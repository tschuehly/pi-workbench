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

    const restarted = new WorkstreamStore({ adapter: new FileWorkstreamAdapter({ directory }), clock: clock() });
    const snapshot = await restarted.inspect("ws-1");
    assert.equal(snapshot.revision, 2);
    assert.equal(snapshot.sessions[0].id, "session-1");
    assert.equal((await restarted.watch({ afterSequence: 0 })).events.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
