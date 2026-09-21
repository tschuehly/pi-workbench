import assert from "node:assert/strict";
import test from "node:test";
import { activityText, recordProgress, renderProgressLog, reportedStatusText } from "./progress-log.mjs";

const startedAt = Date.parse("2026-08-07T20:00:00.000Z");

test("renders a bounded rolling subagent activity log with elapsed and idle time", () => {
  const entries = [];
  recordProgress(entries, { type: "launch", at: "2026-08-07T20:00:00.000Z" }, 3);
  recordProgress(entries, { type: "binding_verified", at: "2026-08-07T20:00:01.000Z", detail: { provider: "openai-codex", model: "gpt-test", effort: "medium" } }, 3);
  recordProgress(entries, { type: "tool_start", at: "2026-08-07T20:00:04.000Z", detail: { toolCallId: "call-1", toolName: "bash" } }, 3);
  recordProgress(entries, { type: "tool_end", at: "2026-08-07T20:00:06.000Z", detail: { toolCallId: "call-1", toolName: "bash" } }, 3);

  assert.equal(renderProgressLog({ entries, startedAt, now: startedAt + 21_000, profile: "reviewer", cognitiveRole: "independent-review" }), [
    "Subagent reviewer · independent-review · running 21s",
    "    1s  Binding verified: openai-codex/gpt-test:medium",
    "    4s  tool start: bash",
    "    6s  tool end: bash",
    "Still running · last activity 15s ago",
  ].join("\n"));
});

test("identifies a pre-prompt RPC startup timeout", () => {
  const entries = [];
  recordProgress(entries, { type: "startup_timeout", at: "2026-08-07T20:00:15.000Z", detail: { timeoutMs: 15_000 } });
  assert.equal(entries[0].text, "Pi RPC startup timed out after 15s before prompt submission.");
});

test("collapses noisy repeated assistant and tool progress updates", () => {
  const entries = [];
  recordProgress(entries, { type: "thinking_progress", at: "2026-08-07T20:00:00.000Z" });
  recordProgress(entries, { type: "thinking_progress", at: "2026-08-07T20:00:01.000Z" });
  recordProgress(entries, { type: "assistant_progress", at: "2026-08-07T20:00:01.000Z" });
  recordProgress(entries, { type: "assistant_progress", at: "2026-08-07T20:00:02.000Z" });
  recordProgress(entries, { type: "tool_progress", at: "2026-08-07T20:00:03.000Z", detail: { toolCallId: "call-1", toolName: "bash" } });
  recordProgress(entries, { type: "tool_progress", at: "2026-08-07T20:00:05.000Z", detail: { toolCallId: "call-1", toolName: "bash" } });

  assert.equal(entries.length, 3);
  assert.equal(entries[0].at, "2026-08-07T20:00:01.000Z");
  assert.equal(entries[0].text, "Child Pi is thinking…");
  assert.equal(entries[1].at, "2026-08-07T20:00:02.000Z");
  assert.equal(entries[2].at, "2026-08-07T20:00:05.000Z");
  assert.equal(activityText({ type: "thinking_progress" }), "thinking");
  assert.equal(activityText({ type: "tool_progress", detail: { toolName: "bash", action: "running npm test" } }), "running npm test");
  assert.equal(activityText({ type: "usage", detail: { input: 10 } }), undefined);
  assert.equal(activityText({ type: "cancellation" }), "stopping");
  assert.equal(activityText({ type: "startup_timeout" }), "timed out");
});

test("extracts a child's own report_status call, distinct from ordinary tool activity", () => {
  assert.equal(reportedStatusText({ type: "tool_start", detail: { toolName: "report_status", action: "Investigating the roster bug" } }), "Investigating the roster bug");
  assert.equal(reportedStatusText({ type: "tool_progress", detail: { toolName: "bash", action: "running npm test" } }), undefined);
  assert.equal(reportedStatusText({ type: "tool_start", detail: { toolName: "report_status", action: "" } }), undefined);
  assert.equal(reportedStatusText({ type: "thinking_progress" }), undefined);
});
