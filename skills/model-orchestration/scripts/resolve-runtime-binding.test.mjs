#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Default-path cases must not inherit a run-scoped overlay from the surrounding session; the
// overlay cases below set the variable explicitly on the child env instead.
delete process.env.PI_WORKBENCH_ROUTING_OVERLAY;

const here = path.dirname(fileURLToPath(import.meta.url));
const resolver = path.join(here, "resolve-runtime-binding.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-routing-test-"));
const quotaPath = path.join(temp, "quota.json");
const catalogPath = path.join(temp, "catalog.txt");

const quota = {
  generatedAt: "2026-07-30T00:00:00Z",
  providers: [
    {
      provider: "claude",
      windows: [
        { id: "five_hour", kind: "session", percentRemaining: 70, resetsAt: "later" },
        { id: "model:fable", kind: "model", percentRemaining: 80, resetsAt: "later" },
      ],
      state: { status: "fresh", stale: false, refreshedAt: "now" },
    },
    {
      provider: "codex",
      windows: [{ id: "seven_day", kind: "weekly", percentRemaining: 90, resetsAt: "later" }],
      state: { status: "fresh", stale: false, refreshedAt: "now" },
    },
  ],
};
const catalog = [
  "anthropic claude-sonnet-5 1M 128K yes yes",
  "anthropic claude-fable-5 1M 128K yes yes",
  "anthropic claude-opus-5 1M 128K yes yes",
  "openai-codex gpt-5.6-sol 272K 128K yes yes",
].join("\n");

try {
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  fs.writeFileSync(catalogPath, catalog);

  const pass = JSON.parse(execFileSync(process.execPath, [resolver, "investigation", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(pass.status, "pass");
  assert.equal(pass.modelBinding.provider, "anthropic");
  assert.equal(pass.modelBinding.quotaSnapshot.relevantWindows.length, 1);

  const synthesis = JSON.parse(execFileSync(process.execPath, [resolver, "synthesis", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(synthesis.modelBinding.model, "claude-opus-5");
  assert.equal(synthesis.modelBinding.effort, "high");

  const reviewOfOpenAi = JSON.parse(execFileSync(process.execPath, [resolver, "independent-review", "--independent-of", "openai-codex", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(reviewOfOpenAi.modelBinding.model, "claude-opus-5");
  assert.equal(reviewOfOpenAi.modelBinding.independence.independentOfFamily, "openai");
  assert.equal(reviewOfOpenAi.modelBinding.independence.selectedFamily, "anthropic");

  const exactModelWithoutOverlay = JSON.parse(execFileSync(process.execPath, [resolver, "independent-review", "--independent-of-model", "openai-codex/gpt-5.6-sol", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.deepEqual(exactModelWithoutOverlay.modelBinding.independence, reviewOfOpenAi.modelBinding.independence);
  assert.equal(exactModelWithoutOverlay.modelBinding.model, "claude-opus-5");

  const contradictoryAuthor = spawnSync(process.execPath, [resolver, "independent-review", "--independent-of", "anthropic", "--independent-of-model", "openai-codex/gpt-5.6-sol", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(contradictoryAuthor.status, 3);
  assert.match(contradictoryAuthor.stderr, /contradicts --independent-of-model/);

  const reviewOfClaude = JSON.parse(execFileSync(process.execPath, [resolver, "independent-review", "--independent-of", "anthropic", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(reviewOfClaude.modelBinding.model, "gpt-5.6-sol");
  assert.equal(reviewOfClaude.modelBinding.independence.selectedFamily, "openai");

  const challengeOfClaude = JSON.parse(execFileSync(process.execPath, [resolver, "challenge", "--independent-of", "anthropic", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(challengeOfClaude.modelBinding.effort, "xhigh");

  const judgmentOfOpenAi = JSON.parse(execFileSync(process.execPath, [resolver, "independent-judgment", "--independent-of", "openai", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(judgmentOfOpenAi.modelBinding.model, "claude-fable-5");

  const missingIndependence = spawnSync(process.execPath, [resolver, "independent-review", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(missingIndependence.status, 3);
  assert.match(missingIndependence.stderr, /requires --independent-of/);

  quota.providers[0].windows[0].percentRemaining = 0;
  quota.providers[0].state = {
    status: "stale",
    stale: true,
    refreshedAt: "earlier",
    error: "Claude sign-in required",
  };
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const stale = JSON.parse(execFileSync(process.execPath, [resolver, "investigation", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(stale.status, "pass");
  assert.equal(stale.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(stale.modelBinding.quotaSnapshot.telemetryStatus, "stale");
  assert.equal(stale.modelBinding.quotaSnapshot.error, "Claude sign-in required");
  assert.equal(stale.modelBinding.quotaSnapshot.relevantWindows.length, 1);

  quota.providers = quota.providers.filter((provider) => provider.provider !== "claude");
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const unavailable = JSON.parse(execFileSync(process.execPath, [resolver, "investigation", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(unavailable.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(unavailable.modelBinding.quotaSnapshot.telemetryStatus, "unavailable");
  assert.match(unavailable.modelBinding.quotaSnapshot.error, /absent/);

  fs.writeFileSync(quotaPath, "not-json");
  const unreadable = JSON.parse(execFileSync(process.execPath, [resolver, "investigation", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(unreadable.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(unreadable.modelBinding.quotaSnapshot.telemetryStatus, "unavailable");
  assert.match(unreadable.modelBinding.quotaSnapshot.error, /invalid quota JSON/);

  const missing = JSON.parse(execFileSync(process.execPath, [resolver, "investigation", "--quota", path.join(temp, "missing.json"), "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(missing.modelBinding.admission, "degraded-quota-telemetry");
  assert.match(missing.modelBinding.quotaSnapshot.error, /quota snapshot unavailable/);

  const fakeBin = path.join(temp, "bin");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, "quota-axi"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(quota))});\nprocess.exit(1);\n`, { mode: 0o755 });
  const salvaged = JSON.parse(execFileSync(process.execPath, [resolver, "investigation", "--catalog", catalogPath], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`, PI_WORKBENCH_QUOTA_CACHE: path.join(temp, "salvaged-cache.json") },
  }));
  assert.equal(salvaged.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(salvaged.modelBinding.quotaSnapshot.telemetryStatus, "unavailable");

  quota.providers.unshift({
    provider: "claude",
    windows: [{ id: "five_hour", kind: "session", percentRemaining: 0, resetsAt: "later" }],
    state: { status: "fresh", stale: false, refreshedAt: "now" },
  });
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const exhausted = spawnSync(process.execPath, [resolver, "investigation", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(exhausted.status, 3);
  assert.match(exhausted.stderr, /quota exhausted/);

  quota.providers[0].windows[0].percentRemaining = 70;
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  fs.writeFileSync(catalogPath, "openai-codex gpt-5.6-sol");
  const absent = spawnSync(process.execPath, [resolver, "investigation", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(absent.status, 3);
  assert.match(absent.stderr, /Pi model .* unavailable/);

  fs.writeFileSync(catalogPath, catalog);
  fs.writeFileSync(path.join(fakeBin, "quota-axi"), `#!/usr/bin/env node\nsetTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(quota))}), 1000);\n`, { mode: 0o755 });
  const slowQuota = JSON.parse(execFileSync(process.execPath, [resolver, "investigation", "--catalog", catalogPath], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`, PI_WORKBENCH_QUOTA_CACHE: path.join(temp, "slow-quota-cache.json"), PI_WORKBENCH_ROUTING_TIMEOUT_MS: "20" },
  }));
  assert.equal(slowQuota.modelBinding.admission, "degraded-quota-telemetry");
  assert.match(slowQuota.modelBinding.quotaSnapshot.error, /timed out|ETIMEDOUT/i);

  fs.writeFileSync(path.join(fakeBin, "pi"), "#!/usr/bin/env node\nsetTimeout(() => process.stdout.write('anthropic claude-sonnet-5\\n'), 1000);\n", { mode: 0o755 });
  const slowCatalog = spawnSync(process.execPath, [resolver, "investigation", "--quota", quotaPath], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`, PI_WORKBENCH_ROUTING_TIMEOUT_MS: "20" },
  });
  assert.equal(slowCatalog.status, 3);
  assert.match(slowCatalog.stderr, /model catalog unavailable/i);

  const cachePath = path.join(temp, "quota-cache.json");
  const callCountPath = path.join(temp, "quota-call-count");
  fs.writeFileSync(path.join(fakeBin, "quota-axi"), `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst countPath = ${JSON.stringify(callCountPath)};\nconst count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : "0") + 1;\nfs.writeFileSync(countPath, String(count));\nprocess.stdout.write(${JSON.stringify(JSON.stringify(quota))});\n`, { mode: 0o755 });
  fs.writeFileSync(catalogPath, catalog);
  const cachedEnv = {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    PI_WORKBENCH_QUOTA_CACHE: cachePath,
  };
  execFileSync(process.execPath, [resolver, "investigation", "--catalog", catalogPath], { encoding: "utf8", env: cachedEnv });
  execFileSync(process.execPath, [resolver, "investigation", "--catalog", catalogPath], { encoding: "utf8", env: cachedEnv });
  assert.equal(fs.readFileSync(callCountPath, "utf8"), "1", "quota-axi should run at most once inside the ten-minute cache window");
  const expiredCache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  expiredCache.checkedAt -= 10 * 60 * 1000;
  fs.writeFileSync(cachePath, JSON.stringify(expiredCache));
  execFileSync(process.execPath, [resolver, "investigation", "--catalog", catalogPath], { encoding: "utf8", env: cachedEnv });
  assert.equal(fs.readFileSync(callCountPath, "utf8"), "2", "the first resolution at the ten-minute boundary should refresh quota telemetry");

  // Run-scoped routing overlay: sole activation variable, fail-closed, distinct-model independence.
  const overlayPath = path.join(here, "..", "references", "anthropic-opus-sonnet-overlay.json");
  const overlaySha = createHash("sha256").update(fs.readFileSync(overlayPath)).digest("hex");
  const withOverlay = (value) => ({ ...process.env, PI_WORKBENCH_ROUTING_OVERLAY: value });
  const runOverlay = (args, value = overlayPath) => spawnSync(process.execPath, [resolver, ...args, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8", env: withOverlay(value) });
  const passOverlay = (args, value = overlayPath) => {
    const run = runOverlay(args, value);
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };

  for (const [role, model] of [["investigation", "claude-sonnet-5"], ["implementation", "claude-sonnet-5"], ["mechanics", "claude-sonnet-5"], ["problem-solving", "claude-sonnet-5"], ["synthesis", "claude-opus-5"]]) {
    const resolved = passOverlay([role]);
    assert.equal(resolved.modelBinding.provider, "anthropic", role);
    assert.equal(resolved.modelBinding.model, model, role);
    assert.equal(resolved.modelBinding.routingOverlay.sha256, overlaySha, role);
    assert.equal(resolved.modelBinding.routingOverlay.path, overlayPath, role);
  }

  const sonnetAuthored = passOverlay(["independent-review", "--independent-of-model", "anthropic/claude-sonnet-5"]);
  assert.equal(sonnetAuthored.modelBinding.model, "claude-opus-5");
  assert.deepEqual(sonnetAuthored.modelBinding.independence, {
    kind: "fresh-context-distinct-model",
    authorProvider: "anthropic", authorModel: "claude-sonnet-5",
    selectedProvider: "anthropic", selectedModel: "claude-opus-5",
  });
  assert.equal(passOverlay(["independent-review", "--independent-of-model", "anthropic/claude-opus-5"]).modelBinding.model, "claude-sonnet-5");

  const overlayBlocks = [
    [["independent-review", "--independent-of", "openai-codex"], /requires --independent-of-model/, "cross-family independence is not available under the overlay"],
    [["independent-review", "--independent-of-model", "anthropic/claude-fable-5"], /no independent binding for author model/, "an unmapped author model fails closed"],
    [["investigation", "--independent-of-model", "anthropic/claude-opus-5"], /does not use an independence constraint/, "a non-independent role rejects an author model"],
  ];
  for (const [args, pattern, message] of overlayBlocks) {
    const run = runOverlay(args);
    assert.equal(run.status, 3, message);
    assert.match(run.stderr, pattern, message);
  }

  const unrelatedExactModel = spawnSync(process.execPath, [resolver, "investigation", "--independent-of-model", "anthropic/claude-opus-5", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(unrelatedExactModel.status, 3, "a non-independent role rejects an author model without an overlay");
  assert.match(unrelatedExactModel.stderr, /does not use an independence constraint/);

  const badOverlay = (contents, pattern, message) => {
    const file = path.join(temp, `overlay-${createHash("sha256").update(String(contents)).digest("hex").slice(0, 8)}.json`);
    fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
    const run = runOverlay(["investigation"], file);
    assert.equal(run.status, 3, message);
    assert.match(run.stderr, pattern, message);
  };
  const valid = JSON.parse(fs.readFileSync(overlayPath, "utf8"));
  const absentOverlay = runOverlay(["investigation"], path.join(temp, "absent-overlay.json"));
  assert.equal(absentOverlay.status, 3, "a missing overlay fails closed");
  assert.match(absentOverlay.stderr, /unreadable/i);
  const relative = spawnSync(process.execPath, [resolver, "investigation", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8", env: withOverlay("references/anthropic-opus-sonnet-overlay.json") });
  assert.equal(relative.status, 3, "a relative overlay path fails closed");
  assert.match(relative.stderr, /must be an absolute path/);
  badOverlay("{not json", /not valid JSON/, "invalid JSON fails closed");
  badOverlay({ ...valid, version: 2 }, /version must be 1/, "an unknown overlay version fails closed");
  badOverlay({ ...valid, allowedModels: [] }, /at least one allowed model/, "an empty allowlist fails closed");
  badOverlay({ ...valid, roles: { ...valid.roles, investigation: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "medium", quotaProvider: "codex" } } }, /resolves outside its own allowlist/, "a role outside the allowlist fails closed");
  badOverlay({ ...valid, roles: { ...valid.roles, "not-a-role": valid.roles.investigation } }, /unknown cognitive role/, "an unknown mapped role fails closed");

  // An unmapped role fails closed rather than falling back to the default openai-codex binding.
  const withoutInvestigation = path.join(temp, "overlay-without-investigation.json");
  const { investigation: _dropped, ...remainingRoles } = valid.roles;
  fs.writeFileSync(withoutInvestigation, JSON.stringify({ ...valid, roles: remainingRoles }));
  const unmapped = runOverlay(["investigation"], withoutInvestigation);
  assert.equal(unmapped.status, 3, "an unmapped role fails closed instead of using default routing");
  assert.match(unmapped.stderr, /does not map cognitive role/);
  assert.equal(passOverlay(["design"], withoutInvestigation).modelBinding.model, "claude-opus-5", "every mapped role stays inside the two-model allowlist");
  badOverlay({ ...valid, independentReview: { "anthropic/claude-opus-5": { provider: "anthropic", model: "claude-opus-5", effort: "high", quotaProvider: "claude" } } }, /not a distinct model/, "same-model review mapping fails closed");

  console.log("resolve-runtime-binding: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
