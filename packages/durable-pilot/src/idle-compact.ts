// Idle prompt-cache compaction: shortly before the prompt cache of a viewed, idle Chat expires, compact it, so the
// owner's next message pays for a short summary instead of rewriting a cold cache of the whole context.
// Decision (2026-11): the timer's summary comes from a cheaper model of the Chat's provider (Sonnet on Anthropic, Terra on
// Codex) through a `beforeCompact` hook, not Durable's own summarizer on the Chat's model (a cold read of the whole
// context: on Opus ~$0.42 at 100k tokens, ~$1.22 at 300k; on Sonnet ~$0.27 and ~$0.67). Haiku scored worst in the
// owner's summary backtest, so the provider's cheapest model is not used. Undo: drop `idleCompaction().extension` from
// the Chat's extensions in chat.ts, and the timer compactions summarize on the Chat's model again; or change the model
// in IDLE_SUMMARY_MODELS.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type Api, type AssistantMessage, type CacheRetention, getPromptCacheTtlMs, type Model, type Usage } from "@earendil-works/pi-ai";
import { serializeConversation } from "@earendil-works/pi-coding-agent";
import { AgentDoc, CompactionTask, defineExtension, hook, InboxDoc, LiveDoc, type ModelRef } from "@earendil-works/pi-durable";
import type { Checkpoint, WorkstreamSession, WorkstreamStore } from "../../workstream-store/src/index.js";
import { compactionInstructions } from "../../../extensions/context-checkpoint/coordinator.mjs";
import { light } from "./cheap-wake.ts";
import { redact } from "./redact.ts";
import { defineDoc } from "./store-schema.ts";

/** Every Durable Chat request asks for the long prompt-cache tier (1 h on Anthropic where the model has it). */
export const CACHE_RETENTION: CacheRetention = "long";

/**
 * A bookkeeping entry (no model message) written right after a timer compaction's summary is placed, with
 * `data: { task }` (the compaction task). Code that routes the turn after an idle compaction looks for it after the
 * newest CompactionEntry.
 */
export const IDLE_COMPACTION_ENTRY = "workbench.idle-compaction";

/** Producer of the host-written Workstream checkpoint: no model reviewed it. */
export const IDLE_NOTE_PRODUCER = "host:idle-compaction";

/**
 * The instructions of every timer compaction task: stored in its input, so the hook tells it from `/compact` and the
 * checkpoint's compactions, and the cheap summarizer's focus.
 */
export const IDLE_INSTRUCTIONS: string = compactionInstructions({
	summaryFocus: "Idle before the prompt cache expires: keep everything the owner's next message needs to continue this Chat.",
	nextPhase: "Continue with the owner's next message.",
});

/** The model of each provider that writes a timer compaction's summary (same provider only). */
export const IDLE_SUMMARY_MODELS: Readonly<Record<string, string>> = { anthropic: "claude-sonnet-5-5", "openai-codex": "gpt-6.1-terra" };
// Sonnet hit 8k in 2 of 8 backtest samples; a summary that hits this cap is truncated and declined.
const SUMMARY_MAX_TOKENS = 16_000;
const SUMMARY_TIMEOUT_MS = 180_000;
const SUMMARY_SYSTEM = "You are a context summarization assistant. Read the conversation between a user and an AI assistant and write the summary the instructions ask for. Do NOT continue the conversation or answer its questions; output only the summary.";

const MIN_PROMPT_TOKENS = 80_000;
export const LEAD_MS = 60_000;
// shortcut: Codex backend has no documented TTL; ~30 min measured for Sol/Terra/Astra (github.com/volt-hq/Volt/issues/458), others unknown so skipped; replace if pi-ai ships Codex promptCache.
const CODEX_TTL_MS = 30 * 60_000;
const TEXT_LIMIT = 4_000;
const NONE = "Unknown: this session has no earlier checkpoint; read the idle note.";

/**
 * How long after the newest request STARTED (a provider's cache TTL counts from then) the timer fires: a minute before
 * its cache entry expires; none without a TTL or without cache evidence. `usages`: the usage of each request on this
 * model, newest first. A request that neither read nor wrote the cache arms nothing. The long tier counts only with
 * evidence: the request wrote its 1 h part, or it read a cache whose nearest earlier write on this model was 1 h.
 */
export function idleDelayMs(model: Model<Api> | undefined, usages: readonly Usage[]): number | undefined {
	const [last, ...earlier] = usages;
	if (model === undefined || last === undefined || (last.cacheRead <= 0 && last.cacheWrite <= 0)) return undefined;
	const deniedByCompat = (model.compat as { supportsLongCacheRetention?: boolean } | undefined)?.supportsLongCacheRetention === false;
	const write = last.cacheWrite > 0 ? last : earlier.find((usage) => usage.cacheWrite > 0);
	const granted = (write?.cacheWrite1h ?? 0) > 0;
	const long = model.promptCache?.long !== undefined && !deniedByCompat && granted;
	let ttl = getPromptCacheTtlMs(model, { cacheRetention: long ? CACHE_RETENTION : "short" });
	if (ttl === undefined && model.provider === "openai-codex" && /sol|terra|astra/.test(model.id)) ttl = CODEX_TTL_MS;
	return ttl === undefined ? undefined : Math.max(0, ttl - LEAD_MS);
}

export type IdleState = {
	isStreaming: boolean;
	isCompacting: boolean;
	/** A foreground `!` command; background bash, Subagents and Workers do not count. */
	isBashRunning: boolean;
	pendingMessageCount: number;
	viewed: boolean;
	/** input + cacheRead + cacheWrite of the newest assistant usage. */
	promptTokens: number;
	/** The timer already compacted in this idle stretch. */
	compacted: boolean;
};

/** Whether the fired timer compacts: idle, viewed, a large prompt, and once per idle stretch. */
export function idleCompactDue(state: IdleState): boolean {
	const idle = !state.isStreaming && !state.isCompacting && !state.isBashRunning && state.pendingMessageCount === 0;
	return idle && state.viewed && state.promptTokens >= MIN_PROMPT_TOKENS && !state.compacted;
}

/**
 * The Workstream state an idle note compares against: `null` for a Chat outside a Workstream; `checkpoint` is this
 * session's checkpoint health fingerprint (`checkpointState`), absent when the store could not be read.
 */
export type IdleBaseline = { workstreamId: string; checkpoint?: string } | null;

/**
 * A timer compaction in flight, stored with its task in the commit that creates it, so a restart finishes its note;
 * `entryId`: the request entry it measured.
 */
export type IdleIntent = { task: number; rootId: number; entryId?: number; firedAt: number; expiresAt: number; summaryModel: ModelRef; baseline: IdleBaseline };
/** `attempted`: the request entry the newest timer compaction measured, kept after its intent clears: one attempt per idle stretch, across restarts. */
export const IdleCacheDoc = defineDoc<{ intent: IdleIntent | null; attempted?: number }>({
	kind: "workbench.idle-cache",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ intent: null }),
	checkpointWhen: () => false,
});

/** Whether model `ref` made `message`; the scripted providers (tests, trials) answer as `faux` under the real model names. */
export const madeBy = (message: { provider: string; model: string }, ref: ModelRef | undefined): boolean =>
	ref !== undefined && message.model === ref.modelId && (message.provider === ref.provider || message.provider === "faux");

/**
 * The cheap summary model for a Chat on `own`; none for a provider without one, and none when it would save nothing:
 * `own` is that model itself or a light tier model (as every cheap wake's override model is). Any other model of the
 * provider qualifies, also one the routing roster does not list (e.g. claude-opus-5).
 */
export const summaryModelFor = (own: ModelRef): ModelRef | undefined => {
	const modelId = IDLE_SUMMARY_MODELS[own.provider];
	return modelId === undefined || modelId === own.modelId || light(own) ? undefined : { provider: own.provider, modelId };
};

/** What the session tells the hook: why a timer compaction may not summarize now (in-process state), and where its warnings and usage go. */
export type IdleGate = {
	blocked: (conversationId: number, task: number) => string | undefined;
	signal: () => AbortSignal | undefined;
	warn: (message: string) => void;
	usage: (message: AssistantMessage) => void;
};

/** The summary of a clean `stop` with text and no tool call (Durable's own rule); anything else declines. */
function summaryText(message: AssistantMessage): string | undefined {
	if (message.stopReason !== "stop" || message.content.some((content) => content.type === "toolCall")) return undefined;
	const text = message.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join("\n").trim();
	return text === "" ? undefined : text;
}

/**
 * The `beforeCompact` hook that writes a timer compaction's summary on the cheap model. It declines (never throws: a
 * throw would make Durable summarize cold on the Chat's model) whenever the cheap summary is not a clean, complete text,
 * and whenever the Chat is no longer idle. Every other compaction passes through untouched.
 */
export function idleCompaction() {
	const gate: IdleGate = { blocked: () => "no Chat session", signal: () => undefined, warn: () => {}, usage: () => {} };
	const extension = defineExtension({
		name: "workbench.idle-compaction",
		hooks: [
			hook(CompactionTask, {
				beforeCompact: async (compaction, api, c) => {
					if (compaction.instructions !== IDLE_INSTRUCTIONS) return undefined;
					// A warning that throws must not escape: a throw makes Durable summarize cold on the Chat's model.
					const decline = (warning?: string) => {
						try {
							if (warning !== undefined) gate.warn(warning);
						} catch {}
						return { decline: true as const };
					};
					try {
						const intent = (await api.snapshot(IdleCacheDoc, api.conversationId, c))?.intent;
						if (intent == null || intent.task !== Number(api.taskId)) return decline();
						if (gate.blocked(Number(api.conversationId), intent.task) !== undefined || api.now() >= intent.expiresAt) return decline();
						if ((await api.snapshot(LiveDoc, api.conversationId, c))?.run !== undefined || ((await api.snapshot(InboxDoc, api.conversationId, c))?.items.length ?? 0) > 0) return decline();
						// The Chat's model changed since admission: the summary would go to the previous one's provider.
						const writerChanged = async () => {
							const own = (await api.snapshot(AgentDoc, api.conversationId, c))?.model;
							const writer = own === undefined ? undefined : summaryModelFor(own);
							return writer?.provider !== intent.summaryModel.provider || writer.modelId !== intent.summaryModel.modelId;
						};
						if (await writerChanged()) return decline();
						const { provider, modelId } = intent.summaryModel;
						const model = api.models.getModel(provider, modelId);
						if (model === undefined) return decline(`Idle compaction skipped: ${provider}/${modelId} is not available.`);
						const prompt = `<conversation>\n${serializeConversation(compaction.messages as never)}\n</conversation>\n\n${IDLE_INSTRUCTIONS}`;
						const cancel = gate.signal();
						const signals = [AbortSignal.timeout(SUMMARY_TIMEOUT_MS), cancel].filter((signal) => signal !== undefined);
						const message = await api.models.completeSimple(
							model,
							{ systemPrompt: SUMMARY_SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: api.now() }] },
							{ maxTokens: Math.min(SUMMARY_MAX_TOKENS, model.maxTokens > 0 ? model.maxTokens : SUMMARY_MAX_TOKENS), cacheRetention: "none", signal: AbortSignal.any(signals) },
						);
						gate.usage(message);
						// An attempt cancelled (a model switch, the viewer gone) or whose writer changed while it ran is never placed.
						if (cancel?.aborted === true || (await writerChanged())) return decline();
						const summary = summaryText(message);
						if (summary !== undefined) return { summary: redact(summary) };
						if (message.stopReason === "aborted") return decline();
						const why = message.stopReason === "length" ? "was cut off at its length limit" : message.stopReason === "error" ? `failed (${redact(message.errorMessage ?? "error")})` : "had no text";
						return decline(`Idle compaction skipped: the ${provider}/${modelId} summary ${why}; the context stays as it is.`);
					} catch (error) {
						return decline(`Idle compaction skipped: ${redact(error instanceof Error ? error.message : String(error))}`);
					}
				},
			}),
		],
	});
	return { extension, gate };
}

/**
 * A session's checkpoint health as a digest of the checkpoint, when it was recorded, and its stale or failure marks: the
 * Chat store keeps it, and a failure reason may quote a secret.
 */
export const checkpointState = (session: WorkstreamSession | undefined): string =>
	createHash("sha256").update(JSON.stringify([session?.latestCheckpoint?.id ?? null, session?.latestCheckpoint?.recordedAt ?? null, session?.checkpointStaleness?.recordedAt ?? null, session?.checkpointFailure ?? null])).digest("hex");

/** The leading sentences of a summary as one line, at most about `max` characters. */
function lead(summary: string, max = 300): string {
	const text = summary.replace(/^\s*#+\s.*$/gm, "").replace(/^\s*[-*]\s+/gm, "").replace(/\s+/g, " ").trim();
	let out = "";
	for (const sentence of text.split(/(?<=[.!?])\s+/)) {
		if (out !== "" && out.length + sentence.length + 1 > max) break;
		out = out === "" ? sentence : `${out} ${sentence}`;
	}
	return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** One path segment for an ID: percent-encoded, so no separator or traversal survives. */
function segment(id: string): string {
	const encoded = encodeURIComponent(id);
	if (encoded === "" || encoded === "." || encoded === "..") throw new Error(`invalid id for a note path: ${JSON.stringify(id)}`);
	return encoded;
}

/**
 * After an idle compaction of a Workstream Chat: the full summary as a note under the Workstream's scratch folder, and a
 * host-written `checkpoint.replaced` for this session that points to it, carrying the previous checkpoint's remains, next,
 * waitingOn, nextSessionPrompt and sessionTitle forward, so `/back` orients on the latest state. Returns the note path;
 * a Chat without a home Workstream (`workstreamId` undefined) writes nothing. The checkpoint is skipped (the note file
 * stays) when the baseline could not be read, the session's checkpoint is stale or its health changed since it, a turn started since
 * (`stale`), or another session of the Workstream checkpointed after this one. Rerun for the same `firedAt` (a restart),
 * it keeps the note file it wrote and skips the checkpoint it already replaced.
 */
export async function writeIdleNote(
	store: () => WorkstreamStore,
	request: {
		workstreamId: string | undefined;
		sessionId: string;
		summary: string;
		/** When the timer fired: names the note file. */
		firedAt: number;
		/** `checkpointState` of this session when the timer fired; undefined: unreadable, so no checkpoint. */
		checkpoint?: string;
		/** True once a newer turn started: its checkpoint, or the owner's, is fresher than this note. */
		stale?: () => boolean | Promise<boolean>;
	},
	options: { scratch?: string } = {},
): Promise<string | undefined> {
	const { workstreamId, sessionId, summary } = request;
	if (workstreamId === undefined) return undefined;
	const workstreams = store();
	const member = (snapshot: Awaited<ReturnType<WorkstreamStore["inspect"]>>) => {
		const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
		if (session?.status !== "active") throw new Error(`session ${sessionId} is ${session?.status ?? "not a member"} in ${workstreamId}`);
		return session;
	};
	let snapshot = await workstreams.inspect(workstreamId);
	member(snapshot);
	const scratch = resolve(options.scratch ?? join(homedir(), ".pi-workbench", "scratch"));
	const dir = join(scratch, segment(workstreamId), "idle-notes");
	// Colons replaced: the timestamp stays a valid file name on Windows too.
	const path = join(dir, `${new Date(request.firedAt).toISOString().replaceAll(":", "-")}-${segment(sessionId)}.md`);
	if (!path.startsWith(scratch + sep)) throw new Error(`note path ${path} leaves ${scratch}`);
	await mkdir(dir, { recursive: true });
	try {
		await writeFile(path, `${summary}\n`, { flag: "wx" });
	} catch (error) {
		// Written by an earlier attempt for the same compaction: kept as it is, never truncated.
		if ((error as { code?: string }).code !== "EEXIST") throw error;
	}
	if (request.checkpoint === undefined) return path;
	// One retry: another writer may move the revision between the read and the append.
	for (let attempt = 0; ; attempt += 1) {
		const session = member(snapshot);
		const previous = session.latestCheckpoint;
		// Guidance from another Chat of this Workstream as new as this one's outranks a host note (the summary shows the newest).
		const newer = snapshot.sessions.some((other) => other.id !== sessionId && other.latestCheckpoint !== null && other.latestCheckpoint.recordedAt >= (previous?.recordedAt ?? ""));
		// A stale checkpoint stays marked stale: a host note must not clear the mark.
		if (newer || session.checkpointStaleness != null || checkpointState(session) !== request.checkpoint || (await request.stale?.()) === true) return path;
		const content: Omit<Checkpoint, "id"> = {
			whatChanged: `Idle compaction before cache expiry (host-written note, not reviewed by the model): ${lead(summary)}`.slice(0, TEXT_LIMIT),
			remains: previous?.remains ?? NONE,
			next: previous?.next ?? NONE,
			...(previous?.waitingOn == null ? {} : { waitingOn: previous.waitingOn }),
			...(previous?.nextSessionPrompt == null ? {} : { nextSessionPrompt: previous.nextSessionPrompt }),
			...(previous?.sessionTitle == null ? {} : { sessionTitle: previous.sessionTitle }),
			// At most 20 references: the note path always stays.
			references: [...(previous?.references ?? []).filter((reference) => reference !== path).slice(-19), path],
		};
		const records = [{ type: "checkpoint.replaced" as const, producer: IDLE_NOTE_PRODUCER, sourceSessionId: sessionId, payload: { sessionId, checkpoint: { id: `cp-idle-${hash([workstreamId, sessionId, snapshot.revision, content])}`, ...content } } }];
		const append = { workstreamId, expectedRevision: snapshot.revision, records };
		try {
			await workstreams.append({ ...append, idempotencyKey: `idle-note-${hash(append)}` });
			return path;
		} catch (error) {
			if (attempt > 0 || (error as { code?: string }).code !== "STALE_REVISION") throw error;
		}
		snapshot = await workstreams.inspect(workstreamId);
	}
}
