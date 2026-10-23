// Subagents and Workers in a Durable Chat (extensions/subagent, rewritten): each assignment is a fresh native child
// conversation owned by a background anchor task, and a background reporter task admits the assignment, records its
// one terminal result, and wakes the lead once. Profiles, Cognitive Roles, routing (the model-orchestration resolver),
// independence and bounded collection are the legacy extension's own (`core.mjs`). Records live in documents of the
// conversation that launched them (fork: initial), Workers in a session document owned by their lead conversation, so a
// fork of a Chat starts with neither children nor control of the source's Workers.
//
// Survival: a restart resumes the reporter in its phase. The assignment, the wake and steering messages are submitted
// under stable request IDs; result, Worker receipt and lock release commit together; a cancellation epoch committed
// before the abort keeps a late reporter from reviving cancelled work; collection commits what it returned, keyed by the
// collecting tool call, so a rerun returns the same text instead of losing or re-marking results.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as BACKGROUND, withCancel } from "@earendil-works/chord/context";
import { type AssistantMessage, clampThinkingLevel, type ModelThinkingLevel, StringEnum, Type } from "@earendil-works/pi-ai";
import {
	configure,
	type ConversationHandle,
	type ConversationId,
	type DocumentReader,
	defineDoc,
	defineExtension,
	defineTask,
	defineTool,
	type Extension,
	type Harness,
	type JsonObject,
	LiveDoc,
	type TaskId,
	type ToolRegistration,
	type Tx,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { taskLabel } from "../../../packages/pi-execution-adapter/src/index.js";
import {
	COGNITIVE_ROLES,
	collectAll,
	INDEPENDENT_ROLES,
	LEAF_PROFILES,
	MODEL_EFFORTS,
	NO_NESTED_WORKERS,
	PROFILES,
	providerOf,
	resolveBinding,
	ROLE_GUIDE,
	STATUS_INSTRUCTION,
	UPDATE_REQUEST,
	WEB_TOOLS,
	WORKER_PROFILES,
	WORKER_ROLES,
} from "../../../extensions/subagent/core.mjs";
import { CUSTOM_TYPE as COMPLETION_CUSTOM_TYPE, NORMAL_CONTENT } from "../../../extensions/subagent/completion-wakeup.mjs";
import { CheckpointDoc } from "./checkpoint.ts";
import { redact, sealed } from "./redact.ts";

/** A completion wake as placed in the lead's transcript (legacy custom message `pi-workbench:child-completion`). */
export const COMPLETION_ENTRY = "workbench.child-completion";
export { COMPLETION_CUSTOM_TYPE };
/** A child's requested status update as placed in the lead's transcript (legacy `pi-workbench:child-update`). */
export const UPDATE_ENTRY = "workbench.child-update";
export const UPDATE_CUSTOM_TYPE = "pi-workbench:child-update";
/** PI WEB's Activity roster status key (Workbench `extensions/activity`). */
export const ACTIVITY_STATUS_KEY = "pi-workbench:activity";

/** Longest child answer kept for collection, as the legacy extension retains it; the rest stays in the child. */
const RESULT_MAX = 8_000;
const CANCEL_TIMEOUT_MS = 15_000;
const KEPT_COLLECTIONS = 20;

const sanitize = sealed(redact);

// ─── Records ─────────────────────────────────────────────────────────────────

export type Outcome = "running" | "success" | "execution_failed" | "cancelled" | "outcome_unknown";
export type Execution = {
	executionId: string;
	kind: "subagent" | "worker";
	name: string;
	profile: string;
	cognitiveRole: string;
	provider: string;
	model: string;
	effort: string;
	fallback?: string;
	independence?: JsonObject;
	cwd: string;
	taskPreview: string;
	launchedAt: string;
	conversationId: number;
	anchor: number;
	reporter: number;
	background: boolean;
	workerId?: string;
	workerName?: string;
	continuing?: boolean;
	outcome: Outcome;
	endedAt?: string;
	text?: string;
	/** Characters of the child's answer; more than `text` holds when truncated. */
	length?: number;
	truncated?: boolean;
	diagnostic?: string;
	collected: boolean;
	/** Set before a cancellation aborts anything: no reporter may record a result or wake the lead afterwards. */
	cancelEpoch?: number;
	reportedStatus?: string;
	reportedAt?: string;
	steers: number;
	/** A steer with requestUpdate: the next report_status from a later tool call wakes the lead once. */
	updateAfterTask?: number;
};

type Result = { output: { type: "text"; text: string }[]; details: JsonObject; isError?: true };

type DelegationState = {
	executions: Record<string, Execution>;
	/** Execution by the launching tool call, so a rerun after a restart finds its own child. */
	byTask: Record<string, string>;
	/** What a collecting tool call returned, by that call: a rerun returns it again. */
	collections: Record<string, Result>;
	/** Steer sequence and update wake by tool call, for reruns. */
	steerByTask: Record<string, number>;
	updateByTask: Record<string, { executionId: string; seq: number; text: string }>;
	cancelEpoch: number;
	/** The last completion wake: a later completion adds none while it is still queued (coalescing). */
	wake: { seq: number; pending: number | null };
};

/** The children this conversation launched; a fork starts with none. */
export const DelegationDoc = defineDoc<DelegationState>({
	kind: "workbench.delegation",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ executions: {}, byTask: {}, collections: {}, steerByTask: {}, updateByTask: {}, cancelEpoch: 0, wake: { seq: 0, pending: null } }),
	checkpointWhen: () => false,
});

/** Who a child conversation is: empty `executionId` for a lead. */
export const ChildDoc = defineDoc<{ executionId: string; parentConversationId: number; kind: "subagent" | "worker" | "lead"; depth: number }>({
	kind: "workbench.child",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ executionId: "", parentConversationId: 0, kind: "lead", depth: 0 }),
	checkpointWhen: () => false,
});

type Receipt = { executionId: string; outcome: Outcome; cognitiveRole: string; provider: string; model: string; effort: string; acceptedAt: string; endedAt: string; diagnostic?: string };
export type Worker = {
	workerId: string;
	name: string;
	scope: string;
	profile: string;
	repositoryRoot: string;
	/** The lead conversation that owns it; a fork is another conversation and gets no control. */
	ownerConversationId: number;
	createdAt: string;
	/** One child conversation per dispatch, each forked from the previous one: the Worker's scoped continuity. */
	lineage: number[];
	lock: { executionId: string; acquiredAt: string } | null;
	retired: { at: string; reason: string } | null;
	requiresInspection: { at: string; diagnostic: string } | null;
	receipts: Receipt[];
};
export const WorkersDoc = defineDoc<{ workers: Record<string, Worker>; byTask: Record<string, string> }>({
	kind: "workbench.workers",
	version: 1,
	scope: "session",
	initial: () => ({ workers: {}, byTask: {} }),
	checkpointWhen: () => false,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const text = (value: string) => [{ type: "text" as const, text: value }];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** A display bound. Sanitize first: a cut through a secret leaves a fragment no redactor recognizes. */
const bounded = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max)}…`);
const iso = (ms: number) => new Date(ms).toISOString();
function stableId(...parts: string[]): string {
	const hex = createHash("sha256").update(parts.join("\0")).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
const failure = (outcome: string, diagnostic: string): Result => ({ output: text(`${outcome}: ${diagnostic}`), details: { outcome, diagnostic }, isError: true });

let holdFn: (name: string, signal: AbortSignal | undefined) => Promise<void> = async () => {};
/** Test barriers at the reporter's fault windows (the crash matrix); a no-op unless a test host installs one. */
export function setDelegationHold(hold: typeof holdFn): void {
	holdFn = hold;
}

function messageText(message: AssistantMessage | undefined): string {
	return (message?.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/** The compact result the lead reads, with the receipt naming the model that actually ran. */
export function resultOf(e: Execution): Result {
	const summary = e.outcome === "success"
		? e.text || "Child completed without a text result."
		: `${e.outcome}: ${e.diagnostic ?? e.text ?? "No diagnostic was reported."}`;
	const remainder = e.truncated === true
		? `\n\n[Result truncated: showing the first ${String(RESULT_MAX)} of ${String(e.length ?? 0)} characters; the full answer stays in child conversation ${String(e.conversationId)}.]`
		: "";
	const family = typeof e.independence?.selectedFamily === "string" ? ` · family ${e.independence.selectedFamily}` : "";
	const receipt = `\n\nCompletion receipt: ${e.provider}/${e.model}:${e.effort} · ${e.kind} · ${e.profile} · ${e.cognitiveRole} · outcome ${e.outcome}${family}${e.truncated === true ? " · TRUNCATED, cannot satisfy verification" : ""}`;
	return {
		output: text(`${summary}${remainder}${receipt}`),
		details: copy({ executionId: e.executionId, outcome: e.outcome, kind: e.kind, provider: e.provider, model: e.model, effort: e.effort, profile: e.profile, cognitiveRole: e.cognitiveRole, truncated: e.truncated === true, conversationId: e.conversationId, ...(e.workerId === undefined ? {} : { workerId: e.workerId }) }),
		...(e.outcome === "success" ? {} : { isError: true as const }),
	};
}

function stateLine(e: Execution): string {
	const state = e.outcome === "running" ? (e.cancelEpoch === undefined ? "running" : "cancelling") : `${e.outcome}, ${e.collected ? "collected" : "uncollected"}`;
	const latest = e.reportedStatus ?? "no status report yet";
	return `${e.executionId} [${state}] ${e.kind} · ${e.profile} · ${e.cognitiveRole} · ${e.provider}/${e.model}:${e.effort}${e.workerName === undefined ? "" : ` · worker "${e.workerName}"`} — ${latest}`;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** Owns one child conversation until its reporter ends; aborting it reaches the child's runs. */
const Anchor = defineTask<{ executionId: string }, { phase: "hold" }, null>({
	name: "workbench.child-anchor",
	version: 1,
	initial: () => ({ phase: "hold" }),
	phases: {
		hold: async (task, runtime, c) => {
			const reporter = (await runtime.snapshot(DelegationDoc, runtime.conversationId, c))?.executions[task.input.executionId]?.reporter;
			if (reporter !== undefined) await runtime.waitForTask(reporter as TaskId, c);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), c);
		},
	},
	abort: (_task, runtime, c) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c),
});

type ReporterState = { phase: "run" } | { phase: "wake"; deliver: boolean } | { phase: "deliver"; seq: number; followUp: boolean };

function reporterTask(options: DelegationOptions) {
	return defineTask<{ executionId: string; assignment: string }, ReporterState, null>({
		name: "workbench.child-reporter",
		version: 1,
		initial: () => ({ phase: "run" }),
		phases: {
			run: async (task, runtime, c) => {
				const id = task.input.executionId;
				await holdFn("child:before-admission", runtime.signal);
				const before = (await runtime.snapshot(DelegationDoc, runtime.conversationId, c))!.executions[id]!;
				if (before.cancelEpoch !== undefined) {
					await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c);
					return;
				}
				const conversation = before.conversationId as ConversationId;
				const child = (await runtime.conversation(conversation, c))!;
				const submission = await child.submit({ type: "input", content: task.input.assignment, whenBusy: "followUp", requestId: `assignment:${id}` }, c);
				const settled = await submission.wait(c);
				const done = settled.status === "done";
				let answers: { entry: { id: unknown }; message: AssistantMessage }[];
				// Steers and follow-ups the lead admitted run after the assignment answered: the child ends once they all have.
				for (;;) {
					if (done) await child.waitForIdle(c);
					if (before.kind === "worker" && done) await settleLeaves(runtime, child, id, c);
					await holdFn("child:after-result", runtime.signal);
					const view = await runtime.context(conversation, c);
					const replies = view.entries.flatMap((entry) => {
						const message = entry.model?.[0] as AssistantMessage | undefined;
						return message?.role === "assistant" ? [{ entry, message }] : [];
					});
					answers = replies.filter(({ message }) => message.stopReason === "stop");
					// A later run that failed or was stopped decides the outcome, not the assignment's earlier answer.
					const late = done ? replies.at(-1)?.message : undefined;
					const lateEnd = late?.stopReason === "error" || late?.stopReason === "aborted" ? late : undefined;
					const answer = sanitize(messageText(answers.at(-1)?.message));
					const outcome: Outcome = lateEnd !== undefined ? (lateEnd.stopReason === "aborted" ? "cancelled" : "execution_failed")
						: done ? "success" : settled.reason === "aborted" ? "cancelled" : "execution_failed";
					const diagnostic = lateEnd !== undefined ? `child run after its assignment ended ${lateEnd.stopReason}${lateEnd.errorMessage === undefined ? "" : `: ${sanitize(lateEnd.errorMessage)}`}`
						: settled.status === "unanswered" ? `child input ended unanswered (${settled.reason})` : "child failed";
					const endedAt = iso(runtime.now());
					let pending = false;
					await runtime.commit(async (tx) => {
						const doc = await tx.doc(DelegationDoc, runtime.conversationId);
						const e = doc.executions[id]!;
						const cancelled = e.cancelEpoch !== undefined;
						if (!cancelled && e.outcome === "running") {
							// Checked in this commit, which the steer tool's admission commit is ordered against: none slips past.
							if (outcome === "success" && (await steerPending(tx, conversation, e))) {
								pending = true;
								return undefined;
							}
							e.outcome = outcome;
							e.endedAt = endedAt;
							e.length = answer.length;
							e.text = answer.slice(0, RESULT_MAX);
							if (answer.length > RESULT_MAX) e.truncated = true;
							if (outcome !== "success") e.diagnostic = diagnostic;
							if (e.workerId !== undefined) settleWorker(await tx.doc(WorkersDoc), e);
						}
						return { status: "running", checkpoint: { phase: "wake", deliver: e.background && !cancelled && !e.collected } };
					}, c);
					if (!pending) break;
					// A steer admitted but not yet submitted to the child: wait for it to arrive and run.
					await sleep(50, undefined, { signal: runtime.signal });
				}
				const record = (await runtime.snapshot(DelegationDoc, runtime.conversationId, c))!.executions[id]!;
				options.record("execution.settled", { executionId: id, kind: record.kind, outcome: record.outcome, childSessionId: `${options.chatId}:${String(conversation)}`, ...(record.workerId === undefined ? {} : { workerId: record.workerId }) });
				for (const { entry, message } of answers)
					options.record("usage", {
						sessionId: `${options.chatId}:${String(conversation)}`,
						usageKey: `${options.chatId}:${String(conversation)}:assistant:${String(entry.id)}`,
						usage: message.usage, provider: message.provider ?? null, model: message.model ?? null, entryId: String(entry.id), executionId: id,
					});
			},
			wake: async (task, runtime, c) => {
				const { deliver } = task.state.checkpoint as Extract<ReporterState, { phase: "wake" }>;
				await holdFn("child:before-delivery", runtime.signal);
				if (!deliver) {
					await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), c);
					return;
				}
				// Checkpoint barrier: a completion during compact_and_continue waits until its continuation is admitted, then
				// queues behind it, so the continuation is placed first (legacy checkpoint-barrier).
				let held = false;
				for (;;) {
					const active = (await runtime.snapshot(CheckpointDoc, runtime.conversationId, c))?.active;
					if (active === null || active === undefined) break;
					held = true;
					await runtime.waitForTask(active.task as TaskId, c);
				}
				await runtime.commit(async (tx) => {
					const doc = await tx.doc(DelegationDoc, runtime.conversationId);
					const e = doc.executions[task.input.executionId]!;
					if (e.collected || e.cancelEpoch !== undefined) return { status: "terminal", outcome: { status: "completed", result: null } };
					if (doc.wake.pending !== null) {
						const pending = await tx.submissionByRequest(runtime.conversationId, `wake:${String(doc.wake.pending)}`);
						// One wake per attention cycle: the lead collects every terminal child when the queued one arrives.
						if (pending === undefined || pending.status === "queued") return { status: "terminal", outcome: { status: "completed", result: null } };
					}
					doc.wake.seq += 1;
					doc.wake.pending = doc.wake.seq;
					return { status: "running", checkpoint: { phase: "deliver", seq: doc.wake.seq, followUp: held } };
				}, c);
			},
			deliver: async (task, runtime, c) => {
				const { seq, followUp } = task.state.checkpoint as Extract<ReporterState, { phase: "deliver" }>;
				const lead = (await runtime.conversation(runtime.conversationId, c))!;
				await lead.submit({
					type: "input",
					content: NORMAL_CONTENT,
					whenBusy: followUp ? "followUp" : "steer",
					requestId: `wake:${String(seq)}`,
					entry: { kind: COMPLETION_ENTRY, data: { attention: "terminal-results" } },
				}, c);
				await holdFn("child:after-delivery", runtime.signal);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), c);
			},
		},
		abort: (_task, runtime, c) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c),
	});
}

/** Whether a steer or follow-up admitted for this child is not yet submitted to it, or not yet answered. */
async function steerPending(tx: Tx, conversation: ConversationId, e: Execution): Promise<boolean> {
	for (let seq = 1; seq <= e.steers; seq++) {
		const submission = await tx.submissionByRequest(conversation, `steer:${e.executionId}:${String(seq)}`);
		if (submission === undefined || submission.status === "queued" || submission.status === "placed") return true;
	}
	return false;
}

/** What settling leaves needs of the reporter's runtime. */
type LeafRuntime = DocumentReader & { waitForTask(id: TaskId, c: Context): Promise<unknown> };

/**
 * A Worker settles only after its background leaves ended and were collected: wait for running leaves (their wakes start
 * the Worker's next run, which collects), then ask once per leaf still uncollected.
 */
async function settleLeaves(runtime: LeafRuntime & { readonly signal: AbortSignal }, worker: ConversationHandle, executionId: string, c: Context): Promise<void> {
	const nudged = new Set<string>();
	for (;;) {
		const leaves = Object.values((await runtime.snapshot(DelegationDoc, worker.id, c))?.executions ?? {});
		// A leaf being cancelled has its receipt once its anchor ends; any other once its reporter ends.
		for (const leaf of leaves.filter((l) => l.outcome === "running")) await runtime.waitForTask((leaf.cancelEpoch === undefined ? leaf.reporter : leaf.anchor) as TaskId, c);
		await worker.waitForIdle(c);
		const now = Object.values((await runtime.snapshot(DelegationDoc, worker.id, c))?.executions ?? {});
		if (now.some((leaf) => leaf.outcome === "running")) {
			// The cancellation is still committing its receipt; yield to it instead of spinning.
			await sleep(50, undefined, { signal: runtime.signal });
			continue;
		}
		const unread = now.filter((leaf) => !leaf.collected && !nudged.has(leaf.executionId));
		if (unread.length === 0) return;
		for (const leaf of unread) nudged.add(leaf.executionId);
		const ids = unread.map((leaf) => leaf.executionId);
		const submission = await worker.submit({
			type: "input",
			content: `Your background Subagent ${ids.join(", ")} finished and is not collected yet. Call subagent_collect once before you finish.`,
			whenBusy: "followUp",
			requestId: `settle:${executionId}:${ids.join(",")}`,
		}, c);
		await submission.wait(c);
	}
}

/** Release a Worker's dispatch lock with its one terminal receipt, in the commit that records the result. */
function settleWorker(doc: { workers: Record<string, Worker> }, e: Execution): void {
	const worker = doc.workers[e.workerId!];
	if (worker === undefined || worker.lock?.executionId !== e.executionId) return;
	worker.lock = null;
	worker.receipts.push({
		executionId: e.executionId, outcome: e.outcome, cognitiveRole: e.cognitiveRole, provider: e.provider, model: e.model, effort: e.effort,
		acceptedAt: e.launchedAt, endedAt: e.endedAt ?? new Date().toISOString(), ...(e.diagnostic === undefined ? {} : { diagnostic: e.diagnostic }),
	});
	if (e.outcome === "outcome_unknown") worker.requiresInspection = { at: e.endedAt ?? new Date().toISOString(), diagnostic: e.diagnostic ?? "unknown outcome" };
}

/**
 * Cancel one execution: commit the cancellation epoch first, then abort its reporter and anchor (reaching the child's
 * runs) and, for a Worker, its running leaves. The receipt says `cancelled` only once the anchor is terminal;
 * otherwise `outcome_unknown`.
 */
export async function cancelExecution(harness: Harness, parent: ConversationId, executionId: string, reason: string): Promise<{ outcome: Outcome; already?: true } | undefined> {
	const conversation = await harness.conversation(parent, BACKGROUND);
	if (conversation === undefined) return undefined;
	const marked = await conversation.commit(async (tx) => {
		const doc = await tx.doc(DelegationDoc, parent);
		const e = doc.executions[executionId];
		if (e === undefined) return undefined;
		if (e.outcome !== "running") return { e: copy(e), already: true as const };
		if (e.cancelEpoch === undefined) e.cancelEpoch = doc.cancelEpoch += 1;
		e.collected = true;
		return { e: copy(e) };
	}, BACKGROUND);
	if (marked === undefined) return undefined;
	if (marked.already) return { outcome: marked.e.outcome, already: true };
	const e = marked.e;
	await holdFn("cancel:after-mark", undefined);
	if (e.kind === "worker") {
		const leaves = Object.values((await harness.snapshot(DelegationDoc, e.conversationId as ConversationId, BACKGROUND))?.executions ?? {});
		for (const leaf of leaves) if (leaf.outcome === "running") await cancelExecution(harness, e.conversationId as ConversationId, leaf.executionId, "Its Worker was cancelled.");
	}
	await harness.abortTask(e.reporter as TaskId, BACKGROUND);
	await harness.abortTask(e.anchor as TaskId, BACKGROUND);
	const { context: waiting, cancel } = withCancel(BACKGROUND);
	const timer = setTimeout(cancel, CANCEL_TIMEOUT_MS);
	const confirmed = await harness.waitForTask(e.anchor as TaskId, waiting).then(() => true, () => false);
	clearTimeout(timer);
	const outcome: Outcome = confirmed ? "cancelled" : "outcome_unknown";
	await conversation.commit(async (tx) => {
		const doc = await tx.doc(DelegationDoc, parent);
		const current = doc.executions[executionId]!;
		if (current.outcome !== "running") return;
		current.outcome = outcome;
		current.endedAt = new Date().toISOString();
		current.diagnostic = confirmed ? sanitize(reason) : `termination was not confirmed within ${String(CANCEL_TIMEOUT_MS / 1000)}s: ${sanitize(reason)}`;
		if (current.workerId !== undefined) settleWorker(await tx.doc(WorkersDoc), current);
	}, BACKGROUND);
	return { outcome };
}

/**
 * Finish cancellations a restart interrupted after their epoch committed (the cancelling call may never run again, e.g.
 * after Stop): its reporter already refuses to record or wake; this aborts the child and records the receipt.
 */
export async function finishCancellations(harness: Harness, conversation: ConversationId): Promise<void> {
	const doc = await harness.snapshot(DelegationDoc, conversation, BACKGROUND);
	for (const e of Object.values(doc?.executions ?? {}))
		if (e.outcome === "running" && e.cancelEpoch !== undefined) await cancelExecution(harness, conversation, e.executionId, "Cancellation finished after a restart.");
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export type DelegationOptions = {
	readonly chatId: string;
	readonly harness: () => Harness;
	/** Family directory: the routing catalog file is written under it. */
	readonly dir: string;
	/** Telemetry of launches, settlements and child usage. */
	readonly record: (type: string, data: Record<string, unknown>) => void;
	/** Extensions only the lead keeps (the Workbench bash): child conversations deselect them. */
	readonly leadOnly?: readonly Extension[];
};

type Api = Parameters<ToolRegistration["execute"]>[1];

async function caller(api: Api, c: Context) {
	const doc = await api.snapshot(ChildDoc, api.conversationId, c);
	return doc === undefined || doc.executionId === "" ? { depth: 0, kind: "lead" as const } : { depth: doc.depth, kind: doc.kind };
}

/** The profile's tools that are registered here: enabled exactly, and offered except the web tools web_enable loads. */
function childTools(api: Api, names: readonly string[]) {
	const byName = new Map<string, ToolRegistration>();
	for (const { tool } of api.registry.tools()) if (!byName.has(tool.name)) byName.set(tool.name, tool);
	const tools = names.flatMap((name) => byName.get(name) ?? []);
	const lazy = byName.has("web_enable") ? WEB_TOOLS : [];
	return { tools, modelTools: tools.filter((tool) => !lazy.includes(tool.name)) };
}

type Launch = {
	kind: "subagent" | "worker";
	executionId: string;
	name: string;
	profile: string;
	cognitiveRole: string;
	binding: { provider: string; model: string; effort: ModelThinkingLevel; fallback?: string; independence?: JsonObject };
	task: string;
	assignment: string;
	background: boolean;
	tools: ReturnType<typeof childTools>;
	cwd: string;
	depth: number;
	worker?: { workerId: string; name: string; forkFrom?: number };
};

/** In one commit: anchor, child conversation (fresh or forked from the Worker's last one), its agent, reporter, record. */
async function admit(tx: Parameters<Parameters<Api["commit"]>[0]>[0], api: Api, launch: Launch, reporter: ReturnType<typeof reporterTask>, leadOnly: readonly Extension[] = []): Promise<Execution> {
	const doc = await tx.doc(DelegationDoc, api.conversationId);
	let at: number | undefined;
	if (launch.worker?.forkFrom !== undefined) at = (await tx.scanEntries({ conversationId: launch.worker.forkFrom as ConversationId }, 1)).items[0]?.id;
	const background = { ownership: { kind: "conversation" as const }, background: true };
	const anchor = await tx.createTask(Anchor, { executionId: launch.executionId }, background);
	const ownership = { kind: "task" as const, taskId: anchor };
	const child = launch.worker?.forkFrom !== undefined && at !== undefined
		? await tx.forkConversation(launch.worker.forkFrom as ConversationId, at as never, { ownership })
		: await tx.createConversation({ ownership });
	await configure(tx, child.id, {
		model: { provider: launch.binding.provider, modelId: launch.binding.model },
		thinkingLevel: launch.binding.effort,
		cwd: launch.cwd,
		extensions: { remove: leadOnly },
		tools: launch.tools.tools,
		modelTools: launch.tools.modelTools,
	});
	Object.assign(await tx.doc(ChildDoc, child.id), { executionId: launch.executionId, parentConversationId: api.conversationId, kind: launch.kind, depth: launch.depth });
	const task = await tx.createTask(reporter, { executionId: launch.executionId, assignment: launch.assignment }, background);
	const e: Execution = {
		executionId: launch.executionId, kind: launch.kind, name: sanitize(launch.name), profile: launch.profile, cognitiveRole: launch.cognitiveRole,
		provider: launch.binding.provider, model: launch.binding.model, effort: launch.binding.effort,
		...(launch.binding.fallback === undefined ? {} : { fallback: launch.binding.fallback }),
		...(launch.binding.independence === undefined ? {} : { independence: launch.binding.independence }),
		cwd: launch.cwd, taskPreview: bounded(sanitize(launch.task), 200), launchedAt: iso(api.now()),
		conversationId: child.id, anchor, reporter: task, background: launch.background,
		...(launch.worker === undefined ? {} : { workerId: launch.worker.workerId, workerName: sanitize(launch.worker.name), continuing: launch.worker.forkFrom !== undefined }),
		outcome: "running", collected: false, steers: 0,
	};
	doc.executions[launch.executionId] = e;
	doc.byTask[String(api.taskId)] = launch.executionId;
	return copy(e);
}

export function delegationExtension(options: DelegationOptions) {
	const Reporter = reporterTask(options);

	/** Resolve a binding with the resolver against the models this host can run (those with a stored login). */
	const route = async (api: Api, role: string, independentOfProvider: string | undefined, independentOfModel: string | undefined, modelOverride: string | undefined, effort: string | undefined, excludeFamilies: string[] | undefined) => {
		const catalog = join(options.dir, "work", "routing-catalog.txt");
		writeFileSync(catalog, (await api.models.getAvailable()).map((model) => `${model.provider} ${model.id}`).join("\n"), { mode: 0o600 });
		const binding = await resolveBinding(role, independentOfProvider, independentOfModel, modelOverride, effort, excludeFamilies, undefined, ["--catalog", catalog]);
		const model = api.models.getModel(binding.provider, binding.model);
		if (model === undefined) throw new Error(`Routing chose ${binding.provider}/${binding.model}, which this Chat cannot run`);
		return {
			provider: binding.provider as string,
			model: binding.model as string,
			effort: clampThinkingLevel(model, binding.effort as ModelThinkingLevel),
			...(binding.fallback === undefined ? {} : { fallback: `${binding.fallback.from as string}: ${binding.fallback.reason as string}` }),
			...(binding.independence === undefined ? {} : { independence: copy(binding.independence) as JsonObject }),
		};
	};

	const launched = (e: Execution, verb: string): Result => ({
		output: text(`${verb} ${e.kind} ${e.executionId}${e.workerName === undefined ? "" : ` (worker "${e.workerName}"${e.continuing === true ? ", resuming its scope" : ", first dispatch"})`} in the background on ${e.provider}/${e.model}:${e.effort}${e.fallback === undefined ? "" : ` (fallback from ${e.fallback})`} (${e.profile} · ${e.cognitiveRole}) in ${e.cwd}. The completion signal starts your next turn; end this turn instead of waiting.`),
		details: copy({ outcome: "launched", executionId: e.executionId, kind: e.kind, provider: e.provider, model: e.model, effort: e.effort, profile: e.profile, cognitiveRole: e.cognitiveRole, cwd: e.cwd, acceptedAt: e.launchedAt, ...(e.workerId === undefined ? {} : { workerId: e.workerId }) }),
	});

	/** Foreground: wait for the child's settled result and collect it with this call; Esc cancels the child. */
	const foreground = async (api: Api, e: Execution, c: Context): Promise<Result> => {
		try {
			await api.waitForTask(e.reporter as TaskId, c);
		} catch (error) {
			if (c.abortSignal?.aborted === true) void cancelExecution(options.harness(), api.conversationId, e.executionId, "Cancelled from the attended parent tool.");
			throw error;
		}
		return collect(api, e.executionId, c);
	};

	/** Collect in one commit, keyed by this call: what it returns is exactly what is marked read. */
	const collect = async (api: Api, executionId: string | undefined, c: Context): Promise<Result> => {
		const result = await api.commit(async (tx) => {
			const doc = await tx.doc(DelegationDoc, api.conversationId);
			const key = String(api.taskId);
			const prior = doc.collections[key];
			if (prior !== undefined) return copy(prior);
			let result: Result;
			if (executionId !== undefined) {
				const e = doc.executions[executionId];
				if (e === undefined) return failure("outcome_unknown", `No child ${executionId} was launched from this conversation.`);
				if (e.outcome === "running")
					return { output: text(`${stateLine(e)}\nStill running; end this turn—the completion signal wakes you for the next turn.`), details: copy({ outcome: "running", executionId }) };
				result = resultOf(e);
				e.collected = true;
			} else {
				const all = Object.values(doc.executions);
				const pending = all.filter((e) => e.outcome !== "running" && !e.collected).map((e) => e.executionId);
				const aggregate = await collectAll({ pending, running: all.filter((e) => e.outcome === "running").length, collectOne: async (id: string) => ({ content: resultOf(doc.executions[id]!).output, ...resultOf(doc.executions[id]!) }) });
				for (const { executionId: id } of aggregate.details.collected) doc.executions[id]!.collected = true;
				result = { output: aggregate.content as Result["output"], details: copy(aggregate.details) as JsonObject, ...(aggregate.isError === true ? { isError: true as const } : {}) };
			}
			doc.collections[key] = result;
			for (const old of Object.keys(doc.collections).slice(0, -KEPT_COLLECTIONS)) delete doc.collections[old];
			return copy(result);
		}, c);
		await holdFn("collect:after-commit", c.abortSignal);
		return result;
	};

	const subagent = defineTool({
		name: "subagent",
		description: "Launch one fresh attended child for one bounded assignment. Prefer background:true, finish genuinely independent work, then end the turn; the completion signal starts the next turn. Never sleep, poll, or collect to wait. Omit background only when the result is the immediate next input and nothing useful can happen first.",
		parameters: Type.Object({
			task: Type.String({ minLength: 1, description: "Self-contained bounded assignment: the task, relevant paths and constraints, 'Done means …' (a checkable finish line), 'Stop and ask only if …', and the expected output with the evidence to show" }),
			name: Type.Optional(Type.String({ minLength: 1, description: "Short human-readable label for this child, a few words not a sentence. Names the delegate roster row; falls back to a label derived from task when omitted." })),
			profile: StringEnum(LEAF_PROFILES as [string, ...string[]], { description: "Bundled Level 1 child behavior profile" }),
			cognitiveRole: StringEnum(COGNITIVE_ROLES as [string, ...string[]], { description: ROLE_GUIDE }),
			modelOverride: Type.Optional(Type.String({ minLength: 3, description: "Exact '<provider>/<model>': an owner request, the reserve model as second frontier panel member, or the other family's strong model for review of frontier work; review still checks the family" })),
			effort: Type.Optional(StringEnum(MODEL_EFFORTS as [string, ...string[]], { description: "Explicit Model Effort; the Cognitive Role still selects the model" })),
			independentOfProvider: Type.Optional(Type.String({ minLength: 1, description: "Author provider to route away from for review, when the exact author model is unavailable." })),
			independentOfModel: Type.Optional(Type.String({ minLength: 1, description: "Exact '<provider>/<model>' that authored the bytes under review, from the author's completion receipt. Independent roles default to this Chat's model." })),
			excludeFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Additional model families to reject during cross-family independent routing" })),
			background: Type.Optional(Type.Boolean({ description: "Return immediately; a completion signal arrives later." })),
		}),
		// Keyed by the tool call: a rerun after a restart finds the child it launched instead of launching another.
		replay: "safe",
		execute: async (params, api, c) => {
			const who = await caller(api, c);
			if (who.depth >= 2 || (who.depth === 1 && who.kind !== "worker"))
				return failure("preflight_failed", "A Subagent is the deepest supported level (lead → Worker → leaf); it cannot launch children.");
			const profile = (PROFILES as Record<string, { tools: string[]; instruction: string }>)[params.profile];
			if (profile === undefined || !LEAF_PROFILES.includes(params.profile)) return failure("preflight_failed", `Unknown child profile: ${params.profile}.`);
			let existing = (await api.snapshot(DelegationDoc, api.conversationId, c))?.byTask[String(api.taskId)];
			let e: Execution;
			if (existing !== undefined) e = (await api.snapshot(DelegationDoc, api.conversationId, c))!.executions[existing]!;
			else {
				const independent = INDEPENDENT_ROLES.has(params.cognitiveRole);
				if (!independent && (params.independentOfProvider !== undefined || params.independentOfModel !== undefined || params.excludeFamilies !== undefined))
					return failure("preflight_failed", `Cognitive Role '${params.cognitiveRole}' does not use an independence constraint or family exclusion.`);
				let independentOfProvider = independent ? params.independentOfProvider : undefined;
				let independentOfModel = independent ? params.independentOfModel : undefined;
				if (independent && independentOfProvider === undefined && independentOfModel === undefined) {
					const parent = (await api.agent(c)).model;
					if (parent !== undefined) independentOfModel = `${parent.provider}/${parent.modelId}`;
				}
				if (independent && independentOfModel !== undefined && providerOf(independentOfModel) === undefined)
					return failure("preflight_failed", `independentOfModel must be '<provider>/<model>', got '${independentOfModel}'.`);
				let binding;
				try {
					binding = await route(api, params.cognitiveRole, independentOfProvider, independentOfModel, params.modelOverride, params.effort, params.excludeFamilies);
				} catch (error) {
					return failure("preflight_failed", error instanceof Error ? error.message : String(error));
				}
				void independentOfProvider;
				const executionId = stableId(options.chatId, String(api.conversationId), String(api.taskId));
				const assignment = sanitize([profile.instruction, STATUS_INSTRUCTION, `Assignment:\n${params.task}`].filter(Boolean).join("\n\n"));
				const cwd = (await api.agent(c)).cwd ?? process.cwd();
				e = await api.commit(async (tx) => {
					const doc = await tx.doc(DelegationDoc, api.conversationId);
					const prior = doc.byTask[String(api.taskId)];
					if (prior !== undefined) return copy(doc.executions[prior]!);
					return admit(tx, api, {
						kind: "subagent", executionId, name: taskLabel(sanitize(params.name ?? params.task)), profile: params.profile, cognitiveRole: params.cognitiveRole,
						binding, task: params.task, assignment, background: params.background === true, tools: childTools(api, profile.tools), cwd, depth: who.depth + 1,
					}, Reporter, options.leadOnly);
				}, c);
				existing = undefined;
				options.record("execution.launched", {
					executionId: e.executionId, kind: "subagent", profile: e.profile, cognitiveRole: e.cognitiveRole, provider: e.provider, model: e.model, effort: e.effort,
					independence: e.independence ?? null, childSessionId: `${options.chatId}:${String(e.conversationId)}`, at: e.launchedAt,
				});
			}
			return e.background ? launched(e, "Launched") : foreground(api, e, c);
		},
	});

	const collectTool = defineTool({
		name: "subagent_collect",
		description: "Reconcile background children. Without executionId, collect all ready terminal children; repeat only for a reported budget-limited remainder. With one, return an immediate bounded snapshot if running, otherwise the compact terminal result.",
		parameters: Type.Object({ executionId: Type.Optional(Type.String({ minLength: 1, description: "One execution to inspect or collect; omit to reconcile every terminal child that is not yet collected" })) }),
		replay: "safe",
		execute: async ({ executionId }, api, c) => collect(api, executionId, c),
	});

	const statusTool = defineTool({
		name: "subagent_status",
		description: "Diagnostic, non-blocking snapshot of one child, or the running and terminal-but-uncollected direct children. Pass all:true for the full roster. Reading collects nothing.",
		parameters: Type.Object({
			executionId: Type.Optional(Type.String({ minLength: 1, description: "One execution to inspect; omit to list running and terminal-but-uncollected direct children" })),
			all: Type.Optional(Type.Boolean({ description: "Include already-collected children for bounded diagnostics" })),
		}),
		replay: "safe",
		execute: async ({ executionId, all }, api, c) => {
			const doc = (await api.snapshot(DelegationDoc, api.conversationId, c)) ?? DelegationDoc.definition.initial();
			if (executionId !== undefined) {
				const e = doc.executions[executionId];
				if (e === undefined) return failure("outcome_unknown", `No child ${executionId} was launched from this conversation.`);
				return { output: text(`${stateLine(e)}\nTask: ${e.taskPreview}`), details: copy({ ...e, text: null }) as unknown as JsonObject };
			}
			const executions = Object.values(doc.executions);
			const shown = all === true ? executions : executions.filter((e) => e.outcome === "running" || !e.collected);
			const running = executions.filter((e) => e.outcome === "running").length;
			const uncollected = executions.filter((e) => e.outcome !== "running" && !e.collected).length;
			const counts = `${String(running)} running, ${String(uncollected)} terminal and uncollected, ${String(executions.length)} launched from this conversation.`;
			const lines = shown.map((e) => `- ${stateLine(e)} — ${e.taskPreview}`);
			return {
				output: text(lines.length === 0 ? `${counts}${all === true ? "" : " Nothing needs reconciliation; use all:true for the full roster."}` : `${counts}\n${lines.join("\n")}`),
				details: copy({ children: shown.map((e) => ({ executionId: e.executionId, outcome: e.outcome, collected: e.collected, kind: e.kind })), running, uncollected, total: executions.length }),
			};
		},
	});

	const reportStatus = defineTool({
		name: "report_status",
		description: "Report your own current one-line status for the delegate roster the lead and owner see; a new report replaces your previous one. Call it when you start, then each time the answer to 'what are you doing now?' changes: reading code, editing a named part, running tests, fixing failures, waiting on a review, merging, hitting a blocker. Keep it current: a line older than a few minutes of work is stale, so report again. Do not call it on every tool call.",
		parameters: Type.Object({ status: Type.String({ minLength: 1, maxLength: 200, description: "One short present-tense line describing what you are doing right now" }) }),
		replay: "safe",
		execute: async (params, api, c) => {
			const status = sanitize(params.status);
			const self = await api.snapshot(ChildDoc, api.conversationId, c);
			if (self !== undefined && self.executionId !== "") {
				const parent = self.parentConversationId as ConversationId;
				const key = String(api.taskId);
				const update = await api.commit(async (tx) => {
					const doc = await tx.doc(DelegationDoc, parent);
					const prior = doc.updateByTask[key];
					if (prior !== undefined) return copy(prior);
					const e = doc.executions[self.executionId];
					if (e === undefined) return undefined;
					e.reportedStatus = status;
					e.reportedAt = iso(api.now());
					// Only a report from a call made after the steer that asked for it wakes the lead, once.
					if (e.updateAfterTask === undefined || Number(api.taskId) <= e.updateAfterTask || e.outcome !== "running" || e.cancelEpoch !== undefined) return undefined;
					const pending = { executionId: e.executionId, seq: e.updateAfterTask, text: `Child ${e.executionId} reported: ${status}\nThis update grants no new authority; continue the run that launched it.` };
					delete e.updateAfterTask;
					doc.updateByTask[key] = pending;
					return copy(pending);
				}, c);
				if (update !== undefined) {
					const lead = (await api.conversation(parent, c))!;
					await lead.submit({ type: "input", content: update.text, whenBusy: "steer", requestId: `update:${update.executionId}:${String(update.seq)}`, entry: { kind: UPDATE_ENTRY, data: { executionId: update.executionId, status } } }, c);
				}
			}
			return { output: text(`Reported: ${status}`), details: { outcome: "reported", status } };
		},
	});

	const cancelTool = defineTool({
		name: "subagent_cancel",
		description: "Cancel a running child and confirm its termination. Cancelling a Worker reaches its leaves; cancelling one leaf leaves its Worker running.",
		parameters: Type.Object({ executionId: Type.String({ minLength: 1 }), reason: Type.Optional(Type.String({ description: "Why the child is being cancelled" })) }),
		replay: "safe",
		execute: async ({ executionId, reason }, api) => {
			const result = await cancelExecution(options.harness(), api.conversationId, executionId, reason ?? "Cancelled by the attended lead.");
			if (result === undefined) return failure("preflight_failed", `No child ${executionId} was launched from this conversation.`);
			const message = result.already === true ? `${executionId} had already ended: ${result.outcome}.` : `${executionId}: ${result.outcome}.`;
			return { output: text(message), details: { executionId, outcome: result.outcome }, ...(result.outcome === "outcome_unknown" ? { isError: true } : {}) };
		},
	});

	const steerTool = defineTool({
		name: "subagent_steer",
		description: "Send a steering message to a running Subagent or Worker, or ask it for an update. With requestUpdate, its next report_status wakes you; end the turn instead of waiting.",
		parameters: Type.Object({
			executionId: Type.String({ minLength: 1 }),
			message: Type.String({ minLength: 1, description: "Steering instruction for the running child" }),
			mode: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("followUp")], { description: "steer: after its current tool calls (default); followUp: once it would otherwise stop" })),
			requestUpdate: Type.Optional(Type.Boolean({ description: "Ask the child to report_status; its next report wakes you" })),
		}),
		replay: "safe",
		execute: async (params, api, c) => {
			const key = String(api.taskId);
			const sent = await api.commit(async (tx) => {
				const doc = await tx.doc(DelegationDoc, api.conversationId);
				const e = doc.executions[params.executionId];
				if (e === undefined) return { error: `No child ${params.executionId} was launched from this conversation.` };
				let seq = doc.steerByTask[key];
				if (seq === undefined) {
					if (e.outcome !== "running" || e.cancelEpoch !== undefined) return { error: `${params.executionId} is not running (${e.outcome}).` };
					seq = e.steers += 1;
					doc.steerByTask[key] = seq;
					if (params.requestUpdate === true) e.updateAfterTask = Number(api.taskId);
				}
				return { seq, conversationId: e.conversationId };
			}, c);
			if ("error" in sent) return failure("preflight_failed", sent.error!);
			const mode = params.mode ?? "steer";
			const child = (await api.conversation(sent.conversationId as ConversationId, c))!;
			const content = sanitize(params.requestUpdate === true ? `${params.message}\n\n${UPDATE_REQUEST}` : params.message);
			await child.submit({ type: "input", content, whenBusy: mode, requestId: `steer:${params.executionId}:${String(sent.seq)}` }, c);
			return {
				output: text(`Sent ${mode} #${String(sent.seq)} to ${params.executionId}.${params.requestUpdate === true ? " Its next report_status will wake you." : ""}`),
				details: { executionId: params.executionId, mode, sequence: sent.seq },
			};
		},
	});

	// ─── Workers ──────────────────────────────────────────────────────────────

	const nestedWorkers = async (api: Api, c: Context) => (await caller(api, c)).depth > 0 ? failure("preflight_failed", NO_NESTED_WORKERS) : undefined;

	const workerCreate = defineTool({
		name: "worker_create",
		description: "Create one durable attended worker: an identity owned by this lead Chat and bound to one semantic scope and repository root. Creation writes a record and starts nothing. Prefer fresh subagents; create a worker only when repeated bounded actions in one scope benefit from preserved context.",
		parameters: Type.Object({
			name: Type.String({ minLength: 1, description: "Short human-readable worker name" }),
			scope: Type.String({ minLength: 1, description: "One semantic scope statement this worker retains context for" }),
			profile: StringEnum(WORKER_PROFILES as [string, ...string[]], { description: "Bundled Level 1 child behavior profile. Use 'coordinator' for a worker that owns one scope and delegates its work to fresh leaf Subagents." }),
		}),
		replay: "safe",
		execute: async (params, api, c) => {
			const nested = await nestedWorkers(api, c);
			if (nested !== undefined) return nested;
			const repositoryRoot = (await api.agent(c)).cwd ?? process.cwd();
			const worker = await api.commit(async (tx) => {
				const doc = await tx.doc(WorkersDoc);
				const key = `${String(api.conversationId)}:${String(api.taskId)}`;
				const known = doc.byTask[key];
				if (known !== undefined) return copy(doc.workers[known]!);
				const workerId = `wkr-${stableId(options.chatId, key).slice(0, 13)}`;
				const created: Worker = {
					workerId, name: sanitize(params.name), scope: sanitize(params.scope), profile: params.profile, repositoryRoot,
					ownerConversationId: api.conversationId, createdAt: iso(api.now()), lineage: [], lock: null, retired: null, requiresInspection: null, receipts: [],
				};
				doc.workers[workerId] = created;
				doc.byTask[key] = workerId;
				return copy(created);
			}, c);
			return {
				output: text(`Created worker ${worker.workerId} "${worker.name}" (${worker.profile}) for scope "${worker.scope}", bound to ${worker.repositoryRoot}. Dispatch bounded assignments with worker_dispatch.`),
				details: copy(worker) as unknown as JsonObject,
			};
		},
	});

	const workerDispatch = defineTool({
		name: "worker_dispatch",
		description: "Dispatch one bounded assignment to a durable worker with scoped continuity. background works as in subagent. Owner-requested modelOverride changes the model; effort may be set independently. One dispatch at a time.",
		parameters: Type.Object({
			workerId: Type.String({ minLength: 1, description: "Durable worker identifier returned by worker_create or worker_status" }),
			task: Type.String({ minLength: 1, description: "Self-contained bounded assignment: the task, relevant paths and constraints, 'Done means …', 'Stop and ask only if …', and the expected output with the evidence to show. Continuity supplements explicit tasking; it never replaces it." }),
			cognitiveRole: StringEnum(WORKER_ROLES as [string, ...string[]], { description: `${ROLE_GUIDE}\nreview roles are subagent-only here: independence requires fresh context` }),
			modelOverride: Type.Optional(Type.String({ minLength: 3, description: "Owner-requested exception selecting one exact '<provider>/<model>'" })),
			effort: Type.Optional(StringEnum(MODEL_EFFORTS as [string, ...string[]], { description: "Explicit Model Effort; the Cognitive Role still selects the model" })),
			background: Type.Optional(Type.Boolean({ description: "Return immediately; a completion signal arrives later." })),
			acknowledgeInspection: Type.Optional(Type.Boolean({ description: "Confirm the lead inspected a previous outcome_unknown dispatch before dispatching this worker again" })),
		}),
		replay: "safe",
		execute: async (params, api, c) => {
			const nested = await nestedWorkers(api, c);
			if (nested !== undefined) return nested;
			if (INDEPENDENT_ROLES.has(params.cognitiveRole)) return failure("preflight_failed", `Independence requires fresh context; Cognitive Role '${params.cognitiveRole}' is subagent-only.`);
			const known = (await api.snapshot(DelegationDoc, api.conversationId, c))?.byTask[String(api.taskId)];
			let e: Execution;
			if (known !== undefined) e = (await api.snapshot(DelegationDoc, api.conversationId, c))!.executions[known]!;
			else {
				const preflight = (worker: Worker | undefined): string | undefined => {
					if (worker === undefined) return `No worker ${params.workerId} is recorded in this Chat family.`;
					if (worker.ownerConversationId !== api.conversationId) return `Worker ${params.workerId} belongs to another lead Chat; use worker_status all:true only for diagnostics.`;
					if (worker.retired !== null) return `Worker ${params.workerId} was retired at ${worker.retired.at}: ${worker.retired.reason}`;
					if (worker.lock !== null) return `Worker ${params.workerId} is busy with dispatch ${worker.lock.executionId}; one dispatch at a time.`;
					if (worker.requiresInspection !== null && params.acknowledgeInspection !== true) return `Worker ${params.workerId} requires inspection: ${worker.requiresInspection.diagnostic}. Dispatch again only with acknowledgeInspection:true.`;
					return undefined;
				};
				const worker = (await api.snapshot(WorkersDoc, c))?.workers[params.workerId];
				const refused = preflight(worker);
				if (refused !== undefined) return failure("preflight_failed", refused);
				const profile = (PROFILES as Record<string, { tools: string[]; instruction: string }>)[worker!.profile]!;
				let binding;
				try {
					binding = await route(api, params.cognitiveRole, undefined, undefined, params.modelOverride, params.effort, undefined);
				} catch (error) {
					return failure("preflight_failed", error instanceof Error ? error.message : String(error));
				}
				// Decided in the admission commit, from the Worker as it is then.
				const assignmentFor = (current: Worker) => {
					const preamble = `You are the durable attended worker "${current.name}" with the semantic scope "${current.scope}".${current.lineage.length > 0 ? " This dispatch resumes your persisted context; the earlier conversation above is your own prior work in this scope." : " This is your first dispatch in this scope."}`;
					return sanitize([profile.instruction, STATUS_INSTRUCTION, preamble, `Assignment:\n${params.task}`].filter(Boolean).join("\n\n"));
				};
				const executionId = stableId(options.chatId, String(api.conversationId), String(api.taskId));
				const admitted = await api.commit(async (tx) => {
					const doc = await tx.doc(DelegationDoc, api.conversationId);
					const prior = doc.byTask[String(api.taskId)];
					if (prior !== undefined) return copy(doc.executions[prior]!);
					const workers = await tx.doc(WorkersDoc);
					const current = workers.workers[params.workerId];
					const late = preflight(current as Worker | undefined);
					if (late !== undefined) return { refused: late };
					const execution = await admit(tx, api, {
						kind: "worker", executionId, name: current!.name, profile: current!.profile, cognitiveRole: params.cognitiveRole, binding, task: params.task,
						assignment: assignmentFor(current as Worker), background: params.background === true, tools: childTools(api, profile.tools), cwd: current!.repositoryRoot, depth: 1,
						worker: { workerId: current!.workerId, name: current!.name, ...(current!.lineage.length > 0 ? { forkFrom: current!.lineage.at(-1)! } : {}) },
					}, Reporter, options.leadOnly);
					current!.lock = { executionId, acquiredAt: execution.launchedAt };
					current!.lineage.push(execution.conversationId);
					if (params.acknowledgeInspection === true) current!.requiresInspection = null;
					return execution;
				}, c);
				if ("refused" in admitted) return failure("preflight_failed", admitted.refused as string);
				e = admitted;
				options.record("execution.launched", {
					executionId: e.executionId, kind: "worker", workerId: e.workerId, profile: e.profile, cognitiveRole: e.cognitiveRole, provider: e.provider, model: e.model, effort: e.effort,
					modelOverride: params.modelOverride ?? null, childSessionId: `${options.chatId}:${String(e.conversationId)}`, at: e.launchedAt,
				});
			}
			return e.background ? launched(e, "Dispatched") : foreground(api, e, c);
		},
	});

	const workerStatus = defineTool({
		name: "worker_status",
		description: "Inspect this Chat's durable workers by default. Pass all:true only for diagnostics across the Chat family, including workers of other lead Chats and retired records; it grants no control.",
		parameters: Type.Object({
			workerId: Type.Optional(Type.String({ minLength: 1, description: "One worker to inspect; omit to list active workers owned by this Chat" })),
			all: Type.Optional(Type.Boolean({ description: "Show every worker of this Chat family, including retired records and those of other lead Chats, for diagnostics" })),
		}),
		replay: "safe",
		execute: async ({ workerId, all }, api, c) => {
			const nested = await nestedWorkers(api, c);
			if (nested !== undefined) return nested;
			const workers = Object.values((await api.snapshot(WorkersDoc, c))?.workers ?? {});
			const mine = (worker: Worker) => worker.ownerConversationId === api.conversationId;
			const state = (worker: Worker) => worker.retired !== null ? "retired" : worker.lock !== null ? "dispatching" : worker.requiresInspection !== null ? "needs inspection" : "idle";
			if (workerId !== undefined) {
				const worker = workers.find((candidate) => candidate.workerId === workerId);
				if (worker === undefined) return failure("preflight_failed", `No worker ${workerId} is recorded in this Chat family.`);
				if (all !== true && !mine(worker)) return failure("preflight_failed", `Worker ${workerId} belongs to another lead Chat; use all:true only for diagnostics.`);
				const latest = worker.receipts.at(-1);
				const lines = [
					`${worker.workerId} "${worker.name}" (${worker.profile}) [${state(worker)}]${worker.retired === null ? "" : ` retired ${worker.retired.at}: ${worker.retired.reason}`}${mine(worker) ? "" : " · owned by another lead Chat"}`,
					`Scope: ${worker.scope}`,
					`Root: ${worker.repositoryRoot} · created ${worker.createdAt} · ${String(worker.receipts.length)} recorded dispatch(es) · lineage ${worker.lineage.join(" → ") || "none"}`,
					...(worker.lock === null ? [] : [`Active dispatch ${worker.lock.executionId} since ${worker.lock.acquiredAt}.`]),
					...(worker.requiresInspection === null ? [] : [`Requires inspection since ${worker.requiresInspection.at}: ${worker.requiresInspection.diagnostic}. Dispatch again only with acknowledgeInspection:true.`]),
					...(latest === undefined ? [] : [`Last dispatch: ${latest.outcome} · ${latest.provider}/${latest.model}:${latest.effort} · ended ${latest.endedAt}`]),
				];
				return { output: text(lines.join("\n")), details: copy({ worker, owned: mine(worker) }) as unknown as JsonObject };
			}
			const shown = all === true ? workers : workers.filter((worker) => mine(worker) && worker.retired === null);
			if (shown.length === 0)
				return { output: text(all === true ? "No durable workers are recorded in this Chat family." : "No active durable workers are recorded for this Chat. Use all:true for diagnostics."), details: { workers: [] } };
			const lines = shown.map((w) => `- ${w.workerId} "${w.name}" (${w.profile}) [${state(w)}] ${String(w.receipts.length)} dispatch(es), last ${w.receipts.at(-1)?.outcome ?? "none"}${mine(w) ? "" : " · another lead Chat"} — ${w.scope}`);
			return { output: text(lines.join("\n")), details: copy({ workers: shown.map((w) => ({ workerId: w.workerId, state: state(w), owned: mine(w) })) }) };
		},
	});

	const workerRetire = defineTool({
		name: "worker_retire",
		description: "Retire a durable worker whose scope is finished or whose accumulated context is no longer trustworthy. A retired worker cannot be dispatched again; start a fresh worker or subagent instead.",
		parameters: Type.Object({
			workerId: Type.String({ minLength: 1 }),
			reason: Type.String({ minLength: 1, description: "Why the worker's scope is finished or its context is no longer trustworthy" }),
		}),
		replay: "safe",
		execute: async ({ workerId, reason }, api, c) => {
			const nested = await nestedWorkers(api, c);
			if (nested !== undefined) return nested;
			const retired = await api.commit(async (tx) => {
				const worker = (await tx.doc(WorkersDoc)).workers[workerId];
				if (worker === undefined) return { error: `No worker ${workerId} is recorded in this Chat family.` };
				if (worker.ownerConversationId !== api.conversationId) return { error: `Worker ${workerId} belongs to another lead Chat; it cannot be retired from here.` };
				if (worker.retired !== null) return copy(worker.retired);
				if (worker.lock !== null) return { error: `Worker ${workerId} is busy with dispatch ${worker.lock.executionId}; cancel it or wait for it to settle first.` };
				worker.retired = { at: iso(api.now()), reason: sanitize(reason) };
				return copy(worker.retired);
			}, c);
			if ("error" in retired) return failure("preflight_failed", retired.error!);
			return { output: text(`Retired worker ${workerId} at ${retired.at}: ${retired.reason}`), details: { workerId, ...retired } };
		},
	});

	return defineExtension({
		name: "workbench.delegation",
		tools: [subagent, collectTool, statusTool, reportStatus, cancelTool, steerTool, workerCreate, workerDispatch, workerStatus, workerRetire] as ToolRegistration[],
		tasks: [Anchor, Reporter],
	});
}

// ─── Roster ──────────────────────────────────────────────────────────────────

/**
 * PI WEB's Activity roster for one lead (`pi-workbench:activity` status, schema 1): running children with their latest
 * self-report and inferred activity, and background results waiting to be collected.
 */
export async function roster(harness: Harness, conversation: ConversationId, c: Context): Promise<string | undefined> {
	const doc = await harness.snapshot(DelegationDoc, conversation, c);
	const shown = Object.values(doc?.executions ?? {}).filter((e) => e.outcome === "running" || (e.background && !e.collected));
	if (shown.length === 0) return undefined;
	const items = await Promise.all(shown.map(async (e) => {
		let activity: string = e.outcome;
		if (e.outcome === "running") {
			const live = await harness.snapshot(LiveDoc, e.conversationId as ConversationId, c);
			const tool = live?.tools?.find((slot) => slot.status === "running" && slot.name !== "report_status")?.name;
			activity = e.cancelEpoch !== undefined ? "stopping" : tool ?? (live?.generation !== undefined ? "responding" : live?.run !== undefined ? "thinking" : "starting");
		}
		return {
			id: `delegate:${e.executionId}`, kind: e.kind, name: e.name, role: e.cognitiveRole, model: `${e.provider}/${e.model}`, effort: e.effort,
			objective: bounded(taskLabel(e.taskPreview.split(/\r?\n/, 1)[0] ?? "", 160), 160), activity, startedAt: e.launchedAt,
			...(e.reportedStatus === undefined ? {} : { reportedStatus: e.reportedStatus }),
			...(e.reportedAt === undefined ? {} : { reportedAt: e.reportedAt }),
			...(e.endedAt === undefined ? {} : { endedAt: e.endedAt }),
		};
	}));
	return JSON.stringify({ schemaVersion: 1, items });
}

