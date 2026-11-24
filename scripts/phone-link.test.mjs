import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { askMessage, describeError, remember, sendTelegram } from "./phone-link.mjs";

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
