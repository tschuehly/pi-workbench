import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import workingMode, { axes, defaults, renderBlock } from "./index.ts";

const cwd = "/tmp/working-mode-test";
const agentDir = `${cwd}/agent`;

// A real Pi session with a scripted model: records every request the model receives.
async function session(entries) {
  const faux = fauxProvider();
  const requests = [];
  const reply = (context) => { requests.push(context); return fauxAssistantMessage("ok"); };
  faux.setResponses(Array.from({ length: 20 }, () => reply));
  const snapshots = [];
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 } });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, systemPrompt: "BASE",
    noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [(pi) => {
      pi.registerProvider(faux.provider);
      pi.events.on("pi-workbench:working-mode", (value) => snapshots.push(value));
    }, workingMode],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ authPath: `${agentDir}/auth.json`, modelsPath: null, refreshOnCreate: false });
  const sessionManager = entries ? SessionManager.inMemory(cwd, undefined, entries) : SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, resourceLoader, settingsManager, sessionManager, model: faux.getModel(), noTools: "all",
    sessionStartEvent: { type: "session_start", reason: entries ? "resume" : "startup" },
  });
  await session.bindExtensions({});
  const blocks = (request) => request.messages
    .map((message) => typeof message.content === "string" ? message.content : message.content?.map?.((part) => part.text ?? "").join("") ?? "")
    .filter((text) => text.startsWith("<working-mode"));
  const last = () => requests.at(-1);
  return { session, sessionManager, requests, snapshots, blocks, last, entries: () => [sessionManager.getHeader(), ...sessionManager.getEntries()] };
}

test("a mode change reaches the model as one tagged message; the system prompt never changes", async () => {
  const s = await session();
  await s.session.prompt("first");
  await s.session.prompt("/mode alignment align");
  await s.session.prompt("/mode Attention PHONE");
  await s.session.prompt("second");
  await s.session.prompt("third");

  const prompts = s.requests.map((request) => getCurrentSystemPrompt(request.messages));
  assert.equal(new Set(prompts).size, 1, "system prompt must stay byte-identical");
  assert.equal(s.blocks(s.requests[0]).length, 0, "starting values post nothing");
  const [block] = s.blocks(s.last());
  assert.equal(s.blocks(s.last()).length, 1, "posted once, not repeated");
  assert.match(block, /^<working-mode seq="1">/);
  assert.match(block, /Alignment: Align · Attention: Phone · Checking: Default · Orchestration: Main/);
  assert.match(block, /Alignment — Align: For nontrivial work/);
  assert.match(block, /Attention — Phone: .*ask_human`, never in the session conversation/);
  assert.match(block, /When a milestone finishes or you stop to wait, send one `notify_human` update/);
  assert.doesNotMatch(block, /Checking —|Orchestration —/);
  assert.match(block, /This block replaces every earlier <working-mode> block\.\n<\/working-mode>$/);
  assert.doesNotMatch(block, /ignore previous/i);
  assert.deepEqual(s.snapshots.at(-1), {
    schemaVersion: 2, phase: "applied",
    selected: { alignment: "Align", attention: "Phone", checking: "Default", orchestration: "Main" },
    applied: { alignment: "Align", attention: "Phone", checking: "Default", orchestration: "Main" },
  });
  s.session.dispose();
});

test("each change posts a numbered replacement; returning to starting values says so", async () => {
  const s = await session();
  await s.session.prompt("/mode checking test");
  await s.session.prompt("one");
  await s.session.prompt("/mode checking default");
  await s.session.prompt("two");
  const blocks = s.blocks(s.last());
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /seq="1"[\s\S]*Checking — Test/);
  assert.match(blocks[1], /seq="2"[\s\S]*no Working Mode guidance applies/);
  s.session.dispose();
});

test("resume restores the selection from the session without posting again", async () => {
  const first = await session();
  await first.session.prompt("/mode orchestration workers");
  await first.session.prompt("one");
  const saved = first.entries();
  first.session.dispose();

  const resumed = await session(saved);
  assert.deepEqual(resumed.snapshots.at(-1).selected, { ...defaults, orchestration: "Workers" });
  await resumed.session.prompt("two");
  assert.equal(resumed.blocks(resumed.last()).length, 1, "the saved block is reused, not re-posted");
  resumed.session.dispose();
});

test("after compaction summarizes the block away, the next prompt attaches it again", async () => {
  const s = await session();
  await s.session.prompt("/mode attention afk");
  await s.session.prompt("one");
  await s.session.prompt("two");
  await s.session.compact();
  await s.session.prompt("three");
  const blocks = s.blocks(s.last());
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /seq="2"[\s\S]*Attention — AFK/);
  s.session.dispose();
});

test("invalid commands change nothing", async () => {
  const s = await session();
  for (const args of ["alignment vibe", "checking", "speed fast", "alignment align extra"]) await s.session.prompt(`/mode ${args}`);
  await s.session.prompt("task");
  assert.equal(s.blocks(s.last()).length, 0);
  s.session.dispose();
});

test("every non-starting value has guidance; starting values render none", () => {
  for (const [axis, { values }] of Object.entries(axes)) {
    for (const [value, text] of Object.entries(values)) {
      const block = renderBlock({ ...defaults, [axis]: value }, 1);
      if (value === defaults[axis]) assert.match(block, /no Working Mode guidance applies/);
      else assert.ok(text && block.includes(text), `${axis}=${value}`);
    }
  }
});

test("the terminal picker changes one axis; cancel changes nothing", async () => {
  const handlers = new Map();
  let command;
  const statuses = [];
  const choices = [];
  workingMode({ on: (name, handler) => handlers.set(name, handler), registerCommand: (_name, value) => { command = value; }, events: { emit() {} } });
  const ctx = {
    mode: "tui", hasUI: true,
    sessionManager: { getBranch: () => [], buildContextEntries: () => [] },
    ui: { setStatus: (_key, value) => statuses.push(value), notify() {}, select: async () => choices.shift() },
  };
  handlers.get("session_start")({ reason: "startup" }, ctx);
  choices.push("Checking: Default", "Challenge");
  await command.handler("", ctx);
  choices.push(undefined);
  await command.handler("", ctx);
  assert.equal(statuses.at(-1), "Alignment: Default · Attention: Default · Checking: Challenge · Orchestration: Main");
  const result = handlers.get("before_agent_start")({}, ctx);
  assert.equal(result.message.customType, "working-mode");
  assert.deepEqual(result.message.details, { schemaVersion: 2, seq: 1, selection: { ...defaults, checking: "Challenge" } });
});
