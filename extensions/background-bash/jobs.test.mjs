import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { createBackgroundBashJobs } from "./jobs.mjs";

const tick = () => new Promise((resolve) => { setImmediate(resolve); });

function fixture() {
  const events = [];
  const messages = [];
  const pi = { events: { emit: (_name, value) => events.push(value) }, sendMessage: (message, options) => messages.push({ message, options }) };
  return { pi, events, messages };
}

test("background bash returns before completion, reports progress, and delivers exit and output", async () => {
  const { pi, events, messages } = fixture();
  let finish;
  const operations = { exec: (_command, _cwd, { onData }) => new Promise((resolve) => { onData(Buffer.from("\u001b[31mgate running\u001b[0m\n")); finish = resolve; }) };
  const jobs = createBackgroundBashJobs(pi, operations, { intervalMs: 5, now: () => 10_000 });
  const job = jobs.start("gate", "/repo", 30, {});
  assert.equal(job.state, "running");
  assert.equal(messages.length, 0);
  assert.ok(events.some((event) => event.type === "upsert" && event.item.id === `background-bash:${job.id}` && event.item.objective === "background bash"));
  await tick();
  assert.equal(jobs.list()[0].bytes, Buffer.byteLength("\u001b[31mgate running\u001b[0m\n"));
  assert.equal(readFileSync(job.logPath, "utf8"), "\u001b[31mgate running\u001b[0m\n");
  finish({ exitCode: 3 });
  await tick();
  assert.equal(jobs.list()[0].state, "failed");
  assert.match(messages[0].message.content, /failed \(exit 3\)/);
  assert.match(messages[0].message.content, /gate running/);
  assert.doesNotMatch(messages[0].message.content, /\u001b/);
  assert.deepEqual(messages[0].options, { triggerTurn: true, deliverAs: "followUp" });
  assert.ok(events.some((event) => event.type === "remove" && event.id === `background-bash:${job.id}`));
  await jobs.shutdown();
  assert.equal(existsSync(job.logPath), false);
});

test("successful completions send only the last 20 lines while failures retain the larger tail", async () => {
  const { pi, messages } = fixture();
  const output = Array.from({ length: 35 }, (_, index) => `line ${index}`).join("\n");
  const jobs = createBackgroundBashJobs(pi, { exec: async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode: 0 }; } });
  jobs.start("long success", "/repo", undefined, {});
  await tick();
  assert.match(messages[0].message.content, /line 34/);
  assert.doesNotMatch(messages[0].message.content, /line 14(?:\n|$)/);
  assert.match(messages[0].message.content, /line 15/);
  assert.match(messages[0].message.content, /Background bash .* complete \(exit 0\)/);
  assert.match(messages[0].message.content, /Full output .*\.log/);
  await jobs.shutdown();

  const failed = fixture();
  const failedJobs = createBackgroundBashJobs(failed.pi, { exec: async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode: 2 }; } });
  failedJobs.start("long failure", "/repo", undefined, {});
  await tick();
  assert.match(failed.messages[0].message.content, /line 0/);
  await failedJobs.shutdown();
});

test("a shell with no exit code reports unknown status rather than fabricating exit 1", async () => {
  const { pi, messages } = fixture();
  const jobs = createBackgroundBashJobs(pi, { exec: async () => ({ exitCode: null }) });
  jobs.start("terminated", "/repo", undefined, {});
  await tick();
  assert.match(messages[0].message.content, /failed \(exit unknown\)\. Shell exited without an exit code/);
  assert.doesNotMatch(messages[0].message.content, /exit 1/);
  await jobs.shutdown();
});

test("finished job history stays bounded in long sessions", async () => {
  const { pi } = fixture();
  const jobs = createBackgroundBashJobs(pi, { exec: async () => ({ exitCode: 0 }) });
  for (let index = 0; index < 65; index++) {
    jobs.start("true", "/repo", undefined, {});
    await tick();
  }
  assert.equal(jobs.list().length, 64);
  await jobs.shutdown();
});

test("session shutdown cancels running jobs without waking the old session", async () => {
  const { pi, messages } = fixture();
  let cancelled = false;
  const operations = { exec: (_command, _cwd, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { cancelled = true; reject(new Error("aborted")); }, { once: true });
  }) };
  const jobs = createBackgroundBashJobs(pi, operations);
  const job = jobs.start("slow", "/repo", undefined, {});
  await tick();
  await jobs.shutdown();
  assert.equal(cancelled, true);
  assert.equal(messages.length, 0);
  assert.equal(existsSync(job.logPath), false);
});

test("cancelling a job does not start an unsolicited model turn", async () => {
  const { pi, messages } = fixture();
  let delivered;
  const completed = new Promise((resolve) => { delivered = resolve; });
  pi.sendMessage = (message, options) => { messages.push({ message, options }); delivered(); };
  const operations = { exec: (_command, _cwd, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }) };
  const jobs = createBackgroundBashJobs(pi, operations);
  const job = jobs.start("slow", "/repo", undefined, {});
  await tick();
  jobs.cancel(job.id);
  await completed;
  assert.equal(jobs.list()[0].state, "cancelled");
  assert.deepEqual(messages[0].options, { triggerTurn: false, deliverAs: "followUp" });
  await jobs.shutdown();
});

test("background timeout validation and concurrency are bounded", async () => {
  const { pi } = fixture();
  const operations = { exec: (_command, _cwd, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) };
  const jobs = createBackgroundBashJobs(pi, operations);
  assert.throws(() => jobs.start("test", "/repo", 0, {}), /Invalid timeout/);
  for (let i = 0; i < 8; i++) jobs.start(`job ${i}`, "/repo", undefined, {});
  assert.throws(() => jobs.start("ninth", "/repo", undefined, {}), /Too many/);
  await tick();
  await jobs.shutdown();
});
