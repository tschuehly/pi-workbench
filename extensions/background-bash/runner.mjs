// Detached per-job sidecar: `node runner.mjs <job-dir>`. It leads its own process group (spawned
// detached), so the job survives the Pi process or PI WEB session daemon that started it. The shell
// shares that group; the runner writes `exit` once and kills the whole group at timeout/expiry.
import { spawn } from "node:child_process";
import { linkSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
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
  const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
  const finish = (result) => writeOnce(join(dir, "exit"), JSON.stringify({ ...result, finishedAt: Date.now() }));
  const output = openSync(join(dir, "output.log"), "a", 0o600);
  const child = spawn(job.shell, [...job.args, job.command], { cwd: job.cwd, stdio: ["ignore", output, output] });
  child.once("error", (error) => { finish({ error: String(error) }); process.exit(0); });
  // Parity with Pi's bash tool: a signal-killed shell reports 128 + signal number.
  child.once("exit", (code, signal) => { finish({ exitCode: code ?? 128 + (constants.signals[signal] ?? 0) }); process.exit(0); });
  setTimeout(() => {
    finish({ error: job.timeout === undefined ? `Stopped at the ${Math.round((job.expiresAt - job.startedAt) / 1000)}-second maximum lifetime` : `Timed out after ${job.timeout} seconds` });
    process.kill(-process.pid, "SIGKILL");
  }, Math.max(0, job.expiresAt - Date.now()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(process.argv[2]);
