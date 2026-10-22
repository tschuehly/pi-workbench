// One Durable Chat on the pilot host: the core coding tools (read, write, edit, bash) in the Chat's workspace, every
// tool and the model behind the pre-persistence redaction wrappers, the Workbench behaviors (Working Mode, ask_user,
// request_attention), and the Claude subscription (Pi's auth.json, pi-claude-code-use 2.2.1 payload rules) plus, for
// tests and trials, the scripted faux model. The Chat's model is stored per conversation and can be switched.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { claudeAliases, claudePayload, PiAuthStore } from "./claude.ts";
import { router } from "./faux.ts";
import { type Host, MODEL, openHost } from "./host.ts";
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
};

/** A Chat host plus the Workbench state PI WEB feeds (resources) and reads (signals). */
export type ChatHost = Host & {
	readonly workbench: { resources: Resources; onSignal: (signal: WorkbenchSignal) => void };
};

export function parseModel(model: string): { provider: string; modelId: string } {
	if (model === "faux") return MODEL;
	const [provider, modelId] = model.split("/", 2);
	if (provider === undefined || provider === "" || modelId === undefined || modelId === "") throw new Error(`Unsupported Durable Chat model ${model}`);
	return { provider, modelId };
}

/**
 * `providers.<id>.baseUrl` from Pi's models.json in the agent dir, which legacy Pi applies to that provider's built-in
 * models (a proxy, or the e2e mock in pi-web `e2e/mockModels/`). Unreadable or absent: the provider's own endpoint.
 * ponytail: only baseUrl is honored; headers, models and modelOverrides stay legacy-only until a Durable Chat needs them.
 */
export function modelsJsonBaseUrl(providerId: string, agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")): string | undefined {
	try {
		const config = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")) as { providers?: Record<string, { baseUrl?: unknown }> };
		const baseUrl = config.providers?.[providerId]?.baseUrl;
		return typeof baseUrl === "string" && baseUrl !== "" ? baseUrl : undefined;
	} catch {
		return undefined;
	}
}

/** The provider with every model served from `baseUrl`; unchanged when it is undefined. */
export function withBaseUrl<P extends Provider>(provider: P, baseUrl: string | undefined): P {
	if (baseUrl === undefined) return provider;
	return {
		...provider,
		baseUrl,
		getModels: () => provider.getModels().map((model) => ({ ...model, baseUrl })),
		...(provider.getAllModels === undefined ? {} : { getAllModels: () => provider.getAllModels!().map((model) => ({ ...model, baseUrl })) }),
	};
}

export async function openChatHost(options: ChatHostOptions): Promise<ChatHost> {
	const scripted = options.model === "faux" || options.scripted === true;
	// No paid API-key path may be taken silently: the subscription login in Pi's auth.json is the only credential.
	for (const name of Object.keys(process.env)) if (name.startsWith("ANTHROPIC_")) delete process.env[name];
	const workbench: ChatHost["workbench"] = { resources: {}, onSignal: () => {} };
	const aliases = claudeAliases("pi");
	const host = await openHost(options.dir, {
		faux: { tokensPerSecond: options.fauxTokensPerSecond ?? 200 },
		provider: () => withBaseUrl(anthropicProvider(), modelsJsonBaseUrl("anthropic")),
		providerOptions: { onPayload: claudePayload(aliases), canonicalToolName: aliases.toCanonical },
		credentials: new PiAuthStore(),
		rootAgent: { model: parseModel(options.model), cwd: options.cwd },
		env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? options.cwd }),
		extensions: [
			chatTools(() => workbench.resources),
			workbenchExtension({ chatId: options.chatId ?? options.dir, signal: (signal) => workbench.onSignal(signal) }),
		],
	});
	if (scripted) {
		// The scripted model takes no Claude payload rules: it is answered locally by the router.
		host.models.setProvider(wrapProvider(host.faux.provider));
		const step = router(options.dir);
		host.faux.setResponses(Array.from({ length: 10_000 }, () => step));
	}
	return Object.assign(host, { workbench });
}
