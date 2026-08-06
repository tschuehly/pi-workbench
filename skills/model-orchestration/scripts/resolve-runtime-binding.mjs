#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(here, "..", "references", "routing-policy.json"), "utf8"));

function usage() {
  console.error("usage: resolve-runtime-binding.mjs <cognitive-role> [--quota <path|->] [--catalog <path>] [--format json|env]");
  process.exit(2);
}

const args = process.argv.slice(2);
const role = args.shift();
if (!role) usage();
let quotaInput;
let catalogInput;
let format = "json";
while (args.length) {
  const option = args.shift();
  if (option === "--quota") quotaInput = args.shift();
  else if (option === "--catalog") catalogInput = args.shift();
  else if (option === "--format") format = args.shift();
  else usage();
}
if ((quotaInput === undefined && process.argv.includes("--quota")) ||
    (catalogInput === undefined && process.argv.includes("--catalog")) ||
    !["json", "env"].includes(format)) usage();

const binding = policy.bindings[role];
if (!binding) {
  console.error(`Unknown cognitive role: ${role}`);
  console.error(`Valid roles: ${Object.keys(policy.bindings).join(", ")}`);
  process.exit(1);
}

let rawQuota;
let quotaError;
try {
  if (quotaInput === "-") rawQuota = fs.readFileSync(0, "utf8");
  else if (quotaInput) rawQuota = fs.readFileSync(quotaInput, "utf8");
  else rawQuota = execFileSync("quota-axi", ["--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
    : execFileSync("pi", ["--list-models"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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

if (format === "env") {
  console.log("ROUTING=PASS");
  console.log(`COGNITIVE_ROLE=${role}`);
  console.log(`PI_PROVIDER=${binding.provider}`);
  console.log(`PI_MODEL=${binding.model}`);
  console.log(`PI_THINKING=${binding.effort}`);
  console.log(`QUOTA_ADMISSION=${result.modelBinding.admission}`);
  console.log(`QUOTA_TELEMETRY_STATUS=${telemetryStatus}`);
  console.log(`QUOTA_GENERATED_AT=${snapshot?.generatedAt ?? ""}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
