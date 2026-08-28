import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  assert.ok(tools.get("worker_status").parameters.properties.all);
  let notice;
  shortcuts.get("super+b").handler({ ui: { notify: (...args) => { notice = args; } } });
  assert.deepEqual(notice, ["No Subagent or Worker can be backgrounded.", "info"]);
});

test("worker tools isolate mutations and default status by persisted lead session", async () => {
  const previousHome = process.env.HOME;
  const temporaryHome = await mkdtemp(join(tmpdir(), "subagent-extension-home-"));
  process.env.HOME = temporaryHome;
  try {
    const tools = new Map();
    subagentExtension({
      on: () => {},
      registerTool: (tool) => tools.set(tool.name, tool),
      registerShortcut: () => {},
      sendMessage: () => {},
    });
    const ctx = (sessionId, persisted = true) => ({
      cwd: "/repo",
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionFile: () => persisted ? `/sessions/${sessionId}.jsonl` : undefined,
      },
    });
    const execute = (name, params, context) => tools.get(name).execute("call", params, undefined, undefined, context);
    const create = (name, sessionId) => execute("worker_create", { name, scope: `${name} scope`, profile: "scout" }, ctx(sessionId));

    const owned = await create("owned", "lead-a");
    const retired = await create("retired", "lead-a");
    const foreign = await create("foreign", "lead-b");
    await execute("worker_retire", { workerId: retired.details.workerId, reason: "done" }, ctx("lead-a"));

    const current = await execute("worker_status", {}, ctx("lead-a"));
    assert.deepEqual(current.details.workers.map((worker) => worker.name), ["owned"]);
    const diagnostic = await execute("worker_status", { all: true }, ctx("lead-a"));
    assert.deepEqual(diagnostic.details.workers.map((worker) => worker.name), ["owned", "retired", "foreign"]);

    const foreignStatus = await execute("worker_status", { workerId: foreign.details.workerId }, ctx("lead-a"));
    assert.match(foreignStatus.content[0].text, /belongs to another lead session/);
    const foreignDispatch = await execute("worker_dispatch", { workerId: foreign.details.workerId, task: "Inspect only", cognitiveRole: "investigation" }, ctx("lead-a"));
    assert.match(foreignDispatch.content[0].text, /WORKER_SESSION_MISMATCH/);
    const foreignRetire = await execute("worker_retire", { workerId: foreign.details.workerId, reason: "wrong owner" }, ctx("lead-a"));
    assert.match(foreignRetire.content[0].text, /WORKER_SESSION_MISMATCH/);

    const ephemeralCreate = await execute("worker_create", { name: "ephemeral", scope: "none", profile: "scout" }, ctx("temporary", false));
    assert.match(ephemeralCreate.content[0].text, /persisted lead Pi session/);
    const ephemeralDispatch = await execute("worker_dispatch", { workerId: owned.details.workerId, task: "none", cognitiveRole: "investigation" }, ctx("temporary", false));
    assert.match(ephemeralDispatch.content[0].text, /persisted lead Pi session/);
    const ephemeralRetire = await execute("worker_retire", { workerId: owned.details.workerId, reason: "none" }, ctx("temporary", false));
    assert.match(ephemeralRetire.content[0].text, /persisted lead Pi session/);
    assert.equal(owned.details.ownerSessionId, "lead-a");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(temporaryHome, { recursive: true, force: true });
  }
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
