// Write fence for background-bash commands (ws-workbench-sandbox-20261124). The runner stays outside and starts each
// command under Apple's sandbox-exec with a Seatbelt profile built here from the job record and the runner's own
// environment, never from files the command can write. No usable sandbox means the command does not start.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Absolute: never a sandbox-exec found on the command's PATH. Codex and srt crash Chromium (Thomas chose this, 24 Nov).
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
// Thomas's private folders and other apps' data: unreadable, so macOS never shows a permission prompt for them.
const PRIVATE = ["Desktop", "Documents", "Downloads", "Pictures", "Library/Containers", "Library/Group Containers", "Library/Mail", "Library/Messages", "Library/Safari"];
// Thomas's caches are all read-only to fenced commands: unfenced tools load code from them (Python's .pyc, pnpm dlx,
// Homebrew's bootsnap, jars, browsers). Fenced commands get their own, pointed at through the environment (Thomas,
// 24 Nov); a tool without such a setting just does not cache inside the fence.
const AGENT_CACHES = ".pi-workbench/sandbox-caches";
// pnpm 12 keeps its store operation locks in XDG_RUNTIME_DIR when only this user can write it, else in /tmp, which no
// fence grants. One folder for every fenced job (they all lock the shared agent store), outside the agent caches so no
// fenced command can replace it or change its mode: only its contents are granted.
const RUNTIME = ".pi-workbench/sandbox-runtime";
// gcloud's login and dev-run's VM state, granted as they are (made by the tools themselves when missing): Thomas
// accepted that agents can then act as him in GCP (27 Nov).
const CLOUD = [".config/gcloud", ".local/state/embabel-dev-vm"];
// shortcut: a job can plant a file where pnpm's lock folder goes and break later fenced installs, like it can break
// the shared agent store itself; delete the entry to recover. Upgrade to per-job store and runtime if this happens.

// Seeded once from Thomas's copy as an APFS clone (no extra disk until changed), so a fenced Playwright does not
// download the same browsers again; later changes never flow back. Only direct children of the agent caches folder,
// which no fenced command can rename or replace (a grant's own folder), so no planted symlink redirects the copy.
const SEEDS = [["Library/Caches/ms-playwright", "ms-playwright"]];
// Inside a granted repo: what would let a command run code later outside the fence or redirect the agent.
const REPO_READ_ONLY = [".pi", "AGENTS.md", "AGENTS.override.md", ".mcp.json"];

export const inside = (path, root) => { const rel = relative(root, path); return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel); };
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
  write.push(join(home, AGENT_CACHES), join(home, RUNTIME), ...CLOUD.map((p) => join(home, p)));
  locked.push(join(home, RUNTIME));
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
  const runtime = join(real(home), RUNTIME);
  for (const [from, to] of SEEDS) seed(join(real(home), from), join(caches, to), real(home));
  const gradleCaches = join(real(home), ".gradle", "caches");
  const { XDG_RUNTIME_DIR: _inherited, ...rest } = env;
  return {
    ...rest,
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
    ...(privateDir(runtime) ? { XDG_RUNTIME_DIR: runtime } : {}),
  };
}

/** Made and checked here, outside the fence: a real folder of this user, mode 0700, or false (then pnpm 12 fails visibly). */
function privateDir(dir) {
  try { mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") return false; }
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== process.getuid()) return false;
  // Fenced commands cannot chmod it (`locked` in grants), so a wrong mode predates the fence: the runner resets it.
  if ((stat.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  return true;
}

/**
 * Already inside a fence (a fenced command started Pi or this runner): Seatbelt refuses a second sandbox, and every
 * child inherits the outer one. Proven, not trusted from the environment: no fence ever grants this account's own
 * ~/.pi-workbench/sandbox, so only a fenced process gets EPERM writing there.
 */
export function alreadyFenced() {
  const state = join(userInfo().homedir, ".pi-workbench", "sandbox");
  try {
    mkdirSync(state, { recursive: true, mode: 0o700 });
    // A fresh folder of its own: never truncates or removes an entry someone planted under a predictable name.
    rmdirSync(mkdtempSync(join(state, "probe-")));
    return false;
  } catch (error) { return error.code === "EPERM"; }
}

/** The grants of a job of chat `sessionId` started in `cwd` with `env` (its PI_TMP), and the owners of its worktrees. */
async function jobGrants({ cwd: at, sessionId }, env) {
  const home = env.HOME ?? homedir();
  const ws = await workstreamOf(sessionId, home, env);
  // Worktrees by Workstream only for a chat started in that Workstream's scratch folder: any chat can associate
  // itself with any Workstream (`workstreams associate`), but not change the folder it was started in.
  const scratchRoot = join(real(home), ".pi-workbench", "scratch");
  const cwd = real(at);
  const started = inside(cwd, scratchRoot) ? workstreamId(relative(scratchRoot, cwd).split(sep)[0]) : undefined;
  const owners = [sessionId, started].filter((id) => typeof id === "string" && id !== "");
  const rules = grants({ cwd: at, home, piTmp: env.PI_TMP, scratch: ws === undefined ? undefined : join(scratchRoot, ws), worktrees: ownedWorktrees(real(home), owners) });
  return { home, owners, rules };
}

/** `path` with every link resolved as far as it exists; undefined when a link points nowhere (its target is unknown). */
function resolved(path) {
  const rest = [];
  for (let at = path; ; at = dirname(at)) {
    // Native: the on-disk spelling (case, Unicode form) of what exists, as the deny rules below compare it.
    try { return join(realpathSync.native(at), ...rest.reverse()); } catch { /* not there yet */ }
    if (present(at) || dirname(at) === at) return undefined;
    rest.push(basename(at));
  }
}

/**
 * Whether the fence lets a command write the absolute `path`, by the profile's rules in their order. Stricter in one
 * place: nothing inside git's objects folders (the fence lets commands add objects there; no file-edit tool needs to).
 */
export function mayWrite(path, { write, read = [], reopen = [], locked = [], history = [] }) {
  const target = resolved(path);
  if (target === undefined) return false;
  const under = (roots, at = target) => roots.some((root) => at === root || inside(at, root));
  // Refusals ignore case and Unicode form (APFS does: `.GIT/Config` is `.git/config`). A locked name above the target
  // counts too: creating the parent folders would make it.
  const fold = (p) => p.normalize("NFD").toLowerCase();
  const folded = (roots) => under(roots.map(fold), fold(target));
  return under(write) && (!folded(read) || folded(reopen)) && !folded(locked) && !folded(history);
}

/**
 * Why a write or edit tool of chat `sessionId`, in `cwd` with its tool environment `env`, may not write `path`;
 * undefined when its commands could write it too. Every spelling a tool layer may make of it must pass: with and
 * without a leading `@` and Unicode spaces made plain, then as Durable resolves it (`~`, `file://`, relative to `cwd`).
 */
export async function writeRefusal(path, { cwd, sessionId, env }) {
  if (typeof path !== "string") return undefined;
  const rules = await writeGrants({ cwd, sessionId, env });
  const target = toolPaths(path, { cwd, env }).find((t) => !mayWrite(t, rules));
  if (target === undefined) return undefined;
  return `Blocked: ${target} is outside this Chat's write folders, the same write fence its commands run in (its checkout or own worktrees, its Workstream scratch folder, PI_TMP), or a protected file inside them (git hooks and config, AGENTS.md, .pi). Only the owner can lift it, with /full-access.`;
}

/** The write folders of chat `sessionId`'s tools in `cwd`: its commands' grants, computed now. */
const writeGrants = async ({ cwd, sessionId, env }) => (await jobGrants({ cwd, sessionId }, env)).rules;

/**
 * Every absolute path a tool layer may make of the tool argument `path`: with and without a leading `@` and Unicode
 * spaces made plain, each resolved as Durable does.
 */
export function toolPaths(path, at) {
  const spellings = [path, path.replace(/^@/, "")].flatMap((p) => [p, p.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")]);
  return [...new Set(spellings.map((p) => toolPath(p, at)))];
}

/** `p` as Durable's file tools resolve it (env/node.js resolvePath): `~`, `file://`, relative to `cwd`. */
export function toolPath(p, { cwd, env }) {
  const home = env.HOME ?? homedir();
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  if (p.startsWith("file://")) try { return resolve(fileURLToPath(p)); } catch { /* an ordinary path then */ }
  return resolve(cwd, p);
}

// Fixed: the paths are its arguments, never script text. Makes the parent folders, then writes stdin to the file.
const WRITE_SCRIPT = '/bin/mkdir -p -- "$1" && exec /bin/cat > "$2"';
// Makes the parent folders, then the new private folder itself (fails if anything is there).
const MKDIR_SCRIPT = '/bin/mkdir -p -- "$1" && exec /bin/mkdir -m 700 -- "$2"';

/** A proven sandbox-exec, or a throw: nothing runs without one. */
function sandboxBin(env, home, what) {
  // PI_SANDBOX_EXEC (set by the host, e.g. tests) replaces Apple's binary; it never falls back to another one.
  const bin = env.PI_SANDBOX_EXEC || SANDBOX_EXEC;
  if (!existsSync(bin)) throw new Error(`Sandbox unavailable: ${bin} is missing; ${what}`);
  try { proven(bin, env, home); }
  catch (error) { throw new Error(`Sandbox unavailable: ${error.message}; ${what}`); }
  return bin;
}

/**
 * Writes `content` to the absolute `path` of a write or edit tool of chat `sessionId` (in `cwd`, tool environment
 * `env`), making its parent folders, in a fixed helper under the profile its commands get, with git's objects folders
 * read-only too. The kernel checks the path as it is when the file opens, so a folder a background job swaps for a link
 * after the tool's approval (`writeRefusal`) leads nowhere. Throws when the fence refuses or no sandbox is proven, with
 * `code` as Node's fs errors carry it.
 */
export const fencedWrite = (path, content, at) => fencedHelper(WRITE_SCRIPT, path, content, at);

/**
 * Makes the new folder `path` (and its parents) as `fencedWrite` writes a file: a temp folder of the Chat's environment
 * (codemode's output files) inside its commands' grants, so a parent a job redirected leads nowhere.
 */
export const fencedMkdir = (path, at) => fencedHelper(MKDIR_SCRIPT, path, "", at);

async function fencedHelper(script, path, content, { cwd, sessionId, env, signal }) {
  const home = env.HOME ?? homedir();
  const bin = sandboxBin(env, home, "nothing was written");
  const rules = await writeGrants({ cwd, sessionId, env });
  if (signal?.aborted) throw Object.assign(new Error("aborted"), { code: "ABORT_ERR" });
  const args = sandboxArgs({ ...rules, read: [...rules.read, ...rules.history], history: [] }, ["/bin/sh", "-c", script, "sh", dirname(path), path]);
  const { code, stderr } = await new Promise((done) => {
    // A fixed environment: nothing of the tool's (BASH_ENV, ENV) reaches the shell.
    const child = spawn(bin, args, { env: { PATH: "/usr/bin:/bin" }, stdio: ["pipe", "ignore", "pipe"], ...(signal ? { signal } : {}) });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => done({ code: -1, stderr: error.message }));
    child.on("close", (code) => done({ code, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(content);
  });
  if (code === 0) return;
  if (signal?.aborted) throw Object.assign(new Error("aborted"), { code: "ABORT_ERR" });
  throw writeError(stderr, path, code);
}

const CAUSES = { "Operation not permitted": "EPERM", "Permission denied": "EACCES", "Is a directory": "EISDIR", "Not a directory": "ENOTDIR", "No such file or directory": "ENOENT" };

/**
 * The helper's failure as an fs-style error. Its message ends `<file>: <reason>` (mkdir, sh), so the reason is the last
 * line's text after the last ": ", never a file name; only the sandbox's EPERM is a fence block.
 */
export function writeError(stderr, path, code) {
  const line = stderr.trim().split("\n").at(-1) ?? "";
  const cause = CAUSES[line.slice(line.lastIndexOf(": ") + 2)] ?? "EIO";
  const detail = stderr.trim() || `exit ${code}`;
  return Object.assign(new Error(cause === "EPERM" ? `Blocked by the write fence: ${path} could not be written (${detail})` : `${path} could not be written (${detail})`), { code: cause });
}

/**
 * The fenced launch for one job: `{ file, args, env }` to spawn in `job.cwd`, with the `owners` whose worktrees it may
 * write. Throws when no proven sandbox is
 * available; the caller then records the failure and never starts the command.
 */
export async function confine(job, env = process.env, { ownSocket } = {}) {
  const argv = [job.shell, ...job.args, job.command];
  // Full access: the owner approved it for this Chat in a dialog only he can answer (durable-pilot /full-access); the
  // host writes it into the job record, which no command can write.
  if (!fenced() || job.fullAccess === true || alreadyFenced()) return { file: argv[0], args: argv.slice(1), env };
  const home = env.HOME ?? homedir();
  const bin = sandboxBin(env, home, "the command was not run");
  const { owners, rules } = await jobGrants(job, env);
  const dataDirs = [env.PI_WEB_DATA_DIR, env.PI_DURABLE_HOST_SOCKET_DIR, join(home, ".pi-web-durable")].filter((d) => typeof d === "string" && d !== "").map(real);
  const ports = [...new Set([env.PI_WEB_PORT, "8506"].filter((port) => typeof port === "string" && /^\d{1,5}$/.test(port)))];
  const piTmp = typeof env.PI_TMP === "string" && env.PI_TMP !== "" ? real(env.PI_TMP) : undefined;
  const net = { ports, sockets: [...dataDirs, join(userInfo().homedir, ".pi-workbench", "sandbox")], ownSocket };
  return { file: bin, args: sandboxArgs({ ...rules, ...net }, argv), env: fencedEnv(env, home, rules.write.includes(piTmp) ? piTmp : undefined), fenced: true, owners };
}
