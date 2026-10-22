// Phase B slice 3 group A, the composer of a Durable Chat against the real host process: queued-message edits,
// attachments, thinking levels, `!`/`!!` shell commands. Positive controls show each new commit path would leak a
// secret without redaction; the host path does not.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { context, openHost } from "../src/host.ts";
import { ChatHost, family, idle, integrity, live, logged, textOf, type UiEvent } from "./chat-proc.ts";
import { cleanup } from "./runner.ts";

// Host processes inherit this: telemetry goes to scratch, never to the owner's ~/.pi/agent/telemetry.
process.env.PI_TELEMETRY_DIR = join(family("telemetry").store, "..", "telemetry");

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

type Queued = { id: number; kind: "steer" | "followUp"; text: string; hasAttachments?: boolean; attachmentCount?: number };
type Status = { isStreaming: boolean; isBashRunning: boolean; queuedMessages: Queued[]; thinkingLevel?: string; model?: { provider: string; id: string } };
type Message = { role: string; content?: unknown; command?: string; output?: string; exitCode?: number; cancelled?: boolean; excludeFromContext?: boolean };

const queue = async (host: ChatHost) => (await host.call<Status>("status")).queuedMessages;
const shape = (items: Queued[]) => items.map((item) => `${item.kind}:${item.text}`);
const running = (host: ChatHost) => host.until((e) => e.type === "tool.update" && String(e.text).includes("running"), "bash output");

/** Every store file a commit can reach (the database and its WAL). */
function storeHas(store: string, needle: string): boolean {
	return ["session.sqlite", "session.sqlite-wal"].some((file) => existsSync(join(store, file)) && readFileSync(join(store, file)).includes(needle));
}

// ─── Queued edit ─────────────────────────────────────────────────────────────

test("queued edit: toggle, promote, remove, recall and promote-all change the Durable queue as legacy does; a stale snapshot is refused", async () => {
	const { store, cwd } = family("queue-edit");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-run", text: 'call:bash {"command":"echo running; sleep 30"}' });
	await running(host);
	for (const [op, text, mode] of [["op-f1", "f1"], ["op-f2", "f2"], ["op-s1", "s1", "steer"], ["op-f3", "f3"]] as const)
		await host.call("prompt", { operationId: op, text, ...(mode === undefined ? {} : { mode }) });
	let items = await queue(host);
	assert.deepEqual(shape(items), ["steer:s1", "followUp:f1", "followUp:f2", "followUp:f3"], "steers first, as they run");
	const mutate = async (action: string, index: number, expected = items) => {
		await host.call("mutateQueue", { editId: `edit-${action}-${index}-${expected.map((i) => i.id).join(".")}`, action, index, expected: expected.map((i) => i.id) });
		items = await queue(host);
	};
	const stale = items;
	await mutate("toggle", 0);
	assert.deepEqual(shape(items), ["followUp:f1", "followUp:f2", "followUp:f3", "followUp:s1"], "toggle moves to the end of the other queue");
	await assert.rejects(mutate("remove", 1, stale), /Queued messages changed/);
	await mutate("promote", 1);
	assert.deepEqual(shape(items), ["steer:f2", "followUp:f1", "followUp:f3", "followUp:s1"], "send now: a follow-up becomes a steer");
	await mutate("remove", 2);
	assert.deepEqual(shape(items), ["steer:f2", "followUp:f1", "followUp:s1"], "remove only that message");
	await mutate("recall", 1);
	assert.deepEqual(shape(items), ["steer:f2"], "recall withdraws it and every later message");
	await host.call("prompt", { operationId: "op-f4", text: "f4" });
	await host.call("prompt", { operationId: "op-f5", text: "f5" });
	items = await queue(host);
	await mutate("promoteAll", 1); // names the first follow-up
	assert.deepEqual(shape(items), ["steer:f2", "steer:f4", "steer:f5"], "send all now keeps their order");
	await host.call("abort");
	assert.deepEqual(await queue(host), [], "Stop withdraws the queue (PI WEB returns its text to the composer)");
	assert.deepEqual(logged(store).map((l) => l.label), ['call:bash {"command":"echo running; slee'], "no queued message reached the model");
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("crash row queue edit: queued messages survive a kill, stay editable while paused, and only the kept ones are sent", async () => {
	const { store, cwd } = family("queue-kill");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-run", text: 'call:bash {"command":"echo running; sleep 30"}' });
	await running(first);
	await first.call("prompt", { operationId: "op-f1", text: "dropped" });
	await first.call("prompt", { operationId: "op-f2", text: "kept" });
	await first.kill();

	const host = new ChatHost(store, cwd);
	await host.ready;
	let items = await queue(host);
	assert.deepEqual(shape(items), ["followUp:dropped", "followUp:kept"], "the queue is restored");
	await host.call("mutateQueue", { editId: "edit-1", action: "remove", index: 0, expected: items.map((i) => i.id) });
	await host.call("mutateQueue", { editId: "edit-1", action: "remove", index: 0, expected: items.map((i) => i.id) }); // a retried request
	items = await queue(host);
	assert.deepEqual(shape(items), ["followUp:kept"]);
	assert.deepEqual(logged(store).map((l) => l.label), ['call:bash {"command":"echo running; slee'], "editing while paused sends nothing");
	await host.call("prompt", { operationId: "op-next", text: "next" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: next", "the last answer");
	const labels = logged(store).map((l) => l.label);
	assert.ok(labels.includes("kept") && !labels.includes("dropped"), labels.join(" | "));
	await host.close();
	assert.equal(integrity(store), "ok");
});

// ─── Attachments ─────────────────────────────────────────────────────────────

/** A 1×1 PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SECRET_NAME = `ghp_${"A1b2C3d4E5".repeat(4)}`;

test("control: attachment metadata committed without redaction leaves the secret in the store", async () => {
	const { store } = family("attach-control");
	const h = await openHost(store);
	await h.root.submit({ type: "write", entry: { kind: "workbench.prompt", data: { attachments: [{ reference: "[PIC_1]", name: `${SECRET_NAME}.png`, mimeType: "image/png" }] } } }, context);
	await h.close();
	assert.ok(storeHas(store, SECRET_NAME), "the scan finds the plaintext name");
});

test("attachments: an image reaches the model, survives a kill and a restart, queued ones show their count; attachment metadata is redacted before commit", async () => {
	const { store, cwd } = family("attach");
	let host = new ChatHost(store, cwd);
	await host.ready;
	const image = { type: "image", data: PNG, mimeType: "image/png" };
	const attachments = [{ reference: "[PIC_1]", name: `${SECRET_NAME}.png`, mimeType: "image/png" }];
	const text = "what is in [PIC_1]\n\nImage blocks immediately following this text map in order as follows:\n1. [PIC_1]";
	await host.call("prompt", { operationId: "op-img", text, images: [image], attachments });
	await idle(host, 1);
	assert.equal(logged(store)[0]?.images, 1, "the image reached the model");
	const user = (await host.call<{ messages: Message[] }>("transcript")).messages.find((m) => m.role === "user")!;
	assert.deepEqual((user.content as { type: string }[]).map((p) => p.type), ["text", "image"]);
	assert.equal(storeHas(store, SECRET_NAME), false, "the attachment name is redacted before commit");
	assert.ok(storeHas(store, PNG.slice(0, 40)), "the image itself is stored");

	// Queued with an image: the queue says so, as a legacy Chat's does.
	await host.call("prompt", { operationId: "op-run", text: 'call:bash {"command":"echo running; sleep 30"}' });
	await running(host);
	await host.call("prompt", { operationId: "op-queued", text: "queued pic", images: [image, image], attachments: [...attachments, { reference: "[PIC_2]", mimeType: "image/png" }] });
	const [queued] = await queue(host);
	assert.deepEqual([queued?.text, queued?.hasAttachments, queued?.attachmentCount], ["queued pic", true, 2]);
	await assert.rejects(host.call("prompt", { operationId: "op-queued", text: "queued pic", images: [image], attachments }), /different payload/, "a retry with other images is refused");
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	assert.equal((await queue(host))[0]?.attachmentCount, 2, "the queued attachments survive a kill");
	await host.call("abort");
	await host.close();
	host = new ChatHost(store, cwd);
	await host.ready;
	const restored = (await host.call<{ messages: Message[] }>("transcript")).messages.find((m) => m.role === "user")!;
	assert.deepEqual(restored.content, user.content, "the image survives a restart unchanged");
	await host.call("prompt", { operationId: "op-after", text: "after" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: after", "the next answer");
	assert.equal(logged(store).at(-1)?.images, 1, "the image stays in the model's context");
	await host.close();
	assert.equal(integrity(store), "ok");
});

// ─── Thinking levels ─────────────────────────────────────────────────────────

test("thinking level: per Chat, validated, persisted, and restored before the first request after a kill", async () => {
	const { store, cwd } = family("thinking");
	let host = new ChatHost(store, cwd, { args: ["--thinking", "low"] });
	await host.ready;
	assert.equal((await host.call<Status>("status")).thinkingLevel, "low", "a new Chat starts at the level PI WEB resolved from Pi's settings");
	assert.deepEqual(await host.call("thinkingLevels"), ["off", "minimal", "low", "medium", "high"]);
	await assert.rejects(host.call("setThinkingLevel", { level: "ultra" }), /Invalid thinking level: ultra/);
	await host.call("setThinkingLevel", { level: "high" });
	assert.equal((await host.call<Status>("status")).thinkingLevel, "high");
	await host.call("prompt", { operationId: "op-1", text: "one" });
	await idle(host, 1);
	await host.kill();

	host = new ChatHost(store, cwd, { args: ["--thinking", "low"] });
	await host.ready;
	assert.equal((await host.call<Status>("status")).thinkingLevel, "high", "the Chat's level, not the default for new Chats");
	await host.call("prompt", { operationId: "op-2", text: "two" });
	await idle(host, 1);
	await host.call("setThinkingLevel", { level: "off" });
	await host.call("prompt", { operationId: "op-3", text: "three" });
	await idle(host, 2);
	assert.deepEqual(logged(store).map((l) => [l.label, l.reasoning]), [["one", "high"], ["two", "high"], ["three", undefined]]);
	await host.close();
});

// ─── `!` and `!!` shell commands ─────────────────────────────────────────────

const SHELL_SECRET = `ghp_${"Z9y8X7w6V5".repeat(4)}`;
const env = { PILOT_SHELL_TOKEN: SHELL_SECRET };

test("control: shell output committed without redaction leaves the secret in the store", async () => {
	const { store } = family("shell-control");
	const h = await openHost(store);
	await h.root.submit({ type: "write", entry: { kind: "workbench.bash", data: { command: "echo", output: `token ${SHELL_SECRET}` } } }, context);
	await h.close();
	assert.ok(storeHas(store, SHELL_SECRET));
});

test("shell: !cmd runs in the workspace, streams, is recorded redacted and reaches the model; !!cmd is recorded but excluded", async () => {
	const { store, cwd } = family("shell");
	let host = new ChatHost(store, cwd, { env });
	await host.ready;
	const ended = async (n: number) => {
		await host.until(() => host.events.filter((e) => e.type === "shell.end").length >= n, `shell ${n}`);
		return host.events.filter((e) => e.type === "shell.end")[n - 1]!;
	};
	await host.call("shell", { text: "!echo token $PILOT_SHELL_TOKEN; pwd" });
	const end = (await ended(1)) as UiEvent & { output: string; exitCode: number };
	const start = host.events.find((e) => e.type === "shell.start")!;
	assert.deepEqual([start.command, start.excludeFromContext], ["echo token $PILOT_SHELL_TOKEN; pwd", false]);
	assert.match(end.output, /token \[REDACTED/);
	assert.ok(end.output.includes(cwd), "runs in the Chat's workspace");
	assert.equal(end.exitCode, 0);
	const chunks = host.events.filter((e) => e.type === "shell.chunk").map((e) => String(e.chunk)).join("");
	assert.ok(!chunks.includes(SHELL_SECRET), "streamed chunks are redacted too");
	await host.call("shell", { text: "!!echo hidden-output" });
	await ended(2);
	await host.call("shell", { text: "!exit 3" });
	await ended(3);
	assert.equal(storeHas(store, SHELL_SECRET), false, "the output is redacted before commit");
	await host.close();

	host = new ChatHost(store, cwd, { env });
	await host.ready;
	const bash = (await host.call<{ messages: Message[] }>("transcript")).messages.filter((m) => m.role === "bashExecution");
	assert.deepEqual(bash.map((m) => [m.command, m.excludeFromContext, m.exitCode]), [["echo token $PILOT_SHELL_TOKEN; pwd", false, 0], ["echo hidden-output", true, 0], ["exit 3", false, 3]], "recorded, and survives a restart");
	await host.call("prompt", { operationId: "op-1", text: "what ran" });
	await idle(host, 1);
	assert.deepEqual(logged(store)[0]?.ran, ["echo token $PILOT_SHELL_TOKEN; pwd", "exit 3"], "!! output stays out of the model's context");
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("shell: one command at a time, Stop cancels it, and a command during a run is recorded after the run", async () => {
	const { store, cwd } = family("shell-stop");
	const host = new ChatHost(store, cwd, { tps: 40 });
	await host.ready;
	await host.call("shell", { text: "!echo started; sleep 30" });
	await host.until((e) => e.type === "shell.chunk" && String(e.chunk).includes("started"), "the shell output");
	assert.equal((await host.call<Status>("status")).isBashRunning, true);
	await assert.rejects(host.call("shell", { text: "!echo second" }), /A bash command is already running/);
	await assert.rejects(host.call("shell", { text: "!   " }), /Usage: !<shell command>/);
	await host.call("abort");
	const end = (await host.until((e) => e.type === "shell.end", "the cancelled shell")) as UiEvent & { cancelled: boolean };
	assert.equal(end.cancelled, true);
	assert.equal((await host.call<Status>("status")).isBashRunning, false);

	await host.call("prompt", { operationId: "op-gen", text: "gen" });
	await host.until((e) => e.type === "assistant.delta", "the running answer");
	await host.call("shell", { text: "!echo during" });
	await host.until(() => host.events.filter((e) => e.type === "shell.end").length >= 2, "the second shell");
	await idle(host, 1);
	const roles = (await host.call<{ messages: Message[] }>("transcript")).messages.map((m) => (m.role === "bashExecution" ? `bash:${m.command}` : m.role));
	assert.deepEqual(roles, ["bash:echo started; sleep 30", "user", "assistant", "bash:echo during"], "as legacy: recorded once the run ends");
	await host.close();
});
