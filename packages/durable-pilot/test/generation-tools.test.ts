// Matrix rows: "Generation before/after partial commit" and "Safe tool, unsafe tool".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Mode, runWindow, type Window } from "./runner.ts";

type E = Record<string, any>;
const modes: Mode[] = ["kill", "close"];

function pausedThenDone(e: E) {
	assert.equal(e.paused.scheduling, "paused", "reopened host must stay paused until resume()");
	assert.equal(e.paused.requestsUnchanged, true, "status reads must not run work");
	assert.equal(e.settled.status, "done");
	assert.deepEqual(e.liveTasks, [], "no live task after completion");
}

const generationWindows: Window[] = [
	{
		id: "generation.before-partial",
		scenario: "generation",
		barrier: "request:gen",
		crash: { window: "before-partial", armed: ["request:gen"] },
		verify: { window: "before-partial" },
		check: (e: E) => {
			pausedThenDone(e);
			assert.deepEqual(e.transcript.users, ["gen"], "one admitted input");
			assert.equal(e.requests, 2, "the ordinary request is sent again once");
			assert.deepEqual(e.transcript.assistants.map((a: E) => a.stop), ["stop"], "no partial, one final answer");
		},
	},
	{
		id: "generation.after-partial",
		scenario: "generation",
		barrier: "partial",
		crash: { window: "after-partial" },
		verify: { window: "after-partial" },
		check: (e: E) => {
			pausedThenDone(e);
			assert.deepEqual(e.transcript.users, ["gen"]);
			assert.equal(e.requests, 2);
			const [aborted, final] = e.transcript.assistants;
			assert.equal(e.transcript.assistants.length, 2);
			assert.equal(aborted.stop, "aborted", "committed partial is visibly aborted");
			assert.ok(e.storedPartial.startsWith(e.barrierData.text), "what observers saw before the crash is durable");
			assert.equal(final.stop, "stop");
		},
	},
	{
		id: "generation.deferred",
		scenario: "generation",
		barrier: "deferred",
		crash: { window: "deferred" },
		verify: { window: "deferred" },
		check: (e: E) => {
			pausedThenDone(e);
			assert.equal(e.deferredSubmits, 1, "a provider-deferred response is polled, not re-requested");
			assert.equal(e.deferredFetches, 1);
			assert.equal(e.requests, 2, "no other provider request");
			assert.deepEqual(e.transcript.assistants.map((a: E) => a.stop), ["stop"]);
		},
	},
];

const toolWindow = (stored: string, current: string, reruns: boolean): Window => ({
	id: `tools.${stored}-${current}`,
	scenario: "tools",
	barrier: "tool:work",
	crash: { tool: "work", stored, armed: ["tool:work"] },
	verify: { tool: "work", current },
	check: (e: E) => {
		assert.equal(e.settled.status, "done");
		const runs = e.effects.filter((x: E) => x.tool === "work").length;
		assert.equal(runs, reruns ? 2 : 1, reruns ? "safe-safe reruns" : "no rerun");
		assert.equal(e.transcript.results.length, 1);
		assert.equal(e.transcript.results[0].isError, !reruns);
		if (!reruns) {
			assert.match(e.transcript.results[0].text, /interrupted and may have partially run/);
			assert.equal(e.uncertainAtOpen.length, 1, "host records the uncertain intent before scheduling");
		} else assert.equal(e.uncertainAtOpen.length, 0);
	},
});

const toolWindows: Window[] = [
	toolWindow("safe", "safe", true),
	toolWindow("safe", "unsafe", false),
	toolWindow("unsafe", "safe", false),
	{
		id: "tools.unsafe-effect-reproposed",
		scenario: "tools",
		barrier: "tool:deploy",
		crash: { tool: "deploy", stored: "unsafe", armed: ["tool:deploy"] },
		verify: { tool: "deploy", current: "unsafe", repropose: true },
		check: (e: E) => {
			assert.equal(e.settled.status, "done");
			assert.equal(e.effects.filter((x: E) => x.tool === "deploy").length, 1, "external effect happened exactly once");
			assert.equal(e.uncertainAtOpen.length, 1);
			const [interrupted, reproposed] = e.transcript.results;
			assert.equal(e.transcript.results.length, 2, "the model proposed the same unsafe action again");
			assert.match(interrupted.text, /interrupted and may have partially run/);
			assert.equal(reproposed.isError, true);
			assert.match(reproposed.text, /Needs reconciliation/, "host guard blocks the fresh attempt");
			assert.equal(Object.values(e.reconcile as E)[0].resolved, undefined, "still awaiting owner resolution");
		},
	},
];

describe("generation recovery", () => {
	for (const window of generationWindows) for (const mode of modes) it(`${window.id} / ${mode}`, () => runWindow(window, mode));
});

describe("tool recovery", () => {
	for (const window of toolWindows) for (const mode of modes) it(`${window.id} / ${mode}`, () => runWindow(window, mode));
});
