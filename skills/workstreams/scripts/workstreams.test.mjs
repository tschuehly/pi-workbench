import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("./workstreams.mjs", import.meta.url));
const skill = fileURLToPath(new URL("../SKILL.md", import.meta.url));
const scratch = process.env.PI_TMP ?? tmpdir();

// Runs the CLI against a throwaway store. `input` feeds stdin.
function run(directory, args, { env = {}, input, command = process.execPath, cwd } = {}) {
  const argv = command === process.execPath ? [cli, ...args] : args;
  const { PI_SESSION_ID: _ignored, ...base } = process.env;
  const result = spawnSync(command, argv, {
    encoding: "utf8",
    input,
    cwd,
    env: { ...base, PI_WORKBENCH_WORKSTREAM_DIR: directory, ...env },
  });
  return { ...result, out: result.stdout };
}

async function withStore(callback) {
  const directory = await mkdtemp(join(scratch, "workstreams-skill-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const session = { PI_SESSION_ID: "session-a" };

function seed(directory, id = "ws-a") {
  assert.equal(run(directory, ["create", id, "--title", "Example", "--group", "Pi Workbench", "--owner"]).status, 0);
  assert.equal(run(directory, ["associate", id], { env: session }).status, 0);
}

const checkpointArgs = ["--what", "Shipped it.", "--remains", "Nothing.", "--next", "Agent continues.", "--waiting", "agent"];

// 01a0811c, 01a04c4a, 01a0c379: `$SKILL_DIR` unset or a guessed checkout path gave
// "Cannot find module '/scripts/workstreams.mjs'". The CLI now runs as `workstreams` on PATH
// through a symlink from any cwd, and the skill no longer tells agents to build a script path.
test("runs as `workstreams` on PATH through a symlink from any directory", async () => {
  await withStore(async (directory) => {
    const bin = join(directory, "bin");
    await mkdir(bin);
    await symlink(cli, join(bin, "workstreams"));
    const result = run(directory, [], { command: "workstreams", cwd: directory, env: { PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.out, /^workstreams — .*workstreams\.mjs\n/);
    assert.match(result.out, /count: 0 open \(0 closed\)/);
    assert.match(result.out, /^help: /m);
  });
});

test("SKILL.md calls the PATH executable, not a script path", async () => {
  const text = await readFile(skill, "utf8");
  assert.doesNotMatch(text, /SKILL_DIR|scripts\/workstreams\.mjs/);
  assert.match(text, /`workstreams/);
  assert.ok(text.split("\n").length <= 95, "SKILL.md stays near 80 lines");
});

// 01a0c5a2: `create --help` failed with CLI_ERROR and the agent read index.d.ts for shapes.
// 01a0c7e2: `append --help` failed with "Input is not valid JSON".
test("every command has --help with flags and examples", () => {
  for (const command of ["list", "show", "create", "associate", "checkpoint", "overview", "link", "unlink", "title", "group", "resolve-task", "close", "append", "watch"]) {
    const result = run(scratch, [command, "--help"]);
    assert.equal(result.status, 0, `${command}: ${result.stdout}`);
    assert.match(result.out, new RegExp(`^workstreams ${command}`), command);
    assert.match(result.out, /Examples:/, command);
  }
  assert.match(run(scratch, ["append", "--help"]).out, /index\.d\.ts/);
});

// 01a0f24d: `append @-` gave ENOENT; bare `append` said only "append requires a JSON object".
test("append reads stdin from -, @-, or --stdin, and bare append says how", async () => {
  await withStore(async (directory) => {
    seed(directory);
    const request = (title) => JSON.stringify({ workstreamId: "ws-a", records: [{ type: "title.set", payload: { title } }] });
    for (const [form, title] of [["-", "One"], ["@-", "Two"], ["--stdin", "Three"]]) {
      const result = run(directory, ["append", form], { input: request(title) });
      assert.equal(result.status, 0, `${form}: ${result.stdout}`);
    }
    assert.match(run(directory, ["show", "ws-a"]).out, /^ws-a \| Three \|/);
    const bare = run(directory, ["append"]);
    assert.equal(bare.status, 2);
    assert.match(bare.out, /^error: append needs <request>\nhelp: workstreams append/);
  });
});

// 01a0e8d1: a hand-written checkpoint lacked payload.sessionId. The checkpoint verb fills it;
// a raw append still missing it gets one error pointing at the verb.
test("checkpoint fills the session envelope; raw append points to the verb", async () => {
  await withStore(async (directory) => {
    seed(directory);
    const written = run(directory, ["checkpoint", "ws-a", ...checkpointArgs], { env: session });
    assert.equal(written.status, 0, written.stdout);
    assert.match(written.out, /^ok: checkpoint cp-[0-9a-f]+ written to ws-a \(rev 4\)/);
    const snapshot = JSON.parse(run(directory, ["show", "ws-a", "--json"]).out);
    assert.equal(snapshot.sessions[0].latestCheckpoint.waitingOn, "agent");

    const raw = run(directory, ["append", "-"], {
      env: session,
      input: JSON.stringify({ workstreamId: "ws-a", records: [{ type: "checkpoint.replaced", payload: { checkpoint: { id: "c", whatChanged: "a", remains: "b", next: "c" } } }] }),
    });
    assert.equal(raw.status, 1);
    assert.match(raw.out, /payload\.sessionId/);
    assert.match(raw.out, /^help: use the verb instead: workstreams checkpoint --help$/m);

    const unassociated = run(directory, ["checkpoint", "ws-a", ...checkpointArgs], { env: { PI_SESSION_ID: "session-b" } });
    assert.equal(unassociated.status, 2);
    assert.match(unassociated.out, /help: workstreams associate ws-a/);
  });
});

// 01a05c21: inline JSON with quotes broke ("Unterminated string"), so the agent used /tmp files.
test("plain flags and --stdin carry quotes and newlines; bad JSON names the fix", async () => {
  await withStore(async (directory) => {
    seed(directory);
    const tricky = `It's "quoted" — and\nmultiline with $HOME and \`ticks\``;
    assert.equal(run(directory, ["checkpoint", "ws-a", ...checkpointArgs.slice(0, 6), "--waiting", "owner", "--what", tricky], { env: session }).status, 0);
    let latest = JSON.parse(run(directory, ["show", "ws-a", "--json"]).out).sessions[0].latestCheckpoint;
    assert.equal(latest.whatChanged, tricky);

    const viaStdin = run(directory, ["checkpoint", "ws-a", "--stdin"], { env: session, input: JSON.stringify({ what: tricky, remains: "r", next: "n", waiting: "agent", ref: ["/Users/x/repo"] }) });
    assert.equal(viaStdin.status, 0, viaStdin.stdout);
    latest = JSON.parse(run(directory, ["show", "ws-a", "--json"]).out).sessions[0].latestCheckpoint;
    assert.deepEqual(latest.references, ["/Users/x/repo"]);

    const broken = run(directory, ["append", '{"workstreamId":"ws-a","records":[{"payload":"unterminated}]}']);
    assert.equal(broken.status, 2);
    assert.match(broken.out, /^error: append input is not a JSON object\nhelp: prefer a verb/);

    const temporary = run(directory, ["checkpoint", "ws-a", ...checkpointArgs, "--ref", "/tmp/notes.json"], { env: session });
    assert.equal(temporary.status, 2);
    assert.match(temporary.out, /temporary directory\nhelp: reference a durable path/);
  });
});

// 01a0f6eb: Python over `list` crashed on a null `next`. Text output prints "-" for none.
test("list prints one compact row per Workstream and '-' for missing values", async () => {
  await withStore(async (directory) => {
    seed(directory, "ws-a");
    assert.equal(run(directory, ["create", "ws-b", "--title", "No checkpoint yet"]).status, 0);
    assert.equal(run(directory, ["checkpoint", "ws-a", ...checkpointArgs], { env: session }).status, 0);
    const listed = run(directory, ["list"]);
    assert.equal(listed.status, 0);
    assert.match(listed.out, /^count: 2 open \(0 closed\)\nid \| title \| group \| waitingOn \| updatedAt\n/);
    assert.match(listed.out, /^ws-b \| No checkpoint yet \| - \| - \| \d{4}-\d\d-\d\d$/m);
    assert.match(run(directory, ["list", "--fields", "id,next"]).out, /^ws-b \| -$/m);
    assert.equal(JSON.parse(run(directory, ["list", "--json"]).out).find(({ id }) => id === "ws-b").next, null);
  });
});

// 01a0f6eb, 01a0ec7c: agents guessed `checkpoint`/`sessionId` keys in an 85 KB inspect dump.
// `show` names every column and stays small however many sessions a Workstream has.
test("show is compact, labeled, and bounded; --full has the complete text", async () => {
  await withStore(async (directory) => {
    seed(directory);
    const long = "x".repeat(3000);
    for (let index = 0; index < 12; index += 1) {
      const env = { PI_SESSION_ID: `session-${index}` };
      assert.equal(run(directory, ["associate", "ws-a"], { env }).status, 0);
      assert.equal(run(directory, ["checkpoint", "ws-a", ...checkpointArgs.slice(0, 2), "--remains", long, "--next", `Step ${index} ${long}`, "--waiting", "owner"], { env }).status, 0);
    }
    const shown = run(directory, ["show", "ws-a"]);
    assert.equal(shown.status, 0);
    assert.ok(shown.out.length < 1500, `show is ${shown.out.length} bytes`);
    assert.match(shown.out, /^sessions: 13 \(3 newest; --full for all\)$/m);
    assert.match(shown.out, /^ {2}session-11 \| - \| active \| owner \| Step 11 x+…$/m);
    assert.ok(run(directory, ["show", "ws-a", "--full"]).out.includes(long));
    const missing = run(directory, ["show", "ws-missing"]);
    assert.equal(missing.status, 1);
    assert.match(missing.out, /^error: WORKSTREAM_NOT_FOUND: .*\nhelp: workstreams list/);
  });
});

// 01a0bda0: the agent ran jq against a guessed raw-store shape and then read the 61k-line file.
// `list --fields` answers without the store layout, and a wrong field lists the valid ones.
test("list --fields selects columns and rejects unknown ones with the valid list", async () => {
  await withStore(async (directory) => {
    seed(directory);
    assert.match(run(directory, ["list", "--fields", "id,group,revision"]).out, /^ws-a \| Pi Workbench \| 3$/m);
    const wrong = run(directory, ["list", "--fields", "id,latestCheckpoint"]);
    assert.equal(wrong.status, 2);
    assert.match(wrong.out, /^error: unknown field latestCheckpoint\nhelp: valid --fields: id,title,group,/);
  });
});

// 01a0ec7c: the agent pulled `sessionId` out of inspect output to associate and got KeyError.
// associate reads PI_SESSION_ID, repeats as a no-op, and names a conflicting Workstream.
test("associate needs no session lookup, is idempotent, and names conflicts", async () => {
  await withStore(async (directory) => {
    seed(directory, "ws-a");
    const again = run(directory, ["associate", "ws-a"], { env: session });
    assert.equal(again.status, 0);
    assert.match(again.out, /^\(no-op\) session session-a is already active in ws-a/);
    assert.equal(run(directory, ["create", "ws-b", "--title", "Other"]).status, 0);
    const conflict = run(directory, ["associate", "ws-b"], { env: session });
    assert.equal(conflict.status, 2);
    assert.match(conflict.out, /already belongs to ws-a.*\nhelp: workstreams show ws-a/);
    assert.match(run(directory, [], { env: session }).out, /^this session: ws-a \|/m);
  });
});

test("writes reject unknown flags and over-long fields before writing", async () => {
  await withStore(async (directory) => {
    seed(directory);
    const unknown = run(directory, ["link", "ws-a", "--kind", "repository", "--target", "x"]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.out, /^error: unknown flag --target for link\nhelp: valid flags: --kind --ref --label/);
    const long = run(directory, ["overview", "ws-a", "--expect", "3", "--goal", "g".repeat(300), "--done-when", "d", "--description", "d", "--history", "h"]);
    assert.equal(long.status, 2);
    assert.match(long.out, /--goal is 300\/280 chars/);
    assert.equal(JSON.parse(run(directory, ["show", "ws-a", "--json"]).out).revision, 3);
    assert.match(run(directory, ["inspect", '{"workstreamId":"ws-a"}']).out, /help: workstreams show ws-a/);
  });
});

test("repeated writes are no-ops; overview and close need the reviewed revision", async () => {
  await withStore(async (directory) => {
    seed(directory);
    assert.equal(run(directory, ["checkpoint", "ws-a", ...checkpointArgs], { env: session }).status, 0);
    assert.match(run(directory, ["checkpoint", "ws-a", ...checkpointArgs], { env: session }).out, /^\(no-op\)/);
    assert.match(run(directory, ["link", "ws-a", "--kind", "repository", "--ref", "github.com/a/b@abc"]).out, /^ok: link repository-/);
    assert.match(run(directory, ["link", "ws-a", "--kind", "repository", "--ref", "github.com/a/b@abc"]).out, /^\(no-op\)/);
    assert.match(run(directory, ["title", "ws-a", "Example"]).out, /^\(no-op\)/);
    assert.match(run(directory, ["create", "ws-a", "--title", "Example"]).out, /^\(no-op\)/);

    const overview = ["overview", "ws-a", "--goal", "g", "--done-when", "d", "--description", "s", "--history", "2026-10-01: started"];
    const missing = run(directory, overview);
    assert.equal(missing.status, 2);
    assert.match(missing.out, /needs --expect <revision> \(ws-a is at rev 5\)\nhelp: .*--expect 5/);
    const stale = run(directory, [...overview, "--expect", "3"]);
    assert.equal(stale.status, 1);
    assert.match(stale.out, /STALE_REVISION: ws-a is at rev 5, not rev 3[\s\S]*newest checkpoint .*Agent continues[\s\S]*help: .*--expect 5/);
    assert.equal(run(directory, [...overview, "--expect", "5"]).status, 0);
    assert.match(run(directory, [...overview, "--expect", "6"]).out, /^\(no-op\)/);

    assert.equal(run(directory, ["close", "ws-a", "--expect", "6"]).status, 0);
    assert.equal(JSON.parse(run(directory, ["show", "ws-a", "--json"]).out).closed, true);
    assert.match(run(directory, ["list"]).out, /count: 0 open \(1 closed\)/);
  });
});
