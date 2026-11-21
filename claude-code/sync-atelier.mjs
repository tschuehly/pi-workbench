#!/usr/bin/env node
// Copies the Atelier host, Page check and Kernel from extensions/atelier into the Claude Code plugin, and the Page
// contract from skills/atelier/SKILL.md into the plugin skill. Claude Code copies an installed plugin into its cache
// without files outside the plugin directory and refuses symlinks that leave it, so the plugin carries copies.
// sync-atelier.test.mjs fails when they drift: run `node claude-code/sync-atelier.mjs` after changing the sources.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(repo, "claude-code", "atelier");
export const COPIES = ["host.ts", "check-page.mjs", "kernel/atelier.js", "kernel/idiomorph.js", "kernel/package.json"];
export const CONTRACT = "skills/atelier/page-contract.md";

/** Every generated file as [plugin-relative path, content]. */
export function expected() {
  const files = COPIES.map((f) => [`lib/${f}`, readFileSync(path.join(repo, "extensions", "atelier", f), "utf8")]);
  const skill = readFileSync(path.join(repo, "skills", "atelier", "SKILL.md"), "utf8");
  const start = skill.indexOf("## Page contract"), end = skill.indexOf("## Registry");
  if (start < 0 || end < start) throw new Error("skills/atelier/SKILL.md lost its Page contract or Registry heading");
  files.push([CONTRACT, `<!-- Generated from pi-workbench skills/atelier/SKILL.md by claude-code/sync-atelier.mjs; do not edit here. -->\n# Atelier Page contract\n\n${skill.slice(start, end).trimEnd()}\n`]);
  return files.map(([f, text]) => [f, text, path.join(plugin, f)]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [f, text, file] of expected()) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); console.log(`wrote ${f}`); }
}
