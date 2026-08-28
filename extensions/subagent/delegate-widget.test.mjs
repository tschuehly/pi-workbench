import assert from "node:assert/strict";
import test from "node:test";
import { createDelegateWidget } from "./delegate-widget.mjs";

test("keeps active subagents and workers visible above the editor", () => {
  const calls = [];
  const widget = createDelegateWidget();
  widget.attach({ setWidget: (...args) => calls.push(args) });

  widget.launch({ executionId: "sub-1", profile: "scout", cognitiveRole: "investigation", taskPreview: "Inspect lifecycle rendering" });
  widget.update("sub-1", "tool start: read");
  widget.update("sub-1", "tool start: read");
  widget.launch({ executionId: "work-1", workerName: "Catalog", profile: "implementer", cognitiveRole: "implementation", taskPreview: "Run focused tests" });

  assert.deepEqual(calls.at(-1), ["pi-workbench:delegates", [
    "Delegates · 2 active",
    "● Subagent · scout · investigation — Inspect lifecycle rendering — tool start: read",
    "● Worker “Catalog” · implementer · implementation — Run focused tests — starting",
  ]]);
  assert.equal(calls.length, 4, "unchanged activity should not rerender");

  widget.finish("sub-1");
  widget.finish("work-1");
  assert.deepEqual(calls.at(-1), ["pi-workbench:delegates", undefined]);

  widget.dispose();
  widget.update("work-1", "late activity");
  assert.deepEqual(calls.at(-1), ["pi-workbench:delegates", undefined]);
});
