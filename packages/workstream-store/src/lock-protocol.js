import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fail, WorkstreamStoreError } from "./errors.js";

export const PROTOCOL_TEST = Symbol("workstream-store.protocolTest");
export const PROTOCOL = Object.freeze({ formatVersion: 1, protocol: "sqlite-transaction-lock" });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const temporary = /^\.(initializing|protocol)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const corrupt = () => fail("CORRUPT_STORE", "Invalid or unsupported lock marker; preserve artifacts for attended diagnosis.");
const busy = () => fail("STORE_BUSY", "Legacy or incomplete lock marker: stop ALL PI WEB and terminal writers, including idle writers, before attended in-place migration; never delete the marker.", { operation: "marker", action: "attended-migration" });

export function validateProtocol(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 2 && value.formatVersion === 1 && value.protocol === PROTOCOL.protocol;
}
export function validateInitialization(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 4 && value.formatVersion === 1 && value.protocol === PROTOCOL.protocol &&
    value.purpose === "construction" && typeof value.operationToken === "string" && uuid.test(value.operationToken);
}
export async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino; }

// Owner-controlled local paths only; metadata checks are not a CAS against hostile same-user mutation.
async function canonicalParent(path) {
  try { return await realpath(path); } catch (error) {
    const parent = dirname(path);
    if (error?.code !== "ENOENT" || parent === path) throw error;
    return join(await canonicalParent(parent), basename(path));
  }
}
export async function validateDirectoryPath(directory) {
  const path = resolve(directory);
  const canonical = join(await canonicalParent(dirname(path)), basename(path));
  const stat = await optionalStat(canonical);
  if (stat?.isSymbolicLink()) fail("LOCK_COORDINATOR_UNAVAILABLE", "Store directory is a symlink; select its canonical real directory path explicitly before retrying.", { operation: "directory" });
  if (stat && !stat.isDirectory()) corrupt();
  return canonical;
}
async function readMetadata(path, validate) {
  const before = await optionalStat(path);
  if (!before) return null;
  if (!before.isFile() || before.isSymbolicLink()) corrupt();
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const descriptor = await handle.stat();
    if (!descriptor.isFile() || !sameIdentity(before, descriptor)) corrupt();
    let value;
    try { value = JSON.parse(await handle.readFile("utf8")); } catch (error) {
      if (error instanceof SyntaxError) corrupt();
      throw error;
    }
    const after = await lstat(path);
    if (!sameIdentity(before, after) || after.isSymbolicLink() || !validate(value)) corrupt();
    return value;
  } finally { await handle?.close(); }
}
export async function inspectMarker(directory) {
  directory = await validateDirectoryPath(directory);
  const marker = join(directory, ".workstreams.lock");
  const stat = await optionalStat(marker);
  if (!stat) return { marker, absent: true };
  if (!stat.isDirectory() || stat.isSymbolicLink()) corrupt();
  for (;;) {
    // Completed protocol is authoritative. Never open/traverse benign leftover entries.
    if (await readMetadata(join(marker, "protocol.json"), validateProtocol)) return { marker, complete: true };
    const names = await readdir(marker);
    // The initializer may publish between the absent read and the directory listing.
    if (names.includes("protocol.json")) continue;
    let retry = false;
    for (const name of names) {
      if (name !== "initializing.json" && !temporary.test(name)) corrupt();
      const entry = await optionalStat(join(marker, name));
      // Only recognized uncommitted temps may disappear through the owner's atomic rename.
      if (!entry && temporary.test(name)) { retry = true; break; }
      if (!entry || !entry.isFile() || entry.isSymbolicLink()) corrupt();
    }
    if (retry) continue;
    return { marker, initialization: await readMetadata(join(marker, "initializing.json"), validateInitialization) };
  }
}
async function atomicMetadata(marker, name, value, hook) {
  const target = join(marker, `${name}.json`);
  if (await optionalStat(target)) corrupt();
  const path = join(marker, `.${name}-${randomUUID()}.tmp`);
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await hook?.(`${name}-temp-synced`);
  } finally { await handle.close(); }
  // Trusted attended model: never knowingly replace an existing authoritative file.
  if (await optionalStat(target)) corrupt();
  await rename(path, target);
}
async function boundary(operation) {
  try { return await operation(); } catch (error) {
    if (error instanceof WorkstreamStoreError) throw error;
    const wrapped = new WorkstreamStoreError("LOCK_COORDINATOR_UNAVAILABLE", "Cannot safely access lock marker; check local directory permissions and storage before retrying.", { operation: "marker" });
    Object.defineProperty(wrapped, "cause", { value: error });
    throw wrapped;
  }
}

// Shared in-place primitive. Matching disk state is necessary, NOT proof of child exit or user authority.
// Only the test supervisor currently calls this for another initializer; no production recovery capability.
export async function completeInitialization(directory, expectedToken, options = {}) {
  return boundary(async () => {
    const state = await inspectMarker(directory);
    if (state.complete) return;
    if (state.absent || !state.initialization || state.initialization.operationToken !== expectedToken) busy();
    await atomicMetadata(state.marker, "protocol", PROTOCOL, options[PROTOCOL_TEST]?.hook);
  });
}

export async function ensureMarker(directory, options = {}) {
  return boundary(async () => {
    const clock = options[PROTOCOL_TEST]?.clock ?? (() => performance.now());
    const wait = options[PROTOCOL_TEST]?.sleep ?? sleep;
    const deadline = options.deadline ?? clock() + (options.lockTimeoutMs ?? 5_000);
    const interval = options.lockRetryIntervalMs ?? 20;
    directory = await validateDirectoryPath(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const marker = join(directory, ".workstreams.lock");
    let winner = false;
    try { await mkdir(marker, { mode: 0o700 }); winner = true; } catch (error) { if (error?.code !== "EEXIST") throw error; }
    if (winner) {
      const seam = options[PROTOCOL_TEST];
      const token = seam?.token ?? randomUUID();
      const metadata = { ...PROTOCOL, operationToken: token, purpose: "construction" };
      if (!validateInitialization(metadata)) throw new TypeError("invalid internal operation token");
      await seam?.hook?.("mkdir");
      await atomicMetadata(marker, "initializing", metadata, seam?.hook);
      await seam?.hook?.("initialized");
      await completeInitialization(directory, token, options);
      return directory;
    }
    for (;;) {
      const state = await inspectMarker(directory);
      if (state.complete) return directory;
      if (clock() >= deadline) busy();
      await wait(Math.min(interval, deadline - clock()));
    }
  });
}
