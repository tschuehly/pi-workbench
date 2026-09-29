import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import workingMode, { axes, defaults, renderBlock, ALIGNMENT_TOOL } from "./index.ts";

const cwd = "/tmp/working-mode-test";
const agentDir = `${cwd}/agent`;

// A real Pi session with a scripted model: records every request the model receives.
// `gate`, when given, holds the first reply open until it resolves so a test can act mid-run.
async function session(entries, gate) {
  const faux = fauxProvider();
  const requests = [];
  const reply = async (context) => {
    requests.push(context);
    if (gate && requests.length === 1) await gate;
    return fauxAssistantMessage("ok");
  };
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
  assert.match(block, /Alignment — Align: Investigate freely, but before the first edit/);
  assert.match(block, /Attention — Phone: .*ask_human`, never in the session conversation/);
  assert.match(block, /When a milestone finishes or you stop to wait, send one `notify_human` update/);
  assert.doesNotMatch(block, /Checking —|Orchestration —/);
  assert.match(block, /This block replaces every earlier <working-mode> block\.\n<\/working-mode>$/);
  assert.doesNotMatch(block, /ignore previous/i);
  assert.deepEqual(s.snapshots.at(-1), {
    schemaVersion: 2, phase: "applied",
    selected: { alignment: "Align", attention: "Phone", checking: "Default", orchestration: "Main" },
    applied: { alignment: "Align", attention: "Phone", checking: "Default", orchestration: "Main" },
    aligned: false,
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("/mode send while idle starts a turn that carries the block once", async () => {
  const s = await session();
  await s.session.prompt("first");
  await s.session.prompt("/mode checking test");
  await s.session.prompt("/mode send");
  await s.session.waitForIdle();
  await tick();
  await s.session.waitForIdle();
  assert.equal(s.requests.length, 2, "send starts a turn");
  const [block] = s.blocks(s.last());
  assert.match(block, /^<working-mode seq="1">[\s\S]*Checking — Test/);
  assert.match(block, /Acknowledge this change in one sentence and continue under it\.\n<\/working-mode>$/);
  assert.equal(s.snapshots.at(-1).phase, "applied");
  assert.deepEqual(s.snapshots.at(-1).applied, { ...defaults, checking: "Test" });
  await s.session.prompt("next");
  assert.equal(s.blocks(s.last()).length, 1, "the next prompt does not repeat the sent block");
  s.session.dispose();
});

test("/mode send while streaming steers the running turn", async () => {
  let release;
  const s = await session(undefined, new Promise((resolve) => { release = resolve; }));
  const running = s.session.prompt("work");
  while (s.requests.length === 0) await tick();
  await s.session.prompt("/mode attention focused");
  await s.session.prompt("/mode send");
  release();
  await running;
  await s.session.waitForIdle();
  assert.equal(s.requests.length, 2, "the steer continues the same run");
  assert.equal(s.blocks(s.requests[0]).length, 0);
  const [block] = s.blocks(s.last());
  assert.match(block, /Attention — Focused[\s\S]*Acknowledge this change/);
  await s.session.prompt("next");
  assert.equal(s.blocks(s.last()).length, 1, "no duplicate after the steer lands");
  s.session.dispose();
});

test("/mode send with nothing pending sends nothing", async () => {
  const s = await session();
  await s.session.prompt("/mode send");
  await tick();
  await s.session.prompt("/mode checking test");
  await s.session.prompt("one");
  await s.session.prompt("/mode send");
  await tick();
  assert.equal(s.requests.length, 1);
  s.session.dispose();
});

test("a queued steer counts as visible; a dropped one is attached again", async () => {
  const handlers = new Map();
  let command;
  const sent = [];
  const notes = [];
  workingMode({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (_name, value) => { command = value; },
    sendMessage: (message, options) => sent.push({ message, options }),
    registerTool() {},
    events: { emit() {} },
  });
  const ctx = {
    mode: "rpc", hasUI: true,
    sessionManager: { getBranch: () => [], buildContextEntries: () => [] },
    ui: { setStatus() {}, notify: (text) => notes.push(text) },
  };
  handlers.get("session_start")({ reason: "startup" }, ctx);
  await command.handler("send", ctx);
  assert.equal(sent.length, 0);
  assert.equal(notes.at(-1), "Working Mode unchanged");
  await command.handler("checking challenge", ctx);
  await command.handler("send", ctx);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].options, { triggerTurn: true, deliverAs: "steer" });
  assert.deepEqual(sent[0].message.details, { schemaVersion: 2, seq: 1, selection: { ...defaults, checking: "Challenge" }, aligned: false });
  assert.equal(sent[0].message.display, true);
  await command.handler("send", ctx);
  assert.equal(sent.length, 1, "a queued block is not sent twice");
  assert.equal(handlers.get("before_agent_start")({}, ctx), undefined, "queued block is not injected again");
  handlers.get("agent_end")({}, ctx);
  const result = handlers.get("before_agent_start")({}, ctx);
  assert.equal(result.message.details.seq, 1, "dropped steer: the next prompt attaches the block");
  assert.doesNotMatch(result.message.content, /Acknowledge/);
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
  workingMode({ on: (name, handler) => handlers.set(name, handler), registerCommand: (_name, value) => { command = value; }, registerTool() {}, events: { emit() {} } });
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
  assert.deepEqual(result.message.details, { schemaVersion: 2, seq: 1, selection: { ...defaults, checking: "Challenge" }, aligned: false });
});

// Drives the extension through fake Pi hooks so the alignment tool can be called directly.
function fakePi(branch = []) {
  const handlers = new Map();
  let command, tool;
  const snapshots = [];
  workingMode({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (_name, value) => { command = value; },
    registerTool: (value) => { tool = value; },
    events: { emit: (_name, value) => snapshots.push(value) },
  });
  const context = [];
  const ctx = {
    mode: "rpc", hasUI: false,
    sessionManager: { getBranch: () => [...branch, ...context], buildContextEntries: () => context },
    ui: { setStatus() {}, notify() {} },
  };
  handlers.get("session_start")({ reason: "startup" }, ctx);
  const prompt = () => {
    const result = handlers.get("before_agent_start")({}, ctx);
    if (result) context.push({ type: "custom_message", customType: result.message.customType, details: result.message.details });
    return result?.message;
  };
  const confirm = async () => {
    const result = await tool.execute("t1", { agreement: "ship X; check Y" }, undefined, undefined, ctx);
    context.push({ type: "message", message: { role: "toolResult", toolName: ALIGNMENT_TOOL, isError: false, details: result.details } });
    return result.content[0].text;
  };
  return { mode: (args) => command.handler(args, ctx), prompt, confirm, snapshots, tool };
}

test("AFK with an Alignment value stays interactive until alignment is reached", async () => {
  const s = fakePi();
  await s.mode("alignment align");
  await s.mode("attention afk");
  const preparing = s.prompt().content;
  assert.match(preparing, /Attention — AFK \(preparing\): AFK has not started/);
  assert.match(preparing, /five bullets[\s\S]*numbered list of every question[\s\S]*`alignment_reached`/);
  assert.doesNotMatch(preparing, /Do not contact Thomas/);

  assert.match(await s.confirm(), /^Alignment recorded\. AFK starts now: .*Do not contact Thomas/);
  assert.equal(s.snapshots.at(-1).aligned, true);
  const started = s.prompt().content;
  assert.match(started, /Alignment is reached\./);
  assert.match(started, /Attention — AFK: .*Do not contact Thomas/);
  assert.equal(s.prompt(), undefined, "unchanged state posts nothing");

  await s.mode("alignment plan");
  assert.match(s.prompt().content, /AFK \(preparing\)[\s\S]*persist the plan/);
});

test("AFK with Default Alignment starts immediately", async () => {
  const s = fakePi();
  await s.mode("attention afk");
  const block = s.prompt().content;
  assert.match(block, /Attention — AFK: .*Do not contact Thomas/);
  assert.doesNotMatch(block, /preparing/);
});

test("resume restores alignment from the latest alignment_reached result", () => {
  const selection = { ...defaults, alignment: "Spec", attention: "AFK" };
  const branch = [
    { type: "custom_message", customType: "working-mode", details: { schemaVersion: 2, seq: 1, selection, aligned: false } },
    { type: "message", message: { role: "toolResult", toolName: ALIGNMENT_TOOL, isError: false } },
  ];
  const s = fakePi(branch);
  assert.equal(s.snapshots.at(-1).aligned, true);
  assert.equal(fakePi(branch.slice(0, 1)).snapshots.at(-1).aligned, false);
});
