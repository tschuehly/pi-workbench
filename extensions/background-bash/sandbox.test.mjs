// Write-fence tests on fake folders only: a fake HOME outside every temp folder, so the shared temp grant cannot
// make a forbidden write look allowed. macOS only, like the fence.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { launchJob, readJob } from "./jobs.mjs";
import { alreadyFenced, grants } from "./sandbox.mjs";

const skip = process.platform !== "darwin" ? "the write fence applies on macOS only" : alreadyFenced() && "already inside a fence, which these fake-folder checks cannot see past; run them from an unfenced shell";
const base = process.env.PI_TMP ?? join(homedir(), ".pi-workbench", "tmp");
mkdirSync(base, { recursive: true });
const root = mkdtempSync(join(base, "sandbox-test-"));
after(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home");
const repo = join(home, "IdeaProjects", "app");
const worktree = join(home, "IdeaProjects", "app.feature");
const piTmp = join(home, ".pi-workbench", "tmp", "ws-x", "session");
for (const dir of [repo, join(home, "IdeaProjects", "sibling"), join(home, ".pi-web-durable"), piTmp]) mkdirSync(dir, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: { ...process.env, HOME: home } });
if (!skip) {
  git(repo, "init", "-q");
  git(repo, "commit", "-q", "--allow-empty", "-m", "init");
  git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
}

let n = 0;
async function run(command, { cwd = repo, owned = false, env = {} } = {}) {
  const id = `sandbox-${process.pid}-${n++}`;
  const jobs = join(root, "jobs");
  // Every command below resolves $HOME to the fake home; refuse to run anything if that ever fails.
  assert.ok(home.startsWith(root));
  launchJob({ root: jobs, id, command, description: "Fence test", cwd, timeout: 30, env: { ...process.env, HOME: home, PI_TMP: piTmp, GIT_CONFIG_GLOBAL: "/dev/null", ...env }, sessionId: "sandbox-test", startedAt: Date.now(), owned, cleanupGraceMs: 200 });
  for (const deadline = Date.now() + 25_000; ;) {
    const job = readJob(jobs, id);
    if (job.state !== "running" && job.state !== "pending") return job;
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish`);
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}
const commit = 'echo a > "f$RANDOM" && git add -A && git -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false commit -qm fenced';
const forbidden = 'touch "$HOME/x" "$HOME/.pi-web-durable/x" "$HOME/IdeaProjects/sibling/x" .git/hooks/x "$GITDIR/hooks/x" 2>/dev/null; touch "$PI_TMP/ok"';

for (const owned of [false, true]) {
  const branch = owned ? "child-agent jobs" : "lead jobs";
  test(`${branch}: a commit in the repo works; home, chat store, sibling repo and git hooks stay untouched`, { skip }, async () => {
    const job = await run(`${commit} && ${forbidden.replace("$GITDIR", ".git")}`, { owned });
    assert.equal(job.state, "complete", job.error);
    assert.match(git(repo, "log", "-1", "--format=%s"), /fenced/);
    for (const path of [join(home, "x"), join(home, ".pi-web-durable", "x"), join(home, "IdeaProjects", "sibling", "x"), join(repo, ".git", "hooks", "x")]) assert.equal(existsSync(path), false, path);
    assert.ok(existsSync(join(piTmp, "ok")));
  });

  test(`${branch}: a commit in a linked worktree works; the shared hooks stay read-only`, { skip }, async () => {
    const job = await run(`${commit} && ${forbidden.replace("$GITDIR", join(repo, ".git"))}; touch "${join(repo, "main-checkout-file")}" 2>/dev/null; true`, { cwd: worktree, owned });
    assert.equal(job.state, "complete", job.error);
    assert.match(git(worktree, "log", "-1", "--format=%s"), /fenced/);
    assert.equal(existsSync(join(repo, ".git", "hooks", "x")), false);
    assert.equal(existsSync(join(repo, "main-checkout-file")), false, "the main checkout's files are not part of the worktree's grant");
  });
}

test("a chat started in ~/IdeaProjects (not a repo) is read-only except its temp folder", { skip }, async () => {
  const job = await run('touch here 2>/dev/null; touch app/x 2>/dev/null; touch "$PI_TMP/from-ideaprojects"', { cwd: join(home, "IdeaProjects") });
  assert.equal(job.state, "complete", job.error);
  assert.equal(existsSync(join(home, "IdeaProjects", "here")), false);
  assert.equal(existsSync(join(repo, "x")), false);
  assert.ok(existsSync(join(piTmp, "from-ideaprojects")));
});

test("the 23 Nov command shape, rm -rf on an empty variable, deletes only inside the grant", { skip }, async () => {
  const keep = join(home, "Desktop", "keep.txt");
  mkdirSync(join(home, "Desktop"), { recursive: true });
  writeFileSync(keep, "keep");
  const job = await run('rm -rf "$HOME$EMPTY_STATE_DIR"/* 2>/dev/null; true', { owned: true, env: { EMPTY_STATE_DIR: "" } });
  assert.equal(job.state, "complete", job.error);
  assert.ok(existsSync(keep), "a folder outside the grant survives");
  assert.ok(existsSync(join(home, ".pi-web-durable")), "the chat store survives");
  assert.ok(existsSync(join(home, "IdeaProjects", "sibling")), "a sibling repo survives");
  assert.ok(existsSync(join(worktree, ".git")), "another worktree survives");
  assert.deepEqual(readdirSync(repo).filter((f) => f.startsWith("f")), [], "the granted repo's files were deleted: the fence limits damage to the grant");
});

test("no sandbox-exec: the command never starts", { skip }, async () => {
  const marker = join(piTmp, "should-not-exist");
  for (const owned of [false, true]) {
    const job = await run(`touch "${marker}"`, { owned, env: { PI_SANDBOX_EXEC: join(root, "missing-sandbox-exec") } });
    assert.equal(job.state, "failed");
    assert.match(job.error, /Sandbox unavailable: .*missing-sandbox-exec is missing/);
    assert.equal(existsSync(marker), false);
  }
});

test("a sandbox-exec that does not fence writes fails its check and runs nothing", { skip }, async () => {
  // Runs everything after `--` with no sandbox at all.
  const fake = join(root, "fake-sandbox-exec");
  writeFileSync(fake, '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done; shift; exec "$@"\n');
  chmodSync(fake, 0o755);
  const marker = join(piTmp, "unfenced-run");
  const job = await run(`touch "${marker}"`, { env: { PI_SANDBOX_EXEC: fake } });
  assert.equal(job.state, "failed");
  assert.match(job.error, /failed the write-fence check/);
  assert.equal(existsSync(marker), false);
});

test("private folders and other apps' data cannot be read, so macOS never asks", { skip }, async () => {
  for (const dir of ["Desktop", "Documents", "Downloads", "Pictures", "Library/Containers"]) {
    mkdirSync(join(home, dir), { recursive: true });
    writeFileSync(join(home, dir, "private.txt"), "private");
  }
  const job = await run('for d in Desktop Documents Downloads Pictures Library/Containers; do cat "$HOME/$d/private.txt" >/dev/null 2>&1 && echo "READ $d"; ls "$HOME/$d" >/dev/null 2>&1 && echo "LISTED $d"; done; ls "$HOME" >/dev/null && echo HOME_LISTED', { owned: true });
  assert.equal(job.state, "complete", job.error);
  const out = readFileSync(job.logPath, "utf8");
  assert.doesNotMatch(out, /READ |LISTED /);
  assert.match(out, /HOME_LISTED/, "the home folder itself stays listable");
});

test("inside a fence the runner starts commands under the outer fence instead of failing", { skip: process.platform !== "darwin" && "macOS only" }, () => {
  const out = execFileSync("/usr/bin/sandbox-exec", ["-p", '(version 1)(allow default)(deny file-write*)(allow file-write* (subpath "/dev"))', process.execPath, "--input-type=module", "-e", `import("${new URL("./sandbox.mjs", import.meta.url).href}").then(async (m) => console.log(m.alreadyFenced(), (await m.confine({ shell: "/bin/bash", args: ["-c"], command: "true", cwd: "/" })).file))`], { encoding: "utf8" });
  assert.equal(out.trim(), "true /bin/bash");
  assert.equal(alreadyFenced(), false, "this test process itself is unfenced");
});

test("grants: never home, ~/IdeaProjects, the scratch root or Pi's own state; a scratch folder counts once", () => {
  const h = "/Users/someone";
  const rules = (cwd, extra = {}) => grants({ cwd, home: h, ...extra }).write.filter((p) => !p.includes("Cache") && !p.includes(".npm") && !p.includes("pnpm") && !p.includes(".m2") && !p.includes(".gradle") && !p.includes(".cache"));
  assert.deepEqual(rules(h), []);
  assert.deepEqual(rules(`${h}/IdeaProjects`), []);
  assert.deepEqual(rules(`${h}/.pi-workbench/scratch`), []);
  assert.deepEqual(rules(`${h}/.pi-workbench/scratch/ws-a/research`), [`${h}/.pi-workbench/scratch/ws-a`]);
  assert.deepEqual(rules(h, { piTmp: `${h}/.pi-workbench/tmp/ws-a/s1`, scratch: `${h}/.pi-workbench/scratch/ws-a` }), [`${h}/.pi-workbench/tmp/ws-a/s1`, `${h}/.pi-workbench/scratch/ws-a`]);
  assert.deepEqual(rules(h, { piTmp: `${h}/.pi/agent`, scratch: `${h}/.pi-workbench/workstreams` }), [], "Pi's own state is never granted");
  assert.ok(grants({ cwd: h, home: h }).read.includes(`${h}/.gradle/gradle.properties`));
  assert.ok(grants({ cwd: h, home: h }).hidden.includes(`${h}/Desktop`));
  assert.deepEqual(grants({ cwd: h, home: h, temp: ["/private/tmp"] }).write.slice(0, 1), ["/private/tmp"]);
});
