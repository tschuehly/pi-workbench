// Idle prompt-cache compaction (src/idle-compact.ts): when the fired timer compacts, when it is armed, and the
// host-written Workstream note of a Workstream Chat.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Api, Model, Usage } from "@earendil-works/pi-ai";
import { InMemoryWorkstreamAdapter, WorkstreamStore } from "../../workstream-store/src/index.js";
// A namespace import: a test of an export the code lacks fails on its own instead of failing the file.
import * as idle from "../src/idle-compact.ts";

// Outside PI_TMP: the store refuses references into swept temporary folders.
mkdirSync(join(import.meta.dirname, "..", ".runs"), { recursive: true });
const root = mkdtempSync(join(import.meta.dirname, "..", ".runs", "idle-note-"));
after(() => rmSync(root, { recursive: true, force: true }));

const due = { isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, viewed: true, promptTokens: 80_000, compacted: false };

test("the fired timer compacts only an idle, viewed Chat with a large prompt, once per idle stretch", () => {
	assert.equal(idle.idleCompactDue(due), true);
	for (const [field, value] of [["isStreaming", true], ["isCompacting", true], ["isBashRunning", true], ["pendingMessageCount", 1], ["viewed", false], ["promptTokens", 79_999], ["compacted", true]] as const)
		assert.equal(idle.idleCompactDue({ ...due, [field]: value }), false, `${field}: ${String(value)} blocks it`);
});

const usage = (cacheRead: number, cacheWrite: number, cacheWrite1h?: number): Usage => ({ input: 0, output: 1, cacheRead, cacheWrite, ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }), totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const model = (promptCache?: Record<string, number>, extra: object = {}) => ({ provider: "anthropic", id: "claude", promptCache, ...extra }) as unknown as Model<Api>;
const tiers = { short: 300, long: 3600 };
const delay = (m: Model<Api> | undefined, usages: Usage[]) => (idle.idleDelayMs as (m: Model<Api> | undefined, u: Usage[]) => number | undefined)(m, usages);

test("the timer fires a minute before the cache entry expires, counted from the request's start: the long tier only with evidence; no TTL, no timer", () => {
	assert.equal(delay(model(tiers), [usage(0, 90_000, 90_000)]), 3_540_000, "a 1 h cache write");
	assert.equal(delay(model(tiers), [usage(90_000, 0), usage(0, 90_000, 90_000)]), 3_540_000, "a read after a 1 h write on this model");
	assert.equal(delay(model(tiers), [usage(90_000, 0), usage(0, 90_000, 0), usage(0, 90_000, 90_000)]), 240_000, "a read after a write without its 1 h part: the short tier");
	assert.equal(delay(model(tiers), [usage(0, 90_000, 0)]), 240_000, "a cache write without its 1 h part: the short tier");
	assert.equal(delay(model(tiers), [usage(0, 90_000)]), 240_000, "a cache write that reports no 1 h part: no evidence, the short tier");
	assert.equal(delay(model(tiers), [usage(90_000, 0)]), 240_000, "a read with no earlier write seen: the short tier");
	assert.equal(delay(model(tiers, { compat: { supportsLongCacheRetention: false } }), [usage(0, 90_000, 90_000)]), 240_000, "compat turns the long tier off");
	assert.equal(delay(model({ short: 300 }), [usage(0, 90_000, 90_000)]), 240_000, "a model without a long tier: the short one");
	assert.equal(delay(model(undefined), [usage(0, 90_000)]), undefined, "no TTL");
	assert.equal(delay(undefined, [usage(0, 90_000)]), undefined, "an unknown model");
	assert.equal(delay(model(tiers), []), undefined, "no request");
});

test("an uncached request arms nothing; Codex gets its measured 30 min only for Sol, Terra and Astra", () => {
	assert.equal(delay(model(tiers), [usage(0, 0, 0)]), undefined, "neither read nor write: nothing cached to keep");
	const codex = (id: string) => model(undefined, { provider: "openai-codex", id });
	for (const id of ["gpt-6.2-sol", "gpt-5.6-terra", "gpt-6.2-astra"]) assert.equal(delay(codex(id), [usage(50_000, 0)]), 29 * 60_000, id);
	for (const id of ["gpt-6-luna", "gpt-6-mini", "codex-other"]) assert.equal(delay(codex(id), [usage(50_000, 0)]), undefined, `${id}: unknown TTL`);
	assert.equal(delay(codex("gpt-6.2-sol"), [usage(0, 0)]), undefined, "Codex, uncached");
});

async function workstream(id: string, sessions: string[]) {
	const store = new WorkstreamStore({ adapter: new InMemoryWorkstreamAdapter() });
	let revision = (await store.create({ workstreamId: id, idempotencyKey: "c", title: "Idle", producer: "session" })).acceptedRevision;
	for (const sessionId of sessions) {
		const payload = { sessionId, associationKey: sessionId };
		revision = (await store.append({ workstreamId: id, expectedRevision: revision, idempotencyKey: `j-${sessionId}`, records: [{ type: "session.pending", producer: "session", payload }, { type: "session.confirmed", producer: "session", payload }] })).acceptedRevision;
	}
	const checkpoint = async (sessionId: string, checkpoint: { id: string; [field: string]: unknown }) => {
		const { revision: current } = await store.inspect(id);
		await store.append({ workstreamId: id, expectedRevision: current, idempotencyKey: `cp-${String(current)}`, records: [{ type: "checkpoint.replaced", producer: "session", sourceSessionId: sessionId, payload: { sessionId, checkpoint: checkpoint as never } }] });
	};
	const session = async (sessionId: string) => (await store.inspect(id)).sessions.find((s) => s.id === sessionId);
	const state = async (sessionId: string) => idle.checkpointState(await session(sessionId));
	return { store, checkpoint, session, state };
}
const T0 = Date.parse("2026-01-02T03:04:05.000Z");
const note = (workstreamId: string, sessionId: string, at = T0) => join(root, encodeURIComponent(workstreamId), "idle-notes", `${new Date(at).toISOString().replaceAll(":", "-")}-${encodeURIComponent(sessionId)}.md`);

test("a Workstream Chat gets the summary as a note and a host-written checkpoint carrying the previous one forward; any other Chat writes nothing", async () => {
	const ws = await workstream("ws-1", ["chat-1"]);
	const previous = { id: "cp-1", whatChanged: "Built it.", remains: "Review.", next: "Merge it.", waitingOn: "owner" as const, sessionTitle: "Idle timer", references: ["docs/a.md"] };
	await ws.checkpoint("chat-1", previous);
	const summary = "## Goal\nShip the idle timer. It compacts before the cache expires.\n\n## Progress\n- Done.";

	assert.equal(await idle.writeIdleNote(() => ws.store, { workstreamId: undefined, sessionId: "chat-2", summary, firedAt: T0 }, { scratch: root }), undefined);
	assert.deepEqual(readdirSync(root), [], "a Chat without a Workstream writes no note");

	const path = await idle.writeIdleNote(() => ws.store, { workstreamId: "ws-1", sessionId: "chat-1", summary, firedAt: T0, checkpoint: await ws.state("chat-1") }, { scratch: root });
	assert.equal(path, note("ws-1", "chat-1"));
	assert.equal(readFileSync(path!, "utf8"), `${summary}\n`, "the full summary");
	const checkpoint = (await ws.session("chat-1"))!.latestCheckpoint!;
	assert.equal(checkpoint.whatChanged, "Idle compaction before cache expiry (host-written note, not reviewed by the model): Ship the idle timer. It compacts before the cache expires. Done.");
	assert.deepEqual({ remains: checkpoint.remains, next: checkpoint.next, waitingOn: checkpoint.waitingOn, nextSessionPrompt: checkpoint.nextSessionPrompt, sessionTitle: checkpoint.sessionTitle }, { remains: "Review.", next: "Merge it.", waitingOn: "owner", nextSessionPrompt: null, sessionTitle: "Idle timer" });
	assert.deepEqual(checkpoint.references, ["docs/a.md", path]);
	const events = await ws.store.watch({ workstreamId: "ws-1" });
	const last = events.mode === "replay" ? (events.events.at(-1)?.records[0] as { producer: string }) : undefined;
	assert.equal(last?.producer, idle.IDLE_NOTE_PRODUCER, "marked host-written");
});

test("the host checkpoint never replaces a fresher one: a changed checkpoint, a turn since, an unreadable baseline, or a changed stale mark keep it, the note file stays; a session that is not active writes nothing", async () => {
	const ws = await workstream("ws-2", ["chat-1"]);
	const baseline = await ws.state("chat-1");
	await ws.checkpoint("chat-1", { id: "cp-model", whatChanged: "Wrote it during the owner's turn.", remains: "Review.", next: "Merge it." });
	const latest = async () => (await ws.session("chat-1"))!.latestCheckpoint?.id;
	const write = (request: object, at: number) => idle.writeIdleNote(() => ws.store, { workstreamId: "ws-2", sessionId: "chat-1", summary: "## Goal\nKeep it.", firedAt: at, ...request }, { scratch: root });

	assert.ok(existsSync((await write({ checkpoint: baseline }, T0))!), "the note file is written");
	assert.equal(await latest(), "cp-model", "the checkpoint written after the timer fired stays");
	await write({ checkpoint: await ws.state("chat-1"), stale: () => true }, T0 + 1);
	assert.equal(await latest(), "cp-model", "a turn started since the timer fired: its checkpoint stays");
	const unreadable = await write({}, T0 + 2);
	assert.ok(existsSync(unreadable!), "an unreadable baseline still writes the note file");
	assert.equal(await latest(), "cp-model", "an unreadable baseline writes no checkpoint");

	// The same checkpoint ID, but marked stale since the baseline: its health changed, so it stays.
	const healthy = await ws.state("chat-1");
	const { revision } = await ws.store.inspect("ws-2");
	await ws.store.append({ workstreamId: "ws-2", expectedRevision: revision, idempotencyKey: "stale", records: [{ type: "checkpoint.stale", producer: "session", sourceSessionId: "chat-1", payload: { sessionId: "chat-1", checkpointId: "cp-model", reason: "repository moved" } }] });
	await write({ checkpoint: healthy }, T0 + 3);
	assert.equal(await latest(), "cp-model", "a stale mark since the baseline keeps it");
	await write({ checkpoint: await ws.state("chat-1"), stale: () => false }, T0 + 4);
	assert.equal(await latest(), "cp-model", "already stale when the timer fired: the host note keeps it");
	assert.equal((await ws.session("chat-1"))!.checkpointStaleness?.checkpointId, "cp-model", "and its stale mark");
	assert.ok(existsSync(note("ws-2", "chat-1", T0 + 4)), "the note file is still written");

	const after = (await ws.store.inspect("ws-2")).revision;
	await ws.store.append({ workstreamId: "ws-2", expectedRevision: after, idempotencyKey: "pending", records: [{ type: "session.pending", producer: "session", payload: { sessionId: "chat-2", associationKey: "chat-2" } }] });
	await assert.rejects(idle.writeIdleNote(() => ws.store, { workstreamId: "ws-2", sessionId: "chat-2", summary: "x", firedAt: T0 + 5, checkpoint: "[]" }, { scratch: root }), /is pending/);
	assert.ok(!existsSync(note("ws-2", "chat-2", T0 + 5)), "no note file for a session that is not active");
});

test("in a multi-Chat Workstream the host note never supersedes newer guidance from another Chat", async () => {
	const ws = await workstream("ws-3", ["chat-1", "chat-2"]);
	await ws.checkpoint("chat-1", { id: "cp-1", whatChanged: "Mine.", remains: "R.", next: "N." });
	await ws.checkpoint("chat-2", { id: "cp-2", whatChanged: "The other Chat's newer guidance.", remains: "R2.", next: "N2." });
	const path = await idle.writeIdleNote(() => ws.store, { workstreamId: "ws-3", sessionId: "chat-1", summary: "## Goal\nOld.", firedAt: T0, checkpoint: await ws.state("chat-1") }, { scratch: root });
	assert.ok(existsSync(path!), "the note file stays");
	assert.equal((await ws.session("chat-1"))!.latestCheckpoint?.id, "cp-1", "another Chat checkpointed later: no host checkpoint");
});

test("the note path: the Workstream ID encoded as one folder, the Chat ID in the file name, a traversal ID refused, an existing note never truncated", async () => {
	const ws = await workstream("team/ws:4", ["chat/x"]);
	const path = await idle.writeIdleNote(() => ws.store, { workstreamId: "team/ws:4", sessionId: "chat/x", summary: "first", firedAt: T0, checkpoint: await ws.state("chat/x") }, { scratch: root });
	assert.equal(path, join(root, "team%2Fws%3A4", "idle-notes", "2026-01-02T03-04-05.000Z-chat%2Fx.md"));
	// Rerun for the same compaction (a restart): the file it wrote stays as it is.
	writeFileSync(path!, "first, as written\n");
	await idle.writeIdleNote(() => ws.store, { workstreamId: "team/ws:4", sessionId: "chat/x", summary: "second", firedAt: T0 }, { scratch: root });
	assert.equal(readFileSync(path!, "utf8"), "first, as written\n", "never truncated or overwritten");
	const traversal = { inspect: async () => ({ revision: 1, sessions: [{ id: "..", status: "active" }] }) } as unknown as WorkstreamStore;
	await assert.rejects(idle.writeIdleNote(() => traversal, { workstreamId: "ws-5", sessionId: "..", summary: "x", firedAt: T0 }, { scratch: root }), /invalid id/);
	const escape = { inspect: async () => ({ revision: 1, sessions: [{ id: "chat-1", status: "active" }] }) } as unknown as WorkstreamStore;
	await assert.rejects(idle.writeIdleNote(() => escape, { workstreamId: "..", sessionId: "chat-1", summary: "x", firedAt: T0 }, { scratch: root }), /invalid id/);
	assert.ok(!existsSync(join(root, "..", "idle-notes")), "nothing written outside the scratch root");
});

test("the timer's summary comes from the provider's own Sonnet or Terra, never another provider's", () => {
	assert.deepEqual(idle.summaryModelFor({ provider: "anthropic", modelId: "claude-opus-5-5" }), { provider: "anthropic", modelId: "claude-sonnet-5-5" });
	assert.deepEqual(idle.summaryModelFor({ provider: "openai-codex", modelId: "gpt-6.2-sol" }), { provider: "openai-codex", modelId: "gpt-6.1-terra" });
	assert.equal(idle.summaryModelFor({ provider: "github-copilot", modelId: "claude-opus-5-5" }), undefined);
});

test("a heavy Chat model outside the routing roster still gets its provider's summary writer", () => {
	assert.deepEqual(idle.summaryModelFor({ provider: "anthropic", modelId: "claude-opus-5" }), { provider: "anthropic", modelId: "claude-sonnet-5-5" });
	assert.deepEqual(idle.summaryModelFor({ provider: "openai-codex", modelId: "gpt-6.1-sol" }), { provider: "openai-codex", modelId: "gpt-6.1-terra" });
});

test("a Chat with no cheaper summary writer gets none: the writer itself, or a light-tier model", () => {
	assert.equal(idle.summaryModelFor({ provider: "anthropic", modelId: "claude-sonnet-5-5" }), undefined, "a Sonnet Chat");
	assert.equal(idle.summaryModelFor({ provider: "openai-codex", modelId: "gpt-6.1-terra" }), undefined, "a Terra Chat");
	assert.equal(idle.summaryModelFor({ provider: "openai-codex", modelId: "gpt-6-luna" }), undefined, "a light-tier Luna Chat");
});

test("the stored checkpoint baseline is a digest: a failure reason's secret never reaches it, a changed reason still changes it", async () => {
	const secret = "idleBaselineSecret-7f3a9c1e5b2d";
	const ws = await workstream("ws-7", ["chat-1"]);
	await ws.checkpoint("chat-1", { id: "cp-1", whatChanged: "W.", remains: "R.", next: "N." });
	const fail = async (reason: string) => {
		const { revision } = await ws.store.inspect("ws-7");
		await ws.store.append({ workstreamId: "ws-7", expectedRevision: revision, idempotencyKey: `f-${String(revision)}`, records: [{ type: "checkpoint.failed", producer: "session", sourceSessionId: "chat-1", payload: { sessionId: "chat-1", reason } }] });
		return ws.state("chat-1");
	};
	const first = await fail(`token ${secret} rejected`);
	assert.ok(!first.includes(secret), `no secret in the baseline: ${first}`);
	assert.notEqual(await fail("another reason"), first, "a changed failure still changes the baseline");
});
