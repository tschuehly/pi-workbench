#!/usr/bin/env node
// Interleaved baseline-vs-candidate Workstream Store benchmark on a PRIVATE copy of a real store.
// Never point --store at the live file: every run copies it into --work and mutates only the copy.
// Prints only timings, counts, and SHA-256 digests; no Workstream ids, titles, or paths.
//
//   node store-bench.mjs --store <copy.json> --work <scratch dir> \
//     --baseline-src <old packages/workstream-store/src> --candidate-src <new src> \
//     --coordination <packages/workstream-session-coordination/src/index.js> [--rounds 5] [--out results.json]
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SELF = new URL(import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => (value.startsWith("--") ? [...pairs, [value.slice(2), list[index + 1]]] : pairs), []));

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const now = () => Number(process.hrtime.bigint()) / 1e6;
const fixedClock = () => { let tick = 0; return () => new Date(Date.UTC(2026, 9, 5, 0, 0, tick++)); };

async function openStore(src, directory) {
  const { FileWorkstreamAdapter, WorkstreamStore } = await import(join(resolve(src), "index.js"));
  const adapter = new FileWorkstreamAdapter({ directory });
  const probe = { lockMs: [], parseMs: [], parses: 0 };
  for (const [method, bucket] of [["acquireLock", "lockMs"], ["readDatabase", "parseMs"]]) {
    const original = adapter[method].bind(adapter);
    adapter[method] = async (...rest) => {
      const start = now();
      try { return await original(...rest); } finally { probe[bucket].push(now() - start); if (method === "readDatabase") probe.parses += 1; }
    };
  }
  return { store: new WorkstreamStore({ adapter, clock: fixedClock() }), probe };
}

async function time(samples, name, operation) {
  const start = now();
  const value = await operation();
  (samples[name] ??= []).push(now() - start);
  return value;
}

function largestOpen(database) {
  return Object.entries(database.workstreams)
    .filter(([, entry]) => !entry.ledger.some((record) => record.type === "workstream.closed"))
    .sort((a, b) => b[1].ledger.length - a[1].ledger.length)[0][0];
}

async function outputDigests(store, database) {
  const ids = Object.keys(database.workstreams).sort();
  const first = database.events[0]?.sequence ?? database.nextSequence;
  return {
    list: digest(await store.list({ includeClosed: true })),
    inspectAll: digest(await Promise.all(ids.map((id) => store.inspect(id)))),
    watchReplay: digest(await store.watch({ afterSequence: first - 1 })),
    watchSnapshot: digest(await store.watch({})),
  };
}

// --- child modes -----------------------------------------------------------------------------

async function single({ src, dir }) {
  const database = JSON.parse(await readFile(join(dir, "workstreams.json"), "utf8"));
  const target = largestOpen(database);
  const tail = database.nextSequence - 10;
  const { store, probe } = await openStore(src, dir);
  const samples = {};
  await time(samples, "coldList", () => store.list({ includeClosed: true }));
  const parsesAfterCold = probe.parses;
  for (let i = 0; i < 30; i += 1) {
    await time(samples, "warmList", () => store.list({ includeClosed: true }));
    await time(samples, "warmInspect", () => store.inspect(target));
    await time(samples, "warmWatchReplay", () => store.watch({ afterSequence: tail }));
  }
  for (let i = 0; i < 5; i += 1) await time(samples, "warmWatchSnapshot", () => store.watch({}));
  const readOnlyParses = probe.parses - parsesAfterCold;
  const before = await outputDigests(store, database);
  await store.create({ workstreamId: "bench-ws", idempotencyKey: "bench-create", title: "Bench", producer: "owner" });
  for (let i = 0; i < 10; i += 1) {
    await time(samples, "append", () => store.append({ workstreamId: "bench-ws", expectedRevision: i + 1, idempotencyKey: `bench-${i}`, records: [{ type: "title.set", producer: "owner", payload: { title: `Bench ${i}` } }] }));
    await time(samples, "inspectAfterAppend", () => store.inspect(target));
  }
  const retry = await store.append({ workstreamId: "bench-ws", expectedRevision: 1, idempotencyKey: "bench-0", records: [{ type: "title.set", producer: "owner", payload: { title: "Bench 0" } }] });
  const file = await readFile(join(dir, "workstreams.json"), "utf8");
  return { samples, probe, readOnlyParses, before, retry: digest(retry), afterState: digest(JSON.parse(file)), fileBytes: Buffer.byteLength(file) };
}

async function digestOnly({ src, dir }) {
  const database = JSON.parse(await readFile(join(dir, "workstreams.json"), "utf8"));
  const { store } = await openStore(src, dir);
  const retry = await store.append({ workstreamId: "bench-ws", expectedRevision: 1, idempotencyKey: "bench-0", records: [{ type: "title.set", producer: "owner", payload: { title: "Bench 0" } }] });
  return { digests: await outputDigests(store, database), retry: digest(retry) };
}

async function worker({ src, dir, index, start }) {
  const database = JSON.parse(await readFile(join(dir, "workstreams.json"), "utf8"));
  const target = largestOpen(database);
  const { store, probe } = await openStore(src, dir);
  await new Promise((done) => setTimeout(done, Math.max(0, Number(start) - Date.now())));
  const samples = {};
  let busy = 0;
  let revision = 0;
  const id = `bench-worker-${index}`;
  for (let i = 0; i < 25; i += 1) {
    try {
      await time(samples, "list", () => store.list({ includeClosed: true }));
      await time(samples, "inspect", () => store.inspect(target));
      await time(samples, "watch", () => store.watch({ afterSequence: database.nextSequence - 10 }));
      if (i % 5 === 0) {
        await time(samples, "append", () => (revision === 0
          ? store.create({ workstreamId: id, idempotencyKey: `${id}-create`, title: "Bench", producer: "owner" })
          : store.append({ workstreamId: id, expectedRevision: revision, idempotencyKey: `${id}-${i}`, records: [{ type: "title.set", producer: "owner", payload: { title: `Bench ${i}` } }] })));
        revision += 1;
      }
    } catch (error) {
      if (error?.code !== "STORE_BUSY") throw error;
      busy += 1;
    }
  }
  return { samples, busy, lockMs: probe.lockMs, parses: probe.parses };
}

async function launch({ src, dir, coordination }) {
  const database = JSON.parse(await readFile(join(dir, "workstreams.json"), "utf8"));
  const target = largestOpen(database);
  const { store, probe } = await openStore(src, dir);
  const { WorkstreamSessionCoordination } = await import(resolve(coordination));
  const value = new WorkstreamSessionCoordination({
    withWorkstreamClient: async (callback) => callback(store),
    attendedSession: {
      checkLocation: async () => ({ type: "ready" }),
      launch: async (request, hooks) => { await hooks.created({ id: `bench-session-${request.associationKey.split(":").at(-1)}`, location: request.location }); return { type: "completed" }; },
      lookup: async () => ({ type: "unknown" }),
    },
    producer: "pi-web",
  });
  const samples = {};
  const outcomes = [];
  for (let i = 0; i < 8; i += 1) {
    const outcome = await time(samples, i === 0 ? "coldLaunch" : "warmLaunch", () => value.launch({ kind: "blank", workstreamId: target, operationId: `bench-launch-${i}`, location: { machineId: "bench", projectId: "bench", workspaceId: "bench" } }));
    outcomes.push(outcome.type);
  }
  return { samples, outcomes, parses: probe.parses, lockMs: probe.lockMs };
}

// Isolated write-path A/B: cold list, then appends without and after a trusted read.
async function writes({ src, dir }) {
  const { store, probe } = await openStore(src, dir);
  const samples = {};
  await time(samples, "coldList", () => store.list({ includeClosed: true }));
  await store.create({ workstreamId: "bench-ws", idempotencyKey: "bench-create", title: "Bench", producer: "owner" });
  let revision = 1;
  const append = (key) => store.append({ workstreamId: "bench-ws", expectedRevision: revision++, idempotencyKey: key, records: [{ type: "title.set", producer: "owner", payload: { title: key } }] });
  for (let i = 0; i < 4; i += 1) await time(samples, "appendNoRead", () => append(`n-${i}`));
  for (let i = 0; i < 4; i += 1) {
    await store.list();
    await time(samples, "appendAfterRead", () => append(`r-${i}`));
  }
  return { samples: { ...samples, parse: probe.parseMs } };
}

const modes = { single, digestOnly, worker, launch, writes };
if (args.mode) {
  process.stdout.write(JSON.stringify(await modes[args.mode](args)));
  process.exit(0);
}

// --- orchestrator ----------------------------------------------------------------------------

const rounds = Number(args.rounds ?? 5);
const variants = { baseline: args["baseline-src"], candidate: args["candidate-src"] };
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, p50: +pick(0.5).toFixed(2), p95: +pick(0.95).toFixed(2) };
};
const child = async (mode, extra) => JSON.parse((await run(process.execPath, [SELF, "--mode", mode, ...Object.entries(extra).flat()], { maxBuffer: 64 << 20 })).stdout);
async function freshCopy(name) {
  const dir = join(args.work, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await copyFile(args.store, join(dir, "workstreams.json"));
  return dir;
}

const pooled = { baseline: {}, candidate: {} };
const add = (variant, group, samples) => {
  for (const [name, values] of Object.entries(samples)) (pooled[variant][`${group}.${name}`] ??= []).push(...values);
};
const parity = { baseline: [], candidate: [] };
const counters = { baseline: { busy: 0, readOnlyParses: [], launchOutcomes: new Set() }, candidate: { busy: 0, readOnlyParses: [], launchOutcomes: new Set() } };

for (let round = 0; args.suite === "writes" && round < rounds; round += 1) {
  for (const variant of round % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
    const dir = await freshCopy(`${variant}-writes`);
    add(variant, "writes", (await child("writes", { "--src": variants[variant], "--dir": dir })).samples);
    await rm(dir, { recursive: true, force: true });
  }
}

for (let round = 0; args.suite !== "writes" && round < rounds; round += 1) {
  const order = round % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
  const mutated = {};
  for (const variant of order) {
    const src = variants[variant];
    const dir = await freshCopy(`${variant}-single`);
    const result = await child("single", { "--src": src, "--dir": dir });
    add(variant, "single", result.samples);
    add(variant, "single", { lock: result.probe.lockMs, parse: result.probe.parseMs });
    counters[variant].readOnlyParses.push(result.readOnlyParses);
    parity[variant].push({ before: result.before, retry: result.retry, afterState: result.afterState, fileBytes: result.fileBytes });
    mutated[variant] = dir;

    const launchDir = await freshCopy(`${variant}-launch`);
    const launched = await child("launch", { "--src": src, "--dir": launchDir, "--coordination": args.coordination });
    add(variant, "launch", { ...launched.samples, lock: launched.lockMs });
    launched.outcomes.forEach((outcome) => counters[variant].launchOutcomes.add(outcome));
    await rm(launchDir, { recursive: true, force: true });

    const contentionDir = await freshCopy(`${variant}-contention`);
    const start = Date.now() + 1_500;
    const workers = await Promise.all(Array.from({ length: 8 }, (_, index) => child("worker", { "--src": src, "--dir": contentionDir, "--index": String(index), "--start": String(start) })));
    for (const result of workers) {
      add(variant, "contention8", { ...result.samples, lock: result.lockMs });
      counters[variant].busy += result.busy;
    }
    await rm(contentionDir, { recursive: true, force: true });
  }
  // Cross-read: each variant reads the other's written file (old reader on compact, new reader on pretty).
  const cross = {
    baselineReadsCandidateFile: await child("digestOnly", { "--src": variants.baseline, "--dir": mutated.candidate }),
    candidateReadsBaselineFile: await child("digestOnly", { "--src": variants.candidate, "--dir": mutated.baseline }),
  };
  parity.cross ??= [];
  parity.cross.push(cross);
  for (const dir of Object.values(mutated)) await rm(dir, { recursive: true, force: true });
  process.stderr.write(`round ${round + 1}/${rounds} done\n`);
}

const summary = {};
for (const variant of Object.keys(pooled)) {
  summary[variant] = Object.fromEntries(Object.entries(pooled[variant]).sort().map(([name, values]) => [name, stats(values)]));
}
const base = { node: process.version, platform: `${process.platform}-${process.arch}`, suite: args.suite ?? "all", rounds, sourceStoreBytes: (await readFile(args.store)).length, summary };
const report = args.suite === "writes" ? base : fullReport();
function fullReport() {
  const outputDigestsEqual = parity.baseline.every((entry, index) => JSON.stringify(entry.before) === JSON.stringify(parity.candidate[index].before));
  const stateDigestsEqual = parity.baseline.every((entry, index) => entry.afterState === parity.candidate[index].afterState && entry.retry === parity.candidate[index].retry);
  const crossEqual = parity.cross.every((entry) => JSON.stringify(entry.baselineReadsCandidateFile.digests) === JSON.stringify(entry.candidateReadsBaselineFile.digests)
    && entry.baselineReadsCandidateFile.retry === entry.candidateReadsBaselineFile.retry
    && entry.baselineReadsCandidateFile.retry === parity.candidate[0].retry);
  return {
    ...base,
    counters: Object.fromEntries(Object.entries(counters).map(([variant, value]) => [variant, { storeBusy: value.busy, readOnlyParsesAfterCold: value.readOnlyParses, launchOutcomes: [...value.launchOutcomes] }])),
    parity: {
      outputDigestsEqual,
      stateAndRetryDigestsEqual: stateDigestsEqual,
      crossReaderDigestsEqual: crossEqual,
      outputDigests: parity.candidate[0].before,
      writtenFileBytes: { baseline: parity.baseline[0].fileBytes, candidate: parity.candidate[0].fileBytes },
    },
  };
}
const text = `${JSON.stringify(report, null, 2)}\n`;
if (args.out) await (await import("node:fs/promises")).writeFile(args.out, text);
process.stdout.write(text);
