// The separate Durable instance (docs/plans/pi-durable-cutover-spec.md B7, AC7): `--instance durable` installs from
// clean revision folders, promotes and rolls back only its own links, plists and folders, and the legacy instance's
// links, plists, settings.json, ~/.pi-web, ~/.config/pi-web and ~/.pi-workbench/installed stay byte-identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const script = new URL("./promote-installed", import.meta.url).pathname;
const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };
const wbRev = (n) => `${"a".repeat(11)}${n}0000`, pwRev = (n) => `${"b".repeat(11)}${n}0000`;
const short = (rev) => rev.slice(0, 12);

function harness() {
  const root = mkdtempSync(join(tmpdir(), "promote-durable-"));
  const home = join(root, "home"), projects = join(root, "projects"), bin = join(root, "bin");
  const la = join(home, "Library/LaunchAgents"), legacyStore = join(home, ".pi-workbench/installed");
  const store = join(home, ".pi-workbench/installed-durable"), data = join(home, ".pi-web-durable");
  const shim = (name, body) => { put(join(bin, name), `#!/bin/sh\n${body}\n`); spawnSync("chmod", ["+x", join(bin, name)]); };
  // git: rev-parse echoes the revision; worktree add makes the folder (with the Durable host's package for pi-workbench).
  shim("git", `case "$3" in rev-parse) r="$5"; echo "\${r%^{commit\\}}";;
  worktree) if [ "$4" = add ]; then mkdir -p "$6"; case "$6" in */pi-workbench-*) mkdir -p "$6/packages/durable-pilot/src";; esac; fi;; esac`);
  shim("npm", `echo "$1 $PWD" >> "$HOME/npm.log"
  case "$1" in ci) mkdir -p node_modules/node-pty/prebuilds/x && touch node_modules/node-pty/prebuilds/x/spawn-helper;;
  run) mkdir -p dist/server && echo daemon > dist/server/sessiond.js && echo web > dist/server/index.js && echo lock > package-lock.json;; esac`);
  shim("launchctl", `echo "$*" >> "$HOME/launchctl.log"`);
  shim("lsof", `echo "$*" >> "$HOME/lsof.log"`);
  shim("sleep", "exit 0");
  // Job folders are named by the second; give each switch its own.
  shim("date", `case "$*" in *%Y%m%dT*) n=$(cat "$HOME/dates" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$HOME/dates"; echo "20261117T0000\${n}Z";; *) exec /bin/date "$@";; esac`);
  // Healthy unless the Durable web service runs the build named by BAD.
  shim("curl", `if [ -n "$BAD" ] && grep -q "$BAD" "$HOME/Library/LaunchAgents/com.pi-web-durable.web.plist" 2>/dev/null; then exit 1; fi
  echo '{"plugins":[{"id":"pi-workbench","server":{"state":"active","restartRequired":false}}]}'`);
  const ps = join(root, "ps.txt");
  put(ps, "");

  // The legacy instance: builds, links, plists, Pi settings, PI WEB config and plugin link, the CLI links.
  for (const [product, sha] of [["pi-workbench", "0123456789ab"], ["pi-web", "ba9876543210"]]) {
    mkdirSync(join(projects, product), { recursive: true });
    // cccccccccccc is the legacy rollback (newest prepared); eeeeeeeeeeee is stale.
    for (const [s, hours] of [[sha, 1], ["cccccccccccc", 0], ["eeeeeeeeeeee", 5]]) {
      mkdirSync(join(legacyStore, `${product}-${s}`), { recursive: true });
      const marker = join(legacyStore, `${product}-${s}.prepared`), when = new Date(Date.now() - hours * 3600e3);
      put(marker, ""); utimesSync(marker, when, when);
    }
    symlinkSync(join(legacyStore, `${product}-${sha}`), join(projects, `${product}.installed`));
  }
  for (const s of ["web", "sessiond", "ui-dev"]) put(join(la, `com.pi-web.${s}.plist`), `<string>exec node &apos;${legacyStore}/pi-web-ba9876543210/dist/server/${s}.js&apos;</string>\n`);
  put(join(home, ".pi/agent/settings.json"), JSON.stringify({ packages: [join(projects, "pi-workbench.installed")] }) + "\n");
  put(join(home, ".pi/agent/auth.json"), "{}\n");
  mkdirSync(join(home, ".pi/agent/bin"), { recursive: true });
  symlinkSync(join(projects, "pi-workbench.installed/skills/workstreams/scripts/workstreams.mjs"), join(home, ".pi/agent/bin/workstreams"));
  put(join(home, ".config/pi-web/config.json"), '{"port":8505,"theme":"dark"}\n');
  mkdirSync(join(home, ".pi-web/plugins"), { recursive: true });
  symlinkSync(join(projects, "pi-workbench.installed/packages"), join(home, ".pi-web/plugins/pi-workbench"));

  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PI_") || key === "PI_TMP")),
    HOME: home, PI_WORKBENCH_PROJECTS: projects, PI_PROMOTE_PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    PI_PROMOTE_PS: `cat ${ps}`, PI_PROMOTE_ETIME_PS: `cat ${ps}`, PI_PROMOTE_ZSH: "/bin/zsh",
  };
  const run = (args, extra = {}) => spawnSync("bash", [script, ...args], { env: { ...env, ...extra }, encoding: "utf8" });
  // Each path under the legacy instance: file bytes and mtime, link target, or folder.
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
  const legacy = () => snapshot([...["web", "sessiond", "ui-dev"].map((s) => join(la, `com.pi-web.${s}.plist`)), join(home, ".pi"),
    join(home, ".config"), join(home, ".pi-web"), legacyStore, join(projects, "pi-workbench.installed"), join(projects, "pi-web.installed")]);
  const durable = () => snapshot([store, join(projects, "pi-workbench.durable-installed"), join(projects, "pi-web.durable-installed"),
    join(la, "com.pi-web-durable.web.plist"), join(la, "com.pi-web-durable.sessiond.plist"), data]);
  const log = (name) => { try { return readFileSync(join(home, name), "utf8"); } catch { return ""; } };
  const plist = (s) => JSON.parse(spawnSync("plutil", ["-convert", "json", "-o", "-", join(la, `com.pi-web-durable.${s}.plist`)], { encoding: "utf8" }).stdout);
  /** Schedule a durable switch, then run its job as launchd would. */
  const switchDurable = (wb, pw, extra = {}) => {
    const scheduled = run(["--instance", "durable", "switch", wb, pw, "0"], extra);
    assert.equal(scheduled.status, 0, scheduled.stderr);
    const jobs = join(store, "jobs"), latest = readdirSync(jobs).sort().at(-1);
    const job = spawnSync("bash", [join(jobs, latest, "job.sh")], { env: { ...env, ...extra }, encoding: "utf8" });
    return { scheduled, status: job.status, log: readFileSync(join(jobs, latest, "job.log"), "utf8") };
  };
  return { root, home, projects, la, store, legacyStore, data, run, legacy, durable, log, plist, switchDurable };
}

const legacyLabels = /com\.pi-web\.(web|sessiond|ui-dev)\b/;

test("the Durable instance installs from clean folders, promotes twice and rolls back a failed health check without touching the legacy instance", () => {
  const h = harness();
  const before = h.legacy();
  const links = () => ["pi-workbench", "pi-web"].map((p) => readlinkSync(join(h.projects, `${p}.durable-installed`)));
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  assert.ok(!existsSync(h.store));

  // Install from clean revision folders.
  const install = h.switchDurable(wbRev(1), pwRev(1));
  assert.equal(install.status, 0, install.log);
  assert.match(install.log, /promoted/);
  assert.deepEqual(links(), [build("pi-workbench", wbRev(1)), build("pi-web", pwRev(1))]);
  assert.match(h.log("npm.log"), new RegExp(`ci ${build("pi-workbench", wbRev(1))}\nci ${build("pi-workbench", wbRev(1))}/packages/durable-pilot\n`));
  assert.equal(readlinkSync(join(h.data, "plugins/pi-workbench")), join(h.projects, "pi-workbench.durable-installed/packages"));
  assert.equal(readFileSync(join(h.data, "config.json"), "utf8"), '{"port":8505,"theme":"dark"}\n');
  for (const s of ["sessiond", "web"]) {
    const p = h.plist(s);
    assert.equal(p.Label, `com.pi-web-durable.${s}`);
    assert.equal(p.ProgramArguments[3], `exec node '${build("pi-web", pwRev(1))}/dist/server/${s === "web" ? "index" : "sessiond"}.js'`);
    assert.deepEqual(p.EnvironmentVariables, {
      PI_WEB_DATA_DIR: h.data, PI_WEB_CONFIG: join(h.data, "config.json"), PI_WEB_PORT: "8506", PI_WEB_PI_PACKAGE_AUTO_INSTALL: "0",
      PI_WEB_PI_PACKAGE_DIR: `${build("pi-web", pwRev(1))}/node_modules/@earendil-works/pi-coding-agent`,
      PI_WEB_DURABLE_HOST: `${build("pi-workbench", wbRev(1))}/packages/durable-pilot/src/chat-host-main.ts`, PI_WEB_DURABLE_DEFAULT: "1",
    });
    assert.equal(p.StandardOutPath, join(h.data, "logs", `${s}.log`));
  }
  assert.deepEqual(h.legacy(), before);

  // Two promotions.
  for (const n of [2, 3]) {
    const promoted = h.switchDurable(wbRev(n), pwRev(n));
    assert.equal(promoted.status, 0, promoted.log);
    assert.deepEqual(links(), [build("pi-workbench", wbRev(n)), build("pi-web", pwRev(n))]);
    assert.ok(existsSync(`${build("pi-workbench", wbRev(n - 1))}.retired`));
    assert.deepEqual(h.legacy(), before);
  }
  const promotedState = h.durable();

  // A forced failed health check: everything of the Durable instance returns, the legacy instance never moved.
  const failed = h.switchDurable(wbRev(4), pwRev(4), { BAD: short(pwRev(4)) });
  assert.equal(failed.status, 1, failed.log);
  assert.match(failed.log, /FAILED; restoring previous services[\s\S]*rollback done/);
  assert.deepEqual(links(), [build("pi-workbench", wbRev(3)), build("pi-web", pwRev(3))]);
  for (const path of ["com.pi-web-durable.web.plist", "com.pi-web-durable.sessiond.plist"]) {
    assert.equal(h.durable()[relative(h.root, join(h.la, path))], promotedState[relative(h.root, join(h.la, path))], path);
  }
  assert.deepEqual(h.legacy(), before);

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
  const wb = h.run(["--instance", "durable", "switch-workbench", wbRev(5)]);
  assert.equal(wb.status, 0, wb.stderr);
  assert.match(wb.stdout, /roll back: .* --instance durable switch-workbench aaaaaaaaaaa3/);
  assert.equal(readlinkSync(join(h.projects, "pi-workbench.durable-installed")), build("pi-workbench", wbRev(5)));
  const web = h.run(["--instance", "durable", "switch-web", pwRev(5)]);
  assert.equal(web.status, 0, web.stderr);
  assert.match(web.stdout, /roll back: .* --instance durable switch-web bbbbbbbbbbb3/);
  assert.equal(h.plist("web").ProgramArguments[3], `exec node '${build("pi-web", pwRev(5))}/dist/server/index.js'`);
  const sessiond = relative(h.root, join(h.la, "com.pi-web-durable.sessiond.plist"));
  assert.equal(h.durable()[sessiond], plists[sessiond]);
  assert.doesNotMatch(h.log("launchctl.log"), legacyLabels);
  assert.deepEqual(h.legacy(), before);
});

test("a legacy prune keeps the Durable instance's builds, and a Durable prune keeps its live and rollback builds", () => {
  const h = harness();
  const build = (product, rev) => join(h.store, `${product}-${short(rev)}`);
  for (const n of [1, 2, 3]) assert.equal(h.switchDurable(wbRev(n), pwRev(n)).status, 0);
  // A prepared build that never went live; retired builds older than any running Pi session.
  assert.equal(h.run(["--instance", "durable", "prepare", wbRev(4), pwRev(4)]).status, 0);
  for (const [n, hours] of [[1, 3], [2, 2]]) for (const product of ["pi-workbench", "pi-web"]) {
    const marker = `${build(product, product === "pi-web" ? pwRev(n) : wbRev(n))}.retired`;
    if (existsSync(marker)) { const when = new Date(Date.now() - hours * 3600e3); utimesSync(marker, when, when); }
  }

  // Legacy: removes its own stale builds and never looks at installed-durable.
  const durableBefore = h.durable();
  const legacy = h.run(["prune", "--apply"]);
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.match(legacy.stdout, /removed pi-workbench-eeeeeeeeeeee/);
  assert.match(legacy.stdout, /keep   pi-workbench-cccccccccccc: rollback/);
  assert.doesNotMatch(legacy.stdout, /aaaaaaaaaaa|bbbbbbbbbbb/);
  assert.deepEqual(h.durable(), durableBefore);
  assert.ok(existsSync(join(h.legacyStore, "pi-workbench-0123456789ab")));

  // Durable: keeps live and rollback, removes the rest; the legacy store stays as it is.
  const legacyBefore = h.legacy();
  const dry = h.run(["--instance", "durable", "prune"]);
  assert.match(dry.stdout, /keep   pi-workbench-aaaaaaaaaaa3: live/);
  assert.match(dry.stdout, /keep   pi-workbench-aaaaaaaaaaa2: rollback/);
  assert.match(dry.stdout, /remove pi-workbench-aaaaaaaaaaa4 /);
  const applied = h.run(["--instance", "durable", "prune", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  for (const product of ["pi-workbench", "pi-web"]) {
    const rev = product === "pi-web" ? pwRev : wbRev;
    for (const n of [2, 3]) assert.ok(existsSync(build(product, rev(n))), `${product} ${n}`);
    for (const n of [1, 4]) assert.ok(!existsSync(build(product, rev(n))), `${product} ${n}`);
  }
  assert.deepEqual(h.legacy(), legacyBefore);
});

test("the Durable check-idle counts only the Durable daemon's descendants and lets its Durable hosts go", () => {
  const h = harness();
  const ps = (lines) => { const f = join(h.root, "ps-idle.txt"); writeFileSync(f, lines.join("\n") + "\n"); return { PI_PROMOTE_PS: `cat ${f}` }; };
  const daemons = ["1 0 /sbin/launchd", `100 1 node ${h.legacyStore}/pi-web-ba9876543210/dist/server/sessiond.js`,
    `200 1 node ${h.store}/pi-web-bbbbbbbbbbb1/dist/server/sessiond.js`, `210 200 node ${h.store}/pi-workbench-aaaaaaaaaaa1/packages/durable-pilot/src/chat-host-main.ts --store x`];
  // A legacy subagent and a host alone do not block a Durable switch.
  assert.equal(h.run(["--instance", "durable", "check-idle"], ps([...daemons, "110 100 node /opt/pi/dist/cli.js --mode rpc"])).status, 0);
  // A Durable Chat's subagent, a grandchild under its host, does.
  const busy = h.run(["--instance", "durable", "check-idle"], ps([...daemons, "220 210 pi --mode rpc --model x"]));
  assert.equal(busy.status, 3);
  assert.match(busy.stderr, /220 210 pi --mode rpc/);
  assert.doesNotMatch(busy.stderr, /chat-host-main/);
});

test("--instance names only durable, which refuses the legacy-only commands", () => {
  const h = harness();
  assert.equal(h.run(["--instance", "other", "prune"]).status, 2);
  const settings = h.run(["--instance", "durable", "check-settings"]);
  assert.equal(settings.status, 2);
  assert.match(settings.stderr, /--instance durable supports/);
});
