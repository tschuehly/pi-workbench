#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.join(here, "..", "references", "routing-policy.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const args = process.argv.slice(2);
const role = args.shift();
let independentOfProvider;
if (args[0] === "--independent-of" && args.length === 2) {
  args.shift();
  independentOfProvider = args.shift();
}

if (!role || args.length > 0) {
  console.error("usage: resolve-binding.mjs <cognitive-role> [--independent-of <provider>]");
  process.exit(2);
}

const rolePolicy = policy.bindings[role];
if (!rolePolicy) {
  console.error("BINDING=FAIL");
  console.error(`ROLE=${role}`);
  console.error(`VALID_ROLES=${Object.keys(policy.bindings).join(",")}`);
  process.exit(1);
}

let binding = rolePolicy;
let independence;
if (rolePolicy.independentBindings !== undefined) {
  const family = policy.providerFamilies[independentOfProvider];
  binding = rolePolicy.independentBindings[family];
  if (binding === undefined) {
    console.error("BINDING=FAIL");
    console.error(`ROLE=${role}`);
    console.error(`REASON=Independent role requires a configured --independent-of provider`);
    process.exit(1);
  }
  independence = {
    independentOfProvider,
    independentOfFamily: family,
    selectedFamily: policy.providerFamilies[binding.provider],
  };
} else if (independentOfProvider !== undefined) {
  console.error("BINDING=FAIL");
  console.error(`ROLE=${role}`);
  console.error("REASON=Role does not use an independence constraint");
  process.exit(1);
}

console.log(JSON.stringify({ cognitiveRole: role, ...binding, ...(independence === undefined ? {} : { independence }) }, null, 2));
