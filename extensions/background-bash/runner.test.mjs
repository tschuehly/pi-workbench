import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchJob, readJob } from "./jobs.mjs";

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
const dir = mkdtempSync(join(tmpdir(), "pi-background-bash-runner-"));
// `node launch.mjs <released> <out> <stay>` starts a helper in its own session whose environment carries
// PI_MANAGED_COMMAND_RELEASED=<released> instead of the owner marker; the helper starts a child. The launcher waits
// until both exist, then exits, or with <stay> stays the helper's parent inside the job.
const launcher = join(dir, "launch.mjs");
writeFileSync(launcher, `import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
const [released, out, stay] = process.argv.slice(2);
if (released === "--helper") {
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  writeFileSync(out, JSON.stringify([process.pid, child.pid]));
  setTimeout(() => {}, 30_000);
} else {
  const env = { ...process.env, PI_MANAGED_COMMAND_RELEASED: released };
  delete env.PI_MANAGED_COMMAND_OWNER;
  spawn(process.execPath, [process.argv[1], "--helper", out], { detached: true, stdio: "ignore", env }).unref();
  const wait = setInterval(() => { if (existsSync(out)) { clearInterval(wait); if (stay !== "stay") process.exit(0); } }, 10);
  if (stay === "stay") setTimeout(() => {}, 30_000);
}
`);

let n = 0;
async function runJob(command) {
  const root = join(dir, "jobs");
  const id = `runner-${process.pid}-${n++}`;
  launchJob({ root, id, command, description: "Release test", cwd: dir, timeout: 20, env: process.env, sessionId: "runner-test", startedAt: Date.now(), owned: true, cleanupGraceMs: 200 });
  for (const deadline = Date.now() + 15_000; ;) {
    const job = readJob(root, id);
    if (job.state !== "running" && job.state !== "pending") return { id, job };
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish`);
    await sleep(20);
  }
}
async function pidsFrom(out) {
  for (const deadline = Date.now() + 5000; !existsSync(out);) { if (Date.now() > deadline) throw new Error("helper never started"); await sleep(20); }
  return JSON.parse(readFileSync(out, "utf8"));
}
async function gone(pids) {
  for (const deadline = Date.now() + 5000; pids.some(alive);) { if (Date.now() > deadline) return false; await sleep(20); }
  return true;
}
const stop = (pids) => { for (const pid of pids) try { process.kill(pid, "SIGKILL"); } catch {} };

test("a helper released with this job's token outside the group keeps running and is listed by identity only", async (t) => {
  const out = join(dir, "released.json");
  const { job } = await runJob(`node ${launcher} "$PI_MANAGED_COMMAND_OWNER" ${out}`);
  const pids = await pidsFrom(out);
  t.after(() => stop(pids));
  assert.equal(job.state, "complete", job.error);
  assert.ok(pids.every(alive), "helper and its child outlive the job");
  assert.deepEqual(job.cleanup.released.map((p) => p.pid).sort(), [...pids].sort());
  for (const p of job.cleanup.released) assert.deepEqual(Object.keys(p).sort(), ["pid", "start"]);
});

test("a released marker with another job's token does not release", async (t) => {
  const out = join(dir, "other.json");
  const { job } = await runJob(`node ${launcher} other-token ${out} stay & until [ -e ${out} ]; do sleep 0.05; done`);
  const pids = await pidsFrom(out);
  t.after(() => stop(pids));
  assert.match(job.error ?? "", /Shell exited with owned descendants still running/);
  assert.deepEqual(job.cleanup.released, []);
  assert.ok(await gone(pids), "the helper, reached through its owned parent, is stopped");
});

test("a process inside the runner's process group is never released", async () => {
  const out = join(dir, "group.pid");
  const { job } = await runJob(`env -u PI_MANAGED_COMMAND_OWNER PI_MANAGED_COMMAND_RELEASED="$PI_MANAGED_COMMAND_OWNER" sh -c 'echo $$ > ${out}; exec sleep 30' & until [ -s ${out} ]; do sleep 0.05; done`);
  const pid = Number(readFileSync(out, "utf8"));
  assert.match(job.error ?? "", /Shell exited with owned descendants still running/);
  assert.deepEqual(job.cleanup.released, []);
  assert.ok(await gone([pid]), "the group member is stopped");
});
