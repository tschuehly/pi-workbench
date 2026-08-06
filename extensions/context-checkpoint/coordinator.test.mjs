import assert from "node:assert/strict";
import test from "node:test";
import {
  compactionInstructions,
  createCheckpointCoordinator,
  latestAssistantToolCallCount,
} from "./coordinator.mjs";

const request = {
  summaryFocus: "Preserve implementation decisions and verification results.",
  nextPhase: "Review the finished implementation for lifecycle races.",
};

test("builds phase-boundary compaction instructions", () => {
  const instructions = compactionInstructions(request);
  assert.match(instructions, /phase-boundary context checkpoint/);
  assert.match(instructions, /Preserve implementation decisions/);
  assert.match(instructions, /Review the finished implementation/);
  assert.match(instructions, /not.*durable cross-session handoff/i);
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
