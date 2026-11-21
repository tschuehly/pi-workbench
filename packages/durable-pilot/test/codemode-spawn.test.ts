// Cutover B2 rows against the real Durable Chat host process and scripted model: P062 codemode (a lead's script calls
// the Chat's tools; replay-unsafe; its output redacted before commit) and P064 spawn_session (the host asks PI WEB,
// here this test standing in for the daemon, to start an independent Chat and reports the answer).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, mock, test } from "node:test";
import { openChatHost } from "../src/chat.ts";
import { context } from "../src/host.ts";
import { SessionSpawner } from "../src/spawn-session.ts";
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
	const code = "const a = await tools.read({ path: 'secrets.env' }); const b = await tools.bash({ command: 'echo from-bash', description: 'echo', foreground: true }); return [a, JSON.stringify(b), 'models: ' + [typeof models.classify, typeof models.generateImages, typeof models.getModelsOfType].join(',')].join('\\n');";
	await host.call("prompt", { operationId: "op-1", text: call("codemode", { code }) });
	const result = await host.until(isResult("codemode"), "the codemode result");
	await host.idle(1);
	const output = textOf((result.message as Message).content);
	assert.match(output, /TOKEN_LINE=\[REDACTED:env:PILOT_CODEMODE_TOKEN\]/, output);
	assert.match(output, /from-bash/);
	assert.match(output, /models: function,function,function/, "the script still has the models capability");
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

test("lead tool descriptions and parameter docs are shorter than before the startup trim", async () => {
	const { store, cwd } = family("tool-texts");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: "tool schema check" });
	await host.idle(1);
	await host.close();
	const db = new DatabaseSync(join(store, "session.sqlite"), { readOnly: true });
	try {
		const row = db.prepare("SELECT record FROM entries WHERE json_extract(record, '$.kind') = 'pi.system' ORDER BY id LIMIT 1").get()!;
		const { toolsAdded } = JSON.parse(String(row.record)).model[0] as { toolsAdded: { name: string; description: string; parameters: object }[] };
		const oldSizes = { ask_user: 3483, request_attention: 740, bash: 1733, compact_and_continue: 1386 };
		for (const [name, size] of Object.entries(oldSizes)) {
			const tool = toolsAdded.find((tool) => tool.name === name);
			assert.ok(tool, `${name} is offered`);
			assert.ok(JSON.stringify(tool).length < size, `${name} definition (including parameter docs) is shorter than ${size} characters`);
			if (name === "ask_user") assert.match(JSON.stringify(tool.parameters), /"description":"Its consequence\."/, "option details must tell the user the consequence");
		}
	} finally {
		db.close();
	}
});

test("P062 codemode points to the installed models docs instead of spelling out the API", async () => {
	const { store, cwd } = family("codemode-model-docs");
	const host = await openChatHost({ dir: store, cwd, model: "faux" });
	try {
		const tool = (await host.root.agent(context)).tools.find((tool) => tool.name === "codemode");
		assert.ok(tool?.description, "codemode has a description");
		assert.doesNotMatch(tool.description, /models\.classify\(/);
		const pointer = /^- `models`: classifiers and image generation\. Read (.+) first\.$/m.exec(tool.description)?.[1];
		assert.ok(pointer && isAbsolute(pointer) && pointer.endsWith("/docs/codemode.md"), "the description points to absolute codemode docs");
		assert.ok(statSync(pointer).isFile(), "the installed docs exist");
	} finally {
		await host.close();
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

test("P064 spawn_session: the answer timeout only runs while a daemon is connected; a request outlives any outage and is resent", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const sent: { requestId: string }[] = [];
		const spawner = new SessionSpawner("chat-1");
		spawner.enabled = true;
		spawner.attach((event) => sent.push(event));
		const api = { taskId: 7, agent: async () => ({ cwd: "/repo", model: undefined, thinkingLevel: undefined }) };
		const tool = spawner.extension().tools![0]!;
		let settled: unknown;
		const call = (tool.execute as (...args: unknown[]) => Promise<{ details: unknown }>)({ prompt: "Fix the build" }, api, { abortSignal: new AbortController().signal })
			.then((r) => (settled = r.details), (e: Error) => (settled = e));
		for (let i = 0; i < 5 && sent.length === 0; i++) await Promise.resolve();
		assert.equal(sent.length, 1, "asked while connected");
		spawner.disconnected();
		mock.timers.tick(121_000);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settled, undefined, "a daemon outage longer than the answer timeout keeps the request pending");
		spawner.resend();
		assert.equal(sent.length, 2, "resent once to the daemon that came back");
		assert.equal(sent[1]!.requestId, sent[0]!.requestId);
		spawner.settle({ requestId: sent[0]!.requestId, result: { sessionId: "chat-2", cwd: "/repo" } });
		await call;
		assert.deepEqual(settled, { sessionId: "chat-2", cwd: "/repo" });

		// While connected the timeout still runs: a daemon that never answers fails the call.
		let failed: unknown;
		const api2 = { ...api, taskId: 8 };
		const stuck = (tool.execute as (...args: unknown[]) => Promise<unknown>)({ prompt: "again" }, api2, { abortSignal: new AbortController().signal }).catch((e: Error) => (failed = e));
		for (let i = 0; i < 5 && sent.length === 2; i++) await Promise.resolve();
		assert.equal(sent.length, 3);
		mock.timers.tick(121_000);
		await stuck;
		assert.match(String(failed), /did not answer/);
	} finally {
		mock.timers.reset();
	}
});

test("P064 only offers spawn_session while PI WEB enables it, without changing the worker tools", async () => {
	const { store, cwd } = family("spawn-toggle");
	let host = new ChatHost(store, cwd);
	await host.ready;
	const probe = async (n: number, text: string) => {
		await host.call("prompt", { operationId: `op-${n}`, text });
		await host.idle(n);
		return logged(store).find((request) => request.label === text.slice(0, 40))!.tools!;
	};
	assert.ok(!(await probe(1, "default state")).includes("spawn_session"));
	await host.call("configure", { resources: {}, spawnSessions: true });
	await host.call("mode", { args: "orchestration Workers" });
	const enabled = await probe(2, "enabled with Workers");
	assert.ok(enabled.includes("spawn_session"));
	assert.ok(enabled.includes("worker_create"));
	const { activeLeafId: enabledLeaf } = await host.call<{ activeLeafId: string }>("tree");

	await host.call("configure", { resources: {}, spawnSessions: false });
	const disabled = await probe(3, call("spawn_session", { prompt: "Fix the build" }));
	assert.ok(!disabled.includes("spawn_session"));
	assert.ok(disabled.includes("worker_create"));
	const result = await host.until(isResult("spawn_session"), "the unoffered tool result");
	assert.equal((result.message as Message).isError, true);
	assert.match(textOf((result.message as Message).content), /Tool spawn_session is not available/);
	assert.ok(!host.events.some((e) => e.type === "durable.spawn"));

	const { activeLeafId } = await host.call<{ activeLeafId: string }>("tree");
	await host.call("navigate", { targetId: enabledLeaf, expectedLeafId: activeLeafId });
	assert.ok(!(await probe(4, "earlier branch")).includes("spawn_session"), "history does not restore an old PI WEB setting");
	await host.call("configure", { resources: {}, spawnSessions: true });
	assert.ok((await probe(5, "enabled again")).includes("spawn_session"));
	await host.close();

	host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-6", text: "before daemon config" });
	await host.idle(1);
	assert.ok(!logged(store).find((request) => request.label === "before daemon config")!.tools!.includes("spawn_session"));
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
