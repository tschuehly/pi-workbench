// A Worker's status file (subagent README): its latest report_status state and line plus the last lines, so a Cockpit
// lead reads every Worker without a tool call. Shared by the subagent extension and the Durable delegation port.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const STATUS_STATES = /** @type {const} */ (["working", "needs-you", "blocked", "waiting", "done", "failed"]);
const STATUS_LOG_MAX = 20;

/** States a Worker reports plus `retired`, which only worker_retire writes. */
const STATUS_FILE_STATES = [...STATUS_STATES, "retired"];

/** Where a Worker's latest report_status lands, so a Cockpit lead can read it by workerId. */
export const workerStatusFile = (/** @type {string} */ workerId, home = os.homedir()) => path.join(home, ".pi-workbench", "workers", "status", `${workerId}.json`);

/**
 * Atomically rewrite the status file: latest state and line, plus the last STATUS_LOG_MAX lines.
 * An undefined line keeps the previous one and logs `logText` (the lead's end-of-dispatch and retire notes).
 * @param {string} file @param {string | undefined} line @param {string | undefined} state @param {Date} [now] @param {string | undefined} [logText]
 */
export function writeStatusFile(file, line, state, now = new Date(), logText = line) {
  if (state !== undefined && !STATUS_FILE_STATES.includes(state)) throw new Error(`Unknown status state '${state}'`);
  /** @type {{ state?: string; line?: string; log?: { t: string; text: string }[] }} */
  let previous = {};
  try { previous = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const updated = now.toISOString();
  const text = logText ?? line ?? "";
  const log = [...(Array.isArray(previous.log) ? previous.log : []), { t: updated, text }].slice(-STATUS_LOG_MAX);
  const body = { state: state ?? previous.state ?? "working", line: line ?? previous.line ?? text, updated, log };
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(temporary, file);
  return body;
}

/** A lead-side status write: returns a note naming the failure instead of swallowing it. */
export function leadStatusWrite(/** @type {string} */ file, /** @type {string} */ state, /** @type {string} */ logText) {
  try { writeStatusFile(file, undefined, state, new Date(), logText); return ""; } catch (error) { return `\n\nStatus file not written: ${error instanceof Error ? error.message : String(error)}`; }
}
