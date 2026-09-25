import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, symlinkSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./promote-installed", import.meta.url).pathname;
const sha = "abcdef1234567890";
const put = (path, data) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, data); };
const shim = (bin, name, body) => { const path = join(bin, name); put(path, `#!/bin/sh\n${body}\n`); spawnSync("chmod", ["+x", path]); };

function scenario(mode, bootstrapFails = false) {
  const root = mkdtempSync(join(tmpdir(), "promote-rollback-"));
  const home = join(root, "home"), projects = join(root, "projects"), bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const store = join(home, ".pi-workbench/installed");
  const plist = join(home, "Library/LaunchAgents");
  const files = [
    join(plist, "com.pi-web.web.plist"), join(plist, "com.pi-web.sessiond.plist"), join(plist, "com.pi-web.ui-dev.plist"),
    join(home, ".pi/agent/settings.json"), join(home, ".config/pi-web/config.json"),
  ];
  for (const [i, file] of files.entries()) put(file, i === 3
    ? JSON.stringify({ packages: [join(projects, "pi-workbench"), "/old/pi-web/dist/pi-packages/a"] }) + "\n"
    : i === 4 ? '{"port":1234,"extra":"original"}\n' : `original plist ${i}\n`);
  const saved = files.map(file => readFileSync(file));
  for (const name of ["pi-workbench", "pi-web"]) {
    mkdirSync(join(projects, name), { recursive: true });
    mkdirSync(join(store, `${name}-${sha.slice(0, 12)}`), { recursive: true });
    put(join(store, `${name}-${sha.slice(0, 12)}.prepared`), "");
    symlinkSync(`/previous/${name}`, join(projects, `${name}.installed`));
  }
  const plugin = join(home, ".pi-web/plugins/pi-workbench");
  mkdirSync(join(plugin, ".."), { recursive: true });
  symlinkSync("/previous/plugin", plugin);
  shim(bin, "git", `echo ${sha}`);
  shim(bin, "plutil", "exit 0");
  shim(bin, "launchctl", `echo "$*" >> "$HOME/launchctl.log"\nif [ "$1" = bootstrap ] && [ "${bootstrapFails ? "yes" : "no"}" = yes ]; then case "$3" in */job.plist) ;; *) exit 1;; esac; fi`);
  shim(bin, "curl", `n=$(cat "$HOME/curls" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$HOME/curls"\nif [ "${mode}" = unhealthy ] || { [ "${mode}" = health ] && [ "$n" -le 90 ]; }; then exit 1; fi\necho '{"plugins":[{"id":"pi-workbench","server":{"state":"active","restartRequired":false}}]}'`);
  shim(bin, "node", `if [ "$1" = -e ]; then exec "$REAL_NODE" "$@" 2>/dev/null; fi\nif [ "$*" = 'dist/cli.js install' ]; then exit ${mode === "install" ? 1 : 0}; fi\nexit 1`);
  shim(bin, "sleep", "exit 0");
  shim(bin, "lsof", "exit 0");
  shim(bin, "zsh", "node dist/cli.js install");
  const env = { ...process.env, HOME: home, PI_WORKBENCH_PROJECTS: projects, PI_PROMOTE_PATH: `${bin}:/usr/bin:/bin`, PI_PROMOTE_ZSH: join(bin, "zsh"), REAL_NODE: process.execPath };
  try {
    const schedule = spawnSync("bash", [script, "--force", "switch", "HEAD", "HEAD", "0"], { env, encoding: "utf8" });
    assert.equal(schedule.status, 0, schedule.stderr);
    const job = join(store, "jobs", readdirSync(join(store, "jobs"))[0], "job.sh");
    const result = spawnSync("bash", [job], { env, encoding: "utf8" });
    const log = readFileSync(join(job, "..", "job.log"), "utf8");
    assert.notEqual(result.status, 0, log);
    for (const [i, file] of files.entries()) assert.deepEqual(readFileSync(file), saved[i], file);
    for (const name of ["pi-workbench", "pi-web"]) assert.equal(readlinkSync(join(projects, `${name}.installed`)), `/previous/${name}`);
    assert.equal(readlinkSync(plugin), "/previous/plugin");
    return { result, log, launch: readFileSync(join(home, "launchctl.log"), "utf8") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("install failure restores all saved state and verifies old services", () => {
  const { result, log, launch } = scenario("install");
  assert.equal(result.status, 1);
  assert.match(log, /rollback done/);
  assert.match(launch, /bootstrap/);
});

test("health failure restores all saved state and verifies old services", () => {
  const { result, log } = scenario("health");
  assert.equal(result.status, 1, log);
  assert.match(log, /rollback done/);
});

test("failed old-service bootstrap reports rollback failure", () => {
  const { result, log } = scenario("install", true);
  assert.equal(result.status, 4);
  assert.match(log, /ROLLBACK FAILED:.*bootstrap/);
  assert.doesNotMatch(log, /rollback done/);
});

test("unhealthy old service reports rollback failure", () => {
  const { result, log } = scenario("unhealthy");
  assert.equal(result.status, 4);
  assert.match(log, /ROLLBACK FAILED:.*health/);
  assert.doesNotMatch(log, /rollback done/);
});
