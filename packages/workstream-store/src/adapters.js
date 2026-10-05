import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TRUSTED_READ, clone } from "./model.js";
import { fail } from "./errors.js";

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
  constructor({ directory, eventRetention = 1_000, lockTimeoutMs = 5_000 } = {}) {
    if (typeof directory !== "string" || directory.length === 0) throw new TypeError("directory is required");
    validateRetention(eventRetention);
    this.directory = directory;
    this.file = join(directory, "workstreams.json");
    this.lockDirectory = join(directory, ".workstreams.lock");
    this.eventRetention = eventRetention;
    this.lockTimeoutMs = lockTimeoutMs;
    this.queue = Promise.resolve();
    // Last validated file generation, lent only to TRUSTED_READ callbacks and revalidated under the lock.
    this.generation = null;
  }

  transaction(callback, options = {}) {
    const { readOnly = false } = options;
    const trusted = readOnly && options[TRUSTED_READ] === true;
    const operation = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.acquireLock();
      try {
        if (!readOnly) this.generation = null;
        const database = trusted ? await this.readTrustedDatabase() : await this.readDatabase();
        const result = await callback(database);
        if (!readOnly) await this.writeDatabase(database);
        return clone(result);
      } finally {
        await rm(this.lockDirectory, { recursive: true, force: true });
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  // Caller must hold the lock. Reuses the cached generation only while the open file keeps the same
  // identity, size, mtime, and ctime; any change, deletion, or read error drops it.
  async readTrustedDatabase() {
    let handle;
    try {
      handle = await open(this.file, "r");
      const before = await handle.stat({ bigint: true });
      if (this.generation && sameGeneration(this.generation.stat, before)) return this.generation.database;
      this.generation = null;
      const database = await this.readDatabase(handle);
      if (sameGeneration(before, await handle.stat({ bigint: true }))) this.generation = { stat: before, database };
      return database;
    } catch (error) {
      this.generation = null;
      if (error?.code === "ENOENT") return emptyDatabase(this.eventRetention);
      if (error?.code === "CORRUPT_STORE") throw error;
      fail("CORRUPT_STORE", `cannot read workstream store: ${error.message}`);
    } finally {
      await handle?.close();
    }
  }

  async readDatabase(source = this.file) {
    try {
      const database = JSON.parse(await readFile(source, "utf8"));
      validateDatabase(database);
      return database;
    } catch (error) {
      if (error?.code === "ENOENT") return emptyDatabase(this.eventRetention);
      if (error?.code === "CORRUPT_STORE") throw error;
      fail("CORRUPT_STORE", `cannot read workstream store: ${error.message}`);
    }
  }

  async writeDatabase(database) {
    validateDatabase(database);
    const temporary = join(this.directory, `.workstreams-${process.pid}-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(database)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.file);
  }

  async acquireLock() {
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        await mkdir(this.lockDirectory, { mode: 0o700 });
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (Date.now() >= deadline) fail("STORE_BUSY", "timed out waiting for the workstream store lock");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }
}

function sameGeneration(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function validateRetention(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("eventRetention must be a positive safe integer");
}
