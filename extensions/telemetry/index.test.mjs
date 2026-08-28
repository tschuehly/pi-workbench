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
  await handlers.get("before_agent_start")({ prompt: `do not duplicate me
PI_TELEMETRY_STUDIO_V1 {"version":2,"type":"studio.review_wake","kind":"sent","concept":"wrong","id":"wrong","seq":11,"eventTime":null}
PI_TELEMETRY_STUDIO_V1 {"version":1,"type":"studio.review_wake","kind":"sent","concept":"alpha","id":"comment-1","seq":12,"eventTime":"2026-08-28T11:59:00.000Z","detail":"Fix it"}` }, ctx);
  await handlers.get("agent_start")({}, ctx);
  await handlers.get("turn_end")({
    turnIndex: 3,
    message: { role: "assistant", timestamp: 123, provider: "anthropic", model: "claude", stopReason: "stop", usage: usage(0.5) },
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
  assert.deepEqual(recorded.map(({ type }) => type), ["session.start", "prompt", "studio.comment_delivered", "agent.start", "usage", "usage", "session.compact", "usage", "session.tree", "usage", "thinking.select", "execution.launched", "orchestration.start", "orchestration.end", "session.shutdown"]);
  assert.deepEqual(recorded[0], {
    type: "session.start", sessionId: "session-1", sessionFile: "/sessions/session-1.jsonl", cwd: "/repo", mode: "rpc", reason: "startup", provider: "anthropic", model: "claude", effort: "high", argv: null, parentSessionId: "parent-1", executionId: "exec-1",
  });
  assert.deepEqual(recorded[1], { type: "prompt", sessionId: "session-1", entryId: "entry-1", prompt: null });
  assert.deepEqual(recorded[2], {
    type: "studio.comment_delivered", sessionId: "session-1", kind: "sent", concept: "alpha", id: "comment-1", seq: 12, eventTime: "2026-08-28T11:59:00.000Z",
  });
  assert.equal(recorded[4].usageKey, "session-1:assistant:123:anthropic:claude");
  assert.equal(recorded[4].turnIndex, 3);
  assert.equal(recorded[5].usageKey, "session-1:tool:web-1:124");
  assert.equal(recorded[7].usageKey, "session-1:compaction:compact-1");
  assert.equal(recorded[9].usageKey, "session-1:branch-summary:tree-1");
  assert.deepEqual(recorded[10], { type: "thinking.select", sessionId: "session-1", effort: "medium", previousEffort: "high" });
  assert.deepEqual(recorded[11], { type: "execution.launched", executionId: "exec-2", task: "Review", sessionId: "session-1" });
  assert.deepEqual(recorded[12], { type: "orchestration.start", sessionId: "session-1", toolCallId: "tool-1", operation: "subagent_cancel", args: { executionId: "exec-2", reason: "done" } });
  assert.deepEqual(recorded[13], { type: "orchestration.end", sessionId: "session-1", toolCallId: "tool-1", operation: "subagent_cancel", isError: false, executionId: "exec-2", workerId: null, outcome: "cancelled" });
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
