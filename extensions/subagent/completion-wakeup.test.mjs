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

function harness() {
  const sent = [];
  const wakeup = createCompletionWakeup({
    sendMessage(message, options) { sent.push({ message, options }); },
  });
  return { wakeup, sent };
}

const subagent = { executionId: "exec-1", outcome: "success", profile: "scout", cognitiveRole: "investigation" };

test("sends one coalesced steer signal for terminal background children", () => {
  const { wakeup, sent } = harness();

  assert.equal(wakeup.notify(subagent), true);
  assert.equal(wakeup.notify(subagent), false);

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].options, { deliverAs: "steer", triggerTurn: true });
  assert.equal(sent[0].message.customType, "pi-workbench:child-completion");
  assert.match(sent[0].message.content, /Background children finished/);
  assert.match(sent[0].message.content, /subagent_collect` without an executionId once/);
  assert.match(sent[0].message.content, /repeat only if it reports a budget-limited remainder/);
  assert.match(sent[0].message.content, /resume the run that launched them at its next incomplete step/);
  assert.match(sent[0].message.content, /Use `subagent_status` only if collect reports children still running and you must decide something about them/);
  assert.match(sent[0].message.content, /authorizes no retry, relaunch, publication, or acceptance/);
  assert.match(sent[0].message.content, /existing authorization/);
  assert.deepEqual(sent[0].message.details, { attention: "terminal-results" });
});

test("carries no per-child identity in normal worker attention", () => {
  const { wakeup, sent } = harness();

  wakeup.notify({
    executionId: "exec-worker",
    outcome: "execution_failed",
    profile: "implementer",
    cognitiveRole: "implementation",
    workerId: "worker-1",
    workerName: "Catalog worker",
  });

  assert.doesNotMatch(sent[0].message.content, /Catalog worker|exec-worker/);
  assert.deepEqual(sent[0].message.details, { attention: "terminal-results" });
});

test("coalesces a fan-out into one signal that only a delivered marker re-arms", () => {
  const { wakeup, sent } = harness();
  const finish = (n) => wakeup.notify({ ...subagent, executionId: `exec-${n}` });

  assert.equal(finish(0), true);
  const later = [];
  for (let n = 1; n < 23; n += 1) later.push(finish(n));
  assert.equal(sent.length, 1, "23 completions produce one signal");
  assert.equal(later.filter((delivered) => delivered === false).length, 22);

  const marker = { role: "custom", customType: sent[0].message.customType, details: sent[0].message.details };
  assert.equal(isNormalCompletionAttention(marker), true);
  assert.equal(isNormalCompletionAttention({ ...marker, role: "user" }), false);
  assert.equal(isNormalCompletionAttention({ ...marker, customType: "context-checkpoint" }), false);
  assert.equal(isNormalCompletionAttention({ ...marker, details: { executionId: "exec-1" } }), false);
  assert.equal(isNormalCompletionAttention(undefined), false);

  wakeup.rearm();
  wakeup.rearm();
  assert.equal(sent.length, 1, "re-arming sends nothing");
  assert.equal(finish(23), true);
  assert.equal(sent.length, 2, "a later completion signals again");
  assert.equal(finish(24), false);
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
  assert.deepEqual(sent[0].message.details, { attention: "terminal-results" });
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
