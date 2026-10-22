// Drives the Durable Chat host process PI WEB spawns (src/chat-host-main.ts) over its real IPC protocol, with the
// scripted faux model. Shared by the composer tests; every barrier is an event the host emitted after a commit.
import { type ChildProcess, fork } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readLog } from "../src/faux.ts";
import { PACKAGE, scratch } from "./runner.ts";

export type UiEvent = { type: string; [key: string]: unknown };
type Reply = { id?: number; result?: unknown; error?: { name: string; message: string }; event?: UiEvent; ready?: { protocol: number; ownerEpoch: number } };

export const live = new Set<ChildProcess>();

export class ChatHost {
	readonly child: ChildProcess;
	readonly events: UiEvent[] = [];
	readonly exited: Promise<number | null>;
	stderr = "";
	#next = 1;
	#pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	#waiters: (() => void)[] = [];
	ready: Promise<NonNullable<Reply["ready"]>>;

	constructor(store: string, cwd: string, options: { tps?: number; env?: NodeJS.ProcessEnv; args?: string[] } = {}) {
		this.child = fork(join(PACKAGE, "src", "chat-host-main.ts"), ["--store", store, "--cwd", cwd, "--model", "faux", "--faux-tps", String(options.tps ?? 400), ...(options.args ?? [])], {
			stdio: ["ignore", "ignore", "pipe", "ipc"],
			// The host's real free disk must not add storage-guard notices to transcripts; tests pass their own reading.
			env: { ...process.env, PI_STORAGE_GUARD_FREE_GB: "1000", ...options.env },
		});
		live.add(this.child);
		this.child.stderr!.on("data", (data) => (this.stderr += data.toString()));
		let markReady!: (ready: NonNullable<Reply["ready"]>) => void;
		this.ready = new Promise((resolve) => (markReady = resolve));
		this.child.on("message", (message: Reply) => {
			if (message.ready !== undefined) markReady(message.ready);
			if (message.event !== undefined) {
				this.events.push(message.event);
				for (const wake of this.#waiters.splice(0)) wake();
			}
			if (message.id !== undefined) {
				const pending = this.#pending.get(message.id)!;
				this.#pending.delete(message.id);
				if (message.error !== undefined) pending.reject(Object.assign(new Error(message.error.message), { name: message.error.name }));
				else pending.resolve(message.result);
			}
		});
		this.exited = new Promise((resolve) => this.child.on("exit", (code) => (live.delete(this.child), resolve(code))));
	}

	call<T = unknown>(method: string, params?: object): Promise<T> {
		const id = this.#next++;
		return new Promise<T>((resolve, reject) => {
			this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.child.send({ id, method, ...(params === undefined ? {} : { params }) });
		});
	}

	/** Wait until an emitted event matches; fails if the host exits first. */
	async until(match: (event: UiEvent) => boolean, what: string): Promise<UiEvent> {
		for (;;) {
			const found = this.events.find(match);
			if (found !== undefined) return found;
			const exited = await Promise.race([new Promise<false>((resolve) => this.#waiters.push(() => resolve(false))), this.exited.then(() => true)]);
			if (exited) throw new Error(`host exited before ${what}: ${this.stderr}`);
		}
	}

	kill(): Promise<number | null> {
		this.child.kill("SIGKILL");
		return this.exited;
	}

	async close(): Promise<void> {
		await this.call("close");
		await this.exited;
	}
}

export const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : "";

export function family(label: string): { store: string; cwd: string } {
	const dir = scratch(`chat-${label}`);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd);
	return { store: join(dir, "family"), cwd };
}

export type Logged = { label: string; reasoning?: string; images?: number; ran?: string[] };
export const logged = (store: string) => readLog<Logged>(join(store, "requests.log"));

export function integrity(store: string): string {
	const db = new DatabaseSync(join(store, "session.sqlite"));
	try {
		return (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
	} finally {
		db.close();
	}
}

export const idle = (host: ChatHost, count: number) => host.until(() => host.events.filter((e) => e.type === "agent.end").length >= count, `${count} runs`);
