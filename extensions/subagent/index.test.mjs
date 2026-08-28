import assert from "node:assert/strict";
import test from "node:test";
import subagentExtension, { detachLatestForeground, emitExecutionEvent, streamToResult } from "./index.ts";

test("registers Cmd+B, concept telemetry, and a portable fallback", () => {
  const shortcuts = new Map();
  const tools = new Map();
  subagentExtension({
    on: () => {},
    registerTool: (tool) => tools.set(tool.name, tool),
    registerShortcut: (key, options) => shortcuts.set(key, options),
    sendMessage: () => {},
  });

  assert.deepEqual([...shortcuts.keys()], ["super+b", "ctrl+alt+b"]);
  assert.ok(tools.get("subagent").parameters.properties.telemetryConcept);
  assert.ok(tools.get("worker_dispatch").parameters.properties.telemetryConcept);
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

test("emits structured execution telemetry on the shared extension bus", () => {
  let emitted;
  emitExecutionEvent({ events: { emit: (...args) => { emitted = args; } } }, {
    type: "execution.launched",
    sessionId: "parent",
    executionId: "exec-1",
    task: "Review",
  });
  assert.deepEqual(emitted, ["pi-workbench:telemetry:execution", {
    type: "execution.launched",
    sessionId: "parent",
    executionId: "exec-1",
    task: "Review",
  }]);
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
