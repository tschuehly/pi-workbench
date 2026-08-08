export function stripFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

export function buildAutonomousGrillPrompt(skillMarkdown, target) {
  const instructions = stripFrontmatter(skillMarkdown);
  const normalizedTarget = target.trim();
  if (normalizedTarget.length === 0) throw new Error("An autonomous grill target is required.");

  return `[AUTONOMOUS GRILL]\n\n${instructions}\n\n## Target supplied by the human\n\n${normalizedTarget}`;
}
