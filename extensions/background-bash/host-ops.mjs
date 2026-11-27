// Host operations for fenced commands (ws-workbench-sandbox-20261124, step 2). The runner stays outside the fence and
// does the few writes agents need beyond their grants, in fixed shapes only: `workstreams` calls (the CLI's own rules
// guard the store) and `wt switch --create`, done here with git in a main checkout
// under ~/IdeaProjects. Nothing the
// command controls runs outside the fence: not its environment (the runner's is used), not a repo it set up, not
// worktrunk's project config, not an owner-record script it could edit.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, userInfo } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CREATOR, linked, narrowed, workstreamId, workstreamOf } from "./sandbox.mjs";

/** Folder of the `workstreams` and `wt` shims put first on a fenced command's PATH. */
export const SHIMS = join(dirname(fileURLToPath(import.meta.url)), "host-ops");
const MAX_REQUEST = 1024 * 1024;
const real = (path) => { try { return realpathSync(path); } catch { return path; } };

/** One job's socket, in this account's ~/.pi-workbench/sandbox, which no fence grants (so no command can replace it). */
export const opsPath = (dir) => join(userInfo().homedir, ".pi-workbench", "sandbox", "ops", `${createHash("sha256").update(dir).digest("hex").slice(0, 16)}.sock`);

/**
 * A request's plan, or a refusal. `wt switch --create <branch> [--base <ref>] [--no-cd]` only: `-x`/`--execute` and
 * `--clobber` would run or delete outside the fence. `workstreams` with any arguments but `@<file>`, which would read
 * a file outside the fence (stdin, `-` or `@-`, still works).
 */
export function plan(argv) {
  const [tool, ...rest] = argv;
  if (tool === "workstreams") {
    const file = rest.find((a) => a.startsWith("@") && a !== "@-");
    return file === undefined ? { file: "workstreams", args: rest } : { error: `workstreams: ${file} reads a file outside the sandbox; pass it on stdin (-) instead` };
  }
  // Pushed worktrees are removable by anyone (Thomas, 27 Nov): one target, no flags (--force, -D would lose work).
  if (tool === "wt" && rest[0] === "remove") {
    const flag = rest.slice(1).find((a) => a.startsWith("-"));
    if (flag !== undefined) return { error: `wt remove ${flag}: is not available inside the sandbox; only \`wt remove [path|branch]\` runs here, for a clean worktree whose commits are on origin` };
    if (rest.length > 2) return { error: "wt remove: one worktree at a time inside the sandbox" };
    return { remove: { target: rest[1] } };
  }
  if (tool !== "wt" || rest[0] !== "switch" || !rest.some((a) => a === "-c" || a === "--create")) return { error: `${tool} is not a host operation` };
  let branch;
  let base;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-c" || a === "--create" || a === "--no-cd") continue;
    if (a === "-b" || a === "--base") { base = rest[++i]; if (base === undefined || base.startsWith("-")) return { error: `wt switch: ${a} needs a branch` }; continue; }
    if (a.startsWith("--base=")) { base = a.slice(7); if (base === "" || base.startsWith("-")) return { error: "wt switch: --base needs a branch" }; continue; }
    if (!a.startsWith("-") && branch === undefined) { branch = a; continue; }
    return { error: `wt switch --create: ${a} is not available inside the sandbox; allowed are --base and --no-cd` };
  }
  if (branch === undefined) return { error: "wt switch --create needs a branch name" };
  return { worktree: { branch, base } };
}

const run = (file, args, { cwd, env, input = "" }) => new Promise((resolve) => {
  const child = execFile(file, args, { cwd, env, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) =>
    resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : 1, stdout, stderr: stderr || (error !== null && typeof error.code !== "number" ? `${error.message}\n` : "") }));
  child.stdin.on("error", () => {});
  child.stdin.end(input);
});
const fail = (message) => ({ code: 2, stdout: "", stderr: `${message}\n` });
const inside = (path, root) => { const rel = relative(root, path); return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel); };

/**
 * The main checkout `~/IdeaProjects/<name>` for a request made in it or in one of its linked worktrees, found by
 * path, never by git searching upward from the request's folder (a repo the agent set up could configure hooks).
 */
function mainCheckout(cwd, home, env) {
  const projects = real(join(home, "IdeaProjects"));
  const at = real(cwd);
  if (!inside(at, projects)) return undefined;
  const [first, second] = relative(projects, at).split(sep);
  // Linked worktrees live in `<repo>.worktrees/<branch>` (worktrunk's worktree-path in tschuehly-config).
  const top = first.endsWith(".worktrees") && second !== undefined ? join(projects, first, second) : join(projects, first);
  let common;
  try { common = real(execFileSync("git", ["-C", top, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", env, timeout: 5000 }).trim()); } catch { return undefined; }
  const main = dirname(common);
  if (basename(common) !== ".git" || dirname(main) !== projects || !statSync(common).isDirectory()) return undefined;
  // A main checkout's git folder with its own commondir or config.worktree reads config the fence could not lock.
  if (["commondir", "config.worktree"].some((f) => { try { lstatSync(join(common, f)); return true; } catch { return false; } })) return undefined;
  // A linked worktree counts only while git's two links agree (sandbox.mjs `linked`).
  if (top !== main && !linked(top, join(common, "worktrees", basename(readFileSync(join(top, ".git"), "utf8").trim())))) return undefined;
  return { main, common };
}

/** `wt switch --create` as worktrunk's configured layout makes it (`<repo>.worktrees/<branch>` beside the main checkout), via git. */
async function createWorktree({ branch, base }, cwd, env, owners) {
  const home = env.HOME ?? homedir();
  const repo = mainCheckout(cwd, home, env);
  if (repo === undefined) return fail("wt switch --create: run it inside a checkout under ~/IdeaProjects (or one of its worktrees)");
  // No hooks and no fsmonitor: a chat working in the main checkout can edit a relative hooks folder (pi-web's .githooks).
  const git = (args) => run("git", ["-C", repo.main, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: repo.main, env });
  if ((await git(["check-ref-format", "--branch", branch])).code !== 0 || branch.startsWith("-")) return fail(`wt switch --create: ${branch} is not a valid branch name`);
  if ((await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0) return fail(`wt switch --create: branch ${branch} already exists`);
  if (base !== undefined && (await git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`])).code !== 0) return fail(`wt switch --create: base ${base} is not a commit`);
  const path = join(dirname(repo.main), `${basename(repo.main)}.worktrees`, branch.replace(/[\\/]/g, "-"));
  try { lstatSync(path); return fail(`wt switch --create: ${path} already exists`); } catch { /* free */ }
  const added = await git(["worktree", "add", "-b", branch, path, ...(base === undefined ? [] : [base])]);
  if (added.code !== 0) return added;
  const meta = join(repo.common, "worktrees", basename(readFileSync(join(path, ".git"), "utf8").trim()));
  if (!linked(path, meta)) return { ...added, code: 1, stderr: `${added.stderr}wt switch --create: the new worktree's git links disagree; no owner was recorded\n` };
  // The owner record mac-storage-workspaces keeps (its format), written here: its script lives in a repo agents edit.
  const sessions = [env.PI_SESSION_ID, env.PI_TELEMETRY_PARENT_SESSION_ID].filter((s) => typeof s === "string" && s !== "");
  const ws = await workstreamOf(env.PI_SESSION_ID?.split(":")[0], home, env);
  const createdAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  writeFileSync(join(meta, "pi-owner.json"), `${JSON.stringify({ createdAt, branch, sessions: [...new Set(sessions)].sort(), workstreams: ws === undefined ? [] : [ws] }, null, 1)}\n`);
  // The receipt names only the Workstream whose scratch folder the Chat started in, not every one it is linked to.
  writeFileSync(join(meta, CREATOR), `${JSON.stringify({ createdAt, branch, sessions: [...new Set(sessions)].sort(), workstreams: owners.filter((o) => workstreamId(o) !== undefined) }, null, 1)}\n`, { flag: "wx" });
  return { code: 0, stdout: `${path}\n`, stderr: `${added.stderr}✓ Created branch ${branch}${base === undefined ? "" : ` from ${base}`} and worktree @ ${path} (owner ${ws ?? sessions[0] ?? "unknown"})\n` };
}

const present = (path) => { try { return lstatSync(path); } catch { return undefined; } };
// Real paths only: a link anywhere on the way could point the removal at another folder.
const unlinked = (path) => { try { return realpathSync.native(path) === path; } catch { return false; } };
const QUIET_MS = 10 * 60_000;

/** The linked worktree at the real path `top` under ~/IdeaProjects, with its git folders, or why it is not one. */
function worktreeAt(top, projects) {
  if (!unlinked(top)) return { error: `${top} does not exist or passes through a symbolic link` };
  if (!unlinked(projects) || !inside(top, projects)) return { error: `${top} is not under ~/IdeaProjects` };
  const dotGit = present(join(top, ".git"));
  if (dotGit?.isDirectory()) return { error: `${top} is a main checkout, never removed here` };
  if (!dotGit?.isFile()) return { error: `${top} is not a linked worktree (no .git file)` };
  const gitDir = /^gitdir: (\/.+)$/.exec(readFileSync(join(top, ".git"), "utf8").trim())?.[1];
  const common = gitDir === undefined ? undefined : dirname(dirname(gitDir));
  if (gitDir === undefined || !unlinked(gitDir) || basename(dirname(gitDir)) !== "worktrees" || basename(common) !== ".git" || dirname(dirname(common)) !== projects) return { error: `${top}'s .git file names no worktree folder of a checkout under ~/IdeaProjects` };
  if (!linked(top, gitDir)) return { error: `${top}'s git links disagree` };
  // As in mainCheckout: these would redirect git to a config the fence could not lock.
  if ([join(common, "commondir"), join(common, "config.worktree"), join(gitDir, "config.worktree")].some(present) || resolve(gitDir, (() => { try { return readFileSync(join(gitDir, "commondir"), "utf8").trim(); } catch { return ""; } })()) !== common) return { error: `${top}'s git folder is redirected` };
  if (present(join(gitDir, "locked"))) return { error: `${top} is locked (git worktree lock)` };
  return { top, gitDir, common, main: dirname(common) };
}

/** Newest change time of anything in `dirs` (no link followed), the top-level node_modules aside. */
function lastChange(dirs) {
  let newest = 0;
  const walk = (dir, top) => {
    newest = Math.max(newest, lstatSync(dir).mtimeMs);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (top && entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, false);
      else newest = Math.max(newest, lstatSync(path).mtimeMs);
    }
  };
  for (const dir of dirs) walk(dir, true);
  return newest;
}

/** Folders of background commands still running (any Chat's), as their job records name them. */
function runningFolders(home) {
  const jobs = join(home, ".pi-workbench", "background-bash", "jobs");
  let ids = [];
  try { ids = readdirSync(jobs); } catch { return []; }
  return ids.flatMap((id) => {
    try {
      if (present(join(jobs, id, "exit"))) return [];
      const job = JSON.parse(readFileSync(join(jobs, id, "job.json"), "utf8"));
      return Date.now() < job.expiresAt && typeof job.cwd === "string" ? [real(job.cwd)] : [];
    } catch { return []; }
  });
}

/**
 * `wt remove [path|branch]`: removes a linked worktree under ~/IdeaProjects only if its head is on origin (after a
 * fetch), it is clean but for a top-level node_modules and .scratch/, and no Chat seems to work in it; .scratch/ goes
 * to the owning Workstream's scratch folder first. The branch goes only if merged into origin's default or equal to
 * its origin branch. Everything touching the worktree's files runs `narrowed` to it (sandbox.mjs).
 */
async function removeWorktree(target, cwd, env, chat) {
  const home = real(env.HOME ?? homedir());
  const projects = join(home, "IdeaProjects");
  const no = (why) => fail(`wt remove: refused: ${why}; nothing was removed`);
  const git = (args, at) => run("git", ["-C", at, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: at, env });
  let top;
  if (target === undefined) {
    // The worktree around the request's folder, found by path, never by git searching upward.
    for (let at = real(cwd); inside(at, projects) && top === undefined; at = dirname(at)) if (present(join(at, ".git"))) top = at;
  } else {
    // A branch first, as wt reads it, then a path.
    const repo = mainCheckout(cwd, home, env);
    if (repo !== undefined) {
      const list = (await git(["worktree", "list", "--porcelain", "-z"], repo.main)).stdout.split("\0");
      const at = list.indexOf(`branch refs/heads/${target}`);
      if (at > 0) top = list.slice(0, at).findLast((l) => l.startsWith("worktree "))?.slice(9);
    }
    top ??= resolve(cwd, target);
  }
  if (top === undefined) return no(`${cwd} is in no worktree under ~/IdeaProjects; name the worktree's branch or path`);
  const tree = worktreeAt(top, projects);
  if (tree.error !== undefined) return no(tree.error);
  if (typeof chat !== "string" || chat === "") return no("this command's Chat folder is unknown");
  if (real(chat) === top || inside(real(chat), top)) return no(`${top} is this Chat's folder`);
  const busy = runningFolders(home).find((f) => f === top || inside(f, top));
  if (busy !== undefined) return no(`a running command works in ${busy}`);
  // shortcut: open Chats' folders are not detectable reliably, so recent file activity stands in for them.
  const quiet = Math.round((Date.now() - lastChange([top, tree.gitDir])) / 60_000);
  if (quiet < QUIET_MS / 60_000) return no(`${top} or its git metadata changed ${quiet} min ago and open Chats' folders cannot be detected, so a worktree with file activity in the last 10 minutes stays; try again later`);
  const fencedRun = (argv, write) => { const [file, ...args] = narrowed(argv, write, env); return run(file, args, { cwd: tree.main, env }); };
  const fetched = await git(["fetch", "--quiet", "origin"], tree.main);
  if (fetched.code !== 0) return no(`git fetch origin failed (${fetched.stderr.trim() || `exit ${fetched.code}`})`);
  const head = (await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], top)).stdout.trim();
  if (head === "") return no(`${top} has no commit checked out`);
  const ref = (await git(["symbolic-ref", "-q", "HEAD"], top)).stdout.trim();
  const remotes = (await git(["for-each-ref", "--contains", head, "--format=%(refname)", "refs/remotes/origin/"], tree.main)).stdout.split("\n").filter((r) => r !== "" && r !== "refs/remotes/origin/HEAD");
  if (remotes.length === 0) return no(`its head ${head.slice(0, 12)} is on no branch of origin; push it first`);
  // No optional locks: a refused status must not touch the index, or the activity check would wait 10 minutes again.
  const status = await fencedRun(["git", "--no-optional-locks", "-C", top, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--ignore-submodules=none"], [tree.gitDir]);
  if (status.code !== 0) return no(`git status failed (${status.stderr.trim() || `exit ${status.code}`})`);
  const entries = status.stdout.split("\0").filter((e) => e !== "");
  const dirty = entries.filter((e) => !["?? node_modules", "?? node_modules/", "?? .scratch/"].includes(e));
  if (dirty.length > 0) return no(`${top} has uncommitted changes or untracked files: ${dirty.slice(0, 5).map((e) => e.slice(3)).join(", ")}${dirty.length > 5 ? ", …" : ""}`);
  const branch = ref.startsWith("refs/heads/") ? ref.slice(11) : undefined;
  const scratch = join(top, ".scratch");
  let rescued;
  if (present(scratch) !== undefined) {
    if (!present(scratch).isDirectory()) return no(`${scratch} is not a folder`);
    let ws;
    for (const file of [CREATOR, "pi-owner.json"]) try { ws ??= JSON.parse(readFileSync(join(tree.gitDir, file), "utf8")).workstreams?.map(workstreamId).find(Boolean); } catch { /* no record */ }
    if (ws === undefined) return no(`${scratch} has no owning Workstream (none in ${CREATOR} or pi-owner.json) to rescue it to`);
    const wsDir = join(home, ".pi-workbench", "scratch", ws);
    mkdirSync(wsDir, { recursive: true });
    if (!unlinked(wsDir)) return no(`${wsDir} passes through a symbolic link`);
    rescued = join(wsDir, `rescued-${(branch ?? head.slice(0, 12)).replace(/[^A-Za-z0-9._-]/g, "-")}-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}`);
    if (present(rescued) !== undefined) return no(`${rescued} already exists`);
  }
  // Again right before anything moves: the same worktree at the same real path, the same head.
  const again = worktreeAt(top, projects);
  if (again.error !== undefined || again.gitDir !== tree.gitDir) return no(again.error ?? `${top} changed`);
  if ((await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], top)).stdout.trim() !== head) return no(`${top} got a new commit meanwhile`);
  if (rescued !== undefined) {
    const moved = await fencedRun(["/bin/mv", "--", scratch, rescued], [top, dirname(rescued)]);
    if (moved.code !== 0) return no(`moving ${scratch} to ${rescued} failed (${moved.stderr.trim()})`);
  }
  const kept = rescued === undefined ? "" : `; its .scratch is now ${rescued}`;
  // An untracked node_modules (a link to the main checkout's) is the one thing git would need --force for.
  if (entries.some((e) => e.startsWith("?? node_modules"))) {
    const gone = await fencedRun(["/bin/rm", "-rf", "--", join(top, "node_modules")], [top]);
    if (gone.code !== 0) return fail(`wt remove: removing ${join(top, "node_modules")} failed (${gone.stderr.trim()})${kept}`);
  }
  // Without --force: git checks again that nothing changed since.
  const removed = await fencedRun(["git", "-C", tree.main, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "worktree", "remove", "--", top], [top, tree.gitDir]);
  if (removed.code !== 0) return { ...removed, stderr: `${removed.stderr}wt remove: git kept ${top}${kept}\n` };
  let note = "";
  if (branch !== undefined) {
    const oid = (await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], tree.main)).stdout.trim();
    let main = (await git(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"], tree.main)).stdout.trim();
    const named = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(main === "" ? (await git(["ls-remote", "--symref", "origin", "HEAD"], tree.main)).stdout : "")?.[1];
    if (named !== undefined) main = `refs/remotes/origin/${named}`;
    const same = oid !== "" && (await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`], tree.main)).stdout.trim() === oid;
    const merged = oid !== "" && main !== "" && (await git(["merge-base", "--is-ancestor", oid, main], tree.main)).code === 0;
    const elsewhere = (await git(["worktree", "list", "--porcelain", "-z"], tree.main)).stdout.split("\0").includes(`branch ${ref}`);
    // The old value guards against a commit made since the checks.
    const deleted = (same || merged) && !elsewhere && (await git(["update-ref", "-d", ref, oid], tree.main)).code === 0;
    note = deleted ? `; deleted branch ${branch} (${merged ? `merged into ${main.slice(13)}` : `same as origin/${branch}`})` : `; kept branch ${branch} (${elsewhere ? "checked out elsewhere" : `not merged into ${main === "" ? "origin's default branch" : main.slice(13)} and not the same as origin/${branch}`})`;
  }
  return { code: 0, stdout: "", stderr: `✓ Removed worktree ${top}${kept}${note}\n` };
}

/**
 * Run one request `{ argv, cwd, stdin }` with the runner's environment `env` for a job owned by `owners`, started in
 * the Chat folder `chat`; never throws.
 */
export async function handle(request, env, owners = [], chat = undefined) {
  try {
    const { argv, cwd, stdin } = request ?? {};
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string") || typeof cwd !== "string") return fail("host operation: malformed request");
    try { if (!statSync(cwd).isDirectory()) throw new Error(); } catch { return fail(`host operation: ${cwd} is not a folder`); }
    const step = plan(argv);
    if (step.error !== undefined) return fail(step.error);
    if (step.worktree !== undefined) return await createWorktree(step.worktree, cwd, env, owners);
    if (step.remove !== undefined) return await removeWorktree(step.remove.target, cwd, env, chat);
    return await run(step.file, step.args, { cwd, env, input: typeof stdin === "string" ? stdin : "" });
  } catch (error) {
    return { code: 1, stdout: "", stderr: `host operation failed: ${error.message}\n` };
  }
}

/**
 * Serve one job's host operations on `opsPath(dir)`; resolves once listening, with the environment additions for the
 * fenced command and a synchronous `close`. The fence lets the command connect to this socket only.
 */
export async function serve(dir, env, owners = [], chat = undefined) {
  const path = opsPath(dir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  rmSync(path, { force: true });
  const server = createServer((socket) => {
    let data = "";
    let answered = false;
    socket.setEncoding("utf8");
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      if (answered) return;
      data += chunk;
      const end = data.indexOf("\n");
      if (end < 0 && data.length <= MAX_REQUEST) return;
      answered = true;
      if (end < 0) { socket.end(`${JSON.stringify(fail("host operation: request too large"))}\n`); return; }
      let request;
      try { request = JSON.parse(data.slice(0, end)); } catch { request = undefined; }
      void handle(request, env, owners, chat).then((result) => socket.end(`${JSON.stringify(result)}\n`));
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  server.unref();
  return {
    env: { PI_HOST_OPS: path, PATH: [SHIMS, ...(env.PATH ?? "").split(delimiter).filter((p) => p !== "" && p !== SHIMS)].join(delimiter) },
    close: () => { server.close(); rmSync(path, { force: true }); },
  };
}
