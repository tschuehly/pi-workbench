// Paused restore, owner actions (plan "Lead decisions while AFK": paused restore after shutdown). A Chat restored after
// shutdown stays paused until the owner sends, answers or resolves: Stop cancels what it targets (the lead's run and
// queue), queue toggle/promote change the queue, and a `!` command finishing while the lead is idle records its
// output, each without scheduling the other paused work (here a background Subagent's interrupted generation). No
// provider request until the owner sends; then the child's generation resumes once and the Stop holds.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { ChatHost, family, live, logged, type Message, type Status, textOf, waitFor } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

const QUOTA = join(scratch("paused-actions-quota"), "quota.json");
process.env.PI_WORKBENCH_QUOTA_CACHE = QUOTA;
process.env.PI_TELEMETRY_DIR = scratch("paused-actions-telemetry");

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

function open(store: string, cwd: string, tps = 5000): ChatHost {
	// A fresh empty quota snapshot: child routing never runs quota-axi.
	writeFileSync(QUOTA, JSON.stringify({ version: 1, checkedAt: Date.now(), status: 0, stdout: JSON.stringify({ providers: [] }), stderr: "" }));
	return new ChatHost(store, cwd, { tps, args: ["--scripted-providers", "--session-id", "chat-paused-actions"] });
}

type Queued = { id: number; kind: string; text: string };
const call = (tool: string, args: object) => `call:${tool} ${JSON.stringify(args)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const child = (store: string) => logged(store).filter((l) => l.label === "gen" && (l as { model?: string }).model !== undefined).length;
const lead = (store: string) => logged(store).filter((l) => l.label === "gen" && (l as { model?: string }).model === undefined).length;
const queue = async (host: ChatHost) => (await host.call<Status & { queuedMessages: Queued[] }>("status")).queuedMessages.map((q) => `${q.kind}:${q.text}`);

/** A first host launches a slow background Subagent (and optionally more), then dies while the child generates. */
async function restoreWithChild(label: string, more?: (host: ChatHost) => Promise<void>): Promise<{ store: string; cwd: string }> {
	const f = family(label);
	const first = open(f.store, f.cwd, 30);
	await first.ready;
	await first.call("prompt", { operationId: "child", text: call("subagent", { task: "gen", profile: "scout", cognitiveRole: "routine", background: true, name: "Paused child" }) });
	await first.idle(1);
	await waitFor(() => child(f.store) === 1, "the child generating");
	await more?.(first);
	await first.kill();
	return f;
}

/** The host sent nothing and still reports a paused restore, after giving a resumed scheduler time to act. */
async function assertPaused(host: ChatHost, store: string, requests: number, what: string): Promise<void> {
	await sleep(1_500);
	assert.equal(logged(store).length, requests, `${what}: no provider request`);
	const status = await host.call<Status>("status");
	assert.ok((status.warnings ?? []).some((w) => /Restored paused/.test(w.message)), `${what}: still reported paused`);
}

test("paused restore: queue toggle and promote change the queue, Stop withdraws it and the lead's run, and none of them schedules the paused child; sending resumes it once", async () => {
	const { store, cwd } = await restoreWithChild("paused-queue-stop", async (first) => {
		await first.call("prompt", { operationId: "gen", text: "gen" });
		await first.until((e) => e.type === "assistant.delta", "the lead generating");
		await first.call("prompt", { operationId: "f1", text: "f1" });
		await first.call("prompt", { operationId: "f2", text: "f2" });
	});
	const requests = logged(store).length;
	assert.equal(child(store), 1);
	assert.equal(lead(store), 1);

	const host = open(store, cwd);
	await host.ready;
	assert.deepEqual(await queue(host), ["followUp:f1", "followUp:f2"], "the queue is restored");
	const mutate = async (editId: string, action: string, index: number) => {
		const items = (await host.call<{ queuedMessages: Queued[] }>("status")).queuedMessages;
		await host.call("mutateQueue", { editId, action, index, expected: items.map((i) => i.id) });
	};
	await mutate("edit-toggle", "toggle", 0);
	assert.deepEqual(await queue(host), ["steer:f1", "followUp:f2"]);
	await assertPaused(host, store, requests, "queue toggle");
	await mutate("edit-promote", "promote", 1);
	assert.deepEqual(await queue(host), ["steer:f1", "steer:f2"]);
	await assertPaused(host, store, requests, "queue promote");
	await host.call("abort");
	assert.deepEqual(await queue(host), [], "Stop withdraws the queue");
	await assertPaused(host, store, requests, "Stop");
	await host.close();

	// Still paused after a close; the owner's send resumes the child once and the Stop holds.
	const next = open(store, cwd);
	await next.ready;
	await assertPaused(next, store, requests, "reopen after the paused actions");
	await next.call("prompt", { operationId: "resume", text: "next" });
	await next.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === "ok: next", "the owner's input answered");
	await waitFor(() => child(store) === 2, "the child's generation reissued after resume");
	assert.equal(lead(store), 1, "the stopped lead generation is not reissued");
	const labels = logged(store).map((l) => l.label);
	assert.ok(!labels.includes("f1") && !labels.includes("f2"), `withdrawn inputs never reach the model: ${labels.join(" | ")}`);
	await next.close();
});

test("paused restore: a `!` command finishing while the lead is idle records its output without scheduling the paused child; the next send carries it", async () => {
	const { store, cwd } = await restoreWithChild("paused-shell");
	const requests = logged(store).length;
	assert.equal(child(store), 1);

	const host = open(store, cwd);
	await host.ready;
	await host.call("shell", { text: "!echo paused-shell-output" });
	await host.until((e) => e.type === "shell.end", "the command finishing");
	await assertPaused(host, store, requests, "a finished `!` command");
	const recorded = (await host.call<{ messages: (Message & { output?: string })[] }>("transcript")).messages.filter((m) => m.role === "bashExecution");
	assert.deepEqual(recorded.map((m) => m.output), ["paused-shell-output"], "the output is recorded");

	await host.call("prompt", { operationId: "resume", text: "next" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === "ok: next", "the owner's input answered");
	assert.deepEqual(logged(store).find((l) => l.label === "next")?.ran, ["echo paused-shell-output"], "the model reads the command with the next request");
	await waitFor(() => child(store) === 2, "the child's generation reissued after resume");
	await host.close();
});
