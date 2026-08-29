#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCachedQuotaSnapshot } from "./quota-snapshot-cache.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(here, "..", "references", "routing-policy.json"), "utf8"));
const ROUTING_COMMAND_TIMEOUT_MS = positiveTimeout(process.env.PI_WORKBENCH_ROUTING_TIMEOUT_MS, 15_000);

function usage() {
  console.error("usage: resolve-runtime-binding.mjs <cognitive-role> [--independent-of <provider>] [--independent-of-model <provider>/<model>] [--quota <path|->] [--catalog <path>] [--format json|env]");
  process.exit(2);
}

function block(role, reason) {
  console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=${reason}`);
  process.exit(3);
}

function authorFromModel(role, authorKey) {
  const slash = authorKey.indexOf("/");
  if (slash <= 0 || slash === authorKey.length - 1) block(role, `--independent-of-model must be '<provider>/<model>', got '${authorKey}'`);
  return { provider: authorKey.slice(0, slash), model: authorKey.slice(slash + 1) };
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
  return { path: overlayPath, sha256: createHash("sha256").update(raw).digest("hex"), doc };
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

const args = process.argv.slice(2);
const role = args.shift();
if (!role) usage();
let independentOfProvider;
let independentOfModel;
let quotaInput;
let catalogInput;
let format = "json";
while (args.length) {
  const option = args.shift();
  if (option === "--independent-of") independentOfProvider = args.shift();
  else if (option === "--independent-of-model") independentOfModel = args.shift();
  else if (option === "--quota") quotaInput = args.shift();
  else if (option === "--catalog") catalogInput = args.shift();
  else if (option === "--format") format = args.shift();
  else usage();
}
if ((independentOfProvider === undefined && process.argv.includes("--independent-of")) ||
    (independentOfModel === undefined && process.argv.includes("--independent-of-model")) ||
    (quotaInput === undefined && process.argv.includes("--quota")) ||
    (catalogInput === undefined && process.argv.includes("--catalog")) ||
    !["json", "env"].includes(format)) usage();

const rolePolicy = policy.bindings[role];
if (!rolePolicy) {
  console.error(`Unknown cognitive role: ${role}`);
  console.error(`Valid roles: ${Object.keys(policy.bindings).join(", ")}`);
  process.exit(1);
}

const overlay = loadRoutingOverlay(role);
let binding = rolePolicy;
let independence;
if (overlay !== undefined) {
  const authorKey = independentOfModel;
  if (rolePolicy.independentBindings === undefined) {
    if (authorKey !== undefined || independentOfProvider !== undefined) block(role, `Role '${role}' does not use an independence constraint`);
    binding = overlay.doc.roles[role];
    if (binding === undefined) block(role, `Routing overlay does not map cognitive role '${role}'`);
  } else {
    // Independence under the overlay is distinct-model, not cross-family: a single-provider run
    // still gets a fresh child on a different model than the one that authored the bytes.
    if (authorKey === undefined) block(role, `Role '${role}' requires --independent-of-model <provider>/<model> while a routing overlay is active`);
    const { provider: authorProvider, model: authorModel } = authorFromModel(role, authorKey);
    if (independentOfProvider !== undefined && independentOfProvider !== authorProvider) {
      block(role, `--independent-of '${independentOfProvider}' contradicts --independent-of-model '${authorKey}'`);
    }
    binding = overlay.doc.independentReview[authorKey];
    if (binding === undefined) block(role, `Routing overlay has no independent binding for author model '${authorKey}'`);
    independence = { kind: "fresh-context-distinct-model", authorProvider, authorModel, selectedProvider: binding.provider, selectedModel: binding.model };
  }
} else if (rolePolicy.independentBindings !== undefined) {
  if (independentOfModel !== undefined) {
    const { provider: authorProvider } = authorFromModel(role, independentOfModel);
    if (independentOfProvider !== undefined && independentOfProvider !== authorProvider) {
      block(role, `--independent-of '${independentOfProvider}' contradicts --independent-of-model '${independentOfModel}'`);
    }
    independentOfProvider = authorProvider;
  }
  if (independentOfProvider === undefined) {
    console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=Role '${role}' requires --independent-of <provider> or --independent-of-model <provider>/<model>`);
    process.exit(3);
  }
  const independentOfFamily = policy.providerFamilies[independentOfProvider];
  binding = rolePolicy.independentBindings[independentOfFamily];
  if (binding === undefined) {
    console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=No independent binding is configured for provider '${independentOfProvider}'`);
    process.exit(3);
  }
  const selectedFamily = policy.providerFamilies[binding.provider];
  if (selectedFamily === independentOfFamily) {
    console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=Resolved provider family is not independent`);
    process.exit(3);
  }
  independence = { independentOfProvider, independentOfFamily, selectedFamily };
} else if (independentOfProvider !== undefined || independentOfModel !== undefined) {
  console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=Role '${role}' does not use an independence constraint`);
  process.exit(3);
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
  if (independence?.authorModel !== undefined) console.log(`INDEPENDENT_OF_MODEL=${independence.authorProvider}/${independence.authorModel}`);
  if (overlay !== undefined) console.log(`ROUTING_OVERLAY_SHA256=${overlay.sha256}`);
  console.log(`QUOTA_ADMISSION=${result.modelBinding.admission}`);
  console.log(`QUOTA_TELEMETRY_STATUS=${telemetryStatus}`);
  console.log(`QUOTA_GENERATED_AT=${snapshot?.generatedAt ?? ""}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
