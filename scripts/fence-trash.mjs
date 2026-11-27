#!/usr/bin/env node
// The trash fenced `wt remove` moves worktrees to (extensions/background-bash/host-ops.mjs): ~/.pi-workbench/trash/<id>/
// holds `tree` (the worktree), `gitdir` (its folder in <repo>/.git/worktrees) and restore.json. Run it unfenced only.
//   fence-trash.mjs --list                      what is in the trash
//   fence-trash.mjs --restore <id>              move one worktree back where it was
//   fence-trash.mjs --empty-older-than <N>d     delete entries moved more than N days ago
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { alreadyFenced } from "../extensions/background-bash/sandbox.mjs";

const trash = (home) => join(home, ".pi-workbench", "trash");
const entry = (home, id) => {
  if (!/^[\w.-]+$/.test(id) || id.startsWith(".")) throw new Error(`${id} is no trash entry`);
  return JSON.parse(readFileSync(join(trash(home), id, "restore.json"), "utf8"));
};
const exists = (p) => { try { lstatSync(p); return true; } catch { return false; } };

/** Every folder in the trash: its restore record, or `{ id, unknown: true }` when it has no readable one. */
export function list(home) {
  let ids = [];
  try { ids = readdirSync(trash(home)); } catch { /* empty */ }
  return ids.map((id) => { try { return { ...entry(home, id), id }; } catch { return { id, unknown: true }; } });
}

/** Moves entry `id`'s worktree and git folder back and lets git repair their links; returns the worktree path. */
export function restore(home, id) {
  const r = entry(home, id);
  const dir = join(trash(home), id);
  for (const p of [r.tree, r.gitDir]) if (exists(p)) throw new Error(`${p} exists; move it away first`);
  renameSync(join(dir, "gitdir"), r.gitDir);
  renameSync(join(dir, "tree"), r.tree);
  execFileSync("git", ["-C", r.main, "worktree", "repair", r.tree], { stdio: "inherit" });
  rmSync(dir, { recursive: true });
  return r.tree;
}

/** Deletes entries moved more than `days` days ago; returns their IDs. */
export function empty(home, days, now = Date.now()) {
  const old = list(home).filter((r) => !r.unknown && now - Date.parse(r.movedAt) > days * 86_400_000);
  for (const r of old) rmSync(join(trash(home), r.id), { recursive: true, force: true });
  return old.map((r) => r.id);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [flag, value] = process.argv.slice(2);
  try {
    // Inside the fence the trash is unwritable anyway; refusing says why.
    if (alreadyFenced()) throw new Error("run it unfenced (Terminal or a Run button)");
    const home = homedir();
    if (flag === "--list") for (const r of list(home)) console.log(r.unknown ? `${r.id}\t(unknown: no readable restore.json; not restorable or emptied by this script)` : `${r.id}\t${r.movedAt}\t${r.tree}\t${r.branch ?? "(detached)"}`);
    else if (flag === "--restore" && value !== undefined) console.log(`restored ${restore(home, value)}`);
    else if (flag === "--empty-older-than" && /^\d+d$/.test(value ?? "")) console.log(`deleted ${empty(home, Number.parseInt(value, 10)).join(", ") || "nothing"}`);
    else throw new Error("usage: fence-trash.mjs --list | --restore <id> | --empty-older-than <N>d");
  } catch (error) { console.error(`fence-trash: ${error.message}`); process.exit(1); }
}
