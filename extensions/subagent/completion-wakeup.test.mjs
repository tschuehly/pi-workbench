import assert from "node:assert/strict";
import test from "node:test";
import { createCompletionWakeup, isNormalCompletionAttention, receiptSafeResult, settleWorkerReceipt, workerReceiptFailureResult } from "./completion-wakeup.mjs";

function childResult() {
  return { content: [{ type: "text", text: "Applied the caption fix." }], details: { outcome: "success", executionId: "execution-1" } };
}

test("collection holds a Worker result until its registry receipt settles", async () => {
  let settle;
  const receipt = { workerId: "worker-1", settled: new Promise((resolve) => { settle = resolve; }) };

  let reported = false;
  const collecting = receiptSafeResult({ result: childResult(), executionId: "execution-1", terminal: true, receipt })
    .then((value) => { reported = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reported, false, "a Worker success cannot be collected while its receipt is unsettled");

  settle({ error: new Error("registry write failed") });
  const guarded = await collecting;
  assert.equal(guarded.details.outcome, "outcome_unknown");
  assert.equal(guarded.details.childOutcome, "success");
  assert.equal(guarded.details.receiptStatus, "failed");
  assert.equal(guarded.isError, true);
  assert.match(guarded.content[0].text, /Child result for inspection only:/);
});

test("collection returns the child result unchanged when no receipt can fail", async () => {
  const result = childResult();
  const settled = { workerId: "worker-1", settled: Promise.resolve(undefined) };
  assert.equal(await receiptSafeResult({ result, executionId: "execution-1", terminal: true, receipt: settled }), result, "a settled receipt reports the child result");
  assert.equal(await receiptSafeResult({ result, executionId: "execution-1", terminal: true, receipt: undefined }), result, "a Subagent has no receipt to await");

  const pending = { workerId: "worker-1", settled: new Promise(() => {}) };
  assert.equal(await receiptSafeResult({ result, executionId: "execution-1", terminal: false, receipt: pending }), result, "a running snapshot never waits for a receipt");
});

function harness(options = {}) {
  const sent = [];
  const delivered = [];
  const wakeup = createCompletionWakeup({
    sendMessage(message, sendOptions) { sent.push({ message, options: sendOptions }); },
    onDelivered(executionId) { delivered.push(executionId); },
    ...options,
  });
  return { wakeup, sent, delivered };
}

const marker = (entry) => ({ role: "custom", ...entry.message });

const subagent = { executionId: "exec-1", outcome: "success", profile: "scout", cognitiveRole: "routine" };

test("sends one coalesced steer signal for terminal background children", () => {
  const { wakeup, sent } = harness();

  assert.equal(wakeup.notify(subagent), true);
  assert.equal(wakeup.notify(subagent), false);

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].options, { deliverAs: "steer", triggerTurn: true });
  assert.equal(sent[0].message.customType, "pi-workbench:child-completion");
  assert.match(sent[0].message.content, /Background children finished/);
  assert.match(sent[0].message.content, /resume the run that launched them at its next incomplete step/);
  assert.match(sent[0].message.content, /authorizes no retry, relaunch, publication, or acceptance/);
  assert.match(sent[0].message.content, /existing authorization/);
  assert.match(sent[0].message.content, /`subagent_collect` without an executionId[\s\S]*exec-1/, "a completion without a carried result is named for collection");
  assert.deepEqual(sent[0].message.details, { attention: "terminal-results", delivered: [], collect: ["exec-1"] });
});

test("carries each finished child's compact result so no collect turn is needed", () => {
  const { wakeup, sent, delivered } = harness();

  wakeup.notify({
    executionId: "exec-worker",
    outcome: "execution_failed",
    profile: "implementer",
    cognitiveRole: "implementation",
    workerId: "worker-1",
    workerName: "Catalog worker",
    text: "execution_failed: tests broke\n\nCompletion receipt: openai/gpt:high · worker · implementer · implementation · outcome execution_failed",
  });

  const { content, details } = sent[0].message;
  assert.match(content, /exec-worker \[execution_failed\]\nexecution_failed: tests broke\n\nCompletion receipt: openai\/gpt:high/, "the result and its author receipt ride in the notice");
  assert.match(content, /already collected/);
  assert.doesNotMatch(content, /call `subagent_collect`/, "nothing is left to collect");
  assert.deepEqual(details, { attention: "terminal-results", delivered: ["exec-worker"], collect: [] });
  assert.deepEqual(delivered, [], "a sent notice is not yet a delivered one");

  wakeup.acknowledge(marker(sent[0]));
  assert.deepEqual(delivered, ["exec-worker"], "delivery marks the carried result collected");
  wakeup.acknowledge(marker(sent[0]));
  assert.deepEqual(delivered, ["exec-worker"], "a repeated delivery marks it once");
  wakeup.rearm();
  assert.equal(sent.length, 1);
});

test("bounds the notice and leaves results that do not fit for subagent_collect", () => {
  const { wakeup, sent, delivered } = harness({ maxChars: 100 });
  wakeup.notify({ ...subagent, executionId: "exec-a", text: "A".repeat(80) });
  // The first signal is composed at the first completion; later ones ride the next composition.
  wakeup.acknowledge(marker(sent[0]));
  wakeup.notify({ ...subagent, executionId: "exec-b", text: "B".repeat(80) });
  const second = sent[1].message;
  assert.deepEqual(second.details.delivered, ["exec-b"], "one oversized result is still carried alone");

  const { wakeup: fanOut, sent: fanSent, delivered: fanDelivered } = harness({ maxChars: 150 });
  fanOut.notify({ ...subagent, executionId: "exec-1", text: "x".repeat(10) });
  fanSent.length = 0; // Pi dropped it; three more finish before the settle re-sends.
  for (const n of [2, 3, 4]) fanOut.notify({ ...subagent, executionId: `exec-${n}`, text: "y".repeat(40) });
  fanOut.rearm();
  const { content, details } = fanSent[0].message;
  assert.deepEqual(details.delivered, ["exec-1", "exec-2", "exec-3"]);
  assert.deepEqual(details.collect, ["exec-4"]);
  assert.match(content, /`subagent_collect` without an executionId[^\n]*exec-4/);
  fanOut.acknowledge(marker(fanSent[0]));
  assert.deepEqual(fanDelivered, ["exec-1", "exec-2", "exec-3"], "a named remainder stays uncollected for subagent_collect");
  fanOut.rearm();
  assert.equal(fanSent.length, 1, "a named remainder needs no second wake");
  assert.deepEqual(delivered, ["exec-a"]);
});

test("a child that finishes after the notice was composed is carried by the next one", () => {
  const { wakeup, sent, delivered } = harness();
  wakeup.notify({ ...subagent, executionId: "exec-1", text: "first" });
  assert.equal(wakeup.notify({ ...subagent, executionId: "exec-2", text: "second" }), false, "coalesced while the first notice is outstanding");
  wakeup.acknowledge(marker(sent[0]));
  assert.deepEqual(delivered, ["exec-1"]);
  assert.equal(sent.length, 2, "the late child is queued at delivery, inside the running turn, not at settle: a Worker's settle ends its dispatch");
  assert.deepEqual(sent[1].options, { deliverAs: "steer", triggerTurn: true });
  assert.deepEqual(sent[1].message.details.delivered, ["exec-2"]);
  assert.match(sent[1].message.content, /exec-2 \[success\]\nsecond/);
  wakeup.acknowledge(marker(sent[1]));
  assert.deepEqual(delivered, ["exec-1", "exec-2"]);
  wakeup.rearm();
  assert.equal(sent.length, 2, "nothing is left to re-send at settle");
});

test("flags a truncated carried result as incomplete verification", () => {
  const { wakeup, sent } = harness();
  wakeup.notify({ ...subagent, text: "partial…\n\nCompletion receipt: … · TRUNCATED, cannot satisfy verification", truncated: true });
  assert.match(sent[0].message.content, /1 result\(s\) truncated — verification incomplete/);
});

test("a result collected before its notice is delivered is not marked again", () => {
  const { wakeup, sent, delivered } = harness();
  wakeup.notify({ ...subagent, text: "done" });
  wakeup.beginReconciliation("exec-1");
  wakeup.finishReconciliation("exec-1", true);
  wakeup.acknowledge(marker(sent[0]));
  assert.deepEqual(delivered, []);
});

test("coalesces a fan-out into one signal that only a delivered marker re-arms", () => {
  const { wakeup, sent } = harness();
  const finish = (n) => wakeup.notify({ ...subagent, executionId: `exec-${n}` });

  assert.equal(finish(0), true);
  const later = [];
  for (let n = 1; n < 23; n += 1) later.push(finish(n));
  assert.equal(sent.length, 1, "23 completions produce one signal");
  assert.equal(later.filter((delivered) => delivered === false).length, 22);

  const delivery = { role: "custom", customType: sent[0].message.customType, details: { attention: sent[0].message.details.attention } };
  assert.equal(isNormalCompletionAttention(delivery), true);
  assert.equal(isNormalCompletionAttention({ ...delivery, role: "user" }), false);
  assert.equal(isNormalCompletionAttention({ ...delivery, customType: "context-checkpoint" }), false);
  assert.equal(isNormalCompletionAttention({ ...delivery, details: { executionId: "exec-1" } }), false);
  assert.equal(isNormalCompletionAttention(undefined), false);

  // A marker without a composition list (an earlier revision's notice) clears all pending attention.
  wakeup.acknowledge(delivery);
  wakeup.rearm();
  assert.equal(sent.length, 1, "a delivered marker leaves nothing to re-send");
  assert.equal(finish(23), true);
  assert.equal(sent.length, 2, "a later completion signals again");
  assert.equal(finish(24), false);
});

test("re-sends one coalesced signal at settle when Pi dropped the undelivered one", () => {
  const { wakeup, sent } = harness();
  wakeup.notify(subagent);
  wakeup.notify({ ...subagent, executionId: "exec-2" });
  sent.length = 0; // Pi cleared its queue: the marker never reaches message_start.

  wakeup.rearm();
  assert.equal(sent.length, 1, "pending terminal attention is re-signalled");
  assert.equal(sent[0].message.details.attention, "terminal-results");
  wakeup.rearm();
  wakeup.rearm();
  assert.equal(sent.length, 1, "a resend that settles undelivered is not resent again (no settle loop)");

  wakeup.notify({ ...subagent, executionId: "exec-3" });
  assert.equal(sent.length, 2, "a new completion signals again");
  wakeup.acknowledge({ role: "custom", ...sent[1].message });
  wakeup.rearm();
  wakeup.rearm();
  assert.equal(sent.length, 2, "a delivered signal does not re-fire on settle");
});

test("collection or shutdown clears pending attention that was never delivered", () => {
  const collected = harness();
  collected.wakeup.notify(subagent);
  collected.wakeup.beginReconciliation("exec-1");
  collected.wakeup.finishReconciliation("exec-1", true);
  collected.wakeup.rearm();
  assert.equal(collected.sent.length, 1, "collected results need no re-signal");

  const muted = harness();
  muted.wakeup.notify(subagent);
  muted.wakeup.shutdown();
  muted.wakeup.rearm();
  assert.equal(muted.sent.length, 1);
});

test("re-sends a dropped receipt-failure wake once", async () => {
  const { wakeup, sent } = harness();
  await assert.rejects(settleWorkerReceipt({
    settle: async () => { throw new Error("registry write failed"); },
    wakeup,
    background: true,
    completion: { ...subagent, executionId: "exec-worker", workerId: "worker-1", workerName: "Worker" },
  }), /registry write failed/);
  wakeup.markHandled("exec-worker");
  wakeup.rearm();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].message.details.receiptStatus, "failed");
  wakeup.rearm();
  assert.equal(sent.length, 2, "no settle loop");
});

test("keeps receipt-failure attention outside normal coalescing", async () => {
  const { wakeup, sent } = harness();
  wakeup.notify(subagent);

  await assert.rejects(settleWorkerReceipt({
    settle: async () => { throw new Error("registry write failed"); },
    wakeup,
    background: true,
    completion: { ...subagent, executionId: "exec-worker", workerId: "worker-1", workerName: "Worker" },
  }), /registry write failed/);

  assert.equal(sent.length, 2, "a receipt failure is never suppressed by a queued normal signal");
  assert.deepEqual(sent[1].options, { deliverAs: "followUp", triggerTurn: true });
  assert.equal(isNormalCompletionAttention({ role: "custom", customType: sent[1].message.customType, details: sent[1].message.details }), false);
  assert.match(sent[1].message.content, /Worker "Worker" \(worker-1\)/);

  wakeup.notify({ ...subagent, executionId: "exec-2" });
  assert.equal(sent.length, 2, "receipt-failure delivery does not re-arm normal attention");
});

test("re-arms wakeup when terminal collection detaches before delivering its result", () => {
  const { wakeup, sent } = harness();

  wakeup.beginReconciliation("exec-1");
  assert.equal(wakeup.notify(subagent), false);
  wakeup.finishReconciliation("exec-1", false);
  assert.equal(wakeup.notify(subagent), true);
  assert.equal(sent.length, 1);
});

test("suppresses wakeup after terminal reconciliation, explicit handling, or shutdown", () => {
  const reconciled = harness();
  reconciled.wakeup.beginReconciliation("exec-1");
  reconciled.wakeup.finishReconciliation("exec-1", true);
  assert.equal(reconciled.wakeup.notify(subagent), false);

  const cancelled = harness();
  cancelled.wakeup.markHandled("exec-1");
  assert.equal(cancelled.wakeup.notify({ ...subagent, outcome: "cancelled" }), false);

  const shuttingDown = harness();
  shuttingDown.wakeup.shutdown();
  assert.equal(shuttingDown.wakeup.notify({ ...subagent, outcome: "cancelled" }), false);
});

test("wakes a worker only after its receipt settles", async () => {
  const { wakeup, sent } = harness();
  let release;
  const receipt = new Promise((resolve) => { release = resolve; });
  const settling = settleWorkerReceipt({
    settle: () => receipt,
    wakeup,
    background: true,
    completion: { ...subagent, executionId: "exec-worker", workerId: "worker-1", workerName: "Worker" },
  });

  await Promise.resolve();
  assert.equal(sent.length, 0);
  release();
  await settling;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.details.attention, "terminal-results");
});

test("emits bounded outcome_unknown attention when a worker receipt fails", async () => {
  const { wakeup, sent } = harness();
  await assert.rejects(settleWorkerReceipt({
    settle: async () => { throw new Error("registry write failed"); },
    wakeup,
    background: true,
    completion: { ...subagent, executionId: "exec-worker", workerId: "worker-1", workerName: "Worker" },
  }), /registry write failed/);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.details.outcome, "outcome_unknown");
  assert.equal(sent[0].message.details.receiptStatus, "failed");
  assert.equal(sent[0].message.details.receiptDiagnostic, "registry write failed");
  assert.equal(sent[0].message.details.resultAlreadyReconciled, false);
  assert.match(sent[0].message.content, /Inspect worker_status/);
});

test("emits receipt-failure attention even after the child result was reconciled", async () => {
  const { wakeup, sent } = harness();
  wakeup.markHandled("exec-worker");

  const attempt = () => settleWorkerReceipt({
    settle: async () => { throw new Error("disk full"); },
    wakeup,
    background: true,
    completion: { ...subagent, executionId: "exec-worker", workerId: "worker-1", workerName: "Worker" },
  });
  await assert.rejects(attempt(), /disk full/);
  await assert.rejects(attempt(), /disk full/);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.details.resultAlreadyReconciled, true);
  assert.match(sent[0].message.content, /If executionId "exec-worker" has not already been collected/);
});

test("returns foreground Worker receipt failure as outcome_unknown with inspection-only child result", () => {
  const result = workerReceiptFailureResult({
    content: [{ type: "text", text: "CHILD_OK" }],
    details: { outcome: "success", executionId: "exec-worker" },
  }, "exec-worker", "worker-1", new Error("registry unavailable"));

  assert.equal(result.isError, true);
  assert.equal(result.details.outcome, "outcome_unknown");
  assert.equal(result.details.childOutcome, "success");
  assert.equal(result.details.receiptStatus, "failed");
  assert.match(result.content[0].text, /do not dispatch this Worker again/);
  assert.match(result.content[0].text, /Child result for inspection only:\nCHILD_OK/);
});

test("rejects malformed internal completion metadata", () => {
  const { wakeup } = harness();
  assert.throws(() => wakeup.notify({ ...subagent, outcome: undefined }), /outcome must be a non-empty string/);
});

test("redacts credentials in a carried result before it is displayed or persisted", async () => {
  const { wakeup, sent } = harness();
  const token = "ghp_" + "A".repeat(36);
  wakeup.notify({ ...subagent, outcome: "execution_failed", text: `execution_failed: git push said ${token}` });
  assert.doesNotMatch(sent[0].message.content, new RegExp(token));
  assert.match(sent[0].message.content, /\[REDACTED:github-token\]/);

  await assert.rejects(settleWorkerReceipt({
    settle: async () => { throw new Error(`registry write failed near ${token}`); },
    wakeup,
    background: true,
    completion: { ...subagent, executionId: "exec-worker", workerId: "worker-1", workerName: "Worker" },
  }));
  assert.doesNotMatch(JSON.stringify(sent[1].message), new RegExp(token), "a receipt-failure diagnostic is redacted too");
});

test("counts each carried section, not only the result text, against the budget", () => {
  const { wakeup, sent } = harness({ maxChars: 100 });
  wakeup.notify({ ...subagent, executionId: "exec-1", text: "x".repeat(10) });
  sent.length = 0;
  wakeup.notify({ ...subagent, executionId: "exec-2-with-a-long-identifier-that-takes-room", text: "y".repeat(60) });
  wakeup.rearm();
  assert.deepEqual(sent[0].message.details.collect, ["exec-2-with-a-long-identifier-that-takes-room"]);
});
