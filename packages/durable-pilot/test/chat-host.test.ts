// The Durable Chat host process PI WEB spawns (src/chat-host-main.ts), driven over its real IPC protocol with the
// scripted faux model: one full turn as PI WEB session events, Stop, and the Phase A crash rows that apply to Phase B
// slice 1 (generation, safe/unsafe tools, queued input, ownership) rerun against this host. Every barrier is an event
// the host emitted after the relevant commit; no timing sleeps.
import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readLog } from "../src/faux.ts";
import { cleanup, PACKAGE, scratch } from "./runner.ts";

type UiEvent = { type: string; [key: string]: unknown };
type Reply = { id?: number; result?: unknown; error?: { name: string; message: string }; event?: UiEvent; ready?: { protocol: number; ownerEpoch: number } };

const live = new Set<ChildProcess>();
// Host processes inherit this: telemetry goes to scratch, never to the owner's ~/.pi/agent/telemetry.
const TELEMETRY = scratch("chat-telemetry");
process.env.PI_TELEMETRY_DIR = TELEMETRY;
// Hermetic: no storage-guard notice from this machine's real free space, and PI_TMP folders in scratch.
process.env.PI_STORAGE_GUARD_FREE_GB = "1000";
process.env.PI_TMP_ROOT = scratch("chat-pi-tmp");

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
	assert.equal((await host.ready).protocol, 2);
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
	assert.deepEqual(queued.queuedMessages.map(({ kind, text }) => ({ kind, text })), [{ kind: "followUp", text: "the follow-up" }]);
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

// ─── Slice 2: Workbench behaviors against the real host process ─────────────

type Status = Transcript["status"] & {
	model?: { provider: string; id: string };
	extensionStatuses?: Record<string, string>;
	pendingAsks?: { askId: string; revision: string; questions: { id: string }[]; turnsSinceUpdate: number }[];
	attentionRequest?: { id: string; reason: string };
	unresolvedEffects?: { id: string; toolName: string; arguments: string }[];
};
type Logged = { label: string; workingMode?: number; sections?: string[] };
const logged = (store: string) => readLog<Logged>(join(store, "requests.log"));
const mode = (status: Status) => JSON.parse(status.extensionStatuses?.["working-mode"] ?? "null") as { phase: string; selected: Record<string, string>; applied: Record<string, string> | null; aligned: boolean };
const idle = (host: ChatHost, count: number) => host.until(() => host.events.filter((e) => e.type === "agent.end").length >= count, `${count} runs`);

const ASK = {
	context: "The deploy target is ambiguous.",
	questions: [{ id: "target", question: "Which target?", options: [{ value: "prod", label: "Production", recommended: true }, { value: "staging", label: "Staging" }] }],
};

/** The outcome PI WEB's PendingAskStore computes for one answered question (the daemon sends it). */
const answered = (askId: string) => ({
	askId, reason: "submitted", askedAt: "", closedAt: "", context: ASK.context,
	questions: [{ question: ASK.questions[0], answered: true, values: ["staging"] }],
	answeredCount: 1, unansweredIds: [], summary: "Answered 1 of 1; none left unanswered",
});

test("Working Mode: a selection survives a restart, rides with the next prompt once, /mode send delivers it now, alignment is recorded", async () => {
	const { store, cwd } = family("mode");
	let host = new ChatHost(store, cwd);
	await host.ready;
	assert.deepEqual(await host.call("mode", { args: "attention focused" }), { type: "done", message: "Working Mode applies with the next prompt." });
	assert.equal((await host.call<{ type: string }>("mode", { args: "attention sideways" })).type, "unsupported");
	assert.equal(mode(await host.call<Status>("status")).selected.attention, "Focused");
	await host.close();

	host = new ChatHost(store, cwd);
	await host.ready;
	const restored = mode(await host.call<Status>("status"));
	assert.equal(restored.selected.attention, "Focused", "the selection survived the restart");
	assert.equal(restored.phase, "selected");
	await host.call("prompt", { operationId: "op-1", text: "hello" });
	await idle(host, 1);
	await host.call("prompt", { operationId: "op-2", text: "again" });
	await idle(host, 2);
	assert.deepEqual(logged(store).map((l) => [l.label, l.workingMode]), [["hello", 1], ["again", undefined]], "the block rides with the first prompt only");
	const transcript = await host.call<{ messages: { role: string; customType?: string; content: unknown; details?: { selection: Record<string, string> } }[] }>("transcript");
	assert.deepEqual(transcript.messages.slice(0, 2).map((m) => [m.role, m.customType ?? textOf(m.content)]), [["custom", "working-mode"], ["user", "hello"]]);
	assert.match(String(transcript.messages[0]!.content), /Attention — Focused: Thomas is watching/);
	assert.equal(mode(await host.call<Status>("status")).applied?.attention, "Focused");

	await host.call("mode", { args: "checking test" });
	assert.deepEqual(await host.call("mode", { args: "send" }), { type: "done" });
	await idle(host, 3);
	assert.deepEqual(await host.call("mode", { args: "send" }), { type: "done", message: "Working Mode unchanged" });
	assert.equal(logged(store).at(-1)?.workingMode, 2, "/mode send started a turn with block 2");

	await host.call("prompt", { operationId: "op-3", text: 'call:alignment_reached {"agreement":"ship it"}' });
	await idle(host, 4);
	assert.equal(mode(await host.call<Status>("status")).aligned, true);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("crash row question: an open set survives a kill, a stale answer is refused, one answer is delivered once, a retried answer returns the same outcome", async () => {
	const { store, cwd } = family("question");
	let host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-ask", text: `call:ask_user ${JSON.stringify(ASK)}` });
	const opened = await host.until((e) => e.type === "ask.opened", "the ask") as UiEvent & { ask: { askId: string; revision: string } };
	const notified = await host.until((e) => e.type === "durable.attention", "the ask notification");
	assert.equal(notified.kind, "ask");
	await idle(host, 1);
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	const status = await host.call<Status>("status");
	assert.deepEqual(status.pendingAsks?.map((a) => [a.askId, a.revision]), [[opened.ask.askId, opened.ask.revision]], "the same set, same revision");
	assert.equal(host.events.filter((e) => e.type === "durable.attention").length, 0, "reopen does not notify again");
	const close = (revision: string, operationId: string) =>
		host.call<{ result: string; outcome?: unknown; retried?: boolean }>("closeAsk", { askId: opened.ask.askId, revision, operationId, outcome: answered(opened.ask.askId), content: "Answers: target staging" });
	assert.deepEqual(await close("old-revision", "op-a0"), { result: "stale" });
	const first = await close(opened.ask.revision, "op-a1");
	assert.equal(first.result, "closed");
	await host.kill(); // right after the answer commit: delivery may not have run yet

	host = new ChatHost(store, cwd);
	await host.ready;
	const retried = await close(opened.ask.revision, "op-a1");
	assert.deepEqual([retried.result, retried.retried], ["closed", true], "a retried answer gets its outcome back, not stale");
	assert.equal((await close(opened.ask.revision, "op-a2")).result, "stale", "another answer to the closed set is stale");
	await host.call("prompt", { operationId: "op-after", text: "after" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: after", "the next answer");
	const deliveries = logged(store).filter((l) => l.label.startsWith("Answers: target staging"));
	assert.equal(deliveries.length, 1, "the answers reached the model exactly once");
	const transcript = await host.call<{ messages: { role: string; customType?: string; details?: { askId?: string } }[] }>("transcript");
	assert.equal(transcript.messages.filter((m) => m.customType === "pi-web.ask.answers").length, 1);
	assert.equal(transcript.messages.find((m) => m.customType === "pi-web.ask.answers")?.details?.askId, opened.ask.askId);
	assert.deepEqual((await host.call<Status>("status")).pendingAsks, undefined);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("request_attention persists across a kill, notifies once, and clears only by its exact ID or a new message", async () => {
	const { store, cwd } = family("attention");
	let host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: 'call:request_attention {"reason":"Please review the diff"}' });
	const event = await host.until((e) => e.type === "durable.attention" && e.kind === "attention", "the attention event");
	await idle(host, 1);
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	const status = await host.call<Status>("status");
	assert.deepEqual(status.attentionRequest, { id: event.id, reason: "Please review the diff" });
	assert.equal(await host.call("acknowledgeAttention", { requestId: "an-older-id" }), false, "an old ID never clears a newer request");
	assert.equal(await host.call("acknowledgeAttention", { requestId: event.id }), true);
	assert.equal((await host.call<Status>("status")).attentionRequest, undefined);
	await host.call("prompt", { operationId: "op-2", text: 'call:request_attention {"reason":"Log in again"}' });
	await idle(host, 1);
	assert.equal((await host.call<Status>("status")).attentionRequest?.reason, "Log in again");
	await host.call("prompt", { operationId: "op-3", text: "here" });
	assert.equal((await host.call<Status>("status")).attentionRequest, undefined, "sending a message answers it");
	assert.equal(host.events.filter((e) => e.type === "durable.attention").length, 1, "one notification per request");
	await host.close();
});

test("model switching is per Chat, persisted, and applies to the next request", async () => {
	const { store, cwd } = family("model");
	let host = new ChatHost(store, cwd);
	await host.ready;
	const models = await host.call<{ provider: string; id: string }[]>("models");
	assert.ok(models.some((m) => m.provider === "faux"), "the scripted model is offered");
	const claude = models.find((m) => m.provider === "anthropic" && m.id.startsWith("claude-"));
	assert.ok(claude !== undefined, "Claude subscription models are offered");
	await assert.rejects(host.call("setModel", { provider: "anthropic", modelId: "no-such-model" }), /Unknown model/);
	await host.call("setModel", { provider: claude.provider, modelId: claude.id });
	assert.deepEqual((await host.call<Status>("status")).model, { provider: claude.provider, id: claude.id });
	await host.close();

	host = new ChatHost(store, cwd);
	await host.ready;
	assert.deepEqual((await host.call<Status>("status")).model, { provider: claude.provider, id: claude.id }, "persisted across a restart");
	await host.call("setModel", { provider: "faux", modelId: "faux-1" });
	await host.call("prompt", { operationId: "op-1", text: "on faux" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: on faux", "the scripted answer");
	assert.deepEqual(logged(store).map((l) => l.label), ["on faux"], "only the scripted model was asked; no Claude request");
	await host.close();
});

test("resolve: the owner marks an interrupted bash retry; it is recorded, the model is told once, and bash runs again", async () => {
	const { store, cwd } = family("resolve");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"echo deploy >> effects.log; echo started; sleep 5"}' });
	await first.until((e) => e.type === "tool.update" && String(e.text).includes("started"), "the effect");
	await first.kill();

	const host = new ChatHost(store, cwd);
	await host.ready;
	const [effect] = (await host.call<Status>("status")).unresolvedEffects ?? [];
	assert.equal(effect?.toolName, "bash");
	assert.match(effect!.arguments, /echo deploy/);
	await assert.rejects(host.call("resolveEffect", { taskId: "999", resolution: "done" }), /No interrupted call/);
	await host.call("resolveEffect", { taskId: effect!.id, resolution: "retry" });
	await host.call("resolveEffect", { taskId: effect!.id, resolution: "retry" }); // an HTTP retry
	await assert.rejects(host.call("resolveEffect", { taskId: effect!.id, resolution: "done" }), /already marked retry/);
	assert.equal((await host.call<Status>("status")).unresolvedEffects, undefined);
	await host.until(() => logged(store).some((l) => l.label.startsWith("The user resolved the interrupted bash")), "the resolution reaching the model");
	await host.call("prompt", { operationId: "op-2", text: 'call:bash {"command":"echo deploy >> effects.log"}' });
	await host.until((e) => e.type === "tool.end" && e.toolName === "bash" && e.isError === false, "a bash call that is no longer blocked");
	assert.equal(logged(store).filter((l) => l.label.startsWith("The user resolved")).length, 1, "the model was told once");
	const transcript = await host.call<{ messages: { role: string; customType?: string }[] }>("transcript");
	assert.equal(transcript.messages.filter((m) => m.customType === "workbench.reconciliation").length, 1);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("resources and telemetry: PI WEB's AGENTS.md/skill sections reach the model; the Workbench telemetry events are written", async () => {
	const { store, cwd } = family("resources");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("configure", { resources: { projectContext: "Project-specific instructions and guidelines:\n\nRULE-42", skills: "<available_skills/>", sources: [{ path: "/x/AGENTS.md", sha256: "abc" }] } });
	await host.call("prompt", { operationId: "op-1", text: "hi" });
	await idle(host, 1);
	assert.deepEqual(logged(store)[0]?.sections, ["project_context", "skills"]);
	await host.close();
	const events = readdirSync(TELEMETRY).flatMap((file) => readLog<{ type: string; sessionId: string; usageKey?: string }>(join(TELEMETRY, file)));
	const mine = events.filter((e) => e.sessionId === store);
	for (const type of ["session.start", "prompt", "agent.start", "usage", "agent.settled", "session.shutdown"]) assert.ok(mine.some((e) => e.type === type), `${type} recorded`);
	assert.ok(mine.find((e) => e.type === "usage")?.usageKey?.startsWith(`${store}:assistant:`));
});

test("an orderly SIGTERM closes the store gracefully: exit 0, the running unsafe call is held for the owner, telemetry ends the session", async () => {
	const { store, cwd } = family("sigterm");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"echo deploy >> effects.log; sleep 30"}' });
	// Barrier: the effect itself (the command prints nothing, so no event would wake an event wait).
	while (!existsSync(join(cwd, "effects.log"))) await new Promise((resolve) => setTimeout(resolve, 20));
	host.child.kill("SIGTERM");
	assert.equal(await host.exited, 0);
	const reopened = new ChatHost(store, cwd);
	await reopened.ready;
	assert.equal((await reopened.call<Status>("status")).unresolvedEffects?.[0]?.toolName, "bash");
	await reopened.close();
	assert.equal(integrity(store), "ok");
	const events = readdirSync(TELEMETRY).flatMap((file) => readLog<{ type: string; sessionId: string }>(join(TELEMETRY, file))).filter((e) => e.sessionId === store);
	assert.equal(events.filter((e) => e.type === "session.shutdown").length, 2, "both host lifetimes ended with session.shutdown");
});
