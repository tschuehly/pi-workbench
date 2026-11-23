// Durable host entry for pi-eval's trial PI WEB instances (scripts/pi-eval-web.mjs); PI_WEB_DURABLE_HOST points here.
// The daemon forks this file with an IPC channel; it runs the real host (PI_EVAL_REAL_HOST) under sandbox-exec with the
// trial's profile, <workspace>/../host-sandbox.sb, and relays IPC both ways. macOS refuses a sandbox inside a sandbox,
// so the whole host is sandboxed: its tool commands inherit no outbound network except loopback, and its model calls
// leave through the harness's provider-only proxy (HTTPS_PROXY with NODE_USE_ENV_PROXY). `--packages` is dropped, so no
// package tools (web search and fetch, notify_human, monitors) run. A trial without its profile file does not start.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const cwd = args[args.indexOf("--cwd") + 1];
const trialDir = args.includes("--cwd") && cwd ? path.dirname(cwd) : "";
const profile = path.join(trialDir, "host-sandbox.sb");
if (!trialDir || !existsSync(profile) || !process.env.PI_EVAL_REAL_HOST || !process.env.PI_EVAL_PROXY) {
  console.error(`pi-eval host shim: no sandbox profile at ${profile} or no PI_EVAL_REAL_HOST/PI_EVAL_PROXY; refusing to start`);
  process.exit(70);
}
const tmp = path.join(trialDir, "pi-tmp");
mkdirSync(tmp, { recursive: true });
const proxy = process.env.PI_EVAL_PROXY;
const env = {
  ...process.env, HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1",
  NODE_USE_ENV_PROXY: "1", PI_TMP: tmp, PI_TMP_ROOT: tmp, TMPDIR: tmp,
  // macOS refuses setuid binaries (/bin/ps) in a sandbox; the bash runner's liveness and cleanup checks need ps.
  PATH: `${path.join(path.dirname(fileURLToPath(import.meta.url)), "pi-eval-ps")}:${process.env.PATH}`,
  // Job records stay in the trial, where its sandbox can read them (the default root is under ~/.pi-workbench).
  PI_BACKGROUND_BASH_ROOT: path.join(trialDir, "background-bash"),
};
// The Chat's own store is readable on top of the trial's profile; other Chats' stores stay denied.
const store = args.includes("--store") && existsSync(args[args.indexOf("--store") + 1]) ? realpathSync(args[args.indexOf("--store") + 1]) : undefined;
const rules = readFileSync(profile, "utf8") + (store ? `(allow file-read-data (subpath ${JSON.stringify(store)}))` : "");
const child = spawn("/usr/bin/sandbox-exec", ["-p", rules, process.execPath, process.env.PI_EVAL_REAL_HOST, ...args.filter((a) => a !== "--packages")], { stdio: ["ignore", "inherit", "inherit", "ipc"], env });
process.on("message", (m) => { if (child.connected) child.send(m); });
child.on("message", (m) => { if (process.connected) process.send(m); });
// An IPC host exits when its daemon goes away; pass that on.
process.on("disconnect", () => { if (child.connected) child.disconnect(); });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
