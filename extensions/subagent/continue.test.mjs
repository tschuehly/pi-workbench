import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import subagentExtension, { retainedResult, watchChildSession } from "./index.ts";

async function harness(t) {
  const temporary = await mkdtemp(join(tmpdir(), "subagent-continue-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const resolverPath = join(temporary, "resolver.mjs");
  await writeFile(resolverPath, `console.log(JSON.stringify({ status: "pass", modelBinding: {
    cognitiveRole: process.argv[2], provider: "anthropic", model: "claude-test", effort: "low", admission: "fresh-quota",
    quotaSnapshot: { generatedAt: null, telemetryStatus: "unavailable", relevantWindows: [], stale: false, refreshedAt: null, error: "test" },
  }}));`);
  return resolverPath;
}

// One persisted lead session; each runtime() is the extension after a host restart.
function lead(resolverPath, entries = []) {
  const runtime = (adapter) => {
    const tools = new Map();
    const handlers = new Map();
    subagentExtension({
      events: { emit: () => {} },
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      registerTool: (tool) => tools.set(tool.name, tool),
      registerShortcut: () => {},
      sendMessage: () => {},
      appendEntry: (customType, data) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
    }, { adapter, resolverPath });
    const ctx = { cwd: "/repo", model: { provider: "anthropic", id: "claude" }, sessionManager: { getSessionId: () => "lead", getSessionFile: () => "/sessions/lead.jsonl", getBranch: () => entries, buildSessionProjection: () => ({ messages: [] }) } };
    const fire = async (event, payload) => { for (const handler of handlers.get(event) ?? []) await handler(payload, ctx); };
    const run = (params) => tools.get("subagent").execute("call", { profile: "implementer", cognitiveRole: "implementation", background: true, ...params }, undefined, undefined, ctx);
    return { fire, run };
  };
  return { entries, runtime };
}

// A fake adapter: children settle on demand, each with its own session once "verified".
function fakeAdapter() {
  const children = new Map();
  const specs = [];
  let next = 0;
  return {
    specs, children,
    dispatch: async (spec) => {
      specs.push(structuredClone(spec));
      const executionId = `child-${++next}`;
      let settle;
      children.set(executionId, { running: true, sessionId: spec.continuation?.sessionId ?? `session-${next}`, result: new Promise((resolve) => { settle = resolve; }), settle });
      return { executionId, acceptedAt: "2026-11-21T00:00:00Z" };
    },
    result: (id) => children.get(id).result,
    status: (id) => { const c = children.get(id); if (!c) throw new Error("EXECUTION_NOT_FOUND"); return { running: c.running, sessionId: c.sessionId }; },
    async *observe(id) { yield { type: "binding_verified", at: "t" }; },
    list: () => [],
    cancelAll: async () => [],
    finish(id, outcome = "success") { const c = children.get(id); c.running = false; c.settle({ outcome, text: "done", sessionId: c.sessionId, provider: "anthropic", model: "claude-test", effort: "low" }); return c.result; },
  };
}

const settleTick = () => new Promise((resolve) => setImmediate(resolve));

test("continueFrom resumes a finished child's session and briefs only what is new", async (t) => {
  const { runtime } = lead(await harness(t));
  const adapter = fakeAdapter();
  const { fire, run } = runtime(adapter);
  await fire("session_start", { reason: "startup" });
  await run({ task: "Build the top bar." });
  await adapter.finish("child-1");
  await settleTick();

  const result = await run({ task: "Fix the five review findings.", continueFrom: "child-1" });
  assert.match(result.content[0].text, /^Launched subagent child-2 continuing child-1 in the background/);
  const spec = adapter.specs[1];
  assert.deepEqual(spec.continuation, { sessionId: "session-1" });
  assert.match(spec.task, /^This launch continues your earlier session/);
  assert.doesNotMatch(spec.task, new RegExp(adapter.specs[0].task.split("\n")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "same profile: no repeated profile instruction");
  assert.match(spec.task, /Assignment:\nFix the five review findings\./);
});

test("continueFrom refuses a running child, an unknown id and review roles", async (t) => {
  const { runtime } = lead(await harness(t));
  const adapter = fakeAdapter();
  const { fire, run } = runtime(adapter);
  await fire("session_start", { reason: "startup" });
  await run({ task: "Still working." });

  const running = await run({ task: "More", continueFrom: "child-1" });
  assert.equal(running.details.outcome, "preflight_failed");
  assert.match(running.details.diagnostic, /still running; use subagent_steer/);
  const unknown = await run({ task: "More", continueFrom: "nope" });
  assert.match(unknown.details.diagnostic, /No Subagent nope was launched from this session/);
  const review = await run({ task: "Re-review", profile: "reviewer", cognitiveRole: "review", continueFrom: "child-1" });
  assert.match(review.details.diagnostic, /needs fresh context/);
  assert.equal(adapter.specs.length, 1, "no refused continuation dispatches");
});

test("a child interrupted by a restart can be continued from its early session record", async (t) => {
  const { entries, runtime } = lead(await harness(t));
  const before = fakeAdapter();
  const first = runtime(before);
  await first.fire("session_start", { reason: "startup" });
  await first.run({ task: "Long migration." });
  await settleTick();
  // The host restarts while child-1 runs: no terminal record, only the launch and the verified session.
  assert.ok(entries.some((e) => e.data.executionId === "child-1" && e.data.childSessionId === "session-1"));

  const after = fakeAdapter();
  const second = runtime(after);
  await second.fire("session_start", { reason: "startup" });
  const result = await second.run({ task: "Pick up where you stopped.", continueFrom: "child-1" });
  assert.equal(result.details.outcome, "launched");
  assert.deepEqual(after.specs[0].continuation, { sessionId: "session-1" });
});

test("the interrupted notice points at continueFrom only when a session was recorded", () => {
  const base = { executionId: "x", status: "interrupted", launchedAt: "t" };
  assert.match(retainedResult({ ...base, childSessionId: "s" }).content[0].text, /continue it with subagent continueFrom: "x"/);
  assert.match(retainedResult(base).content[0].text, /launch a new child/);
});

test("watchChildSession stops at terminal without reporting", async () => {
  const seen = [];
  await watchChildSession({ async *observe() { yield { type: "terminal" }; yield { type: "binding_verified" }; }, status: () => ({ sessionId: "s" }) }, "x", (s) => seen.push(s));
  assert.deepEqual(seen, []);
});
