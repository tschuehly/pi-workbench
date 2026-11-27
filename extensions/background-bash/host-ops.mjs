// Host operations for fenced commands (ws-workbench-sandbox-20261124, step 2). The runner stays outside the fence and
// does the few writes agents need beyond their grants, in fixed shapes only: `workstreams` calls (the CLI's own rules
// guard the store) and `wt switch --create`, done here with git in a main checkout
// under ~/IdeaProjects. Nothing the
// command controls runs outside the fence: not its environment (the runner's is used), not a repo it set up, not
// worktrunk's project config, not an owner-record script it could edit.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** Folders of background commands still running (any Chat's), as their job records name them. */
function runningFolders(home) {
  const jobs = join(home, ".pi-workbench", "background-bash", "jobs");
  let ids = [];
  try { ids = readdirSync(jobs); } catch { return []; }
  return ids.flatMap((id) => {
    try {
      if (present(join(jobs, id, "exit"))) return [];
      const job = JSON.parse(readFileSync(join(jobs, id, "job.json"), "utf8"));
      return Date.now() < job.expiresAt ? [job.cwd, job.folder].filter((f) => typeof f === "string").map(real) : [];
    } catch { return []; }
  });
}

const readText = (path) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * Every Durable Chat's folder as its store keeps it (`fence-folder.json`, written at open by durable-pilot's
 * `chatFolder`, in a store no fence grants); throws when a store cannot be read, so the removal fails closed.
 */
function chatFolders(home) {
  const stores = join(home, ".pi-web-durable", "durable");
  let entries;
  try { entries = readdirSync(stores, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return []; throw new Error(`${stores} cannot be read (${error.code})`); }
  return entries.filter((e) => e.isDirectory()).flatMap((e) => {
    const file = join(stores, e.name, "fence-folder.json");
    let kept;
    try { kept = JSON.parse(readFileSync(file, "utf8")); } catch (error) {
      // shortcut: a store without the file (a read-only Chat, or one not opened since the host wrote these) counts as
      // no folder; once every live Chat has reopened under that host, treat a missing file as unreadable too.
      if (error.code === "ENOENT") return [];
      throw new Error(`${file} cannot be read`);
    }
    if (typeof kept?.folder !== "string" || typeof kept.cwd !== "string") throw new Error(`${file} is malformed`);
    return [kept.folder, real(kept.cwd)];
  });
}

/** The commit and branch the worktree's HEAD names, read from git's files (no git, so no config is read). */
function headAt(gitDir, common) {
  const text = readText(join(gitDir, "HEAD"))?.trim() ?? "";
  if (SHA.test(text)) return { head: text };
  const ref = /^ref: (refs\/heads\/\S+)$/.exec(text)?.[1];
  if (ref === undefined || ref.split("/").includes("..")) return {};
  const loose = readText(join(common, ref))?.trim();
  const head = SHA.test(loose ?? "") ? loose : readText(join(common, "packed-refs"))?.split("\n").find((l) => l.endsWith(` ${ref}`))?.split(" ")[0];
  return { head: SHA.test(head ?? "") ? head : undefined, branch: ref.slice(11) };
}

/** `owner/repo` of a github.com remote URL (https or ssh form), or undefined. */
export const githubRepo = (url) => { const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w-][\w.-]*)\/([\w-][\w.-]*?)(?:\.git)?\/?$/.exec(url ?? ""); return m === null ? undefined : `${m[1]}/${m[2]}`; };

/** The commits of `shas` GitHub has on no branch of `repo` among `branches`, or a gh failure. */
async function unpushed(repo, shas, branches, env) {
  // A clean env in a neutral folder: nothing of the worktree's repo steers gh or the git it may start.
  const gh = (path) => run("gh", ["api", path, "--jq", path.includes("/compare/") ? ".status" : ".default_branch"], { cwd: "/", env: Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_"))) });
  const info = await gh(`repos/${repo}`);
  if (info.code !== 0 || info.stdout.trim() === "") return { error: `gh api repos/${repo} failed (${info.stderr.trim() || `exit ${info.code}`})` };
  const bases = [...new Set([info.stdout.trim(), ...branches])].map((b) => b.split("/").map(encodeURIComponent).join("/"));
  for (const sha of shas) {
    let contained = false;
    for (const base of bases) if (!contained) contained = ["identical", "behind"].includes((await gh(`repos/${repo}/compare/${base}...${sha}`)).stdout.trim());
    if (!contained) return { sha };
  }
  return {};
}

/**
 * `wt remove [path|branch]`: moves a linked worktree under ~/IdeaProjects and its git folder to
 * ~/.pi-workbench/trash/<id>/ (scripts/fence-trash.mjs restores or empties it), only if GitHub has its head and every
 * commit of its HEAD reflog on a branch, it is clean but for a top-level node_modules and .scratch/, and no Chat or
 * running command works in it; .scratch/ is copied to the owning Workstream's scratch folder first. The branch stays.
 * git status runs `narrowed` to the worktree's git folder (sandbox.mjs).
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
  let folders;
  try { folders = chatFolders(home); } catch (error) { return no(`${error.message}, so other Chats' folders are unknown`); }
  const open = folders.find((f) => f === top || inside(f, top) || inside(top, f));
  if (open !== undefined) return no(`a Chat works in ${open}`);
  const { head, branch } = headAt(tree.gitDir, tree.common);
  if (head === undefined) return no(`${top} has no commit checked out`);
  // Only that file (no includes): the fence keeps <common>/config read-only, unlike remote-tracking refs.
  const url = await run("git", ["config", "--file", join(tree.common, "config"), "--get", "remote.origin.url"], { cwd: "/", env: { PATH: env.PATH ?? "/usr/bin:/bin" } });
  const repo = githubRepo(url.stdout.trim());
  if (repo === undefined) return no(`its origin (${url.stdout.trim() || "none"}) is no GitHub repository, so whether it is pushed cannot be checked`);
  const shas = new Set([head]);
  for (const line of (readText(join(tree.gitDir, "logs", "HEAD")) ?? "").split("\n")) for (const sha of line.split(" ", 2)) if (SHA.test(sha) && !/^0+$/.test(sha)) shas.add(sha);
  const missing = await unpushed(repo, shas, branch === undefined ? [] : [branch], env);
  if (missing.error !== undefined) return no(missing.error);
  if (missing.sha !== undefined) return no(`commit ${missing.sha.slice(0, 12)} of its HEAD history is on no branch of github.com/${repo}; push it first`);
  const fencedRun = (argv, write) => { const [file, ...args] = narrowed(argv, write, env); return run(file, args, { cwd: tree.main, env }); };
  const fencedGit = (args) => fencedRun(["git", "--no-optional-locks", "-C", top, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], [tree.gitDir]);
  const status = await fencedGit(["status", "--porcelain=v1", "-z", "--ignored", "--ignore-submodules=none"]);
  if (status.code !== 0) return no(`git status failed (${status.stderr.trim() || `exit ${status.code}`})`);
  // Ignored files too: a .env or build output lives nowhere else.
  const dirty = status.stdout.split("\0").filter((e) => e !== "" && !/^(\?\?|!!) (node_modules\/?|\.scratch\/)$/.test(e));
  if (dirty.length > 0) return no(`${top} has uncommitted changes, untracked or ignored files: ${dirty.slice(0, 5).map((e) => e.slice(3)).join(", ")}${dirty.length > 5 ? ", …" : ""}`);
  const listed = await fencedGit(["ls-files", "-v", "-z"]);
  if (listed.code !== 0) return no(`git ls-files failed (${listed.stderr.trim() || `exit ${listed.code}`})`);
  // Assume-unchanged (lowercase tag) and skip-worktree (S) files hide their changes from git status.
  const hidden = listed.stdout.split("\0").filter((e) => /^([a-z]|S) /.test(e));
  if (hidden.length > 0) return no(`${top} has files git status does not check (assume-unchanged or skip-worktree): ${hidden.slice(0, 5).map((e) => e.slice(2)).join(", ")}`);
  const name = (branch ?? head.slice(0, 12)).replace(/[^A-Za-z0-9._-]/g, "-");
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
    rescued = join(wsDir, `rescued-${name}-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}`);
    if (present(rescued) !== undefined) return no(`${rescued} already exists`);
  }
  const trash = join(home, ".pi-workbench", "trash");
  mkdirSync(trash, { recursive: true, mode: 0o700 });
  if (!unlinked(trash)) return no(`${trash} passes through a symbolic link`);
  // Same volume, so each move is one atomic rename: a write still under way lands in the trash, never lost.
  if ([top, tree.gitDir].some((p) => lstatSync(p).dev !== lstatSync(trash).dev)) return no(`${top} is on another volume than ${trash}`);
  const id = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "")}Z-${basename(tree.main)}-${basename(tree.gitDir)}`;
  const dest = join(trash, id);
  if (rescued !== undefined) {
    // Copied, links as links, under the narrowed fence: a link swapped in for .scratch reads no hidden folder.
    const copied = await fencedRun(["/bin/cp", "-RP", "--", scratch, rescued], [dirname(rescued)]);
    if (copied.code !== 0) return no(`copying ${scratch} to ${rescued} failed (${copied.stderr.trim()})`);
  }
  const kept = rescued === undefined ? "" : `; its .scratch is copied to ${rescued}`;
  // Again right before anything moves: the same worktree at the same real path, the same head.
  const again = worktreeAt(top, projects);
  if (again.error !== undefined || again.gitDir !== tree.gitDir) return fail(`wt remove: refused: ${again.error ?? `${top} changed`}; nothing was moved${kept}`);
  if (headAt(tree.gitDir, tree.common).head !== head) return fail(`wt remove: refused: ${top} got a new commit meanwhile; nothing was moved${kept}`);
  try { mkdirSync(dest); } catch (error) { return fail(`wt remove: ${dest}: ${error.message}; nothing was moved${kept}`); }
  const restore = { id, movedAt: new Date().toISOString(), tree: top, gitDir: tree.gitDir, main: tree.main, branch, head, restore: `mv '${join(dest, "tree")}' '${top}' && mv '${join(dest, "gitdir")}' '${tree.gitDir}' && git -C '${tree.main}' worktree repair '${top}' (or: node scripts/fence-trash.mjs --restore ${id})` };
  writeFileSync(join(dest, "restore.json"), `${JSON.stringify(restore, null, 1)}\n`, { flag: "wx" });
  renameSync(top, join(dest, "tree"));
  try { renameSync(tree.gitDir, join(dest, "gitdir")); } catch (error) {
    renameSync(join(dest, "tree"), top);
    rmSync(dest, { recursive: true });
    return fail(`wt remove: moving ${tree.gitDir} failed (${error.message}); nothing was moved${kept}`);
  }
  return { code: 0, stdout: "", stderr: `✓ Moved worktree ${top} and its git folder to ${dest} (node scripts/fence-trash.mjs --restore ${id} puts them back)${kept}; branch ${branch ?? "(detached)"} kept\n` };
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
