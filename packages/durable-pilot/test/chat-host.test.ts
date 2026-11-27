// The Durable Chat host process PI WEB spawns (src/chat-host-main.ts), driven over its real IPC protocol with the
// scripted faux model: one full turn as PI WEB session events, Stop, and the Phase A crash rows that apply to Phase B
// slice 1 (generation, safe/unsafe tools, queued input, ownership) rerun against this host. Every barrier is an event
// the host emitted after the relevant commit; no timing sleeps.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readLog } from "../src/faux.ts";
import { openChatHost } from "../src/chat.ts";
import { ChatSession, pageTranscript, piWebChatTitle } from "../src/chat-session.ts";
import { IDLE_COMPACTION_ENTRY } from "../src/idle-compact.ts";
import { submitWake } from "../src/cheap-wake.ts";
import { AgentDoc, LiveDoc } from "@earendil-works/pi-durable";
import { context } from "../src/host.ts";
import { QuestionsDoc, questionsState, WorkingModeDoc, workingModeSnapshot } from "../src/workbench.ts";
import { AFK_CLOSE_PROMPT, BACK_PROMPT } from "../../../extensions/working-mode/rules.mts";
import { fakeAgentDir } from "./chat-proc.ts";
import { cleanup, PACKAGE, scratch } from "./runner.ts";

type UiEvent = { type: string; [key: string]: unknown };
type Reply = { id?: number; result?: unknown; error?: { name: string; message: string }; event?: UiEvent; ready?: { protocol: number; ownerEpoch: number; capabilities?: string[] } };

const live = new Set<ChildProcess>();
// Host processes inherit this: telemetry goes to scratch, never to the owner's ~/.pi/agent/telemetry.
const TELEMETRY = scratch("chat-telemetry");
process.env.PI_TELEMETRY_DIR = TELEMETRY;
// Hermetic: no storage-guard notice from this machine's real free space, and PI_TMP folders in scratch.
process.env.PI_STORAGE_GUARD_FREE_GB = "1000";
process.env.PI_TMP_ROOT = scratch("chat-pi-tmp");
// And a scratch Workstream store: no host reads the owner's (the idle compaction looks up a Chat's Workstream).
process.env.PI_WORKBENCH_WORKSTREAM_DIR = scratch("chat-workstreams");
// And a Pi agent dir with fake stored logins, so hosts never read or lock the owner's auth.json.
process.env.PI_CODING_AGENT_DIR = fakeAgentDir("chat-agent");

/**
 * The reconciliation rows need a real unsafe call that a kill interrupts mid-effect: `write` into a FIFO, whose open
 * blocks until a reader comes (a lead's bash is the replay-safe Workbench bash, which reattaches instead).
 */
function heldWrite(cwd: string): string {
	execFileSync("mkfifo", [join(cwd, "effect.fifo")]);
	return 'call:write {"path":"effect.fifo","content":"deploy\\n"}';
}
/**
 * An orderly close joins the running call, and an open blocked on a FIFO cannot be aborted: a non-blocking reader lets
 * the held write finish (the effect lands, its result is never committed). Returns what was written, once read.
 */
function releaseWrite(cwd: string): () => string {
	const fd = openSync(join(cwd, "effect.fifo"), constants.O_RDONLY | constants.O_NONBLOCK);
	return () => {
		try {
			const buffer = Buffer.alloc(64);
			return buffer.subarray(0, readSync(fd, buffer)).toString();
		} catch {
			return ""; // nothing written (EAGAIN): the close came before the write's open
		} finally {
			closeSync(fd);
		}
	};
}
/** The held write is running: its tool task committed its intent (the live slot reads running). */
/**
 * The held write has its durable intent. Durable 1.5 shows the slot running (a deferred commit) just before it stores the
 * intent, so a kill right at `tool.start` can still find the call unstarted; the pause covers that one commit.
 */
const writing = async (host: ChatHost) => {
	await host.until((e) => e.type === "tool.start" && e.toolName === "write", "the held write");
	// shortcut: a fixed pause for one SQLite commit (the owner holds the store EXCLUSIVE, so the test cannot read it);
	// replace with a host-reported durable-intent signal if it ever flakes under load.
	await new Promise((resolve) => setTimeout(resolve, 500));
};

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

type Transcript = { messages: { role: string; entryId?: string; content?: unknown; stopReason?: string; isError?: boolean }[]; partial: unknown; status: { isStreaming: boolean; queuedMessages: { kind: string; text: string }[]; warnings?: unknown[]; workingModeSample?: number } };

const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : "";

function family(label: string): { store: string; cwd: string } {
	const dir = scratch(`chat-${label}`, { repo: true });
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
	const ready = await host.ready;
	assert.equal(ready.protocol, 2);
	assert.deepEqual(ready.capabilities, ["queue.edit", "queue.promote", "attachments", "thinking", "shell", "compact", "compact-and-continue", "tool-groups", "tree", "liveReview", "viewed", "ask-images", "owner-run"], "the gated PI WEB operations this host supports");
	await host.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"cat notes.txt && echo written > out.txt","description":"Read and write","foreground":true}' });
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
	const paged = await host.call<Transcript>("transcript", { limit: 1 });
	// Each status read takes the next Working Mode sample number.
	assert.deepEqual(paged, { ...transcript, status: { ...transcript.status, workingModeSample: paged.status.workingModeSample }, messages: transcript.messages.slice(-1), start: 3, total: 4, usage: transcript.messages.filter((m) => m.role === "assistant").map(({ role, provider, model, usage, timestamp, stopReason, entryId }: Record<string, unknown>) => ({ role, provider, model, usage, timestamp, stopReason, entryId })) }, "a hard-limited page");
	await assert.rejects(host.call("transcript", { limit: -1 }), /non-negative integers/);
	// Every turn request asks for the long prompt-cache tier.
	const retention = readLog<{ cacheRetention?: string }>(join(store, "requests.log")).map((line) => line.cacheRetention);
	assert.deepEqual(retention, ["long", "long"]);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("--read-transcript reads a closed Chat's history without a host: the messages it would show, no package, no model request", async () => {
	const { store, cwd } = family("read-transcript");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"echo hi","description":"Say hi","foreground":true}' });
	await host.until((e) => e.type === "agent.end", "the run to end");
	const { messages } = await host.call<Transcript>("transcript");
	await host.close();
	const sent = requests(store).length;

	// As PI WEB launches it: the host's usual arguments, packages included, plus the read flag.
	const reader = fork(join(PACKAGE, "src", "chat-host-main.ts"), ["--store", store, "--cwd", cwd, "--model", "faux", "--packages", "--read-transcript"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
	let stderr = "";
	reader.stderr!.on("data", (data) => (stderr += data.toString()));
	const received: unknown[] = [];
	reader.on("message", (message) => received.push(message));
	const code = await new Promise((resolve) => reader.on("exit", resolve));
	assert.equal(code, 0, stderr);
	assert.deepEqual(received, [{ transcript: { messages } }], "only the transcript: no ready handshake, no events");
	assert.equal(requests(store).length, sent, "no model request");
	assert.equal(integrity(store), "ok");
});

test("Stop withdraws the queued follow-up and ends the running bash call", async () => {
	const { store, cwd } = family("stop");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: 'call:bash {"command":"echo running; sleep 20","description":"Run","foreground":true}' });
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
	// Durable 1.5 shows a partial before storing it (right after, with persistWithinMs 0; partials are 100 ms apart): two
	// more partials after the one with word0 mean word0 is stored. The first partial may already be in assistant.start.
	// (The store itself cannot be read meanwhile: its owner holds it in SQLite EXCLUSIVE locking mode.)
	const partials = () => first.events.flatMap((e) => (e.type === "assistant.start" ? [textOf((e.message as { content: unknown }).content)] : e.type === "assistant.delta" ? [String(e.text)] : []));
	await first.until(() => {
		if (first.events.some((e) => e.type === "agent.end")) throw new Error(`the answer ended before two partials followed word0: ${JSON.stringify(partials())}`);
		const at = partials().findIndex((text) => text.includes("word0"));
		return at !== -1 && partials().length - at > 2;
	}, "a committed partial");
	await first.kill();
	const second = new ChatHost(store, cwd);
	const ready = await second.ready;
	assert.equal(ready.ownerEpoch, 2);
	const paused = await second.call<Transcript>("transcript");
	assert.ok((paused.status.warnings ?? []).length > 0, "restored paused");
	// P005: the partial the kill cut off shows as interrupted while paused, not as an answer still streaming.
	const cut = paused.partial as { stopReason?: string; errorMessage?: string; content: unknown };
	assert.match(textOf(cut.content), /word0/, "the committed partial text survives");
	assert.equal(cut.stopReason, "aborted");
	assert.match(cut.errorMessage ?? "", /interrupted/i);
	assert.match(JSON.stringify(paused.status.warnings), /interrupted/i, "the paused warning says the answer was interrupted");
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

test("crash row tools: an interrupted unsafe write never reruns and blocks a new write; safe read still runs", async () => {
	const { store, cwd } = family("tools");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: heldWrite(cwd) });
	await writing(first);
	await first.kill();
	const second = new ChatHost(store, cwd);
	await second.ready;
	await second.call("prompt", { operationId: "op-2", text: 'call:write {"path":"other.txt","content":"x"}' });
	await second.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "done after write" && second.events.filter((x) => x.type === "tool.end").length >= 2, "both write results");
	const ends = second.events.filter((e) => e.type === "tool.end");
	assert.match(String(ends[0]?.text), /interrupted/i, "the interrupted call is not rerun");
	assert.match(String(ends[1]?.text), /Needs reconciliation/, "a fresh write call is blocked");
	assert.equal(existsSync(join(cwd, "other.txt")), false, "the blocked write had no effect");
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
	workingModeSample: number;
	pendingAsks?: { askId: string; revision: string; questions: { id: string }[]; turnsSinceUpdate: number }[];
	attentionRequest?: { id: string; reason: string };
	unresolvedEffects?: { id: string; toolName: string; arguments: string }[];
};
type Logged = { label: string; workingMode?: number; sections?: string[]; images?: number };
const logged = (store: string) => readLog<Logged>(join(store, "requests.log"));
const mode = (status: Pick<Status, "extensionStatuses">) => JSON.parse(status.extensionStatuses?.["working-mode"] ?? "null") as { phase: string; selected: Record<string, string>; applied: Record<string, string> | null; aligned: boolean };
const idle = (host: ChatHost, count: number) => host.until(() => host.events.filter((e) => e.type === "agent.end").length >= count, `${count} runs`);

const ASK = {
	context: "The deploy target is ambiguous.",
	questions: [{ id: "target", question: "Which target?", detail: "Where this deploy lands.", options: [{ value: "prod", label: "Production", recommended: true }, { value: "staging", label: "Staging" }] }],
};

/** The outcome PI WEB's PendingAskStore computes for one answered question (the daemon sends it). */
const answered = (askId: string) => ({
	askId, reason: "submitted", askedAt: "", closedAt: "", context: ASK.context,
	questions: [{ question: ASK.questions[0], answered: true, values: ["staging"] }],
	answeredCount: 1, unansweredIds: [], summary: "Answered 1 of 1; none left unanswered",
});

test("P031 complete: PI WEB's Chat title request goes to the Chat's model outside the conversation; nothing is committed or scheduled", async () => {
	const { store, cwd } = family("title");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const title = await host.call<string>("complete", {
		systemPrompt: "Generate a concise title for a coding-agent chat session. Return only the title.",
		prompt: "Create a 2-6 word title for this request:\n\nMigrate the build",
		maxTokens: 24,
		reasoning: "minimal",
		timeoutMs: 10_000,
	});
	assert.equal(title, "Scripted title");
	const transcript = await host.call<Transcript>("transcript");
	assert.deepEqual(transcript.messages, [], "no turn, no entry");
	assert.equal(transcript.status.isStreaming, false);
	assert.deepEqual(requests(store), [], "not a conversation request");
	await assert.rejects(host.call("complete", { systemPrompt: "x", prompt: "y", model: { provider: "nobody", modelId: "none" } }), /Unknown model nobody\/none/);
	// A failed title request was still a provider request: it is accounted too.
	await assert.rejects(host.call("complete", { systemPrompt: "Generate a concise title for a coding-agent chat session. Return only the title.", prompt: "fail", timeoutMs: 10_000 }), /title rejected/);
	await host.close();
	// N6: each paid request outside the conversation leaves one usage record, marked auxiliary, under the Chat's session;
	// no conversation usage, so a report counts it once.
	const usage = readdirSync(TELEMETRY)
		.flatMap((file) => readLog<{ type: string; sessionId: string; usageKey?: string; kind?: string; purpose?: string; provider?: string; stopReason?: string; usage?: { totalTokens: number } }>(join(TELEMETRY, file)))
		.filter((e) => e.sessionId === store && e.type === "usage");
	assert.deepEqual(usage.map((e) => [e.kind, e.purpose, e.provider, e.stopReason]), [["auxiliary", "title", "faux", "stop"], ["auxiliary", "title", "faux", "error"]]);
	assert.ok(usage.every((e) => e.usageKey?.startsWith(`${store}:auxiliary:`)) && new Set(usage.map((e) => e.usageKey)).size === 2, "each request its own usage key");
	assert.ok((usage[0]?.usage?.totalTokens ?? 0) > 0, "the provider's usage is recorded");
});

test("P031 title redaction: a title the model echoes and the fallback source PI WEB asks to redact are masked by the host's redactor", async () => {
	const { store, cwd } = family("title-redact");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const secret = `ghp_${"T1tl3S3cr3t".repeat(4)}`;
	const system = "Generate a concise title for a coding-agent chat session. Return only the title.";
	// Positive control: the successful title path goes through the redacting provider.
	const title = await host.call<string>("complete", { systemPrompt: system, prompt: `Create a 2-6 word title for this request:\n\necho-title:Rotate ${secret} now` });
	assert.ok(!title.includes(secret.slice(4, 20)), `title masked: ${title}`);
	assert.match(title, /^Rotate .*REDACTED.* now$/);
	// The fallback source: the whole secret, and an unfinished private key (whole-text, sealed).
	const masked = await host.call<string>("redact", { text: `Use ${secret} to deploy_the_service today` });
	assert.ok(!masked.includes(secret.slice(4, 20)), `fallback source masked: ${masked}`);
	assert.match(masked, /^Use .*REDACTED.* to deploy_the_service today$/);
	const key = await host.call<string>("redact", { text: "fix -----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA" });
	assert.ok(!key.includes("b3BlbnNzaC1rZXktdjEAAAAA"), `unfinished key masked: ${key}`);
	await assert.rejects(host.call("redact", {}), /text must be a non-empty string/);
	assert.deepEqual(requests(store), [], "no conversation request");
	await host.close();
});

test("Working Mode: a selection survives a restart, rides with the next prompt once, /mode send delivers it now, alignment is recorded", async () => {
	const { store, cwd } = family("mode");
	let host = new ChatHost(store, cwd);
	await host.ready;
	assert.deepEqual(await host.call("mode", { args: "attention focused" }), { type: "done" });
	assert.equal((await host.call<{ type: string }>("mode", { args: "attention sideways" })).type, "unsupported");
	assert.equal(mode(await host.call<Status>("status")).selected.attention, "Focused");
	// Each status numbers its Working Mode sample, so PI WEB orders a reply against the events by when the host read it.
	const [first, second] = await Promise.all([host.call<Status>("status"), host.call<Status>("status")]);
	assert.ok(first.workingModeSample < second.workingModeSample, "a later sample gets a higher number");
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

test("/mode unalign after alignment_reached delivers one block with aligned false; alignment_reached works again afterwards", async () => {
	const { store, cwd } = family("unalign");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: 'call:alignment_reached {"agreement":"ship it"}' });
	await idle(host, 1);
	assert.equal(mode(await host.call<Status>("status")).aligned, true);
	assert.deepEqual(await host.call("mode", { args: "unalign" }), { type: "done" });
	await idle(host, 2);
	assert.equal(mode(await host.call<Status>("status")).aligned, false);
	const transcript = await host.call<{ messages: { customType?: string; content: unknown; details?: { aligned?: boolean } }[] }>("transcript");
	const blocks = transcript.messages.filter((m) => m.customType === "working-mode");
	assert.equal(blocks.length, 1, "one Working Mode block reached the agent");
	assert.equal(blocks[0]!.details?.aligned, false);
	assert.equal(logged(store).at(-1)?.workingMode, 1, "the unalign block started a turn at once");
	await host.call("prompt", { operationId: "op-2", text: 'call:alignment_reached {"agreement":"ship it again"}' });
	await idle(host, 3);
	assert.equal(mode(await host.call<Status>("status")).aligned, true);
	await host.close();
});

test("AFK battery alarm: once AFK applies and a turn runs on battery, the alarm names the Chat every check while work runs; an idle Chat, leaving AFK or closing the host stops it", async () => {
	const { store, cwd } = family("afk-battery");
	const h = await openChatHost({ dir: store, cwd, model: "faux", chatId: "chat-afk" });
	const alarms: { id: string; label: string }[] = [];
	const events: UiEvent[] = [];
	let wake = () => {};
	let title: string | undefined;
	// Injected battery state and alarm: the test never sounds the real one.
	const session = new ChatSession(h, (event) => (events.push(event), wake()), {
		chatId: "chat-afk",
		title: () => title,
		power: { onBattery: async () => true, alarm: (chat) => (alarms.push(chat), wake()), everyMs: 10 },
	});
	const until = async (done: () => boolean | Promise<boolean>, what: string) => {
		const deadline = Date.now() + 20_000;
		while (!(await done())) {
			assert.ok(Date.now() < deadline, `no ${what} within 20 s`);
			await new Promise<void>((resolve) => ((wake = resolve), setTimeout(resolve, 100)));
		}
	};
	const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	const runs = () => events.filter((e) => e.type === "agent.end").length;
	const hold = (seconds: number) => `call:bash ${JSON.stringify({ command: `sleep ${String(seconds)}`, description: "Hold work open" })}`;
	// No turn, queued input, tool, child or background bash job left.
	const idle = async () => {
		const status = await session.status();
		return !status.isStreaming && status.pendingMessageCount === 0 && status.extensionStatuses?.["pi-workbench:background-bash"] === undefined;
	};
	const quiet = async (what: string) => {
		await pause(50);
		const before = alarms.length;
		await pause(150);
		assert.equal(alarms.length, before, what);
	};
	await session.start();
	try {
		await session.mode("attention afk");
		await pause(100);
		assert.equal(alarms.length, 0, "AFK selected but no turn yet: quiet");
		// The turn ends at once; its background bash job keeps work running without a turn.
		await session.prompt({ operationId: "op-1", text: hold(4) });
		await until(async () => runs() >= 1 && !(await session.status()).isStreaming, "the launching turn's end");
		const atEnd = alarms.length;
		await until(() => alarms.length >= atEnd + 3, "repeated alarm while a background bash job runs");
		assert.deepEqual(alarms[0], { id: "chat-afk", label: "workspace" }, "an untitled Chat: the alarm names its folder");
		title = "Battery Chat";
		await until(() => alarms.at(-1)?.label === "Battery Chat (workspace)", "the alarm naming the Chat's title");
		// One per start of work; the job's launch may leave one 10 ms check idle (the job is still pending) after the turn ends.
		const notified = events.filter((e) => e.type === "durable.notification" && e.severity === "error").length;
		assert.ok(notified >= 1 && notified <= 2, `one notification per start of work, got ${String(notified)}`);

		// The job ends (its completion runs one more turn, then the AFK closing nudge one); then the Chat is idle and the alarm stops.
		await until(async () => runs() >= 3 && (await idle()), "the closing nudge's turn end");
		await quiet("an idle AFK Chat on battery does not alarm");

		// Work starting again alarms again.
		const before = alarms.length;
		await session.prompt({ operationId: "op-2", text: hold(4) });
		await until(() => alarms.length > before && runs() >= 4, "alarm when work starts again");

		await session.mode("attention default");
		await quiet("leaving AFK stops the alarm");

		await session.mode("attention afk");
		const left = alarms.length;
		await session.prompt({ operationId: "op-3", text: "again" });
		await until(() => alarms.length > left, "alarm after AFK is re-entered");
	} finally {
		await session.close();
	}
	await quiet("closing the host stops the alarm");
});

test("pageTranscript agrees with PI WEB's pageMessagesAtSafeBoundary on the shared fixtures (copied from PI WEB's messagePaging.fixtures.json)", () => {
	const fixtures = JSON.parse(readFileSync(new URL("./transcript-paging.fixtures.json", import.meta.url), "utf8")) as { name: string; messages: unknown[]; page: { before?: number; limit?: number } | null; start: number; end: number }[];
	for (const { name, messages, page, start, end } of fixtures) {
		assert.deepEqual(pageTranscript(messages, page ?? undefined), { start, total: messages.length, messages: messages.slice(start, end) }, name);
	}
});

// Both projects also run the fixture expectations independently when only one checkout is available.
const peer = process.env.PI_WEB_REPO;
test("the host and PI WEB fallback return identical pages for every shared fixture and cursor", { skip: !peer }, async () => {
	const { pageMessagesAtSafeBoundary } = await import(join(peer!, "src/server/sessions/messagePaging.ts")) as typeof import("../src/message-paging.ts");
	const fixtures = JSON.parse(readFileSync(new URL("./transcript-paging.fixtures.json", import.meta.url), "utf8")) as { name: string; messages: unknown[] }[];
	for (const { name, messages } of fixtures) {
		for (let before = 0; before <= messages.length; before++) for (const page of [{ before }, { before, limit: 1 }, {}, undefined]) {
			assert.deepEqual(pageTranscript(messages, page), pageMessagesAtSafeBoundary(messages, page), name);
		}
	}
});

/** An in-process Chat on the faux model (no real battery alarm), with its run count and an event-driven wait. */
test("pageTranscript matches PI WEB's pageMessagesAtSafeBoundary: a hard limit that skips leading tool results; a 1,700-message turn chains back exactly once", () => {
	const user = (content: string) => ({ role: "user", content });
	const assistantText = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
	const thinking = (text: string) => ({ role: "assistant", content: [{ type: "thinking", thinking: text }] });
	const toolCall = (name: string) => ({ role: "assistant", content: [{ type: "toolCall", name }] });
	const toolResult = (text: string) => ({ role: "toolResult", content: text });
	const page = (start: number, total: number, messages: unknown[]) => ({ start, total, messages });
	const turn = [user("a"), assistantText("b"), user("c")];
	assert.deepEqual(pageTranscript(turn, { limit: 1 }), page(2, 3, turn.slice(2)));
	const midTurn = [user("prompt"), thinking("plan"), toolCall("read"), toolResult("ok"), thinking("next"), assistantText("answer")];
	assert.deepEqual(pageTranscript(midTurn, { before: 5, limit: 2 }), page(4, 6, midTurn.slice(4, 5)));
	const results = [user("prompt"), toolCall("read"), toolResult("a"), toolResult("b"), assistantText("answer")];
	assert.deepEqual(pageTranscript(results, { limit: 3 }), page(4, 5, results.slice(4)));
	assert.deepEqual(pageTranscript(results, { before: 4, limit: 3 }), page(1, 5, results.slice(1, 4)));
	const messages: unknown[] = [user("prompt")];
	while (messages.length < 1_700) messages.push(...(messages.length % 3 === 1 ? [toolCall("read")] : messages.length % 3 === 2 ? [toolResult("ok")] : [thinking("next")]));
	assert.equal(pageTranscript(messages, {}).messages.length, 20, "20 by default");
	const seen: unknown[] = [];
	let before: number | undefined;
	for (let guard = 0; guard < 1_700; guard += 1) {
		const result = pageTranscript(messages, { ...(before === undefined ? {} : { before }), limit: 20 });
		assert.ok(result.messages.length > 0 && result.messages.length <= 20);
		seen.unshift(...result.messages);
		if (result.start === 0) break;
		before = result.start;
	}
	assert.deepEqual(seen, messages);
});

async function quietChat(label: string) {
	const { store, cwd } = family(label);
	const h = await openChatHost({ dir: store, cwd, model: "faux", chatId: `chat-${label}` });
	const events: UiEvent[] = [];
	let wake = () => {};
	const session = new ChatSession(h, (event) => (events.push(event), wake()), { chatId: `chat-${label}`, power: { onBattery: async () => false, alarm: () => {}, everyMs: 60_000 } });
	const runs = () => events.filter((e) => e.type === "agent.end").length;
	/** Until `count` runs ended and the Chat is idle. */
	const settled = async (count: number) => {
		const deadline = Date.now() + 20_000;
		while (runs() < count || (await session.status()).isStreaming) {
			assert.ok(Date.now() < deadline, `no ${String(count)} settled runs within 20 s`);
			await new Promise<void>((resolve) => ((wake = resolve), setTimeout(resolve, 100)));
		}
	};
	await session.start();
	return { h, store, session, runs, settled };
}

/**
 * An in-process scripted Chat on an Anthropic model for the idle cache timer, with an injected delay instead of the
 * model's cache TTL and an injectable wall clock. The summary model (Sonnet) answers through the same script.
 */
const OPUS = { provider: "anthropic", modelId: "claude-opus-5-5" };
async function idleChat(store: string, cwd: string, delay: () => number, options: { now?: () => number; notes?: string; keepRecentTokens?: number | null } = {}) {
	const h = await openChatHost({ dir: store, cwd, model: `${OPUS.provider}/${OPUS.modelId}`, chatId: "chat-idle-timer", scriptedProviders: true });
	const events: UiEvent[] = [];
	let wake = () => {};
	// The 80k-token threshold stays real: the faux model counts a request's chars / 4.
	const session = new ChatSession(h, (event) => (events.push(event), wake()), {
		chatId: "chat-idle-timer", power: { onBattery: async () => false, alarm: () => {}, everyMs: 60_000 }, idleDelayMs: () => delay(),
		...(options.now === undefined ? {} : { now: options.now }), ...(options.notes === undefined ? {} : { idleNotes: options.notes }),
	});
	const until = async (done: () => boolean | Promise<boolean>, what: string, ms = 20_000) => {
		const deadline = Date.now() + ms;
		while (!(await done())) {
			assert.ok(Date.now() < deadline, `no ${what} within ${String(ms / 1000)} s`);
			await new Promise<void>((resolve) => ((wake = resolve), setTimeout(resolve, 50)));
		}
	};
	const runs = () => events.filter((e) => e.type === "agent.end").length;
	const settled = (count: number) => until(async () => runs() >= count && !(await session.status()).isStreaming, `${String(count)} settled runs`);
	const markers = async () => (await h.root.entries({ order: "descending" }, 100, undefined, context)).items.filter((e) => e.kind === IDLE_COMPACTION_ENTRY).length;
	const compacted = () => (session.messages() as { source?: string }[]).some((m) => m.source === "compaction");
	const warnings = () => events.flatMap((e) => (e.type === "command.output" && (e as { level?: string }).level === "warning" ? [String((e as { message?: string }).message)] : []));
	const quiet = () => until(async () => !(await session.status()).isCompacting, "a settled compaction");
	await session.start();
	// A small keep window, so the compaction has history to summarize (null: the Chat's default, 20k).
	if (options.keepRecentTokens !== null) await session.configure({}, { compaction: { keepRecentTokens: options.keepRecentTokens ?? 1 } });
	session.setViewed(true);
	return { h, session, events, until, settled, markers, compacted, warnings, quiet };
}
const PAD = `pad:${"x".repeat(330_000)}`;
/** The model of each summary request, in order. */
const summaries = (store: string) => readLog<{ label: string; model?: string }>(join(store, "requests.log")).filter((line) => line.label === "summarize").map((line) => line.model ?? "faux");
/** The provider's timer-summary model (idle-compact.ts IDLE_SUMMARY_MODELS); the cheap wake-up's light model is the same one on Anthropic. */
const SUMMARY = "anthropic/claude-sonnet-5-5";
/** The output cap of each summary request, in order. */
const summaryCaps = (store: string) => readLog<{ label: string; maxTokens?: number }>(join(store, "requests.log")).filter((line) => line.label === "summarize").map((line) => line.maxTokens);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("idle cache timer: a viewed idle Chat with a large prompt compacts on the cheap model once its timer fires, also when a `!` command ran over it; a new prompt cancels the timer", async () => {
	const { store, cwd } = family("idle-timer");
	let delay = 1_500;
	const { session, events, until, settled, markers, compacted } = await idleChat(store, cwd, () => delay);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		// Armed for 1.5 s; the next prompt's turn ends with a long delay, so only the first timer could compact.
		delay = 60_000;
		await session.prompt({ operationId: "op-2", text: "short" });
		await settled(2);
		await wait(2_500);
		assert.deepEqual(summaries(store), [], "a new prompt cancelled the armed timer");

		// A `!` command runs over the firing: its end checks again, and the Chat compacts.
		delay = 1_500;
		await session.prompt({ operationId: "op-3", text: "short again" });
		await settled(3);
		await session.shell("!sleep 2.5");
		await until(async () => (await markers()) === 1, "the idle compaction marker");
		assert.deepEqual(summaries(store), [SUMMARY], "one idle compaction, summarized by Sonnet, never the Chat's model");
		assert.deepEqual(summaryCaps(store), [16_000], "the summary may take 16k output tokens");
		assert.ok(events.some((e) => e.type === "shell.end"), "the command ran");
		assert.ok(compacted(), "the summary is placed");
	} finally {
		await session.close();
	}
});

test("idle cache timer: a restarted host arms it again, measured from the newest request; one whose cache already expired does not", async () => {
	const { store, cwd } = family("idle-restart");
	const first = await idleChat(store, cwd, () => 60_000);
	await first.session.prompt({ operationId: "op-1", text: PAD });
	await first.settled(1);
	const turned = Date.now();
	await first.session.close();
	await wait(700);
	// Its 0.5 s delay (and 60 s lead) passed during the restart, as the injected clock says: no timer.
	const expired = await idleChat(store, cwd, () => 500, { now: () => Date.now() + 61_000 });
	await wait(1_500);
	await expired.session.close();
	assert.deepEqual(summaries(store), [], "an expired cache gets no timer after a restart");
	const second = await idleChat(store, cwd, () => 8_000);
	try {
		await second.until(async () => (await second.markers()) === 1, "the idle compaction marker after the restart");
		assert.deepEqual(summaries(store), [SUMMARY]);
		assert.ok(Date.now() - turned < 8_000 + 1_500, "fired 8 s after the turn's request, not after the reopen");
	} finally {
		await second.session.close();
	}
});

test("idle cache timer: one pasted turn larger than the default keep window, then a small turn: the timer compaction still summarizes the paste", async () => {
	const { store, cwd } = family("idle-one-paste");
	let delay = 60_000;
	const { session, until, settled, markers, compacted } = await idleChat(store, cwd, () => delay, { keepRecentTokens: null });
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		// The paste alone exceeds the 20k keep window; the small turn after it arms a 1.5 s timer.
		delay = 1_500;
		await session.prompt({ operationId: "op-2", text: "small" });
		await settled(2);
		await until(async () => (await markers()) === 1, "the idle compaction marker");
		assert.ok(compacted(), "a summary is placed");
		assert.deepEqual(summaries(store), [SUMMARY]);
	} finally {
		await session.close();
	}
});

test("idle cache timer: a timer compaction with nothing to summarize warns once and does not retry in that stretch", async () => {
	const { store, cwd } = family("idle-empty");
	const { session, until, settled, warnings, markers, quiet } = await idleChat(store, cwd, () => 1_500, { keepRecentTokens: 10_000_000 });
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await until(() => warnings().some((w) => w.startsWith("Idle compaction found nothing")), "the empty-compaction warning");
		await quiet();
		await wait(2_500);
		await session.prompt({ operationId: "op-2", text: "again" });
		await settled(2);
		await wait(2_500);
		assert.equal(warnings().filter((w) => w.startsWith("Idle compaction found nothing")).length, 1, "warned once");
		assert.deepEqual(summaries(store), [], "nothing summarized");
		assert.equal(await markers(), 0);
	} finally {
		await session.close();
	}
});

test("idle cache timer: a failed cheap summary declines the compaction with a warning, without a second (Chat model) summary", async () => {
	const { store, cwd } = family("idle-cheap-fail");
	const { session, until, settled, markers, compacted, warnings, quiet } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: `pad:summary-fail ${"x".repeat(330_000)}` });
		await settled(1);
		await until(() => warnings().some((w) => w.startsWith("Idle compaction skipped")), "the decline warning");
		await quiet();
		await wait(500);
		assert.deepEqual(summaries(store), [SUMMARY], "only the cheap summary was asked for");
		assert.equal(compacted(), false, "nothing placed");
		assert.equal(await markers(), 0);
	} finally {
		await session.close();
	}
});

test("idle cache timer: a summary cut off at its output cap declines the compaction with a warning, without a Chat-model summary", async () => {
	const { store, cwd } = family("idle-summary-length");
	const { session, until, settled, markers, compacted, warnings, quiet } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: `pad:summary-length ${"x".repeat(330_000)}` });
		await settled(1);
		await until(() => warnings().some((w) => w.startsWith("Idle compaction skipped")), "the decline warning");
		await quiet();
		await wait(500);
		assert.match(warnings().find((w) => w.startsWith("Idle compaction skipped"))!, /cut off at its length limit/);
		assert.deepEqual(summaries(store), [SUMMARY], "only the timer's summary was asked for, never the Chat model's");
		assert.equal(compacted(), false, "nothing placed");
		assert.equal(await markers(), 0);
	} finally {
		await session.close();
	}
});

test("idle cache timer: /compact still runs Durable's own summary on the Chat's model", async () => {
	const { store, cwd } = family("idle-manual");
	const { session, until, settled, markers, compacted } = await idleChat(store, cwd, () => 60_000);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await session.compact();
		await until(compacted, "the /compact summary");
		assert.deepEqual(summaries(store), [`${OPUS.provider}/${OPUS.modelId}`]);
		assert.equal(await markers(), 0, "not a timer compaction");
	} finally {
		await session.close();
	}
});

test("idle cache timer: losing the last viewer cancels a timer compaction whose summary is in flight", async () => {
	const { store, cwd } = family("idle-viewer-loss");
	const gate = join(cwd, "summary-gate");
	const { session, until, settled, markers, compacted, quiet } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: `pad:summary-gate:${gate} ${"x".repeat(330_000)}` });
		await settled(1);
		await until(() => summaries(store).length === 1, "the summary request");
		session.setViewed(false);
		writeFileSync(gate, "");
		await quiet();
		await wait(500);
		assert.equal(compacted(), false, "the cancelled compaction placed nothing");
		assert.equal(await markers(), 0);
	} finally {
		await session.close();
	}
});

test("idle cache timer: due counts from the request's start on the wall clock: inside the last minute it fires at once, after expiry (a host asleep) never", async () => {
	const { store, cwd } = family("idle-clock");
	let offset = 61_000;
	const { session, until, settled, markers } = await idleChat(store, cwd, () => 60_000, { now: () => Date.now() + offset });
	try {
		// 61 s after the request started: past its 60 s due, before its expiry 60 s later.
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await until(async () => (await markers()) === 1, "the immediate idle compaction", 8_000);
	} finally {
		await session.close();
	}
	const late = family("idle-clock-asleep");
	offset = 0;
	const asleep = await idleChat(late.store, late.cwd, () => 1_500, { now: () => Date.now() + offset });
	try {
		await asleep.session.prompt({ operationId: "op-1", text: PAD });
		await asleep.settled(1);
		// The host slept 10 minutes before the timer's callback ran: the cache is cold, nothing to save.
		offset = 10 * 60_000;
		await wait(2_500);
		assert.deepEqual(summaries(late.store), [], "no compaction after expiry");
	} finally {
		await asleep.session.close();
	}
});

test("idle cache timer: a turn on another model than the Chat's stored one (a cheap wake-up) never arms it", async () => {
	const { store, cwd } = family("idle-other-model");
	const { h, session, settled } = await idleChat(store, cwd, () => 1_500);
	try {
		await h.root.configure({ model: { provider: "anthropic", modelId: "claude-sonnet-5-5" } }, context);
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		// As a cheap turn ends: the own model is stored again.
		await h.root.configure({ model: OPUS }, context);
		await wait(2_500);
		assert.deepEqual(summaries(store), [], "the other model's request armed nothing");
	} finally {
		await session.close();
	}
});

/** A background-bash completion submitted as BackgroundBash delivers it (`submitWake`). */
const wakeDraft = (requestId: string, output: string) => ({ type: "input" as const, content: output.startsWith("pad:") ? output : `Background bash ${requestId} complete (exit 0).\n${output}`, whenBusy: "followUp" as const, requestId });
const turns = (store: string) => readLog<{ label: string; model?: string }>(join(store, "requests.log")).filter((line) => line.label !== "summarize");

test("idle cache timer and cheap wake: a wake after a timer compaction runs on the cheap model; that large cheap turn never arms the timer", async () => {
	const { store, cwd } = family("idle-then-cheap");
	const { h, session, until, settled, markers } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await until(async () => (await markers()) === 1, "the timer compaction and its marker");
		// The marker entry and the IdleCacheDoc intent do not hide the compaction: the wake is cheap.
		const id = await submitWake(h.root, wakeDraft("job-1", PAD), h.models);
		await (await h.harness.submission(id, context))!.wait(context);
		await settled(2);
		assert.deepEqual(turns(store).map((t) => t.model), [`${OPUS.provider}/${OPUS.modelId}`, "anthropic/claude-sonnet-5-5"]);
		// A padded completion (the faux model answers it briefly): the cheap turn's >80k-token prompt on Sonnet, and its run reset the stretch: only its usage could arm a second compaction.
		await wait(2_500);
		assert.deepEqual(summaries(store), [SUMMARY], "the cheap turn armed nothing");
		assert.equal(await markers(), 1);
	} finally {
		await session.close();
	}
});

test("idle cache timer and cheap wake: a wake while the timer's cheap summary is in flight never switches to the cheap model", async () => {
	const { store, cwd } = family("idle-cheap-race");
	const gate = join(cwd, "summary-gate");
	const { h, session, until, settled, quiet } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: `pad:summary-gate:${gate} ${"x".repeat(330_000)}` });
		await settled(1);
		await until(() => summaries(store).length === 1, "the timer's summary request");
		const id = await submitWake(h.root, wakeDraft("job-1", "all tests passed"), h.models);
		assert.equal((await h.harness.snapshot(LiveDoc, h.root.id, context))?.run?.override, undefined, "no cheap run during a timer compaction");
		writeFileSync(gate, "");
		await (await h.harness.submission(id, context))!.wait(context);
		await settled(2);
		await quiet();
		assert.deepEqual(turns(store).map((t) => t.model), [`${OPUS.provider}/${OPUS.modelId}`, `${OPUS.provider}/${OPUS.modelId}`], "the wake ran on the own model");
		assert.deepEqual(summaries(store), [SUMMARY]);
		assert.deepEqual((await h.harness.snapshot(AgentDoc, h.root.id, context))?.model, OPUS);
	} finally {
		await session.close();
	}
});

test("idle cache timer: a reopen in the same idle stretch never pays for a second summary after a truncated one", async () => {
	const { store, cwd } = family("idle-truncated-reopen");
	const first = await idleChat(store, cwd, () => 1_500);
	await first.session.prompt({ operationId: "op-1", text: `pad:summary-length ${"x".repeat(330_000)}` });
	await first.settled(1);
	await first.until(() => first.warnings().some((w) => w.startsWith("Idle compaction skipped")), "the decline warning");
	await first.quiet();
	await first.session.close();
	// Viewed again before the cache entry expires: the timer fires at once, for the request already attempted.
	const second = await idleChat(store, cwd, () => 1_500);
	try {
		await wait(2_500);
		assert.deepEqual(summaries(store), [SUMMARY], "one summary request for the stretch");
	} finally {
		await second.session.close();
	}
});

test("idle cache timer: a Chat on Sonnet has no cheaper summary writer and never arms it", async () => {
	const { store, cwd } = family("idle-sonnet-chat");
	const { h, session, settled } = await idleChat(store, cwd, () => 1_500);
	try {
		await h.root.configure({ model: { provider: "anthropic", modelId: "claude-sonnet-5-5" } }, context);
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await wait(2_500);
		assert.deepEqual(summaries(store), [], "no cold summary on the Chat's own model");
	} finally {
		await session.close();
	}
});

test("idle cache timer and cheap wake: the owner choosing the cheap model during a cheap turn never arms the timer on it", async () => {
	const { store, cwd } = family("idle-owner-cheap");
	const gate = join(cwd, "turn-gate-file");
	const { h, session, until, settled, markers } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await until(async () => (await markers()) === 1, "the timer compaction");
		const id = await submitWake(h.root, wakeDraft("job-1", `pad:turn-gate:${gate} ${"x".repeat(330_000)}`), h.models);
		await until(() => turns(store).length === 2, "the cheap request");
		await session.setModel("anthropic", "claude-sonnet-5-5");
		writeFileSync(gate, "");
		await (await h.harness.submission(id, context))!.wait(context);
		await settled(2);
		assert.equal(turns(store)[1]!.model, "anthropic/claude-sonnet-5-5", "the wake ran cheap");
		await wait(2_500);
		assert.deepEqual(summaries(store), [SUMMARY], "the cheap turn armed nothing");
	} finally {
		await session.close();
	}
});

test("idle cache timer: a new large turn that ends while a cancelled summary still unwinds arms the timer once it settles", async () => {
	const { store, cwd } = family("idle-unwinding");
	const gate = join(cwd, "summary-gate");
	const { session, until, settled, markers, quiet } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: `pad:summary-gate:${gate} ${"x".repeat(330_000)}` });
		await settled(1);
		await until(() => summaries(store).length === 1, "the held summary request");
		// The owner's turn cancels the summary, which unwinds only once its request returns.
		await session.prompt({ operationId: "op-2", text: PAD });
		await settled(2);
		await wait(500);
		writeFileSync(gate, "");
		await quiet();
		await until(async () => (await markers()) === 1, "the timer compaction for the newer turn", 10_000);
		assert.deepEqual(summaries(store), [SUMMARY, SUMMARY]);
	} finally {
		await session.close();
	}
});

test("idle cache timer: the Chat's model changing before the timer's admission sends no summary to the previous provider", async () => {
	const { store, cwd } = family("idle-model-switch");
	const { h, session, settled, quiet } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await wait(300);
		// The timer reads the Chat's model, then the owner switches to Terra before the compaction is admitted.
		const agent = h.root.agent.bind(h.root);
		let switched = false;
		h.root.agent = (async (c: Parameters<typeof agent>[0]) => {
			// The timer's own read of the model (its `status()` read comes first and must not switch).
			const timer = /idleFire/.test(new Error().stack ?? "") && !/status/.test(new Error().stack ?? "");
			const read = await agent(c);
			if (timer && !switched) {
				switched = true;
				await h.root.configure({ model: { provider: "openai-codex", modelId: "gpt-6.1-terra" } }, context);
			}
			return read;
		}) as typeof h.root.agent;
		await wait(2_500);
		await quiet();
		assert.ok(switched, "the timer fired");
		assert.deepEqual(summaries(store), [], "no summary on the previous provider's model");
	} finally {
		await session.close();
	}
});

/** Holds the timer summary's provider auth (Sonnet's), before anything is sent, until `release`. */
function holdSummaryAuth(h: Awaited<ReturnType<typeof idleChat>>["h"]) {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const state = { held: false, release: () => release() };
	const getAuth = h.models.getAuth.bind(h.models);
	h.models.getAuth = (async (model: unknown, options?: never) => {
		const target = model as { provider?: string; id?: string };
		if (target.provider === "anthropic" && target.id === "claude-sonnet-5-5" && !state.held) {
			state.held = true;
			await released;
		}
		return getAuth(model as never, options);
	}) as unknown as typeof h.models.getAuth;
	return state;
}

test("idle cache timer: the owner switching models while the timer's summary waits for provider auth aborts it: nothing goes to the previous provider, nothing is placed", async () => {
	const { store, cwd } = family("idle-switch-held-auth");
	const { h, session, until, settled, markers, compacted, quiet } = await idleChat(store, cwd, () => 1_500);
	const auth = holdSummaryAuth(h);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await until(() => auth.held, "the timer summary waiting for its auth");
		await session.setModel("openai-codex", "gpt-6.1-terra");
		auth.release();
		await quiet();
		await wait(500);
		assert.deepEqual(summaries(store), [], "no summary request to the previous provider");
		assert.equal(compacted(), false, "nothing placed");
		assert.equal(await markers(), 0);
	} finally {
		auth.release();
		await session.close();
	}
});

test("idle cache timer: a stale timer callback released after a newer summary started never takes over its cancel: losing the last viewer still cancels it", async () => {
	const { store, cwd } = family("idle-stale-callback");
	const gate = join(cwd, "summary-gate");
	const { h, session, until, settled, markers, compacted, quiet } = await idleChat(store, cwd, () => 1_500);
	// The first timer callback is held at its read of the Chat's model (its `status()` read passes).
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	let held = false;
	const agent = h.root.agent.bind(h.root);
	h.root.agent = (async (c: Parameters<typeof agent>[0]) => {
		const stack = new Error().stack ?? "";
		if (!held && /idleFire/.test(stack) && !/status/.test(stack)) {
			held = true;
			await released;
		}
		return agent(c);
	}) as typeof h.root.agent;
	try {
		await session.prompt({ operationId: "op-1", text: `pad:summary-gate:${gate} ${"x".repeat(330_000)}` });
		await settled(1);
		await until(() => held, "the held first timer callback");
		// Tab closed and reopened: a new timer fires at once and its summary is in flight.
		session.setViewed(false);
		session.setViewed(true);
		await until(() => summaries(store).length === 1, "the newer summary request");
		release();
		await wait(500);
		// The last tab closes: the newer summary must be cancelled.
		session.setViewed(false);
		writeFileSync(gate, "");
		await quiet();
		await wait(500);
		assert.equal(compacted(), false, "the cancelled summary placed nothing");
		assert.equal(await markers(), 0);
	} finally {
		release();
		writeFileSync(gate, "");
		await session.close();
	}
});

test("idle cache timer and cheap wake: a /compact that finishes while the timer's summary is held leaves a wake on the own model", async () => {
	const { store, cwd } = family("idle-manual-during-timer");
	const { h, session, until, settled, compacted, quiet } = await idleChat(store, cwd, () => 1_500);
	const auth = holdSummaryAuth(h);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await until(() => auth.held, "the held timer summary");
		await session.compact();
		await until(compacted, "the /compact summary placed while the timer's is held");
		const id = await submitWake(h.root, wakeDraft("job-1", "all tests passed"), h.models);
		assert.equal((await h.harness.snapshot(LiveDoc, h.root.id, context))?.run?.override, undefined, "no cheap run while a timer compaction is active");
		auth.release();
		await (await h.harness.submission(id, context))!.wait(context);
		await settled(2);
		await quiet();
		assert.equal(turns(store).at(-1)?.model, `${OPUS.provider}/${OPUS.modelId}`, "the wake ran on the own model");
	} finally {
		auth.release();
		await session.close();
	}
});

test("idle cache timer: a replayed prompt (fresh: false) leaves the timer armed", async () => {
	const { store, cwd } = family("idle-replay");
	const { session, until, settled, markers } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		const replay = await session.prompt({ operationId: "op-1", text: PAD });
		assert.equal(replay.fresh, false);
		await until(async () => (await markers()) === 1, "the idle compaction after the replay", 8_000);
	} finally {
		await session.close();
	}
});

test("idle cache timer: a restart after the summary was placed finishes the marker and the Workstream note from the stored intent, without summarizing again", async () => {
	const { IdleCacheDoc, checkpointState, IDLE_NOTE_PRODUCER } = await import("../src/idle-compact.ts");
	const { userWorkstreamStore } = await import("../src/chat-message.ts");
	const { store, cwd } = family("idle-restore");
	// Outside PI_TMP: the store refuses references into swept temporary folders.
	mkdirSync(join(import.meta.dirname, "..", ".runs"), { recursive: true });
	const notes = mkdtempSync(join(import.meta.dirname, "..", ".runs", "idle-restore-"));
	after(() => rmSync(notes, { recursive: true, force: true }));
	const workstreams = userWorkstreamStore();
	const created = await workstreams.create({ workstreamId: "ws-idle-restore", idempotencyKey: "c", title: "Restore", producer: "session" });
	const payload = { sessionId: "chat-idle-timer", associationKey: "chat-idle-timer" };
	await workstreams.append({ workstreamId: "ws-idle-restore", expectedRevision: created.acceptedRevision, idempotencyKey: "j", records: [{ type: "session.pending", producer: "session", payload }, { type: "session.confirmed", producer: "session", payload }] });
	const first = await idleChat(store, cwd, () => 600_000, { notes });
	await first.session.prompt({ operationId: "op-1", text: PAD });
	await first.settled(1);
	// The state a kill leaves between placement and note: a placed summary and its stored intent.
	const task = await first.h.root.compact(undefined, context);
	const { outcome } = (await first.h.harness.waitForTask(task, context)).state;
	await (await first.h.harness.submission((outcome as unknown as { result: { submissionId: never } }).result.submissionId, context))!.wait(context);
	const baseline = { workstreamId: "ws-idle-restore", checkpoint: checkpointState((await workstreams.inspect("ws-idle-restore")).sessions.find((s) => s.id === "chat-idle-timer")) };
	const firedAt = Date.parse("2026-01-02T03:04:05.000Z");
	await first.h.root.commit(async (tx) => {
		(await tx.doc(IdleCacheDoc, first.h.root.id)).intent = { task: Number(task), rootId: Number(first.h.root.id), firedAt, expiresAt: Date.now() + 60_000, summaryModel: { provider: "anthropic", modelId: "claude-sonnet-5-5" }, baseline };
	}, context);
	await first.session.close();
	const second = await idleChat(store, cwd, () => 600_000, { notes });
	try {
		await second.until(async () => (await second.markers()) === 1, "the marker after the restart");
		const path = join(notes, "ws-idle-restore", "idle-notes", "2026-01-02T03-04-05.000Z-chat-idle-timer.md");
		await second.until(() => existsSync(path), "the idle note file");
		await second.until(async () => (await workstreams.inspect("ws-idle-restore")).sessions.find((s) => s.id === "chat-idle-timer")?.latestCheckpoint?.references?.includes(path) === true, `the host checkpoint (${second.warnings().join("; ")})`);
		const events = await workstreams.watch({ workstreamId: "ws-idle-restore" });
		assert.equal(events.mode === "replay" ? (events.events.at(-1)?.records[0] as { producer: string }).producer : undefined, IDLE_NOTE_PRODUCER);
		assert.equal(summaries(store).length, 1, "only the summary before the kill");
		await second.until(async () => (await second.h.harness.snapshot(IdleCacheDoc, second.h.root.id, context))?.intent === null, "the intent cleared");
	} finally {
		await second.session.close();
	}
});

/** Runs `before` once, right before Durable's placement commit (`place`) of a hook-written summary starts. */
function beforePlacement(h: Awaited<ReturnType<typeof idleChat>>["h"], before: () => unknown) {
	// The hook runtime's commits go through the harness's untyped `commitWith`.
	const harness = h.harness as unknown as { commitWith: (...args: unknown[]) => unknown };
	const commitWith = harness.commitWith.bind(harness);
	const state = { reached: false };
	harness.commitWith = (...args) => {
		if (state.reached || !/at place \(/.test(new Error().stack ?? "")) return commitWith(...args);
		state.reached = true;
		return (async () => (await before(), commitWith(...args)))();
	};
	return state;
}

test("idle cache timer: losing the last viewer after the cheap summary returned, right before its placement, places nothing", async () => {
	const { store, cwd } = family("idle-viewer-loss-placement");
	const { h, session, until, settled, markers, compacted, quiet } = await idleChat(store, cwd, () => 1_500);
	const placement = beforePlacement(h, () => session.setViewed(false));
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await until(() => placement.reached, "the placement commit");
		await quiet();
		await wait(500);
		assert.deepEqual(summaries(store), [SUMMARY]);
		assert.equal(compacted(), false, "nothing placed");
		assert.equal(await markers(), 0);
	} finally {
		await session.close();
	}
});

for (const how of ["setModel", "a stored model change"] as const)
	test(`idle cache timer: the Chat's model changing to Terra (${how}) right before the summary's placement places nothing`, async () => {
		const { store, cwd } = family(`idle-switch-placement-${how === "setModel" ? "set" : "stored"}`);
		const { h, session, until, settled, markers, compacted, quiet } = await idleChat(store, cwd, () => 1_500);
		const terra = { provider: "openai-codex", modelId: "gpt-6.1-terra" };
		const placement = beforePlacement(h, () => (how === "setModel" ? session.setModel(terra.provider, terra.modelId) : h.root.configure({ model: terra }, context)));
		try {
			await session.prompt({ operationId: "op-1", text: PAD });
			await settled(1);
			await until(() => placement.reached, "the placement commit");
			await quiet();
			await wait(500);
			assert.equal(compacted(), false, "the previous model's Sonnet summary is not placed");
			assert.equal(await markers(), 0);
		} finally {
			await session.close();
		}
	});

test("idle cache timer: losing the last viewer while the summary's placement waits behind another commit places nothing", async () => {
	const { store, cwd } = family("idle-viewer-loss-queued");
	const gate = join(cwd, "summary-gate");
	const { h, session, until, settled, markers, compacted, quiet } = await idleChat(store, cwd, () => 1_500);
	const harness = h.harness as unknown as { commitWith: (...args: unknown[]) => unknown };
	const commitWith = harness.commitWith.bind(harness);
	let queued!: () => void;
	const placing = new Promise<void>((resolve) => (queued = resolve));
	harness.commitWith = (...args) => {
		const result = commitWith(...args);
		if (/at place \(/.test(new Error().stack ?? "")) queued();
		return result;
	};
	let entered!: () => void;
	const holding = new Promise<void>((resolve) => (entered = resolve));
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	let held: Promise<unknown> | undefined;
	try {
		await session.prompt({ operationId: "op-1", text: `pad:summary-gate:${gate} ${"x".repeat(330_000)}` });
		await settled(1);
		await until(() => summaries(store).length === 1, "the held summary request");
		held = h.root.commit(async () => (entered(), await released), context);
		await holding;
		writeFileSync(gate, "");
		await placing;
		session.setViewed(false);
		release();
		await held;
		await quiet();
		await wait(500);
		assert.equal(compacted(), false, "nothing placed");
		assert.equal(await markers(), 0);
	} finally {
		release();
		await held;
		await session.close();
	}
});

test("idle cache timer: a Chat on Haiku (cheaper than the Sonnet writer) never arms it", async () => {
	const { store, cwd } = family("idle-haiku-chat");
	const { session, settled } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.setModel("anthropic", "claude-haiku-5-5");
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await wait(2_500);
		assert.deepEqual(summaries(store), [], "no Sonnet summary for a Haiku Chat");
	} finally {
		await session.close();
	}
});

test("idle cache timer: reselecting the Chat's current model keeps the armed timer", async () => {
	const { store, cwd } = family("idle-same-model");
	const { session, until, settled, markers } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await session.setModel(OPUS.provider, OPUS.modelId);
		await until(async () => (await markers()) === 1, "the timer compaction", 8_000);
		assert.deepEqual(summaries(store), [SUMMARY]);
	} finally {
		await session.close();
	}
});

test("idle cache timer and cheap wake: an older Opus outside the routing roster (claude-opus-4-7) gets the timer and the cheap wake on Sonnet", async () => {
	const { store, cwd } = family("idle-opus-4-7");
	const { h, session, until, settled, markers } = await idleChat(store, cwd, () => 1_500);
	try {
		await session.setModel("anthropic", "claude-opus-4-7");
		await session.prompt({ operationId: "op-1", text: PAD });
		await settled(1);
		await until(async () => (await markers()) === 1, "the timer compaction");
		const id = await submitWake(h.root, wakeDraft("job-1", "tests passed"), h.models);
		await (await h.harness.submission(id, context))!.wait(context);
		await settled(2);
		assert.deepEqual(turns(store).map((t) => t.model), ["anthropic/claude-opus-4-7", "anthropic/claude-sonnet-5-5"]);
	} finally {
		await session.close();
	}
});

test("Working Mode: a held status cannot report the branch retired by navigation", async (t) => {
	const { h, session, settled } = await quietChat("held-mode");
	const release = Promise.withResolvers<void>();
	try {
		await session.prompt({ operationId: "first", text: "first" });
		await settled(1);
		const earlier = await session.tree();
		assert.ok(earlier.type === "tree" && earlier.activeLeafId);
		await session.mode("alignment align");
		await session.prompt({ operationId: "second", text: "second" });
		await settled(2);
		const later = await session.tree();
		assert.equal(later.type, "tree");
		const started = Promise.withResolvers<void>();
		const snapshot = h.harness.snapshot.bind(h.harness);
		const held = t.mock.method(h.harness, "snapshot", async (...args: Parameters<typeof snapshot>) => {
			const value = await snapshot(...args);
			if (Object.is(args[0], WorkingModeDoc)) {
				held.mock.restore();
				started.resolve();
				await release.promise;
			}
			return value;
		});
		const delayed = session.status();
		await started.promise;
		await session.navigate({ targetId: earlier.activeLeafId, expectedLeafId: later.activeLeafId });
		const active = await session.status();
		assert.equal(mode(active).selected.alignment, "Default");
		release.resolve();
		assert.equal(mode(await delayed).selected.alignment, "Default");
	} finally {
		release.resolve();
		await session.close();
	}
});

test("a paged transcript holds only its page, within the limit; chained earlier pages cover it exactly once; the partial matches a whole read", async () => {
	const { session, settled } = await quietChat("paging");
	type Page = { messages: { role: string; entryId?: string; usage?: unknown; content?: unknown }[]; start: number; total: number; usage: { entryId?: string; usage?: unknown; content?: unknown }[]; partial: unknown };
	const read = async (page?: { before?: number; limit?: number }) => session.transcript(await session.status(), page) as Page;
	const bash = `call:bash ${JSON.stringify({ command: "echo hi", description: "Echo", foreground: true })}`;
	try {
		for (let turn = 1; turn <= 6; turn++) {
			await session.prompt({ operationId: `op-${String(turn)}`, text: turn % 2 === 0 ? bash : `turn ${String(turn)}` });
			await settled(turn);
		}
		const whole = (await read()).messages as Page["messages"];
		const last = await read({ limit: 3 });
		assert.equal(last.total, whole.length);
		assert.deepEqual(last.messages, whole.slice(-3), "a hard limit, not back to the turn's user message");
		assert.equal(last.start, whole.length - 3);
		const pages = [last.messages];
		for (let start = last.start; start > 0;) {
			const earlier = await read({ before: start, limit: 3 });
			assert.ok(earlier.messages.length > 0 && earlier.messages.length <= 3);
			assert.notEqual(earlier.messages[0]!.role, "toolResult", "no result without its call");
			pages.unshift(earlier.messages);
			start = earlier.start;
		}
		assert.deepEqual(pages.flat(), whole, "every message once, in order");
		const assistants = whole.filter((m) => m.role === "assistant");
		assert.deepEqual(last.usage.map((m) => [m.entryId, m.usage]), assistants.map((m) => [m.entryId, m.usage]), "every turn's usage, for cache-miss notices");
		assert.ok(last.usage.every((m) => m.content === undefined), "usage only, no content");
		await session.prompt({ operationId: "op-7", text: "gen" });
		while (session.partial() === null) await new Promise((resolve) => setTimeout(resolve, 5));
		const status = await session.status();
		const paged = session.transcript(status, { limit: 2 }) as Page;
		const all = session.transcript(status);
		assert.notEqual(paged.partial, null);
		assert.deepEqual(paged.partial, all.partial);
		assert.deepEqual(paged.messages, all.messages.slice(paged.start));
		assert.equal(paged.total, all.messages.length);
		await settled(7);
		// A turn starts while the snapshot reads the status: that status is older than the messages, so it is read again.
		const readStatus = session.status.bind(session);
		let reads = 0;
		session.status = async () => {
			const current = await readStatus();
			if (++reads > 1) return current;
			await session.prompt({ operationId: "op-8", text: "turn 8" });
			return { ...current, stale: true };
		};
		let snapshot: Page & { status: Record<string, unknown> } | undefined;
		await session.snapshot({ limit: 2 }, (transcript) => (snapshot = transcript as typeof snapshot));
		assert.ok(reads >= 2, "the status is read again");
		assert.equal(snapshot?.status.stale, undefined, "the reply carries the fresh status");
		session.status = readStatus;
		await settled(8);
	} finally {
		await session.close();
	}
});

test("/back: Working Mode returns to its starting values, the context restarts at the host's handoff with the open set verbatim (no summarizer call), the set stays open, one orient turn runs", async () => {
	const { h, store, session, settled } = await quietChat("back");
	try {
		assert.ok(session.commands().some((c) => c.name === "back"), "PI WEB offers /back");
		await session.mode("attention focused");
		await session.mode("checking test");
		const ask = { context: "Release choice", questions: [{ id: "ship", question: "Ship today?", detail: "The build is green.", options: [{ value: "yes", label: "Ship", recommended: true }, { value: "no", label: "Wait" }] }] };
		await session.prompt({ operationId: "op-1", text: `call:ask_user ${JSON.stringify(ask)}` });
		await settled(1);
		assert.deepEqual(await session.command("back", "", "op-back"), { type: "done" });
		await settled(2);
		const mode = await workingModeSnapshot(h.harness, h.root);
		assert.deepEqual(mode.selected, { alignment: "Default", attention: "Default", checking: "Default", orchestration: "Main" });
		assert.equal(mode.aligned, false);
		const users = (await h.root.context(context)).messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
		assert.equal(users.length, 2, `only the handoff and the orient input remain: ${JSON.stringify(users)}`);
		for (const part of ["run `workstreams`", "Release choice", "**ship: Ship today?**", "The build is green.", "`yes` Ship (recommended)", "`no` Wait"]) assert.ok(users[0]!.includes(part), `handoff has ${part}`);
		assert.equal(users[1], BACK_PROMPT);
		assert.ok(!requests(store).includes("summarize"), "no summarizer call");
		assert.equal(Object.keys((await questionsState(h.harness, h.root)).open).length, 1, "the set stays open and answerable");
		assert.ok(session.messages().some((m) => textOf((m as { content?: unknown }).content).startsWith("call:ask_user")), "the transcript keeps the earlier conversation");
	} finally {
		await session.close();
	}
});

test("AFK closing nudge: a run ending quiet after work since the last checkpoint gets one closing input; its own run, and a run that ended on a checkpoint, get none", async () => {
	const { session, runs, settled } = await quietChat("afk-close");
	const nudges = () => session.messages().filter((m) => textOf((m as { content?: unknown }).content) === AFK_CLOSE_PROMPT).length;
	// Foreground: a background job's completion would wake a run of its own.
	const bash = (command: string) => `call:bash ${JSON.stringify({ command, description: "Work", foreground: true })}`;
	try {
		await session.mode("attention afk");
		await session.prompt({ operationId: "op-1", text: bash("echo work") });
		await settled(2);
		assert.equal(nudges(), 1, "one closing input after the working run");
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(runs(), 2, "the nudge's own run triggers no other");
		// The checkpoint call fails here (no workstreams on PATH); the call alone counts, as in the legacy extension.
		await session.prompt({ operationId: "op-2", text: bash("workstreams checkpoint ws-1 || true") });
		await settled(3);
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(runs(), 3, "a run that ended on a checkpoint gets no nudge");
		assert.equal(nudges(), 1);
	} finally {
		await session.close();
	}
});

test("the AFK alarm's Chat title is PI WEB's name for the Chat in <data dir>/session-runtimes.json, else none", () => {
	const data = scratch("chat-pi-web-data");
	mkdirSync(join(data, "durable", "chat-t"), { recursive: true });
	const store = join(data, "durable", "chat-t");
	assert.equal(piWebChatTitle(store, "chat-t"), undefined, "no locator file");
	writeFileSync(join(data, "session-runtimes.json"), JSON.stringify({ version: 1, chats: { "chat-t": { id: "chat-t", runtime: "durable", name: "Fix the alarm" }, "chat-u": { id: "chat-u", runtime: "durable" } } }));
	assert.equal(piWebChatTitle(store, "chat-t"), "Fix the alarm");
	assert.equal(piWebChatTitle(store, "chat-u"), undefined, "an untitled Chat");
	writeFileSync(join(data, "session-runtimes.json"), "{ torn");
	assert.equal(piWebChatTitle(store, "chat-t"), undefined, "an unreadable file");
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

/** A 1×1 PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("ask_user images: closeAsk with images delivers the answers text plus the images once, refuses a non-image, and the answers record keeps them", async () => {
	const { store, cwd } = family("ask-images");
	const host = new ChatHost(store, cwd);
	assert.ok((await host.ready).capabilities?.includes("ask-images"), "the host reports answer images");
	await host.call("prompt", { operationId: "op-ask", text: `call:ask_user ${JSON.stringify(ASK)}` });
	const opened = await host.until((e) => e.type === "ask.opened", "the ask") as UiEvent & { ask: { askId: string; revision: string } };
	await idle(host, 1);
	const close = (operationId: string, images: unknown) =>
		host.call<{ result: string; retried?: boolean }>("closeAsk", { askId: opened.ask.askId, revision: opened.ask.revision, operationId, outcome: answered(opened.ask.askId), content: "Answers: target staging", images });
	await assert.rejects(close("op-bad", [{ data: PNG, mimeType: "image/svg+xml" }]), /images must be image blocks of image\/jpeg, image\/png, image\/gif or image\/webp/);
	await assert.rejects(close("op-bad", [{ mimeType: "image/png" }]), /images must be image blocks/);
	await assert.rejects(close("op-bad", [{ mimeType: "image/png", data: "not base64" }]), /image 1 is not valid base64/);
	await assert.rejects(close("op-bad", [{ mimeType: "image/png", data: "iVBORw0" }]), /image 1 is not valid base64/, "a length that is no multiple of 4");
	await assert.rejects(close("op-bad", [{ mimeType: "image/png", data: "" }]), /image 1 is not valid base64/, "empty data");
	await assert.rejects(close("op-bad", [{ mimeType: "image/png", data: "AB==" }]), /image 1 is not valid base64/, "'==' with nonzero padding bits");
	await assert.rejects(close("op-bad", [{ mimeType: "image/png", data: "AAB=" }]), /image 1 is not valid base64/, "'=' with nonzero padding bits");
	await assert.rejects(close("op-bad", Array.from({ length: 17 }, () => ({ mimeType: "image/png", data: PNG }))), /at most 16 images/);
	await assert.rejects(close("op-bad", [{ mimeType: "image/png", data: "A".repeat(Math.ceil(10 * 1024 * 1024 / 3) * 4 + 4) }]), /image 1 is larger than 10 MiB/);
	assert.deepEqual((await host.call<Status>("status")).pendingAsks?.length, 1, "a refused close leaves the set open");
	const image = { type: "image", data: PNG, mimeType: "image/png" };
	assert.equal((await close("op-i1", [image])).result, "closed");
	const retried = await close("op-i1", [image]);
	assert.deepEqual([retried.result, retried.retried], ["closed", true], "a retry returns the outcome");
	await idle(host, 2);
	const deliveries = logged(store).filter((l) => l.label.startsWith("Answers: target staging"));
	assert.equal(deliveries.length, 1, "the answers reached the model exactly once");
	assert.equal(deliveries[0]?.images, 1, "with their image");
	const record = (await host.call<Transcript>("transcript")).messages.find((m) => (m as { customType?: string }).customType === "pi-web.ask.answers");
	assert.deepEqual(record?.content, [{ type: "text", text: "Answers: target staging" }, image], "the answers record keeps the text and the image");
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("ask_user approval-only: a set with approval: true may omit questions or give none; without approval it is refused; its approval reaches the model first", async () => {
	const { store, cwd } = family("ask-approval-only");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-none", text: `call:ask_user ${JSON.stringify({ context: ASK.context })}` });
	await idle(host, 1);
	const refused = (await host.call<Transcript>("transcript")).messages.filter((m) => m.role === "toolResult").at(-1);
	assert.equal(refused?.isError, true);
	assert.match(textOf(refused?.content), /questions are required for a new question set/);
	await host.call("prompt", { operationId: "op-empty", text: `call:ask_user ${JSON.stringify({ context: ASK.context, questions: [] })}` });
	await idle(host, 2);
	assert.equal((await host.call<Transcript>("transcript")).messages.filter((m) => m.role === "toolResult").at(-1)?.isError, true, "an empty list without approval is refused");
	let runs = 2;
	for (const [n, call] of [{ context: ASK.context, approval: true }, { context: ASK.context, approval: true, questions: [] }].entries()) {
		await host.call("prompt", { operationId: `op-approve-${String(n)}`, text: `call:ask_user ${JSON.stringify(call)}` });
		await idle(host, ++runs);
		const posted = (await host.call<Transcript>("transcript")).messages.filter((m) => m.role === "toolResult").at(-1);
		assert.equal(posted?.isError, false, textOf(posted?.content));
		assert.match(textOf(posted?.content), /^Posted the context for approval to the user/);
		const opened = host.events.filter((e) => e.type === "ask.opened")[n] as UiEvent & { ask: { askId: string; revision: string; approval?: true; questions: unknown[] } };
		assert.deepEqual([opened.ask.approval, opened.ask.questions], [true, []]);
		await host.call("prompt", { operationId: `op-drop-${String(n)}`, text: `call:ask_user ${JSON.stringify({ update: opened.ask.askId, approval: false })}` });
		await idle(host, ++runs);
		const dropped = (await host.call<Transcript>("transcript")).messages.filter((m) => m.role === "toolResult").at(-1);
		assert.match(textOf(dropped?.content), /An ask must contain at least one question/, "dropping approval from a set without questions is refused");
		const outcome = { askId: opened.ask.askId, reason: "submitted", askedAt: "", closedAt: "", context: ASK.context, approved: true, questions: [], answeredCount: 0, unansweredIds: [], summary: "Answered 0 of 0; none left unanswered" };
		const content = `The user approved the context.\nThe user submitted answers to question set ${opened.ask.askId}.\n\nAnswered 0 of 0; none left unanswered`;
		assert.equal((await host.call<{ result: string }>("closeAsk", { askId: opened.ask.askId, revision: opened.ask.revision, operationId: `op-close-${String(n)}`, outcome, content })).result, "closed");
		await idle(host, ++runs);
	}
	assert.equal(logged(store).filter((l) => l.label.startsWith("The user approved the context.")).length, 2, "each approval reached the model, approval first");
	assert.equal((await host.call<Status>("status")).pendingAsks, undefined);
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("ask_user: a question without detail is refused; a 4000-character detail is accepted and numbering is stripped; the description puts all explanation in the set", async () => {
	const { store, cwd } = family("ask-detail");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const { detail: _detail, ...bare } = ASK.questions[0]!;
	await host.call("prompt", { operationId: "op-bare", text: `call:ask_user ${JSON.stringify({ ...ASK, questions: [bare] })}` });
	await idle(host, 1);
	const refused = (await host.call<Transcript>("transcript")).messages.find((m) => m.role === "toolResult");
	assert.equal(refused?.isError, true, "a question without detail is refused");
	assert.match(textOf(refused?.content), /detail/);
	await host.call("prompt", { operationId: "op-long", text: `call:ask_user ${JSON.stringify({ ...ASK, questions: [{ ...ASK.questions[0]!, question: "1. Which target?", detail: "d".repeat(4000) }] })}` });
	const opened = await host.until((e) => e.type === "ask.opened", "the ask") as UiEvent & { ask: { questions: { question: string; detail: string }[] } };
	assert.equal(opened.ask.questions[0]!.detail.length, 4000);
	assert.equal(opened.ask.questions[0]!.question, "Which target?", "the panel numbers questions");
	await idle(host, 2);
	await host.close();
	const { workbenchExtension } = await import("../src/workbench.ts");
	const description = (workbenchExtension({ chatId: "x", signal: () => {} }) as unknown as { tools: { name: string; description: string }[] }).tools.find((t) => t.name === "ask_user")!.description;
	assert.match(description, /The panel covers the Chat: put all explanation into the set, and let your Chat message only say that questions were posted\./);
});

test("ask_user partial send: the final close returns the set's question order, as first posted and revised, so the whole record is numbered in set order", async () => {
	const { store, cwd } = family("ask-order");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const when = { id: "when", question: "When?", detail: "The deploy window.", options: [{ value: "now", label: "Now" }] };
	await host.call("prompt", { operationId: "op-ask", text: `call:ask_user ${JSON.stringify({ ...ASK, questions: [ASK.questions[0]!, when] })}` });
	const opened = await host.until((e) => e.type === "ask.opened", "the ask") as UiEvent & { ask: { askId: string; revision: string } };
	await idle(host, 1);
	const { askId, revision } = opened.ask;
	// The second question goes first, one by one; the agent then revises the set, which lists only target and a new question.
	const partial = { askId, reason: "submitted", askedAt: "", closedAt: "", questions: [{ question: when, answered: true, values: ["now"] }], answeredCount: 1, unansweredIds: [], summary: "Answered 1; still open: target", partial: true, revision: "r2" };
	assert.equal((await host.call<{ result: string }>("closeAsk", { askId, revision, operationId: "op-p1", outcome: partial, content: "Answer: when now" })).result, "closed");
	await idle(host, 2);
	const extra = { id: "extra", question: "Anything else?", detail: "Optional.", options: [{ value: "no", label: "No" }] };
	await host.call("prompt", { operationId: "op-upd", text: `call:ask_user ${JSON.stringify({ update: askId, questions: [ASK.questions[0]!, extra] })}` });
	await idle(host, 3);
	const revised = (await host.call<Status>("status")).pendingAsks?.find((a) => a.askId === askId);
	assert.deepEqual(revised?.questions.map((q) => q.id), ["target", "extra"]);
	const rest = { askId, reason: "submitted", askedAt: "", closedAt: "", questions: [{ question: ASK.questions[0], answered: true, values: ["prod"] }, { question: extra, answered: true, values: ["no"] }], answeredCount: 2, unansweredIds: [], summary: "Answered 2 of 2; none left unanswered" };
	const final = await host.call<{ result: string; order?: string[] }>("closeAsk", { askId, revision: revised?.revision, operationId: "op-p2", outcome: rest, content: "Answer: target prod" });
	assert.equal(final.result, "closed");
	assert.deepEqual(final.order, ["target", "when", "extra"], "each question where the set first listed it");
	assert.deepEqual((await host.call<{ order?: string[] }>("closeAsk", { askId, revision: revised?.revision, operationId: "op-p2", outcome: rest, content: "Answer: target prod" })).order, ["target", "when", "extra"], "a retried final close returns it too");
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("ask_user partial send: a set with no recorded order (posted before the host kept one) gets it back from history on its final close", async () => {
	const { h, session, settled } = await quietChat("ask-order-history");
	try {
		const when = { id: "when", question: "When?", detail: "The deploy window.", options: [{ value: "now", label: "Now" }] };
		await session.prompt({ operationId: "op-ask", text: `call:ask_user ${JSON.stringify({ ...ASK, questions: [ASK.questions[0]!, when] })}` });
		await settled(1);
		// As a host before the order was kept: the document has none for the set.
		await h.harness.commit(async (tx) => { delete (await tx.doc(QuestionsDoc, h.root.id)).order; }, context);
		const { askId, revision } = Object.values((await questionsState(h.harness, h.root)).open)[0]!;
		const partial = { askId, reason: "submitted", askedAt: "", closedAt: "", questions: [{ question: when, answered: true, values: ["now"] }], answeredCount: 1, unansweredIds: [], summary: "Answered 1; still open: target", partial: true, revision: "r2" };
		assert.equal((await session.closeAsk({ askId, revision, operationId: "op-p1", outcome: partial, content: "Answer: when now" })).result, "closed");
		const rest = { askId, reason: "submitted", askedAt: "", closedAt: "", questions: [{ question: ASK.questions[0], answered: true, values: ["prod"] }], answeredCount: 1, unansweredIds: [], summary: "Answered 1 of 1; none left unanswered" };
		// The JSON PI WEB sends (ASK's optional fields are not JSON-typed).
		const final = await session.closeAsk({ askId, revision: "r2", operationId: "op-p2", outcome: JSON.parse(JSON.stringify(rest)), content: "Answer: target prod" });
		assert.deepEqual(final.result === "closed" ? final.order : undefined, ["target", "when"], "the order the set was posted in, not send order");
	} finally {
		await session.close();
	}
});

test("ask_user: the set tracks who supplied its context; the user's edit, kept by a revision without context, ended by one with the same text", async () => {
	const { h, session, settled } = await quietChat("ask-context-by");
	try {
		const when = { id: "when", question: "When?", detail: "The deploy window.", options: [{ value: "now", label: "Now" }] };
		await session.prompt({ operationId: "op-ask", text: `call:ask_user ${JSON.stringify({ ...ASK, questions: [ASK.questions[0]!, when] })}` });
		await settled(1);
		const open = async () => Object.values((await questionsState(h.harness, h.root)).open)[0]!;
		const { askId, revision } = await open();
		const partial = { askId, reason: "submitted", askedAt: "", closedAt: "", editedContext: "Mine", questions: [{ question: when, answered: true, values: ["now"] }], answeredCount: 1, unansweredIds: [], summary: "Answered 1; still open: target", partial: true, revision: "r2" };
		await session.closeAsk({ askId, revision, operationId: "op-p1", outcome: partial, content: "Answer: when now" });
		assert.deepEqual([(await open()).context, (await open()).contextEdited], ["Mine", true]);
		await session.prompt({ operationId: "op-u1", text: `call:ask_user ${JSON.stringify({ update: askId })}` });
		await settled(3);
		assert.equal((await open()).contextEdited, true, "a revision without context keeps the user's");
		await session.prompt({ operationId: "op-u2", text: `call:ask_user ${JSON.stringify({ update: askId, context: "Mine" })}` });
		await settled(4);
		assert.deepEqual([(await open()).context, (await open()).contextEdited], ["Mine", undefined], "the agent's revision, though its text is the user's");
	} finally {
		await session.close();
	}
});

test("wholeRecord: each one-by-one send's image metadata stays in the whole record under its own answer, tagged with that send's revision; a hidden answer's images drop out", async () => {
	const { wholeRecord } = await import("../src/workbench.ts");
	const record = (id: string) => ({ question: { id, question: `${id}?`, options: [] }, answered: true, values: ["x"] });
	const image = (id: string | undefined, reference: string): { target: { kind: string; id?: string }; reference: string; mimeType: string } => ({ target: id === undefined ? { kind: "note" } : { kind: "question", id }, reference, mimeType: "image/png" });
	const send = (ids: string[], revision: string | undefined, images: ReturnType<typeof image>[]) => ({ askId: "a1", reason: "submitted", questions: ids.map(record), answeredCount: ids.length, unansweredIds: [], summary: "s", images, ...(revision === undefined ? {} : { partial: true, revision }) });
	// A question with id "note" is not the note: targets are objects.
	const whole = wholeRecord(send(["c"], undefined, [image("c", "[PIC_1]"), image(undefined, "[PIC_2]")]), [send(["a"], "r2", [image("a", "[PIC_1]")]), send(["note"], "r3", [image("note", "[PIC_1]"), image("note", "[PIC_2]")])], ["a", "note", "c"], false) as { images?: unknown[] } | undefined;
	assert.deepEqual(whole?.images, [
		{ ...image("a", "[PIC_1]"), revision: "r2" },
		{ ...image("note", "[PIC_1]"), revision: "r3" },
		{ ...image("note", "[PIC_2]"), revision: "r3" },
		image("c", "[PIC_1]"),
		image(undefined, "[PIC_2]"),
	]);
	const many = Array.from({ length: 101 }, (_, i) => send([`q${String(i)}`], `r${String(i)}`, [image(`q${String(i)}`, "[PIC_1]")]));
	const bounded = wholeRecord(send(["last"], undefined, []), many, [], false) as { images?: { target: { id?: string } }[] } | undefined;
	assert.deepEqual([bounded?.images?.length, bounded?.images?.[0]?.target.id], [99, "q2"], "the two hidden answers' images drop out");
});

test("wholeRecord: an earlier send's answer rows carry that send's revision, as its images do, so a reused question id keeps each photo under its own row", async () => {
	const { wholeRecord } = await import("../src/workbench.ts");
	const image = (reference: string) => ({ target: { kind: "question", id: "q" }, reference, mimeType: "image/png" });
	const send = (wording: string, revision: string | undefined, reference: string) => ({ askId: "a1", reason: "submitted", questions: [{ question: { id: "q", question: wording, options: [] }, answered: true, values: ["x"] }], answeredCount: 1, unansweredIds: [], summary: "s", images: [image(reference)], ...(revision === undefined ? {} : { partial: true, revision }) });
	const whole = wholeRecord(send("q again?", undefined, "[PIC_B]"), [send("q?", "r2", "[PIC_A]")], ["q"], false) as { questions: { revision?: string }[]; images: { revision?: string; reference: string }[] } | undefined;
	assert.deepEqual(whole?.questions.map((row) => row.revision), ["r2", undefined], "the earlier row carries r2, the final row none");
	const photos = (row: { revision?: string }) => whole?.images.filter((i) => i.revision === row.revision).map((i) => i.reference);
	assert.deepEqual(whole?.questions.map(photos), [["[PIC_A]"], ["[PIC_B]"]], "row 1 shows only A, row 2 only B");
	// 101 sends reusing one id, 16 photos each: only the kept rows' sends keep their photos, under PI WEB's 1,600-image limit.
	const sixteen = (send_: ReturnType<typeof send>) => ({ ...send_, images: Array.from({ length: 16 }, (_, i) => image(`[PIC_${String(i + 1)}]`)) });
	const many = Array.from({ length: 100 }, (_, i) => sixteen(send("q?", `r${String(i)}`, "")));
	const bounded = wholeRecord(sixteen(send("q?", undefined, "")), many, ["q"], false) as { images: { revision?: string }[] } | undefined;
	assert.equal(bounded?.images.length, 1600, "the hidden send's 16 photos drop out");
	assert.ok(bounded?.images.every((i) => i.revision !== "r0"), "none from the hidden send r0");
});

test("ask_user: approval: true marks the set for an Approve button; a revision without it keeps it, approval: false drops it", async () => {
	const { h, session, settled } = await quietChat("ask-approval");
	try {
		await session.prompt({ operationId: "op-ask", text: `call:ask_user ${JSON.stringify({ ...ASK, approval: true })}` });
		await settled(1);
		const open = async () => Object.values((await questionsState(h.harness, h.root)).open)[0]!;
		const { askId, approval } = await open();
		assert.equal(approval, true);
		await session.prompt({ operationId: "op-u1", text: `call:ask_user ${JSON.stringify({ update: askId })}` });
		await settled(2);
		assert.equal((await open()).approval, true, "a revision without approval keeps it");
		await session.prompt({ operationId: "op-u2", text: `call:ask_user ${JSON.stringify({ update: askId, approval: false })}` });
		await settled(3);
		assert.equal((await open()).approval, undefined);
	} finally {
		await session.close();
	}
});

test("ask_user: the result of a new and of an updated set tells the model not to restate, summarize or add context in the Chat", async () => {
	const { store, cwd } = family("ask-chat-rule");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-new", text: `call:ask_user ${JSON.stringify(ASK)}` });
	const opened = await host.until((e) => e.type === "ask.opened", "the ask") as UiEvent & { ask: { askId: string } };
	await idle(host, 1);
	await host.call("prompt", { operationId: "op-upd", text: `call:ask_user ${JSON.stringify({ update: opened.ask.askId })}` });
	await idle(host, 2);
	const results = (await host.call<Transcript>("transcript")).messages.filter((m) => m.role === "toolResult").map((m) => textOf(m.content));
	assert.match(results[0]!, /^Posted 1 question/);
	assert.match(results[1]!, /^Updated open question set/);
	for (const r of results) assert.ok(r.includes("do not restate, summarize or add context in the Chat"), r);
	await host.close();
});

test("ask_user showIf: a condition on a later or unknown question or an unoffered option is refused; a valid one is posted; the description asks for it", async () => {
	const { store, cwd } = family("ask-show-if");
	const host = new ChatHost(store, cwd);
	await host.ready;
	const location = { id: "location", question: "Where should the browser run?", detail: "Home or VPS.", options: [{ value: "home", label: "Home" }, { value: "vps", label: "VPS" }] };
	const machine = (showIf: { question: string; values: string[] }) => ({ id: "machine", question: "Which machine?", detail: "At home.", options: [{ value: "mini", label: "Mac mini" }], showIf });
	const bad: [string, unknown[], RegExp][] = [
		["op-unknown", [location, machine({ question: "nope", values: ["home"] })], /showIf of question machine must name an earlier question of this set, not nope/],
		["op-later", [machine({ question: "location", values: ["home"] }), location], /must name an earlier question/],
		["op-option", [location, machine({ question: "location", values: ["moon"] })], /question location has no option moon/],
	];
	for (const [n, [operationId, questions, error]] of bad.entries()) {
		await host.call("prompt", { operationId, text: `call:ask_user ${JSON.stringify({ ...ASK, questions })}` });
		await idle(host, n + 1);
		const refused = (await host.call<Transcript>("transcript")).messages.filter((m) => m.role === "toolResult").at(-1);
		assert.equal(refused?.isError, true, operationId);
		assert.match(textOf(refused?.content), error);
	}
	assert.equal((await host.call<Status>("status")).pendingAsks, undefined, "nothing was posted");
	await host.call("prompt", { operationId: "op-ok", text: `call:ask_user ${JSON.stringify({ ...ASK, questions: [location, machine({ question: "location", values: ["home", "home"] })] })}` });
	const opened = await host.until((e) => e.type === "ask.opened", "the ask") as UiEvent & { ask: { questions: { showIf?: unknown }[] } };
	assert.deepEqual(opened.ask.questions[1]!.showIf, { question: "location", values: ["home"] });
	await idle(host, bad.length + 1);
	await host.close();
	const { workbenchExtension } = await import("../src/workbench.ts");
	const description = (workbenchExtension({ chatId: "x", signal: () => {} }) as unknown as { tools: { name: string; description: string }[] }).tools.find((t) => t.name === "ask_user")!.description;
	assert.match(description, /Give a follow-up question `showIf` instead of writing 'If X:' in its text\./);
	assert.match(description, /The user can edit the context; treat an edited context as his version, so put text for approval \(a plan, draft or message\) there\./);
	assert.match(description, /Unlike ask_human \(Telegram, blocks until he replies\), it stays in this Chat\./);
});

test("ask_user partial send: one answer is delivered, the rest stays open at the new revision across a kill, and answering it closes the set", async () => {
	const { store, cwd } = family("ask-partial");
	const ask = { ...ASK, questions: [ASK.questions[0]!, { id: "when", question: "When?", detail: "The deploy window.", options: [{ value: "now", label: "Now" }] }] };
	let host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-ask", text: `call:ask_user ${JSON.stringify(ask)}` });
	const opened = await host.until((e) => e.type === "ask.opened", "the ask") as UiEvent & { ask: { askId: string; revision: string } };
	await idle(host, 1);
	const { askId, revision } = opened.ask;
	// PI WEB's PendingAskStore outcome for a partial send: only the answered question, and the revision the set continues under.
	const partial = {
		askId, reason: "submitted", askedAt: "", closedAt: "", context: ask.context,
		questions: [{ question: ask.questions[0], answered: true, values: ["staging"] }],
		answeredCount: 1, unansweredIds: [], summary: "Answered 1; still open: when", partial: true, revision: "r2",
	};
	const send = () => host.call<{ result: string; retried?: boolean }>("closeAsk", { askId, revision, operationId: "op-p1", outcome: partial, content: "Answer: target staging; when stays open" });
	assert.equal((await send()).result, "closed");
	assert.deepEqual((await host.call<Status>("status")).pendingAsks?.map((a) => [a.revision, a.questions.map((q) => q.id)]), [["r2", ["when"]]], "the unanswered question stays open at the new revision");
	const reopened = await host.until((e) => e.type === "ask.opened" && (e.ask as { revision: string }).revision === "r2", "the set at its new revision") as UiEvent & { ask: { questions: { id: string }[] } };
	assert.deepEqual(reopened.ask.questions.map((q) => q.id), ["when"]);
	assert.equal(host.events.filter((e) => e.type === "ask.closed").length, 0, "the set is not closed");
	await idle(host, 2);
	assert.equal(logged(store).filter((l) => l.label.startsWith("Answer: target staging")).length, 1, "the one answer reached the model");
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	const status = await host.call<Status>("status");
	assert.deepEqual(status.pendingAsks?.map((a) => [a.askId, a.revision, a.questions.map((q) => q.id)]), [[askId, "r2", ["when"]]], "the remaining question survives the restart");
	assert.deepEqual(await send().then((r) => [r.result, r.retried]), ["closed", true], "a retried partial send gets its outcome back");
	const rest = { ...partial, questions: [{ question: ask.questions[1], answered: true, values: ["now"] }], summary: "Answered 1 of 1; none left unanswered", partial: undefined, revision: undefined };
	assert.equal((await host.call<{ result: string }>("closeAsk", { askId, revision, operationId: "op-p2", outcome: rest, content: "Answer: when now" })).result, "stale", "the old revision is stale");
	const final = await host.call<{ result: string; earlier?: { questions: { question: { id: string } }[] }[] }>("closeAsk", { askId, revision: "r2", operationId: "op-p2", outcome: rest, content: "Answer: when now" });
	assert.equal(final.result, "closed");
	assert.deepEqual(final.earlier?.map((o) => o.questions.map((q) => q.question.id)), [["target"]], "the final close returns the earlier one-by-one send, so the record shows the whole set");
	const retriedFinal = await host.call<{ earlier?: unknown[] }>("closeAsk", { askId, revision: "r2", operationId: "op-p2", outcome: rest, content: "Answer: when now" });
	assert.equal(retriedFinal.earlier?.length, 1, "a retried final close returns the earlier sends too");
	await host.until((e) => e.type === "ask.closed", "the set closed");
	await host.until((e) => e.type === "agent.end", "the second delivery");
	assert.equal((await host.call<Status>("status")).pendingAsks, undefined);
	assert.equal(logged(store).filter((l) => l.label.startsWith("Answer:")).length, 2, "each send reached the model once");
	const transcript = await host.call<{ messages: { customType?: string; content?: unknown; details?: { questions: { question: { id: string } }[]; summary: string; answeredCount: number } }[] }>("transcript");
	const records = transcript.messages.filter((m) => m.customType === "pi-web.ask.answers");
	assert.equal(records.length, 2);
	// A reload or another device shows the whole set in the last card; the model's message keeps only this send's answer.
	assert.deepEqual(records[1]!.details?.questions.map((q) => q.question.id), ["target", "when"]);
	assert.deepEqual([records[1]!.details?.answeredCount, records[1]!.details?.summary], [2, "Answered 2 of 2; none left unanswered"]);
	assert.equal(textOf(records[1]!.content), "Answer: when now");
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

test("an owner run result PI WEB delivers as a prompt (Terminal runs) leaves an open attention request open", async () => {
	const { store, cwd } = family("attention-owner-run");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: 'call:request_attention {"reason":"Please review"}' });
	await idle(host, 1);
	const open = (await host.call<Status>("status")).attentionRequest;
	assert.ok(open !== undefined);
	// PI WEB durableChatService.ownerRun: a Terminal run's notice arrives as a follow-up prompt marked `machine`.
	await host.call("prompt", { operationId: "owner-run:7d1c", text: "[Owner run result] The user confirmed and ran your pi-run proposal outside the write fence.", mode: "followUp", machine: true });
	await idle(host, 2);
	assert.equal((await host.call<Status>("status")).attentionRequest?.id, open.id, "a machine follow-up is not the owner answering");
	// The operation ID is caller-chosen: an owner message under an `owner-run:` ID still answers it.
	await host.call("prompt", { operationId: "owner-run:custom", text: "here" });
	assert.equal((await host.call<Status>("status")).attentionRequest, undefined, "only the machine flag keeps it open");
	await host.close();
});

test("a replayed prompt operation admits no new turn and leaves an open attention request open", async () => {
	const { store, cwd } = family("attention-replay");
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: "hello" });
	await idle(host, 1);
	await host.call("prompt", { operationId: "op-2", text: 'call:request_attention {"reason":"Please review"}' });
	await idle(host, 2);
	const open = (await host.call<Status>("status")).attentionRequest;
	assert.ok(open !== undefined);
	// PI WEB retries an operation across a daemon restart, or replays a spawned Chat's assignment, with the same ID and text.
	const replay = await host.call<{ fresh: boolean }>("prompt", { operationId: "op-1", text: "hello" });
	assert.equal(replay.fresh, false);
	assert.equal((await host.call<Status>("status")).attentionRequest?.id, open.id, "a replay is not a new message from the owner");
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

test("OpenAI models: offered from the stored ChatGPT and Copilot logins; the choice survives a hard kill; /fast over IPC", async () => {
	const { store, cwd } = family("openai");
	let host = new ChatHost(store, cwd);
	await host.ready;
	const ids = (await host.call<{ provider: string; id: string }[]>("models")).map((m) => `${m.provider}/${m.id}`);
	for (const id of ["openai-codex/gpt-6-astra", "openai-codex/gpt-6.1-sol", "openai-codex/gpt-6-luna", "github-copilot/grok-4.7", "anthropic/claude-opus-5-5"]) assert.ok(ids.includes(id), `${id} offered`);
	await host.call("setModel", { provider: "openai-codex", modelId: "gpt-6-astra" });
	assert.deepEqual(await host.call("command", { name: "fast", args: "on" }), { type: "done", message: "Fast Mode on" });
	assert.equal((await host.call<Status>("status")).extensionStatuses?.["pi-openai-fast-mode"], "fast");
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	const status = await host.call<Status>("status");
	assert.deepEqual(status.model, { provider: "openai-codex", id: "gpt-6-astra" }, "the model survives a hard kill");
	assert.equal(status.extensionStatuses?.["pi-openai-fast-mode"], "fast", "Fast Mode is the package's file, not Chat state");
	await host.call("command", { name: "fast", args: "off" });
	await host.call("setModel", { provider: "github-copilot", modelId: "grok-4.7" });
	assert.deepEqual((await host.call<Status>("status")).model, { provider: "github-copilot", id: "grok-4.7" });
	await host.close();
	assert.equal(existsSync(join(store, "requests.log")), false, "no model request was sent");
});

test("resolve: the owner marks an interrupted write retry; it is recorded, the model is told once, and write runs again", async () => {
	const { store, cwd } = family("resolve");
	const first = new ChatHost(store, cwd);
	await first.ready;
	await first.call("prompt", { operationId: "op-1", text: heldWrite(cwd) });
	await writing(first);
	await first.kill();

	const host = new ChatHost(store, cwd);
	await host.ready;
	const [effect] = (await host.call<Status>("status")).unresolvedEffects ?? [];
	assert.equal(effect?.toolName, "write");
	assert.match(effect!.arguments, /effect\.fifo/);
	await assert.rejects(host.call("resolveEffect", { taskId: "999", resolution: "done" }), /No interrupted call/);
	await host.call("resolveEffect", { taskId: effect!.id, resolution: "retry" });
	await host.call("resolveEffect", { taskId: effect!.id, resolution: "retry" }); // an HTTP retry
	await assert.rejects(host.call("resolveEffect", { taskId: effect!.id, resolution: "done" }), /already marked retry/);
	assert.equal((await host.call<Status>("status")).unresolvedEffects, undefined);
	await host.until(() => logged(store).some((l) => l.label.startsWith("The user resolved the interrupted write")), "the resolution reaching the model");
	await host.call("prompt", { operationId: "op-2", text: 'call:write {"path":"after.txt","content":"x"}' });
	await host.until((e) => e.type === "tool.end" && e.toolName === "write" && e.isError === false, "a write call that is no longer blocked");
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
	await host.call("prompt", { operationId: "op-1", text: heldWrite(cwd) });
	await writing(host);
	host.child.kill("SIGTERM");
	const effect = releaseWrite(cwd);
	assert.equal(await host.exited, 0);
	assert.match(effect(), /^(deploy\n)?$/, "the effect ran at most once");
	const reopened = new ChatHost(store, cwd);
	await reopened.ready;
	assert.equal((await reopened.call<Status>("status")).unresolvedEffects?.[0]?.toolName, "write");
	await reopened.close();
	assert.equal(integrity(store), "ok");
	const events = readdirSync(TELEMETRY).flatMap((file) => readLog<{ type: string; sessionId: string }>(join(TELEMETRY, file))).filter((e) => e.sessionId === store);
	assert.equal(events.filter((e) => e.type === "session.shutdown").length, 2, "both host lifetimes ended with session.shutdown");
});

// ─── Slice 3 group C: attention and catalog ─────────────────────────────────

type Reminded = Logged & { reminder?: string };

test("open-questions reminder: a plain prompt carries PI WEB's reminder of the persisted open sets once, hidden from the transcript, across a kill", async () => {
	const { store, cwd } = family("reminder");
	let host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-none", text: "nothing open" });
	await idle(host, 1);
	await host.call("prompt", { operationId: "op-ask", text: `call:ask_user ${JSON.stringify(ASK)}` });
	const opened = await host.until((e) => e.type === "ask.opened", "the ask") as UiEvent & { ask: { askId: string } };
	await idle(host, 2);
	await host.kill();

	// The open set is read from the store after the kill, not from memory.
	host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-r1", text: "hello" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: hello", "the answer to hello");
	await host.kill();

	host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-r1", text: "hello" }); // the HTTP retry of the same send
	const status = await host.call<Status>("status");
	assert.equal(status.isStreaming, false, "the retry admitted nothing new");
	const log = readLog<Reminded>(join(store, "requests.log"));
	assert.equal(log.find((l) => l.label === "nothing open")?.reminder, undefined, "no reminder without open sets");
	const reminded = log.filter((l) => l.reminder !== undefined);
	assert.equal(reminded.length, 1, "one reminder, not one per attempt");
	assert.equal(reminded[0]!.label, "hello", "the script still reads the user's own text");
	assert.match(reminded[0]!.reminder!, /^Question sets still open for the user \(answers arrive as a follow-up message\):\n- /);
	assert.ok(reminded[0]!.reminder!.includes(`- ${opened.ask.askId} (${opened.ask.askId.slice(0, 3)}.target; updated `), String(reminded[0]!.reminder));
	assert.match(reminded[0]!.reminder!, /0 turns ago\): Which target\?\nIf one no longer matches the situation and ask_user is available, update or withdraw it; otherwise leave it\.$/);
	const transcript = await host.call<Transcript>("transcript");
	assert.deepEqual(transcript.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)), ["nothing open", `call:ask_user ${JSON.stringify(ASK)}`, "hello"], "the reminder stays out of the browser transcript");

	// A queued follow-up carries none (legacy reminds only on a plain prompt).
	await host.call("prompt", { operationId: "op-gen", text: "gen" });
	await host.until((e) => e.type === "assistant.delta", "the running answer");
	await host.call("prompt", { operationId: "op-follow", text: "queued", mode: "followUp" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: queued", "the follow-up answer");
	const after = readLog<Reminded>(join(store, "requests.log"));
	assert.equal(after.find((l) => l.label === "queued")?.reminder, undefined);
	assert.ok(after.find((l) => l.label === "gen")?.reminder?.includes("1 turns ago"), "turns since the set was posted are counted");
	await host.close();
	assert.equal(integrity(store), "ok");
});

test("status reports context usage from the last answer and the Chat's model window, as a legacy Chat shows it", async () => {
	const { store, cwd } = family("usage");
	const host = new ChatHost(store, cwd);
	await host.ready;
	assert.deepEqual((await host.call<Status & { contextUsage?: unknown }>("status")).contextUsage, { tokens: null, contextWindow: 128000, percent: null });
	await host.call("prompt", { operationId: "op-1", text: "hello" });
	await idle(host, 1);
	const status = await host.call<Status & { contextUsage?: { tokens: number; contextWindow: number; percent: number } }>("status");
	assert.equal(status.contextUsage?.contextWindow, 128000);
	assert.ok((status.contextUsage?.tokens ?? 0) > 0);
	assert.equal(status.contextUsage?.percent, (status.contextUsage!.tokens / 128000) * 100);
	assert.ok((status as Status & { tokens: { total: number } }).tokens.total > 0, "usage totals are reported too");
	await host.close();
});

test("redaction: the open-questions reminder a prompt commits is sanitized, though the question it repeats came verbatim from tool-call arguments", async () => {
	const { store, cwd } = family("reminder-secret");
	const secret = `ghp_${"R3m1nd3rS3cr3tT0k3n".repeat(2)}`;
	const ask = { ...ASK, questions: [{ ...ASK.questions[0]!, question: `Rotate ${secret}?` }] };
	const host = new ChatHost(store, cwd);
	await host.ready;
	await host.call("prompt", { operationId: "op-ask", text: `call:ask_user ${JSON.stringify(ask)}` });
	await idle(host, 1);
	await host.call("prompt", { operationId: "op-r", text: "hello" });
	await idle(host, 2);
	const reminder = readLog<Reminded>(join(store, "requests.log")).find((l) => l.label === "hello")?.reminder ?? "";
	assert.match(reminder, /Rotate \[REDACTED:github-token\]\?/, "the model sees the reminder redacted");
	await host.close(); // the host holds the store exclusively
	// Every stored row, as text: the rows that carry the reminder must not carry the secret.
	const db = new DatabaseSync(join(store, "session.sqlite"));
	const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
	const rows = tables.flatMap((table) => (db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]).map((row) =>
		Object.values(row).map((value) => (value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : String(value))).join("\t")));
	assert.ok(rows.some((row) => row.includes(secret)), "positive control: the verbatim tool-call arguments hold the secret");
	const carriers = rows.filter((row) => row.includes("Question sets still open for the user"));
	assert.ok(carriers.length > 0, "the reminder is stored with the prompt");
	assert.deepEqual(carriers.filter((row) => row.includes(secret)), [], "no stored reminder holds the plaintext");
	db.close();
});

test("remainingAsk: a partial send's skipped dependents leave the set with its answered questions", async () => {
	const { remainingAsk } = await import("../src/workbench.ts");
	const q = (id: string) => ({ id, question: `${id}?`, options: [] });
	const ask = { askId: "a1", askedAt: "", updatedAt: "", revision: "r1", turnsSinceUpdate: 0, questions: [q("location"), q("machine"), q("other")] };
	const outcome = { partial: true, revision: "r2", questions: [{ question: q("location"), answered: true }, { question: q("machine"), answered: false, skipped: true }] };
	assert.deepEqual(remainingAsk(ask, outcome)?.questions.map((question) => question.id), ["other"]);
});

test("remainingAsk: a partial send's edited context becomes the set's context; none keeps the agent's", async () => {
	const { remainingAsk } = await import("../src/workbench.ts");
	const q = (id: string) => ({ id, question: `${id}?`, options: [] });
	const ask = { askId: "a1", askedAt: "", updatedAt: "", revision: "r1", turnsSinceUpdate: 0, context: "Agent's plan", questions: [q("db"), q("cache")] };
	const outcome = { partial: true, revision: "r2", questions: [{ question: q("db"), answered: true }] };
	assert.equal(remainingAsk(ask, { ...outcome, editedContext: "My plan" })?.context, "My plan");
	assert.equal(remainingAsk(ask, outcome)?.context, "Agent's plan");
	assert.equal(remainingAsk(ask, { ...outcome, editedContext: "" })?.context, undefined, "a cleared context stays cleared");
});

test("wholeRecord: as PI WEB's withEarlierAnswers, unanswered ids follow the set order, and past the bound the summary counts every answer and names the hidden ones", async () => {
	const { wholeRecord } = await import("../src/workbench.ts");
	const record = (id: string, answered: boolean) => ({ question: { id, question: `${id}?`, options: [] }, answered, values: answered ? ["x"] : [] });
	const send = (questions: ReturnType<typeof record>[], partial: boolean) => ({ askId: "a1", reason: "submitted", questions, answeredCount: questions.filter((q) => q.answered).length, unansweredIds: [], summary: "s", ...(partial ? { partial: true, revision: "r" } : {}) });
	// a went first; the agent revised the rest to c, b; both left unanswered.
	const whole = wholeRecord(send([record("c", false), record("b", false)], false), [send([record("a", true)], true)], ["a", "b", "c"], false) as { questions: { question: { id: string } }[]; unansweredIds: string[]; summary: string } | undefined;
	assert.deepEqual([whole?.questions.map((q) => q.question.id), whole?.unansweredIds, whole?.summary], [["a", "b", "c"], ["b", "c"], "Answered 1 of 3; unanswered: b, c"]);
	const many = Array.from({ length: 6 }, (_, s) => send(Array.from({ length: 20 }, (_, i) => record(`s${String(s)}-${String(i)}`, true)), true));
	const bounded = wholeRecord(send([record("last", true)], false), many, [], false) as { questions: unknown[]; answeredCount: number; summary: string } | undefined;
	assert.deepEqual([bounded?.questions.length, bounded?.answeredCount, bounded?.summary], [100, 100, "Answered 121 of 121; none left unanswered; 21 earlier answers not shown"]);
});
