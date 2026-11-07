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
  const active = 36500; // the fixture's January days are long past: never count the project as idle here
  assert.deepEqual(sweep(root, 7, active), [], "six active days after last use keep the folder");
  writeFileSync(join(days, "2026-01-11"), "");
  assert.deepEqual(sweep(root, 7, active), [dir], "the seventh active day removes it");
  assert.equal(existsSync(join(days, "2026-01-01")), false, "day markers older than the window are pruned");
  mkdirSync(join(root, "idle"), { recursive: true });
  assert.deepEqual(sweep(root), [], "a project with no recorded days is untouched");
});


test("in a project idle for 21 days, folders unused that long go unless their session is live or a Workstream names them", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tmp-idle-"));
  const sessions = mkdtempSync(join(tmpdir(), "pi-tmp-sessions-"));
  const store = join(mkdtempSync(join(tmpdir(), "pi-tmp-store-")), "workstreams.json");
  const ago = (days) => new Date(Date.now() - days * 864e5);
  const folder = (project, name, days) => {
    const dir = join(root, project, name);
    mkdirSync(dir, { recursive: true });
    utimesSync(dir, ago(days), ago(days));
    return dir;
  };
  const mark = (project, days) => { mkdirSync(join(root, project, ".days"), { recursive: true }); writeFileSync(join(root, project, ".days", ago(days).toLocaleDateString("sv")), ""); };
  const live = "01a00000-0000-7000-8000-000000000001";
  mark("idle", 30);
  const old = folder("idle", "01a00000-0000-7000-8000-000000000002", 30);
  const open = folder("idle", live, 30);
  const named = folder("idle", "01a00000-0000-7000-8000-000000000003", 30);
  const fresh = folder("idle", "01a00000-0000-7000-8000-000000000004", 5);
  mkdirSync(join(sessions, "--cwd--"));
  writeFileSync(join(sessions, "--cwd--", `2026-01-01T00-00-00-000Z_${live}.jsonl`), "{}\n"); // written now: the session is live
  writeFileSync(store, JSON.stringify({ ref: `${named}/report.md` }));
  mark("busy", 1);
  const busy = folder("busy", "01a00000-0000-7000-8000-000000000005", 30);
  mkdirSync(join(root, "plain", "x"), { recursive: true });
  utimesSync(join(root, "plain", "x"), ago(90), ago(90));
  assert.deepEqual(sweep(root, 7, 21, { sessions, store }), [old]);
  for (const dir of [open, named, fresh, busy, join(root, "plain", "x")]) assert.equal(existsSync(dir), true, dir);
});
