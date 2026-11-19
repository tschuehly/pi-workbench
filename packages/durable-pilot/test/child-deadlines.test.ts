// Design C proving tests: real disposable Durable hosts and a real Playwright browser, never the installed host.
import assert from "node:assert/strict";
import { spawn, fork, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { after, afterEach, test as nodeTest } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { createBashTool } from "@earendil-works/pi-durable/tools";
import { openChatHost } from "../src/chat.ts";
import { BackgroundBash, BashJobsDoc } from "../src/background-bash.ts";
import { DelegationDoc } from "../src/delegation.ts";
import { context, openHost } from "../src/host.ts";
import { entriesOf } from "../src/pilot.ts";
import { ChatHost, family, live, textOf, waitFor, type Message } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";
import { cancelJob, launchJob, readJob } from "../../../extensions/background-bash/jobs.mjs";

const test = (name: string, fn: () => Promise<void>) => nodeTest(name, { timeout: 30_000 }, fn);

const ROOT = scratch("command-deadlines");
const JOBS = join(ROOT, "jobs");
process.env.PI_BACKGROUND_BASH_ROOT = JOBS;
process.env.PI_TMP_ROOT = join(ROOT, "tmp");
process.env.PI_TELEMETRY_DIR = join(ROOT, "telemetry");
const QUOTA = join(ROOT, "quota.json");
const require = createRequire(import.meta.url);
const PLAYWRIGHT = require.resolve("playwright");
const call = (name: string, args: object) => `call:${name} ${JSON.stringify(args)}`;
const isCustom = (kind: string) => (e: { type: string; message?: unknown }) => e.type === "message.end" && (e.message as Message).customType === kind;
const isCompletion = isCustom("pi-workbench:child-completion");
const isStuck = isCustom("pi-workbench:child-stuck");
const tool = (name: string) => (e: { type: string; message?: unknown }) => e.type === "message.end" && (e.message as { toolName?: string })?.toolName === name;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const survivors = new Map<number, string>();
const identity = (pid: number) => { try { return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim(); } catch { return ""; } };
const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });

function open(store: string, cwd: string, env: NodeJS.ProcessEnv = {}): ChatHost {
	writeFileSync(QUOTA, JSON.stringify({ version: 1, checkedAt: Date.now(), status: 0, stdout: JSON.stringify({ providers: [] }), stderr: "" }));
	return new ChatHost(store, cwd, { tps: 5000, args: ["--scripted-providers", "--session-id", store], env: {
		PI_WORKBENCH_QUOTA_CACHE: QUOTA, PILOT_CHILD_BASH_TIMEOUT_S: "4", PILOT_COMMAND_QUIET_MS: "1000", ...env,
	} });
}
let op = 0;
const prompt = (h: ChatHost, text: string) => h.call("prompt", { operationId: `deadline-${++op}`, text });
async function launch(h: ChatHost, command: string, extra: object = {}, background = true): Promise<string> {
	await prompt(h, call("subagent", { profile: "scout", cognitiveRole: "routine", background, name: "Deadline probe", task: call("bash", { command, ...extra }) }));
	const e = await h.until(tool("subagent"), "the launch result");
	return /Launched subagent (\S+)/.exec(textOf((e.message as Message).content))?.[1] ?? "foreground";
}
async function done(h: ChatHost): Promise<void> { await h.until(isCompletion, "child completion"); }
async function crashed(h: ChatHost): Promise<void> {
	await Promise.race([h.exited, done(h).then(() => assert.fail("child completed without entering the managed launch crash window"))]);
}
async function marked(h: ChatHost) {
	return Promise.race([h.until((e) => e.type === "test.hold" && e.name === "progress:after-mark", "the durable notice mark"), done(h).then(() => assert.fail("command completed without marking its no-progress notice"))]);
}
async function inspect(store: string, cwd: string) {
	const h = await openChatHost({ dir: store, cwd, model: "faux", chatId: store });
	try {
		const executions = Object.values((await h.harness.snapshot(DelegationDoc, h.root.id, context))!.executions);
		const e = executions.at(-1)!;
		const child = (await h.harness.conversation(e.conversationId as never, context))!;
		const entries = (await child.entries({ order: "ascending" }, 1000, undefined, context)).items;
		const results = entries.flatMap((x) => (x.model ?? []) as readonly (Message & { toolName?: string })[]).filter((x) => x.toolName === "bash");
		const refs = (await h.harness.snapshot(BashJobsDoc, child.id, context))?.jobs ?? {};
		return { e, results, refs, description: (await child.agent(context)).tools.find((t) => t.name === "bash")!.description };
	} finally { await h.close(); }
}
function registry() { return existsSync(JOBS) ? readdirSync(JOBS).filter((id) => existsSync(join(JOBS, id, "job.json"))) : []; }
function record(id: string) { return JSON.parse(readFileSync(join(JOBS, id, "job.json"), "utf8")); }
function exit(id: string) { return JSON.parse(readFileSync(join(JOBS, id, "exit"), "utf8")); }

function browserFixture(cwd: string): string {
	const path = join(cwd, "hang.cjs");
	writeFileSync(path, `const {chromium}=require(${JSON.stringify(PLAYWRIGHT)});
const {spawn}=require('node:child_process'); const fs=require('node:fs');
(async()=>{ const ordinary=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
const browser=await chromium.launchServer({headless:true});
fs.writeFileSync('pids.json',JSON.stringify([process.pid,ordinary.pid,browser.process().pid]));
console.log('browser ready'); process.on('SIGTERM',()=>{});setInterval(()=>{},1000);await new Promise(()=>{});})();`);
	return `${JSON.stringify(process.execPath)} ${JSON.stringify(path)}`;
}
function pids(cwd: string): number[] {
	const list = JSON.parse(readFileSync(join(cwd, "pids.json"), "utf8")) as number[];
	for (const pid of list) survivors.set(pid, identity(pid));
	return list;
}
async function noSurvivors(list: number[]) {
	await waitFor(() => list.every((pid) => !alive(pid)), "all owned descendants to stop", 10_000);
	assert.equal(alive(sentinel.pid!), true, "unrelated sentinel survives");
}

afterEach(async () => {
	for (const id of registry()) cancelJob(JOBS, id);
	for (const c of live) c.kill("SIGKILL");
	for (const [pid, start] of survivors) if (start && identity(pid) === start) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
});

after(async () => {
	for (const id of registry()) cancelJob(JOBS, id);
	for (const c of live) c.kill("SIGKILL");
	for (const [pid, start] of survivors) if (start && identity(pid) === start) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
	sentinel.kill("SIGKILL");
	await new Promise<void>((resolve) => sentinel.exitCode !== null || sentinel.signalCode !== null ? resolve() : sentinel.once("exit", () => resolve()));
	cleanup();
});

/** Fixture-only codemode: test the child tool's programmatic contract without adding codemode to child profiles. */
async function programmaticBash(store: string, cwd: string, code: string) {
	const bash = new BackgroundBash({ chatId: store, cwd, rootId: () => undefined });
	const extension = bash.extension(true);
	assert.deepEqual(extension.tools!.map((t) => t.name), ["bash"]);
	assert.deepEqual(extension.tools![0]!.structuredOutputSchema, createBashTool().structuredOutputSchema);
	assert.doesNotMatch(JSON.stringify(extension.tools![0]!.parameters), /"foreground"/);
	const sandbox = new CodemodeSandbox();
	const h = await openHost(store, { extensions: [extension, createCodemodeExtension({ sandbox })], faux: { tokensPerSecond: 5000 } });
	try {
		h.faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }), fauxAssistantMessage([fauxText("done")])]);
		await (await h.root.submit({ type: "input", content: "run", requestId: "programmatic" }, context)).wait(context);
		const result = (await entriesOf(h.harness, h.root.id)).find((entry) => entry.kind === "pi.tool-result")!;
		const message = result.model![0] as Message;
		assert.notEqual(message.isError, true, textOf(message.content));
		const output = textOf(message.content);
		return JSON.parse(output.slice(output.indexOf("Output:\n") + "Output:\n".length));
	} finally {
		bash.close();
		await h.close();
		await sandbox.close();
	}
}

test("design C: child programmatic bash retains native schemas, stdout, empty output and nonzero exit fields", async () => {
	const { store, cwd } = family("deadline-programmatic");
	const results = await programmaticBash(store, cwd, `const results = []; for (const command of ["printf program-output", "true", "printf failed-output; exit 7"]) results.push(await tools.bash({command, timeout: 5})); return JSON.stringify(results);`);
	assert.deepEqual(results, [
		{ output: "program-output", truncated: false, exitCode: 0 },
		{ output: "", truncated: false, exitCode: 0 },
		{ output: "failed-output", truncated: false, exitCode: 7 },
	]);
});

test("design C: child programmatic bash retains the native tail and a complete split-secret-safe spill", async () => {
	const { store, cwd } = family("deadline-programmatic-spill");
	const secret = "childSpillSecret-4d80725605bc4b9f";
	process.env.DEADLINE_SPILL_PASSWORD = secret;
	try {
		// The env secret crosses the 64 KiB read boundary; an unterminated key at EOF must also be sealed.
		const script = `process.stdout.write("HEAD\\n" + "a\\n".repeat(32760) + "123456 " + process.env.DEADLINE_SPILL_PASSWORD + "\\n" + "b\\n".repeat(5000) + "c".repeat(30000) + "\\nTAIL\\n-----BEGIN " + "RSA PRIVATE KEY-----\\nprivatePayload")`;
		const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
		const result = await programmaticBash(store, cwd, `const r = await tools.bash(${JSON.stringify({ command, timeout: 5 })}); return JSON.stringify({...r, outputLength: r.output.length, output: r.output.slice(-200)});`);
		assert.equal(result.exitCode, 0);
		assert.equal(result.truncated, true);
		assert.ok(result.outputLength > 12000, "the child retains the native window, not the managed lead's 12 KB tail");
		assert.ok(!result.output.includes("HEAD"));
		assert.match(result.output, /TAIL/);
		assert.match(result.fullOutputPath, /output\.sanitized\.log$/);
		const complete = readFileSync(result.fullOutputPath, "utf8");
		assert.ok(complete.startsWith("HEAD\n"));
		assert.match(complete, /TAIL/);
		assert.ok(!complete.includes(secret));
		assert.ok(!complete.includes("privatePayload"));
		assert.match(complete, /REDACTED:env:DEADLINE_SPILL_PASSWORD/);
		assert.match(complete, /REDACTED:private-key/);
		assert.equal(statSync(result.fullOutputPath).mode & 0o777, 0o600);
	} finally { delete process.env.DEADLINE_SPILL_PASSWORD; }
});

test("design C: healthy child stays blocking, uses managed output and the visible 1200-second default", async () => {
	const { store, cwd } = family("deadline-healthy");
	const h = open(store, cwd);
	await h.ready;
	await launch(h, "printf healthy");
	await done(h);
	assert.equal(h.events.filter(isStuck).length, 0);
	await h.close();
	const r = await inspect(store, cwd);
	assert.equal(textOf(r.results[0]!.content), "healthy");
	assert.equal(r.results[0]!.isError, false);
	assert.match(r.description, /1200 seconds/);
	assert.equal(Object.keys(r.refs).length, 1, "the child used the existing job registry");
	assert.equal(record(Object.keys(r.refs)[0]!).ownerExecutionId, r.e.executionId);
	assert.equal(record(Object.keys(r.refs)[0]!).timeout, 4, "test-only seconds replace the 20-minute default");
});

test("design C: hung promise, ordinary descendant and detached real Playwright browser: one notice, absolute expiry, no survivors, next bash works", async () => {
	const { store, cwd } = family("deadline-browser");
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "6", PILOT_REPORT_QUIET_MS: "1000", PILOT_STUCK_GRACE_MS: "1000" });
	await h.ready;
	await launch(h, browserFixture(cwd));
	await waitFor(() => existsSync(join(cwd, "pids.json")), "the real browser");
	const owned = pids(cwd);
	const pgids = owned.map((pid) => execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim());
	assert.notEqual(pgids[0], pgids[2], "Playwright really detached the browser group");
	const n = (await h.until(isStuck, "no-progress notice")).message as Message;
	assert.match(textOf(n.content), /no observed progress.*command age .*deadline .*last captured output/s);
	await done(h);
	await noSurvivors(owned);
	assert.equal(h.events.filter(isStuck).filter((e) => (e.message as Message).details?.jobId === n.details?.jobId).length, 1, "one notice per command, even across the quiet-report window");
	assert.ok(h.events.filter(isStuck).every((e) => (e.message as Message).details?.reason === "no-progress" || (e.message as Message).details?.tool !== "bash"), "managed commands use no second stuck-notice trigger");
	await prompt(h, call("subagent", { profile: "scout", cognitiveRole: "routine", background: false, task: call("bash", { command: "printf ok" }) }));
	await h.until(() => h.events.filter(tool("subagent")).length === 2, "the next child bash");
	await h.close();
	const r = await inspect(store, cwd);
	assert.equal(textOf(r.results[0]!.content), "ok");
	const jobs = registry().filter((id) => record(id).cwd === cwd && record(id).command.includes("hang.cjs"));
	assert.equal(jobs.length, 1);
	const j = record(jobs[0]!); const result = exit(jobs[0]!);
	assert.match(result.error, /Timed out/);
	assert.deepEqual(result.cleanup.survivors, []);
	assert.ok(result.finishedAt >= j.expiresAt && result.finishedAt < j.expiresAt + 5000);
});

test("design C: command > log & and early shell exit never completes cleanly with a writer or detached browser", async () => {
	const { store, cwd } = family("deadline-early-shell");
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "15" });
	await h.ready;
	await launch(h, `${browserFixture(cwd)} > writer.log 2>&1 & while [ ! -e pids.json ]; do sleep 0.02; done; exit 0`);
	await waitFor(() => existsSync(join(cwd, "pids.json")), "the writer's browser");
	const owned = pids(cwd);
	await done(h);
	await noSurvivors(owned);
	await h.close();
	const r = await inspect(store, cwd);
	assert.equal(r.results[0]!.isError, true);
	assert.match(textOf(r.results[0]!.content), /Shell exited with owned descendants/);
	const id = Object.keys(r.refs)[0]!;
	assert.ok(exit(id).finishedAt < record(id).expiresAt, "shell exit triggers cleanup, not a later wait timeout");
});

for (const mode of ["override", "silent", "noisy", "redirected"] as const) test(`design C: ${mode} workload keeps an absolute deadline and truthful output-based suspicion`, async () => {
	const { store, cwd } = family(`deadline-${mode}`);
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "2" });
	await h.ready;
	const command = mode === "noisy" ? 'while :; do echo tick; sleep 0.1; done'
		: mode === "redirected" ? 'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do echo tick >> progress.log; sleep 0.1; done; printf done'
		: 'sleep 3; printf done';
	await launch(h, command, mode === "noisy" ? {} : { timeout: 8, ...(mode === "redirected" ? { progressLog: "progress.log" } : {}) });
	await done(h);
	await h.close();
	const r = await inspect(store, cwd);
	assert.equal(Object.keys(r.refs).length, 1);
	const id = Object.keys(r.refs)[0]!;
	assert.equal(record(id).expiresAt - record(id).startedAt, mode === "noisy" ? 2000 : 8000);
	assert.equal(r.results[0]!.isError, mode === "noisy");
	assert.equal(h.events.filter(isStuck).length, mode === "noisy" || mode === "redirected" ? 0 : 1);
	if (mode === "noisy") assert.match(exit(id).error, /Timed out after 2 seconds/);
});

for (const window of ["intent", "spawned"] as const) test(`design C: kill/reopen after ${window}: one launch/result, unchanged expiry and unblocked next command`, async () => {
	const { store, cwd } = family(`deadline-kill-${window}`);
	const h = open(store, cwd, { PI_DURABLE_CRASH_AT: `bash.${window}`, PILOT_CHILD_BASH_TIMEOUT_S: "12" });
	await h.ready;
	await launch(h, 'echo launch >> launches; sleep 3; printf restored').catch(() => {});
	await crashed(h);
	let originalExpiry: number | undefined;
	if (window === "spawned") {
		await waitFor(() => existsSync(join(cwd, "launches")), "the runner launch");
		originalExpiry = record(registry().find((id) => record(id).cwd === cwd)!).expiresAt;
	}
	const second = open(store, cwd);
	await second.ready;
	assert.ok((await second.call<{ warnings?: unknown[] }>("status")).warnings!.length > 0, "restore remains paused");
	await prompt(second, "resume");
	await done(second);
	await second.close();
	const r = await inspect(store, cwd);
	const id = Object.keys(r.refs)[0]!;
	assert.equal(readFileSync(join(cwd, "launches"), "utf8"), "launch\n");
	assert.equal(r.results.length, 1);
	assert.equal(textOf(r.results[0]!.content), "restored");
	assert.equal(record(id).expiresAt, originalExpiry ?? r.refs[id]!.expiresAt);
	assert.equal(record(id).timeout, 12, "resume's shorter default cannot replace the admitted budget");
});

test("design C: cancellation waits for owned detached browser cleanup before confirming the receipt", async () => {
	const { store, cwd } = family("deadline-cancel");
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "30" });
	await h.ready;
	const id = await launch(h, browserFixture(cwd));
	await waitFor(() => existsSync(join(cwd, "pids.json")), "the browser before cancellation");
	const owned = pids(cwd);
	await prompt(h, call("subagent_cancel", { executionId: id }));
	const result = await h.until(tool("subagent_cancel"), "confirmed cancellation");
	assert.match(textOf((result.message as Message).content), /cancelled/);
	assert.ok(owned.every((pid) => !alive(pid)), "no receipt before cleanup");
	await noSurvivors(owned);
	await h.close();
	const r = await inspect(store, cwd);
	assert.equal(exit(Object.keys(r.refs)[0]!).cancelled, true);
});

test("design C: no-output notice is redacted and revalidated after cancellation before delivery", async () => {
	const { store, cwd } = family("deadline-notice-cancel");
	const secret = 'notice"Secret\\value-934aa81d6e8f';
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "30", DEADLINE_TEST_PASSWORD: secret, PI_DURABLE_HOLD: "progress:after-mark@2500,cancel:after-mark@3500" });
	await h.ready;
	const id = await launch(h, 'printf "%s" "$DEADLINE_TEST_PASSWORD"; sleep 20');
	await marked(h);
	await prompt(h, call("subagent_cancel", { executionId: id }));
	await h.until(tool("subagent_cancel"), "cancellation");
	assert.equal(h.events.filter(isStuck).length, 0);
	await h.close();
	const r = await inspect(store, cwd);
	assert.ok(r.e.progressNotice);
	assert.ok(!JSON.stringify(r.e.progressNotice).includes(secret));
	assert.match(r.e.progressNotice!.text, /REDACTED/);
});

test("design C: worker checkpoint and subsequent dispatch use bounded commands without inheriting old jobs", async () => {
	const { store, cwd } = family("deadline-worker");
	const h = open(store, cwd);
	await h.ready;
	await prompt(h, call("tools_enable", { group: "workers" }));
	await h.until(tool("tools_enable"), "worker tools");
	await prompt(h, call("worker_create", { name: "Bounded worker", scope: "deadline test", profile: "implementer" }));
	const created = await h.until(tool("worker_create"), "worker identity");
	const workerId = /Created worker (\S+)/.exec(textOf((created.message as Message).content))![1]!;
	await prompt(h, call("worker_dispatch", { workerId, cognitiveRole: "routine", background: false, task: `calls:${JSON.stringify([{ name: "bash", arguments: { command: "printf first" } }, { name: "compact_and_continue", arguments: { summaryFocus: "deadline", nextPhase: call("bash", { command: "printf continued" }) } }])}` }));
	await h.until(tool("worker_dispatch"), "checkpointed dispatch");
	await prompt(h, call("worker_dispatch", { workerId, cognitiveRole: "routine", background: false, task: call("bash", { command: "printf resumed" }) }));
	await h.until(() => h.events.filter(tool("worker_dispatch")).length === 2, "resumed dispatch");
	await h.close();
	const r = await inspect(store, cwd);
	assert.equal(r.e.continuing, true);
	assert.equal(textOf(r.results.at(-1)!.content), "resumed");
	assert.equal(Object.keys(r.refs).length, 1, "worker forks never inherit previous dispatch jobs");
	for (const id of registry().filter((id) => record(id).cwd === cwd)) assert.deepEqual(exit(id).cleanup.survivors, []);
});


test("design C: invalid non-finite, non-positive and timer-overflow overrides are rejected before admission", async () => {
	const { BackgroundBash } = await import("../src/background-bash.ts");
	const bash = new BackgroundBash({ chatId: "invalid", cwd: ROOT, rootId: () => 1 as never });
	const t = bash.extension(true).tools!.find((t) => t.name === "bash")!;
	const api = { taskId: "invalid", conversationId: 2, snapshot: async () => undefined };
	for (const timeout of [NaN, Infinity, -Infinity, 0, -1, 2_147_484])
		await assert.rejects((t.execute as (...args: unknown[]) => Promise<unknown>)({ command: "printf wrong", timeout }, api, context), /Invalid timeout/);
	assert.match(t.description, /1200 seconds/, "the admitted API remains the bounded child tool");
});

test("design C: an intent resumed after expiry never starts its writes", async () => {
	const { store, cwd } = family("deadline-expired-intent");
	const first = open(store, cwd, { PI_DURABLE_CRASH_AT: "bash.intent", PILOT_CHILD_BASH_TIMEOUT_S: "1" });
	await first.ready;
	await launch(first, "echo wrong > must-not-exist");
	await crashed(first);
	const afterExpiry = Date.now() + 1200;
	await waitFor(() => Date.now() >= afterExpiry, "the admitted deadline to pass");
	const second = open(store, cwd);
	await second.ready;
	await prompt(second, "resume");
	await done(second);
	await second.close();
	assert.equal(existsSync(join(cwd, "must-not-exist")), false);
	const r = await inspect(store, cwd);
	assert.match(textOf(r.results[0]!.content), /Timed out.*before launch/);
	assert.equal(r.results[0]!.isError, true);
});

test("design C: a notice marked before host loss uses the same channel and request ID after paused restore", async () => {
	const { store, cwd } = family("deadline-notice-restart");
	const first = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "12", PI_DURABLE_HOLD: "progress:after-mark" });
	await first.ready;
	await launch(first, "echo once >> launches; sleep 6; printf completed");
	await marked(first);
	const id = registry().find((id) => record(id).cwd === cwd)!;
	const expiresAt = record(id).expiresAt;
	await first.kill();
	const second = open(store, cwd);
	await second.ready;
	assert.equal(second.events.filter(isStuck).length, 0, "no notice wakes a paused restore");
	await prompt(second, "resume");
	await second.until(isStuck, "the resumed notice");
	await done(second);
	assert.equal(second.events.filter(isStuck).length, 1);
	await second.close();
	assert.equal(record(id).expiresAt, expiresAt);
	assert.equal(readFileSync(join(cwd, "launches"), "utf8"), "once\n");
});

test("design C: explicit Chat end waits for owned detached browser cleanup", async () => {
	const { store, cwd } = family("deadline-end");
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "30" });
	await h.ready;
	await launch(h, browserFixture(cwd));
	await waitFor(() => existsSync(join(cwd, "pids.json")), "browser before Chat end");
	const owned = pids(cwd);
	await h.call("close", { end: true });
	await h.exited;
	assert.ok(owned.every((pid) => !alive(pid)), "end returns after cleanup");
	await noSurvivors(owned);
	const id = registry().find((id) => record(id).cwd === cwd)!;
	assert.equal(exit(id).cancelled, true);
});

test("design C: a vanished claimed runner is unknown/failed, never rerun or reported as clean completion", async () => {
	const { store, cwd } = family("deadline-runner-loss");
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "30" });
	await h.ready;
	await launch(h, "echo launch >> launches; echo $$ > shell.pid; sleep 20");
	await waitFor(() => existsSync(join(cwd, "launches")), "the runner's possible write");
	const id = registry().find((id) => record(id).cwd === cwd);
	assert.ok(id, "the child must be a managed job");
	const pid = JSON.parse(readFileSync(join(JOBS, id, "claim"), "utf8")).pid as number;
	process.kill(pid, "SIGKILL");
	// These are this test's still-owned group members, not a process selected by executable name.
	try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
	await done(h);
	await h.close();
	const r = await inspect(store, cwd);
	assert.equal(readFileSync(join(cwd, "launches"), "utf8"), "launch\n");
	assert.match(textOf(r.results[0]!.content), /runner ended without recording.*not run again/s);
	assert.equal(r.results[0]!.isError, true);
	assert.equal(r.e.outcome, "execution_failed", "missing cleanup receipt cannot become clean completion");
});

test("design C upgrade keeps issue #18's old-native uncertain-effect guard even though new child commands are managed", async () => {
	const { store, cwd } = family("deadline-old-native");
	const fixture = fork(fileURLToPath(new URL("./native-bash-before-upgrade.ts", import.meta.url)), [store, cwd], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
	live.add(fixture);
	await waitFor(() => existsSync(join(cwd, "native.pid")), "the old unsafe bash effect");
	const nativePid = Number(readFileSync(join(cwd, "native.pid"), "utf8"));
	const start = identity(nativePid);
	await new Promise<void>((resolve) => { fixture.once("exit", () => resolve()); fixture.kill("SIGKILL"); });
	live.delete(fixture);
	if (start && identity(nativePid) === start) try { process.kill(-nativePid, "SIGKILL"); } catch { /* gone */ }
	const h = await openChatHost({ dir: store, cwd, model: "faux", chatId: store });
	try {
		assert.equal(h.uncertain.length, 1, "stored unsafe policy still requires reconciliation");
		await h.resume();
		const submission = await h.root.submit({ type: "input", content: call("bash", { description: "Must stay blocked", command: "echo wrong >> writes", foreground: true }), whenBusy: "followUp" }, context);
		await submission.wait(context);
		const entries = (await h.root.entries({ order: "ascending" }, 1000, undefined, context)).items;
		const results = entries.flatMap((e) => e.model ?? []).filter((m) => m.role === "toolResult");
		assert.match(textOf(results.at(-1)!.content), /Needs reconciliation/);
		assert.equal(readFileSync(join(cwd, "writes"), "utf8"), "old\n", "old native bash and new proposals never rerun possible writes");
		const childTool = h.registry.snapshot().tools().find(({ extension, tool }) => extension.name === "workbench.native-bash" && tool.name === "bash")?.tool;
		assert.match(childTool?.description ?? "", /1200 seconds/, "the new tool is managed without upgrading the old task's replay policy");
	} finally { await h.close(); }
});


test("design C: cancellation in the admitted-intent/snapshot gap cannot launch a writer after cleanup confirmed", async () => {
	const { BackgroundBash, stopChildCommands } = await import("../src/background-bash.ts");
	const { ChildDoc } = await import("../src/delegation.ts");
	const { cwd } = family("deadline-pending-cancel");
	const bash = new BackgroundBash({ chatId: "pending-cancel", cwd, rootId: () => 1 as never });
	const t = bash.extension(true).tools!.find((t) => t.name === "bash")!;
	assert.match(t.description, /1200 seconds/);
	const doc = { jobs: {} as Record<string, unknown> };
	let release!: () => void; let entered!: () => void;
	const held = new Promise<void>((r) => (release = r));
	const reached = new Promise<void>((r) => (entered = r));
	const controller = new AbortController();
	const api = {
		taskId: "pending", callId: "pending", conversationId: 2, now: () => Date.now(), output: () => {},
		snapshot: async (kind: unknown) => { if (kind === ChildDoc) { entered(); await held; return { kind: "subagent" }; } return kind === BashJobsDoc ? doc : undefined; },
		commit: async (fn: (tx: unknown) => Promise<unknown>) => fn({ doc: async () => doc }),
		retainedOutput: () => ({ text: "" }),
	};
	const running = (t.execute as (...args: unknown[]) => Promise<{ isError?: boolean }>)({ command: "echo abandoned > must-not-exist" }, api, { abortSignal: controller.signal });
	await reached;
	controller.abort();
	const reader = { snapshot: async () => doc };
	assert.equal(await stopChildCommands(reader as never, 2 as never, context), true, "no runner existed at the cancellation sweep");
	release();
	await assert.rejects(running, /Command aborted/);
	assert.equal(existsSync(join(cwd, "must-not-exist")), false);
	const id = Object.keys(doc.jobs)[0]!;
	assert.equal(exit(id).cancelled, true);
	assert.equal(existsSync(join(JOBS, id, "claim")), false, "no late runner starts");
});


test("design C: output after a marked notice drops stale evidence, then one new quiet span gets a current notice", async () => {
	const { store, cwd } = family("deadline-progress-revalidation");
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "12", PI_DURABLE_HOLD: "progress:after-mark@1800" });
	await h.ready;
	await launch(h, "printf start; sleep 1.5; printf resumed; sleep 5; printf finished");
	const n = (await Promise.race([h.until(isStuck, "a revalidated current notice"), done(h).then(() => assert.fail("command completed without its current no-progress notice"))])).message as Message;
	assert.match(textOf(n.content), /startresumed/);
	await done(h);
	assert.equal(h.events.filter(isStuck).length, 1, "no stale notice or re-armed duplicate");
	await h.close();
	const r = await inspect(store, cwd);
	assert.equal(r.e.progressNotice?.admitted, true);
	assert.ok(Date.parse(String(n.details?.lastOutputAt)) >= record(Object.keys(r.refs)[0]!).startedAt + 1300);
});


test("design C: ending a crashed host through --end-jobs also waits for detached browser cleanup", async () => {
	const { store, cwd } = family("deadline-end-crashed");
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "30" });
	await h.ready;
	await launch(h, browserFixture(cwd));
	await waitFor(() => existsSync(join(cwd, "pids.json")), "browser before host loss");
	const owned = pids(cwd);
	await h.kill();
	const end = fork(fileURLToPath(new URL("../src/chat-host-main.ts", import.meta.url)), ["--end-jobs", "--store", store, "--session-id", store], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
	live.add(end);
	const code = await new Promise<number | null>((resolve) => end.once("exit", resolve));
	live.delete(end);
	assert.equal(code, 0);
	assert.ok(owned.every((pid) => !alive(pid)), "the one-off cleanup cannot exit before its runner cleaned up");
	await noSurvivors(owned);
	const id = registry().find((id) => record(id).cwd === cwd)!;
	assert.deepEqual(exit(id).cleanup.survivors, []);
});


test("design C: a Worker's foreground leaf reports no observed progress directly to the lead before the leaf returns", async () => {
	const { store, cwd } = family("deadline-worker-leaf-notice");
	const h = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "8", PILOT_REPORT_QUIET_MS: "1000", PILOT_STUCK_GRACE_MS: "1000" });
	await h.ready;
	await prompt(h, call("tools_enable", { group: "workers" }));
	await h.until(tool("tools_enable"), "worker tools");
	await prompt(h, call("worker_create", { name: "Waiting worker", scope: "foreground leaf", profile: "coordinator" }));
	const created = await h.until(tool("worker_create"), "worker creation");
	const workerId = /Created worker (\S+)/.exec(textOf((created.message as Message).content))![1]!;
	const leaf = call("subagent", { profile: "scout", cognitiveRole: "routine", background: false, task: call("bash", { command: "sleep 5; echo returned > leaf-returned" }) });
	await prompt(h, call("worker_dispatch", { workerId, cognitiveRole: "coordination", background: true, task: leaf }));
	const launched = await h.until(tool("worker_dispatch"), "worker launch");
	const executionId = /Dispatched worker (\S+)/.exec(textOf((launched.message as Message).content))![1]!;
	const n = (await h.until(isStuck, "the lead's command notice")).message as Message;
	assert.equal(existsSync(join(cwd, "leaf-returned")), false, "the notice does not wait for the blocked Worker to read it");
	assert.equal(n.details?.executionId, executionId);
	assert.notEqual(n.details?.commandExecutionId, executionId, "the notice names the actual leaf command's owner");
	assert.equal(n.details?.reason, "no-progress");
	await done(h);
	assert.equal(h.events.filter(isStuck).filter((e) => (e.message as Message).details?.jobId === n.details?.jobId).length, 1);
	await h.close();
});


test("design C: a runner that fails before its claim settles as failed, never starts writes and is not relaunched", async () => {
	const id = "preclaim-runner-loss";
	launchJob({ root: JOBS, id, command: "echo wrong > must-not-exist", description: "Preclaim loss", cwd: ROOT, timeout: 2, owned: true, startedAt: Date.now(), env: process.env, sessionId: "preclaim", runnerPath: join(ROOT, "missing-runner.mjs") });
	await waitFor(() => !["pending", "running"].includes(readJob(JOBS, id)?.state ?? ""), "failed pre-claim runner");
	assert.equal(readJob(JOBS, id)?.state, "failed");
	assert.match(exit(id).error ?? "", /before claiming.*not run again/);
	assert.equal(launchJob({ root: JOBS, id, command: "echo wrong > must-not-exist", description: "Never retry", cwd: ROOT, timeout: 2, owned: true, startedAt: Date.now(), env: process.env, sessionId: "preclaim" }), false);
	assert.equal(existsSync(join(ROOT, "must-not-exist")), false);
});

test("design C: host loss before a missing runner claims cannot turn the admitted deadline into an infinite wait", async () => {
	const id = "expired-preclaim";
	const dir = join(JOBS, id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "output.log"), "");
	writeFileSync(join(dir, "job.json"), JSON.stringify({ id, owned: true, command: "echo wrong", cwd: ROOT, startedAt: Date.now() - 2000, expiresAt: Date.now() - 1000, timeout: 1 }));
	assert.equal(readJob(JOBS, id)?.state, "failed");
	assert.match(exit(id).error ?? "", /Timed out.*before launch/);
	assert.deepEqual(exit(id).cleanup.survivors, []);
	assert.equal(existsSync(join(dir, "claim")), false);
});
