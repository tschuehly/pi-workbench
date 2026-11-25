// Cheap wake-up: a background-job completion right after a compaction runs its own run on the provider's light-tier model
// (a one-run override, never stored in the Chat's agent settings); otherwise the own model answers. hand_back reruns
// the turn on the own model.
// In process, on the scripted model under Anthropic model names (scriptedProviders).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { AgentDoc, defineExtension, GenerationTask, hook, LiveDoc, type SubmissionId } from "@earendil-works/pi-durable";
import { DEFAULT_COMPACTION, openChatHost } from "../src/chat.ts";
import { CheapWakeDoc, cheapModel, cheapWakeExtension, submitWake } from "../src/cheap-wake.ts";
import { ChatSession } from "../src/chat-session.ts";
import { context } from "../src/host.ts";
import { IDLE_COMPACTION_ENTRY } from "../src/idle-compact.ts";
import { ChatHost, fakeAgentDir, family, live, logged, waitFor } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

process.env.PI_TELEMETRY_DIR = scratch("cheap-wake-telemetry");
process.env.PI_BACKGROUND_BASH_ROOT = scratch("cheap-wake-jobs");
process.env.PI_CODING_AGENT_DIR = fakeAgentDir("cheap-wake-agent");
after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

const OWN = { provider: "anthropic", modelId: "claude-opus-5-5" };
const LIGHT = { provider: "anthropic", id: "claude-sonnet-5-5" };
type Request = { label: string; model?: string; tools: string[]; cheapInstruction?: true };

async function chat(label: string, existing?: string) {
	const dir = existing ?? scratch(label);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd, { recursive: true });
	const store = join(dir, "family");
	const h = await openChatHost({ dir: store, cwd, model: `${OWN.provider}/${OWN.modelId}`, chatId: label, scriptedProviders: true });
	// Keep almost nothing, so a short history compacts.
	h.workbench.compaction = { ...DEFAULT_COMPACTION, keepRecentTokens: 1 };
	await h.resume();
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
	// Every write to any conversation's agent settings from now on: a cheap wake-up never makes one.
	const agentWrites: string[] = [];
	const observed = h.harness.observeCommits({
		advance: (publication) => {
			for (const change of publication.changes) if (change.type === "document" && change.record.kind === AgentDoc.definition.kind) agentWrites.push(String(change.conversationId));
		},
		end: () => {},
	});
	const close = async () => {
		observed.detach();
		await session.close();
		await h.close();
	};
	return { h, dir, session, say, compact, wake, startWake, prompt, settle, requests, agent, agentWrites, close };
}

test("cheap model choice: a heavier tier's model gets its provider's light model; a light, unknown or unavailable one gets none", () => {
	assert.deepEqual(cheapModel(OWN, [LIGHT]), { provider: "anthropic", modelId: "claude-sonnet-5-5" });
	assert.deepEqual(cheapModel({ provider: "openai-codex", modelId: "gpt-6.2-sol" }, [{ provider: "openai-codex", id: "gpt-6-luna" }]), { provider: "openai-codex", modelId: "gpt-6-luna" });
	assert.equal(cheapModel({ provider: "anthropic", modelId: "claude-sonnet-5-5" }, [LIGHT]), undefined, "already light");
	assert.equal(cheapModel({ provider: "faux", modelId: "faux-1" }, [LIGHT]), undefined, "not in the policy");
	assert.equal(cheapModel(OWN, []), undefined, "no cheaper model available");
	assert.equal(cheapModel(OWN, [{ provider: "github-copilot", id: "claude-sonnet-5-5" }]), undefined, "another provider's");
});

test("a delivery right after a compaction runs on the cheap model without writing the agent settings; any other delivery runs on the own model", async () => {
	const { say, compact, wake, requests, agent, agentWrites, close } = await chat("cheap-trigger");
	try {
		for (const text of ["one", "two", "three"]) await say(text);
		await compact();
		const settings = JSON.stringify(await agent());
		const writes = agentWrites.length;
		await wake("job-1", "all tests passed");
		const cheap = requests().at(-1)!;
		assert.match(cheap.label, /^Background bash job-1/);
		assert.equal(cheap.model, "anthropic/claude-sonnet-5-5");
		assert.ok(cheap.tools.includes("hand_back"), "the cheap turn offers hand_back");
		assert.deepEqual(agentWrites.slice(writes), [], "the cheap wake never wrote the agent settings");
		assert.equal(JSON.stringify(await agent()), settings, "the agent settings are unchanged");

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
	const { h, say, compact, wake, requests, agent, agentWrites, close } = await chat("cheap-hand-back");
	try {
		for (const text of ["one", "two", "three"]) await say(text);
		await compact();
		const before = requests().length;
		const writes = agentWrites.length;
		await wake("job-1", "hand_back:2 tests failed");
		await h.root.waitForIdle(context);
		const after = requests().slice(before);
		assert.deepEqual(after.map((r) => r.model), ["anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5"], "cheap turn, then the own model; no request after hand_back's result");
		assert.match(after[1]!.label, /^The cheaper model handed this wake-up/);
		const last = (await h.root.entries({}, 5, undefined, context)).items.map((e) => JSON.stringify(e.model ?? ""));
		assert.ok(last.some((m) => m.includes("reason: 2 tests failed")), "the rerun carries the reason");
		assert.ok(!after[1]!.tools.includes("hand_back"), "the rerun is not offered hand_back");
		assert.deepEqual((await agent()).model, OWN);
		assert.deepEqual(agentWrites.slice(writes), [], "neither the wake nor hand_back wrote the agent settings");
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

test("owner input queued or steered during a cheap wake runs on the own model without hand_back, also when it joins the cheap run at a tool boundary", async () => {
	// `hand_back+read`: the cheap turn makes a tool round (hand_back is refused there), so input queued during it joins the run.
	for (const [mode, output] of [["steer", "all tests passed"], ["followUp", "all tests passed"], ["steer", "hand_back+read:x"], ["followUp", "hand_back+read:x"]] as const) {
		const what = `${mode}${output.startsWith("hand_back") ? " joining" : ""}`;
		const c = await compacted(`cheap-owner-${what.replace(" ", "-")}`);
		try {
			const writes = c.agentWrites.length;
			const wake = await c.startWake("job-1", output);
			await c.settle(await c.prompt(`owner ${mode}`, mode));
			await c.settle(wake);
			const all = c.requests();
			assert.equal(all.find((r) => r.label.startsWith("Background bash job-1"))?.model, "anthropic/claude-sonnet-5-5", `${what}: the wake ran cheap`);
			const owner = all.slice(all.findIndex((r) => r.label === `owner ${mode}`));
			assert.ok(owner.length > 0, `${what}: no request ${JSON.stringify(all)}`);
			for (const r of owner) assertOwn(r, `${what}: ${r.label}`);
			assert.deepEqual(c.agentWrites.slice(writes), [], `${what}: the agent settings were never written`);
			assert.deepEqual((await c.agent()).model, OWN);
		} finally {
			await c.close();
		}
	}
});

test("a second background completion queued during a cheap run joins it on the own model, without hand_back", async () => {
	const c = await compacted("cheap-second-completion");
	try {
		const writes = c.agentWrites.length;
		// The cheap turn makes a tool round, so the second completion joins the run at its tool boundary.
		const first = await c.startWake("job-1", "hand_back+read:x");
		const second = await submitWake(c.h.root, { type: "input", content: "Background bash job-2 complete (exit 0).\nall tests passed", whenBusy: "followUp", requestId: "job-2" }, c.h.models);
		await c.settle(first);
		await c.settle(second);
		const all = c.requests();
		assert.equal(all.find((r) => r.label.startsWith("Background bash job-1"))?.model, "anthropic/claude-sonnet-5-5", "the first completion ran cheap");
		const joined = all.filter((r) => r.label.startsWith("Background bash job-2"));
		assert.ok(joined.length > 0, JSON.stringify(all));
		for (const r of joined) assertOwn(r, "the second completion");
		assert.deepEqual(c.agentWrites.slice(writes), [], "the agent settings were never written");
	} finally {
		await c.close();
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

test("a branch forked inside a finished cheap turn is on the own model and runs the owner's next message on it", async () => {
	const c = await compacted("cheap-fork");
	try {
		await c.wake("job-1", "all tests passed");
		await c.say("four");
		const tree = (await c.session.tree()) as { nodes: { id: string; message?: { role: string; content: unknown } }[]; activeLeafId: string | null };
		const text = (content: unknown) => (typeof content === "string" ? content : JSON.stringify(content));
		const answer = tree.nodes.find((n) => n.message?.role === "assistant" && text(n.message.content).includes("ok: Background bash job-1")) ?? assert.fail("no cheap answer node");
		const before = c.h.root.id;
		await c.session.navigate({ targetId: answer.id, expectedLeafId: tree.activeLeafId });
		assert.notEqual(c.h.root.id, before, "forked a branch");
		assert.deepEqual((await c.agent()).model, OWN, "the fork's stored model is the own one before any input");
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
		assert.deepEqual((await c.agent()).model, { provider: LIGHT.provider, modelId: LIGHT.id }, "the owner's choice stands");
	} finally {
		await c.close();
	}
});

test("hand_back batched with another call is refused before anything changes: no own-model request, no rerun", async () => {
	const c = await compacted("cheap-batched");
	try {
		const before = c.requests().length;
		const writes = c.agentWrites.length;
		await c.wake("job-1", "hand_back+read:2 tests failed");
		await c.h.root.waitForIdle(context);
		const after = c.requests().slice(before);
		assert.ok(after.length >= 2, JSON.stringify(after));
		assert.deepEqual(after.map((r) => r.model), after.map(() => "anthropic/claude-sonnet-5-5"), "the cheap turn stays cheap and nothing reruns");
		const results = (await c.h.root.entries({}, 20, undefined, context)).items.map((e) => JSON.stringify(e.model ?? ""));
		assert.ok(results.some((m) => m.includes("must be called alone")), "the batched call is told to call hand_back alone");
		assert.ok(!results.some((m) => m.includes("handed this wake-up back")), "no rerun queued");
		assert.deepEqual((await c.agent()).model, OWN);
		assert.deepEqual(c.agentWrites.slice(writes), [], "the agent settings were never written");
	} finally {
		await c.close();
	}
});

test("a hand_back replayed after the host stopped finishes it once: the same terminating result, one rerun", async () => {
	const c = await compacted("cheap-replay");
	try {
		await c.wake("job-1", "hand_back:2 tests failed");
		await c.h.root.waitForIdle(context);
		// The hand_back call's tool task, as a replay after a restart runs it again.
		const [taskId] = Object.keys((await c.h.harness.snapshot(CheapWakeDoc, c.h.root.id, context))?.handedBack ?? {});
		assert.ok(taskId !== undefined, "hand_back recorded its call");
		const tool = cheapWakeExtension.tools!.find((t) => t.name === "hand_back")!;
		const api = { conversationId: c.h.root.id, taskId: Number(taskId), conversation: async () => c.h.root, commit: (fn: never, ctx: never) => c.h.root.commit(fn, ctx), getTask: async () => undefined };
		const replay = await (tool.execute as (args: unknown, api: unknown, c: unknown) => Promise<{ isError?: boolean; control?: { terminate?: boolean } }>)({ reason: "x" }, api, context);
		assert.equal(replay.isError, undefined, "the replay is not an error");
		assert.equal(replay.control?.terminate, true, "the replay ends the run as the first did");
		await c.h.root.waitForIdle(context);
		const reruns = c.requests().filter((r) => r.label.startsWith("The cheaper model handed"));
		assert.equal(reruns.length, 1, "one rerun");
		assert.equal(reruns[0]!.model, "anthropic/claude-opus-5-5");
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

const handBackTool = () => cheapWakeExtension.tools!.find((t) => t.name === "hand_back")!;
const handedBackMessages = async (c: Awaited<ReturnType<typeof chat>>) =>
	(await c.h.root.entries({}, 200, undefined, context)).items.filter((e) => e.model?.[0]?.role === "user" && JSON.stringify(e.model).includes("handed this wake-up back")).length;
const until = async (done: () => boolean | Promise<boolean>, what: string) => {
	const deadline = Date.now() + 15_000;
	while (!(await done())) {
		assert.ok(Date.now() < deadline, `no ${what} within 15 s`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
};

test("hand_back called from a codemode script is refused: the nested calls hand nothing back and queue no rerun", async () => {
	const c = await compacted("cheap-nested");
	try {
		const code = "await tools.hand_back({ reason: 'first' }); await tools.hand_back({ reason: 'second' }); return 'x';";
		await c.settle(await submitWake(c.h.root, { type: "input", content: `call:codemode ${JSON.stringify({ code })}`, whenBusy: "followUp", requestId: "job-nested" }, c.h.models));
		await c.h.root.waitForIdle(context);
		assert.equal(await handedBackMessages(c), 0, "no rerun queued by a nested call");
		assert.deepEqual((await c.h.harness.snapshot(CheapWakeDoc, c.h.root.id, context))?.handedBack ?? {}, {}, "no hand-back receipt");
		assert.deepEqual(c.requests().filter((r) => r.label.startsWith("The cheaper model handed")), [], "no own-model rerun");
	} finally {
		await c.close();
	}
});

test("two hand_back calls in one cheap run queue one rerun", async () => {
	const c = await compacted("cheap-two-calls");
	const gate = join(c.dir, "bash-gate");
	try {
		const command = `while [ ! -f '${gate}' ]; do sleep 0.05; done`;
		const id = await submitWake(c.h.root, { type: "input", content: `call:bash ${JSON.stringify({ command, description: "Wait", foreground: true })}`, whenBusy: "followUp", requestId: "job-hold" }, c.h.models);
		// The cheap run holds at its bash call; two direct hand_back calls of that run (as the model would make in two rounds).
		await until(async () => (await c.h.harness.snapshot(LiveDoc, c.h.root.id, context))?.tools !== undefined, "the held bash call");
		assert.ok((await c.h.harness.snapshot(LiveDoc, c.h.root.id, context))?.run?.override !== undefined, "the cheap run is running");
		const assistant = (await c.h.root.entries({ order: "descending" }, 20, undefined, context)).items.find((e) => e.model?.[0]?.role === "assistant")!;
		const api = (taskId: number) => ({ conversationId: c.h.root.id, taskId, conversation: async () => c.h.root, commit: (fn: never, ctx: never) => c.h.root.commit(fn, ctx), getTask: async () => ({ input: { kind: "model", assistant: assistant.id } }) });
		const run = (taskId: number) => (handBackTool().execute as (args: unknown, api: unknown, c: unknown) => Promise<{ isError?: boolean }>)({ reason: "needs work" }, api(taskId), context);
		assert.equal((await run(900_001)).isError, undefined);
		assert.equal((await run(900_002)).isError, undefined);
		writeFileSync(gate, "");
		await c.settle(id);
		await c.h.root.waitForIdle(context);
		assert.equal(await handedBackMessages(c), 1, "one rerun for the run");
	} finally {
		await c.close();
	}
});

test("the cheap-turn instruction rides only on the cheap run's requests: joined owner input never sees it and history never stores it", async () => {
	const c = await compacted("cheap-instruction");
	try {
		const wake = await c.startWake("job-1", "hand_back+read:x");
		await c.settle(await c.prompt("owner steer", "steer"));
		await c.settle(wake);
		const all = c.requests();
		assert.equal(all.find((r) => r.label.startsWith("Background bash job-1"))?.cheapInstruction, true, "the cheap request carries the instruction");
		const owner = all.slice(all.findIndex((r) => r.label === "owner steer"));
		assert.ok(owner.length > 0, JSON.stringify(all));
		for (const r of owner) assert.equal(r.cheapInstruction, undefined, `${r.label}: no cheap-turn instruction on the own model`);
		const stored = (await c.h.root.entries({}, 200, undefined, context)).items.map((e) => JSON.stringify(e.model ?? ""));
		assert.ok(!stored.some((m) => m.includes("[Cheap wake-up]")), "the instruction is never stored in history");
	} finally {
		await c.close();
	}
});

test("an extension's onYield continuation of a cheap run answers on the own model, without hand_back or the instruction", async () => {
	const c = await compacted("cheap-yield");
	try {
		let continued = false;
		c.h.registry.install(defineExtension({
			name: "test.yield",
			hooks: [hook(GenerationTask, {
				onYield: (answer) => {
					if (continued || !JSON.stringify(answer.content).includes("ok: Background bash job-1")) return undefined;
					continued = true;
					return { continue: "yield continuation" };
				},
			})],
		}));
		await c.wake("job-1", "all tests passed");
		await c.h.root.waitForIdle(context);
		const all = c.requests();
		assert.equal(all.find((r) => r.label.startsWith("Background bash job-1"))?.model, "anthropic/claude-sonnet-5-5", "the wake ran cheap");
		const next = all.find((r) => r.label === "yield continuation");
		assertOwn(next, "the continuation");
		assert.equal(next!.cheapInstruction, undefined, "the continuation has no cheap-turn instruction");
	} finally {
		await c.close();
	}
});

test("a cheap run a host kill interrupted resumes on the own model after the restart, without hand_back or the instruction", async () => {
	const { store, cwd } = family("cheap-kill-mid-run");
	const gate = join(cwd, "turn-gate-file");
	// The real host process on the scripted model under the own model's name, so a kill is a real restart.
	const args = ["--model", `${OWN.provider}/${OWN.modelId}`, "--scripted-providers"];
	const completions = () => (logged(store) as unknown as Request[]).filter((l) => l.label.startsWith("Background bash"));
	const first = new ChatHost(store, cwd, { args });
	await first.ready;
	await first.call("configure", { resources: {}, compaction: { keepRecentTokens: 1 } });
	for (const [i, text] of ["one", "two", "three"].entries()) {
		await first.call("prompt", { operationId: `op-${String(i)}`, text });
		await first.idle(i + 1);
	}
	// A background job that ends after the compaction: its completion is the wake right after it, held by the gate its
	// output names (split in the command, so the prompt itself is not held).
	await first.call("prompt", { operationId: "op-bash", text: `call:bash ${JSON.stringify({ description: "Later", command: `while [ ! -e flag ]; do sleep 0.1; done; echo turn-""gate:${gate}` })}` });
	await first.idle(4);
	await first.call("compact", {});
	await until(async () => (await first.call<{ messages: { source?: string }[] }>("transcript")).messages.some((m) => m.source === "compaction"), "the placed summary");
	writeFileSync(join(cwd, "flag"), "");
	await waitFor(() => completions().length === 1, "the cheap wake's request");
	assert.equal(completions()[0]!.model, "anthropic/claude-sonnet-5-5", "the wake ran cheap");
	await first.kill();
	const second = new ChatHost(store, cwd, { args });
	try {
		await second.ready;
		await second.call("resume", { reason: "upgrade-restart" });
		writeFileSync(gate, "");
		await waitFor(() => completions().length >= 2, "the resumed request");
		for (const r of completions().slice(1)) {
			assertOwn(r, "the resumed request");
			assert.equal(r.cheapInstruction, undefined, "no cheap-turn instruction after the restart");
		}
	} finally {
		await second.close();
	}
});
