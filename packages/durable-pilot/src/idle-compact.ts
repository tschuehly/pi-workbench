// Idle prompt-cache compaction: shortly before the prompt cache of a viewed, idle Chat expires, compact it, so the
// owner's next message pays for a short summary instead of rewriting a cold cache of the whole context.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Api, type CacheRetention, getPromptCacheTtlMs, type Model } from "@earendil-works/pi-ai";
import type { Checkpoint, WorkstreamStore } from "../../workstream-store/src/index.js";

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

const MIN_PROMPT_TOKENS = 80_000;
const LEAD_MS = 60_000;
const TEXT_LIMIT = 4_000;
const NONE = "Unknown: this session has no earlier checkpoint; read the idle note.";

/** When the idle timer fires after a turn ends: a minute before the last request's cache entry expires; none without a TTL. */
export function idleDelayMs(model: Model<Api> | undefined): number | undefined {
	const ttl = model === undefined ? undefined : getPromptCacheTtlMs(model, { cacheRetention: CACHE_RETENTION });
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

/**
 * After an idle compaction of a Workstream Chat: the full summary as a note under the Workstream's scratch folder, and a
 * host-written `checkpoint.replaced` for this session that points to it, carrying the previous checkpoint's remains, next,
 * waitingOn, nextSessionPrompt and sessionTitle forward, so `/back` orients on the latest state. Returns the note path;
 * a Chat without a home Workstream (`workstreamId` undefined) writes nothing.
 */
export async function writeIdleNote(
	store: () => WorkstreamStore,
	request: { workstreamId: string | undefined; sessionId: string; summary: string },
	options: { scratch?: string; now?: Date } = {},
): Promise<string | undefined> {
	const { workstreamId, sessionId, summary } = request;
	if (workstreamId === undefined) return undefined;
	const workstreams = store();
	const dir = join(options.scratch ?? join(homedir(), ".pi-workbench", "scratch"), workstreamId, "idle-notes");
	await mkdir(dir, { recursive: true });
	// Colons replaced: the timestamp stays a valid file name on Windows too.
	const path = join(dir, `${(options.now ?? new Date()).toISOString().replaceAll(":", "-")}.md`);
	await writeFile(path, `${summary}\n`);
	// One retry: another writer may move the revision between the read and the append.
	for (let attempt = 0; ; attempt += 1) {
		const snapshot = await workstreams.inspect(workstreamId);
		const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
		if (session?.status !== "active") throw new Error(`session ${sessionId} is ${session?.status ?? "not a member"} in ${workstreamId}`);
		const previous = session.latestCheckpoint;
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
	}
}
