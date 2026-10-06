import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";

const FORMAT_VERSION = 1;
// An ownerless lock (crash between mkdir and owner write, or a pre-owner-file lock) is reclaimable after this age.
const OWNERLESS_LOCK_STALE_MS = 60_000;

function processIsDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function emptyDatabase() {
  return { formatVersion: FORMAT_VERSION, workers: {} };
}

function validateDatabase(database) {
  if (!database || database.formatVersion !== FORMAT_VERSION || typeof database.workers !== "object" || database.workers === null || Array.isArray(database.workers)) {
    fail("CORRUPT_STORE", "worker registry file has an unsupported or invalid format");
  }
}

export class InMemoryWorkerAdapter {
  constructor({ state } = {}) {
    this.database = state ? structuredClone(state) : emptyDatabase();
    validateDatabase(this.database);
    this.queue = Promise.resolve();
  }

  transaction(callback, { readOnly = false } = {}) {
    const operation = this.queue.then(async () => {
      const working = structuredClone(this.database);
      const result = await callback(working);
      if (!readOnly) this.database = working;
      return structuredClone(result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async exportState() {
    await this.queue;
    return structuredClone(this.database);
  }
}

export class FileWorkerAdapter {
  constructor({ directory, lockTimeoutMs = 5_000 } = {}) {
    if (typeof directory !== "string" || directory.length === 0) throw new TypeError("directory is required");
    this.directory = directory;
    this.file = join(directory, "workers.json");
    this.lockDirectory = join(directory, ".workers.lock");
    this.lockOwnerFile = join(this.lockDirectory, "owner.json");
    this.reclaimDirectory = join(directory, ".workers.lock.reclaim");
    this.lockTimeoutMs = lockTimeoutMs;
    this.queue = Promise.resolve();
  }

  transaction(callback, { readOnly = false } = {}) {
    const operation = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.acquireLock();
      try {
        const database = await this.readDatabase();
        const result = await callback(database);
        if (!readOnly) await this.writeDatabase(database);
        return structuredClone(result);
      } finally {
        await rm(this.lockDirectory, { recursive: true, force: true });
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async readDatabase() {
    try {
      const database = JSON.parse(await readFile(this.file, "utf8"));
      validateDatabase(database);
      return database;
    } catch (error) {
      if (error?.code === "ENOENT") return emptyDatabase();
      if (error?.code === "CORRUPT_STORE") throw error;
      fail("CORRUPT_STORE", `cannot read worker registry: ${error.message}`);
    }
  }

  async writeDatabase(database) {
    validateDatabase(database);
    const temporary = join(this.directory, `.workers-${process.pid}-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(database, null, 2)}\n`, "utf8");
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
        await writeFile(this.lockOwnerFile, JSON.stringify({ pid: process.pid, host: hostname() }), { mode: 0o600 })
          .catch(async (error) => { await rm(this.lockDirectory, { recursive: true, force: true }); throw error; });
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (await this.reclaimOrphanedLock()) continue;
        if (Date.now() >= deadline) fail("STORE_BUSY", "timed out waiting for the worker registry lock");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }

  // Reclaimers serialize on a second directory so two waiters cannot both judge and remove the same lock;
  // only a dead same-host owner or an old ownerless lock is removed, never a live slow one.
  async reclaimOrphanedLock() {
    try {
      await mkdir(this.reclaimDirectory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      // ponytail: a reclaimer is held for milliseconds, so an old one crashed; age-based removal can race another waiter doing the same.
      if (await this.olderThan(this.reclaimDirectory, OWNERLESS_LOCK_STALE_MS)) await rm(this.reclaimDirectory, { recursive: true, force: true });
      return false;
    }
    try {
      if (!(await this.lockIsOrphaned())) return false;
      await rm(this.lockDirectory, { recursive: true, force: true });
      return true;
    } finally {
      await rm(this.reclaimDirectory, { recursive: true, force: true });
    }
  }

  async lockIsOrphaned() {
    let owner;
    try {
      owner = JSON.parse(await readFile(this.lockOwnerFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (Number.isInteger(owner?.pid) && owner.pid > 0) return owner.host === hostname() && processIsDead(owner.pid);
    // Read the owner before stat: a lock recreated in between has a fresh mtime and is left alone.
    return this.olderThan(this.lockDirectory, OWNERLESS_LOCK_STALE_MS);
  }

  async olderThan(path, ageMs) {
    try {
      return Date.now() - (await stat(path)).mtimeMs > ageMs;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }
}
