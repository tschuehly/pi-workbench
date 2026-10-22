// The Durable Chat host process PI WEB spawns (src/chat-host-main.ts), driven over its real IPC protocol with the
// scripted faux model: one full turn as PI WEB session events, Stop, and the Phase A crash rows that apply to Phase B
// slice 1 (generation, safe/unsafe tools, queued input, ownership) rerun against this host. Every barrier is an event
// the host emitted after the relevant commit; no timing sleeps.
import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readLog } from "../src/faux.ts";
import { cleanup, PACKAGE, scratch } from "./runner.ts";

type UiEvent = { type: string; [key: string]: unknown };
type Reply = { id?: number; result?: unknown; error?: { name: string; message: string }; event?: UiEvent; ready?: { protocol: number; ownerEpoch: number } };

const live = new Set<ChildProcess>();

class ChatHost {
	readonly child: ChildProcess;
	readonly events: UiEvent[] = [];
	readonly exited: Promise<number | null>;
	stderr = "";
	#next = 1;
	#pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	#waiters: (() => void)[] = [];
	ready: Promise<NonNullable<Reply["ready"]>>;

	constructor(store: string, cwd: string, tps = 400) {
		this.child = fork(join(PACKAGE, "src", "chat-host-main.ts"), ["--store", store, "--cwd", cwd, "--model", "faux", "--faux-tps", String(tps)], {
			stdio: ["ignore", "ignore", "pipe", "ipc"],
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

type Transcript = { messages: { role: string; entryId?: string; content?: unknown; stopReason?: string; isError?: boolean }[]; partial: unknown; status: { isStreaming: boolean; queuedMessages: { kind: string; text: string }[]; warnings?: unknown[] } };

const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : "";

function family(label: string): { store: string; cwd: string } {
	const dir = scratch(`chat-${label}`);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd);
	return { store: join(dir, "family"), cwd };
}

const requests = (store: string) => readLog<{ label: string }>(join(store, "requests.log")).map((line) => line.label);
const integrity = (store: string) => {
	const db = new DatabaseSync(join(store, "session.sqlite"));
	try {
		return (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
	} finally {
		db.close();
	}
};

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

test("a turn reaches PI WEB as session events and a transcript with entry IDs", async () => {
	const { store, cwd } = family("turn");
	writeFileSync(join(cwd, "notes.txt"), "seeded\n");
	const host = new ChatHost(store, cwd);
	assert.equal((await host.ready).protocol, 1);
	await host.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"cat notes.txt && echo written > out.txt"}' });
	await host.until((e) => e.type === "agent.end", "the run to end");
	const types = host.events.map((e) => e.type);
	for (const type of ["agent.start", "tool.start", "tool.end", "message.end", "assistant.start", "agent.end", "status.update"]) assert.ok(types.includes(type), `${type} in ${types.join(",")}`);
	assert.ok(types.indexOf("tool.start") < types.indexOf("tool.end"));
	const end = host.events.find((e) => e.type === "tool.end")!;
	assert.equal(end.isError, false);
	assert.match(String(end.text), /seeded/);
	assert.equal(readFileSync(join(cwd, "out.txt"), "utf8"), "written\n");
	const start = host.events.findLast((e) => e.type === "assistant.start")!;
	const deltas = host.events.slice(host.events.indexOf(start)).filter((e) => e.type === "assistant.delta").map((e) => e.text).join("");
	assert.equal(textOf((start.message as { content: unknown }).content) + deltas, "done after bash");
	const transcript = await host.call<Transcript>("transcript");
	assert.deepEqual(transcript.messages.map((m) => m.role), ["user", "assistant", "toolResult", "assistant"]);
	assert.ok(transcript.messages.every((m) => typeof m.entryId === "string"));
	assert.equal(transcript.partial, null);
	assert.equal(transcript.status.isStreaming, false);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("Stop withdraws the queued follow-up and ends the running bash call", async () => {
	const { store, cwd } = family("stop");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"echo running; sleep 20"}' });
	await host.until((e) => e.type === "tool.update" && String(e.text).includes("running"), "bash output");
	await host.call("prompt", { operationId: "op-2", text: "the follow-up" });
	const queued = await host.call<Transcript["status"]>("status");
	assert.deepEqual(queued.queuedMessages, [{ kind: "followUp", text: "the follow-up" }]);
	await host.call("abort");
	const status = await host.call<Transcript["status"]>("status");
	assert.equal(status.isStreaming, false);
	assert.deepEqual(status.queuedMessages, []);
	const transcript = await host.call<Transcript>("transcript");
	assert.ok(!transcript.messages.some((m) => m.role === "user" && textOf(m.content) === "the follow-up"), "the withdrawn follow-up is never placed");
	const result = transcript.messages.find((m) => m.role === "toolResult");
	assert.equal(result?.isError, true);
	assert.deepEqual((result?.content as { type: string }[]).map((part) => part.type), ["text"], "one text block, as PI WEB renders one tool row");
	assert.match(textOf(result?.content), /running[\s\S]*aborted/);
	assert.deepEqual(requests(store), ['call:bash {"command":"echo running; slee']);
	await host.close();
});

test("crash row generation: a committed partial survives a kill, restore stays paused, then the request is sent again", async () => {
	const { store, cwd } = family("generation");
	const first = new ChatHost(store, cwd, 40);
	await first.ready;
	await first.call("prompt", { operationId: "op-gen", text: "gen" });
	await first.until((e) => e.type === "assistant.delta", "a committed partial");
	await first.kill();
	const second = new ChatHost(store, cwd);
	const ready = await second.ready;
	assert.equal(ready.ownerEpoch, 2);
	const paused = await second.call<Transcript>("transcript");
	assert.ok((paused.status.warnings ?? []).length > 0, "restored paused");
	assert.deepEqual(requests(store), ["gen"], "status and transcript reads send no request");
	// Sending is Thomas's resume: the interrupted generation is reissued first, then the new input is answered.
	await second.call("prompt", { operationId: "op-next", text: "next" });
	await second.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: next", "the next answer");
	const transcript = await second.call<Transcript>("transcript");
	const users = transcript.messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
	assert.deepEqual(users, ["gen", "next"], "one admitted input each");
	const assistants = transcript.messages.filter((m) => m.role === "assistant");
	assert.equal(assistants[0]?.stopReason, "aborted", "the committed partial is visibly aborted");
	assert.match(textOf(assistants[1]?.content), /^word0 word1/);
	assert.deepEqual(requests(store), ["gen", "gen", "next"]);
	await second.close();
	assert.equal(integrity(store), "ok");
});

test("crash row tools: an interrupted unsafe bash never reruns and blocks a new bash; safe read still runs", async () => {
	const { store, cwd } = family("tools");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"echo deploy >> effects.log; echo started; sleep 5"}' });
	await first.until((e) => e.type === "tool.update" && String(e.text).includes("started"), "the effect");
	await first.kill();
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-2", text: 'call:bash {"command":"echo deploy >> effects.log"}' });
	await second.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "done after bash" && e !== undefined && second.events.filter((x) => x.type === "tool.end").length >= 2, "both bash results");
	const ends = second.events.filter((e) => e.type === "tool.end");
	assert.match(String(ends[0]?.text), /interrupted/i, "the interrupted call is not rerun");
	assert.match(String(ends[1]?.text), /Needs reconciliation/, "a fresh bash call is blocked");
	assert.deepEqual(readFileSync(join(cwd, "effects.log"), "utf8").trim().split("\n"), ["deploy"], "the effect ran once");
	writeFileSync(join(cwd, "readme.txt"), "safe\n");
	await second.call("prompt", { operationId: "op-3", text: 'call:read {"path":"readme.txt"}' });
	const read = await second.until((e) => e.type === "tool.end" && e.toolName === "read", "the read");
	assert.equal(read.isError, false);
	await second.close();
	assert.equal(integrity(store), "ok");
});

test("crash row queued input: an acknowledged follow-up survives a kill once, a retry is deduplicated, a changed payload is rejected", async () => {
	const { store, cwd } = family("queue");
	const first = new ChatHost(store, cwd, 40);
	await first.ready;
	await first.call("prompt", { operationId: "op-gen", text: "gen" });
	await first.until((e) => e.type === "assistant.delta", "the running answer");
	const acknowledged = await first.call<{ submissionId: number }>("prompt", { operationId: "op-follow", text: "queued after kill" });
	await first.kill();
	const second = new ChatHost(store, cwd);
	await second.ready;
	const retried = await second.call<{ submissionId: number }>("prompt", { operationId: "op-follow", text: "queued after kill" });
	assert.equal(retried.submissionId, acknowledged.submissionId, "same operation, same submission");
	await assert.rejects(second.call("prompt", { operationId: "op-follow", text: "changed" }), /different payload/);
	await second.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: queued after kill", "the follow-up answer");
	const transcript = await second.call<Transcript>("transcript");
	assert.deepEqual(transcript.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)), ["gen", "queued after kill"]);
	await second.close();
	assert.equal(integrity(store), "ok");
});

test("crash row ownership: a second host on the same store refuses to open", async () => {
	const { store, cwd } = family("owner");
	const first = new ChatHost(store, cwd);
	await first.ready;
	const second = new ChatHost(store, cwd);
	assert.notEqual(await second.exited, 0);
	assert.match(second.stderr, /owned by another process/);
	assert.ok(existsSync(join(store, "owner.json")));
	await first.close();
});
