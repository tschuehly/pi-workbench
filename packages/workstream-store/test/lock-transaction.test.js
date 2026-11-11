import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { mkdtemp, rm, readFile, readdir, lstat, symlink, mkdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { FileWorkstreamAdapter, WorkstreamStore, createUserLocalWorkstreamStore } from "../src/index.js";
import * as adapters from "../src/adapters.js";
import { acquireLock, COORDINATOR_TEST } from "../src/lock-coordinator.js";
import { isolatedRoot, missingIsolation } from "./fixtures/lock-owner-child.mjs";

const skip = missingIsolation().length ? "requires isolated environment" : false;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const busy = (error) => error.code === "STORE_BUSY";
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(await isolatedRoot(), "transaction-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const adapter = new FileWorkstreamAdapter({ directory, ...options });
  return { directory, adapter, store: new WorkstreamStore({ adapter }) };
}
const request = { workstreamId: "ws-1", title: "Original", producer: "owner", idempotencyKey: "create-1" };
async function sameThrow(promise, primary) {
  let caught = false;
  try { await promise; } catch (error) { caught = true; assert.equal(error, primary); }
  assert.ok(caught, "must reject even for undefined/null throws");
}
async function childOwner(t, directory, mode = "candidate", phase) {
  const child = fork(new URL("./fixtures/lock-owner-child.mjs", import.meta.url), [mode, directory, ...(phase ? [phase] : [])], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const exit = once(child, "exit");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exit; clearTimeout(timer); });
  const [message] = await Promise.race([once(child, "message"), exit.then(() => { throw new Error("early child exit"); })]);
  assert.equal(message.event, phase ?? "acquired");
  assert.equal(message.version, process.version);
  return { child, exit };
}
function instrument(DatabaseSync, failure) {
  const state = { closed: 0, commands: [] };
  class Wrapped {
    constructor(path) { this.database = new DatabaseSync(path); }
    exec(sql) { state.commands.push(sql); failure(sql); return this.database.exec(sql); }
    prepare(sql) { return this.database.prepare(sql); }
    close() { this.database.close(); state.closed++; failure("close"); }
  }
  return { state, seam: { importSQLite: async () => ({ DatabaseSync: Wrapped }) } };
}

test("factory options/defaults and declarations agree without touching default Store", { skip }, async (t) => {
  const { directory } = await setup(t);
  const defaults = createUserLocalWorkstreamStore();
  assert.equal(defaults.adapter.directory, join(homedir(), ".pi-workbench", "workstreams"));
  await assert.rejects(lstat(defaults.adapter.directory), { code: "ENOENT" });
  const store = createUserLocalWorkstreamStore({ directory, lockTimeoutMs: 31, lockRetryIntervalMs: 7 });
  assert.equal(store.adapter.lockRetryIntervalMs, 7);
  assert.equal(store.adapter.lockTimeoutMs, 31);
  await store.create(request);
  const types = await readFile(new URL("../src/index.d.ts", import.meta.url), "utf8");
  assert.equal((types.match(/lockRetryIntervalMs\?: number/g) ?? []).length, 2);
  for (const value of [-1, Infinity, NaN, "1", null]) assert.throws(() => new FileWorkstreamAdapter({ directory, lockTimeoutMs: value }), TypeError);
  for (const value of [0, -1, Infinity, NaN, "1", null]) assert.throws(() => new FileWorkstreamAdapter({ directory, lockRetryIntervalMs: value }), TypeError);
});

test("two adapters exclude reads/writes and warm trusted cache; bounded busy yields timer", { skip, timeout: 10_000 }, async (t) => {
  const { directory, adapter, store } = await setup(t, { lockTimeoutMs: 100, lockRetryIntervalMs: 20 });
  await store.create(request);
  await store.list();
  const bytes = await readFile(adapter.file, "utf8");
  const owner = await acquireLock(directory);
  let firedAt;
  const start = performance.now();
  const timer = setTimeout(() => { firedAt = performance.now() - start; }, 25);
  let elapsed;
  try {
    await assert.rejects(store.list(), busy);
    elapsed = performance.now() - start;
    assert.ok(elapsed <= 120, `acquisition ${elapsed} > 120 ms`);
    assert.ok(firedAt < 125, `timer ${firedAt}`);
    const second = new FileWorkstreamAdapter({ directory, lockTimeoutMs: 0 });
    for (const readOnly of [false, true]) await assert.rejects(second.transaction(() => assert.fail("entered under owner"), { readOnly }), busy);
  } finally { clearTimeout(timer); await owner.release(); }
  assert.equal(await readFile(adapter.file, "utf8"), bytes);
  assert.equal((await store.list())[0].title, request.title);
  t.diagnostic(JSON.stringify({ busyMs: elapsed, boundMs: 120, timer25Ms: firedAt }));
});

test("FIFO queue wait is separate from acquisition budget; zero timeout attempts after dequeue", { skip, timeout: 10_000 }, async (t) => {
  const { adapter } = await setup(t, { lockTimeoutMs: 0 });
  const entered = deferred(), release = deferred();
  const order = [];
  const start = performance.now();
  const first = adapter.transaction(async () => { order.push(1); entered.resolve(); await release.promise; }, { readOnly: true });
  await entered.promise;
  const second = adapter.transaction(() => { order.push(2); }, { readOnly: true });
  const third = adapter.transaction(() => { order.push(3); }, { readOnly: true });
  await new Promise((r) => setTimeout(r, 65));
  release.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, [1, 2, 3]);
  t.diagnostic(JSON.stringify({ queueAndCallbackMs: performance.now() - start, acquisitionBudgetMs: 0 }));
  const primary = Object.freeze(new Error("first failed"));
  await sameThrow(adapter.transaction(() => { throw primary; }), primary);
  await adapter.transaction(() => undefined, { readOnly: true });
});

test("queued contender gets its own full acquisition budget only after dequeue", { skip, timeout: 10_000 }, async (t) => {
  const { directory, adapter } = await setup(t, { lockTimeoutMs: 80, lockRetryIntervalMs: 20 });
  const entered = deferred(), release = deferred(), acquiredElsewhere = deferred(), finishElsewhere = deferred();
  const first = adapter.transaction(async () => { entered.resolve(); await release.promise; }, { readOnly: true });
  await entered.promise;
  const competitor = new FileWorkstreamAdapter({ directory });
  const other = competitor.transaction(async () => { acquiredElsewhere.resolve(); await finishElsewhere.promise; }, { readOnly: true });
  // Enqueue the budgeted operation behind a long callback, then let the other adapter acquire first.
  const original = adapter.acquireLock.bind(adapter);
  let acquisitionStart;
  adapter.acquireLock = async () => { await acquiredElsewhere.promise; acquisitionStart = performance.now(); return original(); };
  const queued = adapter.transaction(() => assert.fail("busy callback entered"), { readOnly: true });
  const observed = assert.rejects(queued, busy);
  await new Promise((r) => setTimeout(r, 100));
  release.resolve();
  await first;
  try { await observed; assert.ok(performance.now() - acquisitionStart <= 100); }
  finally { finishElsewhere.resolve(); await other; }
  t.diagnostic(JSON.stringify({ queueWaitMs: 100, acquisitionMs: performance.now() - acquisitionStart, boundMs: 100 }));
});

test("real child read owner excludes writer; death releases without marker/DB deletion", { skip, timeout: 10_000 }, async (t) => {
  const { directory, adapter, store } = await setup(t, { lockTimeoutMs: 0 });
  await store.create(request);
  const bytes = await readFile(adapter.file, "utf8");
  const marker = await lstat(join(directory, ".workstreams.lock"));
  const database = await lstat(join(directory, ".workstreams-lock.sqlite"));
  const { child, exit } = await childOwner(t, directory);
  await assert.rejects(adapter.transaction(() => assert.fail("overlap")), busy);
  child.kill("SIGKILL");
  assert.deepEqual(await exit, [null, "SIGKILL"]);
  const start = performance.now();
  assert.equal((await store.inspect("ws-1")).title, request.title);
  const elapsed = performance.now() - start;
  assert.equal(await readFile(adapter.file, "utf8"), bytes);
  assert.equal((await lstat(join(directory, ".workstreams.lock"))).ino, marker.ino);
  assert.equal((await lstat(join(directory, ".workstreams-lock.sqlite"))).ino, database.ino);
  t.diagnostic(JSON.stringify({ observedExit: "SIGKILL", recoveryMs: elapsed }));
});

test("real child write owner excludes public/trusted reads until released", { skip, timeout: 10_000 }, async (t) => {
  const { directory, adapter, store } = await setup(t, { lockTimeoutMs: 0 });
  await store.create(request);
  await store.list();
  const { child, exit } = await childOwner(t, directory, "candidate-write");
  await assert.rejects(store.list(), busy);
  await assert.rejects(adapter.transaction(() => assert.fail("read overlap"), { readOnly: true }), busy);
  child.send("release");
  assert.deepEqual(await exit, [0, null]);
  assert.equal((await store.list()).length, 1);
});

test("canonical parent alias/relative path shared by marker SQLite and JSON despite chdir", { skip }, async (t) => {
  const { directory } = await setup(t);
  const actual = join(directory, "actual");
  await mkdir(actual);
  const alias = join(directory, "alias");
  await symlink(actual, alias);
  const path = join(alias, "nested");
  const adapter = new FileWorkstreamAdapter({ directory: relative(process.cwd(), path) });
  const cwd = process.cwd();
  try { process.chdir(directory); await adapter.transaction((db) => { db.nextSequence = 2; }); }
  finally { process.chdir(cwd); }
  assert.equal(adapter.directory, await realpath(path));
  assert.equal(JSON.parse(await readFile(join(actual, "nested", "workstreams.json"), "utf8")).nextSequence, 2);
  assert.deepEqual((await readdir(join(actual, "nested"))).sort(), [".workstreams-lock.sqlite", ".workstreams.lock", "workstreams.json"]);
  const refused = new FileWorkstreamAdapter({ directory: alias });
  await assert.rejects(refused.transaction(() => assert.fail("symlink Store")), (e) => e.code === "LOCK_COORDINATOR_UNAVAILABLE");
});

test("JSON symlink refused by both trusted and public reads without touching target", { skip }, async (t) => {
  const { directory, adapter, store } = await setup(t);
  await store.create(request);
  await store.list();
  const target = join(directory, "target.json");
  const { rename } = await import("node:fs/promises");
  await rename(adapter.file, target);
  const bytes = await readFile(target, "utf8");
  await symlink(target, adapter.file);
  for (const read of [() => store.list(), () => adapter.transaction(() => assert.fail("symlink callback"), { readOnly: true })]) {
    await assert.rejects(read(), (e) => e.code === "CORRUPT_STORE");
    assert.equal(adapter.generation, null);
  }
  assert.equal(await readFile(target, "utf8"), bytes);
});

test("callback/read/write/rename primaries survive secondary rollback+close errors by identity", { skip }, async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  for (const where of ["callback", "read", "write", "before-rename"]) {
    for (const primary of [undefined, null, "primitive", Object.freeze(new Error("frozen")), Object.assign(new Error("original"), { code: "PRIMARY" })]) {
      const { directory } = await setup(t);
      const initial = new FileWorkstreamAdapter({ directory });
      await initial.transaction(() => undefined);
      const bytes = await readFile(initial.file, "utf8");
      const wrapped = instrument(DatabaseSync, (sql) => { if (sql === "ROLLBACK" || sql === "close") throw new Error("secondary private path"); });
      const adapter = new FileWorkstreamAdapter({ directory, [COORDINATOR_TEST]: wrapped.seam, [adapters.TRANSACTION_TEST]: { hook: (phase) => { if (phase === where) throw primary; } } });
      if (where === "read") adapter.readDatabase = async () => { throw primary; };
      if (where === "write") adapter.writeDatabase = async () => { throw primary; };
      await sameThrow(adapter.transaction(() => { if (where === "callback") throw primary; }), primary);
      assert.equal(adapter.generation, null);
      assert.equal(wrapped.state.closed, 1);
      assert.equal(await readFile(initial.file, "utf8"), bytes);
      assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
      await initial.transaction(() => undefined, { readOnly: true });
    }
  }
});

test("temp sync/write/close/remove errors preserve first primary and old JSON", { skip }, async (t) => {
  for (const phase of ["temp-write", "temp-sync", "temp-close", "temp-remove"]) {
    const { directory, adapter } = await setup(t);
    await adapter.transaction(() => undefined);
    const bytes = await readFile(adapter.file, "utf8");
    const primary = Object.freeze(new Error(phase));
    const failing = new FileWorkstreamAdapter({ directory, [adapters.TRANSACTION_TEST]: { hook: (at) => { if (at === phase || (phase === "temp-remove" && at === "before-rename")) throw primary; } } });
    await sameThrow(failing.transaction((db) => { db.nextSequence++; }), primary);
    assert.equal(await readFile(adapter.file, "utf8"), bytes);
    // A remove-hook failure deliberately leaves only this transaction's own temp for inventory.
    assert.equal((await readdir(directory)).filter((name) => name.endsWith(".tmp")).length, phase === "temp-remove" ? 1 : 0);
  }
});

test("sole commit/close/release errors typed sanitized with JSON outcome and actual release", { skip }, async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  for (const operation of ["commit", "close", "release"]) for (const readOnly of [false, true]) {
    const { directory } = await setup(t);
    const raw = new Error("private token/path");
    const wrapped = instrument(DatabaseSync, (sql) => { if (sql === operation.toUpperCase() || (sql === "close" && operation === "close")) throw raw; });
    if (operation === "release") wrapped.seam.hook = (phase) => { if (phase === "release") throw raw; };
    const adapter = new FileWorkstreamAdapter({ directory, [COORDINATOR_TEST]: wrapped.seam });
    await assert.rejects(adapter.transaction(() => undefined, { readOnly }), (error) => {
      assert.equal(error.code, "LOCK_COORDINATOR_UNAVAILABLE");
      assert.deepEqual(error.details, { operation, jsonCommitted: !readOnly });
      assert.equal(error.cause, raw);
      assert.ok(!JSON.stringify(error).includes("private"));
      assert.equal(Object.getOwnPropertyDescriptor(error, "cause").enumerable, false);
      if (!readOnly) assert.match(error.message, /exact same idempotency-key.*after.*release/i);
      return true;
    });
    assert.equal(adapter.generation, null);
    assert.equal(wrapped.state.closed, 1);
    await new FileWorkstreamAdapter({ directory, lockTimeoutMs: 0 }).transaction(() => undefined, { readOnly: true });
    if (!readOnly) assert.equal(JSON.parse(await readFile(adapter.file, "utf8")).formatVersion, 1);
  }
});

test("post-rename cleanup failure: definitely committed JSON, exact retry receipt/no duplicate event", { skip }, async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  for (const step of ["COMMIT", "close", "release"]) {
    const { directory } = await setup(t);
    let fail = true;
    const failure = (at) => { if (at === step && fail) { fail = false; throw new Error(step); } };
    const wrapped = instrument(DatabaseSync, failure);
    wrapped.seam.hook = failure;
    const adapter = new FileWorkstreamAdapter({ directory, [COORDINATOR_TEST]: wrapped.seam });
    const store = new WorkstreamStore({ adapter });
    await assert.rejects(store.create(request), (error) => error.details.jsonCommitted === true);
    const before = JSON.parse(await readFile(adapter.file, "utf8"));
    const lease = await acquireLock(directory, { lockTimeoutMs: 0 });
    await lease.release();
    assert.deepEqual(await store.create(request), before.idempotency[request.idempotencyKey].receipt);
    const after = JSON.parse(await readFile(adapter.file, "utf8"));
    assert.deepEqual(after, before);
    assert.equal(after.events.length, 1);
  }
});

test("phase hooks are symbol injected and run inside lease, rename commit precedes after-rename hook", { skip }, async (t) => {
  const { directory } = await setup(t);
  const phases = [];
  const primary = Object.freeze(new Error("after rename"));
  const adapter = new FileWorkstreamAdapter({ directory, [adapters.TRANSACTION_TEST]: { hook: async (phase) => {
    phases.push(phase);
    if (["acquired", "json-read", "temp-synced", "before-rename", "after-rename"].includes(phase)) await assert.rejects(acquireLock(directory, { lockTimeoutMs: 0 }), busy);
    if (phase === "after-rename") throw primary;
  } } });
  await sameThrow(adapter.transaction((db) => { db.nextSequence = 42; }), primary);
  assert.equal(JSON.parse(await readFile(adapter.file, "utf8")).nextSequence, 42);
  for (const phase of ["acquired", "json-read", "temp-synced", "before-rename", "after-rename"]) assert.ok(phases.includes(phase));
  await (await acquireLock(directory, { lockTimeoutMs: 0 })).release();
});


test("adapter fake-clock deadline closes each busy handle and never calls back after rejection", { skip }, async (t) => {
  let now = 0, opened = 0, closed = 0, callbacks = 0;
  class DatabaseSync {
    constructor() { opened++; }
    exec(sql) { if (sql === "BEGIN IMMEDIATE") throw Object.assign(new Error("not message evidence"), { errcode: 261 }); }
    prepare() { return { get: () => ({ timeout: 0 }) }; }
    close() { closed++; }
  }
  const { adapter } = await setup(t, { lockTimeoutMs: 45, lockRetryIntervalMs: 20, [COORDINATOR_TEST]: {
    importSQLite: async () => ({ DatabaseSync }), clock: () => now,
    sleep: async (ms) => { assert.equal(opened, closed); now += ms; },
  } });
  await assert.rejects(adapter.transaction(() => { callbacks++; }), busy);
  await Promise.resolve();
  assert.deepEqual({ now, opened, closed, callbacks }, { now: 45, opened: 3, closed: 3, callbacks: 0 });
});

test("read errors retain identity through JSON handle close and SQLite rollback/close errors", { skip }, async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  for (const trusted of [false, true]) {
    const { directory, adapter: seed } = await setup(t);
    await seed.transaction(() => undefined);
    const primary = Object.freeze(Object.assign(new Error("read"), { code: "READ_PRIMARY" }));
    const wrapped = instrument(DatabaseSync, (sql) => { if (["ROLLBACK", "close"].includes(sql)) throw new Error("secondary"); });
    const adapter = new FileWorkstreamAdapter({ directory, [COORDINATOR_TEST]: wrapped.seam });
    const original = adapter.openDatabase.bind(adapter);
    adapter.openDatabase = async () => {
      const handle = await original();
      return { stat: (...args) => handle.stat(...args), readFile: async () => { throw primary; }, close: async () => { await handle.close(); throw new Error("json close"); } };
    };
    const { TRUSTED_READ } = await import("../src/model.js");
    await sameThrow(adapter.transaction(() => assert.fail("read failed"), { readOnly: true, [TRUSTED_READ]: trusted }), primary);
    assert.equal(wrapped.state.closed, 1);
    await seed.transaction(() => undefined, { readOnly: true });
  }
});

test("rename syscall and temp cleanup errors retain original identity; no JSON commit", { skip }, async (t) => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const { directory, adapter: seed } = await setup(t);
  await seed.transaction(() => undefined);
  const bytes = await readFile(seed.file, "utf8");
  const primary = Object.freeze(Object.assign(new Error("rename"), { code: "RENAME_PRIMARY" }));
  const original = fs.rename;
  const { DatabaseSync } = await import("node:sqlite");
  const wrapped = instrument(DatabaseSync, (sql) => { if (["ROLLBACK", "close"].includes(sql)) throw new Error("secondary"); });
  const adapter = new FileWorkstreamAdapter({ directory, [COORDINATOR_TEST]: wrapped.seam, [adapters.TRANSACTION_TEST]: { hook: (phase) => { if (phase === "temp-remove") throw new Error("remove"); } } });
  fs.rename = async (from, to) => { if (to === seed.file) throw primary; return original(from, to); };
  syncBuiltinESMExports();
  try { await sameThrow(adapter.transaction((db) => { db.nextSequence++; }), primary); }
  finally { fs.rename = original; syncBuiltinESMExports(); }
  assert.equal(await readFile(seed.file, "utf8"), bytes);
  assert.equal((await readdir(directory)).filter((name) => name.endsWith(".tmp")).length, 1);
  assert.equal(wrapped.state.closed, 1);
  await seed.transaction(() => undefined, { readOnly: true });
});

test("earlier callback error survives release hook failure and close; successful cleanup does not mask it", { skip }, async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  for (const primary of [undefined, null, "primitive", Object.freeze(new Error("frozen")), new Error("original")]) {
    const wrapped = instrument(DatabaseSync, (sql) => { if (sql === "close") throw new Error("close"); });
    wrapped.seam.hook = (phase) => { if (phase === "release") throw new Error("release"); };
    const { directory, adapter } = await setup(t, { [COORDINATOR_TEST]: wrapped.seam });
    await sameThrow(adapter.transaction(() => { throw primary; }), primary);
    assert.equal(wrapped.state.closed, 1);
    assert.ok(wrapped.state.commands.includes("ROLLBACK"));
    await new FileWorkstreamAdapter({ directory, lockTimeoutMs: 0 }).transaction(() => undefined, { readOnly: true });
  }
});
