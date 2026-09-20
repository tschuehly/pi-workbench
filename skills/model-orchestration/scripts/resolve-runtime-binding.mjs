#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCachedQuotaSnapshot } from "./quota-snapshot-cache.mjs";
import { knownModelFamilies, modelFamily } from "../../../packages/pi-execution-adapter/src/model-family.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(here, "..", "references", "routing-policy.json"), "utf8"));
const ROUTING_COMMAND_TIMEOUT_MS = positiveTimeout(process.env.PI_WORKBENCH_ROUTING_TIMEOUT_MS, 15_000);

function usage() {
  console.error("usage: resolve-runtime-binding.mjs <cognitive-role> [--model <provider>/<model>] [--independent-of <provider>] [--independent-of-model <provider>/<model>] [--exclude-family <family>]... [--quota <path|->] [--catalog <path>] [--model-metadata <path>] [--format json|env]");
  process.exit(2);
}

function block(role, reason) {
  console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=${reason}`);
  process.exit(3);
}

function parseQualifiedModel(role, value, option = "--independent-of-model") {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) block(role, `${option} must be '<provider>/<model>', got '${value}'`);
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

// A run-scoped overlay narrows routing to one explicit allowlist. It is the sole activation
// variable, and any missing, unreadable, or invalid byte fails closed rather than silently
// falling back to the default policy.
function loadRoutingOverlay(role) {
  const overlayPath = process.env.PI_WORKBENCH_ROUTING_OVERLAY;
  if (overlayPath === undefined || overlayPath === "") return undefined;
  if (!path.isAbsolute(overlayPath)) block(role, `PI_WORKBENCH_ROUTING_OVERLAY must be an absolute path, got '${overlayPath}'`);
  let raw;
  try {
    raw = fs.readFileSync(overlayPath, "utf8");
  } catch (error) {
    block(role, `Routing overlay is unreadable: ${error.message}`);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    block(role, `Routing overlay is not valid JSON: ${error.message}`);
  }
  if (doc?.version !== 1) block(role, `Routing overlay version must be 1, got ${JSON.stringify(doc?.version)}`);
  if (!Array.isArray(doc.allowedModels) || doc.allowedModels.length === 0) block(role, "Routing overlay must list at least one allowed model");
  const allowed = new Set();
  for (const entry of doc.allowedModels) {
    if (!isPlainObject(entry) || typeof entry.provider !== "string" || typeof entry.model !== "string" || entry.provider === "" || entry.model === "") {
      block(role, "Every routing overlay allowedModels entry needs a provider and a model");
    }
    allowed.add(modelKey(entry));
  }
  if (!isPlainObject(doc.roles) || Object.keys(doc.roles).length === 0) block(role, "Routing overlay must map at least one cognitive role");
  for (const [mappedRole, target] of Object.entries(doc.roles)) {
    if (policy.bindings[mappedRole] === undefined) block(role, `Routing overlay maps unknown cognitive role '${mappedRole}'`);
    if (!isBinding(target)) block(role, `Routing overlay role '${mappedRole}' needs provider, model, effort, and quotaProvider`);
    if (!allowed.has(modelKey(target))) block(role, `Routing overlay role '${mappedRole}' resolves outside its own allowlist`);
  }
  if (!isPlainObject(doc.independentReview) || Object.keys(doc.independentReview).length === 0) block(role, "Routing overlay must map at least one independent-review author model");
  for (const [authorKey, target] of Object.entries(doc.independentReview)) {
    if (!allowed.has(authorKey)) block(role, `Routing overlay independentReview author '${authorKey}' is outside its own allowlist`);
    if (!isBinding(target)) block(role, `Routing overlay independentReview '${authorKey}' needs provider, model, effort, and quotaProvider`);
    if (!allowed.has(modelKey(target))) block(role, `Routing overlay independentReview '${authorKey}' resolves outside its own allowlist`);
    if (modelKey(target) === authorKey) block(role, `Routing overlay independentReview '${authorKey}' is not a distinct model`);
  }
  return { path: overlayPath, sha256: createHash("sha256").update(raw).digest("hex"), doc, allowed };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBinding(value) {
  return isPlainObject(value) && ["provider", "model", "effort", "quotaProvider"].every((field) => typeof value[field] === "string" && value[field] !== "");
}

function modelKey(binding) {
  return `${binding.provider}/${binding.model}`;
}

function validateModelEffort(role, binding, metadataInput) {
  const metadataPath = metadataInput ?? path.join(process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"), "models-store.json");
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    block(role, `Pi model metadata is unavailable: ${error.message}`);
  }
  const model = doc?.[binding.provider]?.models?.find((candidate) => candidate.id === binding.model);
  if (model === undefined) block(role, `Pi model metadata has no entry for '${modelKey(binding)}'`);
  const levelMap = isPlainObject(model.thinkingLevelMap) ? model.thinkingLevelMap : {};
  // Pi maps absent standard levels normally; absent xhigh/max levels are unsupported.
  const supported = Object.hasOwn(levelMap, binding.effort)
    ? levelMap[binding.effort] !== null
    : model.reasoning === true && binding.effort !== "xhigh" && binding.effort !== "max";
  if (!supported) block(role, `Pi model '${modelKey(binding)}' does not support Model Effort '${binding.effort}'`);
}

const args = process.argv.slice(2);
const role = args.shift();
if (!role) usage();
let modelOverride;
let independentOfProvider;
let independentOfModel;
const excludedFamilies = [];
let quotaInput;
let catalogInput;
let modelMetadataInput;
let format = "json";
while (args.length) {
  const option = args.shift();
  if (option === "--model") modelOverride = args.shift();
  else if (option === "--independent-of") independentOfProvider = args.shift();
  else if (option === "--independent-of-model") independentOfModel = args.shift();
  else if (option === "--exclude-family") {
    const family = args.shift();
    if (family === undefined) usage();
    excludedFamilies.push(family);
  }
  else if (option === "--quota") quotaInput = args.shift();
  else if (option === "--catalog") catalogInput = args.shift();
  else if (option === "--model-metadata") modelMetadataInput = args.shift();
  else if (option === "--format") format = args.shift();
  else usage();
}
if ((modelOverride === undefined && process.argv.includes("--model")) ||
    (independentOfProvider === undefined && process.argv.includes("--independent-of")) ||
    (independentOfModel === undefined && process.argv.includes("--independent-of-model")) ||
    (quotaInput === undefined && process.argv.includes("--quota")) ||
    (catalogInput === undefined && process.argv.includes("--catalog")) ||
    (modelMetadataInput === undefined && process.argv.includes("--model-metadata")) ||
    !["json", "env"].includes(format)) usage();

const rolePolicy = policy.bindings[role];
if (!rolePolicy) {
  console.error(`Unknown cognitive role: ${role}`);
  console.error(`Valid roles: ${Object.keys(policy.bindings).join(", ")}`);
  process.exit(1);
}

const knownFamilySet = new Set(knownModelFamilies);
for (const family of excludedFamilies) {
  if (!knownFamilySet.has(family)) block(role, `Unknown model family '${family}' in --exclude-family`);
}
const uniqueExcludedFamilies = [...new Set(excludedFamilies)];

const overlay = loadRoutingOverlay(role);
let binding = rolePolicy;
let independence;
if (overlay !== undefined) {
  const authorKey = independentOfModel;
  if (rolePolicy.independentBindings === undefined) {
    if (authorKey !== undefined || independentOfProvider !== undefined) block(role, `Role '${role}' does not use an independence constraint`);
    if (uniqueExcludedFamilies.length > 0) block(role, `Role '${role}' does not use --exclude-family`);
    binding = overlay.doc.roles[role];
    if (binding === undefined) block(role, `Routing overlay does not map cognitive role '${role}'`);
  } else {
    // Independence under the overlay is distinct-model, not cross-family: a single-provider run
    // still gets a fresh child on a different model than the one that authored the bytes.
    if (uniqueExcludedFamilies.length > 0) block(role, `--exclude-family is unavailable under a distinct-model routing overlay`);
    if (authorKey === undefined) block(role, `Role '${role}' requires --independent-of-model <provider>/<model> while a routing overlay is active`);
    const { provider: authorProvider, model: authorModel } = parseQualifiedModel(role, authorKey);
    if (independentOfProvider !== undefined && independentOfProvider !== authorProvider) {
      block(role, `--independent-of '${independentOfProvider}' contradicts --independent-of-model '${authorKey}'`);
    }
    binding = overlay.doc.independentReview[authorKey];
    if (binding === undefined) block(role, `Routing overlay has no independent binding for author model '${authorKey}'`);
    independence = { kind: "fresh-context-distinct-model", authorProvider, authorModel, selectedProvider: binding.provider, selectedModel: binding.model };
  }
} else if (rolePolicy.independentBindings !== undefined) {
  let authorModel;
  if (independentOfModel !== undefined) {
    const author = parseQualifiedModel(role, independentOfModel);
    if (independentOfProvider !== undefined && independentOfProvider !== author.provider) {
      block(role, `--independent-of '${independentOfProvider}' contradicts --independent-of-model '${independentOfModel}'`);
    }
    independentOfProvider = author.provider;
    authorModel = author.model;
  }
  if (independentOfProvider === undefined) {
    block(role, `Role '${role}' requires --independent-of <provider> or --independent-of-model <provider>/<model>`);
  }
  if (independentOfProvider === "github-copilot" && authorModel === undefined) {
    block(role, `--independent-of github-copilot requires --independent-of-model with the exact model`);
  }
  const independentOfFamily = modelFamily(independentOfProvider, authorModel);
  if (independentOfFamily === undefined) {
    block(role, `Cannot determine the model family for author '${independentOfModel ?? independentOfProvider}'`);
  }
  const candidates = rolePolicy.independentBindings.map((candidate) => {
    const family = modelFamily(candidate.provider, candidate.model);
    if (family === undefined) block(role, `Cannot determine the model family for configured candidate '${modelKey(candidate)}'`);
    return { binding: candidate, family };
  });
  const selected = candidates.find((candidate) => candidate.family !== independentOfFamily && !uniqueExcludedFamilies.includes(candidate.family));
  if (selected === undefined) {
    block(role, `No independent candidate remains for author family '${independentOfFamily}' after exclusions`);
  }
  binding = selected.binding;
  independence = {
    independentOfProvider,
    independentOfFamily,
    selectedFamily: selected.family,
    ...(independentOfModel === undefined ? {} : { independentOfModel }),
    ...(uniqueExcludedFamilies.length === 0 ? {} : { excludedFamilies: uniqueExcludedFamilies }),
  };
} else if (independentOfProvider !== undefined || independentOfModel !== undefined) {
  block(role, `Role '${role}' does not use an independence constraint`);
} else if (uniqueExcludedFamilies.length > 0) {
  block(role, `Role '${role}' does not use --exclude-family`);
}

if (modelOverride !== undefined) {
  if (rolePolicy.independentBindings !== undefined) block(role, "An independent role cannot use an explicit model override");
  const requested = parseQualifiedModel(role, modelOverride, "--model");
  if (overlay !== undefined && !overlay.allowed.has(modelOverride)) block(role, `Model '${modelOverride}' is outside the active routing overlay`);
  const quotaProvider = requested.provider === binding.provider
    ? binding.quotaProvider
    : policy.quotaProviders?.[requested.provider];
  if (quotaProvider === undefined) block(role, `Provider '${requested.provider}' has no quota provider mapping for model overrides`);
  binding = { ...binding, provider: requested.provider, model: requested.model, quotaProvider };
}

let rawQuota;
let quotaError;
try {
  if (quotaInput === "-") rawQuota = fs.readFileSync(0, "utf8");
  else if (quotaInput) rawQuota = fs.readFileSync(quotaInput, "utf8");
  else {
    const cached = readCachedQuotaSnapshot();
    rawQuota = cached.stdout.trim() !== "" ? cached.stdout : undefined;
    if (cached.status !== 0) quotaError = `quota snapshot unavailable: ${cached.stderr || `quota-axi exited with status ${cached.status}`}`;
  }
} catch (error) {
  rawQuota = typeof error.stdout === "string" && error.stdout.trim() !== "" ? error.stdout : undefined;
  quotaError = `quota snapshot unavailable: ${error.message}`;
}

let snapshot;
if (rawQuota !== undefined) {
  try {
    snapshot = JSON.parse(rawQuota);
  } catch (error) {
    quotaError = `invalid quota JSON: ${error.message}`;
  }
}

let rawCatalog;
try {
  rawCatalog = catalogInput
    ? fs.readFileSync(catalogInput, "utf8")
    : execFileSync("pi", ["--list-models"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: ROUTING_COMMAND_TIMEOUT_MS });
} catch (error) {
  console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=Pi model catalog unavailable: ${error.message}`);
  process.exit(3);
}
const availableModels = new Set(rawCatalog.split(/\r?\n/).map((line) => {
  const [provider, model] = line.trim().split(/\s+/);
  return provider && model ? `${provider}/${model}` : "";
}).filter(Boolean));

if ((modelOverride !== undefined || rolePolicy.independentBindings !== undefined) && availableModels.has(modelKey(binding))) {
  validateModelEffort(role, binding, modelMetadataInput);
}

const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
const provider = providers.find((candidate) => candidate.provider === binding.quotaProvider);
const windows = Array.isArray(provider?.windows) ? provider.windows : [];
const relevantWindows = windows.filter((window) => window.kind !== "model" || binding.model.includes(window.id.replace(/^model:/, "")));
const telemetryStatus = provider === undefined
  ? "unavailable"
  : provider.state?.status === "fresh" && provider.state?.stale !== true
    ? "fresh"
    : provider.state?.status === "stale" || provider.state?.stale === true
      ? "stale"
      : "unavailable";
const telemetryError = telemetryStatus === "fresh"
  ? null
  : provider?.state?.error
    ?? quotaError
    ?? (provider === undefined
      ? `quota provider '${binding.quotaProvider}' is absent`
      : `quota provider '${binding.quotaProvider}' is ${telemetryStatus}`);
let reason;
if (!availableModels.has(`${binding.provider}/${binding.model}`)) reason = `Pi model '${binding.provider}/${binding.model}' is unavailable`;
else if (telemetryStatus === "fresh" && relevantWindows.some((window) => Number(window.percentRemaining) <= 0)) reason = `quota exhausted for '${binding.quotaProvider}'`;

if (reason) {
  console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=${reason}`);
  process.exit(3);
}

const result = {
  status: "pass",
  modelBinding: {
    cognitiveRole: role,
    provider: binding.provider,
    model: binding.model,
    effort: binding.effort,
    ...(independence === undefined ? {} : { independence }),
    ...(modelOverride === undefined ? {} : { modelOverride }),
    ...(overlay === undefined ? {} : { routingOverlay: { path: overlay.path, sha256: overlay.sha256 } }),
    admission: telemetryStatus === "fresh" ? "fresh-quota" : "degraded-quota-telemetry",
    quotaSnapshot: {
      generatedAt: snapshot?.generatedAt ?? null,
      telemetryStatus,
      relevantWindows: relevantWindows.map((window) => ({
        id: window.id,
        kind: window.kind,
        windowSeconds: window.windowSeconds ?? null,
        resetsAt: window.resetsAt ?? null,
        percentRemaining: window.percentRemaining,
      })),
      stale: telemetryStatus === "stale",
      refreshedAt: provider?.state?.refreshedAt ?? null,
      error: telemetryError,
    },
  },
};

function positiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

if (format === "env") {
  console.log("ROUTING=PASS");
  console.log(`COGNITIVE_ROLE=${role}`);
  console.log(`PI_PROVIDER=${binding.provider}`);
  console.log(`PI_MODEL=${binding.model}`);
  console.log(`PI_THINKING=${binding.effort}`);
  if (independence?.independentOfProvider !== undefined) console.log(`INDEPENDENT_OF_PROVIDER=${independence.independentOfProvider}`);
  if (independence?.independentOfModel !== undefined) console.log(`INDEPENDENT_OF_MODEL=${independence.independentOfModel}`);
  else if (independence?.authorModel !== undefined) console.log(`INDEPENDENT_OF_MODEL=${independence.authorProvider}/${independence.authorModel}`);
  if (overlay !== undefined) console.log(`ROUTING_OVERLAY_SHA256=${overlay.sha256}`);
  console.log(`QUOTA_ADMISSION=${result.modelBinding.admission}`);
  console.log(`QUOTA_TELEMETRY_STATUS=${telemetryStatus}`);
  console.log(`QUOTA_GENERATED_AT=${snapshot?.generatedAt ?? ""}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
