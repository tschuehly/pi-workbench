import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicFakeWorkstreamClient, parseRecordedWorkstreams } from "../fake-workstream-client.js";
import { WorkstreamSessionCoordinator } from "../workstream-session-coordinator.js";
import { sessionAnchorRepairOffer, sessionAnchorRepairPresentation } from "../pi-web-plugin.js";

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

const machine = { id: "studio", name: "Studio" };
const location = { machineId: "studio", projectId: "photoquest", workspaceId: "main" };
const evidence = { evidenceId: "catalog-session-1", matchedCwd: "/PhotoQuest", scannedScopeCount: 3, verifiedAt: "2026-08-01T09:00:01.000Z" };

function activeSession(overrides = {}) {
  return { id: "session-1", status: "active", latestCheckpoint: null, checkpointFailure: null, checkpointStaleness: null, launchFailure: null, ...overrides };
}

function snapshot(session = activeSession(), overrides = {}) {
  return { id: "ws-1", title: "Repair", revision: 4, sessions: [session], closed: false, ...overrides };
}

test("resolution targets one explicit machine and exposes a unique candidate for owner confirmation", async () => {
  const calls = [];
  const host = {
    resolveSessionLocation: async (request) => {
      calls.push(request);
      return { type: "found", location, evidence };
    },
  };
  const result = await new WorkstreamSessionCoordinator({}, host).resolveSessionAnchor(activeSession(), "studio");

  assert.deepEqual(calls, [{ machineId: "studio", sessionId: "session-1" }]);
  assert.deepEqual(result, { status: "found", location, evidence });
  assert.deepEqual(sessionAnchorRepairPresentation({ status: "found", machine, result }), {
    title: "Confirm session location",
    guidance: "PI WEB found one exact session match after scanning all registered Studio (studio) workspaces. Confirm this checkout before repairing the Workstream.",
    candidates: [{ key: "studio\u0000photoquest\u0000main", label: "photoquest · main · studio", selected: true }],
    confirmEnabled: true,
    retryEnabled: false,
  });
});

test("repair immediately rechecks the confirmed evidence and appends only the bounded receipt", async () => {
  const calls = [];
  let current = snapshot();
  const client = {
    inspect: async () => { calls.push("inspect"); return structuredClone(current); },
    append: async (request) => { calls.push("append"); current = { ...current, revision: 5, sessions: [{ ...current.sessions[0], ...location }] }; return { acceptedRevision: 5, sequence: 8, ...request }; },
  };
  const host = {
    resolveSessionLocation: async (request) => { calls.push(`resolve:${request.machineId}`); return { type: "found", location, evidence }; },
  };
  const coordinator = new WorkstreamSessionCoordinator(client, host);

  const receipt = await coordinator.repairSessionAnchor(current, current.sessions[0], { location, evidence });

  assert.equal(receipt.acceptedRevision, 5);
  assert.deepEqual(calls, ["inspect", "resolve:studio", "append"]);
  assert.deepEqual(receipt.records, [{
    type: "session.anchor.repaired",
    producer: "pi-web",
    sourceSessionId: "session-1",
    payload: {
      sessionId: "session-1",
      ...location,
      resolution: { method: "complete-machine-scan", ...evidence },
    },
  }]);
});

test("ambiguous resolution requires an explicit location choice and rechecks that exact choice", async () => {
  const other = {
    location: { machineId: "studio", projectId: "photoquest", workspaceId: "experiment" },
    evidence: { ...evidence, evidenceId: "catalog-session-2", matchedCwd: "/PhotoQuest-experiment" },
  };
  const result = { status: "ambiguous", locations: [{ location, evidence }, other] };
  const appended = [];
  const client = {
    inspect: async () => snapshot(),
    append: async (request) => { appended.push(request); return { acceptedRevision: 5, sequence: 8 }; },
  };
  const host = { resolveSessionLocation: async () => ({ type: "ambiguous", locations: result.locations }) };
  const coordinator = new WorkstreamSessionCoordinator(client, host);

  const unresolved = sessionAnchorRepairPresentation({ status: "ambiguous", machine, result });
  assert.equal(unresolved.confirmEnabled, false);
  assert.equal(unresolved.candidates.length, 2);
  assert.equal(unresolved.candidates.every((candidate) => candidate.selected === false), true);

  const selected = result.locations[1];
  const chosen = sessionAnchorRepairPresentation({ status: "ambiguous", machine, result, selected });
  assert.equal(chosen.confirmEnabled, true);
  assert.equal(chosen.candidates[1].selected, true);
  await coordinator.repairSessionAnchor(snapshot(), activeSession(), selected);
  assert.equal(appended[0].records[0].payload.workspaceId, "experiment");
  assert.equal(appended[0].records[0].payload.resolution.evidenceId, "catalog-session-2");
});

test("missing and unavailable scans provide distinct fail-closed recovery guidance", () => {
  const missing = sessionAnchorRepairPresentation({ status: "missing", machine, result: { status: "missing" } });
  const unavailable = sessionAnchorRepairPresentation({ status: "unavailable", machine, result: { status: "unavailable", failedScopes: [{ workspaceId: "main" }] } });

  assert.match(missing.guidance, /No exact session match exists/);
  assert.match(missing.guidance, /another machine/);
  assert.match(unavailable.guidance, /could not be checked/);
  assert.match(unavailable.guidance, /try the scan again/);
  assert.equal(missing.confirmEnabled, false);
  assert.equal(unavailable.confirmEnabled, false);
});

test("repair is offered only after a typed missing-anchor failure for an open incomplete active session", () => {
  const session = activeSession();
  const failure = Object.assign(new Error("anchor missing"), { code: "SESSION_ANCHOR_MISSING" });
  assert.deepEqual(sessionAnchorRepairOffer(snapshot(session), session, failure, machine), {
    status: "offered",
    sessionId: "session-1",
    machine,
    failureMessage: "anchor missing",
  });
  assert.equal(sessionAnchorRepairOffer(snapshot(session), session, new Error("transport failed"), machine), undefined);
  assert.deepEqual(
    sessionAnchorRepairOffer(snapshot(activeSession({ machineId: "studio" })), activeSession({ machineId: "studio" }), failure, { id: "laptop", name: "Laptop" })?.machine,
    { id: "studio", name: "studio" },
  );
  assert.equal(sessionAnchorRepairOffer(snapshot(activeSession(location)), activeSession(location), failure, machine), undefined);
  assert.equal(sessionAnchorRepairOffer(snapshot(session, { closed: true }), session, failure, machine), undefined);
  assert.equal(sessionAnchorRepairOffer(snapshot(activeSession({ status: "failed" })), activeSession({ status: "failed" }), failure, machine), undefined);
});

test("repair fails closed when the selected evidence changes, the anchor becomes complete, or the Workstream closes", async () => {
  let current = snapshot();
  let appends = 0;
  const client = {
    inspect: async () => structuredClone(current),
    append: async () => { appends += 1; },
  };
  let recheck = { type: "found", location, evidence: { ...evidence, evidenceId: "replacement" } };
  const host = { resolveSessionLocation: async () => recheck };
  const coordinator = new WorkstreamSessionCoordinator(client, host);
  await assert.rejects(coordinator.repairSessionAnchor(current, current.sessions[0], { location, evidence }), (error) => error?.code === "SESSION_LOCATION_CHANGED");
  recheck = { type: "missing" };
  await assert.rejects(coordinator.repairSessionAnchor(current, current.sessions[0], { location, evidence }), (error) => error?.code === "SESSION_LOCATION_MISSING");
  recheck = { type: "unavailable", failedScopes: [{ type: "workspace", workspaceId: "main" }] };
  await assert.rejects(coordinator.repairSessionAnchor(current, current.sessions[0], { location, evidence }), (error) => error?.code === "SESSION_LOCATION_UNAVAILABLE");

  current = snapshot(activeSession(location));
  await assert.rejects(coordinator.repairSessionAnchor(current, current.sessions[0], { location, evidence }), /complete anchor/);
  current = snapshot(activeSession(), { closed: true });
  await assert.rejects(coordinator.repairSessionAnchor(current, current.sessions[0], { location, evidence }), /Closed Workstreams/);
  assert.equal(appends, 0);
});
