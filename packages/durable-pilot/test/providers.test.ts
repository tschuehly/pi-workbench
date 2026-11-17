// Slice 4 group OpenAI: Durable Chats offer the legacy model set (Claude, ChatGPT subscription via openai-codex and
// openai, Meta's Muse, GitHub Copilot) from Pi's own auth.json, switch providers mid-Chat, map the thinking level per model, port
// pi-openai-fast-mode, and redact every new provider stream before commit. Every provider request goes to a fake
// `fetch` in this process (WebSocket disabled, so Codex takes its SSE path); nothing leaves the machine.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { openChatHost } from "../src/chat.ts";
import { ChatSession, type UiEvent } from "../src/chat-session.ts";
import { context } from "../src/host.ts";
import { codexToken, type E, installedPiAuthStorage, race } from "./refresh-race.ts";
import { cleanup, scratch } from "./runner.ts";

type Json = Record<string, any>;


const HOUR = 3_600_000;
const LOGINS = {
	anthropic: { type: "oauth", access: ["sk", "ant", "oat01", "fake-claude"].join("-"), refresh: "fake-ort", expires: Date.now() + HOUR },
	"openai-codex": { type: "oauth", access: codexToken("live"), refresh: "fake-codex-refresh", expires: Date.now() + HOUR, accountId: "acct-live" },
	openai: { type: "oauth", access: "fake-openai-chatgpt", refresh: "fake-openai-refresh", expires: Date.now() + HOUR },
	meta: { type: "oauth", access: "fake-meta-muse", refresh: "fake-meta-refresh", expires: Date.now() + HOUR },
	"github-copilot": { type: "oauth", access: "tid=fake;proxy-ep=proxy.individual.githubcopilot.com", refresh: "fake-gh", expires: Date.now() + HOUR },
};

/** A fake Pi agent dir with these stored logins; returns it. */
function agentDir(logins: Partial<typeof LOGINS>): string {
	const dir = join(scratch("agent"), "agent");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "auth.json"), JSON.stringify(logins, null, 2), { mode: 0o600 });
	return dir;
}

// ─── Wire fixtures ───────────────────────────────────────────────────────────

const sse = (events: Json[], named = true) => events.map((e) => `${named ? `event: ${e.type}\n` : ""}data: ${JSON.stringify(e)}\n\n`).join("");

/** OpenAI Responses stream (Codex and Copilot `openai-responses`). */
function responses(text: string): string {
	const item = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
	return sse([
		{ type: "response.created", response: { id: "resp_1", status: "in_progress" } },
		{ type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
		{ type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "" } },
		...text.match(/[\s\S]{1,7}/g)!.map((delta) => ({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta })),
		{ type: "response.output_item.done", output_index: 0, item },
		{ type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 } } } },
	]);
}

/** Anthropic Messages stream. */
function messages(text: string): string {
	return sse([
		{ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "m", stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
		{ type: "message_stop" },
	]);
}

type Sent = { host: string; path: string; authorization: string | null; body: Json };

/** Replace fetch: provider requests are recorded and answered with `answer`; anything else is refused. */
function fakeNetwork(answer: (sent: Sent) => string) {
	const sent: Sent[] = [];
	const realFetch = globalThis.fetch;
	const realSocket = globalThis.WebSocket;
	// Codex prefers its WebSocket transport; without a constructor it falls back to SSE over fetch.
	(globalThis as { WebSocket?: unknown }).WebSocket = undefined;
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		let raw = Buffer.from(await request.arrayBuffer());
		if (request.headers.get("content-encoding") === "zstd") raw = zstdDecompressSync(raw);
		const entry: Sent = { host: url.host, path: url.pathname, authorization: request.headers.get("authorization") ?? request.headers.get("x-api-key"), body: raw.length === 0 ? {} : JSON.parse(raw.toString("utf8")) };
		sent.push(entry);
		if (!["chatgpt.com", "api.individual.githubcopilot.com", "api.anthropic.com", "mock.invalid"].includes(url.host)) throw new Error(`network blocked by test: ${url.host}`);
		return new Response(answer(entry), { status: 200, headers: { "content-type": "text/event-stream" } });
	}) as typeof fetch;
	return {
		sent,
		restore: () => {
			globalThis.fetch = realFetch;
			(globalThis as { WebSocket?: unknown }).WebSocket = realSocket;
		},
	};
}

const answerFor = (sent: Sent) => (sent.host === "api.anthropic.com" ? messages("claude answered") : responses(`${sent.host === "chatgpt.com" ? "codex" : "copilot"} answered`));

// ─── Chat under test ─────────────────────────────────────────────────────────

type Chat = { session: ChatSession; host: Awaited<ReturnType<typeof openChatHost>>; events: UiEvent[]; dir: string; cwd: string; close: () => Promise<void> };

async function openChat(agent: string, model = "faux", cwd?: string): Promise<Chat> {
	process.env.PI_CODING_AGENT_DIR = agent;
	const dir = scratch("provider-chat");
	const work = cwd ?? join(dir, "workspace");
	mkdirSync(work, { recursive: true });
	const host = await openChatHost({ dir: join(dir, "family"), cwd: work, model, scripted: true });
	const events: UiEvent[] = [];
	const session = new ChatSession(host, (event) => events.push(event));
	await session.start();
	return { session, host, events, dir: join(dir, "family"), cwd: work, close: () => session.close() };
}

/** Send a prompt and wait for its run to end (an event the host emits after the commit). */
async function turn(chat: Chat, text: string): Promise<UiEvent[]> {
	const from = chat.events.length;
	await chat.session.prompt({ operationId: `op-${text}`, text });
	for (let i = 0; i < 400; i++) {
		const tail = chat.events.slice(from);
		if (tail.some((e) => e.type === "agent.end")) return tail;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`no agent.end after ${text}`);
}

const assistantTexts = (chat: Chat) =>
	(chat.session.messages() as { role: string; content: { type: string; text?: string }[]; errorMessage?: string }[])
		.filter((m) => m.role === "assistant")
		.map((m) => m.content.map((c) => c.text ?? "").join("") || `error: ${m.errorMessage}`);

let saved: string | undefined;
beforeEach(() => void (saved = process.env.PI_CODING_AGENT_DIR));
afterEach(() => {
	if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved;
});
after(cleanup);

// ─── P016: model list and switching ──────────────────────────────────────────

describe("P016 models: the legacy provider set from Pi's auth.json", () => {
	it("offers Claude, openai-codex, openai, meta and github-copilot models when their logins are stored", async () => {
		const chat = await openChat(agentDir(LOGINS));
		try {
			const ids = (await chat.session.models()).map((m) => `${m.provider}/${m.id}`);
			for (const id of ["openai-codex/gpt-6-astra", "openai-codex/gpt-6.1-sol", "openai-codex/gpt-6-luna", "openai/gpt-6-astra", "openai/gpt-6.1-sol", "openai/gpt-6-luna", "meta/muse-spark-1.3", "anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5", "anthropic/claude-fable-5-1", "github-copilot/grok-4.7", "github-copilot/gemini-3.8-flash", "github-copilot/mai-code-1.1-flash", "github-copilot/kimi-k3", "faux/faux-1"])
				assert.ok(ids.includes(id), `${id} offered`);
			assert.deepEqual([...new Set(ids.map((id) => id.split("/")[0]))], ["anthropic", "openai-codex", "openai", "meta", "github-copilot", "faux"], "only these providers");
		} finally {
			await chat.close();
		}
	});

	it("adds Pi's refreshed catalog (models-store.json) as Pi does: stored models extend the built-in list, Copilot's login filters it", async () => {
		const agent = agentDir({ ...LOGINS, "github-copilot": { ...LOGINS["github-copilot"], availableModelIds: ["grok-4.7", "gpt-9-stored"] } as never });
		const stored = (provider: string, id: string, api: string) => ({ id, name: id, api, provider, baseUrl: "https://example.invalid", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 32000, type: "chat" });
		writeFileSync(join(agent, "models-store.json"), JSON.stringify({
			"openai-codex": { models: [stored("openai-codex", "gpt-5.3-codex-spark", "openai-codex-responses")], checkedAt: 1 },
			meta: { models: [stored("meta", "muse-ember-1.0", "openai-responses")], checkedAt: 1 },
			"github-copilot": { models: [stored("github-copilot", "gpt-9-stored", "openai-responses"), stored("github-copilot", "not-enabled", "openai-responses")], checkedAt: 1 },
		}));
		const before = readFileSync(join(agent, "models-store.json"), "utf8");
		const chat = await openChat(agent);
		try {
			const ids = (await chat.session.models()).map((m) => `${m.provider}/${m.id}`);
			assert.ok(ids.includes("openai-codex/gpt-5.3-codex-spark"), "a stored Codex model is offered");
			assert.ok(ids.includes("openai-codex/gpt-6-astra"), "next to the built-in ones");
			assert.ok(ids.includes("meta/muse-ember-1.0"), "the Challenge pair's stored Muse model is offered");
			assert.deepEqual(ids.filter((id) => id.startsWith("github-copilot/")), ["github-copilot/grok-4.7", "github-copilot/gpt-9-stored"], "Copilot keeps only the login's models");
			await chat.session.setModel("openai-codex", "gpt-5.3-codex-spark");
			assert.equal(readFileSync(join(agent, "models-store.json"), "utf8"), before, "Pi's catalog file is only read");
		} finally {
			await chat.close();
		}
	});

	it("a provider without a stored login is unavailable: not listed, and selecting it fails visibly", async () => {
		const chat = await openChat(agentDir({ anthropic: LOGINS.anthropic }));
		try {
			const providers = new Set((await chat.session.models()).map((m) => m.provider));
			assert.deepEqual([...providers], ["anthropic", "faux"]);
			await assert.rejects(chat.session.setModel("openai-codex", "gpt-6-astra"), /No stored login for openai-codex/);
			await assert.rejects(chat.session.setModel("github-copilot", "grok-4.7"), /No stored login for github-copilot/);
			await assert.rejects(chat.session.setModel("openai", "gpt-6-luna"), /No stored login for openai/);
			await assert.rejects(chat.session.setModel("meta", "muse-spark-1.3"), /No stored login for meta/);
			assert.deepEqual((await chat.session.status()).model, { provider: "faux", id: "faux-1" }, "the Chat keeps its model");
		} finally {
			await chat.close();
		}
	});

	it("an environment Copilot token is no second credential path: only the stored login counts", async () => {
		process.env.COPILOT_GITHUB_TOKEN = "fake-env-copilot";
		try {
			const chat = await openChat(agentDir({ anthropic: LOGINS.anthropic }));
			try {
				assert.equal((await chat.session.models()).some((m) => m.provider === "github-copilot"), false);
			} finally {
				await chat.close();
			}
		} finally {
			delete process.env.COPILOT_GITHUB_TOKEN;
		}
	});

	it("switches providers mid-Chat: each request goes to its provider with its stored login and the whole conversation", async () => {
		const net = fakeNetwork(answerFor);
		const chat = await openChat(agentDir(LOGINS));
		try {
			await turn(chat, "on faux");
			await chat.session.setModel("openai-codex", "gpt-6-astra");
			await turn(chat, "to codex");
			await chat.session.setModel("github-copilot", "grok-4.7");
			await turn(chat, "to copilot");
			await chat.session.setModel("anthropic", "claude-opus-5-5");
			await turn(chat, "to claude");
			assert.deepEqual(net.sent.map((s) => `${s.host}${s.path}`), ["chatgpt.com/backend-api/codex/responses", "api.individual.githubcopilot.com/responses", "api.anthropic.com/v1/messages"]);
			assert.deepEqual(net.sent.map((s) => s.authorization), [`Bearer ${LOGINS["openai-codex"].access}`, `Bearer ${LOGINS["github-copilot"].access}`, `Bearer ${LOGINS.anthropic.access}`]);
			assert.equal(net.sent[0]!.body.model, "gpt-6-astra");
			assert.equal(net.sent[1]!.body.model, "grok-4.7");
			assert.equal(net.sent[2]!.body.model, "claude-opus-5-5");
			const earlier = ["on faux", "ok: on faux", "to codex", "codex answered", "to copilot", "copilot answered"];
			for (const [i, count] of [[0, 2], [1, 4], [2, 6]] as const)
				for (const text of earlier.slice(0, count)) assert.ok(JSON.stringify(net.sent[i]!.body).includes(text), `request ${i} carries the earlier "${text}"`);
			assert.deepEqual(assistantTexts(chat), ["ok: on faux", "codex answered", "copilot answered", "claude answered"]);
		} finally {
			net.restore();
			await chat.close();
		}
	});

	it("serves each provider from models.json's providers.<id>.baseUrl, as legacy Pi does (pi-web's e2e mock)", async () => {
		const net = fakeNetwork((sent) => (sent.path.startsWith("/claude") ? messages("claude answered") : responses("mock answered")));
		const agent = agentDir(LOGINS);
		const base = (id: string) => `http://mock.invalid/${id}`;
		// Copilot takes no override: pi-ai serves it from the login's proxy endpoint.
		writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { anthropic: { baseUrl: base("claude") }, "openai-codex": { baseUrl: base("codex") } } }));
		const chat = await openChat(agent);
		try {
			for (const [provider, model] of [["openai-codex", "gpt-6-luna"], ["anthropic", "claude-sonnet-5-5"]] as const) {
				await chat.session.setModel(provider, model);
				await turn(chat, `to ${provider}`);
			}
			assert.deepEqual(net.sent.map((s) => `${s.host}${s.path}`), ["mock.invalid/codex/responses", "mock.invalid/claude/v1/messages"]);
			assert.deepEqual(assistantTexts(chat), ["mock answered", "claude answered"]);
		} finally {
			net.restore();
			await chat.close();
		}
	});
});

// ─── Concurrent refresh of the ChatGPT login ─────────────────────────────────

describe("openai-codex refresh against a legacy process", () => {
	it("control: without the lock the same race sends more than one refresh request", async () => {
		const e = await race(installedPiAuthStorage(), ["unlocked", "unlocked", "unlocked"], "openai-codex");
		assert.ok(e.refreshRequests > 1, `unlocked processes all refresh: ${e.refreshRequests} requests`);
	});

	it("two hosts and the installed Pi refresh one expired ChatGPT login once, under Pi's lock", async () => {
		const piModule = installedPiAuthStorage();
		for (let iteration = 0; iteration < Number(process.env.PILOT_REFRESH_ITERATIONS ?? 5); iteration++) {
			const e = await race(piModule, ["host", "host", "pi"], "openai-codex");
			assert.equal(e.refreshRequests, 1, `iteration ${iteration}: exactly one refresh request`);
			assert.equal(e.rejected, 0);
			for (const p of e.processes as E[]) {
				assert.equal(p.error, undefined, `${p.kind} failed: ${p.error}`);
				assert.equal(p.access, e.issuedAccess, `${p.kind} ends with the refreshed token`);
			}
			for (const p of (e.processes as E[]).filter((p) => p.kind === "host")) {
				assert.deepEqual([...new Set(p.blocked.map((b: E) => b.host))], ["chatgpt.com"], "the turn went on to the (blocked) Codex API");
				assert.equal(p.blocked[0].authorization, e.issuedAccess, "with the refreshed token");
			}
			assert.equal(e.finalRefreshIsIssued, true, "the rotated refresh token is stored");
			assert.equal(e.otherKept, true, "other credentials survive the write");
			assert.equal(e.mode, "600");
			assert.equal(e.lockLeft, false);
			assert.equal(e.torn, 0);
		}
	});
});

// ─── Thinking level per provider ─────────────────────────────────────────────

describe("thinking level across providers", () => {
	it("a switch clamps the Chat's level to what the new model supports, as Pi does", async () => {
		const chat = await openChat(agentDir(LOGINS));
		try {
			const { root } = chat.host;
			await chat.session.setModel("openai-codex", "gpt-6-astra");
			await root.configure({ thinkingLevel: "max" }, context);
			await chat.session.setModel("github-copilot", "grok-4.7");
			assert.equal((await chat.session.status()).thinkingLevel, "xhigh", "grok-4.7 tops out at xhigh");
			await root.configure({ thinkingLevel: "minimal" }, context);
			await chat.session.setModel("anthropic", "claude-opus-5-5");
			assert.equal((await chat.session.status()).thinkingLevel, "low", "Opus 5.5 has no minimal");
			await chat.session.setModel("openai-codex", "gpt-6-luna");
			assert.equal((await chat.session.status()).thinkingLevel, "low", "a supported level is kept");
		} finally {
			await chat.close();
		}
	});

	it("the level reaches each provider in its own form", async () => {
		const net = fakeNetwork(answerFor);
		const chat = await openChat(agentDir(LOGINS));
		try {
			const { root } = chat.host;
			await chat.session.setModel("openai-codex", "gpt-6-astra");
			await root.configure({ thinkingLevel: "minimal" }, context);
			await turn(chat, "codex minimal");
			await chat.session.setModel("github-copilot", "grok-4.7");
			await root.configure({ thinkingLevel: "high" }, context);
			await turn(chat, "copilot high");
			assert.deepEqual(net.sent[0]!.body.reasoning?.effort, "low", "Codex maps minimal to low (model thinkingLevelMap)");
			assert.deepEqual(net.sent[1]!.body.reasoning?.effort, "high");
		} finally {
			net.restore();
			await chat.close();
		}
	});
});

// ─── P137: pi-openai-fast-mode ───────────────────────────────────────────────

const FAST_PATH = (agent: string) => join(agent, "extensions", "pi-openai-fast-mode", "config.json");

describe("P137 pi-openai-fast-mode", () => {
	it("/fast toggles the package's own config file; priority goes only to its target models", async () => {
		const net = fakeNetwork(answerFor);
		const agent = agentDir(LOGINS);
		const chat = await openChat(agent);
		try {
			await chat.session.setModel("openai-codex", "gpt-6-astra");
			await turn(chat, "fast off");
			assert.deepEqual(await chat.session.command("fast", "on"), { type: "done", message: "Fast Mode on" });
			assert.equal(JSON.parse(readFileSync(FAST_PATH(agent), "utf8")).enabled, true, "the same file the legacy package reads");
			assert.equal((await chat.session.status()).extensionStatuses?.["pi-openai-fast-mode"], "fast");
			await turn(chat, "fast on");
			await chat.session.setModel("openai-codex", "gpt-6.1-sol");
			assert.equal((await chat.session.status()).extensionStatuses?.["pi-openai-fast-mode"], undefined, "not a Fast Mode target");
			await turn(chat, "not a target");
			await chat.session.setModel("openai-codex", "gpt-6-astra");
			assert.deepEqual(await chat.session.command("fast", ""), { type: "done", message: "Fast Mode off" }, "no argument toggles");
			await turn(chat, "toggled off");
			assert.deepEqual(net.sent.map((s) => s.body.service_tier ?? null), [null, "priority", null, null]);
			assert.deepEqual(await chat.session.command("fast", "sometimes"), { type: "unsupported", message: "Usage: /fast [on|off|toggle]" });
		} finally {
			net.restore();
			await chat.close();
		}
	});

	it("a workspace config file wins over the user one, as in the package; a legacy toggle applies to the next request", async () => {
		const net = fakeNetwork(answerFor);
		const agent = agentDir(LOGINS);
		const workspace = join(scratch("fast-ws"), "ws");
		const project = join(workspace, ".pi", "pi-openai-fast-mode", "config.json");
		mkdirSync(join(project, ".."), { recursive: true });
		writeFileSync(project, JSON.stringify({ enabled: true, targets: [] }));
		const chat = await openChat(agent, "openai-codex/gpt-6-astra", workspace);
		try {
			await turn(chat, "project on");
			writeFileSync(project, JSON.stringify({ enabled: false }));
			await turn(chat, "project off");
			assert.deepEqual(net.sent.map((s) => s.body.service_tier ?? null), ["priority", null], "targets come from the package, enabled from the file");
			assert.equal(existsSync(FAST_PATH(agent)), false, "the user file is untouched");
		} finally {
			net.restore();
			await chat.close();
		}
	});
});

// ─── Redaction on the new provider streams ───────────────────────────────────

const SECRET = `ghp_${"S3cr3tT0k3nV4lu3F0rL34kT3st".padEnd(36, "x")}`;

describe("redaction of OpenAI and Copilot streams before commit", () => {
	for (const [provider, modelId] of [["openai-codex", "gpt-6-astra"], ["github-copilot", "grok-4.7"]] as const)
		it(`${provider}: a secret in the model's answer never reaches the store or PI WEB`, async () => {
			const net = fakeNetwork(() => responses(`the token is ${SECRET} done`));
			const chat = await openChat(agentDir(LOGINS), `${provider}/${modelId}`);
			try {
				const events = await turn(chat, "leak it");
				const stored = assistantTexts(chat).join("\n");
				assert.match(stored, /\[REDACTED/, "the committed answer is redacted");
				assert.equal(JSON.stringify(events).includes(SECRET), false, "no emitted event carries it");
				assert.equal(JSON.stringify(events).includes(SECRET.slice(0, 12)), false, "nor a prefix of it");
			} finally {
				net.restore();
				await chat.close();
			}
			const db = ["session.sqlite", "session.sqlite-wal"].map((f) => join(chat.dir, f)).filter(existsSync).map((f) => readFileSync(f));
			assert.equal(db.some((b) => b.includes(SECRET)), false, "the store files never held it");
		});
});

// ─── Providers Pi packages register (pi.registerProvider) ────────────────────

describe("P016b providers registered by Pi packages: pi-xai-oauth (xai-auth) and pi-meta-oauth (meta)", () => {
	const XAI = process.env.PILOT_XAI_PACKAGE ?? join(process.env.HOME ?? "", "IdeaProjects", "pi-xai-oauth");
	const META = join(process.env.PILOT_PI_PACKAGES ?? join(process.env.HOME ?? "", ".pi", "agent", "npm", "node_modules"), "pi-meta-oauth");
	const XAI_LOGIN = { type: "oauth", access: "fake-xai-grok", refresh: "fake-xai-refresh", expires: Date.now() + HOUR };
	const GROK = { id: "grok-4.7", name: "Grok 4.7", apiBackend: "responses", reasoning: true, input: ["text", "image"], inputProvenance: "known-model-metadata", cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 131072 };
	const EMBER = { id: "muse-ember-1.0", name: "Muse Ember 1.0", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 256000, api: "openai-responses", provider: "meta", baseUrl: "https://api.meta.ai/v1" };

	/** A Responses stream whose only output is one function call. */
	const functionCall = (name: string, args: Json) => {
		const item = { type: "function_call", id: "fc_1", call_id: "call_1", name, arguments: JSON.stringify(args), status: "completed" };
		return sse([
			{ type: "response.created", response: { id: "resp_1", status: "in_progress" } },
			{ type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
			{ type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_1", delta: item.arguments },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 } } } },
		]);
	};

	/** A Chat with both packages installed, their logins stored, and every request recorded and answered here. */
	/** `xai`: the stored login, the cache's age and other answers (the token endpoint, the catalog) for the expired-login case. */
	async function packagedChat(xai: { login?: typeof XAI_LOGIN & { tokenEndpoint?: string }; cacheAge?: number; answer?: (url: URL, request: Request) => Response | undefined } = {}) {
		for (const path of [XAI, META]) assert.ok(existsSync(join(path, "package.json")), `package at ${path}`);
		const agent = agentDir({ ...LOGINS, ["xai-auth" as "meta"]: xai.login ?? XAI_LOGIN });
		writeFileSync(join(agent, "settings.json"), JSON.stringify({ packages: [XAI, META] }));
		writeFileSync(join(agent, "models-store.json"), JSON.stringify({ meta: { models: [EMBER], checkedAt: Date.now() } }));
		// The package's account catalog, fresh: it lists grok-4.7 (its curated offline fallback is grok-4.6 only).
		mkdirSync(join(agent, "cache", "pi-xai-oauth"), { recursive: true, mode: 0o700 });
		writeFileSync(join(agent, "cache", "pi-xai-oauth", "models-v2.json"), JSON.stringify({ schemaVersion: 2, fetchedAt: xai.cacheAge === undefined ? Date.now() + 1_000 : Date.now() - xai.cacheAge, models: [GROK] }), { mode: 0o600 });
		// pi-xai-oauth also reads the Grok CLI's login from HOME: an empty one.
		const home = join(agent, "..", "home");
		mkdirSync(home, { recursive: true });
		const savedHome = process.env.HOME;
		process.env.HOME = home;
		const sent: Sent[] = [];
		let metaCalls = 0;
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const request = new Request(input, init);
			const url = new URL(request.url);
			const raw = await request.text();
			sent.push({ host: url.host, path: url.pathname, authorization: request.headers.get("authorization"), body: raw === "" ? {} : raw.startsWith("{") ? JSON.parse(raw) : { form: raw } });
			const answer = xai.answer?.(url, request);
			if (answer !== undefined) return answer;
			// Anything but a model request (a catalog refresh) is refused.
			if (!url.pathname.endsWith("/responses")) return new Response("{}", { status: 401 });
			const body = url.host === "api.meta.ai" ? (metaCalls++ === 0 ? functionCall("execute_command", { command: "echo ember-tool" }) : responses("ember answered")) : responses("grok answered");
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		}) as typeof fetch;
		process.env.PI_CODING_AGENT_DIR = agent;
		const dir = scratch("ext-provider-chat");
		const cwd = join(dir, "workspace");
		mkdirSync(cwd, { recursive: true });
		const restore = () => {
			globalThis.fetch = realFetch;
			process.env.HOME = savedHome;
		};
		try {
			const host = await openChatHost({ dir: join(dir, "family"), cwd, model: "faux", scripted: true, packages: { agentDir: agent } });
			const events: UiEvent[] = [];
			const session = new ChatSession(host, (event) => events.push(event));
			await session.start();
			const chat: Chat = { session, host, events, dir, cwd, close: async () => (await session.close(), restore()) };
			return { chat, sent };
		} catch (error) {
			restore();
			throw error;
		}
	}

	it("Grok: xai-auth/grok-4.7 is available, routable by delegation's resolver, and answers through the package's client with the stored login", async () => {
		const { chat, sent } = await packagedChat();
		try {
			const available = (await chat.host.models.getAvailable()).map((m) => `${m.provider}/${m.id}`);
			assert.ok(available.includes("xai-auth/grok-4.7"), "xai-auth/grok-4.7 available (the routing catalog)");
			// Delegation writes exactly this catalog for the resolver (delegation.ts `route`).
			const catalog = join(chat.dir, "catalog.txt");
			writeFileSync(catalog, available.map((id) => id.replace("/", " ")).join("\n"));
			process.env.PI_WORKBENCH_QUOTA_CACHE = join(chat.dir, "quota.json");
			writeFileSync(process.env.PI_WORKBENCH_QUOTA_CACHE, JSON.stringify({ version: 1, checkedAt: Date.now(), status: 0, stdout: JSON.stringify({ providers: [] }), stderr: "" }));
			const { resolveBinding } = (await import("../../../extensions/subagent/core.mjs")) as { resolveBinding: (...args: unknown[]) => Promise<Json> };
			const binding = await resolveBinding("routine", undefined, undefined, "xai-auth/grok-4.7", "medium", undefined, undefined, ["--catalog", catalog]);
			assert.deepEqual([binding.provider, binding.model], ["xai-auth", "grok-4.7"]);

			await chat.session.setModel("xai-auth", "grok-4.7");
			await turn(chat, "to grok");
			const grok = sent.filter((s) => s.path.endsWith("/responses"));
			assert.deepEqual(grok.map((s) => `${s.host}${s.path}`), ["cli-chat-proxy.grok.com/v1/responses"]);
			assert.equal(grok[0]!.authorization, `Bearer ${XAI_LOGIN.access}`);
			assert.equal(grok[0]!.body.model, "grok-4.7");
			assert.deepEqual(assistantTexts(chat), ["grok answered"]);
		} finally {
			delete process.env.PI_WORKBENCH_QUOTA_CACHE;
			await chat.close();
		}
	});

	it("Grok after a restart with an expired login and an hour-old catalog: the host refreshes the login, the package's catalog is published again (grok-4.7, not the 4.6 fallback)", async () => {
		const REFRESHED = "fake-xai-refreshed";
		const json = (body: Json) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
		let refreshes = 0;
		const { chat, sent } = await packagedChat({
			login: { ...XAI_LOGIN, expires: Date.now() - HOUR, tokenEndpoint: "https://auth.x.ai/oauth2/token" },
			cacheAge: HOUR,
			answer: (url, request) => {
				if (url.href === "https://auth.x.ai/oauth2/token") return (refreshes++, json({ access_token: REFRESHED, refresh_token: "fake-xai-refresh-2", expires_in: 3600, token_type: "Bearer" }));
				// The entitled catalog, for the refreshed login only.
				if (url.href === "https://cli-chat-proxy.grok.com/v1/models-v2")
					return request.headers.get("authorization") === `Bearer ${REFRESHED}` ? json({ data: [{ model: "grok-4.7", name: "Grok 4.7", apiBackend: "responses", contextWindow: 256000 }] }) : new Response("{}", { status: 401 });
				return undefined;
			},
		});
		try {
			assert.equal(refreshes, 1, "the expired login was refreshed once, by the host");
			const available = (await chat.host.models.getAvailable()).map((m) => `${m.provider}/${m.id}`);
			assert.ok(available.includes("xai-auth/grok-4.7"), `xai-auth/grok-4.7 available: ${available.filter((id) => id.startsWith("xai")).join(",")}`);
			await chat.session.setModel("xai-auth", "grok-4.7");
			await turn(chat, "to grok");
			const grok = sent.filter((s) => s.path.endsWith("/responses"));
			assert.equal(grok[0]!.authorization, `Bearer ${REFRESHED}`);
			assert.deepEqual(assistantTexts(chat), ["grok answered"]);
		} finally {
			await chat.close();
		}
	});

	it("Ember: meta/muse-ember-1.0 goes out through pi-meta-oauth's client, tools under Meta's aliases (bash as execute_command), calls restored to Pi's names", async () => {
		const { chat, sent } = await packagedChat();
		try {
			await chat.session.setModel("meta", "muse-ember-1.0");
			await turn(chat, "to ember");
			const meta = sent.filter((s) => s.host === "api.meta.ai");
			assert.deepEqual(meta.map((s) => s.path), ["/v1/responses", "/v1/responses"], "the tool call, then the answer");
			assert.equal(meta[0]!.authorization, `Bearer ${LOGINS.meta.access}`);
			const names = (meta[0]!.body.tools as { name: string }[]).map((t) => t.name);
			assert.ok(names.includes("execute_command") && !names.includes("bash"), `bash goes out under Meta's alias: ${names.join(",")}`);
			// Meta answers 403 client_attestation_denied to a Muse Code key while either of these names is offered (live, 18 Nov).
			assert.ok(names.includes("delegate_collect") && names.includes("delegate_status") && !names.some((n) => n === "subagent_collect" || n === "subagent_status"), `subagent_collect and subagent_status go out aliased: ${names.join(",")}`);
			const call = (chat.session.messages() as { role: string; content: { type: string; name?: string }[] }[]).flatMap((m) => (m.role === "assistant" ? m.content : [])).find((c) => c.type === "toolCall");
			assert.equal(call?.name, "bash", "the aliased call comes back as bash");
			assert.ok(JSON.stringify(meta[1]!.body).includes("ember-tool"), "bash ran and its output went back");
			assert.deepEqual(assistantTexts(chat).at(-1), "ember answered");
		} finally {
			await chat.close();
		}
	});
});
