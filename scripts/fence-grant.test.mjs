// Owner grant CLI on a fake home only (runs inside a fence too: nothing here is written under the real ~/.pi-workbench).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ownedWorktrees } from "../extensions/background-bash/sandbox.mjs";
import { backfill, grant, list, revoke } from "./fence-grant.mjs";

const base = process.env.PI_TMP ?? join(homedir(), ".pi-workbench", "tmp");
mkdirSync(base, { recursive: true });
const home = realpathSync(mkdtempSync(join(base, "fence-grant-test-")));
after(() => rmSync(home, { recursive: true, force: true }));
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null" } });

test("grant, list and revoke keep one real path per folder in the Workstream's grant file", () => {
  const app = join(home, "IdeaProjects", "app");
  mkdirSync(app, { recursive: true });
  assert.equal(grant(home, "ws-a", `${app}/../app`), app);
  grant(home, "ws-a", app);
  assert.deepEqual(list(home), { "ws-a": [app] });
  assert.match(readFileSync(join(home, ".pi-workbench", "sandbox", "grants", "ws-a.json"), "utf8"), /"workstream": "ws-a"/);
  assert.equal(revoke(home, "ws-a", app), true);
  assert.equal(revoke(home, "ws-a", app), false);
  assert.deepEqual(list(home, "ws-a"), { "ws-a": [] });
  assert.throws(() => grant(home, "ws-a", join(home, "missing")), /does not exist/);
});

test("backfill: a dry run writes nothing; then each worktree a Workstream owns gets a creation receipt, never replacing one", () => {
  const main = join(home, "IdeaProjects", "lib");
  mkdirSync(main, { recursive: true });
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  const meta = join(main, ".git", "worktrees");
  const tree = (name, owner, creator) => {
    const path = join(home, "IdeaProjects", `lib.${name}`);
    git(main, "worktree", "add", "-q", "-b", name, path);
    if (owner) writeFileSync(join(meta, `lib.${name}`, "pi-owner.json"), JSON.stringify(owner));
    if (creator) writeFileSync(join(meta, `lib.${name}`, "pi-creator.json"), JSON.stringify(creator));
    return realpathSync(path);
  };
  const owned = tree("owned", { createdAt: "2026-11-20T10:00:00Z", branch: "owned", sessions: ["s1"], workstreams: ["ws-a", "../bad"] });
  tree("chat-only", { sessions: ["s2"], workstreams: [] });
  tree("has-receipt", { workstreams: ["ws-a"] }, { sessions: ["s3"], workstreams: [] });
  tree("no-owner");
  const planned = backfill(home, { dryRun: true });
  assert.deepEqual(planned.map((p) => p.worktree), [owned]);
  assert.equal(existsSync(join(meta, "lib.owned", "pi-creator.json")), false, "a dry run writes nothing");
  assert.deepEqual(ownedWorktrees(home, ["ws-a"]), [], "no receipt, no grant");
  assert.deepEqual(backfill(home), planned);
  assert.deepEqual(JSON.parse(readFileSync(join(meta, "lib.owned", "pi-creator.json"), "utf8")), { createdAt: "2026-11-20T10:00:00Z", branch: "owned", sessions: ["s1"], workstreams: ["ws-a"] });
  assert.deepEqual(JSON.parse(readFileSync(join(meta, "lib.has-receipt", "pi-creator.json"), "utf8")).sessions, ["s3"], "an existing receipt stays");
  assert.deepEqual(ownedWorktrees(home, ["ws-a"]), [owned]);
  assert.deepEqual(backfill(home), [], "a second run finds nothing");
});
