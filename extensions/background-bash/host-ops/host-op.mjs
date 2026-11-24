#!/usr/bin/env node
// Shim for fenced commands, linked as `workstreams` and `wt` (host-ops.mjs): forwards the call to the job's runner,
// which runs it outside the fence. Other `wt` calls, and any call without a runner, run the real program here.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { basename, delimiter, dirname } from "node:path";

const name = basename(process.argv[1]);
const args = process.argv.slice(2);
const here = dirname(process.argv[1]);
// wt's subcommand words, past its global options (-C <path>, --config <path>, -v, -y).
const words = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "-C" && args[i - 1] !== "--config");
// Removal is refused here, runner or not: the real wt inside the fence would delete what it can and then stop.
if (name === "wt" && (words[0] === "remove" || (words[0] === "merge" && !args.includes("--no-remove")) || (words[0] === "step" && words[1] === "prune"))) {
  process.stderr.write(`wt ${words[0]}: removing a worktree is not available inside the sandbox; ask Thomas to remove it or to turn on full access${words[0] === "merge" ? " (or pass --no-remove)" : ""}\n`);
  process.exit(2);
}
const forwarded = name === "workstreams" || (name === "wt" && args[0] === "switch" && args.some((a) => a === "-c" || a === "--create"));
if (!forwarded || !process.env.PI_HOST_OPS) {
  const PATH = (process.env.PATH ?? "").split(delimiter).filter((p) => p !== here).join(delimiter);
  const real = spawnSync(name, args, { stdio: "inherit", env: { ...process.env, PATH } });
  if (real.error) { process.stderr.write(`${name}: ${real.error.message}\n`); process.exit(127); }
  process.exit(real.status ?? 1);
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
