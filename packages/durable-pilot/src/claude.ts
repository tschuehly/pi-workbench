// Claude subscription access on Durable through public seams only: pi-ai 1.4.0's own Anthropic OAuth path (Claude
// Code identity headers and system block for sk-ant-oat tokens), plus the pi-claude-code-use 2.2.1 payload rules
// re-expressed at pi-ai's `onPayload` hook — flat custom tool names go out as mcp__ aliases and come back canonical
// before Durable executes or stores them. Credentials live in Pi's auth.json and are refreshed under Pi's own file lock,
// so this host, other hosts and the installed Pi refresh an expired login exactly once.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";

/** pi-claude-code-use 2.2.1 CORE_TOOL_NAMES: Claude Code's own tools pass through, never aliased. */
const CORE = new Set(
	["Read", "Write", "Edit", "Bash", "Grep", "Glob", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "KillShell", "NotebookEdit", "Skill", "Task", "TaskOutput", "TodoWrite", "WebFetch", "WebSearch"].map((n) => n.toLowerCase()),
);
const MAX = 128;

export type Aliases = { readonly toWire: (name: string) => string; readonly toCanonical: (name: string) => string };

/**
 * `mcp__<server>__<tool>` aliases for flat custom tools (the package derives <server> from provenance). Sanitizing can
 * make two names collide (`a-b`, `a_b`, case, truncation); as in 2.2.1 `reserveAliasName`, a later name gets a `_2`,
 * `_3`… suffix, so every alias maps back to exactly one tool. Assignments are stable for the life of this object.
 */
export function claudeAliases(server = "pilot"): Aliases {
	const wire = new Map<string, string>(); // flat name → alias
	const back = new Map<string, string>(); // alias (lowercase) → flat name
	const taken = new Set<string>(); // every wire name handed out (lowercase), aliases and pass-through names
	const toWire = (name: string) => {
		const known = wire.get(name);
		if (known !== undefined) return known;
		// Pi's reserved deferred-tool placeholder stays as is: it anchors the transport's cache prefix (as in 2.2.1).
		if (CORE.has(name.toLowerCase()) || name.startsWith("mcp__") || name === "__pi_deferred_placeholder__") {
			const owner = back.get(name.toLowerCase());
			// A tool registered under a name already handed out as an alias cannot be renamed: fail the request.
			if (owner !== undefined) throw new Error(`Tool name ${name} collides with the alias of ${owner}`);
			// Pass-through names map back to themselves: pi-ai re-cases core tools (bash ⇄ Bash) on its own side.
			taken.add(name.toLowerCase());
			return name;
		}
		const base = `mcp__${server}__${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
		let alias = base.slice(0, MAX);
		for (let n = 2; taken.has(alias.toLowerCase()); n++) alias = `${base.slice(0, MAX - `_${n}`.length)}_${n}`;
		wire.set(name, alias);
		back.set(alias.toLowerCase(), name);
		taken.add(alias.toLowerCase());
		return alias;
	};
	return { toWire, toCanonical: (name) => back.get(name.toLowerCase()) ?? name };
}

const rewritePrompt = (text: string) =>
	text.replaceAll("pi itself", "the cli itself").replaceAll("pi .md files", "cli .md files").replaceAll("pi packages", "cli packages");

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The outbound Anthropic Messages payload, rewritten as pi-claude-code-use does for OAuth requests. */
export function claudePayload(aliases: Aliases): (payload: unknown) => unknown {
	return (payload) => {
		if (!isObject(payload)) return payload;
		const out: Json = { ...payload };
		if (typeof out.system === "string") out.system = rewritePrompt(out.system);
		else if (Array.isArray(out.system))
			out.system = out.system.map((b) => (isObject(b) && b.type === "text" && typeof b.text === "string" ? { ...b, text: rewritePrompt(b.text) } : b));
		// A custom tool definition (no server-tool `type`): the initial list and mid-conversation `tool_addition`s alike.
		const definition = (t: unknown) => (isObject(t) && typeof t.name === "string" && t.type === undefined ? { ...t, name: aliases.toWire(t.name) } : t);
		const block = (b: unknown) => {
			if (!isObject(b)) return b;
			if (b.type === "tool_use" && typeof b.name === "string") return { ...b, name: aliases.toWire(b.name) };
			// Native tool changes (pi-ai's mid-conversation system messages) name the same tools: same aliases.
			if (b.type === "tool_addition" && isObject(b.tool) && isObject(b.tool.definition)) return { ...b, tool: { ...b.tool, definition: definition(b.tool.definition) } };
			if (b.type === "tool_removal" && isObject(b.tool) && typeof b.tool.name === "string") return { ...b, tool: { ...b.tool, name: aliases.toWire(b.tool.name) } };
			return b;
		};
		if (Array.isArray(out.tools)) out.tools = out.tools.map(definition);
		if (isObject(out.tool_choice) && typeof out.tool_choice.name === "string") out.tool_choice = { ...out.tool_choice, name: aliases.toWire(out.tool_choice.name) };
		if (Array.isArray(out.messages)) out.messages = out.messages.map((m) => (isObject(m) && Array.isArray(m.content) ? { ...m, content: m.content.map(block) } : m));
		return out;
	};
}

/**
 * Pi's auth.json through the installed Pi's own lock protocol (pi-coding-agent 1.0.4 `FileAuthStorageBackend`
 * .withLockAsync, ported exactly): proper-lockfile 4.1.2 on the file itself (`realpath: false`, `stale: 30s`,
 * `retries: 0`, own jittered backoff until the stale deadline), read, change and write back in place under the lock,
 * mode 0600 on creation. pi-ai re-checks expiry inside `modify`, so racing hosts and Pi refresh only once. Tokens stay
 * in auth.json; nothing is cached or copied elsewhere.
 */
export class PiAuthStore implements CredentialStore {
	readonly #path: string;
	constructor(path = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json")) {
		this.#path = path;
	}

	async #withLock<T>(fn: (current: Record<string, Credential>) => Promise<{ result: T; next?: Record<string, Credential> }>, options?: AuthOperationOptions): Promise<T> {
		const signal = options?.signal;
		signal?.throwIfAborted();
		if (!existsSync(dirname(this.#path))) mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
		if (!existsSync(this.#path)) writeFileSync(this.#path, "{}", WRITE);
		let compromised: Error | undefined;
		const release = await acquire(this.#path, signal, (error) => (compromised = error));
		const check = () => {
			if (compromised !== undefined) throw compromised;
			signal?.throwIfAborted();
		};
		try {
			check();
			const text = readFileSync(this.#path, "utf8");
			const { result, next } = await fn(text === "" ? {} : (JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, Credential>));
			check();
			if (next !== undefined) writeFileSync(this.#path, JSON.stringify(next, null, 2), WRITE);
			check();
			return result;
		} finally {
			await release().catch(() => {}); // as Pi: ignore unlock errors of a compromised lock
		}
	}

	read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		return this.#withLock(async (all) => ({ result: all[providerId] }), options);
	}
	list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		return this.#withLock(async (all) => ({ result: Object.entries(all).map(([providerId, c]) => ({ providerId, type: c.type })) }), options);
	}
	modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions): Promise<Credential | undefined> {
		return this.#withLock(async (all) => {
			const next = await fn(all[providerId]);
			return next === undefined ? { result: all[providerId] } : { result: next, next: { ...all, [providerId]: next } };
		}, options);
	}
	async delete(): Promise<void> {
		throw new Error("Pilot never deletes credentials");
	}
}

// The mode applies only on creation, as in Pi, so administrator-managed modes and ACLs stay intact.
const WRITE = { encoding: "utf8", mode: 0o600 } as const;

/** Pi's `acquireLockAsync`: proper-lockfile with no internal retries, jittered exponential backoff up to the stale time. */
async function acquire(path: string, signal: AbortSignal | undefined, onCompromised: (error: Error) => void): Promise<() => Promise<void>> {
	const staleMs = 30_000;
	const deadline = Date.now() + staleMs;
	for (let retry = 0; ; retry++) {
		signal?.throwIfAborted();
		try {
			const release = await lockfile.lock(path, { realpath: false, retries: 0, stale: staleMs, onCompromised });
			if (signal?.aborted) {
				await release();
				signal.throwIfAborted();
			}
			return release;
		} catch (error) {
			signal?.throwIfAborted();
			const remainingMs = deadline - Date.now();
			if ((error as { code?: string }).code !== "ELOCKED" || remainingMs <= 0) throw error;
			const base = Math.min(10 * 2 ** retry, 1_000);
			await sleep(Math.min(Math.round(base * (1 + Math.random())), remainingMs), undefined, signal === undefined ? {} : { signal });
		}
	}
}
