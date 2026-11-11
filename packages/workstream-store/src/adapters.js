import { constants } from "node:fs";
import { lstat, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { TRUSTED_READ, clone } from "./model.js";
import { fail } from "./errors.js";
import { acquireLock, annotateCleanup, COORDINATOR_TEST } from "./lock-coordinator.js";

export const TRANSACTION_TEST = Symbol("workstream-store.transactionTest");

const FORMAT_VERSION = 1;

function emptyDatabase(eventRetention) {
  return {
    formatVersion: FORMAT_VERSION,
    eventRetention,
    nextSequence: 1,
    workstreams: {},
    idempotency: {},
    events: [],
  };
}

function validateDatabase(database) {
  if (!database || database.formatVersion !== FORMAT_VERSION || !Number.isSafeInteger(database.nextSequence) ||
      !database.workstreams || !database.idempotency || !Array.isArray(database.events)) {
    fail("CORRUPT_STORE", "workstream store file has an unsupported or invalid format");
  }
}

export class InMemoryWorkstreamAdapter {
  constructor({ eventRetention = 1_000, state } = {}) {
    validateRetention(eventRetention);
    this.database = state ? clone(state) : emptyDatabase(eventRetention);
    validateDatabase(this.database);
    this.queue = Promise.resolve();
  }

  transaction(callback, { readOnly = false } = {}) {
    const operation = this.queue.then(async () => {
      const working = clone(this.database);
      const result = await callback(working);
      if (!readOnly) this.database = working;
      return clone(result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async exportState() {
    await this.queue;
    return clone(this.database);
  }
}

export class FileWorkstreamAdapter {
  constructor({ directory, eventRetention = 1_000, lockTimeoutMs = 5_000, lockRetryIntervalMs = 20,
    [COORDINATOR_TEST]: coordinatorTest, [TRANSACTION_TEST]: testHooks } = {}) {
    if (typeof directory !== "string" || directory.length === 0) throw new TypeError("directory is required");
    validateRetention(eventRetention);
    if (typeof lockTimeoutMs !== "number" || !Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0) throw new TypeError("lockTimeoutMs must be finite and nonnegative");
    if (typeof lockRetryIntervalMs !== "number" || !Number.isFinite(lockRetryIntervalMs) || lockRetryIntervalMs <= 0) throw new TypeError("lockRetryIntervalMs must be finite and positive");
    // Freeze relative paths before any queued work or caller chdir; acquisition canonicalizes aliases.
    this.directory = resolve(directory);
    this.file = join(this.directory, "workstreams.json");
    this.lockDirectory = join(this.directory, ".workstreams.lock");
    this.eventRetention = eventRetention;
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockRetryIntervalMs = lockRetryIntervalMs;
    this.coordinatorTest = coordinatorTest;
    this.testHooks = testHooks;
    this.queue = Promise.resolve();
    // Last validated file generation, lent only to TRUSTED_READ callbacks and revalidated under the lock.
    this.generation = null;
  }

  transaction(callback, options = {}) {
    const { readOnly = false } = options;
    const trusted = readOnly && options[TRUSTED_READ] === true;
    const operation = this.queue.then(async () => {
      let lease, result, primary, failed = false, jsonCommitted = false;
      try {
        lease = await this.acquireLock();
        this.directory = lease.directory;
        this.file = join(this.directory, "workstreams.json");
        this.lockDirectory = join(this.directory, ".workstreams.lock");
        await this.testHooks?.hook?.("acquired");
        if (!readOnly) this.generation = null;
        const database = trusted ? await this.readTrustedDatabase() : await this.readDatabase();
        await this.testHooks?.hook?.("json-read");
        result = await callback(database);
        if (!readOnly) await this.writeDatabase(database, () => { jsonCommitted = true; });
        // Trusted Store callbacks already detach their results from the generation.
        result = trusted ? result : clone(result);
      } catch (error) { failed = true; primary = error; }
      try {
        if (lease) await lease.release({ failed, jsonCommitted, ...(failed ? { primary } : {}) });
        else if (failed) throw primary;
      } catch (error) { this.generation = null; throw error; }
      return result;
    });
    // ponytail: queue/callback latency is unbounded; add a separately approved end-to-end budget if needed.
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  // Caller must hold the lock. Reuses the cached generation only while the open file keeps the same
  // identity, size, mtime, and ctime; any change, deletion, or read error drops it.
  async readTrustedDatabase() {
    let handle, primary, failed = false;
    try {
      handle = await this.openDatabase();
      const before = await handle.stat({ bigint: true });
      if (this.generation && sameGeneration(this.generation.stat, before)) return this.generation.database;
      this.generation = null;
      const database = await this.readDatabase(handle);
      if (sameGeneration(before, await handle.stat({ bigint: true }))) this.generation = { stat: before, database };
      return database;
    } catch (error) {
      this.generation = null;
      if (error?.code === "ENOENT") return emptyDatabase(this.eventRetention);
      failed = true;
      primary = error;
      throw error;
    } finally {
      try { await handle?.close(); } catch (error) {
        if (!failed) throw error;
        annotateCleanup(primary, [{ operation: "json-close" }]);
      }
    }
  }

  async openDatabase() {
    const before = await lstat(this.file);
    if (!before.isFile() || before.isSymbolicLink()) fail("CORRUPT_STORE", "Unsafe workstream store file");
    const handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const descriptor = await handle.stat();
      if (!descriptor.isFile() || before.dev !== descriptor.dev || before.ino !== descriptor.ino) fail("CORRUPT_STORE", "Workstream store file identity changed");
      return handle;
    } catch (error) {
      try { await handle.close(); } catch { annotateCleanup(error, [{ operation: "json-close" }]); }
      throw error;
    }
  }

  async readDatabase(source) {
    let handle, primary, failed = false;
    try {
      handle = source ?? await this.openDatabase();
      let database;
      try { database = JSON.parse(await handle.readFile("utf8")); } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        fail("CORRUPT_STORE", "workstream store file contains invalid JSON");
      }
      validateDatabase(database);
      return database;
    } catch (error) {
      if (error?.code === "ENOENT") return emptyDatabase(this.eventRetention);
      failed = true;
      primary = error;
      throw error;
    } finally {
      if (!source) try { await handle?.close(); } catch (error) {
        if (!failed) throw error;
        annotateCleanup(primary, [{ operation: "json-close" }]);
      }
    }
  }

  async writeDatabase(database, committed = () => {}) {
    validateDatabase(database);
    const temporary = join(this.directory, `.workstreams-${process.pid}-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    let primary, failed = false, renamed = false;
    const hook = (phase) => this.testHooks?.hook?.(phase);
    try {
      try {
        await hook("temp-write");
        await handle.writeFile(`${JSON.stringify(database)}\n`, "utf8");
        await hook("temp-sync");
        await handle.sync();
        await hook("temp-synced");
      } catch (error) { failed = true; primary = error; }
      try { await handle.close(); await hook("temp-close"); } catch (error) {
        if (!failed) { failed = true; primary = error; }
        else annotateCleanup(primary, [{ operation: "temp-close" }]);
      }
      if (failed) throw primary;
      await hook("before-rename");
      await rename(temporary, this.file);
      renamed = true;
      committed(); // JSON rename, not SQLite COMMIT, is the data commit point.
      await hook("after-rename");
    } catch (error) {
      if (!renamed) try { await hook("temp-remove"); await rm(temporary, { force: true }); }
      catch { annotateCleanup(error, [{ operation: "temp-remove" }]); }
      throw error;
    }
  }

  async acquireLock() {
    return acquireLock(this.directory, {
      lockTimeoutMs: this.lockTimeoutMs, lockRetryIntervalMs: this.lockRetryIntervalMs,
      [COORDINATOR_TEST]: this.coordinatorTest,
    });
  }
}

function sameGeneration(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function validateRetention(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("eventRetention must be a positive safe integer");
}
