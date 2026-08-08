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
  return { name: "importer", scope: "PhotoQuest importer redesign", profile: "implementer", repositoryRoot: "/repo", ...overrides };
}

test("create writes one durable record and starts nothing", async () => {
  const store = registry();
  const record = await store.create(creation());
  assert.match(record.workerId, /^[0-9a-f-]{36}$/);
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
  await assert.rejects(store.inspect("missing"), (error) => error.code === "WORKER_NOT_FOUND");
});

test("first dispatch has no continuation; later dispatches resume the recorded session", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  const first = await store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" });
  assert.equal(first.continuationSessionId, null);
  assert.equal(first.profile, "implementer");
  await store.completeDispatch(workerId, first.lockToken, { outcome: "success", sessionId: "session-1", executionId: "exec-1" });
  const second = await store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" });
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
  await store.beginDispatch(a.workerId, { pid: 100, repositoryRoot: "/repo" });
  await assert.rejects(store.beginDispatch(a.workerId, { pid: 101, repositoryRoot: "/repo" }), (error) => error.code === "WORKER_BUSY");
  const grant = await store.beginDispatch(b.workerId, { pid: 101, repositoryRoot: "/repo" });
  assert.equal(typeof grant.lockToken, "string");
});

test("reclaims a dead-owner lock and rejects the dead owner's stale token afterwards", async () => {
  let alive = true;
  const store = registry({ isProcessAlive: () => alive });
  const { workerId } = await store.create(creation());
  const stale = await store.beginDispatch(workerId, { pid: 4242, repositoryRoot: "/repo" });
  alive = false;
  const grant = await store.beginDispatch(workerId, { pid: 4243, repositoryRoot: "/repo" });
  assert.notEqual(grant.lockToken, stale.lockToken);
  const record = await store.inspect(workerId);
  assert.equal(record.lastLockRecovery.deadPid, 4242);
  await assert.rejects(store.completeDispatch(workerId, stale.lockToken, { outcome: "success" }), (error) => error.code === "LOCK_NOT_HELD");
  await assert.rejects(store.heartbeat(workerId, stale.lockToken), (error) => error.code === "LOCK_NOT_HELD");
  await store.completeDispatch(workerId, grant.lockToken, { outcome: "success", sessionId: "session-2" });
});

test("a live lock is never reclaimed regardless of heartbeat age", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  await store.beginDispatch(workerId, { pid: 4242, repositoryRoot: "/repo" });
  await assert.rejects(store.beginDispatch(workerId, { pid: 9999, repositoryRoot: "/repo" }), (error) => error.code === "WORKER_BUSY");
  await assert.rejects(store.retire(workerId, "cleanup"), (error) => error.code === "WORKER_BUSY");
});

test("every terminal outcome releases the lock and outcome_unknown demands inspection", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  for (const outcome of ["preflight_failed", "launch_failed", "execution_failed", "cancelled", "timed_out"]) {
    const grant = await store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" });
    await store.completeDispatch(workerId, grant.lockToken, { outcome });
    assert.equal((await store.inspect(workerId)).lock, null);
  }
  const grant = await store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" });
  await store.completeDispatch(workerId, grant.lockToken, { outcome: "outcome_unknown", diagnostic: "termination unconfirmed" });
  const record = await store.inspect(workerId);
  assert.equal(record.lock, null);
  assert.equal(record.requiresInspection.diagnostic, "termination unconfirmed");
  await assert.rejects(store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" }), (error) => error.code === "WORKER_INSPECTION_REQUIRED");
  const acknowledged = await store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo", acknowledgeInspection: true });
  assert.equal((await store.inspect(workerId)).requiresInspection, null);
  await store.completeDispatch(workerId, acknowledged.lockToken, { outcome: "success" });
});

test("heartbeat refreshes the held lock", async () => {
  let current = new Date("2026-08-08T12:00:00.000Z");
  const store = registry({ clock: () => current });
  const { workerId } = await store.create(creation());
  const grant = await store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" });
  current = new Date("2026-08-08T12:05:00.000Z");
  await store.heartbeat(workerId, grant.lockToken);
  assert.equal((await store.inspect(workerId)).lock.heartbeatAt, "2026-08-08T12:05:00.000Z");
});

test("rejects dispatch from a different repository root", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  await assert.rejects(store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/elsewhere" }), (error) => error.code === "REPOSITORY_MISMATCH");
});

test("retirement is immutable and blocks further dispatch", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  await store.retire(workerId, "scope finished");
  await assert.rejects(store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" }), (error) => error.code === "WORKER_RETIRED");
  await assert.rejects(store.retire(workerId, "again"), (error) => error.code === "WORKER_RETIRED");
  const record = await store.inspect(workerId);
  assert.deepEqual(record.retired, { at: now.toISOString(), reason: "scope finished" });
});

test("bounds receipts, sanitizes oversized usage, and validates outcomes", async () => {
  const store = registry();
  const { workerId } = await store.create(creation());
  const grant = await store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" });
  await assert.rejects(store.completeDispatch(workerId, grant.lockToken, { outcome: "finished" }), (error) => error.code === "INVALID_INPUT");
  const stored = await store.completeDispatch(workerId, grant.lockToken, { outcome: "success", usage: { blob: "x".repeat(5_000) }, diagnostic: "d".repeat(5_000) });
  assert.equal(stored.usage, null);
  assert.equal(stored.diagnostic.length, 2_000);
  for (let index = 0; index < 25; index += 1) {
    const g = await store.beginDispatch(workerId, { pid: 100, repositoryRoot: "/repo" });
    await store.completeDispatch(workerId, g.lockToken, { outcome: "success", executionId: `exec-${index}` });
  }
  assert.equal((await store.inspect(workerId)).receipts.length, 20);
});

test("list summarizes workers without exposing full receipts", async () => {
  const store = registry();
  const a = await store.create(creation({ name: "a" }));
  await store.create(creation({ name: "b" }));
  const grant = await store.beginDispatch(a.workerId, { pid: 100, repositoryRoot: "/repo" });
  await store.completeDispatch(a.workerId, grant.lockToken, { outcome: "success", sessionId: "session-9" });
  const summaries = await store.list();
  assert.equal(summaries.length, 2);
  const first = summaries.find((s) => s.name === "a");
  assert.equal(first.latestSessionId, "session-9");
  assert.equal(first.latestOutcome, "success");
  assert.equal(first.locked, false);
  assert.equal("receipts" in first, false);
});

test("file adapter persists identity across registry instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worker-registry-"));
  const first = new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory }), clock: () => now, isProcessAlive: () => true });
  const record = await first.create(creation());
  const grant = await first.beginDispatch(record.workerId, { pid: 100, repositoryRoot: "/repo" });
  await first.completeDispatch(record.workerId, grant.lockToken, { outcome: "success", sessionId: "session-1" });

  const second = new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory }), clock: () => now, isProcessAlive: () => true });
  const reopened = await second.inspect(record.workerId);
  assert.equal(reopened.name, "importer");
  assert.deepEqual(reopened.sessionLineage, ["session-1"]);
  const next = await second.beginDispatch(record.workerId, { pid: 200, repositoryRoot: "/repo" });
  assert.equal(next.continuationSessionId, "session-1");
});

test("file adapter fails closed on a corrupt registry file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worker-registry-"));
  await writeFile(join(directory, "workers.json"), "{ not json", "utf8");
  const store = new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory }), clock: () => now });
  await assert.rejects(store.list(), (error) => error.code === "CORRUPT_STORE");
});

test("file adapter writes atomically through a temporary file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worker-registry-"));
  const store = new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory }), clock: () => now });
  await store.create(creation());
  const written = JSON.parse(await readFile(join(directory, "workers.json"), "utf8"));
  assert.equal(written.formatVersion, 1);
  assert.equal(Object.keys(written.workers).length, 1);
});
