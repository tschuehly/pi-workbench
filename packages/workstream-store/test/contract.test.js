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
  { type: "session.pending", producer: "pi-web", payload: { sessionId: "session-1", associationKey: "launch-1" } },
  { type: "session.confirmed", producer: "pi-web", payload: { sessionId: "session-1" } },
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
      payload: { sessionId: "session-1", checkpoint: { id: "cp-1", whatChanged: "Store implemented", remains: "Connect UI", next: "Run contract tests", references: ["packages/workstream-store"] } },
    }],
  });

  const snapshot = await store.inspect("ws-1");
  const state = await adapter.exportState();
  assert.deepEqual(rebuildSnapshot(state.workstreams["ws-1"].ledger), snapshot);
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.sessions[0].status, "active");
  assert.equal(snapshot.sessions[0].latestCheckpoint.id, "cp-1");
  assert.equal(snapshot.humanTasks[0].id, "task-1");
  assert.equal(snapshot.links[0].id, "link-1");
});

test("keeps the previous confirmed checkpoint when a later checkpoint fails", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "associate", records: associationRecords.slice(0, 2) });
  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "checkpoint-good", records: [{ type: "checkpoint.replaced", producer: "owner", sourceSessionId: "session-1", payload: { sessionId: "session-1", checkpoint: { id: "cp-good", whatChanged: "Implemented", remains: "Review", next: "Run tests" } } }] });
  await store.append({ workstreamId: "ws-1", expectedRevision: 3, idempotencyKey: "checkpoint-failed", records: [{ type: "checkpoint.failed", producer: "pi-web", sourceSessionId: "session-1", payload: { sessionId: "session-1", reason: "Persistence interrupted" } }] });
  const snapshot = await store.inspect("ws-1");
  assert.equal(snapshot.sessions[0].latestCheckpoint.id, "cp-good");
  assert.equal(snapshot.sessions[0].checkpointFailure, "Persistence interrupted");
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
  assert.equal((await store.list())[0].unresolvedHumanTaskCount, 1);

  await store.close({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "close-1", producer: "owner" });
  assert.deepEqual(await store.list(), []);
  assert.equal((await store.list({ includeClosed: true }))[0].closed, true);
  assert.equal((await store.inspect("ws-1")).humanTasks.length, 1);
});

test("reconciles a launch-key pending association to the runtime session without duplication", async () => {
  const { store } = memoryStore();
  await store.create(createRequest);
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "pending-runtime", records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "launch-runtime", machineId: "remote a", projectId: "project-1", workspaceId: "workspace-1" } }] });
  const pending = await store.inspect("ws-1");
  assert.equal(pending.sessions[0].id, "pending:launch-runtime");
  assert.equal(pending.sessions[0].status, "pending");

  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "confirm-runtime", records: [{ type: "session.confirmed", producer: "pi-web", sourceSessionId: "runtime-1", payload: { sessionId: "runtime-1", associationKey: "launch-runtime", machineId: "remote a", projectId: "project-1", workspaceId: "workspace-1" } }] });
  const confirmed = await store.inspect("ws-1");
  assert.deepEqual(confirmed.sessions.map((session) => session.id), ["runtime-1"]);
  assert.equal(confirmed.sessions[0].workspaceId, "workspace-1");
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
  await store.append({ workstreamId: "ws-1", expectedRevision: 2, idempotencyKey: "checkpoint-before-stale", records: [{ type: "checkpoint.replaced", producer: "owner", sourceSessionId: "session-1", payload: { sessionId: "session-1", checkpoint: { id: "cp-before", whatChanged: "Implemented", remains: "Review", next: "Verify" } } }] });
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

  await store.append({ workstreamId: "ws-1", expectedRevision: 5, idempotencyKey: "checkpoint-after-stale", records: [{ type: "checkpoint.replaced", producer: "owner", payload: { sessionId: "session-1", checkpoint: { id: "cp-after", whatChanged: "Reconciled", remains: "None", next: "Continue" } } }] });
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
