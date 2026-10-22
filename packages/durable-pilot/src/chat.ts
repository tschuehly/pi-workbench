// One Durable Chat on the pilot host: the core coding tools (read, write, edit, bash) in the Chat's workspace, every
// tool and the model behind the pre-persistence redaction wrappers, the Workbench behaviors (Working Mode, ask_user,
// request_attention), and the Claude subscription (Pi's auth.json, pi-claude-code-use 2.2.1 payload rules) plus, for
// tests and trials, the scripted faux model. The Chat's model is stored per conversation and can be switched.
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { claudeAliases, claudePayload, PiAuthStore } from "./claude.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { router } from "./faux.ts";
import { context, type Host, MODEL, openHost } from "./host.ts";
import { type PackageEvent, PiPackages } from "./packages.ts";
import { redactingTool, wrapProvider } from "./redact.ts";
import { type Resources, type WorkbenchSignal, workbenchExtension } from "./workbench.ts";

export const PREAMBLE = [
	"You are a coding assistant working in the user's workspace through PI WEB.",
	"Use the read, write, edit and bash tools to inspect and change files; paths are relative to the working directory below.",
	"Keep answers short and concrete.",
].join("\n");

/** Prompt sections in Pi's order (preamble, addendum, project context, skills, cwd); resources come from PI WEB. */
export function chatTools(resources: () => Resources) {
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
		tools: [{ ...createReadTool(), replay: "safe" as const }, createWriteTool(), createEditTool(), createBashTool()].map((tool) => redactingTool(tool)),
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
	/** Run the bound installed Pi packages (`packages.ts`) from this agent directory's settings. */
	readonly packages?: { readonly agentDir?: string };
};

/** A Chat host plus the Workbench state PI WEB feeds (resources) and reads (signals). */
export type ChatHost = Host & {
	readonly workbench: { resources: Resources; onSignal: (signal: WorkbenchSignal) => void };
	/** The bound Pi packages, and where their events go (buffered until a session listens). */
	readonly packages?: PiPackages;
	listenPackages(listener: (event: PackageEvent) => void): void;
};

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
	const workbench: ChatHost["workbench"] = { resources: {}, onSignal: () => {} };
	const aliases = claudeAliases("pi");
	const early: PackageEvent[] = [];
	const chat: { onPackageEvent?: (event: PackageEvent) => void } = {};
	const packages = options.packages === undefined
		? undefined
		: await PiPackages.load({
				cwd: options.cwd,
				chatId: options.chatId ?? options.dir,
				agentDir: options.packages.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
				scratch: join(options.dir, "pi-packages"),
				emit: (event) => (chat.onPackageEvent === undefined ? early.push(event) : chat.onPackageEvent(event)),
			});
	const host = await openHost(options.dir, {
		faux: { tokensPerSecond: options.fauxTokensPerSecond ?? 200 },
		provider: () => anthropicProvider(),
		providerOptions: { onPayload: claudePayload(aliases), canonicalToolName: aliases.toCanonical },
		credentials: new PiAuthStore(),
		rootAgent: { model: parseModel(options.model), cwd: options.cwd },
		env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? options.cwd }),
		extensions: [
			chatTools(() => workbench.resources),
			workbenchExtension({ chatId: options.chatId ?? options.dir, signal: (signal) => workbench.onSignal(signal) }),
			...(packages === undefined ? [] : [packages.extension()]),
		],
	});
	if (scripted) {
		// The scripted model takes no Claude payload rules: it is answered locally by the router.
		host.models.setProvider(wrapProvider(host.faux.provider));
		const step = router(options.dir);
		host.faux.setResponses(Array.from({ length: 10_000 }, () => step));
	}
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
