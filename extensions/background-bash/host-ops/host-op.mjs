#!/usr/bin/env node
// Shim for fenced commands, linked as `workstreams` and `wt` (host-ops.mjs): forwards the call to the job's runner,
// which runs it outside the fence. Other allowed `wt` calls, and any call without a runner, run the real program here.
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import { connect } from "node:net";
import { basename, delimiter, join } from "node:path";

const name = basename(process.argv[1]);
const args = process.argv.slice(2);
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
// Inside the fence the real wt runs only commands that never remove a worktree (it would delete what the fence lets
// it, then stop). Global options in their exact forms only; anything unclassified (e.g. grouped -yC) is refused.
let switchAt = -1;
if (name === "wt") {
  let i = 0;
  for (;;) {
    const a = args[i];
    if (["-y", "--yes", "-v", "--verbose", "-vv", "-vvv"].includes(a)) i += 1;
    else if (a === "-C" || a === "--config") i += 2;
    else if (a !== undefined && /^(-C[^-]|--config=)/.test(a)) i += 1;
    else break;
  }
  const command = args[i];
  // `help` is no wt subcommand: an alias or wt-help program of that name would run.
  if (command !== undefined && !["list", "switch", "config", "-h", "--help", "-V", "--version"].includes(command)) {
    process.stderr.write(`wt ${command}: is not available inside the sandbox (only list, switch and config run here; removing a worktree never); ask Thomas or turn on full access\n`);
    process.exit(2);
  }
  // The host operation takes `switch --create` first only; a prefixed one would run the real wt here, unrecorded.
  if (i > 0 && command === "switch" && args.some((a) => a === "-c" || a === "--create")) {
    process.stderr.write("wt switch --create: is not available inside the sandbox after global options; write `wt switch --create …` first\n");
    process.exit(2);
  }
  // --clobber removes a directory at the target path, which may be another checkout inside a grant.
  if (command === "switch" && args.slice(i + 1).some((a) => a === "--clobber" || a.startsWith("--clobber="))) {
    process.stderr.write("wt switch --clobber: is not available inside the sandbox\n");
    process.exit(2);
  }
  if (command === "switch") switchAt = i;
}
const forwarded = name === "workstreams" || (name === "wt" && args[0] === "switch" && args.some((a) => a === "-c" || a === "--create"));
if (!forwarded || !process.env.PI_HOST_OPS) {
  // The real program by its full path; the shim stays first on PATH for anything it starts (a wt alias or hook).
  // Compared by real path: any `wt` on PATH that is a link to this shim (in any folder) would run it again, forever.
  const self = real(process.argv[1]);
  const bin = (process.env.PATH ?? "").split(delimiter).filter((p) => p !== "").map((p) => join(p, name)).find((f) => { try { accessSync(f, constants.X_OK); return real(f) !== self; } catch { return false; } });
  if (bin === undefined) { process.stderr.write(`${name}: command not found\n`); process.exit(127); }
  // A switch the real wt runs here runs no hooks: an approved hook could remove a worktree with git directly.
  if (switchAt >= 0) args.splice(switchAt + 1, 0, "--no-hooks");
  const ran = spawnSync(bin, args, { stdio: "inherit" });
  if (ran.error) { process.stderr.write(`${name}: ${ran.error.message}\n`); process.exit(127); }
  process.exit(ran.status ?? 1);
}
let stdin = "";
if (!process.stdin.isTTY) try { stdin = readFileSync(0, "utf8"); } catch { /* no stdin */ }
let reply = "";
const socket = connect(process.env.PI_HOST_OPS);
socket.setEncoding("utf8");
socket.on("connect", () => socket.write(`${JSON.stringify({ argv: [name, ...args], cwd: process.cwd(), stdin })}\n`));
socket.on("data", (chunk) => { reply += chunk; });
socket.on("error", (error) => { process.stderr.write(`${name}: the host operation is unavailable (${error.message})\n`); process.exit(1); });
socket.on("end", () => {
  let result;
  try { result = JSON.parse(reply); } catch { process.stderr.write(`${name}: no answer from the host operation\n`); process.exit(1); }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
});
