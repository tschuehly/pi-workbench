import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { PiRpcExecutionAdapter } from "../src/index.js";

const now = new Date("2026-03-20T12:00:00.000Z");
function spec(overrides = {}) {
  return {
    task: "Inspect src and report.", profile: "scout", cognitiveRole: "wide-evidence-gathering", cwd: "/tmp", tools: ["read", "bash"],
    binding: {
      cognitiveRole: "wide-evidence-gathering",
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
  child.stdin = new Writable({ write(chunk, _encoding, callback) { input += String(chunk); drain(); callback(); } });
  child.kill = (signal) => { child.kills.push(signal); if (options.confirmKill !== false) queueMicrotask(() => child.emit("close", null, signal)); return true; };
  child.kills = [];
  child.commands = [];
  const send = (value) => child.stdout.write(`${JSON.stringify(value)}\n`);
  function drain() {
    for (;;) {
      const index = input.indexOf("\n"); if (index < 0) return;
      const command = JSON.parse(input.slice(0, index)); input = input.slice(index + 1); child.commands.push(command);
      if (command.type === "get_state") send({ id: command.id, type: "response", command: "get_state", success: true, data: { model: { provider: options.provider ?? "anthropic", id: options.model ?? "claude-test" }, thinkingLevel: options.effort ?? "high", sessionId: "child-session" } });
      if (command.type === "abort" && options.settleOnAbort) queueMicrotask(() => send({ type: "agent_settled" }));
      if (command.type === "prompt") {
        send({ id: command.id, type: "response", command: "prompt", success: true });
        if (!options.hang) queueMicrotask(() => {
          send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "secret reasoning" } });
          send({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "src" } });
          send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Compact result" }] } });
          send({ type: "agent_settled" });
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
  assert.equal(observations.some((value) => JSON.stringify(value).includes("secret reasoning")), false);
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

test("distinguishes confirmed timeout from an unknown termination outcome", async () => {
  const timedOut = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc({ hang: true }), timeoutMs: 1, killGraceMs: 1 });
  const timedReceipt = await timedOut.dispatch(spec());
  assert.equal((await timedOut.result(timedReceipt.executionId)).outcome, "timed_out");

  const unknown = new PiRpcExecutionAdapter({ clock: () => now, spawn: () => fakeRpc({ hang: true, confirmKill: false }), timeoutMs: 1, killGraceMs: 1 });
  const unknownReceipt = await unknown.dispatch(spec());
  assert.equal((await unknown.result(unknownReceipt.executionId)).outcome, "outcome_unknown");
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
