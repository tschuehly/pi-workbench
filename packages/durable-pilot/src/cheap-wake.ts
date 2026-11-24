// Cheap wake-up: a background-job completion that wakes a Chat whose context was just compacted runs that one turn on
// a cheaper model of the same provider (each model has its own prompt cache, so only a small, cold context pays off).
// Durable has no per-run model, so the turn stores the cheap model in `pi.agent`; it is scoped to the wake's own run:
// - the host restores the Chat's own model once the turn's input settled (no Durable `afterRun` hook: one on every run
//   would delay every run's end), at host start, and `hand_back` in its own commit (with the rerun it queues);
// - owner input (`admit`) restores it in its admission commit, so it never joins a cheap run on the cheap model;
// - the owner choosing a model ends the turn and keeps the choice;
// - a branch forked inside the turn carries its record (`asOf`, as `pi.agent`) and restores at the owner's first input.
import { readFileSync } from "node:fs";
import type { Context } from "@earendil-works/chord/context";
import { str, obj } from "@earendil-works/pi-schema";
import {
	AgentDoc, CompactionEntry, type Conversation, type ConversationId, defineExtension, type DocumentReader, defineTool,
	InboxDoc, type InputSubmissionDraft, LiveDoc, type ModelRef, type SubmissionId, type Tx,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineDoc } from "./store-schema.ts";
import { batchSize } from "./checkpoint.ts";
import { redact, sealed } from "./redact.ts";

export const HAND_BACK = "hand_back";
export const CHEAP_INSTRUCTION = `[Cheap wake-up] This turn runs on a cheaper model because the context was just compacted. If the result above needs no real work (tests passed, expected output), act on it briefly: report the outcome in a line or two and, if this Chat belongs to a Workstream, save it per the workstreams skill; then end the turn. If it needs real work (a failure to debug, a decision, code to change), call ${HAND_BACK} with a one-line reason and do nothing else.`;

type Turn = { own: ModelRef; cheap: ModelRef; submission: SubmissionId };
/** The running cheap turn, and each finished hand_back by its tool task (a replay after a restart finds it). */
export const CheapWakeDoc = defineDoc<{ turn: Turn | null; handedBack: Record<string, ModelRef> }>({
	kind: "workbench.cheap-wake",
	version: 1,
	scope: "conversation",
	// As `pi.agent`: a fork at an entry inside the turn holds the cheap model and the record that restores it.
	history: "rewindable",
	fork: "asOf",
	initial: () => ({ turn: null, handedBack: {} }),
	checkpointWhen: () => false,
});

type Policy = { models: Record<string, { provider: string; model: string }>; tiers: Record<string, string[]>; reserve: string[] };
const POLICY = JSON.parse(readFileSync(new URL("../../../skills/model-orchestration/references/routing-policy.json", import.meta.url), "utf8")) as Policy;
const ids = (names: readonly string[]) => names.map((name) => POLICY.models[name]!.model);

const heavy = (own: ModelRef) => [...ids(POLICY.tiers.strong ?? []), ...ids(POLICY.tiers.standard ?? []), ...ids(POLICY.reserve)].includes(own.modelId);

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
	if ((await tx.doc(LiveDoc, id)).run !== undefined || (await tx.doc(InboxDoc, id)).items.length > 0) return undefined;
	if ((await tx.doc(CheapWakeDoc, id)).turn !== null) return undefined;
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
		const content = typeof draft.content === "string" ? `${draft.content}\n\n${CHEAP_INSTRUCTION}` : [...draft.content, { type: "text" as const, text: CHEAP_INSTRUCTION }];
		const id = await conversation.submit(tx, { ...draft, content });
		const agent = await tx.doc(AgentDoc, conversation.id);
		agent.model = cheap;
		// The lead's filter is an object; hand_back is deferred, so only this turn offers it.
		if (!Array.isArray(agent.modelTools)) agent.modelTools = { ...agent.modelTools, add: [...(agent.modelTools?.add ?? []), HAND_BACK] };
		(await tx.doc(CheapWakeDoc, conversation.id)).turn = { own: now, cheap, submission: id };
		return id;
	}, context);
}

/**
 * End a settled cheap turn: restore the own model (unless the owner picked another meanwhile).
 * shortcut: runs after the commit that settled the turn, so input queued during the cheap turn by others than the owner
 * (another delivery) may get its first request on the cheap model; run it before queued input is placed if Durable
 * offers a hook that does not delay every run.
 */
export async function endCheapTurn(conversation: Conversation, reader: DocumentReader): Promise<void> {
	if (((await reader.snapshot(CheapWakeDoc, conversation.id, context))?.turn ?? null) !== null) await conversation.commit((tx) => settleTurn(tx, conversation.id), context);
}

/**
 * In owner input's admission commit (`admit`), or with `keep` when the owner picks a model: end a cheap turn at once,
 * running or not, so what the owner asks never runs on the cheap model or is offered hand_back.
 */
export async function endCheapTurnNow(tx: Tx, id: ConversationId, keep = false): Promise<void> {
	await endTurn(tx, id, keep ? "keep" : "restore");
}

/** A settled turn ends restoring the own model; a running one only through `endCheapTurnNow` or hand_back. */
async function settleTurn(tx: Tx, id: ConversationId): Promise<void> {
	const turn = (await tx.doc(CheapWakeDoc, id)).turn;
	if (turn !== null && ["done", "unanswered"].includes((await tx.submission(turn.submission))?.status ?? "done")) await endTurn(tx, id, "restore");
}

/** Clear the turn and hand_back; `restore` puts the own model back when the cheap one is still set. */
async function endTurn(tx: Tx, id: ConversationId, model: "restore" | "keep"): Promise<Turn | undefined> {
	const doc = await tx.doc(CheapWakeDoc, id);
	if (doc.turn === null) return undefined;
	const turn = JSON.parse(JSON.stringify(doc.turn)) as Turn;
	const agent = await tx.doc(AgentDoc, id);
	if (model === "restore" && agent.model?.provider === turn.cheap.provider && agent.model.modelId === turn.cheap.modelId) agent.model = turn.own;
	if (!Array.isArray(agent.modelTools) && agent.modelTools?.add !== undefined) agent.modelTools = { ...agent.modelTools, add: agent.modelTools.add.filter((name) => name !== HAND_BACK) };
	doc.turn = null;
	return turn;
}

const sanitize = sealed(redact);
const text = (value: string) => [{ type: "text" as const, text: value }];
const handedBack = (own: ModelRef) => ({ output: text(`Handed back to ${own.provider}/${own.modelId}.`), control: { terminate: true } });

const handBack = defineTool({
	name: HAND_BACK,
	description: "End this cheap wake-up turn and hand the delivery to the Chat's own model, which runs next with your reason.",
	parameters: obj({ reason: str({ minLength: 1, description: "One line: why this needs real work" }) }, { open: true }),
	deferred: true,
	replay: "safe",
	execute: async (args, api, c: Context) => {
		// Alone, or its terminate would not end the run: the own model would answer the other results, then the rerun.
		if ((await batchSize(api, c)) > 1)
			return { output: text(`Not handed back: ${HAND_BACK} must be called alone in its assistant tool batch. Call it again as the sole call.`), isError: true };
		// Redacted whole, before the first line is cut: the reason becomes a new user message, not a tool argument.
		const reason = sanitize(args.reason).split("\n", 1)[0]!.slice(0, 300);
		const handle = (await api.conversation(api.conversationId, c))!;
		const own = await api.commit(async (tx) => {
			const doc = await tx.doc(CheapWakeDoc, api.conversationId);
			const key = String(api.taskId);
			// A replay after a restart: this call already handed back.
			const done = doc.handedBack[key];
			if (done !== undefined) return { ...done };
			const turn = await endTurn(tx, api.conversationId, "restore");
			if (turn === undefined) return undefined;
			await handle.submit(tx, {
				type: "input",
				whenBusy: "followUp",
				onAbort: "keep",
				content: `The cheaper model handed this wake-up back (reason: ${reason}). Handle the delivery above yourself.`,
			});
			doc.handedBack[key] = turn.own;
			return turn.own;
		}, c);
		if (own === undefined) return { output: text("No cheap wake-up turn is running; continue normally."), isError: true };
		return handedBack(own);
	},
});

export const cheapWakeExtension = defineExtension({ name: "workbench.cheap-wake", tools: [handBack] });
