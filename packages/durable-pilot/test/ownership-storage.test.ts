// Matrix rows: "Ownership/storage/security" (competing owner, stale endpoint, disk full, crash-loop parking) and
// "Schema upgrade/rollback" (Durable 1.3 → 1.4 copy, old binary refusal, backup restore; task/document versions).
import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { probeEndpoint, type OwnerRecord } from "../src/store.ts";
import { HostProcess, integrity, ITERATIONS, type Mode, PACKAGE, runWindow, scratch, type Window } from "./runner.ts";

type E = Record<string, any>;

function record(id: string, evidence: object): void {
	const file = join(PACKAGE, "results", "evidence", `${id}.jsonl`);
	mkdirSync(join(PACKAGE, "results", "evidence"), { recursive: true });
	appendFileSync(file, `${JSON.stringify(evidence)}\n`);
}
function reset(id: string): void {
	mkdirSync(join(PACKAGE, "results", "evidence"), { recursive: true });
	writeFileSync(join(PACKAGE, "results", "evidence", `${id}.jsonl`), "");
}

async function repeat(id: string, body: (i: number) => Promise<object>): Promise<void> {
	reset(id);
	for (let i = 0; i < ITERATIONS; i++) {
		try {
			record(id, { iteration: i, ...(await body(i)), pass: true });
		} catch (error) {
			record(id, { iteration: i, pass: false, failure: String(error) });
			throw error;
		}
	}
}

describe("ownership and storage", () => {
	it("competing owner rejected; stale and dead endpoints refused; next owner fenced by epoch", () =>
		repeat("ownership.competing-owner", async () => {
			const dir = scratch("owner");
			const a = new HostProcess("owner", "crash", dir, {});
			const ownerA = (await a.waitFor((m) => m.type === "barrier" && m.name === "open", "owner A")).data as OwnerRecord;
			const probeA = await probeEndpoint(ownerA);
			const b = new HostProcess("owner", "verify", dir, {});
			const contender = (await b.waitFor((m) => m.type === "result", "contender")).evidence as E;
			await b.exited;
			await a.kill();
			const deadEndpoint = await probeEndpoint(ownerA);
			const c = new HostProcess("owner", "verify", dir, {});
			const ownerC = (await c.waitFor((m) => m.type === "barrier" && m.name === "open", "owner C")).data as OwnerRecord;
			const staleNonce = await probeEndpoint({ ...ownerC, nonce: ownerA.nonce });
			const probeC = await probeEndpoint(ownerC);
			c.child.send({ type: "close" });
			await c.waitFor((m) => m.type === "result", "owner C close");
			await c.exited;
			const evidence = { probeA, contender, deadEndpoint, epochs: [ownerA.epoch, ownerC.epoch], staleNonce, probeC, integrity: integrity(dir) };
			assert.equal(probeA, "ok");
			assert.deepEqual(contender, { rejected: true, error: "StoreOwnedElsewhere" }, "a second live owner is refused");
			assert.equal(deadEndpoint, "unreachable");
			assert.equal(ownerC.epoch, ownerA.epoch + 1, "the next owner gets a new fencing epoch");
			assert.equal(staleNonce, "stale", "a client holding the old owner's metadata is refused");
			assert.equal(probeC, "ok");
			assert.equal(evidence.integrity, "ok");
			return evidence;
		}));

	const diskFull: Window = {
		id: "ownership.disk-full",
		scenario: "diskFull",
		barrier: "rejected",
		crash: {},
		verify: {},
		check: (e: E) => {
			assert.equal(e.barrierData.admitted, null, "no success acknowledgement");
			assert.match(e.barrierData.error, /full/i, "real SQLITE_FULL");
			assert.equal(e.barrierData.end, "failed", "a storage error ends the Harness");
			assert.ok(e.barrierData.reports.includes("session_failed"));
			assert.equal(e.settled.status, "done", "retry with the same ID after reopen is admitted");
			assert.equal(e.bigInputs, 1, "exactly once");
		},
	};
	for (const mode of ["kill", "close"] as Mode[]) it(`disk full / ${mode}`, () => runWindow(diskFull, mode));

	it("crash-loop parking is visible and stops reruns", () =>
		repeat("ownership.crash-loop-parking", async () => {
			const dir = scratch("parking");
			let parked: E | undefined;
			let spawns = 0;
			while (parked === undefined && spawns < 10) {
				spawns++;
				const p = new HostProcess("parking", "crash", dir, { first: spawns === 1 });
				const outcome = await Promise.race([
					p.exited.then((exit) => ({ exit })),
					p.waitFor((m) => m.type === "barrier" && m.name === "parked", "parked").then((m) => ({ parked: m.data as E })),
				]);
				if ("parked" in outcome) {
					parked = outcome.parked;
					await p.kill();
				} else assert.equal(outcome.exit.signal, "SIGKILL", "the crasher killed its own process");
			}
			assert.ok(parked !== undefined, "parked within 10 opens");
			assert.equal(parked.parked.length, 1);
			assert.equal(parked.parked[0].kind, "pi.tool");
			assert.equal(parked.runs, 3, "ran restartLimit times, then never again");
			assert.equal(parked.wake.active, false, "a parked task is not counted as active");
			assert.ok(parked.reports.includes("task_parked"), "host is told once");
			const evidence = { spawns, ...parked, integrity: integrity(dir) };
			assert.equal(evidence.integrity, "ok");
			return evidence;
		}));
});

function legacy(mode: "start" | "resume" | "open", dir: string) {
	const child = fork(join(PACKAGE, "legacy-1.3", "host13.mjs"), [mode, dir], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
	const messages: E[] = [];
	const exited = new Promise((resolve) => child.on("exit", resolve));
	const next = (type: string) =>
		new Promise<E>((resolve, reject) => {
			child.on("message", (m: E) => (messages.push(m), m.type === type && resolve(m)));
			child.on("exit", () => reject(new Error(`1.3 host exited before ${type}`)));
		});
	return { child, exited, next };
}

function copyStore(from: string, to: string): string[] {
	mkdirSync(to, { recursive: true });
	const files = ["session.sqlite", "session.sqlite-wal", "session.sqlite-shm"].filter((f) => existsSync(join(from, f)));
	for (const f of files) copyFileSync(join(from, f), join(to, f));
	return files;
}

function schemaVersion(dir: string): number {
	const db = new DatabaseSync(join(dir, "session.sqlite"));
	try {
		return (db.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get() as { version: number }).version;
	} finally {
		db.close();
	}
}

describe("schema upgrade and rollback", () => {
	it("1.3 store with pending work: closed backup, 1.4 upgrades a copy and recovers, 1.3 refuses it, backup restores under 1.3", () =>
		repeat("schema.upgrade-rollback", async () => {
			const original = scratch("schema");
			const start = legacy("start", original);
			await start.next("barrier");
			start.child.kill("SIGKILL");
			await start.exited;
			// Backup only while no owner holds the store, keeping the database and its journal files as one set.
			const backup = join(original, "backup");
			const copy = join(original, "copy");
			const files = copyStore(original, backup);
			copyStore(original, copy);
			const v13 = schemaVersion(backup);

			const upgraded = new HostProcess("generation", "verify", copy, { window: "upgrade-from-1.3" });
			const recovered = (await upgraded.waitFor((m) => m.type === "result", "1.4 recovery")).evidence as E;
			await upgraded.exited;
			const v14 = schemaVersion(copy);

			const refuse = legacy("open", copy);
			const refusal = (await refuse.next("result")).evidence;
			const restore = legacy("resume", backup);
			const restored = (await restore.next("result")).evidence;

			const evidence = { files, v13, v14, recovered: { settled: recovered.settled, users: recovered.transcript.users, paused: recovered.paused }, refusal, restored, integrity: [integrity(copy), integrity(backup)] };
			assert.ok(files.includes("session.sqlite"));
			assert.equal(v13, 1);
			assert.equal(v14, 2, "1.4 migrated the copy to SQLite schema v2");
			assert.equal(recovered.settled.status, "done", "1.4 recovered the pending 1.3 input");
			assert.deepEqual(recovered.transcript.users, ["hello from 1.3"]);
			assert.equal(refusal.version, "1.3.0");
			assert.equal(refusal.opened, false, "the old binary refuses the upgraded copy");
			assert.match(refusal.error, /newer than supported/);
			assert.deepEqual(restored, { version: "1.3.0", opened: true, status: "done" }, "untouched backup reopens and completes under 1.3");
			assert.deepEqual(evidence.integrity, ["ok", "ok"]);
			return evidence;
		}));

	const versions = (variant: string, check: (e: E) => void): Window => ({
		id: `schema.task-doc-${variant}`,
		scenario: "versions",
		barrier: "v1-running",
		crash: { armed: ["v1-running"] },
		verify: { variant },
		check,
	});
	const windows = [
		versions("upgrade", (e) => {
			assert.deepEqual(e.outcome, { status: "completed", result: "v2 migrated" }, "task migrated v1 → v2 and resumed");
			assert.deepEqual(e.doc, { count: 7, label: "migrated" }, "document migrated v1 → v2");
		}),
		versions("missing", (e) => {
			assert.deepEqual(e.blocked, { kind: "blocked", reason: "missing_task" }, "missing definition blocks visibly");
			assert.equal(e.wake.active, false);
			assert.deepEqual(e.outcome, { status: "completed", result: "v1 -" }, "installing the definition unblocks it");
		}),
		versions("failed", (e) => {
			assert.equal(e.blocked.kind, "blocked");
			assert.equal(e.blocked.reason, "migration_failed", "failed migration blocks, never runs");
			assert.ok(e.reports.includes("migration_failed"));
		}),
	];
	for (const window of windows) for (const mode of ["kill", "close"] as Mode[]) it(`${window.id} / ${mode}`, () => runWindow(window, mode));
});
