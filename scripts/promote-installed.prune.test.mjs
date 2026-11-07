import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./promote-installed", import.meta.url).pathname;

test("prune keeps live, the last switched-away build, named and used builds, and removes the rest with their worktrees", async () => {
  const home = mkdtempSync(join(tmpdir(), "promote-prune-"));
  const repo = join(home, "pi-workbench"), store = join(home, ".pi-workbench/installed");
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  const build = (c, age) => {
    const dir = join(store, `pi-workbench-${c.repeat(12)}`);
    git("worktree", "add", "-q", "--detach", dir);
    writeFileSync(`${dir}.prepared`, "");
    const when = new Date(Date.now() - age * 3600e3);
    utimesSync(`${dir}.prepared`, when, when);
    return dir;
  };
  // ages in hours: c was prepared most recently but never went live; d is the build switched away from.
  const [a, b, c, d, e, f] = [["a", 50], ["b", 40], ["c", 1], ["d", 20], ["e", 10], ["f", 60]].map(([x, age]) => build(x, age));
  symlinkSync(e, join(home, "pi-workbench.installed"));
  writeFileSync(`${d}.retired`, "");
  mkdirSync(join(home, ".pi-workbench/workstreams"), { recursive: true });
  writeFileSync(join(home, ".pi-workbench/workstreams/workstreams.json"), JSON.stringify({ ref: `${a}/notes.md` }));
  const worker = spawn("sleep", ["30"], { cwd: b });
  const prune = (...args) => spawnSync("bash", [script, "prune", ...args], { encoding: "utf8", env: { ...process.env, HOME: home, PI_WORKBENCH_PROJECTS: home } });
  try {
    const dry = prune();
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /keep   pi-workbench-e{12}: live/);
    assert.match(dry.stdout, /keep   pi-workbench-d{12}: rollback/);
    assert.match(dry.stdout, /keep   pi-workbench-b{12}: in use by a running process/);
    assert.match(dry.stdout, /keep   pi-workbench-a{12}: named by/);
    assert.match(dry.stdout, /remove pi-workbench-c{12} \(/);
    assert.match(dry.stdout, /remove pi-workbench-f{12} \(/);
    assert.match(dry.stdout, /dry run: nothing removed/);
    assert.ok(existsSync(c) && existsSync(f), "a dry run removes nothing");
    const applied = prune("--apply");
    assert.equal(applied.status, 0, applied.stderr);
    for (const dir of [a, b, d, e]) assert.ok(existsSync(dir), dir);
    for (const dir of [c, f]) assert.ok(!existsSync(dir) && !existsSync(`${dir}.prepared`), dir);
    const listed = git("worktree", "list").stdout;
    assert.doesNotMatch(listed, /c{12}|f{12}/);
    assert.match(listed, /e{12}/);
  } finally {
    worker.kill();
  }
});
