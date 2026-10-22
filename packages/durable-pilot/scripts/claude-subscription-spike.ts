// Spike (a), live: ONE real request on Durable through Thomas's existing Claude subscription login (Pi's auth.json,
// read-only), no API key. A flat custom tool goes out as an mcp__ alias, the call comes back canonical, runs, and
// terminates the run so no second request is sent. Only allowlisted metadata is printed or written: never tokens,
// headers' secret values, or the payload. Run with PILOT_LIVE_CLAUDE=1.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createModels, Type } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, defineExtension, defineTool, Harness, UsageDoc } from "@earendil-works/pi-durable";
import { claudeAliases, claudePayload, PiAuthStore } from "../src/claude.ts";
import { textOfMessage } from "../src/faux.ts";
import { context } from "../src/host.ts";
import { wrapProvider } from "../src/redact.ts";
import { openStore } from "../src/store.ts";

if (process.env.PILOT_LIVE_CLAUDE !== "1") {
	console.log("Dry run. Set PILOT_LIVE_CLAUDE=1 to send one real request with the local Claude subscription login.");
	process.exit(0);
}
const MODEL = process.env.PILOT_CLAUDE_MODEL ?? "claude-haiku-5-5";

// No API-key path may be taken silently: drop every Anthropic env credential for this process.
const envCredentialNames = Object.keys(process.env).filter((name) => name.startsWith("ANTHROPIC_"));
for (const name of envCredentialNames) delete process.env[name];

const credentials = new PiAuthStore();
const credential = await credentials.read("anthropic");
if (credential?.type !== "oauth") throw new Error("No Anthropic OAuth (subscription) login in Pi's auth.json");
const minutesLeft = Math.round((credential.expires - Date.now()) / 60_000);
if (minutesLeft < 10) throw new Error(`Subscription token expires in ${minutesLeft} min; refresh it with the installed Pi first`);
const tokenPrefixOk = credential.access.startsWith("sk-ant-oat");

const aliases = claudeAliases();
const rewrite = claudePayload(aliases);
const wire: { requests: number; toolNames: string[]; claudeCodeIdentity: boolean } = { requests: 0, toolNames: [], claudeCodeIdentity: false };
const response: { status?: number; unifiedHeaders: string[]; unifiedStatus?: string } = { unifiedHeaders: [] };
const models = createModels({ credentials });
models.setProvider(
	wrapProvider(anthropicProvider(), {
		onPayload: (payload) => {
			const out = rewrite(payload) as { tools?: { name: string }[]; system?: { text?: string }[] };
			wire.requests++;
			wire.toolNames = (out.tools ?? []).map((t) => t.name);
			wire.claudeCodeIdentity = (out.system ?? []).some((b) => b.text?.startsWith("You are Claude Code") === true);
			return out;
		},
		onResponse: (r) => {
			response.status = r.status;
			const names = Object.keys(r.headers).map((h) => h.toLowerCase());
			response.unifiedHeaders = names.filter((h) => h.startsWith("anthropic-ratelimit-unified")).sort();
			response.unifiedStatus = r.headers["anthropic-ratelimit-unified-status"];
		},
		canonicalToolName: aliases.toCanonical,
	}),
);

let executed = 0;
const echo = defineTool({
	name: "pilot_echo",
	description: "Echo a short text back. Call it exactly once.",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (args) => {
		executed++;
		return { output: [{ type: "text", text: `echo: ${args.text}` }], control: { terminate: true } };
	},
});
const registry = createRegistry();
registry.install(defineExtension({ name: "pilot.echo", tools: [echo] }));

const dir = mkdtempSync(join(process.env.PI_TMP ?? join(import.meta.dirname, "..", ".runs"), "claude-spike-"));
const store = await openStore(join(dir, "session.sqlite"));
const harness = await Harness.open(store.storage, { models, registry, settings: { retry: { enabled: false } } }, context);
const root = await harness.root(context, {
	agent: { model: { provider: "anthropic", modelId: MODEL }, thinkingLevel: "off", instructions: "Call the pilot_echo tool once with text \"durable-pilot\". Do not write any other text." },
});
const started = Date.now();
const settled = await (await root.submit({ type: "input", content: "Run the echo tool now.", requestId: "spike-1" }, context)).wait(context);
const entries = [...(await root.entries({}, 50, undefined, context)).items].reverse();
const usage = await harness.snapshot(UsageDoc, root.id, context);
await harness.close(context);

const stored = readFileSync(join(dir, "session.sqlite"));
const assistant = entries.find((e) => e.kind === "pi.assistant")?.model?.[0] as { content: { type: string; name?: string }[]; stopReason: string; errorMessage?: string } | undefined;
const result = {
	measuredAt: new Date().toISOString(),
	versions: { "pi-durable": "1.4.0", "pi-ai": "1.4.0", model: MODEL, piClaudeCodeUseRulesFrom: "2.2.1" },
	credential: { source: "Pi auth.json", type: credential.type, subscriptionTokenShape: tokenPrefixOk, minutesLeftAtStart: minutesLeft, anthropicEnvVarsRemoved: envCredentialNames.length },
	wire,
	response,
	run: {
		status: settled.status,
		...(settled.status === "unanswered" ? { reason: settled.reason } : {}),
		ms: Date.now() - started,
		stopReason: assistant?.stopReason,
		errorMessage: assistant?.errorMessage?.slice(0, 200),
		storedToolCallNames: (assistant?.content ?? []).filter((c) => c.type === "toolCall").map((c) => c.name),
		toolExecutions: executed,
		toolResult: textOfMessage(entries.find((e) => e.kind === "pi.tool-result")?.model?.[0] as never),
		entryKinds: entries.map((e) => e.kind),
	},
	usage: usage?.models ?? null,
	store: { accessTokenInStore: stored.includes(credential.access), aliasInStore: stored.includes("mcp__pilot__") },
};
writeFileSync(join(import.meta.dirname, "..", "results", "claude-spike.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
rmSync(dir, { recursive: true, force: true });
