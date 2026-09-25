import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
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
const child = "4242 node /opt/pi/dist/cli.js --mode rpc --provider openai-codex --model gpt-6-luna --tools read";
const quiet = ["1 /sbin/launchd", "50696 node /x/dist/server/sessiond.js", "39353 pi", "7 awk / --mode[ ]rpc( |$)/"];

test("check-idle passes when no child Pi process runs", () => {
  assert.equal(run(quiet, "check-idle").status, 0);
});

test("check-idle lists a running subagent and exits 3", () => {
  const result = run([...quiet, child], "check-idle");
  assert.equal(result.status, 3);
  assert.match(result.stderr, /4242 .*--mode rpc/);
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
