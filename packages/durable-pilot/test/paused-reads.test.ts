// Reads never schedule (plan decision 2, paused restore): a family restored with a pending lead generation and every host
// component's saved state — a running background Subagent, a Workbench bash job that finished while the host was down,
// an Atelier Page with a due human Comment, a restored pi-process-monitor tail watcher, and storage-guard's low-disk
// reading — stays paused while PI WEB opens it and reads status, transcript, tree, info and commands, while a watcher
// notification arrives, and when the paused host is closed and reopened. No provider request and no effect until the
// owner explicitly resumes by sending; then every held delivery arrives once.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ChatHost, live, logged, type Message, textOf, waitFor, writeFakeLogins } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

type Status = { isStreaming: boolean; warnings?: { message: string }[] };

const INSTALLED = process.env.PILOT_PI_PACKAGES ?? join(homedir(), ".pi", "agent", "npm", "node_modules");
const ROOT = scratch("paused-reads");
const JOBS = join(ROOT, "jobs");
const UNDO = 3_000;

before(() => {
	for (const name of ["pi-web-access", "ping-a-human-pi", "pi-process-monitor"])
		assert.ok(existsSync(join(INSTALLED, name, "package.json")), `installed package ${name} in ${INSTALLED}`);
});

after(() => {
	for (const child of live) child.kill("SIGKILL");
	for (const id of existsSync(JOBS) ? readdirSync(JOBS) : []) {
		try {
			process.kill(-JSON.parse(readFileSync(join(JOBS, id, "claim"), "utf8")).pid, "SIGKILL");
		} catch {
			// gone
		}
	}
	cleanup();
});

function family() {
	const home = join(ROOT, "home");
	const agentDir = join(home, ".pi", "agent");
	const cwd = join(ROOT, "workspace");
	for (const path of [agentDir, cwd, join(ROOT, "tmp")]) mkdirSync(path, { recursive: true });
	writeFakeLogins(agentDir, "paused");
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["pi-web-access", "ping-a-human-pi", "pi-process-monitor"].map((name) => join(INSTALLED, name)) }));
	writeFileSync(join(cwd, "page.html"), "<!doctype html><title>t</title><div atl-key='a' atl-ver='1'>A</div>");
	writeFileSync(join(cwd, "job.log"), "");
	const quota = join(ROOT, "quota.json");
	const env = {
		...process.env,
		HOME: home,
		PI_CODING_AGENT_DIR: agentDir,
		PI_TELEMETRY_DIR: join(ROOT, "telemetry"),
		PI_TMP_ROOT: join(ROOT, "pi-tmp"),
		PI_BACKGROUND_BASH_ROOT: JOBS,
		PI_WORKBENCH_QUOTA_CACHE: quota,
		ATELIER_PAGE_CHECK: "off",
		// Below the storage-guard threshold: a new input would get the low-disk notice first, a read must not.
		PI_STORAGE_GUARD_FREE_GB: "1",
		TMPDIR: join(ROOT, "tmp"),
	};
	return { store: join(ROOT, "family"), cwd, env, quota, page: join(cwd, "page.html"), log: join(cwd, "job.log") };
}
type Family = ReturnType<typeof family>;

function host(f: Family, tps?: number): ChatHost {
	// A fresh empty quota snapshot: child routing never runs quota-axi.
	writeFileSync(f.quota, JSON.stringify({ version: 1, checkedAt: Date.now(), status: 0, stdout: JSON.stringify({ providers: [] }), stderr: "" }));
	return new ChatHost(f.store, f.cwd, { env: f.env, ...(tps === undefined ? {} : { tps }), args: ["--session-id", "chat-paused", "--packages", "--scripted-providers"] });
}

const call = (tool: string, args: object) => `call:${tool} ${JSON.stringify(args)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const events = (page: string) => (existsSync(`${page}.events.jsonl`) ? readFileSync(`${page}.events.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { seq: number; type: string; of?: number[] }) : []);
const launches = (cwd: string) => (existsSync(join(cwd, "launches.log")) ? readFileSync(join(cwd, "launches.log"), "utf8").trim().split("\n").length : 0);

/** Everything a paused host must leave as it was. */
function effects(f: Family) {
	return {
		requests: logged(f.store).length,
		launches: launches(f.cwd),
		receipts: events(f.page).filter((e) => e.type === "delivered" || e.type === "received").length,
	};
}

/** What PI WEB does when it opens a Chat to show it, then the owner's reads: nothing here may send or run anything. */
async function readOnly(h: ChatHost): Promise<void> {
	await h.call("configure", { resources: {} });
	await h.call("status");
	await h.call("transcript");
	await h.call("tree");
	await h.call("info");
	await h.call("commands");
}

async function assertPaused(h: ChatHost, f: Family, before: ReturnType<typeof effects>, what: string): Promise<void> {
	assert.deepEqual(effects(f), before, `${what}: no provider request, launch or Atelier receipt`);
	const status = await h.call<Status>("status");
	assert.ok((status.warnings ?? []).some((w) => /Restored paused/.test(w.message)), `${what}: still reported paused`);
	assert.ok(!h.events.some((e) => e.type === "agent.start"), `${what}: no run started`);
}

test("reads never schedule: a paused restore with every component's saved state stays paused through status, transcript, tree, a watcher notification and a close, until the owner sends", async () => {
	const f = family();
	// ─── Saved state, then a kill mid-generation ──────────────────────────────
	const first = host(f, 30);
	await first.ready;
	let runs = 0;
	const run = async (operationId: string, text: string) => {
		await first.call("prompt", { operationId, text });
		await first.idle(++runs);
	};
	await run("enable", call("tools_enable", { group: "atelier" }));
	await run("open", call("atelier", { action: "open", page: "page.html" }));
	const url = /Page open: (http:\/\/127\.0\.0\.1:\d+\/page\.html)/.exec(String(first.events.find((e) => e.type === "tool.end" && e.toolName === "atelier")?.text))?.[1] ?? assert.fail("no Page URL");
	// The monitor tools are a tool group (hidden until enabled), as in legacy Chats.
	await run("enable-monitor", call("tools_enable", { group: "monitor" }));
	await run("watch", call("monitor", { source: { type: "tail", path: f.log }, options: { notifyOn: ["DONE"], coalesceSeconds: 0, label: "job" } }));
	await run("bash", call("bash", { description: "Outlives host", command: "echo x >> launches.log; sleep 3; echo survived" }));
	const job = /bash ([0-9a-f-]{36})/.exec(String(first.events.find((e) => e.type === "tool.end" && e.toolName === "bash")?.text))?.[1] ?? assert.fail("no job ID");
	await run("child", call("subagent", { task: "gen", profile: "scout", cognitiveRole: "routine", background: true, name: "Paused child" }));
	await first.call("prompt", { operationId: "gen", text: "gen" });
	await first.until((e) => e.type === "assistant.delta", "a committed partial of the lead's generation");
	const comment = await fetch(`${new URL(url).origin}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "comment", key: "a", text: "while paused" }) });
	assert.equal(comment.status, 200);
	await first.kill();
	// While the host is down: the job finishes and the Comment's undo window closes.
	await waitFor(() => existsSync(join(JOBS, job, "exit")), "the job finishing while the host is gone");
	await sleep(UNDO + 300);
	const before = effects(f);
	const childRequests = () => logged(f.store).filter((l) => l.label === "gen" && (l as { model?: string }).model !== undefined).length;
	assert.equal(childRequests(), 1, "the background Subagent's generation was interrupted too");
	assert.equal(before.launches, 1);
	assert.equal(before.receipts, 0);

	// ─── Open and read only; a watcher notification arrives; close while paused ──
	const second = host(f);
	await second.ready;
	await readOnly(second);
	appendFileSync(f.log, "step one DONE\n");
	await sleep(2_500); // bash reporter polls every 500 ms, the watcher reads within 150 ms, Atelier delivers at once
	await readOnly(second);
	await assertPaused(second, f, before, "open, reads and a watcher notification");
	await second.close();
	assert.deepEqual(effects(f), before, "closing a paused host sends and runs nothing");

	// ─── Reopen: still paused; then the owner sends, and every held delivery arrives once ──
	const third = host(f);
	await third.ready;
	await readOnly(third);
	appendFileSync(f.log, "step two DONE\n");
	await sleep(1_500);
	await assertPaused(third, f, before, "reopen after a paused close");
	await third.call("prompt", { operationId: "resume", text: "next" });
	await third.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === "ok: next", "the owner's input answered");
	await waitFor(() => events(f.page).some((e) => e.type === "received"), "the Comment delivered after resume");
	await third.until((e) => e.type === "message.end" && (e.message as Message).customType === "monitor" && textOf((e.message as Message).content).includes("step two DONE"), "the watcher notification held until resume");
	const messages = (await third.call<{ messages: Message[] }>("transcript")).messages;
	await waitFor(() => logged(f.store).some((l) => l.label.startsWith("Background bash")), "the bash completion after resume");
	assert.equal(messages.filter((m) => m.customType === "atelier:immediate").length, 1, "the Comment once");
	assert.equal(logged(f.store).filter((l) => l.label === "gen" && (l as { model?: string }).model === undefined).length, 2, "the lead's generation reissued once, only after resume");
	await waitFor(() => childRequests() === 2, "the Subagent's generation reissued after resume");
	assert.equal(launches(f.cwd), 1, "the job never relaunched");
	await third.close();
});
