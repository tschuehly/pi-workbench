// Slice 4 group B: the Workbench `bash` (extensions/background-bash) in a Durable Chat, against the real host process
// (IPC protocol, scripted faux model). Parity rows P071 (foreground), P078 (background by default), P079 bash_status,
// P080 bash_cancel, P081 completion message; survival rows from the plan's "Background bash" row: a kill after launch
// intent, after spawn and after completion admission never launches twice or delivers twice, a host-only loss
// reattaches to the live runner, a machine restart (runner gone) reports an unknown exit and never reruns.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { ChatHost, live, logged, textOf, waitFor } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

type Message = { role: string; customType?: string; content?: unknown; details?: Record<string, unknown>; isError?: boolean };
type Status = { extensionStatuses?: Record<string, string>; warnings?: unknown[]; unresolvedEffects?: unknown[] };

const ROOT = scratch("s4b-bash");
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
