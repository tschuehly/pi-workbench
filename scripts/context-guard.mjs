#!/usr/bin/env node
// Daily check (run by scripts/auto-upgrade) for skills, tools and MCP servers that inflate Pi's startup context.
// For each folder in ~/.pi-workbench/context-guard/folders.json (JSON array of absolute paths) it measures the lead's
// startup tokens with scripts/context-usage.mjs, compares with last.json, writes the new state there, and prints a
// markdown report. Exit 0 = no flags, 1 = flags. The first run records a baseline and flags only absolute problems.
//
// Usage: node scripts/context-guard.mjs   (PI_CONTEXT_GUARD_DIR overrides the state folder)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { measure } from "./context-usage.mjs";

const GROWTH = 1000, MAX_TOTAL = 30_000, MAX_DESC = 400, PACK = 10;

const unescape = (s) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e]);

export function parseSkills(section = "") {
  return [...section.matchAll(/<skill>\s*<name>([\s\S]*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>([\s\S]*?)<\/location>/g)]
    .map(([, name, desc, location]) => {
      const description = unescape(desc.trim());
      return { name: unescape(name.trim()), desc: description, descLen: description.length, location: location.trim() };
    });
}

// An extension tool also appears as mcp__<extension>__<tool>; built-in tools have no such alias.
export function toolSources(names) {
  return names.map((name) => {
    const ns = name.match(/^mcp__(.+?)__/)?.[1] ?? names.find((n) => n.endsWith(`__${name}`) && n.startsWith("mcp__"))?.match(/^mcp__(.+?)__/)[1];
    return { name, source: ns ?? "builtin" };
  });
}

// Servers whose tools are declared upfront: exposure "direct" (default is codemode) or any toolExposure "direct".
export function upfrontMcp(globalCfg, projectCfg) {
  const servers = { ...globalCfg?.mcpServers };
  for (const [name, p] of Object.entries(projectCfg?.mcpServers ?? {})) {
    servers[name] = p.command || p.url || p.type ? p : { ...servers[name], ...p }; // partial entry overrides enabled/exposure only
  }
  return Object.entries(servers)
    .filter(([, s]) => s.enabled !== false && (s.exposure === "direct" || Object.values(s.toolExposure ?? {}).includes("direct")))
    .map(([name]) => name);
}

export function compare(prev, cur) {
  if (!prev) return [];
  const flags = [];
  if (cur.total - prev.total >= GROWTH) flags.push(`startup grew by ${cur.total - prev.total} tokens (${prev.total} → ${cur.total})`);
  if (prev.total <= MAX_TOTAL && cur.total > MAX_TOTAL) flags.push(`startup is ${cur.total} tokens, over ${MAX_TOTAL}`);
  const oldSkills = new Map(prev.skills.map((s) => [s.name, s])), hadTools = new Set(prev.tools.map((t) => t.name));
  const newByParent = Map.groupBy(cur.skills.filter((s) => !oldSkills.has(s.name)), (s) => path.dirname(path.dirname(s.location)));
  for (const s of cur.skills) {
    const old = oldSkills.get(s.name);
    if (!old) flags.push(`new skill \`${s.name}\` (${s.location})`);
    if (s.descLen > MAX_DESC && (!old || (old.desc === undefined ? old.descLen !== s.descLen : old.desc !== s.desc))) flags.push(`skill \`${s.name}\` description is ${s.descLen} characters (${s.location})`);
  }
  for (const t of cur.tools) if (!hadTools.has(t.name)) flags.push(`new tool \`${t.name}\` (from ${t.source})`);
  for (const [dir, list] of newByParent) if (list.length >= PACK) flags.push(`${list.length} new skills from ${dir} (a pack install)`);
  for (const name of cur.upfrontMcp) if (!prev.upfrontMcp.includes(name)) flags.push(`MCP server \`${name}\` loads its tools upfront`);
  return flags;
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);

function inspect(folder) {
  let system;
  const total = measure([], process.env, { dir: folder, onSystem: (m) => (system ??= m) });
  return {
    total,
    skills: parseSkills(system?.sections?.skills),
    tools: toolSources((system?.toolsAdded ?? []).map((t) => t.name)),
    upfrontMcp: upfrontMcp(readJson(path.join(os.homedir(), ".pi/agent/mcp.json")), readJson(path.join(folder, ".pi/mcp.json"))),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.env.PI_CONTEXT_GUARD_DIR ?? path.join(os.homedir(), ".pi-workbench/context-guard");
  mkdirSync(dir, { recursive: true });
  const folders = readJson(path.join(dir, "folders.json")) ?? [];
  const last = readJson(path.join(dir, "last.json"));
  const next = { measuredAt: new Date().toISOString(), folders: {} };
  const flagged = new Map(); // flag text -> folders, so a global skill is reported once
  for (const folder of folders) {
    let flags;
    try {
      next.folders[folder] = inspect(folder);
      flags = compare(last?.folders?.[folder], next.folders[folder]);
    } catch (e) {
      next.folders[folder] = last?.folders?.[folder]; // keep the old baseline when a measurement fails
      flags = [`measurement failed: ${e.message.split("\n")[0]}`];
    }
    for (const f of flags) flagged.set(f, [...(flagged.get(f) ?? []), path.basename(folder)]);
  }
  writeFileSync(path.join(dir, "last.json"), `${JSON.stringify(next, null, 2)}\n`);
  const lines = [`# Context guard ${next.measuredAt.slice(0, 10)}${last ? "" : " (baseline)"}`, "", flagged.size ? "## Flags" : "No flags.", ""];
  for (const [f, where] of flagged) lines.push(`- ${f} — ${where.join(", ")}`);
  lines.push("", "## Startup tokens (lead)", "");
  for (const folder of folders) lines.push(`- ${folder}: ${next.folders[folder]?.total ?? "?"}${last?.folders?.[folder] ? ` (was ${last.folders[folder].total})` : ""}`);
  console.log(lines.join("\n"));
  process.exitCode = flagged.size ? 1 : 0;
}
