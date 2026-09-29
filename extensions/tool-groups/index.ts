import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { GOAL_TOOLS, GROUPS, enabledGroups, goalActive, hiddenNames, inGroup, mcpServers } from "./groups.mjs";

type Group = keyof typeof GROUPS;
const GROUP_IDS = Object.keys(GROUPS) as Group[];

// Keeps rarely used tool groups out of the startup context. Tools activated mid-session reach the
// model as deferred additions, so enabling a group later keeps the cached prompt prefix.
export default function toolGroups(pi: ExtensionAPI) {
  let enabled = new Set<string>();
  let workersMode = false;
  let snippet = "";
  const isEnabled = (id: string) => enabled.has(id) || (id === "workers" && workersMode);

  function activate(names: string[]) {
    const active = pi.getActiveTools();
    const added = names.filter((name) => !active.includes(name));
    if (added.length) pi.setActiveTools([...active, ...added]);
  }

  function enable(id: Group) {
    enabled.add(id);
    const names = pi.getAllTools().filter((tool) => inGroup(id, tool)).map((tool) => tool.name);
    activate(names);
    return names;
  }

  function gate(ctx: ExtensionContext) {
    const hidden = hiddenNames(pi.getAllTools(), isEnabled, goalActive(ctx.sessionManager.getBranch()));
    const active = pi.getActiveTools();
    const next = active.filter((name) => !hidden.has(name));
    if (next.length !== active.length) pi.setActiveTools(next);
  }

  // /goal checks that its tools are active before it starts; tools missing from a child's allowlist
  // are not registered, so this never widens a child.
  const showGoalTools = () => {
    const registered = new Set(pi.getAllTools().map((tool) => tool.name));
    activate(GOAL_TOOLS.filter((name) => registered.has(name)));
  };

  function register(servers: string[]) {
    const next = `Call tools_enable first when you need durable workers, the background process monitor, or MCP servers${servers.length ? ` (${servers.join(", ")})` : ""}; the tools appear on the next model request.`;
    if (next === snippet) return;
    snippet = next;
    pi.registerTool({
      name: "tools_enable",
      label: "Enable Tools",
      description: "Enable a tool group. workers: worker_create/dispatch/status/retire. monitor: monitor* tools for background processes and logs. mcp: MCP gateway (mcp, mcpScript, per-server proxies).",
      promptSnippet: snippet,
      parameters: Type.Object({ group: StringEnum(GROUP_IDS) }, { additionalProperties: false }),
      async execute(_id, { group }) {
        const names = enable(group as Group);
        if (!names.length) throw new Error(`No ${group} tools are registered in this session.`);
        return { content: [{ type: "text" as const, text: `Enabled: ${names.join(", ")}.` }], details: { group, enabled: names } };
      },
    });
  }
  register([]);

  pi.events.on("pi-workbench:working-mode", (value: any) => {
    workersMode = value?.selected?.orchestration === "Workers";
    if (workersMode) activate(pi.getAllTools().filter((tool) => inGroup("workers", tool)).map((tool) => tool.name));
  });

  const restore = (_event: unknown, ctx: ExtensionContext) => {
    // A resumed branch keeps the groups its transcript had active; a new session starts with none.
    const resumed = ctx.sessionManager.getBranch().some((entry) => entry.type === "message");
    enabled = resumed ? enabledGroups(pi.getAllTools(), pi.getActiveTools()) : new Set();
    register(mcpServers(pi.getAllTools()));
    gate(ctx);
    showGoalTools();
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  // Other extensions re-activate tools they own (pi-mcp-adapter after a metadata refresh), and
  // pi-claude-code-use re-adds aliases; gate again before every model request.
  pi.on("before_agent_start", (_event, ctx) => gate(ctx));
  pi.on("turn_end", (_event, ctx) => gate(ctx));
  pi.on("agent_settled", showGoalTools);
}
