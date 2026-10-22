// One process racing to use an expired Claude or ChatGPT login: a pilot host (Durable turn through PiAuthStore) or a stand-in
// for the installed Pi (its own AuthStorage). Every network call is intercepted: the OAuth token URL goes to the test's
// fake endpoint, anything else is refused and recorded. Tokens never leave as text, only as sha256 prefixes.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createModels, type Credential, type CredentialStore } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { PiAuthStore } from "../src/claude.ts";
import { context } from "../src/host.ts";
import { wrapProvider } from "../src/redact.ts";
import { openStore } from "../src/store.ts";

const [kind, authPath, endpoint, piAuthStorage, dir, provider = "anthropic"] = process.argv.slice(2) as [string, string, string, string, string, string?];
const TOKEN_URL = provider === "anthropic" ? "https://platform.claude.com/v1/oauth/token" : "https://auth.openai.com/oauth/token";
// Codex prefers a WebSocket; without one it takes the (intercepted) SSE fetch.
if (provider === "openai-codex") (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const send = (message: object) => new Promise<void>((resolve) => process.send!(message, () => resolve()));

const blocked: { host: string; authorization?: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const url = input instanceof Request ? input.url : String(input);
	if (url === TOKEN_URL) return realFetch(endpoint, init);
	const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
	const authorization = headers.get("authorization") ?? headers.get("x-api-key");
	blocked.push({ host: new URL(url).host, ...(authorization === null ? {} : { authorization: hash(authorization.replace(/^Bearer /, "")) }) });
	throw new Error("network blocked by test");
}) as typeof fetch;

/** Control only: the same store without the lock, to show the race is real. */
class UnlockedStore implements CredentialStore {
	#all = () => JSON.parse(readFileSync(authPath, "utf8")) as Record<string, Credential>;
	async read(id: string) {
		return this.#all()[id];
	}
	async list() {
		return Object.entries(this.#all()).map(([providerId, c]) => ({ providerId, type: c.type }));
	}
	async modify(id: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
		const all = this.#all();
		const next = await fn(all[id]);
		if (next !== undefined) writeFileSync(authPath, JSON.stringify({ ...all, [id]: next }, null, 2));
		return next ?? all[id];
	}
	async delete() {}
}

const credentials: CredentialStore =
	kind === "pi" ? (await import(piAuthStorage)).AuthStorage.create(authPath) : kind === "unlocked" ? new UnlockedStore() : new PiAuthStore(authPath);
const models = createModels({ credentials });
models.setProvider(wrapProvider(provider === "anthropic" ? anthropicProvider() : openaiCodexProvider()));

await send({ type: "ready" });
await new Promise((resolve) => process.once("message", resolve));
const evidence: Record<string, unknown> = { kind };
try {
	if (kind !== "host") {
		evidence.auth = (await models.getAuth(provider)) === undefined ? "none" : "resolved";
	} else {
		// A real Durable turn: auth resolves (refreshing if needed) before the blocked Messages request.
		const store = await openStore(join(dir, "session.sqlite"));
		const harness = await Harness.open(store.storage, { models, registry: createRegistry(), settings: { retry: { enabled: false } } }, context);
		const root = await harness.root(context, { agent: { model: provider === "anthropic" ? { provider, modelId: "claude-haiku-5-5" } : { provider, modelId: "gpt-6-luna" } } });
		const settled = await (await root.submit({ type: "input", content: "hi" }, context)).wait(context);
		evidence.settled = settled.status;
		await harness.close(context);
	}
	const after = await credentials.read(provider);
	evidence.access = after?.type === "oauth" ? hash(after.access) : null;
	evidence.expiresInFuture = after?.type === "oauth" && after.expires > Date.now();
} catch (error) {
	evidence.error = error instanceof Error ? error.name : "unknown";
}
evidence.blocked = blocked;
await send({ type: "result", evidence });
process.exit(0);
