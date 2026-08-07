import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = new URL("./workstreams.mjs", import.meta.url);

function run(directory, operation, input) {
  const result = spawnSync(process.execPath, [cli.pathname, operation, JSON.stringify(input)], {
    encoding: "utf8",
    env: { ...process.env, PI_WORKBENCH_WORKSTREAM_DIR: directory },
  });
  return {
    ...result,
    stdoutValue: result.stdout ? JSON.parse(result.stdout) : undefined,
    stderrValue: result.stderr ? JSON.parse(result.stderr) : undefined,
  };
}

test("operates on the configured user-local Workstream Store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workstreams-skill-"));
  try {
    const created = run(directory, "create", {
      workstreamId: "ws-cli",
      idempotencyKey: "create-cli",
      title: "CLI test",
      producer: "owner",
    });
    assert.equal(created.status, 0);
    assert.equal(created.stdoutValue.acceptedRevision, 1);

    const appended = run(directory, "append", {
      workstreamId: "ws-cli",
      expectedRevision: 1,
      idempotencyKey: "associate-cli",
      records: [
        { type: "session.pending", producer: "session", sourceSessionId: "session-cli", payload: { sessionId: "session-cli", associationKey: "manual-session-cli" } },
        { type: "session.confirmed", producer: "session", sourceSessionId: "session-cli", payload: { sessionId: "session-cli", associationKey: "manual-session-cli" } },
      ],
    });
    assert.equal(appended.status, 0);
    assert.equal(appended.stdoutValue.acceptedRevision, 2);

    const inspected = run(directory, "inspect", { workstreamId: "ws-cli" });
    assert.equal(inspected.status, 0);
    assert.equal(inspected.stdoutValue.sessions[0].id, "session-cli");
    assert.equal(inspected.stdoutValue.sessions[0].status, "active");

    const listed = run(directory, "list", {});
    assert.equal(listed.status, 0);
    assert.deepEqual(listed.stdoutValue.map(({ id }) => id), ["ws-cli"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("returns structured store errors without modifying requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workstreams-skill-"));
  try {
    const missing = run(directory, "inspect", { workstreamId: "missing" });
    assert.equal(missing.status, 1);
    assert.equal(missing.stderrValue.error.code, "WORKSTREAM_NOT_FOUND");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
