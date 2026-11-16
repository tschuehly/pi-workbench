// Cutover B2 rows against the real Durable Chat host process and scripted model: P062 codemode (a lead's script calls
// the Chat's tools; replay-unsafe; its output redacted before commit) and P064 spawn_session (the host asks PI WEB,
// here this test standing in for the daemon, to start an independent Chat and reports the answer).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { openChatHost } from "../src/chat.ts";
import { ChatHost, family, live, logged, type Message, textOf, type UiEvent } from "./chat-proc.ts";
import { cleanup } from "./runner.ts";

const SECRET = "codemodeSecret-5b2e8c1f7a9d4036";
process.env.PILOT_CODEMODE_TOKEN = SECRET;

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

function scan(path: string, needle: string): string[] {
	if (statSync(path).isDirectory()) return readdirSync(path).flatMap((name) => scan(join(path, name), needle));
	return readFileSync(path).includes(needle) ? [path] : [];
}

const isResult = (name: string) => (e: UiEvent) => e.type === "message.end" && (e.message as Message & { toolName?: string }).role === "toolResult" && (e.message as { toolName?: string }).toolName === name;
const call = (tool: string, args: object) => `call:${tool} ${JSON.stringify(args)}`;

test("P062 codemode: offered to the lead by default; a script calls the Chat's tools; the output is redacted before commit; replay-unsafe", async () => {
	const { store, cwd } = family("codemode");
	writeFileSync(join(cwd, "secrets.env"), `TOKEN_LINE=${SECRET}\n`);
	const host = new ChatHost(store, cwd);
	await host.ready;
	const code = "const a = await tools.read({ path: 'secrets.env' }); const b = await tools.bash({ command: 'echo from-bash', description: 'echo', foreground: true }); return [a, JSON.stringify(b)].join('\\n');";
	await host.call("prompt", { operationId: "op-1", text: call("codemode", { code }) });
	const result = await host.until(isResult("codemode"), "the codemode result");
	await host.idle(1);
	const output = textOf((result.message as Message).content);
	assert.match(output, /TOKEN_LINE=\[REDACTED:env:PILOT_CODEMODE_TOKEN\]/, output);
	assert.match(output, /from-bash/);
	assert.notEqual((result.message as Message).isError, true);
	assert.ok(logged(store)[0]!.tools!.includes("codemode"), "the lead's first request offers codemode");
	await host.close();
	assert.deepEqual(scan(store, SECRET), [], "no committed copy of the secret: nested results and the script's output are redacted");
	assert.ok(scan(cwd, SECRET).length > 0, "control: the workspace file holds the plaintext the script read");
	const h = await openChatHost({ dir: store, cwd, model: "faux" });
	try {
		assert.equal(h.registry.snapshot().tools().find(({ tool }) => tool.name === "codemode")?.tool.replay, "unsafe", "a restart never reruns a script: it is reconciled by the owner");
	} finally {
		await h.close();
	}
});

test("P064 spawn_session: the host asks PI WEB for an independent Chat with the lead's model and thinking level, and reports the started Chat", async () => {
	const { store, cwd } = family("spawn");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("configure", { resources: {}, spawnSessions: true });
	await host.call("prompt", { operationId: "op-1", text: call("spawn_session", { prompt: "Fix the build", cwd: "../other" }) });
	const request = await host.until((e) => e.type === "durable.spawn", "the spawn request");
	assert.equal(typeof request.requestId, "string");
	assert.deepEqual({ ...request, requestId: undefined }, { type: "durable.spawn", requestId: undefined, spawningCwd: cwd, prompt: "Fix the build", cwd: "../other", model: "faux/faux-1", thinkingLevel: "medium" });
	await host.call("spawned", { requestId: request.requestId, result: { sessionId: "chat-2", cwd: "/repo/other", model: "faux/faux-1" } });
	const result = await host.until(isResult("spawn_session"), "the spawn_session result");
	assert.equal(textOf((result.message as Message).content), "Started independent session chat-2 in /repo/other using model faux/faux-1.");
	await host.idle(1);
	assert.ok(logged(store)[0]!.tools!.includes("spawn_session"));

	// PI WEB's refusal (an unregistered workspace, an unknown model) is the tool's error, which the model sees.
	await host.call("prompt", { operationId: "op-2", text: call("spawn_session", { prompt: "again", model: "nope/none" }) });
	const second = await host.until((e) => e.type === "durable.spawn" && e.requestId !== request.requestId, "the second spawn request");
	assert.equal(second.model, "nope/none", "an explicit model overrides the lead's");
	await host.call("spawned", { requestId: second.requestId, error: "Unknown model nope/none" });
	await host.until(() => host.events.filter(isResult("spawn_session")).length === 2, "the second result");
	const failed = host.events.filter(isResult("spawn_session"))[1]!.message as Message;
	assert.equal(failed.isError, true);
	assert.match(textOf(failed.content), /Unknown model nope\/none/);
	await host.close();
});

test("P064 spawn_session without PI WEB's spawn support fails visibly instead of waiting", async () => {
	const { store, cwd } = family("spawn-off");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: call("spawn_session", { prompt: "Fix the build" }) });
	const result = await host.until(isResult("spawn_session"), "the spawn_session result");
	assert.equal((result.message as Message).isError, true);
	assert.match(textOf((result.message as Message).content), /Spawning sessions is disabled/);
	assert.ok(!host.events.some((e) => e.type === "durable.spawn"));
	await host.close();
});

test("P064 survival: a host killed while PI WEB starts the Chat reopens with the call to reconcile, never asking again", async () => {
	const { store, cwd } = family("spawn-kill");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("configure", { resources: {}, spawnSessions: true });
	await host.call("prompt", { operationId: "op-1", text: call("spawn_session", { prompt: "Fix the build" }) });
	await host.until((e) => e.type === "durable.spawn", "the spawn request");
	await host.kill();
	const reopened = new ChatHost(store, cwd);
	await reopened.ready;
	await reopened.call("configure", { resources: {}, spawnSessions: true });
	const effects = (await reopened.call<{ unresolvedEffects?: { toolName: string; arguments: string }[] }>("status")).unresolvedEffects ?? [];
	assert.equal(effects[0]?.toolName, "spawn_session", "the owner decides whether the Chat was started");
	assert.match(effects[0]!.arguments, /Fix the build/);
	await reopened.call("prompt", { operationId: "op-2", text: "after" });
	await reopened.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === "ok: after", "the next answer");
	assert.ok(!reopened.events.some((e) => e.type === "durable.spawn"), "the interrupted call is not rerun");
	await reopened.close();
});
