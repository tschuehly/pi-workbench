// Spike (a), offline part: the Claude subscription adapter's payload rules, alias canonicalization before Durable
// executes or stores a call, and refusal to refresh credentials. The one live request is scripts/claude-subscription-spike.ts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createModels, fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, defineExtension, defineTool, Harness } from "@earendil-works/pi-durable";
import { claudeAliases, claudePayload, PiAuthReadOnly } from "../src/claude.ts";
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

	it("an expired subscription credential is not refreshed by the pilot: no request, visible failure", async () => {
		const dir = scratch("claude-expired");
		const auth = join(dir, "auth.json");
		writeFileSync(auth, JSON.stringify({ anthropic: { type: "oauth", access: "sk-ant-oat01-fake", refresh: "sk-ant-ort01-fake", expires: Date.now() - 60_000 } }), { mode: 0o600 });
		const credentials = new PiAuthReadOnly(auth);
		let payloads = 0;
		const models = createModels({ credentials });
		models.setProvider(wrapProvider(anthropicProvider(), { onPayload: (p) => (payloads++, p) }));
		const store = await openStore(join(dir, "store", "session.sqlite"));
		const harness = await Harness.open(store.storage, { models, registry: createRegistry(), settings: { retry: { enabled: false } } }, context);
		const root = await harness.root(context, { agent: { model: { provider: "anthropic", modelId: "claude-haiku-5-5" } } });
		const settled = await (await root.submit({ type: "input", content: "hi" }, context)).wait(context);
		await harness.close(context);
		assert.equal(settled.status, "unanswered");
		assert.deepEqual(credentials.refreshAttempts, ["anthropic"], "refresh was requested and refused");
		assert.equal(payloads, 0, "no request was sent");
		assert.equal(readdirSync(dir).includes("auth.json"), true);
		assert.equal(JSON.parse(readFileSync(auth, "utf8")).anthropic.access, "sk-ant-oat01-fake", "credential file untouched");
	});
});

after(cleanup);
