// Claude subscription access on Durable through public seams only: pi-ai 1.4.0's own Anthropic OAuth path (Claude
// Code identity headers and system block for sk-ant-oat tokens), plus the pi-claude-code-use 2.2.1 payload rules
// re-expressed at pi-ai's `onPayload` hook — flat custom tool names go out as mcp__ aliases and come back canonical
// before Durable executes or stores them. Credentials are read from Pi's auth.json and never refreshed here: a second
// process refreshing would race the installed Pi (production must share Pi's locked credential store).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

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
	const back = new Map<string, string>(); // alias (lowercase) → flat name, or itself for pass-through names
	const toWire = (name: string) => {
		const known = wire.get(name);
		if (known !== undefined) return known;
		// Pi's reserved deferred-tool placeholder stays as is: it anchors the transport's cache prefix (as in 2.2.1).
		if (CORE.has(name.toLowerCase()) || name.startsWith("mcp__") || name === "__pi_deferred_placeholder__") {
			const owner = back.get(name.toLowerCase());
			// A tool registered under a name already handed out as an alias cannot be renamed: fail the request.
			if (owner !== undefined && owner !== name) throw new Error(`Tool name ${name} collides with the alias of ${owner}`);
			back.set(name.toLowerCase(), name);
			return name;
		}
		const base = `mcp__${server}__${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
		let alias = base.slice(0, MAX);
		for (let n = 2; back.has(alias.toLowerCase()); n++) alias = `${base.slice(0, MAX - `_${n}`.length)}_${n}`;
		wire.set(name, alias);
		back.set(alias.toLowerCase(), name);
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
		if (Array.isArray(out.tools)) out.tools = out.tools.map((t) => (isObject(t) && typeof t.name === "string" && t.type === undefined ? { ...t, name: aliases.toWire(t.name) } : t));
		if (isObject(out.tool_choice) && typeof out.tool_choice.name === "string") out.tool_choice = { ...out.tool_choice, name: aliases.toWire(out.tool_choice.name) };
		if (Array.isArray(out.messages))
			out.messages = out.messages.map((m) =>
				isObject(m) && Array.isArray(m.content)
					? { ...m, content: m.content.map((b) => (isObject(b) && b.type === "tool_use" && typeof b.name === "string" ? { ...b, name: aliases.toWire(b.name) } : b)) }
					: m,
			);
		return out;
	};
}

/**
 * Read-only view of Pi's auth.json. `modify` (the refresh path) refuses: the pilot must never rotate the owner's
 * refresh token behind the installed Pi's back.
 */
export class PiAuthReadOnly implements CredentialStore {
	readonly refreshAttempts: string[] = [];
	readonly #path: string;
	constructor(path = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json")) {
		this.#path = path;
	}
	#all(): Record<string, Credential> {
		return JSON.parse(readFileSync(this.#path, "utf8")) as Record<string, Credential>;
	}
	async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
		return this.#all()[providerId];
	}
	async list(): Promise<readonly CredentialInfo[]> {
		return Object.entries(this.#all()).map(([providerId, c]) => ({ providerId, type: c.type }));
	}
	async modify(providerId: string): Promise<Credential | undefined> {
		this.refreshAttempts.push(providerId);
		throw new Error(`Pilot refuses to refresh ${providerId} credentials; refresh with the installed Pi`);
	}
	async delete(): Promise<void> {
		throw new Error("Pilot never deletes credentials");
	}
}
