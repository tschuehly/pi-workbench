// Matrix rows: "Child launch/report", "Queued input", "Unanswered question" (with the attention race).
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { type Mode, cleanup, runWindow, type Window } from "./runner.ts";

type E = Record<string, any>;
const modes: Mode[] = ["kill", "close"];
const count = (items: string[], prefix: string) => items.filter((x) => x.startsWith(prefix)).length;

function oneChildOneReport(e: E) {
	assert.equal(e.settled.status, "done");
	assert.equal(e.children.length, 1, "one child assignment");
	assert.deepEqual(e.children[0].users, ["child task"], "child admitted exactly once");
	assert.equal(count(e.requestLabels, "child task"), 1, "child asked the model once");
	assert.equal(e.childReports.length, 1, "one logical report delivered to the parent");
	assert.equal(e.results.length, 1, "one collectable result");
	assert.deepEqual(e.collected, { first: 1, second: 0 }, "result was uncollected after recovery, then read once");
	assert.deepEqual(e.reporters.map((r: E) => r.outcome), ["completed"]);
	assert.deepEqual(e.liveTasks, []);
}

const killPoint = (point: string): Window => ({
	id: `child.${point}`,
	scenario: "child",
	barrier: `child:${point}`,
	crash: { window: "kill-point", armed: [`child:${point}`] },
	verify: {},
	check: oneChildOneReport,
});

const childWindows: Window[] = [
	killPoint("before-admission"),
	killPoint("after-result"),
	killPoint("before-delivery"),
	killPoint("after-delivery"),
	{
		id: "child.cancel-parent",
		scenario: "child",
		barrier: "cancel-parent",
		crash: { window: "cancel-parent" },
		verify: {},
		check: (e: E) => {
			assert.equal(e.barrierData.childRunningAfterEsc, true, "parent Esc stops at the background boundary");
			assert.equal(e.barrierData.childRunningAfterEnd, false, "ending the Chat reaches the child");
			assert.equal(e.children[0].running, false);
			assert.equal(count(e.requestLabels, "child-block"), 1, "cancelled child never asks the model again");
			assert.equal(e.childReports.length, 0, "no late report revives cancelled work");
			assert.deepEqual(e.reporters.map((r: E) => r.outcome), ["aborted"]);
			assert.deepEqual(e.liveTasks, []);
		},
	},
	{
		id: "child.worker-leaf",
		scenario: "child",
		barrier: "worker-leaf",
		crash: { window: "worker-leaf", armed: [] },
		verify: {},
		check: (e: E) => {
			const worker = e.children[0];
			assert.equal(worker.leaves.length, 1, "one leaf");
			assert.deepEqual(worker.leaves[0].users, ["leaf-task"], "leaf admitted once");
			assert.match(worker.results[0].text, /leaf answered: ok: leaf-task/, "worker settled only after its leaf answered");
			assert.equal(e.childReports.length, 1);
			assert.deepEqual(e.collected, { first: 1, second: 0 });
			assert.deepEqual(e.liveTasks, []);
		},
	},
	{
		id: "child.cancel-worker",
		scenario: "child",
		barrier: "cancel-worker",
		crash: { window: "cancel-worker" },
		verify: {},
		check: (e: E) => {
			const worker = e.children[0];
			assert.equal(worker.running, false);
			assert.match(worker.results[0].text, /Tool leaf was aborted/, "cancelling the worker reached its leaf call");
			assert.ok(worker.leaves[0].assistants.every((a: E) => a.stop === "aborted"), "leaf produced no answer");
			assert.equal(e.results[0].status, "aborted", "the worker's receipt says aborted");
			assert.equal(count(e.requestLabels, "leaf-task"), 1, "leaf not re-run after cancel");
			assert.equal(e.childReports.length, 0);
			assert.deepEqual(e.liveTasks, []);
		},
	},
	{
		id: "child.cancel-leaf",
		scenario: "child",
		barrier: "cancel-leaf",
		crash: { window: "cancel-leaf" },
		verify: {},
		check: (e: E) => {
			const worker = e.children[0];
			assert.match(worker.results[0].text, /aborted/, "leaf call ended aborted");
			assert.equal(worker.assistants.at(-1).stop, "stop", "the worker stays alive and answers");
			assert.equal(e.childReports.length, 1);
			assert.deepEqual(e.liveTasks, []);
		},
	},
];

const queueWindows: Window[] = [
	{
		id: "queue.mid-commit",
		scenario: "queue",
		barrier: "mid-commit",
		crash: { window: "mid-commit" },
		verify: { window: "mid-commit" },
		check: (e: E) => {
			assert.equal(e.settled.status, "done");
			assert.equal(e.retryId, e.again, "stable ID returns the same receipt");
			assert.deepEqual(e.transcript.users, ["hello"], "admitted exactly once");
		},
	},
	{
		id: "queue.after-commit",
		scenario: "queue",
		barrier: "committed-unacked",
		crash: { window: "after-commit" },
		verify: { window: "after-commit" },
		check: (e: E) => {
			assert.equal(e.retryId, e.barrierData.id, "retry returns the submission committed before the crash");
			assert.equal(e.settled.status, "done");
			assert.deepEqual(e.transcript.users, ["hello"]);
		},
	},
	{
		id: "queue.changed-payload",
		scenario: "queue",
		barrier: "receipt",
		crash: { window: "receipt" },
		verify: { window: "receipt" },
		check: (e: E) => {
			assert.equal(e.changedPayload, "PayloadMismatch", "changed payload under a reused ID is rejected");
			assert.equal(e.settled.status, "done");
			assert.deepEqual(e.transcript.users, ["hello"]);
		},
	},
	{
		id: "queue.order",
		scenario: "queue",
		barrier: "queued",
		crash: { window: "order", armed: ["tool:wait_tool"] },
		verify: { window: "order" },
		check: (e: E) => {
			assert.equal(e.barrierData.withdrawn, "aborted");
			// Same order as the no-crash baseline (scripts/queue-order-baseline.ts).
			assert.deepEqual(e.transcript.users, ["call:wait_tool", "steer-1", "follow-1", "steer-2", "follow-2"]);
			assert.equal(e["op-f3"].status, "unanswered", "withdrawn follow-up never placed");
			for (const op of ["op-0", "op-s1", "op-f1", "op-s2", "op-f2"]) assert.equal(e[op].status, "done", op);
		},
	},
	...(["receipt", "withdrawn", "readmitted"] as const).map(
		(at): Window => ({
			id: `queue.edit-${at}`,
			scenario: "queue",
			barrier: `edit:${at}`,
			crash: { window: "edit", at, armed: ["tool:wait_tool"] },
			verify: { window: "edit" },
			check: (e: E) => {
				const edited = e.retry.moved["op-f2"];
				assert.equal(e.afterResume, "done", "resume() finished the interrupted edit before any client retry");
				assert.deepEqual(Object.keys(e.retry.moved), ["op-f2", "op-f3"], "the edited item and the one queued after it were rebuilt");
				assert.deepEqual(e.transcript.users, ["call:wait_tool", "steer-1", "follow-1", "follow-2 edited", "follow-3"], "order preserved");
				assert.equal(count(e.requestLabels, "follow-2 edited"), 1, "edited message delivered exactly once");
				assert.equal(e.requestLabels.filter((l: string) => l === "follow-2").length, 0, "original never delivered");
				assert.deepEqual(e["op-f2"], { id: e["op-f2"].id, status: "unanswered", reason: "aborted" }, "original withdrawn");
				assert.equal(e[edited].status, "done");
				for (const op of ["op-0", "op-s1", "op-f1", e.retry.moved["op-f3"]]) assert.equal(e[op].status, "done", op);
			},
		}),
	),
	{
		id: "queue.failed-run",
		scenario: "queue",
		barrier: "queued",
		crash: { window: "failed-run" },
		verify: { window: "failed-run" },
		check: (e: E) => {
			assert.equal(e.p0.status, "unanswered");
			assert.equal(e.p0.reason, "model_error");
			assert.deepEqual(e.queuedAfterFailure, [{ requestId: "op-f1", status: "queued" }], "failed run keeps queued input waiting");
			assert.equal(count(e.requestsBeforeNext, "follow-1"), 0, "nothing drained it");
			assert.equal(e.f1.status, "done");
			assert.equal(e.next.status, "done");
			assert.deepEqual(e.transcript.users, ["fail", "follow-1", "next"]);
		},
	},
];

function oneQuestionOneAnswer(e: E) {
	assert.equal(e.asked.status, "done");
	assert.equal(e.questionCount, 1, "one question");
	assert.equal(e.answers.length, 1, "one delivered answer");
	assert.equal(e.questions[0].status, "answered");
	assert.equal(e.questions[0].delivered, true);
	assert.equal(e.staleAnswer, "rejected");
	assert.deepEqual(e.liveTasks, []);
}

const questionWindow = (window: string, barrier: string, armed: string): Window => ({
	id: `question.${window}`,
	scenario: "question",
	barrier,
	crash: { window, armed: [armed] },
	verify: {},
	check: oneQuestionOneAnswer,
});

const questionWindows: Window[] = [
	questionWindow("before-commit", "question:before-commit", "question:before-commit"),
	questionWindow("after-commit", "question:after-commit", "question:after-commit"),
	questionWindow("answer-undelivered", "answer:before-delivery", "answer:before-delivery"),
	questionWindow("delivered-unacked", "answer:after-delivery", "answer:after-delivery"),
	{
		id: "question.attention-race",
		scenario: "attention",
		barrier: "requested",
		crash: {},
		verify: {},
		check: (e: E) => {
			assert.equal(e.barrierData.viewed, "att-1");
			assert.equal(e.barrierData.notified, "att-2");
			assert.equal(e.staleAck, "stale", "viewing the old request cannot clear the newer one");
			assert.deepEqual(e.afterStale, { id: "att-2", reason: "second" });
			assert.equal(e.renotify, null, "no re-notification after reopen");
			assert.equal(e.ack, "cleared");
			assert.equal(e.after, null);
		},
	},
];

describe("child launch/report", () => {
	for (const window of childWindows) for (const mode of modes) it(`${window.id} / ${mode}`, () => runWindow(window, mode));
});
describe("queued input", () => {
	for (const window of queueWindows) for (const mode of modes) it(`${window.id} / ${mode}`, () => runWindow(window, mode));
});
describe("unanswered question", () => {
	for (const window of questionWindows) for (const mode of modes) it(`${window.id} / ${mode}`, () => runWindow(window, mode));
});

after(cleanup);
