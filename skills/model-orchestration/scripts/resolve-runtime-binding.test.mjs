#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knownModelFamilies, modelFamily } from "../../../packages/pi-execution-adapter/src/model-family.js";

// Default-path cases must not inherit a run-scoped overlay from the surrounding session; the
// overlay cases below set the variable explicitly on the child env instead.
delete process.env.PI_WORKBENCH_ROUTING_OVERLAY;

const here = path.dirname(fileURLToPath(import.meta.url));
const resolver = path.join(here, "resolve-runtime-binding.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-routing-test-"));
const quotaPath = path.join(temp, "quota.json");
const catalogPath = path.join(temp, "catalog.txt");
const modelMetadataPath = path.join(temp, "models-store.json");

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
    {
      provider: "copilot",
      windows: [{ id: "premium", kind: "monthly", percentRemaining: 60, resetsAt: "later" }],
      state: { status: "fresh", stale: false, refreshedAt: "now" },
    },
  ],
};
const catalog = [
  "anthropic claude-sonnet-5 1M 128K yes yes",
  "anthropic claude-fable-5-1 1M 128K yes yes",
  "anthropic claude-opus-5 1M 128K yes yes",
  "anthropic claude-opus-5-5 1M 128K yes yes",
  "openai-codex gpt-5.6-sol 272K 128K yes yes",
  "openai-codex gpt-6-sol 272K 128K yes yes",
  "openai-codex gpt-6-luna 272K 128K yes yes",
  "openai-codex gpt-6-astra 272K 128K yes yes",
  "github-copilot gpt-5-mini 264K 64K yes yes",
  "github-copilot plain-chat 264K 64K no yes",
  "github-copilot claude-sonnet-5 1M 128K yes yes",
  "github-copilot gemini-3.1-pro-preview 1M 64K yes yes",
  "github-copilot grok-4.6 1M 64K yes yes",
  "github-copilot grok-4.7 1M 64K yes yes",
  "github-copilot gpt-5.6-sol 1M 64K yes yes",
  "openai gpt-5.6-sol 1M 128K yes yes",
  "openai gpt-6-astra 1M 128K yes yes",
].join("\n");

try {
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  fs.writeFileSync(catalogPath, catalog);
  fs.writeFileSync(modelMetadataPath, JSON.stringify({
    "openai-codex": { models: [
      { id: "gpt-5.6-sol", reasoning: true, thinkingLevelMap: { medium: "medium", high: "high", xhigh: "xhigh" } },
      { id: "gpt-6-sol", reasoning: true, thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } },
      { id: "gpt-6-luna", reasoning: true, thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } },
      { id: "gpt-6-astra", reasoning: true, thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } },
    ] },
    anthropic: { models: [
      { id: "claude-sonnet-5", reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max" } },
      { id: "claude-fable-5-1", reasoning: true, thinkingLevelMap: { high: "high", xhigh: "xhigh" } },
      { id: "claude-opus-5", reasoning: true, thinkingLevelMap: { high: "high" } },
      { id: "claude-opus-5-5", reasoning: true, thinkingLevelMap: { medium: "medium", high: "high", xhigh: "xhigh" } },
    ] },
    "github-copilot": { models: [
      { id: "gpt-5-mini", reasoning: true, thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: null, max: null } },
      { id: "plain-chat", reasoning: false },
      { id: "grok-4.6", reasoning: true, thinkingLevelMap: { high: "high" } },
      { id: "grok-4.7", reasoning: true, thinkingLevelMap: { high: "high", xhigh: "xhigh", max: null } },
    ] },
    openai: { models: [
      { id: "gpt-5.6-sol", reasoning: true, thinkingLevelMap: { high: "high", max: "max" } },
      { id: "gpt-6-astra", reasoning: true, thinkingLevelMap: { high: "high", max: "max" } },
    ] },
  }));

  const pass = JSON.parse(execFileSync(process.execPath, [resolver, "routine", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(pass.status, "pass");
  assert.equal(pass.modelBinding.provider, "openai-codex");
  assert.equal(pass.modelBinding.model, "gpt-6-luna");
  assert.equal(pass.modelBinding.quotaSnapshot.relevantWindows.length, 1);

  for (const [role, model, effort, tier] of [
    ["routine", "gpt-6-luna", "medium", "light"], ["implementation", "claude-opus-5-5", "medium", "standard"],
    ["frontier", "gpt-6-astra", "xhigh", "strong"], ["coordination", "claude-opus-5-5", "medium", "standard"],
  ]) {
    const resolved = JSON.parse(execFileSync(process.execPath, [resolver, role, "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
    assert.equal(resolved.modelBinding.model, model, role);
    assert.equal(resolved.modelBinding.effort, effort, role);
    assert.equal(resolved.modelBinding.tier, tier, role);
    assert.equal(resolved.modelBinding.fallback, undefined, role);
  }

  for (const retired of ["investigation", "mechanics", "problem-solving", "design", "escalation", "synthesis", "challenge", "independent-judgment", "independent-review"]) {
    const run = spawnSync(process.execPath, [resolver, retired, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
    assert.equal(run.status, 1, retired);
    assert.match(run.stderr, /Unknown cognitive role/, retired);
  }

  const help = spawnSync(process.execPath, [resolver, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /strong=astra\/opus/);

  const staged = spawnSync(process.execPath, [resolver, "routine", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(staged.status, 0, staged.stderr);
  assert.match(staged.stderr, /STAGE=policy[\s\S]*STAGE=quota[\s\S]*STAGE=catalog/);

  // The reserve tier (Fable) is reachable only by name, e.g. the second member of a frontier panel.
  const reserve = JSON.parse(execFileSync(process.execPath, [resolver, "frontier", "--model", "anthropic/claude-fable-5-1", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(reserve.modelBinding.model, "claude-fable-5-1");
  assert.equal(reserve.modelBinding.effort, "xhigh");
  assert.equal(reserve.modelBinding.tier, undefined, "an explicit model is outside tier routing");

  const lowFrontier = spawnSync(process.execPath, [resolver, "frontier", "--effort", "high", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(lowFrontier.status, 3);
  assert.match(lowFrontier.stderr, /needs at least Model Effort 'xhigh'/);
  const maxFrontier = JSON.parse(execFileSync(process.execPath, [resolver, "frontier", "--effort", "max", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(maxFrontier.modelBinding.effort, "max", "raising effort above the floor is allowed");

  const astraWorker = JSON.parse(execFileSync(process.execPath, [resolver, "coordination", "--model", "openai-codex/gpt-6-astra", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(astraWorker.modelBinding.provider, "openai-codex");
  assert.equal(astraWorker.modelBinding.model, "gpt-6-astra");
  assert.equal(astraWorker.modelBinding.effort, "medium", "the Cognitive Role still selects effort");
  assert.equal(astraWorker.modelBinding.modelOverride, "openai-codex/gpt-6-astra");
  assert.equal(astraWorker.modelBinding.quotaSnapshot.telemetryStatus, "fresh");

  const crossProviderWorker = JSON.parse(execFileSync(process.execPath, [resolver, "implementation", "--model", "anthropic/claude-sonnet-5", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(crossProviderWorker.modelBinding.provider, "anthropic");
  assert.equal(crossProviderWorker.modelBinding.model, "claude-sonnet-5");
  assert.equal(crossProviderWorker.modelBinding.effort, "medium");
  assert.equal(crossProviderWorker.modelBinding.quotaSnapshot.relevantWindows[0].id, "five_hour", "quota follows the overridden provider");

  const explicitEffort = JSON.parse(execFileSync(process.execPath, [resolver, "implementation", "--effort", "high", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(explicitEffort.modelBinding.model, "claude-opus-5-5", "the Cognitive Role still selects the model");
  assert.equal(explicitEffort.modelBinding.effort, "high");
  assert.equal(explicitEffort.modelBinding.effortOverride, "high");

  const reasoningOff = JSON.parse(execFileSync(process.execPath, [resolver, "implementation", "--model", "github-copilot/plain-chat", "--effort", "off", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(reasoningOff.modelBinding.model, "plain-chat");
  assert.equal(reasoningOff.modelBinding.effort, "off");

  const explicitModelAndEffort = JSON.parse(execFileSync(process.execPath, [resolver, "coordination", "--model", "openai-codex/gpt-6-astra", "--effort", "max", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(explicitModelAndEffort.modelBinding.model, "gpt-6-astra");
  assert.equal(explicitModelAndEffort.modelBinding.effort, "max");

  const invalidEffort = spawnSync(process.execPath, [resolver, "implementation", "--effort", "ultra", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(invalidEffort.status, 3);
  assert.match(invalidEffort.stderr, /--effort must be one of/);

  const unsupportedExplicitEffort = spawnSync(process.execPath, [resolver, "implementation", "--model", "openai-codex/gpt-5.6-sol", "--effort", "max", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(unsupportedExplicitEffort.status, 3);
  assert.match(unsupportedExplicitEffort.stderr, /does not support Model Effort 'max'/);

  for (const requested of ["gpt-6-astra", "/gpt-6-astra", "openai-codex/", "openai-codex/not-installed"]) {
    const rejected = spawnSync(process.execPath, [resolver, "coordination", "--model", requested, "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
    assert.equal(rejected.status, 3, requested);
  }

  const unmappedQuota = spawnSync(process.execPath, [resolver, "coordination", "--model", "openai/gpt-6-astra", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(unmappedQuota.status, 3);
  assert.match(unmappedQuota.stderr, /no quota provider mapping/i);

  const unsupportedEffort = spawnSync(process.execPath, [resolver, "frontier", "--model", "github-copilot/gpt-5-mini", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(unsupportedEffort.status, 3);
  assert.match(unsupportedEffort.stderr, /does not support Model Effort 'xhigh'/);

  assert.deepEqual(knownModelFamilies, ["anthropic", "openai", "google", "xai", "moonshot", "microsoft"]);
  assert.equal(modelFamily("anthropic"), "anthropic");
  assert.equal(modelFamily("openai-codex"), "openai");
  assert.equal(modelFamily("github-copilot", "claude-sonnet-5"), "anthropic");
  assert.equal(modelFamily("github-copilot", "gpt-5.6-sol"), "openai");
  assert.equal(modelFamily("github-copilot", "gemini-3.1-pro-preview"), "google");
  assert.equal(modelFamily("github-copilot", "grok-4.6"), "xai");
  assert.equal(modelFamily("github-copilot", "kimi-k3"), "moonshot");
  assert.equal(modelFamily("github-copilot", "mai-code-1.1-flash"), "microsoft");
  assert.equal(modelFamily("github-copilot"), undefined);
  assert.equal(modelFamily("github-copilot", "unknown-1"), undefined);
  assert.equal(modelFamily("unknown-gateway", "gpt-5.6-sol"), undefined);

  const runIndependent = (args, options = {}) => spawnSync(process.execPath, [resolver, ...args,
    "--model-metadata", options.metadata ?? modelMetadataPath,
    "--quota", options.quota ?? quotaPath,
    "--catalog", options.catalog ?? catalogPath,
  ], { encoding: "utf8" });
  const passIndependent = (args, options) => {
    const run = runIndependent(args, options);
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };

  // Reviewing strong-tier work: the lead names the other family's strong model; independence still holds.
  const strongReview = passIndependent(["review", "--model", "openai-codex/gpt-6-astra", "--independent-of", "anthropic"]);
  assert.equal(strongReview.modelBinding.model, "gpt-6-astra");
  assert.equal(strongReview.modelBinding.effort, "xhigh");
  assert.equal(strongReview.modelBinding.independence.selectedFamily, "openai");
  const sameFamilyOverride = runIndependent(["review", "--model", "anthropic/claude-sonnet-5", "--independent-of", "anthropic"]);
  assert.equal(sameFamilyOverride.status, 3);
  assert.match(sameFamilyOverride.stderr, /not independent of author family 'anthropic'/);

  const reviewOfOpenAi = passIndependent(["review", "--independent-of", "openai-codex"]);
  assert.equal(reviewOfOpenAi.modelBinding.model, "claude-opus-5-5");
  assert.equal(reviewOfOpenAi.modelBinding.independence.independentOfFamily, "openai");
  assert.equal(reviewOfOpenAi.modelBinding.independence.selectedFamily, "anthropic");

  assert.equal(reviewOfOpenAi.modelBinding.effort, "xhigh");
  const lowerEffortReview = runIndependent(["review", "--independent-of", "openai-codex", "--effort", "high"]);
  assert.equal(lowerEffortReview.status, 3, "review never runs below its xhigh floor");
  assert.match(lowerEffortReview.stderr, /needs at least Model Effort 'xhigh'/);

  const exactModelWithoutOverlay = passIndependent(["review", "--independent-of-model", "openai-codex/gpt-6-sol"]);
  assert.deepEqual(exactModelWithoutOverlay.modelBinding.independence, {
    ...reviewOfOpenAi.modelBinding.independence,
    independentOfModel: "openai-codex/gpt-6-sol",
  });
  assert.equal(exactModelWithoutOverlay.modelBinding.model, "claude-opus-5-5");

  // Regression: github-copilot is a gateway, so the exact model determines the author family.
  const copilotAuthors = [
    ["claude-sonnet-5", "anthropic", "openai"],
    ["gemini-3.1-pro-preview", "google", "anthropic"],
    ["grok-4.6", "xai", "anthropic"],
    ["gpt-5.6-sol", "openai", "anthropic"],
  ];
  for (const [model, authorFamily, selectedFamily] of copilotAuthors) {
    const resolved = passIndependent(["review", "--independent-of-model", `github-copilot/${model}`]);
    assert.equal(resolved.modelBinding.independence.independentOfFamily, authorFamily, model);
    assert.equal(resolved.modelBinding.independence.selectedFamily, selectedFamily, model);
    assert.equal(resolved.modelBinding.independence.independentOfModel, `github-copilot/${model}`, model);
  }

  // A second CRITICAL reviewer family is selected explicitly; quota/catalog failures never change it.
  const secondReviewer = passIndependent(["review", "--independent-of-model", "openai-codex/gpt-6-sol", "--exclude-family", "anthropic"]);
  assert.equal(secondReviewer.modelBinding.provider, "github-copilot");
  assert.equal(secondReviewer.modelBinding.model, "grok-4.7");
  assert.equal(secondReviewer.modelBinding.effort, "xhigh");
  assert.equal(secondReviewer.modelBinding.independence.selectedFamily, "xai");
  assert.deepEqual(secondReviewer.modelBinding.independence.excludedFamilies, ["anthropic"]);

  const noReviewer = runIndependent(["review", "--independent-of", "openai", "--exclude-family", "anthropic", "--exclude-family", "xai"]);
  assert.equal(noReviewer.status, 3);
  assert.match(noReviewer.stderr, /no independent candidate/i);

  const bareCopilot = runIndependent(["review", "--independent-of", "github-copilot"]);
  assert.equal(bareCopilot.status, 3);
  assert.match(bareCopilot.stderr, /requires --independent-of-model.*exact model/i);

  const unknownCopilot = runIndependent(["review", "--independent-of-model", "github-copilot/unknown-1"]);
  assert.equal(unknownCopilot.status, 3);
  assert.match(unknownCopilot.stderr, /cannot determine.*family/i);

  const unknownFamily = runIndependent(["review", "--independent-of", "openai", "--exclude-family", "not-a-family"]);
  assert.equal(unknownFamily.status, 3);
  assert.match(unknownFamily.stderr, /unknown model family/i);

  const contradictoryAuthor = runIndependent(["review", "--independent-of", "anthropic", "--independent-of-model", "github-copilot/claude-sonnet-5"]);
  assert.equal(contradictoryAuthor.status, 3);
  assert.match(contradictoryAuthor.stderr, /contradicts --independent-of-model/);

  const reviewOfClaude = passIndependent(["review", "--independent-of", "anthropic"]);
  assert.equal(reviewOfClaude.modelBinding.model, "gpt-6-sol");
  assert.equal(reviewOfClaude.modelBinding.independence.selectedFamily, "openai");

  assert.equal(reviewOfClaude.modelBinding.effort, "xhigh", "review of Anthropic work never drops to the light tier");

  const missingIndependence = runIndependent(["review"]);
  assert.equal(missingIndependence.status, 3);
  assert.match(missingIndependence.stderr, /requires --independent-of/);

  const ordinaryExclusion = spawnSync(process.execPath, [resolver, "routine", "--exclude-family", "anthropic", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(ordinaryExclusion.status, 3);
  assert.match(ordinaryExclusion.stderr, /does not use.*exclude-family/i);

  const catalogWithoutGrokPath = path.join(temp, "catalog-without-grok.txt");
  fs.writeFileSync(catalogWithoutGrokPath, catalog.split("\n").filter((line) => !line.startsWith("github-copilot grok-4.7 ")).join("\n"));
  const missingSelectedModel = runIndependent(["review", "--independent-of", "openai", "--exclude-family", "anthropic"], { catalog: catalogWithoutGrokPath });
  assert.equal(missingSelectedModel.status, 3);
  assert.match(missingSelectedModel.stderr, /github-copilot\/grok-4\.7.*unavailable/i);

  const exhaustedCopilotPath = path.join(temp, "quota-exhausted-copilot.json");
  const exhaustedCopilot = structuredClone(quota);
  exhaustedCopilot.providers.find((provider) => provider.provider === "copilot").windows[0].percentRemaining = 0;
  fs.writeFileSync(exhaustedCopilotPath, JSON.stringify(exhaustedCopilot));
  const selectedQuotaExhausted = runIndependent(["review", "--independent-of", "openai", "--exclude-family", "anthropic"], { quota: exhaustedCopilotPath });
  assert.equal(selectedQuotaExhausted.status, 3);
  assert.match(selectedQuotaExhausted.stderr, /quota exhausted.*copilot/i);

  const unsupportedGrokPath = path.join(temp, "models-unsupported-grok.json");
  const unsupportedGrok = JSON.parse(fs.readFileSync(modelMetadataPath, "utf8"));
  unsupportedGrok["github-copilot"].models.find((model) => model.id === "grok-4.7").thinkingLevelMap.xhigh = null;
  fs.writeFileSync(unsupportedGrokPath, JSON.stringify(unsupportedGrok));
  const selectedEffortUnsupported = runIndependent(["review", "--independent-of", "openai", "--exclude-family", "anthropic"], { metadata: unsupportedGrokPath });
  assert.equal(selectedEffortUnsupported.status, 3);
  assert.match(selectedEffortUnsupported.stderr, /does not support Model Effort 'xhigh'/);

  quota.providers[0].windows[0].percentRemaining = 0;
  quota.providers[0].state = {
    status: "stale",
    stale: true,
    refreshedAt: "earlier",
    error: "Claude sign-in required",
  };
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const stale = JSON.parse(execFileSync(process.execPath, [resolver, "coordination", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(stale.status, "pass");
  assert.equal(stale.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(stale.modelBinding.quotaSnapshot.telemetryStatus, "stale");
  assert.equal(stale.modelBinding.quotaSnapshot.error, "Claude sign-in required");
  assert.equal(stale.modelBinding.quotaSnapshot.relevantWindows.length, 1);

  quota.providers = quota.providers.filter((provider) => provider.provider !== "claude");
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const unavailable = JSON.parse(execFileSync(process.execPath, [resolver, "coordination", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(unavailable.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(unavailable.modelBinding.quotaSnapshot.telemetryStatus, "unavailable");
  assert.match(unavailable.modelBinding.quotaSnapshot.error, /absent/);

  fs.writeFileSync(quotaPath, "not-json");
  const unreadable = JSON.parse(execFileSync(process.execPath, [resolver, "coordination", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(unreadable.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(unreadable.modelBinding.quotaSnapshot.telemetryStatus, "unavailable");
  assert.match(unreadable.modelBinding.quotaSnapshot.error, /invalid quota JSON/);

  const missing = JSON.parse(execFileSync(process.execPath, [resolver, "routine", "--quota", path.join(temp, "missing.json"), "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(missing.modelBinding.admission, "degraded-quota-telemetry");
  assert.match(missing.modelBinding.quotaSnapshot.error, /quota snapshot unavailable/);

  const fakeBin = path.join(temp, "bin");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, "quota-axi"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(quota))});\nprocess.exit(1);\n`, { mode: 0o755 });
  const salvaged = JSON.parse(execFileSync(process.execPath, [resolver, "coordination", "--catalog", catalogPath], {
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
  // Exhausted Claude quota moves coordination to its tier partner, never to another tier.
  const partner = JSON.parse(execFileSync(process.execPath, [resolver, "coordination", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(partner.modelBinding.model, "gpt-6-sol");
  assert.equal(partner.modelBinding.effort, "medium");
  assert.equal(partner.modelBinding.fallback.from, "anthropic/claude-opus-5-5");
  assert.match(partner.modelBinding.fallback.reason, /quota exhausted for 'claude'/);
  const pinned = spawnSync(process.execPath, [resolver, "coordination", "--model", "anthropic/claude-opus-5-5", "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(pinned.status, 3, "an explicit model has no fallback");
  assert.match(pinned.stderr, /quota exhausted/);
  const reviewOfSol = spawnSync(process.execPath, [resolver, "review", "--independent-of-model", "openai-codex/gpt-6-sol", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(reviewOfSol.status, 0, "review falls back to the third family, never to the author's family");
  assert.equal(JSON.parse(reviewOfSol.stdout).modelBinding.model, "grok-4.7");
  const bothExhaustedPath = path.join(temp, "quota-both-exhausted.json");
  const bothExhausted = structuredClone(quota);
  bothExhausted.providers.find((provider) => provider.provider === "codex").windows[0].percentRemaining = 0;
  fs.writeFileSync(bothExhaustedPath, JSON.stringify(bothExhausted));
  const noPartner = spawnSync(process.execPath, [resolver, "coordination", "--quota", bothExhaustedPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(noPartner.status, 3, "with both tier models exhausted, routing blocks instead of changing tier");
  assert.match(noPartner.stderr, /claude-opus-5-5: quota exhausted.*gpt-6-sol: quota exhausted/);

  quota.providers[0].windows[0].percentRemaining = 70;
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  fs.writeFileSync(catalogPath, "openai-codex gpt-6-sol");
  const absent = spawnSync(process.execPath, [resolver, "routine", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(absent.status, 3);
  assert.match(absent.stderr, /Pi model .* unavailable/);

  fs.writeFileSync(catalogPath, catalog);
  fs.writeFileSync(path.join(fakeBin, "quota-axi"), `#!/usr/bin/env node\nsetTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(quota))}), 1000);\n`, { mode: 0o755 });
  const slowQuota = JSON.parse(execFileSync(process.execPath, [resolver, "routine", "--catalog", catalogPath], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`, PI_WORKBENCH_QUOTA_CACHE: path.join(temp, "slow-quota-cache.json"), PI_WORKBENCH_ROUTING_TIMEOUT_MS: "20" },
  }));
  assert.equal(slowQuota.modelBinding.admission, "degraded-quota-telemetry");
  assert.match(slowQuota.modelBinding.quotaSnapshot.error, /timed out|ETIMEDOUT/i);

  fs.writeFileSync(path.join(fakeBin, "pi"), "#!/usr/bin/env node\nsetTimeout(() => process.stdout.write('anthropic claude-sonnet-5\\n'), 1000);\n", { mode: 0o755 });
  // Without --catalog the model list comes from Pi's model store; a slow `pi` is never started.
  const storeEnv = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`, PI_WORKBENCH_ROUTING_TIMEOUT_MS: "20", PI_CODING_AGENT_DIR: temp };
  const fromStore = spawnSync(process.execPath, [resolver, "routine", "--quota", quotaPath], { encoding: "utf8", env: storeEnv });
  assert.equal(fromStore.status, 0, fromStore.stderr);
  assert.equal(JSON.parse(fromStore.stdout).modelBinding.model, "gpt-6-luna");
  const missingStore = spawnSync(process.execPath, [resolver, "routine", "--quota", quotaPath], { encoding: "utf8", env: { ...storeEnv, PI_CODING_AGENT_DIR: path.join(temp, "missing") } });
  assert.equal(missingStore.status, 3);
  assert.match(missingStore.stderr, /model catalog unavailable/i);

  const cachePath = path.join(temp, "quota-cache.json");
  const callCountPath = path.join(temp, "quota-call-count");
  fs.writeFileSync(path.join(fakeBin, "quota-axi"), `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst countPath = ${JSON.stringify(callCountPath)};\nconst count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : "0") + 1;\nfs.writeFileSync(countPath, String(count));\nprocess.stdout.write(${JSON.stringify(JSON.stringify(quota))});\n`, { mode: 0o755 });
  fs.writeFileSync(catalogPath, catalog);
  const cachedEnv = {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    PI_WORKBENCH_QUOTA_CACHE: cachePath,
  };
  execFileSync(process.execPath, [resolver, "routine", "--catalog", catalogPath], { encoding: "utf8", env: cachedEnv });
  execFileSync(process.execPath, [resolver, "routine", "--catalog", catalogPath], { encoding: "utf8", env: cachedEnv });
  assert.equal(fs.readFileSync(callCountPath, "utf8"), "1", "quota-axi should run at most once inside the ten-minute cache window");
  const expiredCache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  expiredCache.checkedAt -= 10 * 60 * 1000;
  fs.writeFileSync(cachePath, JSON.stringify(expiredCache));
  execFileSync(process.execPath, [resolver, "routine", "--catalog", catalogPath], { encoding: "utf8", env: cachedEnv });
  assert.equal(fs.readFileSync(callCountPath, "utf8"), "2", "the first resolution at the ten-minute boundary should refresh quota telemetry");

  // Run-scoped routing overlay: sole activation variable, fail-closed, distinct-model independence.
  const overlayPath = path.join(here, "..", "references", "anthropic-opus-sonnet-overlay.json");
  const overlaySha = createHash("sha256").update(fs.readFileSync(overlayPath)).digest("hex");
  const withOverlay = (value) => ({ ...process.env, PI_WORKBENCH_ROUTING_OVERLAY: value });
  const runOverlay = (args, value = overlayPath) => spawnSync(process.execPath, [resolver, ...args, "--model-metadata", modelMetadataPath, "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8", env: withOverlay(value) });
  const passOverlay = (args, value = overlayPath) => {
    const run = runOverlay(args, value);
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };

  for (const [role, model] of [["routine", "claude-sonnet-5"], ["implementation", "claude-sonnet-5"], ["frontier", "claude-opus-5-5"], ["coordination", "claude-opus-5-5"]]) {
    const resolved = passOverlay([role]);
    assert.equal(resolved.modelBinding.provider, "anthropic", role);
    assert.equal(resolved.modelBinding.model, model, role);
    assert.equal(resolved.modelBinding.routingOverlay.sha256, overlaySha, role);
    assert.equal(resolved.modelBinding.routingOverlay.path, overlayPath, role);
  }

  const allowedOverride = passOverlay(["coordination", "--model", "anthropic/claude-sonnet-5"]);
  assert.equal(allowedOverride.modelBinding.model, "claude-sonnet-5");
  assert.equal(allowedOverride.modelBinding.effort, "high");
  const outsideOverlay = runOverlay(["coordination", "--model", "openai-codex/gpt-6-astra"]);
  assert.equal(outsideOverlay.status, 3);
  assert.match(outsideOverlay.stderr, /outside the active routing overlay/i);

  const openAiOverlayPath = path.join(temp, "openai-overlay.json");
  fs.writeFileSync(openAiOverlayPath, JSON.stringify({
    version: 1,
    allowedModels: [{ provider: "openai", model: "gpt-5.6-sol" }, { provider: "openai", model: "gpt-6-astra" }],
    roles: { coordination: { provider: "openai", model: "gpt-5.6-sol", effort: "high", quotaProvider: "codex" } },
    independentReview: {
      "openai/gpt-5.6-sol": { provider: "openai", model: "gpt-6-astra", effort: "high", quotaProvider: "codex" },
      "openai/gpt-6-astra": { provider: "openai", model: "gpt-5.6-sol", effort: "high", quotaProvider: "codex" },
    },
  }));
  const sameProviderOverride = passOverlay(["coordination", "--model", "openai/gpt-6-astra"], openAiOverlayPath);
  assert.equal(sameProviderOverride.modelBinding.admission, "fresh-quota");
  assert.equal(sameProviderOverride.modelBinding.quotaSnapshot.relevantWindows[0].id, "seven_day", "same-provider overlay override retains its declared quota provider");

  const sonnetAuthored = passOverlay(["review", "--independent-of-model", "anthropic/claude-sonnet-5"]);
  assert.equal(sonnetAuthored.modelBinding.model, "claude-opus-5-5");
  assert.deepEqual(sonnetAuthored.modelBinding.independence, {
    kind: "fresh-context-distinct-model",
    authorProvider: "anthropic", authorModel: "claude-sonnet-5",
    selectedProvider: "anthropic", selectedModel: "claude-opus-5-5",
  });
  assert.equal(passOverlay(["review", "--independent-of-model", "anthropic/claude-opus-5-5"]).modelBinding.model, "claude-sonnet-5");

  const overlayBlocks = [
    [["review", "--independent-of", "openai-codex"], /requires --independent-of-model/, "cross-family independence is not available under the overlay"],
    [["review", "--independent-of-model", "anthropic/claude-sonnet-5", "--exclude-family", "openai"], /exclude-family.*distinct-model.*overlay/i, "family exclusions are unavailable under the distinct-model overlay"],
    [["review", "--independent-of-model", "anthropic/claude-fable-5-1"], /no independent binding for author model/, "an unmapped author model fails closed"],
    [["routine", "--independent-of-model", "anthropic/claude-opus-5-5"], /does not use an independence constraint/, "a non-independent role rejects an author model"],
  ];
  for (const [args, pattern, message] of overlayBlocks) {
    const run = runOverlay(args);
    assert.equal(run.status, 3, message);
    assert.match(run.stderr, pattern, message);
  }

  const unrelatedExactModel = spawnSync(process.execPath, [resolver, "routine", "--independent-of-model", "anthropic/claude-opus-5-5", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(unrelatedExactModel.status, 3, "a non-independent role rejects an author model without an overlay");
  assert.match(unrelatedExactModel.stderr, /does not use an independence constraint/);

  const badOverlay = (contents, pattern, message) => {
    const file = path.join(temp, `overlay-${createHash("sha256").update(String(contents)).digest("hex").slice(0, 8)}.json`);
    fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
    const run = runOverlay(["routine"], file);
    assert.equal(run.status, 3, message);
    assert.match(run.stderr, pattern, message);
  };
  const valid = JSON.parse(fs.readFileSync(overlayPath, "utf8"));
  const absentOverlay = runOverlay(["routine"], path.join(temp, "absent-overlay.json"));
  assert.equal(absentOverlay.status, 3, "a missing overlay fails closed");
  assert.match(absentOverlay.stderr, /unreadable/i);
  const relative = spawnSync(process.execPath, [resolver, "routine", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8", env: withOverlay("references/anthropic-opus-sonnet-overlay.json") });
  assert.equal(relative.status, 3, "a relative overlay path fails closed");
  assert.match(relative.stderr, /must be an absolute path/);
  badOverlay("{not json", /not valid JSON/, "invalid JSON fails closed");
  badOverlay({ ...valid, version: 2 }, /version must be 1/, "an unknown overlay version fails closed");
  badOverlay({ ...valid, allowedModels: [] }, /at least one allowed model/, "an empty allowlist fails closed");
  badOverlay({ ...valid, roles: { ...valid.roles, routine: { provider: "openai-codex", model: "gpt-6-sol", effort: "medium", quotaProvider: "codex" } } }, /resolves outside its own allowlist/, "a role outside the allowlist fails closed");
  badOverlay({ ...valid, roles: { ...valid.roles, "not-a-role": valid.roles.routine } }, /unknown cognitive role/, "an unknown mapped role fails closed");

  // An unmapped role fails closed rather than falling back to the default openai-codex binding.
  const withoutRoutine = path.join(temp, "overlay-without-routine.json");
  const { routine: _dropped, ...remainingRoles } = valid.roles;
  fs.writeFileSync(withoutRoutine, JSON.stringify({ ...valid, roles: remainingRoles }));
  const unmapped = runOverlay(["routine"], withoutRoutine);
  assert.equal(unmapped.status, 3, "an unmapped role fails closed instead of using default routing");
  assert.match(unmapped.stderr, /does not map cognitive role/);
  assert.equal(passOverlay(["frontier"], withoutRoutine).modelBinding.model, "claude-opus-5-5", "every mapped role stays inside the two-model allowlist");
  badOverlay({ ...valid, independentReview: { "anthropic/claude-opus-5-5": { provider: "anthropic", model: "claude-opus-5-5", effort: "high", quotaProvider: "claude" } } }, /not a distinct model/, "same-model review mapping fails closed");

  console.log("resolve-runtime-binding: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
