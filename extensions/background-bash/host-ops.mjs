// Host operations for fenced commands (ws-workbench-sandbox-20261124, step 2). The runner stays outside the fence and
// does the few writes agents need beyond their grants, in fixed shapes only: `workstreams` calls (the CLI's own rules
// guard the store) and `wt switch --create`, done here with git in a main checkout
// under ~/IdeaProjects. Nothing the
// command controls runs outside the fence: not its environment (the runner's is used), not a repo it set up, not
// worktrunk's project config, not an owner-record script it could edit.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, userInfo } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CREATOR, linked, workstreamId, workstreamOf } from "./sandbox.mjs";

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
  // Withdrawn 25 Nov (DECISIONS D3): unfenced git could delete outside the fence or a late edit; the shim forwards it
  // here so the real wt never half-empties a worktree inside the fence.
  if (tool === "wt" && rest[0] === "remove") return { error: "wt remove is not available inside the sandbox; ask Thomas to remove the worktree or to turn on full access" };
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
  const top = join(projects, relative(projects, at).split(sep)[0]);
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

/** `wt switch --create` as worktrunk's default layout makes it (`<repo>.<branch>` beside the main checkout), via git. */
async function createWorktree({ branch, base }, cwd, env, owners) {
  const home = env.HOME ?? homedir();
  const repo = mainCheckout(cwd, home, env);
  if (repo === undefined) return fail("wt switch --create: run it inside a checkout under ~/IdeaProjects (or one of its worktrees)");
  // No hooks and no fsmonitor: a chat working in the main checkout can edit a relative hooks folder (pi-web's .githooks).
  const git = (args) => run("git", ["-C", repo.main, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: repo.main, env });
  if ((await git(["check-ref-format", "--branch", branch])).code !== 0 || branch.startsWith("-")) return fail(`wt switch --create: ${branch} is not a valid branch name`);
  if ((await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0) return fail(`wt switch --create: branch ${branch} already exists`);
  if (base !== undefined && (await git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`])).code !== 0) return fail(`wt switch --create: base ${base} is not a commit`);
  const path = join(dirname(repo.main), `${basename(repo.main)}.${branch.replace(/[\\/]/g, "-")}`);
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

/** Run one request `{ argv, cwd, stdin }` with the runner's environment `env` for a job owned by `owners`; never throws. */
export async function handle(request, env, owners = []) {
  try {
    const { argv, cwd, stdin } = request ?? {};
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string") || typeof cwd !== "string") return fail("host operation: malformed request");
    try { if (!statSync(cwd).isDirectory()) throw new Error(); } catch { return fail(`host operation: ${cwd} is not a folder`); }
    const step = plan(argv);
    if (step.error !== undefined) return fail(step.error);
    if (step.worktree !== undefined) return await createWorktree(step.worktree, cwd, env, owners);
    return await run(step.file, step.args, { cwd, env, input: typeof stdin === "string" ? stdin : "" });
  } catch (error) {
    return { code: 1, stdout: "", stderr: `host operation failed: ${error.message}\n` };
  }
}

/**
 * Serve one job's host operations on `opsPath(dir)`; resolves once listening, with the environment additions for the
 * fenced command and a synchronous `close`. The fence lets the command connect to this socket only.
 */
export async function serve(dir, env, owners = []) {
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
      void handle(request, env, owners).then((result) => socket.end(`${JSON.stringify(result)}\n`));
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  server.unref();
  return {
    env: { PI_HOST_OPS: path, PATH: [SHIMS, ...(env.PATH ?? "").split(delimiter).filter((p) => p !== "" && p !== SHIMS)].join(delimiter) },
    close: () => { server.close(); rmSync(path, { force: true }); },
  };
}
