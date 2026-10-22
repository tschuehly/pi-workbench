// PI WEB session-host protocol v2 for one Durable Chat: committed Durable state (watchEvents) projected into PI WEB's
// browser session events, and the operations PI WEB routes to a Durable Chat. Durable IDs, Chord operations and task
// internals stay here; PI WEB sees only its own event and message shapes.
import { OutputBuffer, sanitizeOutput } from "@earendil-works/chord/output";
import { withCancel } from "@earendil-works/chord/context";
import { type AssistantMessage, clampThinkingLevel, getSupportedThinkingLevels, type ImageContent, type Message, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
	type AgentEvent,
	type EntryRecord,
	InboxDoc,
	type SnapshotEvent,
	type SubmissionId,
	UsageDoc,
	watchEvents,
} from "@earendil-works/pi-durable";
import type { ChatHost } from "./chat.ts";
import { parseModel } from "./chat.ts";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { Admissions, admit, changeQueued, context, Edits, type EditPlan, type Host, type QueuedInput, Reconcile, resolveUncertain } from "./host.ts";
import { completePrefix, redact, sanitizeDeep, sanitizingEnv, sealed } from "./redact.ts";
import { type CommandResult, NOTICE_TYPES, runCommand, storagePreflight } from "./extensions.ts";
import {
	ANSWERS_ENTRY,
	ASK_ANSWERS_CUSTOM_TYPE,
	acknowledgeAttention,
	type CloseAsk,
	closeAsk,
	countTurn,
	entryWorkingMode,
	MODE_ENTRY,
	openAsksReminder,
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

/**
 * PI WEB's gated Chat operations (`CHAT_CAPABILITY_LABELS` in its `shared/apiTypes.ts`) this host supports, reported
 * in its ready message. PI WEB shows a control only once its name is here; add a name with the operation that
 * implements it. Protocol 2 hosts without the list support none of them.
 */
export const CAPABILITIES = ["queue.edit", "queue.promote", "attachments", "thinking", "shell"] as const;

/** A `!`/`!!` command's record: PI WEB's `bashExecution` message without role and timestamp. */
export const BASH_ENTRY = "workbench.bash";
type BashRecord = { command: string; timestamp: number; output: string; exitCode?: number; cancelled: boolean; truncated: boolean; fullOutputPath?: string; excludeFromContext: boolean };

/** What the model reads for a `!` command (Pi's `bashExecutionToText`). */
export function bashExecutionToText(record: BashRecord): string {
	let text = `Ran \`${record.command}\`\n`;
	text += record.output === "" ? "(no output)" : `\`\`\`\n${record.output}\n\`\`\``;
	if (record.cancelled) text += "\n\n(command cancelled)";
	else if (record.exitCode !== undefined && record.exitCode !== 0) text += `\n\nCommand exited with code ${record.exitCode}`;
	if (record.truncated && record.fullOutputPath !== undefined) text += `\n\n[Output truncated. Full output: ${record.fullOutputPath}]`;
	return text;
}

/** Pi's shell output limits (`DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`): the tail is kept, the rest spills to a file. */
const SHELL_LIMITS = { maxBytes: 50 * 1024, maxLines: 2000 } as const;

/** Inline image attachments of a prompt: the images, and their metadata (redacted before commit). */
export type Attachment = { reference?: string; name?: string; mimeType: string };

/** PI WEB's queue mutations (legacy `SessionQueueMessageMutation`, plus promotion). */
export type QueueAction = "remove" | "recall" | "toggle" | "promote" | "promoteAll";

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
	isCompacting: false;
	isBashRunning: boolean;
	pendingMessageCount: number;
	/** In run order (steers first); `id` lets PI WEB name the exact snapshot a queue mutation was made against. */
	queuedMessages: QueuedMessage[];
	messageCount: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	warnings?: { severity: "info" | "warning" | "error"; message: string }[];
	extensionStatuses?: Record<string, string>;
	pendingAsks?: unknown[];
	pendingAsk?: unknown;
	attentionRequest?: { id: string; reason: string };
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
	/** Interrupted unsafe tool calls that block their tool until the owner resolves them. */
	unresolvedEffects?: UnresolvedEffect[];
	/** Running shell tool calls, as PI WEB's Activity shows them (`ActiveToolExecution`). */
	activeToolExecutions?: { id: string; kind: "shell"; toolName: string; label: string; startedAt: string }[];
};

export type QueuedMessage = { id: number; kind: "steer" | "followUp"; text: string; hasAttachments?: true; attachmentCount?: number };

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
	if (entry.kind === BASH_ENTRY) return [bashMessage(entry)];
	const message = entry.model?.[0] as Message | undefined;
	if (message === undefined || message.role === "system") return [];
	const entryId = String(entry.id);
	const custom = (customType: string, content: string, details: unknown, id = entryId) => ({ role: "custom", customType, content, display: true, details, timestamp: message.timestamp, entryId: id });
	const parts = Array.isArray(message.content) ? (message.content as { type: string; text?: string }[]) : [];
	const mode = entryWorkingMode(entry);
	// A plain prompt's open-questions reminder is its last block, hidden as in a legacy Chat.
	const userParts = entry.kind === PROMPT_ENTRY && (entry.data as { askReminder?: boolean } | undefined)?.askReminder === true ? parts.slice(0, -1) : parts;
	if (mode !== undefined && message.role === "user") {
		const block = custom(WORKING_MODE_CUSTOM_TYPE, parts[0]?.text ?? "", mode, entry.kind === MODE_ENTRY ? entryId : `${entryId}:working-mode`);
		return entry.kind === MODE_ENTRY ? [block] : [block, { ...message, content: userParts.slice(1), entryId }];
	}
	if (userParts !== parts) return [{ ...message, content: userParts, entryId }];
	if (entry.kind === ANSWERS_ENTRY) return [custom(ASK_ANSWERS_CUSTOM_TYPE, textOfContent(message.content), entry.data ?? null)];
	if (entry.kind === RECONCILE_ENTRY) return [custom(RECONCILE_ENTRY, textOfContent(message.content), entry.data ?? null)];
	const notice = NOTICE_TYPES[entry.kind];
	if (notice !== undefined) return [custom(notice, textOfContent(message.content), entry.data ?? null)];
	const content = message.role === "toolResult" ? { content: browserToolContent(message.content) } : {};
	return [{ ...message, ...content, entryId, ...(streamId === undefined ? {} : { streamId }) }];
}

function bashMessage(entry: EntryRecord): Record<string, unknown> {
	return { role: "bashExecution", ...(entry.data as BashRecord), entryId: String(entry.id) };
}

/** A queued input as the composer's queue shows it: the user's text (after a Working Mode block), and its images. */
function queuedMessage(item: { id: number; mode: "steer" | "followUp"; content: unknown; entry?: unknown }): QueuedMessage {
	const parts = typeof item.content === "string" ? [{ type: "text", text: item.content }] : (item.content as { type: string; text?: string }[]);
	const mode = (item.entry as { data?: { workingMode?: unknown } } | undefined)?.data?.workingMode !== undefined;
	const texts = parts.filter((part) => part.type === "text").slice(mode ? 1 : 0);
	const images = parts.filter((part) => part.type === "image").length;
	return { id: item.id, kind: item.mode, text: texts.map((part) => part.text ?? "").join("\n"), ...(images === 0 ? {} : { hasAttachments: true as const, attachmentCount: images }) };
}

/** Queued inputs in the order they run: steers at the next tool boundary, follow-ups after the run. */
function runOrder<T extends { mode: string } | { kind: string }>(items: T[]): T[] {
	const steer = (item: T) => ("mode" in item ? item.mode : item.kind) === "steer";
	return [...items.filter(steer), ...items.filter((item) => !steer(item))];
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
	/** Running bash calls of the current round (activity), from committed tool events. */
	#shells = new Map<string, string>();
	#stop: (() => Promise<unknown>) | undefined;
	/** False until the first input after open: a reopened store stays paused until Thomas sends something. */
	#resumed = false;
	/** The running `!` command: one at a time, as in a legacy Chat. */
	#shell: { cancel: () => void } | undefined;
	/** `!` records finished during a run: committed when it ends, so they never land between a tool call and its result. */
	#heldShell: BashRecord[] = [];

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
		this.#reset(stream.snapshot);
		stream.start(async (events) => {
			for (const event of events) this.#apply(event);
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

	#reset(snapshot: SnapshotEvent): void {
		this.#entries = [...snapshot.entries];
		this.#running = snapshot.run !== undefined;
		this.#partial = undefined;
		this.#shells.clear();
		// A restored store stays paused: its running slots are interrupted, not running, until work resumes.
		if (this.#resumed) for (const slot of snapshot.tools) if (slot.name === "bash" && slot.status === "running") this.#shells.set(slot.callId, new Date().toISOString());
		this.#emitted = [];
		const partial = snapshot.generation?.message;
		if (partial !== undefined) this.#startPartial(partial);
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
			case "snapshot":
				this.#reset(event);
				this.#emit({ type: "session.tree.changed" });
				return;
			case "run_start":
				this.#running = true;
				this.#emit({ type: "agent.start" });
				this.#record("agent.start", { sessionFile: null });
				// Agent turns since an open set was posted drive the browser's "may be stale" mark.
				void countTurn(this.#host.root).catch(() => {});
				return;
			case "run_end":
				this.#running = false;
				this.#shells.clear();
				void this.#flushShell();
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
				// A `!` record was shown live by its shell events; PI WEB reads it from the transcript after a reload.
				if (event.entry.kind !== BASH_ENTRY)
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
				// Workbench notices (storage-guard) are passive entries; show them live.
				if (event.entry.kind in NOTICE_TYPES) for (const message of browserMessages(event.entry)) this.#emit({ type: "message.end", message });
				return;
			case "tool_execution_start":
				this.#toolOutput.set(event.toolCallId, "");
				if (event.toolName === "bash") this.#shells.set(event.toolCallId, new Date().toISOString());
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
				this.#shells.delete(event.toolCallId);
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
		const queuedMessages = runOrder((inbox?.items ?? []).flatMap((item) => (item.mode === "write" ? [] : [queuedMessage(item)])));
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
		const contextWindow = agent.model === undefined ? undefined : this.#host.models.getModel(agent.model.provider, agent.model.modelId)?.contextWindow;
		const contextTokens = this.#contextTokens();
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
			isCompacting: false,
			isBashRunning: this.#shell !== undefined,
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
			...(this.#shells.size === 0 ? {} : { activeToolExecutions: [...this.#shells].map(([callId, startedAt]) => ({ id: `tool:${callId}`, kind: "shell" as const, toolName: "bash", label: "Shell command", startedAt })) }),
			...(contextWindow === undefined || contextWindow <= 0
				? {}
				: { contextUsage: { tokens: contextTokens, contextWindow, percent: contextTokens === null ? null : (contextTokens / contextWindow) * 100 } }),
		};
	}

	/** A host command (`/quota-check`). It runs outside the store: nothing is committed or resumed. */
	command(name: string, args: string): Promise<CommandResult> {
		return runCommand(name, args);
	}

	/**
	 * Context size as Pi's `getContextUsage` reads it: the last answer's usage (not aborted, failed or empty).
	 * ponytail: ignores the estimate of messages after that answer and compaction; add both with Durable compaction.
	 */
	#contextTokens(): number | null {
		for (const entry of this.#entries.toReversed()) {
			const message = entry.model?.[0] as Message | undefined;
			if (message?.role !== "assistant" || message.stopReason === "aborted" || message.stopReason === "error") continue;
			const { usage } = message;
			const tokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
			if (tokens > 0) return tokens;
		}
		return null;
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
	async prompt(params: { operationId: string; text: string; mode?: "steer" | "followUp"; images?: ImageContent[]; attachments?: Attachment[] }): Promise<{ submissionId: SubmissionId }> {
		await this.#resume();
		const { root } = this.#host;
		const existing = await root.commit((tx) => tx.submissionByRequest(root.id, params.operationId), context);
		// storage-guard: a new input that starts a lead run gets the low-disk notice first.
		if (existing === undefined && this.#chat !== undefined && !this.#running) await storagePreflight(root);
		// A retry keeps whatever the first attempt admitted; only a new operation picks up a pending block or reminder.
		const fresh = existing === undefined && this.#chat !== undefined;
		const block = fresh ? await pendingBlock(this.#host.harness, root, false) : undefined;
		// A plain prompt reminds the model of the open question sets in the store, as a legacy Chat does (hidden).
		// It repeats question text from tool-call arguments (stored verbatim): sanitized before this new copy commits.
		const reminder = fresh && params.mode === undefined ? redact(openAsksReminder((await questionsState(this.#host.harness, root)).open)) : "";
		const images = params.images ?? [];
		// As a legacy Chat sends it: the text (when any), then the images; their metadata is redacted before commit.
		// The reminder rides last, so the transcript hides it as the prompt's last block.
		const content = [
			...(block === undefined ? [] : [{ type: "text" as const, text: block.text }]),
			...(params.text === "" && images.length > 0 ? [] : [{ type: "text" as const, text: params.text }]),
			...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
			...(reminder === "" ? [] : [{ type: "text" as const, text: reminder }]),
		];
		const data = {
			...(block === undefined ? {} : { workingMode: block.details }),
			...(images.length === 0 ? {} : { attachments: sanitizeDeep((params.attachments ?? []).map((a) => ({ ...a })), sealed(redact)) }),
			...(reminder === "" ? {} : { askReminder: true }),
		};
		const submissionId = await admit(root, {
			operationId: params.operationId,
			text: params.text,
			...(params.mode === undefined ? {} : { mode: params.mode }),
			...(block === undefined && images.length === 0 && reminder === "" ? {} : { content, entry: { kind: PROMPT_ENTRY, data } }),
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
		// As a legacy Chat: the Chat's thinking level is clamped to what the new model supports.
		const thinkingLevel = clampThinkingLevel(this.#host.models.getModel(provider, modelId)!, (await this.#host.root.agent(context)).thinkingLevel);
		await this.#host.root.configure({ model, thinkingLevel }, context);
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

	/** Resources PI WEB resolved with Pi's loader; their sources are recorded when they change. */
	async configure(resources: Resources): Promise<void> {
		if (this.#chat === undefined) return;
		this.#chat.workbench.resources = resources;
		const sources = [...(resources.sources ?? [])].map((s) => ({ path: s.path, sha256: s.sha256 }));
		await this.#host.harness.commit(async (tx) => {
			const doc = await tx.doc(ResourcesDoc);
			if (JSON.stringify(doc.sources) !== JSON.stringify(sources)) doc.sources = sources;
		}, context);
	}

	/** Stop: withdraw queued inputs and abort the current run (background work excluded). */
	async abort(): Promise<void> {
		this.#shell?.cancel();
		await this.#host.root.abort(context);
	}

	// ─── Queue ───────────────────────────────────────────────────────────────

	/**
	 * Change the queue as a legacy Chat's controls do, against the snapshot PI WEB showed (`expected`: queued IDs in run
	 * order). remove: only that input; recall: it and every later one (PI WEB puts its text in the composer); toggle:
	 * steer ↔ follow-up, to the end of the other queue; promote: a follow-up becomes a steer; promoteAll: every
	 * follow-up, in order. Durable edits are durable: a crash rolls one forward, a retried `editId` returns its outcome.
	 */
	async mutateQueue(request: { editId: string; action: QueueAction; index: number; expected: number[] }): Promise<void> {
		const { harness, root } = this.#host;
		const inbox = await harness.snapshot(InboxDoc, root.id, context);
		const before = runOrder((inbox?.items ?? []).flatMap((item) => (item.mode === "write" ? [] : [item])));
		const target = await root.commit(async (tx) => {
			// A retried edit names its first attempt's input, whatever the queue holds now.
			const retried = (await tx.doc(Edits)).edits[request.editId];
			if (retried !== undefined) return retried.steps[0]!.from;
			for (const op of Object.keys((await tx.doc(Admissions, root.id)).ops)) {
				const record = await tx.submissionByRequest(root.id, op);
				if (record !== undefined && record.id === before[request.index]?.id) return op;
			}
			return undefined;
		}, context);
		const plan = (queue: QueuedInput[]): EditPlan => {
			const order = runOrder(queue);
			if (order.length !== request.expected.length || order.some((input, n) => input.id !== request.expected[n]))
				throw new Error("Queued messages changed; refresh the queue and try again");
			const input = order[request.index]!;
			const flip = input.mode === "steer" ? "followUp" : "steer";
			switch (request.action) {
				case "remove":
					return { withdraw: [input], readmit: [] };
				case "recall":
					return { withdraw: order.slice(request.index), readmit: [] };
				case "toggle":
					return { withdraw: [input], readmit: [{ input, mode: flip }] };
				case "promote":
					if (input.mode !== "followUp") throw new Error("Only a follow-up can be sent now");
					return { withdraw: [input], readmit: [{ input, mode: "steer" }] };
				case "promoteAll": {
					const follow = order.filter((item) => item.mode === "followUp");
					if (follow[0] !== input) throw new Error("Send all now names the first follow-up");
					return { withdraw: follow, readmit: follow.map((item) => ({ input: item, mode: "steer" as const })) };
				}
			}
		};
		if (target === undefined) throw new Error("Queued messages changed; refresh the queue and try again");
		await changeQueued(harness, root, { editId: request.editId, operationId: target, payload: request }, plan);
		await this.#publishStatus();
	}

	// ─── Thinking level ──────────────────────────────────────────────────────

	async #model() {
		const agent = await this.#host.root.agent(context);
		return agent.model === undefined ? undefined : this.#host.models.getModel(agent.model.provider, agent.model.modelId);
	}

	/** The levels the Chat's model supports (Pi's `getSupportedThinkingLevels`). */
	async thinkingLevels(): Promise<ModelThinkingLevel[]> {
		const model = await this.#model();
		return model === undefined ? ["off"] : getSupportedThinkingLevels(model);
	}

	/** Store the Chat's thinking level; the next request uses it, also after a restart. */
	async setThinkingLevel(level: string): Promise<void> {
		const match = (await this.thinkingLevels()).find((candidate) => candidate === level);
		if (match === undefined) throw new Error(`Invalid thinking level: ${level}`);
		await this.#host.root.configure({ thinkingLevel: match }, context);
		this.#record("model.select", { provider: null, model: null, effort: match, source: "set" });
		await this.#publishStatus();
	}

	/** The next supported level, as a legacy Chat cycles. */
	async cycleThinkingLevel(): Promise<ModelThinkingLevel> {
		const model = await this.#model();
		if (model?.reasoning !== true) throw new Error("Current model does not support thinking");
		const levels = getSupportedThinkingLevels(model);
		const next = levels[(levels.indexOf((await this.#host.root.agent(context)).thinkingLevel) + 1) % levels.length]!;
		await this.setThinkingLevel(next);
		return next;
	}

	// ─── `!` shell commands ──────────────────────────────────────────────────

	/**
	 * `!cmd` runs in the Chat's workspace and its output reaches the model with the next request; `!!cmd` is recorded but
	 * excluded from the model's context (Pi's `executeBash`). Output streams to PI WEB as shell events and is redacted
	 * before it is shown or committed, like a tool's. Resolves once the command started; its record commits when it
	 * ends, or after the current run.
	 */
	async shell(text: string): Promise<void> {
		const excludeFromContext = text.startsWith("!!");
		const command = (excludeFromContext ? text.slice(2) : text.slice(1)).trim();
		if (command === "") throw new Error("Usage: !<shell command>");
		if (this.#shell !== undefined) throw new Error("A bash command is already running");
		const { context: run, cancel } = withCancel(context);
		let cancelled = false;
		this.#shell = { cancel: () => ((cancelled = true), cancel()) };
		const sanitize = sealed(redact);
		const cwd = (await this.#host.root.agent(context)).cwd;
		const env = sanitizingEnv(new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }), sanitize);
		this.#emit({ type: "shell.start", command, excludeFromContext });
		await this.#publishStatus();
		void (async () => {
			const output = new OutputBuffer({ ...SHELL_LIMITS, retain: "tail" });
			let pending = "";
			const forward = (chunk: string) => {
				if (chunk === "") return;
				output.push(chunk);
				this.#emit({ type: "shell.chunk", chunk });
			};
			let exitCode: number | undefined;
			let fullOutputPath: string | undefined;
			try {
				const result = await env.exec(command, {
					spill: { afterBytes: SHELL_LIMITS.maxBytes, afterLines: SHELL_LIMITS.maxLines },
					onOutput: (chunk) => {
						pending += sanitizeOutput(chunk);
						const ready = completePrefix(pending);
						pending = pending.slice(ready.length);
						forward(sanitize(ready));
					},
				}, run);
				if (result.ok) [exitCode, fullOutputPath] = [result.value.exitCode, result.value.spillPath];
				else fullOutputPath = result.error.spillPath;
				forward(sanitize(pending));
				output.end();
				const kept = output.snapshot();
				const record: BashRecord = {
					command, timestamp: Date.now(), output: kept.text.replace(/\n$/, ""), cancelled,
					truncated: kept.droppedBytes > 0 || kept.droppedLines > 0, excludeFromContext,
					...(exitCode === undefined || cancelled ? {} : { exitCode }),
					...(fullOutputPath === undefined ? {} : { fullOutputPath }),
				};
				this.#heldShell.push(record);
				if (!this.#running) await this.#flushShell();
				this.#emit({ type: "shell.end", output: record.output, ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }), cancelled, truncated: record.truncated, ...(fullOutputPath === undefined ? {} : { fullOutputPath }) });
			} catch (error) {
				this.#emit({ type: "shell.end", output: sanitize(error instanceof Error ? error.message : String(error)), isError: true });
			} finally {
				this.#shell = undefined;
				await this.#publishStatus();
			}
		})();
	}

	/** Commit held `!` records as display entries; an included one carries the user message the model reads. */
	async #flushShell(): Promise<void> {
		for (const record of this.#heldShell.splice(0)) {
			const model = record.excludeFromContext ? {} : { model: [{ role: "user" as const, content: [{ type: "text" as const, text: bashExecutionToText(record) }], timestamp: record.timestamp }] };
			await this.#host.root.submit({ type: "write", entry: { kind: BASH_ENTRY, data: record, ...model } }, context);
		}
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

const STATUS_EVENTS = new Set<AgentEvent["type"]>(["run_start", "run_end", "inbox_update", "usage_changed", "agent_changed", "snapshot", "message_end", "tool_execution_start", "tool_execution_end"]);
