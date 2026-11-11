import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { FileWorkstreamAdapter } from "./fixtures/legacy-adapters.js";
import { isolatedRoot, missingIsolation } from "./fixtures/lock-owner-child.mjs";

const absent = missingIsolation();
const options = { timeout: 10_000, skip: absent.length ? `missing isolation: ${absent.join(", ")}` : false };
if (!absent.length) await isolatedRoot();

const childFixture = new URL("./fixtures/lock-owner-child.mjs", import.meta.url);

async function fixture(t) {
  const root = await isolatedRoot();
  const directory = await mkdtemp(join(root, "lock-evidence-"));
  const cleanups = [];
  t.after(async () => {
    try {
      await Promise.all(cleanups.map((cleanup) => cleanup()));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  const adapter = new FileWorkstreamAdapter({ directory, lockTimeoutMs: 80 });
  await adapter.transaction(() => undefined);
  const original = await readFile(join(directory, "workstreams.json"), "utf8");
  return { directory, adapter, original, startOwner: (mode) => owner(cleanups, mode, directory) };
}

async function owner(cleanups, mode, directory) {
  const child = fork(childFixture, [mode, directory], { silent: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4_000); });
  child.stdout.resume();
  const exited = once(child, "exit");
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 5_000);
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    clearTimeout(watchdog);
  });
  const message = await Promise.race([
    once(child, "message").then(([message]) => message),
    exited.then(([code, signal]) => { throw new Error(`fixture exited before acquisition: ${code}/${signal}: ${stderr}`); }),
  ]);
  assert.equal(message.event, "acquired");
  assert.equal(message.mode, mode);
  assert.equal(message.version, process.version);
  return {
    child,
    async kill() {
      assert.equal(child.kill("SIGKILL"), true);
      const [code, signal] = await exited;
      clearTimeout(watchdog);
      assert.equal(code, null);
      assert.equal(signal, "SIGKILL");
    },
  };
}

async function unchanged(directory, original) {
  const contents = await readFile(join(directory, "workstreams.json"), "utf8");
  assert.equal(contents, original);
  assert.equal(JSON.parse(contents).formatVersion, 1);
}

test("red evidence: baseline legacy owner death leaves STORE_BUSY without entering the successor", options, async (t) => {
  const { directory, adapter, original, startOwner } = await fixture(t);
  const holder = await startOwner("legacy");
  await holder.kill();
  const start = performance.now();
  let entered = false;
  await assert.rejects(adapter.transaction(() => { entered = true; }), (error) => error.code === "STORE_BUSY");
  const elapsedMs = performance.now() - start;
  assert.equal(entered, false);
  assert.ok(elapsedMs >= 80 && elapsedMs < 500, `bounded STORE_BUSY: ${elapsedMs}ms`);
  assert.ok((await stat(join(directory, ".workstreams.lock"))).isDirectory());
  await unchanged(directory, original);
  t.diagnostic(JSON.stringify({ evidence: "baseline-legacy-orphan", version: process.version, outcome: "STORE_BUSY", elapsedMs, entered, inventory: await readdir(directory) }));
});

test("rejected design: delayed stale rename displaces a live successor and admits another owner", options, async (t) => {
  const { directory, original, startOwner } = await fixture(t);
  const lock = join(directory, ".workstreams.lock");
  const stale = await startOwner("legacy");
  await stale.kill();
  const observedStale = await stat(lock, { bigint: true });
  // Barrier 1: a delayed contender has observed stale evidence but has not renamed.
  await rm(lock, { recursive: true }); // Another contender completed stale cleanup.
  const successor = await startOwner("legacy");
  const liveIdentity = await stat(lock, { bigint: true });
  // Inode reuse is legal; keep the observed stat only as evidence, never as authority.
  const displaced = join(directory, "rejected-takeover");
  // Barrier 2: the successor is confirmed inside its callback before the delayed rename.
  await rename(lock, displaced);
  assert.equal((await stat(displaced, { bigint: true })).ino, liveIdentity.ino);
  assert.equal(successor.child.signalCode, null);
  assert.equal(successor.child.exitCode, null);
  const third = await startOwner("legacy");
  assert.equal(successor.child.exitCode, null, "successor is still in its critical section");
  assert.equal(third.child.exitCode, null, "another owner entered concurrently");
  await unchanged(directory, original);
  t.diagnostic(JSON.stringify({ evidence: "rejected-rename", version: process.version, staleInode: String(observedStale.ino), displacedLiveInode: String(liveIdentity.ino), simultaneousOwners: 2, inventory: await readdir(directory) }));
  await third.kill();
  await successor.kill();
});

test("SQLite primitive: zero-timeout code 5 yields to timers and acquires after observed owner death", options, async (t) => {
  const { directory, original, startOwner } = await fixture(t);
  const holder = await startOwner("sqlite");
  const file = join(directory, ".workstreams-lock.sqlite");
  const attempts = [];
  const started = performance.now();
  let timerMs;
  const timer = setTimeout(() => { timerMs = performance.now() - started; }, 25);
  t.after(() => clearTimeout(timer));
  do {
    const attemptStart = performance.now();
    const database = new DatabaseSync(file);
    try {
      database.exec("PRAGMA busy_timeout = 0");
      const timeout = database.prepare("PRAGMA busy_timeout").get().timeout;
      assert.equal(timeout, 0);
      assert.throws(() => database.exec("BEGIN IMMEDIATE"), (error) => {
        assert.equal(error.code, "ERR_SQLITE_ERROR");
        assert.equal(error.errcode, 5);
        attempts.push({ code: error.errcode, elapsedMs: performance.now() - attemptStart });
        return true;
      });
    } finally {
      database.close();
    }
    await sleep(10); // Probe only: mirrors the proposed async retry, not production integration.
  } while (performance.now() - started < 180);
  const contentionMs = performance.now() - started;
  assert.ok(attempts.length >= 3);
  assert.ok(attempts.every(({ elapsedMs }) => elapsedMs < 100), "each synchronous attempt must return immediately, not consume a native busy wait");
  assert.ok(timerMs >= 20 && timerMs < 125, `25ms timer fired at ${timerMs}ms`);
  assert.ok(contentionMs < 500);
  await holder.kill(); // Waits for the actual exit event, not PID/age inference.
  const recoveryStart = performance.now();
  const successor = new DatabaseSync(file);
  try {
    successor.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE; COMMIT");
  } finally {
    successor.close();
  }
  const postDeathAcquisitionMs = performance.now() - recoveryStart;
  assert.ok(postDeathAcquisitionMs < 100);
  await unchanged(directory, original);
  t.diagnostic(JSON.stringify({ evidence: "sqlite-primitive", version: process.version, execPath: process.execPath, busyTimeoutMs: 0, attempts, contentionMs, timerRequestedMs: 25, timerMs, observedDeath: "SIGKILL", postDeathAcquired: true, postDeathAcquisitionMs, inventory: await readdir(directory) }));
});
