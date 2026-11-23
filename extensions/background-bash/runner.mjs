// Detached per-job sidecar: `node runner.mjs <job-dir>`. It leads its own process group (spawned
// detached), so the job survives the Pi process or PI WEB session daemon that started it. The shell
// shares that group; the runner writes `exit` once and kills the whole group at timeout/expiry.
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, linkSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

/** Create `path` holding `data` unless it already exists; readers never see a partial file. */
export function writeOnce(path, data) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, data, { mode: 0o600 });
  try { linkSync(temporary, path); return true; }
  catch (error) { if (error.code === "EEXIST") return false; throw error; }
  finally { unlinkSync(temporary); }
}

function run(dir) {
  // Claim the job before anything runs: a second runner for the same job (its host restarted between recording the
  // launch and the runner's start) exits here, and so does one whose job was cancelled before it started.
  if (!writeOnce(join(dir, "claim"), JSON.stringify({ pid: process.pid, at: Date.now() }))) process.exit(0);
  if (existsSync(join(dir, "exit"))) process.exit(0);
  const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
  const finish = (result) => writeOnce(join(dir, "exit"), JSON.stringify({ ...result, finishedAt: Date.now() }));
  const output = openSync(join(dir, "output.log"), "a", 0o600);
  if (job.owned) {
    void runOwned(dir, job, output, finish).catch((error) => {
      finish({ error: `Owned command supervision failed: ${String(error)}`, cleanup: { survivors: [], error: String(error) } });
      process.exit(1);
    });
    return;
  }
  const child = spawn(job.shell, [...job.args, job.command], { cwd: job.cwd, stdio: ["ignore", output, output] });
  child.once("error", (error) => { finish({ error: String(error) }); process.exit(0); });
  // Parity with Pi's bash tool: a signal-killed shell reports 128 + signal number.
  child.once("exit", (code, signal) => { finish({ exitCode: code ?? 128 + (constants.signals[signal] ?? 0) }); process.exit(0); });
  setTimeout(() => {
    finish({ error: job.timeout === undefined ? `Stopped at the ${Math.round((job.expiresAt - job.startedAt) / 1000)}-second maximum lifetime` : `Timed out after ${job.timeout} seconds` });
    process.kill(-process.pid, "SIGKILL");
  }, Math.max(0, job.expiresAt - Date.now()));
}

const exec = promisify(execFile);
const OWNER = "PI_MANAGED_COMMAND_OWNER";
const RELEASED = "PI_MANAGED_COMMAND_RELEASED";

/** ps output is private: never retain or publish other processes' commands or environments. */
async function processes() {
  const probe = exec("ps", [process.platform === "darwin" ? "-Eww" : "eww", "-axo", "pid=,ppid=,pgid=,stat=,lstart=,command="], { maxBuffer: 64 * 1024 * 1024, timeout: 2000 });
  const { stdout } = await probe;
  return stdout.split("\n").flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (Number(fields[0]) === probe.child.pid || fields.length < 10 || fields[3].startsWith("Z")) return [];
    return [{ pid: Number(fields[0]), ppid: Number(fields[1]), pgid: Number(fields[2]), start: fields.slice(4, 9).join(" "), command: fields.slice(9).join(" ") }];
  });
}

/** Trusted commands inherit this marker even into a detached browser group or after their shell exits.
 * ponytail: not a sandbox; a daemon clearing its environment and escaping the group needs OS-level containment.
 * macOS hides protected system binaries' environments, so group ownership and ancestry cover those too. */
function ownedProcesses(table, token, known, released) {
  const ids = new Set(table.filter((p) => !released.has(p.pid) && (p.pgid === process.pid || known.get(p.pid) === p.start || p.command.split(/\s+/).includes(`${OWNER}=${token}`))).map((p) => p.pid));
  for (let changed = true; changed;) {
    changed = false;
    for (const p of table) if (ids.has(p.ppid) && !ids.has(p.pid) && !released.has(p.pid)) { ids.add(p.pid); changed = true; }
  }
  return table.filter((p) => p.pid !== process.pid && ids.has(p.pid));
}

/** A helper the command hands off on purpose (an SSH master meant to outlive it) carries RELEASED=<token> instead of
 * OWNER=<token>, outside the runner's group; it and its descendants are left running. Whoever releases bounds it. */
function releasedProcesses(table, token) {
  const words = (p) => p.command.split(/\s+/);
  const ids = new Set(table.filter((p) => p.pgid !== process.pid && words(p).includes(`${RELEASED}=${token}`) && !words(p).includes(`${OWNER}=${token}`)).map((p) => p.pid));
  for (let changed = true; changed;) {
    changed = false;
    for (const p of table) if (ids.has(p.ppid) && !ids.has(p.pid) && p.pgid !== process.pid) { ids.add(p.pid); changed = true; }
  }
  return ids;
}

/** Enumerate detached descendants before touching parents; verify PID/start identity again before every signal. */
async function cleanupOwned(job, dir) {
  const known = new Map();
  const handedOff = new Map();
  let found = false;
  const grace = job.cleanupGraceMs ?? 1000;
  const until = Date.now() + grace + 2000;
  for (;;) {
    const table = await processes();
    const releasedIds = releasedProcesses(table, job.id);
    for (const p of table) if (releasedIds.has(p.pid)) handedOff.set(p.pid, p.start);
    const released = [...handedOff].map(([pid, start]) => ({ pid, start }));
    const owned = ownedProcesses(table, job.id, known, releasedIds);
    for (const p of owned) known.set(p.pid, p.start);
    found ||= owned.length > 0;
    // An ownership receipt contains identities only, never ps environments or commands.
    writeFileSync(join(dir, "owned.json"), JSON.stringify([...known].map(([pid, start]) => ({ pid, start }))), { mode: 0o600 });
    if (owned.length === 0) return { survivors: [], released, found };
    if (Date.now() >= until) return { survivors: owned.map((p) => p.pid), released, found };
    const kill = Date.now() >= until - 2000;
    // Leaves first (including detached children); their parents can then reap them.
    const depth = (p) => { let n = 0; const seen = new Set(); while (!seen.has(p.pid)) { seen.add(p.pid); p = table.find((x) => x.pid === p.ppid); if (!p) break; n++; } return n; };
    const fresh = await processes();
    for (const p of owned.sort((a, b) => depth(b) - depth(a))) {
      if (!fresh.some((x) => x.pid === p.pid && x.start === p.start)) continue;
      try { process.kill(p.pid, kill ? "SIGKILL" : "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await delay(50);
  }
}

async function runOwned(dir, job, output, finish) {
  // Expiry was admitted before launch: an intent restored after expiry must not start possible writes.
  if (existsSync(join(dir, "cancel"))) {
    closeSync(output);
    finish({ cancelled: true, cleanup: { survivors: [] } });
    process.exit(0);
  }
  if (Date.now() >= job.expiresAt) {
    closeSync(output);
    finish({ error: `Timed out after ${job.timeout} seconds before launch`, cleanup: { survivors: [] } });
    process.exit(0);
  }
  let ending;
  let timer;
  let poll;
  const end = (result, early = false) => {
    if (ending) return ending;
    clearTimeout(timer);
    clearInterval(poll);
    ending = (async () => {
      let cleanup;
      try { cleanup = await cleanupOwned(job, dir); }
      catch (error) { cleanup = { survivors: [], error: String(error) }; }
      if (cleanup.error || cleanup.survivors.length) result = { ...result, error: `Owned-process cleanup failed${cleanup.error ? `: ${cleanup.error}` : ""}` };
      else if (early && cleanup.found) result = { ...result, error: "Shell exited with owned descendants still running; stopped them before completion" };
      finish({ ...result, cleanup });
      closeSync(output);
      process.exit(0);
    })();
    return ending;
  };
  const child = spawn(job.shell, [...job.args, job.command], { cwd: job.cwd, stdio: ["ignore", output, output], env: { ...process.env, [OWNER]: job.id } });
  child.once("error", (error) => void end({ error: String(error) }));
  child.once("exit", (code, signal) => void end({ exitCode: code ?? 128 + (constants.signals[signal] ?? 0) }, true));
  timer = setTimeout(() => void end({ error: `Timed out after ${job.timeout} seconds` }), Math.max(0, job.expiresAt - Date.now()));
  poll = setInterval(() => { if (existsSync(join(dir, "cancel"))) void end({ cancelled: true }); }, 100);
}

// Node resolves symlinks in import.meta.url but not in argv[1]; compare real paths.
if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) run(process.argv[2]);
