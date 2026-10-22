// Installed Pi packages in a Durable Chat (slice 5 group B), against the real host process and the packages' own
// installed code: pi-web-access, ping-a-human-pi (stub MCP transport only), pi-process-monitor, and the commands of
// packages without a Durable surface. Every host runs with an isolated HOME and agent directory; the network is a local
// fixture server. Parity-matrix rows are named in each test title.
import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { claudeAliases, claudePayload } from "../src/claude.ts";
import { readLog } from "../src/faux.ts";
import { cleanup, PACKAGE, scratch } from "./runner.ts";

type UiEvent = { type: string; [key: string]: unknown };
type Reply = { id?: number; result?: unknown; error?: { name: string; message: string }; event?: UiEvent; ready?: { protocol: number } };
type Message = { role: string; customType?: string; content?: unknown; details?: unknown; isError?: boolean; toolName?: string };
type Status = { isStreaming: boolean; queuedMessages: { kind: string; text: string }[]; unresolvedEffects?: { id: string; toolName: string }[] };

/** Where the owner's installed packages are; only read. */
const INSTALLED = process.env.PILOT_PI_PACKAGES ?? join(homedir(), ".pi", "agent", "npm", "node_modules");
const SECRET = `ghp_${"a".repeat(36)}`;

const live = new Set<ChildProcess>();
let fixture: Server;
let port = 0;
const pageHits: string[] = [];

before(async () => {
	for (const name of ["pi-web-access", "ping-a-human-pi", "pi-process-monitor"])
		assert.ok(existsSync(join(INSTALLED, name, "package.json")), `installed package ${name} in ${INSTALLED}`);
	fixture = createServer((request, response) => {
		pageHits.push(request.url ?? "");
		if (request.url?.startsWith("/search")) {
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ results: [{ title: "Fixture result", url: `http://127.0.0.1:${port}/page`, content: "fixture snippet" }] }));
			return;
		}
		response.setHeader("content-type", "text/html");
		response.end(`<html><head><title>Fixture page</title></head><body><article><h1>Durable fixture page</h1><p>The page body names a token ${SECRET} that must never be stored.</p><p>${"Plain paragraph text. ".repeat(40)}</p></article></body></html>`);
	});
	await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
	port = (fixture.address() as { port: number }).port;
});

after(() => {
	for (const child of live) child.kill("SIGKILL");
	fixture?.close();
	cleanup();
});

/** One Chat family with its own HOME: Pi settings naming the three bound packages, stub ping-a-human, fixture search. */
function family(label: string) {
	const dir = scratch(`pkg-${label}`);
	const home = join(dir, "home");
	const agentDir = join(home, ".pi", "agent");
	const cwd = join(dir, "workspace");
	const bin = join(dir, "bin");
	for (const path of [agentDir, cwd, bin]) mkdirSync(path, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["pi-web-access", "ping-a-human-pi", "pi-process-monitor"].map((name) => join(INSTALLED, name)) }));
	writeFileSync(join(agentDir, "web-search.json"), JSON.stringify({ provider: "searxng", searxngBaseUrl: `http://127.0.0.1:${port}`, ssrf: { allowRanges: ["127.0.0.0/8"] } }));
	const pingLog = join(dir, "ping-calls.log");
	const pingConfig = join(dir, "ping-a-human.json");
	writeFileSync(pingConfig, JSON.stringify({ command: process.execPath, args: [join(PACKAGE, "test", "fixtures", "ping-stub.mjs"), pingLog], notify: { enabled: false }, approval: { enabled: false } }));
	// Anything reaching for the real ping-a-human (npx) or a browser (open) is recorded and fails.
	const forbidden = join(dir, "forbidden.log");
	for (const name of ["npx", "open"]) {
		writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${forbidden}"\nexit 1\n`);
		chmodSync(join(bin, name), 0o755);
	}
	const env = {
		...process.env,
		HOME: home,
		PI_CODING_AGENT_DIR: agentDir,
		PING_A_HUMAN_PI_CONFIG: pingConfig,
		PATH: `${bin}:${process.env.PATH}`,
		PI_TELEMETRY_DIR: join(dir, "telemetry"),
		TMPDIR: join(dir, "tmp"),
	};
	mkdirSync(env.TMPDIR, { recursive: true });
	return { store: join(dir, "family"), cwd, env, pingLog, forbidden, chatId: `chat-${label}` };
}

type Family = ReturnType<typeof family>;

class ChatHost {
	readonly child: ChildProcess;
	readonly events: UiEvent[] = [];
	readonly exited: Promise<number | null>;
	stderr = "";
	#next = 1;
	#pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	#waiters: (() => void)[] = [];
	readonly ready: Promise<NonNullable<Reply["ready"]>>;

	constructor(f: Family, packages = true) {
		const args = ["--store", f.store, "--cwd", f.cwd, "--model", "faux", "--faux-tps", "400", "--session-id", f.chatId, ...(packages ? ["--packages"] : [])];
		this.child = fork(join(PACKAGE, "src", "chat-host-main.ts"), args, { stdio: ["ignore", "ignore", "pipe", "ipc"], env: f.env });
		live.add(this.child);
		this.child.stderr!.on("data", (data) => (this.stderr += data.toString()));
		let markReady!: (ready: NonNullable<Reply["ready"]>) => void;
		this.ready = new Promise((resolve) => (markReady = resolve));
		this.child.on("message", (message: Reply) => {
			if (message.ready !== undefined) markReady(message.ready);
			if (message.event !== undefined) {
				this.events.push(message.event);
				for (const wake of this.#waiters.splice(0)) wake();
			}
			if (message.id !== undefined) {
				const pending = this.#pending.get(message.id)!;
				this.#pending.delete(message.id);
				if (message.error !== undefined) pending.reject(Object.assign(new Error(message.error.message), { name: message.error.name }));
				else pending.resolve(message.result);
			}
		});
		this.exited = new Promise((resolve) => this.child.on("exit", (code) => (live.delete(this.child), resolve(code))));
	}

	call<T = unknown>(method: string, params?: object): Promise<T> {
		const id = this.#next++;
		return new Promise<T>((resolve, reject) => {
			this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.child.send({ id, method, ...(params === undefined ? {} : { params }) });
		});
	}

	async until(match: (event: UiEvent) => boolean, what: string): Promise<UiEvent> {
		for (;;) {
			const found = this.events.find(match);
			if (found !== undefined) return found;
			const exited = await Promise.race([new Promise<false>((resolve) => this.#waiters.push(() => resolve(false))), this.exited.then(() => true)]);
			if (exited) throw new Error(`host exited before ${what}: ${this.stderr}`);
		}
	}

	/** Send `call:<tool> <args>` to the scripted model and wait for that tool's result event. */
	async tool(name: string, args: object, operationId: string): Promise<UiEvent> {
		const before = this.events.length;
		await this.call("prompt", { operationId, text: `call:${name} ${JSON.stringify(args)}` });
		const end = await this.until((e) => this.events.indexOf(e) >= before && e.type === "tool.end" && e.toolName === name, `${name} result`);
		await this.until((e) => this.events.indexOf(e) > this.events.indexOf(end) && e.type === "agent.end", `the ${name} run to end`);
		return end;
	}

	kill(): Promise<number | null> {
		this.child.kill("SIGKILL");
		return this.exited;
	}

	async close(): Promise<void> {
		await this.call("close");
		await this.exited;
	}
}

const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : "";
const storeBytes = (store: string) => ["session.sqlite", "session.sqlite-wal"].map((file) => (existsSync(join(store, file)) ? readFileSync(join(store, file)).toString("latin1") : "")).join("");

test("P113 P114 P115 P116 P117 P119 P112: web tools stay deferred until web_enable; search, fetch and stored content work and survive a restart; stored pages are redacted", async () => {
	const f = family("web");
	let host = new ChatHost(f);
	await host.ready;
	const early = await host.tool("get_search_content", { responseId: "none" }, "op-early");
	assert.equal(early.isError, true, "a deferred web tool is not offered before web_enable");
	assert.doesNotMatch(String(early.text), /responseId|No stored/i, "the package never ran it");
	const enabled = await host.tool("web_enable", {}, "op-enable");
	assert.equal(enabled.isError, false);
	assert.match(String(enabled.text), /Enabled: .*web_search.*fetch_content.*get_search_content/);

	const search = await host.tool("web_search", { query: "durable fixture" }, "op-search");
	assert.equal(search.isError, false, String(search.text));
	assert.match(String(search.text), /Fixture result/);
	assert.ok(pageHits.some((url) => url.startsWith("/search?")), "searched through the local SearXNG fixture");
	const check = await host.tool("source_check", { claim: "the fixture page exists", fetchContent: false }, "op-check");
	assert.equal(check.isError, false, String(check.text));
	assert.match(String(check.text), /Fixture result|fixture/i);

	const fetched = await host.tool("fetch_content", { url: `http://127.0.0.1:${port}/page` }, "op-fetch");
	assert.equal(fetched.isError, false, String(fetched.text));
	assert.match(String(fetched.text), /Durable fixture page/);
	assert.doesNotMatch(String(fetched.text), new RegExp(SECRET), "tool output is redacted");
	const responseId = /responseId[^A-Za-z0-9]*([A-Za-z0-9_-]{6,})/.exec(String(fetched.text) + JSON.stringify(fetched.details ?? {}))?.[1];
	assert.ok(responseId !== undefined, `a responseId in ${String(fetched.text).slice(0, 400)}`);
	const stored = await host.tool("get_search_content", { responseId, url: `http://127.0.0.1:${port}/page` }, "op-stored");
	assert.equal(stored.isError, false, String(stored.text));
	assert.match(String(stored.text), /Plain paragraph text/);
	await host.kill();

	host = new ChatHost(f);
	await host.ready;
	// session_start rebuilt the package's stored results from its committed entries; the tool stays loaded on this branch.
	const restored = await host.tool("get_search_content", { responseId, url: `http://127.0.0.1:${port}/page` }, "op-restored");
	assert.equal(restored.isError, false, String(restored.text));
	assert.match(String(restored.text), /Plain paragraph text/);
	await host.close();
	const bytes = storeBytes(f.store);
	assert.ok(bytes.includes("Plain paragraph text"), "the fetched page is committed in the store");
	assert.ok(!bytes.includes(SECRET), "no committed copy of the page holds the token (appendEntry is redacted)");
	assert.ok(!existsSync(f.forbidden), "nothing reached for npx or a browser");

	// P112: package tools leave as Claude mcp__ aliases and come back canonical.
	const aliases = claudeAliases("pi");
	const payload = claudePayload(aliases)({ tools: [{ name: "web_search" }, { name: "ask_human" }, { name: "monitor" }] }) as { tools: { name: string }[] };
	assert.deepEqual(payload.tools.map((tool) => tool.name), ["mcp__pi__web_search", "mcp__pi__ask_human", "mcp__pi__monitor"]);
	assert.equal(aliases.toCanonical("mcp__pi__web_search"), "web_search");
});

test("P118 P134: package commands run in the host, notices are command output; /google-account is refused with its reason; dialogs are refused visibly", async () => {
	const f = family("commands");
	const host = new ChatHost(f);
	await host.ready;
	const commands = (await host.call<{ name: string }[]>("commands")).map((command) => command.name);
	for (const name of ["websearch", "curator", "search", "ping", "monitor", "monitors", "monitor-kill", "monitor-recover", "monitor-gc"]) assert.ok(commands.includes(name), `/${name} in ${commands.join(",")}`);
	assert.ok(!commands.includes("google-account"), "a refused command is not offered");
	assert.match((await host.call<{ type: string; message: string }>("command", { text: "/google-account" })).message, /not available in Durable Chats: .*browser cookies/);

	assert.deepEqual(await host.call("command", { text: "/search" }), { type: "done" });
	await host.until((e) => e.type === "command.output" && /No stored search results/.test(String(e.message)), "the /search notice");

	assert.deepEqual(await host.call("command", { text: "/curator auto-summary" }), { type: "done" });
	const shown = await host.until((e) => e.type === "message.end" && (e.message as Message).customType === "curator-config", "the curator notice");
	assert.match(textOf((shown.message as Message).content), /Auto-summary enabled/);
	assert.equal(JSON.parse(readFileSync(join(f.env.PI_CODING_AGENT_DIR, "web-search.json"), "utf8")).workflow, "auto-summary", "written to the isolated web-search.json");
	assert.ok(!host.events.some((e) => e.type === "agent.start"), "a notice without triggerTurn starts no run");

	await host.tool("web_enable", {}, "op-enable");
	await host.tool("fetch_content", { url: `http://127.0.0.1:${port}/page` }, "op-fetch");
	const search = await host.call<{ type: string; message?: string }>("command", { text: "/search" });
	assert.deepEqual([search.type, /needs an extension dialog/.test(search.message ?? "")], ["unsupported", true], "a dialog is refused, not left open");

	// /monitor commits the watcher's state through appendEntry; its reuse key is secret-shaped and must not be stored.
	const log = join(f.cwd, "cmd.log");
	writeFileSync(log, "");
	assert.deepEqual(await host.call("command", { text: `/monitor --file ${log} --reuse-key ${SECRET}` }), { type: "done" });
	await host.until((e) => e.type === "command.output" && /^created: \S+ \[file\] state=claimed/.test(String(e.message)), "the /monitor notice");
	await host.close();
	assert.ok(storeBytes(f.store).includes("pi-process-monitor") || storeBytes(f.store).includes("cmd.log"), "the watcher state is committed");
	assert.ok(!storeBytes(f.store).includes(SECRET), "appendEntry data is redacted before it is committed");
	assert.ok(!existsSync(f.forbidden));
});

test("P124 P125 P126: ask_human, notify_human and /ping go only to the stub transport; an ask killed after it was sent is never sent again", async () => {
	const f = family("ping");
	let host = new ChatHost(f);
	await host.ready;
	const notified = await host.tool("notify_human", { message: "build finished" }, "op-notify");
	assert.equal(notified.isError, false, String(notified.text));
	assert.doesNotMatch(String(notified.text), /ghp_r/, "the transport's reply is redacted");
	const asked = await host.tool("ask_human", { question: "ship it?" }, "op-ask");
	assert.equal(String(asked.text), "yes");
	assert.deepEqual(await host.call("command", { text: "/ping deploy done" }), { type: "done" });
	const output = await host.until((e) => e.type === "command.output", "the /ping notice");
	assert.match(String(output.message), /sent/);
	assert.doesNotMatch(String(output.message), /ghp_r/);

	await host.call("prompt", { operationId: "op-hold", text: 'call:ask_human {"question":"hold: approve the release?"}' });
	await host.until((e) => e.type === "tool.start" && e.toolName === "ask_human" && JSON.stringify(e.args).includes("hold"), "the held ask");
	for (let i = 0; i < 200 && !readFileSync(f.pingLog, "utf8").includes("hold"); i++) await new Promise((resolve) => setTimeout(resolve, 25));
	await host.kill();

	host = new ChatHost(f);
	await host.ready;
	const status = await host.call<Status>("status");
	assert.deepEqual(status.unresolvedEffects?.map((effect) => effect.toolName), ["ask_human"], "the interrupted ask waits for the owner");
	await host.call("prompt", { operationId: "op-after", text: 'call:ask_human {"question":"another question"}' });
	const blocked = await host.until((e) => e.type === "tool.end" && e.toolName === "ask_human" && /Needs reconciliation/.test(String(e.text)), "the blocked ask");
	assert.equal(blocked.isError, true);
	await host.until((e) => e.type === "agent.end" && host.events.indexOf(e) > host.events.indexOf(blocked), "the blocked run to end");
	await host.close();

	const calls = readLog<{ name: string; args: Record<string, string> }>(f.pingLog);
	assert.deepEqual(calls.map((call) => [call.name, call.args.message ?? call.args.question]), [
		["notify_human", "build finished"],
		["ask_human", "ship it?"],
		["notify_human", "deploy done"],
		["ask_human", "hold: approve the release?"],
	], "each send exactly once; the killed ask is not resent and the blocked one never sent");
	assert.ok(!existsSync(f.forbidden), "the real ping-a-human (npx) was never started: no Telegram message");
});

test("P133 P135: a tail watcher pings the Chat, survives a kill and resumes; pings are redacted; /monitors lists it", async () => {
	const f = family("monitor");
	const log = join(f.cwd, "job.log");
	writeFileSync(log, "");
	let host = new ChatHost(f);
	await host.ready;
	const created = await host.tool("monitor", { source: { type: "tail", path: log }, options: { notifyOn: ["DONE"], coalesceSeconds: 0, label: "job" } }, "op-watch");
	assert.equal(created.isError, false, String(created.text));
	assert.match(String(created.text), /CREATED: watcher \S+ \[file\]/);
	const runs = host.events.filter((e) => e.type === "agent.end").length;
	appendFileSync(log, `step DONE with ${SECRET}\n`);
	const ping = await host.until((e) => e.type === "message.end" && (e.message as Message).customType === "monitor", "the watcher ping");
	assert.match(textOf((ping.message as Message).content), /\[watcher \S+ · job\] .*DONE/);
	assert.doesNotMatch(textOf((ping.message as Message).content), new RegExp(SECRET), "the ping is redacted before it is committed");
	await host.until(() => host.events.filter((e) => e.type === "agent.end").length > runs, "the ping's turn");
	assert.deepEqual(await host.call("command", { text: "/monitors" }), { type: "done" });
	await host.until((e) => e.type === "command.output" && /\[file\] state=claimed/.test(String(e.message)), "the watcher listing");
	const status = await host.tool("monitor_status", {}, "op-status");
	assert.match(String(status.text), /\[file\]/);
	await host.kill();

	host = new ChatHost(f);
	await host.ready;
	appendFileSync(log, "second DONE\n");
	// session_start relaunched the safe-auto file watcher from its committed state; nothing was left unfinished, so
	// the ping starts its turn at once.
	await host.until((e) => e.type === "message.end" && (e.message as Message).customType === "monitor" && textOf((e.message as Message).content).includes("second DONE"), "the ping after restart");
	await host.until((e) => e.type === "message.end" && textOf((e.message as Message).content).startsWith("ok: [watcher"), "the ping's turn after restart");
	await host.close();
	assert.ok(!storeBytes(f.store).includes(SECRET), "neither the ping nor the watcher state holds the token");
});

test("without --packages no package code runs: tools and commands stay unavailable", async () => {
	const f = family("off");
	const host = new ChatHost(f, false);
	await host.ready;
	assert.deepEqual(await host.call("commands"), []);
	assert.equal((await host.call<{ type: string }>("command", { text: "/ping" })).type, "unsupported");
	const end = await host.tool("notify_human", { message: "x" }, "op-1");
	assert.equal(end.isError, true);
	await host.close();
	assert.ok(!existsSync(f.pingLog));
});
