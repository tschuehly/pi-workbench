import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import workingMode from "../working-mode/index.ts";
import toolGroups from "./index.ts";
import { enabledGroups, goalActive, hiddenNames, mcpServers } from "./groups.mjs";

const cwd = "/tmp/tool-groups-test";
const agentDir = `${cwd}/agent`;
const FAKE_TOOLS = ["report_status", "worker_create", "worker_status", "goal_complete", "goal_blocked", "goal_wait", "mcp__subagent__worker_status"];

// A real Pi session with a scripted model. `replies` answer requests in order, then "ok".
async function session({ replies = [], entries } = {}) {
  const faux = fauxProvider();
  const requests = [];
  const queue = [...replies];
  faux.setResponses(Array.from({ length: 20 }, () => (context) => {
    requests.push(context);
    return queue.shift() ?? fauxAssistantMessage("ok");
  }));
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, systemPrompt: "BASE",
    noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [(pi) => {
      pi.registerProvider(faux.provider);
      for (const name of FAKE_TOOLS) {
        pi.registerTool({ name, label: name, description: name, parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "done" }], details: undefined }) });
      }
    }, toolGroups, workingMode],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ authPath: `${agentDir}/auth.json`, modelsPath: null, refreshOnCreate: false });
  const sessionManager = entries ? SessionManager.inMemory(cwd, undefined, entries) : SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, resourceLoader, settingsManager, sessionManager, model: faux.getModel(), noTools: "builtin",
    sessionStartEvent: { type: "session_start", reason: entries ? "resume" : "startup" },
  });
  await session.bindExtensions({});
  const systemMessages = (request) => request.messages.filter((message) => message.role === "system");
  // The request's tool loadout: the transcript's system messages replayed in order.
  const tools = (request) => {
    const names = new Set();
    for (const message of systemMessages(request)) {
      for (const tool of message.toolsRemoved ?? []) names.delete(tool.name);
      for (const tool of message.toolsAdded ?? []) names.add(tool.name);
    }
    return [...names].sort();
  };
  return { session, sessionManager, requests, tools, systemMessages, entries: () => [sessionManager.getHeader(), ...sessionManager.getEntries()] };
}

test("a new session hides worker and goal tools; tools_enable adds workers as a transcript delta", async () => {
  const s = await session({ replies: [fauxAssistantMessage(fauxToolCall("tools_enable", { group: "workers" }))] });
  assert.ok(s.session.getActiveToolNames().includes("goal_complete"), "idle: /goal can start");
  await s.session.prompt("go");

  const [first, second] = s.requests;
  assert.deepEqual(s.tools(first), ["alignment_reached", "alignment_reset", "report_status", "tools_enable"]);
  assert.deepEqual(s.tools(second), ["alignment_reached", "alignment_reset", "report_status", "tools_enable", "worker_create", "worker_status"]);
  const [initial, ...later] = s.systemMessages(second);
  assert.deepEqual(initial.toolsAdded.map((tool) => tool.name).sort(), ["alignment_reached", "alignment_reset", "report_status", "tools_enable"], "initial loadout unchanged");
  assert.deepEqual(later.flatMap((message) => message.toolsAdded ?? []).map((tool) => tool.name).sort(), ["worker_create", "worker_status"], "enabled tools arrive as a later addition");
  assert.ok(s.session.getActiveToolNames().includes("goal_complete"), "goal tools return once the session settles");

  await s.session.prompt("again");
  assert.deepEqual(s.tools(s.requests.at(-1)), s.tools(second), "enabled group stays enabled");
  s.session.dispose();
});

test("an active goal keeps goal tools in the run", async () => {
  const s = await session();
  s.sessionManager.appendCustomEntry("goal-state", { goal: { id: "g", status: "active" } });
  await s.session.prompt("work");
  assert.ok(["goal_blocked", "goal_complete", "goal_wait"].every((name) => s.tools(s.requests[0]).includes(name)));
  s.sessionManager.appendCustomEntry("goal-state", { goal: null });
  await s.session.prompt("done");
  assert.ok(!s.tools(s.requests[1]).includes("goal_complete"));
  s.session.dispose();
});

test("Orchestration Workers activates worker tools; resume keeps the enabled groups", async () => {
  const s = await session();
  await s.session.prompt("/mode orchestration workers");
  await s.session.prompt("one");
  assert.ok(s.tools(s.requests[0]).includes("worker_create"));
  const saved = s.entries();
  s.session.dispose();

  const resumed = await session({ entries: saved });
  await resumed.session.prompt("/mode orchestration main");
  await resumed.session.prompt("two");
  assert.ok(resumed.tools(resumed.requests[0]).includes("worker_create"), "resumed transcript had workers enabled");
  resumed.session.dispose();
});

test("groups match by package source and cover claude-code-use aliases", () => {
  const tools = [
    { name: "monitor", sourceInfo: { source: "npm:pi-process-monitor@2" } },
    { name: "mcp__process_monitor__monitor", sourceInfo: { source: "npm:@benvargas/pi-claude-code-use" } },
    { name: "mcp", sourceInfo: { source: "npm:pi-mcp-adapter" } },
    { name: "mcpScript", sourceInfo: { source: "npm:pi-mcp-adapter" } },
    { name: "mcp__linear", sourceInfo: { source: "npm:pi-mcp-adapter" } },
    { name: "mcp__mcp_adapter__mcpscript", sourceInfo: { source: "npm:@benvargas/pi-claude-code-use" } },
    { name: "read", sourceInfo: { source: "builtin" } },
  ];
  assert.deepEqual([...hiddenNames(tools, (id) => id === "monitor", false)].sort(), ["mcp", "mcpScript", "mcp__linear", "mcp__mcp_adapter__mcpscript"]);
  assert.deepEqual([...hiddenNames(tools, (id) => id === "mcp", true)].sort(), ["mcp__process_monitor__monitor", "monitor"]);
  assert.deepEqual([...enabledGroups(tools, ["read", "mcp"])], ["mcp"]);
  assert.deepEqual(mcpServers(tools), ["linear"]);
  assert.equal(goalActive([{ type: "custom", customType: "goal-state", data: { goal: { status: "active" } } }, { type: "custom", customType: "goal-state", data: { goal: { status: "paused" } } }]), false);
});
