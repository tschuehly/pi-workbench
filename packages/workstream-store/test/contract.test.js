import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FileWorkstreamAdapter,
  InMemoryWorkstreamAdapter,
  WorkstreamStore,
  rebuildSnapshot,
} from "../src/index.js";

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

function memoryStore(options = {}) {
  const adapter = new InMemoryWorkstreamAdapter(options);
  return { adapter, store: new WorkstreamStore({ adapter, clock: clock() }) };
}

const createRequest = {
  workstreamId: "ws-1",
  idempotencyKey: "create-1",
  title: "Ship attention continuity",
  producer: "owner",
};

const associationRecords = [
  { type: "session.pending", producer: "pi-web", payload: { sessionId: "session-1", associationKey: "launch-1", machineId: "studio", projectId: "photoquest", workspaceId: "main" } },
  { type: "session.confirmed", producer: "pi-web", payload: { sessionId: "session-1", machineId: "studio", projectId: "photoquest", workspaceId: "main" } },
  { type: "human-task.upsert", producer: "session", sourceSessionId: "session-1", payload: { task: { id: "task-1", title: "Review projection" } } },
  { type: "link.upsert", producer: "session", sourceSessionId: "session-1", payload: { link: { id: "link-1", kind: "file", reference: "docs/contracts/workstreams.md" } } },
];

test("rebuilds an identical deterministic projection from semantic ledger records", async () => {
  const { adapter, store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "append-1", records: associationRecords });
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 2,
    idempotencyKey: "checkpoint-1",
    records: [{
      type: "checkpoint.replaced",
      producer: "checkpoint-worker",
      sourceSessionId: "session-1",
      payload: { sessionId: "session-1", checkpoint: { id: "cp-1", whatChanged: "Store implemented", remains: "Connect UI", next: "Run contract tests", nextSessionPrompt: "Continue the Workstream store integration. Start by running the contract tests in packages/workstream-store.", references: ["packages/workstream-store"] } },
    }],
  });

  const snapshot = await store.inspect("ws-1");
  const state = await adapter.exportState();
  assert.deepEqual(rebuildSnapshot(state.workstreams["ws-1"].ledger), snapshot);
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.sessions[0].status, "active");
  assert.equal(snapshot.sessions[0].latestCheckpoint.id, "cp-1");
  assert.equal(snapshot.sessions[0].latestCheckpoint.nextSessionPrompt, "Continue the Workstream store integration. Start by running the contract tests in packages/workstream-store.");
  assert.equal(snapshot.humanTasks[0].id, "task-1");
  assert.equal(snapshot.links[0].id, "link-1");
});

test("requires a concise explicit next-session prompt for every confirmed checkpoint", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "associate-for-prompt", records: associationRecords.slice(0, 2) });

  const checkpoint = { id: "cp-prompt", whatChanged: "Implemented", remains: "Review", next: "Run tests" };
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "checkpoint-without-prompt", records: [{ type: "checkpoint.replaced", producer: "owner", payload: { sessionId: "session-1", checkpoint } }] }),
    (error) => error.code === "INVALID_REQUEST" && error.message.includes("nextSessionPrompt"),
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "checkpoint-long-prompt", records: [{ type: "checkpoint.replaced", producer: "owner", payload: { sessionId: "session-1", checkpoint: { ...checkpoint, nextSessionPrompt: "x".repeat(2_001) } } }] }),
    (error) => error.code === "INVALID_REQUEST" && error.message.includes("at most 2000 characters"),
  );
  assert.equal((await store.inspect("ws-1")).sessions[0].latestCheckpoint, null);

  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "checkpoint-max-prompt", records: [{ type: "checkpoint.replaced", producer: "owner", payload: { sessionId: "session-1", checkpoint: { ...checkpoint, nextSessionPrompt: "x".repeat(2_000) } } }] });
  assert.equal((await store.inspect("ws-1")).sessions[0].latestCheckpoint.nextSessionPrompt.length, 2_000);
});

test("projects omitted legacy confirmation fields as incomplete without inventing a checkpoint prompt", () => {
  const legacy = rebuildSnapshot([
    { type: "workstream.created", workstreamId: "ws-legacy", title: "Legacy", producer: "owner", revision: 1, recordedAt: "2025-01-01T00:00:00.000Z" },
    { type: "session.pending", producer: "pi-web", revision: 2, recordedAt: "2025-01-01T00:00:01.000Z", payload: { sessionId: "session-legacy", associationKey: "legacy", machineId: "studio", projectId: "legacy", workspaceId: "main" } },
    { type: "session.confirmed", producer: "pi-web", revision: 3, recordedAt: "2025-01-01T00:00:02.000Z", payload: { sessionId: "session-legacy" } },
    { type: "checkpoint.replaced", producer: "owner", revision: 4, recordedAt: "2025-01-01T00:00:03.000Z", payload: { sessionId: "session-legacy", checkpoint: { id: "cp-legacy", whatChanged: "Implemented", remains: "Review", next: "Continue" } } },
  ]);
  assert.equal(legacy.sessions[0].machineId, undefined);
  assert.equal(legacy.sessions[0].latestCheckpoint.nextSessionPrompt, null);
});

test("keeps the previous confirmed checkpoint when a later checkpoint fails", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "associate", records: associationRecords.slice(0, 2) });
  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "checkpoint-good", records: [{ type: "checkpoint.replaced", producer: "owner", sourceSessionId: "session-1", payload: { sessionId: "session-1", checkpoint: { id: "cp-good", whatChanged: "Implemented", remains: "Review", next: "Run tests", nextSessionPrompt: "Review the implementation, then run the focused tests." } } }] });
  await store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "checkpoint-failed", records: [{ type: "checkpoint.failed", producer: "pi-web", sourceSessionId: "session-1", payload: { sessionId: "session-1", reason: "Persistence interrupted" } }] });
  const snapshot = await store.inspect("ws-1");
  assert.equal(snapshot.sessions[0].latestCheckpoint.id, "cp-good");
  assert.equal(snapshot.sessions[0].checkpointFailure, "Persistence interrupted");
});

test("projects the latest overview and rejects oversized or empty ones", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  const overview = (goal) => ({ type: "overview.replaced", producer: "session", sourceSessionId: "session-1", payload: { overview: { goal, doneWhen: "All five questions answered.", description: "Why and scope.", history: ["2026-09-08: slice 1 merged as PR #36."] } } });
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "ov-1", records: [overview("First goal")] });
  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "ov-2", records: [overview("Second goal")] });
  const snapshot = await store.inspect("ws-1");
  assert.equal(snapshot.overview.goal, "Second goal");
  assert.equal(snapshot.overview.revision, 3);
  assert.equal(snapshot.overview.sourceSessionId, "session-1");
  await store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "group-1", records: [{ type: "group.set", producer: "owner", payload: { group: "Embabel" } }] });
  assert.equal((await store.inspect("ws-1")).group, "Embabel");
  const summary = (await store.list()).find((summary) => summary.id === "ws-1");
  assert.equal(summary.group, "Embabel");
  assert.equal(summary.createdAt, snapshot.createdAt);
  assert.equal(summary.lastCheckpointAt, null);
  assert.equal((await store.create({ ...createRequest, workstreamId: "ws-2", idempotencyKey: "create-2" })) && (await store.inspect("ws-2")).overview, null);
  for (const bad of [
    { ...overview("x").payload.overview, goal: "g".repeat(281) },
    { ...overview("x").payload.overview, history: [] },
    { ...overview("x").payload.overview, history: Array(7).fill("e") },
    { ...overview("x").payload.overview, extra: "field" },
  ]) {
    await assert.rejects(
      store.append({ workstreamId: "ws-1", expectedRevision: 4, idempotencyKey: `bad-${JSON.stringify(bad).length}`, records: [{ type: "overview.replaced", producer: "session", payload: { overview: bad } }] }),
      (error) => error.code === "INVALID_REQUEST" || error.code === "INVALID_RECORD",
    );
  }
});

test("returns the original receipt for an exact retry and rejects conflicting key reuse", async () => {
  const { store } = memoryStore();
  const first = await store.create(createRequest);
  const retry = await store.create({ ...createRequest });
  assert.deepEqual(retry, first);

  await assert.rejects(
    store.create({ ...createRequest, title: "Different input" }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal((await store.inspect("ws-1")).revision, 1);
});

test("rejects stale revisions, invalid records, oversized mutations, and illegal transitions", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);

  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "stale", records: [associationRecords[0]] }),
    (error) => error.code === "STALE_REVISION" && error.details.currentRevision === 1,
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "invalid", records: [{ type: "raw-transcript", producer: "session", payload: {} }] }),
    (error) => error.code === "INVALID_RECORD",
  );
  await assert.rejects(
    store.append({
      workstreamId: "ws-1",
      expectedRevision: 1,
      idempotencyKey: "oversized",
      records: [{ type: "human-task.upsert", producer: "session", payload: { task: { id: "large", title: "x", detail: "x".repeat(40_000) } } }],
    }),
    (error) => error.code === "MUTATION_TOO_LARGE",
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "confirm-first", records: [associationRecords[1]] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
});

test("watches ordered replay and falls back to snapshot reconciliation after retention", async () => {
  const { store } = memoryStore({ eventRetention: 2 });
  const created = await store.create(createRequest);
  const appended = await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "append-1", records: associationRecords });

  const replay = await store.watch({ afterSequence: created.sequence });
  assert.equal(replay.mode, "replay");
  assert.deepEqual(replay.events.map((event) => event.sequence), [appended.sequence]);

  await store.close({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "close-1", producer: "owner" });
  const reconciliation = await store.watch({ afterSequence: 0 });
  assert.equal(reconciliation.mode, "snapshot");
  assert.equal(reconciliation.snapshots[0].closed, true);
  assert.equal(reconciliation.snapshots[0].revision, 3);
});

test("lists summaries, preserves unresolved tasks on close, and excludes closed workstreams by default", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "append-1", records: associationRecords });
  await store.create({ ...createRequest, workstreamId: "ws-2", idempotencyKey: "create-2" });
  assert.equal((await store.list()).find(({ id }) => id === "ws-1").unresolvedHumanTaskCount, 1);
  assert.deepEqual((await store.list({ sessionId: "session-1" })).map(({ id }) => id), ["ws-1"]);
  assert.deepEqual(await store.list({ sessionId: "missing-session" }), []);
  await assert.rejects(store.list({ sessionId: "invalid session" }), (error) => error.code === "INVALID_REQUEST");

  await store.close({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "close-1", producer: "owner" });
  assert.deepEqual(await store.list({ sessionId: "session-1" }), []);
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.list({ includeClosed: true, sessionId: "session-1" }))[0].closed, true);
  assert.equal((await store.inspect("ws-1")).humanTasks.length, 1);
});

test("reconciles a launch-key pending association to the runtime session without duplication", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "pending-runtime", records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "launch-runtime", machineId: "remote a", projectId: "project-1", workspaceId: "workspace-1" } }] });
  const pending = await store.inspect("ws-1");
  assert.equal(pending.sessions[0].id, "pending:launch-runtime");
  assert.equal(pending.sessions[0].status, "pending");

  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "confirm-runtime-without-anchor", records: [{ type: "session.confirmed", producer: "pi-web", sourceSessionId: "runtime-1", payload: { sessionId: "runtime-1", associationKey: "launch-runtime" } }] }),
    (error) => error.code === "INVALID_TRANSITION" && error.message.includes("cannot discard its pending anchor"),
  );
  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "confirm-runtime", records: [{ type: "session.confirmed", producer: "pi-web", sourceSessionId: "runtime-1", payload: { sessionId: "runtime-1", associationKey: "launch-runtime", machineId: "remote a", projectId: "project-1", workspaceId: "workspace-1" } }] });
  const confirmed = await store.inspect("ws-1");
  assert.deepEqual(confirmed.sessions.map((session) => session.id), ["runtime-1"]);
  assert.equal(confirmed.sessions[0].workspaceId, "workspace-1");
});

test("projects derivation kinds and cancellation removes only the current pending association", async () => {
  const { adapter, store } = memoryStore();
  await store.create(createRequest);
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 1,
    idempotencyKey: "pending-fork",
    records: [{
      type: "session.pending",
      producer: "pi-web",
      sourceSessionId: "source-1",
      payload: { associationKey: "pi-web:fork-1", machineId: "studio", projectId: "pi-web", workspaceId: "main", derivationKind: "fork" },
    }],
  });
  assert.equal((await store.inspect("ws-1")).sessions[0].derivationKind, "fork");

  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 2,
    idempotencyKey: "cancel-fork",
    records: [{ type: "session.cancelled", producer: "pi-web", sourceSessionId: "source-1", payload: { associationKey: "pi-web:fork-1", reason: "Owner cancelled before creation" } }],
  });
  assert.deepEqual((await store.inspect("ws-1")).sessions, []);
  assert.equal((await store.list())[0].pendingSessionCount, 0);
  const state = await adapter.exportState();
  assert.deepEqual(state.workstreams["ws-1"].ledger.slice(-2).map((record) => record.type), ["session.pending", "session.cancelled"]);

  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "cancel-again", records: [{ type: "session.cancelled", producer: "pi-web", payload: { associationKey: "pi-web:fork-1", reason: "Duplicate" } }] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "reuse-cancelled-token", records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:fork-1", machineId: "studio", projectId: "pi-web", workspaceId: "main", derivationKind: "fork" } }] }),
    (error) => error.code === "INVALID_TRANSITION" && error.message.includes("already used"),
  );
  await store.create({ workstreamId: "ws-2", idempotencyKey: "create-ws-2", title: "Another Workstream", producer: "owner" });
  await assert.rejects(
    store.append({ workstreamId: "ws-2", expectedRevision: 1, idempotencyKey: "reuse-cancelled-token-elsewhere", records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:fork-1", machineId: "studio", projectId: "pi-web", workspaceId: "main", derivationKind: "fork" } }] }),
    (error) => error.code === "INVALID_TRANSITION" && error.message.includes("already used"),
  );
});

test("rejects reused confirmed operation tokens and mismatched terminal selectors", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 1,
    idempotencyKey: "two-associations",
    records: [
      { type: "session.pending", producer: "pi-web", payload: { sessionId: "active-1", associationKey: "pi-web:active-1", machineId: "studio", projectId: "pi-web", workspaceId: "main", derivationKind: "checkpoint" } },
      { type: "session.confirmed", producer: "pi-web", payload: { sessionId: "active-1", associationKey: "pi-web:active-1", machineId: "studio", projectId: "pi-web", workspaceId: "main" } },
      { type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:pending-2", machineId: "studio", projectId: "pi-web", workspaceId: "main", derivationKind: "checkpoint" } },
    ],
  });
  assert.equal((await store.inspect("ws-1")).sessions.find((session) => session.id === "active-1").derivationKind, undefined);
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "reuse-confirmed-token", records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:active-1" } }] }),
    (error) => error.code === "INVALID_TRANSITION" && error.message.includes("already used"),
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "mixed-cancel-selectors", records: [{ type: "session.cancelled", producer: "pi-web", payload: { sessionId: "active-1", associationKey: "pi-web:pending-2", reason: "Selectors disagree" } }] }),
    (error) => error.code === "INVALID_TRANSITION" && error.message.includes("selectors"),
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "mixed-failure-selectors", records: [{ type: "session.failed", producer: "pi-web", payload: { sessionId: "unused-session-id", associationKey: "pi-web:pending-2", reason: "Selectors disagree" } }] }),
    (error) => error.code === "INVALID_TRANSITION" && error.message.includes("selectors"),
  );
  assert.equal((await store.inspect("ws-1")).sessions.find((session) => session.associationKey === "pi-web:pending-2").status, "pending");
});

test("accepts only checkpoint or fork as pending derivation kinds", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  for (const derivationKind of ["blank", "promotion", ""]) {
    await assert.rejects(
      store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: `invalid-${derivationKind || "empty"}`, records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: `launch-${derivationKind || "empty"}`, derivationKind } }] }),
      (error) => error.code === "INVALID_RECORD",
    );
  }
});

test("repairs an agent-associated incomplete session anchor without another association", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 1,
    idempotencyKey: "associate-agent-only",
    records: [
      { type: "session.pending", producer: "session", sourceSessionId: "agent-1", payload: { sessionId: "agent-1", associationKey: "agent-1" } },
      { type: "session.confirmed", producer: "session", sourceSessionId: "agent-1", payload: { sessionId: "agent-1", associationKey: "agent-1" } },
    ],
  });

  const resolution = {
    method: "complete-machine-scan",
    evidenceId: "scan-1",
    matchedCwd: "/PhotoQuest",
    scannedScopeCount: 3,
    verifiedAt: "2026-01-01T00:00:03.000Z",
  };
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 2,
    idempotencyKey: "repair-anchor",
    records: [{
      type: "session.anchor.repaired",
      producer: "pi-web",
      sourceSessionId: "agent-1",
      payload: { sessionId: "agent-1", machineId: "studio", projectId: "photoquest", workspaceId: "main", resolution },
    }],
  });

  const snapshot = await store.inspect("ws-1");
  assert.equal(snapshot.sessions.length, 1);
  assert.deepEqual(snapshot.sessions[0], {
    id: "agent-1",
    status: "active",
    associationKey: "agent-1",
    machineId: "studio",
    projectId: "photoquest",
    workspaceId: "main",
    latestCheckpoint: null,
    checkpointFailure: null,
    checkpointStaleness: null,
    launchFailure: null,
  });

  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "repair-again", records: [{ type: "session.anchor.repaired", producer: "pi-web", payload: { sessionId: "agent-1", machineId: "other", projectId: "other", workspaceId: "other", resolution } }] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
});

test("rejects partial confirmation anchors and repair of missing, failed, or closed sessions", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "pending", records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "launch-new", machineId: "studio" } }] });
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "partial-confirm", records: [{ type: "session.confirmed", producer: "pi-web", payload: { sessionId: "new-1", associationKey: "launch-new", machineId: "studio" } }] }),
    (error) => error.code === "INVALID_RECORD" && error.message.includes("provide machineId, projectId, and workspaceId together"),
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "incomplete-confirm", records: [{ type: "session.confirmed", producer: "pi-web", payload: { sessionId: "new-1", associationKey: "launch-new" } }] }),
    (error) => error.code === "INVALID_TRANSITION" && error.message.includes("cannot discard its pending anchor"),
  );
  const resolution = { method: "complete-machine-scan", evidenceId: "scan-2", matchedCwd: "/PhotoQuest", scannedScopeCount: 1, verifiedAt: "2026-01-01T00:00:04.000Z" };
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "missing-repair", records: [{ type: "session.anchor.repaired", producer: "pi-web", payload: { sessionId: "missing", machineId: "studio", projectId: "photoquest", workspaceId: "main", resolution } }] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "fail-pending", records: [{ type: "session.failed", producer: "pi-web", payload: { associationKey: "launch-new", reason: "runtime failed" } }] });
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "failed-repair", records: [{ type: "session.anchor.repaired", producer: "pi-web", payload: { sessionId: "pending:launch-new", machineId: "studio", projectId: "photoquest", workspaceId: "main", resolution } }] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
  await store.close({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "close-before-repair", producer: "owner" });
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 4, idempotencyKey: "closed-repair", records: [{ type: "session.anchor.repaired", producer: "pi-web", payload: { sessionId: "missing", machineId: "studio", projectId: "photoquest", workspaceId: "main", resolution } }] }),
    (error) => error.code === "WORKSTREAM_CLOSED",
  );
});

test("keeps a failed launch in the canonical session projection with its checkout anchor", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 1,
    idempotencyKey: "pending-failed-launch",
    records: [{
      type: "session.pending",
      producer: "pi-web",
      payload: { associationKey: "launch-failed", machineId: "studio", projectId: "pi-web", workspaceId: "feature/protocol" },
    }],
  });
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 2,
    idempotencyKey: "failed-launch",
    records: [{ type: "session.failed", producer: "pi-web", payload: { associationKey: "launch-failed", reason: "Host start failed" } }],
  });

  const snapshot = await store.inspect("ws-1");
  assert.equal(snapshot.sessions.length, 1);
  assert.deepEqual(snapshot.sessions[0], {
    id: "pending:launch-failed",
    status: "failed",
    associationKey: "launch-failed",
    machineId: "studio",
    projectId: "pi-web",
    workspaceId: "feature/protocol",
    latestCheckpoint: null,
    checkpointFailure: null,
    checkpointStaleness: null,
    launchFailure: {
      reason: "Host start failed",
      recordedAt: "2026-01-01T00:00:02.000Z",
      revision: 3,
      producer: "pi-web",
      sourceSessionId: null,
    },
  });
  assert.equal((await store.list())[0].failedSessionCount, 1);
});

test("changes checkpoint staleness only through an explicit matching record and clears it on replacement", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "associate-stale", records: associationRecords.slice(0, 2) });
  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "checkpoint-before-stale", records: [{ type: "checkpoint.replaced", producer: "owner", sourceSessionId: "session-1", payload: { sessionId: "session-1", checkpoint: { id: "cp-before", whatChanged: "Implemented", remains: "Review", next: "Verify", nextSessionPrompt: "Verify the accepted protocol change, then replace this checkpoint." } } }] });
  await store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "checkpoint-failure-not-stale", records: [{ type: "checkpoint.failed", producer: "pi-web", payload: { sessionId: "session-1", reason: "Proposal interrupted" } }] });
  assert.equal((await store.inspect("ws-1")).sessions[0].checkpointStaleness, null);

  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 4, idempotencyKey: "wrong-stale", records: [{ type: "checkpoint.stale", producer: "owner", payload: { sessionId: "session-1", checkpointId: "cp-other", reason: "Inputs changed" } }] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
  await store.append({ workstreamId: "ws-1", expectedRevision: 4, idempotencyKey: "mark-stale", records: [{ type: "checkpoint.stale", producer: "owner", sourceSessionId: "session-1", payload: { sessionId: "session-1", checkpointId: "cp-before", reason: "The accepted protocol changed" } }] });
  const stale = (await store.inspect("ws-1")).sessions[0];
  assert.equal(stale.latestCheckpoint.id, "cp-before");
  assert.equal(stale.checkpointStaleness.reason, "The accepted protocol changed");
  assert.equal(stale.checkpointStaleness.revision, 5);

  await store.append({ workstreamId: "ws-1", expectedRevision: 5, idempotencyKey: "checkpoint-after-stale", records: [{ type: "checkpoint.replaced", producer: "owner", payload: { sessionId: "session-1", checkpoint: { id: "cp-after", whatChanged: "Reconciled", remains: "None", next: "Continue", nextSessionPrompt: "Continue from the reconciled protocol state." } } }] });
  assert.equal((await store.inspect("ws-1")).sessions[0].checkpointStaleness, null);
});

test("persists typed Human Task answers, provenance, statuses, and answer receipts", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({
    workstreamId: "ws-1",
    expectedRevision: 1,
    idempotencyKey: "typed-tasks",
    records: [
      { type: "human-task.upsert", producer: "session", sourceSessionId: "session-question", payload: { task: { id: "task-yes-no", title: "Proceed?", answerKind: "yes-no", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "change", label: "Change" }], materiality: "material" } } },
      { type: "human-task.upsert", producer: "session", sourceSessionId: "session-question", payload: { task: { id: "task-no", title: "Reject this alternative?", answerKind: "yes-no", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], materiality: "non-material" } } },
      { type: "human-task.upsert", producer: "session", sourceSessionId: "session-question", payload: { task: { id: "task-change", title: "Accept without changes?", answerKind: "yes-no", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "change", label: "Change" }], materiality: "material" } } },
      { type: "human-task.upsert", producer: "session", sourceSessionId: "session-question", payload: { task: { id: "task-choice", title: "Choose direction", answerKind: "choice", options: [{ id: "keep", label: "Keep" }, { id: "change", label: "Change" }], materiality: "material" } } },
      { type: "human-task.upsert", producer: "owner", payload: { task: { id: "task-text", title: "Describe the change", answerKind: "free-text", options: [], materiality: "non-material" } } },
    ],
  });
  const answerRequest = {
    workstreamId: "ws-1",
    expectedRevision: 2,
    idempotencyKey: "answer-tasks",
    records: [
      { type: "human-task.answered", producer: "owner", payload: { taskId: "task-yes-no", answerId: "answer-yes", answer: { kind: "yes-no", optionId: "yes" } } },
      { type: "human-task.answered", producer: "owner", payload: { taskId: "task-no", answerId: "answer-no", answer: { kind: "yes-no", optionId: "no" } } },
      { type: "human-task.answered", producer: "owner", payload: { taskId: "task-change", answerId: "answer-change-request", answer: { kind: "yes-no", optionId: "change" } } },
      { type: "human-task.answered", producer: "owner", payload: { taskId: "task-choice", answerId: "answer-change", answer: { kind: "choice", optionId: "change" } } },
      { type: "human-task.answered", producer: "owner", payload: { taskId: "task-text", answerId: "answer-text", answer: { kind: "free-text", text: "Use the compact alternative" } } },
    ],
  };
  const answered = await store.append(answerRequest);
  assert.deepEqual(await store.append(structuredClone(answerRequest)), answered);
  const conflictingRetry = structuredClone(answerRequest);
  conflictingRetry.records[0].payload.answer.optionId = "no";
  await assert.rejects(store.append(conflictingRetry), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  await store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "resolve-choice", records: [{ type: "human-task.resolved", producer: "owner", payload: { taskId: "task-choice" } }] });

  const snapshot = await store.inspect("ws-1");
  const yesNo = snapshot.humanTasks.find((task) => task.id === "task-yes-no");
  const choice = snapshot.humanTasks.find((task) => task.id === "task-choice");
  assert.equal(yesNo.sourceSessionId, "session-question");
  assert.equal(snapshot.humanTasks.find((task) => task.id === "task-no").answer.optionId, "no");
  assert.equal(snapshot.humanTasks.find((task) => task.id === "task-change").answer.optionId, "change");
  assert.equal(yesNo.status, "answered");
  assert.deepEqual(yesNo.answer, { kind: "yes-no", optionId: "yes" });
  assert.deepEqual(yesNo.answerReceipt, {
    answerId: "answer-yes",
    taskId: "task-yes-no",
    acceptedRevision: 3,
    recordedAt: "2026-01-01T00:00:02.000Z",
    producer: "owner",
    sourceSessionId: null,
  });
  assert.equal(choice.status, "resolved");
  assert.deepEqual(choice.answer, { kind: "choice", optionId: "change" });
  assert.equal((await store.list())[0].unresolvedHumanTaskCount, 0);
});

test("preserves legacy remove-on-resolution behavior for non-answerable Human Tasks", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "legacy-task", records: [{ type: "human-task.upsert", producer: "owner", payload: { task: { id: "legacy", title: "Legacy task" } } }] });
  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "legacy-resolved", records: [{ type: "human-task.resolved", producer: "owner", payload: { taskId: "legacy" } }] });
  assert.deepEqual((await store.inspect("ws-1")).humanTasks, []);
});

test("runtime validation rejects ambiguous task schemas and reducer rejects incompatible answers", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "partial-task-schema", records: [{ type: "human-task.upsert", producer: "session", payload: { task: { id: "task", title: "Proceed?", answerKind: "yes-no" } } }] }),
    (error) => error.code === "INVALID_RECORD",
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "bad-yes-no-options", records: [{ type: "human-task.upsert", producer: "session", payload: { task: { id: "task", title: "Proceed?", answerKind: "yes-no", options: [{ id: "yes", label: "Yes" }], materiality: "material" } } }] }),
    (error) => error.code === "INVALID_RECORD",
  );
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "valid-choice", records: [{ type: "human-task.upsert", producer: "session", payload: { task: { id: "task", title: "Choose", answerKind: "choice", options: [{ id: "a", label: "A" }], materiality: "non-material" } } }] });
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "stale-answer", records: [{ type: "human-task.answered", producer: "owner", payload: { taskId: "task", answerId: "stale-answer", answer: { kind: "choice", optionId: "a" } } }] }),
    (error) => error.code === "STALE_REVISION" && error.details.currentRevision === 2,
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "partial-answer-batch", records: [
      { type: "human-task.answered", producer: "owner", payload: { taskId: "task", answerId: "answer-valid", answer: { kind: "choice", optionId: "a" } } },
      { type: "human-task.answered", producer: "owner", payload: { taskId: "missing", answerId: "answer-missing", answer: { kind: "choice", optionId: "a" } } },
    ] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
  assert.equal((await store.inspect("ws-1")).humanTasks[0].status, "pending");
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "wrong-answer-kind", records: [{ type: "human-task.answered", producer: "owner", payload: { taskId: "task", answerId: "answer", answer: { kind: "free-text", text: "A" } } }] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
  await assert.rejects(
    store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "wrong-answer-option", records: [{ type: "human-task.answered", producer: "owner", payload: { taskId: "task", answerId: "answer", answer: { kind: "choice", optionId: "missing" } } }] }),
    (error) => error.code === "INVALID_TRANSITION",
  );
});

test("rejects a session identifier assigned to another workstream", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "append-1", records: [associationRecords[0]] });
  await store.create({ workstreamId: "ws-2", idempotencyKey: "create-2", title: "Another", producer: "owner" });

  await assert.rejects(
    store.append({ workstreamId: "ws-2", expectedRevision: 1, idempotencyKey: "append-2", records: [associationRecords[0]] }),
    (error) => error.code === "SESSION_ASSIGNED_ELSEWHERE",
  );
});

test("file adapter survives store reconstruction without persisting generated run data in the repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-workstream-store-"));
  try {
    const first = new WorkstreamStore({ adapter: new FileWorkstreamAdapter({ directory }), clock: clock() });
    await first.create(createRequest);
    await first.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "append-1", records: associationRecords });
    await first.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "durable-task", records: [{ type: "human-task.upsert", producer: "session", sourceSessionId: "session-1", payload: { task: { id: "durable-answer", title: "Continue?", answerKind: "yes-no", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], materiality: "material" } } }] });
    await first.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "durable-answer", records: [{ type: "human-task.answered", producer: "owner", payload: { taskId: "durable-answer", answerId: "answer-after-restart", answer: { kind: "yes-no", optionId: "yes" } } }] });

    const restarted = new WorkstreamStore({ adapter: new FileWorkstreamAdapter({ directory }), clock: clock() });
    const snapshot = await restarted.inspect("ws-1");
    assert.equal(snapshot.revision, 4);
    assert.equal(snapshot.sessions[0].id, "session-1");
    assert.equal(snapshot.humanTasks.find((task) => task.id === "durable-answer").answerReceipt.answerId, "answer-after-restart");
    assert.equal((await restarted.watch({ afterSequence: 0 })).events.length, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
