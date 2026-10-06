import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkpointBarrier } from "../context-checkpoint/checkpoint-barrier.mjs";
import { createBackgroundBashJobs } from "./jobs.mjs";

const cwd = process.cwd();
// Completions are redacted; keep the real ~/.pi/agent/auth.json out of tests.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-background-bash-agent-"));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(condition, ms = 10_000) {
  for (const deadline = Date.now() + ms; !condition();) {
    if (Date.now() > deadline) throw new Error(`condition not met: ${condition}`);
    await sleep(20);
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
const groupAlive = (pgid) => { try { process.kill(-pgid, 0); return true; } catch (error) { return error.code === "EPERM"; } };

function fixture(root = mkdtempSync(join(tmpdir(), "pi-background-bash-"))) {
  const events = [];
  const messages = [];
  const pi = { events: { emit: (_name, value) => events.push(value) }, sendMessage: (message, options) => messages.push({ message, options }) };
  const make = (options = {}) => createBackgroundBashJobs(pi, { root, intervalMs: 50, ...options });
  return { root, pi, events, messages, make };
}
const record = (root, id) => JSON.parse(readFileSync(join(root, id, "job.json"), "utf8"));

test("background bash returns before completion, reports progress, and delivers exit and output", async () => {
  const { events, messages, make } = fixture();
  const jobs = make();
  const job = jobs.start("printf '\\033[31mgate running\\033[0m\\n'; sleep 0.3; exit 3", cwd, 30, undefined, { sessionId: "s1" });
  assert.equal(job.state, "running");
  assert.equal(messages.length, 0);
  assert.ok(events.some((event) => event.type === "upsert" && event.item.id === `background-bash:${job.id}` && event.item.objective === "background bash"));
  await until(() => messages.length === 1);
  assert.equal(jobs.list()[0].state, "failed");
  assert.equal(jobs.list()[0].bytes, Buffer.byteLength("\u001b[31mgate running\u001b[0m\n"));
  assert.equal(readFileSync(job.logPath, "utf8"), "\u001b[31mgate running\u001b[0m\n");
  assert.match(messages[0].message.content, /failed \(exit 3\)/);
  assert.match(messages[0].message.content, /gate running/);
  assert.doesNotMatch(messages[0].message.content, /\u001b/);
  assert.deepEqual(messages[0].options, { triggerTurn: true, deliverAs: "followUp" });
  assert.ok(events.some((event) => event.type === "remove" && event.id === `background-bash:${job.id}`));
  jobs.shutdown();
  assert.equal(existsSync(job.logPath), true, "logs outlive the session");
});

test("completion output and command are redacted before delivery", async () => {
  const { messages, make } = fixture();
  const jobs = make();
  const secret = "ghp_" + "S".repeat(36);
  process.env.SYNTHETIC_BG_TOKEN = "bgSecretValue1234567890";
  try {
    jobs.start(`echo ${secret} $SYNTHETIC_BG_TOKEN`, cwd, 30, undefined, { sessionId: "s1" });
    await until(() => messages.length === 1);
  } finally { delete process.env.SYNTHETIC_BG_TOKEN; }
  const { content, details } = messages[0].message;
  assert.match(content, /\[REDACTED:github-token\] \[REDACTED:env:SYNTHETIC_BG_TOKEN\]/);
  assert.doesNotMatch(content, /S{36}|bgSecretValue/);
  assert.equal(details.command, "echo [REDACTED:github-token] $SYNTHETIC_BG_TOKEN");
  jobs.shutdown();
});

test("successful completions send only the last 20 lines while failures retain the larger tail", async () => {
  const { messages, make } = fixture();
  const jobs = make();
  jobs.start("for i in $(seq 0 34); do echo line $i; done", cwd, undefined, undefined, { sessionId: "s1" });
  jobs.start("for i in $(seq 0 34); do echo line $i; done; exit 2", cwd, undefined, undefined, { sessionId: "s1" });
  await until(() => messages.length === 2);
  const success = messages.find((m) => /complete \(exit 0\)/.test(m.message.content)).message.content;
  assert.match(success, /line 34/);
  assert.doesNotMatch(success, /line 14\n/);
  assert.match(success, /line 15/);
  assert.match(success, /Full output: .*output\.log/);
  assert.match(messages.find((m) => /exit 2/.test(m.message.content)).message.content, /line 0\n/);
  jobs.shutdown();
});

test("registry files are private", async () => {
  const { root, messages, make } = fixture(join(mkdtempSync(join(tmpdir(), "pi-background-bash-")), "nested", "jobs"));
  const jobs = make();
  const job = jobs.start("echo private", cwd, undefined, undefined, { sessionId: "s1" });
  await until(() => messages.length === 1);
  jobs.acknowledge(messages[0].message);
  const mode = (path) => statSync(path).mode & 0o777;
  assert.equal(mode(root), 0o700);
  assert.equal(mode(join(root, job.id)), 0o700);
  for (const file of ["job.json", "output.log", "exit", "delivered"]) assert.equal(mode(join(root, job.id, file)), 0o600, file);
  jobs.shutdown();
});

test("a job keeps running after shutdown; a new instance for the same owner reattaches, reports status, and cancels it", async () => {
  const fx = fixture();
  const first = fx.make();
  const job = first.start("sleep 30", cwd, undefined, undefined, { sessionId: "owner", description: "Wait half a minute" });
  const { pgid } = record(fx.root, job.id);
  assert.equal(record(fx.root, job.id).description, "Wait half a minute");
  first.shutdown();
  assert.ok(fx.events.some((event) => event.type === "remove" && event.id === `background-bash:${job.id}`), "shutdown clears Activity");
  await sleep(200);
  assert.equal(groupAlive(pgid), true, "the job survives its jobs instance");
  assert.equal(fx.messages.length, 0);

  const stranger = fx.make();
  stranger.attach("someone-else");
  assert.deepEqual(stranger.list(), []);
  stranger.shutdown();

  const second = fx.make();
  second.attach("owner");
  assert.equal(second.list().length, 1);
  assert.equal(second.list()[0].state, "running");
  assert.equal(second.list()[0].id, job.id);
  assert.equal(second.list()[0].description, "Wait half a minute", "the description survives reattach");
  assert.equal(second.cancel(job.id).state, "cancelled");
  await until(() => !groupAlive(pgid));
  assert.equal(fx.messages.length, 1);
  assert.match(fx.messages[0].message.content, /cancelled/);
  assert.equal(fx.messages[0].message.details.description, "Wait half a minute");
  assert.deepEqual(fx.messages[0].options, { triggerTurn: false, deliverAs: "followUp" });
  second.shutdown();
});

test("a job finishing while detached delivers its completion exactly once on reattach", async () => {
  const fx = fixture();
  const first = fx.make();
  const job = first.start("sleep 0.2; echo finished-while-away", cwd, undefined, undefined, { sessionId: "owner" });
  first.shutdown();
  await until(() => existsSync(join(fx.root, job.id, "exit")));
  assert.equal(fx.messages.length, 0);
  const second = fx.make();
  second.attach("owner");
  await until(() => fx.messages.length === 1);
  second.acknowledge(fx.messages[0].message);
  const third = fx.make();
  third.attach("owner");
  await sleep(50);
  assert.equal(fx.messages.length, 1);
  assert.match(fx.messages[0].message.content, /complete \(exit 0\)[\s\S]*finished-while-away/);
  assert.equal(third.list()[0].state, "complete");
  second.shutdown();
  third.shutdown();
  const fourth = fx.make();
  fourth.attach("owner");
  await sleep(50);
  assert.equal(fx.messages.length, 1);
  fourth.shutdown();
});

test("a completion stays undelivered until Pi starts its message and is resent after a dropped queue", async () => {
  const fx = fixture();
  const first = fx.make();
  const job = first.start("echo dropped", cwd, undefined, undefined, { sessionId: "owner" });
  await until(() => fx.messages.length === 1);
  const marker = join(fx.root, job.id, "delivered");
  assert.equal(existsSync(marker), false, "sendMessage only queues; it is not delivery");
  first.redeliver(); // agent_settled after the queued follow-up was cleared
  assert.equal(fx.messages.length, 2);
  first.shutdown(); // daemon dies before consuming it
  const second = fx.make();
  second.attach("owner");
  await until(() => fx.messages.length === 3);
  assert.match(fx.messages[2].message.content, /dropped/);
  second.acknowledge({ customType: "other", details: { id: job.id } });
  assert.equal(existsSync(marker), false);
  second.acknowledge(fx.messages[2].message);
  assert.equal(existsSync(marker), true);
  second.redeliver();
  second.shutdown();
  const third = fx.make();
  third.attach("owner");
  await sleep(50);
  assert.equal(fx.messages.length, 3, "an acknowledged completion is never resent");
  third.shutdown();
});

test("a completion during an open checkpoint barrier waits for its release", async () => {
  const fx = fixture();
  const barrier = checkpointBarrier("checkpointing");
  barrier.open();
  const jobs = fx.make();
  const job = jobs.start("echo after-checkpoint", cwd, undefined, undefined, { sessionId: "checkpointing" });
  await until(() => jobs.list()[0].state === "complete");
  jobs.redeliver();
  assert.equal(fx.messages.length, 0);
  assert.equal(barrier.queuedCount, 1, "one queued send per job");
  assert.equal(barrier.release(), 1);
  assert.equal(fx.messages.length, 1);
  assert.match(fx.messages[0].message.content, new RegExp(`${job.id} complete[\\s\\S]*after-checkpoint`));
  jobs.shutdown();
});

test("the maximum lifetime kills the whole process group", async () => {
  const fx = fixture();
  const jobs = fx.make({ lifetimeSeconds: 2 }); // room for the shell to record the grandchild PID under load
  const pidFile = join(fx.root, "grandchild.pid");
  const job = jobs.start(`sleep 30 & echo $! > ${pidFile}; sleep 30`, cwd, undefined, undefined, { sessionId: "s1" });
  const { pgid } = record(fx.root, job.id);
  await until(() => fx.messages.length === 1);
  assert.match(fx.messages[0].message.content, /failed \(exit unknown\)\. Stopped at the 2-second maximum lifetime/);
  const grandchild = Number(readFileSync(pidFile, "utf8"));
  await until(() => !alive(grandchild) && !groupAlive(pgid));
  jobs.shutdown();

  const timed = fx.make();
  timed.start("sleep 30", cwd, 0.3, undefined, { sessionId: "s1" });
  await until(() => fx.messages.length === 2);
  assert.match(fx.messages[1].message.content, /Timed out after 0\.3 seconds/);
  timed.shutdown();
});

test("reattach reports a vanished runner, keeps bounded history, and prunes week-old records", async () => {
  const fx = fixture();
  const old = Date.now() - 8 * 24 * 3600_000;
  const write = (id, job, exit) => {
    mkdirSync(join(fx.root, id), { recursive: true });
    writeFileSync(join(fx.root, id, "job.json"), JSON.stringify({ id, command: "x", sessionId: "owner", startedAt: Date.now(), expiresAt: Date.now() + 60_000, ...job }));
    writeFileSync(join(fx.root, id, "output.log"), "");
    if (exit) writeFileSync(join(fx.root, id, "exit"), JSON.stringify({ exitCode: 0, finishedAt: Date.now() }));
    if (exit) writeFileSync(join(fx.root, id, "delivered"), "");
  };
  write("vanished", { pgid: 2 ** 22 + 12345 }, false);
  for (let index = 0; index < 70; index++) write(`done-${index}`, { startedAt: index }, true);
  write("stale", { sessionId: "other" }, true);
  utimesSync(join(fx.root, "stale", "exit"), old / 1000, old / 1000);
  const jobs = fx.make();
  jobs.attach("owner");
  await until(() => fx.messages.length === 1);
  assert.match(fx.messages[0].message.content, /vanished failed \(exit unknown\)\. The job runner ended without recording an exit status/);
  assert.equal(jobs.list().length, 64);
  assert.equal("description" in jobs.list()[0], false, "records from before descriptions still load");
  assert.equal(existsSync(join(fx.root, "stale")), false);
  jobs.shutdown();
});

test("background timeout validation and concurrency are bounded", async () => {
  const fx = fixture();
  const jobs = fx.make();
  assert.throws(() => jobs.start("test", cwd, 0, undefined, {}), /Invalid timeout/);
  assert.throws(() => jobs.start("test", join(fx.root, "missing"), undefined, undefined, {}), /Working directory does not exist/);
  const started = [];
  for (let i = 0; i < 8; i++) started.push(jobs.start("sleep 30", cwd, undefined, undefined, { sessionId: "s1" }));
  assert.throws(() => jobs.start("ninth", cwd, undefined, undefined, {}), /Too many/);
  for (const job of started) jobs.cancel(job.id);
  jobs.shutdown();
});

test("wait claims a fast completion and leaves a slow one to normal delivery", async () => {
  const { messages, make } = fixture();
  const jobs = make();
  const fast = jobs.start("printf done", cwd, 30, undefined, { sessionId: "s1" });
  const claimed = await jobs.wait(fast.id, 5_000);
  assert.equal(claimed.state, "complete");
  assert.equal(claimed.output, "done");
  await sleep(200);
  assert.equal(messages.length, 0, "a claimed completion sends no follow-up");
  const slow = jobs.start("sleep 0.5; printf late", cwd, 30, undefined, { sessionId: "s1" });
  assert.equal(await jobs.wait(slow.id, 50), undefined);
  await until(() => messages.length === 1);
  assert.match(messages[0].message.content, /late/);
  const controller = new AbortController();
  const aborted = jobs.start("sleep 30", cwd, 60, undefined, { sessionId: "s1" });
  const waiting = jobs.wait(aborted.id, 5_000, controller.signal);
  controller.abort();
  assert.equal((await waiting).state, "cancelled");
  jobs.shutdown();
});

test("preview shows the redacted command and the redacted end of the output", async () => {
  const { make } = fixture();
  const jobs = make();
  const secret = "sk-ant-" + "b".repeat(24);
  const job = jobs.start(`printf 'early\\nkey ${secret}\\nlast line'; sleep 30`, cwd, 60, undefined, { sessionId: "s1" });
  await until(() => jobs.list()[0].bytes > 0);
  const shown = jobs.preview(job.id, 20);
  assert.doesNotMatch(JSON.stringify(shown), /b{24}/);
  assert.equal(shown.output, "last line", "a cut tail starts at a line boundary");
  assert.equal(shown.logPath, job.logPath);
  jobs.cancel(job.id);
  jobs.shutdown();
});
