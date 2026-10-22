// Minimal headless Durable host for one Chat family: one owned store, explicit (paused) restore, reconciliation of
// uncertain unsafe tool effects before scheduling, and stable-ID admission. Not a Workbench port.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	createModels,
	type FauxProviderHandle,
	fauxProvider,
	type Message,
	type Provider,
	type RegisterFauxProviderOptions,
} from "@earendil-works/pi-ai";
import {
	type Conversation,
	type ConversationId,
	createRegistry,
	defineDoc,
	defineExtension,
	type Harness,
	Harness as HarnessFactory,
	type HarnessSettings,
	hook,
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
 * Before scheduling: every model tool task stopped after intent whose rerun is not safe under both the stored and the
 * current policy may have had an external effect. Record it so the guard blocks another attempt.
 */
export async function reconcileOnOpen(harness: Harness, registry: Registry): Promise<string[]> {
	const inspection = await harness.inspect(context);
	const found: Record<string, Uncertain> = {};
	for (const task of inspection.tasks) {
		const record = task.record;
		if (record.kind !== ToolTask.definition.name || record.state.status === "terminal" || record.state.status === "completing") continue;
		const checkpoint = record.state.checkpoint as ToolTaskCheckpoint;
		const input = record.input as ToolTaskInput;
		if (checkpoint?.phase !== "execute" || input.kind !== "model") continue;
		const conversation = (await harness.conversation(record.conversationId, context))!;
		const entry = await conversation.commit((tx) => tx.entry(input.assistant), context);
		const call = (entry?.model?.[0] as Message | undefined)?.role === "assistant"
			? (entry!.model![0] as { content: { type: string; id?: string; name?: string }[] }).content.find((c) => c.type === "toolCall" && c.id === input.callId)
			: undefined;
		const name = call?.name ?? "unknown";
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

export type Admit = { readonly operationId: string; readonly text: string; readonly mode?: "steer" | "followUp" };

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
		{ type: "input", content: request.text, requestId: request.operationId, whenBusy: request.mode ?? "followUp" },
		context,
	);
	return submission.id;
}

// ─── Host ────────────────────────────────────────────────────────────────────

export type HostOptions = {
	readonly synchronous?: Synchronous;
	readonly faults?: Faults;
	readonly faux?: RegisterFauxProviderOptions;
	readonly settings?: HarnessSettings;
	readonly now?: () => number;
	/** Decorate the faux provider (before redaction), e.g. with provider-side deferred jobs. */
	readonly provider?: (faux: Provider) => Provider;
	/** Extensions installed after the guard, in order. */
	readonly extensions?: readonly ReturnType<typeof defineExtension>[];
};

export type Host = {
	readonly store: OpenedStore;
	readonly harness: Harness;
	readonly root: Conversation;
	readonly registry: Registry;
	readonly faux: FauxProviderHandle;
	readonly reports: { readonly type: string; readonly message: string; readonly task?: TaskId }[];
	/** Task IDs recorded as uncertain at open. */
	readonly uncertain: readonly string[];
	/** Explicit resume: restored work stays paused until this is called (owner decision 2). */
	resume(): void;
	close(): Promise<void>;
};

export async function openHost(dir: string, options: HostOptions = {}): Promise<Host> {
	const work = join(dir, "work");
	mkdirSync(work, { recursive: true });
	const store = await openStore(join(dir, "session.sqlite"), {
		...(options.synchronous === undefined ? {} : { synchronous: options.synchronous }),
		...(options.faults === undefined ? {} : { faults: options.faults }),
	});
	const faux = fauxProvider(options.faux ?? {});
	const models = createModels();
	models.setProvider(wrapProvider(options.provider === undefined ? faux.provider : options.provider(faux.provider)));
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
			env: () => new NodeExecutionEnv({ cwd: work }),
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
	const root = await harness.root(context, { agent: { model: MODEL } });
	const uncertain = await reconcileOnOpen(harness, registry);
	return {
		store,
		harness,
		root,
		registry,
		faux,
		reports,
		uncertain,
		resume: () => harness.resume(),
		close: () => harness.close(context),
	};
}
