// Cheap wake-up: a background-job completion that wakes a Chat whose context was just compacted runs that one turn on
// a cheaper model of the same provider (each model has its own prompt cache, so only a small, cold context pays off).
// The turn stores the cheap model in `pi.agent` for its run; the host restores the Chat's own model once the turn's input
// settled (no Durable `afterRun` hook: one on every run would delay every run's end). `hand_back` restores it in its
// own commit, queues the rerun with its reason, and ends the cheap run, so the rerun is placed on the own model.
import { readFileSync } from "node:fs";
import type { Context } from "@earendil-works/chord/context";
import { str, obj } from "@earendil-works/pi-schema";
import {
	AgentDoc, CompactionEntry, type Conversation, type ConversationHandle, type ConversationId, defineExtension, type DocumentReader, defineTool,
	InboxDoc, type InputSubmissionDraft, LiveDoc, type ModelRef, type SubmissionId, type Tx,
} from "@earendil-works/pi-durable";
import { defineDoc } from "./store-schema.ts";
import { context } from "./host.ts";

export const HAND_BACK = "hand_back";
export const CHEAP_INSTRUCTION = `[Cheap wake-up] This turn runs on a cheaper model because the context was just compacted. If the result above needs no real work (tests passed, expected output), act on it briefly: report the outcome in a line or two and, if this Chat belongs to a Workstream, save it per the workstreams skill; then end the turn. If it needs real work (a failure to debug, a decision, code to change), call ${HAND_BACK} with a one-line reason and do nothing else.`;

type Turn = { own: ModelRef; cheap: ModelRef; submission: SubmissionId };
export const CheapWakeDoc = defineDoc<{ turn: Turn | null }>({
	kind: "workbench.cheap-wake",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ turn: null }),
	checkpointWhen: () => false,
});

type Policy = { models: Record<string, { provider: string; model: string }>; tiers: Record<string, string[]>; reserve: string[] };
const POLICY = JSON.parse(readFileSync(new URL("../../../skills/model-orchestration/references/routing-policy.json", import.meta.url), "utf8")) as Policy;
const ids = (names: readonly string[]) => names.map((name) => POLICY.models[name]!.model);

/**
 * The routing policy's `light` tier (the `routine` role) model of `own`'s provider, when `own` is a heavier tier's
 * model and that one is available; otherwise none (a Chat already on a light or unknown model keeps it).
 */
export function cheapModel(own: ModelRef, available: readonly { provider: string; id: string }[]): ModelRef | undefined {
	if (![...ids(POLICY.tiers.strong ?? []), ...ids(POLICY.tiers.standard ?? []), ...ids(POLICY.reserve)].includes(own.modelId)) return undefined;
	const light = ids(POLICY.tiers.light ?? []).find((id) => id !== own.modelId && available.some((m) => m.provider === own.provider && m.id === id));
	return light === undefined ? undefined : { provider: own.provider, modelId: light };
}

/** The cheap model for a wake-up now: an idle conversation whose newest model-visible entry is a compaction summary. */
async function cheapFor(tx: Tx, id: ConversationId, available: readonly { provider: string; id: string }[]): Promise<Omit<Turn, "submission"> | undefined> {
	if ((await tx.doc(LiveDoc, id)).run !== undefined || (await tx.doc(InboxDoc, id)).items.length > 0) return undefined;
	if ((await tx.doc(CheapWakeDoc, id)).turn !== null) return undefined;
	const newest = (await tx.scanEntries({ conversationId: id }, 20)).items.find((entry) => entry.model !== undefined && entry.model.length > 0);
	if (newest?.kind !== CompactionEntry.kind) return undefined;
	const own = (await tx.doc(AgentDoc, id)).model;
	const cheap = own === undefined ? undefined : cheapModel(own, available);
	return cheap === undefined ? undefined : { own: { ...own! }, cheap };
}

/** Submit a wake-up input; just after a compaction its turn runs on the cheaper model with the cheap-turn instruction. */
export async function submitWake(conversation: Conversation, draft: InputSubmissionDraft, models: { getAvailable(): Promise<readonly { provider: string; id: string }[]> }): Promise<SubmissionId> {
	const available = await models.getAvailable();
	return conversation.commit(async (tx) => {
		// A known request was admitted (and its turn decided) before: resubmit unchanged, which writes nothing.
		const known = draft.requestId !== undefined && (await tx.submissionByRequest(conversation.id, draft.requestId)) !== undefined;
		const turn = known ? undefined : await cheapFor(tx, conversation.id, available);
		if (turn === undefined) return conversation.submit(tx, draft);
		const content = typeof draft.content === "string" ? `${draft.content}\n\n${CHEAP_INSTRUCTION}` : [...draft.content, { type: "text" as const, text: CHEAP_INSTRUCTION }];
		const id = await conversation.submit(tx, { ...draft, content });
		const agent = await tx.doc(AgentDoc, conversation.id);
		agent.model = turn.cheap;
		// The lead's filter is an object; hand_back is deferred, so only this turn offers it.
		if (!Array.isArray(agent.modelTools)) agent.modelTools = { ...agent.modelTools, add: [...(agent.modelTools?.add ?? []), HAND_BACK] };
		(await tx.doc(CheapWakeDoc, conversation.id)).turn = { ...turn, submission: id };
		return id;
	}, context);
}

/**
 * End a settled cheap turn: restore the own model (unless the owner picked another meanwhile).
 * shortcut: runs after the commit that settled the turn, so input queued during the cheap turn may get its first request
 * on the cheap model; run it before queued input is placed if Durable offers a hook that does not delay every run.
 */
export async function endCheapTurn(conversation: Conversation, reader: DocumentReader): Promise<void> {
	if (((await reader.snapshot(CheapWakeDoc, conversation.id, context))?.turn ?? null) !== null) await conversation.commit((tx) => endTurn(tx, conversation), context);
}

/** With `reason` (hand_back): end the running turn now and queue its rerun on the own model. */
async function endTurn(tx: Tx, conversation: ConversationHandle, reason?: string): Promise<Turn | undefined> {
	const doc = await tx.doc(CheapWakeDoc, conversation.id);
	if (doc.turn === null) return undefined;
	const turn = JSON.parse(JSON.stringify(doc.turn)) as Turn;
	if (reason === undefined && !["done", "unanswered"].includes((await tx.submission(turn.submission))?.status ?? "done")) return undefined;
	if (reason !== undefined)
		await conversation.submit(tx, {
			type: "input",
			whenBusy: "followUp",
			onAbort: "keep",
			content: `The cheaper model handed this wake-up back (reason: ${reason}). Handle the delivery above yourself.`,
		});
	const agent = await tx.doc(AgentDoc, conversation.id);
	if (agent.model?.provider === turn.cheap.provider && agent.model.modelId === turn.cheap.modelId) agent.model = turn.own;
	if (!Array.isArray(agent.modelTools) && agent.modelTools?.add !== undefined) agent.modelTools = { ...agent.modelTools, add: agent.modelTools.add.filter((name) => name !== HAND_BACK) };
	doc.turn = null;
	return turn;
}

const handBack = defineTool({
	name: HAND_BACK,
	description: "End this cheap wake-up turn and hand the delivery to the Chat's own model, which runs next with your reason.",
	parameters: obj({ reason: str({ minLength: 1, description: "One line: why this needs real work" }) }, { open: true }),
	deferred: true,
	replay: "safe",
	execute: async (args, api, c: Context) => {
		const handle = (await api.conversation(api.conversationId, c))!;
		const turn = await api.commit((tx) => endTurn(tx, handle, args.reason.split("\n", 1)[0]!.slice(0, 300)), c);
		if (turn === undefined) return { output: [{ type: "text" as const, text: "No cheap wake-up turn is running; continue normally." }], isError: true };
		return { output: [{ type: "text" as const, text: `Handed back to ${turn.own.provider}/${turn.own.modelId}.` }], control: { terminate: true } };
	},
});

export const cheapWakeExtension = defineExtension({ name: "workbench.cheap-wake", tools: [handBack] });
