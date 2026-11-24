// Write-fence tests on fake folders only: a fake HOME outside every temp folder, so the shared temp grant cannot
// make a forbidden write look allowed. macOS only, like the fence.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, sep } from "node:path";
import { after, test } from "node:test";
import { launchJob, readJob } from "./jobs.mjs";
import { plan } from "./host-ops.mjs";
import { alreadyFenced, grants, ownedWorktrees, workstreamId } from "./sandbox.mjs";

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
  const rules = (cwd, extra = {}) => grants({ cwd, home: h, ...extra }).write.filter((p) => !p.includes("sandbox-caches"));
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

test("host operations: only `workstreams` (no @file), `wt switch --create` with --base/--no-cd and `wt remove`, never --execute, --clobber or --no-hooks", () => {
  assert.deepEqual(plan(["workstreams", "checkpoint", "ws-a", "--stdin"]), { file: "workstreams", args: ["checkpoint", "ws-a", "--stdin"] });
  assert.deepEqual(plan(["workstreams", "append", "@-"]).args, ["append", "@-"]);
  assert.deepEqual(plan(["wt", "switch", "-c", "feat", "-b", "main"]), { worktree: { branch: "feat", base: "main" } });
  assert.deepEqual(plan(["wt", "switch", "--create", "feat", "--no-cd", "--base=dev"]), { worktree: { branch: "feat", base: "dev" } });
  assert.deepEqual(plan(["wt", "remove", "feat", "--foreground", "-D"]), { remove: { branches: ["feat"], force: false, deleteBranch: "-D" } });
  assert.deepEqual(plan(["wt", "remove", "-f", "--no-delete-branch", "-D"]), { remove: { branches: [], force: true, deleteBranch: undefined } });
  for (const argv of [["wt", "switch", "-c", "feat", "-x", "rm -rf ~"], ["wt", "switch", "-c", "feat", "--clobber"], ["wt", "switch", "-c"], ["wt", "remove", "feat", "-x", "rm -rf ~"], ["wt", "remove", "--no-hooks"], ["git", "push"], ["wt", "switch", "-c", "feat", "-C", "/"], ["wt", "switch", "-c", "feat", "--base=--upload-pack=x"], ["workstreams", "append", "@/Users/x/Documents/secret"]])
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

test("`wt switch --create` makes the sibling worktree outside the fence and records its owner; --execute and a repo outside ~/IdeaProjects are refused", { skip }, async () => {
  // Its own repo: the rm -rf test above empties the shared one's .git, as it may inside the grant.
  const tools = join(home, "IdeaProjects", "tools");
  mkdirSync(tools);
  git(tools, "init", "-q");
  git(tools, "commit", "-q", "--allow-empty", "-m", "init");
  // A repo the agent sets up in its temp folder, its hooks pointing at a script: never used outside the fence.
  const planted = join(piTmp, "planted");
  const job = await run([
    'wt switch --create made-by-host --no-cd; echo "exit=$?"',
    'wt switch --create other -x "touch $HOME/escaped"; echo "exit=$?"',
    `git init -q "${planted}" && printf '#!/bin/sh\ntouch "$HOME/escaped"\n' > "${planted}/hook" && chmod +x "${planted}/hook" && git -C "${planted}" config core.hooksPath "${planted}" && cd "${planted}" && wt switch --create from-planted; echo "exit=$?"`,
  ].join("; "), { cwd: tools, env: withFakes });
  assert.equal(job.state, "complete", job.error);
  const out = readFileSync(job.logPath, "utf8");
  const tree = join(home, "IdeaProjects", "tools.made-by-host");
  assert.ok(existsSync(join(tree, ".git")), out);
  assert.match(out, /exit=0[\s\S]*-x is not available inside the sandbox[\s\S]*exit=2[\s\S]*run it inside a checkout under ~\/IdeaProjects[\s\S]*exit=2/);
  const record = JSON.parse(readFileSync(join(tools, ".git", "worktrees", "tools.made-by-host", "pi-owner.json"), "utf8"));
  assert.deepEqual([record.branch, record.sessions], ["made-by-host", ["sandbox-test"]]);
  const receipt = JSON.parse(readFileSync(join(tools, ".git", "worktrees", "tools.made-by-host", "pi-creator.json"), "utf8"));
  assert.deepEqual([receipt.branch, receipt.sessions, receipt.workstreams], ["made-by-host", ["sandbox-test"], []], "a creation receipt beside the cleanup record");
  assert.equal(existsSync(join(home, "owner-script-ran")), false, "no owner-record script ran");
  assert.equal(existsSync(join(home, "escaped")), false);
  assert.equal(git(tools, "branch", "--list", "other").trim(), "", "a refused call creates nothing");
});

test("`wt remove` removes an owned worktree outside the fence with its merged branch; never the main checkout, another chat's worktree or one holding .scratch/", { skip }, async () => {
  const main = join(home, "IdeaProjects", "rm");
  mkdirSync(main);
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  const add = (name, owner) => {
    const path = join(home, "IdeaProjects", `rm.${name}`);
    git(main, "worktree", "add", "-q", "-b", name, path);
    writeFileSync(join(main, ".git", "worktrees", `rm.${name}`, "pi-creator.json"), JSON.stringify({ sessions: [owner] }));
    return path;
  };
  const [done, dirty, kept, theirs, scratchy] = [["done", "sandbox-test"], ["dirty", "sandbox-test:child-1"], ["kept", "sandbox-test"], ["theirs", "another-chat"], ["scratchy", "sandbox-test"]].map(([name, owner]) => add(name, owner));
  writeFileSync(join(dirty, "untracked"), "x");
  git(kept, "commit", "-q", "--allow-empty", "-m", "unmerged");
  mkdirSync(join(scratchy, ".scratch"));
  const job = await run([
    'wt remove done --foreground; echo "exit=$?"',
    'wt remove dirty; echo "exit=$?"',
    'wt remove dirty --force; echo "exit=$?"',
    `cd "${kept}" && wt remove; echo "exit=$?"`,
    `cd "${main}"; wt remove theirs; echo "exit=$?"`,
    'wt remove scratchy; echo "exit=$?"',
    'wt remove; echo "exit=$?"',
  ].join("; "), { cwd: main, env: withFakes });
  assert.equal(job.state, "complete", job.error);
  const out = readFileSync(job.logPath, "utf8");
  assert.match(out, /Removed worktree @ [^\n]*rm\.done\n.*Deleted branch done\nexit=0/, out);
  assert.match(out, /pass --force[\s\S]*exit=128[\s\S]*rm\.dirty\n.*Deleted branch dirty\nexit=0/);
  assert.match(out, /rm\.kept\n.*Kept branch kept: the branch 'kept' is not fully merged \(-D deletes an unmerged branch\)\nexit=0/);
  assert.match(out, /rm\.theirs is not a worktree this Chat owns[^\n]*\nexit=2[\s\S]*holds \.scratch\/[^\n]*\nexit=2[\s\S]*rm is the main checkout\nexit=2/);
  for (const path of [done, dirty, kept]) assert.equal(existsSync(path), false, path);
  for (const path of [theirs, scratchy, main]) assert.ok(existsSync(join(path, ".git")), path);
  assert.deepEqual(git(main, "branch", "--format=%(refname:short)").trim().split("\n").sort(), ["kept", "master", "scratchy", "theirs"].sort());
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
  assert.match(out, /exit=0[\s\S]*lib\.adopted is not a worktree this Chat owns[^\n]*\nexit=2/, out);
  assert.ok(existsSync(join(adopted, ".git")), "a cleanup owner cannot remove it");
  // The receipt names the chat and only the Workstream whose scratch folder it started in, never every one it is linked to.
  const receipt = JSON.parse(readFileSync(join(meta, "lib.from-ws", "pi-creator.json"), "utf8"));
  assert.deepEqual([receipt.branch, receipt.sessions, receipt.workstreams], ["from-ws", ["sandbox-test"], ["ws-x"]]);
});

test("fenced commands cannot reach PI WEB's port, its or the hosts' sockets, or another job's host operations", { skip }, async () => {
  const { createServer } = await import("node:net");
  const servers = [];
  const listen = (where) => new Promise((resolve, reject) => { const server = createServer((socket) => socket.end("hello\n")); servers.push(server); server.once("error", reject); server.listen(where, () => resolve(server)); });
  // A short socket path (the 104-byte limit): a stand-in PI WEB data folder in the system temp folder.
  const dataDir = mkdtempSync(join(tmpdir(), "pw-"));
  mkdirSync(join(dataDir, "hosts"));
  const otherOps = join(userInfo().homedir, ".pi-workbench", "sandbox", "ops", `test-${process.pid}.sock`);
  mkdirSync(dirname(otherOps), { recursive: true });
  try {
    const web = await listen(0);
    await listen(join(dataDir, "hosts", "h.sock"));
    await listen(otherOps);
    const free = await listen(0);
    const nc = (target) => `nc ${target} </dev/null 2>/dev/null | grep -q hello && echo REACHED || echo REFUSED`;
    const job = await run([nc(`-w2 127.0.0.1 ${web.address().port}`), nc(`-U -w2 "${join(dataDir, "hosts", "h.sock")}"`), nc(`-U -w2 "${otherOps}"`), nc(`-w2 127.0.0.1 ${free.address().port}`)].join("; "), { env: { PI_WEB_PORT: String(web.address().port), PI_WEB_DATA_DIR: dataDir } });
    assert.equal(job.state, "complete", job.error);
    assert.deepEqual(readFileSync(job.logPath, "utf8").trim().split("\n"), ["REFUSED", "REFUSED", "REFUSED", "REACHED"], "only the unrelated port answers");
  } finally {
    for (const server of servers) server.close();
    rmSync(otherOps, { force: true });
    rmSync(dataDir, { recursive: true, force: true });
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

test("temp and caches: TMPDIR is the Chat's PI_TMP; shared temp and Thomas's code caches stay untouched, the agents' own caches work", { skip }, async () => {
  const shared = mkdtempSync(join(tmpdir(), "fence-shared-"));
  mkdirSync(join(home, ".gradle", "caches", "modules-2"), { recursive: true });
  mkdirSync(join(home, ".npm"), { recursive: true });
  mkdirSync(join(home, "Library", "Caches", "ms-playwright"), { recursive: true });
  mkdirSync(join(home, ".cache"), { recursive: true });
  try {
    const job = await run([
      'echo "tmp=$TMPDIR"', 'touch "${TMPDIR}t" && echo TMP_OK',
      'ln -sfn / "${TMPDIR%/}" 2>/dev/null && echo RELINKED || echo RELINK_DENIED',
      `touch "${join(shared, "x")}" 2>/dev/null && echo SHARED_WRITTEN || echo SHARED_DENIED`,
      'touch /private/tmp/fence-x-$$ 2>/dev/null && { rm -f /private/tmp/fence-x-$$; echo SLASHTMP_WRITTEN; } || echo SLASHTMP_DENIED',
      'for c in .gradle/caches/modules-2 .npm Library/Caches/ms-playwright Library/Caches .cache; do touch "$HOME/$c/x" 2>/dev/null && echo "WRITTEN $c" || echo "DENIED $c"; done',
      'mkdir -p "$GRADLE_USER_HOME" "$npm_config_cache" "$PLAYWRIGHT_BROWSERS_PATH" && echo AGENT_CACHES_OK',
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
    assert.deepEqual(lines.slice(1), ["TMP_OK", "RELINK_DENIED", "SHARED_DENIED", "SLASHTMP_DENIED", "DENIED .gradle/caches/modules-2", "DENIED .npm", "DENIED Library/Caches/ms-playwright", "DENIED Library/Caches", "DENIED .cache", "AGENT_CACHES_OK", `ro=${join(home, ".gradle", "caches")}`, `maven=-Dmaven.repo.local=${join(caches, "m2", "repository")}`]);
    assert.ok(existsSync(join(caches, "gradle")));
  } finally { rmSync(shared, { recursive: true, force: true }); }
});
