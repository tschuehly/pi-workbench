// MCP servers in a Durable Chat: the host itself connects the servers Pi's MCP extension would (global
// `<agent dir>/mcp.json`, plus `<project>/.pi/mcp.json` only when PI WEB says the project is trusted, with Pi's
// override rules), and registers their tools as Durable tools named `mcp__<server>__<tool>`:
// - input schemas are validated before registration (an object schema, or the tool is refused), and Durable validates
//   every call against it;
// - every tool is replay-unsafe, so an interrupted call is held for the owner's recorded resolution, except calls
//   listed in REVIEWED_READ_ONLY (reviewed in code, never the server's own `readOnlyHint`);
// - results pass the redacting tool wrapper and carry their provenance (server, tool, config file) in `details`;
// - what Durable Chats do not support yet is blocked visibly per server: OAuth or `/login` provider sign-in, shell
//   command config values, and the `codemode`/`deferred` exposures (codemode and tool_search are deferred).
// Credentials stay in this process: only names, states and schema hashes are committed.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { McpAuthRequiredError, McpClient, StdioTransport, StreamableHttpTransport, type Tool as McpTool, toLlmContent } from "@earendil-works/pi-mcp";
import { defineDoc, defineExtension, type Harness, type Registry, type ToolRegistration } from "@earendil-works/pi-durable";
import { context } from "./host.ts";
import { redactingTool } from "./redact.ts";

/** `server/tool` calls reviewed as read-only and idempotent, so an interrupted call may rerun. */
export const REVIEWED_READ_ONLY: readonly string[] = [];

type ServerConfig = {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	type?: string;
	headers?: Record<string, string>;
	auth?: unknown;
	oauth?: unknown;
	enabled?: boolean;
	exposure?: string;
	toolExposure?: Record<string, string>;
	timeout?: number;
};
type Entry = { name: string; config: ServerConfig; source: string };

export type ServerState = {
	name: string;
	source: string;
	state: "connected" | "failed" | "blocked" | "disabled";
	reason?: string;
	tools: { name: string; tool: string; replay: "safe" | "unsafe"; schemaSha256: string }[];
	refused: { tool: string; reason: string }[];
};

/** What the Chat committed about its MCP servers: provenance and state, never config values. */
export const McpDoc = defineDoc<{ servers: ServerState[]; errors: string[] }>({
	kind: "workbench.mcp",
	version: 1,
	scope: "session",
	initial: () => ({ servers: [], errors: [] }),
	checkpointWhen: () => false,
});

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isOverride = (value: Record<string, unknown>) => value.command === undefined && value.url === undefined && value.type === undefined;

/** Pi's `loadMcpConfig` (extensions/mcp/config.js), which the package does not export. */
export function loadMcpConfig(options: { agentDir: string; cwd: string; projectTrusted: boolean }): { servers: Entry[]; errors: string[] } {
	const servers = new Map<string, Entry>();
	const errors: string[] = [];
	const read = (path: string, scope: "global" | "project") => {
		if (!existsSync(path)) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
			errors.push(`${path}: expected an object with an "mcpServers" object`);
			return;
		}
		for (const [name, value] of Object.entries((parsed.mcpServers ?? {}) as Record<string, unknown>)) {
			if (!SERVER_NAME.test(name) || !isRecord(value)) {
				errors.push(`${path}: invalid server "${name}"`);
				continue;
			}
			if (scope === "project" && isOverride(value)) {
				const base = servers.get(name);
				if (base === undefined || Object.keys(value).some((key) => !OVERRIDE_KEYS.includes(key))) errors.push(`${path}: server "${name}" is not a valid override`);
				else servers.set(name, { ...base, config: { ...base.config, ...value } });
				continue;
			}
			if (typeof value.command !== "string" && typeof value.url !== "string") {
				errors.push(`${path}: server "${name}" needs "command" or "url"`);
				continue;
			}
			if (scope === "project" && value.auth !== undefined) {
				errors.push(`${path}: server "${name}": auth is only allowed in the global mcp.json`);
				continue;
			}
			servers.set(name, { name, config: value as ServerConfig, source: path });
		}
	};
	read(join(options.agentDir, "mcp.json"), "global");
	if (options.projectTrusted) read(join(options.cwd, ".pi", "mcp.json"), "project");
	return { servers: [...servers.values()], errors };
}

class Blocked extends Error {}

/** `${VAR}` templates from the environment, as Pi resolves them; shell-command values are not supported here. */
function resolveValue(value: string, what: string): string {
	if (value.startsWith("!")) throw new Blocked(`${what} is a shell command, which Durable Chats do not run yet`);
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
		const resolved = process.env[name];
		if (resolved === undefined) throw new Error(`Failed to resolve ${what} from environment variable: ${name}`);
		return resolved;
	});
}

const expandHome = (value: string) => (value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value);

/** Pi's `createMcpToolName`: sanitized, at most 64 characters with a hash suffix. */
export function mcpToolName(server: string, tool: string, taken: (name: string) => boolean = () => false): string {
	const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
	if (name.length <= 64 && !taken(name)) return name;
	const hash = createHash("sha256").update(`${server}\0${tool}`).digest("hex").slice(0, 8);
	return `${name.slice(0, 64 - hash.length - 1)}_${hash}`;
}

const exposureOf = (config: ServerConfig, tool: string) => config.toolExposure?.[tool] ?? config.exposure ?? "codemode";

/** An input schema a tool may be registered with: a JSON object schema. */
function schemaProblem(schema: unknown): string | undefined {
	if (!isRecord(schema)) return "its input schema is not an object";
	if (schema.type !== "object") return `its input schema has type ${JSON.stringify(schema.type)}, not "object"`;
	if (schema.properties !== undefined && !isRecord(schema.properties)) return "its input schema's properties are not an object";
	return undefined;
}

export type McpConnection = { readonly states: readonly ServerState[]; readonly errors: readonly string[]; close(): Promise<void> };

/**
 * Connect every enabled server, register the tools that pass, and commit their provenance. Servers that need what
 * Durable Chats lack are recorded as blocked with the reason.
 */
export async function connectMcp(options: {
	harness: Harness;
	registry: Registry;
	agentDir: string;
	cwd: string;
	projectTrusted: boolean;
	reviewed?: readonly string[];
	timeoutMs?: number;
}): Promise<McpConnection> {
	const { servers, errors } = loadMcpConfig(options);
	const reviewed = new Set(options.reviewed ?? REVIEWED_READ_ONLY);
	const clients: McpClient[] = [];
	const tools: ToolRegistration[] = [];
	const states: ServerState[] = [];
	const taken = new Set<string>();
	for (const { name, config, source } of servers) {
		const state: ServerState = { name, source, state: "connected", tools: [], refused: [] };
		states.push(state);
		const block = (reason: string) => Object.assign(state, { state: "blocked", reason });
		if (config.enabled === false) {
			state.state = "disabled";
			continue;
		}
		if (config.auth !== undefined || config.oauth !== undefined) {
			block("it signs in with OAuth or a /login provider, which Durable Chats do not support yet; use a legacy Chat");
			continue;
		}
		const client = new McpClient({ name: "pi-workbench-durable", version: "1.0.0", requestTimeoutMs: options.timeoutMs ?? (config.timeout ?? 10) * 1000 });
		try {
			const transport = config.url !== undefined
				? new StreamableHttpTransport({ url: config.url, headers: Object.fromEntries(Object.entries(config.headers ?? {}).map(([key, value]) => [key, resolveValue(value, `header "${key}"`)])) })
				: new StdioTransport({
						command: expandHome(config.command!),
						args: (config.args ?? []).map(expandHome),
						cwd: resolve(options.cwd, expandHome(config.cwd ?? ".")),
						env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, resolveValue(value, `env "${key}"`)])),
						stderr: "pipe",
					});
			await client.connect(transport);
			clients.push(client);
			for (const tool of await client.listTools()) {
				const exposure = exposureOf(config, tool.name);
				if (exposure === "hidden") continue;
				if (exposure !== "direct") {
					state.refused.push({ tool: tool.name, reason: `exposure "${exposure}" needs ${exposure === "codemode" ? "codemode" : "tool_search"}, which Durable Chats do not have yet; set "exposure": "direct" to use it here` });
					continue;
				}
				const problem = schemaProblem(tool.inputSchema);
				if (problem !== undefined) {
					state.refused.push({ tool: tool.name, reason: problem });
					continue;
				}
				const registered = mcpToolName(name, tool.name, (candidate) => taken.has(candidate));
				taken.add(registered);
				const replay = reviewed.has(`${name}/${tool.name}`) ? "safe" : "unsafe";
				state.tools.push({ name: registered, tool: tool.name, replay, schemaSha256: createHash("sha256").update(JSON.stringify(tool.inputSchema)).digest("hex") });
				tools.push(redactingTool(mcpTool(client, { server: name, source, registered, replay }, tool)));
			}
		} catch (error) {
			await client.close().catch(() => {});
			if (error instanceof McpAuthRequiredError) block("it requires sign-in (OAuth), which Durable Chats do not support yet; use a legacy Chat");
			else if (error instanceof Blocked) block(error.message);
			else Object.assign(state, { state: "failed", reason: error instanceof Error ? error.message : String(error) });
		}
	}
	if (tools.length > 0) options.registry.install(defineExtension({ name: "workbench.mcp", tools }));
	const committed = JSON.parse(JSON.stringify({ servers: states, errors })) as { servers: ServerState[]; errors: string[] };
	await options.harness.commit(async (tx) => Object.assign(await tx.doc(McpDoc), committed), context);
	return { states, errors, close: async () => void (await Promise.all(clients.map((client) => client.close().catch(() => {})))) };
}

function mcpTool(client: McpClient, provenance: { server: string; source: string; registered: string; replay: "safe" | "unsafe" }, tool: McpTool): ToolRegistration {
	return {
		name: provenance.registered,
		description: tool.description ?? `${tool.name} from MCP server ${provenance.server}`,
		// Validated above as an object schema; Durable validates each call's arguments against it.
		parameters: tool.inputSchema as unknown as ToolRegistration["parameters"],
		replay: provenance.replay,
		execute: async (args, _api, c) => {
			// ponytail: an interrupted transport is not proof of a failed call; the unsafe default holds it for the owner.
			const result = await client.callTool(tool.name, args as Record<string, unknown>, { ...(c.abortSignal === undefined ? {} : { signal: c.abortSignal }) });
			return {
				output: toLlmContent(result),
				isError: result.isError === true,
				details: { mcp: { server: provenance.server, tool: tool.name, source: provenance.source } },
			};
		},
	};
}

/** Status lines for servers or tools the Chat could not use, so nothing is missing silently. */
export function mcpWarnings(states: readonly ServerState[], errors: readonly string[]): string[] {
	return [
		...errors.map((error) => `MCP config: ${error}`),
		...states.flatMap((server) => [
			...(server.state === "blocked" || server.state === "failed" ? [`MCP server "${server.name}" is unavailable: ${server.reason}`] : []),
			...server.refused.map((refused) => `MCP tool ${server.name}/${refused.tool} is unavailable: ${refused.reason}`),
		]),
	];
}
