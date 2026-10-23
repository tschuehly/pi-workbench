// Installed Pi packages in a Durable Chat: the packages' own Pi extension code, loaded with Pi's loader, with the
// ExtensionAPI bound to this host instead of a Pi AgentSession. Bound packages (pi-web-access, ping-a-human-pi,
// pi-process-monitor) keep their tools, commands and session hooks; every other package contributes only the skills and
// prompts PI WEB loads. The binding:
// - tools become Durable tools behind the redaction wrapper, with a pinned replay policy (unlisted tools are unsafe:
//   never rerun after a crash, held for the owner); tools a package keeps inactive are deferred until a tool such as
//   `web_enable` activates them (`setActiveTools` during a call becomes `control.addTools`);
// - `appendEntry` and `sendMessage` commit to the Chat (redacted first): entries as passive writes, messages as inputs
//   (a turn when asked for one) or as context for the next turn, shown as PI WEB custom messages;
// - commands run here; `ui.notify` reaches PI WEB as command output, dialogs are refused visibly;
// - `session_start` (with the package's own entries as its branch), `session_tree` (with the new branch's),
//   `before_agent_start`, `agent_settled` and `session_shutdown` reach the packages' handlers; their return values are not applied.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "@earendil-works/chord";
import { type Conversation, type Cursor, defineExtension, type ToolRegistration } from "@earendil-works/pi-durable";
import { context } from "./host.ts";
import { redact, redactingTool, sanitizeDeep } from "./redact.ts";

/** Packages whose extension code runs in a Durable Chat; identified by their package.json name. */
export const BOUND_PACKAGES = ["pi-web-access", "ping-a-human-pi", "pi-process-monitor"];

/**
 * Tools whose interrupted call may rerun after a crash: no external effect beyond reading (a rerun repeats a search or
 * fetch, or reads stored results or watcher state). Every other package tool, ask_human and notify_human included, is
 * unsafe: a kill after it started never sends it again.
 */
export const SAFE_TOOLS = new Set(["web_enable", "web_search", "fetch_content", "get_search_content", "source_check", "monitor_status", "monitor_inspect"]);

/** Bound package commands without a PI WEB surface in Durable Chats, refused with their reason. */
export const BLOCKED_COMMANDS: Record<string, string> = {
	"google-account": "/google-account reads browser cookies for Gemini Web; deferred for Durable Chats.",
};

/** A package's `appendEntry`: `{ customType, data }`, never shown or sent to the model. */
export const PACKAGE_ENTRY = "workbench.package-entry";
/** A package's `sendMessage`: the model sees the content; PI WEB shows it as a custom message when `display`. */
export const PACKAGE_MESSAGE_ENTRY = "workbench.package-message";

export class DialogUnavailable extends Error {
	constructor() {
		super("Extension dialogs are not available in Durable Chats yet");
		this.name = "DialogUnavailable";
	}
}

/**
 * Host events the binding emits: PI WEB's `command.output` and `session.diagnostic`, and `durable.notification`, which
 * PI WEB keeps in the Chat's notification inbox.
 */
export type PackageEvent =
	| { type: "command.output"; level: "info" | "error"; message: string }
	| { type: "session.diagnostic"; message: string }
	| { type: "durable.notification"; severity: "warning" | "error"; message: string };

// The structural part of Pi's extension types this binding uses (pi-coding-agent `core/extensions/types.ts`).
type Content = { type: string; text?: string; [key: string]: unknown }[];
type PiToolResult = { content: Content; details?: unknown; isError?: boolean };
type PiTool = {
	name: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: ToolRegistration["parameters"];
	prepareArguments?: (args: unknown) => unknown;
	execute(callId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: (partial: { details?: unknown }) => void, ctx: unknown): Promise<PiToolResult>;
};
type PiCommand = { name: string; description?: string; handler(args: string, ctx: unknown): Promise<void> | void };
type PiExtension = { path: string; handlers: Map<string, ((event: unknown, ctx: unknown) => unknown)[]>; tools: Map<string, { definition: PiTool }>; commands: Map<string, PiCommand> };
type PiMessage = { customType: string; content: string | Content; display?: boolean; details?: unknown };
type Branch = { type: "custom"; id: string; parentId: string | null; timestamp: string; customType: string; data: unknown }[];

/** The Chat a binding commits to and the model its packages see. */
export type PackageHost = { readonly root: Conversation; readonly registry: { install(extension: ReturnType<typeof defineExtension>): void }; model(): Promise<Record<string, unknown> | undefined> };

const json = (value: unknown): JsonValue => (value === undefined ? null : (JSON.parse(JSON.stringify(value)) as JsonValue));
const textOf = (content: string | Content): string => (typeof content === "string" ? content : content.map((part) => part.text ?? "").join("\n"));
/** Pi's theme, as plain text: every styling call returns its text. */
const plainTheme = new Proxy({}, { get: () => (...args: unknown[]) => args.at(-1) });

export type PackageOptions = {
	readonly cwd: string;
	/** PI WEB's Chat ID: the session ID packages key their state by (watcher leases). */
	readonly chatId: string;
	/** Pi's agent directory: settings.json packages and installed npm/git packages. */
	readonly agentDir: string;
	/** An empty directory of this host: Pi's loader discovers nothing in it. */
	readonly scratch: string;
	readonly emit: (event: PackageEvent) => void;
};

export class PiPackages {
	readonly #options: PackageOptions;
	readonly #extensions: PiExtension[];
	/** Tools the packages keep active; the rest are deferred. */
	#active: Set<string>;
	#host: PackageHost | undefined;
	#branch: Branch = [];
	#idle = true;
	#model: Record<string, unknown> | undefined;
	/** Commits in call order; a failure is reported, never thrown into the package. */
	#queue: Promise<void> = Promise.resolve();
	readonly #calls = new AsyncLocalStorage<{ offered: Set<string>; added: string[] }>();

	private constructor(options: PackageOptions, extensions: PiExtension[]) {
		this.#options = options;
		this.#extensions = extensions;
		this.#active = new Set(this.#tools().map((tool) => tool.name));
	}

	/** Resolve the user's settings packages with Pi's package manager (never installing) and load the bound ones. */
	static async load(options: PackageOptions): Promise<PiPackages> {
		const pi = await import("@earendil-works/pi-coding-agent");
		const settingsManager = pi.SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: false });
		const manager = new pi.DefaultPackageManager({ cwd: options.cwd, agentDir: options.agentDir, settingsManager });
		const resolved = await manager.resolve(async () => "skip");
		const paths = resolved.extensions
			.filter((resource) => resource.enabled && resource.metadata.scope === "user" && BOUND_PACKAGES.includes(packageName(resource.metadata.packageRoot) ?? ""))
			.map((resource) => resource.path);
		mkdirSync(options.scratch, { recursive: true, mode: 0o700 });
		// The scratch directory as cwd and agent dir: only the given paths load, no project or global extensions.
		const loaded = await pi.discoverAndLoadExtensions(paths, options.scratch, options.scratch);
		for (const failure of loaded.errors) options.emit({ type: "session.diagnostic", message: `Package extension ${failure.path} failed to load: ${redact(failure.error)}` });
		const packages = new PiPackages(options, loaded.extensions as unknown as PiExtension[]);
		packages.#bind(loaded.runtime as unknown as Record<string, unknown>);
		return packages;
	}

	#tools(): PiTool[] {
		return this.#extensions.flatMap((extension) => [...extension.tools.values()].map((tool) => tool.definition));
	}

	/** Pi's `bindCore` for this host: the runtime actions every loaded extension's API delegates to. */
	#bind(runtime: Record<string, unknown>): void {
		Object.assign(runtime, {
			sendMessage: (message: PiMessage, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }) => this.#commit(() => this.#send(message, options)),
			sendUserMessage: (content: string | Content, options?: { deliverAs?: "steer" | "followUp" }) =>
				this.#commit(async () => void (await this.#root().submit({ type: "input", content: sanitizeDeep(content, redact) as never, whenBusy: options?.deliverAs ?? "followUp", requestId: `package:${randomUUID()}` }, context))),
			appendEntry: (customType: string, data: unknown) => this.#commit(() => this.#append(customType, data)),
			setSessionName: () => {},
			getSessionName: () => undefined,
			setLabel: () => {},
			getActiveTools: () => {
				const call = this.#calls.getStore();
				return call === undefined ? [...this.#active] : [...new Set([...call.offered, ...call.added])];
			},
			getAllTools: () => this.#tools().map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
			getSettings: () => ({}),
			setActiveTools: (names: string[]) => {
				const call = this.#calls.getStore();
				if (call === undefined) this.#active = new Set(names);
				else call.added.push(...names.filter((name) => !call.offered.has(name)));
			},
			refreshTools: () => {},
			getCommands: () => this.commands().map((command) => ({ name: command.name, description: command.description, source: "extension" })),
			setModel: async () => false,
			getThinkingLevel: () => "off",
			setThinkingLevel: () => {},
			createContext: () => this.#context(false),
		});
	}

	#root(): Conversation {
		if (this.#host === undefined) throw new Error("Package runtime not attached to its Chat yet");
		return this.#host.root;
	}

	#commit(work: () => Promise<void>): void {
		this.#queue = this.#queue.then(work).catch((error: unknown) =>
			this.#options.emit({ type: "session.diagnostic", message: `Package action failed: ${redact(error instanceof Error ? error.message : String(error))}` }),
		);
	}

	async #append(customType: string, data: unknown): Promise<void> {
		const clean = sanitizeDeep(json(data), redact);
		const submission = await this.#root().submit({ type: "write", entry: { kind: PACKAGE_ENTRY, data: { customType, data: clean } } }, context);
		const id = String((await submission.status(context)).entry ?? submission.id);
		this.#branch.push({ type: "custom", id, parentId: this.#branch.at(-1)?.id ?? null, timestamp: new Date().toISOString(), customType, data: clean });
	}

	/** Pi's `sendMessage`: a turn when asked for one (or queued while busy), otherwise context for the next turn. */
	async #send(message: PiMessage, options: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" } = {}): Promise<void> {
		const content = sanitizeDeep(typeof message.content === "string" ? message.content : json(message.content), redact) as string | Content;
		const data = json({ customType: message.customType, display: message.display === true, ...(message.details === undefined ? {} : { details: sanitizeDeep(json(message.details), redact) }) });
		const text = textOf(content);
		if (options.triggerTurn === true || (!this.#idle && options.deliverAs !== "nextTurn")) {
			await this.#root().submit(
				{ type: "input", content: text, whenBusy: options.deliverAs === "followUp" ? "followUp" : "steer", requestId: `package:${randomUUID()}`, entry: { kind: PACKAGE_MESSAGE_ENTRY, data } },
				context,
			);
			return;
		}
		await this.#root().submit({ type: "write", entry: { kind: PACKAGE_MESSAGE_ENTRY, data, model: [{ role: "user", content: text, timestamp: Date.now() }] } }, context);
	}

	#ui(command: boolean) {
		const notify = (message: string, type?: "info" | "warning" | "error") => {
			const clean = redact(String(message));
			// As in a legacy Chat: command notices are command output; others are retained notifications, warnings and errors only.
			if (command) this.#options.emit({ type: "command.output", level: type === "error" ? "error" : "info", message: clean });
			else if (type === "warning" || type === "error") this.#options.emit({ type: "durable.notification", severity: type, message: clean });
		};
		return new Proxy({} as Record<string, unknown>, {
			get: (_target, property) => {
				if (property === "notify") return notify;
				if (property === "theme") return plainTheme;
				if (property === "select" || property === "confirm" || property === "input" || property === "editor" || property === "custom") return () => Promise.reject(new DialogUnavailable());
				// Widgets, footers, status lines and the editor are terminal surfaces: nothing to show them in.
				return () => undefined;
			},
		});
	}

	/** Pi's `ExtensionContext` for this Chat. */
	#context(command: boolean, signal?: AbortSignal): Record<string, unknown> {
		const { cwd, chatId } = this.#options;
		const branch = () => [...this.#branch];
		const unavailable = (what: string) => () => Promise.reject(new Error(`${what} is not available from a package in Durable Chats`));
		return {
			cwd,
			hasUI: true,
			mode: "rpc",
			ui: this.#ui(command),
			sessionManager: {
				getSessionId: () => chatId,
				getSessionFile: () => undefined,
				getCwd: () => cwd,
				getBranch: branch,
				getEntries: branch,
				getLeafId: () => this.#branch.at(-1)?.id ?? null,
				getSessionName: () => undefined,
			},
			modelRegistry: undefined,
			model: this.#model,
			scopedModels: [],
			signal,
			isIdle: () => this.#idle,
			isProjectTrusted: () => false,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: () => {},
			getSystemPrompt: () => "",
			...(command
				? { waitForIdle: async () => {}, newSession: unavailable("A new session"), fork: unavailable("Forking"), navigateTree: unavailable("Tree navigation"), switchSession: unavailable("Switching sessions"), reload: unavailable("Reloading") }
				: {}),
		};
	}

	/** Pi's tool definition as a Durable tool, behind redaction. */
	#tool(definition: PiTool): ToolRegistration {
		const description = [definition.description, definition.promptSnippet === definition.description ? undefined : definition.promptSnippet, ...(definition.promptGuidelines ?? [])]
			.filter((part): part is string => part !== undefined && part !== "")
			.join("\n\n");
		const tool: ToolRegistration = {
			name: definition.name,
			description,
			parameters: definition.parameters,
			replay: SAFE_TOOLS.has(definition.name) ? "safe" : "unsafe",
			...(this.#active.has(definition.name) ? {} : { deferred: true as const }),
			...(definition.prepareArguments === undefined ? {} : { prepareArguments: (args: unknown) => definition.prepareArguments!(args) as never }),
			execute: async (args, api, c) => {
				const agent = await api.agent(c);
				const call = { offered: new Set(agent.tools.map((offered) => offered.name)), added: [] as string[] };
				const update = (partial: { details?: unknown }) => {
					if (partial?.details !== undefined) void api.details(json(partial.details), c).catch(() => {});
				};
				const result = await this.#calls.run(call, () => definition.execute(api.callId, args, c.abortSignal, update, this.#context(false, c.abortSignal)));
				const added = [...new Set(call.added)];
				return {
					output: (result.content ?? []) as never,
					...(result.details === undefined ? {} : { details: json(result.details) }),
					...(result.isError === true ? { isError: true } : {}),
					...(added.length === 0 ? {} : { control: { addTools: added } }),
				};
			},
		};
		return redactingTool(tool);
	}

	/** The Durable extension with every bound package tool. */
	extension() {
		return defineExtension({ name: "workbench.pi-packages", tools: this.#tools().map((definition) => this.#tool(definition)) });
	}

	/**
	 * Attach to the opened Chat: the package entries as each package's branch, `session_start`, then the tools again
	 * with the activation the packages chose.
	 */
	async start(host: PackageHost): Promise<void> {
		this.#host = host;
		this.#model = await host.model();
		await this.#readBranch();
		await this.emit("session_start", { type: "session_start", reason: "startup" });
		host.registry.install(this.extension());
	}

	/** The package entries of the Chat's active branch, as each package's branch. */
	async #readBranch(): Promise<void> {
		this.#branch = [];
		let cursor: Cursor | undefined;
		do {
			const page = await this.#root().entries({ order: "ascending" }, 200, cursor, context);
			for (const entry of page.items) {
				if (entry.kind !== PACKAGE_ENTRY) continue;
				const data = entry.data as { customType: string; data: unknown };
				this.#branch.push({ type: "custom", id: String(entry.id), parentId: this.#branch.at(-1)?.id ?? null, timestamp: new Date().toISOString(), customType: data.customType, data: data.data });
			}
			cursor = page.next;
		} while (cursor !== undefined);
	}

	/** History navigation selected another branch: the packages read its entries and get `session_tree`, as in Pi. */
	async tree(oldLeafId: string | null, newLeafId: string | null): Promise<void> {
		await this.#readBranch();
		await this.emit("session_tree", { type: "session_tree", oldLeafId, newLeafId });
	}

	/** Run boundaries from the Chat: `before_agent_start` when a run starts, `agent_settled` when it ends. */
	async run(phase: "start" | "end"): Promise<void> {
		this.#idle = phase === "end";
		if (phase === "start") this.#model = (await this.#host?.model()) ?? this.#model;
		await this.emit(phase === "start" ? "before_agent_start" : "agent_settled", { type: phase === "start" ? "before_agent_start" : "agent_settled" });
	}

	async emit(type: string, event: Record<string, unknown>): Promise<void> {
		for (const extension of this.#extensions)
			for (const handler of extension.handlers.get(type) ?? []) {
				try {
					await handler(event, this.#context(false));
				} catch (error) {
					this.#options.emit({ type: "session.diagnostic", message: `${type} handler of ${extension.path} failed: ${redact(error instanceof Error ? error.message : String(error))}` });
				}
			}
	}

	/** Commands of the bound packages that run here. */
	commands(): { name: string; description?: string }[] {
		return this.#extensions.flatMap((extension) =>
			[...extension.commands.values()].filter((command) => BLOCKED_COMMANDS[command.name] === undefined).map((command) => ({ name: command.name, ...(command.description === undefined ? {} : { description: command.description }) })),
		);
	}

	/** Run `/name args`; notices stream as command output. A blocked, unknown or dialog-needing command is refused. */
	async command(text: string): Promise<{ type: "done" } | { type: "unsupported"; message: string }> {
		const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
		const name = match?.[1] ?? "";
		const blocked = BLOCKED_COMMANDS[name];
		if (blocked !== undefined) return { type: "unsupported", message: `/${name} is not available in Durable Chats: ${blocked}` };
		const command = this.#extensions.map((extension) => extension.commands.get(name)).find((found) => found !== undefined);
		if (command === undefined) return { type: "unsupported", message: `/${name} is not available in Durable Chats yet` };
		const controller = new AbortController();
		try {
			await command.handler(match?.[2]?.trim() ?? "", this.#context(true, controller.signal));
		} catch (error) {
			if (error instanceof DialogUnavailable) return { type: "unsupported", message: `/${name} needs an extension dialog: ${error.message}` };
			throw new Error(redact(error instanceof Error ? error.message : String(error)));
		} finally {
			await this.#queue;
		}
		return { type: "done" };
	}

	/** `session_shutdown`, then every pending commit. */
	async close(): Promise<void> {
		await this.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
		await this.#queue;
	}

	/** Wait for the package commits made so far (tests and orderly shutdown). */
	settled(): Promise<void> {
		return this.#queue;
	}
}

function packageName(root: string | undefined): string | undefined {
	if (root === undefined) return undefined;
	try {
		return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: string }).name;
	} catch {
		return undefined;
	}
}
