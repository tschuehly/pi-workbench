#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.join(here, "..", "references", "routing-policy.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const [role, extra] = process.argv.slice(2);

if (!role || extra) {
  console.error("usage: resolve-binding.mjs <cognitive-role>");
  process.exit(2);
}

const binding = policy.bindings[role];
if (!binding) {
  console.error("BINDING=FAIL");
  console.error(`ROLE=${role}`);
  console.error(`VALID_ROLES=${Object.keys(policy.bindings).join(",")}`);
  process.exit(1);
}

console.log(JSON.stringify({ cognitiveRole: role, ...binding }, null, 2));
