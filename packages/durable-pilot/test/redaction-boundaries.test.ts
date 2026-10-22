// The three redaction/reconciliation boundaries Phase A left open, each with a positive control:
// 1. bash spill files: the execution environment wrote the complete raw output to a temp file;
// 2. a details value ending in the leading fragment of a credential known only from the environment;
// 3. an unsafe nested tool call (executeTool) interrupted by a restart was not recorded for reconciliation.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { createBashTool } from "@earendil-works/pi-durable/tools";
import { readLog } from "../src/faux.ts";
import { admit, context, type Host, openHost } from "../src/host.ts";
import { effectTool, entriesOf, setHold } from "../src/pilot.ts";
import { redactingTool } from "../src/redact.ts";
import { cleanup, scratch } from "./runner.ts";

const ENV_SECRET = "boundaryEnvSecret-9d2c7a4e1f0b8c35";
const FRAGMENT = ENV_SECRET.slice(0, 22);

before(() => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(scratch("boundary-agent"), "agent-"));
	process.env.PILOT_BOUNDARY_TOKEN = ENV_SECRET;
});
after(() => cleanup());

function scan(paths: readonly string[], needles: readonly string[]): string[] {
	const found: string[] = [];
	const visit = (path: string) => {
		if (statSync(path).isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
		else {
			const bytes = readFileSync(path);
			for (const needle of needles) if (bytes.includes(needle)) found.push(`${path}:${needle}`);
		}
	};
	for (const path of paths) visit(path);
	return found;
}

/** `raw`: a control host that installs `tools` without the redacting wrapper every host otherwise adds. */
async function run(dir: string, tools: ToolRegistration[], steps: ReturnType<typeof fauxAssistantMessage>[], raw = false): Promise<Host> {
	const h = await openHost(dir, {
		rawTools: raw,
		faux: { tokensPerSecond: 400 },
		settings: { progress: { partialIntervalMs: 1, outputIntervalMs: 1 } },
		extensions: [defineExtension({ name: "boundary.tools", tools })],
	});
	h.faux.setResponses(steps);
	await admit(h.root, { operationId: "op-1", text: "go" });
	const record = await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-1"), context);
	await (await h.harness.submission(record!.id, context))!.wait(context);
	return h;
}

/** The spill file the bash result names in its `Full output:` diagnostic. */
async function spillPath(h: Host): Promise<string> {
	const entries = await entriesOf(h.harness, h.root.id);
	const result = entries.find((entry) => entry.kind === "pi.tool-result");
	const diagnostics = (result?.data as { diagnostics?: { message: string }[] } | undefined)?.diagnostics ?? [];
	const path = diagnostics.map((d) => /^Full output: (.+)$/.exec(d.message)?.[1]).find((p) => p !== undefined);
	assert.ok(path !== undefined, `bash spilled: ${JSON.stringify(diagnostics)}`);
	return path;
}

describe("redaction boundaries", () => {
	// The secret is printed first, then enough lines to exceed the retained tail, so it lives only in the spill file.
	const command = `echo "token $PILOT_BOUNDARY_TOKEN"; seq 1 6000`;
	const steps = () => [fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }), fauxAssistantMessage([fauxText("done")])];

	it("control: an unwrapped bash tool spills the raw secret to its full-output file", async () => {
		const dir = scratch("spill-control");
		const h = await run(dir, [createBashTool()], steps(), true);
		const path = await spillPath(h);
		await h.close();
		assert.ok(scan([path], [ENV_SECRET]).length > 0, "the scan finds the plaintext in the spill file");
	});

	it("bash spill files hold only sanitized output, and the full output is still complete", async () => {
		const dir = scratch("spill-wrapped");
		const h = await run(dir, [redactingTool(createBashTool())], steps());
		const path = await spillPath(h);
		await h.close();
		const spilled = readFileSync(path, "utf8");
		assert.deepEqual(scan([path, dir], [ENV_SECRET, ENV_SECRET.slice(-12)]), [], "neither the spill file nor the store holds the secret");
		assert.match(spilled, /^token \[REDACTED:env:PILOT_BOUNDARY_TOKEN\]\n1\n2\n/, "the spill starts with the sanitized first line");
		assert.match(spilled, /\n6000\n$/, "and ends with the last line");
		assert.equal((statSync(path).mode & 0o777).toString(8), "600", "owner-only");
	});

	const fragmentTool = (wrap: boolean) => {
		const tool = defineTool({
			name: "progress",
			description: "reports a value as it is typed",
			parameters: Type.Object({}),
			execute: async (_args, api, c) => {
				// Whole details values that end in the first characters of an env-only credential; the last one becomes the
				// result's details.
				await api.details({ typed: `export TOKEN=${FRAGMENT.slice(0, 12)}` }, c);
				await new Promise((resolve) => setTimeout(resolve, 50));
				await api.details({ typed: `export TOKEN=${FRAGMENT}` }, c);
				return { output: [{ type: "text" as const, text: "typed" }] };
			},
		});
		return wrap ? redactingTool(tool) : tool;
	};
	const fragmentSteps = () => [fauxAssistantMessage([fauxToolCall("progress", {})], { stopReason: "toolUse" }), fauxAssistantMessage([fauxText("done")])];

	it("control: an unwrapped tool commits the leading fragment of an env-only credential in its details", async () => {
		const dir = scratch("fragment-control");
		const h = await run(dir, [fragmentTool(false)], fragmentSteps(), true);
		await h.close();
		assert.ok(scan([dir], [FRAGMENT]).length > 0, "the scan finds the fragment in the store");
	});

	it("a details value ending in the leading fragment of an env-only credential is masked before commit", async () => {
		const dir = scratch("fragment-wrapped");
		const h = await run(dir, [fragmentTool(true)], fragmentSteps());
		await h.close();
		assert.deepEqual(scan([dir], [FRAGMENT, ENV_SECRET.slice(0, 16)]), [], "store and work directory clean");
	});
});

describe("nested unsafe tool calls", () => {
	it("an unsafe nested call interrupted by a restart is recorded for reconciliation and blocks a fresh call", async () => {
		const dir = scratch("nested");
		const deploy = effectTool(dir, "deploy", "unsafe");
		const outer = defineTool({
			name: "release",
			description: "runs deploy as a nested call",
			parameters: Type.Object({}),
			replay: "unsafe",
			execute: async (_args, api, c) => {
				const result = await api.executeTool("deploy", { target: "prod" }, c);
				return { output: [{ type: "text" as const, text: `nested ${result.isError ? "failed" : "ok"}` }] };
			},
		});
		const tools = [deploy, outer];
		let entered!: () => void;
		const inside = new Promise<void>((resolve) => (entered = resolve));
		// Hold the nested deploy after its effect until the close cancels it.
		setHold(async (name, signal) => {
			if (name !== "tool:deploy") return;
			entered();
			await new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("closed")), { once: true }));
		});
		let h = await openHost(dir, { extensions: [defineExtension({ name: "boundary.nested", tools })] });
		h.faux.setResponses([fauxAssistantMessage([fauxToolCall("release", {})], { stopReason: "toolUse" })]);
		await admit(h.root, { operationId: "op-1", text: "release" });
		await inside;
		await h.close();
		setHold(async () => {});

		h = await openHost(dir, { extensions: [defineExtension({ name: "boundary.nested", tools })] });
		const uncertain = [...h.uncertain];
		h.faux.setResponses([
			fauxAssistantMessage([fauxText("after restart")]),
			fauxAssistantMessage([fauxToolCall("deploy", { target: "prod" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		await h.resume();
		await admit(h.root, { operationId: "op-2", text: "deploy again" });
		const record = await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-2"), context);
		await (await h.harness.submission(record!.id, context))!.wait(context);
		const results = (await entriesOf(h.harness, h.root.id)).filter((e) => e.kind === "pi.tool-result").map((e) => JSON.stringify(e.model?.[0]));
		await h.close();
		const effects = readLog<{ tool: string }>(join(dir, "effects.log")).filter((line) => line.tool === "deploy");
		assert.equal(uncertain.length, 2, `the outer call and its nested deploy are both recorded: ${JSON.stringify(uncertain)}`);
		assert.ok(results.some((text) => text.includes("Needs reconciliation")), `a fresh deploy is blocked: ${results.join("\n")}`);
		assert.equal(effects.length, 1, "the effect ran once");
	});
});
