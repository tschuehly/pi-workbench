// Slice 4 group B: the Workbench `bash` (extensions/background-bash) in a Durable Chat, against the real host process
// (IPC protocol, scripted faux model). Parity rows P071 (foreground), P078 (background by default), P079 bash_status,
// P080 bash_cancel, P081 completion message; survival rows from the plan's "Background bash" row: a kill after launch
// intent, after spawn and after completion admission never launches twice or delivers twice, a host-only loss
// reattaches to the live runner, a machine restart (runner gone) reports an unknown exit and never reruns.
import assert from "node:assert/strict";
import cp, { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { userInfo } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AgentDoc } from "@earendil-works/pi-durable";
import { alreadyFenced } from "../../../extensions/background-bash/sandbox.mjs";
import { BackgroundBash, BashJobsDoc } from "../src/background-bash.ts";
import { ChatHost, live, logged, textOf, waitFor } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

type Message = { role: string; customType?: string; content?: unknown; details?: Record<string, unknown>; isError?: boolean };
type Status = { extensionStatuses?: Record<string, string>; warnings?: unknown[]; unresolvedEffects?: unknown[] };

const ROOT = scratch("s4b-bash", { repo: true });
const JOBS = join(ROOT, "jobs");
// Every host this file starts keeps its job registry, PI_TMP and telemetry in scratch.
process.env.PI_BACKGROUND_BASH_ROOT = JOBS;
process.env.PI_TMP_ROOT = join(ROOT, "pi-tmp");
process.env.PI_TELEMETRY_DIR = join(ROOT, "telemetry");

after(() => {
	for (const child of live) child.kill("SIGKILL");
	// Stop any job a failed test left running.
	for (const id of existsSync(JOBS) ? readdirSync(JOBS) : []) {
		try {
			process.kill(-JSON.parse(readFileSync(join(JOBS, id, "claim"), "utf8")).pid, "SIGKILL");
		} catch {
			// gone
		}
	}
	cleanup();
});

function family(label: string): { store: string; cwd: string } {
	const dir = join(ROOT, label);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd, { recursive: true });
	return { store: join(dir, "family"), cwd };
}

const call = (tool: string, args: object) => `call:${tool} ${JSON.stringify(args)}`;
const messages = async (host: ChatHost) => (await host.call<{ messages: Message[] }>("transcript")).messages;
const completions = async (host: ChatHost) => (await messages(host)).filter((m) => m.customType === "background-bash");
const toolEnds = (host: ChatHost) => host.events.filter((e) => e.type === "tool.end");
const toolEnd = (host: ChatHost, n = 1) => host.until(() => toolEnds(host).length >= n, `tool end ${n}`).then(() => toolEnds(host)[n - 1]!);
const launches = (cwd: string) => (existsSync(join(cwd, "launches.log")) ? readFileSync(join(cwd, "launches.log"), "utf8").trim().split("\n").length : 0);
const jobId = (text: unknown) => /bash ([0-9a-f-]{36})/.exec(String(text))?.[1] ?? assert.fail(`no job ID in ${String(text)}`);
const claim = (id: string) => JSON.parse(readFileSync(join(JOBS, id, "claim"), "utf8")) as { pid: number };
const exitRecord = (id: string) => (existsSync(join(JOBS, id, "exit")) ? (JSON.parse(readFileSync(join(JOBS, id, "exit"), "utf8")) as Record<string, unknown>) : undefined);
const completionRequests = (store: string) => logged(store).filter((l) => l.label.startsWith("Background bash")).length;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

test("P078/P081 bash runs in the background by default: a job ID returns at once, one completion with the exit and output wakes the Chat", async () => {
	const { store, cwd } = family("background");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: call("bash", { description: "Count launches", command: "echo x >> launches.log; sleep 0.5; echo finished-output" }) });
	const started = await toolEnd(host);
	assert.equal(started.isError, false);
	assert.match(String(started.text), /^Background bash [0-9a-f-]{36} started\. .*Output log: .*output\.log$/s);
	const id = jobId(started.text);
	assert.equal(exitRecord(id), undefined, "the tool returned before the command finished");
	await host.until(() => completionRequests(store) === 1, "the completion waking the Chat");
	const [completion, ...more] = await completions(host);
	assert.equal(more.length, 0, "one completion");
	assert.match(textOf(completion!.content), new RegExp(`^Background bash ${id} complete \\(exit 0\\)\\.\\nFull output: .*output\\.log\\nfinished-output$`));
	assert.equal(completion!.details?.state, "complete");
	assert.equal(completion!.details?.description, "Count launches");
	assert.equal(completion!.details?.logPath, join(JOBS, id, "output.log"));
	assert.equal(launches(cwd), 1);
	const status = await host.call<Status>("status");
	assert.equal(status.extensionStatuses?.["pi-workbench:background-bash"], undefined, "no running job is shown");
	await host.close();
});

test("an owner run is an unfenced background job of the lead: launched once per operation, its completion wakes the idle Chat with the run marked", async () => {
	const { store, cwd } = family("owner-run");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const request = { operationId: "owner-run:1", command: "echo x >> launches.log; pwd; exit 7", cwd };
	const started = await host.call<{ jobId: string; logPath: string }>("ownerRun", request);
	assert.equal((await host.call<{ jobId: string }>("ownerRun", request)).jobId, started.jobId, "a retried request names the same job");
	assert.equal(JSON.parse(readFileSync(join(JOBS, started.jobId, "job.json"), "utf8")).fullAccess, true, "outside the write fence");
	await host.until(() => logged(store).some((l) => l.label.startsWith("[Owner run result]")), "the completion waking the Chat");
	const [completion, ...more] = await completions(host);
	assert.equal(more.length, 0);
	assert.match(textOf(completion!.content), new RegExp(`^\\[Owner run result\\] .*untrusted data.*\\nBackground bash ${started.jobId} failed \\(exit 7\\)\\.\\nFull output: .*\\n${cwd}\\n$`, "s"));
	assert.equal(launches(cwd), 1, "ran once");
	await host.close();
});

test("an owner run masks a private key that never ends, and once its job record is pruned the same operation is refused, not run again", async () => {
	const { store, cwd } = family("owner-run-pruned");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const request = { operationId: "owner-run:pruned", command: `echo x >> launches.log; printf -- '-----BEGIN PRIVATE KEY-----\\nKEYBODY${"A".repeat(60)}\\n'`, cwd };
	const started = await host.call<{ jobId: string }>("ownerRun", request);
	await host.until(() => logged(store).some((l) => l.label.startsWith("[Owner run result]")), "the completion");
	const [completion] = await completions(host);
	assert.doesNotMatch(textOf(completion!.content), /KEYBODY/);
	rmSync(join(JOBS, started.jobId), { recursive: true }); // the registry's weekly prune
	await assert.rejects(host.call("ownerRun", request), /already ran/);
	assert.equal(launches(cwd), 1, "ran once");
	await host.close();
});

test("an owner run whose launch failed after its record committed launches on the retry", async () => {
	const { store, cwd } = family("owner-run-unlaunched");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const request = { operationId: "owner-run:unlaunched", command: "echo x >> launches.log", cwd };
	// The host's job ID for this operation (background-bash.ts jobId; the Chat ID is the store without --session-id).
	const hex = createHash("sha256").update(`bash\0${store}\0owner-run\0${request.operationId}`).digest("hex");
	const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
	mkdirSync(JOBS, { recursive: true });
	writeFileSync(join(JOBS, id), ""); // the registry cannot make the job's folder
	await assert.rejects(host.call("ownerRun", request));
	rmSync(join(JOBS, id));
	assert.equal((await host.call<{ jobId: string }>("ownerRun", request)).jobId, id);
	await host.until(() => logged(store).some((l) => l.label.startsWith("[Owner run result]")), "the completion");
	assert.equal(launches(cwd), 1, "ran once, on the retry");
	await host.close();
});

test("an owner run whose job record is lost before its completion is delivered is refused on a retry, not run again", async () => {
	const { store, cwd } = family("owner-run-lost");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const request = { operationId: "owner-run:lost", command: "echo x >> launches.log; sleep 1", cwd };
	const started = await host.call<{ jobId: string }>("ownerRun", request);
	await waitFor(() => launches(cwd) === 1, "the command ran");
	rmSync(join(JOBS, started.jobId), { recursive: true }); // a lost registry while it still runs: nothing delivered yet
	await assert.rejects(host.call("ownerRun", request), /already ran/);
	await sleep(1500);
	assert.equal(launches(cwd), 1, "ran once");
	await host.close();
});

test("a completion queued behind a busy turn stays out of the owner's queue, and the owner's queued message stays editable", async () => {
	const { store, cwd } = family("queued-notice");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-bg", text: call("bash", { description: "Short job", command: "sleep 1.5; echo done" }) });
	const id = jobId((await toolEnd(host)).text);
	await host.idle(1);
	await host.call("prompt", { operationId: "op-run", text: call("bash", { description: "Busy", command: "echo running; sleep 6", foreground: true }) });
	await host.call("prompt", { operationId: "op-f1", text: "f1" });
	await waitFor(() => exitRecord(id) !== undefined, "the job's exit");
	await sleep(1500); // its completion is admitted behind f1 while the foreground tool runs
	const items = (await host.call<{ queuedMessages: { id: number; kind: string; text: string }[] }>("status")).queuedMessages;
	assert.deepEqual(items.map((item) => `${item.kind}:${item.text}`), ["followUp:f1"], "only the owner's message is queued");
	await host.call("mutateQueue", { editId: "edit-remove", action: "remove", index: 0, expected: items.map((item) => item.id) });
	assert.deepEqual((await host.call<{ queuedMessages: unknown[] }>("status")).queuedMessages, [], "the notice behind it does not block the edit");
	await host.until(() => completionRequests(store) === 1, "the completion still wakes the Chat");
	assert.ok(!logged(store).some((l) => l.label === "f1"), "the removed message never reached the model");
	await host.close();
});

test("P071 foreground waits for the output inline; a failing exit is an error result; no completion follows", async () => {
	const { store, cwd } = family("foreground");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: call("bash", { description: "Print and fail", command: "echo out; echo err >&2; exit 3", foreground: true }) });
	const failed = await toolEnd(host);
	assert.equal(failed.isError, true, "a non-zero exit is not success");
	assert.match(String(failed.text), /out\nerr\n\n\nCommand exited with code 3$/);
	await host.call("prompt", { operationId: "op-2", text: call("bash", { description: "Print", command: "echo fine", foreground: true }) });
	const ok = await toolEnd(host, 2);
	assert.equal(ok.isError, false);
	assert.equal(String(ok.text), "fine\n");
	assert.match(String((ok.details as { logPath?: string }).logPath), /output\.log$/, "the log button's path");
	await host.idle(2);
	await new Promise((resolve) => setTimeout(resolve, 1500));
	assert.equal((await completions(host)).length, 0, "a foreground result is its own completion");
	assert.equal(completionRequests(store), 0);
	await host.close();
});

test("P073 one foreground bash is one Activity shell: its job names the running call, so PI WEB shows it once; nothing once it ends", async () => {
	const { store, cwd } = family("activity");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const gate = join(cwd, "gate");
	await host.call("prompt", { operationId: "op-1", text: call("bash", { description: "Held activity", command: `while [ ! -e ${gate} ]; do sleep 0.05; done; echo released`, foreground: true }) });
	type ActivityStatus = Status & { activeToolExecutions?: { id: string }[] };
	let status: ActivityStatus = {};
	for (let i = 0; i < 200; i++) {
		status = await host.call<ActivityStatus>("status");
		if (status.extensionStatuses?.["pi-workbench:background-bash"] !== undefined) break;
		await sleep(50);
	}
	const jobs = JSON.parse(status.extensionStatuses?.["pi-workbench:background-bash"] ?? "{}") as { jobs?: { description?: string; toolCallId?: string }[] };
	assert.deepEqual(jobs.jobs?.map((job) => job.description), ["Held activity"], "the running job is shown");
	assert.equal(status.activeToolExecutions?.length, 1, "the running call is reported at its tool boundary");
	assert.equal(`tool:${String(jobs.jobs?.[0]?.toolCallId)}`, status.activeToolExecutions?.[0]?.id, "the job names that call, so it is one shell");
	writeFileSync(gate, "");
	const ended = await toolEnd(host);
	assert.equal(String(ended.text), "released\n");
	await host.idle(1);
	const after = await host.call<ActivityStatus>("status");
	assert.equal(after.activeToolExecutions, undefined);
	assert.equal(after.extensionStatuses?.["pi-workbench:background-bash"], undefined);
	await host.close();
});

test("P071/P078 a foreground wait over 30 seconds hands off the same job, launched once; its completion follows once", async () => {
	const { store, cwd } = family("handoff");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: call("bash", { description: "Slow", command: "echo x >> launches.log; sleep 31.5; echo late", foreground: true }) });
	const handed = await toolEnd(host);
	assert.equal(handed.isError, false);
	assert.match(String(handed.text), /^Still running after 30s; continued as background bash [0-9a-f-]{36}\./);
	const id = jobId(handed.text);
	await host.until(() => completionRequests(store) === 1, "the completion");
	const all = await completions(host);
	assert.equal(all.length, 1);
	assert.equal(all[0]!.details?.id, id, "the same job, not a relaunch");
	assert.equal(launches(cwd), 1);
	await host.close();
});

test("P079/P080 bash_status lists only this Chat's jobs; bash_cancel stops only an owned job, which does not wake the Chat", async () => {
	const mine = family("status-mine");
	const theirs = family("status-theirs");
	const other = new ChatHost(theirs.store, theirs.cwd);
	await other.ready;
	await other.call("prompt", { operationId: "op-1", text: call("bash", { description: "Foreign", command: "sleep 30" }) });
	const foreign = jobId((await toolEnd(other)).text);
	const host = new ChatHost(mine.store, mine.cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: `calls:${JSON.stringify([{ name: "bash", arguments: { description: "One", command: "sleep 30" } }, { name: "bash", arguments: { description: "Two", command: "printf 12345; sleep 30" } }])}` });
	await toolEnd(host, 2);
	await host.idle(1);
	const ids = toolEnds(host).map((e) => jobId(e.text));
	const unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
	try {
		await host.call("prompt", { operationId: "op-2", text: call("bash_status", {}) });
		const listed = JSON.parse(String((await toolEnd(host, 3)).text)) as { id: string; state: string; bytes: number; logPath: string; elapsedSeconds: number }[];
		assert.deepEqual(listed.map((j) => j.id).sort(), [...ids].sort(), "only this Chat's jobs");
		assert.ok(listed.every((j) => j.state === "running" && j.logPath.endsWith("output.log") && Number.isInteger(j.elapsedSeconds)));
		await host.call("prompt", { operationId: "op-3", text: call("bash_status", { id: ids[1] }) });
		const one = JSON.parse(String((await toolEnd(host, 4)).text)) as { id: string; bytes: number }[];
		assert.equal(one.length, 1);
		assert.equal(one[0]!.bytes, 5);
		const status = await host.call<Status>("status");
		const shown = JSON.parse(status.extensionStatuses?.["pi-workbench:background-bash"] ?? "{}") as { jobs?: { id: string }[] };
		assert.deepEqual(shown.jobs?.map((j) => j.id).sort(), [...ids].sort(), "Activity shows the running jobs");

		await host.call("prompt", { operationId: "op-4", text: call("bash_cancel", { id: foreign }) });
		assert.match(String((await toolEnd(host, 5)).text), new RegExp(`No background bash job ${foreign}`));
		assert.equal(exitRecord(foreign), undefined, "another Chat's job is untouched");
		await host.idle(4);
		const before = logged(mine.store).length;
		await host.call("prompt", { operationId: "op-5", text: call("bash_cancel", { id: ids[0] }) });
		assert.match(String((await toolEnd(host, 6)).text), new RegExp(`Cancellation requested for ${ids[0]} \\(state=cancelled\\)`));
		await host.idle(5);
		await waitFor(() => exitRecord(ids[0]!)?.cancelled === true, "the cancel record");
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const done = await completions(host);
		assert.equal(done.length, 1);
		assert.match(textOf(done[0]!.content), /cancelled \(exit unknown\)/);
		assert.equal(logged(mine.store).length, before + 2, "the cancel's own turn only (call and answer): a cancelled completion wakes nothing");
		assert.equal(alive(unrelated.pid!), true, "an unrelated process stays alive");
	} finally {
		unrelated.kill("SIGKILL");
	}
	await host.call("prompt", { operationId: "op-6", text: call("bash_cancel", { id: ids[1] }) });
	await toolEnd(host, 7);
	await other.call("prompt", { operationId: "op-2", text: call("bash_cancel", { id: foreign }) });
	await toolEnd(other, 2);
	await host.close();
	await other.close();
});

test("P078 a timeout stops the job and its completion reports it; output over the inline limit discloses truncation", async () => {
	const { store, cwd } = family("timeout");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: call("bash", { description: "Times out", command: "sleep 30", timeout: 1 }) });
	await toolEnd(host);
	await host.call("prompt", { operationId: "op-2", text: call("bash", { description: "Lots of output", command: "for i in $(seq 1 3000); do echo line-$i-xxxxxxxxxx; done; exit 1" }) });
	await toolEnd(host, 2);
	await host.until(() => completionRequests(store) === 2, "both completions");
	const all = await completions(host);
	const timedOut = all.find((m) => m.details?.description === "Times out");
	const big = all.find((m) => m.details?.description === "Lots of output");
	assert.match(textOf(timedOut!.content), /failed \(exit unknown\)\. Timed out after 1 seconds/);
	assert.match(textOf(big!.content), /failed \(exit 1\)\.\nFull output: .*\n\[showing recent output only\]\n/);
	assert.match(textOf(big!.content), /line-3000-x+\n?$/);
	assert.ok(textOf(big!.content).length < 13_000, "bounded");
	await host.close();
});

test("P081 output is redacted in the tool result, the completion and the store; the log keeps the raw output", async () => {
	const { store, cwd } = family("leak");
	const secret = `ghp_${"S".repeat(36)}`;
	// The command names only the variable: tool-call arguments are stored verbatim (a documented boundary).
	const host = new ChatHost(store, cwd, { env: { S4B_LEAK_TOKEN: secret } });
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: call("bash", { description: "Leak in background", command: "echo token=$S4B_LEAK_TOKEN" }) });
	const id = jobId((await toolEnd(host)).text);
	await host.call("prompt", { operationId: "op-2", text: call("bash", { description: "Leak in foreground", command: "echo fg=$S4B_LEAK_TOKEN", foreground: true }) });
	const fg = await toolEnd(host, 2);
	assert.match(String(fg.text), /fg=\[REDACTED:[a-z-:A-Z0-9_]+\]/);
	await host.until(() => completionRequests(store) === 1, "the completion");
	const [completion] = await completions(host);
	assert.match(textOf(completion!.content), /token=\[REDACTED:[a-z-:A-Z0-9_]+\]/);
	await host.close();
	assert.match(readFileSync(join(JOBS, id, "output.log"), "utf8"), /S{36}/, "positive control: the raw secret was printed");
	for (const file of readdirSync(store).filter((name) => name.startsWith("session.sqlite")))
		assert.equal(readFileSync(join(store, file)).includes("S".repeat(36)), false, `no plaintext secret in ${file}`);
});

test("P081 a running job's Activity preview never publishes the start of a credential; a secret across the retained-tail cut leaves no suffix", async () => {
	const { store, cwd } = family("split-preview");
	// No recognisable shape: only the known-value list (a secret-named env variable) can mask it.
	const secret = "opaqueBashSecret-5e8a1c3f9b2d7046";
	const host = new ChatHost(store, cwd, { env: { S4B_SPLIT_TOKEN: secret } });
	await host.ready;
	const gated = 'printf "start %s" "${S4B_SPLIT_TOKEN:0:14}"; while [ ! -e gate ]; do sleep 0.1; done; printf "%s end\\n" "${S4B_SPLIT_TOKEN:14}"';
	await host.call("prompt", { operationId: "op-1", text: call("bash", { description: "Print a credential in two parts", command: gated }) });
	const id = jobId((await toolEnd(host)).text);
	const log = join(JOBS, id, "output.log");
	await waitFor(() => existsSync(log) && readFileSync(log, "utf8") === `start ${secret.slice(0, 14)}`, "the first 14 characters in the log");
	const seen: string[] = [];
	for (let n = 0; n < 6; n++) {
		seen.push((await host.call<Status>("status")).extensionStatuses?.["pi-workbench:background-bash"] ?? "");
		await sleep(250);
	}
	const fragment = secret.slice(0, 8);
	const published = JSON.stringify(host.events.filter((e) => e.type === "status.update"));
	assert.ok(published.includes("Print a credential in two parts"), "the running job was published");
	assert.ok(seen.every((status) => status.includes('"output":"start [REDACTED:partial]"')), `the fragment is masked, the text before it kept: ${seen.at(-1)}`);
	assert.ok(!seen.some((status) => status.includes(fragment)) && !published.includes(fragment), "no status read or status.update holds the fragment");
	writeFileSync(join(cwd, "gate"), "");
	await host.until(() => completionRequests(store) === 1, "the completion");
	assert.match(textOf((await completions(host))[0]!.content), /start \[REDACTED:env:S4B_SPLIT_TOKEN\] end/, "positive control: the complete secret is masked whole");

	// The retained tail (12,000 bytes) starts 10 characters into the secret; a failure shows the whole tail.
	const filler = 12_000 + "head ".length + 10 - ("head ".length + secret.length + 2);
	const cut = `printf "head %s\\n" "$S4B_SPLIT_TOKEN"; head -c ${String(filler)} /dev/zero | tr '\\0' y; printf "\\n"; exit 1`;
	await host.call("prompt", { operationId: "op-2", text: call("bash", { description: "Cut through a credential", command: cut }) });
	const cutId = jobId((await toolEnd(host, 2)).text);
	await host.until(() => completionRequests(store) === 2, "the failed job's completion");
	await host.call("prompt", { operationId: "op-3", text: call("bash", { description: "Cut through a credential", command: cut, foreground: true }) });
	const foreground = String((await toolEnd(host, 3)).text);
	const failed = textOf((await completions(host))[1]!.content);
	await host.close();
	assert.equal(readFileSync(join(JOBS, cutId, "output.log"), "utf8").length - 12_000, "head ".length + 10, "positive control: the tail cut falls inside the secret");
	const suffix = secret.slice(10);
	assert.ok(!failed.includes(suffix) && !failed.includes(secret.slice(-8)), `no suffix in the completion: ${failed.slice(0, 300)}`);
	assert.match(failed, /\[showing recent output only\]\n+y{100}/, "the completion shows the tail after the cut token");
	assert.ok(foreground.includes("yyyy") && !foreground.includes(suffix) && !foreground.includes(secret.slice(-8)), `no suffix in the foreground result: ${foreground.slice(0, 300)}`);
});

// ─── Survival ───────────────────────────────────────────────────────────────

test("checkpoint barrier: a job finishing during compact_and_continue is delivered only after the continuation is placed", async () => {
	const { store, cwd } = family("barrier");
	const gate = join(store, "..", "summary-gate");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("configure", { resources: {}, compaction: { keepRecentTokens: 1 } });
	await host.call("prompt", { operationId: "op-1", text: "warm up" });
	await host.idle(1);
	await host.call("prompt", { operationId: "op-2", text: call("bash", { description: "Wait for the flag", command: "while [ ! -e flag ]; do sleep 0.1; done; echo flagged" }) });
	const id = jobId((await toolEnd(host)).text);
	await host.idle(2);
	await host.call("prompt", { operationId: "op-3", text: call("compact_and_continue", { summaryFocus: `gate:${gate}`, nextPhase: "phase two" }) });
	await waitFor(() => logged(store).some((l) => l.label === "summarize"), "the summary request");
	// The job ends while the summary is held; the reporter polls twice a second.
	writeFileSync(join(cwd, "flag"), "");
	await waitFor(() => exitRecord(id) !== undefined, "the job's exit");
	await sleep(1500);
	writeFileSync(gate, "");
	await host.until(() => completionRequests(store) === 1, "the completion");
	await waitFor(() => logged(store).some((l) => l.label.startsWith("Context checkpoint")), "the continuation");
	const types = (await messages(host)).map((m) => m.customType);
	const continuation = types.indexOf("context-checkpoint");
	const completion = types.indexOf("background-bash");
	assert.ok(continuation >= 0 && completion >= 0, "both placed");
	assert.ok(continuation < completion, `the continuation (${String(continuation)}) is placed before the completion (${String(completion)})`);
	await host.close();
});

test("survival: a kill after launch intent, before spawn, launches the command once when work resumes", async () => {
	const { store, cwd } = family("kill-intent");
	const first = new ChatHost(store, cwd, { env: { PI_DURABLE_CRASH_AT: "bash.intent" } });
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Once", command: "echo x >> launches.log; echo out", foreground: true }) }).catch(() => {});
	await first.exited;
	assert.equal(launches(cwd), 0, "the kill came before the spawn");
	const second = new ChatHost(store, cwd);
	await second.ready;
	assert.ok(((await second.call<Status>("status")).warnings ?? []).length > 0, "restored paused");
	await second.call("prompt", { operationId: "op-2", text: "next" });
	const end = await toolEnd(second);
	assert.equal(end.isError, false);
	assert.equal(String(end.text), "out\n");
	await second.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === "ok: next", "the next answer");
	assert.equal(launches(cwd), 1);
	assert.equal((await second.call<Status>("status")).unresolvedEffects, undefined, "nothing to reconcile");
	await second.close();
});

test("survival: a kill after spawn, before the result, reattaches to the live runner; launched once", async () => {
	const { store, cwd } = family("kill-spawn");
	const first = new ChatHost(store, cwd, { env: { PI_DURABLE_CRASH_AT: "bash.spawned" } });
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Once", command: "echo x >> launches.log; sleep 1.5; echo out", foreground: true }) }).catch(() => {});
	await first.exited;
	await waitFor(() => launches(cwd) === 1, "the runner running the command");
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-2", text: "next" });
	const end = await toolEnd(second);
	assert.equal(end.isError, false);
	assert.equal(String(end.text), "out\n");
	await second.until((e) => e.type === "message.end" && textOf((e.message as Message).content) === "ok: next", "the next answer");
	assert.equal(launches(cwd), 1, "never launched twice");
	await second.close();
});

test("survival: a kill after completion admission delivers the completion once", async () => {
	const { store, cwd } = family("kill-admitted");
	const first = new ChatHost(store, cwd, { env: { PI_DURABLE_CRASH_AT: "bash.admitted" } });
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Once", command: "echo x >> launches.log; echo out" }) });
	await first.exited;
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-2", text: "next" });
	await second.until(() => completionRequests(store) >= 1 && logged(store).some((l) => l.label === "next"), "the completion and the next input");
	await new Promise((resolve) => setTimeout(resolve, 1500));
	assert.equal((await completions(second)).length, 1, "one completion message");
	assert.equal(completionRequests(store), 1, "one completion turn");
	assert.equal(launches(cwd), 1);
	await second.close();
});

test("survival: a job that finishes while its host is gone delivers its completion once on reopen, without user input", async () => {
	const { store, cwd } = family("host-loss");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Outlives host", command: "echo x >> launches.log; sleep 1; echo survived" }) });
	const id = jobId((await toolEnd(first)).text);
	await first.idle(1);
	// The detached runner claims the job when its process starts, after the tool returned; a loaded machine delays that.
	await waitFor(() => existsSync(join(JOBS, id, "claim")), "the runner's claim");
	await first.kill();
	assert.equal(alive(claim(id).pid), true, "the runner outlives the host");
	await waitFor(() => exitRecord(id) !== undefined, "the job finishing while the host is gone");
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.until(() => completionRequests(store) === 1, "the completion after reopen");
	const [completion] = await completions(second);
	assert.match(textOf(completion!.content), /complete \(exit 0\)[\s\S]*survived/);
	await second.idle(1);
	await second.kill();
	const third = new ChatHost(store, cwd);
	await third.ready;
	await new Promise((resolve) => setTimeout(resolve, 1500));
	assert.equal((await completions(third)).length, 1, "not delivered again");
	assert.equal(completionRequests(store), 1);
	assert.equal(launches(cwd), 1);
	await third.close();
});

test("survival: a still-running job reattaches by its runner's identity; a runner lost with the machine reports an unknown exit and is never rerun", async () => {
	const { store, cwd } = family("machine-loss");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Long", command: "echo x >> launches.log; sleep 30" }) });
	const id = jobId((await toolEnd(first)).text);
	await first.idle(1);
	await waitFor(() => launches(cwd) === 1, "the launch");
	await first.kill();
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-2", text: call("bash_status", { id }) });
	assert.equal((JSON.parse(String((await toolEnd(second)).text)) as { state: string }[])[0]?.state, "running", "reattached");
	await second.idle(1);
	await second.kill();
	process.kill(-claim(id).pid, "SIGKILL"); // the machine going down takes the runner with it
	const third = new ChatHost(store, cwd);
	await third.ready;
	await third.until(() => completionRequests(store) === 1, "the interrupted completion");
	const [completion] = await completions(third);
	assert.match(textOf(completion!.content), /failed \(exit unknown\)\. The job runner ended without recording an exit status \(interrupted/);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	assert.equal(launches(cwd), 1, "never relaunched");
	await third.close();
});

test("survival: a host shutdown during a foreground wait leaves the job running; an explicit Stop cancels it", async () => {
	const { store, cwd } = family("close-vs-stop");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Survives close", command: "echo x >> launches.log; sleep 2; echo after-close", foreground: true }) });
	await waitFor(() => launches(cwd) === 1, "the launch");
	first.child.kill("SIGTERM");
	assert.equal(await first.exited, 0);
	const id = readdirSync(JOBS).find((name) => readFileSync(join(JOBS, name, "job.json"), "utf8").includes("after-close"))!;
	assert.equal(exitRecord(id), undefined, "a host restart is not a cancel");
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-2", text: "next" });
	const end = await toolEnd(second);
	assert.equal(String(end.text), "after-close\n");
	await second.idle(1);
	await second.call("prompt", { operationId: "op-3", text: call("bash", { description: "Stopped", command: "sleep 30", foreground: true }) });
	await second.until((e) => e.type === "tool.start" && (e.args as { description?: string }).description === "Stopped", "the second call");
	const stoppedId = await new Promise<string>((resolve) => {
		const look = () => {
			const found = readdirSync(JOBS).find((name) => existsSync(join(JOBS, name, "claim")) && readFileSync(join(JOBS, name, "job.json"), "utf8").includes('"Stopped"'));
			if (found === undefined) setTimeout(look, 20);
			else resolve(found);
		};
		look();
	});
	await second.call("abort");
	await waitFor(() => exitRecord(stoppedId)?.cancelled === true, "the cancel record");
	await waitFor(() => !alive(claim(stoppedId).pid), "Stop killing the job");
	const stopped = await toolEnd(second, 2);
	assert.equal(stopped.isError, true, "cancellation is not success");
	assert.equal(launches(cwd), 1);
	await second.close();
});

test("an explicit end cancels the family's background jobs (the runner's whole process group); a lost transport leaves them running", async () => {
	const { store, cwd } = family("end-vs-loss");
	const ticks = join(cwd, "ticks.log");
	const size = () => (existsSync(ticks) ? readFileSync(ticks).length : 0);
	const writing = async () => {
		const before = size();
		await sleep(600);
		return size() > before;
	};
	const first = new ChatHost(store, cwd);
	await first.ready;
	// The writer is a child of the job's shell, so only killing the runner's group stops it.
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Writer", command: "echo x >> launches.log; (while true; do echo tick >> ticks.log; sleep 0.1; done) & wait" }) });
	const id = jobId((await toolEnd(first)).text);
	await first.idle(1);
	await waitFor(() => size() > 0, "the writer");

	// Transport loss: the daemon's channel goes away and the host closes, restart-oriented; the job writes on.
	first.child.disconnect();
	assert.equal(await first.exited, 0);
	assert.equal(await writing(), true, "a lost transport keeps the job");
	assert.equal(alive(claim(id).pid), true);
	assert.equal(exitRecord(id), undefined);

	// The owner ends the Chat: the host cancels the job before it closes; the group is gone and writing stops.
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("close", { end: true });
	assert.equal(await second.exited, 0);
	assert.equal(alive(claim(id).pid), false, "the runner's group is gone");
	assert.equal(exitRecord(id)?.cancelled, true);
	await sleep(300);
	assert.equal(await writing(), false, "the writer stopped");
	assert.equal(launches(cwd), 1);
});

test("--end-jobs ends a Chat whose host is gone: its unfinished jobs are cancelled, the store is not opened, so a finished-undelivered completion wakes no model", async () => {
	const { store, cwd } = family("end-gone");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: call("bash", { description: "Writer", command: "(while true; do echo tick >> ticks.log; sleep 0.1; done) & wait" }) });
	const running = jobId((await toolEnd(first)).text);
	await first.idle(1);
	await first.call("prompt", { operationId: "op-2", text: call("bash", { description: "Short", command: "sleep 1; echo done" }) });
	const finished = jobId((await toolEnd(first, 2)).text);
	await first.idle(2);
	await waitFor(() => existsSync(join(JOBS, running, "claim")) && existsSync(join(JOBS, finished, "claim")), "both runners' claims");
	await first.kill();
	await waitFor(() => exitRecord(finished) !== undefined, "the short job finishing while the host is gone");
	const requests = logged(store).length;

	const ended = spawnSync(process.execPath, [join(import.meta.dirname, "..", "src", "chat-host-main.ts"), "--store", store, "--cwd", cwd, "--model", "faux", "--end-jobs"], { encoding: "utf8", timeout: 30_000 });
	assert.equal(ended.status, 0, ended.stderr);
	assert.equal(exitRecord(running)?.cancelled, true, "the unfinished job is cancelled");
	assert.equal(alive(claim(running).pid), false, "its runner's group is gone");
	assert.equal(exitRecord(finished)?.exitCode, 0, "a finished job keeps its outcome");
	assert.equal(logged(store).length, requests, "no model request");
	assert.equal(completionRequests(store), 0, "no completion delivered");
});

test("an explicit end refuses a bash call already past its intent commit: the late job is cancelled and never runs", async () => {
	const { cwd } = family("end-race");
	const bash = new BackgroundBash({ chatId: "chat-end-race", cwd, rootId: () => "lead" as never, root: JOBS });
	const tool = bash.extension().tools!.find((t) => t.name === "bash")!;
	const doc = { jobs: {} as Record<string, unknown> };
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	let atIntent!: () => void;
	const reachedIntent = new Promise<void>((resolve) => (atIntent = resolve));
	const api = {
		taskId: "task-1", callId: "call-1", conversationId: "lead", now: () => Date.now(),
		snapshot: async (kind: unknown) => (kind === AgentDoc ? { cwd } : kind === BashJobsDoc ? doc : undefined),
		// The intent commit lands, then the call is held before it launches.
		commit: async (fn: (tx: unknown) => Promise<unknown>) => {
			const result = await fn({ doc: async () => doc });
			atIntent();
			await held;
			return result;
		},
		retainedOutput: () => ({ text: "" }),
	};
	// The worst legal interleaving (independent review): a spawned runner runs its command before the parent continues.
	const original = cp.spawn;
	cp.spawn = ((...args: Parameters<typeof cp.spawn>) => {
		const child = original(...args);
		if (Array.isArray(args[1]) && args[1].some((arg) => String(arg).endsWith("runner.mjs")))
			cp.execFileSync(process.execPath, ["-e", "const fs=require('fs');const t=Date.now()+5000;while(!fs.existsSync(process.argv[1])&&Date.now()<t);", join(cwd, "launches.log")]);
		return child;
	}) as typeof cp.spawn;
	syncBuiltinESMExports();
	try {
		const call = (tool.execute as (...args: unknown[]) => Promise<{ output: { text: string }[] }>)({ description: "Late", command: "echo x >> launches.log" }, api, { abortSignal: new AbortController().signal });
		await reachedIntent;
		bash.cancelAll(); // close({ end: true }) sweeps the family's jobs first.
		release();
		const id = jobId((await call).output[0]!.text);
		assert.equal(exitRecord(id)?.cancelled, true, "the late job has a cancelled exit record");
		await sleep(1000);
		assert.equal(launches(cwd), 0, "the command never ran");
	} finally {
		cp.spawn = original;
		syncBuiltinESMExports();
		bash.close();
	}
});

test("write and edit tools meet the write fence of the Chat's commands: its checkout is writable, a folder outside and its git config are not; /full-access lifts it for the lead only", { skip: process.platform !== "darwin" ? "the write fence applies on macOS only" : alreadyFenced() && "already inside a fence, where the host leaves its tools to the outer one; run from an unfenced shell" }, async () => {
	const { store, cwd } = family("write-fence");
	// Outside every grant: this account's own sandbox state, which no fence ever grants (sandbox.mjs).
	const outside = join(userInfo().homedir, ".pi-workbench", "sandbox", `write-fence-test-${String(process.pid)}`);
	// Astra review of 667f26b: the Chat's own write tool goes through the sandboxed helper (chat.ts env factory), seen
	// by a sandbox-exec that logs each call and then runs Apple's.
	const calls = join(ROOT, "sandbox-calls.log");
	const wrapper = join(ROOT, "sandbox-exec-logged");
	writeFileSync(wrapper, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nexec /usr/bin/sandbox-exec "$@"\n`, { mode: 0o755 });
	process.env.PI_SANDBOX_EXEC = wrapper;
	const host = new ChatHost(store, cwd);
	try {
		await host.ready;
	} finally {
		delete process.env.PI_SANDBOX_EXEC;
	}
	await host.call("prompt", { operationId: "op-in", text: call("write", { path: "inside.txt", content: "in" }) });
	const written = await toolEnd(host);
	assert.equal(written.isError, false, String(written.text));
	assert.match(readFileSync(calls, "utf8"), /mkdir -p .* \S*inside\.txt/, "written by the fenced helper");
	await host.call("prompt", { operationId: "op-out", text: call("write", { path: outside, content: "out" }) });
	const refused = await toolEnd(host, 2);
	assert.equal(refused.isError, true);
	assert.match(String(refused.text), /outside this Chat's write folders/);
	await host.call("prompt", { operationId: "op-git", text: call("edit", { path: join(ROOT, ".git", "config"), edits: [{ oldText: "[core]", newText: "[core]\n\thooksPath = /dev/null" }] }) });
	const git = await toolEnd(host, 3);
	assert.equal(git.isError, true);
	assert.match(String(git.text), /outside this Chat's write folders/);
	await host.close();
	assert.equal(readFileSync(join(cwd, "inside.txt"), "utf8"), "in");
	assert.equal(existsSync(outside), false);
	assert.doesNotMatch(readFileSync(join(ROOT, ".git", "config"), "utf8"), /hooksPath/);
	// The owner's switch, as the dialog answers it: the lead's tools write where its commands then may, a Subagent's never.
	const bash = new BackgroundBash({ chatId: "chat-write-fence", cwd, rootId: () => "lead" as never, root: JOBS });
	const away = mkdtempSync(`${outside}-race-`);
	try {
		assert.ok(await bash.writeRefusal(outside, cwd, "lead" as never));
		// D13: the Chat's environment writes in the fence, so a folder swapped for a link after the approval leads nowhere.
		mkdirSync(join(cwd, "sub"));
		assert.equal(await bash.writeRefusal(join(cwd, "sub", "x.txt"), cwd, "lead" as never), undefined);
		rmSync(join(cwd, "sub"), { recursive: true });
		symlinkSync(away, join(cwd, "sub"));
		const raced = await bash.env({ cwd, shellEnv: {} }, "lead" as never).writeFile(join(cwd, "sub", "x.txt"), "x", {} as never);
		assert.equal(raced.ok ? "written" : raced.error.code, "permission_denied");
		assert.deepEqual(readdirSync(away), []);
		// Astra rounds 5-6: codemode's temp folder is made inside the fence (PI_TMP), never in OS temp, and written fenced.
		const piTmp = join(cwd, "pi-tmp");
		const env = bash.env({ cwd, shellEnv: { PI_TMP: piTmp, PI_SANDBOX_EXEC: wrapper } }, "lead" as never);
		const temp = await env.createTempDir("write-fence-", {} as never);
		assert.ok(temp.ok);
		assert.match(temp.value.slice(piTmp.length), /^\/write-fence-[0-9a-f]{12}$/);
		assert.ok(temp.value.startsWith(piTmp));
		assert.equal((await env.writeFile(join(temp.value, "own.txt"), "own", {} as never)).ok, true, "codemode writes its temp folder");
		assert.match(readFileSync(calls, "utf8"), /mkdir -m 700 .* \S*write-fence-[0-9a-f]{12}/, "made by the fenced helper");
		const noTmp = await bash.env({ cwd, shellEnv: { PI_TMP: "" } }, "lead" as never).createTempDir("x-", {} as never);
		assert.equal(noTmp.ok ? "made" : noTmp.error.code, "permission_denied", "no temp folder outside the fence");
		await bash.fullAccess("on", "test", async () => true);
		assert.equal(await bash.writeRefusal(outside, cwd, "lead" as never), undefined);
		assert.ok(await bash.writeRefusal(outside, cwd, "child" as never), "a Subagent stays fenced");
		const child = await bash.env({ cwd, shellEnv: {} }, "child" as never).writeFile(join(cwd, "sub", "x.txt"), "x", {} as never);
		assert.equal(child.ok, false, "a Subagent's writes stay fenced");
		assert.deepEqual(readdirSync(away), []);
	} finally {
		bash.close();
		rmSync(away, { recursive: true, force: true });
	}
});

