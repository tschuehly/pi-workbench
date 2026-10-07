// Tool groups kept out of the lead's startup context until a session needs them.
// A group matches tools by name or by the package that registered them.
export const GROUPS = {
  workers: { names: ["worker_create", "worker_dispatch", "worker_status", "worker_retire"] },
  monitor: { source: /pi-process-monitor/ },
  mcp: { source: /pi-mcp-adapter/ },
  atelier: { names: ["atelier"] },
};

// pi-goal refuses to start or continue a goal unless these are active, so they are active while
// the session is idle and while a goal runs, and hidden from every other model run.
export const GOAL_TOOLS = ["goal_complete", "goal_blocked", "goal_wait"];

export const inGroup = (id, tool) =>
  !!(GROUPS[id].names?.includes(tool.name) || GROUPS[id].source?.test(tool.sourceInfo?.source ?? ""));

/** Matching tool names plus their pi-claude-code-use aliases (`mcp__<extension>__<name>`). */
export function withAliases(tools, match) {
  const flat = tools.filter(match).map((tool) => tool.name);
  const suffixes = flat.map((name) => `__${name.toLowerCase()}`);
  return tools.map((tool) => tool.name).filter((name) =>
    flat.includes(name) || (name.startsWith("mcp__") && suffixes.some((suffix) => name.toLowerCase().endsWith(suffix))));
}

/** Tool names to keep inactive for the next model run. */
export function hiddenNames(tools, isEnabled, goalActive) {
  const hidden = Object.keys(GROUPS).filter((id) => !isEnabled(id)).flatMap((id) => withAliases(tools, (tool) => inGroup(id, tool)));
  if (!goalActive) hidden.push(...withAliases(tools, (tool) => GOAL_TOOLS.includes(tool.name)));
  return new Set(hidden);
}

/** Groups with an active tool, i.e. the ones a resumed transcript had enabled. */
export function enabledGroups(tools, activeNames) {
  const active = new Set(activeNames);
  return new Set(Object.keys(GROUPS).filter((id) => tools.some((tool) => active.has(tool.name) && inGroup(id, tool))));
}

// ponytail: reads pi-goal's session entry format ("goal-state"); revisit if pi-goal renames it.
export function goalActive(entries) {
  const last = entries.findLast((entry) => entry.type === "custom" && entry.customType === "goal-state");
  return last?.data?.goal?.status === "active";
}

/** MCP servers reachable through the adapter's per-server proxy tools (`mcp__<server>`). */
export const mcpServers = (tools) =>
  tools.filter((tool) => inGroup("mcp", tool) && /^mcp__[^_]/.test(tool.name) && !tool.name.slice(5).includes("__")).map((tool) => tool.name.slice(5));
