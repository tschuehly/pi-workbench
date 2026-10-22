// Phase B slice 4 group C: history navigation of a Durable Chat (legacy `/tree` and "Go back to this message"),
// against the real host process and scripted model. Navigating selects a retained branch or forks a conversation in
// the same family store; later history is never erased, the branch map survives a kill, navigation is quiescent and
// revision-checked, and Working Mode, questions and tool groups are those of the branch point.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fastMode } from "../src/providers.ts";
import { router } from "../src/faux.ts";
import { ChatSession } from "../src/chat-session.ts";
import { context, MODEL, openHost } from "../src/host.ts";
import { toolGroupsExtension } from "../src/tool-groups.ts";
import { QuestionsDoc } from "../src/workbench.ts";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { ChatHost, family, idle, integrity, live, logged, type Message, type Status, textOf, type Transcript } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

process.env.PI_TELEMETRY_DIR = scratch("tree-telemetry");
process.env.ATELIER_PAGE_CHECK = "off";

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

type Node = { id: string; parentId: string | null; type: string; message?: { role: string; content?: unknown; toolName?: string }; customType?: string };
type Tree = { type: "tree"; nodes: Node[]; activeLeafId: string | null };
type Asked = Status & { pendingAsks?: { askId: string; revision: string }[] };

const shown = (messages: readonly Message[]) =>
	messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => `${m.role}:${textOf(m.content)}`);
const transcript = async (host: ChatHost) => shown((await host.call<Transcript>("transcript")).messages);
const tree = (host: ChatHost) => host.call<Tree>("tree");
/** The node of a user or assistant message with this text. */
const node = (t: Tree, role: string, text: string) => {
	const found = t.nodes.find((n) => n.message?.role === role && textOf(n.message.content) === text);
	assert.ok(found, `${role} node ${text}`);
	return found;
};
const navigate = (host: ChatHost, t: Tree, targetId: string, retainCheckpoint?: boolean) =>
	host.call<{ editorText?: string }>("navigate", { targetId, expectedLeafId: t.activeLeafId, ...(retainCheckpoint === undefined ? {} : { retainCheckpoint }) });

test("tree: going back keeps later history, forks once, reselects a retained branch, and the branch map survives a kill", async () => {
	const { store, cwd } = family("tree");
	let host = new ChatHost(store, cwd);
	await host.ready;
	assert.ok(((await host.ready) as { capabilities?: string[] }).capabilities?.includes("tree"), "the host reports tree navigation");
	await host.call("prompt", { operationId: "op-1", text: "first" });
	await idle(host, 1);
	await host.call("prompt", { operationId: "op-2", text: "second" });
	await idle(host, 2);

	let t = await tree(host);
	assert.equal(t.activeLeafId, node(t, "assistant", "ok: second").id);
	assert.deepEqual(t.nodes.map((n) => n.message?.role ?? n.type), ["user", "assistant", "user", "assistant"], "one node per visible entry");
	assert.equal(node(t, "user", "second").parentId, node(t, "assistant", "ok: first").id);

	// Back to the second prompt: the Chat continues from before it, and its text returns to the editor.
	const back = await navigate(host, t, node(t, "user", "second").id, true);
	assert.deepEqual(back, { editorText: "second" });
	assert.deepEqual(await transcript(host), ["user:first", "assistant:ok: first"]);
	await host.until((e) => e.type === "session.tree.changed", "the tree change");
	await assert.rejects(navigate(host, t, node(t, "user", "first").id), /The session changed since \/tree was opened/, "a stale leaf is refused");

	await host.call("prompt", { operationId: "op-3", text: "second v2" });
	await idle(host, 3);
	t = await tree(host);
	assert.deepEqual(await transcript(host), ["user:first", "assistant:ok: first", "user:second v2", "assistant:ok: second v2"]);
	const forkPoint = node(t, "assistant", "ok: first").id;
	assert.deepEqual(t.nodes.filter((n) => n.parentId === forkPoint).map((n) => textOf(n.message?.content)), ["second", "second v2"], "the old branch is retained beside the new one");
	assert.equal(t.nodes.length, 6);
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	assert.deepEqual(await transcript(host), ["user:first", "assistant:ok: first", "user:second v2", "assistant:ok: second v2"], "the selected branch survives the kill");
	t = await tree(host);
	assert.equal(t.nodes.length, 6, "both branches survive the kill");

	// Selecting the old leaf reselects its retained branch: no new conversation, no duplicate history.
	assert.deepEqual(await navigate(host, t, node(t, "assistant", "ok: second").id), {});
	assert.deepEqual(await transcript(host), ["user:first", "assistant:ok: first", "user:second", "assistant:ok: second"]);
	t = await tree(host);
	assert.equal(t.nodes.length, 6);
	assert.equal(t.activeLeafId, node(t, "assistant", "ok: second").id);

	// Back to the very first prompt: an empty branch, the prompt in the editor; continuing starts fresh.
	assert.deepEqual(await navigate(host, t, node(t, "user", "first").id, true), { editorText: "first" });
	assert.deepEqual(await transcript(host), []);
	await host.call("prompt", { operationId: "op-4", text: "fresh start" });
	await idle(host, 1);
	assert.deepEqual(await transcript(host), ["user:fresh start", "assistant:ok: fresh start"]);
	assert.equal(logged(store).at(-1)?.messages, 1, "the model saw only the new prompt");
	t = await tree(host);
	assert.equal(t.nodes.length, 8);
	assert.deepEqual(t.nodes.filter((n) => n.parentId === null).map((n) => textOf(n.message?.content)), ["first", "fresh start"]);
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	assert.deepEqual(await transcript(host), ["user:fresh start", "assistant:ok: fresh start"]);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("tree: navigation is refused visibly while a turn, queued input or interrupted work is pending", async () => {
	const { store, cwd } = family("tree-quiet");
	let host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: "first" });
	await idle(host, 1);
	const t = await tree(host);
	// A real unsafe call held mid-effect: write into a FIFO blocks until a reader comes.
	execFileSync("mkfifo", [join(cwd, "effect.fifo")]);
	await host.call("prompt", { operationId: "op-run", text: 'call:write {"path":"effect.fifo","content":"x"}' });
	await host.until((e) => e.type === "tool.start" && e.toolName === "write", "the held write");
	await host.call("prompt", { operationId: "op-q", text: "queued" });
	assert.deepEqual(await host.call("tree"), { type: "unsupported", message: "Cannot open the session tree while the session is active. Stop current activity and try /tree again." });
	await assert.rejects(navigate(host, t, node(t, "user", "first").id), /Stop current session activity before navigating the session tree/);
	await host.kill();

	// Reopened with an interrupted unsafe call: navigating away must not leave it unresolved on a hidden branch.
	host = new ChatHost(store, cwd);
	await host.ready;
	await assert.rejects(navigate(host, t, node(t, "user", "first").id), /Stop current session activity|Resolve the interrupted/);
	assert.deepEqual((await transcript(host)).slice(0, 2), ["user:first", "assistant:ok: first"], "nothing moved");
	await host.close();
});

test("tree: a running background bash job and an Atelier Page move with the active branch, as legacy keeps them with the session", async () => {
	const { store, cwd } = family("tree-carry");
	writeFileSync(join(cwd, "page.html"), "<!doctype html><title>t</title><div atl-key='a' atl-ver='1'>A</div>");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: "first" });
	await idle(host, 1);
	await host.call("prompt", { operationId: "op-groups", text: 'call:tools_enable {"group":"atelier"}' });
	await idle(host, 2);
	await host.call("prompt", { operationId: "op-open", text: 'call:atelier {"action":"open","page":"page.html"}' });
	const opened = await host.until((e) => e.type === "tool.end" && e.toolName === "atelier", "the Page");
	const url = /Page open: (http:\/\/127\.0\.0\.1:\d+)\//.exec(String(opened.text))?.[1] ?? assert.fail(String(opened.text));
	await idle(host, 3);
	await host.call("prompt", { operationId: "op-job", text: `call:bash ${JSON.stringify({ description: "Wait for the flag", command: "while [ ! -e flag ]; do sleep 0.1; done; echo carried-output" })}` });
	await idle(host, 4);
	// Human input still inside its undo window: undelivered when navigation starts.
	const comment = await fetch(`${url}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "comment", key: "a", text: "carried comment" }) });
	assert.equal(comment.status, 200);
	const t = await tree(host);
	assert.deepEqual(await navigate(host, t, node(t, "assistant", "ok: first").id), {}, "neither blocks navigation (legacy)");
	writeFileSync(join(cwd, "flag"), "");
	// Both deliveries and their answers on the active branch: read for a bounded time (red when lost, not a hang).
	let messages: Message[] = [];
	for (let tries = 0; tries < 200; tries += 1) {
		messages = (await host.call<Transcript>("transcript")).messages;
		if (messages.filter((m) => m.role === "assistant").length >= 3) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.deepEqual(shown(messages).slice(0, 2), ["user:first", "assistant:ok: first"], "the new branch");
	assert.equal(messages.some((m) => m.role === "toolResult"), false, "the new branch starts after the first answer");
	assert.match(textOf(messages.find((m) => m.customType === "background-bash")?.content), /carried-output/, "the completion reached the active branch");
	assert.match(textOf(messages.find((m) => m.customType === "atelier:immediate")?.content), /carried comment/, "the human input reached the active branch");
	await host.call("prompt", { operationId: "op-status", text: 'call:bash_status {}' });
	const status = await host.until((e) => e.type === "tool.end" && e.toolName === "bash_status", "bash_status");
	assert.match(String(status.text), /"state":"complete"/, "the branch owns the carried job");
	await host.close();
	assert.equal(integrity(store), "ok");
});

const ASK = {
	context: "The deploy target is ambiguous.",
	questions: [{ id: "target", question: "Which target?", options: [{ value: "prod", label: "Production" }, { value: "staging", label: "Staging" }] }],
};
const answered = (askId: string) => ({
	askId, reason: "submitted", askedAt: "", closedAt: "", context: ASK.context,
	questions: [{ question: ASK.questions[0], answered: true, values: ["staging"] }],
	answeredCount: 1, unansweredIds: [], summary: "Answered 1 of 1; none left unanswered",
});
const mode = (status: Status) => JSON.parse(status.extensionStatuses?.["working-mode"] ?? "null") as { selected: Record<string, string> };

test("tree: questions and Working Mode are those of the branch point; each branch keeps its own after a kill", async () => {
	const { store, cwd } = family("tree-asks");
	let host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("mode", { args: "attention focused" });
	await host.call("prompt", { operationId: "op-ask", text: `call:ask_user ${JSON.stringify(ASK)}` });
	const opened = (await host.until((e) => e.type === "ask.opened", "the ask")) as unknown as { ask: { askId: string; revision: string } };
	await idle(host, 1);
	const closed = await host.call<{ result: string }>("closeAsk", { askId: opened.ask.askId, revision: opened.ask.revision, operationId: "op-a1", outcome: answered(opened.ask.askId), content: "Answers: target staging" });
	assert.equal(closed.result, "closed");
	await idle(host, 2);
	await host.call("mode", { args: "attention afk" });
	await host.call("prompt", { operationId: "op-later", text: "later" });
	await idle(host, 3);
	assert.equal((await host.call<Asked>("status")).pendingAsks, undefined);

	// Back to the question: it is open again on the new branch, and Working Mode is as of that point.
	let t = await tree(host);
	const question = t.nodes.find((n) => n.message?.role === "toolResult" && n.message.toolName === "ask_user")!;
	assert.deepEqual(await navigate(host, t, question.id, true), {});
	let status = await host.call<Asked>("status");
	assert.deepEqual(status.pendingAsks?.map((a) => a.askId), [opened.ask.askId], "the branch's question returns");
	assert.equal(mode(status).selected.attention, "Focused", "Working Mode as of the branch point");
	assert.ok(host.events.some((e) => e.type === "ask.opened" && (e.ask as { askId: string }).askId === opened.ask.askId && host.events.indexOf(e) > host.events.findIndex((x) => x.type === "session.tree.changed")));
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	status = await host.call<Asked>("status");
	assert.deepEqual(status.pendingAsks?.map((a) => a.askId), [opened.ask.askId], "the reopened question survives a kill");
	// Answer it here: delivered once, on this branch.
	assert.equal((await host.call<{ result: string }>("closeAsk", { askId: opened.ask.askId, revision: status.pendingAsks![0]!.revision, operationId: "op-a2", outcome: answered(opened.ask.askId), content: "Answers: target prod" })).result, "closed");
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content).startsWith("done") === false && (e.message as { role?: string }).role === "assistant", "the answer turn");
	await idle(host, 1);
	assert.equal(logged(store).filter((l) => l.label.startsWith("Answers: target prod")).length, 1);

	// The old branch keeps its own state: no open question, its later Working Mode.
	t = await tree(host);
	await navigate(host, t, node(t, "assistant", "ok: later").id);
	status = await host.call<Asked>("status");
	assert.equal(status.pendingAsks, undefined);
	assert.equal(mode(status).selected.attention, "AFK");
	assert.ok(host.events.some((e) => e.type === "ask.closed" && e.askId === opened.ask.askId), "the left branch's open set closes for the browser");
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("redaction: questions a branch reopens are committed sanitized, though the set they copy came verbatim from tool-call arguments", async () => {
	const { store, cwd } = family("tree-secret");
	const secret = `ghp_${"Br4nchQu3st10nT0k3n".repeat(2)}`;
	const ask = { ...ASK, questions: [{ ...ASK.questions[0]!, question: `Rotate ${secret}?` }] };
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-ask", text: `call:ask_user ${JSON.stringify(ask)}` });
	await idle(host, 1);
	await host.call("prompt", { operationId: "op-later", text: "later" });
	await idle(host, 2);
	const t = await tree(host);
	await navigate(host, t, t.nodes.find((n) => n.message?.toolName === "ask_user")!.id, true);
	const reopened = (await host.call<{ pendingAsks?: { questions: { question: string }[] }[] }>("status")).pendingAsks;
	assert.match(reopened?.[0]?.questions[0]?.question ?? "", /^Rotate \[REDACTED:github-token\]\?$/);
	await host.close();
	const h = await openHost(store);
	try {
		const source = JSON.stringify(await h.harness.snapshot(QuestionsDoc, (await h.harness.root(context)).id, context));
		assert.ok(source.includes(secret), "positive control: the source branch's set holds the verbatim secret");
		const copy = JSON.stringify(await h.harness.snapshot(QuestionsDoc, h.root.id, context));
		assert.ok(copy.includes("Rotate"), "the branch has its own copy");
		assert.ok(!copy.includes(secret), "the branch's copy holds no plaintext");
	} finally {
		await h.close();
	}
});

// ─── Tool groups (in process: the Chat host registers no group tools) ───────

const groupExtensions = [defineExtension({
	name: "workbench.workers",
	tools: ["worker_create", "worker_status"].map((name) => defineTool({ name, description: name, parameters: Type.Object({}), execute: async () => ({ output: [{ type: "text" as const, text: name }] }) })),
})];

test("tree: tool-group exposure is that of the branch point", async () => {
	const dir = scratch("tree-groups");
	const h = await openHost(join(dir, "family"), { rootAgent: { model: MODEL }, extensions: [...groupExtensions, toolGroupsExtension(groupExtensions)] });
	const step = router(dir);
	h.faux.setResponses(Array.from({ length: 50 }, () => step));
	const chat = Object.assign(h, { workbench: { resources: {}, onSignal: () => {}, compaction: {}, extensions: groupExtensions }, listenPackages: () => {}, fast: fastMode(dir) });
	const session = new ChatSession(chat as never, () => {});
	await session.start();
	const settle = async (op: string, text: string) => {
		await session.prompt({ operationId: op, text });
		const record = await h.root.commit((tx) => tx.submissionByRequest(h.root.id, op), context);
		await (await h.harness.submission(record!.id, context))!.wait(context);
	};
	const offered = (label: string) => (logged(dir).filter((l) => l.label === label).at(-1)?.tools ?? []).filter((t) => t.startsWith("worker_"));
	await settle("op-1", "before");
	await settle("op-2", 'call:tools_enable {"group":"workers"}');
	await settle("op-3", "after");
	assert.deepEqual(offered("after"), ["worker_create", "worker_status"]);
	const t = (await session.tree()) as Tree;
	await session.navigate({ targetId: node(t, "assistant", "ok: before").id, expectedLeafId: t.activeLeafId });
	await settle("op-4", "on the branch");
	assert.deepEqual(offered("on the branch"), [], "the branch point had no workers group");
	const t2 = (await session.tree()) as Tree;
	await session.navigate({ targetId: node(t2, "assistant", "ok: after").id, expectedLeafId: t2.activeLeafId });
	await settle("op-5", "back on the old branch");
	assert.deepEqual(offered("back on the old branch"), ["worker_create", "worker_status"]);
	await session.close();
});

