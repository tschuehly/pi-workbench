// Idle prompt-cache compaction (src/idle-compact.ts): when the fired timer compacts, when it is armed, and the
// host-written Workstream note of a Workstream Chat.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { InMemoryWorkstreamAdapter, WorkstreamStore } from "../../workstream-store/src/index.js";
import { IDLE_NOTE_PRODUCER, idleCompactDue, idleDelayMs, writeIdleNote } from "../src/idle-compact.ts";

// Outside PI_TMP: the store refuses references into swept temporary folders.
mkdirSync(join(import.meta.dirname, "..", ".runs"), { recursive: true });
const root = mkdtempSync(join(import.meta.dirname, "..", ".runs", "idle-note-"));
after(() => rmSync(root, { recursive: true, force: true }));

const due = { isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, viewed: true, promptTokens: 80_000, compacted: false };

test("the fired timer compacts only an idle, viewed Chat with a large prompt, once per idle stretch", () => {
	assert.equal(idleCompactDue(due), true);
	for (const [field, value] of [["isStreaming", true], ["isCompacting", true], ["isBashRunning", true], ["pendingMessageCount", 1], ["viewed", false], ["promptTokens", 79_999], ["compacted", true]] as const)
		assert.equal(idleCompactDue({ ...due, [field]: value }), false, `${field}: ${String(value)} blocks it`);
});

test("the timer fires a minute before the cache entry expires: the long tier only where the request got it; no TTL, no timer", () => {
	const model = (promptCache?: Record<string, number>, extra: object = {}) => ({ provider: "anthropic", id: "claude", promptCache, ...extra }) as unknown as Model<Api>;
	const usage = (cacheWrite: number, cacheWrite1h?: number) => ({ input: 0, output: 1, cacheRead: 0, cacheWrite, ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }), totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
	const tiers = { short: 300, long: 3600 };
	assert.equal(idleDelayMs(model(tiers)), 3_540_000, "the long tier");
	assert.equal(idleDelayMs(model(tiers), usage(90_000, 90_000)), 3_540_000, "a 1 h cache write");
	assert.equal(idleDelayMs(model(tiers), usage(0, 0)), 3_540_000, "a cache read keeps the tier it was written with");
	assert.equal(idleDelayMs(model(tiers), usage(90_000, 0)), 240_000, "a cache write without its 1 h part: the short tier");
	assert.equal(idleDelayMs(model(tiers, { compat: { supportsLongCacheRetention: false } })), 240_000, "compat turns the long tier off");
	assert.equal(idleDelayMs(model({ short: 300 })), 240_000, "a model without a long tier: the short one");
	assert.equal(idleDelayMs(model(undefined)), undefined, "no TTL");
	assert.equal(idleDelayMs(undefined), undefined, "an unknown model");
	assert.equal(idleDelayMs(model(undefined, { provider: "openai-codex", id: "gpt-5.5-sol" })), 29 * 60_000, "Codex: the measured 30 min");
	assert.equal(idleDelayMs(model(undefined, { provider: "openai-codex", id: "gpt-5.5-luna" })), undefined, "Codex Luna: too short to act on");
});

test("a Workstream Chat gets the summary as a note and a host-written checkpoint carrying the previous one forward; any other Chat writes nothing", async () => {
	const store = new WorkstreamStore({ adapter: new InMemoryWorkstreamAdapter() });
	const created = await store.create({ workstreamId: "ws-1", idempotencyKey: "c", title: "Idle", producer: "session" });
	const payload = { sessionId: "chat-1", associationKey: "chat-1" };
	const joined = await store.append({ workstreamId: "ws-1", expectedRevision: created.acceptedRevision, idempotencyKey: "j", records: [{ type: "session.pending", producer: "session", payload }, { type: "session.confirmed", producer: "session", payload }] });
	const previous = { id: "cp-1", whatChanged: "Built it.", remains: "Review.", next: "Merge it.", waitingOn: "owner" as const, sessionTitle: "Idle timer", references: ["docs/a.md"] };
	await store.append({ workstreamId: "ws-1", expectedRevision: joined.acceptedRevision, idempotencyKey: "cp", records: [{ type: "checkpoint.replaced", producer: "session", sourceSessionId: "chat-1", payload: { sessionId: "chat-1", checkpoint: previous } }] });
	const summary = "## Goal\nShip the idle timer. It compacts before the cache expires.\n\n## Progress\n- Done.";

	assert.equal(await writeIdleNote(() => store, { workstreamId: undefined, sessionId: "chat-2", summary }, { scratch: root }), undefined);
	assert.deepEqual(readdirSync(root), [], "a Chat without a Workstream writes no note");

	const path = await writeIdleNote(() => store, { workstreamId: "ws-1", sessionId: "chat-1", summary }, { scratch: root, now: new Date("2026-01-02T03:04:05.000Z") });
	assert.equal(path, join(root, "ws-1", "idle-notes", "2026-01-02T03-04-05.000Z.md"));
	assert.ok(existsSync(path!));
	assert.equal(readFileSync(path!, "utf8"), `${summary}\n`, "the full summary");
	const session = (await store.inspect("ws-1")).sessions.find((s) => s.id === "chat-1")!;
	const checkpoint = session.latestCheckpoint!;
	assert.equal(checkpoint.whatChanged, "Idle compaction before cache expiry (host-written note, not reviewed by the model): Ship the idle timer. It compacts before the cache expires. Done.");
	assert.deepEqual({ remains: checkpoint.remains, next: checkpoint.next, waitingOn: checkpoint.waitingOn, nextSessionPrompt: checkpoint.nextSessionPrompt, sessionTitle: checkpoint.sessionTitle }, { remains: "Review.", next: "Merge it.", waitingOn: "owner", nextSessionPrompt: null, sessionTitle: "Idle timer" });
	assert.deepEqual(checkpoint.references, ["docs/a.md", path]);
	const events = await store.watch({ workstreamId: "ws-1" });
	const last = events.mode === "replay" ? (events.events.at(-1)?.records[0] as { producer: string }) : undefined;
	assert.equal(last?.producer, IDLE_NOTE_PRODUCER, "marked host-written");
});

test("the host checkpoint never replaces a fresher one: a turn since the timer fired or a changed checkpoint keeps it, the note file stays; a session that is not active writes nothing", async () => {
	const store = new WorkstreamStore({ adapter: new InMemoryWorkstreamAdapter() });
	const created = await store.create({ workstreamId: "ws-2", idempotencyKey: "c", title: "Fresh", producer: "session" });
	const payload = { sessionId: "chat-1", associationKey: "chat-1" };
	const joined = await store.append({ workstreamId: "ws-2", expectedRevision: created.acceptedRevision, idempotencyKey: "j", records: [{ type: "session.pending", producer: "session", payload }, { type: "session.confirmed", producer: "session", payload }] });
	const model = { id: "cp-model", whatChanged: "Wrote it during the owner's turn.", remains: "Review.", next: "Merge it." };
	await store.append({ workstreamId: "ws-2", expectedRevision: joined.acceptedRevision, idempotencyKey: "cp", records: [{ type: "checkpoint.replaced", producer: "session", sourceSessionId: "chat-1", payload: { sessionId: "chat-1", checkpoint: model } }] });
	const latest = async () => (await store.inspect("ws-2")).sessions.find((s) => s.id === "chat-1")!.latestCheckpoint?.id;
	const write = (request: object, at: string) => writeIdleNote(() => store, { workstreamId: "ws-2", sessionId: "chat-1", summary: "## Goal\nKeep it.", ...request }, { scratch: root, now: new Date(at) });

	const changed = await write({ checkpointId: null }, "2026-01-03T00:00:00.000Z");
	assert.ok(existsSync(changed!), "the note file is written");
	assert.equal(await latest(), "cp-model", "the checkpoint written after the timer fired stays");
	const ran = await write({ checkpointId: "cp-model", stale: () => true }, "2026-01-03T00:00:01.000Z");
	assert.ok(existsSync(ran!));
	assert.equal(await latest(), "cp-model", "a turn started since the timer fired: its checkpoint stays");
	await write({ checkpointId: "cp-model", stale: () => false }, "2026-01-03T00:00:02.000Z");
	assert.match((await latest())!, /^cp-idle-/, "unchanged since the timer fired: the host note replaces it");

	const revision = (await store.inspect("ws-2")).revision;
	await store.append({ workstreamId: "ws-2", expectedRevision: revision, idempotencyKey: "pending", records: [{ type: "session.pending", producer: "session", payload: { sessionId: "chat-2", associationKey: "chat-2" } }] });
	await assert.rejects(writeIdleNote(() => store, { workstreamId: "ws-2", sessionId: "chat-2", summary: "x" }, { scratch: root, now: new Date("2026-01-03T00:00:03.000Z") }), /is pending/);
	assert.ok(!existsSync(join(root, "ws-2", "idle-notes", "2026-01-03T00-00-03.000Z.md")), "no note file for a session that is not active");
});
