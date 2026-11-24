import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { askMessage, createLinker, describeError, loadState, remember, saveState, sendTelegram } from "./phone-link.mjs";

const TOKEN = "123456:SECRET-bot-token";

const opened = { type: "session.attention", sessionId: "chat 1", cwd: "/w", sessionName: "Release", kind: "ask", id: "ask-1", detail: "Ship it?" };

test("an opened question set becomes name, first question and the Chat link", () => {
	assert.equal(askMessage(opened), "Release: Ship it?\nhttps://pi.tschuehly.de/?session=chat+1");
});

test("other events and attention kinds send nothing", () => {
	assert.equal(askMessage({ ...opened, kind: "attention" }), undefined);
	assert.equal(askMessage({ type: "status.update" }), undefined);
	assert.equal(askMessage({ ...opened, id: "" }), undefined);
	assert.equal(askMessage(null), undefined);
});

test("a missing name or question falls back to plain words", () => {
	assert.equal(askMessage({ ...opened, sessionName: undefined, detail: "" }), "Pi: Needs an answer\nhttps://pi.tschuehly.de/?session=chat+1");
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
 * @param {{ state?: any, send?: (text: string) => Promise<void>, sessions?: any[], asks?: Record<string, any[]>, retryDelays?: number[] }} [options]
 */
function harness({ state = { delivered: [], pending: [] }, send, sessions = [], asks = {}, retryDelays = [] } = {}) {
	const saved = [];
	const sent = [];
	const reads = [];
	const getJson = async (path) => {
		reads.push(path);
		if (path.startsWith("/api/sessions/recent")) return sessions;
		const id = decodeURIComponent(path.split("/")[3] ?? "");
		return { pendingAsks: asks[id] ?? [] };
	};
	const linker = createLinker({
		send: async (text) => { sent.push(text); if (send !== undefined) await send(text); },
		getJson,
		state,
		save: (next) => saved.push(structuredClone(next)),
		wait: async () => {},
		now: () => Date.parse("2026-05-01T12:00:00Z"),
		retryDelays,
	});
	return { linker, state, saved, sent, reads };
}

test("a send that fails while another succeeds is never saved as delivered", async () => {
	const gates = {};
	const send = (text) => new Promise((resolve, reject) => { gates[text.includes("Question a?") ? "a" : "b"] = { resolve, reject }; });
	const { linker, state, saved } = harness({ send: (text) => send(text) });
	const a = linker.onEvent(opening("a"));
	const b = linker.onEvent(opening("b"));
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
	assert.deepEqual(sent.sort(), ["Durable · Fix: Question failed?\nhttps://pi.tschuehly.de/?session=s2", "Durable · Release: Question new?\nhttps://pi.tschuehly.de/?session=s1"]);
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
	assert.equal(sent.at(-1), "Durable · Release: Needs an answer\nhttps://pi.tschuehly.de/?session=s1");
	assert.equal(linker.onEvent({ type: "status.update", status: { sessionId: "s1", pendingAsks: [{ askId: "z" }] } }), undefined);
});

test("an old bare-array state file loads as delivered ids", (t) => {
	const dir = mkdtempSync(join(process.env.PI_TMP ?? tmpdir(), "phone-link-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "sent-asks.json");
	writeFileSync(path, JSON.stringify(["a", 3]));
	assert.deepEqual(loadState(path), { delivered: ["a"], pending: [] });
	const state = { delivered: ["a"], pending: [{ id: "b", sessionId: "s", cwd: "/w" }], checkedAt: "2026-05-01T12:00:00.000Z" };
	saveState(path, state);
	assert.deepEqual(loadState(path), state);
});
