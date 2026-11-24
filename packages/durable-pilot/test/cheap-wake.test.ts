// Cheap wake-up: a background-job completion right after a compaction runs its turn on the provider's light-tier model
// and restores the Chat's own model; otherwise the own model answers. hand_back reruns the turn on the own model.
// In process, on the scripted model under Anthropic model names (scriptedProviders).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { AgentDoc, type SubmissionId } from "@earendil-works/pi-durable";
import { DEFAULT_COMPACTION, openChatHost } from "../src/chat.ts";
import { CheapWakeDoc, cheapModel, submitWake } from "../src/cheap-wake.ts";
import { ChatSession } from "../src/chat-session.ts";
import { context } from "../src/host.ts";
import { IDLE_COMPACTION_ENTRY } from "../src/idle-compact.ts";
import { fakeAgentDir, logged } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

process.env.PI_TELEMETRY_DIR = scratch("cheap-wake-telemetry");
process.env.PI_CODING_AGENT_DIR = fakeAgentDir("cheap-wake-agent");
after(cleanup);

const OWN = { provider: "anthropic", modelId: "claude-opus-5-5" };
const LIGHT = { provider: "anthropic", id: "claude-sonnet-5-5" };
type Request = { label: string; model?: string; tools: string[] };

async function chat(label: string) {
	const dir = scratch(label);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd, { recursive: true });
	const store = join(dir, "family");
	const h = await openChatHost({ dir: store, cwd, model: `${OWN.provider}/${OWN.modelId}`, chatId: label, scriptedProviders: true });
	// Keep almost nothing, so a short history compacts.
	h.workbench.compaction = { ...DEFAULT_COMPACTION, keepRecentTokens: 1 };
	await h.resume();
	// The session restores the own model once a cheap turn settles, as the Chat host does.
	const session = new ChatSession(h, () => {});
	await session.start();
	const settle = async (id: SubmissionId) => {
		await (await h.harness.submission(id, context))!.wait(context);
		await h.root.waitForIdle(context);
	};
	const say = async (text: string) => settle((await h.root.submit({ type: "input", content: text, requestId: text }, context)).id);
	const compact = async () => {
		const { outcome } = (await h.harness.waitForTask(await h.root.compact(undefined, context), context)).state;
		assert.equal(outcome.status, "completed", JSON.stringify(outcome));
		await settle((outcome as { result: { submissionId: SubmissionId } }).result.submissionId);
	};
	const wake = async (requestId: string, output: string) =>
		settle(await submitWake(h.root, { type: "input", content: `Background bash ${requestId} complete (exit 0).\n${output}`, whenBusy: "followUp", requestId }, h.models));
	const requests = () => logged(store) as unknown as Request[];
	const agent = async () => (await h.harness.snapshot(AgentDoc, h.root.id, context))!;
	const restored = async () => {
		for (const end = Date.now() + 10_000; (await h.harness.snapshot(CheapWakeDoc, h.root.id, context))?.turn != null; ) {
			if (Date.now() > end) assert.fail("the cheap turn never ended");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	};
	const close = async () => {
		await session.close();
		await h.close();
	};
	return { h, say, compact, wake, requests, agent, restored, close };
}

test("cheap model choice: a heavier tier's model gets its provider's light model; a light, unknown or unavailable one gets none", () => {
	assert.deepEqual(cheapModel(OWN, [LIGHT]), { provider: "anthropic", modelId: "claude-sonnet-5-5" });
	assert.deepEqual(cheapModel({ provider: "openai-codex", modelId: "gpt-6.2-sol" }, [{ provider: "openai-codex", id: "gpt-6-luna" }]), { provider: "openai-codex", modelId: "gpt-6-luna" });
	assert.equal(cheapModel({ provider: "anthropic", modelId: "claude-sonnet-5-5" }, [LIGHT]), undefined, "already light");
	assert.equal(cheapModel({ provider: "faux", modelId: "faux-1" }, [LIGHT]), undefined, "not in the policy");
	assert.equal(cheapModel(OWN, []), undefined, "no cheaper model available");
	assert.equal(cheapModel(OWN, [{ provider: "github-copilot", id: "claude-sonnet-5-5" }]), undefined, "another provider's");
});

test("a delivery right after a compaction runs on the cheap model and restores the own model; any other delivery runs on the own model", async () => {
	const { say, compact, wake, requests, agent, restored, close } = await chat("cheap-trigger");
	try {
		for (const text of ["one", "two", "three"]) await say(text);
		await compact();
		await wake("job-1", "all tests passed");
		await restored();
		const cheap = requests().at(-1)!;
		assert.match(cheap.label, /^Background bash job-1/);
		assert.equal(cheap.model, "anthropic/claude-sonnet-5-5");
		assert.ok(cheap.tools.includes("hand_back"), "the cheap turn offers hand_back");
		assert.deepEqual((await agent()).model, OWN, "own model restored");
		assert.ok(!JSON.stringify((await agent()).modelTools ?? {}).includes("hand_back"));

		await wake("job-2", "all tests passed");
		const own = requests().at(-1)!;
		assert.match(own.label, /^Background bash job-2/);
		assert.equal(own.model, "anthropic/claude-opus-5-5", "no compaction just before: own model");
		assert.ok(!own.tools.includes("hand_back"), "the lead is never offered hand_back");
	} finally {
		await close();
	}
});

test("the idle compaction's marker entry after the summary still counts as right after a compaction", async () => {
	const { h, say, compact, wake, requests, close } = await chat("cheap-after-idle-marker");
	try {
		for (const text of ["one", "two", "three"]) await say(text);
		await compact();
		await h.root.submit({ type: "write", entry: { kind: IDLE_COMPACTION_ENTRY, data: { task: 1 } } }, context);
		await wake("job-1", "all tests passed");
		assert.equal(requests().at(-1)!.model, "anthropic/claude-sonnet-5-5");
	} finally {
		await close();
	}
});

test("hand_back ends the cheap turn and reruns it on the own model with the reason", async () => {
	const { h, say, compact, wake, requests, agent, close } = await chat("cheap-hand-back");
	try {
		for (const text of ["one", "two", "three"]) await say(text);
		await compact();
		const before = requests().length;
		await wake("job-1", "hand_back:2 tests failed");
		await h.root.waitForIdle(context);
		const after = requests().slice(before);
		assert.deepEqual(after.map((r) => r.model), ["anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5"], "cheap turn, then the own model; no request after hand_back's result");
		assert.match(after[1]!.label, /^The cheaper model handed this wake-up/);
		const last = (await h.root.entries({}, 5, undefined, context)).items.map((e) => JSON.stringify(e.model ?? ""));
		assert.ok(last.some((m) => m.includes("reason: 2 tests failed")), "the rerun carries the reason");
		assert.deepEqual((await agent()).model, OWN);
	} finally {
		await close();
	}
});
