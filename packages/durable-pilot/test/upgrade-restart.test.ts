// Seamless host upgrades: PI WEB's "Upgrade now" as crash-matrix trigger rows 1–8, against the real Chat host process.
// Each iteration runs a family to its barrier, then does what Upgrade now does: an ordered close with reason `upgrade`,
// a new host on the same store, and `resume` at once (no paused restore). Recovery is the crash path's: an interrupted
// answer is requested again, a safe tool reruns, an unsafe one is held for the owner, children and background bash go
// on. Storage is every host's default (WAL + synchronous=FULL + fullfsync=ON). Evidence: results/evidence/upgrade.<row>.jsonl.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ChatSession } from "../src/chat-session.ts";
import { ChatHost, family, integrity, live, logged, type Message, type Status, textOf, type Transcript, waitFor } from "./chat-proc.ts";
import { cleanup, runRow, scratch } from "./runner.ts";

const ROOT = scratch("upgrade-rows");
const TELEMETRY = join(ROOT, "telemetry");
const JOBS = join(ROOT, "jobs");
process.env.PI_TELEMETRY_DIR = TELEMETRY;
process.env.PI_BACKGROUND_BASH_ROOT = JOBS;
process.env.PI_TMP_ROOT = join(ROOT, "pi-tmp");
process.env.ATELIER_PAGE_CHECK = "off";
const QUOTA = join(ROOT, "quota.json");
process.env.PI_WORKBENCH_QUOTA_CACHE = QUOTA;

after(() => {
	for (const child of live) child.kill("SIGKILL");
	for (const id of existsSync(JOBS) ? readdirSync(JOBS) : []) {
		try {
			process.kill(-(JSON.parse(readFileSync(join(JOBS, id, "claim"), "utf8")) as { pid: number }).pid, "SIGKILL");
		} catch {
			// gone
		}
	}
	cleanup();
});

/** A host on the scripted model with routed children; the quota snapshot is fresh, so routing never runs quota-axi. */
function host(store: string, cwd: string, id: string, tps = 400): ChatHost {
	writeFileSync(QUOTA, JSON.stringify({ version: 1, checkedAt: Date.now(), status: 0, stdout: JSON.stringify({ providers: [] }), stderr: "" }));
	return new ChatHost(store, cwd, { tps, args: ["--scripted-providers", "--session-id", id] });
}

/**
 * Upgrade now, as PI WEB runs it: the old host closes in order with reason `upgrade` (exit 0), a new host opens the
 * store and is resumed at once. `closing` runs once the close is sent (a held write's release).
 */
async function upgrade(old: ChatHost, open: () => ChatHost, closing?: () => Promise<void>): Promise<ChatHost> {
	const closed = old.call("close", { reason: "upgrade" });
	await closing?.();
	await closed;
	assert.equal(await old.exited, 0, "the old host closed in order");
	const next = open();
	await next.ready;
	await next.call("resume", { reason: "upgrade-restart" });
	return next;
}

/** The new host's status no longer says "restored paused". */
async function notPaused(next: ChatHost): Promise<void> {
	const status = await next.call<Status>("status");
	assert.ok(!JSON.stringify(status.warnings ?? []).includes("Restored paused"), `resumed at once: ${JSON.stringify(status.warnings)}`);
}

/** Wait until the Chat is idle with nothing queued, three reads in a row. */
async function quiet(next: ChatHost, timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let calm = 0;
	while (calm < 3) {
		if (Date.now() > deadline) throw new Error("timed out waiting for the Chat to settle");
		const status = await next.call<Status & { pendingMessageCount: number }>("status");
		calm = !status.isStreaming && status.pendingMessageCount === 0 ? calm + 1 : 0;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
}

/** Close the last host, check the store and that telemetry recorded one upgrade restart for the Chat. */
async function finish(last: ChatHost, store: string, id: string): Promise<Record<string, unknown>> {
	await last.close();
	assert.equal(integrity(store), "ok");
	const events = readdirSync(TELEMETRY).flatMap((file) => readFileSync(join(TELEMETRY, file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; at: string; sessionId?: string; reason?: string }))
		.filter((event) => event.sessionId === id).sort((x, y) => x.at.localeCompare(y.at));
	const shutdowns = events.filter((event) => event.type === "session.shutdown").map((event) => event.reason);
	assert.deepEqual(shutdowns, ["upgrade-restart", "close"], "the upgrade's close is recorded as upgrade-restart, distinct from a close or crash");
	assert.deepEqual(events.filter((event) => event.type === "session.restart").map((event) => event.reason), ["upgrade-restart"]);
	return { integrity: "ok", shutdowns };
}

const call = (tool: string, args: object) => `call:${tool} ${JSON.stringify(args)}`;
const said = (h: ChatHost, text: string) => h.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === text, `"${text}"`);
const labels = (store: string) => logged(store).filter((l) => (l as { model?: string }).model === undefined).map((l) => l.label);
const LONG = Array.from({ length: 120 }, (_, i) => `word${String(i)}`).join(" ");

// ─── Rows ────────────────────────────────────────────────────────────────────

/** 1: an answer in flight is requested again; its committed partial, if any, is aborted; the answer completes once. */
async function generation(i: number): Promise<Record<string, unknown>> {
	const { store, cwd } = family(`up-gen-${String(i)}`);
	const id = `up-gen-${String(i)}`;
	const first = host(store, cwd, id, 40);
	await first.ready;
	await first.call("prompt", { operationId: "op-gen", text: "gen" });
	await first.until((e) => e.type === "assistant.delta" && String(e.text).includes("word2"), "the answer in flight");
	assert.ok(!first.events.some((e) => e.type === "agent.end"), "the upgrade comes while the answer streams");
	const second = await upgrade(first, () => host(store, cwd, id));
	await said(second, LONG);
	await quiet(second);
	const transcript = await second.call<Transcript>("transcript");
	assert.deepEqual(transcript.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)), ["gen"], "one admitted input");
	const assistants = transcript.messages.filter((m) => m.role === "assistant");
	const finals = assistants.filter((m) => m.stopReason !== "aborted");
	assert.equal(finals.length, 1, "the answer completes once");
	assert.equal(textOf(finals[0]!.content), LONG);
	assert.ok(assistants.length - finals.length <= 1, "at most the committed partial, aborted");
	assert.deepEqual(labels(store), ["gen", "gen"], "the request is sent again once");
	return { aborted: assistants.length - finals.length, requests: labels(store).length, ...(await finish(second, store, id)) };
}

const launches = (cwd: string) => (existsSync(join(cwd, "launches.log")) ? readFileSync(join(cwd, "launches.log"), "utf8").trim().split("\n").length : 0);

/** 2: a running safe tool (the lead's foreground bash wait) reruns once: it reattaches to the same job, launched once. */
async function safeTool(i: number): Promise<Record<string, unknown>> {
	const { store, cwd } = family(`up-safe-${String(i)}`);
	const id = `up-safe-${String(i)}`;
	const first = host(store, cwd, id);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Waits", command: "echo x >> launches.log; sleep 2; echo after-upgrade", foreground: true }) });
	await waitFor(() => launches(cwd) === 1, "the launch");
	const second = await upgrade(first, () => host(store, cwd, id));
	const end = await second.until((e) => e.type === "tool.end" && e.toolName === "bash", "the rerun's result");
	assert.equal(end.isError, false);
	assert.equal(String(end.text), "after-upgrade\n");
	await said(second, "done after bash");
	await quiet(second);
	const transcript = await second.call<Transcript>("transcript");
	assert.equal(transcript.messages.filter((m) => m.role === "toolResult").length, 1, "one result");
	assert.ok(!first.events.some((e) => e.type === "tool.end"), "the old host closed before the call returned: the new host reran it");
	// The rerun continues the restored live slot, so it is not announced again.
	const announced = second.events.filter((e) => e.type === "tool.start" && e.toolName === "bash").length;
	assert.equal(launches(cwd), 1, "the command ran once");
	return { rerunResults: 1, announcedAgain: announced, launches: launches(cwd), ...(await finish(second, store, id)) };
}

/** 3: a running unsafe tool (`write` held on a FIFO) is never rerun; it is held for the owner, its interruption kept. */
async function unsafeTool(i: number): Promise<Record<string, unknown>> {
	const { store, cwd } = family(`up-unsafe-${String(i)}`);
	const id = `up-unsafe-${String(i)}`;
	execFileSync("mkfifo", [join(cwd, "effect.fifo")]);
	const first = host(store, cwd, id);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("write", { path: "effect.fifo", content: "deploy\n" }) });
	await first.until((e) => e.type === "tool.start" && e.toolName === "write", "the held write");
	// shortcut: a fixed pause for the write's intent commit, as chat-host.test.ts `writing` (the store is EXCLUSIVE).
	await new Promise((resolve) => setTimeout(resolve, 500));
	let effect = () => "";
	const second = await upgrade(first, () => host(store, cwd, id), async () => {
		// The close joins the running call, and an open blocked on a FIFO cannot be aborted: once the close has begun, a
		// non-blocking reader lets the held write finish (its result is never committed).
		await new Promise((resolve) => setTimeout(resolve, 300));
		const fd = openSync(join(cwd, "effect.fifo"), constants.O_RDONLY | constants.O_NONBLOCK);
		effect = () => {
			try {
				const buffer = Buffer.alloc(64);
				return buffer.subarray(0, readSync(fd, buffer)).toString();
			} catch {
				return "";
			} finally {
				closeSync(fd);
			}
		};
	});
	await said(second, "done after write");
	await quiet(second);
	const status = await second.call<Status>("status");
	assert.deepEqual(status.unresolvedEffects?.map((e) => e.toolName), ["write"], "held for the owner");
	const transcript = await second.call<Transcript>("transcript");
	const results = transcript.messages.filter((m) => m.role === "toolResult");
	assert.equal(results.length, 1);
	assert.equal(results[0]!.isError, true);
	assert.match(textOf(results[0]!.content), /interrupted/i, "the interruption is kept in the transcript");
	assert.equal(second.events.filter((e) => e.type === "tool.start" && e.toolName === "write").length, 0, "never rerun");
	const written = effect();
	assert.match(written, /^(deploy\n)?$/, "the effect ran at most once");
	return { held: status.unresolvedEffects?.length ?? 0, effectLanded: written !== "", ...(await finish(second, store, id)) };
}

const isNotice = (e: { type: string; message?: unknown }) => e.type === "message.end" && (e.message as Message).customType === "pi-workbench:child-completion";
const isTool = (name: string) => (e: { type: string; message?: unknown }) => e.type === "message.end" && (e.message as { role?: string; toolName?: string }).role === "toolResult" && (e.message as { toolName?: string }).toolName === name;
async function toolResult(h: ChatHost, name: string, nth = 1): Promise<string> {
	await h.until(() => h.events.filter(isTool(name)).length >= nth, `${name} result #${String(nth)}`);
	return textOf((h.events.filter(isTool(name))[nth - 1]!.message as Message).content);
}

/** 4: a running Subagent and a running Worker dispatch resume in the new host: one report each, collected once. */
async function children(i: number): Promise<Record<string, unknown>> {
	const { store, cwd } = family(`up-children-${String(i)}`);
	const id = `up-children-${String(i)}`;
	const first = host(store, cwd, id, 40);
	await first.ready;
	await first.call("prompt", { operationId: "op-enable", text: call("tools_enable", { group: "workers" }) });
	await quiet(first);
	await first.call("prompt", { operationId: "op-create", text: call("worker_create", { name: "Keeper", scope: "the parser", profile: "coordinator" }) });
	const workerId = /Created worker (\S+)/.exec(await toolResult(first, "worker_create"))?.[1] ?? assert.fail("no Worker");
	await quiet(first);
	await first.call("prompt", {
		operationId: "op-launch",
		text: `calls:${JSON.stringify([
			{ name: "subagent", arguments: { task: "gen", profile: "scout", cognitiveRole: "routine", background: true, name: "Child" } },
			{ name: "worker_dispatch", arguments: { workerId, task: "gen", cognitiveRole: "routine", background: true } },
		])}`,
	});
	const launched = [await toolResult(first, "subagent"), await toolResult(first, "worker_dispatch")].map((text) => /(?:Launched subagent|Dispatched worker) (\S+)/.exec(text)?.[1] ?? assert.fail(`no execution in ${text}`));
	const childAsks = () => logged(store).filter((l) => l.label === "gen" && (l as { model?: string }).model !== undefined).length;
	await waitFor(() => childAsks() >= 2, "both children answering");
	const second = await upgrade(first, () => host(store, cwd, id));
	await notPaused(second);
	const carried = async () => (await second.call<Transcript>("transcript")).messages.filter((m) => m.customType === "pi-workbench:child-completion").map((m) => textOf(m.content)).join("\n");
	const reported = (text: string) => launched.every((execution) => text.includes(`${execution} [success]`));
	const deadline = Date.now() + 90_000;
	for (let text = ""; !reported(text); text = await carried()) {
		if (Date.now() > deadline) throw new Error(`not both reported: ${text}`);
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	await quiet(second, 90_000);
	const text = await carried();
	for (const execution of launched) assert.equal(text.split(`${execution} [success]`).length - 1, 1, `${execution} reported once`);
	assert.ok(childAsks() <= 4, `each child asked at most twice (its answer requested again): ${String(childAsks())}`);
	await second.call("prompt", { operationId: "op-collect", text: call("subagent_collect", {}) });
	assert.match(await toolResult(second, "subagent_collect"), /^Nothing terminal to reconcile\./, "the notices collected both");
	await quiet(second);
	return { executions: launched.length, childRequests: childAsks(), ...(await finish(second, store, id)) };
}

const claimOf = (job: string) => JSON.parse(readFileSync(join(JOBS, job, "claim"), "utf8")) as { pid: number };
const completionRequests = (store: string) => logged(store).filter((l) => l.label.startsWith("Background bash")).length;

/** 5: a running background job outlives the upgrade (same runner) and its completion arrives once, without input. */
async function backgroundBash(i: number): Promise<Record<string, unknown>> {
	const { store, cwd } = family(`up-bash-${String(i)}`);
	const id = `up-bash-${String(i)}`;
	const first = host(store, cwd, id);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Outlives upgrade", command: "echo x >> launches.log; sleep 2; echo survived" }) });
	const started = await first.until((e) => e.type === "tool.end" && e.toolName === "bash", "the job ID");
	const job = /bash ([0-9a-f-]{36})/.exec(String(started.text))?.[1] ?? assert.fail(`no job in ${String(started.text)}`);
	await quiet(first);
	await waitFor(() => existsSync(join(JOBS, job, "claim")), "the runner's claim");
	const runner = claimOf(job).pid;
	assert.ok(!existsSync(join(JOBS, job, "exit")), "the upgrade comes while the job runs");
	const second = await upgrade(first, () => host(store, cwd, id));
	await second.until(() => completionRequests(store) >= 1, "the completion");
	await quiet(second);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const completions = (await second.call<Transcript>("transcript")).messages.filter((m) => m.customType === "background-bash");
	assert.equal(completions.length, 1, "one completion message");
	assert.match(textOf(completions[0]!.content), /complete \(exit 0\)[\s\S]*survived/);
	assert.equal(completionRequests(store), 1, "one completion turn");
	assert.equal(launches(cwd), 1, "never relaunched");
	assert.equal(claimOf(job).pid, runner, "the same runner finished it");
	return { completions: completions.length, launches: launches(cwd), ...(await finish(second, store, id)) };
}

const ASK = {
	context: "The deploy target is ambiguous.",
	questions: [{ id: "target", question: "Which target?", detail: "Where this deploy lands.", options: [{ value: "prod", label: "Production", recommended: true }, { value: "staging", label: "Staging" }] }],
};
const answered = (askId: string) => ({
	askId, reason: "submitted", askedAt: "", closedAt: "", context: ASK.context,
	questions: [{ question: ASK.questions[0], answered: true, values: ["staging"] }],
	answeredCount: 1, unansweredIds: [], summary: "Answered 1 of 1; none left unanswered",
});
type Asks = Status & { pendingAsks?: { askId: string; revision: string }[] };

/** 6: an open `ask_user` set is the same set after the upgrade, not notified again; one answer is delivered once. */
async function openAsk(i: number): Promise<Record<string, unknown>> {
	const { store, cwd } = family(`up-ask-${String(i)}`);
	const id = `up-ask-${String(i)}`;
	const first = host(store, cwd, id);
	await first.ready;
	await first.call("prompt", { operationId: "op-ask", text: call("ask_user", ASK) });
	const opened = (await first.until((e) => e.type === "ask.opened", "the ask")) as unknown as { ask: { askId: string; revision: string } };
	await first.until((e) => e.type === "durable.attention", "the ask notification");
	await quiet(first);
	const second = await upgrade(first, () => host(store, cwd, id));
	await notPaused(second);
	const status = await second.call<Asks>("status");
	assert.deepEqual(status.pendingAsks?.map((a) => [a.askId, a.revision]), [[opened.ask.askId, opened.ask.revision]], "the same set, same revision");
	const close = (operationId: string) => second.call<{ result: string; retried?: boolean }>("closeAsk", { askId: opened.ask.askId, revision: opened.ask.revision, operationId, outcome: answered(opened.ask.askId), content: "Answers: target staging" });
	assert.equal((await close("op-a1")).result, "closed");
	assert.deepEqual(await close("op-a1").then((r) => [r.result, r.retried]), ["closed", true], "a retried answer gets its outcome back");
	await second.until(() => logged(store).some((l) => l.label.startsWith("Answers: target staging")), "the delivered answer");
	await quiet(second);
	assert.equal(second.events.filter((e) => e.type === "durable.attention").length, 0, "the new host does not notify again");
	assert.equal(logged(store).filter((l) => l.label.startsWith("Answers: target staging")).length, 1, "one answer reached the model");
	assert.equal((await second.call<Asks>("status")).pendingAsks, undefined);
	return { deliveries: 1, ...(await finish(second, store, id)) };
}

/** 7: a queued steer and follow-up survive the upgrade and are placed once each, in the order a no-upgrade run places them. */
async function queued(i: number, control = false): Promise<Record<string, unknown>> {
	const { store, cwd } = family(`up-queue-${String(i)}${control ? "-control" : ""}`);
	const id = `up-queue-${String(i)}${control ? "-control" : ""}`;
	const first = host(store, cwd, id, 40);
	await first.ready;
	await first.call("prompt", { operationId: "op-gen", text: "gen" });
	await first.until((e) => e.type === "assistant.delta" && String(e.text).includes("word2"), "the answer in flight");
	await first.call("prompt", { operationId: "op-steer", text: "steered", mode: "steer" });
	await first.call("prompt", { operationId: "op-follow", text: "followed", mode: "followUp" });
	assert.deepEqual((await first.call<Status>("status")).queuedMessages.map(({ kind, text }) => [kind, text]), [["steer", "steered"], ["followUp", "followed"]]);
	const second = control ? first : await upgrade(first, () => host(store, cwd, id));
	await said(second, "ok: followed");
	await quiet(second);
	const transcript = await second.call<Transcript>("transcript");
	const users = transcript.messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
	const answers = transcript.messages.filter((m) => m.role === "assistant" && m.stopReason !== "aborted").map((m) => textOf(m.content));
	// The steer and the follow-up are placed before the next request, which the scripted model answers by the last text.
	for (const text of ["steered", "followed"]) assert.equal(users.filter((t) => t === text).length, 1, `${text} placed once`);
	assert.equal(answers.filter((t) => t === "ok: followed").length, 1, `answered once: ${JSON.stringify(answers.map((t) => t.slice(0, 30)))}`);
	if (control) {
		await second.close();
		return { users };
	}
	assert.deepEqual(users, QUEUE_ORDER, "the order a no-upgrade run places them in");
	return { users, ...(await finish(second, store, id)) };
}
let QUEUE_ORDER: string[] = [];

const PAGE = "<!doctype html><title>t</title><div atl-key='a' atl-ver='1'>A</div>";
const UNDO = 3_000;
type Entry = { seq: number; type: string; of?: number[] };
const eventLog = (page: string): Entry[] => (existsSync(`${page}.events.jsonl`) ? readFileSync(`${page}.events.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entry) : []);
async function post(url: string, body: object): Promise<Entry> {
	const response = await fetch(`${new URL(url).origin}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	assert.equal(response.status, 200);
	return ((await response.json()) as { entry: Entry }).entry;
}

/** 8: a served Atelier Page reopens on the same link; a Comment made before the upgrade and one after each arrive once. */
async function atelierPage(i: number): Promise<Record<string, unknown>> {
	const { store, cwd } = family(`up-atelier-${String(i)}`);
	const id = `up-atelier-${String(i)}`;
	const page = join(cwd, "page.html");
	writeFileSync(page, PAGE);
	const first = host(store, cwd, id);
	await first.ready;
	await first.call("prompt", { operationId: "enable", text: call("tools_enable", { group: "atelier" }) });
	await quiet(first);
	await first.call("prompt", { operationId: "open", text: call("atelier", { action: "open", page: "page.html" }) });
	const end = await first.until((e) => e.type === "tool.end" && e.toolName === "atelier", "the Page");
	const url = /Page open: (http:\/\/127\.0\.0\.1:\d+\/page\.html)/.exec(String(end.text))?.[1] ?? assert.fail(`no URL in ${String(end.text)}`);
	await quiet(first);
	const before = await post(url, { type: "comment", key: "a", text: "before the upgrade" });
	const second = await upgrade(first, () => host(store, cwd, id));
	assert.ok(!eventLog(page).some((e) => e.type === "delivered" && e.of?.includes(before.seq)), "the upgrade came inside the undo window");
	assert.equal((await fetch(url)).status, 200, "the new host serves the same link");
	const atelierTurns = () => logged(store).filter((l) => l.label.startsWith("Atelier")).length;
	await second.until(() => atelierTurns() === 1, "the Comment from before");
	await quiet(second);
	const afterwards = await post(url, { type: "comment", key: "a", text: "after the upgrade" });
	await second.until(() => atelierTurns() === 2, "the Comment from after");
	await quiet(second);
	await new Promise((resolve) => setTimeout(resolve, UNDO));
	const delivered = (await second.call<Transcript>("transcript")).messages.filter((m) => m.customType?.startsWith("atelier:")).map((m) => textOf(m.content));
	for (const text of ["before the upgrade", "after the upgrade"]) assert.equal(delivered.filter((t) => t.includes(text)).length, 1, `${text} delivered once: ${JSON.stringify(delivered)}`);
	assert.equal(atelierTurns(), 2, "no event delivered twice");
	for (const entry of [before, afterwards]) assert.equal(eventLog(page).filter((e) => e.type === "received" && e.of?.includes(entry.seq)).length, 1, `one receipt for #${String(entry.seq)}`);
	return { delivered: delivered.length, ...(await finish(second, store, id)) };
}

describe("upgrade-trigger rows (Upgrade now: ordered close, new host, resumed at once)", () => {
	it("1 in-flight generation: requested again, partial aborted, the answer completes once", () => runRow("generation", generation));
	it("2 running safe tool: rerun once, its command launched once", () => runRow("safe-tool", safeTool));
	it("3 running unsafe tool: held for the owner with its interruption kept, never rerun", () => runRow("unsafe-tool", unsafeTool));
	it("4 running Subagent and Worker: resume, one report each", () => runRow("children", children));
	it("5 background bash: the runner survives, its completion arrives once", () => runRow("background-bash", backgroundBash));
	it("6 open ask_user: the same question, one answer delivered", () => runRow("ask-user", openAsk));
	it("7 queued steer and follow-up: same order, once each", async () => {
		QUEUE_ORDER = (await queued(0, true)).users as string[];
		await runRow("queue", (i) => queued(i));
	});
	it("8 served Atelier Page: reopens on the same link, no event lost or doubled", () => runRow("atelier", atelierPage));
});

// The automatic upgrade's (B's) close: decided in the host with input held off, so the daemon's quiet check can never
// be overtaken by input that arrives before the close. Daemon side: pi-web durableUpgrade.test.ts "finding 4".
describe("B conditional close (close only if still restart-safe)", () => {
	it("refuses while input is arriving or a turn runs, keeps running; once quiet it closes and admits nothing after", async () => {
		const id = "up-conditional";
		const { store, cwd } = family(id);
		const first = host(store, cwd, id, 40);
		assert.equal((await first.ready).closeIfRestartSafe, true, "the handshake says the host closes only if restart-safe");
		const conditional = { reason: "upgrade", ifRestartSafe: true };
		// A prompt and the close back to back: the prompt is in flight when the host decides.
		const prompted = first.call("prompt", { operationId: "op-gen", text: "gen" });
		assert.equal((await first.call<{ closed: boolean; busy?: string }>("close", conditional)).closed, false, "input in flight");
		await prompted;
		await first.until((e) => e.type === "assistant.delta" && String(e.text).includes("word2"), "the answer in flight");
		assert.deepEqual(await first.call("close", conditional), { closed: false, busy: "a turn is running" });
		await said(first, LONG);
		await quiet(first);
		// Quiet: it closes; a prompt sent right behind the close is refused, never admitted.
		const closing = first.call("close", conditional);
		const late = Promise.race([first.call("prompt", { operationId: "op-late", text: "late" }).then(() => "admitted", (error: unknown) => (error instanceof Error ? error.message : String(error))), first.exited.then(() => "no answer")]);
		assert.deepEqual(await closing, { closed: true });
		assert.match(await late, /restarting on new host code|no answer/);
		assert.equal(await first.exited, 0, "closed in order");
		const second = host(store, cwd, id);
		await second.ready;
		const transcript = await second.call<Transcript>("transcript");
		assert.deepEqual(transcript.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)), ["gen"], "the late input was never admitted");
		await second.close();
		assert.equal(integrity(store), "ok");
	});

	it("a quiet check that fails admits input again (the close is refused, the host keeps running)", async () => {
		// The status snapshot may reject (store I/O); this needs neither a model nor an opened store.
		const session = new ChatSession({} as never, () => undefined);
		session.status = async () => {
			throw new Error("injected snapshot I/O failure");
		};
		await assert.rejects(session.quiesce(), /snapshot I\/O/);
		assert.equal(await session.exclusive(async () => "admitted"), "admitted");
	});
});
