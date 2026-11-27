// Write-fence tests on fake folders only: a fake HOME outside every temp folder, so the shared temp grant cannot
// make a forbidden write look allowed. macOS only, like the fence.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchJob, readJob } from "./jobs.mjs";
import { plan } from "./host-ops.mjs";
import { grant, revoke } from "../../scripts/fence-grant.mjs";
import { alreadyFenced, fencedEnv, fencedWrite, grantRefusal, grants, grantsFile, mayWrite, ownedWorktrees, profile, toolPaths, workstreamId, writeError, writeRefusal } from "./sandbox.mjs";

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
async function run(command, { cwd = repo, owned = false, env = {}, folder } = {}) {
  const id = `sandbox-${process.pid}-${n++}`;
  const jobs = join(root, "jobs");
  // Every command below resolves $HOME to the fake home; refuse to run anything if that ever fails.
  assert.ok(home.startsWith(root));
  launchJob({ root: jobs, id, command, description: "Fence test", cwd, timeout: 30, env: { ...process.env, HOME: home, PI_TMP: piTmp, GIT_CONFIG_GLOBAL: "/dev/null", ...env }, sessionId: "sandbox-test", startedAt: Date.now(), owned, cleanupGraceMs: 200, ...(folder === undefined ? {} : { folder }) });
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
  const rules = (cwd, extra = {}) => grants({ cwd, home: h, ...extra }).write.filter((p) => !p.includes("sandbox-caches") && !p.endsWith("sandbox-runtime"));
  assert.deepEqual(rules(h), []);
  assert.deepEqual(rules(`${h}/IdeaProjects`), []);
  assert.deepEqual(rules(`${h}/.pi-workbench/scratch`), []);
  assert.deepEqual(rules(`${h}/.pi-workbench/scratch/ws-a/research`), [`${h}/.pi-workbench/scratch/ws-a`]);
  assert.deepEqual(rules(h, { piTmp: `${h}/.pi-workbench/tmp/ws-a/s1`, scratch: `${h}/.pi-workbench/scratch/ws-a` }), [`${h}/.pi-workbench/tmp/ws-a/s1`, `${h}/.pi-workbench/scratch/ws-a`]);
  assert.deepEqual(rules(h, { piTmp: `${h}/.pi/agent`, scratch: `${h}/.pi-workbench/workstreams` }), [], "Pi's own state is never granted");
  // Caches with code Thomas's builds run: never writable; the agents' own instead.
  const all = grants({ cwd: h, home: h });
  for (const cache of [".npm", ".m2", ".gradle", "Library/pnpm", "Library/Caches", ".cache"]) assert.ok(!all.write.some((w) => w === `${h}/${cache}` || w.startsWith(`${h}/${cache}/`)), cache);
  assert.ok(all.write.includes(`${h}/.pi-workbench/sandbox-caches`));
  assert.ok(grants({ cwd: h, home: h }).hidden.includes(`${h}/Desktop`));
  assert.ok(!all.write.some((w) => w.startsWith("/private/") || w.startsWith("/var/")), "no shared system temp folder");
});

test("host operations: only `workstreams` (no @file), `wt switch --create` with --base/--no-cd and `wt remove` of one target without flags, never --execute or --clobber", () => {
  assert.deepEqual(plan(["workstreams", "checkpoint", "ws-a", "--stdin"]), { file: "workstreams", args: ["checkpoint", "ws-a", "--stdin"] });
  assert.deepEqual(plan(["workstreams", "append", "@-"]).args, ["append", "@-"]);
  assert.deepEqual(plan(["wt", "switch", "-c", "feat", "-b", "main"]), { worktree: { branch: "feat", base: "main" } });
  assert.deepEqual(plan(["wt", "switch", "--create", "feat", "--no-cd", "--base=dev"]), { worktree: { branch: "feat", base: "dev" } });
  assert.deepEqual(plan(["wt", "remove", "feat"]), { remove: { target: "feat" } });
  assert.deepEqual(plan(["wt", "remove"]), { remove: { target: undefined } });
  for (const argv of [["wt", "switch", "-c", "feat", "-x", "rm -rf ~"], ["wt", "switch", "-c", "feat", "--clobber"], ["wt", "switch", "-c"], ["wt", "remove", "feat", "--force"], ["wt", "remove", "-f", "-D"], ["wt", "remove", "a", "b"], ["git", "push"], ["wt", "switch", "-c", "feat", "-C", "/"], ["wt", "switch", "-c", "feat", "--base=--upload-pack=x"], ["workstreams", "append", "@/Users/x/Documents/secret"]])
    assert.ok(plan(argv).error, argv.join(" "));
});

test("grants: a Workstream ID never leads out of scratch/, and a worktree whose .git was repointed gets no grant", () => {
  assert.equal(workstreamId("ws-x/../../../Library/LaunchAgents"), undefined);
  assert.equal(workstreamId("ws-a..b"), undefined);
  assert.equal(workstreamId("ws-workbench-sandbox-20261124"), "ws-workbench-sandbox-20261124");
  const h = "/Users/someone";
  assert.deepEqual(grants({ cwd: h, home: h, scratch: `${h}/.pi-workbench/scratch/ws-x/../../../Library/LaunchAgents` }).write.filter((p) => p.includes("Library/LaunchAgents")), []);
});

// Fake programs the runner finds on the job's PATH: they write where no fence grants, proving they ran outside it.
const fakeBin = join(root, "bin");
mkdirSync(fakeBin, { recursive: true });
writeFileSync(join(fakeBin, "workstreams"), '#!/bin/sh\nmkdir -p "$HOME/.pi-workbench/workstreams"\n{ echo "args=$* foo=$FOO"; cat; } > "$HOME/.pi-workbench/workstreams/record"\necho stored\n', { mode: 0o755 });
// Never run by the host operation (it writes the owner record itself): this one would mark that it ran.
writeFileSync(join(fakeBin, "mac-storage-workspaces"), '#!/bin/sh\necho "$@" > "$HOME/owner-script-ran"\n', { mode: 0o755 });
// The real wt, reached only when the shim does not forward a call: it says so.
// `wt config` here stands in for an alias or hook that calls wt again.
writeFileSync(join(fakeBin, "wt"), '#!/bin/sh\necho "REAL_WT_RAN $*"\n[ "$1" = config ] && wt remove from-alias\ntrue\n', { mode: 0o755 });
const withFakes = { PATH: `${fakeBin}:${process.env.PATH}`, PI_SESSION_ID: "sandbox-test" };

for (const owned of [false, true]) {
  test(`${owned ? "child-agent" : "lead"} jobs: \`workstreams\` runs outside the fence with its arguments and stdin, never the command's environment`, { skip }, async () => {
    const job = await run('touch "$HOME/.pi-workbench/workstreams-direct" 2>/dev/null; printf "{\\"what\\":1}" | FOO=agent workstreams checkpoint ws-a --stdin; workstreams append "@$HOME/Desktop/x" || echo at-file-refused', { owned, env: withFakes });
    assert.equal(job.state, "complete", job.error);
    assert.match(readFileSync(job.logPath, "utf8"), /stored[\s\S]*reads a file outside the sandbox[\s\S]*at-file-refused/);
    assert.equal(readFileSync(join(home, ".pi-workbench", "workstreams", "record"), "utf8"), 'args=checkpoint ws-a --stdin foo=\n{"what":1}');
    assert.equal(existsSync(join(home, ".pi-workbench", "workstreams-direct")), false, "the command itself still cannot write there");
    rmSync(join(home, ".pi-workbench", "workstreams", "record"));
  });
}

test("`wt switch --create` makes the `<repo>.worktrees/<branch>` worktree outside the fence (also from inside one) and records its owner; --execute and a repo outside ~/IdeaProjects are refused", { skip }, async () => {
  // Its own repo: the rm -rf test above empties the shared one's .git, as it may inside the grant.
  const tools = join(home, "IdeaProjects", "tools");
  mkdirSync(tools);
  git(tools, "init", "-q");
  git(tools, "commit", "-q", "--allow-empty", "-m", "init");
  // A repo the agent sets up in its temp folder, its hooks pointing at a script: never used outside the fence.
  const planted = join(piTmp, "planted");
  const job = await run([
    'wt switch --create made-by-host --no-cd; echo "exit=$?"',
    `(cd "${join(home, "IdeaProjects", "tools.worktrees", "made-by-host")}" && wt switch --create nested --no-cd); echo "nested=$?"`,
    'wt switch --create other -x "touch $HOME/escaped"; echo "exit=$?"',
    `git init -q "${planted}" && printf '#!/bin/sh\ntouch "$HOME/escaped"\n' > "${planted}/hook" && chmod +x "${planted}/hook" && git -C "${planted}" config core.hooksPath "${planted}" && cd "${planted}" && wt switch --create from-planted; echo "exit=$?"`,
  ].join("; "), { cwd: tools, env: withFakes });
  assert.equal(job.state, "complete", job.error);
  const out = readFileSync(job.logPath, "utf8");
  const tree = join(home, "IdeaProjects", "tools.worktrees", "made-by-host");
  assert.ok(existsSync(join(tree, ".git")), out);
  assert.ok(out.includes("nested=0") && existsSync(join(home, "IdeaProjects", "tools.worktrees", "nested", ".git")), out);
  assert.match(out, /exit=0[\s\S]*-x is not available inside the sandbox[\s\S]*exit=2[\s\S]*run it inside a checkout under ~\/IdeaProjects[\s\S]*exit=2/);
  const record = JSON.parse(readFileSync(join(tools, ".git", "worktrees", "made-by-host", "pi-owner.json"), "utf8"));
  assert.deepEqual([record.branch, record.sessions], ["made-by-host", ["sandbox-test"]]);
  const receipt = JSON.parse(readFileSync(join(tools, ".git", "worktrees", "made-by-host", "pi-creator.json"), "utf8"));
  assert.deepEqual([receipt.branch, receipt.sessions, receipt.workstreams], ["made-by-host", ["sandbox-test"], []], "a creation receipt beside the cleanup record");
  assert.equal(existsSync(join(home, "owner-script-ran")), false, "no owner-record script ran");
  assert.equal(existsSync(join(home, "escaped")), false);
  assert.equal(git(tools, "branch", "--list", "other").trim(), "", "a refused call creates nothing");
});

test("inside the sandbox the real wt runs only list, switch and config: removal, merge, step, hooks and aliases are refused, after any global options and without a runner", { skip }, async () => {
  const main = join(home, "IdeaProjects", "rm");
  mkdirSync(main);
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  const done = join(home, "IdeaProjects", "rm.done");
  git(main, "worktree", "add", "-q", "-b", "done", done);
  const receipt = join(main, ".git", "worktrees", "rm.done", "pi-creator.json");
  writeFileSync(receipt, JSON.stringify({ branch: "done", sessions: ["sandbox-test"], workstreams: [] }));
  const refused = ["remove done --foreground", "remove done --force -D", "-y remove done", "-C . remove done", "--config /dev/null -v remove done", "-yC . remove done", "merge", "merge --no-remove", "merge -- --no-remove", "step prune", "step promote", "hook pre-remove", "my_alias", "help", "-y switch --create made --no-cd", "switch --clobber other", "-y switch other --clobber"];
  // What the real wt receives: a local switch always without hooks.
  const allowed = { "list": "list", "-C . list": "-C . list", "--config=/dev/null switch other": "--config=/dev/null switch --no-hooks other", "--version": "--version", "config": "config" };
  const job = await run([...refused.map((r) => `wt ${r}; echo "exit=$?"`), `cd "${done}" && PI_HOST_OPS= wt remove; echo "exit=$?"`, ...Object.keys(allowed).map((r) => `wt ${r}; echo "exit=$?"`)].join("; "), { cwd: main, env: withFakes });
  assert.equal(job.state, "complete", job.error);
  const out = readFileSync(job.logPath, "utf8");
  assert.equal(out.match(/is not available inside the sandbox[^\n]*\nexit=2/g)?.length, refused.length + 1, out);
  assert.match(out, /REAL_WT_RAN config\nwt remove: refused: /, "a wt started by the real wt meets the shim too");
  for (const r of Object.values(allowed)) assert.ok(out.includes(`REAL_WT_RAN ${r}\n`), r);
  assert.ok(existsSync(join(done, ".git")) && existsSync(receipt), "tree and receipt stay");
  assert.equal(git(main, "branch", "--list", "done", "--format=%(refname:short)").trim(), "done", "the branch stays");
  assert.equal(out.match(/REAL_WT_RAN/g).length, Object.keys(allowed).length, "the real wt ran only the allowed commands");
});

// The shim alone, no fence needed (so it also runs inside one): two PATH folders each link `wt` to it.
test("wt shim: refuses --clobber, runs a local switch without hooks, and finds the real wt by real path past every link to itself", () => {
  const shim = join(dirname(fileURLToPath(import.meta.url)), "host-ops", "host-op.mjs");
  const [a, b, realBin] = ["shim-a", "shim-b", "real-wt"].map((d) => mkdtempSync(join(root, `${d}-`)));
  for (const d of [a, b]) symlinkSync(shim, join(d, "wt"));
  writeFileSync(join(realBin, "wt"), '#!/bin/sh\necho "REAL_WT_RAN $*"\n', { mode: 0o755 });
  const wt = (...args) => spawnSync(join(a, "wt"), args, { encoding: "utf8", timeout: 10_000, env: { PATH: [a, b, realBin, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter) } });
  const local = wt("-y", "switch", "other");
  assert.equal(local.stdout, "REAL_WT_RAN -y switch --no-hooks other\n", local.stderr || local.error?.message);
  for (const args of [["switch", "--clobber", "x"], ["switch", "x", "--clobber=true"]]) {
    const refused = wt(...args);
    assert.equal(refused.status, 2, args.join(" "));
    assert.match(refused.stderr, /--clobber: is not available inside the sandbox/);
  }
  // Without a runner a `switch --create` runs the real wt here, also without hooks.
  assert.equal(wt("switch", "--create", "n").stdout, "REAL_WT_RAN switch --no-hooks --create n\n");
  assert.equal(wt("list").stdout, "REAL_WT_RAN list\n");
});

// Same shim setup, one subtest per hardening so each fails on its own.
test("wt shim: grouped short options, a repeated --no-hooks, options after `--`, a relative PATH entry and a folder named wt", async (t) => {
  const shim = join(dirname(fileURLToPath(import.meta.url)), "host-ops", "host-op.mjs");
  const [a, realBin, dot, folder] = ["shim-a", "real-wt", "dot-wt", "folder-wt"].map((d) => mkdtempSync(join(root, `${d}-`)));
  symlinkSync(shim, join(a, "wt"));
  writeFileSync(join(realBin, "wt"), '#!/bin/sh\necho "REAL_WT_RAN $*"\n', { mode: 0o755 });
  writeFileSync(join(dot, "wt"), '#!/bin/sh\necho "DOT_WT $0 $*"\n', { mode: 0o755 });
  mkdirSync(join(folder, "wt"));
  const wt = (args, { path = [a, realBin], cwd, env = {} } = {}) => spawnSync(join(a, "wt"), args, { cwd, encoding: "utf8", timeout: 10_000, env: { ...env, PATH: [...path, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter) } });
  await t.test("a short-option group could hide --create or --clobber: refused", () => {
    for (const group of ["-yc", "-cy"]) {
      const refused = wt(["switch", group, "n"]);
      assert.equal(refused.status, 2, group);
      assert.match(refused.stderr, /write each short option separately/);
    }
  });
  await t.test("a value attached to -x is no group: both spellings run", () => {
    for (const args of [["switch", "topic", "-xpwd"], ["switch", "topic", "-x", "pwd"]]) assert.equal(wt(args).stdout, `REAL_WT_RAN switch --no-hooks ${args.slice(1).join(" ")}\n`, args.join(" "));
  });
  await t.test("--no-hooks goes in once", () => {
    assert.equal(wt(["switch", "--no-hooks", "other"]).stdout, "REAL_WT_RAN switch --no-hooks other\n");
  });
  await t.test("options end at `--`: --execute's arguments neither refuse nor forward", () => {
    const args = ["switch", "other", "-x", "echo", "--", "--clobber", "--no-hooks", "-c"];
    const ran = wt(args, { env: { PI_HOST_OPS: join(root, "no-runner.sock") } });
    assert.equal(ran.stdout, `REAL_WT_RAN switch --no-hooks ${args.slice(1).join(" ")}\n`, ran.stderr);
  });
  await t.test("a relative PATH entry: the real wt runs by its absolute path, never a bare name the lookup could send to the shim", () => {
    const ran = wt(["list"], { path: [".", a], cwd: dot });
    assert.equal(ran.stdout, `DOT_WT ${join(realpathSync(dot), "wt")} list\n`, ran.stderr);
  });
  await t.test("`wt remove` goes to the runner only: without one, or after global options, it is refused and the real wt never runs", () => {
    for (const [args, why] of [[["remove", "x"], /without its runner/], [["-y", "remove", "x"], /after global options/]]) {
      const refused = wt(args, { env: args[0] === "-y" ? { PI_HOST_OPS: join(root, "no-runner.sock") } : {} });
      assert.equal(refused.status, 2, args.join(" "));
      assert.match(refused.stderr, why);
      assert.equal(refused.stdout, "");
    }
  });
  await t.test("only a regular file counts as the real wt, not a folder named wt", () => {
    const ran = wt(["list"], { path: [folder, a, realBin] });
    assert.equal(ran.stdout, "REAL_WT_RAN list\n", ran.stderr);
  });
});

test("a chat in its scratch folder may write the worktrees whose creation receipt names it; a cleanup owner record grants nothing; it cannot forge one", { skip }, async () => {
  const main = join(home, "IdeaProjects", "lib");
  const mine = join(home, "IdeaProjects", "lib.mine");
  const theirs = join(home, "IdeaProjects", "lib.theirs");
  mkdirSync(main);
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "worktree", "add", "-q", "-b", "mine", mine);
  git(main, "worktree", "add", "-q", "-b", "theirs", theirs);
  const meta = join(main, ".git", "worktrees");
  writeFileSync(join(meta, "lib.mine", "pi-creator.json"), JSON.stringify({ sessions: ["sandbox-test:child-1"], workstreams: [] }));
  writeFileSync(join(meta, "lib.theirs", "pi-creator.json"), JSON.stringify({ sessions: ["another-chat"], workstreams: ["ws-other"] }));
  const viaWorkstream = join(home, "IdeaProjects", "lib.ws");
  git(main, "worktree", "add", "-q", "-b", "ws", viaWorkstream);
  writeFileSync(join(meta, "lib.ws", "pi-creator.json"), JSON.stringify({ sessions: ["earlier-chat"], workstreams: ["ws-x"] }));
  // Adopted: another chat made it; `mac-storage-workspaces --record-owner` later added this chat and ws-x as cleanup owners.
  const adopted = join(home, "IdeaProjects", "lib.adopted");
  git(main, "worktree", "add", "-q", "-b", "adopted", adopted);
  writeFileSync(join(meta, "lib.adopted", "pi-creator.json"), JSON.stringify({ sessions: ["another-chat"], workstreams: [] }));
  writeFileSync(join(meta, "lib.adopted", "pi-owner.json"), JSON.stringify({ sessions: ["another-chat", "sandbox-test"], workstreams: ["ws-other", "ws-x"] }));
  // A forged record: a worktree entry naming this chat, pointing at the main checkout (whose .git is a folder).
  mkdirSync(join(meta, "forged"));
  writeFileSync(join(meta, "forged", "gitdir"), `${join(main, ".git")}\n`);
  writeFileSync(join(meta, "forged", "pi-creator.json"), JSON.stringify({ sessions: ["sandbox-test"] }));
  assert.deepEqual(ownedWorktrees(home, ["sandbox-test"]).filter((p) => p.includes(`${sep}lib.`)), [mine], "a child's session counts as its chat; theirs, the adopted one and the forgery do not");
  const scratchDir = join(home, ".pi-workbench", "scratch", "ws-x");
  mkdirSync(scratchDir, { recursive: true });
  const job = await run([
    `cd "${mine}" && ${commit}`,
    `cd "${viaWorkstream}" && ${commit}`,
    `printf 'gitdir: ${join(main, ".git")}\n' > "${join(mine, ".git")}" 2>/dev/null`,
    `touch "${join(theirs, "x")}" "${join(main, "x")}" "${join(meta, "lib.mine", "pi-owner.json")}" "${join(meta, "lib.mine", "gitdir")}" "${join(main, ".git", "pi-owner.json")}" 2>/dev/null`,
    `mkdir "${join(meta, "planted")}" 2>/dev/null`,
    `echo "{}" > "${join(meta, "lib.theirs", "pi-creator.json")}" 2>/dev/null`,
    `touch "${join(adopted, "x")}" 2>/dev/null`,
    `cd "${main}" && wt switch --create from-ws --no-cd; echo "exit=$?"`,
    `cd "${main}" && wt remove adopted; echo "exit=$?"`,
    "true",
  ].join("; "), { cwd: scratchDir, owned: true, env: withFakes });
  assert.equal(job.state, "complete", job.error);
  assert.match(git(mine, "log", "-1", "--format=%s"), /fenced/, "a commit in the owned worktree works");
  assert.match(git(viaWorkstream, "log", "-1", "--format=%s"), /fenced/, "a worktree of the Workstream whose scratch folder the chat started in");
  assert.match(readFileSync(join(mine, ".git"), "utf8"), /worktrees\/lib\.mine/, "its .git file cannot be repointed");
  for (const path of [join(theirs, "x"), join(main, "x"), join(main, ".git", "pi-owner.json"), join(meta, "planted"), join(adopted, "x")]) assert.equal(existsSync(path), false, path);
  assert.match(readFileSync(join(meta, "lib.mine", "pi-creator.json"), "utf8"), /child-1/, "its own creation receipt is unchanged");
  assert.match(readFileSync(join(meta, "lib.theirs", "pi-creator.json"), "utf8"), /another-chat/);
  const out = readFileSync(job.logPath, "utf8");
  assert.match(out, /exit=0[\s\S]*wt remove: refused: [^\n]*\nexit=2/, out);
  assert.ok(existsSync(join(adopted, ".git")), "a cleanup owner cannot remove it");
  // The receipt names the chat and only the Workstream whose scratch folder it started in, never every one it is linked to.
  const receipt = JSON.parse(readFileSync(join(meta, "lib.from-ws", "pi-creator.json"), "utf8"));
  assert.deepEqual([receipt.branch, receipt.sessions, receipt.workstreams], ["from-ws", ["sandbox-test"], ["ws-x"]]);
});

test("fenced `wt remove` removes a pushed, clean worktree outside the fence with its git filters fenced, and refuses an unpushed one", { skip }, async () => {
  const origin = join(root, "pushed-origin.git");
  const app = join(home, "IdeaProjects", "pushed");
  git(root, "init", "-q", "--bare", origin);
  git(root, "clone", "-q", origin, app);
  git(app, "commit", "-q", "--allow-empty", "-m", "init");
  git(app, "push", "-q", "origin", "HEAD");
  const done = join(home, "IdeaProjects", "pushed.worktrees", "done");
  const unpushed = join(home, "IdeaProjects", "pushed.worktrees", "unpushed");
  git(app, "worktree", "add", "-q", "-b", "done", done);
  git(app, "worktree", "add", "-q", "-b", "unpushed", unpushed);
  // A clean filter (Thomas's repo config) whose script sits in the checkout, where any fenced Chat could edit it.
  const sentinel = join(home, "filter-escaped");
  writeFileSync(join(done, "spy.sh"), `#!/bin/sh\ntouch "${sentinel}" 2>/dev/null; exec cat\n`, { mode: 0o755 });
  git(app, "config", "filter.spy.clean", join(done, "spy.sh"));
  writeFileSync(join(done, ".gitattributes"), "*.txt filter=spy\n");
  writeFileSync(join(done, "a.txt"), "a\n");
  git(done, "add", "-A");
  git(done, "commit", "-q", "-m", "done");
  git(done, "push", "-q", "origin", "done");
  git(unpushed, "commit", "-q", "--allow-empty", "-m", "local only");
  // Files an hour old (no Chat active there); a.txt is then stat-dirty, so git status runs the filter: unfenced it escapes.
  const then = new Date(Date.now() - 3600_000);
  const age = () => { for (const p of execFileSync("find", [done, unpushed, join(app, ".git", "worktrees")], { encoding: "utf8" }).trim().split("\n")) utimesSync(p, then, then); };
  age();
  rmSync(sentinel, { force: true });
  git(done, "status", "--porcelain");
  assert.ok(existsSync(sentinel), "the fixture's filter does run unfenced");
  rmSync(sentinel);
  age();
  const job = await run(`wt remove done; echo "exit=$?"; wt remove unpushed; echo "exit=$?"`, { cwd: app, env: withFakes });
  assert.equal(job.state, "complete", job.error);
  const out = readFileSync(job.logPath, "utf8");
  assert.match(out, /✓ Removed worktree [^\n]*pushed\.worktrees\/done; deleted branch done \(same as origin\/done\)\nexit=0/, out);
  assert.match(out, /wt remove: refused: its head [0-9a-f]{12} is on no branch of origin; push it first; nothing was removed\nexit=2/, out);
  assert.equal(existsSync(done), false);
  assert.ok(existsSync(join(unpushed, ".git")));
  assert.equal(existsSync(sentinel), false, "the filter ran only inside the narrowed fence");
});

test("fenced commands cannot reach PI WEB's port, its or the hosts' sockets, or another job's host operations", { skip }, async () => {
  const { createServer } = await import("node:net");
  const servers = [];
  const listen = (where) => new Promise((resolve, reject) => { const server = createServer((socket) => socket.end("hello\n")); servers.push(server); server.once("error", reject); server.listen(where, () => resolve(server)); });
  // A short socket path (the 104-byte limit): a stand-in PI WEB data folder in the system temp folder.
  const dataDir = mkdtempSync(join(tmpdir(), "pw-"));
  mkdirSync(join(dataDir, "hosts"));
  // A host socket folder outside the data folder (PI_WEB_DURABLE_HOST_DIR), as the host announces it.
  const hostDir = mkdtempSync(join(tmpdir(), "ph-"));
  const otherOps = join(userInfo().homedir, ".pi-workbench", "sandbox", "ops", `test-${process.pid}.sock`);
  mkdirSync(dirname(otherOps), { recursive: true });
  try {
    const web = await listen(0);
    await listen(join(dataDir, "hosts", "h.sock"));
    await listen(otherOps);
    await listen(join(hostDir, "h.sock"));
    const free = await listen(0);
    const nc = (target) => `nc ${target} </dev/null 2>/dev/null | grep -q hello && echo REACHED || echo REFUSED`;
    const job = await run([nc(`-w2 127.0.0.1 ${web.address().port}`), nc(`-U -w2 "${join(dataDir, "hosts", "h.sock")}"`), nc(`-U -w2 "${otherOps}"`), nc(`-U -w2 "${join(hostDir, "h.sock")}"`), nc(`-w2 127.0.0.1 ${free.address().port}`)].join("; "), { env: { PI_WEB_PORT: String(web.address().port), PI_WEB_DATA_DIR: dataDir, PI_DURABLE_HOST_SOCKET_DIR: hostDir } });
    assert.equal(job.state, "complete", job.error);
    assert.deepEqual(readFileSync(job.logPath, "utf8").trim().split("\n"), ["REFUSED", "REFUSED", "REFUSED", "REFUSED", "REACHED"], "only the unrelated port answers");
  } finally {
    for (const server of servers) server.close();
    rmSync(otherOps, { force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(hostDir, { recursive: true, force: true });
  }
});

test("signals reach only the command's own processes: no SIGUSR1 opens an unfenced Node debugger", { skip }, async () => {
  const { spawn } = await import("node:child_process");
  const outsider = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    const job = await run(`kill -USR1 ${outsider.pid} 2>/dev/null && echo OUTSIDER_SIGNALLED || echo OUTSIDER_REFUSED; sleep 30 & kill $! && echo OWN_KILLED`);
    assert.equal(job.state, "complete", job.error);
    assert.deepEqual(readFileSync(job.logPath, "utf8").trim().split("\n"), ["OUTSIDER_REFUSED", "OWN_KILLED"]);
    assert.equal(outsider.exitCode, null, "the outside process is untouched");
  } finally { outsider.kill(); }
});

test("a planted commondir or a relative hooks folder never runs through the worktree host operation", { skip }, async () => {
  const app = join(home, "IdeaProjects", "hooked");
  const wtree = join(home, "IdeaProjects", "hooked.mine");
  mkdirSync(app);
  git(app, "init", "-q");
  git(app, "commit", "-q", "--allow-empty", "-m", "init");
  git(app, "worktree", "add", "-q", "-b", "mine", wtree);
  git(app, "config", "core.hooksPath", ".githooks");
  mkdirSync(join(app, ".githooks"));
  writeFileSync(join(app, ".githooks", "post-checkout"), `#!/bin/sh\ntouch "${join(home, "hook-ran")}"\n`, { mode: 0o755 });
  writeFileSync(join(app, ".git", "worktrees", "hooked.mine", "pi-creator.json"), JSON.stringify({ sessions: ["sandbox-test"] }));
  // From its owned worktree the chat can write the shared git folder, but not plant a commondir there.
  const job = await run(`printf '${piTmp}\\n' > "${join(app, ".git", "commondir")}" 2>/dev/null || echo COMMONDIR_REFUSED; wt switch --create via-host; echo "exit=$?"`, { cwd: wtree, env: withFakes });
  assert.equal(job.state, "complete", job.error);
  const out = readFileSync(job.logPath, "utf8");
  assert.match(out, /COMMONDIR_REFUSED[\s\S]*exit=0/);
  assert.ok(existsSync(join(home, "IdeaProjects", "hooked.via-host", ".git")), out);
  assert.equal(existsSync(join(home, "hook-ran")), false, "no hook ran outside the fence");
  // Planted by someone outside the fence: the host operation refuses the repo.
  writeFileSync(join(app, ".git", "commondir"), `${piTmp}\n`);
  const again = await run('wt switch --create second; echo "exit=$?"', { cwd: wtree, env: withFakes });
  assert.match(readFileSync(again.logPath, "utf8"), /run it inside a checkout under ~\/IdeaProjects[\s\S]*exit=2/);
  rmSync(join(app, ".git", "commondir"));
});

test("git history: commits, branch deletes and fetches work; the command cannot delete, move or overwrite objects", { skip }, async () => {
  const hist = join(home, "IdeaProjects", "history");
  const src = join(piTmp, "history-src");
  for (const dir of [hist, src]) { mkdirSync(dir, { recursive: true }); git(dir, "init", "-q"); git(dir, "commit", "-q", "--allow-empty", "-m", "init"); }
  const g = "git -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false";
  const job = await run([
    `${commit} && echo COMMIT_OK`,
    `${g} branch gone && ${g} branch -D gone >/dev/null 2>&1 && echo BRANCH_DELETED`,
    // unpackLimit=1 keeps the fetched pack, so git writes and removes a .keep file and renames a temporary pack.
    `${g} -c fetch.unpackLimit=1 fetch -q "${src}" HEAD:refs/heads/fetched && echo FETCH_OK`,
    `rm -rf .git/objects 2>/dev/null || echo RM_REFUSED`,
    `mv .git/objects .git/moved 2>/dev/null || echo MV_REFUSED`,
    `f=$(find .git/objects -type f -path "*/objects/[0-9a-f][0-9a-f]/*" | head -1); chmod u+w "$f"; : 2>/dev/null > "$f" || echo OVERWRITE_REFUSED`,
    // gc packs what it can; the objects it would delete stay.
    `${g} gc -q 2>/dev/null; echo GC_RAN`,
    `{ echo "$PI_TMP/alt" > .git/objects/info/alternates; } 2>/dev/null && echo ALTERNATES_WRITTEN || echo ALTERNATES_REFUSED`,
  ].join("; "), { cwd: hist });
  assert.equal(job.state, "complete", job.error);
  assert.deepEqual(readFileSync(job.logPath, "utf8").trim().split("\n"), ["COMMIT_OK", "BRANCH_DELETED", "FETCH_OK", "RM_REFUSED", "MV_REFUSED", "OVERWRITE_REFUSED", "GC_RAN", "ALTERNATES_REFUSED"]);
  git(hist, "fsck", "--no-progress");
  assert.match(git(hist, "log", "-1", "--format=%s"), /fenced/);
  assert.equal(git(hist, "for-each-ref", "--format=%(refname)", "refs/heads/fetched").trim(), "refs/heads/fetched");
});

// Runs inside a fence too: it only builds the environment, so pnpm 12's lock folder is checked even where the
// fenced-run tests skip themselves.
test("pnpm 12's lock folder: XDG_RUNTIME_DIR is one user-only folder outside the agent caches, never /tmp; only its contents are granted", () => {
  const fake = mkdtempSync(join(root, "env-home-"));
  const runtime = join(realpathSync(fake), ".pi-workbench", "sandbox-runtime");
  const env = fencedEnv({ PATH: process.env.PATH, XDG_RUNTIME_DIR: "/tmp" }, fake, undefined);
  assert.equal(env.XDG_RUNTIME_DIR, runtime);
  assert.equal(statSync(runtime).mode & 0o777, 0o700);
  assert.equal(fencedEnv({}, fake, undefined).XDG_RUNTIME_DIR, runtime, "every fenced job shares it");
  // A mode loosened before the fence existed is reset; pnpm would otherwise fall back to /tmp and fail.
  chmodSync(runtime, 0o777);
  assert.equal(fencedEnv({}, fake, undefined).XDG_RUNTIME_DIR, runtime);
  assert.equal(statSync(runtime).mode & 0o777, 0o700);
  // Anything but a real folder is never handed out.
  rmSync(runtime, { recursive: true });
  symlinkSync(mkdtempSync(join(root, "elsewhere-")), runtime);
  assert.equal(fencedEnv({ XDG_RUNTIME_DIR: "/tmp" }, fake, undefined).XDG_RUNTIME_DIR, undefined, "nor an inherited one");
  const g = grants({ cwd: fake, home: fake });
  assert.ok(g.write.includes(runtime) && g.locked.includes(runtime), "contents writable, the folder itself locked");
});

// Runs inside a fence too: it only computes the grants and resolves paths, on a fake home.
test("file-edit tools: a path is writable exactly where the Chat's commands could write it", async () => {
  const fake = realpathSync(mkdtempSync(join(root, "edit-home-")));
  const app = join(fake, "IdeaProjects", "app");
  mkdirSync(app, { recursive: true });
  execFileSync("git", ["init", "-q", app]);
  const outside = mkdtempSync(join(root, "edit-outside-"));
  symlinkSync(outside, join(app, "link-out"));
  symlinkSync(join(app, "gone"), join(app, "dangling"));
  const env = { HOME: fake, PI_TMP: join(fake, ".pi-workbench", "tmp", "ws-x", "s"), PI_WORKBENCH_WORKSTREAM_DIR: join(fake, "workstreams") };
  mkdirSync(env.PI_TMP, { recursive: true });
  const refusal = (path) => writeRefusal(path, { cwd: app, sessionId: "edit-test", env });
  for (const path of ["src/new/file.ts", "@README.md", join(app, "link-out", "..", "x"), join(env.PI_TMP, "x")]) assert.equal(await refusal(path), undefined, path);
  const refused = [join(fake, "elsewhere"), "~/elsewhere", "../app.other/x", "AGENTS.md", ".pi/settings.json", ".git/hooks/pre-commit", ".git/config", ".git/objects/ab/cdef", "link-out/x", "dangling", join(outside, "x")];
  for (const path of refused) assert.match(await refusal(path) ?? "", /^Blocked: .* outside this Chat's write folders/, path);
  // Review of fc1e881: every spelling a tool may make of the path; case and Unicode form as APFS sees them; a locked
  // name that creating parent folders would make.
  const reviewed = [pathToFileURL(join(outside, "x")).href, "@~/elsewhere", ".GIT/Config", "AGENTS.MD", ".git/commondir/x"];
  const allowed = [];
  for (const path of reviewed) if (!/^Blocked: /.test(await refusal(path) ?? "")) allowed.push(path);
  assert.deepEqual(allowed, [], "each one refused");
  assert.match(await writeRefusal(join(fake, "x"), { cwd: fake, sessionId: "edit-test", env }) ?? "", /^Blocked/, "a Chat in home writes only PI_TMP, like its commands");
  assert.equal(await writeRefusal(join(env.PI_TMP, "y"), { cwd: fake, sessionId: "edit-test", env }), undefined);
  // Astra re-check of 2604454: the path Durable writes (`@` stripped, spaces made plain) is among the approved ones.
  assert.ok(toolPaths("@src/a\u00A0b.ts", { cwd: app, env }).includes(join(app, "src", "a b.ts")));
  assert.ok(toolPaths("file:///x//file.txt", { cwd: app, env }).includes("/x/file.txt"), "normalized as Durable resolves it");
  // Astra re-check of 97836da: codemode's OS-temp folders, written unfenced, are never a write or edit tool's target.
  assert.match(await refusal(join(realpathSync(tmpdir()), "pi-codemode-x", "out.png")) ?? "", /^Blocked/);
  // The helper's reason is the text after a message's last ": ", never a file name; only EPERM is the fence.
  const cause = (stderr) => { const e = writeError(stderr, "/x", 1); return [e.code, /write fence/.test(e.message)]; };
  assert.deepEqual(cause("sh: /a/Operation not permitted/f: Is a directory\n"), ["EISDIR", false]);
  assert.deepEqual(cause("sh: /a/f: Permission denied\n"), ["EACCES", false]);
  assert.deepEqual(cause("mkdir: /a/Is a directory: Operation not permitted\n"), ["EPERM", true]);
  assert.deepEqual(cause(""), ["EIO", false]);
});

// D13: the approval (writeRefusal, before the tool runs) does not bind the write; the write itself runs in the fence.
test("file-edit tools: a folder swapped for a link after the approval leads nowhere; an allowed write works; no sandbox writes nothing", { skip }, async () => {
  const fake = realpathSync(mkdtempSync(join(root, "race-home-")));
  const app = join(fake, "IdeaProjects", "app");
  mkdirSync(join(app, "src"), { recursive: true });
  execFileSync("git", ["init", "-q", app]);
  writeFileSync(join(app, "src", "f.txt"), "inside");
  const outside = realpathSync(mkdtempSync(join(root, "race-outside-")));
  writeFileSync(join(outside, "f.txt"), "orig");
  const env = { HOME: fake, PI_TMP: join(fake, ".pi-workbench", "tmp", "ws-x", "s"), PI_WORKBENCH_WORKSTREAM_DIR: join(fake, "workstreams") };
  const at = { cwd: app, sessionId: "race-test", env };
  const created = join(app, "src", "new.txt");
  const edited = join(app, "src", "f.txt");
  for (const path of [created, edited]) assert.equal(await writeRefusal(path, at), undefined, `approved: ${path}`);
  // A background job's swap between approval and write.
  rmSync(join(app, "src"), { recursive: true });
  symlinkSync(outside, join(app, "src"));
  await assert.rejects(fencedWrite(created, "new", at), /Blocked by the write fence/, "write");
  await assert.rejects(fencedWrite(edited, "changed", at), /Blocked by the write fence/, "edit");
  assert.equal(existsSync(join(outside, "new.txt")), false);
  assert.equal(readFileSync(join(outside, "f.txt"), "utf8"), "orig");
  // Allowed: parents made, content exact; git's objects stay out of reach.
  await fencedWrite(join(app, "a", "b", "c.txt"), "ü\n", at);
  assert.equal(readFileSync(join(app, "a", "b", "c.txt"), "utf8"), "ü\n");
  await assert.rejects(fencedWrite(join(app, ".git", "objects", "ab", "cdef"), "x", at), /Blocked by the write fence/);
  // Ordinary errors keep their cause; a cancel before the helper starts writes nothing.
  await assert.rejects(fencedWrite(join(app, "a"), "x", at), (error) => error.code === "EISDIR" && !/write fence/.test(error.message));
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(fencedWrite(join(app, "late.txt"), "x", { ...at, signal: cancelled.signal }), { code: "ABORT_ERR" });
  assert.equal(existsSync(join(app, "late.txt")), false);
  await assert.rejects(fencedWrite(join(app, "none.txt"), "x", { ...at, env: { ...env, PI_SANDBOX_EXEC: join(fake, "missing") } }), /Sandbox unavailable/);
  assert.equal(existsSync(join(app, "none.txt")), false);
});

test("temp and caches: TMPDIR is the Chat's PI_TMP; shared temp and Thomas's code caches stay untouched, the agents' own caches work", { skip }, async () => {
  const shared = mkdtempSync(join(tmpdir(), "fence-shared-"));
  mkdirSync(join(home, ".gradle", "caches", "modules-2"), { recursive: true });
  mkdirSync(join(home, ".npm"), { recursive: true });
  mkdirSync(join(home, "Library", "Caches", "ms-playwright"), { recursive: true });
  mkdirSync(join(home, ".cache"), { recursive: true });
  mkdirSync(join(home, "Library", "pnpm", "store"), { recursive: true });
  try {
    const job = await run([
      'echo "tmp=$TMPDIR"', 'touch "${TMPDIR}t" && echo TMP_OK',
      'ln -sfn / "${TMPDIR%/}" 2>/dev/null && echo RELINKED || echo RELINK_DENIED',
      `touch "${join(shared, "x")}" 2>/dev/null && echo SHARED_WRITTEN || echo SHARED_DENIED`,
      'touch /private/tmp/fence-x-$$ 2>/dev/null && { rm -f /private/tmp/fence-x-$$; echo SLASHTMP_WRITTEN; } || echo SLASHTMP_DENIED',
      'for c in .gradle/caches/modules-2 .npm Library/Caches/ms-playwright Library/Caches .cache Library/pnpm/store; do touch "$HOME/$c/x" 2>/dev/null && echo "WRITTEN $c" || echo "DENIED $c"; done',
      'mkdir -p "$GRADLE_USER_HOME" "$npm_config_cache" "$PLAYWRIGHT_BROWSERS_PATH" && echo AGENT_CACHES_OK',
      // pnpm 12 locks its store in XDG_RUNTIME_DIR, only if just this user can write it (else /tmp, denied above).
      'mkdir "$XDG_RUNTIME_DIR/pnpm-store-operation-locks" && echo "runtime=$XDG_RUNTIME_DIR $(stat -f %Lp "$XDG_RUNTIME_DIR")"',
      'chmod 777 "$XDG_RUNTIME_DIR" 2>/dev/null && echo RUNTIME_CHMODDED || echo RUNTIME_CHMOD_DENIED',
      'mv "$XDG_RUNTIME_DIR" "$XDG_RUNTIME_DIR.x" 2>/dev/null && echo RUNTIME_MOVED || echo RUNTIME_MOVE_DENIED',
      'echo "ro=$GRADLE_RO_DEP_CACHE"; echo "maven=$MAVEN_OPTS"',
    ].join("; "));
    assert.equal(job.state, "complete", job.error);
    const caches = join(home, ".pi-workbench", "sandbox-caches");
    const lines = readFileSync(job.logPath, "utf8").trim().split("\n");
    // A short link to PI_TMP (the 104-byte socket path limit), in a folder the command cannot write.
    const link = lines[0].slice("tmp=".length, -1);
    assert.equal(realpathSync(link), realpathSync(piTmp));
    // In production 42 bytes under /Users/<name>, so sockets there fit (this fake home is too long to show it).
    assert.match(link, /\/\.pi-workbench\/t\/[0-9a-f]{12}$/);
    assert.deepEqual(lines.slice(1), ["TMP_OK", "RELINK_DENIED", "SHARED_DENIED", "SLASHTMP_DENIED", "DENIED .gradle/caches/modules-2", "DENIED .npm", "DENIED Library/Caches/ms-playwright", "DENIED Library/Caches", "DENIED .cache", "DENIED Library/pnpm/store", "AGENT_CACHES_OK", `runtime=${join(home, ".pi-workbench", "sandbox-runtime")} 700`, "RUNTIME_CHMOD_DENIED", "RUNTIME_MOVE_DENIED", `ro=${join(home, ".gradle", "caches")}`, `maven=-Dmaven.repo.local=${join(caches, "m2", "repository")}`]);
    assert.ok(existsSync(join(caches, "gradle")));
  } finally { rmSync(shared, { recursive: true, force: true }); }
});

// Runs inside a fence too: it only computes the grants (the owner CLI's functions write the fake home's grant file).
test("Workstream grants: a Chat started in the Workstream's scratch folder writes a granted checkout as its own, not before the grant or after revoke", async () => {
  const fake = realpathSync(mkdtempSync(join(root, "grant-home-")));
  const app = join(fake, "IdeaProjects", "app");
  mkdirSync(app, { recursive: true });
  execFileSync("git", ["init", "-q", app]);
  const scratchDir = join(fake, ".pi-workbench", "scratch", "ws-x");
  const notes = join(fake, "notes");
  mkdirSync(scratchDir, { recursive: true });
  mkdirSync(notes);
  const env = { HOME: fake, PI_TMP: join(fake, ".pi-workbench", "tmp", "ws-x", "s"), PI_WORKBENCH_WORKSTREAM_DIR: join(fake, "workstreams") };
  const blocked = async (path, cwd = scratchDir) => /^Blocked/.test(await writeRefusal(path, { cwd, sessionId: "grant-test", env }) ?? "");
  assert.ok(await blocked(join(app, "x")), "not before the grant");
  assert.equal(grant(fake, "ws-x", app), app);
  const other = join(fake, ".pi-workbench", "scratch", "ws-y");
  mkdirSync(other);
  assert.equal(grant(fake, "ws-x", other), other);
  assert.equal(await blocked(join(app, "src", "x")), false, "the granted checkout");
  assert.equal(await blocked(join(app, ".git", "refs", "heads", "x")), false, "its git folder");
  assert.equal(await blocked(join(other, "x")), false, "a granted Workstream scratch folder");
  for (const path of [join(app, ".git", "hooks", "pre-commit"), join(app, ".git", "config"), join(app, ".git", "pi-creator.json"), join(app, "AGENTS.md"), join(app, ".envrc"), join(app, "sub", ".envrc")]) assert.ok(await blocked(path), path);
  assert.ok(await blocked(join(app, "x"), join(fake, ".pi-workbench", "scratch", "ws-z")), "a Chat started in another Workstream's folder");
  assert.ok(await blocked(join(app, "x"), fake), "a Chat started in home");
  // Review of 35fafff (Terra): a plain folder grant made nested repos' .git/hooks writable; refused, and ignored if stored.
  const nested = join(notes, "app");
  mkdirSync(nested);
  execFileSync("git", ["init", "-q", nested]);
  assert.throws(() => grant(fake, "ws-x", notes), /refused: .* only a checkout under ~\/IdeaProjects or a Workstream scratch folder/);
  assert.throws(() => grant(fake, "ws-x", nested), /refused/, "a checkout outside ~/IdeaProjects");
  mkdirSync(join(other, "sub"));
  assert.throws(() => grant(fake, "ws-x", join(other, "sub")), /refused/, "inside a scratch folder");
  writeFileSync(grantsFile(fake, "ws-x"), JSON.stringify({ paths: [app, notes, nested] }));
  assert.ok(await blocked(join(nested, ".git", "hooks", "pre-commit")), "a stored plain-folder grant grants nothing");
  assert.ok(await blocked(join(notes, "x")));
  // A grant is the real folder the owner chose: one swapped for a link later grants nothing.
  rmSync(other, { recursive: true });
  symlinkSync(join(fake, ".pi-web-durable"), other);
  mkdirSync(join(fake, ".pi-web-durable"));
  assert.ok(await blocked(join(other, "x")), "a link swapped in for a granted folder");
  assert.ok(revoke(fake, "ws-x", app));
  assert.ok(await blocked(join(app, "x")), "not after revoke");
  // Refused at grant time and again when applied, whatever the grant file says.
  for (const dir of [fake, join(fake, "IdeaProjects"), join(fake, ".pi"), join(fake, ".pi", "agent"), join(fake, ".pi-web-durable"), join(fake, ".pi-workbench"), join(fake, ".pi-workbench", "sandbox"), join(fake, ".pi-workbench", "sandbox-caches"), join(fake, ".pi-workbench", "tmp", "ws-x"), join(fake, ".pi-workbench", "scratch"), join(fake, ".pi-workbench", "workstreams"), "/etc"]) {
    assert.ok(grantRefusal(dir, fake), dir);
    assert.deepEqual(grants({ cwd: fake, home: fake, granted: [dir] }).write.filter((w) => !w.includes("sandbox-")), [], dir);
  }
  mkdirSync(join(fake, ".pi-workbench", "scratch", "ws-w"));
  assert.equal(grantRefusal(join(fake, ".pi-workbench", "scratch", "ws-w"), fake), undefined, "another Workstream's scratch folder may be granted");
  mkdirSync(join(fake, ".pi"));
  assert.throws(() => grant(fake, "ws-x", join(fake, ".pi")), /refused/);
  assert.throws(() => grant(fake, "../ws-x", app), /not a Workstream ID/);
});

// Review of 35fafff (Terra): a `.git` file naming another repo's git folder made git report that folder as this
// folder's own, and the fence granted it. Runs inside a fence too: it only computes the grants.
test("a .git file planted in a scratch or granted folder never grants another repo's git folder", () => {
  const fake = realpathSync(mkdtempSync(join(root, "plant-home-")));
  const victim = join(fake, "IdeaProjects", "victim");
  mkdirSync(victim, { recursive: true });
  execFileSync("git", ["init", "-q", victim]);
  const attack = join(victim, ".git", "refs", "heads", "attack");
  const scratchDir = join(fake, ".pi-workbench", "scratch", "ws-x");
  const granted = join(fake, ".pi-workbench", "scratch", "ws-y");
  for (const dir of [scratchDir, granted]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".git"), `gitdir: ${join(victim, ".git")}\n`);
  }
  assert.equal(execFileSync("git", ["-C", scratchDir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(), scratchDir, "git takes the planted file");
  const inScratch = grants({ cwd: scratchDir, home: fake });
  assert.equal(mayWrite(attack, inScratch), false, "a Chat started in its scratch folder");
  assert.equal(mayWrite(join(scratchDir, "notes.md"), inScratch), true, "still writes its own scratch folder");
  const viaGrant = grants({ cwd: fake, home: fake, granted: [granted] });
  assert.equal(mayWrite(attack, viaGrant), false, "a granted folder");
  assert.equal(mayWrite(join(granted, "notes.md"), viaGrant), true, "the granted scratch folder itself");
  // A fake linked worktree: its own metadata folder, linked back, with a commondir naming the victim's.
  const meta = join(scratchDir, "meta");
  mkdirSync(meta);
  writeFileSync(join(scratchDir, ".git"), `gitdir: ${meta}\n`);
  writeFileSync(join(meta, "gitdir"), `${join(scratchDir, ".git")}\n`);
  writeFileSync(join(meta, "commondir"), `${join(victim, ".git")}\n`);
  writeFileSync(join(meta, "HEAD"), "ref: refs/heads/main\n");
  assert.equal(execFileSync("git", ["-C", scratchDir, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim(), join(victim, ".git"), "git takes the fake worktree");
  assert.equal(mayWrite(attack, grants({ cwd: scratchDir, home: fake })), false, "a fake linked worktree");
  // A real checkout and a real linked worktree still count.
  execFileSync("git", ["-C", victim, "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init"]);
  const tree = join(fake, "IdeaProjects", "victim.feature");
  execFileSync("git", ["-C", victim, "worktree", "add", "-q", "-b", "feature", tree]);
  assert.equal(mayWrite(attack, grants({ cwd: victim, home: fake })), true, "a main checkout");
  assert.equal(mayWrite(attack, grants({ cwd: tree, home: fake })), true, "a linked worktree");
});

// Review of 35fafff (Terra): direnv runs an .envrc unfenced when Thomas enters its folder.
test("no .envrc at any depth is writable inside any grant", () => {
  const g = "/Users/someone/IdeaProjects/app";
  const rules = profile({ write: [g], read: [], hidden: [] }).at(-1);
  assert.match(rules, /\(deny file-write\* \(regex #"\/\\\.\[Ee\]\[Nn\]\[Vv\]\[Rr\]\[Cc\]\$"\)\)/);
  for (const path of [`${g}/.envrc`, `${g}/sub/.envrc`, `${g}/.ENVRC`]) assert.equal(mayWrite(path, { write: [g] }), false, path);
  assert.equal(mayWrite(`${g}/.envrc.example`, { write: [g] }), true);
});

test("Workstream grants: a fenced command commits in a granted checkout and cannot write the grant file", { skip }, async () => {
  const lib = join(home, "IdeaProjects", "granted");
  mkdirSync(lib);
  git(lib, "init", "-q");
  git(lib, "commit", "-q", "--allow-empty", "-m", "init");
  const scratchDir = join(home, ".pi-workbench", "scratch", "ws-g");
  mkdirSync(scratchDir, { recursive: true });
  const attempt = `cd "${lib}" && ${commit} && echo COMMITTED; touch .git/hooks/x 2>/dev/null && echo HOOK_WRITTEN; mkdir -p "$HOME/.pi-workbench/sandbox/grants" 2>/dev/null; echo '{"paths":["${home}"]}' > "$HOME/.pi-workbench/sandbox/grants/ws-g.json" 2>/dev/null && echo GRANT_FORGED; true`;
  const before = await run(attempt, { cwd: scratchDir });
  assert.doesNotMatch(readFileSync(before.logPath, "utf8"), /COMMITTED|GRANT_FORGED/, "no grant yet");
  grant(home, "ws-g", lib);
  const job = await run(attempt, { cwd: scratchDir });
  assert.equal(job.state, "complete", job.error);
  assert.deepEqual(readFileSync(job.logPath, "utf8").trim().split("\n"), ["COMMITTED"]);
  assert.match(git(lib, "log", "-1", "--format=%s"), /fenced/);
  revoke(home, "ws-g", lib);
});

// Runs inside a fence too: it only computes the grants on a fake home.
test("folder fixed at Chat open: a Chat folder a job swapped for a link to another checkout or Workstream folder grants nothing there", async () => {
  const fake = realpathSync(mkdtempSync(join(root, "folder-home-")));
  const app = join(fake, "IdeaProjects", "app");
  const other = join(fake, "IdeaProjects", "other");
  for (const dir of [join(app, "sub"), other]) mkdirSync(dir, { recursive: true });
  for (const dir of [app, other]) execFileSync("git", ["init", "-q", dir]);
  const env = { HOME: fake, PI_TMP: join(fake, ".pi-workbench", "tmp", "ws-x", "s"), PI_WORKBENCH_WORKSTREAM_DIR: join(fake, "workstreams") };
  const cwd = join(app, "sub");
  const folder = realpathSync(cwd);
  const blocked = async (path, at = { cwd, folder }) => /^Blocked/.test(await writeRefusal(path, { ...at, sessionId: "folder-test", env }) ?? "");
  assert.equal(await blocked(join(app, "sub", "x")), false, "its own checkout before the swap");
  rmSync(cwd, { recursive: true });
  symlinkSync(other, cwd);
  assert.equal(await blocked(join(other, "x"), { cwd }), false, "unfixed, the swapped-in checkout would be granted");
  assert.ok(await blocked(join(other, "x")), "fixed at open: the swapped-in checkout");
  assert.ok(await blocked(join(app, "x")), "nor its own: the folder no longer is the one it opened in");
  // A Workstream folder swapped the same way gives neither that folder nor that Workstream's grants.
  const mine = join(fake, ".pi-workbench", "scratch", "ws-a", "sub");
  const theirs = join(fake, ".pi-workbench", "scratch", "ws-b");
  for (const dir of [mine, theirs]) mkdirSync(dir, { recursive: true });
  const opened = realpathSync(mine);
  grant(fake, "ws-b", other);
  rmSync(mine, { recursive: true });
  symlinkSync(theirs, mine);
  assert.equal(await blocked(join(other, "x"), { cwd: mine }), false, "unfixed, ws-b's grant would apply");
  for (const path of [join(other, "x"), join(theirs, "x")]) assert.ok(await blocked(path, { cwd: mine, folder: opened }), path);
  // Inside the folder it opened in still counts.
  mkdirSync(join(app, "deeper"));
  assert.equal(await blocked(join(app, "deeper", "x"), { cwd: join(app, "deeper"), folder: realpathSync(app) }), false);
});

test("folder fixed at Chat open: a fenced command whose folder was swapped for a link cannot commit in the linked checkout", { skip }, async () => {
  const other = join(home, "IdeaProjects", "swapped-in");
  mkdirSync(other);
  git(other, "init", "-q");
  git(other, "commit", "-q", "--allow-empty", "-m", "init");
  const sub = join(repo, "chat-folder");
  mkdirSync(sub);
  const folder = realpathSync(sub);
  rmSync(sub, { recursive: true });
  symlinkSync(other, sub);
  const job = await run(`${commit} && echo COMMITTED; true`, { cwd: sub, folder });
  assert.equal(job.state, "complete", job.error);
  assert.doesNotMatch(readFileSync(job.logPath, "utf8"), /COMMITTED/);
  assert.equal(JSON.parse(readFileSync(join(root, "jobs", job.id, "job.json"), "utf8")).folder, folder, "the job record carries the folder");
  assert.doesNotMatch(git(other, "log", "-1", "--format=%s"), /fenced/);
  rmSync(sub);
});
