// Cheap wake-up: a background-job completion that wakes a Chat whose context was just compacted runs that one run on
// a cheaper model of the same provider (each model has its own prompt cache, so only a small, cold context pays off).
// The wake's input carries a one-run override (our pi-durable patch, `InputSubmissionDraft.override`): the cheap model
// and hand_back, used by that run's generations and tool calls only. Nothing is stored in `pi.agent`, so forks, tree
// navigation and later runs keep the own model; any input that joins the run at a tool boundary (owner input, another
// completion, a Subagent update) or an extension's continuation ends the override, so it never answers on the cheap
// model. The cheap-turn instruction is never stored: each request of the run gets it while the override lasts.
import { readFileSync } from "node:fs";
import type { Context } from "@earendil-works/chord/context";
import { str, obj } from "@earendil-works/pi-schema";
import {
	AgentDoc, CompactionEntry, type Conversation, type ConversationId, defineExtension, defineTool, GenerationTask, hook,
	InboxDoc, type InputSubmissionDraft, LiveDoc, type ModelRef, type SubmissionId, type Tx,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineDoc } from "./store-schema.ts";
import { batchSize } from "./checkpoint.ts";
import { redact, sealed } from "./redact.ts";

export const HAND_BACK = "hand_back";
export const CHEAP_INSTRUCTION = `[Cheap wake-up] This turn runs on a cheaper model because the context was just compacted. If the result above needs no real work (tests passed, expected output), act on it briefly: report the outcome in a line or two and, if this Chat belongs to a Workstream, save it per the workstreams skill; then end the turn. If it needs real work (a failure to debug, a decision, code to change), call ${HAND_BACK} with a one-line reason and do nothing else.`;

/**
 * Each finished hand_back by its tool task, with the own model it named (a replay after a restart finds it) and the
 * run's generation task (`run`), so a second call in the same run queues nothing.
 */
export const CheapWakeDoc = defineDoc<{ handedBack: Record<string, ModelRef & { run?: number }> }>({
	kind: "workbench.cheap-wake",
	version: 1,
	scope: "conversation",
	// Unchanged from the stored-model version (whose `turn` field is now ignored), so stores it wrote still open.
	history: "rewindable",
	fork: "asOf",
	initial: () => ({ handedBack: {} }),
	checkpointWhen: () => false,
});

type Policy = { models: Record<string, { provider: string; model: string }>; tiers: Record<string, string[]>; reserve: string[] };
const POLICY = JSON.parse(readFileSync(new URL("../../../skills/model-orchestration/references/routing-policy.json", import.meta.url), "utf8")) as Policy;
const ids = (names: readonly string[]) => names.map((name) => POLICY.models[name]!.model);

/** A light tier model (the cheap wake's and a summary writer's tier). */
export const light = (own: ModelRef) => ids(POLICY.tiers.light ?? []).includes(own.modelId);

/** A strong, standard or reserve tier model: one a light model is cheaper than. */
export const heavy = (own: ModelRef) => [...ids(POLICY.tiers.strong ?? []), ...ids(POLICY.tiers.standard ?? []), ...ids(POLICY.reserve)].includes(own.modelId);

/**
 * The routing policy's `light` tier (the `routine` role) model of `own`'s provider, when `own` is a heavier tier's
 * model and that one is available; otherwise none (a Chat already on a light or unknown model keeps it).
 */
export function cheapModel(own: ModelRef, available: readonly { provider: string; id: string }[]): ModelRef | undefined {
	if (!heavy(own)) return undefined;
	const light = ids(POLICY.tiers.light ?? []).find((id) => id !== own.modelId && available.some((m) => m.provider === own.provider && m.id === id));
	return light === undefined ? undefined : { provider: own.provider, modelId: light };
}

/** The own model when a wake-up now may be cheap: an idle conversation whose newest model-visible entry is a compaction summary. */
async function eligible(tx: Tx, id: ConversationId, draft: InputSubmissionDraft): Promise<ModelRef | undefined> {
	// A known request was admitted (and its turn decided) before: resubmit unchanged, which writes nothing.
	if (draft.requestId !== undefined && (await tx.submissionByRequest(id, draft.requestId)) !== undefined) return undefined;
	// Idle with an empty inbox: the wake's input starts its own run at once, which the override needs. No compaction
	// active, checked in this commit: a timer summary still in flight after a /compact finished keeps the own model.
	const live = await tx.doc(LiveDoc, id);
	if (live.run !== undefined || (live.compactions?.length ?? 0) > 0 || (await tx.doc(InboxDoc, id)).items.length > 0) return undefined;
	const newest = (await tx.scanEntries({ conversationId: id }, 20)).items.find((entry) => entry.model !== undefined && entry.model.length > 0);
	if (newest?.kind !== CompactionEntry.kind) return undefined;
	const own = (await tx.doc(AgentDoc, id)).model;
	return own === undefined || !heavy(own) ? undefined : { ...own };
}

/**
 * Submit a wake-up input; just after a compaction its turn runs on the cheaper model with the cheap-turn instruction.
 * Only an eligible wake-up asks for models, of its own provider; a discovery failure delivers it as an ordinary one.
 */
export async function submitWake(conversation: Conversation, draft: InputSubmissionDraft, models: { getAvailable(provider?: string): Promise<readonly { provider: string; id: string }[]> }): Promise<SubmissionId> {
	const own = await conversation.commit((tx) => eligible(tx, conversation.id, draft), context);
	let available: readonly { provider: string; id: string }[] = [];
	try {
		if (own !== undefined) available = await models.getAvailable(own.provider);
	} catch {} // no cheap model: an ordinary delivery
	return conversation.commit(async (tx) => {
		const now = await eligible(tx, conversation.id, draft);
		const cheap = now === undefined ? undefined : cheapModel(now, available);
		if (now === undefined || cheap === undefined) return conversation.submit(tx, draft);
		// hand_back is deferred, so only this run offers it; the instruction rides on its requests (`cheapInstruction`).
		return conversation.submit(tx, { ...draft, override: { model: cheap, tools: [HAND_BACK] } });
	}, context);
}

/**
 * A reopened host resumes a cheap run on the stored model: its override is dropped before anything is scheduled.
 * Except once this round's hand_back committed its receipt and rerun: the override stays so that call still resolves,
 * replays its receipt and ends the run (no request of the run follows a terminating round); the rerun is on the own model.
 */
export async function dropOverride(conversation: Conversation): Promise<void> {
	await conversation.commit(async (tx) => {
		const live = await tx.doc(LiveDoc, conversation.id);
		const run = live.run;
		if (run?.override === undefined) return;
		const handedBack = Object.values((await tx.doc(CheapWakeDoc, conversation.id)).handedBack).some((entry) => entry.run === Number(run.taskId));
		if (!(handedBack && live.tools !== undefined)) delete run.override;
	}, context);
}

/** While the run's override offers hand_back, each request's newest user message (the delivery) carries the instruction. */
const cheapInstruction = hook(GenerationTask, {
	beforeRequest: async ({ messages }, api, c) => {
		if ((await api.snapshot(LiveDoc, api.conversationId, c))?.run?.override?.tools?.includes(HAND_BACK) !== true) return undefined;
		const at = messages.findLastIndex((m) => m.role === "user");
		if (at < 0) return undefined;
		const user = messages[at]!;
		const parts = typeof user.content === "string" ? [{ type: "text" as const, text: user.content }] : user.content;
		return { messages: messages.map((m, i) => (i === at ? ({ ...user, content: [...parts, { type: "text", text: `\n\n${CHEAP_INSTRUCTION}` }] } as typeof m) : m)) };
	},
});

const sanitize = sealed(redact);
const text = (value: string) => [{ type: "text" as const, text: value }];
const handedBack = (own: ModelRef) => ({ output: text(`Handed back to ${own.provider}/${own.modelId}.`), control: { terminate: true } });

const handBack = defineTool({
	name: HAND_BACK,
	description: "End this cheap wake-up turn and hand the delivery to the Chat's own model, which runs next with your reason.",
	parameters: obj({ reason: str({ minLength: 1, description: "One line: why this needs real work" }) }, { open: true }),
	deferred: true,
	// A direct call only: a nested call (codemode) never ends the run, so the cheap model would go on after it.
	callers: ["model"],
	replay: "safe",
	execute: async (args, api, c: Context) => {
		const key = String(api.taskId);
		// A replay after a restart: this call already handed back.
		const done = await api.commit(async (tx) => {
			const found = (await tx.doc(CheapWakeDoc, api.conversationId)).handedBack[key];
			return found === undefined ? undefined : { ...found };
		}, c);
		if (done !== undefined) return handedBack(done);
		// The sole direct call of its batch, or its terminate would not end the run: the own model would answer the other results, then the rerun.
		if ((await batchSize(api, c)) !== 1)
			return { output: text(`Not handed back: ${HAND_BACK} must be called alone in its assistant tool batch. Call it again as the sole call.`), isError: true };
		// Redacted whole, before the first line is cut: the reason becomes a new user message, not a tool argument.
		const reason = sanitize(args.reason).split("\n", 1)[0]!.slice(0, 300);
		const handle = (await api.conversation(api.conversationId, c))!;
		const own = await api.commit(async (tx) => {
			const doc = await tx.doc(CheapWakeDoc, api.conversationId);
			const again = doc.handedBack[key];
			if (again !== undefined) return { ...again };
			// Offered only by a cheap run's override, which input joining the run ends.
			const run = (await tx.doc(LiveDoc, api.conversationId)).run;
			if (run?.override === undefined) return undefined;
			const model = (await tx.doc(AgentDoc, api.conversationId)).model;
			if (model === undefined) return undefined;
			// One rerun per cheap run: a second call in it records its receipt and queues nothing.
			const runId = Number(run.taskId);
			if (Object.values(doc.handedBack).some((entry) => entry.run === runId)) {
				doc.handedBack[key] = { ...model, run: runId };
				return { ...model };
			}
			// Queued behind the terminating round: it starts the next run, on the stored model.
			await handle.submit(tx, {
				type: "input",
				whenBusy: "followUp",
				onAbort: "keep",
				content: `The cheaper model handed this wake-up back (reason: ${reason}). Handle the delivery above yourself.`,
			});
			doc.handedBack[key] = { ...model, run: runId };
			return { ...model };
		}, c);
		if (own === undefined) return { output: text("No cheap wake-up turn is running; continue normally."), isError: true };
		return handedBack(own);
	},
});

export const cheapWakeExtension = defineExtension({ name: "workbench.cheap-wake", tools: [handBack], hooks: [cheapInstruction] });
