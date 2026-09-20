import assert from "node:assert/strict";
import test from "node:test";
import activityExtension from "./index.ts";

function harness() {
  const lifecycle = new Map();
  const channels = new Map();
  const pi = {
    on: (event, handler) => lifecycle.set(event, handler),
    events: {
      on: (channel, handler) => { channels.set(channel, handler); return () => {}; },
      emit: (channel, event) => channels.get(channel)?.(event),
    },
  };
  return { lifecycle, channels, pi };
}

test("projects active shell tools through the shared activity surface", () => {
  const { lifecycle, pi } = harness();
  let component;
  let renders = 0;
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

test("publishes and clears the versioned activity status in RPC mode", () => {
  const { lifecycle, pi } = harness();
  const statuses = [];
  activityExtension(pi);
  lifecycle.get("session_start")({}, { mode: "rpc", ui: { setStatus: (...args) => statuses.push(args) } });
  pi.events.emit("pi-workbench:activity", { type: "upsert", item: {
    id: "delegate:child-1", kind: "subagent", role: "implementation", model: "openai/gpt", effort: "medium", objective: "Fix roster", activity: "testing",
  } });
  assert.deepEqual(JSON.parse(statuses.at(-1)[1]), {
    schemaVersion: 1,
    items: [{ id: "delegate:child-1", kind: "subagent", role: "implementation", model: "openai/gpt", effort: "medium", objective: "Fix roster", activity: "testing" }],
  });
  lifecycle.get("session_shutdown")();
  assert.deepEqual(statuses.at(-1), ["pi-workbench:activity", undefined]);
});
