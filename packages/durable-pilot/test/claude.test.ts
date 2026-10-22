// Spike (a), offline part: the Claude subscription adapter's payload rules, alias canonicalization before Durable
// executes or stores a call, and refresh through Pi's locked auth.json. The one live request is scripts/claude-subscription-spike.ts.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createModels, fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, defineExtension, defineTool, Harness } from "@earendil-works/pi-durable";
import { modelsJsonBaseUrl, withBaseUrl } from "../src/providers.ts";
import { claudeAliases, claudePayload, PiAuthStore } from "../src/claude.ts";
import { textOfMessage } from "../src/faux.ts";
import { admit, context, openHost } from "../src/host.ts";
import { wrapProvider } from "../src/redact.ts";
import { openStore } from "../src/store.ts";
import { cleanup, scratch } from "./runner.ts";

const echo = defineTool({
	name: "pilot_echo",
	description: "Echo text back",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (args) => ({ output: [{ type: "text", text: `echo: ${args.text}` }], control: { terminate: true } }),
});

describe("claude subscription adapter (offline)", () => {
	it("rewrites flat custom tool names to mcp__ aliases on the wire, keeps core tools and prompt rules", () => {
		const aliases = claudeAliases();
		const out = claudePayload(aliases)({
			system: [{ type: "text", text: "Ask pi itself about pi packages" }],
			tools: [{ name: "Bash" }, { name: "pilot_echo" }, { name: "mcp__other__x" }, { name: "__pi_deferred_placeholder__" }],
			tool_choice: { type: "tool", name: "pilot_echo" },
			messages: [{ role: "assistant", content: [{ type: "tool_use", name: "pilot_echo", id: "t", input: {} }] }],
		}) as any;
		assert.equal(out.system[0].text, "Ask the cli itself about cli packages");
		// The live spike (results/claude-spike.json) ran before the placeholder rule and sent it aliased; fixed here.
		assert.deepEqual(out.tools.map((t: any) => t.name), ["Bash", "mcp__pilot__pilot_echo", "mcp__other__x", "__pi_deferred_placeholder__"]);
		assert.equal(out.tool_choice.name, "mcp__pilot__pilot_echo");
		assert.equal(out.messages[0].content[0].name, "mcp__pilot__pilot_echo");
		assert.equal(aliases.toCanonical("mcp__pilot__pilot_echo"), "pilot_echo");
		assert.equal(aliases.toCanonical("mcp__other__x"), "mcp__other__x", "foreign mcp__ tools are left alone");
	});

	it("an aliased tool call is canonical before Durable executes and stores it", async () => {
		const dir = scratch("claude-alias");
		const aliases = claudeAliases();
		aliases.toWire("pilot_echo");
		const host = await openHost(dir, {
			extensions: [defineExtension({ name: "echo", tools: [echo] })],
			provider: (faux) => wrapProvider(faux, { canonicalToolName: aliases.toCanonical, sanitize: (t) => t }),
		});
		host.faux.setResponses([fauxAssistantMessage([fauxToolCall("mcp__pilot__pilot_echo", { text: "hi" })], { stopReason: "toolUse" }), fauxAssistantMessage([fauxText("unused")])]);
		const id = await admit(host.root, { operationId: "op-1", text: "echo" });
		const settled = await (await host.harness.submission(id, context))!.wait(context);
		const entries = [...(await host.root.entries({}, 100, undefined, context)).items].reverse();
		await host.close();
		const stored = readFileSync(join(dir, "session.sqlite"));
		assert.equal(settled.status, "done");
		const call = (entries.find((e) => e.kind === "pi.assistant")!.model![0] as any).content[0];
		assert.equal(call.name, "pilot_echo");
		assert.equal(textOfMessage(entries.find((e) => e.kind === "pi.tool-result")!.model![0] as never), "echo: hi");
		assert.equal(entries.filter((e) => e.kind === "pi.assistant").length, 1, "terminate: no second model request");
		assert.equal(stored.includes("mcp__pilot__"), false, "the wire alias never reaches the store");
	});

	it("colliding tool names get distinct, reversible aliases: the call runs the tool the model chose", async () => {
		const dir = scratch("claude-collide");
		const ran: string[] = [];
		const tool = (name: string) =>
			defineTool({ name, description: name, parameters: Type.Object({}), execute: async () => (ran.push(name), { output: [{ type: "text", text: `ran ${name}` }], control: { terminate: true } }) });
		const aliases = claudeAliases();
		const wire = (claudePayload(aliases)({ tools: [{ name: "review-deploy" }, { name: "review_deploy" }, { name: "__pi_deferred_placeholder__" }] }) as any).tools.map((t: any) => t.name);
		const host = await openHost(dir, {
			extensions: [defineExtension({ name: "collide", tools: [tool("review-deploy"), tool("review_deploy")] })],
			provider: (faux) => wrapProvider(faux, { canonicalToolName: aliases.toCanonical, sanitize: (t) => t }),
		});
		host.faux.setResponses([fauxAssistantMessage([fauxToolCall(wire[0], {})], { stopReason: "toolUse" }), fauxAssistantMessage([fauxText("unused")])]);
		const id = await admit(host.root, { operationId: "op-1", text: "deploy" });
		const settled = await (await host.harness.submission(id, context))!.wait(context);
		await host.close();
		assert.equal(settled.status, "done");
		assert.deepEqual(ran, ["review-deploy"], "the first tool's alias runs the first tool, not its collision");
		assert.equal(new Set(wire.map((n: string) => n.toLowerCase())).size, 3, `distinct wire names: ${wire.join(", ")}`);
		assert.equal(wire[2], "__pi_deferred_placeholder__", "the placeholder stays unaliased");
		assert.deepEqual([aliases.toCanonical(wire[0]), aliases.toCanonical(wire[1])], ["review-deploy", "review_deploy"], "each alias maps back to its own tool");
	});

	it("Claude Code tool names come back as the registered core tool: pi-ai's Bash → bash is never re-cased", () => {
		const aliases = claudeAliases();
		// pi-ai renames core tools to Claude Code casing for OAuth before onPayload, and back before the wrapper sees the call.
		const wire = (claudePayload(aliases)({ tools: [{ name: "Bash" }, { name: "Read" }, { name: "custom-tool" }] }) as any).tools.map((t: any) => t.name);
		assert.deepEqual(wire, ["Bash", "Read", "mcp__pilot__custom_tool"]);
		assert.deepEqual(["bash", "read", "mcp__pilot__custom_tool"].map(aliases.toCanonical), ["bash", "read", "custom-tool"]);
	});

	it("a failed refresh of an expired login fails the turn visibly: no model request, auth.json untouched", async () => {
		const dir = scratch("claude-expired");
		const auth = join(dir, "auth.json");
		writeFileSync(auth, JSON.stringify({ anthropic: { type: "oauth", access: "fake-oat-expired", refresh: "fake-ort-1", expires: Date.now() - 60_000 } }), { mode: 0o600 });
		const before = readFileSync(auth, "utf8");
		const credentials = new PiAuthStore(auth);
		let payloads = 0;
		let refreshes = 0;
		const realFetch = globalThis.fetch;
		// The OAuth endpoint fails; every other request is refused, so nothing leaves the machine.
		globalThis.fetch = (async (input: string | URL | Request) => {
			if (String(input instanceof Request ? input.url : input) === "https://platform.claude.com/v1/oauth/token") {
				refreshes++;
				return new Response('{"error":"server_error"}', { status: 500 });
			}
			throw new Error("network blocked by test");
		}) as typeof fetch;
		try {
			const models = createModels({ credentials });
			models.setProvider(wrapProvider(anthropicProvider(), { onPayload: (p) => (payloads++, p) }));
			const store = await openStore(join(dir, "store", "session.sqlite"));
			const harness = await Harness.open(store.storage, { models, registry: createRegistry(), settings: { retry: { enabled: false } } }, context);
			const root = await harness.root(context, { agent: { model: { provider: "anthropic", modelId: "claude-haiku-5-5" } } });
			const settled = await (await root.submit({ type: "input", content: "hi" }, context)).wait(context);
			await harness.close(context);
			assert.equal(settled.status, "unanswered");
			assert.equal(refreshes, 1, "one refresh attempt");
			assert.equal(payloads, 0, "no model request was sent");
			assert.equal(readFileSync(auth, "utf8"), before, "credential file untouched");
			assert.equal(statSync(auth).mode & 0o777, 0o600);
			assert.equal(existsSync(`${auth}.lock`), false, "lock released");
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});

describe("models.json baseUrl (as legacy Pi honors it)", () => {
	it("serves every anthropic model from the agent dir's providers.anthropic.baseUrl, and only then", () => {
		const agentDir = scratch("models-json");
		assert.equal(modelsJsonBaseUrl("anthropic", agentDir), undefined, "no models.json");
		assert.equal(withBaseUrl(anthropicProvider(), undefined).getModels()[0]?.baseUrl, "https://api.anthropic.com");
		writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { anthropic: { baseUrl: "http://127.0.0.1:9" } } }));
		assert.equal(modelsJsonBaseUrl("openai-codex", agentDir), undefined);
		const provider = withBaseUrl(anthropicProvider(), modelsJsonBaseUrl("anthropic", agentDir));
		assert.ok(provider.getModels().length > 0);
		assert.ok(provider.getModels().every((model) => model.baseUrl === "http://127.0.0.1:9"));
		const models = createModels();
		models.setProvider(provider);
		assert.equal(models.getModel("anthropic", "claude-sonnet-5-5")?.baseUrl, "http://127.0.0.1:9");
	});
});

after(cleanup);
