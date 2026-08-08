import assert from "node:assert/strict";
import test from "node:test";
import { buildAutonomousGrillPrompt, stripFrontmatter } from "./prompt.mjs";

test("strips skill frontmatter without changing the instruction body", () => {
  const source = "---\nname: autonomous-grill\ndisable-model-invocation: true\n---\n\n# Autonomous Grill\n\nRun it.";
  assert.equal(stripFrontmatter(source), "# Autonomous Grill\n\nRun it.");
});

test("builds one hidden prompt from the authoritative skill and target", () => {
  const prompt = buildAutonomousGrillPrompt("---\nname: autonomous-grill\n---\n\n# Instructions", "  choose a cache  ");
  assert.equal(prompt, "[AUTONOMOUS GRILL]\n\n# Instructions\n\n## Target supplied by the human\n\nchoose a cache");
  assert.throws(() => buildAutonomousGrillPrompt("# Instructions", "  "), /target is required/);
});
