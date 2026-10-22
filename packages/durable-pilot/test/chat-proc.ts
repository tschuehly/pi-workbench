// Drives the Durable Chat host process PI WEB spawns (src/chat-host-main.ts) over its real IPC protocol, with the
// scripted faux model. Shared by the composer, context-tools, extensions and packages tests; every barrier is an event the host
// emitted after a commit.
import { type ChildProcess, fork } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readLog } from "../src/faux.ts";
import { codexToken } from "./refresh-race.ts";
import { PACKAGE, scratch } from "./runner.ts";

/** Fake stored logins for Claude, ChatGPT and Copilot in a Pi agent dir, so hosts never read or lock the owner's auth.json. */
export function writeFakeLogins(agentDir: string, tag = "chat"): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
		anthropic: { type: "oauth", access: "fake-oat", refresh: "fake-ort", expires: Date.now() + 3_600_000 },
		"openai-codex": { type: "oauth", access: codexToken(tag), refresh: "fake-codex", expires: Date.now() + 3_600_000, accountId: `acct-${tag}` },
		"github-copilot": { type: "oauth", access: "tid=fake;proxy-ep=proxy.individual.githubcopilot.com", refresh: "fake-gh", expires: Date.now() + 3_600_000 },
	}), { mode: 0o600 });
}

/** A scratch Pi agent dir with fake logins. */
export function fakeAgentDir(label: string): string {
	const dir = join(scratch(label), "agent");
	writeFakeLogins(dir);
	return dir;
}

// Hermetic: every host this driver starts (and any in-process store in its tests) reads a scratch agent dir with fake
// logins; a test passes its own PI_CODING_AGENT_DIR in `env` when it needs one.
process.env.PI_CODING_AGENT_DIR = fakeAgentDir("chat-proc-agent");
// Workbench bash jobs go to a scratch registry, never the owner's ~/.pi-workbench/background-bash.
process.env.PI_BACKGROUND_BASH_ROOT ??= join(scratch("chat-proc-jobs"), "jobs");

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

	/** Wait until `count` runs have ended. */
	idle(count: number): Promise<UiEvent> {
		return this.until(() => this.events.filter((e) => e.type === "agent.end").length >= count, `${count} runs`);
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

export type Message = { role: string; entryId?: string; content?: unknown; stopReason?: string; isError?: boolean; customType?: string; source?: string; details?: Record<string, unknown> };
export type Status = {
	isStreaming: boolean;
	isCompacting: boolean;
	queuedMessages: { kind: string; text: string }[];
	warnings?: { severity: string; message: string }[];
	extensionStatuses?: Record<string, string>;
	unresolvedEffects?: { id: string; toolName: string; arguments: string }[];
};
export type Transcript = { messages: Message[]; partial: unknown; status: Status };

export const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : "";

export function family(label: string): { store: string; cwd: string } {
	const dir = scratch(`chat-${label}`);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd);
	return { store: join(dir, "family"), cwd };
}

export type Logged = { label: string; workingMode?: number; focus?: string; tools?: string[]; sections?: string[]; reasoning?: string; images?: number; ran?: string[]; messages?: number; reminder?: string };
export const logged = (store: string) => readLog<Logged>(join(store, "requests.log"));

export function integrity(store: string): string {
	const db = new DatabaseSync(join(store, "session.sqlite"));
	try {
		return (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
	} finally {
		db.close();
	}
}

export const idle = (host: ChatHost, count: number) => host.idle(count);

/** Poll for a condition a file shows (an effect or a provider request), for barriers no event marks. */
export async function waitFor(condition: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
