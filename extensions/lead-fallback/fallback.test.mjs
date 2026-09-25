import assert from "node:assert/strict";
import test from "node:test";
import { shouldFallBack } from "./fallback.mjs";

const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const limit = { role: "assistant", stopReason: "error", errorMessage: `429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit."}}` };

test("falls back only for a lead's Claude limit error", () => {
  assert.equal(shouldFallBack({ env: {}, model: opus, message: limit }), true);
  assert.equal(shouldFallBack({ env: { PI_TELEMETRY_PARENT_SESSION_ID: "p" }, model: opus, message: limit }), false);
  assert.equal(shouldFallBack({ env: {}, model: { provider: "openai-codex", id: "gpt-6-sol" }, message: limit }), false);
  assert.equal(shouldFallBack({ env: {}, model: opus, message: { ...limit, errorMessage: "500 overloaded" } }), false);
  assert.equal(shouldFallBack({ env: {}, model: opus, message: { ...limit, stopReason: "stop" } }), false);
});
