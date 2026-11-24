// Write fence for background-bash commands (ws-workbench-sandbox-20261124). The runner stays outside and starts each
// command under Apple's sandbox-exec with a Seatbelt profile built here from the job record and the runner's own
// environment, never from files the command can write. No usable sandbox means the command does not start.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

// Absolute: never a sandbox-exec found on the command's PATH. Codex and srt crash Chromium (Thomas chose this, 24 Nov).
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
// Thomas's private folders and other apps' data: unreadable, so macOS never shows a permission prompt for them.
const PRIVATE = ["Desktop", "Documents", "Downloads", "Pictures", "Library/Containers", "Library/Group Containers", "Library/Mail", "Library/Messages", "Library/Safari"];
// Rebuildable package caches stay writable (Thomas, 24 Nov); their credential files are not caches and stay read-only.
const CACHES = [".npm", "Library/pnpm", ".m2/repository", ".gradle", ".cache", "Library/Caches"];
const CACHE_SECRETS = [".gradle/gradle.properties"];
// Inside a granted repo: what would let a command run code later outside the fence or redirect the agent.
const REPO_READ_ONLY = [".pi", "AGENTS.md", "AGENTS.override.md", ".mcp.json"];

const inside = (path, root) => { const rel = relative(root, path); return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel); };
const real = (path) => { try { return realpathSync(path); } catch { return path; } };

/** Only macOS is fenced; Linux machines are the agent VMs and CI, isolated as whole machines. */
export const fenced = () => process.platform === "darwin";

function git(cwd) {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    const [top, gitDir, common] = out.trim().split("\n").map(real);
    return top && gitDir && common ? { top, gitDir, common } : undefined;
  } catch { return undefined; }
}

/** The chat's home Workstream scratch folder, looked up by the job's session ID; absent when unknown. */
async function workstreamScratch(sessionId, home, env) {
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  try {
    const { createUserLocalWorkstreamStore } = await import("../../packages/workstream-store/src/index.js");
    const store = createUserLocalWorkstreamStore({ directory: env.PI_WORKBENCH_WORKSTREAM_DIR ?? join(home, ".pi-workbench", "workstreams") });
    const [ws] = await store.list({ sessionId, includeClosed: false });
    return ws === undefined ? undefined : join(home, ".pi-workbench", "scratch", ws.id);
  } catch { return undefined; }
}

/**
 * Paths a command may write (`write`), paths inside them that stay read-only (`read`) and paths it cannot read (`hidden`). A chat folder is granted
 * only as its git checkout or worktree, or as one Workstream scratch folder; never home, ~/IdeaProjects, the scratch
 * root or Pi's own state, so a chat started there runs read-only.
 */
export function grants({ cwd, home = homedir(), piTmp, scratch, temp = [] }) {
  home = real(home);
  cwd = real(cwd);
  const pw = join(home, ".pi-workbench");
  const scratchRoot = join(pw, "scratch");
  const never = [join(home, ".pi"), join(home, ".pi-web-durable"), join(pw, "installed"), join(pw, "installed-durable"), join(pw, "workstreams"), join(pw, "background-bash"), join(pw, "sandbox")];
  const grantable = (dir) => inside(dir, home) && ![join(home, "IdeaProjects"), pw, scratchRoot, join(pw, "tmp")].includes(dir) && !never.some((n) => dir === n || inside(dir, n));
  const write = [];
  const read = [];
  const repo = git(cwd);
  if (repo !== undefined && grantable(repo.top)) {
    write.push(repo.top, repo.gitDir, repo.common);
    read.push(...["hooks", "config", "info"].map((p) => join(repo.common, p)), ...REPO_READ_ONLY.map((p) => join(repo.top, p)));
  } else if (inside(cwd, scratchRoot)) {
    write.push(join(scratchRoot, relative(scratchRoot, cwd).split(sep)[0]));
  }
  for (const dir of [piTmp, scratch]) if (typeof dir === "string" && dir !== "" && grantable(real(dir))) write.push(real(dir));
  write.push(...temp, ...CACHES.map((p) => join(home, p)));
  read.push(...CACHE_SECRETS.map((p) => join(home, p)));
  return { write, read, hidden: PRIVATE.map((p) => join(home, p)) };
}

/**
 * The Seatbelt profile: everything as today except writes, which only the grants and the system temp folders get, and
 * reads of Thomas's private folders. Later rules win. Paths enter as -D parameters, never as profile text.
 */
function profile({ write, read, hidden }) {
  const params = [];
  const p = (path) => { params.push(`-D`, `P${params.length / 2}=${path}`); return `(param "P${params.length / 2 - 1}")`; };
  const rules = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    // shortcut: all of /dev (tty, null, fd, pty); raw disks there are root-only. Narrow it if a device class needs it.
    `(allow file-write* (subpath "/dev")${write.map((w) => ` (subpath ${p(w)})`).join("")})`,
    ...(read.length ? [`(deny file-write*${read.map((r) => ` (subpath ${p(r)})`).join("")})`] : []),
    // A grant's own folder cannot be deleted or renamed away, only its contents.
    ...(write.length ? [`(deny file-write-unlink${write.map((w) => ` (literal ${p(w)})`).join("")})`] : []),
    // Refused before macOS asks, so no "node wants to access your Desktop" prompt appears (Thomas, 24 Nov).
    ...(hidden.length ? [`(deny file-read*${hidden.map((h) => ` (subpath ${p(h)})`).join("")})`] : []),
  ];
  return [...params, "-p", rules.join("\n")];
}

const sandboxArgs = (rules, argv) => [...profile(rules), "--", ...argv];

/**
 * Prove sandbox-exec fences writes before trusting it: once per binary build (a macOS update replaces it), a write
 * inside a grant must work and one beside it must fail. The receipt lives where commands cannot write.
 */
function proven(bin, env, home) {
  const state = join(real(home), ".pi-workbench", "sandbox");
  const { size, mtimeMs } = statSync(real(bin));
  const receipt = join(state, `canary-${createHash("sha256").update(`${real(bin)}:${size}:${mtimeMs}`).digest("hex").slice(0, 16)}.json`);
  try { if (JSON.parse(readFileSync(receipt, "utf8")).ok === true) return; } catch { /* not proven yet */ }
  const dir = join(state, `canary-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "in"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "out"), { mode: 0o700 });
  try {
    const run = spawnSync(bin, sandboxArgs({ write: [join(dir, "in")], read: [], hidden: [] }, ["/bin/sh", "-c", 'touch "$1/in/ok"; touch "$1/out/escaped"', "sh", dir]), { env, encoding: "utf8", timeout: 20_000 });
    const ok = run.error === undefined && existsSync(join(dir, "in", "ok")) && !existsSync(join(dir, "out", "escaped"));
    if (!ok) throw new Error(`${bin} failed the write-fence check${run.error ? `: ${run.error.message}` : ""}`);
    writeFileSync(receipt, JSON.stringify({ ok, bin: real(bin), at: Date.now() }), { mode: 0o600 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The shared system temp folders (Thomas, 24 Nov): $TMPDIR, the per-user cache folder beside it, /tmp. */
function temps(env) {
  let cache;
  try { cache = execFileSync("getconf", ["DARWIN_USER_CACHE_DIR"], { encoding: "utf8", timeout: 2000 }).trim(); } catch { /* none */ }
  return [env.TMPDIR, cache, "/private/tmp"].filter((d) => typeof d === "string" && d !== "" && existsSync(d)).map(real);
}

/**
 * Already inside a fence (a fenced command started Pi or this runner): Seatbelt refuses a second sandbox, and every
 * child inherits the outer one. Proven, not trusted from the environment: no fence ever grants this account's own
 * ~/.pi-workbench/sandbox, so only a fenced process gets EPERM writing there.
 */
export function alreadyFenced() {
  const probe = join(userInfo().homedir, ".pi-workbench", "sandbox", `probe-${process.pid}`);
  try {
    mkdirSync(join(probe, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(probe, "");
    unlinkSync(probe);
    return false;
  } catch (error) { return error.code === "EPERM"; }
}

/**
 * The fenced launch for one job: `{ file, args, env }` to spawn in `job.cwd`. Throws when no proven sandbox is
 * available; the caller then records the failure and never starts the command.
 */
export async function confine(job, env = process.env) {
  const argv = [job.shell, ...job.args, job.command];
  if (!fenced() || alreadyFenced()) return { file: argv[0], args: argv.slice(1), env };
  const home = env.HOME ?? homedir();
  // PI_SANDBOX_EXEC (set by the host, e.g. tests) replaces Apple's binary; it never falls back to another one.
  const bin = env.PI_SANDBOX_EXEC || SANDBOX_EXEC;
  if (!existsSync(bin)) throw new Error(`Sandbox unavailable: ${bin} is missing; the command was not run`);
  try { proven(bin, env, home); }
  catch (error) { throw new Error(`Sandbox unavailable: ${error.message}; the command was not run`); }
  const rules = grants({ cwd: job.cwd, home, piTmp: env.PI_TMP, scratch: await workstreamScratch(job.sessionId, home, env), temp: temps(env) });
  return { file: bin, args: sandboxArgs(rules, argv), env };
}
