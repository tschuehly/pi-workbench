// Cheap wake-up: a background-job completion right after a compaction runs its turn on the provider's light-tier model
// and restores the Chat's own model; otherwise the own model answers. hand_back reruns the turn on the own model.
// In process, on the scripted model under Anthropic model names (scriptedProviders).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { AgentDoc, type SubmissionId } from "@earendil-works/pi-durable";
import { DEFAULT_COMPACTION, openChatHost } from "../src/chat.ts";
import { CheapWakeDoc, cheapModel, cheapWakeExtension, submitWake } from "../src/cheap-wake.ts";
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

async function chat(label: string, existing?: string) {
	const dir = existing ?? scratch(label);
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
	const draft = (requestId: string, output: string) => ({ type: "input" as const, content: `Background bash ${requestId} complete (exit 0).\n${output}`, whenBusy: "followUp" as const, requestId });
	const wake = async (requestId: string, output: string, models: Parameters<typeof submitWake>[2] = h.models) => settle(await submitWake(h.root, draft(requestId, output), models));
	// Admitted, not settled: the cheap turn is still running when the caller goes on.
	const startWake = (requestId: string, output: string) => submitWake(h.root, draft(requestId, output), h.models);
	const prompt = async (text: string, mode?: "steer" | "followUp") => (await session.prompt({ operationId: text, text, ...(mode === undefined ? {} : { mode }) })).submissionId;
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
	return { h, dir, session, say, compact, wake, startWake, prompt, settle, requests, agent, restored, close };
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

/** A Chat whose newest context entry is a compaction summary: the next wake-up is cheap. */
async function compacted(label: string) {
	const c = await chat(label);
	for (const text of ["one", "two", "three"]) await c.say(text);
	await c.compact();
	return c;
}
const ownerRequests = (all: Request[]) => all.filter((r) => r.label.startsWith("owner"));
const assertOwn = (r: Request | undefined, what: string) => {
	assert.ok(r !== undefined, `${what}: no request`);
	assert.equal(r.model, "anthropic/claude-opus-5-5", `${what}: own model`);
	assert.ok(!r.tools.includes("hand_back"), `${what}: hand_back not offered`);
};

test("owner input queued or steered during a cheap wake runs on the own model without hand_back", async () => {
	for (const mode of ["steer", "followUp"] as const) {
		const c = await compacted(`cheap-owner-${mode}`);
		try {
			await c.startWake("job-1", "all tests passed");
			await c.settle(await c.prompt(`owner ${mode}`, mode));
			const all = c.requests();
			const owner = all.slice(all.findIndex((r) => r.label === `owner ${mode}`));
			assert.ok(owner.length > 0, `${mode}: no request ${JSON.stringify(all)}`);
			for (const r of owner) assertOwn(r, `${mode}: ${r.label}`);
			await c.restored();
			assert.deepEqual((await c.agent()).model, OWN);
		} finally {
			await c.close();
		}
	}
});

test("after the host stops mid-wake and reopens, the owner's next message runs on the own model", async () => {
	const c = await compacted("cheap-reopen");
	await c.startWake("job-1", "all tests passed");
	await c.close();
	const again = await chat("cheap-reopen", c.dir);
	try {
		await again.settle(await again.prompt("owner after reopen"));
		assertOwn(ownerRequests(again.requests()).at(-1), "after reopen");
	} finally {
		await again.close();
	}
});

test("a branch forked inside a finished cheap turn runs the owner's next message on the own model", async () => {
	const c = await compacted("cheap-fork");
	try {
		await c.wake("job-1", "all tests passed");
		await c.restored();
		await c.say("four");
		const tree = (await c.session.tree()) as { nodes: { id: string; message?: { role: string; content: unknown } }[]; activeLeafId: string | null };
		const text = (content: unknown) => (typeof content === "string" ? content : JSON.stringify(content));
		const answer = tree.nodes.find((n) => n.message?.role === "assistant" && text(n.message.content).includes("ok: Background bash job-1")) ?? assert.fail("no cheap answer node");
		const before = c.h.root.id;
		await c.session.navigate({ targetId: answer.id, expectedLeafId: tree.activeLeafId });
		assert.notEqual(c.h.root.id, before, "forked a branch");
		await c.settle(await c.prompt("owner on branch"));
		assertOwn(ownerRequests(c.requests()).at(-1), "on the branch");
		assert.deepEqual((await c.agent()).model, OWN, "the branch keeps the own model");
	} finally {
		await c.close();
	}
});

test("the owner choosing the cheap model during a cheap wake keeps it", async () => {
	const c = await compacted("cheap-owner-choice");
	try {
		const id = await c.startWake("job-1", "all tests passed");
		await c.session.setModel(LIGHT.provider, LIGHT.id);
		await c.settle(id);
		await c.restored();
		assert.deepEqual((await c.agent()).model, { provider: LIGHT.provider, modelId: LIGHT.id }, "the owner's choice stands");
	} finally {
		await c.close();
	}
});

test("hand_back batched with another call is refused before anything changes: no own-model request, no rerun", async () => {
	const c = await compacted("cheap-batched");
	try {
		const before = c.requests().length;
		await c.wake("job-1", "hand_back+read:2 tests failed");
		await c.h.root.waitForIdle(context);
		await c.restored();
		const after = c.requests().slice(before);
		assert.ok(after.length >= 2, JSON.stringify(after));
		assert.deepEqual(after.map((r) => r.model), after.map(() => "anthropic/claude-sonnet-5-5"), "the cheap turn stays cheap and nothing reruns");
		const results = (await c.h.root.entries({}, 20, undefined, context)).items.map((e) => JSON.stringify(e.model ?? ""));
		assert.ok(results.some((m) => m.includes("must be called alone")), "the batched call is told to call hand_back alone");
		assert.ok(!results.some((m) => m.includes("handed this wake-up back")), "no rerun queued");
		assert.deepEqual((await c.agent()).model, OWN);
	} finally {
		await c.close();
	}
});

test("a hand_back replayed after the host stopped finishes it once: the same terminating result, one rerun", async () => {
	const c = await compacted("cheap-replay");
	try {
		// The state a cheap turn is in when the model calls hand_back.
		await c.h.root.commit(async (tx) => {
			(await tx.doc(AgentDoc, c.h.root.id)).model = { provider: LIGHT.provider, modelId: LIGHT.id };
			(await tx.doc(CheapWakeDoc, c.h.root.id)).turn = { own: OWN, cheap: { provider: LIGHT.provider, modelId: LIGHT.id }, submission: 1 as SubmissionId };
		}, context);
		const tool = cheapWakeExtension.tools!.find((t) => t.name === "hand_back")!;
		const api = { conversationId: c.h.root.id, taskId: 4242, conversation: async () => c.h.root, commit: (fn: never, ctx: never) => c.h.root.commit(fn, ctx), getTask: async () => undefined };
		const run = () => (tool.execute as (args: unknown, api: unknown, c: unknown) => Promise<{ isError?: boolean; control?: { terminate?: boolean } }>)({ reason: "x" }, api, context);
		const first = await run();
		const replay = await run();
		assert.equal(first.control?.terminate, true);
		assert.equal(replay.isError, undefined, "the replay is not an error");
		assert.equal(replay.control?.terminate, true, "the replay ends the run as the first did");
		await c.h.root.waitForIdle(context);
		const reruns = c.requests().filter((r) => r.label.startsWith("The cheaper model handed"));
		assert.equal(reruns.length, 1, "one rerun");
	} finally {
		await c.close();
	}
});

test("hand_back's reason is redacted before it becomes the rerun's message", async () => {
	const c = await compacted("cheap-redact");
	const secret = `ghp_${"C".repeat(36)}`;
	try {
		await c.wake("job-1", `hand_back:token ${secret} rejected`);
		await c.h.root.waitForIdle(context);
		const rerun = (await c.h.root.entries({}, 20, undefined, context)).items.filter((e) => e.model?.[0]?.role === "user").map((e) => JSON.stringify(e.model)).filter((m) => m.includes("handed this wake-up back"));
		assert.equal(rerun.length, 1, "one rerun message");
		assert.ok(!rerun[0]!.includes(secret), "the secret never reaches the rerun");
		assert.match(rerun[0]!, /REDACTED/);
	} finally {
		await c.close();
	}
});

test("model discovery that throws never blocks a delivery: ordinary wakes skip it, a cheap one falls back to the own model", async () => {
	const c = await chat("cheap-discovery");
	const broken = { getAvailable: async () => { throw new Error("unrelated provider discovery failed"); } };
	try {
		await c.say("one");
		await c.wake("job-1", "all tests passed", broken);
		assertOwn(c.requests().at(-1), "ordinary delivery");
		for (const text of ["two", "three"]) await c.say(text);
		await c.compact();
		await c.wake("job-2", "all tests passed", broken);
		const last = c.requests().at(-1)!;
		assert.match(last.label, /^Background bash job-2/);
		assertOwn(last, "a cheap wake whose discovery fails");
	} finally {
		await c.close();
	}
});
