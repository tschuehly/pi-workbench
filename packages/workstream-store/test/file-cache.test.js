import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  FileWorkstreamAdapter,
  InMemoryWorkstreamAdapter,
  WorkstreamStore,
} from "../src/index.js";
import * as model from "../src/model.js";

const run = promisify(execFile);
const INDEX_URL = new URL("../src/index.js", import.meta.url).href;

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(process.env.PI_TMP ?? tmpdir(), "pi-workstream-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const adapter = new FileWorkstreamAdapter({ directory, ...options });
  const store = new WorkstreamStore({ adapter, clock: clock() });
  await store.create({ workstreamId: "ws-1", idempotencyKey: "create-1", title: "Alpha", producer: "owner" });
  return { directory, file: join(directory, "workstreams.json"), adapter, store };
}

function retitle(revision, title, key = `title-${revision}`) {
  return { workstreamId: "ws-1", expectedRevision: revision, idempotencyKey: key, records: [{ type: "title.set", producer: "owner", payload: { title } }] };
}

function countReads(adapter) {
  const reads = { count: 0 };
  const original = adapter.readDatabase.bind(adapter);
  adapter.readDatabase = (...args) => {
    reads.count += 1;
    return original(...args);
  };
  return reads;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test("repeated trusted Store reads do not reread an unchanged file", async (t) => {
  const { adapter, store } = await fixture(t);
  await store.list();
  const reads = countReads(adapter);
  await store.list();
  await store.inspect("ws-1");
  await store.watch({ afterSequence: 0 });
  assert.equal(reads.count, 0);
  await store.append(retitle(1, "Beta"));
  assert.equal((await store.list())[0].title, "Beta");
  assert.ok(reads.count >= 2, "the write and the next trusted read both read the file");
});

test("Store read callbacks treat trusted input as deeply frozen", async () => {
  const inner = new InMemoryWorkstreamAdapter();
  const trusted = [];
  const adapter = {
    transaction(callback, options = {}) {
      if (!options.readOnly) return inner.transaction(callback, options);
      trusted.push(options[model.TRUSTED_READ]);
      return inner.transaction((database) => callback(deepFreeze(database)), options);
    },
  };
  const store = new WorkstreamStore({ adapter, clock: clock() });
  await store.create({ workstreamId: "ws-1", idempotencyKey: "create-1", title: "Alpha", producer: "owner" });
  await store.append({ workstreamId: "ws-1", expectedRevision: 1, idempotencyKey: "a-1", records: [
    { type: "session.pending", producer: "pi-web", payload: { sessionId: "s-1", associationKey: "k-1", machineId: "m", projectId: "p", workspaceId: "w" } },
    { type: "session.confirmed", producer: "pi-web", payload: { sessionId: "s-1", machineId: "m", projectId: "p", workspaceId: "w" } },
    { type: "checkpoint.replaced", producer: "pi-web", payload: { sessionId: "s-1", checkpoint: { id: "c-1", whatChanged: "x", remains: "y", next: "z", references: ["docs/README.md"] } } },
    { type: "human-task.upsert", producer: "owner", payload: { task: { id: "t-1", title: "T", answerKind: "choice", options: [{ id: "a", label: "A" }], materiality: "material" } } },
    { type: "link.upsert", producer: "owner", payload: { link: { id: "l-1", kind: "file", reference: "docs/README.md" } } },
    { type: "overview.replaced", producer: "owner", payload: { overview: { goal: "g", doneWhen: "d", description: "x", history: ["h"] } } },
  ] });
  const snapshot = await store.inspect("ws-1");
  snapshot.sessions[0].latestCheckpoint.references.push("mutated");
  assert.equal((await store.list({ includeClosed: true, text: "alp" })).length, 1);
  assert.equal((await store.watch({ afterSequence: 0 })).events.length, 2);
  const inner2 = new InMemoryWorkstreamAdapter({ eventRetention: 1 });
  const replayStore = new WorkstreamStore({ adapter: { transaction: (cb, o = {}) => inner2.transaction((db) => cb(o.readOnly ? deepFreeze(db) : db), o) }, clock: clock() });
  await replayStore.create({ workstreamId: "ws-1", idempotencyKey: "c", title: "A", producer: "owner" });
  await replayStore.create({ workstreamId: "ws-2", idempotencyKey: "c2", title: "B", producer: "owner" });
  assert.equal((await replayStore.watch({ afterSequence: 0 })).mode, "snapshot");
  assert.deepEqual(trusted, [true, true, true]);
  assert.deepEqual((await store.inspect("ws-1")).sessions[0].latestCheckpoint.references, ["docs/README.md"]);
});

test("public readOnly transactions stay fresh and isolated while the trusted cache is warm", async (t) => {
  const { adapter, store } = await fixture(t);
  const before = await store.list();
  let retained;
  await adapter.transaction((database) => {
    retained = database;
    database.workstreams["ws-1"].ledger[0].title = "Mutated";
    database.workstreams.extra = { ledger: [] };
  }, { readOnly: true });
  await assert.rejects(adapter.transaction((database) => {
    database.workstreams["ws-1"].ledger.length = 0;
    throw new Error("boom");
  }, { readOnly: true }), /boom/);
  retained.workstreams["ws-1"].ledger.length = 0;
  const result = await adapter.transaction((database) => database.workstreams, { readOnly: true });
  result["ws-1"].ledger.length = 0;
  assert.notEqual(await adapter.transaction((database) => database, { readOnly: true }), retained);
  assert.deepEqual(await store.list(), before);

  const inspected = await store.inspect("ws-1");
  inspected.title = "Changed";
  const watched = await store.watch({ afterSequence: 0 });
  watched.events[0].records[0].title = "Changed";
  assert.equal((await store.inspect("ws-1")).title, "Alpha");
  assert.equal((await store.watch({ afterSequence: 0 })).events[0].records[0].title, "Alpha");
});

test("a failed write transaction invalidates without serving its discarded graph", async (t) => {
  const { adapter, store } = await fixture(t);
  await store.list();
  await assert.rejects(adapter.transaction((database) => {
    database.workstreams["ws-1"].ledger[0].title = "Discarded";
    throw new Error("boom");
  }), /boom/);
  assert.equal((await store.list())[0].title, "Alpha");
});

test("warm cache sees a separate-process append and an atomic replacement", async (t) => {
  const { directory, file, store } = await fixture(t);
  assert.equal((await store.list())[0].revision, 1);
  const child = `const { createUserLocalWorkstreamStore } = await import(${JSON.stringify(INDEX_URL)});
    await createUserLocalWorkstreamStore({ directory: process.argv[1] }).append(${JSON.stringify(retitle(1, "Child"))});`;
  await run(process.execPath, ["--input-type=module", "-e", child, directory]);
  assert.deepEqual([(await store.inspect("ws-1")).title, (await store.list())[0].revision], ["Child", 2]);

  const replaced = JSON.parse(await readFile(file, "utf8"));
  replaced.workstreams["ws-1"].ledger[0].title = "Swapped";
  replaced.workstreams["ws-1"].ledger[1].payload.title = "Swapped";
  await writeFile(`${file}.next`, JSON.stringify(replaced));
  await rename(`${file}.next`, file);
  assert.equal((await store.list())[0].title, "Swapped");
});

test("warm cache detects same-size in-place rewrites with restored mtime via ctime", async (t) => {
  const { file, store } = await fixture(t);
  const pinned = new Date(Date.UTC(2026, 0, 1));
  await utimes(file, pinned, pinned);
  const original = await stat(file, { bigint: true });
  assert.equal((await store.list())[0].title, "Alpha");

  const text = await readFile(file, "utf8");
  await writeFile(file, text.replaceAll("Alpha", "Bravo"));
  await utimes(file, pinned, pinned);
  const rewritten = await stat(file, { bigint: true });
  assert.deepEqual([rewritten.ino, rewritten.size, rewritten.mtimeNs], [original.ino, original.size, original.mtimeNs]);
  assert.notEqual(rewritten.ctimeNs, original.ctimeNs);
  assert.equal((await store.list())[0].title, "Bravo");

  await writeFile(file, `x${text.slice(1)}`);
  await utimes(file, pinned, pinned);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(store.list(), (error) => error.code === "CORRUPT_STORE");
  }
  await writeFile(file, text);
  assert.equal((await store.list())[0].title, "Alpha");
});

test("warm cache follows deletion and recreation", async (t) => {
  const { file, store } = await fixture(t);
  assert.equal((await store.list()).length, 1);
  await rm(file);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.inspect("ws-1"), (error) => error.code === "WORKSTREAM_NOT_FOUND");
  await store.create({ workstreamId: "ws-2", idempotencyKey: "create-2", title: "Recreated", producer: "owner" });
  assert.deepEqual((await store.list()).map((summary) => summary.id), ["ws-2"]);
});

test("warm trusted reads still wait for another lock owner", async (t) => {
  const { directory, store } = await fixture(t, { lockTimeoutMs: 60 });
  await store.list();
  await mkdir(join(directory, ".workstreams.lock"));
  for (const read of [() => store.list(), () => store.inspect("ws-1"), () => store.watch()]) {
    await assert.rejects(read(), (error) => error.code === "STORE_BUSY");
  }
  await rm(join(directory, ".workstreams.lock"), { recursive: true });
  assert.equal((await store.list()).length, 1);
});

test("writes compact JSON that old pretty-printed stores and readers interchange", async (t) => {
  const { directory, file, store } = await fixture(t);
  const receipt = await store.append(retitle(1, "Beta", "retry-key"));
  const replay = await store.watch({ afterSequence: 0 });
  const compact = await readFile(file, "utf8");
  assert.equal(compact, `${JSON.stringify(JSON.parse(compact))}\n`);

  await writeFile(file, `${JSON.stringify(JSON.parse(compact), null, 2)}\n`);
  const restarted = new WorkstreamStore({ adapter: new FileWorkstreamAdapter({ directory }), clock: clock() });
  assert.deepEqual(await restarted.append(retitle(1, "Beta", "retry-key")), receipt);
  assert.deepEqual(await restarted.watch({ afterSequence: 0 }), replay);
  await assert.rejects(restarted.append(retitle(1, "Other", "retry-key")), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  const next = await restarted.append(retitle(2, "Gamma"));
  const rewritten = await readFile(file, "utf8");
  assert.equal(rewritten, `${JSON.stringify(JSON.parse(rewritten))}\n`);
  assert.equal(JSON.parse(rewritten).formatVersion, 1);
  assert.deepEqual(JSON.parse(rewritten).idempotency[next.idempotencyKey].receipt, next);
});
