import assert from "node:assert/strict";
import test from "node:test";
import { checkClaudeQuota, isRepairableQuotaStatus, noticeForQuotaCheck, repairClaudeQuota } from "./check.mjs";

const fresh = {
  providers: [{ provider: "claude", state: { status: "fresh", stale: false } }],
};

function runner(steps) {
  const calls = [];
  return {
    calls,
    run: async (command, args) => {
      calls.push([command, args]);
      const next = steps.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test("classifies fresh, keychain, sign-in, and unavailable Claude telemetry", async () => {
  for (const [payload, expected] of [
    [fresh, "fresh"],
    [{ providers: [{ provider: "claude", state: { status: "unavailable", reason: "keychain_access_required", remedyCommand: "quota-axi --allow-keychain-prompt" } }] }, "keychain-required"],
    [{ providers: [{ provider: "claude", state: { status: "auth_required", error: "Claude sign-in required" } }] }, "sign-in-required"],
    [{ providers: [] }, "unavailable"],
  ]) {
    const fake = runner([{ code: 0, stdout: JSON.stringify(payload), stderr: "" }]);
    assert.equal((await checkClaudeQuota(fake.run)).status, expected);
  }
});

test("keeps endpoint rate limits silent at startup and reports them on manual checks", async () => {
  const fake = runner([{ code: 0, stdout: JSON.stringify({
    providers: [{ provider: "claude", state: { status: "rate_limited", error: "Claude quota endpoint rate limited" } }],
  }), stderr: "" }]);
  const result = await checkClaudeQuota(fake.run);
  assert.equal(result.status, "rate-limited");
  assert.equal(noticeForQuotaCheck(result, false), undefined);
  assert.deepEqual(noticeForQuotaCheck(result, true), {
    level: "warning",
    message: "Claude quota endpoint is rate limited. Child launches can proceed with degraded telemetry; retry /quota-check later.",
  });
});

test("only authentication and Keychain failures enter the repair flow", () => {
  assert.equal(isRepairableQuotaStatus("keychain-required"), true);
  assert.equal(isRepairableQuotaStatus("sign-in-required"), true);
  assert.equal(isRepairableQuotaStatus("fresh"), false);
  assert.equal(isRepairableQuotaStatus("rate-limited"), false);
  assert.equal(isRepairableQuotaStatus("unavailable"), false);
});

test("reports missing or malformed quota-axi output without throwing", async () => {
  const missing = runner([new Error("spawn quota-axi ENOENT")]);
  assert.equal((await checkClaudeQuota(missing.run)).status, "unavailable");

  const malformed = runner([{ code: 0, stdout: "not-json", stderr: "" }]);
  assert.equal((await checkClaudeQuota(malformed.run)).status, "unavailable");
});

test("repairs keychain access without launching Claude login", async () => {
  const fake = runner([
    { code: 0, stdout: JSON.stringify(fresh), stderr: "" },
  ]);
  const result = await repairClaudeQuota(fake.run, "keychain-required");
  assert.equal(result.status, "fresh");
  assert.deepEqual(fake.calls, [["quota-axi", ["--allow-keychain-prompt", "--provider", "claude", "--json"]]]);
});

test("repairs expired sign-in before requesting persistent Keychain access", async () => {
  const fake = runner([
    { code: 0, stdout: "Login successful.", stderr: "" },
    { code: 0, stdout: JSON.stringify(fresh), stderr: "" },
  ]);
  const result = await repairClaudeQuota(fake.run, "sign-in-required");
  assert.equal(result.status, "fresh");
  assert.deepEqual(fake.calls, [
    ["claude", ["auth", "login"]],
    ["quota-axi", ["--allow-keychain-prompt", "--provider", "claude", "--json"]],
  ]);
});
