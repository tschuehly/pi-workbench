import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { ensureMarker, optionalStat, PROTOCOL_TEST } from "./lock-protocol.js";
import { fail, lockUnavailable, WorkstreamStoreError } from "./errors.js";

export const COORDINATOR_TEST = Symbol("workstream-store.coordinatorTest");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const primaryCode = (error) => Number.isInteger(error?.errcode) ? error.errcode & 255 : undefined;
function operational(error, operation) {
  if (error instanceof WorkstreamStoreError) return error;
  if ([11, 26].includes(primaryCode(error))) {
    return new WorkstreamStoreError("CORRUPT_STORE", "Malformed SQLite lock database; preserve artifacts for attended diagnosis.", { operation });
  }
  return lockUnavailable(operation, error);
}
function supported(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match && (+match[1] > 24 || (+match[1] === 24 && (+match[2] > 13 || (+match[2] === 13 && +match[3] >= 0))));
}
async function preflight(seam) {
  try {
    if (!supported(seam.version ?? process.versions.node)) throw new Error("unsupported runtime");
    const module = await (seam.importSQLite ?? (() => import("node:sqlite")))();
    if (typeof module.DatabaseSync !== "function") throw new Error("missing DatabaseSync");
    return module.DatabaseSync;
  } catch (error) { throw lockUnavailable("preflight", error); }
}
async function validateDatabasePaths(directory) {
  // Metadata only: opening/closing a raw DB descriptor could drop another same-process SQLite lease.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const stat = await optionalStat(join(directory, `.workstreams-lock.sqlite${suffix}`));
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) fail("CORRUPT_STORE", "Unsafe SQLite lock path; preserve artifacts for attended diagnosis.");
  }
}
export function annotateCleanup(primary, diagnostics) {
  try {
    if (primary && (typeof primary === "object" || typeof primary === "function") && Object.isExtensible(primary)) {
      Object.defineProperty(primary, "cleanupDiagnostics", { value: diagnostics, configurable: true });
    }
  } catch { /* Best effort only: frozen/primitive/proxy primaries must retain identity. */ }
}
function makeLease(database, directory, hook) {
  let used = false;
  return {
    directory,
    async release(options = {}) {
      const jsonCommitted = options.jsonCommitted === true;
      if (used) throw lockUnavailable("release", undefined, jsonCommitted);
      used = true;
      let hasPrimary = Object.hasOwn(options, "primary"), primary = options.primary;
      const diagnostics = [];
      const attempt = async (operation, callback) => {
        try { await callback(); return true; } catch (cause) {
          if (!hasPrimary) { primary = lockUnavailable(operation, cause, jsonCommitted); hasPrimary = true; }
          else diagnostics.push({ operation });
          return false;
        }
      };
      try {
        const healthy = await attempt("release", () => hook?.("release"));
        if (options.failed || !healthy) await attempt("rollback", () => database.exec("ROLLBACK"));
        else if (!await attempt("commit", () => database.exec("COMMIT"))) await attempt("rollback", () => database.exec("ROLLBACK"));
      } finally { await attempt("close", () => database.close()); }
      if (hasPrimary) {
        if (diagnostics.length) annotateCleanup(primary, diagnostics);
        throw primary;
      }
    },
  };
}

// Internal injection only. Capability failure remains asynchronous.
export async function acquireLock(directory, options = {}) {
  const timeout = options.lockTimeoutMs ?? 5_000;
  const interval = options.lockRetryIntervalMs ?? 20;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) throw new TypeError("lockTimeoutMs must be finite and nonnegative");
  if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) throw new TypeError("lockRetryIntervalMs must be finite and positive");
  const seam = options[COORDINATOR_TEST] ?? {};
  const clock = seam.clock ?? (() => performance.now());
  const wait = seam.sleep ?? sleep;
  const deadline = clock() + timeout;
  // Import/version capability gate BEFORE any marker mutation; engines alone are not enforcement.
  const DatabaseSync = await preflight(seam);
  directory = await ensureMarker(directory, {
    deadline, lockRetryIntervalMs: interval,
    [PROTOCOL_TEST]: { ...seam.protocol, clock, sleep: wait },
  });
  let first = true;
  for (;;) {
    // A zero budget still permits exactly one immediate attempt after dequeue/marker validation.
    if (!first && clock() >= deadline) fail("STORE_BUSY", "Timed out acquiring SQLite workstream lock.");
    first = false;
    let database, acquired = false, failure;
    try {
      await validateDatabasePaths(directory);
      database = new DatabaseSync(join(directory, ".workstreams-lock.sqlite"));
      await validateDatabasePaths(directory);
      try {
        database.exec("PRAGMA busy_timeout = 0");
        const row = database.prepare("PRAGMA busy_timeout").get();
        if (!row || Object.values(row).length !== 1 || Object.values(row)[0] !== 0) throw lockUnavailable("busy-timeout");
      } catch (error) { throw operational(error, "busy-timeout"); }
      database.exec("BEGIN IMMEDIATE");
      acquired = true;
      await seam.hook?.("acquired");
      return makeLease(database, directory, seam.hook);
    } catch (error) {
      failure = error;
      if (acquired) {
        // Hook failure still owns a lease: rollback/close without masking its primary.
        await makeLease(database, directory, seam.hook).release({ failed: true, primary: error });
      }
    } finally {
      if (database && !acquired) {
        try { database.close(); } catch (error) {
          // A failed busy attempt with uncertain handle health cannot safely retry.
          if (primaryCode(failure) === 5) throw lockUnavailable("close", error, false);
          const primary = operational(failure, "acquire");
          annotateCleanup(primary, [{ operation: "close" }]);
          throw primary;
        }
      }
    }
    if (primaryCode(failure) !== 5) throw operational(failure, "acquire");
    const remaining = deadline - clock();
    if (remaining <= 0) fail("STORE_BUSY", "Timed out acquiring SQLite workstream lock.");
    await wait(Math.min(interval, remaining));
  }
}
