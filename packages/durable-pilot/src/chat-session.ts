// PI WEB session-host protocol v2 for one Durable Chat: committed Durable state (watchEvents) projected into PI WEB's
// browser session events, and the operations PI WEB routes to a Durable Chat. Durable IDs, Chord operations and task
// internals stay here; PI WEB sees only its own event and message shapes.
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
	type AgentEvent,
	CompactionEntry,
	type CompactionSettings,
	type EntryRecord,
	InboxDoc,
	LiveDoc,
	type SnapshotEvent,
	type SubmissionId,
	UsageDoc,
	watchEvents,
} from "@earendil-works/pi-durable";
import type { ChatHost } from "./chat.ts";
import { DEFAULT_COMPACTION, parseModel } from "./chat.ts";
import { CHECKPOINT_CUSTOM_TYPE, CHECKPOINT_ENTRY, type CheckpointData } from "./checkpoint.ts";

type WorkingModeDetailsLike = Record<string, unknown>;
import { redact } from "./redact.ts";
import { admit, context, type Host, Reconcile, resolveUncertain } from "./host.ts";
import {
	ANSWERS_ENTRY,
	ASK_ANSWERS_CUSTOM_TYPE,
	acknowledgeAttention,
	type CloseAsk,
	closeAsk,
	countTurn,
	entryWorkingMode,
	MODE_ENTRY,
	PROMPT_ENTRY,
	pendingBlock,
	questionsState,
	RECONCILE_ENTRY,
	type Resources,
	ResourcesDoc,
	selectMode,
	WORKING_MODE_CUSTOM_TYPE,
	type WorkbenchSignal,
	workingModeSnapshot,
} from "./workbench.ts";

/** v2 adds Working Mode, questions and attention, models, resources, effect resolution and client operation IDs. */
export const PROTOCOL = 2;

/** Telemetry recorder of the Workbench telemetry extension (`extensions/telemetry/telemetry.mjs`). */
export type Recorder = { record(type: string, data?: Record<string, unknown>): unknown; close(): void };

/** A PI WEB `SessionUiEvent` body (src/shared/apiTypes.ts), without the hub's `seq`. */
export type UiEvent = { readonly type: string } & Record<string, unknown>;

type Block = AssistantMessage["content"][number];

/** PI WEB `SessionStatus` without `sessionId`, which the router adds. */
export type ChatStatus = {
	persisted: true;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	isStreaming: boolean;
	isCompacting: boolean;
	isBashRunning: false;
	pendingMessageCount: number;
	queuedMessages: { kind: "steer" | "followUp"; text: string }[];
	messageCount: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	warnings?: { severity: "info" | "warning" | "error"; message: string }[];
	extensionStatuses?: Record<string, string>;
	pendingAsks?: unknown[];
	pendingAsk?: unknown;
	attentionRequest?: { id: string; reason: string };
	/** Interrupted unsafe tool calls that block their tool until the owner resolves them. */
	unresolvedEffects?: UnresolvedEffect[];
};

export type UnresolvedEffect = { id: string; toolName: string; arguments: string };
export type Resolution = "done" | "not-done" | "retry";

export type Transcript = { messages: unknown[]; status: ChatStatus; partial: unknown };

/**
 * A tool result's content as PI WEB renders it: one text block (Durable appends harness notes such as an abort as
 * separate blocks, which PI WEB would show as a second tool row), then any images.
 */
export function browserToolContent(content: unknown): unknown {
	if (!Array.isArray(content)) return content;
	const texts = content.filter((part: { type?: string }) => part.type === "text") as { text: string }[];
	if (texts.length < 2) return content;
	return [{ type: "text", text: texts.map((part) => part.text).join("\n") }, ...content.filter((part: { type?: string }) => part.type !== "text")];
}

/** The browser message of an entry: its model message with the entry ID, or none for bookkeeping entries. */
export function browserMessage(entry: EntryRecord, streamId?: string): Record<string, unknown> | undefined {
	return browserMessages(entry, streamId).at(-1);
}

/**
 * The browser messages of an entry, as a legacy Chat shows them: a Working Mode block as PI WEB's `working-mode` custom
 * message (before the prompt it came with), delivered answers as `pi-web.ask.answers`, and every other model message
 * with its entry ID.
 */
export function browserMessages(entry: EntryRecord, streamId?: string): Record<string, unknown>[] {
	const message = entry.model?.[0] as Message | undefined;
	const entryId = String(entry.id);
	const custom = (customType: string, content: string, details: unknown, id = entryId) => ({ role: "custom", customType, content, display: true, details, timestamp: message?.timestamp ?? 0, entryId: id });
	if (entry.kind === CHECKPOINT_ENTRY) {
		// The legacy extension's `context-checkpoint` message, after the Working Mode block it carried.
		const { workingMode, text, ...details } = (entry.data ?? {}) as CheckpointData & { workingMode?: WorkingModeDetailsLike };
		const content = message === undefined ? [] : Array.isArray(message.content) ? (message.content as { type: string; text?: string }[]) : [{ type: "text", text: String(message.content) }];
		const body = message === undefined ? (text ?? "") : (content.at(-1)?.text ?? "");
		return [...(workingMode === undefined ? [] : [custom(WORKING_MODE_CUSTOM_TYPE, content[0]?.text ?? "", workingMode, `${entryId}:working-mode`)]), custom(CHECKPOINT_CUSTOM_TYPE, body, details)];
	}
	if (message === undefined || message.role === "system") return [];
	const parts = Array.isArray(message.content) ? (message.content as { type: string; text?: string }[]) : [];
	const mode = entryWorkingMode(entry);
	if (mode !== undefined && message.role === "user") {
		const block = custom(WORKING_MODE_CUSTOM_TYPE, parts[0]?.text ?? "", mode, entry.kind === MODE_ENTRY ? entryId : `${entryId}:working-mode`);
		return entry.kind === MODE_ENTRY ? [block] : [block, { ...message, content: parts.slice(1), entryId }];
	}
	if (entry.kind === CompactionEntry.kind) {
		// Pi's transcript shape for a compaction (PI WEB transcriptMessages.ts): the summary without Durable's framing.
		const summary = /<summary>\n([\s\S]*)\n<\/summary>$/.exec(textOfContent(message.content))?.[1] ?? textOfContent(message.content);
		return [{ role: "system", source: "compaction", content: `Compacted history:\n\n${summary}`, timestamp: message.timestamp, entryId }];
	}
	if (entry.kind === ANSWERS_ENTRY) return [custom(ASK_ANSWERS_CUSTOM_TYPE, textOfContent(message.content), entry.data ?? null)];
	if (entry.kind === RECONCILE_ENTRY) return [custom(RECONCILE_ENTRY, textOfContent(message.content), entry.data ?? null)];
	const content = message.role === "toolResult" ? { content: browserToolContent(message.content) } : {};
	return [{ ...message, ...content, entryId, ...(streamId === undefined ? {} : { streamId }) }];
}

function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

function blockText(block: Block | undefined): { kind: "text" | "thinking"; text: string } | undefined {
	if (block?.type === "text") return { kind: "text", text: block.text };
	if (block?.type === "thinking") return { kind: "thinking", text: block.thinking };
	return undefined;
}

/**
 * Projects one conversation's committed Durable events into PI WEB session events, in commit order, and keeps the
 * state a joining browser needs (transcript, in-flight partial, status) consistent with the events already emitted.
 */
export class ChatSession {
	readonly #host: Host;
	readonly #chat: ChatHost | undefined;
	readonly #emit: (event: UiEvent) => void;
	readonly #chatId: string;
	readonly #telemetry: Recorder | undefined;
	#entries: EntryRecord[] = [];
	#partial: AssistantMessage | undefined;
	/** Text of each partial block emitted so far, so deltas append exactly what is new. */
	#emitted: string[] = [];
	#streamId: string | undefined;
	#streams = 0;
	#running = false;
	#toolOutput = new Map<string, string>();
	#stop: (() => Promise<unknown>) | undefined;
	/** False until the first input after open: a reopened store stays paused until Thomas sends something. */
	#resumed = false;

	constructor(host: Host | ChatHost, emit: (event: UiEvent) => void, options: { chatId?: string; telemetry?: Recorder } = {}) {
		this.#host = host;
		this.#chat = "workbench" in host ? host : undefined;
		this.#emit = emit;
		this.#chatId = options.chatId ?? "durable";
		this.#telemetry = options.telemetry;
	}

	async start(): Promise<void> {
		if (this.#chat !== undefined) this.#chat.workbench.onSignal = (signal) => void this.#signal(signal);
		const stream = await watchEvents(this.#host.harness, this.#host.root.id, context);
		await this.#reset(stream.snapshot);
		stream.start(async (events) => {
			for (const event of events) {
				if (event.type !== "snapshot") this.#apply(event);
				else {
					await this.#reset(event);
					this.#emit({ type: "session.tree.changed" });
				}
			}
			if (events.some((event) => STATUS_EVENTS.has(event.type))) this.#emit({ type: "status.update", status: await this.status() });
		});
		this.#stop = () => stream.stop();
		const agent = await this.#host.root.agent(context);
		this.#record("session.start", {
			sessionFile: null, cwd: agent.cwd ?? null, mode: "durable", reason: "open",
			provider: agent.model?.provider ?? null, model: agent.model?.modelId ?? null, effort: agent.thinkingLevel ?? null,
			argv: null, parentSessionId: null, executionId: null, ownerEpoch: this.#host.store.owner.epoch,
		});
	}

	async close(): Promise<void> {
		await this.#stop?.();
		await this.#host.close();
		this.#record("session.shutdown", { sessionFile: null, reason: "close" });
		this.#telemetry?.close();
	}

	#record(type: string, data: Record<string, unknown> = {}): void {
		try {
			this.#telemetry?.record(type, { sessionId: this.#chatId, ...data });
		} catch (error) {
			this.#emit({ type: "session.diagnostic", message: `Telemetry failed: ${error instanceof Error ? error.message : String(error)}` });
		}
	}

	/** Workbench tool outcomes, after their commit: PI WEB events, and attention for the daemon to notify. */
	async #signal(signal: WorkbenchSignal): Promise<void> {
		if (signal.type === "attention") this.#emit({ type: "durable.attention", kind: signal.kind, id: signal.id, detail: signal.detail });
		else this.#emit(signal);
		await this.#publishStatus();
	}

	async #publishStatus(): Promise<void> {
		this.#emit({ type: "status.update", status: await this.status() });
	}

	/**
	 * The snapshot's state, with the whole history up to its newest entry: the snapshot holds only the active context,
	 * which after a compaction starts at the summary, while PI WEB shows every message as a legacy Chat does.
	 */
	async #reset(snapshot: SnapshotEvent): Promise<void> {
		this.#entries = await this.#history(snapshot.entries.reduce((max, entry) => Math.max(max, entry.id), 0));
		this.#running = snapshot.run !== undefined;
		this.#partial = undefined;
		this.#emitted = [];
		const partial = snapshot.generation?.message;
		if (partial !== undefined) this.#startPartial(partial);
	}

	async #history(newest: number): Promise<EntryRecord[]> {
		if (newest === 0) return [];
		const entries: EntryRecord[] = [];
		let cursor: Parameters<Host["root"]["entries"]>[2];
		do {
			const page = await this.#host.root.entries({ order: "ascending", maxEntryId: newest as EntryRecord["id"] }, 500, cursor, context);
			entries.push(...page.items);
			cursor = page.next;
		} while (cursor !== undefined);
		return entries;
	}

	#startPartial(partial: AssistantMessage): void {
		this.#partial = partial;
		this.#streamId = `durable-${String(++this.#streams)}`;
		this.#emitted = partial.content.map((block) => blockText(block)?.text ?? "");
	}

	#apply(event: AgentEvent): void {
		// Nested calls belong to their parent tool's result; slice 1 shows only model-issued calls.
		if ("parentToolCallId" in event && event.parentToolCallId !== undefined) return;
		switch (event.type) {
			case "run_start":
				this.#running = true;
				this.#emit({ type: "agent.start" });
				this.#record("agent.start", { sessionFile: null });
				// Agent turns since an open set was posted drive the browser's "may be stale" mark.
				void countTurn(this.#host.root).catch(() => {});
				return;
			case "run_end":
				this.#running = false;
				this.#emit({ type: "agent.end" });
				this.#record("agent.settled", { sessionFile: null });
				return;
			case "message_start":
				if (event.message.role !== "assistant") return;
				this.#startPartial(event.message);
				this.#emit({ type: "assistant.start", message: { ...event.message, streamId: this.#streamId } });
				return;
			case "message_update":
				this.#update(event.changes);
				return;
			case "message_end": {
				this.#entries.push(event.entry);
				const model = event.entry.model?.[0] as Message | undefined;
				const streamed = model?.role === "assistant" && this.#partial !== undefined;
				if (streamed) this.#partial = undefined;
				for (const message of browserMessages(event.entry, streamed ? this.#streamId : undefined)) this.#emit({ type: "message.end", message });
				if (model?.role === "assistant" && model.usage !== undefined)
					// One usage record per committed assistant entry: a replayed request is its own entry, counted separately.
					this.#record("usage", {
						usageKey: `${this.#chatId}:assistant:${String(event.entry.id)}`, usage: model.usage,
						provider: model.provider ?? null, model: model.model ?? null, stopReason: model.stopReason ?? null, entryId: String(event.entry.id),
					});
				return;
			}
			case "entry_appended":
				this.#entries.push(event.entry);
				// Passive entries the browser shows (a cancelled checkpoint); bookkeeping entries project to nothing.
				for (const message of browserMessages(event.entry)) this.#emit({ type: "message.end", message });
				return;
			case "tool_execution_start":
				this.#toolOutput.set(event.toolCallId, "");
				this.#emit({ type: "tool.start", toolName: event.toolName, toolCallId: event.toolCallId, summary: "", args: event.args });
				return;
			case "tool_execution_update": {
				let text = this.#toolOutput.get(event.toolCallId) ?? "";
				if (event.output !== undefined) {
					if ("set" in event.output) text = event.output.set;
					else text = text.slice(event.output.trimStart ?? 0) + (event.output.append ?? "");
				}
				this.#toolOutput.set(event.toolCallId, text);
				this.#emit({ type: "tool.update", toolName: event.toolName, toolCallId: event.toolCallId, text, ...(event.details === undefined ? {} : { details: event.details }) });
				return;
			}
			case "tool_execution_end": {
				this.#toolOutput.delete(event.toolCallId);
				const stored = event.entry?.model?.[0] as { content?: unknown; isError?: boolean; details?: unknown } | undefined;
				const result = stored === undefined ? undefined : { ...stored, content: browserToolContent(stored.content) };
				this.#emit({
					type: "tool.end",
					toolName: event.toolName,
					toolCallId: event.toolCallId,
					text: result === undefined ? "Tool call ended without a result" : textOfContent(result.content),
					isError: result === undefined || result.isError === true,
					...(result?.content === undefined ? {} : { content: result.content }),
					...(result?.details === undefined ? {} : { details: result.details }),
				});
				return;
			}
			case "compaction_end":
				// A manual compaction reports through `compact()`; an automatic one that failed is reported here, as Pi does.
				if (event.error !== undefined && event.reason !== "manual") this.#compactionFailed(event.error);
				return;
			case "task_failed":
				this.#emit({ type: "session.diagnostic", message: `Durable task ${event.kind} failed: ${event.message}` });
				return;
			default:
				return;
		}
	}

	#update(changes: Extract<AgentEvent, { type: "message_update" }>["changes"]): void {
		if (this.#partial === undefined) return;
		for (const change of changes) {
			if (change.type === "message") this.#partial = change.message;
			else if (change.type === "block" || change.type.endsWith("_start")) {
				const content: Block[] = [...this.#partial.content];
				content[change.contentIndex] = (change as { block: Block }).block;
				this.#partial = { ...this.#partial, content };
			} else if (change.type === "text_delta" || change.type === "thinking_delta") {
				const content: Block[] = [...this.#partial.content];
				const block = content[change.contentIndex];
				if (block?.type === "text") content[change.contentIndex] = { ...block, text: block.text + change.delta };
				if (block?.type === "thinking") content[change.contentIndex] = { ...block, thinking: block.thinking + change.delta };
				this.#partial = { ...this.#partial, content };
			}
		}
		// Emit what each text block gained since the last emission; the redacting provider only ever appends.
		for (const [index, block] of this.#partial.content.entries()) {
			const current = blockText(block);
			if (current === undefined) continue;
			const before = this.#emitted[index] ?? "";
			if (!current.text.startsWith(before) || current.text.length === before.length) continue;
			this.#emitted[index] = current.text;
			const text = current.text.slice(before.length);
			this.#emit({ type: current.kind === "text" ? "assistant.delta" : "assistant.thinking.delta", text, streamId: this.#streamId });
		}
	}

	/** The whole transcript as browser messages; PI WEB pages it. */
	messages(): unknown[] {
		// ponytail: sends the whole transcript per read; page in the host once Durable Chats grow long.
		return this.#entries.flatMap((entry) => browserMessages(entry));
	}

	partial(): unknown {
		return this.#partial === undefined ? null : { ...this.#partial, streamId: this.#streamId };
	}

	async transcript(): Promise<Transcript> {
		// Captured before the await, so the page and partial match the events emitted so far.
		const messages = this.messages();
		const partial = this.partial();
		return { messages, partial, status: await this.status() };
	}

	async status(): Promise<ChatStatus> {
		const { harness, root } = this.#host;
		const [inbox, usage, agent] = await Promise.all([
			harness.snapshot(InboxDoc, root.id, context),
			harness.snapshot(UsageDoc, root.id, context),
			root.agent(context),
		]);
		const queuedMessages = (inbox?.items ?? []).flatMap((item) =>
			item.mode === "write" ? [] : [{ kind: item.mode, text: typeof item.content === "string" ? item.content : textOfContent(item.content) }],
		);
		const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
		let cost = 0;
		for (const bucket of [...Object.values(usage?.models ?? {}), ...Object.values(usage?.tools ?? {})]) {
			tokens.input += bucket.input;
			tokens.output += bucket.output;
			tokens.cacheRead += bucket.cacheRead;
			tokens.cacheWrite += bucket.cacheWrite;
			tokens.total += bucket.totalTokens;
			cost += bucket.cost.total;
		}
		const paused = harness.wake().active && !this.#resumed;
		const live = await harness.snapshot(LiveDoc, root.id, context);
		const [mode, questions, reconcile] = await Promise.all([workingModeSnapshot(harness, root), questionsState(harness, root), harness.snapshot(Reconcile, context)]);
		const pendingAsks = Object.values(questions.open).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
		const unresolvedEffects = Object.entries(reconcile?.uncertain ?? {})
			.filter(([, item]) => item.resolved === undefined && item.conversationId === root.id)
			.map(([id, item]) => ({ id, toolName: item.tool, arguments: item.arguments.length > 300 ? `${item.arguments.slice(0, 300)}…` : item.arguments }));
		return {
			persisted: true,
			...(agent.model === undefined ? {} : { model: { provider: agent.model.provider, id: agent.model.modelId } }),
			...(agent.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
			isStreaming: this.#running,
			isCompacting: (live?.compactions?.length ?? 0) > 0,
			isBashRunning: false,
			pendingMessageCount: queuedMessages.length,
			queuedMessages,
			messageCount: this.messages().length,
			tokens,
			cost,
			...(paused ? { warnings: [{ severity: "info" as const, message: "Restored paused: unfinished work waits until you send a message." }] } : {}),
			extensionStatuses: { [WORKING_MODE_CUSTOM_TYPE]: JSON.stringify(mode) },
			...(pendingAsks.length === 0 ? {} : { pendingAsks, pendingAsk: pendingAsks[0] }),
			...(questions.attention === null ? {} : { attentionRequest: questions.attention }),
			...(unresolvedEffects.length === 0 ? {} : { unresolvedEffects }),
		};
	}

	async #resume(): Promise<void> {
		if (this.#resumed) return;
		await this.#host.resume();
		this.#resumed = true;
	}

	/**
	 * Admit one input under its stable operation ID; resolves once committed. Sending resumes a paused restore, answers
	 * an attention request, and carries a pending Working Mode block before the user's text (one input, one turn).
	 */
	async prompt(params: { operationId: string; text: string; mode?: "steer" | "followUp" }): Promise<{ submissionId: SubmissionId }> {
		await this.#resume();
		const { root } = this.#host;
		const existing = await root.commit((tx) => tx.submissionByRequest(root.id, params.operationId), context);
		// A retry keeps whatever the first attempt admitted; only a new operation picks up a pending block.
		const block = existing === undefined && this.#chat !== undefined ? await pendingBlock(this.#host.harness, root, false) : undefined;
		const submissionId = await admit(root, {
			operationId: params.operationId,
			text: params.text,
			...(params.mode === undefined ? {} : { mode: params.mode }),
			...(block === undefined ? {} : { content: [{ type: "text", text: block.text }, { type: "text", text: params.text }], entry: { kind: PROMPT_ENTRY, data: { workingMode: block.details } } }),
		});
		if (existing === undefined) this.#record("prompt", { entryId: null, prompt: null, submissionId: String(submissionId) });
		if (this.#chat !== undefined && (await acknowledgeAttention(root, undefined))) await this.#publishStatus();
		else if (block !== undefined) await this.#publishStatus();
		return { submissionId };
	}

	/** `/mode …`: select an axis value for the next prompt, or `/mode send` to deliver the pending block now. */
	async mode(args: string): Promise<{ type: "done"; message?: string } | { type: "unsupported"; message: string }> {
		const { harness, root } = this.#host;
		if (args.trim().toLowerCase() === "send") {
			await this.#resume();
			const block = await pendingBlock(harness, root, true);
			if (block === undefined) return { type: "done", message: "Working Mode unchanged" };
			// Idle: starts a turn. Running: steers it after the current tool calls.
			await admit(root, {
				operationId: `mode-send:${block.details.seq}`,
				text: block.text,
				mode: "steer",
				entry: { kind: MODE_ENTRY, data: { workingMode: block.details } },
			});
			await this.#publishStatus();
			return { type: "done" };
		}
		const result = await selectMode(root, args);
		await this.#publishStatus();
		return result.ok ? { type: "done", message: result.message } : { type: "unsupported", message: result.message };
	}

	/** Close an open question set with PI WEB's validated outcome; the answers reach the model once, as a follow-up. */
	async closeAsk(request: CloseAsk): Promise<Awaited<ReturnType<typeof closeAsk>>> {
		await this.#resume();
		const result = await closeAsk(this.#host.root, request);
		if (result.result === "closed" && !result.retried) this.#emit({ type: "ask.closed", askId: request.askId, reason: result.outcome.reason });
		await this.#publishStatus();
		return result;
	}

	async acknowledgeAttention(id: string): Promise<boolean> {
		const cleared = await acknowledgeAttention(this.#host.root, id);
		if (cleared) await this.#publishStatus();
		return cleared;
	}

	/** Models this Chat can switch to: the Claude models, and the scripted one when offered. */
	models(): { provider: string; id: string; name: string; contextWindow?: number; reasoning?: unknown }[] {
		return this.#host.models.getModels().map((model) => ({ provider: model.provider, id: model.id, name: model.name, contextWindow: model.contextWindow, reasoning: model.reasoning }));
	}

	/** Store the Chat's model; the next model request uses it. */
	async setModel(provider: string, modelId: string): Promise<void> {
		if (this.#host.models.getModel(provider, modelId) === undefined) throw new Error(`Unknown model ${provider}/${modelId}`);
		const model = parseModel(`${provider}/${modelId}`);
		await this.#host.root.configure({ model }, context);
		this.#record("model.select", { provider, model: modelId, effort: null, source: "set" });
		await this.#publishStatus();
	}

	/**
	 * The owner resolves an interrupted unsafe call: recorded durably, the tool unblocked, and the model told once (a
	 * follow-up under a stable ID, so a retried request delivers nothing twice).
	 */
	async resolveEffect(taskId: string, resolution: Resolution): Promise<void> {
		const { harness, root } = this.#host;
		const doc = await harness.snapshot(Reconcile, context);
		const item = doc?.uncertain[taskId];
		if (item === undefined || item.conversationId !== root.id) throw new Error(`No interrupted call ${taskId} in this Chat`);
		if (item.resolved !== undefined && item.resolved !== resolution) throw new Error(`Interrupted call ${taskId} was already marked ${item.resolved}`);
		await resolveUncertain(harness, taskId, resolution);
		await this.#resume();
		const label = { done: "done: its effect happened. Do not repeat it.", "not-done": "not done: its effect did not happen. Run it again only if it is still needed.", retry: "to retry: run it again now." }[resolution];
		await admit(root, {
			operationId: `resolve:${taskId}`,
			text: `The user resolved the interrupted ${item.tool} call (${item.arguments}) as ${label}`,
			entry: { kind: RECONCILE_ENTRY, data: { taskId, tool: item.tool, resolution } },
		});
		await this.#publishStatus();
	}

	/**
	 * `/compact [instructions]`: a manual Durable compaction, which summarizes while the Chat keeps working and places
	 * the summary when idle or at the next turn boundary; Esc cancels it. Its outcome is reported when it settles.
	 */
	async compact(instructions?: string): Promise<{ type: "done" }> {
		await this.#resume();
		const focus = instructions?.trim();
		// The instructions become task input, a new committed place: redacted like every other.
		const id = await this.#host.root.compact(focus === undefined || focus === "" ? undefined : redact(focus), context);
		await this.#publishStatus();
		void this.#host.harness.waitForTask(id, context).then(({ state }) => {
			const outcome = state.outcome;
			if (outcome.status === "failed") this.#compactionFailed(outcome.error.message);
			else if (outcome.status === "aborted") this.#emit({ type: "command.output", level: "info", message: "Compaction cancelled." });
			else if (outcome.result?.submissionId === undefined && outcome.result?.entryId === undefined)
				this.#emit({ type: "command.output", level: "info", message: "Nothing to compact yet." });
		}, () => {});
		return { type: "done" };
	}

	#compactionFailed(error: string): void {
		this.#emit({ type: "session.diagnostic", message: `Compaction failed: ${error}` });
		this.#emit({ type: "command.output", level: "error", message: "Couldn’t compact history. Try again." });
	}

	/** Resources PI WEB resolved with Pi's loader; their sources are recorded when they change. Compaction: Pi's settings. */
	async configure(resources: Resources, settings: { compaction?: CompactionSettings } = {}): Promise<void> {
		if (this.#chat === undefined) return;
		this.#chat.workbench.resources = resources;
		if (settings.compaction !== undefined) this.#chat.workbench.compaction = { ...DEFAULT_COMPACTION, ...settings.compaction };
		const sources = [...(resources.sources ?? [])].map((s) => ({ path: s.path, sha256: s.sha256 }));
		await this.#host.harness.commit(async (tx) => {
			const doc = await tx.doc(ResourcesDoc);
			if (JSON.stringify(doc.sources) !== JSON.stringify(sources)) doc.sources = sources;
		}, context);
	}

	/** Stop: withdraw queued inputs and abort the current run (background work excluded). */
	async abort(): Promise<void> {
		await this.#host.root.abort(context);
	}

	async clearQueue(): Promise<void> {
		const { harness, root } = this.#host;
		const inbox = await harness.snapshot(InboxDoc, root.id, context);
		for (const item of inbox?.items ?? []) if (item.mode !== "write") await harness.abortSubmission(item.id, context, root.id);
	}

	/** Listing metadata, read without scheduling anything. */
	info(): { messageCount: number; firstMessage: string } {
		const first = (this.messages() as { role?: string; content?: unknown }[]).find((message) => message.role === "user");
		return { messageCount: this.messages().length, firstMessage: textOfContent(first?.content) };
	}
}

const STATUS_EVENTS = new Set<AgentEvent["type"]>(["run_start", "run_end", "inbox_update", "usage_changed", "agent_changed", "snapshot", "message_end", "compaction_start", "compaction_end"]);
