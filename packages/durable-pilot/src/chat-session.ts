// PI WEB session-host protocol v1 for one Durable Chat: committed Durable state (watchEvents) projected into PI WEB's
// browser session events, and the operations PI WEB routes to a Durable Chat. Durable IDs, Chord operations and task
// internals stay here; PI WEB sees only its own event and message shapes.
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
	type AgentEvent,
	type EntryRecord,
	InboxDoc,
	type SnapshotEvent,
	type SubmissionId,
	UsageDoc,
	watchEvents,
} from "@earendil-works/pi-durable";
import { admit, context, type Host } from "./host.ts";

export const PROTOCOL = 1;

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
	isBashRunning: false;
	pendingMessageCount: number;
	queuedMessages: { kind: "steer" | "followUp"; text: string }[];
	messageCount: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	warnings?: { severity: "info" | "warning" | "error"; message: string }[];
};

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
	const message = entry.model?.[0] as Message | undefined;
	if (message === undefined || message.role === "system") return undefined;
	const content = message.role === "toolResult" ? { content: browserToolContent(message.content) } : {};
	return { ...message, ...content, entryId: String(entry.id), ...(streamId === undefined ? {} : { streamId }) };
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
	readonly #emit: (event: UiEvent) => void;
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

	constructor(host: Host, emit: (event: UiEvent) => void) {
		this.#host = host;
		this.#emit = emit;
	}

	async start(): Promise<void> {
		const stream = await watchEvents(this.#host.harness, this.#host.root.id, context);
		this.#reset(stream.snapshot);
		stream.start(async (events) => {
			for (const event of events) this.#apply(event);
			if (events.some((event) => STATUS_EVENTS.has(event.type))) this.#emit({ type: "status.update", status: await this.status() });
		});
		this.#stop = () => stream.stop();
	}

	async close(): Promise<void> {
		await this.#stop?.();
		await this.#host.close();
	}

	#reset(snapshot: SnapshotEvent): void {
		this.#entries = [...snapshot.entries];
		this.#running = snapshot.run !== undefined;
		this.#partial = undefined;
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
				return;
			case "run_end":
				this.#running = false;
				this.#emit({ type: "agent.end" });
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
				const role = (event.entry.model?.[0] as Message | undefined)?.role;
				const streamed = role === "assistant" && this.#partial !== undefined;
				const message = browserMessage(event.entry, streamed ? this.#streamId : undefined);
				if (streamed) this.#partial = undefined;
				if (message !== undefined) this.#emit({ type: "message.end", message });
				return;
			}
			case "entry_appended":
				this.#entries.push(event.entry);
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
		return this.#entries.flatMap((entry) => browserMessage(entry) ?? []);
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
		return {
			persisted: true,
			...(agent.model === undefined ? {} : { model: { provider: agent.model.provider, id: agent.model.modelId } }),
			...(agent.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
			isStreaming: this.#running,
			isCompacting: false,
			isBashRunning: false,
			pendingMessageCount: queuedMessages.length,
			queuedMessages,
			messageCount: this.messages().length,
			tokens,
			cost,
			...(paused ? { warnings: [{ severity: "info" as const, message: "Restored paused: unfinished work waits until you send a message." }] } : {}),
		};
	}

	/** Admit one input under its stable operation ID; resolves once committed. Sending resumes a paused restore. */
	async prompt(params: { operationId: string; text: string; mode?: "steer" | "followUp" }): Promise<{ submissionId: SubmissionId }> {
		if (!this.#resumed) {
			await this.#host.resume();
			this.#resumed = true;
		}
		const submissionId = await admit(this.#host.root, {
			operationId: params.operationId,
			text: params.text,
			...(params.mode === undefined ? {} : { mode: params.mode }),
		});
		return { submissionId };
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
		const first = this.#entries.find((entry) => (entry.model?.[0] as Message | undefined)?.role === "user");
		return { messageCount: this.messages().length, firstMessage: textOfContent((first?.model?.[0] as { content?: unknown } | undefined)?.content) };
	}
}

const STATUS_EVENTS = new Set<AgentEvent["type"]>(["run_start", "run_end", "inbox_update", "usage_changed", "agent_changed", "snapshot", "message_end"]);
