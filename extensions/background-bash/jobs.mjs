import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { removeActivity, upsertActivity } from "../activity/activity.mjs";
import { redact, redactDeep, redactGrowing } from "../secret-redaction/redact.mjs";
import { checkpointBarrier } from "../context-checkpoint/checkpoint-barrier.mjs";
import { writeOnce } from "./runner.mjs";
import { nodeBin } from "./node-bin.mjs";

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
  // A cut tail is read with up to 16 KB before it, so key blocks are found in continuous text, delimiters whole.
  // shortcut: a key block that starts more than 16 KB before the cut and never ends there is not recognized.
  const back = Math.min(size - length, 16 * 1024);
  const buffer = Buffer.alloc(back + length);
  const fd = openSync(path, "r");
  try { readSync(fd, buffer, 0, back + length, size - length - back); } finally { closeSync(fd); }
  const tail = buffer.subarray(back).toString("utf8").replace(/^\uFFFD+/u, "");
  if (length === size) return tail;
  // Key boundaries are found in the text as the redactor will see it: terminal codes stripped (`cleanOutput`).
  return dropCutHead(cleanOutput(buffer.toString("utf8")), cleanOutput(tail).length);
}

const KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;
/** A private-key block, or one that never ends (to the end of the text). */
const KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

/**
 * The last `tailLength` characters of `text`, cut where no redactor would recognize a secret: a private-key block the
 * cut runs through is masked up to its end; otherwise the cut token is dropped, and the rest of a key block whose
 * header lies beyond the text read.
 */
function dropCutHead(text, tailLength) {
  // A tail cut inside a terminal code cleans to more text than the whole log's suffix: never past the start.
  const cut = Math.max(0, text.length - tailLength);
  // The cut token is dropped below, so a key whose header overlaps it (or starts exactly at the cut) is masked too.
  const token = cut + (/^\S*/.exec(text.slice(cut))?.[0].length ?? 0);
  for (const block of text.matchAll(KEY_BLOCK)) {
    const end = block.index + block[0].length;
    if (block.index < token && end > cut) return `[REDACTED:private-key]${text.slice(end)}`;
  }
  const rest = text.slice(cut).replace(/^\S+/, "");
  const end = KEY_END.exec(rest);
  return end !== null && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(rest.slice(0, end.index)) ? rest.slice(end.index + end[0].length) : rest;
}

/** For a finished log, which will not grow: also masks a private-key block that never ended. */
const sealedRedact = (text) => redact(text).replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/, "[REDACTED:private-key]");

/** A job as tools, status and completions show it. */
export function describeJob(job) {
  return { id: job.id, command: job.command, ...(job.description === undefined ? {} : { description: job.description }), state: job.state, elapsedSeconds: Math.floor(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000), bytes: job.bytes, logPath: job.logPath, ...(job.owned ? { startedAt: job.startedAt, expiresAt: job.expiresAt, lastOutputAt: job.lastOutputAt, ...(job.error === undefined ? {} : { error: job.error }), ...(job.cleanup === undefined ? {} : { cleanup: job.cleanup }) } : {}), ...(job.exitCode === undefined ? {} : { exitCode: job.exitCode }) };
}

/**
 * A finished job's completion message (its header not yet redacted): state, exit, log path and recent output, the last
 * 20 lines of a success and the whole retained tail otherwise, with truncation disclosed. The output is sanitized
 * before lines are dropped, so a cut never separates a secret from the part the redactor recognizes it by.
 */
export function completionContent(job, sanitize = sealedRedact) {
  const tail = readTail(job.logPath, job.bytes);
  const clean = sanitize(cleanOutput(tail));
  const shown = job.exitCode === 0 ? clean.replace(/\n$/, "").split("\n").slice(-20).join("\n") : clean;
  return `Background bash ${job.id} ${job.state}${job.exitCode === undefined ? " (exit unknown)" : ` (exit ${job.exitCode})`}.${job.error ? ` ${cleanOutput(job.error)}` : ""}\nFull output: ${job.logPath}\n${job.bytes > Buffer.byteLength(tail) ? "[showing recent output only]\n" : ""}${shown}`;
}

/** Redacted, control-free command, description and recent output for the Activity drawer. */
export function previewJob(job, chars) {
  // Redact before cutting so a secret split at the edge is still recognized. The log may still grow: a trailing fragment
  // of a secret is masked, since this preview is published now and a later redaction cannot retract it.
  const full = redactGrowing(cleanOutput(readTail(job.logPath, job.bytes)));
  let output = full.slice(-chars);
  // Start at a line boundary when the cut fell mid-line.
  if (output.length < full.length && full[full.length - output.length - 1] !== "\n" && output.includes("\n")) output = output.slice(output.indexOf("\n") + 1);
  return { command: redact(cleanOutput(job.command)).slice(0, 240), ...(job.description === undefined ? {} : { description: redact(cleanOutput(job.description)).slice(0, 120) }), output, logPath: job.logPath };
}

export const VANISHED = "The job runner ended without recording an exit status";

/**
 * Launch a job under a caller-chosen ID (a host that persisted its launch intent first), idempotently: a job whose
 * runner already claimed it is never started again, and of two runners started for one job only the one that claims
 * it runs the command (runner.mjs). Returns whether a runner was started. `cancelled`: record the job as cancelled
 * without starting a runner (its owner ended meanwhile).
 */
export function launchJob({ root = defaultRoot(), id, command, description, cwd, timeout, env, sessionId, shell = "/bin/bash", args = ["-c"], startedAt, expiresAt = NaN, owned = false, ownerExecutionId = "", progressLog = "", cleanupGraceMs = 1000, runnerPath = RUNNER, lifetimeSeconds = MAX_LIFETIME_SECONDS, cancelled = false, fullAccess = false, prepare = false, prepared = false }) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid job ID ${id}`);
  const dir = join(root, id);
  if (existsSync(join(dir, "claim")) || existsSync(join(dir, "exit"))) return false;
  // `prepared`: start only the record made by an earlier `prepare` call; a lost record is never made again (throws).
  if (prepared) {
    if (!existsSync(join(dir, "job.json"))) throw new Error(`The record of job ${id} is gone; it is not started again`);
  } else mkdirSync(dir, { recursive: true, mode: 0o700 });
  closeSync(openSync(join(dir, "output.log"), prepared ? "r" : "a", 0o600));
  // An admitted deadline is immutable, even when a host dies before the runner claims it.
  if (!prepared && !existsSync(join(dir, "job.json"))) writeOnce(join(dir, "job.json"), JSON.stringify({ id, command, description, cwd, sessionId, shell, args, timeout, startedAt, expiresAt: Number.isFinite(expiresAt) ? expiresAt : startedAt + (timeout ?? lifetimeSeconds) * 1000, ...(owned ? { owned, ownerExecutionId, progressLog, cleanupGraceMs } : {}), ...(fullAccess === true ? { fullAccess: true } : {}) }));
  // `prepare`: only the record, for a caller that commits its own reference to the job before the runner starts.
  if (prepare) return false;
  if (cancelled) {
    writeOnce(join(dir, "exit"), JSON.stringify({ cancelled: true, finishedAt: Date.now(), ...(owned ? { cleanup: { survivors: [] } } : {}) }));
    return false;
  }
  // --disable-sigusr1: no debugger a signal could open in this unfenced process (the fence also denies such signals).
  const runner = spawn(process.execPath, ["--disable-sigusr1", runnerPath, dir], { cwd: dir, detached: true, stdio: "ignore", env });
  // A job folder removed meanwhile (a lost registry) has nowhere to record the failure, and nothing ran.
  const settle = (result) => { try { writeOnce(join(dir, "exit"), JSON.stringify(result)); } catch (error) { if (error.code !== "ENOENT") throw error; } };
  runner.once("error", (error) => settle({ error: `Runner could not start: ${String(error)}`, finishedAt: Date.now() }));
  runner.once("exit", () => {
    // No claim means no shell could have run. Never leave the blocking tool waiting on a dead pre-claim runner.
    if (owned && !existsSync(join(dir, "claim"))) settle({ error: "Runner ended before claiming the command; it was not run again", finishedAt: Date.now(), cleanup: { survivors: [] } });
  });
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
  const lastOutputAt = Math.max(record.startedAt, ...[logPath, ...(record.owned && record.progressLog ? [joinPath(record.cwd, record.progressLog)] : [])].map((path) => { try { const stat = statSync(path); return stat.size > 0 ? stat.mtimeMs : 0; } catch { return 0; } }));
  // Sampled before the claim is read: a claim missing then and a deadline already past mean no runner may still start it.
  const now = Date.now();
  const job = { id, expiresAt: record.expiresAt, lastOutputAt, ...(record.owned ? { owned: true } : {}), command: record.command, ...(typeof record.description === "string" && record.description.trim() !== "" ? { description: record.description } : {}), startedAt: record.startedAt, logPath, dir, bytes: fileSize(logPath), state: "running" };
  let result = readJson(join(dir, "exit"));
  const claim = readJson(join(dir, "claim"));
  if (result === undefined && claim === undefined) {
    if (now < record.expiresAt) return { ...job, state: "pending" };
    // The launching host may have died before observing a pre-claim runner failure. Its committed expiry still wins.
    writeOnce(join(dir, "exit"), JSON.stringify({ error: `Timed out after ${record.timeout ?? Math.round((record.expiresAt - record.startedAt) / 1000)} seconds before launch; runner admission was not observed`, finishedAt: Date.now(), ...(record.owned ? { cleanup: { survivors: [] } } : {}) }));
    result = readJson(join(dir, "exit"));
  }
  if (result === undefined && !ownsProcess({ id, pgid: claim?.pid })) {
    writeOnce(join(dir, "exit"), JSON.stringify({ error: `${VANISHED} (interrupted, for example by a restart of this machine); it was not run again`, finishedAt: Date.now() }));
    result = readJson(join(dir, "exit"));
  }
  if (result === undefined) return { ...job, pid: claim.pid };
  const settled = result.cancelled ? { state: "cancelled" } : result.error !== undefined ? { state: "failed", error: result.error } : { state: result.exitCode === 0 ? "complete" : "failed", exitCode: result.exitCode };
  return { ...job, ...settled, finishedAt: result.finishedAt, ...(result.cleanup === undefined ? {} : { cleanup: result.cleanup }), bytes: fileSize(logPath) };
}

/** Cancel a job: kill its runner's group only after verifying it is this job's runner; a pending job never starts. */
export function cancelJob(root, id) {
  const job = readJob(root, id);
  if (job === undefined || (job.state !== "running" && job.state !== "pending")) return job;
  if (job.owned) {
    // The runner owns TERM -> grace -> KILL and writes the result only after checking descendants.
    writeOnce(join(job.dir, "cancel"), "");
    return readJob(root, id);
  }
  if (job.pid !== undefined && ownsProcess({ id, pgid: job.pid })) { try { process.kill(-job.pid, "SIGKILL"); } catch { /* already gone */ } }
  writeOnce(join(job.dir, "exit"), JSON.stringify({ cancelled: true, finishedAt: Date.now() }));
  return readJob(root, id);
}

/**
 * Session-owned background bash jobs. Each job runs under a detached runner (runner.mjs) and is
 * recorded in `<root>/<id>/{job.json,output.log,exit,delivered}`, so it survives shutdown, reload
 * and daemon restarts; `attach(sessionId)` resumes this session's jobs and delivers each completion.
 * `delivered` is written when Pi starts a turn-triggering completion message (`acknowledge`), or at send for a
 * non-triggering one (cancelled); until then `attach` and `redeliver` (at agent_settled) resend it, so a dropped
 * queue cannot lose it.
 */
export function createBackgroundBashJobs(pi, { root = defaultRoot(), intervalMs = 5_000, lifetimeSeconds = MAX_LIFETIME_SECONDS, onChange = () => {}, runner: runnerPath = RUNNER } = {}) {
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
        // Pi appends a non-turn message itself (now, or at the end of the running turn) and emits no extension
        // message_start for it, so nothing would acknowledge it: the send is its delivery.
        if (!triggerTurn) try { writeFileSync(join(job.dir, "delivered"), "", { flag: "wx", mode: 0o600 }); } catch { /* already delivered */ }
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
    // A long-running daemon keeps this module loaded after promotion or cleanup removed its build.
    if (!existsSync(runnerPath)) throw new Error(`This session's background bash runner was removed (${runnerPath}), likely by a Pi Workbench promotion or cleanup; run /reload`);
    if ([...jobs.values()].filter((job) => job.state === "running").length >= MAX_ACTIVE) throw new Error("Too many background bash jobs; wait or cancel one before starting another");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const dir = join(root, id);
    mkdirSync(dir, { mode: 0o700 });
    closeSync(openSync(join(dir, "output.log"), "wx", 0o600));
    const startedAt = Date.now();
    const record = { id, command, description, cwd, sessionId, sessionFile, shell, args, timeout, startedAt, expiresAt: startedAt + (timeout ?? lifetimeSeconds) * 1000 };
    writeJson(join(dir, "job.json"), record);
    const runner = spawn(nodeBin(), [runnerPath, dir], { cwd: dir, detached: true, stdio: "ignore", env });
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
