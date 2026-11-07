import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import subagentExtension, { RELOAD_HANDOFF_VERSION, claimReloadHandoff, stashForReload } from "./index.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const COMPLETION = "pi-workbench:child-completion";

/** A controllable stand-in for PiRpcExecutionAdapter: children run until the test finishes them. */
function fakeAdapter(prefix) {
  const children = new Map();
  const calls = { cancelAll: 0, cancel: [], steer: [], dispatched: 0 };
  const get = (executionId) => {
    const child = children.get(executionId);
    if (child === undefined) throw new Error(`Execution ${executionId} was not found.`);
    return child;
  };
  const summary = (child) => ({ executionId: child.executionId, profile: child.spec.profile, cognitiveRole: child.spec.cognitiveRole, kind: child.spec.kind ?? "subagent", running: !child.done, outcome: child.outcome, acceptedAt: "2026-10-21T00:00:00Z" });
  const adapter = {
    calls,
    async dispatch(spec) {
      calls.dispatched += 1;
      const executionId = `${prefix}-${children.size + 1}`;
      let settle;
      const result = new Promise((resolve) => { settle = resolve; });
      children.set(executionId, { executionId, spec, result, settle, done: false, outcome: undefined, observations: [], wake: undefined });
      return { executionId, acceptedAt: "2026-10-21T00:00:00Z" };
    },
    result: (executionId) => get(executionId).result,
    async *observe(executionId) {
      const child = get(executionId);
      let cursor = 0;
      while (true) {
        while (cursor < child.observations.length) yield child.observations[cursor++];
        if (child.done) return;
        await new Promise((resolve) => { child.wake = resolve; });
      }
    },
    status: (executionId) => ({ ...summary(get(executionId)), provider: "anthropic", model: "claude-test", effort: "low", observationCount: get(executionId).observations.length }),
    list: () => [...children.values()].map(summary),
    async cancel(executionId) { calls.cancel.push(executionId); adapter.finish(executionId, { outcome: "cancelled" }); return { executionId, outcome: "cancelled" }; },
    async steer(executionId, message, mode = "steer") { get(executionId); calls.steer.push({ executionId, message }); return { executionId, mode, sequence: 0 }; },
    async cancelAll() {
      calls.cancelAll += 1;
      for (const child of children.values()) if (!child.done) adapter.finish(child.executionId, { outcome: "cancelled" });
      return [];
    },
    push: (executionId, observation) => { const child = get(executionId); child.observations.push({ executionId, sequence: child.observations.length + 1, at: "2026-10-21T00:00:01Z", ...observation }); child.wake?.(); },
    finish(executionId, final) {
      const child = get(executionId);
      child.done = true;
      child.outcome = final.outcome;
      child.observations.push({ executionId, sequence: child.observations.length + 1, at: "2026-10-21T00:01:00Z", type: "terminal", detail: { outcome: final.outcome } });
      child.settle({ text: "", truncated: false, kind: child.spec.kind ?? "subagent", profile: child.spec.profile, cognitiveRole: child.spec.cognitiveRole, provider: "anthropic", model: "claude-test", effort: "low", ...final });
      child.wake?.();
    },
  };
  return adapter;
}

async function fakeResolver() {
  const directory = await mkdtemp(join(tmpdir(), "subagent-reload-handoff-"));
  const resolverPath = join(directory, "resolver.mjs");
  await writeFile(resolverPath, `
    console.log(JSON.stringify({ status: "pass", modelBinding: {
      cognitiveRole: process.argv[2], provider: "anthropic", model: "claude-test", effort: "low",
      admission: "degraded-quota-telemetry",
      quotaSnapshot: { generatedAt: null, telemetryStatus: "unavailable", relevantWindows: [], stale: false, refreshedAt: null, error: "test" },
    }}));
  `);
  return { directory, resolverPath };
}

/** One extension instance of a lead session; instances of the same session share its persisted entries. */
function leadInstance({ sessionId, entries, adapter, resolverPath, reloadClaimMs }) {
  const tools = new Map();
  const handlers = new Map();
  const sent = [];
  const roster = new Map();
  let stale = false;
  const guard = () => { if (stale) throw new Error("This extension ctx is stale after session replacement or reload."); };
  subagentExtension({
    events: { emit: (channel, event) => {
      guard();
      if (channel !== "pi-workbench:activity") return;
      if (event.type === "remove") roster.delete(event.id);
      else roster.set(event.item.id, event.item);
    } },
    on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerTool: (tool) => tools.set(tool.name, tool),
    registerShortcut: () => {},
    sendMessage: (message, options) => { guard(); sent.push({ message, options }); },
    appendEntry: (customType, data) => { guard(); entries.push({ type: "custom", customType, data: structuredClone(data) }); },
  }, { adapter, resolverPath, reloadClaimMs });
  const ctx = { cwd: "/repo", model: { provider: "anthropic", id: "claude" }, sessionManager: { getSessionId: () => sessionId, getSessionFile: () => `/sessions/${sessionId}.jsonl`, getBranch: () => entries, buildSessionProjection: () => ({ messages: [] }) } };
  return {
    sent, roster,
    completions: () => sent.filter((entry) => entry.message.customType === COMPLETION).length,
    // The SDK invalidates the old runner right after session_shutdown(reload) returns.
    fire: async (event, payload) => { for (const handler of handlers.get(event) ?? []) await handler(payload, ctx); if (event === "session_shutdown") stale = true; },
    run: (name, params) => tools.get(name).execute("call", params, undefined, undefined, ctx),
  };
}

test("a reload hands running children to the next instance, which re-attaches roster, tools, and one completion", async () => {
  const { directory, resolverPath } = await fakeResolver();
  try {
    const entries = [];
    const oldAdapter = fakeAdapter("old");
    const first = leadInstance({ sessionId: "reload-handoff-live", entries, adapter: oldAdapter, resolverPath });
    await first.fire("session_start", { reason: "startup" });
    const launch = await first.run("subagent", { task: "Sleep, then report", name: "Sleeper", profile: "scout", cognitiveRole: "routine", background: true });
    const id = launch.details.executionId;
    oldAdapter.push(id, { type: "tool_start", detail: { toolName: "bash", action: "sleep 60" } });
    await tick();

    await first.fire("session_shutdown", { reason: "reload" });
    assert.equal(oldAdapter.calls.cancelAll, 0, "reload must not cancel running children");

    const newAdapter = fakeAdapter("new");
    const second = leadInstance({ sessionId: "reload-handoff-live", entries, adapter: newAdapter, resolverPath });
    await second.fire("session_start", { reason: "reload" });
    assert.deepEqual([...second.roster.keys()], [`delegate:${id}`], "the reloaded roster shows the adopted child");
    assert.equal(second.roster.get(`delegate:${id}`).name, "Sleeper");

    const status = await second.run("subagent_status", {});
    assert.match(status.content[0].text, new RegExp(`1 running, 0 terminal and uncollected, 1 launched this session[\\s\\S]*${id} \\[running\\]`));
    assert.doesNotMatch(status.content[0].text, /interrupted/);
    assert.match((await second.run("subagent_collect", { executionId: id })).content[0].text, /\[running\]/);
    await second.run("subagent_steer", { executionId: id, message: "Hurry up" });
    assert.deepEqual(oldAdapter.calls.steer.map((call) => call.executionId), [id], "steer reaches the adapter that launched the child");

    // New launches use the reloaded revision's adapter.
    const fresh = await second.run("subagent", { task: "New work", profile: "scout", cognitiveRole: "routine", background: true });
    assert.equal(fresh.details.executionId, "new-1");
    assert.equal(oldAdapter.calls.dispatched, 1);

    oldAdapter.finish(id, { outcome: "success", text: "SLEPT_OK", sessionId: "child-session" });
    for (let i = 0; i < 5; i += 1) await tick();
    assert.equal(first.completions(), 0, "the stale instance sends nothing");
    assert.equal(second.completions(), 1, "the completion wakes the reloaded lead exactly once");

    const collected = await second.run("subagent_collect", {});
    assert.deepEqual(collected.details.collected, [{ executionId: id, outcome: "success" }]);
    assert.match(collected.content[0].text, /SLEPT_OK/);
    assert.deepEqual((await second.run("subagent_collect", {})).details.collected, [], "collected once");
    assert.equal(second.completions(), 1);
    const settledRecord = entries.find((entry) => entry.data.executionId === id && entry.data.status === "success");
    assert.ok(settledRecord, "the settled record reaches the persisted session through the live instance");

    await second.fire("session_shutdown", { reason: "quit" });
    assert.equal(oldAdapter.calls.cancelAll, 1, "quit cancels adopted children");
    assert.equal(newAdapter.calls.cancelAll, 1, "quit cancels the instance's own children");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a child that finishes while the session reloads is delivered once to the next instance", async () => {
  const { directory, resolverPath } = await fakeResolver();
  try {
    const entries = [];
    const adapter = fakeAdapter("limbo");
    const first = leadInstance({ sessionId: "reload-handoff-limbo", entries, adapter, resolverPath });
    await first.fire("session_start", { reason: "startup" });
    const { details: { executionId } } = await first.run("subagent", { task: "Finish during reload", profile: "scout", cognitiveRole: "routine", background: true });
    await first.fire("session_shutdown", { reason: "reload" });

    adapter.finish(executionId, { outcome: "success", text: "DONE_IN_LIMBO" });
    for (let i = 0; i < 5; i += 1) await tick();
    assert.equal(first.completions(), 0);

    const second = leadInstance({ sessionId: "reload-handoff-limbo", entries, adapter: fakeAdapter("unused"), resolverPath });
    await second.fire("session_start", { reason: "reload" });
    assert.equal(second.completions(), 1, "the waiting completion is sent on re-attach");
    assert.ok(second.roster.has(`delegate:${executionId}`), "a terminal uncollected background child keeps its roster row");
    const collected = await second.run("subagent_collect", {});
    assert.deepEqual(collected.details.collected, [{ executionId, outcome: "success" }]);
    assert.equal(second.roster.size, 0);
    assert.ok(entries.some((entry) => entry.data.executionId === executionId && entry.data.status === "success"));
    await second.fire("session_shutdown", { reason: "quit" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a background child's result rides its completion notice, and delivery collects it", async () => {
  const { directory, resolverPath } = await fakeResolver();
  try {
    const entries = [];
    const adapter = fakeAdapter("carried");
    const lead = leadInstance({ sessionId: "carried-result", entries, adapter, resolverPath });
    await lead.fire("session_start", { reason: "startup" });
    const { details: { executionId } } = await lead.run("subagent", { task: "Report back", profile: "scout", cognitiveRole: "routine", background: true });
    adapter.finish(executionId, { outcome: "success", text: "CARRIED_OK", sessionId: "child-session" });
    for (let i = 0; i < 5; i += 1) await tick();

    assert.equal(lead.completions(), 1);
    const notice = lead.sent.at(-1).message;
    assert.match(notice.content, new RegExp(`${executionId} \\[success\\]\\nCARRIED_OK\\n\\nCompletion receipt: anthropic/claude-test:low \u00b7 subagent \u00b7 scout \u00b7 routine \u00b7 outcome success`));
    assert.ok(lead.roster.has(`delegate:${executionId}`), "the row stays until the notice reaches the lead");

    await lead.fire("message_start", { message: { role: "custom", ...notice } });
    assert.equal(lead.roster.has(`delegate:${executionId}`), false, "a delivered result leaves the roster like a collected one");
    assert.match((await lead.run("subagent_status", {})).content[0].text, /0 running, 0 terminal and uncollected/);
    assert.deepEqual((await lead.run("subagent_collect", {})).details.collected, [], "nothing is left for a collect turn");
    assert.ok(entries.some((entry) => entry.data.executionId === executionId && entry.data.collected === true), "a reloaded runtime also sees it collected");
    await lead.fire("agent_settled", {});
    assert.equal(lead.completions(), 1, "a delivered notice is not re-sent");
    await lead.fire("session_shutdown", { reason: "quit" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("every other shutdown reason cancels children", async () => {
  const { directory, resolverPath } = await fakeResolver();
  try {
    for (const reason of ["quit", "new", "resume", "fork", undefined]) {
      const adapter = fakeAdapter(String(reason));
      const lead = leadInstance({ sessionId: `reload-handoff-${reason}`, entries: [], adapter, resolverPath });
      await lead.fire("session_start", { reason: "startup" });
      await lead.run("subagent", { task: "Running", profile: "scout", cognitiveRole: "routine", background: true });
      await lead.fire("session_shutdown", reason === undefined ? undefined : { reason });
      assert.equal(adapter.calls.cancelAll, 1, `${reason} cancels`);
      assert.equal(claimReloadHandoff(`reload-handoff-${reason}`), undefined, `${reason} hands nothing over`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a session that ends while reloading, or a reload nobody claims, cancels the handed-over children", async () => {
  const { directory, resolverPath } = await fakeResolver();
  try {
    const ended = fakeAdapter("ended");
    const first = leadInstance({ sessionId: "reload-handoff-ended", entries: [], adapter: ended, resolverPath });
    await first.fire("session_start", { reason: "startup" });
    await first.run("subagent", { task: "Running", profile: "scout", cognitiveRole: "routine", background: true });
    await first.fire("session_shutdown", { reason: "reload" });
    // The next instance loaded but the session is disposed before its session_start.
    const second = leadInstance({ sessionId: "reload-handoff-ended", entries: [], adapter: fakeAdapter("never"), resolverPath });
    await second.fire("session_shutdown", { reason: "quit" });
    assert.equal(ended.calls.cancelAll, 1);

    const orphan = fakeAdapter("orphan");
    const lone = leadInstance({ sessionId: "reload-handoff-orphan", entries: [], adapter: orphan, resolverPath, reloadClaimMs: 20 });
    await lone.fire("session_start", { reason: "startup" });
    await lone.run("subagent", { task: "Running", profile: "scout", cognitiveRole: "routine", background: true });
    await lone.fire("session_shutdown", { reason: "reload" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(orphan.calls.cancelAll, 1, "an unclaimed handoff is cancelled after its claim window");
    assert.equal(lone.completions(), 0);
    assert.equal(claimReloadHandoff("reload-handoff-orphan"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a handoff from an incompatible revision is cancelled through its own cancel, not adopted", () => {
  let cancelled = 0;
  stashForReload("reload-handoff-version", { version: RELOAD_HANDOFF_VERSION + 1, state: {}, cancel: async () => { cancelled += 1; } });
  assert.equal(claimReloadHandoff("reload-handoff-version"), undefined);
  assert.equal(cancelled, 1);
});

test("a background Worker keeps its dispatch lock across a reload and settles its receipt once", async () => {
  const { directory, resolverPath } = await fakeResolver();
  const previousHome = process.env.HOME;
  process.env.HOME = directory;
  try {
    const entries = [];
    const adapter = fakeAdapter("worker");
    const first = leadInstance({ sessionId: "reload-handoff-worker", entries, adapter, resolverPath });
    await first.fire("session_start", { reason: "startup" });
    const created = await first.run("worker_create", { name: "Keeper", scope: "Reload scope", profile: "scout" });
    const { workerId } = created.details;
    const dispatch = await first.run("worker_dispatch", { workerId, task: "Keep going", cognitiveRole: "routine", background: true });
    const id = dispatch.details.executionId;
    await first.fire("session_shutdown", { reason: "reload" });

    const second = leadInstance({ sessionId: "reload-handoff-worker", entries, adapter: fakeAdapter("worker-new"), resolverPath });
    await second.fire("session_start", { reason: "reload" });
    const locked = await second.run("worker_status", { workerId });
    assert.match(locked.content[0].text, new RegExp(`Locked by pid ${process.pid}`));
    assert.match(locked.content[0].text, new RegExp(`Live dispatch ${id}`));
    assert.match((await second.run("worker_dispatch", { workerId, task: "Again", cognitiveRole: "routine" })).content[0].text, /preflight_failed/, "the worker stays busy");

    adapter.finish(id, { outcome: "success", text: "WORKER_OK", sessionId: "worker-session" });
    for (let i = 0; i < 50 && second.completions() === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(second.completions(), 1);
    assert.match(second.sent.at(-1).message.content, new RegExp(`${id} \\[success\\]\\nWORKER_OK\\n\\nCompletion receipt: anthropic/claude-test:low \u00b7 worker`), "the Worker notice carries its receipt-safe result");
    const idle = await second.run("worker_status", { workerId });
    assert.doesNotMatch(idle.content[0].text, /Locked by pid/);
    assert.match(idle.content[0].text, /Last dispatch: success/);
    const collected = await second.run("subagent_collect", {});
    assert.deepEqual(collected.details.collected, [{ executionId: id, outcome: "success" }]);
    assert.equal(second.completions(), 1);
    await second.fire("session_shutdown", { reason: "quit" });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  }
});
