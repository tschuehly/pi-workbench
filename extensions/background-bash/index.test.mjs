import assert from "node:assert/strict";
import { test } from "node:test";
import backgroundBashExtension from "./index.ts";

function harness(mode = "rpc", child = false) {
  const tools = new Map();
  const handlers = new Map();
  const statuses = [];
  const messages = [];
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });
  const pi = {
    registerTool: (tool) => tools.set(tool.name, tool),
    on: (name, handler) => handlers.set(name, handler),
    events: { emit() {} },
    sendMessage: (message) => { messages.push(message); resolveCompletion(); },
  };
  const inheritedKind = process.env.PI_WORKBENCH_EXECUTION_KIND;
  if (!child) delete process.env.PI_WORKBENCH_EXECUTION_KIND;
  try { backgroundBashExtension(pi); }
  finally {
    if (inheritedKind === undefined) delete process.env.PI_WORKBENCH_EXECUTION_KIND;
    else process.env.PI_WORKBENCH_EXECUTION_KIND = inheritedKind;
  }
  const ctx = { mode, cwd: process.cwd(), ui: { setStatus: (key, value) => statuses.push([key, value]) },
    sessionManager: { getSessionId: () => "test-session", getSessionFile: () => undefined }, model: undefined, thinkingLevel: undefined };
  return { tools, handlers, statuses, messages, completion, ctx };
}

test("an attended RPC bash call starts immediately, publishes status, and clears it on shutdown", async () => {
  const fixture = harness();
  await fixture.handlers.get("session_start")({}, fixture.ctx);
  const result = await fixture.tools.get("bash").execute("call", { command: "printf attended" }, undefined, undefined, fixture.ctx);
  assert.match(result.content[0].text, /Background bash .* started/);
  const active = JSON.parse(fixture.statuses.at(-1)[1]).jobs;
  assert.equal(active.length, 1);
  assert.equal(active[0].command, undefined, "status snapshots must not disclose shell commands");
  assert.equal(active[0].elapsedSeconds, 0);
  await fixture.completion;
  assert.match(fixture.messages[0].content, /complete \(exit 0\)/);
  assert.match(fixture.messages[0].content, /attended/);
  assert.equal(JSON.parse(fixture.statuses.at(-1)[1]).jobs.length, 0);
  await fixture.handlers.get("session_shutdown")();
  assert.equal(fixture.statuses.at(-1)[1], undefined);
});

test("a child keeps the native bash tool and one-shot Pi runs foreground", async () => {
  const prior = process.env.PI_WORKBENCH_EXECUTION_KIND;
  process.env.PI_WORKBENCH_EXECUTION_KIND = "subagent";
  try {
    const fixture = harness("rpc", true);
    assert.equal(fixture.tools.has("bash"), false, "the built-in Pi bash remains active in a child");
    assert.equal(fixture.handlers.has("session_shutdown"), false);
  } finally {
    if (prior === undefined) delete process.env.PI_WORKBENCH_EXECUTION_KIND;
    else process.env.PI_WORKBENCH_EXECUTION_KIND = prior;
  }
  const oneShot = harness("print");
  const result = await oneShot.tools.get("bash").execute("call", { command: "printf printed" }, undefined, undefined, oneShot.ctx);
  assert.match(result.content[0].text, /printed/);
  await oneShot.handlers.get("session_shutdown")();
});

test("foreground and background commands receive the session's PI_TMP folder", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.PI_TMP_ROOT = mkdtempSync(join(tmpdir(), "pi-tmp-bash-"));
  try {
    const expected = join(process.env.PI_TMP_ROOT, "pi-workbench", "test-session");
    const oneShot = harness("print");
    const printed = await oneShot.tools.get("bash").execute("call", { command: "printf %s \"$PI_TMP\"" }, undefined, undefined, oneShot.ctx);
    assert.match(printed.content[0].text, new RegExp(expected));
    const attended = harness();
    await attended.tools.get("bash").execute("call", { command: "printf %s \"$PI_TMP\"" }, undefined, undefined, attended.ctx);
    await attended.completion;
    assert.match(attended.messages[0].content, new RegExp(expected));
    await attended.handlers.get("session_shutdown")();
  } finally { delete process.env.PI_TMP_ROOT; }
});
