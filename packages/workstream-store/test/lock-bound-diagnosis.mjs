// Standalone diagnosis, deliberately outside test/*.test.js. Not acceptance evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { FileWorkstreamAdapter } from "../src/adapters.js";
import { acquireLock } from "../src/lock-coordinator.js";
import { isolatedRoot } from "./fixtures/lock-owner-child.mjs";
import "./fixtures/lock-bound-timing.mjs";

assert.ok(["waits", "stall"].includes(process.env.P2_DIAG_CASE), "select predeclared waits or stall diagnostic");
for (const ownerMode of process.env.P2_DIAG_CASE === "waits" ? ["same-process", "child-process"] : ["scheduler-stall"]) {
  test(`P2 diagnosis only: ${ownerMode}`, { timeout: 10_000 }, async (t) => {
    const directory = await mkdtemp(join(await isolatedRoot(), "bound-diag-"));
    let owner, child, exit, watchdog, stall;
    try {
      const seed = await acquireLock(directory);
      await seed.release();
      if (ownerMode === "child-process") {
        child = fork(new URL("./fixtures/lock-owner-child.mjs", import.meta.url), ["candidate", directory], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
        exit = once(child, "exit");
        watchdog = setTimeout(() => child.kill("SIGKILL"), 5_000);
        const [ready] = await Promise.race([once(child, "message"), exit.then(() => { throw new Error("early owner exit"); })]);
        assert.equal(ready.event, "acquired");
      } else owner = await acquireLock(directory);
      const markerBefore = await lstat(join(directory, ".workstreams.lock"));
      const adapter = new FileWorkstreamAdapter({ directory, lockTimeoutMs: 100, lockRetryIntervalMs: 20 });
      let callbacks = 0, timer25Ms;
      const start = performance.now();
      const timer = setTimeout(() => { timer25Ms = performance.now() - start; }, 25);
      const stalls = [];
      if (ownerMode === "scheduler-stall") stall = setTimeout(() => {
        const before = performance.now();
        // Negative scheduler control only: no candidate algorithm can run during this interval.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
        stalls.push({ at: before - start, ms: performance.now() - before });
      }, 90);
      let elapsedMs;
      try {
        await assert.rejects(adapter.transaction(() => { callbacks++; }, { readOnly: true }), { code: "STORE_BUSY" });
        elapsedMs = performance.now() - start;
      } finally { clearTimeout(timer); clearTimeout(stall); }
      assert.equal(callbacks, 0);
      assert.equal((await lstat(join(directory, ".workstreams.lock"))).ino, markerBefore.ino);
      await assert.rejects(acquireLock(directory, { lockTimeoutMs: 0 }), { code: "STORE_BUSY" });
      if (ownerMode === "scheduler-stall") { assert.equal(stalls.length, 1); assert.ok(elapsedMs > 120); }
      t.diagnostic(JSON.stringify({ ownerMode, elapsedMs, unchangedBoundMs: 120, exceedsBound: elapsedMs > 120, timer25Ms, callbacks, stalls }));
    } finally {
      clearTimeout(stall);
      if (owner) await owner.release();
      if (child) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exit;
        clearTimeout(watchdog);
      }
      // A fresh lease after observed release/exit proves no owned lease is left behind.
      const successor = await acquireLock(directory, { lockTimeoutMs: 0 });
      await successor.release();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
