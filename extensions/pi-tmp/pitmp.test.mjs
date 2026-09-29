import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { piTmpDir, projectKey, sweep } from "./pitmp.mjs";

const at = (iso) => new Date(`${iso}T12:00:00`);

test("worktrees share their repository's key; plain folders use their name", () => {
  assert.equal(projectKey(process.cwd()), "pi-workbench");
  const plain = mkdtempSync(join(tmpdir(), "pi-tmp-plain-"));
  assert.match(projectKey(plain), /^pi-tmp-plain-/);
});

test("a session folder survives until its project has 7 active days after its last use", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tmp-root-"));
  const dir = piTmpDir(process.cwd(), "s1", root);
  assert.equal(dir, join(root, "pi-workbench", "s1"));
  writeFileSync(join(dir, "note.txt"), "x");
  utimesSync(dir, at("2026-01-01"), at("2026-01-01"));
  const days = join(root, "pi-workbench", ".days");
  for (const d of ["2026-01-01", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10"]) writeFileSync(join(days, d), "");
  rmSync(join(days, new Date().toLocaleDateString("sv"))); // keep the fixture calendar deterministic
  assert.deepEqual(sweep(root), [], "six active days after last use keep the folder");
  writeFileSync(join(days, "2026-01-11"), "");
  assert.deepEqual(sweep(root), [dir], "the seventh active day removes it");
  assert.equal(existsSync(join(days, "2026-01-01")), false, "day markers older than the window are pruned");
  mkdirSync(join(root, "idle"), { recursive: true });
  assert.deepEqual(sweep(root), [], "a project with no recorded days is untouched");
});

