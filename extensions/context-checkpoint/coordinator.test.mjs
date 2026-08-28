import assert from "node:assert/strict";
import test from "node:test";
import {
  compactionInstructions,
  createCheckpointCoordinator,
  latestAssistantToolCallCount,
  MAX_NEXT_PHASE_CHARS,
  MAX_SUMMARY_FOCUS_CHARS,
  validateCheckpointRequest,
} from "./coordinator.mjs";
import { createCheckpointBarrier } from "./checkpoint-barrier.mjs";

const request = {
  summaryFocus: "Preserve implementation decisions and verification results.",
  nextPhase: "Review the finished implementation for lifecycle races.",
};

test("builds phase-boundary compaction instructions", () => {
  const instructions = compactionInstructions(request);
  assert.match(instructions, /phase-boundary context checkpoint/);
  assert.match(instructions, /Preserve implementation decisions/);
  assert.match(instructions, /Review the finished implementation/);
  assert.match(instructions, /do not.*durable checkpoint.*cross-session handoff/is);
});

test("validates concise checkpoint directives with actionable lengths", () => {
  assert.equal(validateCheckpointRequest(request), undefined);
  assert.match(
    validateCheckpointRequest({ ...request, summaryFocus: "x".repeat(MAX_SUMMARY_FOCUS_CHARS + 1) }),
    new RegExp(`summaryFocus is ${MAX_SUMMARY_FOCUS_CHARS + 1} characters.*not the summary itself`),
  );
  assert.match(
    validateCheckpointRequest({ ...request, nextPhase: "x".repeat(MAX_NEXT_PHASE_CHARS + 1) }),
    new RegExp(`nextPhase is ${MAX_NEXT_PHASE_CHARS + 1} characters`),
  );
  assert.match(validateCheckpointRequest({ summaryFocus: "", nextPhase: "phase" }), /non-whitespace/);
});

test("counts sibling tool calls in the latest assistant message", () => {
  const branch = [
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall" }] } },
    { type: "message", message: { role: "toolResult", content: [] } },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text" }, { type: "toolCall" }, { type: "toolCall" }],
      },
    },
  ];
  assert.equal(latestAssistantToolCallCount(branch), 2);
  assert.equal(latestAssistantToolCallCount([]), 0);
});

test("compacts only after settlement and resumes after completion", () => {
  const outcomes = [];
  const coordinator = createCheckpointCoordinator((outcome) => outcomes.push(outcome));
  const first = coordinator.request(request);
  const duplicate = coordinator.request({ summaryFocus: "other", nextPhase: "other" });

  assert.deepEqual(first, { accepted: true, state: "pending" });
  assert.deepEqual(duplicate, { accepted: false, state: "pending" });
  assert.deepEqual(outcomes, []);

  let options;
  assert.equal(coordinator.onAgentSettled((value) => { options = value; }), true);
  assert.equal(coordinator.onAgentSettled(() => assert.fail("must not compact twice")), false);
  assert.deepEqual(coordinator.request(request), { accepted: false, state: "compacting" });
  assert.match(options.customInstructions, /Review the finished implementation/);

  const result = { summary: "checkpoint" };
  options.onComplete(result);
  options.onComplete({ summary: "duplicate callback" });
  assert.deepEqual(outcomes, [{ request, status: "compacted", result }]);
  assert.deepEqual(coordinator.request(request), { accepted: true, state: "pending" });
});

test("disposal drops pending work and ignores stale callbacks", () => {
  const outcomes = [];
  const coordinator = createCheckpointCoordinator((outcome) => outcomes.push(outcome));
  coordinator.request(request);
  let options;
  coordinator.onAgentSettled((value) => { options = value; });

  coordinator.dispose();
  options.onComplete({ summary: "too late" });

  assert.deepEqual(outcomes, []);
  assert.deepEqual(coordinator.request(request), { accepted: false, state: "disposed" });
  assert.equal(coordinator.onAgentSettled(() => assert.fail("disposed coordinator ran")), false);
});

test("reports asynchronous and synchronous compaction failures", () => {
  const outcomes = [];
  const coordinator = createCheckpointCoordinator((outcome) => outcomes.push(outcome));

  coordinator.request(request);
  let options;
  coordinator.onAgentSettled((value) => { options = value; });
  const asynchronous = new Error("nothing to compact");
  options.onError(asynchronous);

  coordinator.request(request);
  const synchronous = new Error("extension context is stale");
  coordinator.onAgentSettled(() => { throw synchronous; });

  assert.deepEqual(outcomes, [
    { request, status: "failed", error: asynchronous },
    { request, status: "failed", error: synchronous },
  ]);
});

test("a child finishing between checkpoint scheduling and agent_settled wakes only after compaction", () => {
  const delivered = [];
  const barrier = createCheckpointBarrier();
  const coordinator = createCheckpointCoordinator((outcome) => delivered.push(`checkpoint:${outcome.status}`), barrier);
  const childFinished = (id) => barrier.defer(() => delivered.push(`wake:${id}`), id);

  assert.equal(coordinator.request(request).accepted, true);

  // The gap the regression guards: the run has ended, but agent_settled has not fired yet.
  assert.equal(childFinished("execution-1"), true);
  assert.deepEqual(delivered, [], "a child wake must not trigger a turn before compaction settles");

  let options;
  coordinator.onAgentSettled((value) => { options = value; });
  assert.equal(childFinished("execution-2"), true, "a child finishing mid-compaction is queued too");
  assert.deepEqual(delivered, []);

  options.onComplete({ summary: "checkpoint" });

  assert.deepEqual(delivered, ["checkpoint:compacted", "wake:execution-1", "wake:execution-2"]);
  assert.equal(barrier.state, "idle");
  assert.equal(childFinished("execution-3"), false, "later children wake immediately again");
});

test("a failed checkpoint still releases the children it queued", () => {
  const delivered = [];
  const barrier = createCheckpointBarrier();
  const coordinator = createCheckpointCoordinator((outcome) => delivered.push(`checkpoint:${outcome.status}`), barrier);

  coordinator.request(request);
  barrier.defer(() => delivered.push("wake:execution-1"), "execution-1");
  coordinator.onAgentSettled(() => { throw new Error("extension context is stale"); });

  assert.deepEqual(delivered, ["checkpoint:failed", "wake:execution-1"]);
  assert.equal(barrier.state, "idle", "a failed checkpoint must not strand the barrier closed");
});

test("session shutdown during a checkpoint drops queued wakes with the pending checkpoint", () => {
  const delivered = [];
  const barrier = createCheckpointBarrier();
  const coordinator = createCheckpointCoordinator((outcome) => delivered.push(`checkpoint:${outcome.status}`), barrier);

  coordinator.request(request);
  let options;
  coordinator.onAgentSettled((value) => { options = value; });
  barrier.defer(() => delivered.push("wake:execution-1"), "execution-1");

  coordinator.dispose();
  options.onComplete({ summary: "too late" });

  assert.deepEqual(delivered, []);
  assert.equal(barrier.queuedCount, 0);
});
