// Spike (b): secrets are sanitized before Durable stores them — streaming model partials and tool output, including
// secrets split across chunks, a real bash process, and sanitizer failures. The proof is a byte scan of every store
// file (database, WAL, and the work directory) plus a spy on exactly what Durable received.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, hook, LiveDoc, type ToolRegistration, ToolTask } from "@earendil-works/pi-durable";
import { createBashTool } from "@earendil-works/pi-durable/tools";
import { textOfMessage } from "../src/faux.ts";
import { admit, context, type Host, openHost } from "../src/host.ts";
import { redact, redactingTool, type Sanitize, wrapProvider } from "../src/redact.ts";
import { cleanup, PACKAGE, scratch } from "./runner.ts";

const BODY = "Q7xVb2mNp4Lk9Rt3Wy6Hs8Jd1Fg5Zc0Ae";
const KEY = `sk-ant-api03-${BODY}`;
const ENV_SECRET = "pilotEnvSecret-7f3a9c2e5b8d1a64";
const results: Record<string, unknown> = {};

before(() => {
	// Hermetic: no real auth.json is read; a known env credential is.
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(scratch("redact-agent"), "agent-"));
	process.env.PILOT_FAKE_API_TOKEN = ENV_SECRET;
	process.env.PILOT_SPLIT_A = `sk-ant-api03-${BODY.slice(0, 12)}`;
	process.env.PILOT_SPLIT_B = BODY.slice(12);
});
after(() => {
	cleanup();
	writeFileSync(join(PACKAGE, "results", "redaction.json"), `${JSON.stringify(results, null, 2)}\n`);
});

/** Every file under dir (store, WAL, spill files) that contains a fragment of either secret (or of `extra`). */
function leaks(dir: string, extra: readonly string[] = []): string[] {
	const needles = [BODY.slice(0, 8), BODY.slice(-8), ENV_SECRET.slice(-10), ...extra];
	const found: string[] = [];
	const walk = (path: string) => {
		for (const name of readdirSync(path)) {
			const file = join(path, name);
			if (statSync(file).isDirectory()) walk(file);
			else {
				const bytes = readFileSync(file);
				for (const needle of needles) if (bytes.includes(needle)) found.push(`${name}:${needle}`);
			}
		}
	};
	walk(dir);
	return found;
}

/** Split the secret text into small streaming tokens. */
const SECRET_TEXT = `Here is the key ${KEY} and the token ${ENV_SECRET} done.`;

async function host(dir: string, options: { tools?: ToolRegistration[]; hooks?: boolean } = {}): Promise<Host> {
	const extensions = [defineExtension({ name: "spike.tools", tools: options.tools ?? [] })];
	if (options.hooks === true)
		extensions.push(
			defineExtension({
				name: "spike.throwing-after-tool",
				hooks: [
					hook(ToolTask, {
						afterTool: () => {
							throw new Error("sanitizer bug");
						},
					}),
				],
			}),
		);
	// openHost puts the redacting provider wrapper in front of the faux provider.
	return openHost(dir, {
		faux: { tokensPerSecond: 400, tokenSize: { min: 1, max: 3 } },
		settings: { progress: { partialIntervalMs: 1, outputIntervalMs: 1 } },
		extensions,
	});
}

/** Every committed partial (model text and tool output) as observers see it; `until` resolves on a match. */
async function watchPartials(h: Host, until?: (text: string) => boolean): Promise<{ seen: string[]; reached: Promise<void> }> {
	const seen: string[] = [];
	let reach!: () => void;
	const reached = new Promise<void>((resolve) => (reach = resolve));
	const watch = (await h.harness.watchDoc(LiveDoc, h.root.id, context))!;
	watch.start(async (value) => {
		const text = textOfMessage(value?.generation?.message as never);
		if (text !== "") seen.push(text);
		for (const tool of value?.tools ?? []) if (tool.output !== undefined) seen.push(tool.output);
		if (until !== undefined && seen.some(until)) reach();
	});
	return { seen, reached };
}

describe("pre-persistence redaction", () => {
	it("control: without the wrapper the scan finds the streamed secret", async () => {
		const dir = scratch("redact-control");
		const h = await openHost(dir);
		// Prove the scanner: commit the plaintext directly as an entry, bypassing every sanitizer.
		await h.root.submit({ type: "write", entry: { kind: "spike.plain", data: SECRET_TEXT } }, context);
		await h.close();
		const found = leaks(dir);
		results.control = { found };
		assert.ok(found.length > 0, "the byte scan detects plaintext secrets in the store");
	});

	it("model partials and the final answer are sanitized before commit, including split chunks and a close mid-stream", async () => {
		const dir = scratch("redact-model");
		let h = await host(dir);
		h.faux.setResponses([fauxAssistantMessage([fauxText(`${SECRET_TEXT} ${"filler ".repeat(200)}`)])]);
		const { seen, reached } = await watchPartials(h, (text) => text.includes("filler filler"));
		await admit(h.root, { operationId: "op-1", text: "say it" });
		// Close while streaming, once a committed partial is past both secrets: it becomes an aborted entry on reopen.
		await reached;
		await h.close();
		const midStream = leaks(dir);
		h = await host(dir);
		h.faux.setResponses([fauxAssistantMessage([fauxText(SECRET_TEXT)])]);
		h.resume();
		const record = await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-1"), context);
		const settled = await (await h.harness.submission(record!.id, context))!.wait(context);
		await h.close();
		const final = leaks(dir);
		const observedLeaks = seen.filter((s) => s.includes(BODY.slice(0, 6)) || s.includes(ENV_SECRET.slice(-6)));
		results.model = { partialsObserved: seen.length, observedLeaks: observedLeaks.length, midStream, final, settled: settled.status, redactedSample: seen.at(-1)?.slice(0, 120) };
		assert.ok(seen.length > 5, "several partials were committed while streaming");
		assert.deepEqual(observedLeaks, [], "no committed partial held a fragment of a secret");
		assert.deepEqual(midStream, [], "store clean after a close mid-stream");
		assert.equal(settled.status, "done");
		assert.deepEqual(final, [], "store clean after completion");
	});

	it("tool output split across chunks, details, diagnostics and a real bash process are sanitized before commit", async () => {
		const dir = scratch("redact-tool");
		const received: string[] = [];
		const splitter = redactingTool(
			defineTool({
				name: "splitter",
				description: "emits a secret in pieces",
				parameters: Type.Object({}),
				execute: async (_args, api, c) => {
					let sofar = "";
					for (const piece of ["start\nkey: sk-ant-api03-", BODY.slice(0, 10), BODY.slice(10, 20), `${BODY.slice(20)} tail\n`, `env ${ENV_SECRET.slice(0, 9)}`, `${ENV_SECRET.slice(9)}\n`]) {
						api.output(piece);
						sofar += piece;
						// Details are whole values; a pattern redactor sees each one complete (a lone fragment it cannot know).
						await api.details({ sofar }, c);
					}
					api.diagnostic({ severity: "info", message: `saw ${KEY}` });
					return {};
				},
			}),
		);
		// Spy on exactly what Durable receives from the wrapper.
		const spied = (tool: ToolRegistration): ToolRegistration => ({
			...tool,
			execute: (args, api, c) =>
				tool.execute(
					args,
					new Proxy(api, {
						get: (t, p) => {
							if (p === "output") return (chunk: string, skip?: never) => (received.push(String(chunk)), t.output(chunk, skip));
							if (p === "details") return (value: unknown, cc: never) => (received.push(JSON.stringify(value)), t.details(value as never, cc));
							if (p === "diagnostic") return (d: { message: string }) => (received.push(d.message), t.diagnostic(d as never));
							const value = Reflect.get(t, p, t) as unknown;
							return typeof value === "function" ? value.bind(t) : value;
						},
					}) as never,
					c,
				),
		});
		const bash = redactingTool(createBashTool());
		const h = await host(dir, { tools: [spied(splitter), bash] });
		h.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("splitter", {})], { stopReason: "toolUse" }),
			// The secret comes from the process, in two writes 200 ms apart; the command itself holds no secret.
			fauxAssistantMessage([fauxToolCall("bash", { command: `printf 'k=%s' "$PILOT_SPLIT_A"; sleep 0.2; printf '%s\\n' "$PILOT_SPLIT_B"; echo "$PILOT_FAKE_API_TOKEN"` })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		const { seen } = await watchPartials(h);
		await admit(h.root, { operationId: "op-1", text: "run" });
		const record = await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-1"), context);
		const settled = await (await h.harness.submission(record!.id, context))!.wait(context);
		const entries = (await h.root.entries({}, 100, undefined, context)).items;
		const toolResults = entries.filter((e) => e.kind === "pi.tool-result").map((e) => textOfMessage(e.model?.[0] as never));
		await h.close();
		const found = leaks(dir);
		results.tool = { received, toolResults, found, settled: settled.status, partialsObserved: seen.length };
		assert.equal(settled.status, "done");
		const fragments = [BODY.slice(0, 6), BODY.slice(10, 16), BODY.slice(-6), ENV_SECRET.slice(-6)];
		assert.ok(received.length >= 10, "output, details and diagnostics were all spied");
		assert.deepEqual(received.filter((chunk) => fragments.some((f) => chunk.includes(f))), [], "no raw fragment reached Durable on any channel");
		assert.ok(toolResults.every((t) => t.includes("[REDACTED:")), "both tools' results show redaction markers");
		assert.deepEqual(found, [], "store and work directory clean");
	});

	it("split PEM headers and retained-output reads between token fragments never commit a partial secret", async () => {
		const PEM_BODY = "MIIEpAIBAAKCAQEAsyntheticPemBodyA1b2C3d4E5f6";
		const PEM_TAIL = "MHcCAQEEIsyntheticPemTailZ9y8X7w6V5u4";
		const needles = ["syntheticPemBody", "syntheticPemTail"];
		const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
		const peeked: string[] = [];
		const tools = (wrap: boolean): ToolRegistration[] => {
			const w = (tool: ToolRegistration) => (wrap ? redactingTool(tool) : tool);
			return [
				// The PEM opening header is split at whitespace; the second key is cut off before its END line.
				w(
					defineTool({
						name: "pem",
						description: "prints keys in pieces",
						parameters: Type.Object({}),
						execute: async (_args, api) => {
							for (const piece of ["cert follows\n-----BEGIN RSA ", "PRIVATE KEY-----\n", `${PEM_BODY}\n`, `${PEM_BODY}\n`, "-----END RSA PRIVATE KEY-----\nnext ", "-----BEGIN EC ", "PRIVATE KEY-----\n", `${PEM_TAIL}\n`]) {
								api.output(piece);
								await pause();
							}
							return {};
						},
					}),
				),
				// Reads its retained output while a token is only half written.
				w(
					defineTool({
						name: "peek",
						description: "reads retained output mid-token",
						parameters: Type.Object({}),
						execute: async (_args, api) => {
							api.output(`token sk-ant-api03-${BODY.slice(0, 10)}`);
							peeked.push(api.retainedOutput().text);
							await pause();
							api.output(`${BODY.slice(10)} done\n`);
							await pause();
							return {};
						},
					}),
				),
			];
		};
		const run = async (wrap: boolean) => {
			const dir = scratch(`redact-split-${wrap}`);
			const h = await host(dir, { tools: tools(wrap) });
			h.faux.setResponses([
				fauxAssistantMessage([fauxToolCall("pem", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxToolCall("peek", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxText("done")]),
			]);
			const { seen } = await watchPartials(h);
			await admit(h.root, { operationId: "op-1", text: "run" });
			const record = await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-1"), context);
			const settled = await (await h.harness.submission(record!.id, context))!.wait(context);
			await h.close();
			const all = [...needles, BODY.slice(0, 8), BODY.slice(-8)];
			return {
				settled: settled.status,
				partials: seen.length,
				observed: [...new Set(seen.flatMap((s) => all.filter((n) => s.includes(n))))],
				found: leaks(dir, needles),
			};
		};
		const control = await run(false);
		const controlPeek = peeked.splice(0);
		const wrapped = await run(true);
		// Record whether the read was raw, not the raw text itself.
		results.splitStreams = { control: { ...control, peekedRaw: controlPeek.some((t) => t.includes(BODY.slice(0, 8))) }, wrapped: { ...wrapped, peeked } };
		assert.equal(control.settled, "done");
		assert.ok(control.found.some((f) => f.includes("syntheticPemBody")) && control.found.some((f) => f.includes(BODY.slice(0, 8))), "control: unwrapped, the scan finds both secrets in the store");
		assert.ok(control.observed.length > 0, "control: unwrapped, observers see the secrets in committed output");
		assert.equal(wrapped.settled, "done");
		assert.ok(wrapped.partials > 3, "tool output was committed while streaming");
		assert.deepEqual(wrapped.observed, [], "no committed LiveDoc output held a secret fragment");
		assert.ok(peeked.every((text) => !text.includes(BODY.slice(0, 8))), "retainedOutput never hands back an unsafe tail");
		assert.deepEqual(wrapped.found, [], "session.sqlite, WAL and work directory clean after close");
	});

	it("sanitizer errors fail closed: the model response and the tool call are withheld, never committed raw", async () => {
		const dir = scratch("redact-fail");
		let calls = 0;
		const flaky: Sanitize = (text) => {
			if (++calls > 3) throw new Error("sanitizer exploded");
			return redact(text);
		};
		const tool = redactingTool(
			defineTool({ name: "leaky", description: "leaks", parameters: Type.Object({}), execute: async (_a, api) => (api.output(`secret ${KEY}\n`), {}) }),
			() => {
				throw new Error("sanitizer exploded");
			},
		);
		const h = await openHost(dir, {
			faux: { tokensPerSecond: 400, tokenSize: { min: 1, max: 3 } },
			settings: { progress: { partialIntervalMs: 1 }, retry: { enabled: false } },
			extensions: [defineExtension({ name: "spike.leaky", tools: [tool] })],
			provider: (faux) => wrapProvider(faux, { sanitize: flaky }),
		});
		h.faux.setResponses([
			fauxAssistantMessage([fauxText(SECRET_TEXT)]),
			fauxAssistantMessage([fauxToolCall("leaky", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("after tool")]),
		]);
		await admit(h.root, { operationId: "op-model", text: "speak" });
		const model = await (await h.harness.submission((await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-model"), context))!.id, context))!.wait(context);
		calls = -1_000_000; // let the second request through the provider, so the tool's own sanitizer is tested
		await admit(h.root, { operationId: "op-tool", text: "use tool" });
		const toolRun = await (await h.harness.submission((await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-tool"), context))!.id, context))!.wait(context);
		const entries = (await h.root.entries({}, 100, undefined, context)).items;
		const toolResult = entries.filter((e) => e.kind === "pi.tool-result").map((e) => textOfMessage(e.model?.[0] as never));
		await h.close();
		const found = leaks(dir);
		results.sanitizerErrors = { model: { status: model.status, reason: model.status === "unanswered" ? model.reason : null }, toolResult, toolRun: toolRun.status, found };
		assert.equal(model.status, "unanswered", "a failing model sanitizer withholds the answer");
		assert.match(toolResult[0] ?? "", /Secret redaction failed; tool output withheld/);
		assert.deepEqual(found, [], "nothing raw reached storage");
	});

	it("documented boundary: tool-call arguments are stored verbatim (as with the current extension)", async () => {
		const dir = scratch("redact-args");
		const h = await host(dir, { tools: [redactingTool(createBashTool())] });
		h.faux.setResponses([fauxAssistantMessage([fauxToolCall("bash", { command: `echo ${KEY}` })], { stopReason: "toolUse" }), fauxAssistantMessage([fauxText("ok")])]);
		await admit(h.root, { operationId: "op-1", text: "go" });
		await (await h.harness.submission((await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-1"), context))!.id, context))!.wait(context);
		await h.close();
		const found = leaks(dir);
		results.argumentsBoundary = { found };
		assert.ok(found.length > 0, "a secret the model writes into tool arguments is stored; storage stays sensitive");
	});

	it("why not hooks: Durable skips a throwing afterTool hook and commits the raw result", async () => {
		const dir = scratch("redact-hook");
		const tool = defineTool({ name: "leaky", description: "leaks", parameters: Type.Object({}), execute: async () => ({ output: [{ type: "text", text: `secret ${KEY}` }] }) });
		const h = await host(dir, { tools: [tool], hooks: true });
		h.faux.setResponses([fauxAssistantMessage([fauxToolCall("leaky", {})], { stopReason: "toolUse" }), fauxAssistantMessage([fauxText("ok")])]);
		await admit(h.root, { operationId: "op-1", text: "go" });
		await (await h.harness.submission((await h.root.commit((tx) => tx.submissionByRequest(h.root.id, "op-1"), context))!.id, context))!.wait(context);
		const reports = h.reports.map((r) => r.type);
		await h.close();
		const found = leaks(dir);
		results.hookControl = { reports, found };
		assert.ok(reports.includes("extension_error"), "the hook error is only reported");
		assert.ok(found.length > 0, "and the unsanitized result was committed: hooks cannot be the security gate");
	});
});
