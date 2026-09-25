import { randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";
import { removeActivity, upsertActivity } from "../activity/activity.mjs";

const MAX_TAIL = 12_000;
const MAX_ACTIVE = 8;
const MAX_RETAINED = 64;
const cleanOutput = (text) => stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

export function createBackgroundBashJobs(pi, operations, { intervalMs = 5_000, now = Date.now, onChange = () => {} } = {}) {
  const jobs = new Map();
  let directory;
  let closed = false;

  function activity(job) {
    upsertActivity(pi, {
      id: `background-bash:${job.id}`, kind: "shell", objective: "background bash",
      activity: `running · ${Math.floor((now() - job.startedAt) / 1000)}s · ${job.bytes} bytes output`,
    });
    onChange();
  }

  function describe(job) {
    return { id: job.id, command: job.command, state: job.state, elapsedSeconds: Math.floor((now() - job.startedAt) / 1000), bytes: job.bytes, logPath: job.logPath, ...(job.exitCode === undefined ? {} : { exitCode: job.exitCode }) };
  }

  function start(command, cwd, timeout, env) {
    if (closed) throw new Error("Background bash session has ended");
    if (typeof command !== "string" || command.trim() === "") throw new Error("A non-empty bash command is required");
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2_147_483_647)) throw new Error("Invalid timeout in seconds");
    if ([...jobs.values()].filter((job) => job.state === "running").length >= MAX_ACTIVE) throw new Error("Too many background bash jobs; wait or cancel one before starting another");
    directory ??= mkdtempSync(join(tmpdir(), "pi-background-bash-"));
    const id = randomUUID();
    const logPath = join(directory, `${id}.log`);
    const fd = openSync(logPath, "wx", 0o600);
    const controller = new AbortController();
    const decoder = new StringDecoder("utf8");
    const job = { id, command, state: "running", startedAt: now(), bytes: 0, logPath, controller, tail: "", exitCode: undefined, pending: undefined, timer: undefined };
    jobs.set(id, job);
    activity(job);
    job.timer = setInterval(() => { if (job.state === "running") activity(job); }, intervalMs);
    job.timer.unref?.();
    const onData = (data) => {
      try { for (let written = 0; written < data.length;) written += writeSync(fd, data, written, data.length - written); }
      catch (error) { job.writeError = error; controller.abort(); return; }
      job.bytes += data.length;
      job.tail = (job.tail + decoder.write(data)).slice(-MAX_TAIL);
    };
    job.pending = Promise.resolve().then(() => operations.exec(command, cwd, { onData, signal: controller.signal, timeout, env }))
      .then(({ exitCode }) => {
        if (Number.isInteger(exitCode)) job.exitCode = exitCode;
        else job.error = "Shell exited without an exit code";
        job.state = job.exitCode === 0 ? "complete" : "failed";
      })
      .catch((error) => { job.state = job.writeError ? "failed" : controller.signal.aborted ? "cancelled" : "failed"; job.error = String(job.writeError ?? error); })
      .finally(() => {
        job.tail = (job.tail + decoder.end()).slice(-MAX_TAIL);
        try { closeSync(fd); }
        catch (error) { job.state = "failed"; job.error = String(error); }
        clearInterval(job.timer);
        for (const [oldId, oldJob] of jobs) {
          if (jobs.size <= MAX_RETAINED) break;
          if (oldJob.state !== "running") jobs.delete(oldId);
        }
        removeActivity(pi, `background-bash:${id}`);
        onChange();
        if (!closed) {
          try {
            const tail = job.exitCode === 0 ? job.tail.split("\n").slice(-20).join("\n") : job.tail;
            pi.sendMessage({
              customType: "background-bash", display: true,
              content: `Background bash ${id} ${job.state}${job.exitCode === undefined ? " (exit unknown)" : ` (exit ${job.exitCode})`}.${job.error ? ` ${cleanOutput(job.error)}` : ""}\nFull output (available until session shutdown): ${logPath}\n${job.bytes > Buffer.byteLength(job.tail) ? "[showing recent output only]\n" : ""}${cleanOutput(tail.replace(/^[\uDC00-\uDFFF]/u, ""))}`,
              details: describe(job),
            }, { triggerTurn: job.state !== "cancelled", deliverAs: "followUp" });
          } catch (error) { console.error(`Background bash ${id} could not deliver completion:`, error); }
        }
      });
    return describe(job);
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (job?.state === "running") job.controller.abort();
    return job === undefined ? undefined : describe(job);
  }

  async function shutdown() {
    closed = true;
    for (const job of jobs.values()) if (job.state === "running") job.controller.abort();
    await Promise.allSettled([...jobs.values()].map((job) => job.pending));
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
    jobs.clear();
  }

  return { start, cancel, shutdown, list: () => [...jobs.values()].map(describe) };
}
