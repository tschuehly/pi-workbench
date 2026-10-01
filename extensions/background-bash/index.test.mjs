import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import backgroundBashExtension from "./index.ts";

process.env.PI_BACKGROUND_BASH_ROOT = mkdtempSync(join(tmpdir(), "pi-background-bash-index-"));

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
  assert.match(result.content[0].text, /Continue independent work or end the turn; completion arrives automatically/);
  assert.doesNotMatch(result.content[0].text, /Check bash_status/);
  assert.match(fixture.tools.get("bash_status").description, /Diagnostic snapshot.*Do not use to poll for completion/);
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

test("a reloaded extension reattaches the session's running job and cancels it", async () => {
  const before = harness();
  await before.handlers.get("session_start")({}, before.ctx);
  const started = await before.tools.get("bash").execute("call", { command: "sleep 30" }, undefined, undefined, before.ctx);
  await before.handlers.get("session_shutdown")();
  const after = harness();
  await after.handlers.get("session_start")({ reason: "reload" }, after.ctx);
  const status = await after.tools.get("bash_status").execute("call", { id: started.details.id });
  assert.equal(status.details.jobs[0].state, "running");
  assert.equal(JSON.parse(after.statuses.at(-1)[1]).jobs.length, 1);
  const cancelled = await after.tools.get("bash_cancel").execute("call", { id: started.details.id });
  assert.match(cancelled.content[0].text, /state=cancelled/);
  await after.completion;
  assert.match(after.messages[0].content, /cancelled/);
  await after.handlers.get("session_shutdown")();
});

test("leaving a session via /new keeps its job, and resuming that session reattaches it", async () => {
  const before = harness();
  await before.handlers.get("session_start")({}, before.ctx);
  const started = await before.tools.get("bash").execute("call", { command: "sleep 30" }, undefined, undefined, before.ctx);
  await before.handlers.get("session_shutdown")({ type: "session_shutdown", reason: "new" });
  const resumed = harness();
  await resumed.handlers.get("session_start")({ reason: "resume" }, resumed.ctx);
  const status = await resumed.tools.get("bash_status").execute("call", { id: started.details.id });
  assert.equal(status.details.jobs[0].state, "running");
  await resumed.tools.get("bash_cancel").execute("call", { id: started.details.id });
  await resumed.completion;
  await resumed.handlers.get("session_shutdown")({ type: "session_shutdown", reason: "quit" });
});
