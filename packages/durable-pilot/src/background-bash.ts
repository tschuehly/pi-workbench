// The Workbench `bash` (extensions/background-bash) in a Durable Chat: background by default, `foreground: true`
// waits up to 30 seconds and then continues in the background, `bash_status` and `bash_cancel`, and one completion
// message per job. Jobs run under the existing detached runner and registry (jobs.mjs, runner.mjs), which stay the
// authority for job state and logs; Durable records only references and delivery receipts (`BashJobsDoc`).
// Exactly once, across kills:
// - Launch: the job ID derives from the Chat and the tool task, the intent commits before the spawn, and the runner
//   claims the job before it runs anything, so a rerun of the (replay-safe) tool reattaches instead of launching again.
// - Completion: the job is claimed for the foreground result or for a completion in one commit, and the completion is
//   submitted under a request ID derived from the job, so a crash before its receipt resubmits nothing new.
// Completions are delivered by a host-side reporter, not a Durable task, so a reopened idle Chat delivers them at once
// while a restore with interrupted work stays paused until the user resumes it (owner decision 2).
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { AgentDoc, type Conversation, type ConversationId, defineDoc, defineExtension, defineTool, type DocumentReader, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { cancelJob as cancelRecord, cleanOutput, completionContent, defaultRoot, describeJob, launchJob, MAX_TAIL, previewJob, readJob as readRecord, readTail } from "../../../extensions/background-bash/jobs.mjs";
import { toolEnv, warningTool } from "./extensions.ts";
import { context } from "./host.ts";
import { PACKAGE_MESSAGE_ENTRY } from "./packages.ts";
import { redact, redactingTool, sanitizeDeep } from "./redact.ts";

export const FOREGROUND_WAIT_MS = 30_000;
const MAX_ACTIVE = 8;
const POLL_MS = 250;
export const BACKGROUND_BASH_STATUS = "pi-workbench:background-bash";

/** Test fault injection: SIGKILL this host at a named point, as a crash there would. */
export function crashPoint(name: string): void {
	if (process.env.PI_DURABLE_CRASH_AT === name) process.kill(process.pid, "SIGKILL");
}

/** A job this conversation launched: its tool task, whether it runs in the background, and its delivery receipt. */
type JobRef = { taskId: string; startedAt: number; background: boolean; delivery?: "foreground" | "completion"; admitted?: boolean };
/**
 * A fork starts without the source's jobs, as a new legacy session does.
 * ponytail: refs are never pruned (the registry prunes week-old jobs); drop settled, admitted refs if Chats grow huge.
 */
export const BashJobsDoc = defineDoc<{ jobs: Record<string, JobRef> }>({
	kind: "workbench.background-bash",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ jobs: {} }),
	checkpointWhen: () => false,
});

/** A job as the registry (jobs.mjs `readJob`) reports it. */
type Job = {
	id: string; command: string; description?: string; startedAt: number; logPath: string; dir: string; bytes: number;
	state: "pending" | "running" | "complete" | "failed" | "cancelled"; pid?: number; exitCode?: number; error?: string; finishedAt?: number;
};
const readJob = (root: string, id: string) => readRecord(root, id) as Job | undefined;
const cancelJob = (root: string, id: string) => cancelRecord(root, id) as Job | undefined;
const settled = (job: Job | undefined) => job !== undefined && job.state !== "running" && job.state !== "pending";

/** A UUID-shaped job ID derived from the Chat and the tool task: a rerun of the same call names the same job. */
function jobId(chatId: string, taskId: string): string {
	const hex = createHash("sha256").update(`bash\0${chatId}\0${taskId}`).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const text = (value: string) => [{ type: "text" as const, text: value }];
const started = (id: string, logPath: string) =>
	`Background bash ${id} started. Continue independent work or end the turn; completion arrives automatically. Output log: ${logPath}`;

/** Bytes of a log from `offset`, at most `limit`. */
function readFrom(path: string, offset: number, limit: number): Buffer {
	const buffer = Buffer.alloc(limit);
	const fd = openSync(path, "r");
	try {
		return buffer.subarray(0, readSync(fd, buffer, 0, limit, offset));
	} finally {
		closeSync(fd);
	}
}

function sleep(ms: number, c: Context): Promise<void> {
	return new Promise((resolve) => {
		const signal = c.abortSignal;
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal?.addEventListener("abort", done, { once: true });
	});
}

export type BackgroundBashOptions = {
	readonly chatId: string;
	readonly cwd: string;
	/** The lead conversation; other conversations wait for their commands as native bash does. */
	readonly rootId: () => ConversationId | undefined;
	readonly root?: string;
};

/** The Workbench bash tools, and the reporter that delivers completions to the lead conversation. */
export class BackgroundBash {
	readonly #options: BackgroundBashOptions;
	readonly #root: string;
	/** Set before the harness closes: a wait it interrupts is a host restart, never a cancel. */
	#closing = false;
	#timer: ReturnType<typeof setInterval> | undefined;
	#reporting = false;
	#signature = "";
	#conversation: Conversation | undefined;
	#reader: DocumentReader | undefined;

	constructor(options: BackgroundBashOptions) {
		this.#options = options;
		this.#root = options.root ?? defaultRoot();
	}

	extension() {
		const bash = defineTool({
			name: "bash",
			description:
				"Run a bash command in an attended Pi session. Background by default: return a job ID immediately, keep elapsed time and output size visible in Activity, and deliver exit status and output when done. Set foreground=true to wait up to 30 seconds for the output; a command still running then continues in the background and delivers its completion like any job. Background jobs survive host restarts; they stop at their timeout or a 12-hour maximum lifetime.\n\nRun long checks and builds in the background. Continue independent work, then wait for their completion message before dependent actions; never infer success from a job ID. Use foreground=true for short commands whose output is needed now. If it returns a job ID instead, the command is still running: continue independent work or end the turn. Do not launch conflicting writes while a background command is running. Use bash_status for elapsed time and output bytes; use bash_cancel to stop a job. A completed job reports its exit status and bounded output in a new message; do not claim success from its initial job ID.",
			parameters: Type.Object({
				description: Type.String({ description: "Short description of what this command does, 3-10 words, in plain words (e.g. 'Check installed app build date'). Shown to the user instead of the command." }),
				command: Type.String({ description: "Shell command to execute" }),
				timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional; background jobs otherwise stop after 12 hours)" })),
				foreground: Type.Optional(Type.Boolean({ description: "Wait up to 30 seconds for output and exit status, then continue in the background; default false" })),
			}),
			// The job ID and the runner's claim make a rerun reattach to the job it launched, never launch another.
			replay: "safe",
			execute: async (args, api, c) => {
				const id = jobId(this.#options.chatId, String(api.taskId));
				const lead = api.conversationId === this.#options.rootId();
				const foreground = !lead || args.foreground === true;
				const agent = await api.snapshot(AgentDoc, api.conversationId, c);
				const cwd = agent?.cwd ?? this.#options.cwd;
				let ref = (await api.snapshot(BashJobsDoc, api.conversationId, c))?.jobs[id];
				if (ref === undefined) {
					if (args.command.trim() === "") throw new Error("A non-empty bash command is required");
					if (args.timeout !== undefined && (!Number.isFinite(args.timeout) || args.timeout <= 0 || args.timeout * 1000 > 2_147_483_647)) throw new Error("Invalid timeout in seconds");
					if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`);
					const owned = Object.keys((await api.snapshot(BashJobsDoc, api.conversationId, c))?.jobs ?? {});
					if (owned.filter((other) => !settled(readJob(this.#root, other))).length >= MAX_ACTIVE)
						throw new Error("Too many background bash jobs; wait or cancel one before starting another");
					const startedAt = api.now();
					ref = await api.commit(async (tx) => {
						const doc = await tx.doc(BashJobsDoc, api.conversationId);
						doc.jobs[id] ??= { taskId: String(api.taskId), startedAt, background: !foreground };
						return { ...doc.jobs[id]! };
					}, c);
				}
				crashPoint("bash.intent");
				const { shell, args: shellArgs } = getShellConfig();
				const identity = { chatId: this.#options.chatId, conversationId: api.conversationId, rootId: this.#options.rootId(), cwd, ...(agent?.model === undefined ? {} : { model: agent.model }), ...(agent?.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }) };
				launchJob({
					root: this.#root, id, command: args.command, description: args.description, cwd, timeout: args.timeout,
					env: { ...process.env, ...toolEnv(identity) }, sessionId: this.#options.chatId, shell, args: shellArgs, startedAt: ref.startedAt,
				});
				crashPoint("bash.spawned");
				const logPath = readJob(this.#root, id)!.logPath;
				if (ref.background) return { output: text(started(id, logPath)), details: describeJob(readJob(this.#root, id)) };
				return this.#wait(id, lead ? FOREGROUND_WAIT_MS : Infinity, api, c);
			},
		});
		const status = defineTool({
			name: "bash_status",
			description: "Diagnostic snapshot of background bash job state, elapsed time, output byte count, and log path. Do not use to poll for completion; it arrives automatically. Omit id to list all jobs in this session.",
			parameters: Type.Object({ id: Type.Optional(Type.String()) }),
			replay: "safe",
			execute: async (args, api, c) => {
				const ids = Object.keys((await api.snapshot(BashJobsDoc, api.conversationId, c))?.jobs ?? {}).filter((id) => args.id === undefined || id === args.id);
				const list = ids.flatMap((id) => {
					const job = readJob(this.#root, id);
					return job === undefined ? [] : [describeJob(job.state === "pending" ? { ...job, state: "running" } : job)];
				});
				return { output: text(list.length ? JSON.stringify(list) : "No matching background bash jobs."), details: { jobs: list } };
			},
		});
		const cancel = defineTool({
			name: "bash_cancel",
			description: "Stop one session-owned background bash job by ID. Does not affect unrelated processes.",
			parameters: Type.Object({ id: Type.String() }),
			replay: "safe",
			execute: async (args, api, c) => {
				const owned = (await api.snapshot(BashJobsDoc, api.conversationId, c))?.jobs[args.id] !== undefined;
				const job = owned ? cancelJob(this.#root, args.id) : undefined;
				this.#poke();
				if (job === undefined) return { output: text(`No background bash job ${args.id}.`) };
				return { output: text(`Cancellation requested for ${args.id} (state=${job.state}).`), details: describeJob(job) };
			},
		});
		return defineExtension({ name: "workbench.background-bash", tools: [bash, status, cancel].map((tool) => redactingTool(warningTool(tool))) });
	}

	/**
	 * Foreground: stream the log while waiting up to `ms` for the job. A finished job claimed here is this call's
	 * result; otherwise it continues in the background and its completion arrives as a message. Stop cancels the job;
	 * a host shutdown leaves it running for the rerun after reopen.
	 */
	async #wait(id: string, ms: number, api: ToolExecutionApi, c: Context) {
		const deadline = Date.now() + ms;
		const decoder = new StringDecoder("utf8");
		let offset = 0;
		const stream = (job: Job) => {
			while (offset < job.bytes) {
				const chunk = readFrom(job.logPath, offset, Math.min(job.bytes - offset, 64 * 1024));
				if (chunk.length === 0) break;
				offset += chunk.length;
				const out = cleanOutput(decoder.write(chunk));
				if (out !== "") api.output(out);
			}
		};
		for (;;) {
			let job = readJob(this.#root, id)!;
			stream(job);
			if (c.abortSignal?.aborted === true && !this.#closing) job = cancelJob(this.#root, id)!;
			if (c.abortSignal?.aborted === true && this.#closing) throw new Error("The host is shutting down; this call resumes after it reopens");
			if (settled(job) || Date.now() >= deadline) {
				const outcome = await api.commit(async (tx) => {
					const ref = (await tx.doc(BashJobsDoc, api.conversationId)).jobs[id]!;
					if (ref.delivery === "completion") return "delivered" as const;
					if (settled(job)) {
						ref.delivery = "foreground";
						return "claimed" as const;
					}
					ref.background = true;
					return "background" as const;
				}, c);
				const details = describeJob(job);
				if (outcome === "delivered") return { output: text(`Background bash ${id} ${job.state}; its completion was delivered as a message.`), details };
				if (outcome === "background")
					return { output: text(`Still running after 30s; continued as background bash ${id}. Continue independent work or end the turn; completion arrives automatically. Output log: ${job.logPath}`), details };
				const truncated = job.bytes > MAX_TAIL;
				const out = `${truncated ? `[showing recent output only; full output: ${job.logPath}]\n` : ""}${cleanOutput(readTail(job.logPath, job.bytes)) || "(no output)"}`;
				// As the legacy tool: a failure is an error result that still carries the output.
				if (job.state === "cancelled") return { output: text(`${out}\n\nCommand aborted`), isError: true, details: { ...details, truncated } };
				if (job.state !== "complete")
					return { output: text(`${out}\n\n${job.exitCode === undefined ? `Command failed${job.error === undefined ? "" : `: ${cleanOutput(job.error)}`}` : `Command exited with code ${job.exitCode}`}`), isError: true, details: { ...details, truncated } };
				return { output: text(out), details: { ...details, truncated } };
			}
			await sleep(POLL_MS, c);
		}
	}

	// ─── Reporter ────────────────────────────────────────────────────────────

	/**
	 * Deliver completions of the lead's background jobs: now, and after every reopen. `deliverable` resolves once the
	 * Chat may take new input (a paused restore waits for the user); `changed` publishes the status.
	 */
	start(conversation: Conversation, reader: DocumentReader, hooks: { deliverable: () => Promise<void>; changed: () => void }): void {
		this.#conversation = conversation;
		this.#reader = reader;
		this.#hooks = hooks;
		// ponytail: polls the registry every 500 ms; watch the job directories if many Chats run at once.
		this.#timer = setInterval(() => this.#poke(), 500);
		this.#poke();
	}

	#hooks: { deliverable: () => Promise<void>; changed: () => void } = { deliverable: async () => {}, changed: () => {} };

	/** Before the harness closes: stop reporting; a running foreground wait ends without cancelling its job. */
	close(): void {
		this.#closing = true;
		clearInterval(this.#timer);
	}

	/** Running jobs for PI WEB's Activity, as the legacy extension publishes them. */
	async status(): Promise<Record<string, string>> {
		if (this.#conversation === undefined) return {};
		const running = (await this.#read()).filter((job) => job.state === "running");
		if (running.length === 0) return {};
		const jobs = running.map((job) => ({ id: job.id, elapsedSeconds: Math.floor((Date.now() - job.startedAt) / 1000), bytes: job.bytes, ...previewJob(job, 1200) }));
		return { [BACKGROUND_BASH_STATUS]: JSON.stringify({ schemaVersion: 1, jobs }) };
	}

	async #read(): Promise<Job[]> {
		const doc = await this.#reader!.snapshot(BashJobsDoc, this.#conversation!.id, context);
		return Object.keys(doc?.jobs ?? {}).flatMap((id) => {
			const job = readJob(this.#root, id);
			return job === undefined ? [] : [job];
		});
	}

	#poke(): void {
		if (this.#reporting || this.#closing || this.#conversation === undefined) return;
		this.#reporting = true;
		void this.#report().catch(() => {}).finally(() => (this.#reporting = false));
	}

	async #report(): Promise<void> {
		const conversation = this.#conversation!;
		const refs = Object.entries((await this.#reader!.snapshot(BashJobsDoc, conversation.id, context))?.jobs ?? {});
		const jobs = await this.#read();
		// Elapsed time in 5-second steps, so Activity moves without a status per poll.
		const signature = JSON.stringify(jobs.filter((job) => job.state === "running").map((job) => [job.id, job.bytes, Math.floor((Date.now() - job.startedAt) / 5000)]));
		if (signature !== this.#signature) {
			this.#signature = signature;
			this.#hooks.changed();
		}
		for (const [id, ref] of refs) {
			if (!ref.background || ref.admitted === true || ref.delivery === "foreground") continue;
			const job = jobs.find((candidate) => candidate.id === id);
			if (!settled(job)) continue;
			await this.#hooks.deliverable();
			if (this.#closing) return;
			await this.#deliver(conversation, job!);
		}
	}

	/** Claim the completion, submit it under the job's request ID, then record the receipt. */
	async #deliver(conversation: Conversation, job: Job): Promise<void> {
		const claimed = await conversation.commit(async (tx) => {
			const ref = (await tx.doc(BashJobsDoc, conversation.id)).jobs[job.id];
			if (ref === undefined || ref.delivery === "foreground" || ref.admitted === true) return false;
			ref.delivery = "completion";
			return true;
		}, context);
		if (!claimed) return;
		const content = redact(completionContent(job));
		const data = { customType: "background-bash", display: true, details: sanitizeDeep(describeJob(job), redact) };
		const requestId = `background-bash:${job.id}`;
		// A cancelled job's completion is context for the next turn; any other wakes the Chat (queued while it is busy).
		if (job.state === "cancelled")
			await conversation.submit({ type: "write", requestId, entry: { kind: PACKAGE_MESSAGE_ENTRY, data, model: [{ role: "user", content, timestamp: Date.now() }] } }, context);
		else await conversation.submit({ type: "input", content, whenBusy: "followUp", requestId, entry: { kind: PACKAGE_MESSAGE_ENTRY, data } }, context);
		crashPoint("bash.admitted");
		await conversation.commit(async (tx) => {
			const ref = (await tx.doc(BashJobsDoc, conversation.id)).jobs[job.id];
			if (ref !== undefined) ref.admitted = true;
		}, context);
		this.#hooks.changed();
	}
}
