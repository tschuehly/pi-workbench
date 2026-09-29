import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./promote-installed", import.meta.url).pathname;
const sha = "abcdef1234567890";
const put = (path, data) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, data); };
const plist = (entry) => `<string>exec node '${entry}'</string>\n`;

function scenario({ healthy, daemonChanged = false }) {
  const root = mkdtempSync(join(tmpdir(), "promote-switch-web-"));
  const home = join(root, "home"), projects = join(root, "projects"), bin = join(root, "bin");
  const store = join(home, ".pi-workbench/installed"), la = join(home, "Library/LaunchAgents");
  const old = join(store, "pi-web-000000000000"), next = join(store, `pi-web-${sha.slice(0, 12)}`);
  for (const dir of [old, next]) {
    put(join(dir, "dist/server/sessiond.js"), dir === next && daemonChanged ? "changed\n" : "daemon\n");
    put(join(dir, "package-lock.json"), "lock\n");
  }
  put(`${next}.prepared`, "");
  put(join(la, "com.pi-web.sessiond.plist"), plist(`${old}/dist/server/sessiond.js`));
  put(join(la, "com.pi-web.web.plist"), plist(`${old}/dist/server/index.js`));
  mkdirSync(join(projects, "pi-web"), { recursive: true });
  symlinkSync(old, join(projects, "pi-web.installed"));
  const shim = (name, body) => { put(join(bin, name), `#!/bin/sh\n${body}\n`); spawnSync("chmod", ["+x", join(bin, name)]); };
  shim("git", `echo ${sha}`);
  shim("sleep", "exit 0");
  shim("launchctl", `echo "$*" >> "$HOME/launchctl.log"`);
  // Healthy only while the web plist points at the build that works.
  shim("curl", `grep -q "${healthy ? next : old}" "$HOME/Library/LaunchAgents/com.pi-web.web.plist" || exit 1\necho '{"plugins":[{"id":"pi-workbench","server":{"state":"active","restartRequired":false}}]}'`);
  const result = spawnSync("bash", [script, "switch-web", "HEAD"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, PI_WORKBENCH_PROJECTS: projects, PI_PROMOTE_PATH: `${bin}:${process.env.PATH}` },
  });
  const web = readFileSync(join(la, "com.pi-web.web.plist"), "utf8");
  const log = (() => { try { return readFileSync(join(home, "launchctl.log"), "utf8"); } catch { return ""; } })();
  return { result, web, log, link: readlinkSync(join(projects, "pi-web.installed")), old, next };
}

test("switch-web restarts only the web service on the new build", () => {
  const { result, web, log, link, next } = scenario({ healthy: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(web, new RegExp(`${next}/dist/server/index.js`));
  assert.equal(link, next);
  assert.doesNotMatch(log, /sessiond/);
  assert.match(result.stdout, /roll back: .* switch-web 000000000000/);
});

test("switch-web restores the previous web service when the new one stays unhealthy", () => {
  const { result, web, link, old } = scenario({ healthy: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAILED; restoring/);
  assert.match(web, new RegExp(`${old}/dist/server/index.js`));
  assert.equal(link, old);
});

test("switch-web refuses when the session daemon's code changed", () => {
  const { result, log, link, old } = scenario({ healthy: true, daemonChanged: true });
  assert.equal(result.status, 5);
  assert.match(result.stderr, /dist\/server\/sessiond\.js[\s\S]*use switch/);
  assert.equal(log, "");
  assert.equal(link, old);
});
