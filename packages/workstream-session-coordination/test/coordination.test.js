import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryWorkstreamAdapter,
  WorkstreamStore,
} from "../../workstream-store/src/index.js";
import {
  WorkstreamSessionCoordination,
} from "../src/index.js";

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

async function workstreamWithCheckpoint({ prompt = "Continue from the confirmed checkpoint.", stale = false } = {}) {
  const adapter = new InMemoryWorkstreamAdapter();
  const store = new WorkstreamStore({ adapter, clock: clock() });
  await store.create({ workstreamId: "ws-1", idempotencyKey: "create", title: "Coordinate continuation", producer: "owner" });
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 1,
    idempotencyKey: "associate-source",
    records: [
      { type: "session.pending", producer: "pi-web", payload: { sessionId: "source-1", associationKey: "source-operation", machineId: "local", projectId: "workbench", workspaceId: "main" } },
      { type: "session.confirmed", producer: "pi-web", sourceSessionId: "source-1", payload: { sessionId: "source-1", associationKey: "source-operation", machineId: "local", projectId: "workbench", workspaceId: "main" } },
    ],
  });
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 2,
    idempotencyKey: "checkpoint-source",
    records: [{
      type: "checkpoint.replaced",
      producer: "owner",
      sourceSessionId: "source-1",
      payload: {
        sessionId: "source-1",
        checkpoint: {
          id: "checkpoint-1",
          whatChanged: "Coordination was designed.",
          remains: "Launch it.",
          next: "Continue in a fresh session.",
          nextSessionPrompt: prompt,
          references: ["packages/workstream-session-coordination"],
        },
      },
    }],
  });
  if (stale) {
    await store.append({
      workstreamId: "ws-1",
      expectedRevision: 3,
      idempotencyKey: "stale-source",
      records: [{ type: "checkpoint.stale", producer: "owner", payload: { sessionId: "source-1", checkpointId: "checkpoint-1", reason: "The source changed." } }],
    });
  }
  return { adapter, store };
}

function coordination(store, attendedSession, options = {}) {
  let acquisitions = 0;
  const value = new WorkstreamSessionCoordination({
    withWorkstreamClient: async (callback) => {
      acquisitions += 1;
      return callback(store);
    },
    attendedSession,
    producer: "pi-web",
    ...options,
  });
  return { value, acquisitions: () => acquisitions };
}

function readyHost(overrides = {}) {
  return {
    checkLocation: async () => ({ type: "ready" }),
    launch: async (request, hooks) => {
      await hooks.created({ id: "created-1", location: request.location });
      return { type: "completed" };
    },
    lookup: async () => ({ type: "unknown" }),
    ...overrides,
  };
}

test("classifies continuation candidates per source session without inventing a Workstream-global checkpoint", async () => {
  const base = {
    id: "ws-candidates",
    title: "Candidates",
    revision: 7,
    closed: false,
    humanTasks: [],
    links: [],
    sessions: [
      { id: "active-ready", status: "active", machineId: "local", projectId: "p", workspaceId: "w", latestCheckpoint: { id: "cp", whatChanged: "Changed", remains: "Remain", next: "Next", nextSessionPrompt: "Continue." }, checkpointFailure: null, checkpointStaleness: null, launchFailure: null },
      { id: "active-legacy", status: "active", machineId: "local", projectId: "p", workspaceId: "w", latestCheckpoint: { id: "legacy", whatChanged: "Changed", remains: "Remain", next: "Next", nextSessionPrompt: null }, checkpointFailure: null, checkpointStaleness: null, launchFailure: null },
      { id: "active-incomplete", status: "active", latestCheckpoint: null, checkpointFailure: null, checkpointStaleness: null, launchFailure: null },
      { id: "pending-1", status: "pending", associationKey: "pi-web:pending", latestCheckpoint: null, checkpointFailure: null, checkpointStaleness: null, launchFailure: null },
    ],
  };
  const client = { inspect: async () => structuredClone(base), append: async () => assert.fail("inspection must not append") };
  const { value } = coordination(client, readyHost());
  const view = await value.inspectContinuation("ws-candidates");
  const statuses = Object.fromEntries(view.candidates.map((candidate) => [candidate.sourceSessionId, candidate.status === "ready" ? "ready" : candidate.cause]));
  assert.deepEqual(statuses, {
    "active-incomplete": "SOURCE_LOCATION_INCOMPLETE",
    "active-legacy": "NEXT_SESSION_PROMPT_MISSING",
    "active-ready": "ready",
    "pending-1": "SOURCE_SESSION_NOT_ACTIVE",
  });
  assert.equal(typeof view.candidates.find((candidate) => candidate.status === "ready").selection, "string");
});

test("checkpoint selections encode and decode without Node globals", async () => {
  const state = await workstreamWithCheckpoint({ prompt: "Continue with ünicode 🚀." });
  let snapshot = await state.store.inspect("ws-1");
  const client = {
    inspect: async () => structuredClone(snapshot),
    append: async (request) => {
      const record = request.records[0];
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      if (record.type === "session.pending") snapshot.sessions.push({ id: `pending:${record.payload.associationKey}`, status: "pending", associationKey: record.payload.associationKey, ...record.payload });
      if (record.type === "session.confirmed") {
        snapshot.sessions = snapshot.sessions.filter((session) => session.associationKey !== record.payload.associationKey);
        snapshot.sessions.push({ id: record.payload.sessionId, status: "active", associationKey: record.payload.associationKey, machineId: record.payload.machineId, projectId: record.payload.projectId, workspaceId: record.payload.workspaceId });
      }
      return { acceptedRevision: snapshot.revision };
    },
  };
  const { value } = coordination(client, readyHost());
  const nodeBuffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const candidate = (await value.inspectContinuation("ws-1")).candidates[0];
    const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "browser-selection", selection: candidate.selection });
    assert.equal(outcome.type, "confirmed", JSON.stringify(outcome));
  } finally {
    globalThis.Buffer = nodeBuffer;
  }
});

test("records pending before launch, preserves the exact prompt once, and confirms the created session", async () => {
  const exactPrompt = "x".repeat(2_000);
  const { store } = await workstreamWithCheckpoint({ prompt: exactPrompt });
  let launchRequest;
  const host = readyHost({
    launch: async (request, hooks) => {
      launchRequest = request;
      const pending = (await store.inspect("ws-1")).sessions.find((session) => session.associationKey === request.associationKey);
      assert.equal(pending.status, "pending");
      assert.equal(pending.derivationKind, "checkpoint");
      await hooks.created({ id: "created-1", location: request.location });
      return { type: "completed" };
    },
  });
  const { value, acquisitions } = coordination(store, host);
  const view = await value.inspectContinuation("ws-1");
  const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "continue-1", selection: view.candidates[0].selection });

  assert.equal(outcome.type, "confirmed");
  assert.equal(outcome.operationToken, "pi-web:continue-1");
  assert.equal(launchRequest.operationMarker, "pi-web:continue-1");
  assert.equal(launchRequest.initialPrompt.split(exactPrompt).length - 1, 1);
  const snapshot = await store.inspect("ws-1");
  assert.equal(snapshot.sessions.find((session) => session.id === "created-1").status, "active");
  assert.equal(snapshot.sessions.find((session) => session.id === "created-1").derivationKind, undefined);
  assert.equal(snapshot.sessions.find((session) => session.id === "source-1").latestCheckpoint.id, "checkpoint-1");
  assert.ok(acquisitions() >= 4, "each durable step should reacquire a Workstream client");
});

test("requires explicit acceptance of the exact stale checkpoint and does not clear staleness", async () => {
  const { store } = await workstreamWithCheckpoint({ stale: true });
  let launches = 0;
  const { value } = coordination(store, readyHost({ launch: async (request, hooks) => { launches += 1; await hooks.created({ id: "created-stale", location: request.location }); return { type: "completed" }; } }));
  const candidate = (await value.inspectContinuation("ws-1")).candidates[0];
  assert.equal(candidate.cause, "CHECKPOINT_STALE");

  const blocked = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "stale-blocked", selection: candidate.selection });
  assert.equal(blocked.type, "blocked");
  assert.equal(blocked.cause, "CHECKPOINT_STALE");
  assert.equal(launches, 0);

  const accepted = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "stale-accepted", selection: candidate.selection, acceptStaleCheckpointId: "checkpoint-1" });
  assert.equal(accepted.type, "confirmed");
  assert.equal((await store.inspect("ws-1")).sessions.find((session) => session.id === "source-1").checkpointStaleness.checkpointId, "checkpoint-1");
});

test("allows an unrelated Workstream revision after inspection", async () => {
  const { store } = await workstreamWithCheckpoint();
  const { value } = coordination(store, readyHost());
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 3,
    idempotencyKey: "unrelated-after-inspection",
    records: [{ type: "link.upsert", producer: "owner", payload: { link: { id: "unrelated", kind: "reference", reference: "README.md" } } }],
  });
  const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "unrelated", selection });
  assert.equal(outcome.type, "confirmed");
});

test("blocks a selection when its checkpoint or source location changes after inspection", async () => {
  const { store } = await workstreamWithCheckpoint();
  const { value } = coordination(store, readyHost());
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 3,
    idempotencyKey: "replace-after-inspection",
    records: [{ type: "checkpoint.replaced", producer: "owner", payload: { sessionId: "source-1", checkpoint: { id: "checkpoint-2", whatChanged: "Changed again", remains: "Review", next: "Continue", nextSessionPrompt: "Use the newer prompt." } } }],
  });
  const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "changed", selection });
  assert.equal(outcome.type, "blocked");
  assert.equal(outcome.cause, "SELECTION_CHANGED");
});

test("blocks a host location mismatch before appending pending", async () => {
  const { store } = await workstreamWithCheckpoint();
  const { value } = coordination(store, readyHost({ checkLocation: async () => ({ type: "blocked", cause: "HOST_LOCATION_MISMATCH", reason: "Run the command from main." }) }));
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  const before = (await store.inspect("ws-1")).revision;
  const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "wrong-location", selection });
  assert.equal(outcome.type, "blocked");
  assert.equal(outcome.cause, "HOST_LOCATION_MISMATCH");
  assert.equal((await store.inspect("ws-1")).revision, before);
});

test("records explicit cancellation but preserves an unknown launch as pending", async () => {
  const cancelledState = await workstreamWithCheckpoint();
  const cancelledCoordination = coordination(cancelledState.store, readyHost({ launch: async () => ({ type: "cancelled", reason: "Owner cancelled before creation." }) })).value;
  const cancelledSelection = (await cancelledCoordination.inspectContinuation("ws-1")).candidates[0].selection;
  const cancelled = await cancelledCoordination.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "cancelled", selection: cancelledSelection });
  assert.equal(cancelled.type, "cancelled");
  assert.equal((await cancelledState.store.inspect("ws-1")).sessions.some((session) => session.associationKey === "pi-web:cancelled"), false);

  const unknownState = await workstreamWithCheckpoint();
  const unknownCoordination = coordination(unknownState.store, readyHost({ launch: async () => ({ type: "unknown", reason: "Connection dropped." }) })).value;
  const unknownSelection = (await unknownCoordination.inspectContinuation("ws-1")).candidates[0].selection;
  const unknown = await unknownCoordination.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "unknown", selection: unknownSelection });
  assert.equal(unknown.type, "pending");
  assert.equal((await unknownState.store.inspect("ws-1")).sessions.find((session) => session.associationKey === "pi-web:unknown").status, "pending");
});

test("an exact launch retry resumes the durable operation and never relaunches the host", async () => {
  const { store } = await workstreamWithCheckpoint();
  let launches = 0;
  const host = readyHost({
    launch: async () => { launches += 1; return { type: "unknown", reason: "Connection dropped." }; },
    lookup: async () => ({ type: "unknown" }),
  });
  const { value } = coordination(store, host);
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  const request = { kind: "checkpoint", workstreamId: "ws-1", operationId: "exact-retry", selection };
  assert.equal((await value.launch(request)).type, "pending");
  const retry = await value.launch(request);
  assert.equal(retry.type, "pending");
  assert.match(retry.reason, /will not relaunch/);
  assert.equal(launches, 1);
});

test("concurrent exact retries across coordinators suppress duplicate host launch", async () => {
  const { store } = await workstreamWithCheckpoint();
  let launches = 0;
  let releaseLaunch;
  let reportStarted;
  const started = new Promise((resolve) => { reportStarted = resolve; });
  const gate = new Promise((resolve) => { releaseLaunch = resolve; });
  const host = readyHost({
    launch: async () => { launches += 1; reportStarted(); await gate; return { type: "unknown", reason: "Still pending." }; },
  });
  const firstCoordination = coordination(store, host).value;
  const secondCoordination = coordination(store, host).value;
  const selection = (await firstCoordination.inspectContinuation("ws-1")).candidates[0].selection;
  const request = { kind: "checkpoint", workstreamId: "ws-1", operationId: "concurrent", selection };
  const first = firstCoordination.launch(request);
  await started;
  const duplicate = await secondCoordination.launch(request);
  assert.equal(duplicate.type, "pending");
  assert.match(duplicate.reason, /already in progress/);
  assert.equal(launches, 1);
  releaseLaunch();
  assert.equal((await first).type, "pending");
});

test("a cancelled operation token remains occupied and an exact retry only reconciles it", async () => {
  const { store } = await workstreamWithCheckpoint();
  let launches = 0;
  const host = readyHost({
    launch: async () => { launches += 1; return { type: "cancelled", reason: "Owner cancelled." }; },
    lookup: async () => ({ type: "cancelled", reason: "Owner cancelled." }),
  });
  const { value } = coordination(store, host);
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  const request = { kind: "checkpoint", workstreamId: "ws-1", operationId: "cancel-tombstone", selection };
  assert.equal((await value.launch(request)).type, "cancelled");
  assert.equal((await value.launch(request)).type, "cancelled");
  assert.equal(launches, 1);

  const blindRetry = coordination(store, readyHost({
    launch: async () => assert.fail("a consumed token must not relaunch"),
    lookup: async () => ({ type: "unknown" }),
  })).value;
  const consumed = await blindRetry.launch(request);
  assert.equal(consumed.type, "conflict");
  assert.equal(consumed.cause, "OPERATION_TOKEN_CONSUMED");
});

test("surfaces a created session whose Workstream confirmation is unavailable", async () => {
  const { store } = await workstreamWithCheckpoint();
  const client = {
    inspect: (id) => store.inspect(id),
    append: async (request) => {
      if (request.records[0].type === "session.confirmed") {
        const error = new Error("Store lock is busy.");
        error.code = "STORE_BUSY";
        throw error;
      }
      return store.append(request);
    },
  };
  const host = readyHost({
    launch: async (request, hooks) => {
      try {
        await hooks.created({ id: "created-unconfirmed", location: request.location });
      } catch (error) {
        return { type: "unknown", reason: error.message };
      }
      return { type: "completed" };
    },
  });
  const { value } = coordination(client, host);
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "unconfirmed", selection });
  assert.equal(outcome.type, "unconfirmed");
  assert.equal(outcome.session.id, "created-unconfirmed");
  assert.equal((await store.inspect("ws-1")).sessions.find((session) => session.associationKey === "pi-web:unconfirmed").status, "pending");
});

test("propagates one-home confirmation conflicts from launch and reconciliation", async () => {
  const launchState = await workstreamWithCheckpoint();
  const conflictClient = {
    inspect: (id) => launchState.store.inspect(id),
    append: async (request) => {
      if (request.records[0].type === "session.confirmed") {
        const error = new Error("session created-conflict belongs to another workstream");
        error.code = "SESSION_ASSIGNED_ELSEWHERE";
        throw error;
      }
      return launchState.store.append(request);
    },
  };
  const host = readyHost({
    launch: async (request, hooks) => {
      try { await hooks.created({ id: "created-conflict", location: request.location }); } catch (error) { return { type: "unknown", reason: error.message }; }
      return { type: "completed" };
    },
  });
  const launchCoordination = coordination(conflictClient, host).value;
  const selection = (await launchCoordination.inspectContinuation("ws-1")).candidates[0].selection;
  const launched = await launchCoordination.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "one-home", selection });
  assert.equal(launched.type, "conflict");
  assert.equal(launched.cause, "SESSION_ASSIGNED_ELSEWHERE");
  assert.equal(launched.session.id, "created-conflict");

  const reconciled = await launchCoordination.reconcile("ws-1");
  assert.equal(reconciled[0].status, "pending", "the host has not exposed the session to lookup yet");
  const lookupCoordination = coordination(conflictClient, readyHost({ lookup: async ({ location }) => ({ type: "found", session: { id: "created-conflict", location } }) })).value;
  const conflict = await lookupCoordination.reconcile("ws-1");
  assert.equal(conflict[0].status, "conflict");
  assert.equal(conflict[0].cause, "SESSION_ASSIGNED_ELSEWHERE");
});

test("returns a typed unavailable outcome when pending persistence fails before host launch", async () => {
  const { store } = await workstreamWithCheckpoint();
  let launches = 0;
  const client = {
    inspect: (id) => store.inspect(id),
    append: async () => {
      const error = new Error("Store lock is busy.");
      error.code = "STORE_BUSY";
      throw error;
    },
  };
  const { value } = coordination(client, readyHost({ launch: async () => { launches += 1; return { type: "completed" }; } }));
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "store-busy", selection });
  assert.deepEqual({ type: outcome.type, cause: outcome.cause }, { type: "unavailable", cause: "STORE_BUSY" });
  assert.equal(launches, 0);
});

test("returns a typed unavailable outcome when the initial Workstream inspection fails", async () => {
  let launches = 0;
  const client = {
    inspect: async () => { throw Object.assign(new Error("Workstream transport is offline."), { code: "TRANSPORT_UNAVAILABLE" }); },
    append: async () => assert.fail("must not append"),
  };
  const { value } = coordination(client, readyHost({ launch: async () => { launches += 1; return { type: "completed" }; } }));
  const outcome = await value.launch({ kind: "blank", workstreamId: "ws-offline", operationId: "offline", location: { machineId: "local", projectId: "workbench", workspaceId: "main" } });
  assert.deepEqual({ type: outcome.type, cause: outcome.cause }, { type: "unavailable", cause: "TRANSPORT_UNAVAILABLE" });
  assert.equal(launches, 0);
});

test("blank launch prompts preserve Level 1 posture and checkpoint instructions", async () => {
  const { store } = await workstreamWithCheckpoint();
  let initialPrompt;
  const host = readyHost({ launch: async (request, hooks) => { initialPrompt = request.initialPrompt; await hooks.created({ id: "blank-created", location: request.location }); return { type: "completed" }; } });
  const { value } = coordination(store, host);
  const outcome = await value.launch({ kind: "blank", workstreamId: "ws-1", operationId: "blank", location: { machineId: "local", projectId: "workbench", workspaceId: "main" } });
  assert.equal(outcome.type, "confirmed");
  assert.match(initialPrompt, /Level 1 Pair posture/);
  assert.match(initialPrompt, /what changed, what remains, the next useful action, an exact paste-ready prompt/i);
  assert.match(initialPrompt, /review and confirm every field before persistence/i);
});

test("known canonical snapshots avoid transport inspection when no owned pending exists", async () => {
  const client = { inspect: async () => { throw Object.assign(new Error("offline"), { code: "TRANSPORT_UNAVAILABLE" }); }, append: async () => assert.fail("must not append") };
  const { value } = coordination(client, readyHost());
  const outcome = await value.reconcile("ws-known", { id: "ws-known", sessions: [] });
  assert.deepEqual(outcome, []);
  assert.deepEqual(await value.reconcile("ws-known"), [{ status: "unavailable", cause: "TRANSPORT_UNAVAILABLE", reason: "offline" }]);
});

test("closed Workstreams block pending reconciliation without touching the host", async () => {
  const client = { inspect: async () => assert.fail("known snapshot must avoid inspection"), append: async () => assert.fail("closed reconciliation must not append") };
  const host = readyHost({ lookup: async () => assert.fail("closed reconciliation must not query the host") });
  const { value } = coordination(client, host);
  const outcomes = await value.reconcile("ws-closed", {
    id: "ws-closed",
    closed: true,
    sessions: [{ id: "pending:pi-web:closed", status: "pending", associationKey: "pi-web:closed", machineId: "local", projectId: "workbench", workspaceId: "main" }],
  });
  assert.deepEqual(outcomes, [{ associationKey: "pi-web:closed", status: "blocked", cause: "WORKSTREAM_CLOSED", reason: "Workstream ws-closed is closed; its pending association cannot be reconciled." }]);
});

test("retries the exact terminal mutation after cancellation response loss", async () => {
  const { store } = await workstreamWithCheckpoint();
  let loseCancellationResponse = true;
  const client = {
    inspect: (id) => store.inspect(id),
    append: async (request) => {
      const receipt = await store.append(request);
      if (request.records[0].type === "session.cancelled" && loseCancellationResponse) {
        loseCancellationResponse = false;
        throw new Error("response lost after cancellation commit");
      }
      return receipt;
    },
  };
  const { value } = coordination(client, readyHost({ launch: async () => ({ type: "cancelled", reason: "Owner cancelled." }) }));
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "cancel-response-loss", selection });
  assert.equal(outcome.type, "cancelled");
  assert.equal((await store.inspect("ws-1")).sessions.some((session) => session.associationKey === "pi-web:cancel-response-loss"), false);
});

test("reconciles only owning-host pending tokens and never relaunches", async () => {
  const { store } = await workstreamWithCheckpoint();
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 3,
    idempotencyKey: "pending-hosts",
    records: [
      { type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:recover", machineId: "local", projectId: "workbench", workspaceId: "main", derivationKind: "checkpoint" } },
      { type: "session.pending", producer: "pi-extension", payload: { associationKey: "pi-extension:foreign", machineId: "local", projectId: "workbench", workspaceId: "main", derivationKind: "checkpoint" } },
    ],
  });
  let launches = 0;
  const host = readyHost({
    launch: async () => { launches += 1; return { type: "failed", reason: "must not launch" }; },
    lookup: async ({ associationKey, location }) => associationKey === "pi-web:recover"
      ? { type: "found", session: { id: "recovered-1", location } }
      : { type: "unknown" },
  });
  const { value } = coordination(store, host);
  const outcomes = await value.reconcile("ws-1");
  assert.deepEqual(outcomes, [{ associationKey: "pi-web:recover", status: "confirmed", sessionId: "recovered-1" }]);
  assert.equal(launches, 0);
  const snapshot = await store.inspect("ws-1");
  assert.equal(snapshot.sessions.find((session) => session.id === "recovered-1").status, "active");
  assert.equal(snapshot.sessions.find((session) => session.associationKey === "pi-extension:foreign").status, "pending");
});

test("reconciliation recognizes a cancellation committed after its known snapshot", async () => {
  const { store } = await workstreamWithCheckpoint();
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 3,
    idempotencyKey: "pending-cancel-race",
    records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:cancel-race", machineId: "local", projectId: "workbench", workspaceId: "main", derivationKind: "checkpoint" } }],
  });
  const knownSnapshot = await store.inspect("ws-1");
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 4,
    idempotencyKey: "external-cancel-race",
    records: [{ type: "session.cancelled", producer: "pi-web", payload: { associationKey: "pi-web:cancel-race", reason: "Owner cancelled." } }],
  });
  const { value } = coordination(store, readyHost({ lookup: async () => ({ type: "cancelled", reason: "Owner cancelled." }) }));
  const outcomes = await value.reconcile("ws-1", knownSnapshot);
  assert.deepEqual(outcomes, [{ associationKey: "pi-web:cancel-race", status: "cancelled", reason: "Owner cancelled." }]);
});

test("retries stale Workstream revisions without retrying the attended host", async () => {
  const { store } = await workstreamWithCheckpoint();
  let staleOnce = true;
  let launches = 0;
  const client = {
    inspect: (id) => store.inspect(id),
    append: async (request) => {
      if (request.records[0].type === "session.pending" && staleOnce) {
        staleOnce = false;
        const error = new Error("stale");
        error.code = "STALE_REVISION";
        throw error;
      }
      return store.append(request);
    },
  };
  const { value } = coordination(client, readyHost({ launch: async (request, hooks) => { launches += 1; await hooks.created({ id: "created-retry", location: request.location }); return { type: "completed" }; } }));
  const selection = (await value.inspectContinuation("ws-1")).candidates[0].selection;
  const outcome = await value.launch({ kind: "checkpoint", workstreamId: "ws-1", operationId: "retry", selection });
  assert.equal(outcome.type, "confirmed");
  assert.equal(launches, 1);
});
