#!/usr/bin/env node
// Owner-only grants for the write fence (extensions/background-bash/sandbox.mjs, ws-workbench-sandbox-20261124):
// a checkout or folder Thomas grants a Workstream becomes writable for every Chat started in its scratch folder.
// Run it unfenced (Terminal or a Run button): its files live in ~/.pi-workbench/sandbox, which no fence grants.
//   fence-grant.mjs <ws-id> <path>           grant
//   fence-grant.mjs --revoke <ws-id> <path>  revoke
//   fence-grant.mjs --list [<ws-id>]         show grants
//   fence-grant.mjs --backfill [--dry-run]   creation receipts for worktrees a Workstream owns (pi-owner.json) but has none
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { alreadyFenced, CREATOR, grantRefusal, grantsFile, linked, workstreamGrants, workstreamId } from "../extensions/background-bash/sandbox.mjs";

const real = (path) => { try { return realpathSync(path); } catch { return path; } };

function save(home, ws, paths) {
  const file = grantsFile(home, ws);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // Renamed into place: a reader never sees half a file.
  writeFileSync(`${file}.${process.pid}`, `${JSON.stringify({ workstream: ws, paths }, null, 1)}\n`, { mode: 0o600 });
  renameSync(`${file}.${process.pid}`, file);
}

function checked(ws) {
  if (workstreamId(ws) === undefined) throw new Error(`${ws} is not a Workstream ID (ws-…)`);
  return ws;
}

/** Grants the existing folder `path` (stored as its real path) to Workstream `ws`; returns that path. */
export function grant(home, ws, path) {
  checked(ws);
  let dir;
  try { dir = realpathSync.native(resolve(path)); } catch { throw new Error(`${path} does not exist`); }
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
  const refusal = grantRefusal(dir, home);
  if (refusal !== undefined) throw new Error(`refused: ${refusal}`);
  const paths = workstreamGrants(home, ws);
  if (!paths.includes(dir)) save(home, ws, [...paths, dir]);
  return dir;
}

/** Removes `path` (as given or as its real path) from Workstream `ws`'s grants; returns whether it was granted. */
export function revoke(home, ws, path) {
  checked(ws);
  const paths = workstreamGrants(home, ws);
  const gone = new Set([resolve(path), real(resolve(path))]);
  const kept = paths.filter((p) => !gone.has(p));
  if (kept.length !== paths.length) save(home, ws, kept);
  return kept.length !== paths.length;
}

/** `{ ws: paths }` for one Workstream or every one with grants. */
export function list(home, ws) {
  if (ws !== undefined) return { [checked(ws)]: workstreamGrants(home, ws) };
  let files = [];
  try { files = readdirSync(dirname(grantsFile(home, "ws-x"))); } catch { /* none yet */ }
  return Object.fromEntries(files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => workstreamId(id)).map((id) => [id, workstreamGrants(home, id)]));
}

const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } };

/**
 * Writes the creation receipt (host-ops.mjs `createWorktree`'s format) for each linked worktree under ~/IdeaProjects
 * whose cleanup record names a Workstream but which has none (made unfenced). Returns `{ worktree, receipt }` per
 * worktree; `dryRun` writes nothing.
 */
export function backfill(home, { dryRun = false } = {}) {
  const projects = join(real(home), "IdeaProjects");
  const done = [];
  let repos = [];
  try { repos = readdirSync(projects); } catch { return done; }
  for (const repo of repos) {
    const meta = join(projects, repo, ".git", "worktrees");
    let names = [];
    try { names = readdirSync(meta); } catch { continue; }
    for (const name of names) {
      const at = join(meta, name);
      const owner = readJson(join(at, "pi-owner.json"));
      const workstreams = [...new Set(Array.isArray(owner?.workstreams) ? owner.workstreams.filter((w) => workstreamId(w) !== undefined) : [])];
      if (workstreams.length === 0 || present(join(at, CREATOR))) continue;
      let dotGit = "";
      try { dotGit = readFileSync(join(at, "gitdir"), "utf8").trim(); } catch { continue; }
      if (!dotGit.endsWith(`${sep}.git`) || !linked(dotGit.slice(0, -5), at)) continue;
      const sessions = Array.isArray(owner.sessions) ? [...new Set(owner.sessions.filter((s) => typeof s === "string" && s !== ""))].sort() : [];
      const receipt = { createdAt: typeof owner.createdAt === "string" ? owner.createdAt : new Date().toISOString().replace(/\.\d+Z$/, "Z"), branch: typeof owner.branch === "string" ? owner.branch : name, sessions, workstreams };
      // wx: never replaces a receipt written meanwhile.
      if (!dryRun) writeFileSync(join(at, CREATOR), `${JSON.stringify(receipt, null, 1)}\n`, { flag: "wx" });
      done.push({ worktree: dotGit.slice(0, -5), receipt });
    }
  }
  return done;
}

const present = (path) => { try { lstatSync(path); return true; } catch { return false; } };

function main(argv) {
  const home = process.env.HOME ?? homedir();
  const [first, ...rest] = argv;
  if (first === "--list") { console.log(JSON.stringify(list(home, rest[0]), null, 1)); return; }
  // Its files are outside every fence: inside one the writes fail anyway, so say why first.
  if (alreadyFenced()) throw new Error("runs only outside the write fence: ask Thomas to run it (Terminal or a Run button)");
  if (first === "--backfill") {
    const dryRun = rest.includes("--dry-run");
    for (const { worktree, receipt } of backfill(home, { dryRun })) console.log(`${dryRun ? "would write" : "wrote"} ${CREATOR} for ${worktree}: workstreams ${receipt.workstreams.join(", ")}`);
    return;
  }
  if (first === "--revoke" && rest.length === 2) { console.log(revoke(home, rest[0], rest[1]) ? `revoked ${rest[1]} from ${rest[0]}` : `${rest[1]} was not granted to ${rest[0]}`); return; }
  if (argv.length === 2 && !first.startsWith("-")) { console.log(`granted ${grant(home, first, rest[0])} to ${first}`); return; }
  throw new Error("usage: fence-grant.mjs <ws-id> <path> | --revoke <ws-id> <path> | --list [<ws-id>] | --backfill [--dry-run]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`fence-grant: ${error.message}`); process.exit(2); }
}
