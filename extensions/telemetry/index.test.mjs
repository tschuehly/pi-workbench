import assert from "node:assert/strict";
import test from "node:test";
import { registerTelemetry } from "./index.ts";

test("records Pi lifecycle usage and execution bus events without prompt duplication", async () => {
  const handlers = new Map();
  let executionHandler;
  const recorded = [];
  let closed = false;
  const recorder = {
    record: (type, data) => recorded.push({ type, ...data }),
    close: () => { closed = true; },
  };
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    events: { on: (channel, handler) => { assert.equal(channel, "pi-workbench:telemetry:execution"); executionHandler = handler; } },
  };
  const sessionManager = {
    getSessionId: () => "session-1",
    getSessionFile: () => "/sessions/session-1.jsonl",
    getLeafId: () => "entry-1",
  };
  const ctx = { cwd: "/repo", mode: "rpc", model: { provider: "anthropic", id: "claude" }, thinkingLevel: "high", sessionManager };

  registerTelemetry(pi, recorder, { argv: ["pi", "--mode", "rpc", "secret prompt"], env: { PI_TELEMETRY_PARENT_SESSION_ID: "parent-1", PI_TELEMETRY_EXECUTION_ID: "exec-1" } });
  await handlers.get("session_start")({ reason: "startup" }, ctx);
  await handlers.get("before_agent_start")({ prompt: "do not duplicate me" }, ctx);
  await handlers.get("agent_start")({}, ctx);
  const monitorMessage = { role: "custom", content: `[watcher 42 · review-studio-events] PI_TELEMETRY_STUDIO_V1 {"version":1,"type":"studio.review_wake","kind":"sent","concept":"alpha","id":null,"seq":12,"eventTime":"2026-08-28T11:59:00.000Z","detail":"Fix it"}` };
  await handlers.get("message_start")({ message: monitorMessage }, ctx);
  await handlers.get("message_start")({ message: monitorMessage }, ctx);
  await handlers.get("message_start")({ message: { role: "toolResult", content: [{ type: "text", text: 'PI_TELEMETRY_STUDIO_V1 {"version":1,"type":"studio.review_wake","kind":"sent","concept":"beta","id":null,"seq":12,"eventTime":null}' }] } }, ctx);
  const lifecycleMessage = { role: "custom", content: 'PI_TELEMETRY_STUDIO_LIFECYCLE_V1 {"version":1,"type":"studio.comment_state","concept":"alpha","id":"c1","state":"accepted","source":"human"}' };
  await handlers.get("message_start")({ message: lifecycleMessage }, ctx);
  await handlers.get("message_start")({ message: lifecycleMessage }, ctx);
  await handlers.get("message_start")({ message: { role: "custom", content: 'PI_TELEMETRY_STUDIO_LIFECYCLE_V1 {"version":1,"type":"studio.comment_state","concept":"alpha","id":"c1","state":"implemented","source":"agent"}' } }, ctx);
  await handlers.get("turn_end")({
    turnIndex: 3,
    message: { role: "assistant", responseId: "response-123", timestamp: 123, provider: "anthropic", model: "claude", stopReason: "stop", usage: usage(0.5) },
    toolResults: [{ role: "toolResult", toolCallId: "web-1", toolName: "web_search", timestamp: 124, usage: usage(0.3) }],
  }, ctx);
  await handlers.get("session_compact")({ reason: "overflow", willRetry: true, compactionEntry: { id: "compact-1", usage: usage(0.2) } }, ctx);
  await handlers.get("session_tree")({ summaryEntry: { id: "tree-1", usage: usage(0.1) } }, ctx);
  await handlers.get("thinking_level_select")({ level: "medium", previousLevel: "high" }, ctx);
  executionHandler({ type: "execution.launched", executionId: "exec-2", task: "Review" });
  await handlers.get("tool_execution_start")({ toolCallId: "tool-1", toolName: "subagent_cancel", args: { executionId: "exec-2", reason: "done" } }, ctx);
  await handlers.get("tool_execution_end")({ toolCallId: "tool-1", toolName: "subagent_cancel", result: { details: { executionId: "exec-2", outcome: "cancelled" } }, isError: false }, ctx);
  await handlers.get("session_shutdown")({ reason: "quit" }, ctx);

  assert.equal(closed, true);
  assert.deepEqual(recorded.map(({ type }) => type), ["session.start", "prompt", "agent.start", "studio.comment_delivered", "studio.comment_delivered", "studio.comment_state", "usage", "usage", "session.compact", "usage", "session.tree", "usage", "thinking.select", "execution.launched", "orchestration.start", "orchestration.end", "session.shutdown"]);
  assert.deepEqual(recorded[0], {
    type: "session.start", sessionId: "session-1", sessionFile: "/sessions/session-1.jsonl", cwd: "/repo", mode: "rpc", reason: "startup", provider: "anthropic", model: "claude", effort: "high", argv: null, parentSessionId: "parent-1", executionId: "exec-1",
  });
  assert.deepEqual(recorded[1], { type: "prompt", sessionId: "session-1", entryId: "entry-1", prompt: null });
  assert.deepEqual(recorded[3], {
    type: "studio.comment_delivered", sessionId: "session-1", kind: "sent", concept: "alpha", id: null, seq: 12, eventTime: "2026-08-28T11:59:00.000Z",
  });
  assert.deepEqual(recorded[4], { type: "studio.comment_delivered", sessionId: "session-1", kind: "sent", concept: "beta", id: null, seq: 12, eventTime: null });
  assert.deepEqual(recorded[5], { type: "studio.comment_state", sessionId: "session-1", concept: "alpha", id: "c1", state: "accepted", source: "human" });
  assert.equal(recorded[6].usageKey, "session-1:assistant:response-123");
  assert.equal(recorded[6].turnIndex, 3);
  assert.equal(recorded[7].usageKey, "session-1:tool:web-1:124");
  assert.equal(recorded[9].usageKey, "session-1:compaction:compact-1");
  assert.equal(recorded[11].usageKey, "session-1:branch-summary:tree-1");
  assert.deepEqual(recorded[12], { type: "thinking.select", sessionId: "session-1", effort: "medium", previousEffort: "high" });
  assert.deepEqual(recorded[13], { type: "execution.launched", executionId: "exec-2", task: "Review", sessionId: "session-1" });
  assert.deepEqual(recorded[14], { type: "orchestration.start", sessionId: "session-1", toolCallId: "tool-1", operation: "subagent_cancel", args: { executionId: "exec-2", reason: "done" } });
  assert.deepEqual(recorded[15], { type: "orchestration.end", sessionId: "session-1", toolCallId: "tool-1", operation: "subagent_cancel", isError: false, executionId: "exec-2", workerId: null, outcome: "cancelled" });
});

test("keeps ephemeral prompts reconstructible while redacting credential arguments", async () => {
  const handlers = new Map();
  const recorded = [];
  registerTelemetry({
    on: (event, handler) => handlers.set(event, handler),
    events: { on: () => {} },
  }, {
    record: (type, data) => recorded.push({ type, ...data }),
    close: () => {},
  }, {
    argv: ["pi", "--no-session", "--api-key", "secret", "benchmark prompt", "--token=hidden"],
    env: {},
  });
  const ctx = {
    cwd: "/fixture", mode: "print", model: null, thinkingLevel: null,
    sessionManager: { getSessionId: () => "ephemeral-1", getSessionFile: () => undefined, getLeafId: () => null },
  };

  await handlers.get("session_start")({ reason: "startup" }, ctx);
  await handlers.get("before_agent_start")({ prompt: "benchmark prompt" }, ctx);

  assert.deepEqual(recorded[0].argv, ["pi", "--no-session", "--api-key", "[REDACTED]", "benchmark prompt", "--token=[REDACTED]"]);
  assert.equal(recorded[1].prompt, "benchmark prompt");
});

function usage(total) {
  return { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total } };
}
