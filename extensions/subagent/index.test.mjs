import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import subagentExtension, { PROFILES, collectAll, createCheckpointAwareWakeup, detachLatestForeground, emitExecutionEvent, harnessRevision, inheritedConcept, providerOf, reservePending, streamToResult } from "./index.ts";
import { checkpointBarrier, createCheckpointBarrier } from "../context-checkpoint/checkpoint-barrier.mjs";

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

test("a terminal result cites the author model so independentOfModel can quote a receipt", async () => {
  const final = {
    outcome: "success", text: "Applied the caption fix.", truncated: false, kind: "subagent",
    profile: "implementer", cognitiveRole: "implementation",
    provider: "anthropic", model: "claude-sonnet-5", effort: "medium", sessionId: "leaf",
  };
  const adapter = { result: () => Promise.resolve(final), cancel: () => {}, async *observe() {} };

  const result = await streamToResult(adapter, "child-1", "implementer", "implementation", new Date().toISOString(), undefined, undefined, { cancelOnAbort: true });
  assert.match(result.content[0].text, /Completion receipt: anthropic\/claude-sonnet-5:medium/);
  assert.equal(result.details.model, "claude-sonnet-5");

  const truncated = { ...final, truncated: true };
  const oversized = await streamToResult({ ...adapter, result: () => Promise.resolve(truncated) }, "child-2", "implementer", "implementation", new Date().toISOString(), undefined, undefined, { cancelOnAbort: true });
  assert.match(oversized.content[0].text, /TRUNCATED, cannot satisfy verification/);
});

test("a leaf inherits the concept slug of the worker phase that launched it", () => {
  assert.equal(inheritedConcept({ PI_WORKBENCH_TELEMETRY_CONCEPT: "29-printed-cards-giftable" }), "29-printed-cards-giftable");
  assert.equal(inheritedConcept({ PI_WORKBENCH_TELEMETRY_CONCEPT: "  " }), undefined);
  assert.equal(inheritedConcept({}), undefined);
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
  const collect = tools.get("subagent_collect").parameters;
  assert.ok(collect.properties.executionId, "one child can still be collected by identifier");
  assert.equal((collect.required ?? []).includes("executionId"), false, "collecting without an identifier reconciles every terminal child");

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

test("holds one coalesced completion signal while a context checkpoint is pending or compacting", () => {
  const barrier = createCheckpointBarrier();
  const sent = [];
  const wakeup = createCheckpointAwareWakeup({ sendMessage: (message, options) => sent.push({ attention: message.details?.attention, deliverAs: options?.deliverAs, triggerTurn: options?.triggerTurn }) }, barrier);
  const finish = (executionId, extra = {}) => wakeup.notify({ executionId, outcome: "succeeded", profile: "implementer", cognitiveRole: "implementation", ...extra });

  finish("before-checkpoint");
  assert.equal(sent.length, 1);
  wakeup.rearm();

  barrier.open();
  finish("during-pending");
  barrier.beginCompaction();
  finish("during-compaction");
  assert.equal(sent.length, 1, "no turn-triggering wake escapes the checkpoint");

  barrier.release();
  assert.equal(sent.length, 2, "a checkpoint fan-out releases one coalesced signal");
  assert.equal(sent.every((entry) => entry.attention === "terminal-results" && entry.deliverAs === "steer" && entry.triggerTurn === true), true);

  barrier.release();
  assert.equal(sent.length, 2, "queued wakes are released exactly once");
});

test("re-arms coalesced completion attention on marker delivery and on agent_settled", () => {
  const handlers = new Map();
  subagentExtension({
    on: (event, handler) => handlers.set(event, handler),
    registerTool: () => {},
    registerShortcut: () => {},
    sendMessage: () => {},
  });

  assert.ok(handlers.has("message_start"), "delivery of the coalesced marker must return attention to idle");
  assert.ok(handlers.has("agent_settled"), "a settled agent must re-arm without sending");
  handlers.get("message_start")({ message: { role: "assistant", content: [] } });
  handlers.get("agent_settled")({});
});

test("keeps a terminal wake and a receipt-failure wake for one execution distinct across a checkpoint", () => {
  const barrier = createCheckpointBarrier();
  const sent = [];
  const wakeup = createCheckpointAwareWakeup({ sendMessage: (message) => sent.push(message.details?.receiptStatus ?? "terminal") }, barrier);

  barrier.open();
  const base = { executionId: "execution-1", outcome: "succeeded", profile: "implementer", cognitiveRole: "implementation" };
  wakeup.notify(base);
  wakeup.notify({ ...base, workerId: "worker-1", receiptFailure: "registry write failed" });
  assert.deepEqual(sent, []);

  barrier.release();
  assert.deepEqual(sent, ["terminal", "failed"], "the receipt failure must not overwrite the coalesced signal");
});

test("collecting without an identifier reconciles every terminal child exactly once", async () => {
  const calls = [];
  const collectOne = async (executionId) => {
    calls.push(executionId);
    return { content: [{ type: "text", text: `result of ${executionId}` }], details: { outcome: "success" } };
  };

  const aggregate = await collectAll({ pending: ["child-a", "child-b"], running: 1, collectOne });
  assert.deepEqual(calls, ["child-a", "child-b"], "every terminal child is collected once, in launch order");
  assert.match(aggregate.content[0].text, /Reconciled 2 of 2 terminal children/);
  assert.match(aggregate.content[0].text, /child-a \[success\]\nresult of child-a/);
  assert.match(aggregate.content[0].text, /1 child is still running and cannot be collected yet/);
  assert.deepEqual(aggregate.details.collected, [
    { executionId: "child-a", outcome: "success" },
    { executionId: "child-b", outcome: "success" },
  ]);
  assert.deepEqual(aggregate.details.remaining, []);
});

test("bulk collection stays bounded and leaves what it did not read reconcilable", async () => {
  const calls = [];
  const collectOne = async (executionId) => {
    calls.push(executionId);
    return { content: [{ type: "text", text: "x".repeat(60) }], details: { outcome: "success" } };
  };

  const aggregate = await collectAll({ pending: ["child-a", "child-b", "child-c"], running: 0, collectOne, maxChars: 50 });
  assert.deepEqual(calls, ["child-a"], "a child past the budget is never collected, so it stays reconcilable");
  assert.deepEqual(aggregate.details.remaining, ["child-b", "child-c"]);
  assert.match(aggregate.content[0].text, /Reconciled 1 of 3 terminal children/);
  assert.match(aggregate.content[0].text, /collect again or name one: child-b, child-c/);

  const many = await collectAll({
    pending: Array.from({ length: 15 }, (_, index) => `child-${index}`),
    running: 0,
    collectOne,
    maxChars: 1,
  });
  assert.equal(many.details.remaining.length, 14);
  assert.equal((many.content[0].text.match(/child-\d+,/g) ?? []).length <= 10, true, "the named remainder stays bounded");
  assert.match(many.content[0].text, /and 4 more reached by collecting again/);
});

test("collecting an empty roster through the registered tool reports nothing to reconcile", async () => {
  const tools = new Map();
  subagentExtension({ on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} });

  const result = await tools.get("subagent_collect").execute("call", {}, undefined, undefined, {});
  assert.match(result.content[0].text, /Nothing terminal to reconcile/);
  assert.deepEqual(result.details, { collected: [], remaining: [], running: 0 });
});

test("two bulk collections in one batch cannot reconcile the same child twice", () => {
  const roster = [
    { executionId: "child-a", running: false },
    { executionId: "child-b", running: true },
    { executionId: "child-c", running: false },
  ];
  const collected = new Set(["child-c"]);
  const reconciling = new Set();

  assert.deepEqual(reservePending(roster, collected, reconciling), ["child-a"], "a running child and an already-collected child are left alone");
  assert.deepEqual(reservePending(roster, collected, reconciling), [], "a parallel call finds the reserved child already claimed");
  reconciling.delete("child-a");
  assert.deepEqual(reservePending(roster, collected, reconciling), ["child-a"], "a released reservation is reconcilable again");
});

test("bulk collection reports an empty roster and never hides a child failure", async () => {
  const empty = await collectAll({ pending: [], running: 2, collectOne: async () => assert.fail("nothing terminal may be collected") });
  assert.match(empty.content[0].text, /Nothing terminal to reconcile/);
  assert.match(empty.content[0].text, /2 children are still running/);
  assert.deepEqual(empty.details.collected, []);

  const failing = await collectAll({
    pending: ["child-a"],
    running: 0,
    collectOne: async () => ({ content: [{ type: "text", text: "registry receipt did not settle" }], details: { outcome: "outcome_unknown" }, isError: true }),
  });
  assert.equal(failing.isError, true, "an outcome_unknown child must stay visible as an error through the aggregate");
  assert.deepEqual(failing.details.collected, [{ executionId: "child-a", outcome: "outcome_unknown" }]);
});

test("the subagent extension uses the process-shared barrier", () => {
  assert.equal(checkpointBarrier(), checkpointBarrier());
});
