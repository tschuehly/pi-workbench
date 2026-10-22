// Parent side of the crash matrix: spawn a host process, wait for an explicit barrier, then hard-kill it (SIGKILL)
// or ask it to close gracefully; reopen in a fresh process and collect evidence; check SQLite integrity.
// Every iteration's evidence is appended to results/evidence/<window>.<mode>.jsonl.
import { type ChildProcess, fork } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ITERATIONS = Number(process.env.PILOT_ITERATIONS ?? 20);
const CONCURRENCY = Number(process.env.PILOT_CONCURRENCY ?? 6);
const TIMEOUT_MS = Number(process.env.PILOT_TIMEOUT_MS ?? 60_000);
const RUNS = process.env.PILOT_TMP ?? process.env.PI_TMP ?? join(PACKAGE, ".runs");

export type Mode = "kill" | "close";
type Message = { type: string; name?: string; data?: unknown; evidence?: Record<string, unknown>; message?: string };

export function scratch(label: string): string {
	mkdirSync(RUNS, { recursive: true });
	return mkdtempSync(join(RUNS, `dp-${label.replace(/[^a-z0-9]+/gi, "-")}-`));
}

export class HostProcess {
	readonly child: ChildProcess;
	readonly messages: Message[] = [];
	readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	#waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];
	stderr = "";

	constructor(scenario: string, phase: "crash" | "verify", dir: string, options: object) {
		this.child = fork(join(PACKAGE, "test", "proc.ts"), [scenario, phase, dir, JSON.stringify(options)], {
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		});
		this.child.stderr!.on("data", (data) => (this.stderr += data.toString()));
		this.child.on("message", (message: Message) => {
			this.messages.push(message);
			this.#waiters = this.#waiters.filter((waiter) => (waiter.match(message) ? (waiter.resolve(message), false) : true));
		});
		this.exited = new Promise((resolve) => this.child.on("exit", (code, signal) => resolve({ code, signal })));
	}

	/** Wait for a message; fails on process error/exit or timeout. */
	async waitFor(match: (m: Message) => boolean, what: string): Promise<Message> {
		const found = this.messages.find(match);
		if (found !== undefined) return found;
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				new Promise<Message>((resolve) => this.#waiters.push({ match, resolve })),
				this.exited.then((exit) => {
					const error = this.messages.find((m) => m.type === "error")?.message ?? this.stderr.slice(-2000);
					throw new Error(`Host exited (${JSON.stringify(exit)}) before ${what}: ${error}`);
				}),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error(`Timed out waiting for ${what}: ${this.stderr.slice(-2000)}`)), TIMEOUT_MS);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	async kill(): Promise<void> {
		this.child.kill("SIGKILL");
		await this.exited;
	}

	async close(): Promise<void> {
		this.child.send({ type: "close" });
		await this.waitFor((m) => m.type === "closed", "graceful close");
		await this.exited;
	}
}

export function integrity(dir: string): string {
	const database = new DatabaseSync(join(dir, "session.sqlite"));
	try {
		return (database.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
	} finally {
		database.close();
	}
}

export type Window = {
	readonly id: string;
	readonly scenario: string;
	readonly barrier: string;
	readonly crash: object;
	readonly verify: object;
	/** Throws when the evidence violates the row's required observation. */
	readonly check: (evidence: Record<string, unknown>, mode: Mode) => void;
};

function evidenceFile(window: string, mode: Mode): string {
	const file = join(PACKAGE, "results", "evidence", `${window}.${mode}.jsonl`);
	mkdirSync(dirname(file), { recursive: true });
	return file;
}

/** One fault-window iteration. */
export async function runOnce(window: Window, mode: Mode, iteration: number): Promise<Record<string, unknown>> {
	const dir = scratch(`${window.id}-${mode}`);
	const started = Date.now();
	const crash = new HostProcess(window.scenario, "crash", dir, window.crash);
	const barrier = await crash.waitFor((m) => m.type === "barrier" && m.name === window.barrier, `barrier ${window.barrier}`);
	if (mode === "kill") await crash.kill();
	else await crash.close();
	const verify = new HostProcess(window.scenario, "verify", dir, window.verify);
	const result = await verify.waitFor((m) => m.type === "result", "verify result");
	await verify.exited;
	const evidence = {
		iteration,
		mode,
		barrier: barrier.name,
		barrierData: barrier.data ?? null,
		crashMessages: crash.messages.map((m) => m.type).filter((t) => t !== "barrier"),
		...result.evidence,
		integrity: integrity(dir),
		ms: Date.now() - started,
	};
	let failure: unknown;
	try {
		if (evidence.integrity !== "ok") throw new Error(`integrity_check: ${evidence.integrity}`);
		window.check(evidence, mode);
	} catch (error) {
		failure = error;
	}
	appendFileSync(evidenceFile(window.id, mode), `${JSON.stringify({ ...evidence, pass: failure === undefined, ...(failure === undefined ? {} : { failure: String(failure), dir }) })}\n`);
	if (failure !== undefined) throw failure;
	rmSync(dir, { recursive: true, force: true });
	return evidence;
}

/** ITERATIONS runs of one window in one mode, CONCURRENCY at a time; rejects with every failure. */
export async function runWindow(window: Window, mode: Mode, iterations = ITERATIONS): Promise<void> {
	writeFileSync(evidenceFile(window.id, mode), "");
	const failures: string[] = [];
	let next = 0;
	const worker = async () => {
		while (next < iterations) {
			const iteration = next++;
			try {
				await runOnce(window, mode, iteration);
			} catch (error) {
				failures.push(`#${iteration}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, iterations) }, worker));
	if (failures.length > 0) throw new Error(`${window.id}/${mode}: ${failures.length}/${iterations} failed\n${failures.slice(0, 5).join("\n")}`);
}
