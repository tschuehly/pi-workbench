import assert from "node:assert/strict";
import test from "node:test";
import subagentExtension, { completionSummary, detachLatestForeground, streamToResult } from "./index.ts";

test("uses a substantive success line and never hides a failure outcome", () => {
  assert.equal(completionSummary({ outcome: "success", text: "## Verdict\n\n**No blocking findings.**\nDetails follow." }), "No blocking findings.");
  assert.equal(completionSummary({ outcome: "timed_out", text: "Migration complete." }), "timed out");
  assert.equal(completionSummary({ outcome: "execution_failed", diagnostic: "RPC closed", text: "Done." }), "execution failed · RPC closed");
});

test("registers Cmd+B and a portable fallback", () => {
  const shortcuts = new Map();
  subagentExtension({
    on: () => {},
    registerTool: () => {},
    registerShortcut: (key, options) => shortcuts.set(key, options),
    sendMessage: () => {},
  });

  assert.deepEqual([...shortcuts.keys()], ["super+b", "ctrl+alt+b"]);
  let notice;
  shortcuts.get("super+b").handler({ ui: { notify: (...args) => { notice = args; } } });
  assert.deepEqual(notice, ["No Subagent or Worker can be backgrounded.", "info"]);
});

test("Cmd+B detaches the newest foreground delegate", () => {
  const detached = [];
  const foreground = new Map([
    ["first", { label: "Subagent first", detach: () => detached.push("first") }],
    ["second", { label: "Worker “Catalog”", detach: () => detached.push("second") }],
  ]);

  assert.equal(detachLatestForeground(foreground), "Worker “Catalog”");
  assert.deepEqual(detached, ["second"]);
  assert.deepEqual([...foreground.keys()], ["first"]);
});

test("detaching a foreground wait leaves the child running", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const never = new Promise(() => {});
  const adapter = {
    result: () => never,
    cancel: () => { cancelled = true; },
    async *observe() { await never; },
  };

  const waiting = streamToResult(adapter, "child-1", "reviewer", "review", new Date().toISOString(), undefined, undefined, {
    cancelOnAbort: true,
    detachSignal: controller.signal,
  });
  controller.abort();

  const result = await waiting;
  assert.equal(result.details.outcome, "detached");
  assert.equal(cancelled, false);
});
