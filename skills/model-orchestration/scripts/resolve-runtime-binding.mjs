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
try {
  if (quotaInput === "-") rawQuota = fs.readFileSync(0, "utf8");
  else if (quotaInput) rawQuota = fs.readFileSync(quotaInput, "utf8");
  else rawQuota = execFileSync("quota-axi", ["--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=quota snapshot unavailable: ${error.message}`);
  process.exit(3);
}

let snapshot;
try {
  snapshot = JSON.parse(rawQuota);
} catch (error) {
  console.error(`ROUTING=BLOCKED\nROLE=${role}\nREASON=invalid quota JSON: ${error.message}`);
  process.exit(3);
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

const provider = snapshot.providers?.find((candidate) => candidate.provider === binding.quotaProvider);
const windows = provider?.windows ?? [];
const relevantWindows = windows.filter((window) => window.kind !== "model" || binding.model.includes(window.id.replace(/^model:/, "")));
let reason;
if (!availableModels.has(`${binding.provider}/${binding.model}`)) reason = `Pi model '${binding.provider}/${binding.model}' is unavailable`;
else if (!provider) reason = `quota provider '${binding.quotaProvider}' is absent`;
else if (provider.state?.status !== "fresh" || provider.state?.stale) reason = `quota provider '${binding.quotaProvider}' is not fresh`;
else if (relevantWindows.some((window) => Number(window.percentRemaining) <= 0)) reason = `quota exhausted for '${binding.quotaProvider}'`;

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
    quotaSnapshot: {
      generatedAt: snapshot.generatedAt ?? null,
      relevantWindows: relevantWindows.map((window) => ({
        id: window.id,
        kind: window.kind,
        windowSeconds: window.windowSeconds ?? null,
        resetsAt: window.resetsAt ?? null,
        percentRemaining: window.percentRemaining,
      })),
      stale: false,
      refreshedAt: provider.state?.refreshedAt ?? null,
      error: null,
    },
  },
};

if (format === "env") {
  console.log("ROUTING=PASS");
  console.log(`COGNITIVE_ROLE=${role}`);
  console.log(`PI_PROVIDER=${binding.provider}`);
  console.log(`PI_MODEL=${binding.model}`);
  console.log(`PI_THINKING=${binding.effort}`);
  console.log(`QUOTA_GENERATED_AT=${snapshot.generatedAt ?? ""}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
