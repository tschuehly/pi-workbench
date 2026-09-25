#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCachedQuotaSnapshot } from "./quota-snapshot-cache.mjs";
import { knownModelFamilies, modelFamily } from "../../../packages/pi-execution-adapter/src/model-family.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(here, "..", "references", "routing-policy.json"), "utf8"));
const MODEL_EFFORTS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const HELP = `usage: resolve-runtime-binding.mjs <cognitive-role> [--model <provider>/<model>] [--effort <level>]
  [--independent-of <provider> | --independent-of-model <provider>/<model>] [--exclude-family <family>]...
  [--quota <path|->] [--catalog <path>] [--model-metadata <path>] [--format json|env]

Roles (references/routing-policy.json): ${Object.entries(policy.roles).map(([r, p]) => `${r}=${p.tier}:${p.effort}`).join(", ")}
Tiers, default first: ${Object.entries(policy.tiers).map(([t, m]) => `${t}=${m.join("/")}`).join(", ")}; reserve=${policy.reserve.join("/")} (only by --model)

- The role's tier supplies the default model. When it is unavailable, lacks the effort, or has fresh
  exhausted quota, the other model of the same tier runs and the receipt records the fallback.
  Routing never moves to another tier; with both tier models unavailable it blocks.
- review: needs the author (--independent-of-model, or --independent-of). It selects the tier model
  of the other family, then the third family; --model is allowed when its family differs.
- --effort may not go below a role's minEffort (frontier and review: xhigh).
- --model selects one exact model with no fallback; the reserve tier is reachable only this way.
- PI_WORKBENCH_ROUTING_OVERLAY=<abs path> narrows routing to an allowlist; see references/*-overlay.json.
Exit: 0 pass (JSON or env on stdout), 1 unknown role, 2 usage, 3 ROUTING=BLOCKED with REASON.`;

function usage() {
  console.error(HELP);
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
    if (policy.roles[mappedRole] === undefined) block(role, `Routing overlay maps unknown cognitive role '${mappedRole}'`);
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

// Returns a reason when the model cannot run at this effort, or undefined when it can. Without
// readable metadata, only explicitly requested models or efforts fail closed.
const defaultMetadataPath = () => path.join(process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"), "models-store.json");

function effortProblem(binding, metadataInput, explicit) {
  const metadataPath = metadataInput ?? defaultMetadataPath();
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    return explicit ? `Pi model metadata is unavailable: ${error.message}` : undefined;
  }
  const model = doc?.[binding.provider]?.models?.find((candidate) => candidate.id === binding.model);
  if (model === undefined) return explicit ? `Pi model metadata has no entry for '${modelKey(binding)}'` : undefined;
  const levelMap = isPlainObject(model.thinkingLevelMap) ? model.thinkingLevelMap : {};
  // Pi exposes only off for non-reasoning models, maps absent standard reasoning levels normally,
  // and requires xhigh/max to be explicitly mapped.
  const supported = model.reasoning !== true
    ? binding.effort === "off"
    : Object.hasOwn(levelMap, binding.effort)
      ? levelMap[binding.effort] !== null
      : binding.effort !== "xhigh" && binding.effort !== "max";
  return supported ? undefined : `Pi model '${modelKey(binding)}' does not support Model Effort '${binding.effort}'`;
}

const args = process.argv.slice(2);
if (args[0] === "--help" || args[0] === "-h") { console.log(HELP); process.exit(0); }
const role = args.shift();
if (!role) usage();
let modelOverride;
let effortOverride;
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
  else if (option === "--effort") effortOverride = args.shift();
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
    (effortOverride === undefined && process.argv.includes("--effort")) ||
    (independentOfProvider === undefined && process.argv.includes("--independent-of")) ||
    (independentOfModel === undefined && process.argv.includes("--independent-of-model")) ||
    (quotaInput === undefined && process.argv.includes("--quota")) ||
    (catalogInput === undefined && process.argv.includes("--catalog")) ||
    (modelMetadataInput === undefined && process.argv.includes("--model-metadata")) ||
    !["json", "env"].includes(format)) usage();

console.error("STAGE=policy");
const rolePolicy = policy.roles[role];
if (!rolePolicy) {
  console.error(`Unknown cognitive role: ${role}`);
  console.error(`Valid roles: ${Object.keys(policy.roles).join(", ")}`);
  process.exit(1);
}
if (effortOverride !== undefined && !MODEL_EFFORTS.has(effortOverride)) {
  block(role, `--effort must be one of ${[...MODEL_EFFORTS].join(", ")}, got '${effortOverride}'`);
}
const effortRank = [...MODEL_EFFORTS];
if (effortOverride !== undefined && rolePolicy.minEffort !== undefined && effortRank.indexOf(effortOverride) < effortRank.indexOf(rolePolicy.minEffort)) {
  block(role, `Role '${role}' needs at least Model Effort '${rolePolicy.minEffort}', got '${effortOverride}'`);
}
const effort = effortOverride ?? rolePolicy.effort;

const knownFamilySet = new Set(knownModelFamilies);
for (const family of excludedFamilies) {
  if (!knownFamilySet.has(family)) block(role, `Unknown model family '${family}' in --exclude-family`);
}
const uniqueExcludedFamilies = [...new Set(excludedFamilies)];
const independent = rolePolicy.independent === true;
if (!independent && (independentOfProvider !== undefined || independentOfModel !== undefined)) block(role, `Role '${role}' does not use an independence constraint`);
if (!independent && uniqueExcludedFamilies.length > 0) block(role, `Role '${role}' does not use --exclude-family`);

const named = (key) => {
  const entry = policy.models[key];
  if (entry === undefined) block(role, `Routing policy names unknown model '${key}'`);
  return { ...entry, effort };
};
const familyOf = (binding) => {
  const family = modelFamily(binding.provider, binding.model);
  if (family === undefined) block(role, `Cannot determine the model family for '${modelKey(binding)}'`);
  return family;
};
const overrideBinding = (base) => {
  const requested = parseQualifiedModel(role, modelOverride, "--model");
  const quotaProvider = requested.provider === base?.provider ? base.quotaProvider : policy.quotaProviders?.[requested.provider];
  if (quotaProvider === undefined) block(role, `Provider '${requested.provider}' has no quota provider mapping for model overrides`);
  return { provider: requested.provider, model: requested.model, quotaProvider, effort: effortOverride ?? base?.effort ?? effort };
};

// Candidates in preference order. Only the first is the role's choice; later ones are fallbacks.
const overlay = loadRoutingOverlay(role);
let candidates;
let independence;
if (overlay !== undefined) {
  if (modelOverride !== undefined && !overlay.allowed.has(modelOverride)) block(role, `Model '${modelOverride}' is outside the active routing overlay`);
  if (!independent) {
    const target = overlay.doc.roles[role];
    if (target === undefined) block(role, `Routing overlay does not map cognitive role '${role}'`);
    candidates = [modelOverride !== undefined ? overrideBinding(target) : { ...target, ...(effortOverride === undefined ? {} : { effort }) }];
  } else {
    // Independence under the overlay is distinct-model, not cross-family: a single-provider run
    // still gets a fresh child on a different model than the one that authored the bytes.
    if (uniqueExcludedFamilies.length > 0) block(role, `--exclude-family is unavailable under a distinct-model routing overlay`);
    if (independentOfModel === undefined) block(role, `Role '${role}' requires --independent-of-model <provider>/<model> while a routing overlay is active`);
    const { provider: authorProvider, model: authorModel } = parseQualifiedModel(role, independentOfModel);
    if (independentOfProvider !== undefined && independentOfProvider !== authorProvider) {
      block(role, `--independent-of '${independentOfProvider}' contradicts --independent-of-model '${independentOfModel}'`);
    }
    const target = modelOverride !== undefined ? overrideBinding() : overlay.doc.independentReview[independentOfModel];
    if (target === undefined) block(role, `Routing overlay has no independent binding for author model '${independentOfModel}'`);
    if (modelKey(target) === independentOfModel) block(role, `Model '${modelOverride}' authored the work under review`);
    candidates = [{ ...target, ...(effortOverride === undefined ? {} : { effort }) }];
    independence = { kind: "fresh-context-distinct-model", authorProvider, authorModel, selectedProvider: target.provider, selectedModel: target.model };
  }
} else if (independent) {
  let authorModel;
  if (independentOfModel !== undefined) {
    const author = parseQualifiedModel(role, independentOfModel);
    if (independentOfProvider !== undefined && independentOfProvider !== author.provider) {
      block(role, `--independent-of '${independentOfProvider}' contradicts --independent-of-model '${independentOfModel}'`);
    }
    independentOfProvider = author.provider;
    authorModel = author.model;
  }
  if (independentOfProvider === undefined) block(role, `Role '${role}' requires --independent-of <provider> or --independent-of-model <provider>/<model>`);
  if (independentOfProvider === "github-copilot" && authorModel === undefined) {
    block(role, `--independent-of github-copilot requires --independent-of-model with the exact model`);
  }
  const independentOfFamily = modelFamily(independentOfProvider, authorModel);
  if (independentOfFamily === undefined) block(role, `Cannot determine the model family for author '${independentOfModel ?? independentOfProvider}'`);
  const eligible = (binding) => familyOf(binding) !== independentOfFamily && !uniqueExcludedFamilies.includes(familyOf(binding));
  if (modelOverride !== undefined) {
    const requested = overrideBinding();
    if (!eligible(requested)) block(role, `Model '${modelOverride}' is not independent of author family '${independentOfFamily}'${uniqueExcludedFamilies.length ? ` or excluded families ${uniqueExcludedFamilies.join(", ")}` : ""}`);
    candidates = [requested];
  } else {
    const keys = [...policy.tiers[rolePolicy.tier], ...(rolePolicy.thirdFamily ? [rolePolicy.thirdFamily] : [])];
    candidates = keys.map(named).filter(eligible);
    if (candidates.length === 0) block(role, `No independent candidate remains for author family '${independentOfFamily}' after exclusions`);
  }
  independence = {
    independentOfProvider,
    independentOfFamily,
    ...(independentOfModel === undefined ? {} : { independentOfModel }),
    ...(uniqueExcludedFamilies.length === 0 ? {} : { excludedFamilies: uniqueExcludedFamilies }),
  };
} else {
  candidates = modelOverride !== undefined ? [overrideBinding()] : policy.tiers[rolePolicy.tier].map(named);
}

console.error("STAGE=quota");
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

console.error("STAGE=catalog");
let rawCatalog;
try {
  // Pi's own model store lists the same models as `pi --list-models` without starting Pi, which
  // loads every extension and can exceed the routing timeout on a busy host.
  rawCatalog = catalogInput
    ? fs.readFileSync(catalogInput, "utf8")
    : Object.entries(JSON.parse(fs.readFileSync(modelMetadataInput ?? defaultMetadataPath(), "utf8")))
      .flatMap(([provider, entry]) => (Array.isArray(entry?.models) ? entry.models : []).map((model) => `${provider} ${model.id}`))
      .join("\n");
} catch (error) {
  block(role, `Pi model catalog unavailable: ${error.message}`);
}
const availableModels = new Set(rawCatalog.split(/\r?\n/).map((line) => {
  const [provider, model] = line.trim().split(/\s+/);
  return provider && model ? `${provider}/${model}` : "";
}).filter(Boolean));

const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
function admit(binding) {
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
      ?? (provider === undefined ? `quota provider '${binding.quotaProvider}' is absent` : `quota provider '${binding.quotaProvider}' is ${telemetryStatus}`);
  let reason;
  if (!availableModels.has(modelKey(binding))) reason = `Pi model '${modelKey(binding)}' is unavailable`;
  else reason = effortProblem(binding, modelMetadataInput, modelOverride !== undefined || effortOverride !== undefined);
  if (reason === undefined && telemetryStatus === "fresh" && relevantWindows.some((window) => Number(window.percentRemaining) <= 0)) {
    reason = `quota exhausted for '${binding.quotaProvider}'`;
  }
  return { binding, reason, provider, relevantWindows, telemetryStatus, telemetryError };
}

const attempts = [];
let chosen;
for (const candidate of candidates) {
  const attempt = admit(candidate);
  attempts.push(attempt);
  if (attempt.reason === undefined) { chosen = attempt; break; }
}
if (chosen === undefined) block(role, attempts.map((a) => `${modelKey(a.binding)}: ${a.reason}`).join("; "));
const binding = chosen.binding;
const fallback = attempts.length > 1
  ? { from: modelKey(attempts[0].binding), reason: attempts[0].reason, skipped: attempts.slice(0, -1).map((a) => ({ model: modelKey(a.binding), reason: a.reason })) }
  : undefined;
if (independence !== undefined && independence.kind === undefined) independence.selectedFamily = familyOf(binding);

const result = {
  status: "pass",
  modelBinding: {
    cognitiveRole: role,
    provider: binding.provider,
    model: binding.model,
    effort: binding.effort,
    ...(modelOverride === undefined && overlay === undefined ? { tier: rolePolicy.tier } : {}),
    ...(fallback === undefined ? {} : { fallback }),
    ...(independence === undefined ? {} : { independence }),
    ...(modelOverride === undefined ? {} : { modelOverride }),
    ...(effortOverride === undefined ? {} : { effortOverride }),
    ...(overlay === undefined ? {} : { routingOverlay: { path: overlay.path, sha256: overlay.sha256 } }),
    admission: chosen.telemetryStatus === "fresh" ? "fresh-quota" : "degraded-quota-telemetry",
    quotaSnapshot: {
      generatedAt: snapshot?.generatedAt ?? null,
      telemetryStatus: chosen.telemetryStatus,
      relevantWindows: chosen.relevantWindows.map((window) => ({
        id: window.id,
        kind: window.kind,
        windowSeconds: window.windowSeconds ?? null,
        resetsAt: window.resetsAt ?? null,
        percentRemaining: window.percentRemaining,
      })),
      stale: chosen.telemetryStatus === "stale",
      refreshedAt: chosen.provider?.state?.refreshedAt ?? null,
      error: chosen.telemetryError,
    },
  },
};

if (format === "env") {
  console.log("ROUTING=PASS");
  console.log(`COGNITIVE_ROLE=${role}`);
  console.log(`PI_PROVIDER=${binding.provider}`);
  console.log(`PI_MODEL=${binding.model}`);
  console.log(`PI_THINKING=${binding.effort}`);
  if (fallback !== undefined) console.log(`ROUTING_FALLBACK_FROM=${fallback.from}`);
  if (independence?.independentOfProvider !== undefined) console.log(`INDEPENDENT_OF_PROVIDER=${independence.independentOfProvider}`);
  if (independence?.independentOfModel !== undefined) console.log(`INDEPENDENT_OF_MODEL=${independence.independentOfModel}`);
  else if (independence?.authorModel !== undefined) console.log(`INDEPENDENT_OF_MODEL=${independence.authorProvider}/${independence.authorModel}`);
  if (overlay !== undefined) console.log(`ROUTING_OVERLAY_SHA256=${overlay.sha256}`);
  console.log(`QUOTA_ADMISSION=${result.modelBinding.admission}`);
  console.log(`QUOTA_TELEMETRY_STATUS=${chosen.telemetryStatus}`);
  console.log(`QUOTA_GENERATED_AT=${snapshot?.generatedAt ?? ""}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
