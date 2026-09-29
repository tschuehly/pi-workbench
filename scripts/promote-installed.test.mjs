import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./promote-installed", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "promote-guard-"));
const run = (psLines, ...args) => {
  const ps = join(dir, "ps.txt");
  writeFileSync(ps, psLines.join("\n") + "\n");
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: dir, PI_WORKBENCH_PROJECTS: dir, PI_PROMOTE_PS: `cat ${ps}` },
  });
};
const child = "4242 50696 node /opt/pi/dist/cli.js --mode rpc --provider openai-codex --model gpt-6-luna --tools read";
// A terminal `pi` (parent: a shell) survives the restart; only the daemon's children die.
const quiet = ["1 0 /sbin/launchd", "50696 1 node /x/dist/server/sessiond.js", "900 1 -zsh", "39353 900 pi", "7 900 awk / --mode[ ]rpc( |$)/"];

test("check-idle passes when no child Pi process runs", () => {
  assert.equal(run(quiet, "check-idle").status, 0);
});

test("check-idle lists a running subagent and exits 3", () => {
  const result = run([...quiet, child], "check-idle");
  assert.equal(result.status, 3);
  assert.match(result.stderr, /4242 .*--mode rpc/);
});

test("check-idle sees a retitled `pi` child of the session daemon", () => {
  const result = run([...quiet, "3087 50696 pi             "], "check-idle");
  assert.equal(result.status, 3);
  assert.match(result.stderr, /3087 50696 pi/);
});

test("check-idle lists a session's command but not the phone helper or a surviving background bash runner", () => {
  const job = "5100 50696 /bin/bash -c ./scripts/ci/gate.sh";
  const runner = "5400 50696 /opt/homebrew/bin/node /x/extensions/background-bash/runner.mjs /Users/me/.pi-workbench/background-bash/jobs/abc";
  const result = run([...quiet, "5200 50696 npm exec ping-a-human", "5300 50696 <defunct>", runner, job], "check-idle");
  assert.equal(result.status, 3);
  assert.match(result.stderr, /5100 50696 .*gate\.sh/);
  assert.doesNotMatch(result.stderr, /ping-a-human|defunct|runner\.mjs/);
  assert.equal(run([...quiet, "5200 50696 npm exec ping-a-human", runner], "check-idle").status, 0);
});

test("switch refuses before preparing or scheduling anything", () => {
  const result = run([...quiet, child], "switch", "HEAD", "HEAD", "5");
  assert.equal(result.status, 3);
  assert.match(result.stderr, /refusing/);
  assert.equal(existsSync(join(dir, ".pi-workbench", "installed")), false);
});

test("--force skips the idle check", () => {
  // Proceeds past the guard and fails later, at preparing a missing repository.
  const result = run([...quiet, child], "--force", "switch", "HEAD", "HEAD", "5");
  assert.doesNotMatch(result.stderr, /refusing/);
  assert.match(result.stderr, /prepare pi-workbench failed/);
});

test("sessiond-unchanged follows the daemon's imports and the lock, ignoring web-only files", () => {
  const build = (shared, web, lock) => {
    const root = mkdtempSync(join(tmpdir(), "promote-build-"));
    mkdirSync(join(root, "dist/server"), { recursive: true });
    mkdirSync(join(root, "dist/shared"), { recursive: true });
    writeFileSync(join(root, "dist/server/sessiond.js"), 'import { a } from "./a.js";\nawait import("../shared/b.js");\n');
    writeFileSync(join(root, "dist/server/a.js"), 'export * from "../shared/c.js";\n');
    writeFileSync(join(root, "dist/shared/b.js"), shared);
    writeFileSync(join(root, "dist/shared/c.js"), "export const a = 1;\n");
    writeFileSync(join(root, "dist/server/index.js"), web);
    writeFileSync(join(root, "package-lock.json"), lock);
    return root;
  };
  const base = build("b", "web", "lock");
  assert.equal(run(quiet, "sessiond-unchanged", base, build("b", "web changed", "lock")).status, 0);
  const shared = run(quiet, "sessiond-unchanged", base, build("b changed", "web", "lock"));
  assert.equal(shared.status, 1);
  assert.match(shared.stderr, /dist\/shared\/b\.js/);
  assert.equal(run(quiet, "sessiond-unchanged", base, build("b", "web", "lock changed")).status, 1);
});

test("check-settings refuses Pi Workbench or PI WEB packages outside the installed store", () => {
  const store = join(dir, ".pi-workbench/installed/pi-workbench-0123456789ab");
  mkdirSync(store, { recursive: true });
  mkdirSync(join(dir, "pi-workbench"), { recursive: true });
  symlinkSync(store, join(dir, "pi-workbench.installed"));
  const settings = (...packages) => { const f = join(dir, "settings.json"); writeFileSync(f, JSON.stringify({ packages })); return f; };
  assert.equal(run(quiet, "check-settings", settings("npm:pi-web-access", join(dir, "pi-workbench.installed"))).status, 0);
  const dev = run(quiet, "check-settings", settings(join(dir, "pi-workbench.installed"), { source: join(dir, "pi-workbench") }));
  assert.equal(dev.status, 6);
  assert.match(dev.stderr, /not an installed checkout: .*\/pi-workbench ->/);
});
