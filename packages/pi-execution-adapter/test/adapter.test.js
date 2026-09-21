import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { PiRpcExecutionAdapter, summarizeToolAction, taskLabel, taskSlug } from "../src/index.js";

// The adapter defaults its overlay path from the environment, so a run-scoped overlay in the
// surrounding session would silently activate fail-closed validation in the default-path cases.
// Overlay cases below pass routingOverlayPath explicitly.
delete process.env.PI_WORKBENCH_ROUTING_OVERLAY;

test("derives a human-readable task label from the first meaningful clause", () => {
  assert.equal(taskLabel("Fix the login bug. Then write a test."), "Fix the login bug");
  assert.equal(taskLabel("Align   drawer\nlabels\twith the spec"), "Align drawer labels with the spec");
  assert.equal(taskLabel("Do the thing!"), "Do the thing");
  assert.equal(taskLabel(""), "Untitled task");
  assert.equal(taskLabel("   "), "Untitled task");
  assert.equal(taskLabel("a".repeat(200)), "a".repeat(40));
  assert.equal(taskLabel("Investigate why caf\u00e9 orders fail, then report"), "Investigate why caf\u00e9 orders fail, then r");
});

test("derives an ascii hyphenated session-name slug from the first clause of a task", () => {
  assert.equal(taskSlug("Scout: align drawer labels with the spec."), "scout-align-drawer-labels-with-the-spec");
  assert.equal(taskSlug(""), "task");
  assert.equal(taskSlug("   "), "task");
  assert.equal(taskSlug("a".repeat(200)), "a".repeat(40));
  assert.equal(taskSlug("\u00c9tudier le caf\u00e9"), "etudier-le-cafe");
  assert.equal(taskSlug("\u65e5\u672c\u8a9e\u306e\u30bf\u30b9\u30af"), "task");
  assert.equal(taskSlug("Fix --dangerous; rm -rf /tmp!!"), "fix-dangerous-rm-rf-tmp");
});

test("names the launched child session from the task instead of a generic profile counter", async () => {
  const children = [];
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: (_command, args) => { const child = fakeRpc(); children.push({ child, args }); return child; } });
  const receipt = await adapter.dispatch(spec({ task: "Align drawer labels with the design spec" }));
  await adapter.result(receipt.executionId);
  const args = children[0].args;
  assert.equal(args[args.indexOf("--name") + 1], "workbench-scout-align-drawer-labels-with-the-design-spec");
});

test("summarizes child tool activity without exposing shell arguments", () => {
  assert.equal(summarizeToolAction("read", { path: "/repo/src/auth-service.ts" }), "reading src/auth-service.ts");
  assert.equal(summarizeToolAction("edit", { path: "src/index.ts" }), "editing src/index.ts");
  assert.equal(summarizeToolAction("bash", { command: "npm test -- --runInBand" }), "running npm test");
  assert.equal(summarizeToolAction("bash", { command: "curl -u user:password https://example.test" }), "running bash");
  assert.equal(summarizeToolAction("grep", { path: "/repo/src", pattern: "AWS_SECRET_ACCESS_KEY=abc" }), "searching repo/src");
  assert.equal(summarizeToolAction("read", { path: "/repo/src/\u001b[2Jauth.ts" }).includes("\u001b"), false);
});

const now = new Date("2026-03-20T12:00:00.000Z");
function spec(overrides = {}) {
  return {
    task: "Inspect src and report.", profile: "scout", cognitiveRole: "investigation", cwd: "/tmp", tools: ["read", "bash"],
    binding: {
      cognitiveRole: "investigation",
      provider: "anthropic",
      model: "claude-test",
      effort: "high",
      admission: "fresh-quota",
      quotaSnapshot: { generatedAt: now.toISOString(), refreshedAt: now.toISOString(), telemetryStatus: "fresh", stale: false, error: null, relevantWindows: [] },
    },
    ...overrides,
  };
}

function fakeRpc(options = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.closed = false;
  let input = "";
  child.stdin = new Writable({
    write(chunk, _encoding, callback) { input += String(chunk); drain(); callback(); },
    final(callback) {
      if (options.closeOnStdinEnd !== false) queueMicrotask(() => child.emit("close", 0, null));
      callback();
    },
  });
  child.kill = (signal) => { child.kills.push(signal); if (options.confirmKill !== false) queueMicrotask(() => child.emit("close", null, signal)); return true; };
  child.kills = [];
  child.commands = [];
  const send = (value) => child.stdout.write(`${JSON.stringify(value)}\n`);
  const stateResponse = (command) => ({ id: command.id, type: "response", command: "get_state", success: true, data: { model: { provider: options.provider ?? "anthropic", id: options.model ?? "claude-test" }, thinkingLevel: options.effort ?? "high", sessionId: options.sessionId ?? "child-session", isStreaming: false, isCompacting: false, pendingMessageCount: 0 } });
  let pendingGetState;
  function drain() {
    for (;;) {
      const index = input.indexOf("\n"); if (index < 0) return;
      const command = JSON.parse(input.slice(0, index)); input = input.slice(index + 1); child.commands.push(command);
      if (command.type === "get_state") {
        if (options.hangOnGetState) pendingGetState = command;
        else if (options.stateDelayMs !== undefined) setTimeout(() => send(stateResponse(command)), options.stateDelayMs);
        else send(stateResponse(command));
      }
      if (command.type === "abort" && options.respondStateOnAbort && pendingGetState !== undefined) send(stateResponse(pendingGetState));
      if (command.type === "abort" && options.settleOnAbort) queueMicrotask(() => send({ type: "agent_settled" }));
      if (command.type === "prompt") {
        send({ id: command.id, type: "response", command: "prompt", success: true });
        if (!options.hang) queueMicrotask(() => {
          send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "secret reasoning" } });
          send({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "src" } });
          send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: options.text ?? "Compact result" }], stopReason: "stop" } });
          if (!options.omitSettled) send({ type: "agent_settled" });
        });
      }
    }
  }
  return child;
}

async function eventuallyResult(adapter, id) { return await adapter.result(id); }

test("launches one persistent RPC child, verifies binding, and returns compact metadata", async () => {
  const children = [];
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: (_command, args) => { const child = fakeRpc(); children.push({ child, args }); return child; } });
  const receipt = await adapter.dispatch(spec());
  const observations = [];
  const collecting = (async () => { for await (const observation of adapter.observe(receipt.executionId)) observations.push(observation); })();
  const result = await eventuallyResult(adapter, receipt.executionId);
  await collecting;
  assert.equal(children.length, 1);
  assert.equal(children[0].args.includes("--no-session"), false);
  assert.equal(result.outcome, "success");
  assert.equal(result.text, "Compact result");
  assert.equal(result.sessionId, "child-session");
  assert.equal(observations.some((value) => value.type === "thinking_progress"), true);
  assert.equal(observations.some((value) => JSON.stringify(value).includes("secret reasoning")), false);
});

test("propagates deterministic parent and execution lineage to the child", async () => {
  let spawnOptions;
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: (_command, _args, options) => { spawnOptions = options; return fakeRpc(); } });
  const receipt = await adapter.dispatch(spec({ parentSessionId: "parent-session" }));
  assert.equal((await adapter.result(receipt.executionId)).outcome, "success");
  assert.equal(spawnOptions.env.PI_TELEMETRY_PARENT_SESSION_ID, "parent-session");
  assert.equal(spawnOptions.env.PI_TELEMETRY_EXECUTION_ID, receipt.executionId);
});

test("resumes a recorded session, verifies its identity, and keeps fresh launches unnamed by session", async () => {
  const children = [];
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: (_command, args) => { const child = fakeRpc({ sessionId: "worker-session-1" }); children.push({ child, args }); return child; } });
  const receipt = await adapter.dispatch(spec({ continuation: { sessionId: "worker-session-1" } }));
  const observations = [];
  const collecting = (async () => { for await (const observation of adapter.observe(receipt.executionId)) observations.push(observation); })();
  const result = await adapter.result(receipt.executionId);
  await collecting;
  const args = children[0].args;
  assert.equal(args[args.indexOf("--session") + 1], "worker-session-1");
  assert.equal(args.includes("--name"), false);
  assert.equal(result.outcome, "success");
  assert.equal(result.sessionId, "worker-session-1");
  assert.equal(observations.some((value) => value.type === "continuation_verified" && value.detail?.sessionId === "worker-session-1"), true);
});

test("fails closed when the resumed session does not match the requested continuation", async () => {
  const child = fakeRpc({ sessionId: "unexpected-fresh-session" });
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => child, killGraceMs: 1 });
  const receipt = await adapter.dispatch(spec({ continuation: { sessionId: "worker-session-1" } }));
  const result = await adapter.result(receipt.executionId);
  assert.equal(result.outcome, "launch_failed");
  assert.match(result.diagnostic ?? "", /does not match the requested continuation/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(child.commands.some((command) => command.type === "prompt"), false);
});

test("rejects a malformed continuation before launch", async () => {
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc() });
  await assert.rejects(adapter.dispatch(spec({ continuation: { sessionId: "" } })), (error) => error.code === "INVALID_SPEC");
  await assert.rejects(adapter.dispatch(spec({ continuation: "worker-session-1" })), (error) => error.code === "INVALID_SPEC");
  await assert.rejects(adapter.dispatch(spec({ parentSessionId: "" })), (error) => error.code === "INVALID_SPEC");
});

test("launches with degraded quota telemetry and makes the degradation observable", async () => {
  const binding = {
    ...spec().binding,
    admission: "degraded-quota-telemetry",
    quotaSnapshot: {
      generatedAt: now.toISOString(),
      refreshedAt: "2026-03-20T10:00:00.000Z",
      telemetryStatus: "stale",
      stale: true,
      error: "Claude sign-in required",
      relevantWindows: [],
    },
  };
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc() });
  const receipt = await adapter.dispatch(spec({ binding }));
  const observations = [];
  const collecting = (async () => { for await (const observation of adapter.observe(receipt.executionId)) observations.push(observation); })();
  const result = await adapter.result(receipt.executionId);
  assert.equal(result.outcome, "success");
  assert.equal(result.quotaAdmission, "degraded-quota-telemetry");
  assert.equal(result.quotaTelemetryStatus, "stale");
  await collecting;
  assert.equal(observations.some((value) => value.type === "quota_degraded" && value.detail?.error === "Claude sign-in required"), true);
});

test("reconciles terminal output when the settled event is missing but RPC state is idle", async () => {
  const adapter = new PiRpcExecutionAdapter({
    clock: () => now,
    spawn: () => fakeRpc({ omitSettled: true }),
    settlementProbeMs: 1,
    killGraceMs: 1,
  });
  const receipt = await adapter.dispatch(spec());
  const result = await adapter.result(receipt.executionId);
  assert.equal(result.outcome, "success");
  assert.equal(result.text, "Compact result");
});

test("launches when quota telemetry is unavailable", async () => {
  const binding = {
    ...spec().binding,
    admission: "degraded-quota-telemetry",
    quotaSnapshot: {
      generatedAt: now.toISOString(),
      refreshedAt: null,
      telemetryStatus: "unavailable",
      stale: false,
      error: "quota snapshot unavailable",
      relevantWindows: [],
    },
  };
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc() });
  const receipt = await adapter.dispatch(spec({ binding }));
  const result = await adapter.result(receipt.executionId);
  assert.equal(result.outcome, "success");
  assert.equal(result.quotaAdmission, "degraded-quota-telemetry");
  assert.equal(result.quotaTelemetryStatus, "unavailable");
});

test("treats fresh quota evidence that aged before dispatch as degraded telemetry", async () => {
  const binding = {
    ...spec().binding,
    quotaSnapshot: { ...spec().binding.quotaSnapshot, refreshedAt: "2026-03-20T10:00:00.000Z" },
  };
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc() });
  const receipt = await adapter.dispatch(spec({ binding }));
  const observations = [];
  const collecting = (async () => { for await (const observation of adapter.observe(receipt.executionId)) observations.push(observation); })();
  const result = await adapter.result(receipt.executionId);
  assert.equal(result.outcome, "success");
  assert.equal(result.quotaAdmission, "degraded-quota-telemetry");
  assert.equal(result.quotaTelemetryStatus, "stale");
  await collecting;
  assert.equal(observations.some((value) => value.type === "quota_degraded" && value.detail?.telemetryStatus === "stale"), true);
});

test("enforces cross-family bindings for independent roles", async () => {
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc() });
  const reviewBinding = {
    ...spec().binding,
    cognitiveRole: "independent-review",
    independence: { independentOfProvider: "openai-codex", independentOfFamily: "openai", selectedFamily: "anthropic" },
  };
  const receipt = await adapter.dispatch(spec({ cognitiveRole: "independent-review", binding: reviewBinding }));
  assert.equal((await adapter.result(receipt.executionId)).outcome, "success");

  await assert.rejects(
    adapter.dispatch(spec({ cognitiveRole: "independent-review", binding: { ...reviewBinding, independence: undefined } })),
    (error) => error.code === "INVALID_BINDING",
  );
  await assert.rejects(
    adapter.dispatch(spec({ cognitiveRole: "independent-review", binding: { ...reviewBinding, independence: { ...reviewBinding.independence, independentOfFamily: "anthropic" } } })),
    (error) => error.code === "INVALID_BINDING",
  );
});

test("verifies gateway model families and records the excluded panel family", async () => {
  const binding = {
    ...spec().binding, cognitiveRole: "challenge", provider: "github-copilot", model: "grok-4.6",
    independence: {
      independentOfProvider: "github-copilot", independentOfModel: "github-copilot/gpt-5.6-sol",
      independentOfFamily: "openai", selectedFamily: "xai", excludedFamilies: ["anthropic"],
    },
  };
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc({ provider: binding.provider, model: binding.model }) });
  const receipt = await adapter.dispatch(spec({ cognitiveRole: "challenge", binding }));
  const result = await adapter.result(receipt.executionId);
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.independence, binding.independence);
  assert.deepEqual(adapter.status(receipt.executionId).independence, binding.independence);
});

test("rejects forged gateway families, excluded judges, and ambiguous authors before spawning", async () => {
  let spawned = 0;
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => { spawned++; return fakeRpc(); } });
  const binding = {
    ...spec().binding, cognitiveRole: "challenge",
    independence: {
      independentOfProvider: "openai-codex", independentOfModel: "openai-codex/gpt-5.6-sol",
      independentOfFamily: "openai", selectedFamily: "anthropic", excludedFamilies: ["xai"],
    },
  };
  const invalid = [
    { ...binding, independence: { ...binding.independence, independentOfProvider: "github-copilot", independentOfModel: "github-copilot/claude-opus-5" } },
    { ...binding, independence: { ...binding.independence, independentOfModel: "anthropic/claude-opus-5" } },
    { ...binding, independence: { ...binding.independence, independentOfModel: "malformed" } },
    { ...binding, independence: { ...binding.independence, independentOfProvider: "github-copilot", independentOfModel: undefined } },
    { ...binding, independence: { ...binding.independence, excludedFamilies: ["anthropic"] } },
    { ...binding, independence: { ...binding.independence, excludedFamilies: ["not-a-family"] } },
    { ...binding, independence: { ...binding.independence, excludedFamilies: "xai" } },
    { ...binding, provider: "github-copilot", model: "unknown-model" },
    { ...binding, provider: "github-copilot", model: "gpt-5.6-sol" },
  ];
  for (const candidate of invalid) {
    await assert.rejects(adapter.dispatch(spec({ cognitiveRole: "challenge", binding: candidate })), (error) => error.code === "INVALID_BINDING");
  }
  assert.equal(spawned, 0);
});

test("all independent bindings require fresh subagent context", async () => {
  let spawned = 0;
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => { spawned++; return fakeRpc(); } });
  const binding = { ...spec().binding, cognitiveRole: "challenge", independence: { independentOfProvider: "openai-codex", independentOfFamily: "openai", selectedFamily: "anthropic" } };
  for (const extra of [{ continuation: { sessionId: "prior-review" } }, { kind: "worker" }]) {
    await assert.rejects(adapter.dispatch(spec({ ...extra, cognitiveRole: "challenge", binding })), (error) => error.code === "INVALID_BINDING");
  }
  assert.equal(spawned, 0);
});

test("fails closed on inconsistent admission, capability expansion, fresh exhaustion, and runtime binding mismatch", async () => {
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, hostTools: ["read", "bash"], spawn: () => fakeRpc({ model: "wrong" }) });
  await assert.rejects(adapter.dispatch(spec({ tools: ["write"] })), (error) => error.code === "CAPABILITY_EXCEEDED");
  await assert.rejects(adapter.dispatch(spec({ binding: { ...spec().binding, admission: "degraded-quota-telemetry" } })), (error) => error.code === "INVALID_BINDING");
  await assert.rejects(adapter.dispatch(spec({ binding: { ...spec().binding, quotaSnapshot: { ...spec().binding.quotaSnapshot, telemetryStatus: "stale", stale: true, error: "stale" } } })), (error) => error.code === "INVALID_BINDING");
  await assert.rejects(adapter.dispatch(spec({ binding: { ...spec().binding, quotaSnapshot: undefined } })), (error) => error.code === "INVALID_BINDING");
  await assert.rejects(adapter.dispatch(spec({ binding: { ...spec().binding, quotaSnapshot: { ...spec().binding.quotaSnapshot, relevantWindows: [{ percentRemaining: 0 }] } } })), (error) => error.code === "QUOTA_EXHAUSTED");
  const receipt = await adapter.dispatch(spec());
  assert.notEqual((await adapter.result(receipt.executionId)).outcome, "success");
});

test("fails launch quickly when Pi RPC never answers the initial state request", async () => {
  const child = fakeRpc({ hangOnGetState: true });
  const adapter = new PiRpcExecutionAdapter({
    clock: () => now,
    spawn: () => child,
    startupTimeoutMs: 5,
    killGraceMs: 1,
  });
  const receipt = await adapter.dispatch(spec());
  const observations = [];
  const collecting = (async () => { for await (const observation of adapter.observe(receipt.executionId)) observations.push(observation); })();
  const result = await adapter.result(receipt.executionId);
  await collecting;

  assert.equal(result.outcome, "launch_failed");
  assert.match(result.diagnostic ?? "", /startup_timeout: Pi RPC.*5 ms/i);
  assert.equal(child.commands.some((command) => command.type === "prompt"), false);
  assert.equal(child.kills.includes("SIGTERM"), true);
  assert.equal(observations.some((value) => value.type === "startup_timeout"), true);
  assert.equal(observations.some((value) => value.type === "timeout"), false);
});

test("ignores a late initial state response after startup termination begins", async () => {
  const child = fakeRpc({ hangOnGetState: true, respondStateOnAbort: true });
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => child, startupTimeoutMs: 5, killGraceMs: 1 });
  const receipt = await adapter.dispatch(spec());
  const observations = [];
  const collecting = (async () => { for await (const observation of adapter.observe(receipt.executionId)) observations.push(observation); })();
  const result = await adapter.result(receipt.executionId);
  await collecting;

  assert.equal(result.outcome, "launch_failed");
  assert.equal(result.sessionId, undefined);
  assert.equal(child.commands.some((command) => command.type === "prompt"), false);
  assert.equal(observations.some((value) => value.type === "binding_verified"), false);
});

test("reports unknown outcome when startup termination cannot be confirmed", async () => {
  const adapter = new PiRpcExecutionAdapter({
    clock: () => now,
    spawn: () => fakeRpc({ hangOnGetState: true, confirmKill: false }),
    startupTimeoutMs: 2,
    killGraceMs: 1,
  });
  const receipt = await adapter.dispatch(spec());
  assert.equal((await adapter.result(receipt.executionId)).outcome, "outcome_unknown");
});

test("keeps a task running until it finishes or is cancelled", async () => {
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc({ hang: true }), killGraceMs: 1 });
  const receipt = await adapter.dispatch(spec());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.status(receipt.executionId).running, true);
  assert.equal((await adapter.cancel(receipt.executionId, "test complete")).outcome, "cancelled");
});

test("forces a successful RPC child to terminate when graceful stdin shutdown hangs", async () => {
  const child = fakeRpc({ closeOnStdinEnd: false });
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => child, killGraceMs: 1 });
  const receipt = await adapter.dispatch(spec());
  assert.equal((await adapter.result(receipt.executionId)).outcome, "success");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(child.kills.includes("SIGTERM"), true);
});

test("reports non-blocking status and list snapshots for background reconciliation", async () => {
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc({ hang: true }) });
  const receipt = await adapter.dispatch(spec());
  const running = adapter.status(receipt.executionId);
  assert.equal(running.running, true);
  assert.equal(running.outcome, undefined);
  assert.equal(running.provider, "anthropic");
  assert.equal(adapter.list().length, 1);
  assert.equal(adapter.list()[0].running, true);
  assert.throws(() => adapter.status("missing"), (error) => error.code === "EXECUTION_NOT_FOUND");

  await adapter.cancel(receipt.executionId, "test");
  const done = adapter.status(receipt.executionId);
  assert.equal(done.running, false);
  assert.equal(done.outcome, "cancelled");
  assert.equal(adapter.list()[0].outcome, "cancelled");
});

test("allows concurrent executions and confirms their cancellation", async () => {
  const children = [fakeRpc({ hang: true, settleOnAbort: true }), fakeRpc({ hang: true, settleOnAbort: true })];
  let spawnIndex = 0;
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => children[spawnIndex++], killGraceMs: 1 });
  const first = await adapter.dispatch(spec());
  const second = await adapter.dispatch(spec());
  const cancellations = await Promise.all([
    adapter.cancel(first.executionId, "test"),
    adapter.cancel(second.executionId, "test"),
  ]);
  assert.deepEqual(cancellations.map(({ outcome }) => outcome), ["cancelled", "cancelled"]);
  assert.equal((await adapter.result(first.executionId)).outcome, "cancelled");
  assert.equal((await adapter.result(second.executionId)).outcome, "cancelled");
  assert.equal(children.every((child) => child.kills.includes("SIGTERM")), true);
});

const overlayReceipt = { path: "/abs/overlay.json", sha256: "d2f0a4" };
function overlayAdapter(options = {}) {
  return new PiRpcExecutionAdapter({
    clock: () => now,
    routingOverlayPath: overlayReceipt.path,
    spawn: options.spawn ?? (() => fakeRpc()),
    ...options,
  });
}
function stubOverlayRead(adapter, allowed = ["anthropic/claude-test", "anthropic/claude-other"]) {
  adapter.overlayCache = { path: overlayReceipt.path, sha256: overlayReceipt.sha256, allowed: new Set(allowed) };
  return adapter;
}

test("admits leaf delegation tools for a coordinating worker but nothing beyond the ceiling", async () => {
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc() });
  const coordinatorTools = ["read", "bash", "grep", "find", "ls", "subagent", "subagent_collect", "subagent_status", "subagent_cancel"];
  const receipt = await adapter.dispatch(spec({ kind: "worker", tools: coordinatorTools }));
  assert.equal((await adapter.result(receipt.executionId)).kind, "worker");
  await assert.rejects(adapter.dispatch(spec({ tools: [...coordinatorTools, "worker_dispatch"] })), (error) => error.code === "CAPABILITY_EXCEEDED");
  await assert.rejects(adapter.dispatch(spec({ kind: "coordinator" })), (error) => error.code === "INVALID_SPEC");
});

test("marks an oversized child result truncated so it cannot satisfy verification", async () => {
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, resultMaxChars: 40, spawn: () => fakeRpc({ text: "x".repeat(500) }) });
  const receipt = await adapter.dispatch(spec());
  const result = await adapter.result(receipt.executionId);
  assert.equal(result.truncated, true);
  assert.match(result.text, /TRUNCATED at 40 characters/);
  assert.equal(result.text.startsWith("x".repeat(40)), true);

  const small = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc({ text: "done" }) });
  assert.equal((await small.result((await small.dispatch(spec())).executionId)).truncated, false);
});

test("marks execution kind and propagates the active routing overlay to the child", async () => {
  let spawnOptions;
  const adapter = stubOverlayRead(overlayAdapter({ spawn: (_command, _args, options) => { spawnOptions = options; return fakeRpc(); } }));
  await adapter.dispatch(spec({ kind: "worker", binding: { ...spec().binding, routingOverlay: overlayReceipt } }));
  assert.equal(spawnOptions.env.PI_WORKBENCH_EXECUTION_KIND, "worker");
  assert.equal(spawnOptions.env.PI_WORKBENCH_ROUTING_OVERLAY, overlayReceipt.path);
  assert.equal(spawnOptions.detached, true, "a lead launch owns its own process group");

  let leafOptions;
  const insideWorker = new PiRpcExecutionAdapter({ clock: () => now, ownsProcessGroups: false, spawn: (_command, _args, options) => { leafOptions = options; return fakeRpc(); } });
  await insideWorker.dispatch(spec());
  assert.equal(leafOptions.detached, false, "a leaf launched inside a worker stays in the worker's group");
  assert.equal(leafOptions.env.PI_WORKBENCH_EXECUTION_KIND, "subagent");
});

test("carries a concept-bound phase down to the leaf environment", async () => {
  let workerOptions;
  const adapter = new PiRpcExecutionAdapter({ clock: () => now, spawn: (_command, _args, options) => { workerOptions = options; return fakeRpc(); } });
  await adapter.dispatch(spec({ kind: "worker", telemetryConcept: "29-printed-cards-giftable" }));
  assert.equal(workerOptions.env.PI_WORKBENCH_TELEMETRY_CONCEPT, "29-printed-cards-giftable");

  let plainOptions;
  const plain = new PiRpcExecutionAdapter({ clock: () => now, spawn: (_command, _args, options) => { plainOptions = options; return fakeRpc(); } });
  await plain.dispatch(spec());
  assert.equal(plainOptions.env.PI_WORKBENCH_TELEMETRY_CONCEPT, undefined, "an unbound execution leaks no stale concept");

  await assert.rejects(adapter.dispatch(spec({ telemetryConcept: "  " })), (error) => error.code === "INVALID_SPEC");
});

test("fails closed when a binding does not match the active routing overlay", async () => {
  const adapter = stubOverlayRead(overlayAdapter());
  await adapter.dispatch(spec({ binding: { ...spec().binding, routingOverlay: overlayReceipt } }));
  await assert.rejects(adapter.dispatch(spec()), (error) => error.code === "INVALID_BINDING");
  await assert.rejects(
    adapter.dispatch(spec({ binding: { ...spec().binding, routingOverlay: { ...overlayReceipt, sha256: "stale" } } })),
    (error) => error.code === "INVALID_BINDING",
  );
  await assert.rejects(
    adapter.dispatch(spec({ binding: { ...spec().binding, model: "claude-outside", routingOverlay: overlayReceipt } })),
    (error) => error.code === "INVALID_BINDING",
  );
  await assert.rejects(
    new PiRpcExecutionAdapter({ clock: () => now, routingOverlayPath: "/absent-overlay.json", spawn: () => fakeRpc() }).dispatch(spec()),
    (error) => error.code === "ROUTING_OVERLAY_UNAVAILABLE",
  );

  const withoutOverlay = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc() });
  await assert.rejects(withoutOverlay.dispatch(spec({ binding: { ...spec().binding, routingOverlay: overlayReceipt } })), (error) => error.code === "INVALID_BINDING");
});

test("accepts distinct-model independence only under an active overlay with fresh context", async () => {
  const adapter = stubOverlayRead(overlayAdapter());
  const independence = { kind: "fresh-context-distinct-model", authorProvider: "anthropic", authorModel: "claude-other", selectedProvider: "anthropic", selectedModel: "claude-test" };
  const reviewBinding = { ...spec().binding, cognitiveRole: "independent-review", routingOverlay: overlayReceipt, independence };
  const receipt = await adapter.dispatch(spec({ cognitiveRole: "independent-review", binding: reviewBinding }));
  assert.equal((await adapter.result(receipt.executionId)).outcome, "success");

  const rejected = [
    spec({ cognitiveRole: "independent-review", binding: reviewBinding, continuation: { sessionId: "resumed" } }),
    spec({ cognitiveRole: "independent-review", binding: { ...reviewBinding, independence: { ...independence, authorModel: "claude-test" } } }),
    spec({ cognitiveRole: "independent-review", binding: { ...reviewBinding, independence: { ...independence, authorModel: "claude-elsewhere" } } }),
    spec({ cognitiveRole: "independent-review", binding: { ...reviewBinding, independence: { ...independence, selectedModel: "claude-other" } } }),
  ];
  for (const candidate of rejected) await assert.rejects(adapter.dispatch(candidate), (error) => error.code === "INVALID_BINDING");

  const withoutOverlay = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc() });
  await assert.rejects(
    withoutOverlay.dispatch(spec({ cognitiveRole: "independent-review", binding: { ...spec().binding, cognitiveRole: "independent-review", independence } })),
    (error) => error.code === "INVALID_BINDING",
  );
});
