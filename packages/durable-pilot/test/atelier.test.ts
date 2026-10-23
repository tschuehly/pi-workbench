// Slice 4 group B: the Workbench Atelier (extensions/atelier) in a Durable Chat, against the real host process.
// Parity rows P075 (the atelier tool) and P076 (delivery of human input), and the plan's "Atelier Page and human input"
// survival row: a kill at Event Log append, after admission and after the receipt delivers each event once; the Page
// and its Event Log stay the authority; a second receiver cannot take the Page from a live one.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { ChatHost, live, logged, textOf, waitFor } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

type Message = { role: string; customType?: string; content?: unknown; details?: Record<string, unknown> };
type Entry = { seq: number; at: number; type: string; origin: string; of?: number[]; op?: string; text?: string };

const ROOT = scratch("s4b-atelier");
process.env.ATELIER_PAGE_CHECK = "off"; // the browser Page check has its own tests (extensions/atelier/page-check.test.mjs)
process.env.PI_BACKGROUND_BASH_ROOT = join(ROOT, "jobs");
process.env.PI_TMP_ROOT = join(ROOT, "pi-tmp");
process.env.PI_TELEMETRY_DIR = join(ROOT, "telemetry");
const PAGE = "<!doctype html><title>t</title><div atl-key='a' atl-ver='1'>A</div>";
const UNDO = 3_000;

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

function family(label: string, cwd = join(ROOT, label, "workspace")): { store: string; cwd: string; page: string } {
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(cwd, "page.html"), PAGE);
	return { store: join(ROOT, label, "family"), cwd, page: join(cwd, "page.html") };
}

const call = (args: object) => `call:atelier ${JSON.stringify(args)}`;
const toolEnds = (host: ChatHost) => host.events.filter((e) => e.type === "tool.end" && e.toolName === "atelier");
const toolEnd = (host: ChatHost, n: number) => host.until(() => toolEnds(host).length >= n, `tool end ${n}`).then(() => toolEnds(host)[n - 1]!);
const log = (page: string): Entry[] => {
	try {
		return readFileSync(`${page}.events.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entry);
	} catch {
		return [];
	}
};
const delivered = async (host: ChatHost) => (await host.call<{ messages: Message[] }>("transcript")).messages.filter((m) => m.customType?.startsWith("atelier:"));
const atelierRequests = (store: string) => logged(store).filter((l) => l.label.startsWith("Atelier")).length;
const pageUrl = (text: unknown) => /Page open: (http:\/\/127\.0\.0\.1:\d+\/page\.html)/.exec(String(text))?.[1] ?? assert.fail(`no URL in ${String(text)}`);
async function post(url: string, body: object): Promise<{ status: number; entry?: Entry }> {
	const response = await fetch(`${new URL(url).origin}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const json = (await response.json()) as { entry?: Entry };
	return { status: response.status, ...(json.entry === undefined ? {} : { entry: json.entry }) };
}
/** Atelier is a tool group: enabled first (one run), then the Page is opened (another). */
async function enable(host: ChatHost): Promise<void> {
	await host.call("prompt", { operationId: "enable", text: 'call:tools_enable {"group":"atelier"}' });
	await host.until((e) => e.type === "tool.end" && e.toolName === "tools_enable", "the atelier group");
	await host.until((e) => e.type === "agent.end", "the enabling run");
}
async function open(host: ChatHost, n: number): Promise<string> {
	if (n === 1 && !host.events.some((e) => e.type === "tool.end" && e.toolName === "tools_enable")) await enable(host);
	await host.call("prompt", { operationId: `open-${n}`, text: call({ action: "open", page: "page.html" }) });
	const end = await toolEnd(host, n);
	assert.equal(end.isError, false, String(end.text));
	return pageUrl(end.text);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("P075/P076 open links a served Page; a human Comment reaches the Chat once after its undo window; ask, answer, status, update and check act on the Event Log", async () => {
	const { store, cwd, page } = family("round-trip");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const url = await open(host, 1);
	assert.match(readFileSync(join(cwd, "atelier.js"), "utf8"), /^\/\/ atelier-copy /, "the Kernel is copied beside the Page");
	assert.equal((await fetch(url)).status, 200);
	await host.idle(2);

	const comment = await post(url, { type: "comment", key: "a", text: "Make A bigger" });
	assert.equal(comment.status, 200);
	await sleep(UNDO / 2);
	assert.equal((await delivered(host)).length, 0, "held for the undo window");
	await host.until(() => atelierRequests(store) === 1, "the Comment waking the Chat");
	const [message] = await delivered(host);
	assert.equal(message!.customType, "atelier:immediate");
	assert.match(textOf(message!.content), /Make A bigger/);
	await waitFor(() => log(page).some((e) => e.type === "received" && e.of?.includes(comment.entry!.seq)), "the receipt in the Event Log");
	assert.ok(log(page).some((e) => e.type === "delivered" && e.of?.includes(comment.entry!.seq)));
	await host.idle(3);

	// Undone inside its window: never delivered.
	const undone = await post(url, { type: "comment", key: "a", text: "never mind" });
	assert.equal((await post(url, { type: "undo", target: undone.entry!.seq })).status, 200);

	await host.call("prompt", { operationId: "op-answer", text: call({ action: "answer", page: "page.html", comment: comment.entry!.seq, text: "Done: A is bigger" }) });
	assert.match(String((await toolEnd(host, 2)).text), new RegExp(`Answered Comment #${comment.entry!.seq}`));
	await host.call("prompt", { operationId: "op-ask", text: call({ action: "ask", page: "page.html", decision: { id: "size", question: "Which size?", options: [{ label: "S", consequence: "small" }, { label: "L", consequence: "large", recommended: true }] } }) });
	assert.match(String((await toolEnd(host, 3)).text), /Decision size posted/);
	await host.call("prompt", { operationId: "op-update", text: call({ action: "update", page: "page.html", text: "A is bigger" }) });
	assert.match(String((await toolEnd(host, 4)).text), /No tab is connected|Update sent/);
	await host.call("prompt", { operationId: "op-check", text: call({ action: "check", page: "page.html" }) });
	assert.equal((await toolEnd(host, 5)).isError, false);
	const agentEvents = log(page).filter((e) => e.origin === "agent");
	assert.deepEqual(agentEvents.map((e) => e.type), ["answer", "ask", "update"]);
	assert.ok(agentEvents.every((e) => typeof e.op === "string"), "each carries its tool task, for a rerun to find");
	const request = await post(url, { type: "request", job: "rerun", key: "a" });
	await host.until(() => atelierRequests(store) === 2, "the Request");
	await host.idle(8);
	await host.call("prompt", { operationId: "op-status", text: call({ action: "status", page: "page.html", request: request.entry!.seq, state: "running", text: "on it" }) });
	assert.match(String((await toolEnd(host, 6)).text), new RegExp(`Request #${request.entry!.seq} is running`));
	await sleep(UNDO);
	assert.equal((await delivered(host)).length, 2, "the Comment and the Request, not the undone Comment");
	assert.equal(atelierRequests(store), 2);
	await host.close();
});

test("P076 a Comment arriving while the Chat is busy is one follow-up after the run, never inside it", async () => {
	const { store, cwd } = family("busy");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const url = await open(host, 1);
	await host.idle(2);
	await host.call("prompt", { operationId: "op-busy", text: `call:bash ${JSON.stringify({ description: "Busy", command: "sleep 5; echo busy-done", foreground: true })}` });
	await host.until((e) => e.type === "tool.start" && e.toolName === "bash", "the busy run");
	await post(url, { type: "comment", key: "a", text: "while busy" });
	await host.until(() => atelierRequests(store) === 1, "the follow-up");
	const roles = (await host.call<{ messages: Message[] }>("transcript")).messages.map((m) => m.customType ?? m.role);
	const at = roles.indexOf("atelier:immediate");
	assert.deepEqual(roles.slice(at - 3, at), ["assistant", "toolResult", "assistant"], "after the run's final answer");
	await host.close();
});

test("checkpoint barrier: human input arriving during compact_and_continue is delivered only after the continuation is placed", async () => {
	const { store, cwd } = family("barrier");
	const gate = join(ROOT, "barrier", "summary-gate");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("configure", { resources: {}, compaction: { keepRecentTokens: 1 } });
	const url = await open(host, 1);
	await host.idle(2);
	await host.call("prompt", { operationId: "op-checkpoint", text: `call:compact_and_continue ${JSON.stringify({ summaryFocus: `gate:${gate}`, nextPhase: "phase two" })}` });
	await waitFor(() => logged(store).some((l) => l.label === "summarize"), "the summary request");
	const comment = await post(url, { type: "comment", key: "a", text: "during the checkpoint" });
	assert.equal(comment.status, 200);
	await sleep(UNDO + 1500);
	writeFileSync(gate, "");
	await host.until(() => atelierRequests(store) === 1, "the Comment");
	await waitFor(() => logged(store).some((l) => l.label.startsWith("Context checkpoint")), "the continuation");
	const types = (await host.call<{ messages: Message[] }>("transcript")).messages.map((m) => m.customType);
	const continuation = types.indexOf("context-checkpoint");
	const input = types.indexOf("atelier:immediate");
	assert.ok(continuation >= 0 && input >= 0, "both placed");
	assert.ok(continuation < input, `the continuation (${String(continuation)}) is placed before the human input (${String(input)})`);
	await host.close();
});

test("P076 human input is redacted before it is committed; the Event Log keeps what the human wrote", async () => {
	const { store, cwd, page } = family("leak");
	const secret = `ghp_${"H".repeat(36)}`;
	const host = new ChatHost(store, cwd);
	await host.ready;
	const url = await open(host, 1);
	await host.idle(2);
	await post(url, { type: "comment", key: "a", text: `my token is ${secret}` });
	await host.until(() => atelierRequests(store) === 1, "the Comment");
	const [message] = await delivered(host);
	assert.match(textOf(message!.content), /my token is \[REDACTED:github-token\]/);
	await host.close();
	assert.ok(log(page).some((e) => e.text?.includes(secret)), "positive control: the Event Log holds the raw text");
	for (const file of readdirSync(store).filter((name) => name.startsWith("session.sqlite")))
		assert.equal(readFileSync(join(store, file)).includes("H".repeat(36)), false, `no plaintext secret in ${file}`);
});

// ─── Survival ───────────────────────────────────────────────────────────────

test("survival: a kill right after a human event's append delivers it once from the reopened host, on the same link", async () => {
	const { store, cwd, page } = family("kill-append");
	const first = new ChatHost(store, cwd);
	await first.ready;
	const url = await open(first, 1);
	await first.idle(2);
	const comment = await post(url, { type: "comment", key: "a", text: "before the kill" });
	await first.kill();
	assert.ok(!log(page).some((e) => e.type === "delivered"), "killed inside the undo window");
	const second = new ChatHost(store, cwd);
	await second.ready;
	assert.equal((await fetch(url)).status, 200, "the reopened host serves the same link");
	await second.until(() => atelierRequests(store) === 1, "the delivery after reopen");
	await waitFor(() => log(page).some((e) => e.type === "received" && e.of?.includes(comment.entry!.seq)), "the receipt");
	await second.idle(1);
	await sleep(UNDO);
	assert.equal((await delivered(second)).length, 1);
	assert.equal(atelierRequests(store), 1);
	await second.close();
});

test("survival: a kill after admission, before the Event Log records it, admits nothing twice", async () => {
	const { store, cwd, page } = family("kill-admitted");
	const first = new ChatHost(store, cwd, { env: { PI_DURABLE_CRASH_AT: "atelier.admitted" } });
	await first.ready;
	const url = await open(first, 1);
	await first.idle(2);
	const comment = await post(url, { type: "comment", key: "a", text: "admitted once" });
	await first.exited;
	assert.ok(!log(page).some((e) => e.type === "delivered" || e.type === "received"), "the Event Log never heard of the admission");
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-next", text: "next" });
	await second.until(() => atelierRequests(store) === 1 && logged(store).some((l) => l.label === "next"), "the admitted Comment and the next input");
	await waitFor(() => log(page).some((e) => e.type === "received" && e.of?.includes(comment.entry!.seq)), "the receipt recorded after reopen");
	await sleep(UNDO);
	assert.equal((await delivered(second)).length, 1, "one message");
	assert.equal(atelierRequests(store), 1, "one turn");
	await second.close();
});

test("survival: a kill after admitting one event, with a second falling due while down, delivers each event in exactly one admitted message", async () => {
	const { store, cwd, page } = family("kill-admitted-staggered");
	const first = new ChatHost(store, cwd, { env: { PI_DURABLE_CRASH_AT: "atelier.admitted" } });
	await first.ready;
	const url = await open(first, 1);
	await first.idle(2);
	const a = await post(url, { type: "comment", key: "a", text: "staggered A" });
	await sleep(1_400);
	const b = await post(url, { type: "comment", key: "a", text: "staggered B" });
	await first.exited;
	assert.ok(!log(page).some((e) => e.type === "delivered" || e.type === "received"), "killed after A's admission, before the Event Log heard of it");
	// Reopened once B is due too: the kernel now batches A and B.
	await sleep(Math.max(0, b.entry!.at + UNDO + 200 - Date.now()));
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-next", text: "next" });
	await waitFor(() => [a, b].every((x) => log(page).some((e) => e.type === "received" && e.of?.includes(x.entry!.seq))), "both receipts");
	await second.until(() => logged(store).some((l) => l.label === "next"), "the next input");
	await sleep(UNDO);
	const texts = (await delivered(second)).map((m) => textOf(m.content));
	for (const text of ["staggered A", "staggered B"]) assert.equal(texts.filter((t) => t.includes(text)).length, 1, `${text} in exactly one admitted message: ${JSON.stringify(texts)}`);
	await second.close();
});

test("survival: a kill after the receipt delivers nothing again", async () => {
	const { store, cwd } = family("kill-received");
	const first = new ChatHost(store, cwd, { env: { PI_DURABLE_CRASH_AT: "atelier.received" } });
	await first.ready;
	const url = await open(first, 1);
	await first.idle(2);
	await post(url, { type: "comment", key: "a", text: "received once" });
	await first.exited;
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-next", text: "next" });
	await second.until(() => logged(store).some((l) => l.label === "next"), "the next input");
	await sleep(UNDO + 500);
	assert.equal((await delivered(second)).length, 1);
	assert.equal(atelierRequests(store), 1);
	await second.close();
});

test("survival: a second Chat cannot open or take over a Page a live Chat receives; after that Chat dies it reclaims it at the next generation, and the old Chat stays out", async () => {
	const shared = join(ROOT, "two-receivers", "workspace");
	const a = family("two-a", shared);
	const b = { store: join(ROOT, "two-b", "family"), cwd: shared, page: a.page };
	const first = new ChatHost(a.store, shared);
	await first.ready;
	await open(first, 1);
	await first.idle(2);
	const second = new ChatHost(b.store, shared);
	await second.ready;
	await enable(second);
	await second.call("prompt", { operationId: "open-1", text: call({ action: "open", page: "page.html" }) });
	assert.match(String((await toolEnd(second, 1)).text), /held by session .* in another process/);
	await second.call("prompt", { operationId: "takeover-1", text: call({ action: "takeover", page: "page.html", generation: 1 }) });
	assert.match(String((await toolEnd(second, 2)).text), /in another process/, "no takeover across processes, whatever the generation");
	await first.kill();
	await second.call("prompt", { operationId: "open-2", text: call({ action: "open", page: "page.html" }) });
	const reopened = await toolEnd(second, 3);
	assert.equal(reopened.isError, false);
	assert.equal((reopened.details as { generation?: number }).generation, 2, "the next generation");
	const url = pageUrl(reopened.text);
	await second.idle(4);
	const again = new ChatHost(a.store, shared);
	await again.ready;
	await again.call("prompt", { operationId: "op-answer", text: call({ action: "answer", page: "page.html", comment: 1, text: "stale" }) });
	assert.match(String((await toolEnd(again, 1)).text), /Open page\.html first/, "the old receiver did not reclaim it");
	await post(url, { type: "comment", key: "a", text: "to the new receiver" });
	await second.until(() => atelierRequests(b.store) === 1, "delivery to the current receiver");
	await sleep(UNDO);
	assert.equal(atelierRequests(a.store), 0, "the old receiver gets nothing");
	await again.close();
	await second.close();
});
