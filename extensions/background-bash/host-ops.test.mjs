// `wt remove` host operation on fixture repos whose origin URL names github.com while pushes go to a bare local repo,
// with a fake `gh` that answers GitHub's compare API from that bare repo; called as the runner calls it. Runs inside a
// fence too: there its git steps run under the outer fence instead of a narrowed one (sandbox.mjs `narrowed`).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { empty, restore } from "../../scripts/fence-trash.mjs";
import { githubRepo, handle } from "./host-ops.mjs";

const base = process.env.PI_TMP ?? join(homedir(), ".pi-workbench", "tmp");
mkdirSync(base, { recursive: true });
const root = realpathSync(mkdtempSync(join(base, "host-ops-test-")));
after(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home");
const projects = join(home, "IdeaProjects");
const main = join(projects, "app");
const chat = join(home, ".pi-workbench", "scratch", "ws-x");
const trash = join(home, ".pi-workbench", "trash");
const stores = join(home, ".pi-web-durable", "durable");
mkdirSync(chat, { recursive: true });
const origin = join(root, "origin.git");
// GitHub's compare API, answered from the bare repo: behind when the commit is on that branch, 404 for an unknown one.
const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "gh"), `#!/bin/sh
[ -n "$FAKE_GH_FAIL" ] && { echo "gh: HTTP 401" >&2; exit 1; }
case "$2" in
  repos/acme/app) echo main ;;
  repos/acme/app/compare/*) bh=\${2#*/compare/}; b=\${bh%...*}; sha=\${bh##*...}
    git -C "${origin}" rev-parse -q --verify "refs/heads/$b" >/dev/null && git -C "${origin}" cat-file -e "$sha^{commit}" 2>/dev/null || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    if git -C "${origin}" merge-base --is-ancestor "$sha" "refs/heads/$b"; then echo behind; else echo ahead; fi ;;
  *) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env }).trim();
git(root, "init", "-q", "--bare", "-b", "main", origin);
git(root, "clone", "-q", origin, main);
git(main, "remote", "set-url", "origin", "https://github.com/acme/app.git");
git(main, "remote", "set-url", "--push", "origin", origin);
writeFileSync(join(main, ".gitignore"), ".env\nnode_modules\n");
git(main, "add", "-A");
git(main, "commit", "-q", "-m", "init");
git(main, "push", "-q", "origin", "main");

/** A worktree `<app>.worktrees/<branch>` with one commit, pushed unless `push` is false. */
function worktree(branch, { push = true, receipt = { workstreams: ["ws-x"] } } = {}) {
  const top = join(projects, "app.worktrees", branch);
  git(main, "worktree", "add", "-q", "-b", branch, top);
  writeFileSync(join(top, `${branch}.txt`), "work\n");
  git(top, "add", "-A");
  git(top, "commit", "-q", "-m", branch);
  if (push) git(top, "push", "-q", "origin", branch);
  const meta = join(main, ".git", "worktrees", branch);
  if (receipt !== undefined) writeFileSync(join(meta, "pi-creator.json"), JSON.stringify({ branch, sessions: ["c1"], ...receipt }));
  return { top, meta };
}

const remove = (target, { cwd = main, from = chat, e = env } = {}) => handle({ argv: ["wt", "remove", ...(target === undefined ? [] : [target])], cwd }, e, [], from);
const refused = async (target, why, options) => {
  const result = await remove(target, options);
  assert.equal(result.code, 2, result.stderr);
  assert.match(result.stderr, /^wt remove: refused: .*; nothing was removed\n$/);
  assert.match(result.stderr, why);
};

test("githubRepo: https and ssh forms of github.com only", () => {
  for (const url of ["https://github.com/acme/app.git", "https://x@github.com/acme/app", "git@github.com:acme/app.git", "ssh://git@github.com/acme/app.git"]) assert.equal(githubRepo(url), "acme/app", url);
  for (const url of ["https://gitlab.com/acme/app.git", "https://github.com.evil.io/acme/app", "/srv/app.git", "https://github.com/../app", ""]) assert.equal(githubRepo(url), undefined, url);
});

test("wt remove moves a pushed, clean worktree and its git folder to the trash with restore.json; .scratch is copied to the owning Workstream; the branch stays; restore and empty work", async () => {
  const w = worktree("done");
  mkdirSync(join(w.top, ".scratch"));
  writeFileSync(join(w.top, ".scratch", "notes.md"), "keep me\n");
  symlinkSync(join(main, "node_modules"), join(w.top, "node_modules"));
  const result = await remove("done");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /✓ Moved worktree .*app\.worktrees\/done and its git folder to .*trash\/\d{8}T\d{6}Z-app-done \(node scripts\/fence-trash\.mjs --restore \S+ puts them back\); its \.scratch is copied to .*ws-x\/rescued-done-\d{4}-\d\d-\d\dT\d{6}; branch done kept/);
  assert.equal(existsSync(w.top), false);
  assert.equal(existsSync(w.meta), false);
  assert.doesNotMatch(git(main, "worktree", "list"), /app\.worktrees\/done/);
  assert.notEqual(git(main, "branch", "--list", "done"), "");
  const rescued = readdirSync(chat).find((d) => d.startsWith("rescued-done-"));
  assert.equal(readFileSync(join(chat, rescued, "notes.md"), "utf8"), "keep me\n");
  const [id] = readdirSync(trash);
  const record = JSON.parse(readFileSync(join(trash, id, "restore.json"), "utf8"));
  assert.deepEqual([record.tree, record.gitDir, record.branch, record.head], [w.top, w.meta, "done", git(main, "rev-parse", "done")]);
  assert.equal(readFileSync(join(trash, id, "tree", ".scratch", "notes.md"), "utf8"), "keep me\n", "the original stays with the tree");
  assert.equal(restore(home, id), w.top);
  assert.match(git(main, "worktree", "list"), /app\.worktrees\/done/);
  assert.equal(git(w.top, "rev-parse", "--abbrev-ref", "HEAD"), "done");
  assert.deepEqual(readdirSync(trash), []);
  rmSync(join(w.top, ".scratch"), { recursive: true });
  const again = await remove("done");
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(empty(home, 14), [], "a fresh entry stays");
  assert.equal(empty(home, 14, Date.now() + 15 * 86_400_000).length, 1);
  assert.deepEqual(readdirSync(trash), []);
});

test("wt remove refuses unless GitHub has every commit: an unpushed head, an unpushed commit only in the HEAD reflog, a forged tracking ref, a non-GitHub origin, a failing gh", async () => {
  worktree("unpushed", { push: false });
  await refused("unpushed", /commit [0-9a-f]{12} of its HEAD history is on no branch of github\.com\/acme\/app; push it first/);
  const r = worktree("reflogged");
  writeFileSync(join(r.top, "lost.txt"), "x\n");
  git(r.top, "add", "-A");
  git(r.top, "commit", "-q", "-m", "lost");
  const lost = git(r.top, "rev-parse", "HEAD");
  git(r.top, "reset", "-q", "--hard", "HEAD~1");
  await refused("reflogged", new RegExp(`commit ${lost.slice(0, 12)} of its HEAD history`));
  const s = worktree("stale");
  git(s.top, "commit", "-q", "--allow-empty", "-m", "local");
  git(main, "update-ref", "refs/remotes/origin/stale", "stale");
  await refused("stale", /of its HEAD history is on no branch/);
  worktree("plain");
  git(main, "remote", "set-url", "origin", "https://gitlab.com/acme/app.git");
  try { await refused("plain", /its origin \(https:\/\/gitlab\.com\/acme\/app\.git\) is no GitHub repository/); } finally { git(main, "remote", "set-url", "origin", "https://github.com/acme/app.git"); }
  await refused("plain", /gh api repos\/acme\/app failed \(gh: HTTP 401\)/, { e: { ...env, FAKE_GH_FAIL: "1" } });
  for (const b of ["unpushed", "reflogged", "stale", "plain"]) assert.ok(existsSync(join(projects, "app.worktrees", b, ".git")), b);
});

test("wt remove refuses local data: a tracked change, an untracked file, an ignored .env, assume-unchanged and skip-worktree files, .scratch without an owning Workstream", async () => {
  const cases = [
    ["edited", (t) => writeFileSync(join(t, "edited.txt"), "changed\n"), /untracked or ignored files: edited\.txt/],
    ["untracked", (t) => writeFileSync(join(t, "new.txt"), "new\n"), /untracked or ignored files: new\.txt/],
    ["secret", (t) => writeFileSync(join(t, ".env"), "TOKEN=1\n"), /untracked or ignored files: \.env/],
    ["assumed", (t) => { git(t, "update-index", "--assume-unchanged", "assumed.txt"); writeFileSync(join(t, "assumed.txt"), "hidden\n"); }, /files git status does not check \(assume-unchanged or skip-worktree\): assumed\.txt/],
    ["skipped", (t) => { git(t, "update-index", "--skip-worktree", "skipped.txt"); writeFileSync(join(t, "skipped.txt"), "hidden\n"); }, /files git status does not check \(assume-unchanged or skip-worktree\): skipped\.txt/],
    ["orphan", (t) => mkdirSync(join(t, ".scratch")), /\.scratch has no owning Workstream/, { workstreams: [] }],
  ];
  for (const [branch, change, why, receipt] of cases) {
    const w = worktree(branch, receipt === undefined ? {} : { receipt });
    change(w.top);
    await refused(w.top, why);
    assert.ok(existsSync(join(w.top, ".git")), w.top);
  }
});

test("wt remove refuses where a Chat works: this Chat's folder, a running command's, another Chat's stored folder in or around it, an unreadable Chat store", async () => {
  const w = worktree("busy");
  await refused("busy", /is this Chat's folder/, { from: join(w.top, "sub") });
  const jobs = join(home, ".pi-workbench", "background-bash", "jobs", "j1");
  mkdirSync(jobs, { recursive: true });
  writeFileSync(join(jobs, "job.json"), JSON.stringify({ cwd: chat, folder: w.top, expiresAt: Date.now() + 60_000 }));
  await refused("busy", /a running command works in .*app\.worktrees\/busy/);
  writeFileSync(join(jobs, "exit"), "{}");
  const store = join(stores, "chat-2");
  mkdirSync(store, { recursive: true });
  mkdirSync(join(stores, "read-only-chat"));
  for (const folder of [join(w.top, "sub"), projects]) {
    writeFileSync(join(store, "fence-folder.json"), JSON.stringify({ cwd: folder, folder }));
    await refused("busy", new RegExp(`a Chat works in ${folder}$|a Chat works in ${folder};`));
  }
  writeFileSync(join(store, "fence-folder.json"), "{");
  await refused("busy", /chat-2\/fence-folder\.json cannot be read, so other Chats' folders are unknown/);
  writeFileSync(join(store, "fence-folder.json"), JSON.stringify({ cwd: main, folder: main }));
  assert.equal((await remove("busy")).code, 0, "another Chat in the main checkout is no obstacle");
});

test("wt remove refuses with the reason: the main checkout, a path through a symbolic link, a locked worktree, a flag", async () => {
  assert.match((await remove(main)).stderr, /is a main checkout, never removed here/);
  const w = worktree("linked");
  const link = join(projects, "link");
  symlinkSync(w.top, link);
  assert.match((await remove(link)).stderr, /passes through a symbolic link/);
  git(main, "worktree", "lock", w.top);
  assert.match((await remove("linked")).stderr, /is locked/);
  assert.match((await handle({ argv: ["wt", "remove", "--force", "linked"], cwd: main }, env, [], chat)).stderr, /wt remove --force: is not available inside the sandbox/);
  assert.ok(existsSync(join(w.top, ".git")));
});
