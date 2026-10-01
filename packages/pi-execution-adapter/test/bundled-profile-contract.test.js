import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adapter = readFileSync(resolve(root, "packages/pi-execution-adapter/src/index.js"), "utf8");
const profiles = readFileSync(resolve(root, "extensions/subagent/index.ts"), "utf8");
const routing = JSON.parse(readFileSync(resolve(root, "skills/model-orchestration/references/routing-policy.json"), "utf8"));

function list(source, name) {
  const match = source.match(new RegExp(`(?:const|export const) ${name} = \\[([^\\]]*)\\]`));
  assert.ok(match, `missing ${name} list`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

function expandTools(expression, symbols) {
  return expression.split(",").flatMap((part) => {
    const spread = part.trim().match(/^\.\.\.([A-Z_]+)$/);
    if (spread) {
      assert.ok(symbols[spread[1]], `unknown profile tool list ${spread[1]}`);
      return symbols[spread[1]];
    }
    const item = part.trim().match(/^["']([^"']+)["']$/);
    return item ? [item[1]] : [];
  });
}

test("bundled child profile tools fit the adapter host ceiling and skill roles exist", () => {
  const ceiling = adapter.match(/this\.hostTools = new Set\(options\.hostTools \?\? \[([^\]]*)\]/);
  assert.ok(ceiling, "missing adapter host tool ceiling");
  const delegation = list(profiles, "DELEGATION_TOOLS");
  const childTools = list(profiles, "CHILD_TOOLS");
  // Expand the adapter's delegation-tool spread against the bundled extension declaration.
  const adapterTools = new Set(expandTools(ceiling[1], { DELEGATION_TOOLS: delegation }));
  const symbols = { CHILD_TOOLS: childTools, DELEGATION_TOOLS: delegation };
  const profileBlock = profiles.match(/export const PROFILES = \{([\s\S]*?)\n\} as const/);
  assert.ok(profileBlock, "missing bundled profiles");
  const bundled = [...profileBlock[1].matchAll(/^\s+(\w+): \{\s*\n\s+tools: \[([^\]]*)\]/gm)];
  assert.ok(bundled.length > 0, "no bundled profiles parsed");
  for (const [, name, expression] of bundled) {
    for (const tool of expandTools(expression, symbols)) assert.ok(adapterTools.has(tool), `${name} requests ${tool}, outside adapter host ceiling`);
  }

  const skills = resolve(root, "skills");
  const markdown = execFileSync("find", [skills, "-name", "*.md", "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const file of markdown) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/Cognitive Role `([^`]+)`|cognitiveRole:\s*["']([^"']+)["']/g)) {
      const role = match[1] ?? match[2];
      assert.ok(routing.roles[role], `${file} refers to unknown Cognitive Role ${role}`);
    }
  }
});
