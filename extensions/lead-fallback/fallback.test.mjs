import assert from "node:assert/strict";
import test from "node:test";
import { shouldFallBack, FALLBACK } from "./fallback.mjs";
import leadFallback from "./index.ts";
import { pathToFileURL } from "node:url";

const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const failure = (errorMessage, stopReason = "error") => ({ role: "assistant", stopReason, errorMessage });
const eligible = (message, env = {}, model = opus) => shouldFallBack({ env, model, message });

test("lead recovery covers limits, overloads, HTTP 5xx and timeouts, not unrelated failures", () => {
  for (const error of [
    '429 {"error":{"type":"rate_limit_error"}}', "usage limit reached", "quota exceeded",
    '529 {"error":{"type":"overloaded_error"}}', "currently experiencing high demand",
    "500 Internal Server Error", "502 Bad Gateway", "503 Service Unavailable", "504 Gateway Timeout",
    "HTTP 501", "HTTP 599", "Request timed out", "Request timeout", "ETIMEDOUT",
  ]) assert.equal(eligible(failure(error)), true, error);
  for (const error of [
    "401 authentication_error", "403 permission denied", "400 invalid_request_error",
    "prompt is too long", "context window exceeded", "unknown error", "request id 1500",
    "Connection reset", "fetch failed", "Request cancelled after timeout", "Retry canceled: 503",
    "Request aborted: 500", "refusal: 503", "Request refused: timeout", "safety policy: 500",
    "content_filter: 503", "policy_violation: 500", "refusal_error: 503", "content policy: 500", "",
  ]) assert.equal(eligible(failure(error)), false, error);
  for (const stop of ["stop", "aborted", "refusal", "toolUse"]) assert.equal(eligible(failure("503", stop)), false);
  assert.equal(eligible(undefined), false);
  assert.equal(eligible({ role: "toolResult", stopReason: "error", errorMessage: "503" }), false);
  assert.equal(eligible(failure("503"), {}, FALLBACK), false);
  for (const key of ["PI_TELEMETRY_PARENT_SESSION_ID", "PI_TELEMETRY_EXECUTION_ID", "PI_WORKBENCH_EXECUTION_KIND"]) {
    assert.equal(eligible(failure("503"), { [key]: "child" }), false, key);
  }
});

test("settlement hook switches once, records one notice, and stops when fallback is unavailable", async (t) => {
  // The test itself may be running in a child; simulate an attended lead explicitly.
  const keys = ["PI_TELEMETRY_PARENT_SESSION_ID", "PI_TELEMETRY_EXECUTION_ID", "PI_WORKBENCH_EXECUTION_KIND"];
  const saved = keys.map((key) => process.env[key]);
  keys.forEach((key) => delete process.env[key]);
  t.after(() => keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]));

  function harness(availability = "yes") {
    const handlers = {};
    const calls = [];
    const controller = new AbortController();
    const ctx = {
      model: opus, signal: controller.signal,
      modelRegistry: { find: (provider, id) => {
        assert.equal(provider, FALLBACK.provider);
        assert.equal(id, FALLBACK.id);
        return availability === "missing" ? undefined : FALLBACK;
      } },
    };
    leadFallback({
      on: (name, handler) => { handlers[name] = handler; },
      setModel: async (model) => {
        calls.push(["model", model]);
        if (availability === "throws") throw new Error("Auth unavailable");
        if (availability === "no-auth") return false;
        ctx.model = model;
        return true;
      },
      setThinkingLevel: (level) => calls.push(["thinking", level]),
    });
    return { handlers, calls, ctx, controller,
      message: (message) => handlers.message_end({ message }),
      settle: (outcome = "error") => handlers.agent_before_settle({ outcome }, ctx),
    };
  }

  const h = harness();
  assert.deepEqual(Object.keys(h.handlers), ["message_end", "agent_before_settle"]);
  h.message(failure("503 Service Unavailable"));
  assert.equal(h.calls.length, 0, "message_end must not bypass native retries");
  h.message({ role: "toolResult" });
  const result = await h.settle();
  assert.equal(result.continue, true);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].display, true);
  assert.match(result.entries[0].content, /503 Service Unavailable/);
  assert.match(result.entries[0].content, /openai-codex\/gpt-6-sol \(high\)/);
  assert.match(result.entries[0].content, /Before repeating any side-effecting action, check/);
  assert.deepEqual(h.calls, [["model", FALLBACK], ["thinking", "high"]]);
  assert.equal(await h.settle(), undefined, "consume failure only once");
  h.message(failure("503"));
  assert.equal(await h.settle(), undefined, "no fallback chain on Sol failure");

  for (const availability of ["missing", "no-auth", "throws"]) {
    const h = harness(availability);
    h.message(failure("Request timed out"));
    const result = await h.settle();
    assert.equal(result.continue, false);
    assert.equal(result.entries.length, 1);
    assert.match(result.entries[0].content, /Request timed out/);
    assert.match(result.entries[0].content, /Fallback unavailable; stopped without automatic continuation/);
    assert.equal(h.calls.some(([name]) => name === "thinking"), false);
    assert.equal(await h.settle(), undefined);
  }
  for (const outcome of ["success", "aborted"]) {
    const h = harness();
    h.message(failure("503"));
    assert.equal(await h.settle(outcome), undefined);
    assert.equal(await h.settle(), undefined, "discard stale errors");
    assert.deepEqual(h.calls, []);
  }
  for (const message of [failure("503", "aborted"), failure("refusal: 503"), failure("401")]) {
    const h = harness();
    h.message(message);
    assert.equal(await h.settle(), undefined);
    assert.deepEqual(h.calls, []);
  }
  const cancelled = harness();
  cancelled.message(failure("503"));
  cancelled.controller.abort();
  assert.equal(await cancelled.settle(), undefined);
  assert.deepEqual(cancelled.calls, []);

  const child = harness();
  process.env.PI_TELEMETRY_EXECUTION_ID = "child";
  child.message(failure("503"));
  assert.equal(await child.settle(), undefined);
  assert.deepEqual(child.calls, []);
});

test("native Pi retries finish before the extension continues on Sol", { skip: !process.env.PI_CODING_AGENT_MODULE }, async (t) => {
  const { AgentSession } = await import(pathToFileURL(process.env.PI_CODING_AGENT_MODULE).href);
  const keys = ["PI_TELEMETRY_PARENT_SESSION_ID", "PI_TELEMETRY_EXECUTION_ID", "PI_WORKBENCH_EXECUTION_KIND"];
  const saved = keys.map((key) => process.env[key]);
  keys.forEach((key) => delete process.env[key]);
  t.after(() => keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]));
  for (const enabled of [true, false]) {
    const handlers = {}, events = [], notices = [];
    let model = { ...opus, contextWindow: 200000 }, requests = 0;
    // Exercise the installed loop/retry methods without provider calls or session writes.
    const session = Object.create(AgentSession.prototype);
    const ctx = { get model() { return model; }, modelRegistry: { find: () => FALLBACK } };
    leadFallback({
      on: (name, handler) => { handlers[name] = handler; },
      setModel: async (target) => { model = target; return true; },
      setThinkingLevel: () => {},
    });
    const produce = async () => {
      requests++;
      const message = { ...failure("503 Service Unavailable", model.provider === "anthropic" ? "error" : "stop"), content: [] };
      session._lastAssistantMessage = message;
      session._lastAssistantToolResults = [];
      handlers.message_end({ message });
      session._lastActivityOutcome = message.stopReason === "error" ? "error" : "success";
    };
    Object.assign(session, {
      agent: { state: { get model() { return model; } }, prompt: produce, continue: produce, hasQueuedMessages: () => false },
      settingsManager: { getRetrySettings: () => ({ enabled, maxRetries: 3, baseDelayMs: 0, maxAgentDelayMs: 0 }) },
      _retryAttempt: 0, _emit: (event) => events.push(event),
      _omitRecoveryAttempt: () => {}, _checkCompaction: async () => false,
      _runBeforeSettleBoundary: async () => {
        const result = await handlers.agent_before_settle({ outcome: session._lastActivityOutcome }, ctx);
        if (result) notices.push(...result.entries);
        return result?.continue ?? false;
      },
      _flushPendingBashMessages: () => {}, _flushPendingCustomMessages: () => {}, _emitAgentSettled: async () => {},
    });
    await session._runAgentPrompt([]);
    assert.equal(requests, enabled ? 5 : 2, "initial Claude request, native retries, then one Sol request");
    assert.equal(events.filter((event) => event.type === "auto_retry_start").length, enabled ? 3 : 0);
    assert.equal(notices.length, 1);
    assert.equal(model.id, FALLBACK.id);
  }
});
