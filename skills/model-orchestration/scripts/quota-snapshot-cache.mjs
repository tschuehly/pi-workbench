#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QUOTA_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 50;

export function readCachedQuotaSnapshot(options = {}) {
  const cachePath = options.cachePath ?? process.env.PI_WORKBENCH_QUOTA_CACHE ?? defaultCachePath();
  const maxAgeMs = options.maxAgeMs ?? QUOTA_CACHE_MAX_AGE_MS;
  const now = options.now ?? (() => Date.now());
  const run = options.run ?? (() => runQuotaAxi(options.quotaArgs ?? ["--json"]));
  const force = options.force === true;

  const cached = force ? undefined : readFreshCache(cachePath, maxAgeMs, now());
  if (cached !== undefined) return cached;

  fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  const lockPath = `${cachePath}.lock`;
  acquireLock(lockPath, now);
  try {
    const filledWhileWaiting = force ? undefined : readFreshCache(cachePath, maxAgeMs, now());
    if (filledWhileWaiting !== undefined) return filledWhileWaiting;

    const result = normalizeResult(run());
    writeCache(cachePath, { version: 1, checkedAt: now(), ...result });
    return result;
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function defaultCachePath() {
  const root = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(root, "pi-workbench", "quota-axi.json");
}

function runQuotaAxi(args) {
  const result = spawnSync("quota-axi", args, { encoding: "utf8" });
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function normalizeResult(result) {
  return {
    status: Number.isInteger(result?.status) ? result.status : 1,
    stdout: typeof result?.stdout === "string" ? result.stdout : "",
    stderr: typeof result?.stderr === "string" ? result.stderr : "",
  };
}

function readFreshCache(cachePath, maxAgeMs, now) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (cached?.version !== 1 || !Number.isFinite(cached.checkedAt) || now - cached.checkedAt >= maxAgeMs || now < cached.checkedAt) return undefined;
    return normalizeResult(cached);
  } catch {
    return undefined;
  }
}

function writeCache(cachePath, entry) {
  const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600 });
  fs.renameSync(temporary, cachePath);
}

function acquireLock(lockPath, now) {
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = now() - fs.statSync(lockPath).mtimeMs;
        if (age >= LOCK_STALE_MS) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
    }
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const refreshKeychain = process.argv[2] === "--refresh-keychain" && process.argv.length === 3;
  if (process.argv.length > (refreshKeychain ? 3 : 2)) {
    console.error("usage: quota-snapshot-cache.mjs [--refresh-keychain]");
    process.exit(2);
  }
  const result = readCachedQuotaSnapshot(refreshKeychain
    ? { force: true, quotaArgs: ["--allow-keychain-prompt", "--json"] }
    : undefined);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status;
}
