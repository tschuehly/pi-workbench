// Opt-in diagnostic preload: measures the actual adapter acquisition; never loaded by production.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import { FileWorkstreamAdapter } from "../../src/adapters.js";
import { isolatedRoot } from "./lock-owner-child.mjs";

await isolatedRoot();
const context = new AsyncLocalStorage();
function measure(trace, stage, operation) {
  const start = performance.now();
  try { return operation(); }
  finally { trace.events.push({ stage, at: start - trace.start, ms: performance.now() - start }); }
}
async function measureAsync(trace, stage, operation) {
  const start = performance.now();
  try { return await operation(); }
  finally { trace.events.push({ stage, at: start - trace.start, ms: performance.now() - start }); }
}
// Async durations include threadpool/OS scheduling, not just filesystem service time.
for (const name of ["realpath", "lstat", "mkdir", "open"]) {
  const original = fs[name];
  fs[name] = async (...args) => {
    const trace = context.getStore();
    if (!trace) return original(...args);
    return measureAsync(trace, `fs.${name}`, async () => {
      const result = await original(...args);
      if (name === "open") for (const method of ["stat", "readFile", "close"]) {
        const call = result[method].bind(result);
        result[method] = (...values) => measureAsync(trace, `marker.${method}`, () => call(...values));
      }
      return result;
    });
  };
}
syncBuiltinESMExports();
const original = FileWorkstreamAdapter.prototype.acquireLock;
FileWorkstreamAdapter.prototype.acquireLock = async function () {
  // Select the unchanged P2-BOUND case; leave fake-clock and unrelated tests alone.
  if (this.lockTimeoutMs !== 100 || this.lockRetryIntervalMs !== 20 || this.coordinatorTest) return original.call(this);
  const trace = { tag: "P2-BOUND-DIAG", pid: process.pid, start: performance.now(), events: [] };
  const utilization = performance.eventLoopUtilization();
  let previous = trace.start, maxLoopGapMs = 0, outcome;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxLoopGapMs = Math.max(maxLoopGapMs, now - previous);
    previous = now;
  }, 2);
  const prior = this.coordinatorTest;
  this.coordinatorTest = {
    clock: () => {
      const now = performance.now();
      trace.events.push({ stage: "clock", at: now - trace.start });
      return now;
    },
    importSQLite: async () => measureAsync(trace, "preflight", async () => {
      const { DatabaseSync } = await import("node:sqlite");
      return { DatabaseSync: class {
        constructor(path) { this.db = measure(trace, "sqlite.open", () => new DatabaseSync(path)); }
        exec(sql) { return measure(trace, `sqlite.${sql}`, () => this.db.exec(sql)); }
        prepare(sql) {
          const statement = measure(trace, "sqlite.prepare", () => this.db.prepare(sql));
          return { get: () => measure(trace, "sqlite.get", () => statement.get()) };
        }
        close() { return measure(trace, "sqlite.close", () => this.db.close()); }
      } };
    }),
    sleep: async (requestedMs) => {
      const start = performance.now();
      await new Promise((done) => setTimeout(done, requestedMs));
      trace.events.push({ stage: "sleep", at: start - trace.start, requestedMs, ms: performance.now() - start });
    },
  };
  try {
    return await context.run(trace, async () => {
      try { const result = await original.call(this); outcome = "acquired"; return result; }
      catch (error) { outcome = error.code ?? error.name; throw error; }
    });
  } finally {
    clearInterval(heartbeat);
    this.coordinatorTest = prior;
    const elapsedMs = performance.now() - trace.start;
    maxLoopGapMs = Math.max(maxLoopGapMs, performance.now() - previous);
    console.log(JSON.stringify({ ...trace, elapsedMs, outcome, maxLoopGapMs, eventLoopUtilization: performance.eventLoopUtilization(utilization) }));
  }
};
