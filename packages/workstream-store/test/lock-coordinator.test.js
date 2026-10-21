import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, lstat, symlink, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isolatedRoot, missingIsolation } from "./fixtures/lock-owner-child.mjs";

const skip = missingIsolation().length ? "requires isolated environment" : false;
const sqliteError = (errcode, message = "not classification evidence") => Object.assign(new Error(message), { code: "ERR_SQLITE_ERROR", errcode });
const code = (expected) => (error) => { assert.equal(error.code, expected); return true; };
async function setup(t) {
  const directory = await mkdtemp(join(await isolatedRoot(), "coordinator-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, api: await import("../src/lock-coordinator.js") };
}
function fake({ begin, pragma = 0, execFailure, closeFailure } = {}) {
  const state = { opened: 0, closed: 0, active: 0, commands: [] };
  class DatabaseSync {
    constructor() { state.opened++; state.active++; }
    exec(sql) {
      state.commands.push(sql);
      if (execFailure) execFailure(sql);
      if (sql === "BEGIN IMMEDIATE" && begin) begin(state.opened);
    }
    prepare(sql) { state.commands.push(sql); return { get: () => ({ timeout: pragma }) }; }
    close() { state.closed++; state.active--; if (closeFailure) throw closeFailure; }
  }
  return { state, DatabaseSync };
}
function options(api, db, extra = {}) {
  return { lockTimeoutMs: 0, [api.COORDINATOR_TEST]: { importSQLite: async () => ({ DatabaseSync: db.DatabaseSync }), ...extra } };
}

test("missing capability and wrong runtime are lazy typed failures BEFORE marker mutation", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  const db = fake();
  for (const injection of [
    { importSQLite: async () => { throw new Error("missing node:sqlite / private path"); } },
    { version: "24.12.9" }, { version: "22.19.0" }, { version: "nonsense" },
    { importSQLite: async () => ({}) },
  ]) {
    await assert.rejects(api.acquireLock(directory, options(api, db, injection)), (error) => {
      assert.equal(error.code, "LOCK_COORDINATOR_UNAVAILABLE");
      assert.equal(error.details.operation, "preflight");
      assert.equal(JSON.stringify(error).includes("private path"), false);
      return true;
    });
    assert.deepEqual(await readdir(directory), []);
  }
});

test("numeric primary BUSY including extended code retries; closes before capped async sleep", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  const db = fake({ begin: () => { throw sqliteError(261, "not busy text"); } });
  let now = 0, sleeps = 0;
  const opts = options(api, db, { clock: () => now, sleep: async (ms) => { assert.equal(db.state.active, 0); assert.ok(ms > 0 && ms <= 20); now += ms; sleeps++; } });
  opts.lockTimeoutMs = 45;
  await assert.rejects(api.acquireLock(directory, opts), code("STORE_BUSY"));
  assert.equal(now, 45);
  assert.equal(sleeps, 3);
  assert.equal(db.state.opened, 3);
  assert.equal(db.state.closed, 3);
  assert.equal(db.state.commands.filter((sql) => sql === "PRAGMA busy_timeout = 0").length, 3);
});

test("zero budget makes exactly one immediate attempt with no sleep, free or busy", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  for (const busy of [false, true]) {
    const db = fake({ begin: () => { if (busy) throw sqliteError(5); } });
    const opts = options(api, db, { clock: () => 100, sleep: () => assert.fail("zero timeout slept") });
    if (busy) await assert.rejects(api.acquireLock(directory, opts), code("STORE_BUSY"));
    else await (await api.acquireLock(directory, opts)).release();
    assert.equal(db.state.opened, 1);
    assert.equal(db.state.closed, 1);
  }
});

test("PRAGMA must set and read back zero before BEGIN on every handle", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  for (const db of [fake({ pragma: 100 }), ...[5, 10].map((errcode) => fake({ execFailure: (sql) => { if (sql.startsWith("PRAGMA")) throw sqliteError(errcode); } }))]) {
    await assert.rejects(api.acquireLock(directory, options(api, db)), code("LOCK_COORDINATOR_UNAVAILABLE"));
    assert.equal(db.state.commands.includes("BEGIN IMMEDIATE"), false);
    assert.equal(db.state.closed, 1);
  }
});

test("actual numeric corruption differs from operational, LOCKED and unknown failures", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  for (const [errcode, expected] of [[11, "CORRUPT_STORE"], [26, "CORRUPT_STORE"], [10, "LOCK_COORDINATOR_UNAVAILABLE"], [14, "LOCK_COORDINATOR_UNAVAILABLE"], [8, "LOCK_COORDINATOR_UNAVAILABLE"], [6, "LOCK_COORDINATOR_UNAVAILABLE"], [undefined, "LOCK_COORDINATOR_UNAVAILABLE"]]) {
    const db = fake({ begin: () => { throw sqliteError(errcode, "database is locked busy corrupt"); } });
    await assert.rejects(api.acquireLock(directory, options(api, db)), code(expected));
    assert.equal(db.state.opened, 1);
    assert.equal(db.state.closed, 1);
  }
});

test("invalid timeout and retry values refuse before touching marker", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  for (const value of [-1, NaN, Infinity, "1"]) await assert.rejects(api.acquireLock(directory, { lockTimeoutMs: value }), TypeError);
  for (const value of [0, -1, NaN, Infinity, "1"]) await assert.rejects(api.acquireLock(directory, { lockRetryIntervalMs: value }), TypeError);
  assert.deepEqual(await readdir(directory), []);
});

test("database-family symlinks refuse before SQLite factory, no raw descriptor opens", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  const db = fake();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const path = join(directory, `.workstreams-lock.sqlite${suffix}`);
    await symlink(join(directory, "absent"), path);
    await assert.rejects(api.acquireLock(directory, options(api, db)), code("CORRUPT_STORE"));
    assert.equal(db.state.opened, 0);
    await rm(path);
  }
});

test("cleanup preserves primitive/frozen primary identity and closes even after rollback failure", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  for (const primary of ["primitive", null, undefined, Object.freeze(new Error("frozen")), Object.assign(new Error("callback"), { code: "CALLBACK" })]) {
    const db = fake({ execFailure: (sql) => { if (sql === "ROLLBACK") throw sqliteError(10); }, closeFailure: new Error("close") });
    const lease = await api.acquireLock(directory, options(api, db));
    let caught = false;
    try { await lease.release({ failed: true, primary }); } catch (error) { caught = true; assert.equal(error, primary); }
    assert.equal(caught, true);
    assert.equal(db.state.closed, 1);
    if (primary && !Object.isFrozen(primary) && typeof primary === "object") assert.deepEqual(primary.cleanupDiagnostics, [{ operation: "rollback" }, { operation: "close" }]);
  }
});

test("sole COMMIT/rollback/close errors are typed sanitized diagnostics, first failure wins", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  for (const operation of ["commit", "rollback", "close"]) {
    for (const jsonCommitted of [false, true]) {
      const raw = new Error("private token / path");
      const db = fake({ execFailure: (sql) => { if (sql === operation.toUpperCase()) throw raw; }, closeFailure: operation === "close" ? raw : new Error("secondary close") });
      const lease = await api.acquireLock(directory, options(api, db));
      await assert.rejects(lease.release({ failed: operation === "rollback", jsonCommitted }), (error) => {
        assert.equal(error.code, "LOCK_COORDINATOR_UNAVAILABLE");
        assert.deepEqual(error.details, { operation, jsonCommitted });
        assert.equal(error.cause, raw);
        assert.equal(JSON.stringify(error).includes("private token"), false);
        return true;
      });
      assert.equal(db.state.closed, 1);
      if (operation === "commit") assert.equal(db.state.commands.includes("ROLLBACK"), true);
      await assert.rejects(lease.release(), code("LOCK_COORDINATOR_UNAVAILABLE"));
    }
  }
});

test("busy close failure is unavailable and never sleeps/retries an unhealthy handle", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  const db = fake({ begin: () => { throw sqliteError(5); }, closeFailure: new Error("close failed") });
  const opts = options(api, db, { sleep: () => assert.fail("must not retry") });
  opts.lockTimeoutMs = 100;
  await assert.rejects(api.acquireLock(directory, opts), code("LOCK_COORDINATOR_UNAVAILABLE"));
  assert.equal(db.state.opened, 1);
});

test("real SQLite leases exclude same-process coordinator and yield timers, then reuse permanent marker", { skip, timeout: 10_000 }, async (t) => {
  const { directory, api } = await setup(t);
  const lease = await api.acquireLock(directory);
  const inode = (await lstat(join(directory, ".workstreams.lock"))).ino;
  // Metadata only while any same-process lease is held: no DB read/open/close outside SQLite.
  let fired = false;
  const timer = setTimeout(() => { fired = true; }, 5);
  try {
    await assert.rejects(api.acquireLock(directory, { lockTimeoutMs: 40, lockRetryIntervalMs: 10 }), code("STORE_BUSY"));
    assert.equal(fired, true);
  } finally { clearTimeout(timer); await lease.release(); }
  await (await api.acquireLock(directory)).release();
  const child = fork(new URL("./fixtures/lock-owner-child.mjs", import.meta.url), ["sqlite", directory], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const exited = once(child, "exit");
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    const [message] = await Promise.race([once(child, "message"), exited.then(() => { throw new Error("child exited before acquisition"); })]);
    assert.deepEqual(message, { event: "acquired", mode: "sqlite", version: process.version });
    await assert.rejects(api.acquireLock(directory, { lockTimeoutMs: 0 }), code("STORE_BUSY"));
    child.send("release");
    assert.deepEqual(await exited, [0, null]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    clearTimeout(watchdog);
  }
  await (await api.acquireLock(directory)).release();
  assert.equal((await lstat(join(directory, ".workstreams.lock"))).ino, inode);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(directory, ".workstreams-lock.sqlite"));
  try { assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all(), []); } finally { db.close(); }
  t.diagnostic(JSON.stringify({ evidence: "phase1-coordinator-seam", sameProcessBusy: true, timerYielded: fired, childOwnerBusy: true, observedChildExit: [0, null], markerInodePreserved: true, applicationTables: 0 }));
});

test("real malformed database preserved and reported corrupt, not operational unavailable", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  const path = join(directory, ".workstreams-lock.sqlite");
  const original = "not sqlite content";
  await writeFile(path, original);
  await assert.rejects(api.acquireLock(directory), code("CORRUPT_STORE"));
  assert.equal(await readFile(path, "utf8"), original);
});
