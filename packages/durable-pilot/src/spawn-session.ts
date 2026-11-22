// spawn_session for Durable Chats (legacy PI WEB `spawnSessionTool.ts`): the lead starts an independent Chat in a
// workspace of its project and sends it a first prompt; it gets no output back. PI WEB creates the Chat (a Durable Chat
// in the same instance): the host emits a `durable.spawn` request and PI WEB answers with the `spawned` method. A child
// never gets the tool: its allowlist names its tools.
import { createHash } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import { obj, opt, str } from "@earendil-works/pi-schema";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

export type SpawnRequest = { requestId: string; spawningCwd: string; prompt: string; cwd?: string; model?: string; thinkingLevel?: string };
export type SpawnResult = { sessionId: string; cwd: string; model?: string };
type Settle = { requestId: string; result?: SpawnResult; error?: string };
type Pending = { request: SpawnRequest; resolve: (result: SpawnResult) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };

/** PI WEB answers in seconds (one Chat created and prompted); this bounds a connected daemon that never answers. */
const ANSWER_TIMEOUT_MS = 120_000;

// PI WEB `KNOWN_THINKING_LEVELS`.
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const Params = obj({
	thinkingLevel: opt(StringEnum(LEVELS, {
		description: "Thinking level override for the new session. Set this field only when instructed to use a specific thinking level or to choose an appropriate one. Otherwise omit it to inherit this session's thinking level. An unknown value is rejected; valid levels are clamped to the selected model's capabilities.",
	})),
	prompt: str({ description: "The first instruction to send to the newly created session. The new session runs independently; you do not receive its output." }),
	cwd: opt(str({ description: "Working directory for the new session. Must be a workspace (worktree, or root) of the same project as this session. Defaults to this session's working directory." })),
	model: opt(str({ description: 'Model override for the new session, as an exact "provider/model-id". Set this field only when instructed to use a specific model or to choose an appropriate one. Otherwise omit it to inherit this session\'s model. An unknown value is rejected.' })),
}, { open: true });

export class SessionSpawner {
	/** Set by PI WEB's `configure` when its spawn support is on (legacy `spawnSessions`). */
	enabled = false;
	#emit: ((event: { type: "durable.spawn" } & SpawnRequest) => void) | undefined;
	readonly #pending = new Map<string, Pending>();
	/** Whether a daemon can hear requests: the answer timeout runs only then, so a request outlives any daemon outage. */
	#connected = true;

	readonly #chatId: string;

	constructor(chatId: string) {
		this.#chatId = chatId;
	}

	attach(emit: (event: { type: "durable.spawn" } & SpawnRequest) => void): void {
		this.#emit = emit;
	}

	/**
	 * Ask again for every request still waiting: a daemon that just connected may never have received them (sent while
	 * none was connected) or may have died before answering. PI WEB answers a repeated request with the Chat it started.
	 */
	resend(): void {
		this.#connected = true;
		for (const pending of this.#pending.values()) {
			this.#arm(pending);
			this.#emit?.({ type: "durable.spawn", ...pending.request });
		}
	}

	/** No daemon is connected: pause every answer timeout until one connects (`resend`). */
	disconnected(): void {
		this.#connected = false;
		for (const pending of this.#pending.values()) clearTimeout(pending.timer);
	}

	#arm(pending: Pending): void {
		clearTimeout(pending.timer);
		if (this.#connected) pending.timer = setTimeout(() => pending.reject(new Error("PI WEB did not answer the spawn request")), ANSWER_TIMEOUT_MS);
	}

	/** PI WEB's answer to a request; one for a request nobody waits for (timed out, host restarted) is dropped. */
	settle(answer: Settle): void {
		const pending = this.#pending.get(answer.requestId);
		this.#pending.delete(answer.requestId);
		if (answer.error !== undefined) pending?.reject(new Error(answer.error));
		else if (answer.result !== undefined) pending?.resolve(answer.result);
		else pending?.reject(new Error("PI WEB sent an empty spawn answer"));
	}

	#request(request: SpawnRequest, signal: AbortSignal | undefined): Promise<SpawnResult> {
		const emit = this.#emit;
		if (!this.enabled || emit === undefined) return Promise.reject(new Error("Spawning sessions is disabled"));
		return new Promise<SpawnResult>((resolve, reject) => {
			const done = () => {
				clearTimeout(pending.timer);
				signal?.removeEventListener("abort", aborted);
				this.#pending.delete(request.requestId);
			};
			const aborted = () => (done(), reject(new Error("spawn_session was cancelled")));
			const pending: Pending = { request, resolve: (result) => (done(), resolve(result)), reject: (error) => (done(), reject(error)) };
			signal?.addEventListener("abort", aborted, { once: true });
			this.#pending.set(request.requestId, pending);
			this.#arm(pending);
			emit({ type: "durable.spawn", ...request });
		});
	}

	extension() {
		const tool = defineTool({
			name: "spawn_session",
			deferred: true,
			description: "Start a fully independent session; its transcript and results are unavailable here. Use only when the user or active workflow explicitly requests a separate session.",
			parameters: Params,
			// Default `unsafe`: an interrupted call may have started a Chat, so it is reconciled by the owner, never rerun.
			execute: async (args, api, c) => {
				const agent = await api.agent(c);
				const model = args.model ?? (agent.model === undefined ? undefined : `${agent.model.provider}/${agent.model.modelId}`);
				const thinkingLevel = args.thinkingLevel ?? agent.thinkingLevel;
				const result = await this.#request({
					requestId: createHash("sha256").update(`${this.#chatId}\0${String(api.taskId)}\0spawn`).digest("hex").slice(0, 32),
					spawningCwd: agent.cwd ?? "",
					prompt: args.prompt,
					...(args.cwd === undefined ? {} : { cwd: args.cwd }),
					...(model === undefined ? {} : { model }),
					...(thinkingLevel === undefined ? {} : { thinkingLevel }),
				}, c.abortSignal);
				const note = result.model === undefined ? "" : ` using model ${result.model}`;
				return { output: [{ type: "text" as const, text: `Started independent session ${result.sessionId} in ${result.cwd}${note}.` }], details: result };
			},
		});
		return defineExtension({ name: "workbench.spawn-session", tools: [tool] });
	}
}
