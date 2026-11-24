import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  assert.equal(run([], "sessiond-unchanged", base, build("b", "web changed", "lock")).status, 0);
  const shared = run([], "sessiond-unchanged", base, build("b changed", "web", "lock"));
  assert.equal(shared.status, 1);
  assert.match(shared.stderr, /dist\/shared\/b\.js/);
  assert.equal(run([], "sessiond-unchanged", base, build("b", "web", "lock changed")).status, 1);
});
