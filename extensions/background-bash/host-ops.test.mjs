// `wt remove` host operation on fixture repos with a bare local origin, called as the runner calls it. Runs inside a
// fence too: there its git steps run under the outer fence instead of a narrowed one (sandbox.mjs `narrowed`).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { handle } from "./host-ops.mjs";

const base = process.env.PI_TMP ?? join(homedir(), ".pi-workbench", "tmp");
mkdirSync(base, { recursive: true });
const root = realpathSync(mkdtempSync(join(base, "host-ops-test-")));
after(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home");
const projects = join(home, "IdeaProjects");
const main = join(projects, "app");
const chat = join(home, ".pi-workbench", "scratch", "ws-x");
mkdirSync(chat, { recursive: true });
const env = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env }).trim();
const origin = join(root, "origin.git");
git(root, "init", "-q", "--bare", "-b", "main", origin);
git(root, "clone", "-q", origin, main);
git(main, "commit", "-q", "--allow-empty", "-m", "init");
git(main, "push", "-q", "origin", "main");

/** Everything under `dirs` an hour old, links not followed: the 10-minute activity rule then lets the removal run. */
function age(...dirs) {
  const then = new Date(Date.now() - 3600_000);
  const walk = (p) => { if (lstatSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e)); lutimesSync(p, then, then); };
  for (const d of dirs) walk(d);
}

/** A worktree `<app>.worktrees/<branch>` with one commit, pushed unless `push` is false, its files aged. */
function worktree(branch, { push = true, receipt = { workstreams: ["ws-x"] } } = {}) {
  const top = join(projects, "app.worktrees", branch);
  git(main, "worktree", "add", "-q", "-b", branch, top);
  writeFileSync(join(top, `${branch}.txt`), "work\n");
  git(top, "add", "-A");
  git(top, "commit", "-q", "-m", branch);
  if (push) git(top, "push", "-q", "origin", branch);
  const meta = join(main, ".git", "worktrees", branch);
  if (receipt !== undefined) writeFileSync(join(meta, "pi-creator.json"), JSON.stringify({ branch, sessions: ["c1"], ...receipt }));
  return { top, meta, age: () => age(top, meta) };
}

const remove = (target, { cwd = main, from = chat, e = env } = {}) => handle({ argv: ["wt", "remove", ...(target === undefined ? [] : [target])], cwd }, e, [], from);

test("wt remove: a pushed, clean worktree goes; its .scratch moves to the owning Workstream; an untracked node_modules link is no obstacle; a branch equal to origin's goes", async () => {
  const w = worktree("done");
  mkdirSync(join(w.top, ".scratch"));
  writeFileSync(join(w.top, ".scratch", "notes.md"), "keep me\n");
  symlinkSync(join(main, "node_modules"), join(w.top, "node_modules"));
  w.age();
  const result = await remove("done");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /✓ Removed worktree .*app\.worktrees\/done; its \.scratch is now .*ws-x\/rescued-done-\d{4}-\d\d-\d\dT\d{6}; deleted branch done \(same as origin\/done\)/);
  assert.equal(existsSync(w.top), false);
  assert.equal(existsSync(w.meta), false);
  const rescued = readdirSync(chat).find((d) => d.startsWith("rescued-done-"));
  assert.equal(readFileSync(join(chat, rescued, "notes.md"), "utf8"), "keep me\n");
  assert.equal(git(main, "branch", "--list", "done"), "");
});

test("wt remove: a branch neither merged into origin's default nor equal to its origin branch is kept; one merged into it goes", async () => {
  const kept = worktree("kept", { push: false });
  git(kept.top, "push", "-q", "origin", "kept:elsewhere");
  writeFileSync(join(kept.top, "later.txt"), "x\n");
  git(kept.top, "add", "-A");
  git(kept.top, "commit", "-q", "-m", "later");
  git(kept.top, "push", "-q", "origin", "kept:elsewhere");
  git(kept.top, "push", "-q", "origin", "HEAD~1:refs/heads/kept");
  kept.age();
  const one = await remove(kept.top);
  assert.equal(one.code, 0, one.stderr);
  assert.match(one.stderr, /kept branch kept \(not merged into origin\/main and not the same as origin\/kept\)/);
  assert.notEqual(git(main, "branch", "--list", "kept"), "");
  const merged = worktree("merged");
  git(main, "fetch", "-q", "origin");
  git(main, "push", "-q", "origin", "origin/merged:refs/heads/main");
  merged.age();
  const two = await remove("merged");
  assert.equal(two.code, 0, two.stderr);
  assert.match(two.stderr, /deleted branch merged \(merged into origin\/main\)/);
});

test("wt remove refuses with the reason: unpushed head, tracked change, untracked file, .scratch without an owning Workstream", async () => {
  const cases = [
    [worktree("unpushed", { push: false }), () => {}, /its head [0-9a-f]{12} is on no branch of origin; push it first/],
    [worktree("edited"), (t) => writeFileSync(join(t, "edited.txt"), "changed\n"), /has uncommitted changes or untracked files: edited\.txt/],
    [worktree("untracked"), (t) => writeFileSync(join(t, "new.txt"), "new\n"), /has uncommitted changes or untracked files: new\.txt/],
    [worktree("orphan", { receipt: { workstreams: [] } }), (t) => mkdirSync(join(t, ".scratch")), /\.scratch has no owning Workstream/],
  ];
  for (const [w, change, why] of cases) {
    change(w.top);
    w.age();
    const result = await remove(w.top);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, /^wt remove: refused: /);
    assert.match(result.stderr, why);
    assert.ok(existsSync(join(w.top, ".git")), w.top);
  }
});

test("wt remove refuses with the reason: the Chat's own folder, a running command's folder, recent activity, a failed fetch", async () => {
  const w = worktree("busy");
  w.age();
  assert.match((await remove("busy", { from: join(w.top, "sub") })).stderr, /is this Chat's folder/);
  const jobs = join(home, ".pi-workbench", "background-bash", "jobs", "j1");
  mkdirSync(jobs, { recursive: true });
  writeFileSync(join(jobs, "job.json"), JSON.stringify({ cwd: w.top, expiresAt: Date.now() + 60_000 }));
  assert.match((await remove("busy")).stderr, /a running command works in .*app\.worktrees\/busy/);
  writeFileSync(join(jobs, "exit"), "{}");
  writeFileSync(join(w.top, "fresh.txt"), "x\n");
  assert.match((await remove("busy")).stderr, /changed 0 min ago and open Chats' folders cannot be detected, so a worktree with file activity in the last 10 minutes stays/);
  rmSync(join(w.top, "fresh.txt"));
  w.age();
  git(main, "remote", "set-url", "origin", join(root, "missing.git"));
  try { assert.match((await remove("busy")).stderr, /git fetch origin failed/); } finally { git(main, "remote", "set-url", "origin", origin); }
  assert.ok(existsSync(join(w.top, ".git")));
});

test("wt remove refuses with the reason: the main checkout, a path through a symbolic link, a locked worktree, a flag", async () => {
  assert.match((await remove(main)).stderr, /is a main checkout, never removed here/);
  const w = worktree("linked");
  const link = join(projects, "link");
  symlinkSync(w.top, link);
  w.age();
  assert.match((await remove(link)).stderr, /passes through a symbolic link/);
  git(main, "worktree", "lock", w.top);
  w.age();
  assert.match((await remove("linked")).stderr, /is locked/);
  assert.match((await handle({ argv: ["wt", "remove", "--force", "linked"], cwd: main }, env, [], chat)).stderr, /wt remove --force: is not available inside the sandbox/);
  assert.ok(existsSync(join(w.top, ".git")));
});
