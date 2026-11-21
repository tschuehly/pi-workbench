import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, parseSkills, toolSources, upfrontMcp } from "./context-guard.mjs";

const skill = (name, desc, loc) => `  <skill>\n    <name>${name}</name>\n    <description>${desc}</description>\n    <location>${loc}</location>\n  </skill>`;

test("parseSkills reads name, unescaped description length and location", () => {
  const section = `<skills>\nintro\n<available_skills>\n${skill("a", "Use &apos;x&apos;\n", "/s/a/SKILL.md")}\n${skill("b", "bb", "/p/b/SKILL.md")}\n</available_skills>\n</skills>`;
  assert.deepEqual(parseSkills(section), [
    { name: "a", descLen: 7, location: "/s/a/SKILL.md" },
    { name: "b", descLen: 2, location: "/p/b/SKILL.md" },
  ]);
  assert.deepEqual(parseSkills(undefined), []);
});

test("toolSources names the extension namespace of each tool", () => {
  assert.deepEqual(toolSources(["read", "subagent", "mcp__subagent__subagent", "mcp__parqet__get"]), [
    { name: "read", source: "builtin" },
    { name: "subagent", source: "subagent" },
    { name: "mcp__subagent__subagent", source: "subagent" },
    { name: "mcp__parqet__get", source: "parqet" },
  ]);
});

test("upfrontMcp: default codemode is not upfront; direct, toolExposure direct and project overrides are", () => {
  const global = { mcpServers: { quiet: { url: "u" }, loud: { url: "u", exposure: "direct" }, off: { url: "u", exposure: "direct" }, some: { url: "u", toolExposure: { "get_*": "direct" } } } };
  const project = { mcpServers: { off: { enabled: false }, quiet: { exposure: "direct" }, some: { command: "x" }, proj: { command: "y", exposure: "deferred" } } };
  assert.deepEqual(upfrontMcp(global, project), ["quiet", "loud"]);
  assert.deepEqual(upfrontMcp(undefined, undefined), []);
});

const state = (over = {}) => ({ total: 20_000, skills: [{ name: "a", descLen: 100, location: "/s/a/SKILL.md" }], tools: [{ name: "read", source: "builtin" }], upfrontMcp: [], ...over });

test("compare: no flags when nothing changed", () => {
  assert.deepEqual(compare(state(), state()), []);
});

test("compare: growth, new skill and tool, long description, pack, upfront MCP", () => {
  const pack = Array.from({ length: 20 }, (_, i) => ({ name: `p${i}`, descLen: 10, location: `/pack/p${i}/SKILL.md` }));
  const cur = state({ total: 21_000, skills: [...state().skills, { name: "long", descLen: 401, location: "/x/long/SKILL.md" }, ...pack], tools: [...state().tools, { name: "mcp__z__q", source: "z" }], upfrontMcp: ["z"] });
  const flags = compare(state(), cur);
  assert.ok(flags.some((f) => f.includes("grew by 1000")));
  assert.ok(flags.some((f) => f.includes("new skill `long` (/x/long/SKILL.md)")));
  assert.ok(flags.some((f) => f.includes("new tool `mcp__z__q` (from z)")));
  assert.ok(flags.some((f) => f.includes("`long` description is 401 characters")));
  assert.ok(flags.some((f) => f.includes("20 skills listed from /pack")));
  assert.ok(flags.some((f) => f.includes("MCP server `z`")));
  assert.equal(compare(state(), state({ total: 20_999 })).length, 0);
});

test("compare: first run flags only absolute problems", () => {
  const cur = state({ total: 30_001, skills: [{ name: "long", descLen: 500, location: "/x/long/SKILL.md" }] });
  const flags = compare(undefined, cur);
  assert.equal(flags.length, 2);
  assert.ok(flags.some((f) => f.includes("over 30000")));
  assert.ok(flags.some((f) => f.includes("500 characters")));
});
