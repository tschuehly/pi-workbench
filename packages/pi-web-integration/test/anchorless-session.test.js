import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicFakeWorkstreamClient, parseRecordedWorkstreams } from "../fake-workstream-client.js";
import { WorkstreamSessionCoordinator } from "../workstream-session-coordinator.js";

const fixtureUrl = new URL("../fixtures/anchorless-active-session.json", import.meta.url);
const unavailableMessage = "Session session-photoquest-anchorless is not available in the selected workspace.";

test("an anchorless active Workstream session reports the exact unavailable symptom and is eligible for repair", async () => {
  const recorded = parseRecordedWorkstreams(JSON.parse(await readFile(fixtureUrl, "utf8")));
  assert.notEqual(recorded, undefined);
  const client = new DeterministicFakeWorkstreamClient(recorded);
  const snapshot = await client.inspect("ws-anchorless-session");
  const session = snapshot.sessions[0];

  assert.deepEqual(
    { status: session.status, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId },
    { status: "active", machineId: undefined, projectId: undefined, workspaceId: undefined },
  );

  const host = {
    open: async () => { throw new Error(unavailableMessage); },
  };

  let failure;
  try {
    await new WorkstreamSessionCoordinator(client, host).resume(session);
  } catch (error) {
    failure = error;
  }

  assert.notEqual(failure, undefined, "expected the anchorless session to be unavailable");
  assert.deepEqual(
    {
      message: failure?.message,
      code: failure?.code,
      repairEligible: failure?.code === "SESSION_ANCHOR_MISSING",
    },
    {
      message: unavailableMessage,
      code: "SESSION_ANCHOR_MISSING",
      repairEligible: true,
    },
  );
});
