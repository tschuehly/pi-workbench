// `compact_and_continue` for Durable Chats (extensions/context-checkpoint, rewritten): the model ends its run at a
// phase boundary; a durable checkpoint task waits until the Chat is idle, runs a manual compaction with the
// extension's summarizer instructions, waits until the summary is actually placed, and then submits exactly one
// continuation (stable request ID). A failed compaction still continues with the diagnostic, as the legacy extension
// does; an explicit cancellation (Esc) is recorded visibly and starts nothing. Every step survives a restart.
import { Type } from "@earendil-works/pi-ai";
import {
	CompactionTask,
	type Conversation,
	type ConversationId,
	defineDoc,
	defineExtension,
	defineTask,
	defineTool,
	type Harness,
	type JsonObject,
	LiveDoc,
	type TaskId,
	type ToolTaskInput,
} from "@earendil-works/pi-durable";
import {
	compactionInstructions,
	MAX_NEXT_PHASE_CHARS,
	MAX_SUMMARY_FOCUS_CHARS,
	validateCheckpointRequest,
} from "../../../extensions/context-checkpoint/coordinator.mjs";
import { pendingBlock } from "./workbench.ts";

/** The continuation (or the record of a cancelled checkpoint) as placed in the transcript. */
export const CHECKPOINT_ENTRY = "workbench.context-checkpoint";
/** PI WEB custom message type of the legacy extension. */
export const CHECKPOINT_CUSTOM_TYPE = "context-checkpoint";

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
					(live.compactions ??= []).push({ taskId: compaction, reason: "manual", blocking: false, attempt: 1 });
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
				else if (outcome.status === "failed") next = { phase: "continue", status: "failed", diagnostic: outcome.error.message };
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
				const requestId = `checkpoint:${String(runtime.taskId)}`;
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
		description: [
			"End the current agent run at a coherent phase boundary, compact older session context using a short focus directive, then automatically start the next phase in the same session. summaryFocus directs Pi's summarizer; it is not a handoff summary and must be 1200 characters or fewer.",
			"Call compact_and_continue alone as the final action of a completed phase, after saving and verifying work that must survive compaction.",
			"Use compact_and_continue only when the next phase is concrete and materially benefits from a smaller context; do not use it to avoid difficult reasoning or unfinished work.",
			"Keep compact_and_continue summaryFocus at 1200 characters or fewer; use it as a short summarizer directive and reference existing evidence paths instead of restating session history.",
			"Do not create a progress file solely for compact_and_continue or call generated notes authoritative, durable checkpoints, Continuation Artifacts, or cross-session handoffs.",
		].join("\n\n"),
		parameters: Type.Object({
			summaryFocus: Type.String({ minLength: 1, description: `Brief directive to Pi's summarizer, not a handoff summary; at most ${MAX_SUMMARY_FOCUS_CHARS} characters` }),
			nextPhase: Type.String({ minLength: 1, description: `One concrete next phase to begin automatically after compaction; at most ${MAX_NEXT_PHASE_CHARS} characters` }),
		}),
		// Scripts cannot schedule a checkpoint: it must be the model's sole call of its round.
		callers: ["model"],
		executionMode: "sequential",
		// Keyed by the tool task: a rerun finds the checkpoint it already scheduled.
		replay: "safe",
		execute: async (args, api, c) => {
			const request: Request = { summaryFocus: args.summaryFocus.trim(), nextPhase: args.nextPhase.trim() };
			const invalid = validateCheckpointRequest(request);
			if (invalid !== undefined) throw new Error(invalid);
			const input = (await api.getTask(api.taskId, c))?.input as ToolTaskInput | undefined;
			const assistant = input?.kind === "model" ? await api.commit((tx) => tx.entry(input.assistant), c) : undefined;
			const calls = ((assistant?.model?.[0] as { content?: { type: string }[] } | undefined)?.content ?? []).filter((block) => block.type === "toolCall").length;
			if (calls > 1)
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

	return defineExtension({ name: "workbench.context-checkpoint", tools: [tool], tasks: [CheckpointTask] });
}
