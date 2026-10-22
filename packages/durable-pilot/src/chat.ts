// One Durable Chat on the pilot host: the core coding tools (read, write, edit, bash) in the Chat's workspace, every
// tool and the model behind the pre-persistence redaction wrappers, the Workbench behaviors (Working Mode, ask_user,
// request_attention), and the Claude subscription (Pi's auth.json, pi-claude-code-use 2.2.1 payload rules) plus, for
// tests and trials, the scripted faux model. The Chat's model is stored per conversation and can be switched.
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { type CompactionSettings, defineExtension, section } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { claudeAliases, claudePayload, PiAuthStore } from "./claude.ts";
import { checkpointExtension } from "./checkpoint.ts";
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
	readonly workbench: { resources: Resources; onSignal: (signal: WorkbenchSignal) => void; compaction: CompactionSettings };
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
	const workbench: ChatHost["workbench"] = { resources: {}, onSignal: () => {}, compaction: DEFAULT_COMPACTION };
	const aliases = claudeAliases("pi");
	let opened: Host | undefined;
	const host = await openHost(options.dir, {
		faux: { tokensPerSecond: options.fauxTokensPerSecond ?? 200 },
		provider: () => anthropicProvider(),
		providerOptions: { onPayload: claudePayload(aliases), canonicalToolName: aliases.toCanonical },
		credentials: new PiAuthStore(),
		settings: { get compaction() { return workbench.compaction; } },
		rootAgent: { model: parseModel(options.model), cwd: options.cwd },
		env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? options.cwd }),
		extensions: [
			chatTools(() => workbench.resources),
			workbenchExtension({ chatId: options.chatId ?? options.dir, signal: (signal) => workbench.onSignal(signal) }),
			checkpointExtension(() => opened!.harness),
		],
	});
	opened = host;
	if (scripted) {
		// The scripted model takes no Claude payload rules: it is answered locally by the router.
		host.models.setProvider(wrapProvider(host.faux.provider));
		const step = router(options.dir);
		host.faux.setResponses(Array.from({ length: 10_000 }, () => step));
	}
	return Object.assign(host, { workbench });
}
