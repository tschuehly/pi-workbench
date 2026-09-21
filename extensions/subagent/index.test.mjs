import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import subagentExtension, { PROFILES, collectAll, createCheckpointAwareWakeup, detachLatestForeground, emitExecutionEvent, harnessRevision, inheritedConcept, providerOf, reservePending, streamToResult, watchActivity } from "./index.ts";
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
  assert.ok(tools.get("worker_dispatch").parameters.properties.modelOverride);
  assert.equal(tools.get("subagent").parameters.properties.modelOverride, undefined, "only Worker dispatches accept an explicit model");
  assert.ok(tools.get("subagent").parameters.properties.name, "subagent accepts an explicit dispatcher-supplied name");
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

    const invalidOverride = await execute("worker_dispatch", { workerId: owned.details.workerId, task: "none", cognitiveRole: "coordination", modelOverride: "gpt-6-astra" }, ctx("lead-a"));
    assert.match(invalidOverride.content[0].text, /--model must be '<provider>\/<model>'/, "worker_dispatch forwards its override to routing");

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

test("activity progress retains terminal background children but removes foreground children", async () => {
  const events = [];
  const pi = { events: { emit: (channel, event) => events.push([channel, event]) } };
  const adapter = {
    async *observe() {
      yield { type: "tool_progress", detail: { toolName: "bash", action: "running focused tests" } };
      yield { type: "terminal", detail: { outcome: "success" } };
    },
  };
  const activity = { id: "delegate:child-1", kind: "subagent", role: "implementation", model: "openai/gpt", effort: "medium", objective: "Fix the roster", activity: "starting" };

  await watchActivity(pi, adapter, "child-1", activity, () => true);
  assert.equal(events.at(-2)[1].item.activity, "running focused tests");
  assert.equal(events.at(-1)[1].item.activity, "success");
  assert.equal(events.some(([, event]) => event.type === "remove"), false);

  events.length = 0;
  await watchActivity(pi, adapter, "child-1", activity);
  assert.deepEqual(events.at(-1), ["pi-workbench:activity", { type: "remove", id: "delegate:child-1" }]);
});

test("watchActivity keeps the last self-reported status while inferred activity keeps updating", async () => {
  const events = [];
  const pi = { events: { emit: (channel, event) => events.push([channel, event]) } };
  const adapter = {
    async *observe() {
      yield { type: "tool_progress", detail: { toolName: "read", action: "reading roster.ts" } };
      yield { type: "tool_start", detail: { toolName: "report_status", action: "Investigating the roster bug" } };
      yield { type: "tool_progress", detail: { toolName: "edit", action: "editing roster.ts" } };
      yield { type: "tool_start", detail: { toolName: "report_status", action: "Fixing the roster bug" } };
      yield { type: "tool_progress", detail: { toolName: "bash", action: "running focused tests" } };
    },
  };
  const activity = { id: "delegate:child-2", kind: "subagent", role: "implementation", model: "openai/gpt", effort: "medium", objective: "Fix the roster", activity: "starting" };

  await watchActivity(pi, adapter, "child-2", activity, () => true);
  const items = events.filter(([channel]) => channel === "pi-workbench:activity").map(([, event]) => event.item);
  assert.deepEqual(items.map((item) => item.activity), ["reading roster.ts", "Investigating the roster bug", "editing roster.ts", "Fixing the roster bug", "running focused tests"]);
  assert.deepEqual(items.map((item) => item.reportedStatus), [undefined, "Investigating the roster bug", "Investigating the roster bug", "Fixing the roster bug", "Fixing the roster bug"]);
});

test("collection and explicit cancellation remove retained activity", async () => {
  const events = [];
  const tools = new Map();
  const final = {
    outcome: "success", text: "Done.", kind: "subagent", profile: "implementer", cognitiveRole: "implementation",
    provider: "openai", model: "gpt", effort: "medium", sessionId: "child-session",
  };
  const adapter = {
    result: async () => final,
    async *observe() { yield { type: "terminal", at: new Date().toISOString(), detail: { outcome: "success" } }; },
    list: () => [{ executionId: "child-1", running: false }],
    cancel: async (executionId) => ({ executionId, outcome: "cancelled" }),
    cancelAll: async () => [],
  };
  subagentExtension({
    events: { emit: (channel, event) => events.push([channel, event]) },
    on: () => {},
    registerTool: (tool) => tools.set(tool.name, tool),
    registerShortcut: () => {},
    sendMessage: () => {},
  }, { adapter });

  await tools.get("subagent_collect").execute("collect", { executionId: "child-1" }, undefined, undefined);
  await tools.get("subagent_cancel").execute("cancel", { executionId: "child-2" }, undefined, undefined);
  assert.deepEqual(events.filter(([, event]) => event.type === "remove").map(([, event]) => event.id), ["delegate:child-1", "delegate:child-2"]);
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

test("a terminal review receipt exposes verified panel family evidence", async () => {
  const independence = { independentOfProvider: "openai-codex", independentOfFamily: "openai", selectedFamily: "xai", excludedFamilies: ["anthropic"] };
  const final = { outcome: "success", text: "Reviewed.", kind: "subagent", profile: "reviewer", cognitiveRole: "challenge", provider: "github-copilot", model: "grok-4.6", effort: "high", independence };
  const adapter = { result: () => Promise.resolve(final), cancel: () => {}, async *observe() {} };
  const result = await streamToResult(adapter, "judge-2", "reviewer", "challenge", new Date().toISOString(), undefined, undefined, { cancelOnAbort: true });
  assert.match(result.content[0].text, /family xai/);
  assert.match(result.content[0].text, /excluded anthropic/);
  assert.deepEqual(result.details.independence, independence);
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

test("exposes no task timeout controls with bounded independence and status parameters", () => {
  const tools = new Map();
  subagentExtension({ on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} });

  const leaf = tools.get("subagent").parameters.properties;
  assert.ok(leaf.independentOfModel, "a leaf reviewer carries the recorded author model");
  assert.equal(leaf.excludeFamilies.type, "array", "only Subagents expose repeatable family exclusions");
  assert.equal(tools.get("worker_dispatch").parameters.properties.excludeFamilies, undefined, "Workers cannot request family exclusions");
  assert.equal(leaf.timeoutSeconds, undefined);
  assert.equal(tools.get("worker_dispatch").parameters.properties.timeoutSeconds, undefined);
  assert.ok(tools.get("subagent_status").parameters.properties.all, "status defaults to the actionable set");
  const collect = tools.get("subagent_collect").parameters;
  assert.ok(collect.properties.executionId, "one child can still be collected by identifier");
  assert.equal((collect.required ?? []).includes("executionId"), false, "collecting without an identifier reconciles every terminal child");

  assert.equal(providerOf("anthropic/claude-opus-5"), "anthropic");
  for (const invalid of [undefined, "claude-opus-5", "/claude-opus-5", "anthropic/"]) assert.equal(providerOf(invalid), undefined);
});

test("rejects family exclusions on non-independent roles before routing", async () => {
  const tools = new Map();
  subagentExtension({ on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} });

  const result = await tools.get("subagent").execute("call", {
    task: "Inspect routing",
    profile: "reviewer",
    cognitiveRole: "investigation",
    excludeFamilies: ["anthropic"],
  }, undefined, undefined, { model: { provider: "openai-codex", id: "gpt-6-astra" } });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /does not use.*family exclusion/i);
});

test("defaults independence to the exact parent model and preserves repeated family exclusions in the adapter binding", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "subagent-routing-"));
  const resolverPath = join(temporary, "resolver.mjs");
  const argsPath = join(temporary, "args.json");
  await writeFile(resolverPath, `
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
    const cognitiveRole = process.argv[2];
    console.log(JSON.stringify({ status: "pass", modelBinding: {
      cognitiveRole,
      provider: "github-copilot", model: "gemini-2.5-pro", effort: "high",
      independence: {
        independentOfProvider: "github-copilot",
        independentOfModel: "github-copilot/claude-sonnet-5",
        independentOfFamily: "anthropic",
        selectedFamily: "google",
        excludedFamilies: ["anthropic", "openai"],
      },
      admission: "degraded-quota-telemetry",
      quotaSnapshot: { generatedAt: null, telemetryStatus: "unavailable", relevantWindows: [], stale: false, refreshedAt: null, error: "test" },
    }}));
  `);

  let dispatched;
  const never = new Promise(() => {});
  const adapter = {
    dispatch: async (spec) => { dispatched = structuredClone(spec); return { executionId: "execution-1", acceptedAt: "2026-09-01T00:00:00Z" }; },
    result: () => never,
    async *observe() {},
    list: () => [],
    cancelAll: async () => [],
  };
  const tools = new Map();
  const pi = {
    events: { emit: () => {} },
    on: () => {},
    registerTool: (tool) => tools.set(tool.name, tool),
    registerShortcut: () => {},
    sendMessage: () => {},
  };

  try {
    subagentExtension(pi, { adapter, resolverPath });
    const result = await tools.get("subagent").execute("call", {
      task: "Review the author output",
      profile: "reviewer",
      cognitiveRole: "independent-review",
      excludeFamilies: ["anthropic", "openai"],
      background: true,
    }, undefined, undefined, {
      cwd: "/repo",
      model: { provider: "github-copilot", id: "claude-sonnet-5" },
      sessionManager: { getSessionId: () => "lead" },
    });

    assert.equal(result.details.outcome, "launched");
    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "independent-review",
      "--independent-of-model", "github-copilot/claude-sonnet-5",
      "--exclude-family", "anthropic",
      "--exclude-family", "openai",
    ]);
    assert.equal(dispatched.binding.independence.selectedFamily, "google");
    assert.deepEqual(dispatched.binding.independence.excludedFamilies, ["anthropic", "openai"]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("provider-only authors never borrow a parent model and are used only when an exact model is unavailable", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "subagent-routing-provider-"));
  const resolverPath = join(temporary, "resolver.mjs");
  const argsPath = join(temporary, "args.json");
  await writeFile(resolverPath, `
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
    console.log(JSON.stringify({ status: "pass", modelBinding: {
      cognitiveRole: process.argv[2], provider: "openai-codex", model: "gpt-6-astra", effort: "high",
      independence: { independentOfProvider: "anthropic", independentOfFamily: "anthropic", selectedFamily: "openai" },
      admission: "degraded-quota-telemetry",
      quotaSnapshot: { generatedAt: null, telemetryStatus: "unavailable", relevantWindows: [], stale: false, refreshedAt: null, error: "test" },
    }}));
  `);

  const never = new Promise(() => {});
  const adapter = { dispatch: async () => ({ executionId: "execution-2", acceptedAt: "2026-09-01T00:00:00Z" }), result: () => never, async *observe() {}, list: () => [], cancelAll: async () => [] };
  const tools = new Map();
  try {
    subagentExtension({ events: { emit: () => {} }, on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} }, { adapter, resolverPath });
    await tools.get("subagent").execute("call", {
      task: "Review the author output", profile: "reviewer", cognitiveRole: "independent-review",
      independentOfProvider: "anthropic", background: true,
    }, undefined, undefined, {
      cwd: "/repo",
      model: { provider: "unknown-gateway", id: "must-not-be-guessed" },
      sessionManager: { getSessionId: () => "lead" },
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), ["independent-review", "--independent-of", "anthropic"]);

    await tools.get("subagent").execute("call", {
      task: "Review the parent output", profile: "reviewer", cognitiveRole: "independent-review", background: true,
    }, undefined, undefined, {
      cwd: "/repo",
      model: { provider: "github-copilot", id: "" },
      sessionManager: { getSessionId: () => "lead" },
    });
    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), ["independent-review", "--independent-of", "github-copilot"]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

async function dispatchSubagentWithName(params) {
  const temporary = await mkdtemp(join(tmpdir(), "subagent-name-"));
  const resolverPath = join(temporary, "resolver.mjs");
  await writeFile(resolverPath, `
    console.log(JSON.stringify({ status: "pass", modelBinding: {
      cognitiveRole: process.argv[2],
      provider: "anthropic", model: "claude-test", effort: "high",
      admission: "fresh-quota",
      quotaSnapshot: { generatedAt: null, telemetryStatus: "unavailable", relevantWindows: [], stale: false, refreshedAt: null, error: "test" },
    }}));
  `);
  let dispatched;
  const events = [];
  const never = new Promise(() => {});
  const adapter = {
    dispatch: async (spec) => { dispatched = structuredClone(spec); return { executionId: "execution-name", acceptedAt: "2026-09-01T00:00:00Z" }; },
    result: () => never,
    async *observe() {},
    list: () => [],
    cancelAll: async () => [],
  };
  const tools = new Map();
  const pi = { events: { emit: (channel, event) => events.push([channel, event]) }, on: () => {}, registerTool: (tool) => tools.set(tool.name, tool), registerShortcut: () => {}, sendMessage: () => {} };
  try {
    subagentExtension(pi, { adapter, resolverPath });
    await tools.get("subagent").execute("call", {
      profile: "reviewer",
      cognitiveRole: "investigation",
      background: true,
      ...params,
    }, undefined, undefined, { cwd: "/repo", model: { provider: "anthropic", id: "claude" }, sessionManager: { getSessionId: () => "lead" } });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const activityItem = events.find(([channel, event]) => channel === "pi-workbench:activity" && event.type === "upsert")[1].item;
  return { dispatched, activityName: activityItem.name };
}

test("an explicit subagent name wins over the task-derived label and slug", async () => {
  const { dispatched, activityName } = await dispatchSubagentWithName({
    task: "Verification task, read-only with respect to routing. Actually: fix the roster label.",
    name: "Fix roster label",
  });
  assert.equal(dispatched.name, "Fix roster label");
  assert.equal(activityName, "Fix roster label");
});

test("an omitted subagent name falls back to the task-derived label, unchanged", async () => {
  const { dispatched, activityName } = await dispatchSubagentWithName({
    task: "Fix the roster label. Then verify it.",
  });
  assert.equal(dispatched.name, undefined);
  assert.equal(activityName, "Fix the roster label");
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
