import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { removeActivity, upsertActivity } from "../activity/activity.mjs";
import { redact, redactDeep } from "../secret-redaction/redact.mjs";
import { checkpointBarrier } from "../context-checkpoint/checkpoint-barrier.mjs";
import { writeOnce } from "./runner.mjs";

export const MAX_TAIL = 12_000;
const MAX_ACTIVE = 8;
const MAX_RETAINED = 64;
const KEEP_MS = 7 * 24 * 3600_000;
export const MAX_LIFETIME_SECONDS = 12 * 3600;
const RUNNER = fileURLToPath(new URL("./runner.mjs", import.meta.url));
export const defaultRoot = () => process.env.PI_BACKGROUND_BASH_ROOT ?? join(homedir(), ".pi-workbench", "background-bash", "jobs");
export const cleanOutput = (text) => stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } };
const fileSize = (path) => { try { return statSync(path).size; } catch { return 0; } };
function writeJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
function alive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
/** The registered group leader is still this job's runner, not a reused PID. */
export function ownsProcess(job) {
  if (!alive(job.pgid)) return false;
  try { return execFileSync("ps", ["-ww", "-o", "command=", "-p", String(job.pgid)], { encoding: "utf8" }).includes(job.id); }
  catch { return false; }
}
export function readTail(path, size) {
  const length = Math.min(size, MAX_TAIL);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try { readSync(fd, buffer, 0, length, size - length); } finally { closeSync(fd); }
  return buffer.toString("utf8").replace(/^\uFFFD+/u, "");
}

/** A job as tools, status and completions show it. */
export function describeJob(job) {
  return { id: job.id, command: job.command, ...(job.description === undefined ? {} : { description: job.description }), state: job.state, elapsedSeconds: Math.floor(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000), bytes: job.bytes, logPath: job.logPath, ...(job.exitCode === undefined ? {} : { exitCode: job.exitCode }) };
}

/**
 * A finished job's completion message (not yet redacted): state, exit, log path and recent output, the last 20 lines
 * of a success and the whole retained tail otherwise, with truncation disclosed.
 */
export function completionContent(job) {
  const tail = readTail(job.logPath, job.bytes);
  const shown = job.exitCode === 0 ? tail.replace(/\n$/, "").split("\n").slice(-20).join("\n") : tail;
  return `Background bash ${job.id} ${job.state}${job.exitCode === undefined ? " (exit unknown)" : ` (exit ${job.exitCode})`}.${job.error ? ` ${cleanOutput(job.error)}` : ""}\nFull output: ${job.logPath}\n${job.bytes > Buffer.byteLength(tail) ? "[showing recent output only]\n" : ""}${cleanOutput(shown)}`;
}

/** Redacted, control-free command, description and recent output for the Activity drawer. */
export function previewJob(job, chars) {
  // Redact before cutting so a secret split at the edge is still recognized.
  const full = redact(cleanOutput(readTail(job.logPath, job.bytes)));
  let output = full.slice(-chars);
  // Start at a line boundary when the cut fell mid-line.
  if (output.length < full.length && full[full.length - output.length - 1] !== "\n" && output.includes("\n")) output = output.slice(output.indexOf("\n") + 1);
  return { command: redact(cleanOutput(job.command)).slice(0, 240), ...(job.description === undefined ? {} : { description: redact(cleanOutput(job.description)).slice(0, 120) }), output, logPath: job.logPath };
}

const VANISHED = "The job runner ended without recording an exit status";

/**
 * Launch a job under a caller-chosen ID (a host that persisted its launch intent first), idempotently: a job whose
 * runner already claimed it is never started again, and of two runners started for one job only the one that claims
 * it runs the command (runner.mjs). Returns whether a runner was started.
 */
export function launchJob({ root = defaultRoot(), id, command, description, cwd, timeout, env, sessionId, shell = "/bin/bash", args = ["-c"], startedAt, lifetimeSeconds = MAX_LIFETIME_SECONDS }) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid job ID ${id}`);
  const dir = join(root, id);
  if (existsSync(join(dir, "claim")) || existsSync(join(dir, "exit"))) return false;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  closeSync(openSync(join(dir, "output.log"), "a", 0o600));
  writeJson(join(dir, "job.json"), { id, command, description, cwd, sessionId, shell, args, timeout, startedAt, expiresAt: startedAt + (timeout ?? lifetimeSeconds) * 1000 });
  const runner = spawn(process.execPath, [RUNNER, dir], { cwd: dir, detached: true, stdio: "ignore", env });
  runner.once("error", () => {});
  runner.unref();
  return true;
}

/**
 * One job's state from the registry: `pending` before a runner claimed it, `running`, or settled. A claimed job whose
 * runner is gone without an exit record (a machine restart) settles as failed with unknown exit, never rerun.
 */
export function readJob(root, id) {
  if (!/^[\w-]+$/.test(id)) return undefined;
  const dir = join(root, id);
  const record = readJson(join(dir, "job.json"));
  if (record === undefined) return undefined;
  const logPath = join(dir, "output.log");
  const job = { id, command: record.command, ...(typeof record.description === "string" && record.description.trim() !== "" ? { description: record.description } : {}), startedAt: record.startedAt, logPath, dir, bytes: fileSize(logPath), state: "running" };
  let result = readJson(join(dir, "exit"));
  const claim = readJson(join(dir, "claim"));
  if (result === undefined && claim === undefined) return { ...job, state: "pending" };
  if (result === undefined && !ownsProcess({ id, pgid: claim?.pid })) {
    writeOnce(join(dir, "exit"), JSON.stringify({ error: `${VANISHED} (interrupted, for example by a restart of this machine); it was not run again`, finishedAt: Date.now() }));
    result = readJson(join(dir, "exit"));
  }
  if (result === undefined) return { ...job, pid: claim.pid };
  const settled = result.cancelled ? { state: "cancelled" } : result.error !== undefined ? { state: "failed", error: result.error } : { state: result.exitCode === 0 ? "complete" : "failed", exitCode: result.exitCode };
  return { ...job, ...settled, finishedAt: result.finishedAt, bytes: fileSize(logPath) };
}

/** Cancel a job: kill its runner's group only after verifying it is this job's runner; a pending job never starts. */
export function cancelJob(root, id) {
  const job = readJob(root, id);
  if (job === undefined || (job.state !== "running" && job.state !== "pending")) return job;
  if (job.pid !== undefined && ownsProcess({ id, pgid: job.pid })) { try { process.kill(-job.pid, "SIGKILL"); } catch { /* already gone */ } }
  writeOnce(join(job.dir, "exit"), JSON.stringify({ cancelled: true, finishedAt: Date.now() }));
  return readJob(root, id);
}

/**
 * Session-owned background bash jobs. Each job runs under a detached runner (runner.mjs) and is
 * recorded in `<root>/<id>/{job.json,output.log,exit,delivered}`, so it survives shutdown, reload
 * and daemon restarts; `attach(sessionId)` resumes this session's jobs and delivers each completion.
 * `delivered` is written only when Pi starts the completion message (`acknowledge`); until then
 * `attach` and `redeliver` (at agent_settled) resend it, so a dropped queue cannot lose it.
 */
export function createBackgroundBashJobs(pi, { root = defaultRoot(), intervalMs = 5_000, lifetimeSeconds = MAX_LIFETIME_SECONDS, onChange = () => {} } = {}) {
  const jobs = new Map();
  let closed = false;
  let timer;

  const exitPath = (job) => join(job.dir, "exit");

  function activity(job) {
    job.lastActivity = Date.now();
    upsertActivity(pi, {
      id: `background-bash:${job.id}`, kind: "shell", objective: "background bash",
      activity: `running · ${Math.floor((Date.now() - job.startedAt) / 1000)}s · ${job.bytes} bytes output`,
    });
    onChange();
  }

  const describe = describeJob;

  function track(record, dir) {
    const job = { id: record.id, sessionId: record.sessionId, dir, command: record.command, description: typeof record.description === "string" && record.description.trim() !== "" ? record.description : undefined, startedAt: record.startedAt, pgid: record.pgid, logPath: join(dir, "output.log"), state: "running", bytes: 0, lastActivity: 0 };
    jobs.set(job.id, job);
    timer ??= setInterval(() => { for (const job of jobs.values()) check(job); }, intervalMs);
    timer.unref?.();
    return job;
  }

  function settle(job, result) {
    job.finishedAt = result.finishedAt;
    if (result.cancelled) job.state = "cancelled";
    else if (result.error !== undefined) { job.state = "failed"; job.error = result.error; }
    else { job.exitCode = result.exitCode; job.state = result.exitCode === 0 ? "complete" : "failed"; }
    for (const [oldId, oldJob] of jobs) {
      if (jobs.size <= MAX_RETAINED) break;
      if (oldJob.state !== "running") jobs.delete(oldId);
    }
  }

  function deliver(job, retry = false) {
    if (closed || (job.sent && !retry) || existsSync(join(job.dir, "delivered"))) return;
    job.sent = true;
    const content = completionContent(job);
    const triggerTurn = job.state !== "cancelled";
    const send = () => {
      if (closed || existsSync(join(job.dir, "delivered"))) return;
      try {
        pi.sendMessage({
          customType: "background-bash", display: true,
          // Idle, non-triggering completions persist before any extension hook runs, so redact here.
          content: redact(content),
          details: redactDeep(describe(job)),
        }, { triggerTurn, deliverAs: "followUp" });
      } catch (error) {
        console.error(`Background bash ${job.id} could not deliver completion:`, error);
      }
    };
    // A turn-triggering completion must not split an accepted checkpoint; one queued send per job.
    if (!triggerTurn || typeof job.sessionId !== "string" || job.sessionId === "" || !checkpointBarrier(job.sessionId).defer(send, `background-bash:${job.id}`)) send();
  }

  /** Pi started a completion message: persist `delivered` so no later attach resends it. */
  function acknowledge(message) {
    const id = message?.customType === "background-bash" ? message.details?.id : undefined;
    if (typeof id !== "string" || !/^[\w-]+$/.test(id) || !existsSync(join(root, id))) return;
    try { writeFileSync(join(root, id, "delivered"), "", { flag: "wx", mode: 0o600 }); } catch { /* already acknowledged */ }
  }

  /**
   * Resend finished, unacknowledged completions at an idle boundary (agent_settled): their queued
   * follow-up was dropped. Once per job per process: a resend triggers a turn, and a turn that
   * settles without delivering would otherwise resend forever. A later attach resends once more.
   */
  const redelivered = new Set();
  function redeliver() {
    for (const job of jobs.values()) {
      if (job.state === "running" || redelivered.has(job.id)) continue;
      redelivered.add(job.id);
      deliver(job, true);
    }
  }

  function check(job) {
    if (closed || job.state !== "running") return;
    job.bytes = fileSize(job.logPath);
    let result = readJson(exitPath(job));
    if (result === undefined && !alive(job.pgid)) {
      writeOnce(exitPath(job), JSON.stringify({ error: "The job runner ended without recording an exit status", finishedAt: Date.now() }));
      result = readJson(exitPath(job));
    }
    if (result === undefined) {
      if (Date.now() - job.lastActivity >= intervalMs) activity(job);
      return;
    }
    settle(job, result);
    removeActivity(pi, `background-bash:${job.id}`);
    onChange();
    job.waiter?.();
    deliver(job);
  }

  function start(command, cwd, timeout, env, { sessionId, sessionFile, shell = "/bin/bash", args = ["-c"], description } = {}) {
    if (closed) throw new Error("Background bash session has ended");
    if (typeof command !== "string" || command.trim() === "") throw new Error("A non-empty bash command is required");
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2_147_483_647)) throw new Error("Invalid timeout in seconds");
    if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`);
    if ([...jobs.values()].filter((job) => job.state === "running").length >= MAX_ACTIVE) throw new Error("Too many background bash jobs; wait or cancel one before starting another");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const dir = join(root, id);
    mkdirSync(dir, { mode: 0o700 });
    closeSync(openSync(join(dir, "output.log"), "wx", 0o600));
    const startedAt = Date.now();
    const record = { id, command, description, cwd, sessionId, sessionFile, shell, args, timeout, startedAt, expiresAt: startedAt + (timeout ?? lifetimeSeconds) * 1000 };
    writeJson(join(dir, "job.json"), record);
    const runner = spawn(process.execPath, [RUNNER, dir], { cwd: dir, detached: true, stdio: "ignore", env });
    runner.unref();
    const job = track({ ...record, pgid: runner.pid }, dir);
    writeJson(join(dir, "job.json"), { ...record, runnerPid: runner.pid, pgid: runner.pid });
    runner.once("error", (error) => { writeOnce(exitPath(job), JSON.stringify({ error: String(error), finishedAt: Date.now() })); check(job); });
    runner.once("exit", () => { check(job); });
    activity(job);
    return describe(job);
  }

  /** Resume this session's jobs from the registry and prune records finished over a week ago. */
  function attach(sessionId) {
    if (closed) return;
    let ids = [];
    try { ids = readdirSync(root); } catch { return; }
    const owned = [];
    for (const id of ids) {
      const dir = join(root, id);
      const record = readJson(join(dir, "job.json"));
      let ended;
      try { ended = statSync(join(dir, "exit")).mtimeMs; } catch { ended = record?.expiresAt ?? statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? 0; }
      if (Date.now() - ended > KEEP_MS) { rmSync(dir, { recursive: true, force: true }); continue; }
      if (record !== undefined && sessionId !== undefined && record.sessionId === sessionId && !jobs.has(id)) owned.push([record, dir]);
    }
    for (const [record, dir] of owned.sort((a, b) => a[0].startedAt - b[0].startedAt)) {
      const job = track(record, dir);
      job.bytes = fileSize(job.logPath);
      const result = readJson(exitPath(job));
      if (result !== undefined) { settle(job, result); continue; }
      // After a reboot the PID may belong to an unrelated process; never adopt or kill it.
      if (!ownsProcess(job)) job.pgid = undefined;
      activity(job);
    }
    onChange();
    // Deliver completions missed while detached once the session has finished starting.
    setImmediate(() => { for (const job of jobs.values()) if (job.state === "running") check(job); else if (!closed) deliver(job); });
  }

  /**
   * Wait up to `ms` for a job to finish. If it does, claim its completion (no follow-up message)
   * and resolve with its description and output tail; otherwise resolve undefined and let the
   * completion arrive as usual. Aborting `signal` cancels the job.
   */
  function wait(id, ms, signal) {
    const job = jobs.get(id);
    if (job === undefined) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const finish = (claimed) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        job.waiter = undefined;
        resolve(claimed ? { ...describe(job), output: cleanOutput(readTail(job.logPath, job.bytes)), truncated: job.bytes > MAX_TAIL } : undefined);
      };
      job.waiter = () => {
        try { writeFileSync(join(job.dir, "delivered"), "", { flag: "wx", mode: 0o600 }); } catch { return finish(false); }
        finish(true);
      };
      const abort = () => { cancel(id); };
      const timeout = setTimeout(() => finish(false), ms);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else if (job.state !== "running") job.waiter();
    });
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (job?.state === "running") {
      if (ownsProcess(job)) { try { process.kill(-job.pgid, "SIGKILL"); } catch { /* already gone */ } }
      writeOnce(exitPath(job), JSON.stringify({ cancelled: true, finishedAt: Date.now() }));
      check(job);
    }
    return job === undefined ? undefined : describe(job);
  }

  /** Stop watching; jobs keep running and are reattached by the next session start. */
  function shutdown() {
    closed = true;
    clearInterval(timer);
    for (const job of jobs.values()) if (job.state === "running") removeActivity(pi, `background-bash:${job.id}`);
    jobs.clear();
  }

  function preview(id, chars) {
    const job = jobs.get(id);
    return job === undefined ? undefined : previewJob(job, chars);
  }

  return { start, wait, preview, attach, acknowledge, redeliver, cancel, shutdown, list: () => [...jobs.values()].map(describe) };
}
