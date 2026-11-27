import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, lstat, readdir, rm, symlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isolatedRoot, missingIsolation } from "./fixtures/lock-owner-child.mjs";

const skip = missingIsolation().length ? "requires isolated environment" : false;
const protocol = { formatVersion: 1, protocol: "sqlite-transaction-lock" };
const init = (token = randomUUID()) => ({ ...protocol, operationToken: token, purpose: "construction" });
async function setup(t) {
  const root = await isolatedRoot();
  const directory = await mkdtemp(join(root, "protocol-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, marker: join(directory, ".workstreams.lock"), api: await import("../src/lock-protocol.js") };
}
const code = (expected) => (error) => { assert.equal(error.code, expected); return true; };
async function bytes(marker) {
  const result = {};
  for (const name of (await readdir(marker)).sort()) {
    const stat = await lstat(join(marker, name));
    result[name] = [stat.ino, stat.mode, stat.isFile() ? await readFile(join(marker, name), "utf8") : "nonregular"];
  }
  return result;
}

test("fresh marker is permanent, private, exact and continuously excludes frozen legacy", { skip }, async (t) => {
  const { directory, marker, api } = await setup(t);
  await api.ensureMarker(directory);
  const before = await lstat(marker);
  assert.deepEqual(JSON.parse(await readFile(join(marker, "protocol.json"))), protocol);
  assert.equal((await lstat(join(marker, "protocol.json"))).mode & 0o777, 0o600);
  await api.ensureMarker(directory);
  assert.equal((await lstat(marker)).ino, before.ino);
  const { FileWorkstreamAdapter } = await import("./fixtures/legacy-adapters.js");
  let entered = false;
  await assert.rejects(new FileWorkstreamAdapter({ directory, lockTimeoutMs: 0 }).transaction(() => { entered = true; }), code("STORE_BUSY"));
  assert.equal(entered, false);
  assert.equal((await lstat(marker)).ino, before.ino);
});

test("contender waits for live initializer; only mkdir winner finishes", { skip }, async (t) => {
  const { directory, marker, api } = await setup(t);
  let resume, ready;
  const waiting = new Promise((resolve) => { ready = resolve; });
  const barrier = new Promise((resolve) => { resume = resolve; });
  const first = api.ensureMarker(directory, { [api.PROTOCOL_TEST]: { hook: async (phase) => { if (phase === "initialized") { ready(); await barrier; } } } });
  await waiting;
  t.after(resume);
  const inode = (await lstat(marker)).ino;
  const { FileWorkstreamAdapter } = await import("./fixtures/legacy-adapters.js");
  let legacyEntered = false;
  await assert.rejects(new FileWorkstreamAdapter({ directory, lockTimeoutMs: 0 }).transaction(() => { legacyEntered = true; }), code("STORE_BUSY"));
  assert.equal(legacyEntered, false);
  assert.equal((await readdir(marker)).includes("protocol.json"), false);
  await assert.rejects(api.ensureMarker(directory, { lockTimeoutMs: 0 }), code("STORE_BUSY"));
  const second = api.ensureMarker(directory);
  resume();
  await Promise.all([first, second]);
  assert.equal((await lstat(marker)).ino, inode);
});

test("empty legacy and partial/missing initialization never auto-complete", { skip }, async (t) => {
  const { directory, marker, api } = await setup(t);
  await mkdir(marker);
  for (const content of [null, "{", JSON.stringify(protocol)]) {
    if (content !== null) await writeFile(join(marker, "initializing.json"), content);
    const before = await bytes(marker);
    await assert.rejects(api.ensureMarker(directory, { lockTimeoutMs: 0 }), code(content === null ? "STORE_BUSY" : "CORRUPT_STORE"));
    await assert.rejects(api.completeInitialization(directory, randomUUID()));
    assert.deepEqual(await bytes(marker), before);
    assert.equal((await readdir(marker)).includes("protocol.json"), false);
  }
});

test("malformed, unsupported, nonregular and symlink authoritative paths fail closed", { skip }, async (t) => {
  const { directory, marker, api } = await setup(t);
  const target = join(directory, "target");
  await mkdir(target);
  await symlink(target, marker);
  await assert.rejects(api.ensureMarker(directory), code("CORRUPT_STORE"));
  await rm(marker);
  await mkdir(marker);
  for (const value of ["{", JSON.stringify({ ...protocol, formatVersion: 2 }), JSON.stringify({ ...protocol, extra: true })]) {
    await writeFile(join(marker, "protocol.json"), value);
    await assert.rejects(api.ensureMarker(directory), code("CORRUPT_STORE"));
  }
  await rm(join(marker, "protocol.json"));
  await symlink(join(directory, "absent"), join(marker, "protocol.json"));
  await assert.rejects(api.ensureMarker(directory), code("CORRUPT_STORE"));
  await rm(join(marker, "protocol.json"));
  await mkdir(join(marker, "protocol.json"));
  await assert.rejects(api.ensureMarker(directory), code("CORRUPT_STORE"));
  await rm(join(marker, "protocol.json"), { recursive: true });
  await symlink(join(directory, "absent"), join(marker, "initializing.json"));
  await assert.rejects(api.ensureMarker(directory), code("CORRUPT_STORE"));
  assert.deepEqual(await readdir(target), []);
});

test("ancestor aliases succeed but a symlink Store is unavailable without marker corruption", { skip }, async (t) => {
  const { directory, api } = await setup(t);
  const target = join(directory, "target"), alias = join(directory, "alias");
  await mkdir(target);
  await symlink(target, alias);
  await api.ensureMarker(join(alias, "nested"));
  assert.deepEqual(JSON.parse(await readFile(join(target, "nested", ".workstreams.lock", "protocol.json"))), protocol);
  const before = await bytes(join(target, "nested", ".workstreams.lock"));
  await assert.rejects(api.ensureMarker(alias), (error) => {
    assert.equal(error.code, "LOCK_COORDINATOR_UNAVAILABLE");
    assert.match(error.message, /symlink.*(canonical|real|direct).*path/i);
    return true;
  });
  assert.deepEqual(await bytes(join(target, "nested", ".workstreams.lock")), before);
  assert.deepEqual((await readdir(target)).sort(), ["nested"]);
});

// Patch the real builtin binding: no production hook can accidentally bypass the raced scan.
async function duringReaddir(marker, action, operation) {
  const original = fs.readdir;
  let hits = 0;
  fs.readdir = async (path, ...args) => {
    if (path === marker && hits++ === 0) return action(() => original(path, ...args));
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try { await operation(); assert.ok(hits > 0, "scan barrier must fire"); }
  finally { fs.readdir = original; syncBuiltinESMExports(); }
}

test("protocol published after absent read is reread as authoritative", { skip }, async (t) => {
  const { directory, marker, api } = await setup(t);
  await mkdir(marker);
  await writeFile(join(marker, "initializing.json"), JSON.stringify(init()));
  await duringReaddir(marker, async (list) => {
    const temporary = join(marker, `.protocol-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(protocol));
    await rename(temporary, join(marker, "protocol.json"));
    return list();
  }, async () => assert.equal((await api.inspectMarker(directory)).complete, true));
});

test("own recognized temporary renamed after listing triggers revalidation", { skip }, async (t) => {
  const { directory, marker, api } = await setup(t);
  await mkdir(marker);
  const metadata = init();
  const temporary = join(marker, `.initializing-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(metadata));
  await duringReaddir(marker, async (list) => {
    const names = await list();
    await rename(temporary, join(marker, "initializing.json"));
    return names;
  }, async () => assert.deepEqual((await api.inspectMarker(directory)).initialization, metadata));
});

test("concurrent fresh-root initializers all succeed", { skip, timeout: 10_000 }, async (t) => {
  const { directory, api } = await setup(t);
  const errors = [];
  let calls = 0;
  for (let round = 0; round < 100; round++) {
    const store = join(directory, `fresh-${round}`);
    await Promise.all(Array.from({ length: 32 }, async () => {
      calls++;
      try { await api.ensureMarker(store); } catch (error) { errors.push(error.code ?? error.name); }
    }));
  }
  t.diagnostic(JSON.stringify({ calls, errors: errors.length }));
  assert.equal(calls, 3200);
  assert.deepEqual(errors, []);
});

test("completed protocol ignores leftovers without traversing or modifying them", { skip }, async (t) => {
  const { directory, marker, api } = await setup(t);
  await api.ensureMarker(directory);
  await writeFile(join(marker, "initializing.json"), "malformed leftover");
  await writeFile(join(marker, `.protocol-${randomUUID()}.tmp`), "partial");
  await symlink(join(directory, "absent"), join(marker, ".DS_Store"));
  const before = await bytes(marker);
  await api.ensureMarker(directory);
  assert.deepEqual(await bytes(marker), before);
});

test("matching-token internal completion preserves recognized temps but refuses unknown or unsafe entries", { skip }, async (t) => {
  const { directory, marker, api } = await setup(t);
  await mkdir(marker);
  const metadata = init();
  await writeFile(join(marker, "initializing.json"), JSON.stringify(metadata));
  const temporary = `.initializing-${randomUUID()}.tmp`;
  await writeFile(join(marker, temporary), "partial ignored bytes");
  const before = await bytes(marker);
  await assert.rejects(api.completeInitialization(directory, randomUUID()), code("STORE_BUSY"));
  assert.deepEqual(await bytes(marker), before);
  for (const name of ["unknown", ".protocol-not-a-uuid.tmp"]) {
    await writeFile(join(marker, name), "unknown");
    const snapshot = await bytes(marker);
    await assert.rejects(api.completeInitialization(directory, metadata.operationToken), code("CORRUPT_STORE"));
    assert.deepEqual(await bytes(marker), snapshot);
    await rm(join(marker, name));
  }
  const unsafe = `.protocol-${randomUUID()}.tmp`;
  await symlink(join(directory, "absent"), join(marker, unsafe));
  await assert.rejects(api.completeInitialization(directory, metadata.operationToken), code("CORRUPT_STORE"));
  await rm(join(marker, unsafe));
  const inode = (await lstat(marker)).ino;
  // Internal import is intentionally callable: token validation is NOT proof of observed exit.
  await api.completeInitialization(directory, metadata.operationToken);
  await api.completeInitialization(directory, metadata.operationToken);
  assert.equal((await lstat(marker)).ino, inode);
  assert.deepEqual((await bytes(marker))[temporary], before[temporary]);
});

test("test supervisor requires fresh root, exact disk token and actual retained-child exit", { skip, timeout: 10_000 }, async (t) => {
  const { createConstructionSupervisor, reconcileConstruction } = await import("./fixtures/construction-supervisor.mjs");
  await isolatedRoot();
  await assert.rejects(reconcileConstruction({ exited: true, token: randomUUID(), pid: process.pid }), /supervisor/);
  await assert.rejects(createConstructionSupervisor({ directory: process.env.PI_WORKBENCH_WORKSTREAM_DIR }), /fresh/);
  const supervisor = await createConstructionSupervisor();
  t.after(() => supervisor.dispose());
  await supervisor.start();
  await assert.rejects(supervisor.complete(), /exit/);
  assert.deepEqual(await supervisor.stop(), { code: null, signal: "SIGKILL" });
  // A new supervisor cannot adopt this existing scope; lost/restarted state grants nothing.
  await assert.rejects(createConstructionSupervisor({ directory: supervisor.directory }), /fresh/);
  const restarted = await createConstructionSupervisor();
  t.after(() => restarted.dispose());
  await assert.rejects(restarted.complete(), /exit/);
  const marker = join(supervisor.directory, ".workstreams.lock");
  const inode = (await lstat(marker)).ino;
  const original = await readFile(join(marker, "initializing.json"), "utf8");
  await writeFile(join(marker, "initializing.json"), JSON.stringify(init()));
  await assert.rejects(supervisor.complete(), code("STORE_BUSY"));
  await writeFile(join(marker, "initializing.json"), "{");
  await assert.rejects(supervisor.complete(), code("CORRUPT_STORE"));
  await rm(join(marker, "initializing.json"));
  await assert.rejects(supervisor.complete(), code("STORE_BUSY"));
  await writeFile(join(marker, "initializing.json"), original);
  await supervisor.complete();
  await supervisor.complete();
  assert.equal((await lstat(marker)).ino, inode);
});

test("supervisor refuses mkdir-only crash, multiple assignments and changed owned root", { skip, timeout: 10_000 }, async (t) => {
  const { createConstructionSupervisor } = await import("./fixtures/construction-supervisor.mjs");
  for (const mode of ["mkdir", "multiple", "changed"]) {
    const supervisor = await createConstructionSupervisor();
    t.after(() => supervisor.dispose());
    await supervisor.start({ phase: mode === "mkdir" ? "mkdir" : "initialized" });
    if (mode === "multiple") await assert.rejects(supervisor.start(), /multiple/);
    await supervisor.stop();
    if (mode === "changed") {
      const moved = `${supervisor.directory}-moved`;
      await rename(supervisor.directory, moved);
      t.after(() => rm(moved, { recursive: true, force: true }));
      await mkdir(supervisor.directory);
    }
    await assert.rejects(supervisor.complete());
    assert.equal((await readdir(join(mode === "changed" ? `${supervisor.directory}-moved` : supervisor.directory, ".workstreams.lock"))).includes("protocol.json"), false);
  }
});
