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

test("the timer fires a minute before the long-retention cache entry expires; no TTL, no timer", () => {
	const model = (promptCache?: Record<string, number>) => ({ promptCache }) as unknown as Model<Api>;
	assert.equal(idleDelayMs(model({ short: 300, long: 3600 })), 3_540_000, "the long tier");
	assert.equal(idleDelayMs(model({ short: 300 })), undefined, "a model without a long tier");
	assert.equal(idleDelayMs(undefined), undefined, "an unknown model");
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
