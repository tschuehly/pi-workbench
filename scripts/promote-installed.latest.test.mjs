// promote-installed latest: the preview PI WEB's Install latest button reads, and the switch to that pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const script = new URL("./promote-installed", import.meta.url).pathname;
const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };

function harness() {
  const root = mkdtempSync(join(tmpdir(), "promote-latest-"));
  const home = join(root, "home"), projects = join(root, "projects"), bin = join(root, "bin");
  const store = join(home, ".pi-workbench/installed-durable");
  const genv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, env: genv, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (cwd, subject, file = "f", content = subject) => { writeFileSync(join(cwd, file), content); git(cwd, "add", "."); git(cwd, "commit", "-qm", subject); return git(cwd, "rev-parse", "HEAD"); };
  // Remotes and their integration checkouts: pi-workbench on main, PI WEB on pi-workbench.
  const repos = {};
  for (const [name, branch] of [["pi-workbench", "main"], ["pi-web", "pi-workbench"]]) {
    git(root, "init", "-q", "--bare", "-b", branch, `${name}.git`);
    const seed = join(root, `seed-${name}`);
    git(root, "clone", "-q", join(root, `${name}.git`), seed);
    git(seed, "checkout", "-q", "-b", branch);
    repos[name] = { seed, branch, first: commit(seed, `${name} one`) };
    git(seed, "push", "-q", "origin", `HEAD:${branch}`);
    git(root, "clone", "-q", "-b", branch, join(root, `${name}.git`), join(projects, name));
  }
  const shim = (name, body) => { put(join(bin, name), `#!/bin/sh\n${body}\n`); spawnSync("chmod", ["+x", join(bin, name)]); };
  shim("launchctl", `echo "$*" >> "$HOME/launchctl.log"`);
  shim("lsof", "exit 0");
  mkdirSync(home, { recursive: true });
  const ps = join(root, "ps.txt");
  put(ps, "");
  const env = {
    ...Object.fromEntries(Object.entries(genv).filter(([key]) => !key.startsWith("PI_") || key === "PI_TMP")),
    HOME: home, PI_WORKBENCH_PROJECTS: projects, PI_PROMOTE_PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    PI_PROMOTE_PS: `cat ${ps}`, PI_PROMOTE_ETIME_PS: `cat ${ps}`,
  };
  const run = (...args) => spawnSync("bash", [script, ...args], { env, encoding: "utf8" });
  /** A prepared build the switch reuses as is (no install), linked live when `live`. */
  const build = (product, rev, live) => {
    const dir = join(store, `${product}-${rev.slice(0, 12)}`);
    if (product === "pi-web") put(join(dir, "dist/server/sessiond.js"), 'env["PI_WEB_DURABLE_HOST_LAUNCHD"]\n');
    else mkdirSync(dir, { recursive: true });
    put(`${dir}.prepared`, "");
    if (live) { rmSync(join(projects, `${product}.durable-installed`), { force: true }); symlinkSync(dir, join(projects, `${product}.durable-installed`)); }
    return dir;
  };
  return { root, home, projects, store, repos, git, commit, run, build };
}

/** pi-workbench main gains a merged branch that pins PI WEB's second commit; PI WEB's branch moves on to a third. */
function moveOn(h) {
  const wb = h.repos["pi-workbench"], pw = h.repos["pi-web"];
  const pw2 = h.commit(pw.seed, "pi-web two"), pw3 = h.commit(pw.seed, "pi-web three");
  h.git(pw.seed, "push", "-q", "origin", "HEAD:pi-workbench");
  h.git(wb.seed, "checkout", "-q", "-b", "feature");
  h.commit(wb.seed, "feature work", "g");
  h.git(wb.seed, "checkout", "-q", "main");
  h.git(wb.seed, "merge", "-q", "--no-ff", "-m", "Merge branch 'feature'", "feature");
  const merge = h.commit(wb.seed, "pin pi-web", "pi-web.rev", `${pw2}\n`);
  h.git(wb.seed, "push", "-q", "origin", "HEAD:main");
  return { wbMerge: h.git(wb.seed, "rev-parse", "HEAD^"), wbPin: merge, pw2, pw3 };
}

test("latest --dry-run --json: installed and latest full revisions, first-parent merges between them, upToDate", () => {
  const h = harness();
  const wb1 = h.repos["pi-workbench"].first, pw1 = h.repos["pi-web"].first;
  h.build("pi-workbench", wb1, true);
  h.build("pi-web", pw1, true);
  const { wbMerge, wbPin, pw2 } = moveOn(h);

  const preview = h.run("latest", "--dry-run", "--json");
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout), {
    installed: { workbench: wb1, piWeb: pw1 },
    latest: { workbench: wbPin, piWeb: pw2 },
    merges: [
      { repo: "pi-workbench", sha: wbPin, subject: "pin pi-web" },
      { repo: "pi-workbench", sha: wbMerge, subject: "Merge branch 'feature'" },
      { repo: "pi-web", sha: pw2, subject: "pi-web two" },
    ],
    upToDate: false,
  });
  const human = h.run("latest");
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, new RegExp(`latest +pi-workbench ${wbPin.slice(0, 12)} +pi-web ${pw2.slice(0, 12)}`));
  assert.match(human.stdout, /Merge branch 'feature'/);
  assert.match(human.stdout, new RegExp(`latest --from ${wb1.slice(0, 12)} ${pw1.slice(0, 12)} --to ${wbPin.slice(0, 12)} ${pw2.slice(0, 12)}`));

  h.build("pi-workbench", wbPin, true);
  h.build("pi-web", pw2, true);
  const current = JSON.parse(h.run("latest", "--dry-run", "--json").stdout);
  assert.equal(current.upToDate, true);
  assert.deepEqual(current.merges, []);
});

test("latest falls back to local main when the fetch fails, and to origin/pi-workbench without a pi-web.rev", () => {
  const h = harness();
  const wb1 = h.repos["pi-workbench"].first;
  h.build("pi-workbench", wb1, true);
  h.build("pi-web", h.repos["pi-web"].first, true);
  const { pw3 } = moveOn(h);
  spawnSync("git", ["fetch", "-q", "origin"], { cwd: join(h.projects, "pi-web") });
  for (const name of ["pi-workbench", "pi-web"]) spawnSync("git", ["remote", "set-url", "origin", join(h.root, "gone.git")], { cwd: join(h.projects, name) });
  const preview = h.run("latest", "--dry-run", "--json");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stderr, /using local main/);
  const out = JSON.parse(preview.stdout);
  assert.deepEqual(out.latest, { workbench: wb1, piWeb: pw3 });
  assert.deepEqual(out.merges.map((m) => m.subject), ["pi-web three", "pi-web two"]);
});

test("failed fetch cannot roll back a newer installed Workbench or PI WEB without explicit approval", () => {
  const h = harness(), wb = h.repos["pi-workbench"], pw = h.repos["pi-web"];
  const { wbPin, pw2 } = moveOn(h);
  for (const name of ["pi-workbench", "pi-web"]) {
    h.git(join(h.projects, name), "fetch", "origin");
    h.git(join(h.projects, name), "remote", "set-url", "origin", join(h.root, "missing.git"));
  }
  h.build("pi-web", pw.first, true);
  h.build("pi-workbench", wbPin, true);
  h.build("pi-workbench", wb.first);
  const stale = h.run("latest", "--from", wbPin, pw.first);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /refusing: pi-workbench .*--allow-downgrade/);
  h.build("pi-web", pw2, true);
  h.git(join(h.projects, "pi-web"), "update-ref", "refs/remotes/origin/pi-workbench", pw.first);
  h.build("pi-workbench", wb.first, true);
  const staleWeb = h.run("latest", "--from", wb.first, pw2);
  assert.notEqual(staleWeb.status, 0);
  assert.match(staleWeb.stderr, /refusing: pi-web .*--allow-downgrade/);
  assert.ok(!existsSync(join(h.store, "jobs")));
  const rollback = h.run("--allow-downgrade", "latest", "--from", wb.first, pw2);
  assert.equal(rollback.status, 0, rollback.stderr);
});

test("latest --from switches to the latest pair with switch's lock and stale check", () => {
  const h = harness();
  const wb1 = h.repos["pi-workbench"].first, pw1 = h.repos["pi-web"].first;
  h.build("pi-workbench", wb1, true);
  h.build("pi-web", pw1, true);
  const { wbPin, pw2 } = moveOn(h);
  const wbDir = h.build("pi-workbench", wbPin), pwDir = h.build("pi-web", pw2);
  const jobs = () => (existsSync(join(h.store, "jobs")) ? readdirSync(join(h.store, "jobs")).length : 0);

  assert.equal(h.run("latest", "--from", wb1.slice(0, 12)).status, 2);
  const stale = h.run("latest", "--from", pw1.slice(0, 12), pw1.slice(0, 12), "0");
  assert.equal(stale.status, 8, stale.stderr);
  assert.match(stale.stderr, /fresh approval/);
  put(join(h.store, "promote.lock/owner"), `pid ${process.pid}\n`);
  assert.equal(h.run("latest", "--from", wb1.slice(0, 12), pw1.slice(0, 12), "0").status, 6);
  rmSync(join(h.store, "promote.lock"), { recursive: true });
  assert.equal(jobs(), 0);

  const scheduled = h.run("latest", "--from", wb1.slice(0, 12), pw1.slice(0, 12), "0");
  assert.equal(scheduled.status, 0, scheduled.stderr);
  assert.match(scheduled.stdout, /scheduled .*; log: /);
  const job = readdirSync(join(h.store, "jobs"))[0];
  const sh = readFileSync(join(h.store, "jobs", job, "job.sh"), "utf8");
  assert.ok(sh.includes(`wb=${wbDir} pw=${pwDir}`), sh);
  assert.equal(jobs(), 1);

  assert.equal(h.run("latest", "--to", wbPin, pw2).status, 2);

  // Up to date: nothing to switch, no job.
  rmSync(join(h.store, "promote.lock"), { recursive: true, force: true });
  rmSync(join(h.store, "current"));
  symlinkSync(`releases/${wbPin.slice(0, 12)}-${pw2.slice(0, 12)}`, join(h.store, "current"));
  const same = h.run("latest", "--from", wbPin.slice(0, 12), pw2.slice(0, 12));
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /up to date/);
  assert.equal(jobs(), 1);
});

test("latest --to refuses (exit 9) when origin/main moved after the preview, and switches to the pair shown otherwise", () => {
  const h = harness();
  const wb1 = h.repos["pi-workbench"].first, pw1 = h.repos["pi-web"].first;
  h.build("pi-workbench", wb1, true);
  h.build("pi-web", pw1, true);
  const { wbPin, pw2 } = moveOn(h);
  h.build("pi-workbench", wbPin);
  const pwDir = h.build("pi-web", pw2);
  const shown = JSON.parse(h.run("latest", "--dry-run", "--json").stdout).latest;
  assert.deepEqual(shown, { workbench: wbPin, piWeb: pw2 });

  // Someone merges to main between the owner's look and the click.
  const wb = h.repos["pi-workbench"];
  const wbNext = h.commit(wb.seed, "later merge", "h");
  h.git(wb.seed, "push", "-q", "origin", "HEAD:main");
  const moved = h.run("latest", "--from", wb1, pw1, "--to", shown.workbench, shown.piWeb, "0");
  assert.equal(moved.status, 9, moved.stderr);
  assert.match(moved.stderr, new RegExp(`latest moved since you looked: now ${wbNext.slice(0, 12)} ${pw2.slice(0, 12)}.*review again`));
  assert.ok(!existsSync(join(h.store, "jobs")));

  // The pair now shown installs; its job switches to exactly that pair.
  h.build("pi-workbench", wbNext);
  const ok = h.run("latest", "--from", wb1, pw1, "--to", wbNext, pw2, "0");
  assert.equal(ok.status, 0, ok.stderr);
  const job = readdirSync(join(h.store, "jobs"))[0];
  assert.ok(readFileSync(join(h.store, "jobs", job, "job.sh"), "utf8").includes(`wb=${join(h.store, `pi-workbench-${wbNext.slice(0, 12)}`)} pw=${pwDir}`));
});
