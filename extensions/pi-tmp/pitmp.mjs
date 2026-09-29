import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const KEEP_ACTIVE_DAYS = 7;
export const defaultRoot = () => process.env.PI_TMP_ROOT ?? join(homedir(), ".pi-workbench", "tmp");
const day = (date = new Date()) => date.toLocaleDateString("sv"); // local YYYY-MM-DD
const keys = new Map();

/** Worktrees of one repository share the key of its main checkout; other folders use their own name. */
export function projectKey(cwd) {
  if (!keys.has(cwd)) {
    let name = basename(cwd);
    try {
      const common = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      name = basename(common.endsWith("/.git") ? dirname(common) : common);
    } catch { /* not a Git checkout */ }
    // ponytail: same-named projects share one key; add a path hash if that ever collides in practice.
    keys.set(cwd, name.replace(/[^\w.-]/g, "_").replace(/^\.+/, "") || "root");
  }
  return keys.get(cwd);
}

/** Create the session's PI_TMP folder and record today as an active day of its project. */
export function piTmpDir(cwd, sessionId, root = defaultRoot()) {
  const project = join(root, projectKey(cwd));
  const dir = join(project, sessionId.replace(/[^\w.-]/g, "_"));
  mkdirSync(join(project, ".days"), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(project, ".days", day()), "");
  const now = new Date();
  utimesSync(dir, now, now);
  return dir;
}

/** Delete session folders last used before the project's `keep` most recent active days. */
export function sweep(root = defaultRoot(), keep = KEEP_ACTIVE_DAYS) {
  const removed = [];
  for (const project of list(root)) {
    const daysDir = join(root, project, ".days");
    const days = list(daysDir).sort().reverse();
    if (days.length < keep) continue;
    const cutoff = days[keep - 1];
    for (const old of days.slice(keep)) rmSync(join(daysDir, old), { force: true });
    for (const session of list(join(root, project))) {
      if (session.startsWith(".")) continue;
      const dir = join(root, project, session);
      if (day(statSync(dir).mtime) < cutoff) { rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
    }
  }
  return removed;
}

function list(dir) {
  try { return readdirSync(dir); } catch { return []; }
}
