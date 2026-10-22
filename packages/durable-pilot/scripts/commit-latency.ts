// Spike (c): commit latency of the pilot store under synchronous NORMAL, FULL, and FULL + fullfsync (macOS
// F_FULLFSYNC), measured as (1) one small Durable document commit and (2) one whole faux-model turn (admission,
// generation, answer). Rounds are interleaved to spread machine noise. Writes results/latency.json.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { defineDoc } from "@earendil-works/pi-durable";
import { admit, context, openHost } from "../src/host.ts";

const COMMITS = Number(process.env.COMMITS ?? 300);
const TURNS = Number(process.env.TURNS ?? 60);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const base = process.env.PI_TMP ?? join(import.meta.dirname, "..", ".runs");
const Counter = defineDoc<{ n: number }>({ kind: "latency.counter", version: 1, scope: "session", initial: () => ({ n: 0 }), checkpointWhen: () => false });

// The default row opens the host with no storage options, exactly as every host does; the others are comparisons.
type Config = { name: string; options: { synchronous?: "NORMAL" | "FULL"; fullfsync?: boolean } };
const configs: Config[] = [
	{ name: "NORMAL", options: { synchronous: "NORMAL", fullfsync: false } },
	{ name: "FULL", options: { synchronous: "FULL", fullfsync: false } },
	{ name: "FULL+fullfsync (default)", options: {} },
];

async function measure(config: Config) {
	const dir = mkdtempSync(join(base, `latency-${config.name.replace(/\W+/g, "-")}-`));
	const host = await openHost(dir, config.options);
	host.faux.setResponses(Array.from({ length: TURNS }, () => fauxAssistantMessage([fauxText("ok")])));
	const commits: number[] = [];
	for (let i = 0; i < COMMITS; i++) {
		const t = performance.now();
		await host.harness.commit(async (tx) => void ((await tx.doc(Counter)).n += 1), context);
		commits.push(performance.now() - t);
	}
	const turns: number[] = [];
	for (let i = 0; i < TURNS; i++) {
		const t = performance.now();
		const id = await admit(host.root, { operationId: `op-${i}`, text: `turn ${i}` });
		await (await host.harness.submission(id, context))!.wait(context);
		turns.push(performance.now() - t);
	}
	const pragmas = host.store.pragmas;
	await host.close();
	rmSync(dir, { recursive: true, force: true });
	return { commits, turns, pragmas };
}

const stats = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
	return { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), p99: +q(0.99).toFixed(3) };
};

const all: Record<string, { commits: number[]; turns: number[]; pragmas?: unknown }> = {};
for (let round = 0; round < ROUNDS; round++)
	for (const config of configs) {
		const r = await measure(config);
		const slot = (all[config.name] ??= { commits: [], turns: [] });
		slot.commits.push(...r.commits);
		slot.turns.push(...r.turns);
		slot.pragmas = r.pragmas;
	}

const machine = {
	node: process.version,
	os: execFileSync("sw_vers", ["-productVersion"]).toString().trim(),
	cpu: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"]).toString().trim(),
	volume: execFileSync("df", [base]).toString().trim().split("\n").at(-1)!.split(/\s+/)[0],
	model: execFileSync("sysctl", ["-n", "hw.model"]).toString().trim(),
};
const result = {
	measuredAt: new Date().toISOString(),
	machine,
	rounds: ROUNDS,
	configs: Object.fromEntries(Object.entries(all).map(([name, r]) => [name, { pragmas: r.pragmas, commitMs: stats(r.commits), turnMs: stats(r.turns) }])),
};
writeFileSync(join(import.meta.dirname, "..", "results", "latency.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log("config            commit p50/p95/p99 ms         turn p50/p95 ms");
for (const [name, r] of Object.entries(result.configs))
	console.log(`${name.padEnd(25)} ${r.commitMs.p50} / ${r.commitMs.p95} / ${r.commitMs.p99}`.padEnd(56) + `${r.turnMs.p50} / ${r.turnMs.p95}`);
