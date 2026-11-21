import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, parseSkills, toolSources, upfrontMcp } from "./context-guard.mjs";

const skill = (name, desc, loc) => `  <skill>\n    <name>${name}</name>\n    <description>${desc}</description>\n    <location>${loc}</location>\n  </skill>`;

test("parseSkills reads name, unescaped description and location", () => {
  const section = `<skills>\nintro\n<available_skills>\n${skill("a", "Use &apos;x&apos;\n", "/s/a/SKILL.md")}\n${skill("b", "bb", "/p/b/SKILL.md")}\n</available_skills>\n</skills>`;
  assert.deepEqual(parseSkills(section), [
    { name: "a", desc: "Use 'x'", descLen: 7, location: "/s/a/SKILL.md" },
    { name: "b", desc: "bb", descLen: 2, location: "/p/b/SKILL.md" },
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

const state = (over = {}) => ({ total: 20_000, skills: [{ name: "a", desc: "short", descLen: 100, location: "/s/a/SKILL.md" }], tools: [{ name: "read", source: "builtin" }], upfrontMcp: [], ...over });

test("compare: no flags when nothing changed", () => {
  assert.deepEqual(compare(state(), state()), []);
});

test("compare: growth, new skill and tool, new long description, pack, upfront MCP", () => {
  const pack = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}`, desc: "short", descLen: 10, location: `/pack/p${i}/SKILL.md` }));
  const cur = state({ total: 21_000, skills: [...state().skills, { name: "long", desc: "x".repeat(401), descLen: 401, location: "/x/long/SKILL.md" }, ...pack], tools: [...state().tools, { name: "mcp__z__q", source: "z" }], upfrontMcp: ["z"] });
  const flags = compare(state(), cur);
  assert.ok(flags.some((f) => f.includes("grew by 1000")));
  assert.ok(flags.some((f) => f.includes("new skill `long` (/x/long/SKILL.md)")));
  assert.ok(flags.some((f) => f.includes("new tool `mcp__z__q` (from z)")));
  assert.ok(flags.some((f) => f.includes("`long` description is 401 characters")));
  assert.ok(flags.some((f) => f.includes("10 new skills from /pack")));
  assert.ok(flags.some((f) => f.includes("MCP server `z`")));
  assert.equal(compare(state(), state({ total: 20_999 })).length, 0);
});

test("compare: first run records baseline without flags", () => {
  const cur = state({ total: 40_000, skills: [{ name: "long", desc: "x".repeat(500), descLen: 500, location: "/x/long/SKILL.md" }], upfrontMcp: ["z"] });
  assert.deepEqual(compare(undefined, cur), []);
});

test("compare: long description flags only when new or changed", () => {
  const old = { name: "long", desc: "x".repeat(401), descLen: 401, location: "/x/long/SKILL.md" };
  assert.deepEqual(compare(state({ skills: [old] }), state({ skills: [old] })), []);
  assert.ok(compare(state(), state({ skills: [old] })).some((f) => f.includes("401 characters")));
  const changed = { ...old, desc: "y".repeat(401) };
  assert.ok(compare(state({ skills: [old] }), state({ skills: [changed] })).some((f) => f.includes("401 characters")));
  const legacy = { name: old.name, descLen: old.descLen, location: old.location };
  assert.deepEqual(compare(state({ skills: [legacy] }), state({ skills: [old] })), []);
});

test("compare: pack counts only new skills and total flags only on crossing", () => {
  const pack = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}`, desc: "short", descLen: 5, location: `/skills/p${i}/SKILL.md` }));
  assert.ok(compare(state(), state({ skills: [...state().skills, ...pack] })).some((f) => f.includes("10 new skills from /")));
  assert.ok(!compare(state({ skills: pack }), state({ skills: pack })).some((f) => f.includes("new skills from")));
  assert.ok(!compare(state({ total: 30_001 }), state({ total: 30_002 })).some((f) => f.includes("over 30000")));
  assert.ok(compare(state({ total: 30_000 }), state({ total: 30_001 })).some((f) => f.includes("over 30000")));
  assert.ok(compare(state(), state({ total: 30_001 })).some((f) => f.includes("over 30000")));
});
