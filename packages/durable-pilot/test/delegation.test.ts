// Slice 4 group A: Subagents and Workers as native child conversations of a Durable Chat (parity rows P089–P099),
// against the real host process. The lead and every routed child run on the scripted model under the model names
// routing chose (`--scripted-providers`); the resolver reads a fresh empty quota snapshot, never quota-axi. Kill rows
// stop the host at the reporter's named fault windows (PI_DURABLE_HOLD), reopen it, and check one assignment, one
// report and one collection.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ConversationId, EntryRecord } from "@earendil-works/pi-durable";
import { openChatHost } from "../src/chat.ts";
import { ChildDoc, DelegationDoc, type Execution, WorkersDoc } from "../src/delegation.ts";
import { context } from "../src/host.ts";
import { ChatHost, eventCopies, family, hideIn, integrity, live, logged, type Message, type Status, textOf, type Transcript, waitFor } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

const TELEMETRY = scratch("delegation-telemetry");
process.env.PI_TELEMETRY_DIR = TELEMETRY;
const QUOTA = join(scratch("delegation-quota"), "quota.json");
process.env.PI_WORKBENCH_QUOTA_CACHE = QUOTA;
const SECRET = "delegationSecret-7c1e4b9a2d6f0e35";
process.env.PILOT_DELEGATION_TOKEN = SECRET;
const CHAT = "chat-s4a";

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

/** A host with routed children on the scripted model; the quota snapshot is refreshed so routing never runs quota-axi. */
function open(store: string, cwd: string, env: NodeJS.ProcessEnv = {}): ChatHost {
	writeFileSync(QUOTA, JSON.stringify({ version: 1, checkedAt: Date.now(), status: 0, stdout: JSON.stringify({ providers: [] }), stderr: "" }));
	return new ChatHost(store, cwd, { tps: 5000, args: ["--scripted-providers", "--session-id", CHAT], env });
}

const call = (tool: string, args: object) => `call:${tool} ${JSON.stringify(args)}`;
const calls = (...list: { name: string; arguments: object }[]) => `calls:${JSON.stringify(list)}`;
const scout = (task: string, extra: object = {}) => ({ task, profile: "scout", cognitiveRole: "routine", background: true, ...extra });

const isTool = (name: string) => (e: { type: string; message?: unknown }) => e.type === "message.end" && (e.message as Message & { toolName?: string }).role === "toolResult" && (e.message as { toolName?: string }).toolName === name;
async function toolResult(host: ChatHost, name: string, nth = 1): Promise<string> {
	await host.until(() => host.events.filter(isTool(name)).length >= nth, `${name} result #${String(nth)}`);
	return textOf((host.events.filter(isTool(name))[nth - 1]!.message as Message).content);
}
const launchedId = (result: string) => /(?:Launched subagent|Dispatched worker) (\S+)/.exec(result)?.[1] ?? assert.fail(`no execution ID in: ${result}`);
const customs = (messages: readonly Message[], type: string) => messages.filter((m) => m.customType === type);
/** The nth completion notice placed in the lead's transcript, as the browser received it. */
const isNotice = (e: { type: string; message?: unknown }) => e.type === "message.end" && (e.message as Message).customType === "pi-workbench:child-completion";
async function notice(host: ChatHost, nth = 1): Promise<Message> {
	await host.until(() => host.events.filter(isNotice).length >= nth, `completion notice #${String(nth)}`);
	return host.events.filter(isNotice)[nth - 1]!.message as Message;
}
const UPDATE_REQUEST = "The lead asks for a progress update: call report_status with your next tool call, saying where you stand, then continue your assignment.";
const said = (host: ChatHost, text: string) => host.until((e) => e.type === "message.end" && textOf((e.message as Message).content).includes(text), `"${text}"`);

/** Wait until the Chat is idle with nothing queued, three reads in a row. */
async function quiet(host: ChatHost, timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let calm = 0;
	while (calm < 3) {
		if (Date.now() > deadline) throw new Error("timed out waiting for the Chat to settle");
		const status = await host.call<Status & { pendingMessageCount: number }>("status");
		calm = !status.isStreaming && status.pendingMessageCount === 0 ? calm + 1 : 0;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
}
/** An event emitted after `mark` (an index into host.events). */
const since = (host: ChatHost, mark: number, match: (e: { type: string; [key: string]: unknown }) => boolean, what: string) =>
	host.until((e) => host.events.indexOf(e) >= mark && match(e), what);

let ops = 0;
const prompt = (host: ChatHost, text: string) => host.call("prompt", { operationId: `op-${String(++ops)}`, text });

/** Read a closed store in this process: the lead's children, a child's entries, the Workers. */
async function inspect<T>(store: string, cwd: string, read: (h: Awaited<ReturnType<typeof openChatHost>>) => Promise<T>): Promise<T> {
	const h = await openChatHost({ dir: store, cwd, model: "faux", chatId: CHAT });
	try {
		return await read(h);
	} finally {
		await h.close();
	}
}
async function executions(h: Awaited<ReturnType<typeof openChatHost>>, conversation: ConversationId = h.root.id): Promise<Execution[]> {
	return Object.values((await h.harness.snapshot(DelegationDoc, conversation, context))?.executions ?? {});
}
async function entries(h: Awaited<ReturnType<typeof openChatHost>>, conversation: number): Promise<EntryRecord[]> {
	const c = (await h.harness.conversation(conversation as ConversationId, context))!;
	return [...(await c.entries({ order: "ascending" }, 1000, undefined, context)).items];
}
const childRequests = (store: string, label: string) => logged(store).filter((l) => l.label === label && (l as { model?: string }).model !== undefined);

function telemetry(): Record<string, unknown>[] {
	return readdirSync(TELEMETRY).flatMap((file) => readFileSync(join(TELEMETRY, file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>));
}

// ─── P089 subagent ───────────────────────────────────────────────────────────

test("P089 background Subagent: routed fresh child with its allowlist and own identity; one wake; collect returns the answer with a receipt naming the model", async () => {
	const { store, cwd } = family("subagent-bg");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, "parent-only context");
	await quiet(host);
	await prompt(host, call("subagent", scout('calls:[{"name":"bash","arguments":{"command":"echo $PI_SESSION_ID > child-id.txt"}},{"name":"subagent","arguments":{"task":"nested","profile":"scout","cognitiveRole":"routine"}}]', { name: "Probe child" })));
	const launched = await toolResult(host, "subagent");
	const id = launchedId(launched);
	assert.match(launched, /in the background on openai\/gpt-6-luna:medium \(scout · routine\)/, "the launch names the routed model");
	assert.ok(launched.includes(` in ${cwd}.`), `the launch receipt names the child's cwd: ${launched}`);
	const carried = textOf((await notice(host)).content);
	assert.match(carried, /Completion receipt: openai\/gpt-6-luna:medium · subagent · scout · routine · outcome success/);
	assert.match(carried, new RegExp(`${id} \\[success\\]`), "the wake carries the result");
	await quiet(host);
	const transcript = await host.call<Transcript>("transcript");
	assert.equal(customs(transcript.messages, "pi-workbench:child-completion").length, 1, "one completion wake");

	const child = logged(store).filter((l) => (l as { model?: string }).model === "openai/gpt-6-luna");
	assert.equal(child[0]!.messages, 1, "the child starts without the parent transcript");
	assert.deepEqual(child[0]!.tools, ["bash", "compact_and_continue", "find", "grep", "ls", "read", "report_status"], "scout allowlist: no write, edit or delegation tools");
	await host.close();

	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		assert.equal(e!.executionId, id);
		assert.equal(readFileSync(join(cwd, "child-id.txt"), "utf8").trim(), `${CHAT}:${String(e!.conversationId)}`, "the child's tools get its own PI_SESSION_ID");
		const childEntries = await entries(h, e!.conversationId);
		const nested = childEntries.find((entry) => (entry.model?.[0] as { role?: string; toolName?: string } | undefined)?.toolName === "subagent");
		assert.match(textOf((nested!.model![0] as { content: unknown }).content), /not|unknown|unavailable/i, "a Subagent cannot launch Subagents: the tool is not in its allowlist");
		assert.equal((await h.harness.snapshot(ChildDoc, e!.conversationId as ConversationId, context))?.depth, 1);
	});
	const events = telemetry().filter((event) => event.executionId === id);
	assert.deepEqual(events.filter((event) => String(event.type).startsWith("execution.")).map((event) => event.type), ["execution.launched", "execution.settled"]);
	assert.ok(events.some((event) => event.type === "usage" && String(event.sessionId).startsWith(`${CHAT}:`)), "child usage is recorded under the child's session ID");
	assert.equal(integrity(store), "ok");
});

test("P089 foreground Subagent: the tool returns the result and receipt itself, collected, with no wake", async () => {
	const { store, cwd } = family("subagent-fg");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout("hello child", { background: false, profile: "implementer" })));
	const result = await toolResult(host, "subagent");
	assert.match(result, /^ok: hello child\n\nCompletion receipt: openai\/gpt-6-luna:medium · subagent · implementer · routine · outcome success$/);
	await quiet(host);
	await prompt(host, call("subagent_status", { all: true }));
	assert.match(await toolResult(host, "subagent_status"), /\[success, collected\]/);
	await quiet(host);
	const transcript = await host.call<Transcript>("transcript");
	assert.equal(customs(transcript.messages, "pi-workbench:child-completion").length, 0, "a foreground child wakes nobody");
	const child = logged(store).find((l) => l.label === "hello child")!;
	assert.deepEqual(child.tools, ["bash", "compact_and_continue", "edit", "find", "grep", "ls", "read", "report_status", "write"], "implementer allowlist adds edit and write");
	await host.close();
});

test("bash per conversation: the lead has the Workbench bash, a Subagent the native blocking bash, in the same host", async () => {
	const { store, cwd } = family("bash-per-conversation");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout('call:bash {"command":"sleep 0.3; echo native-child"}', { background: false })));
	await toolResult(host, "subagent");
	await quiet(host);
	await host.close();
	await inspect(store, cwd, async (h) => {
		const bashOf = async (conversation: ConversationId) =>
			(await (await h.harness.conversation(conversation, context))!.agent(context)).tools.find((tool) => tool.name === "bash")!;
		const [e] = await executions(h);
		const lead = await bashOf(h.root.id);
		const child = await bashOf(e!.conversationId as ConversationId);
		assert.ok("foreground" in (lead.parameters as { properties: object }).properties, "the lead's bash is the Workbench one");
		assert.equal("foreground" in (child.parameters as { properties: object }).properties, false, "the child's bash is the native one");
		const result = (await entries(h, e!.conversationId)).map((entry) => entry.model?.[0] as Message & { toolName?: string } | undefined).find((m) => m?.toolName === "bash");
		assert.equal(textOf(result!.content).trim(), "native-child", "the child waited for its command, as native bash does");
		assert.equal(result!.isError, false);
	});
	assert.equal(integrity(store), "ok");
});

test("P089 independent review: routed to another model family, the receipt names it; exclusions and misuse fail preflight", async () => {
	const { store, cwd } = family("subagent-review");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout("review it", { cognitiveRole: "review", profile: "reviewer", background: false, independentOfModel: "openai-codex/gpt-6.1-sol" })));
	assert.match(await toolResult(host, "subagent"), /Completion receipt: anthropic\/claude-opus-5-5:high · subagent · reviewer · review · outcome success · family anthropic/);
	await quiet(host);
	await prompt(host, call("subagent", scout("review again", { cognitiveRole: "review", profile: "reviewer", background: false, independentOfModel: "openai-codex/gpt-6.1-sol", excludeFamilies: ["anthropic"] })));
	// Routing policy v6 has no third family: excluding the only other family leaves no independent reviewer.
	assert.match(await toolResult(host, "subagent", 2), /^preflight_failed: Routing resolver failed[\s\S]*No independent candidate remains for author family 'openai' after exclusions/);
	await quiet(host);
	await prompt(host, call("subagent", scout("x", { independentOfModel: "openai-codex/gpt-6.1-sol" })));
	assert.match(await toolResult(host, "subagent", 3), /^preflight_failed: Cognitive Role 'routine' does not use an independence constraint/);
	await quiet(host);
	await prompt(host, call("subagent", scout("x", { cognitiveRole: "review", profile: "reviewer", modelOverride: "openai-codex/gpt-6-astra", independentOfModel: "openai-codex/gpt-6.1-sol" })));
	assert.match(await toolResult(host, "subagent", 4), /^preflight_failed: Routing resolver failed[\s\S]*not independent of author family 'openai'/);
	await quiet(host);
	await prompt(host, call("subagent", scout("x", { cognitiveRole: "frontier", effort: "low" })));
	assert.match(await toolResult(host, "subagent", 5), /^preflight_failed: Routing resolver failed[\s\S]*Role 'frontier' needs at least Model Effort 'medium', got 'low'/, "effort ceilings of the routing policy hold");
	await host.close();
});

// ─── P090/P091 collect and status ────────────────────────────────────────────

test("P090/P091 collect and status: running inspection returns at once; a long result is bounded and says so; a failed child is an error; status lists by default only what needs reconciling", async () => {
	const { store, cwd } = family("collect");
	// Notices are held, so subagent_collect alone reads the results.
	const host = open(store, cwd, { PI_DURABLE_HOLD: "child:before-delivery" });
	await host.ready;
	await prompt(host, call("subagent", scout('call:bash {"command":"sleep 2"}', { name: "Slow" })));
	const slow = launchedId(await toolResult(host, "subagent"));
	await quiet(host);
	await prompt(host, call("subagent_collect", { executionId: slow }));
	assert.match(await toolResult(host, "subagent_collect"), /\[running\][\s\S]*Still running; end this turn/, "a running child returns a snapshot at once");
	await host.until((e) => e.type === "test.hold", "the slow child's result");
	await quiet(host);
	await prompt(host, call("subagent_collect", {}));
	assert.match(await toolResult(host, "subagent_collect", 2), new RegExp(`^Reconciled 1 of 1 terminal children\\.\\n\\n${slow} \\[success\\]`), "a later collect reads it");
	await quiet(host);

	// Both end, then one bulk collect.
	await prompt(host, calls(
		{ name: "subagent", arguments: scout("long:9000", { name: "Long" }) },
		{ name: "subagent", arguments: scout("fail", { name: "Failing" }) },
	));
	await toolResult(host, "subagent", 3);
	await host.until(() => host.events.filter((e) => e.type === "test.hold").length >= 3, "both results");
	await quiet(host);
	await prompt(host, call("subagent_collect", {}));
	const bulk = await toolResult(host, "subagent_collect", 3);
	assert.match(bulk, /^Reconciled 2 of 2 terminal children\. 1 result\(s\) truncated — verification incomplete\./);
	assert.match(bulk, /\[Result truncated: showing the first 8000 of 9000 characters; the full answer stays in child conversation \d+\.\]/);
	assert.match(bulk, /TRUNCATED, cannot satisfy verification/);
	assert.match(bulk, /\n\S+ \[execution_failed\]\nexecution_failed: child input ended unanswered \(model_error\)/, "a failed child is reported as failed, not success");
	assert.match(bulk, /\n\S+ \[success\]\nx{8000}\n/, "the long child succeeded, bounded");
	assert.equal((host.events.filter(isTool("subagent_collect"))[2]!.message as Message).isError, true, "a bulk collect with a failure is an error result");
	await quiet(host);

	await prompt(host, call("subagent_status", {}));
	assert.match(await toolResult(host, "subagent_status"), /^0 running, 0 terminal and uncollected, 3 launched from this conversation\. Nothing needs reconciliation/);
	await quiet(host);
	await prompt(host, call("subagent_status", { all: true }));
	const all = await toolResult(host, "subagent_status", 2);
	assert.equal(all.match(/, collected\]/g)?.length, 3, "all:true lists the collected children too");
	await quiet(host);
	await prompt(host, call("subagent_collect", {}));
	assert.match(await toolResult(host, "subagent_collect", 4), /^Nothing terminal to reconcile\./, "a second collect reads nothing again");
	await quiet(host);
	await host.close();
});

test("P091 status reads never collect: a terminal child read by status stays uncollected until subagent_collect", async () => {
	const { store, cwd } = family("status-read");
	// The wake is held, so only the lead's own calls read or collect the result.
	const host = open(store, cwd, { PI_DURABLE_HOLD: "child:before-delivery" });
	await host.ready;
	await prompt(host, call("subagent", scout("quick")));
	const id = launchedId(await toolResult(host, "subagent"));
	await host.until((e) => e.type === "test.hold", "the result");
	await quiet(host);
	await prompt(host, call("subagent_status", { executionId: id }));
	assert.match(await toolResult(host, "subagent_status"), new RegExp(`^${id} \\[success, uncollected\\]`));
	await quiet(host);
	await prompt(host, call("subagent_status", {}));
	assert.match(await toolResult(host, "subagent_status", 2), new RegExp(`^0 running, 1 terminal and uncollected, 1 launched from this conversation\\.\\n- ${id} \\[success, uncollected\\]`));
	await quiet(host);
	await prompt(host, call("subagent_collect", {}));
	assert.match(await toolResult(host, "subagent_collect"), new RegExp(`^Reconciled 1 of 1 terminal children\\.\\n\\n${id} \\[success\\]\\nok: quick`), "reading status collected nothing");
	await quiet(host);
	await host.close();
});

// ─── P092 report_status and roster ───────────────────────────────────────────

test("P092 report_status: a second report replaces the first in the one roster row, which names the model and start; the row goes once collected", async () => {
	const { store, cwd } = family("report");
	const host = open(store, cwd);
	await host.ready;
	const rosterOf = (status: Status) => JSON.parse(status.extensionStatuses?.["pi-workbench:activity"] ?? '{"items":[]}') as { schemaVersion: number; items: Record<string, string>[] };
	const mark = host.events.length;
	await prompt(host, call("subagent", scout(calls({ name: "report_status", arguments: { status: "Reading the code" } }, { name: "bash", arguments: { command: "sleep 1.5" } }), { name: "Reporter" })));
	const id = launchedId(await toolResult(host, "subagent"));
	const first = await since(host, mark, (e) => e.type === "status.update" && rosterOf(e.status as Status).items[0]?.reportedStatus === "Reading the code", "the first report");
	const [item, ...others] = rosterOf(first.status as Status).items;
	assert.equal(others.length, 0);
	assert.deepEqual({ id: item!.id, kind: item!.kind, name: item!.name, model: item!.model, effort: item!.effort, role: item!.role }, { id: `delegate:${id}`, kind: "subagent", name: "Reporter", model: "openai/gpt-6-luna", effort: "medium", role: "routine" });
	assert.ok(Date.parse(item!.startedAt!) > 0 && Date.parse(item!.reportedAt!) >= Date.parse(item!.startedAt!), "start and report times for elapsed and quiet time");
	await prompt(host, call("subagent_steer", { executionId: id, message: call("report_status", { status: "Writing the fix" }) }));
	const second = await since(host, mark, (e) => e.type === "status.update" && rosterOf(e.status as Status).items[0]?.reportedStatus === "Writing the fix", "the second report");
	assert.equal(rosterOf(second.status as Status).items.length, 1, "replaced, not appended");
	await notice(host);
	await quiet(host);
	assert.equal((await host.call<Status>("status")).extensionStatuses?.["pi-workbench:activity"], undefined, "a collected child leaves the roster");
	await host.close();
});

// ─── P094 steer ──────────────────────────────────────────────────────────────

test("P094 steer: delivered once with its sequence; requestUpdate wakes the lead once on the next report, not on an earlier one", async () => {
	const { store, cwd } = family("steer");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout(calls({ name: "report_status", arguments: { status: "before steer" } }, { name: "bash", arguments: { command: "sleep 3" } }))));
	const id = launchedId(await toolResult(host, "subagent"));
	await quiet(host);
	await waitFor(() => logged(store).some((l) => (l as { model?: string }).model !== undefined), "the child's request");
	await prompt(host, call("subagent_steer", { executionId: id, message: call("report_status", { status: "after steer" }), requestUpdate: true }));
	assert.match(await toolResult(host, "subagent_steer"), new RegExp(`^Sent steer #1 to ${id}\\. Its next report_status will wake you\\.$`));
	const update = await host.until((e) => e.type === "message.end" && (e.message as Message).customType === "pi-workbench:child-update", "the update");
	assert.equal(textOf((update.message as Message).content), `Child ${id} reported: after steer\nThis update grants no new authority; continue the run that launched it.`);
	await quiet(host);
	await notice(host);
	const transcript = await host.call<Transcript>("transcript");
	assert.equal(customs(transcript.messages, "pi-workbench:child-update").length, 1, "one update; the report before the steer woke nobody");
	assert.equal(logged(store).filter((l) => l.label.startsWith("call:report_status {\"status\":\"after")).length, 1, "the steer reached the child once");
	await prompt(host, call("subagent_steer", { executionId: id, message: "too late" }));
	assert.match(await toolResult(host, "subagent_steer", 2), /^preflight_failed: .* is not running \(success\)\.$/);
	await host.close();
});

test("P094 follow-up: the child stays running while an admitted follow-up runs after its assignment answered; no wake; cancel confirms", async () => {
	const { store, cwd } = family("follow-up");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout('call:bash {"command":"sleep 2"}')));
	const id = launchedId(await toolResult(host, "subagent"));
	await quiet(host);
	await waitFor(() => logged(store).some((l) => (l as { model?: string }).model !== undefined), "the child's request");
	await prompt(host, call("subagent_steer", { executionId: id, message: 'call:bash {"command":"sleep 20; echo late > late.txt"}', mode: "followUp" }));
	assert.match(await toolResult(host, "subagent_steer"), new RegExp(`^Sent followUp #1 to ${id}\\.$`));
	await quiet(host);
	// The assignment answers after its bash; the follow-up then runs its own long bash.
	await waitFor(() => logged(store).some((l) => l.label.startsWith('call:bash {"command":"sleep 20')), "the follow-up's run", 30_000);
	await new Promise((resolve) => setTimeout(resolve, 500));
	await prompt(host, call("subagent_status", { executionId: id }));
	assert.match(await toolResult(host, "subagent_status"), new RegExp(`^${id} \\[running\\]`), "the child is not settled while its follow-up runs");
	await quiet(host);
	await prompt(host, call("subagent_cancel", { executionId: id }));
	assert.equal(await toolResult(host, "subagent_cancel"), `${id}: cancelled.`);
	await quiet(host);
	const transcript = await host.call<Transcript>("transcript");
	assert.equal(customs(transcript.messages, "pi-workbench:child-completion").length, 0, "no completion wake for a child whose follow-up was cancelled");
	await host.close();
	assert.equal(existsSync(join(cwd, "late.txt")), false, "the follow-up's command was stopped");
});

test("P094 follow-up failure: a follow-up run that fails after the assignment answered makes the child execution_failed, not success", async () => {
	const { store, cwd } = family("follow-up-fail");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout('call:bash {"command":"sleep 2"}')));
	const id = launchedId(await toolResult(host, "subagent"));
	await quiet(host);
	await waitFor(() => logged(store).some((l) => (l as { model?: string }).model !== undefined), "the child's request");
	await prompt(host, call("subagent_steer", { executionId: id, message: "fail", mode: "followUp" }));
	assert.match(await toolResult(host, "subagent_steer"), new RegExp(`^Sent followUp #1 to ${id}\\.$`));
	const collected = textOf((await notice(host)).content);
	assert.match(collected, new RegExp(`${id} \\[execution_failed\\]\\nexecution_failed: child run after its assignment ended error: 400 invalid request \\(scripted\\)`));
	await quiet(host);
	await host.close();
});

// ─── P093 cancel ─────────────────────────────────────────────────────────────

test("P093 cancel: the receipt confirms termination; no wake or result follows; the child's work stops", async () => {
	const { store, cwd } = family("cancel");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout('call:bash {"command":"sleep 20; echo late > late.txt"}')));
	const id = launchedId(await toolResult(host, "subagent"));
	await quiet(host);
	await waitFor(() => logged(store).some((l) => (l as { model?: string }).model !== undefined), "the child's request");
	await prompt(host, call("subagent_cancel", { executionId: id }));
	assert.equal(await toolResult(host, "subagent_cancel"), `${id}: cancelled.`);
	await quiet(host);
	await prompt(host, call("subagent_status", { executionId: id }));
	assert.match(await toolResult(host, "subagent_status"), /\[cancelled, collected\]/);
	await quiet(host);
	const transcript = await host.call<Transcript>("transcript");
	assert.equal(customs(transcript.messages, "pi-workbench:child-completion").length, 0, "a cancelled child never wakes the lead");
	await host.close();
	assert.equal(existsSync(join(cwd, "late.txt")), false, "the child's command was stopped");
});

// ─── P095–P098 Workers ───────────────────────────────────────────────────────

test("P095–P098 Workers: create starts nothing; busy dispatch fails preflight; a coordinator settles only after its leaf is collected; the next dispatch continues its scope with a fresh binding; retire blocks dispatch", async () => {
	const { store, cwd } = family("workers");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("tools_enable", { group: "workers" }));
	await quiet(host);
	const requestsBefore = logged(store).length;
	await prompt(host, call("worker_create", { name: "Scope keeper", scope: "the parser", profile: "coordinator" }));
	const created = await toolResult(host, "worker_create");
	const workerId = /Created worker (\S+)/.exec(created)![1]!;
	await quiet(host);
	assert.equal(logged(store).length, requestsBefore + 2, "create made no child request (only the lead's two)");

	// The coordinator's leaf runs two seconds, so its Worker is busy for at least that long.
	const leafTask = call("subagent", scout('call:bash {"command":"sleep 2"}', { name: "Leaf" }));
	await prompt(host, call("worker_dispatch", { workerId, task: leafTask, cognitiveRole: "coordination", background: true }));
	const dispatched = await toolResult(host, "worker_dispatch");
	assert.match(dispatched, /^Dispatched worker \S+ \(worker "Scope keeper", first dispatch\) in the background on anthropic\/claude-opus-5-5:medium \(coordinator · coordination\)/);
	const firstId = launchedId(dispatched);
	await waitFor(() => logged(store).some((l) => l.label.startsWith("call:bash")), "the leaf's request");
	await prompt(host, call("worker_dispatch", { workerId, task: "second", cognitiveRole: "coordination", background: true }));
	assert.match(await toolResult(host, "worker_dispatch", 2), new RegExp(`^preflight_failed: Worker ${workerId} is busy with dispatch ${firstId}; one dispatch at a time\\.$`), "a busy Worker refuses instead of queueing");
	const collected = textOf((await notice(host)).content);
	assert.match(collected, new RegExp(`${firstId} \\[success\\]\\nok: Background children finished; their results follow and are already collected\\.`), "the Worker's answer came after its leaf's notice");
	await quiet(host);

	await prompt(host, call("worker_dispatch", { workerId, task: "follow-up", cognitiveRole: "routine", background: false }));
	assert.match(await toolResult(host, "worker_dispatch", 3), /^ok: follow-up\n\nCompletion receipt: openai\/gpt-6-luna:medium · worker · coordinator · routine · outcome success$/, "a fresh binding per dispatch");
	const followUp = logged(store).find((l) => l.label === "follow-up")!;
	assert.ok(followUp.messages! > 3, `the second dispatch sees its first dispatch's conversation (${String(followUp.messages)} messages)`);
	await quiet(host);

	await prompt(host, call("worker_dispatch", { workerId, task: call("worker_create", { name: "nested", scope: "s", profile: "scout" }), cognitiveRole: "routine", background: false }));
	assert.match(await toolResult(host, "worker_dispatch", 4), /^done after worker_create/);
	await quiet(host);
	await prompt(host, call("worker_dispatch", { workerId, task: "x", cognitiveRole: "review" }));
	assert.match(await toolResult(host, "worker_dispatch", 5), /cognitiveRole: expected one of \["routine","implementation","frontier","coordination"\]/, "review roles are subagent-only: the Worker schema refuses them");
	await quiet(host);
	await prompt(host, call("worker_retire", { workerId, reason: "scope done" }));
	assert.match(await toolResult(host, "worker_retire"), new RegExp(`^Retired worker ${workerId} at \\S+: scope done$`));
	await quiet(host);
	await prompt(host, call("worker_dispatch", { workerId, task: "x", cognitiveRole: "routine" }));
	assert.match(await toolResult(host, "worker_dispatch", 6), /^preflight_failed: Worker \S+ was retired at \S+: scope done$/);
	await quiet(host);
	await prompt(host, call("worker_status", { workerId }));
	const status = await toolResult(host, "worker_status");
	assert.match(status, /\[retired\] retired \S+: scope done/);
	assert.match(status, /3 recorded dispatch\(es\)/);
	assert.match(status, /Last dispatch: success · openai\/gpt-6-luna:medium/);
	await quiet(host);
	await prompt(host, call("worker_status", {}));
	assert.match(await toolResult(host, "worker_status", 2), /^No active durable workers are recorded for this Chat\./, "default status lists only active owned Workers");
	await host.close();

	await inspect(store, cwd, async (h) => {
		const worker = Object.values((await h.harness.snapshot(WorkersDoc, context))!.workers)[0]!;
		assert.equal(worker.lineage.length, 3, "one child conversation per dispatch, each forked from the one before");
		const nested = (await entries(h, worker.lineage[2]!)).map((entry) => entry.model?.[0] as { toolName?: string; content?: unknown; isError?: boolean } | undefined).find((m) => m?.toolName === "worker_create");
		assert.equal(nested?.isError, true, "a Worker cannot create Workers: the tool is not in its allowlist");
		const [dispatch] = (await executions(h)).filter((e) => e.kind === "worker");
		const leaves = await executions(h, dispatch!.conversationId as ConversationId);
		assert.equal(leaves.length, 1);
		assert.equal(leaves[0]!.collected, true);
		assert.equal((await h.harness.snapshot(ChildDoc, leaves[0]!.conversationId as ConversationId, context))?.depth, 2, "lead → Worker → leaf");
		assert.deepEqual(logged(store).find((l) => l.label.startsWith("call:bash"))?.tools, ["bash", "compact_and_continue", "find", "grep", "ls", "read", "report_status"], "the leaf has no delegation tools");
	});
});

test("P093 Worker cancel reaches its leaves; cancelling one leaf leaves its Worker running", async () => {
	const { store, cwd } = family("worker-cancel");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("tools_enable", { group: "workers" }));
	await quiet(host);
	await prompt(host, call("worker_create", { name: "W", scope: "s", profile: "coordinator" }));
	const workerId = /Created worker (\S+)/.exec(await toolResult(host, "worker_create"))![1]!;
	await quiet(host);
	const sleeper = call("subagent", scout('call:bash {"command":"sleep 20; echo late > late-leaf.txt"}'));

	// One leaf cancelled by its Worker (steered to do so): the Worker answers.
	await prompt(host, call("worker_dispatch", { workerId, task: sleeper, cognitiveRole: "coordination", background: true }));
	const firstWorker = launchedId(await toolResult(host, "worker_dispatch"));
	await quiet(host);
	await waitFor(() => logged(store).filter((l) => l.label.startsWith("call:bash")).length >= 1, "the leaf's request");
	await prompt(host, call("subagent_steer", { executionId: firstWorker, message: "cancel:last", mode: "followUp" }));
	await toolResult(host, "subagent_steer");
	const collected = textOf((await notice(host)).content);
	assert.match(collected, new RegExp(`${firstWorker} \\[success\\]\\ndone after subagent_cancel`), "the Worker stayed alive and answered after its leaf was cancelled");
	await quiet(host);

	// The Worker cancelled: its running leaf is cancelled with it.
	await prompt(host, call("worker_dispatch", { workerId, task: sleeper, cognitiveRole: "coordination", background: true }));
	const secondWorker = launchedId(await toolResult(host, "worker_dispatch", 2));
	await quiet(host);
	await waitFor(() => logged(store).filter((l) => l.label.startsWith("call:bash")).length >= 2, "the second leaf's request");
	await prompt(host, call("subagent_cancel", { executionId: secondWorker }));
	assert.equal(await toolResult(host, "subagent_cancel"), `${secondWorker}: cancelled.`);
	await quiet(host);
	await host.close();
	await inspect(store, cwd, async (h) => {
		const dispatches = (await executions(h)).filter((e) => e.kind === "worker");
		assert.deepEqual(dispatches.map((e) => e.outcome), ["success", "cancelled"]);
		const firstLeaves = await executions(h, dispatches[0]!.conversationId as ConversationId);
		const secondLeaves = await executions(h, dispatches[1]!.conversationId as ConversationId);
		assert.deepEqual(firstLeaves.map((e) => e.outcome), ["cancelled"]);
		assert.deepEqual(secondLeaves.map((e) => e.outcome), ["cancelled"], "Worker cancellation reached its leaf");
		const worker = Object.values((await h.harness.snapshot(WorkersDoc, context))!.workers)[0]!;
		assert.equal(worker.lock, null, "the cancelled dispatch released its lock");
		assert.deepEqual(worker.receipts.map((r) => r.outcome), ["success", "cancelled"], "one terminal receipt per dispatch");
	});
	assert.equal(existsSync(join(cwd, "late-leaf.txt")), false);
});

// ─── P099 coalescing and the checkpoint barrier ──────────────────────────────

test("P099 two children finishing together: each result reaches exactly one notice, and nothing is left to collect", async () => {
	const { store, cwd } = family("coalesce");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, calls(
		{ name: "subagent", arguments: scout("a") },
		{ name: "subagent", arguments: scout("b") },
		{ name: "bash", arguments: { command: "sleep 1.5", description: "Keep the lead busy", foreground: true } },
	));
	const ids = [launchedId(await toolResult(host, "subagent", 1)), launchedId(await toolResult(host, "subagent", 2))];
	const carried = () => host.events.filter(isNotice).map((e) => textOf((e.message as Message).content)).join("\n");
	await host.until(() => ids.every((id) => carried().includes(`${id} [success]`)), "both results");
	await quiet(host);
	for (const part of [...ids.map((id) => `${id} [success]\nok: `), "\nok: a\n", "\nok: b\n"]) assert.equal(carried().split(part).length, 2, `${part} carried once`);
	assert.equal(host.events.filter(isTool("subagent_collect")).length, 0, "the notices carried both: no collect");
	await prompt(host, call("subagent_collect", {}));
	assert.match(await toolResult(host, "subagent_collect"), /^Nothing terminal to reconcile\./);
	await quiet(host);
	await host.close();
});

test("checkpoint barrier: a child finishing during compact_and_continue wakes the lead only after the continuation is placed", async () => {
	const { store, cwd } = family("barrier");
	const gate = join(store, "..", "summary-gate");
	const host = open(store, cwd);
	await host.ready;
	await host.call("configure", { resources: {}, compaction: { keepRecentTokens: 1 } });
	await prompt(host, "warm up");
	await quiet(host);
	await prompt(host, calls(
		{ name: "subagent", arguments: scout('call:bash {"command":"sleep 1"}') },
	));
	await quiet(host);
	await prompt(host, call("compact_and_continue", { summaryFocus: `gate:${gate}`, nextPhase: "phase two" }));
	await waitFor(() => logged(store).some((l) => l.label === "summarize"), "the summary request");
	// The child ends while the summary is held.
	await host.until((e) => e.type === "status.update" && /"activity":"success"/.test((e.status as Status).extensionStatuses?.["pi-workbench:activity"] ?? ""), "the child's result");
	writeFileSync(gate, "");
	await notice(host);
	await quiet(host);
	const transcript = await host.call<Transcript>("transcript");
	const continuation = transcript.messages.findIndex((m) => m.customType === "context-checkpoint");
	const wake = transcript.messages.findIndex((m) => m.customType === "pi-workbench:child-completion");
	assert.ok(continuation >= 0 && wake >= 0, "both placed");
	assert.ok(continuation < wake, `the continuation (${String(continuation)}) is placed before the wake (${String(wake)})`);
	await host.close();
});

// ─── Completion notices carry results (main 0bfd282, aedf57c, a2684e3) ──────

test("a background child's completion notice carries its result and receipt, marks it collected; an over-budget child is named for subagent_collect; a late child rides the next notice", async () => {
	const { store, cwd } = family("notice");
	// Three results end held before their notice, so after a restart one notice composes all three (24k budget: two fit).
	let host = open(store, cwd, { PI_DURABLE_HOLD: "child:before-delivery" });
	await host.ready;
	await prompt(host, calls(...["A", "B", "C"].map((name) => ({ name: "subagent", arguments: scout("long:8000", { name }) }))));
	const ids = [launchedId(await toolResult(host, "subagent", 1)), launchedId(await toolResult(host, "subagent", 2)), launchedId(await toolResult(host, "subagent", 3))];
	await host.until(() => host.events.filter((e) => e.type === "test.hold").length >= 3, "three results held");
	await host.kill();
	host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout('call:bash {"command":"sleep 2"}', { name: "Late" })));
	const late = launchedId(await toolResult(host, "subagent"));

	const first = await notice(host, 1);
	const body = textOf(first.content);
	const carried = ids.filter((id) => body.includes(`${id} [success]\nxxxx`));
	const named = ids.filter((id) => !carried.includes(id));
	assert.equal(carried.length, 2, `two results fit the budget: ${body.slice(0, 400)}`);
	assert.ok(body.startsWith("Background children finished; their results follow and are already collected."), body.slice(0, 300));
	assert.ok(body.includes(`Call \`subagent_collect\` without an executionId once for the results this notice could not carry: ${named[0]!}.`), "the third is named for subagent_collect");
	assert.equal(body.match(/Completion receipt: \S+ · subagent · scout · routine · outcome success/g)?.length, 2, "each carried result has its receipt");
	const details = first.details as { attention: string; delivered: string[]; collect: string[] };
	assert.deepEqual({ ...details, delivered: [...details.delivered].sort() }, { attention: "terminal-results", delivered: [...carried].sort(), collect: named });
	assert.match(await toolResult(host, "subagent_collect"), new RegExp(`^Reconciled 1 of 1 terminal children\\.\\n\\n${named[0]!} \\[success\\]`), "the lead collects only the named one");

	const second = textOf((await notice(host, 2)).content);
	assert.match(second, new RegExp(`^Background children finished; their results follow and are already collected\\.[^\\n]*\\n\\n${late} \\[success\\]\\ndone after bash\\n\\nCompletion receipt: `), "the late child rides its own notice");
	assert.ok(!second.split("\n\n", 1)[0]!.includes("subagent_collect"), "nothing left to collect");
	await quiet(host);
	assert.equal(host.events.filter(isTool("subagent_collect")).length, 1, "one collect: the notices carried the rest");
	assert.equal(host.events.filter(isNotice).length, 2, "each result reached exactly one notice");
	await prompt(host, call("subagent_status", { all: true }));
	assert.equal((await toolResult(host, "subagent_status")).match(/, collected\]/g)?.length, 4, "all four are collected");
	await quiet(host);
	await host.close();
	assert.equal(integrity(store), "ok");
});

// ─── report_status reminder and quiet-report cadence (main 0bfd282, e46dc16) ─

test("report_status alone in its batch returns the reminder; batched with another call it does not; the description asks for phase changes and a report after each wait", async () => {
	const { store, cwd } = family("report-alone");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout(call("report_status", { status: "alone" }), { background: false })));
	await toolResult(host, "subagent");
	await quiet(host);
	await prompt(host, call("subagent", scout(calls({ name: "report_status", arguments: { status: "batched" } }, { name: "ls", arguments: {} }), { background: false })));
	await toolResult(host, "subagent", 2);
	await quiet(host);
	await host.close();
	await inspect(store, cwd, async (h) => {
		const reports: string[] = [];
		for (const e of await executions(h))
			for (const entry of await entries(h, e.conversationId)) {
				const m = entry.model?.[0] as (Message & { toolName?: string }) | undefined;
				if (m?.toolName === "report_status") reports.push(textOf(m.content));
			}
		assert.deepEqual(reports.sort(), ["Reported: alone. Next time send report_status with a real tool call, never alone.", "Reported: batched"]);
		const [e] = await executions(h);
		const tool = (await (await h.harness.conversation(e!.conversationId as ConversationId, context))!.agent(context)).tools.find((t) => t.name === "report_status")!;
		assert.match(tool.description, /report only when your phase changes[\s\S]*never alone; after each wait \(at most 55 min\) send one with your next tool call\.$/);
		assert.doesNotMatch(tool.description, /stale/);
	});
});

test("quiet-report cadence: a child quiet for the window gets one update-request steer, waking nobody; its next report re-arms it; its commands are marked a child's", async () => {
	const { store, cwd } = family("cadence");
	// Each steer is read within the stuck grace (the first after 2 s, the second after 1.5 s): no stuck notice.
	const host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "1000", PILOT_STUCK_GRACE_MS: "3000" });
	await host.ready;
	await prompt(host, call("bash", { command: 'echo "lead=${PI_WORKBENCH_EXECUTION_KIND:-none}" > lead-kind.txt', description: "Lead kind", foreground: true }));
	await quiet(host);
	// Quiet 3 s (steer 1 at 1 s, placed at 3 s): reports, quiet 2.5 s again (steer 2), reports, ends.
	await prompt(host, call("subagent", scout('call:bash {"command":"echo kind=$PI_WORKBENCH_EXECUTION_KIND > kind.txt; sleep 3"}', { background: false })));
	assert.match(await toolResult(host, "subagent"), /^done after report_status\n/);
	await quiet(host);
	assert.equal(customs((await host.call<Transcript>("transcript")).messages, "pi-workbench:child-update").length, 0, "a quiet-report steer wakes nobody");
	assert.equal(customs((await host.call<Transcript>("transcript")).messages, "pi-workbench:child-stuck").length, 0, "a child that read its steer sends no stuck notice");
	await host.close();
	assert.equal(readFileSync(join(cwd, "kind.txt"), "utf8").trim(), "kind=subagent", "wait-until inside a child caps its wait");
	assert.equal(readFileSync(join(cwd, "lead-kind.txt"), "utf8").trim(), "lead=none");
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		const asked = (await entries(h, e!.conversationId)).filter((entry) => { const m = entry.model?.[0] as Message | undefined; return m?.role === "user" && textOf(m.content) === UPDATE_REQUEST; });
		assert.equal(asked.length, 2, "one steer per quiet span: none repeated while the first waited, a second after the report re-armed it");
		assert.equal(e!.steers, 2);
		assert.equal(e!.reportedStatus, "update 2");
	});
});

test("quiet-report cadence: the steer committed before a host kill is sent once after reopen", async () => {
	const { store, cwd } = family("cadence-kill");
	let host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "1000", PI_DURABLE_HOLD: "cadence:after-mark" });
	await host.ready;
	await prompt(host, call("subagent", scout('call:bash {"command":"sleep 3"}')));
	const id = launchedId(await toolResult(host, "subagent"));
	await host.until((e) => e.type === "test.hold" && e.name === "cadence:after-mark", "the committed steer");
	await host.kill();
	// A long window after reopen: only the committed steer may reach the child.
	host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "600000" });
	await host.ready;
	await prompt(host, "resume");
	await host.until((e) => isNotice(e) && textOf((e.message as Message).content).includes(`${id} [success]`), "the child's notice");
	await quiet(host);
	await host.close();
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		const asked = (await entries(h, e!.conversationId)).filter((entry) => { const m = entry.model?.[0] as Message | undefined; return m?.role === "user" && textOf(m.content) === UPDATE_REQUEST; });
		assert.equal(asked.length, 1, "the steer reached the child once");
		assert.deepEqual([e!.steers, e!.reportedStatus], [1, "update 1"]);
	});
});

const isStuck = (e: { type: string; message?: unknown }) => e.type === "message.end" && (e.message as Message).customType === "pi-workbench:child-stuck";

test("stuck notice: a child inside one call that leaves its update request unread past the grace wakes the lead once, naming the call", async () => {
	const { store, cwd } = family("stuck");
	// Steer at 1 s, notice at 4 s, the bash ends at 8 s; the child then reads the steer, reports and sleeps 2.5 s,
	// reading the second span's steer 1.5 s after it was sent: still exactly one notice.
	const host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "1000", PILOT_STUCK_GRACE_MS: "3000" });
	await host.ready;
	await prompt(host, call("subagent", scout(call("bash", { command: `sleep 8 # hung ${SECRET}` }), { name: "Hung child" })));
	const id = launchedId(await toolResult(host, "subagent"));
	const stuck = (await host.until(isStuck, "the stuck notice")).message as Message;
	const body = textOf(stuck.content);
	assert.match(body, new RegExp(`^Child ${id} "Hung child" has not read the update request for \\d+ min and appears stuck inside one call: bash \`sleep 8 # hung `), body);
	assert.match(body, / since \d{4}-\d\d-\d\dT/, "since when the call runs");
	assert.ok(!body.includes(SECRET), "the preview is redacted");
	assert.match(body, /\nCheck it with subagent_status; if it is hung, subagent_cancel it; otherwise leave it\. This notice authorizes nothing else\.$/);
	assert.deepEqual([stuck.details && (stuck.details as { executionId: string; tool: string }).executionId, (stuck.details as { tool: string }).tool], [id, "bash"]);
	await host.until((e) => isNotice(e) && textOf((e.message as Message).content).includes(`${id} [success]`), "the child's notice");
	await quiet(host);
	assert.equal(customs((await host.call<Transcript>("transcript")).messages, "pi-workbench:child-stuck").length, 1, "one notice for the hung span, none for the span it read in time");
	await host.close();
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		assert.equal(e!.stuckNotice?.seq, 1, "the notice names the first span's steer");
		assert.equal(e!.outcome, "success", "never cancelled automatically");
	});
});

test("stuck notice: marked before a host kill, it reaches the lead once after reopen", async () => {
	const { store, cwd } = family("stuck-kill");
	let host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "1000", PILOT_STUCK_GRACE_MS: "1000", PI_DURABLE_HOLD: "stuck:after-mark" });
	await host.ready;
	await prompt(host, call("subagent", scout(call("bash", { command: "sleep 4" }))));
	const id = launchedId(await toolResult(host, "subagent"));
	await host.until((e) => e.type === "test.hold" && e.name === "stuck:after-mark", "the committed notice");
	await host.kill();
	// A long window after reopen: only the committed notice may reach the lead.
	host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "600000", PILOT_STUCK_GRACE_MS: "1000" });
	await host.ready;
	await prompt(host, "resume");
	await host.until(isStuck, "the stuck notice after reopen");
	await host.until((e) => isNotice(e) && textOf((e.message as Message).content).includes(`${id} [`), "the child's notice");
	await quiet(host);
	const notices = customs((await host.call<Transcript>("transcript")).messages, "pi-workbench:child-stuck");
	assert.equal(notices.length, 1, "exactly one stuck notice");
	assert.match(textOf(notices[0]!.content), new RegExp(`^Child ${id} .* bash \`sleep 4\``));
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("stuck notice: a Worker stuck in a foreground subagent call names its leaf; a known secret with a quote and a backslash in the call's arguments is masked, raw and JSON-escaped", async () => {
	const { store, cwd } = family("stuck-escaped");
	const password = 'stuck"Pass\\word-4b8e1d7c93a5';
	const escaped = JSON.stringify(password).slice(1, -1);
	const host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "1000", PILOT_STUCK_GRACE_MS: "1000", PILOT_STUCK_PASSWORD: password });
	await host.ready;
	await prompt(host, call("tools_enable", { group: "workers" }));
	await quiet(host);
	await prompt(host, call("worker_create", { name: "Stuck keeper", scope: "the parser", profile: "coordinator" }));
	const workerId = /Created worker (\S+)/.exec(await toolResult(host, "worker_create"))![1]!;
	await quiet(host);
	// The secret leads the arguments, so the 200-character preview holds it.
	const leaf = call("subagent", { name: `Leaf ${password}`, task: call("bash", { command: "sleep 6" }), profile: "scout", cognitiveRole: "routine", background: false });
	await prompt(host, call("worker_dispatch", { workerId, task: leaf, cognitiveRole: "coordination", background: true }));
	const id = launchedId(await toolResult(host, "worker_dispatch"));
	const stuck = (await host.until(isStuck, "the stuck notice")).message as Message;
	const body = textOf(stuck.content);
	assert.match(String((stuck.details as { preview?: string }).preview), /^\{"name":"Leaf \[REDACTED:env:PILOT_STUCK_PASSWORD\]"/, "the entry's data.preview");
	assert.ok(body.startsWith(`Child ${id} `) && body.includes('stuck inside one call: subagent `{"name":"Leaf [REDACTED:env:PILOT_STUCK_PASSWORD]"'), body);
	assert.match(body, /; it is a Worker blocked in a foreground subagent call on leaf \S+ "Leaf \[REDACTED/, body);
	for (const form of [password, escaped]) assert.ok(!body.includes(form), `the notice holds no ${form}`);
	await host.until((e) => isNotice(e) && textOf((e.message as Message).content).includes(`${id} [success]`), "the Worker's notice");
	await quiet(host);
	const delivered = JSON.stringify(customs((await host.call<Transcript>("transcript")).messages, "pi-workbench:child-stuck"));
	await host.close();
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		// The record holds the latest span's notice; every notice the lead got is in its transcript.
		const stored = JSON.stringify(e!.stuckNotice) + delivered;
		for (const form of [password, escaped, JSON.stringify(escaped).slice(1, -1)]) assert.ok(!stored.includes(form), `the stored notice holds no ${form}`);
	});
});

test("stuck notice: a foreground child still gets its update request but sends no stuck notice; its call already blocks the lead", async () => {
	const { store, cwd } = family("stuck-foreground");
	const host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "1000", PILOT_STUCK_GRACE_MS: "1000" });
	await host.ready;
	await prompt(host, call("subagent", scout(call("bash", { command: "sleep 5" }), { background: false })));
	await toolResult(host, "subagent");
	await quiet(host);
	assert.equal(customs((await host.call<Transcript>("transcript")).messages, "pi-workbench:child-stuck").length, 0, "no stuck notice for a foreground child");
	await host.close();
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		assert.ok(e!.steers >= 1 && e!.quietSteer !== undefined, "the quiet-report steer is unchanged");
		assert.equal(e!.stuckNotice, undefined);
	});
});

test("stuck notice: marked, then the child's cancellation begins before delivery: the notice is dropped", async () => {
	const { store, cwd } = family("stuck-cancel");
	// The notice's hold releases while the cancellation is held after its mark, before it aborts the reporter.
	const host = open(store, cwd, { PILOT_REPORT_QUIET_MS: "1000", PILOT_STUCK_GRACE_MS: "1000", PI_DURABLE_HOLD: "stuck:after-mark@3000,cancel:after-mark@4000" });
	await host.ready;
	await prompt(host, call("subagent", scout(call("bash", { command: "sleep 30" }))));
	const id = launchedId(await toolResult(host, "subagent"));
	await host.until((e) => e.type === "test.hold" && e.name === "stuck:after-mark", "the committed notice");
	const marked = Date.now();
	await quiet(host);
	await prompt(host, call("subagent_cancel", { executionId: id }));
	await host.until((e) => e.type === "test.hold" && e.name === "cancel:after-mark", "the committed cancellation");
	assert.ok(Date.now() - marked < 3000, "the cancellation was marked while the notice was held");
	await toolResult(host, "subagent_cancel");
	await quiet(host);
	assert.equal(customs((await host.call<Transcript>("transcript")).messages, "pi-workbench:child-stuck").length, 0, "a cancelled child's notice wakes nobody");
	await host.close();
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		assert.equal(e!.outcome, "cancelled");
		assert.equal(e!.stuckNotice?.seq, 1, "the notice was marked before the cancellation");
	});
});

test("children's bash: a call without timeout gets the default (1800 s, shortened here), an explicit one is kept; the lead's bash is unaffected", async () => {
	const { store, cwd } = family("child-bash-timeout");
	// Its own job root: Workbench bash job IDs (Chat and task) repeat across this file's Chats.
	const host = open(store, cwd, { PILOT_CHILD_BASH_TIMEOUT_S: "1", PI_BACKGROUND_BASH_ROOT: scratch("delegation-bash-jobs") });
	await host.ready;
	await prompt(host, call("bash", { command: "sleep 2; echo lead-ok > lead.txt", description: "Lead sleep", foreground: true }));
	await toolResult(host, "bash");
	await quiet(host);
	await prompt(host, call("subagent", scout(calls({ name: "bash", arguments: { command: "sleep 3; echo late" } }, { name: "bash", arguments: { command: "sleep 2; echo kept", timeout: 30 } }), { background: false })));
	await toolResult(host, "subagent");
	await quiet(host);
	await host.close();
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		const results = (await entries(h, e!.conversationId)).flatMap((entry) => {
			const m = entry.model?.[0] as (Message & { toolName?: string; isError?: boolean }) | undefined;
			return m?.toolName === "bash" ? [{ text: textOf(m.content), isError: m.isError === true }] : [];
		});
		assert.deepEqual(results.map((r) => r.isError), [true, false], JSON.stringify(results));
		assert.match(results[0]!.text, /Command timed out after 1 seconds/);
		assert.match(results[1]!.text, /kept/);
		const child = (await (await h.harness.conversation(e!.conversationId as ConversationId, context))!.agent(context)).tools.find((t) => t.name === "bash")!;
		assert.match(child.description, /without one the command times out after 1800 seconds\./);
		const lead = (await h.root.agent(context)).tools.find((t) => t.name === "bash")!;
		assert.doesNotMatch(lead.description, /1800/);
	});
	assert.equal(readFileSync(join(cwd, "lead.txt"), "utf8").trim(), "lead-ok", "the lead's bash has no child default");
});

// ─── compact_and_continue in a child (main 0bfd282, a2684e3) ─────────────────

test("a child that calls compact_and_continue settles with the continuation's answer and one receipt", async () => {
	const { store, cwd } = family("child-checkpoint");
	// Its own telemetry directory: execution IDs repeat across this file's Chats.
	const dir = scratch("delegation-checkpoint-telemetry");
	const host = open(store, cwd, { PI_TELEMETRY_DIR: dir });
	await host.ready;
	await host.call("configure", { resources: {}, compaction: { keepRecentTokens: 1 } });
	await prompt(host, call("subagent", scout(call("compact_and_continue", { summaryFocus: "child focus", nextPhase: "phase two" }), { background: false, name: "Checkpointer" })));
	const result = await toolResult(host, "subagent");
	assert.match(result, /^ok: Context checkpoint completed\.\n\nContinue with the requested next phase: phase two\n/, result);
	assert.equal(result.match(/Completion receipt: /g)?.length, 1, "one receipt");
	await quiet(host);
	await host.close();
	assert.ok(logged(store).some((l) => l.label === "summarize"), "the child's context was compacted");
	assert.ok(logged(store).find((l) => l.label.startsWith("call:compact_and_continue") && (l as { model?: string }).model !== undefined)?.tools?.includes("compact_and_continue"), "every child profile offers compact_and_continue");
	const events = readdirSync(dir).flatMap((file) => readFileSync(join(dir, file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>));
	assert.deepEqual(events.filter((event) => String(event.type).startsWith("execution.")).map((event) => event.type), ["execution.launched", "execution.settled"], "settled once");
});

// ─── Survival ────────────────────────────────────────────────────────────────

for (const window of ["before-admission", "after-result", "before-delivery", "after-delivery"] as const)
	test(`kill row child:${window}: one assignment, one report, collected exactly once after reopen; status reads launch nothing`, async () => {
		const { store, cwd } = family(`kill-${window}`);
		let host = open(store, cwd, { PI_DURABLE_HOLD: `child:${window}` });
		await host.ready;
		await prompt(host, call("subagent", scout("survivor")));
		await host.until((e) => e.type === "test.hold" && e.name === `child:${window}`, "the barrier");
		await host.kill();

		host = open(store, cwd);
		await host.ready;
		const requests = logged(store).length;
		await host.call("status");
		await host.call("transcript");
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(logged(store).length, requests, "reading a restored Chat sends nothing");
		// Any input resumes a paused restore. A credential read the killed host was in holds Pi's auth.json lock until its
		// 30 s stale period ends.
		await prompt(host, "resume");
		await host.until((e) => isNotice(e) && /ok: survivor/.test(textOf((e.message as Message).content)), "the carried result");
		await quiet(host, 90_000);
		const transcript = await host.call<Transcript>("transcript");
		assert.equal(childRequests(store, "survivor").length, 1, "the child was asked once");
		const wakes = customs(transcript.messages, "pi-workbench:child-completion");
		assert.equal(wakes.length, 1, "one wake");
		assert.match(textOf(wakes[0]!.content), /^Background children finished; their results follow and are already collected\.[\s\S]*\[success\]\nok: survivor/, "it carries the result");
		await prompt(host, call("subagent_collect", {}));
		assert.match(await toolResult(host, "subagent_collect"), /^Nothing terminal to reconcile\./, "the notice collected it");
		await quiet(host);
		await host.close();
		await inspect(store, cwd, async (h) => {
			assert.equal((await executions(h)).length, 1, "one child assignment");
			assert.deepEqual((await h.harness.inspect(context)).tasks.map((t) => t.record.kind), [], "no live tasks");
		});
		assert.equal(integrity(store), "ok");
	});

test("kill row collection: killed after collection committed, the rerun returns the same result once; nothing is lost or falsely read", async () => {
	const { store, cwd } = family("kill-collect");
	// The notice is held, so the lead's own collect reads the result.
	let host = open(store, cwd, { PI_DURABLE_HOLD: "child:before-delivery,collect:after-commit" });
	await host.ready;
	await prompt(host, call("subagent", scout("survivor")));
	await host.until((e) => e.type === "test.hold" && e.name === "child:before-delivery", "the result");
	await quiet(host);
	await prompt(host, call("subagent_collect", {}));
	await host.until((e) => e.type === "test.hold" && e.name === "collect:after-commit", "the barrier");
	await host.kill();
	host = open(store, cwd);
	await host.ready;
	await prompt(host, "resume");
	await host.until(() => host.events.filter(isTool("subagent_collect")).length >= 1, "the collect result");
	await quiet(host);
	const transcript = await host.call<Transcript>("transcript");
	const collects = transcript.messages.filter((m) => (m as { toolName?: string }).toolName === "subagent_collect").map((m) => textOf(m.content));
	assert.equal(collects.length, 1);
	assert.match(collects[0]!, /Reconciled 1 of 1[\s\S]*ok: survivor/, "the rerun returned what the first attempt marked read");
	assert.equal(customs(transcript.messages, "pi-workbench:child-completion").length, 0, "a collected result sends no notice");
	assert.equal(childRequests(store, "survivor").length, 1);
	await host.close();
});

test("kill row cancellation: a cancelled child's held reporter cannot revive it after reopen", async () => {
	const { store, cwd } = family("kill-cancel");
	let host = open(store, cwd, { PI_DURABLE_HOLD: "child:after-result" });
	await host.ready;
	await prompt(host, call("subagent", scout("survivor")));
	const id = launchedId(await toolResult(host, "subagent"));
	await host.until((e) => e.type === "test.hold" && e.name === "child:after-result", "the barrier");
	await quiet(host);
	await prompt(host, call("subagent_cancel", { executionId: id }));
	assert.equal(await toolResult(host, "subagent_cancel"), `${id}: cancelled.`);
	await quiet(host);
	await host.kill();
	host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent_status", { executionId: id }));
	assert.match(await toolResult(host, "subagent_status"), /\[cancelled, collected\]/);
	await quiet(host);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const transcript = await host.call<Transcript>("transcript");
	assert.equal(customs(transcript.messages, "pi-workbench:child-completion").length, 0, "no late wake");
	await host.close();
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		assert.equal(e!.outcome, "cancelled");
		assert.equal(e!.text, undefined, "no late result was recorded");
	});
});

test("kill row cancellation epoch: killed after the cancellation committed but before any abort, then Stop: the reporter records nothing and wakes nobody; the next prompt finishes the cancellation", async () => {
	const { store, cwd } = family("kill-cancel-mark");
	let host = open(store, cwd, { PI_DURABLE_HOLD: "child:after-result,cancel:after-mark" });
	await host.ready;
	await prompt(host, call("subagent", scout("survivor")));
	const id = launchedId(await toolResult(host, "subagent"));
	await host.until((e) => e.type === "test.hold" && e.name === "child:after-result", "the child's result");
	await quiet(host);
	await prompt(host, call("subagent_cancel", { executionId: id }));
	await host.until((e) => e.type === "test.hold" && e.name === "cancel:after-mark", "the committed cancellation");
	await host.kill();
	host = open(store, cwd);
	await host.ready;
	// Stop ends the interrupted cancel call (it never reruns) without resuming the paused reporter (paused restore: only
	// the owner's input resumes); the next prompt lets it run and finishes the cancellation.
	const requests = logged(store).length;
	await host.call("abort");
	await waitFor(() => false, "the reporter's chance to run", 2_500).catch(() => undefined);
	assert.equal(logged(store).length, requests, "Stop on a paused restore sends nothing");
	const mark = host.events.length;
	await prompt(host, "resume");
	await since(host, mark, (e) => e.type === "status.update" && (e.status as Status).extensionStatuses?.["pi-workbench:activity"] === undefined, "the cancellation to finish");
	await quiet(host, 90_000);
	assert.equal(customs((await host.call<Transcript>("transcript")).messages, "pi-workbench:child-completion").length, 0, "the late reporter woke nobody");
	await prompt(host, call("subagent_status", { executionId: id }));
	assert.match(await toolResult(host, "subagent_status"), /\[cancelled, collected\]/, "resuming finished the cancellation");
	await quiet(host);
	await host.close();
	await inspect(store, cwd, async (h) => {
		const [e] = await executions(h);
		assert.equal(e!.outcome, "cancelled");
		assert.equal(e!.text, undefined, "no late result was recorded");
	});
});

// ─── Redaction and the fork rule ─────────────────────────────────────────────

test("redaction: secrets in an assignment, a steer, a status report and a Worker scope are masked in every new place they are committed", async () => {
	const { store, cwd } = family("redaction");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("subagent", scout(calls({ name: "report_status", arguments: { status: `status ${SECRET}` } }, { name: "bash", arguments: { command: "sleep 2" } }), { name: `name ${SECRET}` })));
	const id = launchedId(await toolResult(host, "subagent"));
	await quiet(host);
	await prompt(host, call("subagent_steer", { executionId: id, message: `steer ${SECRET}`, requestUpdate: true }));
	await toolResult(host, "subagent_steer");
	await quiet(host);
	await prompt(host, call("tools_enable", { group: "workers" }));
	await quiet(host);
	await prompt(host, call("worker_create", { name: `w ${SECRET}`, scope: `scope ${SECRET}`, profile: "scout" }));
	await toolResult(host, "worker_create");
	await notice(host);
	await quiet(host);
	await host.close();
	await inspect(store, cwd, async (h) => {
		const records = JSON.stringify([await h.harness.snapshot(DelegationDoc, h.root.id, context), await h.harness.snapshot(WorkersDoc, context)]);
		const [e] = await executions(h);
		const child = JSON.stringify(await entries(h, e!.conversationId));
		const delivered = JSON.stringify((await entries(h, h.root.id)).filter((entry) => entry.kind.startsWith("workbench.child")));
		assert.ok(!records.includes(SECRET), "delegation and Worker records are redacted");
		assert.ok(!child.includes(SECRET), "the child's assignment and steer are redacted");
		assert.ok(!delivered.includes(SECRET), "wake and update messages are redacted");
		assert.ok(records.includes("status ") && child.includes("steer "), "the surrounding text is kept");
	});
});

const REDACTED = "[REDACTED:env:PILOT_DELEGATION_TOKEN]";
/** Stored entries of a conversation as JSON, without the assistant's tool calls (their arguments are kept verbatim). */
const nonCallEntries = (list: readonly EntryRecord[]) => JSON.stringify(list.filter((entry) => (entry.model?.[0] as { role?: string } | undefined)?.role !== "assistant"));

test("redaction: a delegation tool's preflight and resolver failures mask a secret in their output, details, stored result and events", async () => {
	const { store, cwd } = family("redaction-preflight");
	const host = open(store, cwd);
	await host.ready;
	// The prompts name the secret only \u-escaped: the model's calls hold it, as a real model's would.
	await prompt(host, hideIn(call("subagent", scout("review it", { cognitiveRole: "review", profile: "reviewer", background: false, independentOfModel: SECRET })), SECRET));
	const invalid = await toolResult(host, "subagent");
	await quiet(host);
	await prompt(host, hideIn(call("subagent", scout("x", { background: false, modelOverride: `anthropic/${SECRET}` })), SECRET));
	const resolver = await toolResult(host, "subagent", 2);
	await quiet(host);
	await host.close();
	const prefix = SECRET.slice(0, 12);
	assert.equal(invalid, `preflight_failed: independentOfModel must be '<provider>/<model>', got '${REDACTED}'.`);
	assert.match(resolver, /^preflight_failed: Routing resolver failed[\s\S]*anthropic\/\[REDACTED:env:PILOT_DELEGATION_TOKEN\]/, "the resolver's diagnostic keeps its text around the mask");
	assert.ok(!resolver.includes(prefix));
	assert.ok(!eventCopies(host.events).includes(prefix), "no browser event other than the calls carries the secret or its prefix");
	await inspect(store, cwd, async (h) => {
		const all = await entries(h, h.root.id);
		assert.ok(JSON.stringify(all).includes(SECRET), "positive control: the model's calls hold the complete secret");
		const results = nonCallEntries(all);
		assert.ok(results.includes("preflight_failed") && !results.includes(prefix), "the committed tool results and details hold neither the secret nor its prefix");
	});
});

test("redaction: a secret across the task-preview and label cutoffs leaves no fragment in the execution, the roster or subagent_status", async () => {
	const { store, cwd } = family("redaction-preview");
	// Children answer, then hold before their result commits: they stay running, so the roster shows them.
	const host = open(store, cwd, { PI_DURABLE_HOLD: "child:after-result" });
	await host.ready;
	// The 200-character preview cut and the 40-character label cut each fall inside the secret.
	const preview = `${"p".repeat(190)} ${SECRET}`;
	const label = `${"n".repeat(30)} ${SECRET}`;
	await prompt(host, call("subagent", scout(preview, { name: label })));
	await prompt(host, call("subagent", scout(label)));
	// Positive control: a complete secret inside both bounds is masked whole.
	await prompt(host, call("subagent", scout(`whole ${SECRET} task`, { name: `w ${SECRET}` })));
	await host.until(() => host.events.filter((e) => e.type === "test.hold").length >= 3, "three children holding");
	await quiet(host);
	const roster = (await host.call<Status>("status")).extensionStatuses?.["pi-workbench:activity"] ?? "";
	await prompt(host, call("subagent_status", {}));
	const status = await toolResult(host, "subagent_status");
	await host.kill();
	// What each cut would leave: the secret's first 9 characters.
	const fragment = SECRET.slice(0, 9);
	assert.equal((JSON.parse(roster) as { items: unknown[] }).items.length, 3, "the roster shows the three children");
	assert.ok(!roster.includes(fragment), `no fragment in the roster: ${roster}`);
	assert.ok(!status.includes(fragment), `no fragment in subagent_status: ${status}`);
	assert.ok(status.includes(`whole ${REDACTED} task`), "the complete secret is masked whole");
	await inspect(store, cwd, async (h) => {
		const list = await executions(h);
		const shown = JSON.stringify(list.map((e) => [e.name, e.taskPreview]));
		assert.ok(!shown.includes(fragment), `no fragment in a stored name or preview: ${shown}`);
		assert.deepEqual(list.map((e) => e.name).sort(), [`${"n".repeat(30)} [REDACTED`, `${"n".repeat(30)} [REDACTED`, `w ${REDACTED}`].sort());
		assert.ok(list.some((e) => e.taskPreview.startsWith(`${"p".repeat(190)} [REDACTED`)), "the preview is cut after masking");
	});
});

test("fork rule: a fork of the lead gets no children and no control of the source's Workers", async () => {
	const { store, cwd } = family("fork");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, call("tools_enable", { group: "workers" }));
	await quiet(host);
	await prompt(host, call("worker_create", { name: "W", scope: "s", profile: "scout" }));
	const workerId = /Created worker (\S+)/.exec(await toolResult(host, "worker_create"))![1]!;
	await quiet(host);
	await prompt(host, call("subagent", scout("before fork", { background: false })));
	await toolResult(host, "subagent");
	await quiet(host);
	await host.close();
	writeFileSync(QUOTA, JSON.stringify({ version: 1, checkedAt: Date.now(), status: 0, stdout: JSON.stringify({ providers: [] }), stderr: "" }));
	const h = await openChatHost({ dir: store, cwd, model: "faux", chatId: CHAT, scriptedProviders: true });
	try {
		await h.resume();
		const last = (await h.root.entries({}, 1, undefined, context)).items[0]!;
		const fork = await h.root.fork(last.id, { ownership: { kind: "ownerless" } }, context);
		assert.deepEqual(await executions(h, fork.id), [], "the fork starts without the source's children");
		const submission = await fork.submit({ type: "input", content: call("worker_dispatch", { workerId, task: "x", cognitiveRole: "routine" }), requestId: "fork-1" }, context);
		await submission.wait(context);
		const results = (await fork.entries({ order: "ascending" }, 100, undefined, context)).items.map((entry) => entry.model?.[0] as { role?: string; content?: unknown; toolName?: string } | undefined);
		const refused = results.filter((m) => m?.toolName === "worker_dispatch").map((m) => textOf(m!.content)).at(-1);
		assert.match(refused ?? "", /^preflight_failed: Worker \S+ belongs to another lead Chat/);
	} finally {
		await h.close();
	}
});

// ─── With history navigation (slice 4 group C) ───────────────────────────────

type TreeNode = { id: string; message?: { role: string; content?: unknown } };
type HistoryTree = { type: "tree"; nodes: TreeNode[]; activeLeafId: string | null };
const treeNode = (t: HistoryTree, role: string, text: string) => t.nodes.find((n) => n.message?.role === role && textOf(n.message.content) === text) ?? assert.fail(`${role} node ${text}`);
const BUSY = /Stop current session activity before navigating the session tree/;

test("navigation: refused while a background child runs, allowed once it is collected; the branch gets its own roster", async () => {
	const { store, cwd } = family("nav-child");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, "first");
	await quiet(host);
	await prompt(host, call("subagent", scout('call:bash {"command":"sleep 3"}', { name: "Slow" })));
	launchedId(await toolResult(host, "subagent"));
	await host.until((e) => e.type === "agent.end", "the launching turn");
	await quiet(host);
	const running = await host.call<HistoryTree | { type: "unsupported" }>("tree");
	assert.equal(running.type, "tree", "/tree reads the tree while a child runs");
	await assert.rejects(host.call("navigate", { targetId: "1", expectedLeafId: null }), BUSY, "navigation is refused while a background child runs");
	await notice(host);
	await quiet(host);
	const ready = await host.call<HistoryTree>("tree");
	assert.equal(ready.type, "tree", "collected: the Chat is quiescent");
	await host.call("navigate", { targetId: treeNode(ready, "assistant", "ok: first").id, expectedLeafId: ready.activeLeafId });
	await host.until((e) => e.type === "session.tree.changed", "the branch switch");

	// On the branch, a launch reaches the browser's roster through the new branch's watch.
	const mark = host.events.length;
	await prompt(host, call("subagent", scout(calls({ name: "report_status", arguments: { status: "On the branch" } }, { name: "bash", arguments: { command: "sleep 1.5" } }), { name: "Brancher" })));
	await since(host, mark, (e) => e.type === "status.update" && ((e.status as Status).extensionStatuses?.["pi-workbench:activity"] ?? "").includes("On the branch"), "the branch child's roster row");
	await since(host, mark, isNotice, "the branch child's notice");
	await quiet(host);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("navigation: refused while a finished background result waits to be collected", async () => {
	const { store, cwd } = family("nav-uncollected");
	const h = await openChatHost({ dir: store, cwd, model: "faux", chatId: CHAT });
	const { ChatSession } = await import("../src/chat-session.ts");
	const session = new ChatSession(h, () => {});
	await session.start();
	try {
		await h.root.commit(async (tx) => {
			(await tx.doc(DelegationDoc, h.root.id)).executions.x = { executionId: "x", outcome: "success", background: true, collected: false } as unknown as Execution;
		}, context);
		await assert.rejects(session.navigate({ targetId: "1", expectedLeafId: null }), /Collect the finished Subagents and Workers before navigating the session tree/);
		await h.root.commit(async (tx) => {
			(await tx.doc(DelegationDoc, h.root.id)).executions.x!.collected = true;
		}, context);
		await assert.rejects(session.navigate({ targetId: "1", expectedLeafId: null }), (error: Error) => !/Collect|Stop current/.test(error.message), "collected: quiescence no longer refuses");
	} finally {
		await session.close();
	}
});

test("navigation: the Chat keeps control of its Workers on another branch (a fork outside the branch map gets none: the fork rule test above)", async () => {
	const { store, cwd } = family("nav-worker");
	const host = open(store, cwd);
	await host.ready;
	await prompt(host, "first");
	await quiet(host);
	await prompt(host, call("tools_enable", { group: "workers" }));
	await quiet(host);
	await prompt(host, call("worker_create", { name: "W", scope: "s", profile: "scout" }));
	const workerId = /Created worker (\S+)/.exec(await toolResult(host, "worker_create"))![1]!;
	await quiet(host);
	const t = await host.call<HistoryTree>("tree");
	await host.call("navigate", { targetId: treeNode(t, "assistant", "ok: first").id, expectedLeafId: t.activeLeafId });
	await host.until((e) => e.type === "session.tree.changed", "the branch switch");
	await prompt(host, call("tools_enable", { group: "workers" }));
	await quiet(host);
	await prompt(host, call("worker_status", {}));
	assert.match(await toolResult(host, "worker_status"), new RegExp(`^- ${workerId} "W" \\(scout\\) \\[idle\\]`), "the branch lists the Chat's Worker as its own");
	await quiet(host);
	await prompt(host, call("worker_dispatch", { workerId, task: "on the branch", cognitiveRole: "routine" }));
	assert.match(await toolResult(host, "worker_dispatch"), /^ok: on the branch/, "the branch dispatches the Chat's Worker");
	await quiet(host);
	await host.close();
});

test("P101 telemetry lineage: a child conversation starts its own telemetry session naming the lead, so the lead's report includes its usage", async () => {
	const { store, cwd } = family("telemetry-lineage");
	// Its own telemetry directory: the other tests share this file's directory and Chat ID.
	const dir = scratch("delegation-lineage-telemetry");
	const host = open(store, cwd, { PI_TELEMETRY_DIR: dir });
	await host.ready;
	await prompt(host, call("subagent", scout("lineage child", { background: false })));
	await toolResult(host, "subagent");
	await quiet(host);
	await host.close();
	const events = readdirSync(dir).flatMap((file) => readFileSync(join(dir, file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>));
	const launched = events.filter((event) => event.type === "execution.launched");
	assert.equal(launched.length, 1, "the launch is recorded");
	assert.equal(launched[0]!.sessionId, CHAT);
	const starts = events.filter((event) => event.type === "session.start" && event.sessionId === launched[0]!.childSessionId);
	assert.equal(starts.length, 1, "one session.start for the child");
	assert.equal(starts[0]!.parentSessionId, CHAT, "its parent is the Durable lead");
	assert.equal(starts[0]!.executionId, launched[0]!.executionId);
	assert.ok(events.some((event) => event.type === "usage" && event.sessionId === launched[0]!.childSessionId), "the child's usage is under its session ID");
	const { buildReport } = await import("../../../extensions/telemetry/telemetry.mjs");
	const report = buildReport(events, { rootSessionId: CHAT }) as { sessionIds: string[] };
	assert.deepEqual(report.sessionIds, [CHAT, String(launched[0]!.childSessionId)].sort(), "the lead's report reaches the child");
});
