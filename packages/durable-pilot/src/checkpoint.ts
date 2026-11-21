// `compact_and_continue` for Durable Chats (extensions/context-checkpoint, rewritten): the model ends its run at a
// phase boundary; a durable checkpoint task waits until the Chat is idle, runs a manual compaction with the
// extension's summarizer instructions, waits until the summary is actually placed, and then submits exactly one
// continuation (stable request ID). A failed compaction still continues with the diagnostic, as the legacy extension
// does; an explicit cancellation (Esc) is recorded visibly and starts nothing. Every step survives a restart.
import { obj, str } from "@earendil-works/pi-schema";
import {
	CompactionTask,
	type Conversation,
	type ConversationId,
	defineExtension,
	defineTool,
	GenerationTask,
	type Harness,
	hook,
	type JsonObject,
	LiveDoc,
	type TaskId,
	type ToolExecutionApi,
	type ToolTaskInput,
} from "@earendil-works/pi-durable";
import { defineDoc, defineTask } from "./store-schema.ts";
import type { Context } from "@earendil-works/chord/context";
import {
	compactionInstructions,
	createContextCeiling,
	MAX_NEXT_PHASE_CHARS,
	MAX_SUMMARY_FOCUS_CHARS,
	validateCheckpointRequest,
} from "../../../extensions/context-checkpoint/coordinator.mjs";
import { redact, sealed } from "./redact.ts";
import { pendingBlock } from "./workbench.ts";

/** The continuation (or the record of a cancelled checkpoint) as placed in the transcript. */
export const CHECKPOINT_ENTRY = "workbench.context-checkpoint";
/** PI WEB custom message type of the legacy extension. */
export const CHECKPOINT_CUSTOM_TYPE = "context-checkpoint";
/** The context-ceiling nudge as placed in the transcript; PI WEB shows it as the legacy `context-ceiling` message. */
export const CEILING_ENTRY = "workbench.context-ceiling";
export const CEILING_CUSTOM_TYPE = "context-ceiling";

type Request = { summaryFocus: string; nextPhase: string };
type Status = "compacted" | "failed" | "cancelled";
export type CheckpointData = { status: Status; nextPhase: string; diagnostic?: string; text?: string };

/** The live checkpoint of a conversation, and which tool call scheduled which checkpoint (a rerun finds its own). */
export const CheckpointDoc = defineDoc<{ active: { task: number; state: "pending" | "compacting" } | null; byTool: Record<string, number> }>({
	kind: "workbench.context-checkpoint",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ active: null, byTool: {} }),
	checkpointWhen: () => false,
});

/** The legacy extension's model-facing continuation text. */
export function continuationText(status: Exclude<Status, "cancelled">, nextPhase: string, diagnostic?: string): string {
	return status === "failed"
		? [`Context checkpoint failed: ${diagnostic}.`, "Report the checkpoint failure, then continue only if the remaining context is sufficient.", `Requested next phase: ${nextPhase}`].join("\n\n")
		: ["Context checkpoint completed.", `Continue with the requested next phase: ${nextPhase}`, "Use the compacted checkpoint as context, but verify repository state before relying on consequential claims."].join("\n\n");
}

type Checkpoint =
	| { phase: "settle" }
	| { phase: "compacting"; compaction: number }
	| { phase: "continue"; status: Status; diagnostic?: string };

const text = (value: string) => [{ type: "text" as const, text: value }];
const sanitize = sealed(redact);

/** The request ID of the continuation a checkpoint task submits; a child's reporter waits for its answer. */
export const continuationRequestId = (task: number) => `checkpoint:${String(task)}`;

/** How many tool calls the assistant message that made this call holds (0 for a call no model made). */
export async function batchSize(api: Pick<ToolExecutionApi, "taskId" | "getTask" | "commit">, c: Context): Promise<number> {
	const input = (await api.getTask(api.taskId, c))?.input as ToolTaskInput | undefined;
	const assistant = input?.kind === "model" ? await api.commit((tx) => tx.entry(input.assistant), c) : undefined;
	return ((assistant?.model?.[0] as { content?: { type: string }[] } | undefined)?.content ?? []).filter((block) => block.type === "toolCall").length;
}

/** Extension of the checkpoint tool and task; `harness` is the host's, for the conversation-level operations. */
export function checkpointExtension(harness: () => Harness) {
	const conversation = async (id: ConversationId, c: Parameters<Harness["conversation"]>[1]): Promise<Conversation> => (await harness().conversation(id, c))!;

	const CheckpointTask = defineTask<{ request: Request }, Checkpoint, null>({
		name: "workbench.context-checkpoint",
		version: 1,
		initial: () => ({ phase: "settle" }),
		phases: {
			// Like the legacy extension's agent_settled: compact only once the run that asked for it has ended.
			settle: async (task, runtime, c) => {
				await (await runtime.conversation(runtime.conversationId, c))!.waitForIdle(c);
				await runtime.commit(async (tx) => {
					// Durable's own manual compaction, created with its live status in the same commit as this phase change,
					// so a restart never creates a second one.
					const compaction = await tx.createTask(CompactionTask, { reason: "manual", instructions: compactionInstructions(task.input.request) }, { ownership: { kind: "conversation" } });
					const live = await tx.doc(LiveDoc, runtime.conversationId);
					// Pushed through the draft (as Durable's addCompactionStatus): `(x ??= []).push` would mutate an untracked array,
					// leaving the status (and so isCompacting and Stop) empty while the summary runs.
					live.compactions ??= [];
					live.compactions.push({ taskId: compaction, trigger: "manual", blocking: false, attempt: 1 });
					const doc = await tx.doc(CheckpointDoc, runtime.conversationId);
					if (doc.active !== null) doc.active.state = "compacting";
					return { status: "running", checkpoint: { phase: "compacting", compaction } };
				}, c);
			},
			compacting: async (task, runtime, c) => {
				const id = (task.state.checkpoint as Extract<Checkpoint, { phase: "compacting" }>).compaction as TaskId<{ submissionId?: number; entryId?: number }>;
				const { outcome } = (await runtime.waitForTask(id, c)).state;
				let next: Extract<Checkpoint, { phase: "continue" }>;
				if (outcome.status === "aborted") next = { phase: "continue", status: "cancelled" };
				else if (outcome.status === "failed") next = { phase: "continue", status: "failed", diagnostic: sanitize(outcome.error.message) };
				else if (outcome.result?.submissionId === undefined) next = { phase: "continue", status: "failed", diagnostic: "Nothing to compact" };
				else {
					// Completed means the summary was admitted; continue only once it is placed.
					const placed = await (await harness().submission(outcome.result.submissionId as never, c))!.wait(c);
					next = placed.status === "done"
						? { phase: "continue", status: "compacted" }
						: (placed as { reason?: string }).reason === "aborted"
							? { phase: "continue", status: "cancelled" }
							: { phase: "continue", status: "failed", diagnostic: `The summary was not placed (${(placed as { reason?: string }).reason ?? placed.status})` };
				}
				await runtime.commit(() => ({ status: "running", checkpoint: next }), c);
			},
			continue: async (task, runtime, c) => {
				const { status, diagnostic } = task.state.checkpoint as Extract<Checkpoint, { phase: "continue" }>;
				const { nextPhase } = task.input.request;
				const main = await conversation(runtime.conversationId, c);
				const requestId = continuationRequestId(runtime.taskId);
				if (status === "cancelled") {
					// Explicit cancellation stays cancellation: recorded for the transcript, no new turn.
					const data: CheckpointData = { status, nextPhase, text: "Context checkpoint cancelled; the next phase was not started." };
					await main.submit({ type: "write", requestId, entry: { kind: CHECKPOINT_ENTRY, data } }, c);
				} else {
					const body = continuationText(status, nextPhase, diagnostic);
					// The continuation starts a turn, so it carries a pending Working Mode block as a prompt does (legacy
					// before_agent_start); compaction may have summarized the last one away. Memoized: a rerun sends the same.
					type Memo = { block?: string; workingMode?: JsonObject };
					const memo = (await runtime.memo<JsonObject>("continuation", c)
						?? await runtime.memo<JsonObject>("continuation", await pendingBlock(harness(), main, false).then((b): JsonObject => (b === undefined ? {} : { block: b.text, workingMode: JSON.parse(JSON.stringify(b.details)) as JsonObject })), c)) as Memo;
					const data = { status, nextPhase, ...(diagnostic === undefined ? {} : { diagnostic }), ...(memo.workingMode === undefined ? {} : { workingMode: memo.workingMode }) };
					await main.submit({
						type: "input",
						content: memo.block === undefined ? body : [{ type: "text", text: memo.block }, { type: "text", text: body }],
						whenBusy: "followUp",
						requestId,
						entry: { kind: CHECKPOINT_ENTRY, data: JSON.parse(JSON.stringify(data)) },
					}, c);
				}
				await runtime.commit(async (tx) => {
					const doc = await tx.doc(CheckpointDoc, runtime.conversationId);
					if (doc.active?.task === runtime.taskId) doc.active = null;
					return { status: "terminal", outcome: { status: "completed", result: null } };
				}, c);
			},
		},
		// Ending the Chat suppresses the continuation, as session shutdown does in the legacy extension.
		abort: (_task, runtime, c) =>
			runtime.commit(async (tx) => {
				const doc = await tx.doc(CheckpointDoc, runtime.conversationId);
				if (doc.active?.task === runtime.taskId) doc.active = null;
				return { status: "terminal", outcome: { status: "aborted" } };
			}, c),
	});

	const tool = defineTool({
		name: "compact_and_continue",
		description: "End the run at a completed phase, compact older context, and start the named next phase in this session. Call it alone as the final action, after saving and verifying work that must survive compaction, and only when the next phase is concrete and gains from a smaller context, never to avoid hard reasoning or unfinished work. Do not create a progress file for it, or call the generated notes a durable checkpoint or handoff.",
		parameters: obj({
			summaryFocus: str({ minLength: 1, description: `Short directive to the summarizer, not a handoff summary; at most ${MAX_SUMMARY_FOCUS_CHARS} characters; point to existing evidence paths instead of restating history` }),
			nextPhase: str({ minLength: 1, description: `One concrete next phase to begin after compaction; at most ${MAX_NEXT_PHASE_CHARS} characters` }),
		}, { open: true }),
		// Scripts cannot schedule a checkpoint: it must be the model's sole call of its round.
		callers: ["model"],
		executionMode: "sequential",
		// Keyed by the tool task: a rerun finds the checkpoint it already scheduled.
		replay: "safe",
		execute: async (args, api, c) => {
			const raw: Request = { summaryFocus: args.summaryFocus.trim(), nextPhase: args.nextPhase.trim() };
			const invalid = validateCheckpointRequest(raw);
			if (invalid !== undefined) throw new Error(invalid);
			// The request is copied into the checkpoint task, the summarizer's instructions, this result and the
			// continuation: only its tool-call arguments keep it verbatim. A sanitizer throw fails the call.
			const request: Request = { summaryFocus: sanitize(raw.summaryFocus), nextPhase: sanitize(raw.nextPhase) };
			if ((await batchSize(api, c)) > 1)
				return {
					output: text("Checkpoint not scheduled: compact_and_continue must be called alone in its assistant tool batch. Finish the current work, then call it as the sole final action."),
					details: { accepted: false, state: "batched", ...request },
				};
			const scheduled = await api.commit(async (tx) => {
				const doc = await tx.doc(CheckpointDoc, api.conversationId);
				const key = String(api.taskId);
				if (doc.byTool[key] !== undefined) return { accepted: true, state: "pending" };
				if (doc.active !== null) return { accepted: false, state: doc.active.state };
				const task = await tx.createTask(CheckpointTask, { request }, { ownership: { kind: "conversation" }, background: true });
				doc.byTool[key] = task;
				doc.active = { task, state: "pending" };
				return { accepted: true, state: "pending" };
			}, c);
			return {
				output: text(scheduled.accepted
					? "Context checkpoint scheduled. This agent run will end; Pi will compact the session and automatically begin the requested next phase."
					: `A context checkpoint is already ${scheduled.state}; this request was not added.`),
				details: { ...scheduled, ...request },
				...(scheduled.accepted ? { control: { terminate: true } } : {}),
			};
		},
	});

	// The legacy turn_end nudge: from 200k context tokens, and every further 50k until a compaction drops it, a boundary
	// entry the next request carries (a queued write while the run is busy). Context size as Pi's getContextUsage reads it.
	// shortcut: the ceiling's level is per host process, so a restart above 200k repeats one note; persist it if that matters.
	const ceilings = new Map<ConversationId, ReturnType<typeof createContextCeiling>>();
	const ceilingNudge = hook(GenerationTask, {
		afterResponse: async (message, api, c) => {
			if (message.stopReason === "error" || message.stopReason === "aborted") return;
			const { usage } = message;
			const tokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
			if (tokens <= 0) return;
			if (!ceilings.has(api.conversationId)) ceilings.set(api.conversationId, createContextCeiling());
			const note = ceilings.get(api.conversationId)!(tokens);
			if (note === undefined) return;
			await (await conversation(api.conversationId, c)).submit({
				type: "write",
				requestId: `context-ceiling:${String(api.taskId)}:${String(message.timestamp)}`,
				entry: { kind: CEILING_ENTRY, model: [{ role: "user", content: text(note.content), timestamp: Date.now() }], data: note.details },
			}, c);
		},
	});

	return defineExtension({ name: "workbench.context-checkpoint", tools: [tool], tasks: [CheckpointTask], hooks: [ceilingNudge] });
}
