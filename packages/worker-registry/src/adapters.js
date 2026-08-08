import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";

const FORMAT_VERSION = 1;

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
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (Date.now() >= deadline) fail("STORE_BUSY", "timed out waiting for the worker registry lock");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }
}
