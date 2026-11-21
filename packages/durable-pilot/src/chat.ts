// One Durable Chat on the pilot host: the core coding tools (read, write, edit, bash) in the Chat's workspace, every
// tool and the model behind the pre-persistence redaction wrappers, the Workbench behaviors (Working Mode, ask_user,
// request_attention), and the legacy Chat's providers from Pi's auth.json: the Claude subscription (pi-claude-code-use
// 2.2.1 payload rules), the ChatGPT subscription (openai-codex and openai, with pi-openai-fast-mode), Meta's Muse and
// GitHub Copilot; plus, for
// tests and trials, the scripted faux model. The Chat's model is stored per conversation and can be switched.
import { clampThinkingLevel, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { type CompactionSettings, defineExtension, type Extension, section } from "@earendil-works/pi-durable";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { claudeAliases, claudePayload, PiAuthStore } from "./claude.ts";
import { checkpointExtension } from "./checkpoint.ts";
import { ChildDoc, delegationExtension } from "./delegation.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { router } from "./faux.ts";
import { clearInheritedIdentity, storedAgent, sweepPiTmp, toolEnv, warningTool, workbenchExtensions } from "./extensions.ts";
import { context, type Host, MODEL, openHost } from "./host.ts";
import { toolGroupsExtension } from "./tool-groups.ts";
import { type PackageEvent, PiPackages } from "./packages.ts";
import { builtinProviders, ENV_CREDENTIALS, type FastMode, fastMode, modelsJsonBaseUrl, refreshExpiredLogins, registeredProviders, subscriptionProviders, withBaseUrl, withStoredModels } from "./providers.ts";
import { redact, wrapProvider } from "./redact.ts";
import { searchTools } from "./search-tools.ts";
import { Atelier } from "./atelier.ts";
import { SessionSpawner } from "./spawn-session.ts";
import { BackgroundBash } from "./background-bash.ts";
import { type Resources, type WorkbenchSignal, workbenchExtension } from "./workbench.ts";

export const PREAMBLE = [
	"You are a coding assistant working in the user's workspace through PI WEB.",
	"Use the read, write, edit and bash tools to inspect and change files; paths are relative to the working directory below.",
	"Keep answers short and concrete.",
].join("\n");

/**
 * The edit tool with PI WEB's preview (legacy `createPiWebEditToolDefinition`): before applying, the diff it will apply
 * (or why it cannot) reaches the browser as running `details.preview`; the result's own details replace it. The
 * preview runs the same edit against the call's environment with writes discarded, so it matches exactly what is
 * applied next.
 */
export function previewingEdit(edit = createEditTool()): typeof edit {
	const discardWrites = <T extends object>(env: T): T =>
		new Proxy(env, {
			get(target, property) {
				if (property === "writeFile") return async () => ({ ok: true, value: undefined });
				const value = Reflect.get(target, property, target) as unknown;
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	return {
		...edit,
		execute: async (args, api, c) => {
			const dry = new Proxy(api, {
				get(target, property) {
					if (property === "env") return target.env === undefined ? undefined : discardWrites(target.env);
					const value = Reflect.get(target, property, target) as unknown;
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			const preview = await edit.execute(args, dry, c).then(
				({ details }) => ({ diff: details?.diff ?? "", ...(details?.firstChangedLine === undefined ? {} : { firstChangedLine: details.firstChangedLine }) }),
				(error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
			);
			if (c.abortSignal?.aborted !== true) await api.details({ preview } as never, c);
			return edit.execute(args, api, c);
		},
	};
}

/** Prompt sections in Pi's order (preamble, addendum, project context, skills, cwd); resources come from PI WEB. */
export function chatTools(resources: () => Resources, cwd: string) {
	return defineExtension({
		name: "workbench.chat",
		sections: [
			section("preamble", () => PREAMBLE, { tag: false }),
			section("addendum", () => resources().addendum || undefined),
			section("project_context", () => resources().projectContext || undefined),
			section("skills", () => resources().skills || undefined),
			section("cwd", (input) => input.env?.cwd),
		],
		// read has no external effect, so a crash mid-read may rerun it; write and edit stay unsafe (never rerun). bash is
		// the Workbench one (background-bash.ts). grep/find/ls: Pi's own, offered only where an allowlist names them
		// (children), as in legacy Chats.
		tools: [{ ...createReadTool(), replay: "safe" as const }, createWriteTool(), previewingEdit(), ...searchTools(cwd)],
	});
}

export type ChatHostOptions = {
	/** Family directory: session.sqlite, owner.json, work/. */
	readonly dir: string;
	/** The Chat's workspace: every tool call runs here. */
	readonly cwd: string;
	/** PI WEB's Chat ID: stable ask/attention IDs and telemetry lineage. */
	readonly chatId?: string;
	/** Model of a new Chat: `<provider>/<model>` with a stored login in Pi's auth.json, or `faux` (scripted by `faux.ts` `router`). */
	readonly model: string;
	/** Offer the scripted model next to the Claude models (tests and trials); implied by `model: "faux"`. */
	readonly scripted?: boolean;
	/** Faux only: tokens per second of a streamed answer. */
	readonly fauxTokensPerSecond?: number;
	/**
	 * Thinking level of a new Chat, as PI WEB resolved it from Pi's settings (legacy default `medium`); clamped to the
	 * model. A reopened Chat keeps its own.
	 */
	readonly thinkingLevel?: string;
	/**
	 * Tests and trials only: requests to the Claude, ChatGPT and Copilot models are answered by the scripted model, so
	 * routed children run under the model names routing chose without leaving the machine.
	 */
	readonly scriptedProviders?: boolean;
	/** Open the store only to read its history: no packages, reconciliation or model clamp (`HostOptions.readOnly`). */
	readonly readOnly?: boolean;
	/** Run the bound installed Pi packages (`packages.ts`) from this agent directory's settings. */
	readonly packages?: { readonly agentDir?: string };
};

/** A Chat host plus the Workbench state PI WEB feeds (resources) and reads (signals). */
export type ChatHost = Host & {
	readonly workbench: {
		resources: Resources;
		onSignal: (signal: WorkbenchSignal) => void;
		compaction: CompactionSettings;
		extensions: readonly Extension[];
		/** Telemetry of Subagents and Workers (launches, settlements, child usage). */
		record: (type: string, data: Record<string, unknown>) => void;
	};
	/** The bound Pi packages, and where their events go (buffered until a session listens). */
	readonly packages?: PiPackages;
	listenPackages(listener: (event: PackageEvent) => void): void;
	/** pi-openai-fast-mode for this Chat's workspace. */
	readonly fast: FastMode;
	/** The Workbench bash tools and their completion reporter (replace the core bash). */
	readonly bash: BackgroundBash;
	/** The atelier tool, its page server and the delivery of human input. */
	readonly atelier: Atelier;
	/** spawn_session's requests to PI WEB and their answers. */
	readonly spawner: SessionSpawner;
};

/**
 * Pi's codemode tool, offered to the lead as in a legacy Chat (where the MCP extension activates it), in Durable's
 * restart-surviving form. Marked replay-unsafe all the same: a restart never reruns a script, whose nested calls may
 * have had effects; the owner reconciles it. Its output goes behind the redacting wrapper like every tool's.
 */
function codemodeExtension(sandbox: CodemodeSandbox, inlineBudget: number | undefined): Extension {
	const extension = createCodemodeExtension({ sandbox, ...(inlineBudget === undefined ? {} : { inlineBudget }) });
	return { ...extension, tools: extension.tools?.map((tool) => ({ ...tool, replay: "unsafe" as const })) };
}

/** Pi's `codemode.inlineBudget` setting, read as the Pi CLI's codemode extension reads it; `undefined` keeps the library default. */
export function codemodeInlineBudget(cwd: string, agentDir: string): number | undefined {
	return SettingsManager.create(cwd, agentDir, { projectTrusted: false }).getSettings().codemode?.inlineBudget;
}

/** pi-ai's per-API compat flags for adding tools mid-conversation without resending the transcript. */
const DYNAMIC_TOOLS = { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true, supportsMidConvoToolAdditions: true, supportsAdditionalTools: true };

/**
 * Pi's compaction defaults (threshold above `contextWindow - reserveTokens`, keep ~20k recent tokens), without Durable's
 * extra background compaction, which Pi does not have; PI WEB replaces them with the user's Pi settings.
 */
export const DEFAULT_COMPACTION: CompactionSettings = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, backgroundTokens: 0 };

export function parseModel(model: string): { provider: string; modelId: string } {
	if (model === "faux") return MODEL;
	const [provider, modelId] = model.split("/", 2);
	if (provider === undefined || provider === "" || modelId === undefined || modelId === "") throw new Error(`Unsupported Durable Chat model ${model}`);
	return { provider, modelId };
}

/**
 * As Pi's `setModel` and session load: store `model` (when given) and clamp the Chat's thinking level to what the
 * Chat's model supports. Returns the resulting thinking level.
 */
export async function applyModel(host: Host, model?: { provider: string; modelId: string }): Promise<ModelThinkingLevel | undefined> {
	const agent = await host.root.agent(context);
	const target = model ?? agent.model;
	const found = target === undefined ? undefined : host.models.getModel(target.provider, target.modelId);
	const current = agent.thinkingLevel;
	const thinkingLevel = found === undefined || current === undefined ? current : clampThinkingLevel(found, current);
	if (model !== undefined || thinkingLevel !== current)
		await host.root.configure({ ...(model === undefined ? {} : { model }), ...(thinkingLevel === current ? {} : { thinkingLevel }) }, context);
	return thinkingLevel;
}

export async function openChatHost(options: ChatHostOptions): Promise<ChatHost> {
	const scripted = options.model === "faux" || options.scripted === true || options.scriptedProviders === true;
	// No paid API-key path may be taken silently: the subscription logins in Pi's auth.json are the only credentials.
	for (const name of Object.keys(process.env)) if (name.startsWith("ANTHROPIC_") || ENV_CREDENTIALS.includes(name)) delete process.env[name];
	const fast = fastMode(options.cwd);
	// Each tool call gets this Chat's identity (toolEnv), never one the host inherited.
	clearInheritedIdentity();
	sweepPiTmp();
	const chatId = options.chatId ?? options.dir;
	let opened: Host | undefined;
	// The lead is the active branch: history navigation may select another.
	const bash = new BackgroundBash({ chatId, cwd: options.cwd, rootId: () => opened?.root.id });
	const atelier = new Atelier({ chatId, cwd: options.cwd, rootId: () => opened?.root.id });
	const workbenchBash = bash.extension();
	const spawner = new SessionSpawner(chatId);
	const sandbox = new CodemodeSandbox();
	const agentDir = options.packages?.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	// Like the packages: only a Chat that runs the user's Pi settings (PI WEB's `--packages`) reads them.
	const inlineBudget = options.packages === undefined || options.readOnly === true ? undefined : codemodeInlineBudget(options.cwd, agentDir);
	// Tool groups defer the group tools of every extension before them. The Workbench bash, installed after the core
	// tools, replaces their bash.
	const extensions: Extension[] = [
		chatTools(() => workbench.resources, options.cwd),
		workbenchExtension({ chatId, signal: (signal) => workbench.onSignal(signal) }),
		workbenchExtensions(options.cwd),
		checkpointExtension(() => opened!.harness),
		delegationExtension({ chatId, dir: options.dir, harness: () => opened!.harness, record: (type, data) => workbench.record(type, data), leadOnly: [workbenchBash] }),
		// Same runner, blocking API and a bounded lifetime for children; no async child scheduler.
		bash.extension(true),
		workbenchBash,
		atelier.extension(),
		spawner.extension(),
		codemodeExtension(sandbox, inlineBudget),
	];
	const workbench: ChatHost["workbench"] = { resources: {}, onSignal: () => {}, compaction: DEFAULT_COMPACTION, extensions, record: () => {} };
	const aliases = claudeAliases("pi");
	const early: PackageEvent[] = [];
	const chat: { onPackageEvent?: (event: PackageEvent) => void } = {};
	const emitPackage = (event: PackageEvent) => (chat.onPackageEvent === undefined ? early.push(event) : chat.onPackageEvent(event));
	const packages = options.packages === undefined || options.readOnly === true
		? undefined
		: await PiPackages.load({
				cwd: options.cwd,
				chatId,
				agentDir,
				scratch: join(options.dir, "pi-packages"),
				emit: emitPackage,
			});
	const credentials = new PiAuthStore();
	const host = await openHost(options.dir, {
		...(options.readOnly === true ? { readOnly: true } : {}),
		// The scripted model reasons, so thinking levels apply to it as to Claude.
		faux: { tokensPerSecond: options.fauxTokensPerSecond ?? 200, models: [{ id: MODEL.modelId, reasoning: true }] },
		provider: () => withBaseUrl(withStoredModels(anthropicProvider()), modelsJsonBaseUrl("anthropic")),
		providerOptions: { onPayload: claudePayload(aliases), canonicalToolName: aliases.toCanonical },
		credentials,
		settings: { get compaction() { return workbench.compaction; } },
		rootAgent: { model: parseModel(options.model), cwd: options.cwd, thinkingLevel: (options.thinkingLevel ?? "medium") as ModelThinkingLevel },
		env: async (target, c) => {
			const cwd = target.cwd ?? options.cwd;
			const agent = await storedAgent(target.read, target.conversationId, c);
			// A Subagent's or Worker's calls are marked as a child's (wait-until caps its wait there); a lead's are not.
			const kind = (await target.read.snapshot(ChildDoc, target.conversationId, c))?.kind;
			// The Chat's active branch is the Chat: its calls carry the Chat's own ID.
			const identity = { chatId, conversationId: target.conversationId, rootId: opened?.root.id, cwd, ...(agent?.model === undefined ? {} : { model: agent.model }), ...(agent?.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }), ...(kind === undefined || kind === "lead" ? {} : { executionKind: kind }) };
			return new NodeExecutionEnv({ cwd, shellEnv: toolEnv(identity) });
		},
		// Package tools keep their own deferral (web_enable); tool groups also gate the package groups (monitor), as in
		// legacy Chats. Their wraps apply to the package extension installed after them.
		extensions: [...extensions, toolGroupsExtension([...extensions, ...(packages?.sources() ?? [])]), ...(packages === undefined ? [] : [packages.extension()])],
	});
	opened = host;
	// Package-registered providers last: a package's provider replaces the built-in of its ID, as in legacy Pi.
	const diagnostic = (message: string) => emitPackage({ type: "session.diagnostic", message: redact(message) });
	for (const provider of [...subscriptionProviders(fast), ...(await registeredProviders(packages?.providers() ?? [], fast, diagnostic))]) host.models.setProvider(provider);
	// Before any model is configured: a package that picked its catalog without an expired login picks again with it.
	if (packages !== undefined && (await refreshExpiredLogins(host.models, credentials, packages.providers().map((r) => r.name), diagnostic)))
		for (const provider of await registeredProviders(await packages.reloadProviders(), fast, diagnostic)) host.models.setProvider(provider);
	if (scripted) {
		// The scripted model takes no Claude payload rules: it is answered locally by the router.
		host.models.setProvider(wrapProvider(host.faux.provider));
		const step = router(options.dir);
		host.faux.setResponses(Array.from({ length: 10_000 }, () => step));
	}
	if (options.scriptedProviders === true) {
		const scriptedAs = (provider: Provider): Provider => ({ ...withStoredModels(provider), stream: host.faux.provider.stream, streamSimple: host.faux.provider.streamSimple });
		for (const provider of [anthropicProvider(), ...builtinProviders()]) host.models.setProvider(wrapProvider(scriptedAs(provider)));
	}
	// As Pi does on load: a stored level the model does not support is clamped (before anything is scheduled).
	if (options.readOnly !== true) await applyModel(host);
	await packages?.start({
		// The active branch at each use: history navigation may select another.
		get root() { return host.root; },
		reader: host.harness,
		registry: host.registry,
		models: host.models,
		// The Chat's model as it is (api, provider, baseUrl: pi-web-access picks current-model hosted search by them). Durable
		// adds tools mid-conversation natively for every model (deferred tools loaded with control.addTools); the compat
		// flags say so in each API's terms, so pi-web-access keeps its web tools behind web_enable for Claude, ChatGPT and
		// Copilot models alike. The scripted model's API is its own, unknown to packages.
		model: async () => {
			const ref = (await host.root.agent(context)).model;
			const model = ref === undefined ? undefined : host.models.getModel(ref.provider, ref.modelId);
			return model === undefined ? undefined : { ...model, compat: { ...model.compat, ...DYNAMIC_TOOLS } };
		},
	});
	const closeHost = host.close.bind(host);
	return Object.assign(host, {
		// Stop running scripts first: closing the sandbox is no outcome, the store reopens with the call interrupted.
		close: async () => {
			await sandbox.close();
			await closeHost();
		},
		workbench,
		fast,
		bash,
		atelier,
		spawner,
		...(packages === undefined ? {} : { packages }),
		listenPackages: (listener: (event: PackageEvent) => void) => {
			chat.onPackageEvent = listener;
			for (const event of early.splice(0)) listener(event);
		},
	});
}
