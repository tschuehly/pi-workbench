// Phase B slice 3 group B (context and tools) against the real Durable Chat host process and scripted model:
// compaction (manual, automatic, kill during compaction, Working Mode re-attachment), `compact_and_continue`, tool
// groups and MCP. Barriers are events or files the host wrote after the relevant commit.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { CompactionEntry } from "@earendil-works/pi-durable";
import { ChatSession } from "../src/chat-session.ts";
import { admit, context, type Host, openHost } from "../src/host.ts";
import { entriesOf } from "../src/pilot.ts";
import { ChatHost, family, integrity, live, logged, type Message, type Status, textOf, type Transcript, waitFor } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

process.env.PI_TELEMETRY_DIR = scratch("context-telemetry");
// Hosts read Pi's agent directory (auth.json, mcp.json): an empty one here, never the owner's.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(scratch("context-agent"), "agent-"));
const SECRET = "contextSummarySecret-4f1e9a2b7c6d0e83";
process.env.PILOT_CONTEXT_TOKEN = SECRET;

function scan(paths: readonly string[], needles: readonly string[]): string[] {
	const found: string[] = [];
	const visit = (path: string) => {
		if (statSync(path).isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
		else for (const needle of needles) if (readFileSync(path).includes(needle)) found.push(`${path}:${needle}`);
	};
	for (const path of paths) visit(path);
	return found;
}

async function settle(h: Host, operationId: string, text: string): Promise<void> {
	await admit(h.root, { operationId, text });
	const record = await h.root.commit((tx) => tx.submissionByRequest(h.root.id, operationId), context);
	await (await h.harness.submission(record!.id, context))!.wait(context);
}

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

const compactions = (messages: readonly Message[]) => messages.filter((m) => m.source === "compaction");
const users = (messages: readonly Message[]) => messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
/** Keep only the newest turn verbatim, so a short scripted Chat has something to compact. */
const SMALL = { compaction: { keepRecentTokens: 1 } };

// ─── Compaction ──────────────────────────────────────────────────────────────

test("/compact with instructions: one summary placed, full history kept around it, the Working Mode block re-attached on the next prompt", async () => {
	const { store, cwd } = family("compact");
	let host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("configure", { resources: {}, ...SMALL });
	await host.call("mode", { args: "attention focused" });
	await host.call("prompt", { operationId: "op-1", text: "hello" });
	await host.idle(1);
	await host.call("prompt", { operationId: "op-2", text: "second" });
	await host.idle(2);
	assert.deepEqual(await host.call("compact", { instructions: "Keep the test names" }), { type: "done" });
	const appended = await host.until((e) => e.type === "message.end" && (e.message as Message).source === "compaction", "the summary row");
	assert.match(textOf((appended.message as Message).content), /^Compacted history:\n\nSummary of \d+ earlier messages\.$/);
	await host.until((e) => e.type === "status.update" && (e.status as Status).isCompacting === false, "compaction to end");
	assert.equal(logged(store).filter((l) => l.label === "summarize").length, 1);
	assert.equal(logged(store).find((l) => l.label === "summarize")?.focus, "Keep the test names", "the instructions reach the summarizer");

	await host.call("prompt", { operationId: "op-3", text: "after" });
	await host.idle(3);
	assert.deepEqual(logged(store).filter((l) => l.label !== "summarize").map((l) => [l.label, l.workingMode]), [["hello", 1], ["second", undefined], ["after", 2]], "compaction summarized the block away; the next prompt carries it again");
	await host.close();

	host = new ChatHost(store, cwd);
	await host.ready;
	const transcript = await host.call<Transcript>("transcript");
	assert.deepEqual(users(transcript.messages), ["hello", "second", "after"], "a reopened Chat still shows the history before the summary");
	assert.equal(compactions(transcript.messages).length, 1);
	assert.ok(transcript.messages.indexOf(compactions(transcript.messages)[0]!) > transcript.messages.findIndex((m) => textOf(m.content) === "ok: second"));
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("/compact with nothing to compact says so instead of failing silently", async () => {
	const { store, cwd } = family("compact-empty");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("compact", {});
	const output = await host.until((e) => e.type === "command.output", "the outcome");
	assert.equal(output.message, "Nothing to compact yet.");
	await host.close();
});

test("automatic compaction: above Pi's threshold the next request waits for one summary, then goes ahead", async () => {
	const { store, cwd } = family("compact-auto");
	const host = new ChatHost(store, cwd);
	await host.ready;
	// faux-1 has a 128k window: a threshold of 400 tokens, as Pi's reserveTokens would set it for a small window.
	await host.call("configure", { resources: {}, compaction: { modelOverrides: { "faux/faux-1": { reserveTokens: 128_000 - 400, keepRecentTokens: 1 } } } });
	await host.call("prompt", { operationId: "op-1", text: "gen" });
	await host.idle(1);
	await host.call("prompt", { operationId: "op-2", text: "gen" });
	await host.idle(2);
	await host.call("prompt", { operationId: "op-3", text: "third" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === "ok: third", "the third answer");
	assert.ok(host.events.some((e) => e.type === "status.update" && (e.status as Status).isCompacting), "the Chat showed it was compacting");
	const labels = logged(store).map((l) => l.label);
	assert.deepEqual(labels.filter((l) => l !== "summarize"), ["gen", "gen", "third"], "every input answered once");
	assert.ok(labels.includes("summarize") && labels.at(-1) === "third", `a summary before the request that needed it: ${labels.join(",")}`);
	const transcript = await host.call<Transcript>("transcript");
	assert.equal(compactions(transcript.messages).length, labels.filter((l) => l === "summarize").length, "one placed summary per summary request");
	await host.close();
});

test("crash row compaction: a kill while summarizing restores paused; sending reruns the summary once and places one summary", async () => {
	const { store, cwd } = family("compact-kill");
	let host = new ChatHost(store, cwd, { tps: 40 });
	await host.ready;
	await host.call("configure", { resources: {}, ...SMALL });
	for (const [n, text] of ["one", "two"].entries()) {
		await host.call("prompt", { operationId: `op-${n}`, text });
		await host.idle(n + 1);
	}
	await host.call("compact", { instructions: "slow" });
	await waitFor(() => logged(store).some((l) => l.label === "summarize"), "the summary request");
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("configure", { resources: {}, ...SMALL });
	const paused = await host.call<Status>("status");
	assert.equal(paused.isCompacting, true, "the interrupted compaction is still shown");
	assert.ok((paused.warnings ?? []).length > 0, "restored paused");
	assert.equal(logged(store).filter((l) => l.label === "summarize").length, 1, "status reads send no request");
	await host.call("prompt", { operationId: "op-3", text: "three" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === "ok: three", "the next answer");
	await host.until((e) => e.type === "status.update" && (e.status as Status).isCompacting === false, "compaction to end");
	const transcript = await host.call<Transcript>("transcript");
	assert.equal(compactions(transcript.messages).length, 1, "one summary placed");
	assert.equal(logged(store).filter((l) => l.label === "summarize").length, 2, "the interrupted summary request was sent again, once");
	assert.deepEqual(users(transcript.messages), ["one", "two", "three"]);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("redaction control: without the redacting provider a compaction summary and its instructions commit a secret", async () => {
	const dir = scratch("compact-leak-control");
	const h = await openHost(dir, { settings: { compaction: { keepRecentTokens: 1 } }, providerOptions: { sanitize: (text) => text } });
	h.faux.setResponses([fauxAssistantMessage([fauxText("first")]), fauxAssistantMessage([fauxText("second")]), fauxAssistantMessage([fauxText(`Summary: the token is ${SECRET}`)])]);
	await settle(h, "op-1", "one");
	await settle(h, "op-2", "two");
	await h.harness.waitForTask(await h.root.compact(`keep ${SECRET}`, context), context);
	const placed = async () => (await entriesOf(h.harness, h.root.id)).some((entry) => entry.kind === CompactionEntry.kind);
	for (let i = 0; i < 100 && !(await placed()); i++) await new Promise((resolve) => setTimeout(resolve, 20));
	await h.close();
	assert.ok(scan([dir], [SECRET]).length > 0, "the scan finds the plaintext in the store");
});

test("a compaction summary and its /compact instructions are redacted before they are committed", async () => {
	const dir = scratch("compact-leak");
	const h = await openHost(dir, { settings: { compaction: { keepRecentTokens: 1 } } });
	h.faux.setResponses([fauxAssistantMessage([fauxText("first")]), fauxAssistantMessage([fauxText("second")]), fauxAssistantMessage([fauxText(`Summary: the token is ${SECRET}`)])]);
	const events: { type: string; message?: { source?: string; content?: string } }[] = [];
	const session = new ChatSession(h, (event) => events.push(event as never));
	await session.start();
	await settle(h, "op-1", "one");
	await settle(h, "op-2", "two");
	await session.compact(`keep ${SECRET}`);
	await waitFor(() => events.some((e) => e.message?.source === "compaction"), "the summary");
	await session.close();
	assert.match(String(events.find((e) => e.message?.source === "compaction")?.message?.content), /\[REDACTED:env:PILOT_CONTEXT_TOKEN\]/);
	assert.deepEqual(scan([dir], [SECRET, SECRET.slice(0, 16)]), [], "store and work directory clean");
});

// ─── compact_and_continue ────────────────────────────────────────────────────

const checkpointCall = (summaryFocus: string, nextPhase = "write the docs") => `call:compact_and_continue ${JSON.stringify({ summaryFocus, nextPhase })}`;
const isCheckpoint = (e: { type: string; message?: unknown }) => e.type === "message.end" && (e.message as Message).customType === "context-checkpoint";
const continuations = (store: string) => logged(store).filter((l) => l.label.startsWith("Context checkpoint"));

/** A Chat with two answered turns and a small keep window, so a checkpoint has history to summarize. */
async function twoTurns(host: ChatHost): Promise<void> {
	await host.call("configure", { resources: {}, ...SMALL });
	for (const [n, text] of ["one", "two"].entries()) {
		await host.call("prompt", { operationId: `op-${n}`, text });
		await host.idle(n + 1);
	}
}

test("compact_and_continue: the run ends, the summary is placed, then exactly one continuation starts the next phase with the Working Mode block", async () => {
	const { store, cwd } = family("checkpoint");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("mode", { args: "attention focused" });
	await twoTurns(host);
	await host.call("prompt", { operationId: "op-cc", text: checkpointCall("Keep the test names") });
	const ended = await host.until((e) => e.type === "tool.end" && e.toolName === "compact_and_continue", "the tool result");
	assert.match(String(ended.text), /Context checkpoint scheduled/);
	const message = await host.until(isCheckpoint, "the continuation");
	assert.match(textOf((message.message as Message).content), /^Context checkpoint completed\.\n\nContinue with the requested next phase: write the docs/);
	assert.equal((message.message as Message).details?.status, "compacted");
	await host.until((e) => e.type === "message.end" && textOf((e.message as Message).content).startsWith("ok: Context checkpoint completed"), "the next phase's answer");
	const labels = logged(store).map((l) => l.label);
	assert.equal(labels.filter((l) => l === "summarize").length, 1);
	assert.ok(!labels.includes("result:compact_and_continue"), "the run ended without another model request");
	assert.ok(labels.indexOf("summarize") < labels.findIndex((l) => l.startsWith("Context checkpoint")), "the continuation follows the placed summary");
	assert.match(String(logged(store).find((l) => l.label === "summarize")?.focus), /Summary focus directive: Keep the test names\nNext phase: write the docs/);
	assert.equal(continuations(store).length, 1);
	assert.equal(continuations(store)[0]?.workingMode, 2, "the block compaction summarized away rides with the continuation");
	const transcript = await host.call<Transcript>("transcript");
	const types = transcript.messages.map((m) => m.customType ?? m.source ?? m.role);
	assert.deepEqual(types.slice(types.indexOf("compaction")), ["compaction", "working-mode", "context-checkpoint", "assistant"]);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("compact_and_continue refuses a sibling tool batch and schedules nothing", async () => {
	const { store, cwd } = family("checkpoint-batch");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await twoTurns(host);
	const calls = [{ name: "compact_and_continue", arguments: { summaryFocus: "x", nextPhase: "y" } }, { name: "read", arguments: { path: "missing.txt" } }];
	await host.call("prompt", { operationId: "op-cc", text: `calls:${JSON.stringify(calls)}` });
	const ended = await host.until((e) => e.type === "tool.end" && e.toolName === "compact_and_continue", "the tool result");
	assert.match(String(ended.text), /must be called alone in its assistant tool batch/);
	await host.idle(3);
	assert.ok(!logged(store).some((l) => l.label === "summarize"), "no compaction");
	assert.equal(continuations(store).length, 0);
	await host.close();
});

test("compact_and_continue: a failed compaction still continues once, with the diagnostic", async () => {
	const { store, cwd } = family("checkpoint-fail");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await twoTurns(host);
	await host.call("prompt", { operationId: "op-cc", text: checkpointCall("fail now") });
	const message = await host.until(isCheckpoint, "the continuation");
	assert.equal((message.message as Message).details?.status, "failed");
	assert.match(textOf((message.message as Message).content), /^Context checkpoint failed: Summarization failed: 400 summarizer rejected/);
	await host.idle(4);
	assert.equal(continuations(store).length, 1);
	await host.close();
});

test("compact_and_continue: Esc during the compaction cancels it visibly and starts no next phase", async () => {
	const { store, cwd } = family("checkpoint-cancel");
	const host = new ChatHost(store, cwd, { tps: 40 });
	await host.ready;
	await twoTurns(host);
	await host.call("prompt", { operationId: "op-cc", text: checkpointCall("slow") });
	await waitFor(() => logged(store).some((l) => l.label === "summarize"), "the summary request");
	await host.call("abort");
	const message = await host.until(isCheckpoint, "the cancellation record");
	assert.equal((message.message as Message).details?.status, "cancelled");
	assert.equal(textOf((message.message as Message).content), "Context checkpoint cancelled; the next phase was not started.");
	const status = await host.call<Status>("status");
	assert.equal(status.isCompacting, false);
	assert.equal(status.isStreaming, false);
	assert.equal(continuations(store).length, 0, "no continuation reached the model");
	await host.close();
	assert.equal(integrity(store), "ok");
});

for (const window of ["after the tool result", "while summarizing", "after the continuation"] as const) {
	test(`crash row compact_and_continue: a kill ${window} yields one summary and one continuation after reopen`, async () => {
		const { store, cwd } = family(`checkpoint-kill-${window.split(" ").at(-1)}`);
		let host = new ChatHost(store, cwd, { tps: window === "while summarizing" ? 40 : 400 });
		await host.ready;
		await twoTurns(host);
		await host.call("prompt", { operationId: "op-cc", text: checkpointCall(window === "while summarizing" ? "slow" : "Keep it") });
		if (window === "after the tool result") await host.until((e) => e.type === "tool.end" && e.toolName === "compact_and_continue", "the tool result");
		if (window === "while summarizing") await waitFor(() => logged(store).some((l) => l.label === "summarize"), "the summary request");
		if (window === "after the continuation") await host.until(isCheckpoint, "the continuation");
		await host.kill();
		const summariesBefore = logged(store).filter((l) => l.label === "summarize").length;

		host = new ChatHost(store, cwd);
		await host.ready;
		await host.call("configure", { resources: {}, ...SMALL });
		await host.call("prompt", { operationId: "op-after", text: "after restart" });
		if (window !== "after the continuation") await host.until(isCheckpoint, "the continuation");
		await host.until(() => logged(store).some((l) => l.label === "after restart"), "the new prompt's request");
		await host.until(() => continuations(store).length >= 1 && (window === "after the continuation" || host.events.filter((e) => e.type === "agent.end").length >= 2), "the runs to end");
		const transcript = await host.call<Transcript>("transcript");
		assert.equal(transcript.messages.filter((m) => m.customType === "context-checkpoint").length, 1, "one continuation in the transcript");
		assert.equal(compactions(transcript.messages).length, 1, "one placed summary");
		assert.equal(continuations(store).length, 1, "the model got the continuation once");
		const summaries = logged(store).filter((l) => l.label === "summarize").length;
		assert.equal(summaries, window === "while summarizing" ? 2 : Math.max(summariesBefore, 1), "a summary request is resent only when the kill interrupted it");
		await host.close();
		assert.equal(integrity(store), "ok");
	});
}
