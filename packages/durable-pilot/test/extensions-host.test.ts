// Slice 5 group A: the remaining Workbench extensions in a Durable Chat, against the real host process (IPC protocol,
// scripted faux model). Row IDs from the parity matrix name each test: P034 runtime identity for tools and the
// Workstreams CLI, P085 pi-tmp, P088 storage-guard, P086 quota-startup, P073 activity. autonomous-grill (P077),
// lead-fallback (P084) and agent-audit (P074) are out of scope (owner, 2026-10-22). Every barrier is an event the host emitted after the relevant commit.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { readLog } from "../src/faux.ts";
import type { ConversationId } from "@earendil-works/pi-durable";
import { quotaCheck, toolEnv } from "../src/extensions.ts";
import { ChatHost, idle as runs, live, textOf } from "./chat-proc.ts";
import { cleanup, PACKAGE, scratch } from "./runner.ts";

type Message = { role: string; customType?: string; content?: unknown };
type Status = { isStreaming: boolean; activeToolExecutions?: { id: string; kind: string; toolName: string; label: string }[] };

const ROOT = scratch("s5a");
const TMP_ROOT = join(ROOT, "pi-tmp");
const CLI = join(PACKAGE, "..", "..", "skills", "workstreams", "scripts", "workstreams.mjs");
// Inherited by every host: telemetry, PI_TMP and the Workstream store stay in scratch, never the owner's real ones.
process.env.PI_TELEMETRY_DIR = join(ROOT, "telemetry");
process.env.PI_TMP_ROOT = TMP_ROOT;
process.env.PI_WORKBENCH_WORKSTREAM_DIR = join(ROOT, "workstreams");
delete process.env.PI_STORAGE_GUARD_FREE_GB;

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

function family(label: string): { store: string; cwd: string } {
	const dir = join(ROOT, label);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd, { recursive: true });
	return { store: join(dir, "family"), cwd };
}

const labels = (store: string) => readLog<{ label: string }>(join(store, "requests.log")).map((line) => line.label);
const messages = async (host: ChatHost) => (await host.call<{ messages: Message[] }>("transcript")).messages;
const toolEnd = (host: ChatHost, n = 1) => host.until(() => host.events.filter((e) => e.type === "tool.end").length >= n, `tool end ${n}`).then(() => host.events.filter((e) => e.type === "tool.end")[n - 1]!);

test("P034 tools see the Chat's runtime identity, and the Workstreams CLI on PATH resolves this Durable Chat", async () => {
	const { store, cwd } = family("identity");
	const agentDir = join(ROOT, "agent");
	mkdirSync(join(agentDir, "bin"), { recursive: true });
	symlinkSync(CLI, join(agentDir, "bin", "workstreams"));
	assert.equal(spawnSync(process.execPath, [CLI, "create", "ws-durable", "--title", "Durable", "--group", "Pi Workbench", "--owner"], { encoding: "utf8" }).status, 0);
	const host = new ChatHost(store, cwd, { args: ["--session-id", "chat-s5a-1"], env: { PI_CODING_AGENT_DIR: agentDir, PI_SESSION_ID: "stale-daemon-id", PI_SESSION_FILE: "/stale.jsonl", PI_TMP: "/stale" } });
	await host.ready;
	const command = 'echo "id=$PI_SESSION_ID tmp=$PI_TMP model=$PI_PROVIDER/$PI_MODEL file=${PI_SESSION_FILE:-none} tmpdir=${TMPDIR:-unset}"; workstreams associate ws-durable >/dev/null && workstreams | grep "this session"';
	await host.call("prompt", { operationId: "op-1", text: `call:bash ${JSON.stringify({ command })}` });
	const end = await toolEnd(host);
	assert.equal(end.isError, false, String(end.text));
	const tmp = join(TMP_ROOT, "workspace", "chat-s5a-1");
	assert.match(String(end.text), new RegExp(`id=chat-s5a-1 tmp=${tmp} model=faux/faux-1 file=none`));
	assert.doesNotMatch(String(end.text), new RegExp(`tmpdir=${tmp}`), "TMPDIR is never PI_TMP");
	assert.ok(existsSync(tmp), "PI_TMP exists for the command");
	assert.match(String(end.text), /this session: ws-durable/, "the CLI resolves this Chat by PI_SESSION_ID");
	await host.close();
});

test("P034/P085 a child conversation gets its own identity and PI_TMP; the host process environment is untouched", () => {
	const before = process.env.PI_TMP;
	const root = toolEnv({ chatId: "chat-x", conversationId: 1 as ConversationId, rootId: 1 as ConversationId, cwd: ROOT });
	const child = toolEnv({ chatId: "chat-x", conversationId: 7 as ConversationId, rootId: 1 as ConversationId, cwd: ROOT, model: { provider: "faux", modelId: "faux-2" }, thinkingLevel: "high" });
	assert.equal(root.PI_SESSION_ID, "chat-x");
	assert.equal(child.PI_SESSION_ID, "chat-x:7");
	assert.notEqual(root.PI_TMP, child.PI_TMP);
	assert.deepEqual([child.PI_PROVIDER, child.PI_MODEL, child.PI_REASONING_LEVEL], ["faux", "faux-2", "high"]);
	assert.equal(root.PI_PROVIDER, undefined);
	assert.equal(root.TMPDIR, undefined);
	assert.equal(process.env.PI_TMP, before);
});

test("P085 pi-tmp: writes into an OS temp folder are blocked, bash /tmp use is warned, the sweeper runs at open", async () => {
	const { store, cwd } = family("pitmp");
	// Seven active days of one project, newest last; a session folder last used before them is swept, a current one kept.
	const project = join(TMP_ROOT, "swept-project");
	mkdirSync(join(project, ".days"), { recursive: true });
	for (let day = 1; day <= 8; day++) writeFileSync(join(project, ".days", `2026-10-${String(day).padStart(2, "0")}`), "");
	mkdirSync(join(project, "old-session"));
	mkdirSync(join(project, "current-session"));
	utimesSync(join(project, "old-session"), new Date("2026-09-01"), new Date("2026-09-01"));
	utimesSync(join(project, "current-session"), new Date("2026-10-08T12:00:00"), new Date("2026-10-08T12:00:00"));
	const host = new ChatHost(store, cwd);
	await host.ready;
	assert.equal(existsSync(join(project, "old-session")), false, "swept at open");
	assert.equal(existsSync(join(project, "current-session")), true);

	await host.call("prompt", { operationId: "op-1", text: 'call:write {"path":"/tmp/s5a-blocked.txt","content":"x"}' });
	const blocked = await toolEnd(host, 1);
	assert.equal(blocked.isError, true);
	assert.match(String(blocked.text), /Blocked: \/tmp\/s5a-blocked\.txt is under an OS temp folder\. Use \$PI_TMP/);
	assert.equal(existsSync("/tmp/s5a-blocked.txt"), false);
	await runs(host, 1);
	await host.call("prompt", { operationId: "op-2", text: 'call:bash {"command":"true || cd /tmp; true || git worktree add ../x"}' });
	const warned = await toolEnd(host, 2);
	assert.equal(warned.isError, false);
	assert.match(String(warned.text), /Warning: this command uses \/tmp\. Use \$PI_TMP/);
	assert.match(String(warned.text), /wt switch --create/);
	await runs(host, 2);
	const transcript = await messages(host);
	assert.match(textOf(transcript.findLast((m) => m.role === "toolResult")?.content), /Warning: this command uses \/tmp/, "the model sees the warning");
	await host.close();
});

test("P088 storage-guard: one low-disk notice before the lead's run, persisted across a kill, again only 5 GB lower", async () => {
	const { store, cwd } = family("storage");
	const low = (gb: number) => ({ env: { PI_STORAGE_GUARD_FREE_GB: String(gb) } });
	let host = new ChatHost(store, cwd, low(49));
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: "first" });
	await runs(host, 1);
	const notice = host.events.find((e) => e.type === "message.end" && (e.message as Message).customType === "storage-guard");
	assert.match(textOf((notice?.message as Message | undefined)?.content), /^Disk low: 49 GB free\. At the next checkpoint/, "shown live");
	await host.call("prompt", { operationId: "op-2", text: "second" });
	await runs(host, 2);
	await host.kill();

	host = new ChatHost(store, cwd, low(46));
	await host.ready;
	await host.call("prompt", { operationId: "op-3", text: "third" });
	await runs(host, 1);
	await host.kill();

	host = new ChatHost(store, cwd, low(44));
	await host.ready;
	await host.call("prompt", { operationId: "op-4", text: "fourth" });
	await runs(host, 1);
	const shown = (await messages(host)).filter((m) => m.role === "user" || m.customType === "storage-guard").map((m) => m.customType === undefined ? textOf(m.content) : textOf(m.content).slice(0, 20));
	assert.deepEqual(shown, ["Disk low: 49 GB free", "first", "second", "third", "Disk low: 44 GB free", "fourth"]);
	assert.deepEqual(labels(store), ["first", "second", "third", "fourth"], "no forced cleanup turn");
	assert.equal(readLog<{ messages: number }>(join(store, "requests.log"))[0]?.messages, 2, "the model read the notice before the first prompt");
	await host.close();
});

test("P086 quota-check: a host command; check only by default; Keychain/sign-in repair only when the owner asks for it", async () => {
	const { store, cwd } = family("quota");
	const host = new ChatHost(store, cwd);
	await host.ready;
	assert.deepEqual((await host.call<{ name: string }[]>("commands")).map((c) => c.name), ["quota-check"]);
	assert.deepEqual(await host.call("command", { name: "quota-check", args: "bogus" }), { type: "done", message: "Usage: /quota-check [repair]" });
	await assert.rejects(host.call("command", { name: "autonomous-grill", args: "" }), /Unknown command/);
	await host.close();

	const calls: string[] = [];
	const report = (state: object) => JSON.stringify({ providers: [{ provider: "claude", state }] });
	const runWith = (states: object[]) => async (command: string, args: string[]) => {
		calls.push([command === process.execPath ? "node" : command, ...args.map((a) => a.split("/").at(-1))].join(" "));
		return { code: 0, stdout: command === "claude" ? "" : report(states.shift() ?? {}), stderr: "" };
	};
	assert.equal(await quotaCheck("", runWith([{ status: "fresh" }])), "Claude quota telemetry is fresh.");
	assert.match(await quotaCheck("", runWith([{ status: "unavailable", error: "offline" }])), /could not inspect telemetry: offline/);
	calls.length = 0;
	assert.match(await quotaCheck("", runWith([{ reason: "keychain_access_required" }])), /needs macOS Keychain access\. Run \/quota-check repair/);
	assert.deepEqual(calls, ["node quota-snapshot-cache.mjs"], "no repair without the owner's explicit request");
	calls.length = 0;
	assert.match(await quotaCheck("repair", runWith([{ status: "auth_required" }, { status: "fresh" }])), /fresh and future startup checks will be non-interactive/);
	assert.deepEqual(calls, ["node quota-snapshot-cache.mjs", "claude auth login", "node quota-snapshot-cache.mjs --refresh-keychain"]);
	assert.match(await quotaCheck("bogus", runWith([{ status: "fresh" }])), /^Usage: \/quota-check \[repair\]/);
});

test("P073 activity: a running bash call shows in the Chat's shell activity and leaves it when it ends", async () => {
	const { store, cwd } = family("activity");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"echo running; sleep 30"}' });
	await host.until((e) => e.type === "tool.update" && String(e.text).includes("running"), "bash output");
	const running = await host.call<Status>("status");
	assert.equal(running.activeToolExecutions?.length, 1);
	assert.deepEqual({ ...running.activeToolExecutions![0], id: undefined, startedAt: undefined }, { id: undefined, kind: "shell", toolName: "bash", label: "Shell command", startedAt: undefined });
	assert.ok(host.events.some((e) => e.type === "status.update" && ((e.status as Status).activeToolExecutions?.length ?? 0) === 1), "pushed live");
	await host.kill();

	const reopened = new ChatHost(store, cwd);
	await reopened.ready;
	assert.equal((await reopened.call<Status>("status")).activeToolExecutions, undefined, "an interrupted call is not shown as running");
	await reopened.call("prompt", { operationId: "op-2", text: 'call:read {"path":"."}' });
	await runs(reopened, 1);
	assert.equal((await reopened.call<Status>("status")).activeToolExecutions, undefined);
	await reopened.close();
});
