import assert from "node:assert/strict";
import test from "node:test";
import { createCompletionWakeup, settleWorkerReceipt, workerReceiptFailureResult } from "./completion-wakeup.mjs";

function harness() {
  const sent = [];
  const wakeup = createCompletionWakeup({
    sendMessage(message, options) { sent.push({ message, options }); },
  });
  return { wakeup, sent };
}

const subagent = { executionId: "exec-1", outcome: "success", profile: "scout", cognitiveRole: "investigation" };

test("sends one bounded follow-up turn for a terminal background subagent", () => {
  const { wakeup, sent } = harness();

  assert.equal(wakeup.notify(subagent), true);
  assert.equal(wakeup.notify(subagent), false);

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].options, { deliverAs: "followUp", triggerTurn: true });
  assert.equal(sent[0].message.customType, "pi-workbench:child-completion");
  assert.match(sent[0].message.content, /exec-1/);
  assert.match(sent[0].message.content, /success/);
  assert.match(sent[0].message.content, /Call subagent_collect exactly once/);
  assert.match(sent[0].message.content, /Do not retry, relaunch, publish, or accept/);
  assert.deepEqual(sent[0].message.details, subagent);
});

test("identifies a worker without including its terminal result", () => {
  const { wakeup, sent } = harness();

  wakeup.notify({
    executionId: "exec-worker",
    outcome: "execution_failed",
    profile: "implementer",
    cognitiveRole: "implementation",
    workerId: "worker-1",
    workerName: "Catalog worker",
  });

  assert.match(sent[0].message.content, /Worker "Catalog worker" \(worker-1\)/);
  assert.deepEqual(sent[0].message.details, {
    executionId: "exec-worker",
    outcome: "execution_failed",
    profile: "implementer",
    cognitiveRole: "implementation",
    workerId: "worker-1",
    workerName: "Catalog worker",
  });
  assert.equal("text" in sent[0].message.details, false);
  assert.equal("diagnostic" in sent[0].message.details, false);
});

test("re-arms wakeup when collection detaches before terminal", () => {
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
  assert.equal(sent[0].message.details.outcome, "success");
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
