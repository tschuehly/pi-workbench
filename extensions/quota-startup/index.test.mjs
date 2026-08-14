import assert from "node:assert/strict";
import test from "node:test";
import quotaStartupExtension from "./index.ts";

test("skips interactive quota repair during RPC startup", async () => {
  let startup;
  let execCalls = 0;
  const pi = {
    exec: async () => {
      execCalls += 1;
      return { code: 0, stdout: "{}", stderr: "" };
    },
    on: (event, handler) => { if (event === "session_start") startup = handler; },
    registerCommand: () => {},
  };

  quotaStartupExtension(pi);
  await startup({ reason: "startup" }, {
    mode: "rpc",
    hasUI: true,
    ui: { notify: () => {}, confirm: async () => false },
  });

  assert.equal(execCalls, 0);
});
