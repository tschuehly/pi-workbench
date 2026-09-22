import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileWorkerAdapter, InMemoryWorkerAdapter, WorkerRegistry } from "../src/index.js";

const now = new Date("2026-08-08T12:00:00.000Z");

function registry(overrides = {}) {
  return new WorkerRegistry({ adapter: new InMemoryWorkerAdapter(), clock: () => now, isProcessAlive: () => true, ...overrides });
}

function creation(overrides = {}) {
  return { name: "importer", scope: "PhotoQuest importer redesign", profile: "implementer", repositoryRoot: "/repo", ownerSessionId: "lead-session", ...overrides };
}

function begin(store, workerId, overrides = {}) {
  return store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo", ownerSessionId: "lead-session", ...overrides });
}

function retire(store, workerId, reason) {
  return store.retire(workerId, reason, { ownerSessionId: "lead-session" });
}

test("create writes one durable record and starts nothing", async () => {
  const store = registry();
  const record = await store.create(creation());
  assert.match(record.workerId, /^[0-9a-f-]{36}$/);
  assert.equal(record.ownerSessionId, "lead-session");
  assert.deepEqual(record.sessionLineage, []);
  assert.deepEqual(record.receipts, []);
  assert.equal(record.lock, null);
  assert.equal(record.retired, null);
  const inspected = await store.inspect(record.workerId);
  assert.deepEqual(inspected, record);
});

test("rejects invalid creation input and unknown workers", async () => {
  const store = registry();
  await assert.rejects(store.create(creation({ name: " " })), (error) => error.code === "INVALID_INPUT");
  await assert.rejects(store.create(creation({ scope: "x".repeat(2_001) })), (error) => error.code === "INVALID_INPUT");
  await assert.rejects(store.create(creation({ ownerSessionId: " " })), (error) => error.code === "INVALID_INPUT");
  await assert.rejects(store.inspect("missing"), (error) => error.code === "WORKER_NOT_FOUND");
});

test("first dispatch has no continuation; later dispatches resume the recorded session", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  const first = await begin(store, workerId);
  assert.equal(first.continuationSessionId, null);
  assert.equal(first.profile, "implementer");
  await store.completeDispatch(workerId, first.lockToken, { outcome: "success", sessionId: "session-1", executionId: "exec-1" });
  const second = await begin(store, workerId);
  assert.equal(second.continuationSessionId, "session-1");
  await store.completeDispatch(workerId, second.lockToken, { outcome: "success", sessionId: "session-1" });
  const record = await store.inspect(workerId);
  assert.deepEqual(record.sessionLineage, ["session-1"]);
  assert.equal(record.receipts.length, 2);
  assert.equal(record.lock, null);
});

test("a concurrent dispatch to a live-locked worker fails typed while other workers stay dispatchable", async () => {
  const store = registry();
  const a = await store.create(creation({ name: "a" }));
  const b = await store.create(creation({ name: "b" }));
  await begin(store, a.workerId);
  await assert.rejects(begin(store, a.workerId, { pid: 101 }), (error) => error.code === "WORKER_BUSY");
  const grant = await begin(store, b.workerId, { pid: 101 });
  assert.equal(typeof grant.lockToken, "string");
});

test("reclaiming a dead-owner lock requires inspection before dispatch", async () => {
  let alive = true;
  const store = registry({ isProcessAlive: () => alive });
  const { workerId } = await store.create(creation());
  const stale = await begin(store, workerId, { pid: 4242 });
  alive = false;
  await assert.rejects(begin(store, workerId, { pid: 4243 }), (error) => error.code === "WORKER_INSPECTION_REQUIRED");

  const diagnostic = "dispatch lock held by dead process 4242 since 2026-08-08T12:00:00.000Z (last heartbeat 2026-08-08T12:00:00.000Z) was reclaimed; the interrupted assignment's outcome is unknown";
  const record = await store.inspect(workerId);
  assert.equal(record.lock, null);
  assert.deepEqual(record.lastLockRecovery, {
    at: now.toISOString(),
    deadPid: 4242,
    acquiredAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  });
  assert.deepEqual(record.requiresInspection, { at: now.toISOString(), diagnostic });
  assert.equal(record.receipts.at(-1).outcome, "outcome_unknown");
  assert.equal(record.receipts.at(-1).diagnostic, diagnostic);
  assert.equal((await store.list({ ownerSessionId: "lead-session" }))[0].requiresInspection.diagnostic, diagnostic);
  await assert.rejects(store.completeDispatch(workerId, stale.lockToken, { outcome: "success" }), (error) => error.code === "LOCK_NOT_HELD");
  await assert.rejects(store.heartbeat(workerId, stale.lockToken), (error) => error.code === "LOCK_NOT_HELD");

  const grant = await begin(store, workerId, { pid: 4243, acknowledgeInspection: true });
  assert.notEqual(grant.lockToken, stale.lockToken);
  assert.equal((await store.inspect(workerId)).requiresInspection, null);
  await store.completeDispatch(workerId, grant.lockToken, { outcome: "success", sessionId: "session-2" });
});

test("a live lock is never reclaimed regardless of heartbeat age", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  await begin(store, workerId, { pid: 4242 });
  await assert.rejects(begin(store, workerId, { pid: 9999 }), (error) => error.code === "WORKER_BUSY");
  await assert.rejects(retire(store, workerId, "cleanup"), (error) => error.code === "WORKER_BUSY");
});

test("every current or legacy terminal outcome releases the lock and outcome_unknown demands inspection", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  for (const outcome of ["preflight_failed", "launch_failed", "execution_failed", "cancelled", "timed_out"]) {
    const grant = await begin(store, workerId);
    await store.completeDispatch(workerId, grant.lockToken, { outcome });
    assert.equal((await store.inspect(workerId)).lock, null);
  }
  const grant = await begin(store, workerId);
  await store.completeDispatch(workerId, grant.lockToken, { outcome: "outcome_unknown", diagnostic: "termination unconfirmed" });
  const record = await store.inspect(workerId);
  assert.equal(record.lock, null);
  assert.equal(record.requiresInspection.diagnostic, "termination unconfirmed");
  await assert.rejects(begin(store, workerId), (error) => error.code === "WORKER_INSPECTION_REQUIRED");
  const acknowledged = await begin(store, workerId, { acknowledgeInspection: true });
  assert.equal((await store.inspect(workerId)).requiresInspection, null);
  await store.completeDispatch(workerId, acknowledged.lockToken, { outcome: "success" });
});

test("heartbeat refreshes the held lock", async () => {
  let current = new Date("2026-08-08T12:00:00.000Z");
  const store = registry({ clock: () => current });
  const { workerId } = await store.create(creation());
  const grant = await begin(store, workerId);
  current = new Date("2026-08-08T12:05:00.000Z");
  await store.heartbeat(workerId, grant.lockToken);
  assert.equal((await store.inspect(workerId)).lock.heartbeatAt, "2026-08-08T12:05:00.000Z");
});

test("rejects dispatch from a different repository root", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  await assert.rejects(begin(store, workerId, { repositoryRoot: "/elsewhere" }), (error) => error.code === "REPOSITORY_MISMATCH");
});

test("retirement is immutable and blocks further dispatch", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  await retire(store, workerId, "scope finished");
  await assert.rejects(begin(store, workerId), (error) => error.code === "WORKER_RETIRED");
  await assert.rejects(retire(store, workerId, "again"), (error) => error.code === "WORKER_RETIRED");
  const record = await store.inspect(workerId);
  assert.deepEqual(record.retired, { at: now.toISOString(), reason: "scope finished" });
});

test("bounds receipts, sanitizes oversized usage, and validates outcomes", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  const grant = await begin(store, workerId);
  await assert.rejects(store.completeDispatch(workerId, grant.lockToken, { outcome: "finished" }), (error) => error.code === "INVALID_INPUT");
  const stored = await store.completeDispatch(workerId, grant.lockToken, { outcome: "success", usage: { blob: "x".repeat(5_000) }, diagnostic: "d".repeat(5_000) });
  assert.equal(stored.usage, null);
  assert.equal(stored.diagnostic.length, 2_000);
  for (let index = 0; index < 25; index += 1) {
    const g = await begin(store, workerId);
    await store.completeDispatch(workerId, g.lockToken, { outcome: "success", executionId: `exec-${index}` });
  }
  assert.equal((await store.inspect(workerId)).receipts.length, 20);
});

test("list summarizes workers without exposing full receipts", async () => {
  const store = registry();
  const a = await store.create(creation({ name: "a" }));
  await store.create(creation({ name: "b" }));
  const grant = await begin(store, a.workerId);
  await store.completeDispatch(a.workerId, grant.lockToken, { outcome: "success", sessionId: "session-9" });
  const summaries = await store.list({ ownerSessionId: "lead-session", includeRetired: true });
  assert.equal(summaries.length, 2);
  const first = summaries.find((s) => s.name === "a");
  assert.equal(first.latestSessionId, "session-9");
  assert.equal(first.latestOutcome, "success");
  assert.equal(first.locked, false);
  assert.equal("receipts" in first, false);
});

test("session filters isolate active workers while all:true remains diagnostic", async () => {
  const store = registry();
  const owned = await store.create(creation({ name: "owned" }));
  await store.create(creation({ name: "foreign", ownerSessionId: "other-session" }));
  const retired = await store.create(creation({ name: "retired" }));
  await retire(store, retired.workerId, "done");

  const active = await store.list({ ownerSessionId: "lead-session", includeRetired: false });
  assert.deepEqual(active.map((worker) => worker.name), ["owned"]);
  assert.equal((await store.list({ all: true })).length, 3);
  await assert.rejects(
    store.beginDispatch(owned.workerId, { pid: 100, repositoryRoot: "/repo", ownerSessionId: "other-session" }),
    (error) => error.code === "WORKER_SESSION_MISMATCH",
  );
  await assert.rejects(
    store.retire(owned.workerId, "foreign cleanup", { ownerSessionId: "other-session" }),
    (error) => error.code === "WORKER_SESSION_MISMATCH",
  );
});

test("the first mutation claims a legacy unowned worker for the current session", async () => {
  const adapter = new InMemoryWorkerAdapter();
  const original = new WorkerRegistry({ adapter, clock: () => now, isProcessAlive: () => true });
  const record = await original.create(creation({ name: "legacy" }));
  const state = await adapter.exportState();
  delete state.workers[record.workerId].ownerSessionId;
  const legacy = new WorkerRegistry({ adapter: new InMemoryWorkerAdapter({ state }), clock: () => now, isProcessAlive: () => true });

  assert.equal((await legacy.list({ all: true }))[0].ownerSessionId, null);
  const grant = await begin(legacy, record.workerId);
  assert.equal((await legacy.inspect(record.workerId)).ownerSessionId, "lead-session");
  await legacy.completeDispatch(record.workerId, grant.lockToken, { outcome: "success" });
});

test("file adapter persists identity across registry instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worker-registry-"));
  const first = new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory }), clock: () => now, isProcessAlive: () => true });
  const record = await first.create(creation());
  const grant = await begin(first, record.workerId);
  await first.completeDispatch(record.workerId, grant.lockToken, { outcome: "success", sessionId: "session-1" });

  const second = new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory }), clock: () => now, isProcessAlive: () => true });
  const reopened = await second.inspect(record.workerId);
  assert.equal(reopened.name, "importer");
  assert.deepEqual(reopened.sessionLineage, ["session-1"]);
  const next = await begin(second, record.workerId, { pid: 200 });
  assert.equal(next.continuationSessionId, "session-1");
});

test("file adapter fails closed on a corrupt registry file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worker-registry-"));
  await writeFile(join(directory, "workers.json"), "{ not json", "utf8");
  const store = new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory }), clock: () => now });
  await assert.rejects(store.list({ all: true }), (error) => error.code === "CORRUPT_STORE");
});

test("file adapter writes atomically through a temporary file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worker-registry-"));
  const store = new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory }), clock: () => now });
  await store.create(creation());
  const written = JSON.parse(await readFile(join(directory, "workers.json"), "utf8"));
  assert.equal(written.formatVersion, 1);
  assert.equal(Object.keys(written.workers).length, 1);
});
