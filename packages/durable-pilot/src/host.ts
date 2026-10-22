// Minimal headless Durable host for one Chat family: one owned store, explicit (paused) restore, reconciliation of
// uncertain unsafe tool effects before scheduling, and stable-ID admission. Not a Workbench port.
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	createModels,
	type CredentialStore,
	type FauxProviderHandle,
	fauxProvider,
	type Message,
	type Provider,
	type RegisterFauxProviderOptions,
} from "@earendil-works/pi-ai";
import {
	type AgentChange,
	type Conversation,
	type ConversationId,
	type EnvTarget,
	createRegistry,
	defineDoc,
	defineExtension,
	type Harness,
	Harness as HarnessFactory,
	type HarnessSettings,
	hook,
	type InputEntry,
	type UserInput,
	InboxDoc,
	type Registry,
	type ReportInfo,
	type SubmissionId,
	type TaskId,
	type ToolTaskCheckpoint,
	type ToolTaskInput,
	ToolTask,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { wrapProvider } from "./redact.ts";
import { type Faults, type OpenedStore, openStore, type Synchronous } from "./store.ts";

export const context: Context = BACKGROUND_CONTEXT;
export const MODEL = { provider: "faux", modelId: "faux-1" } as const;

// ─── Reconciliation of uncertain unsafe effects ──────────────────────────────

type Uncertain = { tool: string; conversationId: ConversationId; arguments: string; resolved?: string };
export const Reconcile = defineDoc<{ uncertain: Record<string, Uncertain> }>({
	kind: "pilot.reconcile",
	version: 1,
	scope: "session",
	initial: () => ({ uncertain: {} }),
	checkpointWhen: () => false,
});

/** Blocks every call of a tool with an unresolved uncertain effect in that conversation; a throw blocks too. */
export const ReconcileGuard = defineExtension({
	name: "pilot.reconcile-guard",
	hooks: [
		hook(ToolTask, {
			beforeTool: async (call, api, callContext) => {
				const doc = await api.snapshot(Reconcile, callContext);
				const open = Object.entries(doc?.uncertain ?? {}).find(
					([, item]) => item.resolved === undefined && item.tool === call.name && item.conversationId === api.conversationId,
				);
				return open === undefined
					? undefined
					: { block: `Needs reconciliation: an earlier ${call.name} call (task ${open[0]}) may have run; awaiting owner resolution` };
			},
		}),
	],
});

/**
 * Before scheduling: every tool task stopped after intent whose rerun is not safe under both the stored and the
 * current policy may have had an external effect. Record it so the guard blocks another attempt. That includes nested
 * calls (`executeTool`): Durable abandons them after a restart when their caller is not replay-safe, but an abandoned
 * call in its execute phase may still have run.
 */
export async function reconcileOnOpen(harness: Harness, registry: Registry): Promise<string[]> {
	const inspection = await harness.inspect(context);
	const found: Record<string, Uncertain> = {};
	for (const task of inspection.tasks) {
		const record = task.record;
		if (record.kind !== ToolTask.definition.name || record.state.status === "terminal" || record.state.status === "completing") continue;
		const checkpoint = record.state.checkpoint as ToolTaskCheckpoint;
		const input = record.input as ToolTaskInput;
		if (checkpoint?.phase !== "execute") continue;
		let name = "unknown";
		if (input.kind === "nested") name = input.call.name;
		else {
			const conversation = (await harness.conversation(record.conversationId, context))!;
			const entry = await conversation.commit((tx) => tx.entry(input.assistant), context);
			const call = (entry?.model?.[0] as Message | undefined)?.role === "assistant"
				? (entry!.model![0] as { content: { type: string; id?: string; name?: string }[] }).content.find((c) => c.type === "toolCall" && c.id === input.callId)
				: undefined;
			name = call?.name ?? "unknown";
		}
		const current = registry.snapshot().tools().find(({ tool }) => tool.name === name)?.tool;
		if (checkpoint.replay === "safe" && current?.replay === "safe") continue;
		found[record.id] = { tool: name, conversationId: record.conversationId, arguments: JSON.stringify(checkpoint.arguments) };
	}
	if (Object.keys(found).length > 0)
		await harness.commit(async (tx) => {
			const doc = await tx.doc(Reconcile);
			for (const [id, item] of Object.entries(found)) doc.uncertain[id] ??= item;
		}, context);
	return Object.keys(found);
}

export async function resolveUncertain(harness: Harness, taskId: string, resolution: string): Promise<void> {
	await harness.commit(async (tx) => {
		const doc = await tx.doc(Reconcile);
		if (doc.uncertain[taskId] !== undefined) doc.uncertain[taskId]!.resolved = resolution;
	}, context);
}

// ─── Admission with stable operation IDs ─────────────────────────────────────

export class PayloadMismatch extends Error {
	constructor(operationId: string) {
		super(`Operation ${operationId} was already used with a different payload`);
		this.name = "PayloadMismatch";
	}
}

export const Admissions = defineDoc<{ ops: Record<string, { hash: string }> }>({
	kind: "pilot.admissions",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ ops: {} }),
	checkpointWhen: () => false,
});

export type Admit = {
	readonly operationId: string;
	readonly text: string;
	readonly mode?: "steer" | "followUp";
	/** What the model receives instead of `text` (e.g. a Working Mode block before it); the receipt hashes `text`. */
	readonly content?: UserInput;
	/** The entry the input is placed as, instead of `pi.user`. */
	readonly entry?: InputEntry;
};

/**
 * Commit the operation's payload hash, then submit under the same ID; the caller acknowledges only after this
 * resolves. A retry finds the receipt (and Durable dedupes the submission); a changed payload is rejected.
 */
export async function admit(
	conversation: Conversation,
	request: Admit,
	hooks: { readonly afterReceipt?: () => Promise<void> } = {},
): Promise<SubmissionId> {
	const hash = createHash("sha256").update(JSON.stringify([request.mode ?? "followUp", request.text])).digest("hex");
	await conversation.commit(async (tx) => {
		const doc = await tx.doc(Admissions, conversation.id);
		const existing = doc.ops[request.operationId];
		if (existing !== undefined && existing.hash !== hash) throw new PayloadMismatch(request.operationId);
		doc.ops[request.operationId] ??= { hash };
	}, context);
	await hooks.afterReceipt?.();
	const submission = await conversation.submit(
		{
			type: "input",
			content: request.content ?? request.text,
			requestId: request.operationId,
			whenBusy: request.mode ?? "followUp",
			...(request.entry === undefined ? {} : { entry: request.entry }),
		},
		context,
	);
	return submission.id;
}

// ─── Queued-input edit ───────────────────────────────────────────────────────

export class EditTooLate extends Error {
	constructor(operationId: string) {
		super(`Operation ${operationId} is no longer queued; it cannot be edited`);
		this.name = "EditTooLate";
	}
}

type EditStep = { readonly from: string; readonly to: string; readonly text: string; readonly mode: "steer" | "followUp" };
type EditReceipt = { conversationId: ConversationId; hash: string; steps: EditStep[]; status: "pending" | "done" | "too-late" };

/** Durable intent of every edit, so a crash between its commits rolls forward on resume. */
export const Edits = defineDoc<{ edits: Record<string, EditReceipt> }>({
	kind: "pilot.edits",
	version: 1,
	scope: "session",
	initial: () => ({ edits: {} }),
	checkpointWhen: () => false,
});

export type Edit = { readonly editId: string; readonly operationId: string; readonly text: string };
export type EditStepName = "receipt" | "withdrawn" | "readmitted";

/**
 * Edit a queued input. Durable has no edit and places queued inputs in ID order, so an edit withdraws the item and
 * every input queued after it, then re-admits them in order (the edited one with its new text) under stable operation
 * IDs `<editId>#<n>`. The plan is committed first as a receipt; each step is idempotent, so a retry under the same
 * edit ID, or `resume()` after a crash, finishes it. Resolves with each moved operation's new ID; the caller
 * acknowledges only then.
 */
export async function editQueued(
	harness: Harness,
	conversation: Conversation,
	edit: Edit,
	hooks: { readonly at?: (step: EditStepName) => Promise<void> | undefined } = {},
): Promise<{ readonly moved: Record<string, string> }> {
	const hash = createHash("sha256").update(JSON.stringify([edit.operationId, edit.text])).digest("hex");
	const receipt = await conversation.commit(async (tx) => {
		const doc = await tx.doc(Edits);
		const existing = doc.edits[edit.editId];
		if (existing !== undefined) {
			if (existing.hash !== hash) throw new PayloadMismatch(edit.editId);
			return JSON.parse(JSON.stringify(existing)) as EditReceipt;
		}
		const inbox = (await tx.doc(InboxDoc, conversation.id)).items;
		const target = await tx.submissionByRequest(conversation.id, edit.operationId);
		const at = inbox.findIndex((item) => item.id === target?.id);
		if (at < 0) throw new EditTooLate(edit.operationId);
		const tail = inbox.slice(at);
		// ponytail: refuses an edit with a queued write behind it, since rebuilding would move the write ahead.
		if (tail.some((item) => item.mode === "write")) throw new Error(`Cannot edit ${edit.operationId}: a queued write follows it`);
		// ponytail: maps inbox IDs back to operation IDs by scanning every admitted operation; index them if this grows.
		const opOf = new Map<SubmissionId, string>();
		for (const op of Object.keys((await tx.doc(Admissions, conversation.id)).ops)) {
			const record = await tx.submissionByRequest(conversation.id, op);
			if (record !== undefined) opOf.set(record.id, op);
		}
		const steps = tail.map((item, n): EditStep => {
			const from = opOf.get(item.id);
			if (from === undefined || item.mode === "write" || typeof item.content !== "string")
				throw new Error(`Cannot edit ${edit.operationId}: queued item ${item.id} was not admitted as text by this host`);
			return { from, to: `${edit.editId}#${n}`, text: n === 0 ? edit.text : item.content, mode: item.mode };
		});
		const created: EditReceipt = { conversationId: conversation.id, hash, steps, status: "pending" };
		doc.edits[edit.editId] = created;
		return JSON.parse(JSON.stringify(created)) as EditReceipt;
	}, context);
	if (receipt.status === "too-late") throw new EditTooLate(edit.operationId);
	if (receipt.status === "pending") await applyEdit(harness, conversation, edit.editId, receipt, hooks);
	return { moved: Object.fromEntries(receipt.steps.map((step) => [step.from, step.to])) };
}

async function applyEdit(
	harness: Harness,
	conversation: Conversation,
	editId: string,
	receipt: EditReceipt,
	hooks: { readonly at?: (step: EditStepName) => Promise<void> | undefined },
): Promise<void> {
	const finish = (status: EditReceipt["status"]) =>
		harness.commit(async (tx) => void ((await tx.doc(Edits)).edits[editId]!.status = status), context);
	await hooks.at?.("receipt");
	// Withdraw in queue order, the edited item first: if it was already placed, nothing else is touched.
	const readmit: EditStep[] = [];
	for (const [n, step] of receipt.steps.entries()) {
		const record = await conversation.commit((tx) => tx.submissionByRequest(conversation.id, step.from), context);
		await harness.abortSubmission(record!.id, context, conversation.id);
		const status = await (await harness.submission(record!.id, context))!.status(context);
		const withdrawn = status.status === "unanswered" && status.reason === "aborted";
		if (n === 0 && !withdrawn) {
			await finish("too-late");
			throw new EditTooLate(step.from);
		}
		// ponytail: a later item placed meanwhile stays where it landed (ahead of the edit); Durable has no reorder.
		if (withdrawn) readmit.push(step);
	}
	await hooks.at?.("withdrawn");
	for (const step of readmit) await admit(conversation, { operationId: step.to, text: step.text, mode: step.mode });
	await hooks.at?.("readmitted");
	await finish("done");
}

/** Roll forward every edit a crash interrupted. Withdrawals run before scheduling resumes; re-admission resumes it. */
async function finishEdits(harness: Harness): Promise<void> {
	const doc = await harness.snapshot(Edits, context);
	for (const [editId, receipt] of Object.entries(doc?.edits ?? {})) {
		if (receipt.status !== "pending") continue;
		const conversation = await harness.conversation(receipt.conversationId, context);
		if (conversation === undefined) continue;
		try {
			await applyEdit(harness, conversation, editId, JSON.parse(JSON.stringify(receipt)) as EditReceipt, {});
		} catch (error) {
			if (!(error instanceof EditTooLate)) throw error;
		}
	}
}

// ─── Host ────────────────────────────────────────────────────────────────────

export type HostOptions = {
	/** Benchmark comparison only; every host defaults to FULL + fullfsync=ON, verified on open. */
	readonly synchronous?: Synchronous;
	readonly fullfsync?: boolean;
	readonly faults?: Faults;
	readonly faux?: RegisterFauxProviderOptions;
	readonly settings?: HarnessSettings;
	readonly now?: () => number;
	/** Decorate or replace the faux provider (before redaction), e.g. with provider-side deferred jobs or a real provider. */
	readonly provider?: (faux: Provider) => Provider;
	/** Provider-boundary options of the redacting wrapper, e.g. the Claude subscription payload rules. */
	readonly providerOptions?: Parameters<typeof wrapProvider>[1];
	/** Credential store of the model collection, e.g. Pi's auth.json. */
	readonly credentials?: CredentialStore;
	/** The root conversation's agent when it is created; default the faux model. */
	readonly rootAgent?: AgentChange;
	/** Execution environment per call; default a NodeExecutionEnv in the family's work directory. */
	readonly env?: (target: EnvTarget, context: Context) => NodeExecutionEnv | Promise<NodeExecutionEnv>;
	/** Extensions installed after the guard, in order. */
	readonly extensions?: readonly ReturnType<typeof defineExtension>[];
};

export type Host = {
	readonly store: OpenedStore;
	readonly harness: Harness;
	readonly root: Conversation;
	readonly registry: Registry;
	/** The model collection: providers, catalog and credentials. */
	readonly models: ReturnType<typeof createModels>;
	readonly faux: FauxProviderHandle;
	readonly reports: { readonly type: string; readonly message: string; readonly task?: TaskId }[];
	/** Task IDs recorded as uncertain at open. */
	readonly uncertain: readonly string[];
	/**
	 * Explicit resume: restored work stays paused until this is called (owner decision 2). Interrupted queued-input
	 * edits are rolled forward first.
	 */
	resume(): Promise<void>;
	close(): Promise<void>;
};

export async function openHost(dir: string, options: HostOptions = {}): Promise<Host> {
	// Owner-only from creation: the family dir before anything is created in it, and a process umask so files the
	// execution environment and tools write later (work files, bash spill files) are 0600/0700 too.
	// ponytail: process-wide umask; fine for a process that only hosts families, revisit if a host embeds elsewhere.
	process.umask(0o077);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	const work = join(dir, "work");
	mkdirSync(work, { recursive: true, mode: 0o700 });
	const store = await openStore(join(dir, "session.sqlite"), {
		...(options.synchronous === undefined ? {} : { synchronous: options.synchronous }),
		...(options.fullfsync === undefined ? {} : { fullfsync: options.fullfsync }),
		...(options.faults === undefined ? {} : { faults: options.faults }),
	});
	const faux = fauxProvider(options.faux ?? {});
	const models = createModels(options.credentials === undefined ? undefined : { credentials: options.credentials });
	models.setProvider(wrapProvider(options.provider === undefined ? faux.provider : options.provider(faux.provider), options.providerOptions));
	const registry = createRegistry();
	registry.install(ReconcileGuard);
	for (const extension of options.extensions ?? []) registry.install(extension);
	const reports: { type: string; message: string; task?: TaskId }[] = [];
	const harness = await HarnessFactory.open(
		store.storage,
		{
			models,
			registry,
			settings: { afterFailedRun: "keep", ...options.settings },
			env: options.env ?? (() => new NodeExecutionEnv({ cwd: work })),
			...(options.now === undefined ? {} : { now: options.now }),
			onReport: (error: unknown, info: ReportInfo) =>
				reports.push({
					type: info.type,
					message: error instanceof Error ? error.message : String(error),
					...("task" in info && info.task !== undefined ? { task: info.task.id } : {}),
				}),
		},
		context,
	);
	const root = await harness.root(context, { agent: options.rootAgent ?? { model: MODEL } });
	const uncertain = await reconcileOnOpen(harness, registry);
	return {
		store,
		harness,
		root,
		registry,
		models,
		faux,
		reports,
		uncertain,
		resume: async () => {
			await finishEdits(harness);
			harness.resume();
		},
		close: () => harness.close(context),
	};
}
