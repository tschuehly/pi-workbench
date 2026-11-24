import assert from "node:assert/strict";
import test from "node:test";
import { askMessage, remember } from "./phone-link.mjs";

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
