// One Durable Chat on the pilot host: the core coding tools (read, write, edit, bash) in the Chat's workspace, every
// tool and the model behind the pre-persistence redaction wrappers, the Workbench behaviors (Working Mode, ask_user,
// request_attention), and the Claude subscription (Pi's auth.json, pi-claude-code-use 2.2.1 payload rules) plus, for
// tests and trials, the scripted faux model. The Chat's model is stored per conversation and can be switched.
import { clampThinkingLevel, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { type CompactionSettings, defineExtension, type Extension, section } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { claudeAliases, claudePayload, PiAuthStore } from "./claude.ts";
import { checkpointExtension } from "./checkpoint.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { router } from "./faux.ts";
import type { ConversationId } from "@earendil-works/pi-durable";
import { clearInheritedIdentity, storedAgent, sweepPiTmp, toolEnv, warningTool, workbenchExtensions } from "./extensions.ts";
import { context, type Host, MODEL, openHost } from "./host.ts";
import { toolGroupsExtension } from "./tool-groups.ts";
import { type PackageEvent, PiPackages } from "./packages.ts";
import { redactingTool, wrapProvider } from "./redact.ts";
import { searchTools } from "./search-tools.ts";
import { type Resources, type WorkbenchSignal, workbenchExtension } from "./workbench.ts";

export const PREAMBLE = [
	"You are a coding assistant working in the user's workspace through PI WEB.",
	"Use the read, write, edit and bash tools to inspect and change files; paths are relative to the working directory below.",
	"Keep answers short and concrete.",
].join("\n");

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
		// read has no external effect, so a crash mid-read may rerun it; write, edit and bash stay unsafe (never rerun).
		// grep/find/ls: Pi's own, offered only where an allowlist names them (children), as in legacy Chats.
		tools: [{ ...createReadTool(), replay: "safe" as const }, createWriteTool(), createEditTool(), createBashTool(), ...searchTools(cwd)].map((tool) => redactingTool(warningTool(tool))),
	});
}

export type ChatHostOptions = {
	/** Family directory: session.sqlite, owner.json, work/. */
	readonly dir: string;
	/** The Chat's workspace: every tool call runs here. */
	readonly cwd: string;
	/** PI WEB's Chat ID: stable ask/attention IDs and telemetry lineage. */
	readonly chatId?: string;
	/** Model of a new Chat: `anthropic/<model>` via the Claude subscription, or `faux` (scripted by `faux.ts` `router`). */
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
	/** Run the bound installed Pi packages (`packages.ts`) from this agent directory's settings. */
	readonly packages?: { readonly agentDir?: string };
};

/** A Chat host plus the Workbench state PI WEB feeds (resources) and reads (signals). */
export type ChatHost = Host & {
	readonly workbench: { resources: Resources; onSignal: (signal: WorkbenchSignal) => void; compaction: CompactionSettings; extensions: readonly Extension[] };
	/** The bound Pi packages, and where their events go (buffered until a session listens). */
	readonly packages?: PiPackages;
	listenPackages(listener: (event: PackageEvent) => void): void;
};

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

export async function openChatHost(options: ChatHostOptions): Promise<ChatHost> {
	const scripted = options.model === "faux" || options.scripted === true;
	// No paid API-key path may be taken silently: the subscription login in Pi's auth.json is the only credential.
	for (const name of Object.keys(process.env)) if (name.startsWith("ANTHROPIC_")) delete process.env[name];
	// Each tool call gets this Chat's identity (toolEnv), never one the host inherited.
	clearInheritedIdentity();
	sweepPiTmp();
	const chatId = options.chatId ?? options.dir;
	let rootId: ConversationId | undefined;
	let opened: Host | undefined;
	// Tool groups defer the group tools of every extension before them.
	const extensions: Extension[] = [
		chatTools(() => workbench.resources, options.cwd),
		workbenchExtension({ chatId, signal: (signal) => workbench.onSignal(signal) }),
		workbenchExtensions(options.cwd),
		checkpointExtension(() => opened!.harness),
	];
	const workbench: ChatHost["workbench"] = { resources: {}, onSignal: () => {}, compaction: DEFAULT_COMPACTION, extensions };
	const aliases = claudeAliases("pi");
	const early: PackageEvent[] = [];
	const chat: { onPackageEvent?: (event: PackageEvent) => void } = {};
	const packages = options.packages === undefined
		? undefined
		: await PiPackages.load({
				cwd: options.cwd,
				chatId,
				agentDir: options.packages.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
				scratch: join(options.dir, "pi-packages"),
				emit: (event) => (chat.onPackageEvent === undefined ? early.push(event) : chat.onPackageEvent(event)),
			});
	const host = await openHost(options.dir, {
		// The scripted model reasons, so thinking levels apply to it as to Claude.
		faux: { tokensPerSecond: options.fauxTokensPerSecond ?? 200, models: [{ id: MODEL.modelId, reasoning: true }] },
		provider: () => anthropicProvider(),
		providerOptions: { onPayload: claudePayload(aliases), canonicalToolName: aliases.toCanonical },
		credentials: new PiAuthStore(),
		settings: { get compaction() { return workbench.compaction; } },
		rootAgent: { model: parseModel(options.model), cwd: options.cwd, thinkingLevel: (options.thinkingLevel ?? "medium") as ModelThinkingLevel },
		env: async (target, c) => {
			const cwd = target.cwd ?? options.cwd;
			const agent = await storedAgent(target.read, target.conversationId, c);
			const identity = { chatId, conversationId: target.conversationId, rootId, cwd, ...(agent?.model === undefined ? {} : { model: agent.model }), ...(agent?.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }) };
			return new NodeExecutionEnv({ cwd, shellEnv: toolEnv(identity) });
		},
		// Package tools keep their own deferral (web_enable); tool groups see only the Workbench extensions.
		extensions: [...extensions, toolGroupsExtension(extensions), ...(packages === undefined ? [] : [packages.extension()])],
	});
	opened = host;
	rootId = host.root.id;
	if (scripted) {
		// The scripted model takes no Claude payload rules: it is answered locally by the router.
		host.models.setProvider(wrapProvider(host.faux.provider));
		const step = router(options.dir);
		host.faux.setResponses(Array.from({ length: 10_000 }, () => step));
	}
	// As Pi does on load: a stored level the model does not support is clamped (before anything is scheduled).
	const agent = await host.root.agent(context);
	const model = agent.model === undefined ? undefined : host.models.getModel(agent.model.provider, agent.model.modelId);
	const clamped = model === undefined ? agent.thinkingLevel : clampThinkingLevel(model, agent.thinkingLevel);
	if (clamped !== agent.thinkingLevel) await host.root.configure({ thinkingLevel: clamped }, context);
	await packages?.start({
		root: host.root,
		registry: host.registry,
		// Durable adds tools mid-conversation natively for every model (deferred tools loaded with control.addTools), so
		// packages see a model that supports it: pi-web-access then keeps its web tools behind web_enable, as legacy
		// Claude Chats do.
		model: async () => {
			const ref = (await host.root.agent(context)).model;
			const model = ref === undefined ? undefined : host.models.getModel(ref.provider, ref.modelId);
			return { ...model, api: "anthropic-messages", compat: { ...model?.compat, supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } };
		},
	});
	return Object.assign(host, {
		workbench,
		...(packages === undefined ? {} : { packages }),
		listenPackages: (listener: (event: PackageEvent) => void) => {
			chat.onPackageEvent = listener;
			for (const event of early.splice(0)) listener(event);
		},
	});
}
