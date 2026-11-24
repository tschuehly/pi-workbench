// Write fence for background-bash commands (ws-workbench-sandbox-20261124). The runner stays outside and starts each
// command under Apple's sandbox-exec with a Seatbelt profile built here from the job record and the runner's own
// environment, never from files the command can write. No usable sandbox means the command does not start.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

// Absolute: never a sandbox-exec found on the command's PATH. Codex and srt crash Chromium (Thomas chose this, 24 Nov).
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
// Thomas's private folders and other apps' data: unreadable, so macOS never shows a permission prompt for them.
const PRIVATE = ["Desktop", "Documents", "Downloads", "Pictures", "Library/Containers", "Library/Group Containers", "Library/Mail", "Library/Messages", "Library/Safari"];
// Thomas's caches are all read-only to fenced commands: unfenced tools load code from them (Python's .pyc, pnpm dlx,
// Homebrew's bootsnap, jars, browsers). Fenced commands get their own, pointed at through the environment (Thomas,
// 24 Nov); a tool without such a setting just does not cache inside the fence.
const AGENT_CACHES = ".pi-workbench/sandbox-caches";
// Seeded once from Thomas's copy as an APFS clone (no extra disk until changed), so a fenced Playwright does not
// download the same browsers again; later changes never flow back. Only direct children of the agent caches folder,
// which no fenced command can rename or replace (a grant's own folder), so no planted symlink redirects the copy.
const SEEDS = [["Library/Caches/ms-playwright", "ms-playwright"]];
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

// A Workstream ID names one folder under scratch/; anything else (a `/`, `..`) would point elsewhere.
const WORKSTREAM_ID = /^ws-[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export const workstreamId = (id) => (typeof id === "string" && WORKSTREAM_ID.test(id) && !id.includes("..") ? id : undefined);

/** The chat's home Workstream ID, looked up by the job's session ID; absent when unknown or not a plain folder name. */
export async function workstreamOf(sessionId, home, env) {
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  try {
    const { createUserLocalWorkstreamStore } = await import("../../packages/workstream-store/src/index.js");
    const store = createUserLocalWorkstreamStore({ directory: env.PI_WORKBENCH_WORKSTREAM_DIR ?? join(home, ".pi-workbench", "workstreams") });
    const [ws] = await store.list({ sessionId, includeClosed: false });
    return workstreamId(ws?.id);
  } catch { return undefined; }
}

const OWNER = "pi-owner.json";
// The creation receipt: written once by the `wt switch --create` host operation, never merged. Only it grants access;
// pi-owner.json is the storage-cleanup record, which any later owner may join (mac-storage-workspaces --record-owner).
export const CREATOR = "pi-creator.json";
const readText = (path) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

/**
 * Linked worktrees in ~/IdeaProjects whose creation receipt (written outside the fence by the runner's
 * `wt switch --create` host operation only) names this chat (a child's `<chat>:<conversation>` session counts as the chat) or
 * `owners`' Workstream. Trusted only when git's two links agree: the record's `gitdir` names a worktree
 * whose own `.git` file points back. Fenced commands cannot write either record (see `grants`).
 */
/** Git's two links of a linked worktree agree: its `.git` file names `gitDir`, whose `gitdir` file names it back. */
export const linked = (top, gitDir) => readText(join(top, ".git"))?.trim() === `gitdir: ${gitDir}` && real(readText(join(gitDir, "gitdir"))?.trim() ?? "") === join(top, ".git");

export function ownedWorktrees(home, owners) {
  const found = [];
  const projects = join(home, "IdeaProjects");
  let repos = [];
  try { repos = readdirSync(projects); } catch { return found; }
  for (const repo of repos) {
    const meta = join(projects, repo, ".git", "worktrees");
    let names = [];
    try { names = readdirSync(meta); } catch { continue; }
    for (const name of names) {
      let record;
      try { record = JSON.parse(readText(join(meta, name, CREATOR)) ?? "null"); } catch { continue; }
      if (record === null || ![...(record.sessions ?? []), ...(record.workstreams ?? [])].some((id) => typeof id === "string" && owners.includes(id.split(":")[0]))) continue;
      const dotGit = readText(join(meta, name, "gitdir"))?.trim();
      if (dotGit === undefined || !dotGit.endsWith(`${sep}.git`)) continue;
      const top = dotGit.slice(0, -5);
      if (linked(top, join(meta, name)) || linked(real(top), join(real(meta), name))) found.push(real(top));
    }
  }
  return found;
}

/**
 * Paths a command may write (`write`), paths inside them that stay read-only (`read`), paths reopened inside those
 * (`reopen`), single files locked again inside those (`locked`) and paths it cannot read (`hidden`). A chat folder is
 * granted only as its git checkout or worktree, or as one Workstream scratch folder; never home, ~/IdeaProjects, the
 * scratch root or Pi's own state, so a chat started there runs read-only. `worktrees` adds the chat's owned worktrees.
 */
export function grants({ cwd, home = homedir(), piTmp, scratch, worktrees = [] }) {
  home = real(home);
  cwd = real(cwd);
  const pw = join(home, ".pi-workbench");
  const scratchRoot = join(pw, "scratch");
  const never = [join(home, ".pi"), join(home, ".pi-web-durable"), join(pw, "installed"), join(pw, "installed-durable"), join(pw, "workstreams"), join(pw, "background-bash"), join(pw, "sandbox")];
  const grantable = (dir) => inside(dir, home) && ![join(home, "IdeaProjects"), pw, scratchRoot, join(pw, "tmp")].includes(dir) && !never.some((n) => dir === n || inside(dir, n));
  const write = [];
  const read = [];
  const reopen = [];
  const locked = [];
  const history = [];
  const checkout = (repo) => {
    // A linked worktree whose links disagree (its .git file repointed) is no checkout of this repo: no grant.
    if (repo.gitDir !== repo.common && !linked(repo.top, repo.gitDir)) return;
    write.push(repo.top, repo.gitDir, repo.common);
    // Git history: objects are only ever added, so none may be deleted, renamed or overwritten (Thomas, 24 Nov).
    if (!history.includes(join(repo.common, "objects"))) history.push(join(repo.common, "objects"));
    read.push(...["hooks", "config", "info", "worktrees"].map((p) => join(repo.common, p)), ...REPO_READ_ONLY.map((p) => join(repo.top, p)));
    // Its own worktree metadata only, minus the files that decide ownership and the worktree link (ownedWorktrees).
    if (repo.gitDir !== repo.common) reopen.push(repo.gitDir);
    // commondir/config.worktree in the common folder would redirect every later git there to an agent-written config.
    locked.push(...[OWNER, `${OWNER}.lock`, CREATOR, "commondir", "config.worktree"].map((f) => join(repo.common, f)), ...[OWNER, `${OWNER}.lock`, CREATOR, "gitdir", "commondir", "config.worktree"].map((f) => join(repo.gitDir, f)));
    // Its .git file: repointed, every later git there (an unfenced one too) would read a config the agent wrote.
    if (repo.gitDir !== repo.common) locked.push(join(repo.top, ".git"));
  };
  const repo = git(cwd);
  if (repo !== undefined && grantable(repo.top)) checkout(repo);
  else if (inside(cwd, scratchRoot)) write.push(join(scratchRoot, relative(scratchRoot, cwd).split(sep)[0]));
  for (const tree of worktrees) {
    const owned = git(tree);
    if (owned !== undefined && owned.top === real(tree) && grantable(owned.top) && !write.includes(owned.top)) checkout(owned);
  }
  if (typeof piTmp === "string" && piTmp !== "" && grantable(real(piTmp))) write.push(real(piTmp));
  // One Workstream's own folder, directly under scratch/, never a path an ID could lead elsewhere.
  if (typeof scratch === "string" && scratch !== "" && dirname(real(scratch)) === scratchRoot && grantable(real(scratch))) write.push(real(scratch));
  write.push(join(home, AGENT_CACHES));
  return { write, read, reopen, locked, history, hidden: PRIVATE.map((p) => join(home, p)) };
}

/**
 * The Seatbelt profile: everything as today except writes, which only the grants get, and
 * reads of Thomas's private folders. Later rules win. Paths enter as -D parameters, never as profile text.
 */
function profile({ write, read, reopen = [], locked = [], history = [], hidden, ports = [], sockets = [], ownSocket }) {
  const params = [];
  const p = (path) => { params.push(`-D`, `P${params.length / 2}=${path}`); return `(param "P${params.length / 2 - 1}")`; };
  const rules = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    // shortcut: all of /dev (tty, null, fd, pty); raw disks there are root-only. Narrow it if a device class needs it.
    `(allow file-write* (subpath "/dev")${write.map((w) => ` (subpath ${p(w)})`).join("")})`,
    ...(read.length ? [`(deny file-write*${read.map((r) => ` (subpath ${p(r)})`).join("")})`] : []),
    ...(reopen.length ? [`(allow file-write*${reopen.map((r) => ` (subpath ${p(r)})`).join("")})`] : []),
    ...(locked.length ? [`(deny file-write*${locked.map((r) => ` (literal ${p(r)})`).join("")})`] : []),
    // Objects folders: no deletes (a rename over a file is one) or overwrites, except git's own temporary files, lock
    // and keep files, and info/ (commit-graph and pack lists, rewritten by rename). `git gc` and repack then fail here.
    ...(history.length ? [
      `(deny file-write-unlink file-write-data${history.map((h) => ` (subpath ${p(h)})`).join("")})`,
      `(allow file-write-unlink file-write-data${history.map((h) => ` (require-all (subpath ${p(h)}) (regex #"/(tmp_[^/]*|\\.tmp-[^/]*|[^/]*\\.(lock|keep))$"))`).join("")}${history.map((h) => ` (subpath ${p(join(h, "info"))})`).join("")})`,
      // An alternates file makes the owner's next unfenced gc drop every object the alternate store also has.
      `(deny file-write*${history.map((h) => ` (literal ${p(join(h, "info", "alternates"))}) (literal ${p(join(h, "info", "http-alternates"))})`).join("")})`,
    ] : []),
    // A grant's own folder cannot be deleted or renamed away, only its contents.
    ...(write.length ? [`(deny file-write-unlink${write.map((w) => ` (literal ${p(w)})`).join("")})`] : []),
    // Refused before macOS asks, so no "node wants to access your Desktop" prompt appears (Thomas, 24 Nov).
    ...(hidden.length ? [`(deny file-read*${hidden.map((h) => ` (subpath ${p(h)})`).join("")})`] : []),
    // PI WEB and the Durable hosts run `!` commands and prompts outside the fence; no fenced command may reach them,
    // nor another job's host operations. Ports are digits only (checked in confine), so they enter as text.
    ...(ports.length ? [`(deny network-outbound${ports.map((port) => ` (remote ip "*:${port}")`).join("")})`] : []),
    ...(sockets.length ? [`(deny network-outbound${sockets.map((s) => ` (remote unix-socket (subpath ${p(s)}))`).join("")})`] : []),
    ...(ownSocket ? [`(allow network-outbound (remote unix-socket (path-literal ${p(ownSocket)})))`] : []),
    // No Apple events: osascript could otherwise make Terminal or System Events act outside the fence.
    "(deny appleevent-send)",
    // Signals only within this command's own sandbox: SIGUSR1 opens an unfenced Node process's debugger (its runner,
    // the hosts, PI WEB), which would run any code outside the fence.
    "(deny signal)",
    "(allow signal (target same-sandbox))",
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

const present = (path) => { try { lstatSync(path); return true; } catch { return false; } };

/** Clones `from` to `to`, built where no fenced command can write (same disk), then renamed into place. */
function seed(from, to, home) {
  if (present(to) || !existsSync(from)) return;
  mkdirSync(join(home, ".pi-workbench", "sandbox"), { recursive: true, mode: 0o700 });
  const work = mkdtempSync(join(home, ".pi-workbench", "sandbox", "seed-"));
  try {
    execFileSync("/bin/cp", ["-cR", from, join(work, "copy")], { stdio: "ignore", timeout: 60_000 });
    renameSync(join(work, "copy"), to);
  } catch { /* another runner won the race, or no clone: the tool starts a fresh cache */ }
  finally { rmSync(work, { recursive: true, force: true }); }
}

/**
 * A short path for the Chat's temp folder: `PI_TMP` itself can pass the 104-byte Unix socket limit (tmux, Chromium and
 * any `listen($TMPDIR/x.sock)` fail). A link under ~/.pi-workbench/t, which no fenced command can write, to PI_TMP.
 */
function shortTmp(home, piTmp) {
  const dir = join(home, ".pi-workbench", "t");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Links whose PI_TMP was swept go; a fresh one is made on the next command.
  for (const name of readdirSync(dir)) if (!existsSync(join(dir, name))) rmSync(join(dir, name), { force: true });
  const link = join(dir, createHash("sha256").update(piTmp).digest("hex").slice(0, 12));
  const target = () => { try { return readlinkSync(link); } catch { return undefined; } };
  if (target() !== piTmp) {
    rmSync(link, { recursive: true, force: true });
    // Two commands of one Chat can start together: the other runner's identical link is as good as ours.
    try { symlinkSync(piTmp, link); } catch (error) { if (error.code !== "EEXIST" || target() !== piTmp) throw error; }
  }
  return link;
}

/**
 * The fenced command's environment: its temp folder is the Chat's own PI_TMP (the shared system temp folders hold code
 * unfenced Pi loads later, e.g. compiled extensions, so no fence grants them), and its package caches are the agents'
 * own (Thomas, 24 Nov). Gradle still reads Thomas's downloaded jars, read-only.
 */
export function fencedEnv(env, home, grantedTmp) {
  const caches = join(real(home), AGENT_CACHES);
  mkdirSync(caches, { recursive: true, mode: 0o700 });
  for (const [from, to] of SEEDS) seed(join(real(home), from), join(caches, to), real(home));
  const gradleCaches = join(real(home), ".gradle", "caches");
  return {
    ...env,
    // shortcut: no PI_TMP grant leaves TMPDIR unwritable (temp files fail visibly); every Pi-started command has one.
    ...(grantedTmp === undefined ? {} : { TMPDIR: `${shortTmp(real(home), grantedTmp)}/` }),
    GRADLE_USER_HOME: join(caches, "gradle"),
    ...(existsSync(join(gradleCaches, "modules-2")) ? { GRADLE_RO_DEP_CACHE: gradleCaches } : {}),
    MAVEN_USER_HOME: join(caches, "m2"),
    MAVEN_OPTS: [env.MAVEN_OPTS, `-Dmaven.repo.local=${join(caches, "m2", "repository")}`].filter(Boolean).join(" "),
    npm_config_cache: join(caches, "npm"),
    pnpm_config_store_dir: join(caches, "pnpm-store"),
    PLAYWRIGHT_BROWSERS_PATH: join(caches, "ms-playwright"),
    pnpm_config_cache_dir: join(caches, "pnpm-cache"),
    XDG_CACHE_HOME: join(caches, "xdg"),
    PYTHONPYCACHEPREFIX: join(caches, "python"),
    GOCACHE: join(caches, "go-build"),
    // clang (and Swift) keep compiled modules in the per-user cache folder, which no fence grants.
    CLANG_MODULE_CACHE_PATH: join(caches, "clang-modules"),
  };
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
 * The fenced launch for one job: `{ file, args, env }` to spawn in `job.cwd`, with the `owners` whose worktrees it may
 * write (and remove through the host operation). Throws when no proven sandbox is
 * available; the caller then records the failure and never starts the command.
 */
export async function confine(job, env = process.env, { ownSocket } = {}) {
  const argv = [job.shell, ...job.args, job.command];
  // Full access: the owner approved it for this Chat in a dialog only he can answer (durable-pilot /full-access); the
  // host writes it into the job record, which no command can write.
  if (!fenced() || job.fullAccess === true || alreadyFenced()) return { file: argv[0], args: argv.slice(1), env };
  const home = env.HOME ?? homedir();
  // PI_SANDBOX_EXEC (set by the host, e.g. tests) replaces Apple's binary; it never falls back to another one.
  const bin = env.PI_SANDBOX_EXEC || SANDBOX_EXEC;
  if (!existsSync(bin)) throw new Error(`Sandbox unavailable: ${bin} is missing; the command was not run`);
  try { proven(bin, env, home); }
  catch (error) { throw new Error(`Sandbox unavailable: ${error.message}; the command was not run`); }
  const ws = await workstreamOf(job.sessionId, home, env);
  // Worktrees by Workstream only for a chat started in that Workstream's scratch folder: any chat can associate
  // itself with any Workstream (`workstreams associate`), but not change the folder it was started in.
  const scratchRoot = join(real(home), ".pi-workbench", "scratch");
  const cwd = real(job.cwd);
  const started = inside(cwd, scratchRoot) ? workstreamId(relative(scratchRoot, cwd).split(sep)[0]) : undefined;
  const owners = [job.sessionId, started].filter((id) => typeof id === "string" && id !== "");
  const dataDirs = [env.PI_WEB_DATA_DIR, join(home, ".pi-web-durable")].filter((d) => typeof d === "string" && d !== "").map(real);
  const ports = [...new Set([env.PI_WEB_PORT, "8506"].filter((port) => typeof port === "string" && /^\d{1,5}$/.test(port)))];
  const rules = grants({ cwd: job.cwd, home, piTmp: env.PI_TMP, scratch: ws === undefined ? undefined : join(scratchRoot, ws), worktrees: ownedWorktrees(real(home), owners) });
  const piTmp = typeof env.PI_TMP === "string" && env.PI_TMP !== "" ? real(env.PI_TMP) : undefined;
  const net = { ports, sockets: [...dataDirs, join(userInfo().homedir, ".pi-workbench", "sandbox")], ownSocket };
  return { file: bin, args: sandboxArgs({ ...rules, ...net }, argv), env: fencedEnv(env, home, rules.write.includes(piTmp) ? piTmp : undefined), fenced: true, owners };
}
