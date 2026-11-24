import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { askMessage, createLinker, describeError, loadState, remember, saveState, sendTelegram } from "./phone-link.mjs";

const TOKEN = "123456:SECRET-bot-token";

const opened = { type: "session.attention", sessionId: "chat 1", cwd: "/w", sessionName: "Release", kind: "ask", id: "ask-1", detail: "Ship it?" };

test("an opened question set becomes a fixed label and the Chat link, never its name or question", () => {
	assert.equal(askMessage(opened), "Pi needs an answer\nhttps://pi.tschuehly.de/?session=chat+1");
});

test("other events and attention kinds send nothing", () => {
	assert.equal(askMessage({ ...opened, kind: "attention" }), undefined);
	assert.equal(askMessage({ type: "status.update" }), undefined);
	assert.equal(askMessage({ ...opened, id: "" }), undefined);
	assert.equal(askMessage(null), undefined);
});

test("live and recovery sends carry no Chat name or question text", async () => {
	const { linker, sent } = harness({
		sessions: [{ id: "s1", cwd: "/w", name: "Durable · Secret plan", modified: "2026-05-01T11:00:00Z" }],
		asks: { s1: [{ askId: "r", questions: [{ id: "q", question: "Leak the key?" }] }] },
	});
	await linker.onEvent({ ...opened, sessionName: "Secret plan", detail: "Leak the key?" });
	await linker.reconcile();
	assert.deepEqual(sent, ["Pi needs an answer\nhttps://pi.tschuehly.de/?session=chat+1", "Pi needs an answer\nhttps://pi.tschuehly.de/?session=s1"]);
});

test("each ask id is sent once and the list stays bounded", () => {
	const sent = [];
	assert.equal(remember(sent, "a"), true);
	assert.equal(remember(sent, "a"), false);
	for (let i = 0; i < 600; i += 1) remember(sent, `x${i}`);
	assert.equal(sent.length, 500);
	assert.equal(sent.at(-1), "x599");
});

test("a malformed credential file fails with fixed text that quotes none of it", async (t) => {
	const dir = mkdtempSync(join(process.env.PI_TMP ?? tmpdir(), "phone-link-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const config = join(dir, "config.json");
	// An unquoted token: V8's JSON.parse message quotes the text around it.
	writeFileSync(config, `{"telegram": {"botToken": SECRET-bot-token, "chatId": "1"}}`);
	const error = await sendTelegram("hi", config).then(() => undefined, (caught) => caught);
	assert.ok(error instanceof Error);
	assert.doesNotMatch(describeError(error), /SECRET/u);
	assert.doesNotMatch(error.message, /SECRET/u);
	assert.match(describeError(error), /config .* is unreadable or not valid JSON/u);
});

test("transport failures log only an allowlisted code or HTTP status", () => {
	const fetchFailed = new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/sendMessage`, { cause: { code: "ECONNRESET", message: TOKEN } });
	assert.equal(describeError(fetchFailed), "ECONNRESET");
	assert.equal(describeError(new Error(TOKEN)), "unknown error");
	assert.equal(describeError({ code: `bot${TOKEN}` }), "unknown error");
	assert.equal(describeError(new DOMException("The operation timed out", "TimeoutError")), "TimeoutError");
});

const transportError = () => new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
const opening = (id, sessionId = "s1") => ({ ...opened, id, sessionId, detail: `Question ${id}?` });

/**
 * A linker over in-memory effects: `saved` holds a copy of every state write, `sent` every Telegram text.
 * `failing` holds Chat ids whose ask read fails; `reading.max` counts the most ask reads at once; `clock.now` is the time.
 * @param {{ state?: any, send?: (text: string) => Promise<void>, sessions?: any[], asks?: Record<string, any[]>, retryDelays?: number[], failing?: Set<string>, clock?: { now: number } }} [options]
 */
function harness({ state = { delivered: [], pending: [] }, send, sessions = [], asks = {}, retryDelays = [], failing = new Set(), clock = { now: Date.parse("2026-05-01T12:00:00Z") } } = {}) {
	const saved = [];
	const sent = [];
	const reads = [];
	const reading = { now: 0, max: 0 };
	const getJson = async (path) => {
		reads.push(path);
		if (path.startsWith("/api/sessions/recent")) return sessions;
		const id = decodeURIComponent(path.split("/")[3]?.split("?")[0] ?? "");
		reading.max = Math.max(reading.max, ++reading.now);
		await new Promise((resolve) => setImmediate(resolve));
		reading.now -= 1;
		if (failing.has(id)) throw transportError();
		return { pendingAsks: asks[id] ?? [] };
	};
	const linker = createLinker({
		send: async (text) => { sent.push(text); if (send !== undefined) await send(text); },
		getJson,
		state,
		save: (next) => saved.push(structuredClone(next)),
		wait: async () => {},
		now: () => clock.now,
		retryDelays,
	});
	return { linker, state, saved, sent, reads, reading };
}

test("a send that fails while another succeeds is never saved as delivered", async () => {
	const gates = {};
	const send = (text) => new Promise((resolve, reject) => { gates[text.endsWith("=sa") ? "a" : "b"] = { resolve, reject }; });
	const { linker, state, saved } = harness({ send: (text) => send(text) });
	const a = linker.onEvent(opening("a", "sa"));
	const b = linker.onEvent(opening("b", "sb"));
	await new Promise((resolve) => setImmediate(resolve));
	gates.a.resolve();
	await a;
	gates.b.reject(transportError());
	await b;
	assert.ok(saved.length > 0);
	for (const snapshot of saved) assert.ok(!snapshot.delivered.includes("b"), `b saved as delivered: ${JSON.stringify(snapshot)}`);
	assert.deepEqual(state.delivered, ["a"]);
	assert.deepEqual(state.pending.map((ask) => ask.id), ["b"]);
});

test("a transient failure is retried with backoff and sent once", async () => {
	let failures = 2;
	const { linker, state, sent } = harness({ retryDelays: [1, 2, 3], send: async () => { if (failures-- > 0) throw transportError(); } });
	await linker.onEvent(opening("a"));
	await linker.onEvent(opening("a"));
	assert.equal(sent.length, 3);
	assert.deepEqual(state.delivered, ["a"]);
	assert.deepEqual(state.pending, []);
});

test("a reconcile sends open asks missed or failed, once, and reads only changed or failed Chats", async () => {
	const ask = (askId) => ({ askId, questions: [{ id: "q", question: `Question ${askId}?\nmore` }] });
	const { linker, state, sent, reads } = harness({
		state: { delivered: ["old"], pending: [{ id: "failed", sessionId: "s2", cwd: "/w" }, { id: "closed", sessionId: "s2", cwd: "/w" }], checkedAt: "2026-05-01T10:00:00Z" },
		sessions: [
			{ id: "s1", cwd: "/w", name: "Durable · Release", modified: "2026-05-01T11:00:00Z" },
			{ id: "s2", cwd: "/w", name: "Durable · Fix", modified: "2026-05-01T08:00:00Z" },
			{ id: "s3", cwd: "/w", name: "Durable · Cold", modified: "2026-05-01T08:00:00Z" },
		],
		asks: { s1: [ask("new"), ask("old")], s2: [ask("failed")], s3: [ask("cold")] },
	});
	await linker.reconcile();
	assert.deepEqual(sent.sort(), ["Pi needs an answer\nhttps://pi.tschuehly.de/?session=s1", "Pi needs an answer\nhttps://pi.tschuehly.de/?session=s2"]);
	assert.ok(!reads.some((path) => path.includes("/s3/")), "a Chat unchanged since the last reconcile is not read");
	assert.deepEqual(state.pending, []);
	assert.equal(state.checkedAt, "2026-05-01T12:00:00.000Z");
	await linker.reconcile();
	assert.equal(sent.length, 2);
});

test("an exhausted send waits for the next reconcile, and a status.update with an unseen ask reconciles that Chat", async () => {
	let down = true;
	const { linker, state, sent } = harness({
		retryDelays: [1],
		send: async () => { if (down) throw transportError(); },
		sessions: [{ id: "s1", cwd: "/w", name: "Durable · Release", modified: "2026-05-01T11:00:00Z" }],
		asks: { s1: [{ askId: "a", questions: [{ id: "q", question: "Ship it?" }] }, { askId: "z", questions: [] }] },
	});
	await linker.onEvent(opening("a"));
	assert.equal(sent.length, 2);
	assert.deepEqual(state.pending.map((ask) => ask.id), ["a"]);
	down = false;
	assert.equal(linker.onEvent({ type: "status.update", status: { sessionId: "s1", pendingAsks: [{ askId: "a" }] } }), undefined, "a pending ask waits for its reconcile");
	await linker.onEvent({ type: "status.update", status: { sessionId: "s1", pendingAsks: [{ askId: "a" }, { askId: "z" }] } });
	assert.deepEqual(state.delivered.sort(), ["a", "z"]);
	assert.deepEqual(state.pending, []);
	assert.equal(sent.at(-1), "Pi needs an answer\nhttps://pi.tschuehly.de/?session=s1");
	assert.equal(linker.onEvent({ type: "status.update", status: { sessionId: "s1", pendingAsks: [{ askId: "z" }] } }), undefined);
});

const ask = (askId) => ({ askId, questions: [{ id: "q", question: `Question ${askId}?` }] });

test("a first connect without a watermark sends the open asks of Chats changed in the last day", async () => {
	const { linker, sent, reads } = harness({
		sessions: [
			{ id: "s1", cwd: "/w", name: "Durable · Release", modified: "2026-05-01T09:00:00Z" },
			{ id: "s2", cwd: "/w", name: "Durable · Old", modified: "2026-04-28T09:00:00Z" },
		],
		asks: { s1: [ask("open")], s2: [ask("stale")] },
	});
	await linker.reconcile();
	assert.deepEqual(sent, ["Pi needs an answer\nhttps://pi.tschuehly.de/?session=s1"]);
	assert.ok(!reads.some((path) => path.includes("/s2/")), "a Chat unchanged for days is not read");
});

test("a failed ask read is retried at the next reconcile, though the watermark moved past it", async () => {
	const failing = new Set(["s1"]);
	const { linker, state, sent } = harness({
		state: { delivered: [], pending: [], checkedAt: "2026-05-01T10:00:00Z" },
		sessions: [{ id: "s1", cwd: "/w", name: "Durable · Release", modified: "2026-05-01T11:00:00Z" }],
		asks: { s1: [ask("a")] },
		failing,
	});
	await linker.reconcile();
	assert.deepEqual(sent, []);
	failing.clear();
	await linker.reconcile();
	assert.deepEqual(sent, ["Pi needs an answer\nhttps://pi.tschuehly.de/?session=s1"]);
	assert.deepEqual(state.recheck, []);
});

test("a Chat whose read keeps failing is given up with its pending asks", async () => {
	const { linker, state } = harness({ state: { delivered: [], pending: [{ id: "p", sessionId: "gone", cwd: "/x" }], checkedAt: "2026-05-01T11:00:00Z" }, failing: new Set(["gone"]) });
	for (let i = 0; i < 5; i += 1) await linker.reconcile(["gone"]);
	assert.equal(state.recheck[0]?.failures, 5);
	await linker.reconcile(["gone"]);
	assert.deepEqual(state.recheck, []);
	assert.deepEqual(state.pending, []);
});

test("a pending ask of a Chat outside the recent list is read by its saved id and cwd", async () => {
	const { linker, state, sent, reads } = harness({
		state: { delivered: [], pending: [{ id: "p", sessionId: "far", cwd: "/x" }], checkedAt: "2026-05-01T11:00:00Z" },
		asks: { far: [ask("p")] },
	});
	await linker.reconcile(["far"]);
	assert.deepEqual(sent, ["Pi needs an answer\nhttps://pi.tschuehly.de/?session=far"]);
	assert.ok(reads.includes("/api/sessions/far/asks?cwd=%2Fx"));
	assert.ok(!reads.some((path) => path.startsWith("/api/sessions/recent")), "saved Chats need no Chat list");
	assert.deepEqual(state.pending, []);
});

test("a reconnect reads at most two Chats at once", async () => {
	const sessions = ["a", "b", "c", "d", "e"].map((id) => ({ id, cwd: "/w", name: id, modified: "2026-05-01T11:00:00Z" }));
	const { linker, reads, reading } = harness({ state: { delivered: [], pending: [], checkedAt: "2026-05-01T10:00:00Z" }, sessions });
	await linker.reconcile();
	assert.equal(reads.filter((path) => path.includes("/asks")).length, 5);
	assert.equal(reading.max, 2);
});

test("a scan and four status events together read at most two Chats at once", async () => {
	const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
	const sessions = ids.map((id) => ({ id, cwd: "/w", modified: "2026-05-01T11:00:00Z" }));
	const { linker, reads, reading } = harness({ state: { delivered: [], pending: [], checkedAt: "2026-05-01T10:00:00Z" }, sessions });
	await Promise.all([linker.reconcile(), ...["f", "g", "h", "i"].map((id) => linker.onEvent({ type: "status.update", status: { sessionId: id, pendingAsks: [{ askId: `x${id}` }] } }))]);
	assert.ok(reads.filter((path) => path.includes("/asks")).length >= ids.length);
	assert.equal(reading.max, 2);
});

test("while the socket stays up the watermark follows, so a reconnect reads only Chats changed while it was down", async () => {
	const clock = { now: Date.parse("2026-05-01T08:00:00Z") };
	const sessions = [];
	const { linker, state, reads } = harness({ state: { delivered: [], pending: [], checkedAt: "2026-05-01T07:00:00Z" }, sessions, clock });
	await linker.reconcile();
	clock.now = Date.parse("2026-05-01T11:00:00Z");
	linker.listening();
	clock.now = Date.parse("2026-05-01T12:00:00Z");
	linker.disconnected();
	assert.equal(state.checkedAt, "2026-05-01T12:00:00.000Z");
	linker.listening();
	clock.now = Date.parse("2026-05-01T13:00:00Z");
	linker.listening();
	assert.equal(state.checkedAt, "2026-05-01T12:00:00.000Z", "a socket that is down moves no watermark");
	sessions.push(
		{ id: "live", cwd: "/w", name: "Live", modified: "2026-05-01T10:00:00Z" },
		{ id: "down", cwd: "/w", name: "Down", modified: "2026-05-01T12:30:00Z" },
	);
	await linker.reconcile();
	assert.deepEqual(reads.filter((path) => path.includes("/asks")), ["/api/sessions/down/asks?cwd=%2Fw"]);
});

test("an old bare-array state file loads as delivered ids", (t) => {
	const dir = mkdtempSync(join(process.env.PI_TMP ?? tmpdir(), "phone-link-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "sent-asks.json");
	writeFileSync(path, JSON.stringify(["a", 3]));
	assert.deepEqual(loadState(path), { delivered: ["a"], pending: [], recheck: [] });
	const state = { delivered: ["a"], pending: [{ id: "b", sessionId: "s", cwd: "/w" }], recheck: [{ sessionId: "t", cwd: "/w", failures: 1 }], checkedAt: "2026-05-01T12:00:00.000Z" };
	saveState(path, state);
	assert.deepEqual(loadState(path), state);
});
