// Secrets split across content blocks (second code review N1, N2): a reader sees an assistant message's text blocks, and
// a tool result's, as one text, so a credential or private key split across blocks must be masked as if it were whole.
// Reviewer reproductions through a real host and its store, positive controls, then a fuzz: each secret split at every
// character position across 2 and 3 blocks, for assistant text (every streamed partial and the final message) and
// tool-result content arrays; no 6-character fragment of a secret survives in what Durable receives or in store bytes.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
	type Provider,
	Type,
} from "@earendil-works/pi-ai";
import { defineExtension, defineTool, LiveDoc } from "@earendil-works/pi-durable";
import { textOfMessage } from "../src/faux.ts";
import { admit, context, type Host, openHost } from "../src/host.ts";
import { entriesOf } from "../src/pilot.ts";
import { redact, redactingTool, sanitizeDeep, wrapProvider } from "../src/redact.ts";
import { cleanup, scratch } from "./runner.ts";

const DASH = "-----";
const PEM = [`${DASH}BEGIN EC PRIVATE KEY${DASH}`, "MHcCAQEEIsplitFuzzPemBodyQ1w2E3r4T5y6", "U7i8O9p0splitFuzzPemTailA1s2D3f4", `${DASH}END EC PRIVATE KEY${DASH}`].join("\n");
const ENV_SECRET = "splitEnvSecret-4c9e1a7b3d5f8a20";
const PATTERN_KEY = `ghp_${"Zq8Lm3Nx7Rv2Tb5Wc9Yd4Fh6Jk1Gs0Pa"}`;
const SECRETS = { pem: PEM, env: ENV_SECRET, pattern: PATTERN_KEY } as const;
const LEAD = "lead ";
const TRAIL = " trail";

before(() => {
	// Hermetic: no real auth.json is read; one secret is known only as an environment value.
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(scratch("split-agent"), "agent-"));
	process.env.PILOT_SPLIT_FUZZ_TOKEN = ENV_SECRET;
});
after(() => cleanup());

/** Every 6-character fragment of a secret. */
const fragments = (secret: string) => [...new Set(Array.from({ length: secret.length - 5 }, (_, i) => secret.slice(i, i + 6)))];
const FRAGMENTS = Object.values(SECRETS).flatMap(fragments);
/** The fragments a text holds. */
const holds = (text: string, secret?: string) => (secret === undefined ? FRAGMENTS : fragments(secret)).filter((f) => text.includes(f));

/** Every file under dir holding a fragment; newlines in fragments are also searched JSON-escaped. */
function storeLeaks(dir: string, secrets: readonly string[] = Object.values(SECRETS)): string[] {
	const needles = [...new Set(secrets.flatMap(fragments).flatMap((f) => (f.includes("\n") ? [f, f.replaceAll("\n", "\\n")] : [f])))];
	const found: string[] = [];
	const walk = (path: string) => {
		for (const name of readdirSync(path)) {
			const file = join(path, name);
			if (statSync(file).isDirectory()) walk(file);
			else {
				const bytes = readFileSync(file);
				for (const needle of needles) if (bytes.includes(needle)) found.push(`${name}:${JSON.stringify(needle)}`);
			}
		}
	};
	walk(dir);
	return found;
}

/** `text` split at the given positions (ascending, within the text). */
const split = (text: string, at: readonly number[]) => [0, ...at].map((from, i) => text.slice(from, at[i] ?? text.length));

/** Each secret placed in prose, split into 2 blocks at every position in it, and into 3 at every pair of positions. */
function cases(blocks: 2 | 3): { secret: string; parts: string[] }[] {
	const out: { secret: string; parts: string[] }[] = [];
	for (const secret of Object.values(SECRETS)) {
		const text = `${LEAD}${secret}${TRAIL}`;
		const positions = Array.from({ length: secret.length + 1 }, (_, i) => LEAD.length + i);
		if (blocks === 2) for (const p of positions) out.push({ secret, parts: split(text, [p]) });
		else for (const p of positions) for (const q of positions) if (q > p) out.push({ secret, parts: split(text, [p, q]) });
	}
	return out;
}

const message = (texts: readonly string[]): AssistantMessage => ({
	role: "assistant",
	content: texts.map((text) => ({ type: "text" as const, text })),
	api: "fake",
	provider: "fake",
	model: "fake",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: 0,
});

/**
 * What the redacting provider hands Durable for one message streamed block by block, character by character: the text
 * blocks of every partial and of the final message.
 */
async function streamed(parts: readonly string[]): Promise<string[][]> {
	const events: AssistantMessageEvent[] = [];
	for (let k = 0; k < parts.length; k++)
		for (let n = 1; n <= parts[k]!.length; n++) events.push({ type: "text_delta", contentIndex: k, delta: "", partial: message([...parts.slice(0, k), parts[k]!.slice(0, n)]) });
	events.push({ type: "done", reason: "stop", message: message(parts) });
	const source = createAssistantMessageEventStream();
	for (const event of events) source.push(event);
	source.end();
	const inner = { id: "fake", name: "fake", auth: undefined, getModels: () => [], stream: () => source, streamSimple: () => source } as unknown as Provider;
	const seen: string[][] = [];
	for await (const event of wrapProvider(inner).stream({ api: "fake", provider: "fake", id: "fake" } as never, { messages: [] } as never, undefined)) {
		const out = event.type === "done" ? event.message : event.type === "error" ? event.error : event.partial;
		seen.push(out.content.flatMap((block) => (block.type === "text" ? [block.text] : [])));
	}
	return seen;
}

/** What a registered tool returning `parts` as text blocks hands Durable. */
async function toolResult(parts: readonly string[]): Promise<string[]> {
	const tool = redactingTool(defineTool({ name: "t", description: "t", parameters: Type.Object({}), execute: async () => ({ output: parts.map((text) => ({ type: "text" as const, text })) }) }));
	const result = (await tool.execute({} as never, {} as never, context as never)) as { output: { type: string; text: string }[] };
	return result.output.map((block) => block.text);
}

/** Commit texts as entries of a fresh store, close it, and return the files holding a fragment. */
async function committed(texts: Iterable<string>): Promise<string[]> {
	const dir = scratch("split-store");
	const h = await openHost(dir);
	const all = [...texts];
	for (let i = 0; i < all.length; i += 2_000) await h.root.commit((tx) => tx.appendEntry(h.root.id, { kind: "fuzz.output", data: all.slice(i, i + 2_000) }), context);
	await h.close();
	return storeLeaks(dir);
}

/** Run one turn of a host to completion. */
async function turn(h: Host, operationId: string): Promise<void> {
	await admit(h.root, { operationId, text: "go" });
	const record = await h.root.commit((tx) => tx.submissionByRequest(h.root.id, operationId), context);
	assert.equal((await (await h.harness.submission(record!.id, context))!.wait(context)).status, "done");
}

/** Every committed LiveDoc text (generation partials and tool output) while `run` runs. */
async function watched(h: Host, run: () => Promise<void>): Promise<string[]> {
	const seen: string[] = [];
	const watch = (await h.harness.watchDoc(LiveDoc, h.root.id, context))!;
	watch.start(async (value) => {
		for (const block of (value?.generation?.message?.content ?? []) as { type: string; text?: string }[]) if (block.type === "text") seen.push(block.text ?? "");
		for (const tool of value?.tools ?? []) if (tool.output !== undefined) seen.push(tool.output);
	});
	await run();
	await watch.stop();
	return seen;
}

describe("secrets split across content blocks", () => {
	it("controls: each half alone is no secret, the whole secret is masked, and a whole private key in one block is masked", () => {
		assert.equal(redact(`${LEAD}${ENV_SECRET.slice(0, 15)}`), `${LEAD}${ENV_SECRET.slice(0, 15)}`);
		assert.equal(redact(`${ENV_SECRET.slice(15)}${TRAIL}`), `${ENV_SECRET.slice(15)}${TRAIL}`);
		assert.equal(redact(`${LEAD}${ENV_SECRET}${TRAIL}`), `${LEAD}[REDACTED:env:PILOT_SPLIT_FUZZ_TOKEN]${TRAIL}`);
		assert.equal(redact(`${LEAD}${PEM}${TRAIL}`), `${LEAD}[REDACTED:private-key]${TRAIL}`);
		// The opening header split at its space: neither block alone holds a complete private-key block.
		const at = PEM.indexOf(" PRIVATE");
		assert.equal(redact(`${LEAD}${PEM.slice(0, at)}`), `${LEAD}${PEM.slice(0, at)}`);
		assert.equal(redact(`${PEM.slice(at)}${TRAIL}`), `${PEM.slice(at)}${TRAIL}`);
	});

	it("N1: a private key whose opening header is split at whitespace across assistant text blocks reaches neither the answer nor the store; signed thinking stays byte-for-byte", async () => {
		const dir = scratch("split-n1");
		const h = await openHost(dir, { faux: { tokensPerSecond: 2_000, tokenSize: { min: 1, max: 4 } }, settings: { progress: { partialIntervalMs: 1 } } });
		const at = PEM.indexOf(" PRIVATE");
		const thinking = { ...fauxThinking("weighing how to answer"), thinkingSignature: "sig-unrelated-0001" };
		h.faux.setResponses([fauxAssistantMessage([thinking, fauxText(`header split: ${PEM.slice(0, at)}`), fauxText(`${PEM.slice(at)} after`)])]);
		const seen = await watched(h, () => turn(h, "op-1"));
		const answer = (await entriesOf(h.harness, h.root.id)).flatMap((entry) => ((entry.model?.[0] as { role?: string } | undefined)?.role === "assistant" ? [entry.model![0] as AssistantMessage] : []))[0]!;
		await h.close();
		assert.equal(textOfMessage(answer), "header split: [REDACTED:private-key] after");
		assert.deepEqual(answer.content[0], thinking, "the signed thinking block is unchanged");
		assert.deepEqual(seen.flatMap((text) => holds(text, PEM)), [], "no committed partial holds a fragment of the key");
		assert.deepEqual(storeLeaks(dir, [PEM]), [], "session.sqlite and WAL hold no fragment of the key");
	});

	it("N2: a known credential a registered tool returns split across text blocks is stored masked; the whole credential is the control", async () => {
		const dir = scratch("split-n2");
		const leaky = defineTool({
			name: "leaky",
			description: "returns a credential in pieces",
			parameters: Type.Object({ whole: Type.Boolean() }),
			execute: async ({ whole }) => ({
				output: whole
					? [{ type: "text" as const, text: `${LEAD}${ENV_SECRET}${TRAIL}` }]
					: [{ type: "text" as const, text: `${LEAD}${ENV_SECRET.slice(0, 11)}` }, { type: "text" as const, text: ENV_SECRET.slice(11, 22) }, { type: "text" as const, text: `${ENV_SECRET.slice(22)}${TRAIL}` }],
			}),
		});
		// Registered through the host's registry, as installed packages are: the registry puts it behind redaction.
		const h = await openHost(dir, { extensions: [defineExtension({ name: "split.tools", tools: [leaky] })] });
		h.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("leaky", { whole: true })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("ok")]),
			fauxAssistantMessage([fauxToolCall("leaky", { whole: false })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("ok")]),
		]);
		await turn(h, "op-whole");
		await turn(h, "op-split");
		const results = (await entriesOf(h.harness, h.root.id)).flatMap((entry) => ((entry.model?.[0] as { role?: string } | undefined)?.role === "toolResult" ? [textOfMessage(entry.model![0] as never)] : []));
		await h.close();
		assert.equal(results.length, 2);
		assert.equal(results[0], `${LEAD}[REDACTED:env:PILOT_SPLIT_FUZZ_TOKEN]${TRAIL}`, "control: the whole credential is masked");
		assert.equal(results[1]!.replaceAll("\n", ""), `${LEAD}[REDACTED:env:PILOT_SPLIT_FUZZ_TOKEN]${TRAIL}`, "the split credential is masked as one");
		assert.deepEqual(storeLeaks(dir, [ENV_SECRET]), [], "session.sqlite and WAL hold no fragment of the credential");
	});

	it("shared sanitizer: content arrays a package sends are masked across blocks, images and signed thinking untouched", () => {
		const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
		const thinking = { type: "thinking", thinking: "x", thinkingSignature: "s" };
		const out = sanitizeDeep([{ type: "text", text: `${LEAD}${PATTERN_KEY.slice(0, 9)}` }, image, thinking, { type: "text", text: `${PATTERN_KEY.slice(9)}${TRAIL}` }], redact);
		assert.deepEqual(out, [{ type: "text", text: `${LEAD}[REDACTED:github-token]` }, image, thinking, { type: "text", text: TRAIL }]);
	});

	it("fuzz: every 2- and 3-block split of each secret, in assistant text (every partial and the answer) and tool-result arrays, leaves no 6-character fragment", async () => {
		const outputs = new Set<string>();
		const failures: string[] = [];
		const check = (where: string, parts: readonly string[], texts: readonly string[], secret: string) => {
			for (const text of texts) {
				outputs.add(text);
				const found = holds(text, secret);
				if (found.length > 0 && failures.length < 20) failures.push(`${where} ${JSON.stringify(parts)} -> ${JSON.stringify(text)} holds ${JSON.stringify(found[0])}`);
			}
		};
		let count = 0;
		for (const { secret, parts } of [...cases(2), ...cases(3)]) {
			count++;
			const final = await toolResult(parts);
			check("tool", parts, final, secret);
			if (!final.join("").startsWith(LEAD.trim()) || !final.join("").endsWith(TRAIL)) failures.push(`tool ${JSON.stringify(parts)}: the prose around the secret was lost`);
			const partials = await streamed(parts);
			for (const texts of partials) check("assistant", parts, texts, secret);
			if (!partials.at(-1)!.join("").includes("[REDACTED:")) failures.push(`assistant ${JSON.stringify(parts)}: the answer shows no mask`);
		}
		assert.deepEqual(failures, [], `${count} split cases`);
		assert.ok(count > 9_000, `every split was tried: ${count}`);
		assert.deepEqual(await committed(outputs), [], "the committed outputs hold no fragment in store bytes");
	});

	it("fuzz through a real host: every 2-block split in assistant text and tool results leaves no fragment in committed partials or store bytes", async () => {
		const dir = scratch("split-host");
		const two = cases(2);
		const blocks = (separator: string) => two.flatMap(({ parts }) => [...parts, separator]);
		const tool = defineTool({ name: "splits", description: "returns every split", parameters: Type.Object({}), execute: async () => ({ output: blocks("\n\n").map((text) => ({ type: "text" as const, text })) }) });
		const h = await openHost(dir, {
			faux: { tokensPerSecond: 100_000, tokenSize: { min: 3, max: 40 } },
			settings: { progress: { partialIntervalMs: 1, outputIntervalMs: 1 } },
			extensions: [defineExtension({ name: "split.host", tools: [tool] })],
		});
		h.faux.setResponses([
			fauxAssistantMessage(blocks("\n\n").map(fauxText)),
			fauxAssistantMessage([fauxToolCall("splits", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("ok")]),
		]);
		const seen = await watched(h, async () => {
			await turn(h, "op-text");
			await turn(h, "op-tool");
		});
		const entries = await entriesOf(h.harness, h.root.id);
		await h.close();
		const roles = entries.map((entry) => (entry.model?.[0] as { role?: string } | undefined)?.role);
		assert.ok(roles.includes("assistant") && roles.includes("toolResult"));
		assert.ok(seen.length > 3, "partials were committed");
		assert.deepEqual([...new Set(seen.flatMap((text) => holds(text)))], [], "no committed partial holds a fragment");
		assert.deepEqual(storeLeaks(dir), [], "session.sqlite and WAL hold no fragment");
	});
});
