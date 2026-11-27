// PI WEB session-host protocol v2 for one Durable Chat: committed Durable state (the conversation view) projected into PI WEB's
// browser session events, and the operations PI WEB routes to a Durable Chat. Durable IDs, Chord operations and task
// internals stay here; PI WEB sees only its own event and message shapes.
import { OutputBuffer, sanitizeOutput } from "@earendil-works/chord/output";
import { withCancel } from "@earendil-works/chord/context";
import { type AssistantMessage, clampThinkingLevel, getSupportedThinkingLevels, type ImageContent, type Message, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
	AgentDoc,
	CompactionEntry,
	CompactionTask,
	type CompactionSettings,
	type ConversationView,
	type ConversationId,
	type EntryRecord,
	InboxDoc,
	LiveDoc,
	type LiveState,
	ResetEntry,
	type ModelRef,
	type SubmissionId,
	type TaskId,
	type ToolSlot,
	type Tx,
	UsageDoc,
} from "@earendil-works/pi-durable";
import type { ChatHost } from "./chat.ts";
import { applyModel, DEFAULT_COMPACTION, parseModel } from "./chat.ts";
import { CEILING_CUSTOM_TYPE, CEILING_ENTRY, CHECKPOINT_CUSTOM_TYPE, CHECKPOINT_ENTRY, type CheckpointData, CheckpointDoc } from "./checkpoint.ts";
import { syncWorkersGroup } from "./tool-groups.ts";
import { ACTIVITY_STATUS_KEY, COMPLETION_CUSTOM_TYPE, COMPLETION_ENTRY, DelegationDoc, finishCancellations, navigationCarries, roster, STUCK_CUSTOM_TYPE, STUCK_ENTRY, UPDATE_CUSTOM_TYPE, UPDATE_ENTRY } from "./delegation.ts";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { Admissions, admit, changeQueued, context, Edits, type EditPlan, type Host, type QueuedInput, Reconcile, resolveUncertain } from "./host.ts";
import { completePrefix, redact, sanitizeDeep, sanitizingEnv, sealed } from "./redact.ts";
import { COMMANDS, type CommandResult, NOTICE_TYPES, runCommand, storagePreflight } from "./extensions.ts";
import { type ContributedResources, PACKAGE_MESSAGE_ENTRY } from "./packages.ts";
import { FAST_COMMAND, FAST_STATUS } from "./providers.ts";
import { BUSY, commitNavigation, entries, historyOrder, historyTree, planNavigation, type TreeEntry } from "./tree.ts";
import { BACKGROUND_BASH_STATUS, BashJobsDoc, FULL_ACCESS_COMMAND } from "./background-bash.ts";
import type { SpawnResult } from "./spawn-session.ts";
import { CHAT_MESSAGE_TYPE, CHAT_PAUSED, type ChatListResult, type ChatMessageDelivery, type ChatMessageResult, type Delivery, deliveredBefore, homeWorkstream, type IncomingChatMessage, submitChatMessage, userWorkstreamStore } from "./chat-message.ts";
import { checkpointState, IDLE_COMPACTION_ENTRY, madeBy, IDLE_INSTRUCTIONS, type IdleBaseline, IdleCacheDoc, idleCompactDue, idleDelayMs, type IdleIntent, LEAD_MS, summaryModelFor, writeIdleNote } from "./idle-compact.ts";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

type WorkingModeDetailsLike = Record<string, unknown>;
/** Battery state and alarm for the AFK battery alarm (`chat` names the Chat in the alert). */
export type Power = { onBattery: () => Promise<boolean>; alarm: (chat: { id: string; label: string }) => void; everyMs: number };

/**
 * The Chat's title as PI WEB keeps it: its runtime locator `<data dir>/session-runtimes.json`, beside the `durable/`
 * folder holding the Chat's store. Undefined when PI WEB names none or the file is not there.
 * shortcut: reads PI WEB's own file (format version 1) because the host is never told the title; use the name PI WEB sends once it does.
 */
export function piWebChatTitle(store: string, chatId: string): string | undefined {
	try {
		const name: unknown = JSON.parse(readFileSync(join(dirname(dirname(resolve(store))), "session-runtimes.json"), "utf8"))?.chats?.[chatId]?.name;
		return typeof name === "string" && name.trim() !== "" ? name : undefined;
	} catch {
		return undefined;
	}
}
// Legacy Working Mode's own checks, loaded by URL as `atelier.ts` loads the kernel: tsc would check the extension's .ts as CommonJS.
const { AFK_BATTERY_WARNING, batteryAlarm, onBattery } = (await import(new URL("../../../extensions/working-mode/index.ts", import.meta.url).href)) as {
	AFK_BATTERY_WARNING: string;
	batteryAlarm: Power["alarm"];
	onBattery: Power["onBattery"];
};
import { AFK_CLOSE_PROMPT, AFK_CLOSE_TYPE, BACK_PROMPT, BACK_TYPE, backSummary, checkpointPrompt, writesCheckpoint } from "../../../extensions/working-mode/rules.mts";
import {
	AFK_CLOSE_ENTRY,
	ANSWERS_ENTRY,
	ASK_ANSWERS_CUSTOM_TYPE,
	acknowledgeAttention,
	afkActive,
	BACK_ENTRY,
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
	resetMode,
	type Resources,
	ResourcesDoc,
	selectMode,
	unalign,
	WORKING_MODE_CUSTOM_TYPE,
	type WorkbenchSignal,
	workingModeSnapshot,
} from "./workbench.ts";

/** `/back`, as the legacy Working Mode extension describes it. */
const BACK_COMMAND = { name: "back", description: "Return from AFK: clear the context down to a pointer to the latest checkpoint and the open questions, reset Working Mode, and orient" };
const CHECKPOINT_COMMAND = { name: "checkpoint", description: "Checkpoint and continue: after the current turn, the model writes the Workstream checkpoint and goes on in a fresh context ([next phase])" };

/** v2 adds Working Mode, questions and attention, models, resources, effect resolution and client operation IDs. */
export const PROTOCOL = 2;

/**
 * PI WEB's gated Chat operations (`CHAT_CAPABILITY_LABELS` in its `shared/apiTypes.ts`) this host supports, reported
 * in its ready message. PI WEB shows a control only once its name is here; add a name with the operation that
 * implements it. Protocol 2 hosts without the list support none of them. compact: `/compact` (method `compact`);
 * compact-and-continue: the model tool; tool-groups: `tools_enable`; tree: `/tree` and `navigate` (no branch summaries);
 * viewed: `setViewed` (whether a browser shows this Chat; the idle compaction timer acts only then).
 */
export const CAPABILITIES = ["queue.edit", "queue.promote", "attachments", "thinking", "shell", "compact", "compact-and-continue", "tool-groups", "tree", "liveReview", "viewed", "ask-images", "owner-run"] as const;

/** An armed idle timer: when it fires, when the cache entry expires, and the branch and request it measured. */
type IdleArm = { timer?: ReturnType<typeof setTimeout>; epoch: number; due: number; expiresAt: number; rootId: number; entryId: number };

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
	isCompacting: boolean;
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
/** Every entry of the root conversation up to `newest`, oldest first. */
async function history(root: Host["root"], newest: number): Promise<EntryRecord[]> {
	if (newest === 0) return [];
	const entries: EntryRecord[] = [];
	let cursor: Parameters<Host["root"]["entries"]>[2];
	do {
		const page = await root.entries({ order: "ascending", maxEntryId: newest as EntryRecord["id"] }, 500, cursor, context);
		entries.push(...page.items);
		cursor = page.next;
	} while (cursor !== undefined);
	return entries;
}

/**
 * The transcript a ChatSession on this store would show as it opens (`messages()`), read without starting one: no
 * package, job, Page or delivery runs (`--read-transcript`, PI WEB's history read of a Chat with no host).
 */
export async function storedMessages(host: Pick<Host, "harness" | "root">): Promise<unknown[]> {
	const observation = await host.harness.observeConversation(host.root.id, { advance: () => {}, end: () => {} }, context);
	await observation.detach();
	const view = observation.value;
	return (await history(host.root, view.entries.at(-1)?.id ?? view.before ?? 0)).flatMap((entry) => browserMessages(entry));
}

export function browserMessages(entry: EntryRecord, streamId?: string): Record<string, unknown>[] {
	if (entry.kind === BASH_ENTRY) return [bashMessage(entry)];
	const message = entry.model?.[0] as Message | undefined;
	const entryId = String(entry.id);
	const custom = (customType: string, content: string | Record<string, unknown>[], details: unknown, id = entryId) => ({ role: "custom", customType, content, display: true, details, timestamp: message?.timestamp ?? 0, entryId: id });
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
	if (entry.kind === BACK_ENTRY)
		return [...(mode === undefined ? [] : [custom(WORKING_MODE_CUSTOM_TYPE, parts[0]?.text ?? "", mode, `${entryId}:working-mode`)]), custom(BACK_TYPE, parts.at(-1)?.text ?? textOfContent(message.content), null)];
	// A plain prompt's open-questions reminder is its last block, hidden as in a legacy Chat.
	const userParts = entry.kind === PROMPT_ENTRY && (entry.data as { askReminder?: boolean } | undefined)?.askReminder === true ? parts.slice(0, -1) : parts;
	if (mode !== undefined && message.role === "user") {
		const block = custom(WORKING_MODE_CUSTOM_TYPE, parts[0]?.text ?? "", mode, entry.kind === MODE_ENTRY ? entryId : `${entryId}:working-mode`);
		return entry.kind === MODE_ENTRY ? [block] : [block, { ...message, content: userParts.slice(1), entryId }];
	}
	// `/back`'s reset handoff shows as a compaction summary does: it replaced the context the same way.
	if (entry.kind === CompactionEntry.kind || entry.kind === ResetEntry.kind) {
		// Pi's transcript shape for a compaction (PI WEB transcriptMessages.ts): the summary without Durable's framing.
		const summary = compactionSummary(message);
		return [{ role: "system", source: "compaction", content: `Compacted history:\n\n${summary}`, timestamp: message.timestamp, entryId }];
	}
	if (userParts !== parts) return [{ ...message, content: userParts, entryId }];
	if (entry.kind === ANSWERS_ENTRY) {
		// Answers with images keep them after the text, so PI WEB's record can show them; without, the text alone as before.
		const images = parts.filter((part) => part.type === "image") as unknown as Record<string, unknown>[];
		const text = images.length === 0 ? textOfContent(message.content) : textOfContent(parts.filter((part) => part.type === "text"));
		return [custom(ASK_ANSWERS_CUSTOM_TYPE, images.length === 0 ? text : [{ type: "text", text }, ...images], entry.data ?? null)];
	}
	if (entry.kind === RECONCILE_ENTRY) return [custom(RECONCILE_ENTRY, textOfContent(message.content), entry.data ?? null)];
	if (entry.kind === AFK_CLOSE_ENTRY) return [custom(AFK_CLOSE_TYPE, textOfContent(message.content), null)];
	// Delegation: the coalesced completion wake and a requested child update, as the legacy extension's custom messages.
	if (entry.kind === COMPLETION_ENTRY) return [custom(COMPLETION_CUSTOM_TYPE, textOfContent(message.content), entry.data ?? null)];
	if (entry.kind === UPDATE_ENTRY) return [custom(UPDATE_CUSTOM_TYPE, textOfContent(message.content), entry.data ?? null)];
	if (entry.kind === STUCK_ENTRY) return [custom(STUCK_CUSTOM_TYPE, textOfContent(message.content), entry.data ?? null)];
	if (entry.kind === CEILING_ENTRY) return [custom(CEILING_CUSTOM_TYPE, textOfContent(message.content), entry.data ?? null)];
	const notice = NOTICE_TYPES[entry.kind];
	if (notice !== undefined) return [custom(notice, textOfContent(message.content), entry.data ?? null)];
	if (entry.kind === PACKAGE_MESSAGE_ENTRY) {
		// A Pi package's sendMessage, shown as legacy Chats show a custom message: only when it asked to be displayed.
		const data = entry.data as { customType: string; display: boolean; details?: unknown };
		return data.display ? [custom(data.customType, textOfContent(message.content), data.details ?? null)] : [];
	}
	const content = message.role === "toolResult" ? { content: browserToolContent(message.content) } : {};
	return [{ ...message, ...content, entryId, ...(streamId === undefined ? {} : { streamId }) }];
}

/** A compaction entry's summary without Durable's framing. */
function compactionSummary(message: Message): string {
	return /<summary>\n([\s\S]*)\n<\/summary>$/.exec(textOfContent(message.content))?.[1] ?? textOfContent(message.content);
}

function bashMessage(entry: EntryRecord): Record<string, unknown> {
	return { role: "bashExecution", ...(entry.data as BashRecord), entryId: String(entry.id) };
}

/** Another Chat's queued message (`submitChatMessage`), by its entry. */
function chatMessageEntry(entry: unknown): { fromKey?: string; fromChatId?: string } | undefined {
	const { kind, data } = (entry ?? {}) as { kind?: string; data?: { customType?: string; details?: { fromKey?: string; fromChatId?: string } } };
	return kind === PACKAGE_MESSAGE_ENTRY && data?.customType === CHAT_MESSAGE_TYPE ? (data.details ?? {}) : undefined;
}

/**
 * A queued input the owner sent (a prompt, with or without its Working Mode block) or another Chat's message (the owner
 * may remove or promote it), not a notice from background bash, a child, a Page or a package: those wake the Chat but
 * stay out of the queue the composer shows and edits, as legacy Pi keeps custom messages out of its queue. The queue
 * view and its edits use this one rule, so indices agree.
 */
function ownerQueued<T extends { mode: string; entry?: unknown }>(item: T): item is T & { mode: "steer" | "followUp" } {
	if (item.mode === "write") return false;
	const kind = (item.entry as { kind?: string } | undefined)?.kind;
	return kind === undefined || kind === PROMPT_ENTRY || kind === MODE_ENTRY || chatMessageEntry(item.entry) !== undefined;
}

/** A queued input as the composer's queue shows it: the user's text (after a Working Mode block), and its images. */
function queuedMessage(item: { id: number; mode: "steer" | "followUp"; content: unknown; entry?: unknown }): QueuedMessage {
	const chat = chatMessageEntry(item.entry);
	// Another Chat's message: its text after the label's two lines, under a short sender prefix.
	if (chat !== undefined) return { id: item.id, kind: item.mode, text: `From ${chat.fromKey ?? chat.fromChatId ?? "another chat"}: ${textOfContent(item.content).split("\n").slice(2).join("\n")}` };
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
	/** Running bash calls of the current round (activity), from committed tool events. */
	#shells = new Map<string, string>();
	#stop: (() => Promise<unknown>) | undefined;
	#unsubscribe: (() => void) | undefined;
	/** False until the first input after open: a reopened store stays paused until Thomas sends something. */
	#resumed = false;
	/** The running `!` command: one at a time, as in a legacy Chat. */
	#shell: { cancel: () => void } | undefined;
	/** `!` records finished during a run: committed when it ends, so they never land between a tool call and its result. */
	#heldShell: BashRecord[] = [];
	/** Tree navigation in progress, and operations in flight that it must not overlap (legacy tree-exclusive gate). */
	#navigating = false;
	#inFlight = 0;
	/** B's close is deciding or under way: no input is admitted (see `quiesce`). */
	#quiescing = false;
	/** Deliveries (bash completions, Atelier input, package messages) waiting for a paused restore to be resumed, or for navigation to end. */
	#deliveries: (() => void)[] = [];
	#afterNavigation: (() => void)[] = [];
	/** Deliveries held while B's close decides: let through only if it is refused (`#admit`). */
	#afterQuiesce: (() => void)[] = [];

	/** The AFK battery alarm: shared Working Mode checks by default; tests inject theirs. */
	readonly #power: Power;
	#powerTimer: ReturnType<typeof setInterval> | undefined;
	#warnedOnBattery = false;
	#closed = false;
	#cwd = "";
	/**
	 * AFK closing nudge (legacy Working Mode): a tool call ran since the last `workstreams checkpoint`, outside a nudge's
	 * own run (`#nudgeRun`; the nudge is sent while quiet, so the next run to start is its own).
	 * shortcut: in memory, so a host restart forgets unsaved work; scan the entries if that loses a checkpoint in practice.
	 */
	#unsaved = false;
	#nudgeSent = false;
	#nudgeRun = false;

	/** A browser shows this Chat (`setViewed`); not viewed until PI WEB says so. */
	#viewed = false;
	/**
	 * Idle prompt-cache timer, armed when a run ends; whether it compacted in this idle stretch; the epoch every cancel
	 * bumps, so a callback already under way sees it was cancelled; and the cheap summary in flight, aborted on cancel.
	 */
	#idle: IdleArm | undefined;
	#idleEpoch = 0;
	#idleCompacted = false;
	#idleAbort: AbortController | undefined;
	#idleTask: number | undefined;
	/** The timer task whose summary hook ran, and whether an empty timer compaction was reported (once per session). */
	#idleHookRan: number | undefined;
	#idleEmptyWarned = false;
	#idleUnavailable = new Set<string>();
	/** A fired timer found only a `!` command in the way: retried when it ends, while the cache entry lives. */
	#idleRetry: IdleArm | undefined;
	readonly #idleDelayMs: typeof idleDelayMs;
	readonly #now: () => number;
	readonly #idleNotes: string | undefined;

	/** The Chat's title for the AFK alarm, read when it sounds (a rename shows on the next one). */
	readonly #title: () => string | undefined;

	/** `idleDelayMs`, `now`, `idleNotes`: tests inject a short idle timer delay, its wall clock, and the idle notes' scratch root. */
	constructor(host: Host | ChatHost, emit: (event: UiEvent) => void, options: { chatId?: string; telemetry?: Recorder; power?: Partial<Power>; title?: () => string | undefined; idleDelayMs?: typeof idleDelayMs; now?: () => number; idleNotes?: string } = {}) {
		this.#host = host;
		this.#chat = "workbench" in host ? host : undefined;
		this.#emit = emit;
		this.#chatId = options.chatId ?? "durable";
		this.#telemetry = options.telemetry;
		this.#power = { onBattery, alarm: batteryAlarm, everyMs: 60_000, ...options.power };
		this.#title = options.title ?? (() => undefined);
		this.#idleDelayMs = options.idleDelayMs ?? idleDelayMs;
		this.#now = options.now ?? Date.now;
		this.#idleNotes = options.idleNotes;
		const idle = this.#chat?.idle;
		if (idle !== undefined) {
			idle.blocked = (conversationId, task) => ((this.#idleHookRan = task), conversationId !== Number(this.#host.root.id) || this.#idleAbort === undefined || this.#idleAbort.signal.aborted || this.#idleTask !== task ? "cancelled" : this.#idleBlocked());
			idle.signal = () => this.#idleAbort?.signal;
			idle.warn = (message) => this.#idleWarning(message);
			idle.usage = (answer) => this.#record("usage", {
				usageKey: `${this.#chatId}:auxiliary:${crypto.randomUUID()}`, usage: answer.usage, kind: "auxiliary", purpose: "idle-compaction",
				provider: answer.provider ?? null, model: answer.model ?? null, stopReason: answer.stopReason ?? null, entryId: null,
			});
		}
	}

	async start(): Promise<void> {
		if (this.#chat !== undefined) {
			this.#chat.workbench.onSignal = (signal) => void this.#signal(signal);
			this.#chat.spawner?.attach((event) => this.#emit(event));
			this.#chat.messenger?.attach((event) => this.#emit(event));
			await this.#host.harness.commit((tx) => this.#syncSpawnTool(tx), context);
			this.#chat.workbench.record = (type, data) => {
				this.#record(type, data);
				// A child is its own telemetry session, as a legacy child Pi process is: its start names the lead as its parent,
				// so the lead's report includes the child's usage (recorded under childSessionId).
				if (type === "execution.launched" && typeof data?.childSessionId === "string")
					this.#record("session.start", {
						sessionId: data.childSessionId, sessionFile: null, cwd: null, mode: "durable", reason: "startup",
						provider: data.provider ?? null, model: data.model ?? null, effort: data.effort ?? null,
						argv: null, parentSessionId: this.#chatId, executionId: data.executionId ?? null, ownerEpoch: this.#host.store.owner.epoch,
					});
			};
		}
		// The delegate roster changes with this Chat's children (launch, status report, result, collection).
		// Filtered on the active branch at commit time, so it follows navigation without resubscribing.
		let rosterQueued = false;
		const commits = this.#host.harness.observeCommits({
			advance: (publication) => {
				const changed = publication.changes.some((change) => change.type === "document" && change.record.kind === DelegationDoc.definition.kind && change.conversationId === this.#host.root.id);
				if (!changed || rosterQueued) return;
				rosterQueued = true;
				setTimeout(() => {
					rosterQueued = false;
					void this.#publishStatus().catch(() => {});
				}, 0);
			},
			end: () => {},
		});
		this.#unsubscribe = () => commits.detach();
		this.#chat?.listenPackages((event) => (event.type === "extension.status" ? void this.#publishStatus().catch(() => {}) : this.#emit(event)));
		await this.#watch();
		const lead = () => this.#host.root;
		const deliver = <T>(work: () => Promise<T>) => this.#deliver(work);
		this.#chat?.bash?.start(lead, this.#host.harness, { deliver, changed: () => void this.#publishStatus().catch(() => {}) });
		await this.#chat?.atelier?.start(lead, this.#host.harness, { deliver });
		this.#chat?.packages?.attach({ deliver });
		const agent = await this.#host.root.agent(context);
		this.#cwd = agent.cwd ?? "";
		this.#record("session.start", {
			sessionFile: null, cwd: agent.cwd ?? null, mode: "durable", reason: "open",
			provider: agent.model?.provider ?? null, model: agent.model?.modelId ?? null, effort: agent.thinkingLevel ?? null,
			argv: null, parentSessionId: null, executionId: null, ownerEpoch: this.#host.store.owner.epoch,
		});
		// A timer compaction a kill interrupted: its note is finished from the placed summary, never summarized again.
		const intent = this.#chat === undefined ? undefined : (await this.#host.harness.snapshot(IdleCacheDoc, this.#host.root.id, context))?.intent;
		if (intent != null) void this.#finishIdle(intent).catch((error: unknown) => this.#idleNoteFailed(error));
		// A restart or upgrade keeps the idle timer: measured from the newest request, skipped once its cache expired.
		else if (!this.#running) await this.#armIdle();
	}

	/**
	 * Project the active branch's view, from its current value on: each revision (one per commit, as memory adopts it)
	 * becomes the events it implies, handled in order after the reset to the first value.
	 */
	async #watch(): Promise<void> {
		let last: ConversationView | undefined;
		const early: ConversationView[] = [];
		let queue = Promise.resolve();
		const handle = (events: ViewEvent[]) => {
			queue = queue.then(async () => {
				for (const event of events) this.#apply(event);
				if (events.some((event) => STATUS_EVENTS.has(event.type))) this.#emit({ type: "status.update", status: await this.status() });
			}).catch((error: unknown) => this.#emit({ type: "session.diagnostic", message: `Durable view failed: ${error instanceof Error ? error.message : String(error)}` }));
		};
		const advance = (next: ConversationView) => {
			if (last === undefined) return void early.push(next);
			const events = viewEvents(last, next);
			last = next;
			if (events.length > 0) handle(events);
		};
		// The observer must only record: no awaits or Session calls. A revision can arrive before the attachment resolves.
		const observation = await this.#host.harness.observeConversation(this.#host.root.id, { advance: (call) => call.kind === "value" && advance(call.value), end: () => {} }, context);
		last = observation.value;
		queue = this.#reset(observation.value);
		for (const next of early.splice(0)) advance(next);
		await queue;
		this.#stop = async () => observation.detach();
	}

	/**
	 * `end`: the owner ends the Chat, so its background jobs are cancelled first; any other close (a restart) keeps them.
	 * `reason: "upgrade"`: PI WEB's Upgrade now closes the host to start its family on new code (telemetry `upgrade-restart`);
	 * its answer says whether full access was on, which PI WEB hands back in the new host's `resume`.
	 */
	async close(options: { end?: boolean; reason?: "upgrade" } = {}): Promise<{ fullAccess?: true }> {
		if (options.end === true) await this.#chat?.bash?.cancelAll();
		this.#closed = true;
		this.#cancelIdle();
		this.#stopPower();
		this.#chat?.bash?.close();
		this.#chat?.atelier?.close();
		await this.#chat?.packages?.close();
		this.#unsubscribe?.();
		await this.#stop?.();
		await this.#host.close();
		this.#record("session.shutdown", { sessionFile: null, reason: options.reason === "upgrade" ? "upgrade-restart" : "close" });
		this.#telemetry?.close();
		return options.reason === "upgrade" && this.#chat?.bash?.carryFullAccess() === true ? { fullAccess: true } : {};
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
	 * Legacy Working Mode's AFK battery alarm: once AFK has started and a turn runs under it (`arm`), every minute on
	 * battery while work runs (`#working`) the alarm names this Chat, plus one error notification per unplug. Leaving AFK or closing the host stops
	 * it; a restored idle Chat with an old AFK selection stays quiet until a turn runs.
	 */
	async #watchPower(arm: boolean): Promise<void> {
		if (this.#chat === undefined || this.#closed) return;
		const afk = await afkActive(this.#host.harness, this.#host.root).catch(() => false);
		if (!afk || this.#closed) return this.#stopPower();
		if (this.#powerTimer !== undefined || !arm) return;
		// As legacy alarmSession: the Chat's title and its folder, or the folder alone.
		const folder = basename(this.#cwd) || this.#chatId;
		const chat = () => { const title = this.#title(); return { id: this.#chatId, label: title === undefined ? folder : `${title} (${folder})` }; };
		const check = async () => {
			try {
				const battery = (await this.#power.onBattery()) && !this.#closed && (await afkActive(this.#host.harness, this.#host.root)) && (await this.#working());
				if (battery) this.#power.alarm(chat());
				if (battery && !this.#warnedOnBattery) this.#emit({ type: "durable.notification", severity: "error", message: AFK_BATTERY_WARNING });
				this.#warnedOnBattery = battery;
			} catch {
				this.#stopPower(); // the store is gone
			}
		};
		this.#powerTimer = setInterval(() => void check(), this.#power.everyMs);
		this.#powerTimer.unref?.();
		void check();
	}

	/**
	 * Whether work runs that sleep would cut short, as PI WEB's `familyBusy` minus an open question (waiting for the owner
	 * is not work): a turn, compaction or `!` command, queued input, a running tool, a running child, background bash or
	 * a watcher. An unparseable status line counts as work.
	 */
	async #working(): Promise<boolean> {
		const status = await this.status();
		if (status.isStreaming || status.isCompacting || status.isBashRunning || status.pendingMessageCount > 0 || (status.activeToolExecutions?.length ?? 0) > 0) return true;
		const list = (key: string, field: string): unknown[] => {
			const text = status.extensionStatuses?.[key];
			if (text === undefined) return [];
			try {
				const items: unknown = (JSON.parse(text) as Record<string, unknown> | null)?.[field];
				return Array.isArray(items) ? items : [undefined];
			} catch {
				return [undefined];
			}
		};
		return list(ACTIVITY_STATUS_KEY, "items").some((item) => (item as { endedAt?: unknown } | undefined)?.endedAt === undefined)
			|| list(BACKGROUND_BASH_STATUS, "jobs").length > 0 || list("pi-process-monitor:watchers", "watchers").length > 0;
	}

	#stopPower(): void {
		clearInterval(this.#powerTimer);
		this.#powerTimer = undefined;
		this.#warnedOnBattery = false;
	}

	/**
	 * The snapshot's state, with the whole history up to its newest entry: the snapshot holds only the active context,
	 * which after a compaction starts at the summary, while PI WEB shows every message as a legacy Chat does.
	 */
	async #reset(view: ConversationView): Promise<void> {
		const live = liveOf(view);
		this.#entries = await this.#history(view.entries.at(-1)?.id ?? view.before ?? 0);
		this.#running = live.run !== undefined;
		this.#partial = undefined;
		this.#shells.clear();
		// A restored store stays paused: its running slots are interrupted, not running, until work resumes.
		if (this.#resumed) for (const slot of live.tools ?? []) if (slot.name === "bash" && slot.status === "running") this.#shells.set(slot.callId, new Date().toISOString());
		this.#emitted = [];
		const partial = live.generation?.message as AssistantMessage | undefined;
		// A paused restore's partial was cut off by the host's death: shown as aborted, as resuming commits it.
		if (partial !== undefined) this.#startPartial(this.#resumed ? partial : { ...partial, stopReason: "aborted", errorMessage: INTERRUPTED });
	}

	#history(newest: number): Promise<EntryRecord[]> {
		return history(this.#host.root, newest);
	}

	#startPartial(partial: AssistantMessage): void {
		this.#partial = partial;
		this.#streamId = `durable-${String(++this.#streams)}`;
		this.#emitted = partial.content.map((block) => blockText(block)?.text ?? "");
	}

	#apply(event: ViewEvent): void {
		switch (event.type) {
			case "run_start":
				this.#running = true;
				// A new turn: a new idle stretch once it ends.
				this.#cancelIdle();
				this.#idleCompacted = false;
				this.#nudgeRun = this.#nudgeSent;
				this.#nudgeSent = false;
				this.#emit({ type: "agent.start" });
				this.#record("agent.start", { sessionFile: null });
				// Agent turns since an open set was posted drive the browser's "may be stale" mark.
				void countTurn(this.#host.root).catch(() => {});
				void this.#watchPower(true);
				void this.#chat?.packages?.run("start");
				return;
			case "run_end":
				this.#running = false;
				this.#shells.clear();
				void this.#flushShell();
				this.#emit({ type: "agent.end" });
				this.#record("agent.settled", { sessionFile: null });
				void this.#chat?.packages?.run("end");
				void this.#afkClose().catch(() => {});
				void this.#armIdle().catch(() => {});
				return;
			case "message_start":
				if (event.message.role !== "assistant") return;
				this.#startPartial(event.message);
				this.#emit({ type: "assistant.start", message: { ...event.message, streamId: this.#streamId } });
				return;
			case "message_update":
				this.#update(event.message);
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
				// Passive entries the browser shows (Workbench notices, a cancelled checkpoint); bookkeeping entries project to
				// nothing. A `!` record was shown live by its shell events.
				if (event.entry.kind !== BASH_ENTRY) for (const message of browserMessages(event.entry)) this.#emit({ type: "message.end", message });
				return;
			case "tool_execution_start":
				if (event.toolName === "bash") this.#shells.set(event.toolCallId, new Date().toISOString());
				if (!this.#nudgeRun) this.#unsaved = !writesCheckpoint(event.args);
				this.#emit({ type: "tool.start", toolName: event.toolName, toolCallId: event.toolCallId, summary: "", args: event.args });
				return;
			case "tool_execution_update":
				this.#emit({ type: "tool.update", toolName: event.toolName, toolCallId: event.toolCallId, text: event.text, ...(event.details === undefined ? {} : { details: event.details }) });
				return;
			case "tool_execution_end": {
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
			case "compaction_end":
				// A manual compaction reports through `compact()`; an automatic one that failed is reported here, as Pi does.
				if (event.error !== undefined && event.trigger !== "manual") this.#compactionFailed(event.error);
				return;
			case "task_failed":
				this.#emit({ type: "session.diagnostic", message: `Durable task ${event.kind} failed: ${event.message}` });
				return;
			default:
				return;
		}
	}

	#update(message: AssistantMessage): void {
		if (this.#partial === undefined) return;
		this.#partial = message;
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
		const queuedMessages = runOrder((inbox?.items ?? []).filter(ownerQueued).map(queuedMessage));
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
		const paused = this.#paused();
		const contextWindow = agent.model === undefined ? undefined : this.#host.models.getModel(agent.model.provider, agent.model.modelId)?.contextWindow;
		const contextTokens = this.#contextTokens();
		const live = await harness.snapshot(LiveDoc, root.id, context);
		const warnings = paused
			? [{ severity: "info" as const, message: `Restored paused: unfinished work waits until you send a message.${this.#partial === undefined ? "" : ` ${INTERRUPTED}`}` }]
			: [];
		const [mode, questions, reconcile, delegates] = await Promise.all([workingModeSnapshot(harness, root), questionsState(harness, root), harness.snapshot(Reconcile, context), roster(harness, root.id, context)]);
		const pendingAsks = Object.values(questions.open).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
		const unresolvedEffects = Object.entries(reconcile?.uncertain ?? {})
			.filter(([, item]) => item.resolved === undefined && item.conversationId === root.id)
			.map(([id, item]) => {
				// A browser copy of verbatim arguments: sanitized before the cut, which would leave a fragment no redactor knows.
				const args = redact(item.arguments);
				return { id, toolName: item.tool, arguments: args.length > 300 ? `${args.slice(0, 300)}…` : args };
			});
		return {
			persisted: true,
			...(agent.model === undefined ? {} : { model: { provider: agent.model.provider, id: agent.model.modelId } }),
			...(agent.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
			isStreaming: this.#running,
			isCompacting: (live?.compactions?.length ?? 0) > 0,
			isBashRunning: this.#shell !== undefined,
			pendingMessageCount: queuedMessages.length,
			queuedMessages,
			messageCount: this.messages().length,
			tokens,
			cost,
			...(warnings.length === 0 ? {} : { warnings }),
			extensionStatuses: {
				// Package status lines first: a key the host owns (Working Mode, Activity, fast, bash) stays the host's.
				...this.#chat?.packages?.statuses(),
				[WORKING_MODE_CUSTOM_TYPE]: JSON.stringify(mode),
				...(delegates === undefined ? {} : { [ACTIVITY_STATUS_KEY]: delegates }),
				...(this.#chat?.fast.active(agent.model && { provider: agent.model.provider, id: agent.model.modelId }) ? { [FAST_STATUS]: "fast" } : {}),
				...(await this.#chat?.bash?.status()),
				...this.#chat?.atelier?.status(),
			},
			...(pendingAsks.length === 0 ? {} : { pendingAsks, pendingAsk: pendingAsks[0] }),
			...(questions.attention === null ? {} : { attentionRequest: questions.attention }),
			...(unresolvedEffects.length === 0 ? {} : { unresolvedEffects }),
			...(this.#shells.size === 0 ? {} : { activeToolExecutions: [...this.#shells].map(([callId, startedAt]) => ({ id: `tool:${callId}`, kind: "shell" as const, toolName: "bash", label: "Shell command", startedAt })) }),
			...(contextWindow === undefined || contextWindow <= 0
				? {}
				: { contextUsage: { tokens: contextTokens, contextWindow, percent: contextTokens === null ? null : (contextTokens / contextWindow) * 100 } }),
		};
	}

	/** Resources the bound packages contributed (`resources_discover`), for PI WEB to load with the Chat's others. */
	resources(): ContributedResources {
		return this.#chat?.packages?.resources() ?? { skillPaths: [], promptPaths: [], themePaths: [] };
	}

	/** The Chat's slash commands: the host's own (`/quota-check`, `/fast`, `/back`), then the bound Pi packages'. */
	commands(): { name: string; description?: string }[] {
		return [...COMMANDS, ...(this.#chat === undefined ? [] : [FAST_COMMAND, BACK_COMMAND, CHECKPOINT_COMMAND]), ...(this.#chat?.bash === undefined ? [] : [FULL_ACCESS_COMMAND]), ...(this.#chat?.packages?.commands() ?? [])];
	}

	/**
	 * Run one of the Chat's commands. A host command runs outside the store (nothing committed or resumed); a package
	 * command is refused visibly when blocked, unknown or in need of a dialog; any other is not available.
	 */
	async command(name: string, args: string, operationId: string = crypto.randomUUID()): Promise<CommandResult | { type: "unsupported"; message: string }> {
		if (COMMANDS.some((command) => command.name === name)) return runCommand(name, args);
		if (name === FAST_COMMAND.name) return this.#fast(args);
		if (name === BACK_COMMAND.name && this.#chat !== undefined) return this.#back(operationId);
		// A follow-up: queued behind a running turn, at once when idle.
		if (name === CHECKPOINT_COMMAND.name && this.#chat !== undefined) return this.prompt({ operationId: `checkpoint:${operationId}`, text: checkpointPrompt(args.trim()), mode: "followUp" }).then(() => ({ type: "done" as const }));
		if (name === FULL_ACCESS_COMMAND.name && this.#chat?.bash !== undefined) {
			const result = await this.#chat.bash.fullAccess(args, `"${this.#title() ?? this.#chatId ?? "untitled"}" in ${this.#cwd}`);
			await this.#publishStatus();
			return result;
		}
		const packages = this.#chat?.packages;
		if (packages === undefined) return { type: "unsupported", message: `/${name} is not available in Durable Chats yet` };
		const result = await packages.command(args === "" ? `/${name}` : `/${name} ${args}`);
		await this.#publishStatus();
		return result;
	}

	/** PI WEB's Run button: the owner's confirmed command as an unfenced background job of the lead (background-bash.ts). */
	async ownerRun(request: { operationId: string; command: string; cwd: string }): Promise<{ jobId: string; logPath: string }> {
		if (this.#chat?.bash === undefined) throw new Error("Run buttons need the Chat's background jobs");
		const started = await this.#chat.bash.ownerRun(request);
		await this.#publishStatus();
		return started;
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

	/**
	 * A restore with unfinished work the owner has not resumed (plan decision 2): only a send, an answer or a resolution
	 * resumes it. Stop, queue edits and a finished `!` command act without `Conversation.submit`/`abort`, which enable
	 * scheduling for the whole family.
	 */
	#paused(): boolean {
		return !this.#resumed && this.#host.harness.wake().active;
	}

	/**
	 * B's close (PI WEB's automatic upgrade), decided here so no input slips in after the daemon's own check: from now on
	 * no input is admitted, then why the Chat may not restart, if anything: input in flight, a running turn, compaction
	 * or `!` command, queued input, a running tool or a running child. Work that survives a restart (open questions,
	 * background bash, watchers, Atelier Pages) does not count. Undefined: the caller closes at once; otherwise (or when
	 * the check fails) input is admitted again.
	 */
	async quiesce(): Promise<string | undefined> {
		if (this.#navigating) return "session tree navigation is running";
		this.#quiescing = true;
		try {
			const busy = this.#inFlight > 0 ? "input is arriving" : await this.#restartBusy();
			if (busy !== undefined) this.#admit();
			return busy;
		} catch (error) {
			this.#admit();
			throw error;
		}
	}

	/** B's close was refused: input is admitted again, the deliveries it held first. */
	#admit(): void {
		this.#quiescing = false;
		for (const deliver of this.#afterQuiesce.splice(0)) deliver();
	}

	async #restartBusy(): Promise<string | undefined> {
		const status = await this.status();
		if (status.isStreaming || status.isCompacting || status.isBashRunning) return "a turn is running";
		if (status.pendingMessageCount > 0) return "input is queued";
		if ((status.activeToolExecutions?.length ?? 0) > 0) return "a tool is running";
		const delegation = await this.#host.harness.snapshot(DelegationDoc, this.#host.root.id, context);
		if (Object.values(delegation?.executions ?? {}).some((e) => e.outcome === "running")) return "children are running";
		return undefined;
	}

	/**
	 * Resume a restore without a new input: the host started by PI WEB's Upgrade now. Restored work runs as after any
	 * restart (an interrupted answer is requested again, safe tools rerun, unsafe ones stay held for the owner).
	 */
	async resume(reason: "upgrade-restart", fullAccess = false): Promise<void> {
		// Before any restored work runs: the old host's full access (its close answer), from PI WEB only, and never once
		// something else already resumed this host.
		if (!this.#resumed) this.#chat?.bash?.carryFullAccess(fullAccess);
		await this.#resume();
		this.#record("session.restart", { reason, ownerEpoch: this.#host.store.owner.epoch });
		await this.#publishStatus();
	}

	async #resume(): Promise<void> {
		if (this.#resumed) return;
		await this.#host.resume();
		// A Stop while paused (here or before a restart) only marked the lead's tasks: their abort lands first, as an aborted
		// run places nothing, so the input that resumes would otherwise wait behind it for good.
		const { harness, root } = this.#host;
		for (const { record } of (await harness.inspect(context)).tasks)
			if (stopReaches(record, root.id) && record.abortRequested && record.abortReason === undefined) await harness.waitForTask(record.id, context);
		this.#resumed = true;
		// Cancellations a restart interrupted stay cancelled: finish them now that work runs again.
		void finishCancellations(this.#host.harness, this.#host.root.id).then(() => this.#publishStatus(), () => {});
		for (const deliver of this.#deliveries.splice(0)) deliver();
	}

	/**
	 * Resolves once a host-side delivery (a bash completion, Atelier input, a package message) may submit: at once in a running or
	 * idle Chat; a restore with interrupted work stays paused until the user resumes it, so a delivery never resumes
	 * that work by itself. Checkpoint barrier, as for child completions: during `compact_and_continue` it waits until
	 * the continuation is admitted, so the delivery's follow-up queues behind it (legacy checkpoint-barrier).
	 */
	async #deliverable(): Promise<void> {
		if (this.#paused()) await new Promise<void>((resolve) => this.#deliveries.push(resolve));
		else await this.#resume();
		const { harness } = this.#host;
		for (;;) {
			const active = (await harness.snapshot(CheckpointDoc, this.#host.root.id, context))?.active;
			if (active === null || active === undefined) return;
			await harness.waitForTask(active.task as TaskId, context);
		}
	}

	/**
	 * Run one host-side delivery once it may submit (`#deliverable`), never during history navigation (which carries an
	 * undelivered one to the new branch) nor once B's close is deciding (`quiesce`; a close it accepts leaves the delivery
	 * to the next host, as any close does), and counted, so navigation and the quiet check refuse while it runs.
	 */
	async #deliver<T>(work: () => Promise<T>): Promise<T> {
		for (;;) {
			if (this.#quiescing) await new Promise<void>((resolve) => this.#afterQuiesce.push(resolve));
			await this.#deliverable();
			// Checked with the count below, without an await between: the quiet check sees either this delivery or none.
			if (this.#quiescing) continue;
			if (!this.#navigating) break;
			await new Promise<void>((resolve) => this.#afterNavigation.push(resolve));
		}
		this.#inFlight += 1;
		try {
			return await work();
		} finally {
			this.#inFlight -= 1;
		}
	}

	/**
	 * Admit one input under its stable operation ID; resolves once committed. Sending resumes a paused restore, answers
	 * an attention request, and carries a pending Working Mode block before the user's text (one input, one turn).
	 */
	async prompt(params: { operationId: string; text: string; mode?: "steer" | "followUp"; images?: ImageContent[]; attachments?: Attachment[] }): Promise<{ submissionId: SubmissionId; fresh: boolean }> {
		await this.#resume();
		const { root } = this.#host;
		const existing = await root.commit((tx) => tx.submissionByRequest(root.id, params.operationId), context);
		// shortcut: `fresh` is read before admission, so two overlapping calls with one operation ID may both say fresh and reset PI WEB's hop twice; read it from the admission if loops slip through.
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
		// Admitted: a new turn follows, so this idle stretch is over (a refused input or a replayed operation leaves the timer armed).
		if (existing === undefined) this.#cancelIdle();
		if (existing === undefined) this.#record("prompt", { entryId: null, prompt: null, submissionId: String(submissionId) });
		if (this.#chat !== undefined && (await acknowledgeAttention(root, undefined))) await this.#publishStatus();
		else if (block !== undefined) await this.#publishStatus();
		// `fresh`: this call admitted a new input (PI WEB restarts the reply chain only then), not a replayed operation.
		return { submissionId, fresh: existing === undefined };
	}

	/**
	 * `/mode …`: select an axis value for the next prompt, `/mode send` to deliver the pending block now, or `/mode unalign`
	 * to clear the confirmed alignment and tell the model at once.
	 */
	async mode(args: string): Promise<{ type: "done"; message?: string } | { type: "unsupported"; message: string }> {
		const { harness, root } = this.#host;
		const verb = args.trim().toLowerCase();
		if (verb === "send" || verb === "unalign") {
			await this.#resume();
			if (verb === "unalign") await unalign(root);
			const block = await pendingBlock(harness, root, true, verb === "unalign");
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
		if (result.ok && this.#chat !== undefined) await syncWorkersGroup(harness, this.#host.registry, root, this.#chat.workbench.extensions);
		await this.#watchPower(false);
		await this.#publishStatus();
		return result.ok ? { type: "done" } : { type: "unsupported", message: result.message };
	}

	/** Close an open question set with PI WEB's validated outcome; the answers reach the model once, as a follow-up. */
	async closeAsk(request: CloseAsk): Promise<Awaited<ReturnType<typeof closeAsk>>> {
		await this.#resume();
		const { harness, root } = this.#host;
		// A final close of a set with no recorded order (posted before the host kept one, or open in a fork) reads it from history.
		const known = (request.outcome as { partial?: unknown }).partial === true || (await questionsState(harness, root)).order?.[request.askId] !== undefined;
		const result = await closeAsk(root, request, known ? undefined : historyOrder(await entries(root), request.askId));
		// A partial send keeps the set open under a new revision: browsers replace its card, as on an update.
		if (result.result === "closed" && !result.retried) this.#emit(result.ask === undefined ? { type: "ask.closed", askId: request.askId, reason: result.outcome.reason } : { type: "ask.opened", ask: result.ask });
		await this.#publishStatus();
		return result;
	}

	async acknowledgeAttention(id: string): Promise<boolean> {
		const cleared = await acknowledgeAttention(this.#host.root, id);
		if (cleared) await this.#publishStatus();
		return cleared;
	}

	/** Models this Chat can switch to: those of every provider with a stored login (Pi's `getAvailable`), and faux when offered. */
	async models(): Promise<{ provider: string; id: string; name: string; contextWindow?: number; reasoning?: unknown }[]> {
		return (await this.#host.models.getAvailable()).map((model) => ({ provider: model.provider, id: model.id, name: model.name, contextWindow: model.contextWindow, reasoning: model.reasoning }));
	}

	/**
	 * Store the Chat's model; the next model request uses it. As Pi's `setModel`: a provider without a stored login is
	 * refused, and the Chat's thinking level is clamped to what the new model supports.
	 */
	async setModel(provider: string, modelId: string): Promise<void> {
		const found = this.#host.models.getModel(provider, modelId);
		if (found === undefined) throw new Error(`Unknown model ${provider}/${modelId}`);
		if ((await this.#host.models.checkAuth(provider)) === undefined) throw new Error(`No stored login for ${provider}: log in with Pi (/login) first`);
		const model = parseModel(`${provider}/${modelId}`);
		const before = (await this.#host.root.agent(context)).model;
		const thinkingLevel = await applyModel(this.#host, model);
		// A timer summary admitted for the previous model would go to its provider: cancelled with its intent. Reselecting the same model keeps it.
		if (before?.provider !== model.provider || before.modelId !== model.modelId) this.#cancelIdle();
		this.#record("model.select", { provider, model: modelId, effort: thinkingLevel ?? null, source: "set" });
		await this.#publishStatus();
	}

	/**
	 * One request outside the conversation (PI WEB's Chat title): the Chat's model, or the one named, through the same
	 * providers, logins and redaction as its turns. Nothing is committed or scheduled; returns the answer's text.
	 */
	async complete(request: { systemPrompt: string; prompt: string; maxTokens?: number; reasoning?: ModelThinkingLevel; timeoutMs?: number; model?: { provider: string; modelId: string } }): Promise<string> {
		const ref = request.model ?? (await this.#host.root.agent(context)).model;
		const model = ref === undefined ? undefined : this.#host.models.getModel(ref.provider, ref.modelId);
		if (model === undefined) throw new Error(`Unknown model ${ref === undefined ? "(none)" : `${ref.provider}/${ref.modelId}`}`);
		const answer = await this.#host.models.completeSimple(
			model,
			{ systemPrompt: request.systemPrompt, messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }] },
			{
				...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
				...(request.reasoning === undefined || request.reasoning === "off" ? {} : { reasoning: request.reasoning }),
				signal: AbortSignal.timeout(request.timeoutMs ?? 10_000),
			},
		);
		// A provider request no entry records, failed or not: its own usage record, marked auxiliary, counted once.
		this.#record("usage", {
			usageKey: `${this.#chatId}:auxiliary:${crypto.randomUUID()}`, usage: answer.usage, kind: "auxiliary", purpose: "title",
			provider: answer.provider ?? null, model: answer.model ?? null, stopReason: answer.stopReason ?? null, entryId: null,
		});
		if (answer.stopReason === "error" || answer.stopReason === "aborted") throw new Error(answer.errorMessage ?? `The model request ${answer.stopReason === "error" ? "failed" : "was aborted"}`);
		return textOfContent(answer.content);
	}

	/**
	 * `/back` (legacy Working Mode), when the Chat is idle: every axis to its starting value and alignment cleared, then
	 * the model context restarts at a handoff the host writes, with no summarizer call: a pointer to the home Workstream's
	 * latest checkpoint and every open question set verbatim (they stay open in the store). A Durable reset keeps nothing
	 * verbatim, where a compaction keeps at least the newest turn; the stored transcript keeps everything. Then one
	 * input starts a brief orient. If the reset fails, it still orients on the context as it is and says so.
	 */
	async #back(operationId: string): Promise<CommandResult> {
		const { harness, root } = this.#host;
		const requestId = `back:${operationId}`;
		if ((await root.commit((tx) => tx.submissionByRequest(root.id, requestId), context)) !== undefined) return { type: "done" };
		const status = await this.status();
		if (status.isStreaming || status.isCompacting || status.isBashRunning || status.pendingMessageCount > 0) return { type: "done", message: "/back runs when the Chat is idle; stop it first." };
		await this.#resume();
		await resetMode(root);
		await syncWorkersGroup(harness, this.#host.registry, root, this.#chat!.workbench.extensions);
		this.#stopPower();
		this.#unsaved = false;
		const asks = Object.values((await questionsState(harness, root)).open).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
		let kept: string | undefined;
		// The question sets repeat tool-call arguments (stored verbatim): sanitized before this new copy commits.
		await root.reset(redact(backSummary(asks)), context).catch((error: unknown) => (kept = error instanceof Error ? error.message : String(error)));
		// The orient input starts a turn, so it carries a pending block as a prompt does (none after a reset: all defaults).
		const block = await pendingBlock(harness, root, false);
		await admit(root, {
			operationId: requestId,
			text: BACK_PROMPT,
			...(block === undefined ? {} : { content: [{ type: "text" as const, text: block.text }, { type: "text" as const, text: BACK_PROMPT }] }),
			entry: { kind: BACK_ENTRY, ...(block === undefined ? {} : { data: { workingMode: block.details } }) },
		});
		await this.#publishStatus();
		return kept === undefined ? { type: "done" } : { type: "done", message: `/back kept the context: ${redact(kept)}` };
	}

	/**
	 * AFK closing nudge (legacy Working Mode): once AFK has started, at a run's end with nothing running (`#working`) and
	 * a tool call since the last checkpoint, one visible input asks for the closing checkpoint. Keyed by the newest entry,
	 * so overlapping checks send it once; work still running leaves it to the next run's end.
	 */
	async #afkClose(): Promise<void> {
		if (!this.#unsaved || this.#chat === undefined || this.#closed) return;
		const { harness, root } = this.#host;
		if (!(await afkActive(harness, root)) || (await this.#working()) || !this.#unsaved) return;
		this.#unsaved = false;
		this.#nudgeSent = true;
		const operationId = `afk-close:${String(this.#entries.at(-1)?.id ?? 0)}`;
		await this.#deliver(() => admit(root, { operationId, text: AFK_CLOSE_PROMPT, entry: { kind: AFK_CLOSE_ENTRY } }));
	}

	/** `/fast [on|off|toggle]` (pi-openai-fast-mode), one of the Chat's commands. */
	async #fast(args: string): Promise<{ type: "done"; message: string } | { type: "unsupported"; message: string }> {
		if (this.#chat === undefined) return { type: "unsupported", message: "/fast is not available on this host" };
		const result = this.#chat.fast.command(args);
		await this.#publishStatus();
		return result;
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

	/**
	 * Arm the idle prompt-cache timer from the newest request, when the Chat's own stored model made it: the model on the
	 * request's message is the run's actual one, and a cheap wake-up's override is never stored, so its run (whose model
	 * has its own cache) arms nothing. It fires a minute before that request's cache entry expires, counted from when the
	 * request started, as the provider's TTL is. A restored Chat inside that last minute fires at once; one whose cache
	 * already expired gets none. Only while a browser shows the Chat (`setViewed` arms it again).
	 */
	async #armIdle(): Promise<void> {
		this.#stopIdleTimer();
		const epoch = this.#idleEpoch;
		const entry = this.#lastAssistantEntry();
		const last = entry?.model?.[0] as AssistantMessage | undefined;
		if (last === undefined || this.#closed || this.#running || !this.#viewed || this.#chat?.idle === undefined || this.#idleAbort !== undefined) return;
		const own = (await this.#host.root.agent(context)).model;
		// No cheaper writer (a light-tier Chat, as every cheap wake-up's override model is): nothing to save.
		if (epoch !== this.#idleEpoch || this.#idle !== undefined || !madeBy(last, own) || summaryModelFor(own!) === undefined) return;
		const usages = this.#entries.toReversed().flatMap((candidate) => {
			const message = candidate.model?.[0] as Message | undefined;
			return message?.role === "assistant" && madeBy(message, own) ? [message.usage] : [];
		});
		const delay = this.#idleDelayMs(this.#host.models.getModel(own!.provider, own!.modelId), usages);
		if (delay === undefined) return;
		const due = last.timestamp + delay;
		const arm: IdleArm = { epoch, due, expiresAt: due + LEAD_MS, rootId: Number(this.#host.root.id), entryId: Number(entry!.id) };
		const now = this.#now();
		if (now >= arm.expiresAt) return;
		arm.timer = setTimeout(() => void this.#idleFire(arm).catch(() => {}), Math.max(0, due - now));
		arm.timer.unref?.();
		this.#idle = arm;
	}

	#stopIdleTimer(): void {
		clearTimeout(this.#idle?.timer);
		this.#idle = undefined;
		this.#idleRetry = undefined;
	}

	/** Any cancel (input admitted, a turn, navigation, the viewer gone, close): the timer, a callback under way, and a cheap summary in flight. */
	#cancelIdle(): void {
		this.#stopIdleTimer();
		this.#idleEpoch += 1;
		this.#idleAbort?.abort();
	}

	/** The newest assistant entry since the last compaction or reset: none once its context was already replaced. */
	#lastAssistantEntry(): EntryRecord | undefined {
		for (const entry of this.#entries.toReversed()) {
			if (entry.kind === CompactionEntry.kind || entry.kind === ResetEntry.kind) return undefined;
			if ((entry.model?.[0] as Message | undefined)?.role === "assistant") return entry;
		}
		return undefined;
	}

	#lastAssistant(): AssistantMessage | undefined {
		return this.#lastAssistantEntry()?.model?.[0] as AssistantMessage | undefined;
	}

	/** Why an idle compaction may not start or summarize now, from this process's state; undefined when it may. */
	#idleBlocked(): string | undefined {
		if (this.#closed || this.#navigating || this.#quiescing || this.#paused()) return "the Chat is closing, navigating or paused";
		if (!this.#viewed) return "no browser shows the Chat";
		if (this.#running) return "a turn runs";
		if (this.#shell !== undefined || this.#heldShell.length > 0) return "a ! command runs";
		return undefined;
	}

	async #idleFire(arm: IdleArm): Promise<void> {
		if (arm.epoch !== this.#idleEpoch) return;
		if (this.#idle === arm) this.#idle = undefined;
		// A host that slept past the expiry finds a cold cache: nothing left to save.
		if (this.#now() >= arm.expiresAt || this.#closed || this.#navigating || this.#quiescing || this.#paused() || this.#chat?.idle === undefined) return;
		const usage = this.#lastAssistant()?.usage;
		const status = await this.status();
		const promptTokens = usage === undefined ? 0 : usage.input + usage.cacheRead + usage.cacheWrite;
		const state = { ...status, viewed: this.#viewed, promptTokens, compacted: this.#idleCompacted };
		if (!idleCompactDue(state)) {
			// Only a `!` command in the way: its end checks again (`shell`), while the cache entry still lives.
			if (status.isBashRunning && idleCompactDue({ ...state, isBashRunning: false }) && arm.epoch === this.#idleEpoch) this.#idleRetry = arm;
			return;
		}
		const own = (await this.#host.root.agent(context)).model;
		const last = this.#lastAssistant();
		if (own === undefined || last === undefined || !madeBy(last, own)) return;
		const summaryModel = summaryModelFor(own);
		if (summaryModel === undefined || this.#host.models.getModel(summaryModel.provider, summaryModel.modelId) === undefined) {
			// Never the Chat's own model instead: its cold read of the whole context is what this timer avoids.
			if (!this.#idleUnavailable.has(own.provider)) this.#idleWarning(`Idle compaction skipped: ${own.provider} has no cheap summary model here${summaryModel === undefined ? "" : ` (${summaryModel.modelId})`}.`);
			this.#idleUnavailable.add(own.provider);
			return;
		}
		const baseline = await this.#idleBaseline();
		// Not a paused restore (checked above): a reopened host schedules tasks only once something resumes it, as `/compact` does.
		await this.#resume();
		await this.exclusive(() => this.#admitIdle(arm, own, summaryModel, baseline));
	}

	/**
	 * Create the timer's compaction task, with the intent its note needs, in one commit that checks every condition
	 * again: this branch and request, viewed, no run, an empty inbox, no `!` command, the cache entry still alive, the
	 * Chat's model still `own`, and no earlier attempt for this request (a declined summary is not paid for again).
	 */
	async #admitIdle(arm: IdleArm, own: ModelRef, summaryModel: IdleIntent["summaryModel"], baseline: IdleBaseline): Promise<void> {
		const { root } = this.#host;
		// A stale callback (cancelled since it fired) or an admitted summary's controller: never touched, so a cancel still reaches that summary.
		if (arm.epoch !== this.#idleEpoch || this.#idleAbort !== undefined) return;
		const abort = new AbortController();
		this.#idleAbort = abort;
		let intent: IdleIntent | undefined;
		try {
			intent = await root.commit(async (tx) => {
				if (arm.epoch !== this.#idleEpoch || this.#idleCompacted || this.#idleBlocked() !== undefined || this.#now() >= arm.expiresAt) return undefined;
				if (this.#host.root !== root || Number(root.id) !== arm.rootId || Number(this.#lastAssistantEntry()?.id) !== arm.entryId) return undefined;
				const live = await tx.doc(LiveDoc, root.id);
				if (live.run !== undefined || (live.compactions?.length ?? 0) > 0 || (await tx.doc(InboxDoc, root.id)).items.length > 0) return undefined;
				const model = (await tx.doc(AgentDoc, root.id)).model;
				if (model?.provider !== own.provider || model.modelId !== own.modelId) return undefined;
				const doc = await tx.doc(IdleCacheDoc, root.id);
				if (doc.intent !== null || doc.attempted === arm.entryId) return undefined;
				// Durable's manual compaction with its live status, as the checkpoint task creates one; its instructions mark it.
				// `idle` (our pi-durable patch): a first entry larger than the keep window alone may be summarized too.
				const task = await tx.createTask(CompactionTask, { reason: "manual", idle: true, instructions: IDLE_INSTRUCTIONS }, { ownership: { kind: "conversation" } });
				live.compactions ??= [];
				live.compactions.push({ taskId: task, trigger: "manual", blocking: false, attempt: 1 });
				const created: IdleIntent = { task: Number(task), rootId: Number(root.id), entryId: arm.entryId, firedAt: this.#now(), expiresAt: arm.expiresAt, summaryModel, baseline };
				doc.intent = created;
				doc.attempted = arm.entryId;
				this.#idleTask = created.task;
				return created;
			}, context);
		} finally {
			if (intent === undefined && this.#idleAbort === abort) this.#idleAbort = undefined;
		}
		if (intent === undefined) return;
		this.#idleCompacted = true;
		await this.#publishStatus();
		void this.#finishIdle(intent).catch((error: unknown) => this.#idleNoteFailed(error));
	}

	/** This Chat's Workstream and its checkpoint health now; null outside a Workstream, no `checkpoint` when unreadable. */
	async #idleBaseline(): Promise<IdleBaseline> {
		const workstreamId = await homeWorkstream(this.#chatId);
		if (workstreamId === undefined) return null;
		try {
			const snapshot = await userWorkstreamStore().inspect(workstreamId);
			return { workstreamId, checkpoint: checkpointState(snapshot.sessions.find((session) => session.id === this.#chatId)) };
		} catch {
			return { workstreamId };
		}
	}

	/**
	 * After a timer compaction settles: once its summary is placed, the marker entry, then a Workstream Chat's note. Run
	 * again on restore for an intent a kill left: every step is idempotent and none summarizes again. A declined
	 * compaction (the hook warned when it matters) leaves nothing to do. The intent is cleared at the end, but not by a close.
	 */
	async #finishIdle(intent: IdleIntent): Promise<void> {
		const { harness, root } = this.#host;
		try {
			const { outcome } = (await harness.waitForTask(intent.task as unknown as TaskId<{ submissionId?: number }>, context)).state;
			if (outcome.status === "failed") return this.#compactionFailed(outcome.error.message);
			if (outcome.status === "aborted") return this.#emit({ type: "command.output", level: "info", message: "Compaction cancelled." });
			const submissionId = outcome.result?.submissionId;
			if (submissionId === undefined) {
				// No summary and the hook never decided: Durable found no prefix to summarize. This stretch stays done (no retry).
				if (this.#idleHookRan !== intent.task && !this.#idleEmptyWarned) {
					this.#idleEmptyWarned = true;
					this.#idleWarning("Idle compaction found nothing to summarize: the recent turns the compaction keeps are the whole context.");
				}
				return;
			}
			const placed = await (await harness.submission(submissionId as never, context))!.wait(context);
			if (placed.status !== "done") return;
			const entryId = placed.entry as number;
			await root.submit({ type: "write", requestId: `idle-compaction:${String(intent.task)}`, entry: { kind: IDLE_COMPACTION_ENTRY, data: { task: intent.task } } }, context);
			if (intent.baseline === null) return;
			const entry = (await root.entries({ minEntryId: entryId as never, maxEntryId: entryId as never }, 1, undefined, context)).items[0];
			const message = entry?.kind === CompactionEntry.kind ? (entry.model?.[0] as Message | undefined) : undefined;
			if (message === undefined) return this.#idleWarning(`Idle compaction note skipped: the placed summary (entry ${String(entryId)}) was not found.`);
			await writeIdleNote(userWorkstreamStore, {
				workstreamId: intent.baseline.workstreamId,
				sessionId: this.#chatId,
				summary: compactionSummary(message),
				firedAt: intent.firedAt,
				...(intent.baseline.checkpoint === undefined ? {} : { checkpoint: intent.baseline.checkpoint }),
				stale: () => this.#turnSince(entryId),
			}, this.#idleNotes === undefined ? {} : { scratch: this.#idleNotes });
		} finally {
			if (this.#idleTask === intent.task) {
				this.#idleTask = undefined;
				this.#idleAbort = undefined;
			}
			if (!this.#closed) {
				await root.commit(async (tx) => {
					const doc = await tx.doc(IdleCacheDoc, intent.rootId as unknown as ConversationId);
					if (doc.intent?.task === intent.task) doc.intent = null;
				}, context);
				// A newer request whose turn ended while this one unwound found the timer busy: arm it now.
				const newest = this.#lastAssistantEntry();
				if (newest !== undefined && Number(newest.id) !== intent.entryId) void this.#armIdle().catch(() => {});
			}
		}
	}

	/** Whether a turn started after entry `after` (the placed summary): its checkpoint, or the owner's, is fresher than a note. */
	async #turnSince(after: number): Promise<boolean> {
		const page = await this.#host.root.entries({ minEntryId: (after + 1) as never, order: "ascending" }, 50, undefined, context);
		return page.items.some((entry) => (entry.model ?? []).some((message) => (message as Message).role === "user" || (message as Message).role === "assistant"));
	}

	#idleNoteFailed(error: unknown): void {
		// The compaction stands; only its idle marker or Workstream note failed.
		this.#idleWarning(`Idle compaction note failed: ${redact(error instanceof Error ? error.message : String(error))}`);
	}

	#idleWarning(message: string): void {
		this.#emit({ type: "command.output", level: "warning", message });
	}

	/** PI WEB: whether at least one browser tab or window shows this Chat. Losing the last viewer cancels the timer; a new one arms it. */
	setViewed(viewed: boolean): void {
		if (viewed === this.#viewed) return;
		this.#viewed = viewed;
		if (!viewed) this.#cancelIdle();
		else void this.#armIdle().catch(() => {});
	}

	#compactionFailed(error: string): void {
		this.#emit({ type: "session.diagnostic", message: `Compaction failed: ${error}` });
		this.#emit({ type: "command.output", level: "error", message: "Couldn’t compact history. Try again." });
	}

	/** PI WEB's settings are host-wide; a rewound agent may still have a different model tool list. */
	async #syncSpawnTool(tx: Tx): Promise<void> {
		const agent = await tx.doc(AgentDoc, this.#host.root.id);
		for (const [requests, tool] of [[this.#chat?.spawner, "spawn_session"], [this.#chat?.messenger, "send_chat_message"]] as const) {
			if (requests === undefined) continue;
			const modelTools = agent.modelTools;
			if (Array.isArray(modelTools)) return; // Never edit a child's explicit allowlist.
			const add = modelTools?.add ?? [];
			if (add.includes(tool) === requests.enabled) continue;
			agent.modelTools = { ...modelTools, add: requests.enabled ? [...add, tool] : add.filter((name) => name !== tool) };
		}
	}

	/** Resources PI WEB resolved with Pi's loader; their sources are recorded when they change. Compaction: Pi's settings. */
	async configure(resources: Resources, settings: { compaction?: CompactionSettings; spawnSessions?: boolean; chatMessages?: boolean } = {}): Promise<void> {
		if (this.#chat === undefined) return;
		this.#chat.workbench.resources = resources;
		if (this.#chat.spawner !== undefined) this.#chat.spawner.enabled = settings.spawnSessions === true;
		if (this.#chat.messenger !== undefined) this.#chat.messenger.enabled = settings.chatMessages === true;
		if (settings.compaction !== undefined) this.#chat.workbench.compaction = { ...DEFAULT_COMPACTION, ...settings.compaction };
		const sources = [...(resources.sources ?? [])].map((s) => ({ path: s.path, sha256: s.sha256 }));
		await this.#host.harness.commit(async (tx) => {
			const doc = await tx.doc(ResourcesDoc);
			if (JSON.stringify(doc.sources) !== JSON.stringify(sources)) doc.sources = sources;
			await this.#syncSpawnTool(tx);
		}, context);
	}

	/** PI WEB's answer to a spawn_session request: the started Chat, or why it refused. */
	spawned(answer: { requestId: string; result?: SpawnResult; error?: string }): void {
		this.#chat?.spawner?.settle(answer);
	}

	/** PI WEB's answer to a send_chat_message request: the delivery or chat list, or why it refused. */
	chatMessaged(answer: { requestId: string; result?: ChatMessageResult | ChatListResult; error?: string }): void {
		this.#chat?.messenger?.settle(answer);
	}

	/**
	 * Another Chat's message, delivered by PI WEB: a host-side delivery (it waits for navigation and a checkpoint, as
	 * Atelier input does). A paused restore refuses it at once, so the sender learns now instead of a hidden later
	 * delivery. A replay answers `duplicate` with the first delivery, hop and held flag. Resolves once committed, with how
	 * it was delivered.
	 */
	async chatMessage(message: IncomingChatMessage): Promise<ChatMessageDelivery> {
		const earlier = await deliveredBefore(this.#host.harness, this.#host.root, message);
		if (earlier !== undefined) return { ...earlier, duplicate: true };
		if (this.#paused()) throw new Error(CHAT_PAUSED);
		return this.#deliver(async () => {
			const again = await deliveredBefore(this.#host.harness, this.#host.root, message);
			if (again !== undefined) return { ...again, duplicate: true };
			// shortcut: guessed before admission, so two concurrent sends to an idle chat may both say started though one queues; ask Durable for the submission's placement if that matters.
			const delivery: Delivery = !message.wake ? "noted" : !this.#running ? "started" : message.urgent === true ? "steered" : "queued";
			await submitChatMessage(this.#host.root, message, delivery);
			return { delivery };
		});
	}

	/**
	 * Stop: withdraw queued inputs and abort the current run (background work excluded). A paused restore stays paused:
	 * the queue is withdrawn and the lead's own foreground tasks are marked aborted; their abort, and its cascade to the
	 * work they own, runs once the owner resumes, so the interrupted run never answers.
	 */
	async abort(): Promise<void> {
		this.#shell?.cancel();
		if (!this.#paused()) return this.#host.root.abort(context);
		await this.clearQueue();
		const { harness, root } = this.#host;
		for (const { record } of (await harness.inspect(context)).tasks) if (stopReaches(record, root.id)) await harness.abortTask(record.id, context);
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
		const before = runOrder((inbox?.items ?? []).filter(ownerQueued));
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
			const order = runOrder(queue.filter(ownerQueued));
			if (order.length !== request.expected.length || order.some((input, n) => input.id !== request.expected[n]))
				throw new Error("Queued messages changed; refresh the queue and try again");
			const input = order[request.index]!;
			const flip = input.mode === "steer" ? "followUp" : "steer";
			switch (request.action) {
				case "remove":
					return { withdraw: [input], readmit: [] };
				case "recall":
					if (order.slice(request.index).some((item) => chatMessageEntry(item.entry) !== undefined)) throw new Error("A chat message from another chat cannot be recalled into the composer; remove it instead");
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
				// The idle timer fired while this command ran: check again while the cache entry lives.
				const retry = this.#idleRetry;
				this.#idleRetry = undefined;
				if (retry !== undefined) void this.#idleFire(retry).catch(() => {});
			}
		})();
	}

	/** Commit held `!` records as display entries; an included one carries the user message the model reads. */
	async #flushShell(): Promise<void> {
		for (const record of this.#heldShell.splice(0)) {
			const model = record.excludeFromContext ? {} : { model: [{ role: "user" as const, content: [{ type: "text" as const, text: bashExecutionToText(record) }], timestamp: record.timestamp }] };
			const entry = { kind: BASH_ENTRY, data: record, ...model };
			const { root } = this.#host;
			// A paused restore stays paused: its lead is idle here (a held record waits for the run), so the record is
			// appended directly; a write submission would enable scheduling.
			if (this.#paused()) await root.commit((tx) => tx.appendEntry(root.id, entry), context);
			else await root.submit({ type: "write", entry }, context);
		}
	}

	async clearQueue(): Promise<void> {
		const { harness, root } = this.#host;
		const inbox = await harness.snapshot(InboxDoc, root.id, context);
		for (const item of inbox?.items ?? []) if (item.mode !== "write") await harness.abortSubmission(item.id, context, root.id);
	}

	// ─── History navigation ──────────────────────────────────────────────────

	/**
	 * Run an operation that must not overlap tree navigation (input, questions, models, the queue, shell, compaction):
	 * refused while one runs, and counted so navigation waits for nothing in flight.
	 */
	async exclusive<T>(work: () => Promise<T>): Promise<T> {
		if (this.#navigating) throw new Error("Wait for session tree navigation to finish, then try again");
		if (this.#quiescing) throw new Error("This Chat is restarting on new host code; send it again in a moment");
		this.#inFlight += 1;
		try {
			return await work();
		} finally {
			this.#inFlight -= 1;
		}
	}

	/** Why the Chat is not quiescent: a run, queued input, a `!` command, or any live task (compaction, delivery) besides the background children navigation carries. */
	async #activity(): Promise<string | undefined> {
		if (this.#navigating || this.#quiescing || this.#inFlight > 0 || this.#running || this.#shell !== undefined || this.#heldShell.length > 0) return BUSY;
		// Background Subagents and Workers move to the destination branch (`carryChildren`): their own work does not block.
		const carries = await navigationCarries(this.#host.harness, this.#host.root.id, context);
		const inspection = await this.#host.harness.inspect(context);
		if (inspection.tasks.some((task) => !carries.task(task.record)) || inspection.submissions.some((submission) => !carries.submission(submission))) return BUSY;
		// A completion admitted before a kill but not yet receipted is finished by the reporter on this branch first.
		const jobs = await this.#host.harness.snapshot(BashJobsDoc, this.#host.root.id, context);
		if (Object.values(jobs?.jobs ?? {}).some((ref) => ref.delivery === "completion" && ref.admitted !== true)) return BUSY;
		const reconcile = await this.#host.harness.snapshot(Reconcile, context);
		if (Object.values(reconcile?.uncertain ?? {}).some((item) => item.resolved === undefined)) return "Resolve the interrupted tool call before navigating the session tree";
		return undefined;
	}

	/** `/tree`: every retained branch's history and the active leaf, as Pi-shaped entries. Read-only, so allowed while active; `navigate` refuses. */
	async tree(): Promise<{ type: "tree"; nodes: TreeEntry[]; activeLeafId: string | null } | { type: "unsupported"; message: string }> {
		return { type: "tree", ...(await historyTree(this.#host.harness, this.#host.root)) };
	}

	/**
	 * Continue the Chat from an earlier entry: select the retained branch that ends there, or fork one in the same store
	 * (Working Mode, tool groups and the agent as of the fork point; questions as that history leaves them). Later
	 * history stays. Quiescent and checked against the leaf PI WEB showed. Returns a user message's text for the editor.
	 */
	async navigate(request: { targetId: string; expectedLeafId: string | null; retainCheckpoint?: boolean }): Promise<{ editorText?: string }> {
		const busy = await this.#activity();
		if (busy !== undefined) throw new Error(busy);
		// A delivery that began during the check is activity too; none can begin from here on.
		if (this.#inFlight > 0) throw new Error(BUSY);
		this.#navigating = true;
		try {
			const { harness } = this.#host;
			const plan = await planNavigation(harness, this.#host.root, request);
			const result = plan.editorText === undefined ? {} : { editorText: plan.editorText };
			if (plan.select === undefined && plan.fork === undefined) return result;
			const before = (await questionsState(harness, this.#host.root)).open;
			const next = await commitNavigation(harness, this.#host.root, plan);
			// Another branch: the timer measured this branch's newest request.
			this.#cancelIdle();
			await this.#stop?.();
			this.#host.root = next;
			if (this.#chat !== undefined) await harness.commit((tx) => this.#syncSpawnTool(tx), context);
			await this.#watch();
			this.#record("session.tree", { entryId: null, newLeafId: plan.newLeafId, oldLeafId: plan.oldLeafId });
			this.#emit({ type: "session.tree.changed" });
			// The browser's question chips follow the branch: the sets left behind close, the branch's own open.
			const after = (await questionsState(harness, next)).open;
			for (const askId of Object.keys(before)) if (after[askId] === undefined) this.#emit({ type: "ask.closed", askId, reason: "cancelled" });
			for (const [askId, ask] of Object.entries(after)) if (before[askId]?.revision !== ask.revision) this.#emit({ type: "ask.opened", ask });
			await this.#chat?.packages?.tree(plan.oldLeafId, plan.newLeafId);
			await this.#publishStatus();
			return result;
		} finally {
			this.#navigating = false;
			for (const resume of this.#afterNavigation.splice(0)) resume();
		}
	}

	/** Listing metadata, read without scheduling anything. */
	info(): { messageCount: number; firstMessage: string } {
		const first = (this.messages() as { role?: string; content?: unknown }[]).find((message) => message.role === "user");
		return { messageCount: this.messages().length, firstMessage: textOfContent(first?.content) };
	}
}

const INTERRUPTED = "The answer in progress was interrupted when the Chat's host stopped.";

/** A task Stop marks on a paused restore: the lead's own foreground work; `Conversation.abort` cascades from it. */
function stopReaches(task: { conversationId: unknown; owner?: unknown; background: boolean }, lead: unknown): boolean {
	return task.conversationId === lead && task.owner === undefined && !task.background;
}

/** What one view revision changed, as the events of Durable 1.4's `watchEvents` this projection was built on. */
type ViewEvent =
	| { type: "run_start" | "run_end" | "docs_changed" | "compaction_start" }
	| { type: "message_start"; message: Message }
	| { type: "message_update"; message: AssistantMessage }
	| { type: "message_end" | "entry_appended"; entry: EntryRecord }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; text: string; details?: unknown }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; entry?: EntryRecord }
	| { type: "compaction_end"; trigger: string; error?: string }
	| { type: "task_failed"; kind: string; message: string };

const STATUS_EVENTS = new Set<ViewEvent["type"]>(["run_start", "run_end", "docs_changed", "message_end", "tool_execution_start", "tool_execution_end", "compaction_start", "compaction_end"]);

function liveOf(view: ConversationView): LiveState {
	return (view.docs["pi.live"] ?? {}) as LiveState;
}

/** The arguments of a model-issued call, from the answer that made it (the newest in the window). */
function callArguments(entries: readonly EntryRecord[], callId: string): unknown {
	for (const entry of entries.toReversed()) {
		const message = entry.model?.[0] as Message | undefined;
		if (message?.role !== "assistant") continue;
		const call = message.content.find((block) => block.type === "toolCall" && block.id === callId);
		if (call?.type === "toolCall") return call.arguments;
	}
	return {};
}

/**
 * The events between two revisions of one view, in Durable 1.4's `watchEvents` order: tool starts, the in-flight
 * message, tool output, then committed entries (each tool's end right before its result), ends without a result,
 * compaction ends, a failed run, run end, document changes, compaction starts and run start. Nested calls belong to
 * their parent tool's result and are not shown.
 */
export function viewEvents(before: ConversationView, after: ConversationView): ViewEvent[] {
	const was = liveOf(before);
	const now = liveOf(after);
	const newest = before.entries.at(-1)?.id ?? before.before ?? 0;
	const entries = after.entries.filter((entry) => entry.id > newest);
	const events: ViewEvent[] = [];
	const slotsBefore = new Map((was.tools ?? []).map((slot) => [slot.callId, slot]));
	const slots = now.tools ?? [];
	for (const slot of slots)
		if (slot.status === "running" && slotsBefore.get(slot.callId)?.status !== "running")
			events.push({ type: "tool_execution_start", toolCallId: slot.callId, toolName: slot.name, args: callArguments(after.entries, slot.callId) });
	const partialBefore = was.generation?.message;
	const partial = now.generation?.message as AssistantMessage | undefined;
	if (partial !== undefined && partialBefore === undefined) events.push({ type: "message_start", message: partial });
	else if (partial !== undefined && partial !== partialBefore) events.push({ type: "message_update", message: partial });
	for (const slot of slots) {
		const previous = slotsBefore.get(slot.callId);
		if (slot.status !== "running" || previous?.status !== "running") continue;
		if (slot.output === previous.output && slot.details === previous.details) continue;
		events.push({ type: "tool_execution_update", toolCallId: slot.callId, toolName: slot.name, text: slot.output ?? "", ...(slot.details === previous.details ? {} : { details: slot.details ?? null }) });
	}
	// Tools that end here: a slot that becomes done, one created done, or an unfinished one gone with its run.
	const known = [...before.entries, ...entries];
	const ends: Extract<ViewEvent, { type: "tool_execution_end" }>[] = [];
	const end = (slot: ToolSlot, entry: EntryRecord | undefined) => ends.push({ type: "tool_execution_end", toolCallId: slot.callId, toolName: slot.name, ...(entry === undefined ? {} : { entry }) });
	const resultOf = (callId: string) => known.find((entry) => { const m = entry.model?.[0] as Message | undefined; return m?.role === "toolResult" && m.toolCallId === callId; });
	for (const previous of slotsBefore.values()) {
		if (previous.status === "done") continue;
		const slot = slots.find((candidate) => candidate.callId === previous.callId);
		if (slot?.status === "done") end(slot, known.find((entry) => entry.id === slot.entry));
		else if (slot === undefined) end(previous, resultOf(previous.callId));
	}
	for (const slot of slots) if (slot.status === "done" && !slotsBefore.has(slot.callId)) end(slot, known.find((entry) => entry.id === slot.entry));
	let assistantAppended = false;
	for (const entry of entries) {
		events.push(...ends.filter((candidate) => candidate.entry === entry));
		const message = entry.model?.[0] as Message | undefined;
		if (message === undefined) {
			events.push({ type: "entry_appended", entry });
			continue;
		}
		// A streamed answer already started with its first partial.
		const streamed = message.role === "assistant" && partialBefore !== undefined && !assistantAppended;
		if (message.role === "assistant") assistantAppended = true;
		if (!streamed) events.push({ type: "message_start", message });
		events.push({ type: "message_end", entry });
	}
	events.push(...ends.filter((candidate) => candidate.entry === undefined || !entries.includes(candidate.entry)));
	const compactions = now.compactions ?? [];
	for (const { taskId, trigger } of was.compactions ?? [])
		if (!compactions.some((status) => status.taskId === taskId)) {
			const error = now.compactionFailure?.taskId === taskId ? now.compactionFailure.error : undefined;
			events.push({ type: "compaction_end", trigger, ...(error === undefined ? {} : { error }) });
		}
	// A run whose task faulted or was orphaned (Durable 1.4 reported every such task; 1.5 keeps only the run's).
	const failure = now.runFailure;
	if (failure !== undefined && failure !== was.runFailure && (failure.reason === "faulted" || failure.reason === "orphaned"))
		events.push({ type: "task_failed", kind: "pi.generation", message: failure.detail ?? failure.reason });
	const runChanged = now.run?.inputs[0] !== was.run?.inputs[0];
	if (was.run !== undefined && runChanged) events.push({ type: "run_end" });
	if (["pi.inbox", "pi.agent", "pi.usage"].some((kind) => after.docs[kind] !== before.docs[kind])) events.push({ type: "docs_changed" });
	if (compactions.some(({ taskId }) => !(was.compactions ?? []).some((status) => status.taskId === taskId))) events.push({ type: "compaction_start" });
	if (now.run !== undefined && runChanged) events.push({ type: "run_start" });
	return events;
}
