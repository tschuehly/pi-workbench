// One Durable Chat on the pilot host: the core coding tools (read, write, edit, bash) in the Chat's workspace, every
// tool and the model behind the pre-persistence redaction wrappers, and the model reached through the Claude
// subscription (Pi's auth.json, pi-claude-code-use 2.2.1 payload rules) or, for tests, the scripted faux model.
// Phase B slice 1: no Working Mode, ask_user, request_attention, model switching or Workbench extensions yet.
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { claudeAliases, claudePayload, PiAuthStore } from "./claude.ts";
import { router } from "./faux.ts";
import { type Host, MODEL, openHost } from "./host.ts";
import { redactingTool } from "./redact.ts";

export const PREAMBLE = [
	"You are a coding assistant working in the user's workspace through PI WEB.",
	"Use the read, write, edit and bash tools to inspect and change files; paths are relative to the working directory below.",
	"Keep answers short and concrete.",
].join("\n");

/** read has no external effect, so a crash mid-read may rerun it; write, edit and bash stay unsafe (never rerun). */
export const ChatTools = defineExtension({
	name: "workbench.chat",
	sections: [section("preamble", () => PREAMBLE, { tag: false }), section("cwd", (input) => input.env?.cwd)],
	tools: [{ ...createReadTool(), replay: "safe" as const }, createWriteTool(), createEditTool(), createBashTool()].map((tool) => redactingTool(tool)),
});

export type ChatHostOptions = {
	/** Family directory: session.sqlite, owner.json, work/. */
	readonly dir: string;
	/** The Chat's workspace: every tool call runs here. */
	readonly cwd: string;
	/** `anthropic/<model>` via the Claude subscription, or `faux` for tests (scripted by `faux.ts` `router`). */
	readonly model: string;
	/** Faux only: tokens per second of a streamed answer. */
	readonly fauxTokensPerSecond?: number;
};

export async function openChatHost(options: ChatHostOptions): Promise<Host> {
	if (options.model === "faux") {
		const host = await openHost(options.dir, {
			faux: { tokensPerSecond: options.fauxTokensPerSecond ?? 200 },
			rootAgent: { model: MODEL, cwd: options.cwd },
			env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? options.cwd }),
			extensions: [ChatTools],
		});
		const step = router(options.dir);
		host.faux.setResponses(Array.from({ length: 10_000 }, () => step));
		return host;
	}
	const [provider, modelId] = options.model.split("/", 2);
	if (provider !== "anthropic" || modelId === undefined || modelId === "") throw new Error(`Unsupported Durable Chat model ${options.model}`);
	// No paid API-key path may be taken silently: the subscription login in Pi's auth.json is the only credential.
	for (const name of Object.keys(process.env)) if (name.startsWith("ANTHROPIC_")) delete process.env[name];
	const aliases = claudeAliases("pi");
	return openHost(options.dir, {
		provider: () => anthropicProvider(),
		providerOptions: { onPayload: claudePayload(aliases), canonicalToolName: aliases.toCanonical },
		credentials: new PiAuthStore(),
		rootAgent: { model: { provider, modelId }, cwd: options.cwd },
		env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? options.cwd }),
		extensions: [ChatTools],
	});
}
