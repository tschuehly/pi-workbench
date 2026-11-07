// Installed Pi packages in a Durable Chat: the packages' own Pi extension code, loaded with Pi's loader, with the
// ExtensionAPI bound to this host instead of a Pi AgentSession. Bound packages (pi-web-access, ping-a-human-pi,
// pi-process-monitor) keep their tools, commands and session hooks; every other package contributes only the skills and
// prompts PI WEB loads. The binding:
// - tools become Durable tools behind the redaction wrapper, with a pinned replay policy (unlisted tools are unsafe:
//   never rerun after a crash, held for the owner); tools a package keeps inactive are deferred until a tool such as
//   `web_enable` activates them (`setActiveTools` during a call becomes `control.addTools`);
// - `appendEntry` and `sendMessage` commit to the Chat (redacted first): entries as passive bookkeeping, committed at once
//   without scheduling anything (a paused restore stays paused while packages start, record and shut down); messages as
//   inputs (a turn when asked for one) or as context for the next turn, shown as PI WEB custom messages, through the
//   Chat's delivery barrier as bash completions and Atelier input are: held while a restore is paused until the owner
//   resumes it. Each message is committed passively to the Chat's package outbox when sent, so one still held when the
//   host closes is delivered after the reopened Chat resumes, once (its stable request ID survives a kill mid-delivery);
// - `ctx.model` is the Chat's model as the host has it, flagged for mid-conversation tool additions; `ctx.modelRegistry`
//   reads the host's models and Pi's stored logins through the host's credential store, and requests through its providers;
// - commands run here; `ui.notify` reaches PI WEB as command output, `ui.setStatus` as the Chat's extension statuses,
//   dialogs are refused visibly;
// - `resources_discover` (after `session_start`, as in Pi) collects the skill, prompt and theme paths packages
//   contribute; PI WEB loads them with the Chat's other resources;
// - `session_start` (with the package's own entries as its branch), `session_tree` (with the new branch's),
//   `before_agent_start`, `agent_settled` and `session_shutdown` reach the packages' handlers; their return values are not applied.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "@earendil-works/chord";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import { type Conversation, type Cursor, defineDoc, defineExtension, type DocumentReader, type ToolRegistration } from "@earendil-works/pi-durable";
import { fileRevision } from "./claude.ts";
import { context } from "./host.ts";
import { redact, sanitizeDeep } from "./redact.ts";

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

/** A package message (`sendMessage`) or user message (`sendUserMessage`) waiting for delivery, already redacted. */
type Held =
	| { id: string; kind: "message"; content: JsonValue; data: JsonValue; triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
	| { id: string; kind: "user"; content: JsonValue; deliverAs?: "steer" | "followUp" };
type HeldDraft = Held extends infer H ? (H extends Held ? Omit<H, "id"> : never) : never;

/** The package outbox: messages in call order, committed when sent, removed once admitted under their `id` as request ID. */
export const PackageOutboxDoc = defineDoc<{ held: Held[] }>({
	kind: "workbench.package-outbox",
	version: 1,
	scope: "session",
	initial: () => ({ held: [] }),
	checkpointWhen: () => false,
});

export class DialogUnavailable extends Error {
	constructor() {
		super("Extension dialogs are not available in Durable Chats yet");
		this.name = "DialogUnavailable";
	}
}

/**
 * Host events the binding emits: PI WEB's `command.output` and `session.diagnostic`, and `durable.notification`, which
 * PI WEB keeps in the Chat's notification inbox, and status changes.
 */
export type PackageEvent =
	| { type: "command.output"; level: "info" | "error"; message: string }
	| { type: "session.diagnostic"; message: string }
	| { type: "durable.notification"; severity: "warning" | "error"; message: string }
	/** A package's status line changed: the Chat publishes its status (not a browser event itself). */
	| { type: "extension.status" };

/** Resource paths packages contributed through `resources_discover`, each with the extension it came from (Pi's shape). */
export type ContributedResources = Record<"skillPaths" | "promptPaths" | "themePaths", { path: string; extensionPath: string }[]>;

/** PI WEB's limits on extension statuses (`EXTENSION_STATUS_*` in its shared/apiTypes.ts). */
const STATUS_LIMIT = 64;
const STATUS_KEY_MAX = 128;
const STATUS_TEXT_MAX = 65_536;

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
type PiExtension = { path: string; sourceInfo?: { source?: string }; handlers: Map<string, ((event: unknown, ctx: unknown) => unknown)[]>; tools: Map<string, { definition: PiTool }>; commands: Map<string, PiCommand> };
type PiMessage = { customType: string; content: string | Content; display?: boolean; details?: unknown };
/** The Chat session's delivery barrier (ChatSession `#deliver`). */
type Deliver = <T>(work: () => Promise<T>) => Promise<T>;
type Branch = { type: "custom"; id: string; parentId: string | null; timestamp: string; customType: string; data: unknown }[];

/** The Chat a binding commits to, the model its packages see, and the host's models with their stored logins. */
export type PackageHost = {
	readonly root: Conversation;
	/** Committed document reads (the package outbox), without a commit. */
	readonly reader: DocumentReader;
	readonly registry: { install(extension: ReturnType<typeof defineExtension>): void };
	model(): Promise<Record<string, unknown> | undefined>;
	readonly models: Models;
};

/** What a sync `ModelRegistry` read needs: the models with a stored login, and each provider's login type. */
type Logins = { available: Model<Api>[]; types: Map<string, string> };

/** How long a login snapshot waits for auth.json's lock (Pi's own sync reload gives up within ~200 ms). */
const LOGIN_READ_MS = 1_000;

/** Throws when auth.json stays locked past `signal`: the caller keeps its last snapshot. */
async function readLogins(models: Models, signal: AbortSignal): Promise<Logins> {
	const types = new Map<string, string>();
	for (const provider of models.getProviders()) {
		const check = await models.checkAuth(provider.id, { signal }).catch(() => undefined);
		if (check !== undefined) types.set(provider.id, check.type);
	}
	const available = await models.getAvailable(undefined, { signal });
	signal.throwIfAborted();
	return { available: [...available], types };
}

/**
 * Pi's `ModelRegistry` as packages use it (pi-coding-agent `ModelRegistry`), backed by the host's models: its providers
 * and Pi's auth.json through the host's credential store, under Pi's lock. Requests go through the host's providers
 * (redaction, Claude payload rules), never a package's own client with a copied token. Availability and login types are
 * read at session start and at each run start, as Pi's registry snapshots them.
 */
function modelRegistry(models: Models, logins: () => Logins) {
	// The host's own model, not the packages' view of it (its compat flags describe Durable's tool handling).
	const own = <M extends Model<Api>>(model: M): M => (models.getModel(model.provider, model.id) as M | undefined) ?? model;
	return {
		getAll: () => [...models.getModels()],
		getAvailable: () => [...logins().available],
		find: (provider: string, id: string) => models.getModel(provider, id),
		hasConfiguredAuth: (model: Model<Api>) => logins().types.has(model.provider),
		isUsingOAuth: (model: Model<Api>) => logins().types.get(model.provider) === "oauth",
		getApiKeyAndHeaders: async (model: Model<Api>) => {
			try {
				const resolved = await models.getAuth(own(model));
				if (resolved === undefined) return { ok: false as const, error: `No API key found for "${model.provider}"` };
				const { apiKey, headers, baseUrl } = resolved.auth;
				return { ok: true as const, apiKey, headers, ...(baseUrl === undefined ? {} : { baseUrl }), env: resolved.env };
			} catch (error) {
				return { ok: false as const, error: redact(error instanceof Error ? error.message : String(error)) };
			}
		},
		stream: ((model, context, options) => models.stream(own(model), context, options)) as Models["stream"],
		streamSimple: ((model, context, options) => models.streamSimple(own(model), context, options)) as Models["streamSimple"],
		complete: ((model, context, options) => models.complete(own(model), context, options)) as Models["complete"],
	};
}

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
	#logins: Logins = { available: [], types: new Map() };
	#authRevision: string | undefined;
	#registry: ReturnType<typeof modelRegistry> | undefined;
	/** `ui.setStatus` lines, by key (in memory, as in a legacy Chat: packages publish them again at session_start). */
	readonly #statuses = new Map<string, string>();
	#resources: ContributedResources = { skillPaths: [], promptPaths: [], themePaths: [] };
	/** Passive commits in call order; a failure is reported, never thrown into the package. */
	#queue: Promise<void> = Promise.resolve();
	/** Outbox deliveries in call order, each through the Chat's delivery barrier once a session attached it. */
	#outbox: Promise<void> = Promise.resolve();
	#deliver: Deliver | undefined;
	readonly #attached = Promise.withResolvers<void>();
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
			sendMessage: (message: PiMessage, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }) =>
				this.#hold({
					kind: "message",
					content: sanitizeDeep(json(message.content), redact),
					data: json({ customType: message.customType, display: message.display === true, ...(message.details === undefined ? {} : { details: sanitizeDeep(json(message.details), redact) }) }),
					...(options?.triggerTurn === undefined ? {} : { triggerTurn: options.triggerTurn }),
					...(options?.deliverAs === undefined ? {} : { deliverAs: options.deliverAs }),
				}),
			sendUserMessage: (content: string | Content, options?: { deliverAs?: "steer" | "followUp" }) =>
				this.#hold({ kind: "user", content: sanitizeDeep(json(content), redact), ...(options?.deliverAs === undefined ? {} : { deliverAs: options.deliverAs }) }),
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

	readonly #failed = (error: unknown) =>
		this.#options.emit({ type: "session.diagnostic", message: `Package action failed: ${redact(error instanceof Error ? error.message : String(error))}` });

	#commit(work: () => Promise<void>): void {
		this.#queue = this.#queue.then(work).catch(this.#failed);
	}

	/**
	 * A message (it may start or feed a turn): committed to the outbox at once, passively, then delivered only through the
	 * Chat's delivery barrier, never ahead of it.
	 */
	#hold(draft: HeldDraft): void {
		const held = (this.#queue = this.#queue.then(() => this.#commitHeld(draft)).catch(this.#failed));
		this.#outbox = this.#outbox.then(() => held).then(() => this.#flush()).catch(this.#failed);
	}

	async #commitHeld(draft: HeldDraft): Promise<void> {
		await this.#root().commit(async (tx) => void (await tx.doc(PackageOutboxDoc)).held.push({ ...draft, id: `package:${randomUUID()}` } as Held), context);
	}

	/** The oldest held message, if any. */
	async #oldest(): Promise<Held | undefined> {
		if (this.#host === undefined) throw new Error("Package runtime not attached to its Chat yet");
		return (await this.#host.reader.snapshot(PackageOutboxDoc, context))?.held[0];
	}

	/** Deliver what the outbox holds, once the session attached and its barrier lets it (never while a restore is paused). */
	async #flush(): Promise<void> {
		await this.#attached.promise;
		if ((await this.#oldest()) === undefined) return;
		await this.#deliver!(async () => {
			// Admitted under its request ID, then removed: a kill between the two finds the admission on the next delivery,
			// which only removes it (resubmitting could pick another type, `input` or `write`, than the one admitted).
			for (let item = await this.#oldest(); item !== undefined; item = await this.#oldest()) {
				const id = item.id;
				const root = this.#root();
				if ((await root.commit((tx) => tx.submissionByRequest(root.id, id), context)) === undefined) await this.#send(item);
				await root.commit(async (tx) => {
					const doc = await tx.doc(PackageOutboxDoc);
					doc.held = doc.held.filter((held) => held.id !== id);
				}, context);
			}
		});
	}

	/**
	 * The Chat session's delivery barrier: package messages wait for it as bash completions and Atelier input do. Messages
	 * a closed host still held are delivered first.
	 */
	attach(hooks: { deliver: Deliver }): void {
		this.#deliver = hooks.deliver;
		this.#attached.resolve();
		this.#outbox = this.#outbox.then(() => this.#flush()).catch(this.#failed);
	}

	/**
	 * Bookkeeping the model never sees: appended in one commit, as Durable admits a display-only write busy or not, but
	 * not through `Conversation.submit`, which enables scheduling and would resume a paused restore.
	 * ponytail: lands ahead of a queued reset write; this host queues none (no `Conversation.reset`).
	 */
	async #append(customType: string, data: unknown): Promise<void> {
		const clean = sanitizeDeep(json(data), redact);
		const root = this.#root();
		const entry = await root.commit((tx) => tx.appendEntry(root.id, { kind: PACKAGE_ENTRY, data: { customType, data: clean } }), context);
		const id = String(entry.id);
		this.#branch.push({ type: "custom", id, parentId: this.#branch.at(-1)?.id ?? null, timestamp: new Date().toISOString(), customType, data: clean });
	}

	/**
	 * Pi's `sendUserMessage`, and `sendMessage`: a turn when asked for one (or queued while busy), otherwise context for
	 * the next turn. The held message's ID is the request ID, so delivering it again admits nothing twice.
	 */
	async #send(item: Held): Promise<void> {
		const root = this.#root();
		if (item.kind === "user") {
			await root.submit({ type: "input", content: item.content as never, whenBusy: item.deliverAs ?? "followUp", requestId: item.id }, context);
			return;
		}
		const text = textOf(item.content as string | Content);
		const data = item.data;
		if (item.triggerTurn === true || (!this.#idle && item.deliverAs !== "nextTurn")) {
			await root.submit({ type: "input", content: text, whenBusy: item.deliverAs === "followUp" ? "followUp" : "steer", requestId: item.id, entry: { kind: PACKAGE_MESSAGE_ENTRY, data } }, context);
			return;
		}
		await root.submit({ type: "write", requestId: item.id, entry: { kind: PACKAGE_MESSAGE_ENTRY, data, model: [{ role: "user", content: text, timestamp: Date.now() }] } }, context);
	}

	#ui(command: boolean) {
		const notify = (message: string, type?: "info" | "warning" | "error") => {
			const clean = redact(String(message));
			// As in a legacy Chat: command notices are command output; others are retained notifications, warnings and errors only.
			if (command) this.#options.emit({ type: "command.output", level: type === "error" ? "error" : "info", message: clean });
			else if (type === "warning" || type === "error") this.#options.emit({ type: "durable.notification", severity: type, message: clean });
		};
		// PI WEB's legacy `setStatus`: bounded, unchanged values ignored; text is redacted like every package output.
		const setStatus = (key: unknown, text: unknown) => {
			if (typeof key !== "string" || key === "" || key.length > STATUS_KEY_MAX) return;
			if (text !== undefined && (typeof text !== "string" || text.length > STATUS_TEXT_MAX)) return;
			if (text === undefined) {
				if (!this.#statuses.delete(key)) return;
			} else {
				const clean = redact(text);
				if ((!this.#statuses.has(key) && this.#statuses.size >= STATUS_LIMIT) || this.#statuses.get(key) === clean) return;
				this.#statuses.set(key, clean);
			}
			this.#options.emit({ type: "extension.status" });
		};
		return new Proxy({} as Record<string, unknown>, {
			get: (_target, property) => {
				if (property === "notify") return notify;
				if (property === "setStatus") return setStatus;
				if (property === "theme") return plainTheme;
				if (property === "select" || property === "confirm" || property === "input" || property === "editor" || property === "custom") return () => Promise.reject(new DialogUnavailable());
				// Widgets, footers and the editor are terminal surfaces: nothing to show them in.
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
			modelRegistry: this.#registry,
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

	/** Pi's tool definition as a Durable tool; the host registry puts it behind redaction. */
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
		return tool;
	}

	/**
	 * Each package extension's tool names under its provenance (Pi's source and the loaded path), so tool groups match
	 * package tools by package as legacy `inGroup` does (monitor: pi-process-monitor).
	 */
	sources(): { name: string; tools: { name: string }[] }[] {
		return this.#extensions.map((extension) => ({ name: `${extension.sourceInfo?.source ?? ""} ${extension.path}`, tools: [...extension.tools.keys()].map((name) => ({ name })) }));
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
		this.#registry = modelRegistry(host.models, () => this.#logins);
		this.#model = await host.model();
		await this.#refreshLogins(host.models);
		await this.#readBranch();
		await this.emit("session_start", { type: "session_start", reason: "startup" });
		await this.#discover();
		host.registry.install(this.extension());
	}

	/**
	 * The login snapshot, read again only when auth.json changed: every read takes Pi's auth.json lock, and a host killed
	 * while holding it leaves the lock for 30 s, stalling every Chat and Pi that waits on it. A lock held past
	 * LOGIN_READ_MS keeps the last snapshot, as Pi's reload does.
	 */
	async #refreshLogins(models: Models): Promise<void> {
		const revision = fileRevision(join(this.#options.agentDir, "auth.json"));
		if (revision === this.#authRevision) return;
		try {
			this.#logins = await readLogins(models, AbortSignal.timeout(LOGIN_READ_MS));
			this.#authRevision = revision;
		} catch {
			// auth.json stayed locked: the last snapshot stands until the next run start.
		}
	}

	/** Pi's `emitResourcesDiscover` at startup: every handler's paths, with the extension that contributed them. */
	async #discover(): Promise<void> {
		const found: ContributedResources = { skillPaths: [], promptPaths: [], themePaths: [] };
		for (const extension of this.#extensions)
			for (const handler of extension.handlers.get("resources_discover") ?? []) {
				try {
					const result = (await handler({ type: "resources_discover", cwd: this.#options.cwd, reason: "startup" }, this.#context(false))) as Partial<Record<keyof ContributedResources, unknown>> | undefined;
					for (const kind of ["skillPaths", "promptPaths", "themePaths"] as const) {
						const paths = result?.[kind];
						if (Array.isArray(paths)) for (const path of paths) if (typeof path === "string") found[kind].push({ path, extensionPath: extension.path });
					}
				} catch (error) {
					this.#options.emit({ type: "session.diagnostic", message: `resources_discover handler of ${extension.path} failed: ${redact(error instanceof Error ? error.message : String(error))}` });
				}
			}
		this.#resources = found;
	}

	/** Resources the packages contributed at startup, for PI WEB's resource loader. */
	resources(): ContributedResources {
		return this.#resources;
	}

	/** The packages' status lines. */
	statuses(): Record<string, string> {
		return Object.fromEntries(this.#statuses);
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
		if (phase === "start" && this.#host !== undefined) {
			this.#model = (await this.#host.model()) ?? this.#model;
			await this.#refreshLogins(this.#host.models);
		}
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

	/** `session_shutdown`, then every pending passive commit; a message held for a paused restore stays in the outbox. */
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
