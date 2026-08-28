import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_CHANNEL, ACTIVITY_SUMMARY_LIMIT, createActivitySurface, renderActivityLines, shortModel } from "./activity.mjs";

test("keeps changing activity visible ahead of a long launch objective", () => {
  const lines = renderActivityLines([{
    id: "sub-1",
    kind: "subagent",
    role: "independent-review",
    model: "anthropic/claude-opus-5",
    objective: "Adversarially review PR embabel/me#993 in /Users/example/a-very-long-repository-path and verify every requirement",
    activity: "reading src/auth-service.ts",
  }]);

  assert.match(lines[1], /^🤖 reading src\/auth-service\.ts/);
});

test("renders bounded one-line activity with compact identity and model names", () => {
  assert.equal(shortModel("anthropic/claude-opus-5"), "O5");
  assert.equal(shortModel("openai-codex/gpt-5.6-terra"), "T5.6");
  assert.equal(shortModel("anthropic/claude-haiku-4-5-20251001"), "H4.5");
  assert.equal(shortModel("anthropic/claude-sonnet-5"), "Sn5");

  assert.deepEqual(renderActivityLines([
    { id: "sub-1", kind: "subagent", role: "independent-review", model: "anthropic/claude-opus-5", objective: "Review activity design", activity: "reading monitor/runtime.ts" },
    { id: "work-1", kind: "worker", name: "Catalog", role: "implementation", model: "openai-codex/gpt-5.6-terra", objective: "Run focused tests", activity: "bash" },
    { id: "monitor-1", kind: "monitor", name: "build", objective: "npm test", activity: "watching" },
    { id: "shell-1", kind: "shell", objective: "npm test", activity: "running" },
  ]), [
    "Active · 4",
    "🤖 reading monitor/runtime.ts · review · O5",
    "🧰 bash · Catalog · build · T5.6",
    "👀 watching · build",
    "💻 npm test",
  ]);

  assert.deepEqual(renderActivityLines(
    [{ id: "shell-1", kind: "shell", objective: "npm test" }],
    [{ id: "done-1", kind: "subagent", role: "independent-review", outcome: "success", summary: "No blocking findings" }],
  ), ["Done", "✅ No blocking findings · review", "Active · 1", "💻 npm test"]);

  const calls = [];
  const surface = createActivitySurface();
  surface.attach({ setWidget: (...args) => calls.push(args) });
  surface.update({ type: "upsert", item: { id: "sub-1", kind: "subagent", role: "review", objective: "x".repeat(200), activity: "thinking" } });
  assert.ok(calls.at(-1)[1][1].length <= ACTIVITY_SUMMARY_LIMIT);
  surface.update({ type: "complete", item: { id: "sub-1", kind: "subagent", role: "independent-review", model: "anthropic/claude-opus-5", outcome: "success", summary: "No blocking findings." } });
  assert.deepEqual(calls.at(-1), [ACTIVITY_CHANNEL, ["Done", "✅ No blocking findings · review"]]);
  const completionRenderCount = calls.length;
  surface.update({ type: "upsert", item: { id: "sub-1", kind: "subagent", role: "constructor", activity: "late terminal update" } });
  assert.equal(calls.length, completionRenderCount, "a terminal update must not resurrect completed activity");
  surface.clearCompleted();
  assert.deepEqual(calls.at(-1), [ACTIVITY_CHANNEL, undefined]);
  surface.update({ type: "upsert", item: { id: "bad", kind: "unknown" } });
  assert.deepEqual(calls.at(-1), [ACTIVITY_CHANNEL, undefined]);
});
