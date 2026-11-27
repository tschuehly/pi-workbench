import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { isolatedRoot, isolationVariables, missingIsolation } from "./fixtures/lock-owner-child.mjs";

const exec = promisify(execFile);
const absent = missingIsolation();
const options = { timeout: 10_000, skip: absent.length ? `missing isolation: ${absent.join(", ")}` : false };
const root = absent.length ? undefined : await isolatedRoot();

async function withEnvironment(overrides, callback) {
  const saved = { ...process.env };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (Object.hasOwn(saved, key)) process.env[key] = saved[key];
      else delete process.env[key];
    }
  }
}

test("isolation guard accepts disposable HOME and refuses every absent/empty variable", options, async () => {
  assert.equal(await isolatedRoot(), root);
  for (const key of isolationVariables) {
    await withEnvironment({ [key]: undefined }, async () => {
      assert.deepEqual(missingIsolation(), [key]);
      await assert.rejects(isolatedRoot(), /required/);
    });
    await withEnvironment({ [key]: "" }, async () => {
      assert.deepEqual(missingIsolation(), []);
      await assert.rejects(isolatedRoot(), /must not be empty/);
    });
  }
});

test("isolation guard rejects canonical root, TMPDIR and HOME escapes", options, async (t) => {
  const directory = await mkdtemp(join(root, "isolation-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const escape = join(directory, "escape");
  await symlink(process.env.PI_TMP, escape, "dir");
  for (const overrides of [
    { PI_WORKBENCH_WORKSTREAM_DIR: process.env.PI_TMP },
    { PI_WORKBENCH_WORKSTREAM_DIR: escape },
    { TMPDIR: escape },
    { HOME: escape },
    { HOME: root },
    { HOME: join(directory, "missing") },
  ]) await withEnvironment(overrides, () => assert.rejects(isolatedRoot()));
});

test("recovery discovery skips only absent isolation; present-invalid fails without a skip", options, async () => {
  const file = new URL("./lock-recovery.test.js", import.meta.url).pathname;
  for (const key of isolationVariables) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // This is an independent runner, not an IPC test-runner child.
    delete env[key];
    const { stdout } = await exec(process.execPath, ["--test", "--test-reporter=tap", file], { env });
    assert.match(stdout, /# tests 3\b/);
    assert.match(stdout, /# pass 0\b/);
    assert.match(stdout, /# skipped 3\b/);
    assert.match(stdout, /# todo 0\b/);
    env[key] = "";
    await assert.rejects(exec(process.execPath, ["--test", "--test-reporter=tap", file], { env }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /# skipped 0\b/);
      assert.match(error.stdout, /# fail 1\b/);
      return true;
    });
  }
});

test("frozen legacy adapter is byte-faithful after only header/import normalization", options, async () => {
  const revision = "a3dfbb9bb791ae9895ce33938c8d9d988808802b";
  const hash = "16bf7047380914f209db890f5984b02de1dff5833a48f64b8a54b84eb40d1027";
  const snapshot = await readFile(new URL("./fixtures/legacy-adapters.js", import.meta.url), "utf8");
  const header = `// Frozen test-only baseline: ${revision}\n// Original adapters.js SHA256: ${hash}\n`;
  assert.ok(snapshot.startsWith(header));
  const normalized = snapshot.slice(header.length)
    .replace('from "../../src/model.js"', 'from "./model.js"')
    .replace('from "../../src/errors.js"', 'from "./errors.js"');
  assert.equal(createHash("sha256").update(normalized).digest("hex"), hash);
  const { stdout } = await exec("git", ["show", `${revision}:packages/workstream-store/src/adapters.js`], {
    cwd: new URL("../../../", import.meta.url),
  });
  assert.equal(normalized, stdout);
});
