import assert from "node:assert/strict";
import test from "node:test";
import activityExtension from "./index.ts";

test("projects active shell tools through the shared activity surface", () => {
  const lifecycle = new Map();
  const channels = new Map();
  const calls = [];
  const pi = {
    on: (event, handler) => lifecycle.set(event, handler),
    events: {
      on: (channel, handler) => { channels.set(channel, handler); return () => {}; },
      emit: (channel, event) => channels.get(channel)?.(event),
    },
  };

  activityExtension(pi);
  lifecycle.get("session_start")({}, { mode: "tui", ui: { setWidget: (...args) => calls.push(args) } });
  lifecycle.get("tool_execution_start")({ toolCallId: "bash-1", toolName: "bash", args: { command: "npm test" } });
  assert.deepEqual(calls.at(-1), ["pi-workbench:activity", ["Active · 1", "$ npm test"]]);
  lifecycle.get("tool_execution_end")({ toolCallId: "bash-1", toolName: "bash" });
  assert.deepEqual(calls.at(-1), ["pi-workbench:activity", undefined]);
});
