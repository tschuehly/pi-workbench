import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import subagentExtension, { PROFILES, detachLatestForeground, emitExecutionEvent, harnessRevision, providerOf, streamToResult } from "./index.ts";

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

test("bounds the hierarchy to lead → worker → leaf with a delegating coordinator profile", () => {
  const tools = new Map();
  subagentExtension({ on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} });

  const leafProfiles = tools.get("subagent").parameters.properties.profile.enum;
  const workerProfiles = tools.get("worker_create").parameters.properties.profile.enum;
  assert.deepEqual(leafProfiles, ["scout", "planner", "reviewer", "implementer"], "coordinator is worker-only");
  assert.deepEqual(workerProfiles, ["scout", "planner", "reviewer", "implementer", "coordinator"]);

  const delegation = ["subagent", "subagent_collect", "subagent_status", "subagent_cancel"];
  assert.deepEqual(PROFILES.coordinator.tools, ["read", "bash", "grep", "find", "ls", ...delegation]);
  for (const worker of ["worker_create", "worker_dispatch", "worker_retire"]) {
    assert.equal(PROFILES.coordinator.tools.includes(worker), false, `a coordinator must not receive ${worker}`);
  }
  for (const mutation of ["edit", "write"]) {
    assert.equal(PROFILES.coordinator.tools.includes(mutation), false, `a coordinator must not receive ${mutation}`);
  }
  for (const leaf of leafProfiles) {
    assert.deepEqual(PROFILES[leaf].tools.filter((tool) => delegation.includes(tool)), [], `leaf profile ${leaf} must have no delegation tool`);
  }
});

test("exposes bounded independence, timeout, and status parameters", () => {
  const tools = new Map();
  subagentExtension({ on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} });

  const leaf = tools.get("subagent").parameters.properties;
  assert.ok(leaf.independentOfModel, "a leaf reviewer carries the recorded author model");
  assert.equal(leaf.timeoutSeconds.maximum, 45 * 60);
  assert.equal(tools.get("worker_dispatch").parameters.properties.timeoutSeconds.maximum, 60 * 60);
  assert.ok(tools.get("subagent_status").parameters.properties.all, "status defaults to the actionable set");

  assert.equal(providerOf("anthropic/claude-opus-5"), "anthropic");
  for (const invalid of [undefined, "claude-opus-5", "/claude-opus-5", "anthropic/"]) assert.equal(providerOf(invalid), undefined);
});

test("reports counts and hides collected children from the default status roster", async () => {
  const tools = new Map();
  subagentExtension({ on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} });
  const status = (params) => tools.get("subagent_status").execute("call", params, undefined, undefined, {});

  const empty = await status({});
  assert.match(empty.content[0].text, /0 running, 0 terminal and uncollected, 0 launched this session\./);
  assert.match(empty.content[0].text, /use all:true for the full roster/);
  assert.deepEqual(empty.details, { children: [], running: 0, uncollected: 0, total: 0 });
});

test("fails closed on worker lifecycle and background delegation from inside a worker", async () => {
  const probe = `
    import assert from "node:assert/strict";
    import subagentExtension from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
    const tools = new Map();
    subagentExtension({ on: () => {}, registerTool: (t) => tools.set(t.name, t), registerShortcut: () => {}, sendMessage: () => {} });
    const ctx = { cwd: "/repo", model: { provider: "anthropic" }, sessionManager: { getSessionId: () => "worker-session", getSessionFile: () => "/sessions/worker.jsonl" } };
    const run = (name, params) => tools.get(name).execute("call", params, undefined, undefined, ctx);
    for (const [name, params] of [
      ["worker_create", { name: "n", scope: "s", profile: "scout" }],
      ["worker_dispatch", { workerId: "w", task: "t", cognitiveRole: "implementation" }],
      ["worker_retire", { workerId: "w", reason: "r" }],
    ]) {
      const result = await run(name, params);
      assert.equal(result.isError, true, name);
      assert.match(result.content[0].text, /Workers cannot create or dispatch Workers/, name);
    }
    const nestedBackground = await run("subagent", { task: "t", profile: "scout", cognitiveRole: "investigation", background: true });
    assert.equal(nestedBackground.isError, true);
    assert.match(nestedBackground.content[0].text, /must run in the foreground/);
    console.log("NESTED_GUARDS_OK");
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    env: { ...process.env, PI_WORKBENCH_EXECUTION_KIND: "worker" },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /NESTED_GUARDS_OK/);
});

test("allows worker lifecycle and background delegation from a lead session", async () => {
  const tools = new Map();
  subagentExtension({ on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} });
  const ctx = { cwd: "/repo", sessionManager: { getSessionId: () => "lead", getSessionFile: () => undefined } };
  const result = await tools.get("worker_create").execute("call", { name: "n", scope: "s", profile: "coordinator" }, undefined, undefined, ctx);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /require a persisted lead Pi session/, "the lead reaches its own preflight, not the nesting guard");
});

test("makes harness revision drift observable to a long-running lead", () => {
  const stable = harnessRevision();
  assert.match(stable, /^[0-9a-f]{12}$/);
  assert.equal(harnessRevision(), stable, "the same bytes give the same revision");
  assert.notEqual(harnessRevision(["/absent-harness-file.js"]), stable, "changed harness bytes change the revision");
});
