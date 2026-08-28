import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_CHANNEL, ACTIVITY_SUMMARY_LIMIT, createActivitySurface, renderActivityLines, shortModel } from "./activity.mjs";

test("renders bounded one-line activity with compact identity and model names", () => {
  assert.equal(shortModel("anthropic/claude-opus-5"), "Opus 5");
  assert.equal(shortModel("openai-codex/gpt-5.6-terra"), "5.6 Terra");
  assert.equal(shortModel("anthropic/claude-haiku-4-5-20251001"), "Haiku 4.5");

  assert.deepEqual(renderActivityLines([
    { id: "sub-1", kind: "subagent", role: "independent-review", model: "anthropic/claude-opus-5", objective: "Review activity design", activity: "reading monitor/runtime.ts" },
    { id: "work-1", kind: "worker", name: "Catalog", role: "implementation", model: "openai-codex/gpt-5.6-terra", objective: "Run focused tests", activity: "bash" },
    { id: "monitor-1", kind: "monitor", name: "build", objective: "npm test", activity: "watching" },
    { id: "shell-1", kind: "shell", objective: "npm test", activity: "running" },
  ]), [
    "Active · 4",
    "◇ independent review · Opus 5 — Review activity design; reading monitor/runtime.ts",
    "◆ Catalog · implementation · 5.6 Terra — Run focused tests; bash",
    "◌ build — npm test; watching",
    "$ npm test",
  ]);

  const calls = [];
  const surface = createActivitySurface();
  surface.attach({ setWidget: (...args) => calls.push(args) });
  surface.update({ type: "upsert", item: { id: "sub-1", kind: "subagent", role: "review", objective: "x".repeat(200), activity: "thinking" } });
  assert.ok(calls.at(-1)[1][1].split(" — ")[1].length <= ACTIVITY_SUMMARY_LIMIT);
  surface.update({ type: "remove", id: "sub-1" });
  assert.deepEqual(calls.at(-1), [ACTIVITY_CHANNEL, undefined]);
  surface.update({ type: "upsert", item: { id: "bad", kind: "unknown" } });
  assert.deepEqual(calls.at(-1), [ACTIVITY_CHANNEL, undefined]);
});
