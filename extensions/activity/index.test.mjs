import assert from "node:assert/strict";
import test from "node:test";
import activityExtension from "./index.ts";

test("projects active shell tools through the shared activity surface", () => {
  const lifecycle = new Map();
  const channels = new Map();
  let component;
  let renders = 0;
  const pi = {
    on: (event, handler) => lifecycle.set(event, handler),
    events: {
      on: (channel, handler) => { channels.set(channel, handler); return () => {}; },
      emit: (channel, event) => channels.get(channel)?.(event),
    },
  };
  const ui = { setWidget: (_id, value) => {
    if (typeof value === "function") component = value({ requestRender: () => { renders += 1; } });
  } };

  activityExtension(pi);
  lifecycle.get("session_start")({}, { mode: "tui", ui });
  lifecycle.get("tool_execution_start")({ toolCallId: "bash-1", toolName: "bash", args: { command: "npm test" } });
  assert.equal(renders, 1);
  assert.deepEqual(component.render(80), ["Active · 1", "💻 npm test"]);
  lifecycle.get("tool_execution_end")({ toolCallId: "bash-1", toolName: "bash" });
  assert.deepEqual(component.render(80), []);
});
