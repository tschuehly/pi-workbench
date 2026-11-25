// The Durable instance (docs/plans/pi-durable-cutover-spec.md B7, AC7): installs from clean revision folders and
// promotes and rolls back only its own links, plists and folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const script = new URL("./promote-installed", import.meta.url).pathname;
const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };
const wbRev = (n) => `${"a".repeat(11)}${n}0000`, pwRev = (n) => `${"b".repeat(11)}${n}0000`;
const short = (rev) => rev.slice(0, 12);
/** The build a *.durable-installed link resolves to: through <store>/current/<product>, or directly (the old layout). */
const resolve = (link) => { const t = readlinkSync(link); return lstatSync(t).isSymbolicLink() ? readlinkSync(t) : t; };

function harness() {
  const root = mkdtempSync(join(tmpdir(), "promote-durable-"));
  const home = join(root, "home"), projects = join(root, "projects"), bin = join(root, "bin");
  const la = join(home, "Library/LaunchAgents");
  const store = join(home, ".pi-workbench/installed-durable"), data = join(home, ".pi-web-durable");
  const shim = (name, body) => { put(join(bin, name), `#!/bin/sh\n${body}\n`); spawnSync("chmod", ["+x", join(bin, name)]); };
  // git: rev-parse echoes the revision; worktree add makes the folder (with the Durable host's package for pi-workbench).
  shim("git", `case "$3" in rev-parse) r="$5"; echo "\${r%^{commit\\}}";;
  worktree) if [ "$4" = add ]; then mkdir -p "$6"; case "$6" in */pi-workbench-*) mkdir -p "$6/packages/durable-pilot/src";; esac
    # LOCKFILE: the revision has pnpm lockfiles with that content.
    if [ -n "$LOCKFILE" ]; then echo "$LOCKFILE" > "$6/pnpm-lock.yaml"; if [ -d "$6/packages/durable-pilot" ]; then echo "$LOCKFILE" > "$6/packages/durable-pilot/pnpm-lock.yaml"; fi; fi; fi;; esac`);
  shim("pnpm", `echo "pnpm $1 $PWD" >> "$HOME/npm.log"; mkdir -p node_modules/node-pty/prebuilds/x && touch node_modules/node-pty/prebuilds/x/spawn-helper && echo "$PWD" > node_modules/installed-in`);
  shim("cp", `[ -n "$FAIL_CP" ] && exit 1; exec /bin/cp "$@"`);
  shim("npm", `echo "$1 $PWD" >> "$HOME/npm.log"
  case "$1" in ci) mkdir -p node_modules/node-pty/prebuilds/x && touch node_modules/node-pty/prebuilds/x/spawn-helper;;
  run) mkdir -p dist/server/sessions && echo web > dist/server/index.js && echo lock > package-lock.json
    # NO_LAUNCHD: a PI WEB build from before Phase C1; PROTOCOL: the Durable host protocol its daemon speaks.
    if [ -n "$NO_LAUNCHD" ]; then echo daemon > dist/server/sessiond.js; else echo 'daemon env["PI_WEB_DURABLE_HOST_LAUNCHD"]' > dist/server/sessiond.js; fi
    echo "export const DURABLE_HOST_PROTOCOL = \${PROTOCOL:-2};" > dist/server/sessions/durableChatService.js;; esac`);
  // print: a scheduled switch job runs while $HOME/job-running exists.
  shim("launchctl", `if [ "$1" = print ]; then [ -e "$HOME/job-running" ] || exit 1; echo "state = waiting"; exit 0; fi; echo "$*" >> "$HOME/launchctl.log"`);
  shim("lsof", `echo "$*" >> "$HOME/lsof.log"; case "$*" in *tcp:*) echo "$FOREIGN_PID";; esac`);
  // FAIL_MV_CURRENT: the rename that replaces <store>/current fails (the one step that switches both products).
  shim("mv", `case "$*" in */installed-durable/current) [ -n "$FAIL_MV_CURRENT" ] && exit 1;; esac; exec /bin/mv "$@"`);
  shim("sleep", "exit 0");
  // Job folders are named by the second; give each switch its own.
  shim("date", `case "$*" in *%Y%m%dT*) n=$(cat "$HOME/dates" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$HOME/dates"; echo "20261117T0000\${n}Z";; *) exec /bin/date "$@";; esac`);
  // Healthy unless the Durable web service runs the build named by BAD.
  shim("curl", `if [ -n "$BAD" ] && grep -q "$BAD" "\${WEB_PLIST:-$HOME/Library/LaunchAgents/com.pi-web-durable.web.plist}" 2>/dev/null; then exit 1; fi
  echo '{"plugins":[{"id":"pi-workbench","server":{"state":"active","restartRequired":false}}]}'`);
  const ps = join(root, "ps.txt");
  put(ps, "");

  mkdirSync(home, { recursive: true });
  for (const product of ["pi-workbench", "pi-web"]) mkdirSync(join(projects, product), { recursive: true });

  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PI_") || key === "PI_TMP")),
    HOME: home, PI_WORKBENCH_PROJECTS: projects, PI_PROMOTE_PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    PI_PROMOTE_PS: `cat ${ps}`, PI_PROMOTE_ETIME_PS: `cat ${ps}`, PI_PROMOTE_ZSH: "/bin/zsh",
  };
  const run = (args, extra = {}) => spawnSync("bash", [script, ...args], { env: { ...env, ...extra }, encoding: "utf8" });
  /** Schedule a switch from the pair installed now, as a Chat proposes it. */
  const sw = (wb, pw, extra = {}, delay = ["0"]) => run(["switch", wb, pw, "--from", ...run(["current"], extra).stdout.trim().split(" "), ...delay], extra);
  // Each path: file bytes and mtime, link target, or folder.
  const snapshot = (paths) => {
    const out = {};
    const walk = (path) => {
      let stat; try { stat = lstatSync(path); } catch { out[relative(root, path)] = "missing"; return; }
      if (stat.isSymbolicLink()) out[relative(root, path)] = `link ${readlinkSync(path)}`;
      else if (stat.isDirectory()) { out[relative(root, path)] = "dir"; for (const name of readdirSync(path)) walk(join(path, name)); }
      else out[relative(root, path)] = `file ${stat.mtimeMs} ${readFileSync(path, "base64")}`;
    };
    for (const path of paths) walk(path);
    return out;
  };
  const durable = () => snapshot([store, join(projects, "pi-workbench.durable-installed"), join(projects, "pi-web.durable-installed"),
    join(la, "com.pi-web-durable.web.plist"), join(la, "com.pi-web-durable.sessiond.plist"), data]);
  const log = (name) => { try { return readFileSync(join(home, name), "utf8"); } catch { return ""; } };
  const plist = (s) => JSON.parse(spawnSync("plutil", ["-convert", "json", "-o", "-", join(la, `com.pi-web-durable.${s}.plist`)], { encoding: "utf8" }).stdout);
  /** Schedule a durable switch, then run its job as launchd would. */
  const switchDurable = (wb, pw, extra = {}) => {
    const scheduled = sw(wb, pw, extra);
    assert.equal(scheduled.status, 0, scheduled.stderr);
    const jobs = join(store, "jobs"), latest = readdirSync(jobs).sort().at(-1);
    const job = spawnSync("bash", [join(jobs, latest, "job.sh")], { env: { ...env, ...extra }, encoding: "utf8" });
    return { scheduled, status: job.status, log: readFileSync(join(jobs, latest, "job.log"), "utf8") };
  };
  return { root, home, projects, la, store, data, env, run, sw, bin, durable, snapshot, log, plist, switchDurable };
}

/**
 * Durable host families as Phase C1 leaves them: a launchd job plist and socket under `<data>/hosts`, and each Chat's
 * `host` in the runtime locator. A family's host runs from `revision`, whose host speaks `protocol`.
 */
function hosts(h, families) {
  const chats = {};
  for (const { id, revision, protocol, pid } of families) {
    put(join(revision, "packages/durable-pilot/src/chat-session.ts"), `export const PROTOCOL = ${protocol};\n`);
    const label = `com.pi-workbench.durable-host.${id}`, socket = join(h.data, "hosts", `${id}.sock`);
    put(join(h.data, "hosts", `${label}.plist`), `<string>${revision}/packages/durable-pilot/src/chat-host-main.ts</string>\n`);
    put(socket, "");
    chats[id] = { id, cwd: h.root, runtime: "durable", storeId: id, created: "", modified: "", firstMessage: "", messageCount: 0,
      host: { label, socket, revision: realpathSync(revision), ownerEpoch: 1, pid } };
  }
  put(join(h.data, "session-runtimes.json"), JSON.stringify({ version: 1, chats }));
}
const deadPid = () => spawnSync("true").pid;
/** What a promotion must never change: the Durable links, plists and data folder (with its hosts and locator). */
const instanceState = (h) => h.snapshot([join(h.projects, "pi-workbench.durable-installed"), join(h.projects, "pi-web.durable-installed"),
  join(h.la, "com.pi-web-durable.web.plist"), join(h.la, "com.pi-web-durable.sessiond.plist"), h.data]);
const hostState = (h) => h.snapshot([join(h.data, "hosts"), join(h.data, "session-runtimes.json")]);
/** Every label a launchctl call named; a promotion may name only the two Durable services and its own job. */
const launchLabels = (h) => new Set([...h.log("launchctl.log").matchAll(/(com\.pi-[\w.-]+?)(?:\.plist)?(?:\s|$)/g)].map((m) => m[1]));

const legacyLabels = /com\.pi-web\.(web|sessiond|ui-dev)\b/; // the old non-Durable labels must never appear

test("the Durable instance installs from clean folders, promotes twice and rolls back a failed health check", () => {
  const h = harness();
  const links = () => ["pi-workbench", "pi-web"].map((p) => resolve(join(h.projects, `${p}.durable-installed`)));
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  assert.ok(!existsSync(h.store));

  // Install from clean revision folders.
  const install = h.switchDurable(wbRev(1), pwRev(1));
  assert.equal(install.status, 0, install.log);
  assert.match(install.log, /promoted/);
  assert.deepEqual(links(), [build("pi-workbench", wbRev(1)), build("pi-web", pwRev(1))]);
  for (const p of ["pi-workbench", "pi-web"]) assert.equal(readlinkSync(join(h.projects, `${p}.durable-installed`)), join(h.store, "current", p));
  assert.equal(readlinkSync(join(h.store, "current")), `releases/${short(wbRev(1))}-${short(pwRev(1))}`);
  assert.match(h.log("npm.log"), new RegExp(`ci ${build("pi-workbench", wbRev(1))}\nci ${build("pi-workbench", wbRev(1))}/packages/durable-pilot\n`));
  assert.equal(readlinkSync(join(h.data, "plugins/pi-workbench")), join(h.projects, "pi-workbench.durable-installed/packages"));
  assert.equal(readFileSync(join(h.data, "config.json"), "utf8"), "{}\n");
  for (const s of ["sessiond", "web"]) {
    const p = h.plist(s);
    assert.equal(p.Label, `com.pi-web-durable.${s}`);
    assert.equal(p.ProgramArguments[3], `exec node '${build("pi-web", pwRev(1))}/dist/server/${s === "web" ? "index" : "sessiond"}.js'`);
    assert.deepEqual(p.EnvironmentVariables, {
      PI_WEB_DATA_DIR: h.data, PI_WEB_CONFIG: join(h.data, "config.json"), PI_WEB_PORT: "8506", PI_WEB_PI_PACKAGE_AUTO_INSTALL: "0",
      PI_WEB_PI_PACKAGE_DIR: `${build("pi-web", pwRev(1))}/node_modules/@earendil-works/pi-coding-agent`,
      PI_WEB_DURABLE_HOST: `${build("pi-workbench", wbRev(1))}/packages/durable-pilot/src/chat-host-main.ts`, PI_WEB_DURABLE_DEFAULT: "1",
      PI_WEB_DURABLE_HOST_LAUNCHD: "com.pi-workbench.durable-host", PI_WEB_DURABLE_AUTO_UPGRADE: "1",
    });
    assert.equal(p.StandardOutPath, join(h.data, "logs", `${s}.log`));
  }

  // Two promotions.
  for (const n of [2, 3]) {
    const promoted = h.switchDurable(wbRev(n), pwRev(n));
    assert.equal(promoted.status, 0, promoted.log);
    assert.deepEqual(links(), [build("pi-workbench", wbRev(n)), build("pi-web", pwRev(n))]);
    assert.ok(existsSync(`${build("pi-workbench", wbRev(n - 1))}.retired`));
  }
  const promotedState = h.durable();

  // A forced failed health check: everything of the Durable instance returns.
  const failed = h.switchDurable(wbRev(4), pwRev(4), { BAD: short(pwRev(4)) });
  assert.equal(failed.status, 1, failed.log);
  assert.match(failed.log, /FAILED; restoring previous services[\s\S]*rollback done/);
  assert.deepEqual(links(), [build("pi-workbench", wbRev(3)), build("pi-web", pwRev(3))]);
  for (const path of ["com.pi-web-durable.web.plist", "com.pi-web-durable.sessiond.plist"]) {
    assert.equal(h.durable()[relative(h.root, join(h.la, path))], promotedState[relative(h.root, join(h.la, path))], path);
  }

  // Only Durable labels, port and socket were ever stopped or started.
  const launches = h.log("launchctl.log");
  assert.doesNotMatch(launches, legacyLabels);
  assert.match(launches, /bootstrap .*com\.pi-web-durable\.sessiond\.plist/);
  assert.match(launches, /bootout .*com\.pi-web-durable\.web/);
  for (const line of h.log("lsof.log").trim().split("\n").filter((l) => /tcp:|sock/.test(l))) {
    assert.match(line, /tcp:8506|\.pi-web-durable\/sessiond\.sock/, line);
  }

  // switch-workbench and switch-web move only the Durable links and web service.
  const plists = h.durable();
  const wb = h.run(["switch-workbench", wbRev(5)]);
  assert.equal(wb.status, 0, wb.stderr);
  assert.match(wb.stdout, /roll back: .* switch-workbench aaaaaaaaaaa3/);
  assert.equal(resolve(join(h.projects, "pi-workbench.durable-installed")), build("pi-workbench", wbRev(5)));
  const web = h.run(["switch-web", pwRev(5)]);
  assert.equal(web.status, 0, web.stderr);
  assert.match(web.stdout, /roll back: .* switch-web bbbbbbbbbbb3/);
  assert.equal(h.plist("web").ProgramArguments[3], `exec node '${build("pi-web", pwRev(5))}/dist/server/index.js'`);
  const sessiond = relative(h.root, join(h.la, "com.pi-web-durable.sessiond.plist"));
  assert.equal(h.durable()[sessiond], plists[sessiond]);
  assert.doesNotMatch(h.log("launchctl.log"), legacyLabels);
});

test("switch needs the live pair (--from), refuses a stale one, and one promotion at a time holds the lock", () => {
  const h = harness();
  assert.equal(h.switchDurable(wbRev(1), pwRev(1)).status, 0);
  const jobs = () => readdirSync(join(h.store, "jobs")).length, lock = join(h.store, "promote.lock");
  assert.equal(h.run(["current"]).stdout, `${short(wbRev(1))} ${short(pwRev(1))}\n`);
  const missing = h.run(["switch", wbRev(2), pwRev(2)]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--from <live-workbench-rev> <live-pi-web-rev>[\s\S]*installed now: aaaaaaaaaaa1 bbbbbbbbbbb1/);

  // A pair read before another Chat switched: refused, nothing changed, the lock released.
  const before = instanceState(h);
  for (const from of [["none", "none"], [short(wbRev(1)), short(pwRev(2))], ["main", short(pwRev(1))]]) {
    const stale = h.run(["switch", wbRev(2), pwRev(2), "--from", ...from, "0"]);
    assert.equal(stale.status, 8, stale.stderr);
    assert.match(stale.stderr, /installed now is aaaaaaaaaaa1 bbbbbbbbbbb1[\s\S]*fresh approval/);
  }
  assert.equal(h.run(["switch", wbRev(2), pwRev(2), "--from", wbRev(1).slice(0, 7), pwRev(1), "0"]).status, 0, "a prefix or full revision matches");
  assert.equal(jobs(), 2);
  assert.deepEqual(instanceState(h), before);

  // The scheduled job holds the lock while it runs: every other promotion fails fast.
  writeFileSync(join(h.home, "job-running"), "");
  for (const args of [["switch", wbRev(3), pwRev(3), "--from", short(wbRev(1)), short(pwRev(1)), "0"], ["switch-workbench", wbRev(3)], ["switch-web", pwRev(3)], ["prune", "--apply"], ["prepare", wbRev(4), pwRev(4)]]) {
    const busy = h.run(args);
    assert.equal(busy.status, 6, `${args[0]}: ${busy.stderr}`);
    assert.match(busy.stderr, /another promotion is in progress \(queued com\.pi-workbench\.promote-installed-durable\.[\s\S]*current/);
  }
  assert.ok(existsSync(join(h.store, `releases/${short(wbRev(2))}-${short(pwRev(2))}/pi-web`)), "pending release survives prune");
  assert.equal(jobs(), 2);
  // Its end releases the lock.
  const job = join(h.store, "jobs", readdirSync(join(h.store, "jobs")).sort().at(-1));
  assert.equal(spawnSync("bash", [join(job, "job.sh")], { env: h.env }).status, 0, readFileSync(join(job, "job.log"), "utf8"));
  assert.ok(!existsSync(lock));

  // A live holder blocks; a dead one is taken over.
  put(join(lock, "owner"), `pid ${process.pid}\n`);
  assert.equal(h.run(["switch-workbench", wbRev(3)]).status, 6);
  put(join(lock, "owner"), `pid ${deadPid()}\n`);
  const takeover = h.run(["switch-workbench", wbRev(3)]);
  assert.equal(takeover.status, 0, takeover.stderr);
  assert.match(takeover.stderr, /taking over a stale promotion lock/);
  assert.ok(!existsSync(lock));
});

test("a displaced queued job cannot run or unlock its replacement", () => {
  const h = harness();
  assert.equal(h.sw(wbRev(1), pwRev(1)).status, 0);
  const job = join(h.store, "jobs", readdirSync(join(h.store, "jobs"))[0]);
  assert.equal(h.sw(wbRev(2), pwRev(2)).status, 0); // first job no longer registered
  const owner = join(h.store, "promote.lock/owner"), next = readFileSync(owner, "utf8");
  assert.equal(spawnSync("bash", [join(job, "job.sh")], { env: h.env }).status, 6);
  assert.equal(readFileSync(owner, "utf8"), next);
  assert.equal(h.run(["current"]).stdout, "none none\n");
});

test("a foreign listener survives a failed stop and the new pair is not installed", () => {
  const h = harness(), foreign = spawn("/bin/sleep", ["60"]);
  try {
    assert.equal(h.switchDurable(wbRev(1), pwRev(1)).status, 0);
    const r = h.switchDurable(wbRev(2), pwRev(2), { FOREIGN_PID: String(foreign.pid) });
    assert.notEqual(r.status, 0);
    assert.match(r.log, /still held after launchd bootout.*not signalling/);
    process.kill(foreign.pid, 0);
    assert.equal(h.run(["current"]).stdout, `${short(wbRev(1))} ${short(pwRev(1))}\n`);
  } finally { foreign.kill(); }
});

test("switch waits 3 seconds by default", () => {
  const h = harness();
  assert.equal(h.sw(wbRev(1), pwRev(1), {}, []).status, 0);
  const job = join(h.store, "jobs", readdirSync(join(h.store, "jobs")).sort().at(-1));
  assert.match(readFileSync(join(job, "job.sh"), "utf8"), /\nsleep 3\n/);
});

test("prepare clones node_modules from a prepared build with the same lockfile, else installs", () => {
  const h = harness();
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  const dirs = (n) => [build("pi-workbench", wbRev(n)), join(build("pi-workbench", wbRev(n)), "packages/durable-pilot"), build("pi-web", pwRev(n))];
  const installs = () => h.log("npm.log").split("\n").filter((l) => l.startsWith("pnpm "));
  const prepare = (n, extra) => { const r = h.run(["prepare", wbRev(n), pwRev(n)], extra); assert.equal(r.status, 0, r.stderr); return r; };
  prepare(1, { LOCKFILE: "one" });
  assert.equal(installs().length, 3);
  // Same lockfiles: all three node_modules are clones of build 1's, the post-install steps still run.
  const reused = prepare(2, { LOCKFILE: "one" });
  assert.equal(installs().length, 3, reused.stderr);
  assert.equal((reused.stderr.match(/node_modules: cloned from/g) ?? []).length, 3);
  dirs(2).forEach((dir, i) => assert.equal(readFileSync(join(dir, "node_modules/installed-in"), "utf8").trim(), dirs(1)[i]));
  assert.match(h.log("npm.log"), new RegExp(`run ${build("pi-web", pwRev(2))}`));
  // A changed lockfile, or a failed clone, installs.
  prepare(3, { LOCKFILE: "two" });
  assert.equal(installs().length, 6);
  prepare(4, { LOCKFILE: "one", FAIL_CP: "1" });
  assert.equal(installs().length, 9);
  for (const dir of dirs(4)) assert.equal(readFileSync(join(dir, "node_modules/installed-in"), "utf8").trim(), dir);
});

test("prune keeps its live and rollback builds", () => {
  const h = harness();
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  for (const n of [1, 2, 3]) assert.equal(h.switchDurable(wbRev(n), pwRev(n)).status, 0);
  // A prepared build that never went live; retired builds older than any running Pi session.
  assert.equal(h.run(["prepare", wbRev(4), pwRev(4)]).status, 0);
  for (const [n, hours] of [[1, 3], [2, 2]]) for (const product of ["pi-workbench", "pi-web"]) {
    const marker = `${build(product, product === "pi-web" ? pwRev(n) : wbRev(n))}.retired`;
    if (existsSync(marker)) { const when = new Date(Date.now() - hours * 3600e3); utimesSync(marker, when, when); }
  }

  // Keeps live and rollback, removes the rest.
  const dry = h.run(["prune"]);
  assert.match(dry.stdout, /keep   pi-workbench-aaaaaaaaaaa3: live/);
  assert.match(dry.stdout, /keep   pi-workbench-aaaaaaaaaaa2: rollback/);
  assert.match(dry.stdout, /remove pi-workbench-aaaaaaaaaaa4 /);
  const applied = h.run(["prune", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  for (const product of ["pi-workbench", "pi-web"]) {
    const rev = product === "pi-web" ? pwRev : wbRev;
    for (const n of [2, 3]) assert.ok(existsSync(build(product, rev(n))), `${product} ${n}`);
    for (const n of [1, 4]) assert.ok(!existsSync(build(product, rev(n))), `${product} ${n}`);
  }
});

test("the Durable check-idle counts only the Durable daemon's descendants and lets its Durable hosts go", () => {
  const h = harness();
  const ps = (lines) => { const f = join(h.root, "ps-idle.txt"); writeFileSync(f, lines.join("\n") + "\n"); return { PI_PROMOTE_PS: `cat ${f}` }; };
  const daemons = ["1 0 /sbin/launchd", `100 1 node /elsewhere/pi-web-ba9876543210/dist/server/sessiond.js`,
    `200 1 node ${h.store}/pi-web-bbbbbbbbbbb1/dist/server/sessiond.js`, `210 200 node ${h.store}/pi-workbench-aaaaaaaaaaa1/packages/durable-pilot/src/chat-host-main.ts --store x`];
  // A subagent outside the Durable daemon and a host alone do not block a Durable switch.
  assert.equal(h.run(["check-idle"], ps([...daemons, "110 100 node /opt/pi/dist/cli.js --mode rpc"])).status, 0);
  // A Durable Chat's subagent, a grandchild under its host, does.
  const busy = h.run(["check-idle"], ps([...daemons, "220 210 pi --mode rpc --model x"]));
  assert.equal(busy.status, 3);
  assert.match(busy.stderr, /220 210 pi --mode rpc/);
  assert.doesNotMatch(busy.stderr, /chat-host-main/);
});

test("a Durable switch refuses a PI WEB build whose daemon would not run hosts as launchd jobs; nothing changes", () => {
  const h = harness();
  assert.equal(h.switchDurable(wbRev(1), pwRev(1)).status, 0);
  const before = instanceState(h), launches = h.log("launchctl.log");
  const refused = h.sw(wbRev(2), pwRev(2), { NO_LAUNCHD: "1" });
  assert.equal(refused.status, 7, refused.stderr);
  assert.match(refused.stderr, /PI_WEB_DURABLE_HOST_LAUNCHD/);
  assert.equal(readdirSync(join(h.store, "jobs")).length, 1);
  assert.equal(h.log("launchctl.log"), launches);
  assert.deepEqual(instanceState(h), before);
});

test("a Durable switch refuses while a running host speaks a protocol the new daemon does not, listing those families", () => {
  const h = harness();
  assert.equal(h.switchDurable(wbRev(1), pwRev(1)).status, 0);
  const wb1 = join(h.store, `pi-workbench-${short(wbRev(1))}`), old = join(h.store, "pi-workbench-ffffffffffff");
  hosts(h, [{ id: "fam-current", revision: wb1, protocol: 2, pid: process.pid },
    { id: "fam-old", revision: old, protocol: 1, pid: process.pid },
    { id: "fam-gone", revision: old, protocol: 1, pid: deadPid() }]);
  const before = instanceState(h), launches = h.log("launchctl.log");

  // A protocol 3 daemon reattaches none of them; a host that no longer runs does not count.
  const bumped = h.sw(wbRev(2), pwRev(2), { PROTOCOL: "3" });
  assert.equal(bumped.status, 7, bumped.stderr);
  assert.match(bumped.stderr, /refusing: .*protocol 3/);
  assert.match(bumped.stderr, /com\.pi-workbench\.durable-host\.fam-current: protocol 2, revision /);
  assert.match(bumped.stderr, /com\.pi-workbench\.durable-host\.fam-old: protocol 1, revision .*pi-workbench-ffffffffffff/);
  assert.doesNotMatch(bumped.stderr, /fam-gone/);
  // A protocol 2 daemon still cannot reattach the protocol 1 family.
  const same = h.sw(wbRev(3), pwRev(3));
  assert.equal(same.status, 7, same.stderr);
  assert.match(same.stderr, /fam-old/);
  assert.doesNotMatch(same.stderr, /fam-current|fam-gone/);
  assert.equal(readdirSync(join(h.store, "jobs")).length, 1);
  assert.equal(h.log("launchctl.log"), launches);
  assert.deepEqual(instanceState(h), before);

  // Without the old family it schedules; a host started during the delay is checked again when the job starts.
  hosts(h, [{ id: "fam-current", revision: wb1, protocol: 2, pid: process.pid }]);
  const scheduled = h.sw(wbRev(3), pwRev(3));
  assert.equal(scheduled.status, 0, scheduled.stderr);
  hosts(h, [{ id: "fam-current", revision: wb1, protocol: 2, pid: process.pid }, { id: "fam-late", revision: old, protocol: 1, pid: process.pid }]);
  const late = instanceState(h);
  const jobs = join(h.store, "jobs"), job = join(jobs, readdirSync(jobs).sort().at(-1));
  const ran = spawnSync("bash", [join(job, "job.sh")], { env: h.env, encoding: "utf8" });
  assert.equal(ran.status, 7, readFileSync(join(job, "job.log"), "utf8"));
  assert.match(readFileSync(join(job, "job.log"), "utf8"), /fam-late[\s\S]*refused /);
  assert.deepEqual(instanceState(h), late);
});

test("a full Durable switch restarts only the two Durable services, never a host, and prune keeps the builds running hosts use", () => {
  const h = harness();
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  assert.equal(h.switchDurable(wbRev(1), pwRev(1)).status, 0);
  assert.equal(h.run(["prepare", wbRev(4), pwRev(4)]).status, 0);
  hosts(h, [{ id: "fam-a", revision: build("pi-workbench", wbRev(1)), protocol: 2, pid: process.pid },
    { id: "fam-b", revision: build("pi-workbench", wbRev(1)), protocol: 2, pid: process.pid }]);
  // A family whose host died: its revision may go once nothing else names it.
  const gone = JSON.parse(readFileSync(join(h.data, "session-runtimes.json"), "utf8"));
  gone.chats["fam-gone"] = { ...gone.chats["fam-a"], id: "fam-gone", storeId: "fam-gone",
    host: { ...gone.chats["fam-a"].host, label: "com.pi-workbench.durable-host.fam-gone", revision: realpathSync(build("pi-workbench", wbRev(4))), pid: deadPid() } };
  put(join(h.data, "session-runtimes.json"), JSON.stringify(gone));
  const hostsBefore = hostState(h);

  for (const n of [2, 3]) {
    const promoted = h.switchDurable(wbRev(n), pwRev(n));
    assert.equal(promoted.status, 0, promoted.log);
    assert.deepEqual(hostState(h), hostsBefore);
  }
  const labels = [...launchLabels(h)].filter((l) => !l.startsWith("com.pi-workbench.promote-installed-durable."));
  assert.deepEqual(labels.sort(), ["com.pi-web-durable.sessiond", "com.pi-web-durable.web"]);
  // The new daemon finds the hosts where they were: the same data dir, launchd hosts on.
  assert.equal(h.plist("sessiond").EnvironmentVariables.PI_WEB_DATA_DIR, h.data);
  assert.equal(h.plist("sessiond").EnvironmentVariables.PI_WEB_DURABLE_HOST_LAUNCHD, "com.pi-workbench.durable-host");

  for (const product of ["pi-workbench", "pi-web"]) for (const n of [1, 2]) {
    const marker = `${build(product, product === "pi-web" ? pwRev(n) : wbRev(n))}.retired`, when = new Date(Date.now() - (3 - n) * 3600e3);
    if (existsSync(marker)) utimesSync(marker, when, when);
  }
  // The switches' own prunes may already have removed some; the end state counts.
  const dry = h.run(["prune"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /keep   pi-workbench-aaaaaaaaaaa1: a running Durable host runs from it/);
  assert.equal(h.run(["prune", "--apply"]).status, 0);
  assert.ok(existsSync(build("pi-workbench", wbRev(1))));
  assert.ok(!existsSync(build("pi-web", pwRev(1))));
  assert.ok(!existsSync(build("pi-workbench", wbRev(4))));

  // An unreadable locator removes nothing.
  assert.equal(h.run(["prepare", wbRev(5), pwRev(5)]).status, 0);
  put(join(h.data, "session-runtimes.json"), "{");
  const unreadable = h.run(["prune", "--apply"]);
  assert.notEqual(unreadable.status, 0);
  assert.match(unreadable.stderr, /session-runtimes\.json/);
  assert.ok(existsSync(build("pi-workbench", wbRev(5))));
});

test("PI_PROMOTE_DURABLE_ENV adds service environment on the real Durable instance too, and later switches keep it (the agent's git identity)", () => {
  const h = harness();
  const promoted = h.switchDurable(wbRev(1), pwRev(1), { PI_PROMOTE_DURABLE_ENV: "GIT_CONFIG_GLOBAL=/home/agent.gitconfig PI_WEB_DURABLE_AUTO_UPGRADE=0" });
  assert.equal(promoted.status, 0, promoted.log);
  for (const s of ["sessiond", "web"]) {
    const env = h.plist(s).EnvironmentVariables;
    assert.equal(env.GIT_CONFIG_GLOBAL, "/home/agent.gitconfig");
    assert.equal(env.PI_WEB_DURABLE_AUTO_UPGRADE, "0", "a later entry overrides the default");
    assert.equal(env.PI_WEB_PORT, "8506");
  }
  // Without it, the next switch keeps the extra keys but sets its own keys again.
  assert.equal(h.switchDurable(wbRev(2), pwRev(2)).status, 0);
  for (const s of ["sessiond", "web"]) {
    const env = h.plist(s).EnvironmentVariables;
    assert.equal(env.GIT_CONFIG_GLOBAL, "/home/agent.gitconfig");
    assert.equal(env.PI_WEB_DURABLE_AUTO_UPGRADE, "1", "a key the script owns comes from the script");
    assert.match(env.PI_WEB_DURABLE_HOST, new RegExp(short(wbRev(2))));
  }
  // Given again, it merges: new keys add, -KEY removes a carried key.
  assert.equal(h.switchDurable(wbRev(3), pwRev(3), { PI_PROMOTE_DURABLE_ENV: "-GIT_CONFIG_GLOBAL PI_OFFLINE=1" }).status, 0);
  const env = h.plist("web").EnvironmentVariables;
  assert.equal(env.GIT_CONFIG_GLOBAL, undefined);
  assert.equal(env.PI_OFFLINE, "1");
});

test("prune keeps the build a stopped Durable Chat is pinned to (C3 hostEntry) and removes it once the pin goes", () => {
  const h = harness();
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  const pin = (entry) => put(join(h.data, "session-runtimes.json"), JSON.stringify({ version: 1, chats: { "fam-p": { id: "fam-p", cwd: h.root,
    runtime: "durable", storeId: "fam-p", created: "", modified: "", firstMessage: "", messageCount: 0, ...(entry ? { hostEntry: entry } : {}) } } }));
  for (const n of [1, 2]) assert.equal(h.switchDurable(wbRev(n), pwRev(n)).status, 0);
  pin(join(realpathSync(build("pi-workbench", wbRev(1))), "packages/durable-pilot/src/chat-host-main.ts"));
  // Build 1 is neither live nor the rollback after this switch; without the pin its own prune removes it.
  assert.equal(h.switchDurable(wbRev(3), pwRev(3)).status, 0);
  assert.ok(existsSync(build("pi-workbench", wbRev(1))));
  for (const product of ["pi-workbench", "pi-web"]) {
    const marker = `${build(product, product === "pi-web" ? pwRev(1) : wbRev(1))}.retired`, when = new Date(Date.now() - 3 * 3600e3);
    if (existsSync(marker)) utimesSync(marker, when, when);
  }
  const dry = h.run(["prune"]);
  assert.match(dry.stdout, /keep   pi-workbench-aaaaaaaaaaa1: a Durable Chat is pinned to it/);
  pin(undefined);
  assert.equal(h.run(["prune", "--apply"]).status, 0);
  assert.ok(!existsSync(build("pi-workbench", wbRev(1))));
});

test("a Durable switch whose health check fails rolls back without touching any host", () => {
  const h = harness();
  assert.equal(h.switchDurable(wbRev(1), pwRev(1)).status, 0);
  hosts(h, [{ id: "fam-a", revision: join(h.store, `pi-workbench-${short(wbRev(1))}`), protocol: 2, pid: process.pid }]);
  const before = instanceState(h);
  const failed = h.switchDurable(wbRev(2), pwRev(2), { BAD: short(pwRev(2)) });
  assert.equal(failed.status, 1, failed.log);
  assert.match(failed.log, /rollback done/);
  assert.deepEqual(instanceState(h), before);
  const labels = [...launchLabels(h)].filter((l) => !l.startsWith("com.pi-workbench.promote-installed-durable."));
  assert.deepEqual(labels.sort(), ["com.pi-web-durable.sessiond", "com.pi-web-durable.web"]);
});

test("a trial (PI_PROMOTE_DURABLE_TRIAL) promotes and rolls back only its own folder, port and com.pi-workbench.durable-trial.* labels", () => {
  const h = harness();
  const trial = join(h.root, "trial"), store = join(trial, "installed-durable"), data = join(trial, "data"), la = join(trial, "LaunchAgents");
  const projects = join(trial, "projects");
  for (const product of ["pi-workbench", "pi-web"]) mkdirSync(join(projects, product), { recursive: true });
  const t = { PI_PROMOTE_DURABLE_TRIAL: trial, PI_PROMOTE_DURABLE_PORT: "8516", PI_WORKBENCH_PROJECTS: projects, WEB_PLIST: join(la, "com.pi-workbench.durable-trial.web.plist"),
    PI_PROMOTE_DURABLE_ENV: "PI_WEB_DURABLE_AGENT_DIR=/trial/agent PI_OFFLINE=1" };
  const instance = h.durable();
  const build = (product, rev) => join(store, `${product}-${short(rev)}`);
  const plist = (s) => JSON.parse(spawnSync("plutil", ["-convert", "json", "-o", "-", join(la, `com.pi-workbench.durable-trial.${s}.plist`)], { encoding: "utf8" }).stdout);
  // Like switchDurable, against the trial's store.
  const promote = (n, extra = {}) => {
    const scheduled = h.sw(wbRev(n), pwRev(n), { ...t, ...extra });
    assert.equal(scheduled.status, 0, scheduled.stderr);
    const job = join(store, "jobs", readdirSync(join(store, "jobs")).sort().at(-1));
    // launchd starts the job without the caller's environment: only the shims' switches.
    const ran = spawnSync("bash", [join(job, "job.sh")], { env: { ...h.env, WEB_PLIST: t.WEB_PLIST, ...extra }, encoding: "utf8" });
    return { status: ran.status, log: readFileSync(join(job, "job.log"), "utf8"), job };
  };

  for (const n of [1, 2]) {
    const promoted = promote(n);
    assert.equal(promoted.status, 0, promoted.log);
    const job = spawnSync("plutil", ["-convert", "json", "-o", "-", join(promoted.job, "job.plist")], { encoding: "utf8" }).stdout;
    assert.match(JSON.parse(job).Label, /^com\.pi-workbench\.durable-trial\.promote\.\d/);
    // The job's own checks and prune act on the trial, not on the real Durable instance.
    assert.match(promoted.log, new RegExp(`promoted [\\s\\S]*\\nkeep   pi-workbench-${short(wbRev(n))}: live`));
  }
  for (const s of ["sessiond", "web"]) {
    const p = plist(s);
    assert.equal(p.Label, `com.pi-workbench.durable-trial.${s}`);
    assert.equal(p.StandardOutPath, join(data, "logs", `${s}.log`));
    assert.deepEqual(p.EnvironmentVariables, {
      PI_WEB_DATA_DIR: data, PI_WEB_CONFIG: join(data, "config.json"), PI_WEB_PORT: "8516", PI_WEB_PI_PACKAGE_AUTO_INSTALL: "0",
      PI_WEB_PI_PACKAGE_DIR: `${build("pi-web", pwRev(2))}/node_modules/@earendil-works/pi-coding-agent`,
      PI_WEB_DURABLE_HOST: `${build("pi-workbench", wbRev(2))}/packages/durable-pilot/src/chat-host-main.ts`, PI_WEB_DURABLE_DEFAULT: "1",
      PI_WEB_DURABLE_HOST_LAUNCHD: "com.pi-workbench.durable-trial.host", PI_WEB_DURABLE_AUTO_UPGRADE: "1", PI_WEB_DURABLE_AGENT_DIR: "/trial/agent", PI_OFFLINE: "1",
      PI_PROMOTE_DURABLE_TRIAL: trial, PI_PROMOTE_DURABLE_PORT: "8516", PI_WORKBENCH_PROJECTS: projects,
    });
  }
  // PI WEB's Install latest runs the script with the web service's environment: it must act on the trial, not the real store.
  const fromWeb = spawnSync("bash", [script, "current"], { env: { ...h.env, ...plist("web").EnvironmentVariables }, encoding: "utf8" });
  assert.equal(fromWeb.stdout.trim(), `${short(wbRev(2))} ${short(pwRev(2))}`, fromWeb.stderr);
  assert.notEqual(h.run(["current"]).stdout.trim(), fromWeb.stdout.trim());
  assert.equal(resolve(join(projects, "pi-workbench.durable-installed")), build("pi-workbench", wbRev(2)));
  assert.equal(readlinkSync(join(data, "plugins/pi-workbench")), join(projects, "pi-workbench.durable-installed/packages"));

  // A forced failed health check restores the trial's previous services.
  const failed = promote(3, { BAD: short(pwRev(3)) });
  assert.equal(failed.status, 1, failed.log);
  assert.match(failed.log, /FAILED; restoring previous services[\s\S]*rollback done/);
  assert.equal(plist("web").ProgramArguments[3], `exec node '${build("pi-web", pwRev(2))}/dist/server/index.js'`);

  // The trial's extra environment may turn launchd hosts off (forked hosts, the survival run's red check).
  assert.equal(promote(4, { PI_PROMOTE_DURABLE_ENV: "PI_WEB_DURABLE_HOST_LAUNCHD=" }).status, 0);
  assert.equal(plist("sessiond").EnvironmentVariables.PI_WEB_DURABLE_HOST_LAUNCHD, "");

  // Only trial labels, port and socket; the real Durable instance never moved.
  const labels = [...h.log("launchctl.log").matchAll(/(com\.pi-[\w.-]+?)(?:\.plist)?(?:\s|$)/g)].map((m) => m[1]);
  assert.ok(labels.length > 0);
  for (const label of labels) assert.match(label, /^com\.pi-workbench\.durable-trial\./);
  for (const line of h.log("lsof.log").trim().split("\n").filter((l) => /tcp:|sock/.test(l))) assert.match(line, new RegExp(`tcp:8516|${data}/sessiond\.sock`), line);
  assert.deepEqual(h.durable(), instance);

  // A trial needs its own port.
  for (const port of ["", "8506"]) assert.equal(h.run(["prune"], { ...t, PI_PROMOTE_DURABLE_PORT: port }).status, 2, port);
});

test("a trial refuses a port that is the Durable one in disguise, and projects outside the trial, before touching anything", () => {
  const h = harness();
  const trial = join(h.root, "trial"), projects = join(trial, "projects");
  for (const product of ["pi-workbench", "pi-web"]) mkdirSync(join(projects, product), { recursive: true });
  const instance = h.durable();
  const refused = (env) => {
    const r = h.run(["switch", wbRev(1), pwRev(1), "0"], { PI_PROMOTE_DURABLE_TRIAL: trial, ...env });
    assert.equal(r.status, 2, r.stdout + r.stderr);
  };
  for (const port of ["08506", "008506", "8506", "80", "70000", ""]) refused({ PI_PROMOTE_DURABLE_PORT: port, PI_WORKBENCH_PROJECTS: projects });
  // Without its own projects folder a trial switch would repoint the real *.durable-installed links.
  refused({ PI_PROMOTE_DURABLE_PORT: "8516" });
  refused({ PI_PROMOTE_DURABLE_PORT: "8516", PI_WORKBENCH_PROJECTS: h.projects });
  assert.equal(launchLabels(h).size, 0);
  assert.ok(!existsSync(join(trial, "installed-durable")));
  assert.deepEqual(h.durable(), instance);
});

test("the removed legacy commands and --instance are refused", () => {
  const h = harness();
  for (const args of [["check-settings"], ["--instance", "durable", "prune"]]) {
    const r = h.run(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /promote-installed supports/);
  }
});

test("release layout: an old two-link install migrates on the next switch without changing what runs; again is a no-op", () => {
  const h = harness();
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  assert.equal(h.run(["prepare", wbRev(1), pwRev(1)]).status, 0);
  for (const [p, rev] of [["pi-workbench", wbRev(1)], ["pi-web", pwRev(1)]]) symlinkSync(build(p, rev), join(h.projects, `${p}.durable-installed`));
  assert.equal(h.run(["current"]).stdout, `${short(wbRev(1))} ${short(pwRev(1))}\n`);

  const scheduled = h.sw(wbRev(2), pwRev(2));
  assert.equal(scheduled.status, 0, scheduled.stderr);
  assert.match(scheduled.stderr, /migrating the \*\.durable-installed links/);
  // Scheduled, not yet run: the same builds, now through current.
  assert.equal(readlinkSync(join(h.store, "current")), `releases/${short(wbRev(1))}-${short(pwRev(1))}`);
  for (const [p, rev] of [["pi-workbench", wbRev(1)], ["pi-web", pwRev(1)]]) {
    assert.equal(readlinkSync(join(h.projects, `${p}.durable-installed`)), join(h.store, "current", p));
    assert.equal(resolve(join(h.projects, `${p}.durable-installed`)), build(p, rev));
  }
  const jobs = join(h.store, "jobs"), job = join(jobs, readdirSync(jobs).sort().at(-1));
  assert.equal(spawnSync("bash", [join(job, "job.sh")], { env: h.env }).status, 0, readFileSync(join(job, "job.log"), "utf8"));
  assert.equal(h.run(["current"]).stdout, `${short(wbRev(2))} ${short(pwRev(2))}\n`);
  assert.equal(readlinkSync(join(h.store, "previous")), `releases/${short(wbRev(1))}-${short(pwRev(1))}`);

  const again = h.switchDurable(wbRev(3), pwRev(3));
  assert.equal(again.status, 0, again.log);
  assert.doesNotMatch(again.scheduled.stderr, /migrating/);
});

test("first install can resume with one dangling public link; reselecting a release never rewrites it", () => {
  const h = harness();
  symlinkSync(join(h.store, "current/pi-workbench"), join(h.projects, "pi-workbench.durable-installed"));
  assert.equal(h.run(["current"]).stdout, "none none\n");
  assert.equal(h.switchDurable(wbRev(1), pwRev(1)).status, 0);
  const dir = realpathSync(join(h.store, "current"));
  const times = () => [dir, ...["pi-workbench", "pi-web"].map(p => join(dir, p))].map(p => lstatSync(p).ctimeMs);
  const before = times();
  assert.equal(h.switchDurable(wbRev(1), pwRev(1)).status, 0);
  assert.deepEqual(times(), before);
});

test("release layout: a failed swap of current or a failed health check leaves the old pair whole, previous restored", () => {
  const h = harness();
  const pair = () => h.run(["current"]).stdout.trim();
  for (const n of [1, 2]) assert.equal(h.switchDurable(wbRev(n), pwRev(n)).status, 0);
  const before = { current: readlinkSync(join(h.store, "current")), previous: readlinkSync(join(h.store, "previous")), pair: pair() };
  assert.equal(before.pair, `${short(wbRev(2))} ${short(pwRev(2))}`);
  const after = () => ({ current: readlinkSync(join(h.store, "current")), previous: readlinkSync(join(h.store, "previous")), pair: pair() });

  // The rename of current fails after previous moved: the job rolls back, both products stay on pair 2.
  const failedSwap = h.switchDurable(wbRev(3), pwRev(3), { FAIL_MV_CURRENT: "1" });
  assert.equal(failedSwap.status, 1, failedSwap.log);
  assert.match(failedSwap.log, /rollback done/);
  assert.deepEqual(after(), before);
  // The swap succeeded but PI WEB stays unhealthy: rollback swaps current back in one rename.
  const unhealthy = h.switchDurable(wbRev(3), pwRev(3), { BAD: short(pwRev(3)) });
  assert.equal(unhealthy.status, 1, unhealthy.log);
  assert.deepEqual(after(), before);
  // switch-workbench whose rename fails changes nothing either.
  const wb = h.run(["switch-workbench", wbRev(4)], { FAIL_MV_CURRENT: "1" });
  assert.equal(wb.status, 1);
  assert.equal(pair(), before.pair);
  const ok = h.run(["switch-workbench", wbRev(4)]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(pair(), `${short(wbRev(4))} ${short(pwRev(2))}`);
  assert.equal(readlinkSync(join(h.store, "previous")), before.current);
});

test("prune never removes a build named by the current or previous release, and drops other release folders", () => {
  const h = harness();
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  for (const n of [1, 2]) assert.equal(h.switchDurable(wbRev(n), pwRev(n)).status, 0);
  assert.equal(h.run(["prepare", wbRev(3), pwRev(3)]).status, 0);
  assert.equal(h.run(["prepare", wbRev(4), pwRev(4)]).status, 0);
  // Every retired marker older than any running Pi; build 3 is the newest retired, so the rollback guess picks it, not 1.
  for (const [n, hours] of [[1, 3], [3, 1]]) for (const product of ["pi-workbench", "pi-web"]) {
    const marker = `${build(product, product === "pi-web" ? pwRev(n) : wbRev(n))}.retired`, when = new Date(Date.now() - hours * 3600e3);
    writeFileSync(marker, ""); utimesSync(marker, when, when);
  }
  mkdirSync(join(h.store, "releases", "000000000000-111111111111"));
  const dry = h.run(["prune"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /keep   pi-workbench-aaaaaaaaaaa1: rollback \(in the current or previous release\)/);
  assert.match(dry.stdout, /remove release 000000000000-111111111111/);
  assert.equal(h.run(["prune", "--apply"]).status, 0);
  for (const product of ["pi-workbench", "pi-web"]) {
    const rev = product === "pi-web" ? pwRev : wbRev;
    for (const n of [1, 2, 3]) assert.ok(existsSync(build(product, rev(n))), `${product} ${n}`);
    assert.ok(!existsSync(build(product, rev(4))), `${product} 4`);
  }
  assert.deepEqual(readdirSync(join(h.store, "releases")).sort(), [`${short(wbRev(1))}-${short(pwRev(1))}`, `${short(wbRev(2))}-${short(pwRev(2))}`]);
});
