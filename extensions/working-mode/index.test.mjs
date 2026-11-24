import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import workingMode, { axes, defaults, renderBlock, ALIGNMENT_TOOL, ALIGNMENT_RESET_TOOL, AFK_BATTERY_WARNING, AFK_CLOSE_PROMPT, BACK_PROMPT, openAsks } from "./index.ts";

import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Fake power and alarm binaries for the whole file, so AFK tests never sound the real alarm on battery.
const bin = mkdtempSync(join(process.env.PI_TMP ?? tmpdir(), "pmset-"));
const power = join(bin, "power");
const calls = join(bin, "calls");
const dialog = join(bin, "dialog");
writeFileSync(power, "AC Power");
writeFileSync(calls, "");
writeFileSync(join(bin, "pmset"), `#!/bin/sh\necho "Now drawing from '$(cat ${power})'"\n`);
for (const name of ["afplay", "say"]) writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> ${calls}\n`);
writeFileSync(join(bin, "osascript"), `#!/bin/sh\necho osascript >> ${calls}\necho "$@" > ${dialog}\n`);
writeFileSync(join(bin, "pgrep"), "#!/bin/sh\nexit 1\n");
for (const name of ["pmset", "afplay", "say", "osascript", "pgrep"]) chmodSync(join(bin, name), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const cwd = "/tmp/working-mode-test";
const agentDir = `${cwd}/agent`;

// A real Pi session with a scripted model: records every request the model receives.
// `gate`, when given, holds the first reply open until it resolves so a test can act mid-run.
// `respond`, when given, picks each reply from the request count; the default answers "ok".
async function session(entries, gate, { factories = [], tools, respond, keepRecentTokens = 1 } = {}) {
  const faux = fauxProvider();
  const requests = [];
  const reply = async (context) => {
    requests.push(context);
    if (gate && requests.length === 1) await gate;
    return respond?.(requests.length) ?? fauxAssistantMessage("ok");
  };
  faux.setResponses(Array.from({ length: 20 }, () => reply));
  const snapshots = [];
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens } });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, systemPrompt: "BASE",
    noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [(pi) => {
      pi.registerProvider(faux.provider);
      pi.events.on("pi-workbench:working-mode", (value) => snapshots.push(value));
    }, ...factories, workingMode],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ authPath: `${agentDir}/auth.json`, modelsPath: null, refreshOnCreate: false });
  const sessionManager = entries ? SessionManager.inMemory(cwd, undefined, entries) : SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, resourceLoader, settingsManager, sessionManager, model: faux.getModel(), ...(tools ? { tools } : { noTools: "all" }),
    sessionStartEvent: { type: "session_start", reason: entries ? "resume" : "startup" },
  });
  await session.bindExtensions({});
  const blocks = (request) => request.messages
    .map((message) => typeof message.content === "string" ? message.content : message.content?.map?.((part) => part.text ?? "").join("") ?? "")
    .filter((text) => text.startsWith("<working-mode"));
  const last = () => requests.at(-1);
  return { session, sessionManager, requests, snapshots, blocks, last, entries: () => [sessionManager.getHeader(), ...sessionManager.getEntries()] };
}

// Runs first: later tests leave real AFK sessions whose late turns would alarm under the fake battery.
test("AFK on battery alarms once a turn runs; AC, preparing, restored, and non-AFK sessions stay quiet", async () => {
  const alarms = () => readFileSync(calls, "utf8").split("\n").filter(Boolean).sort();
  writeFileSync(calls, "");
  try {
    const handlers = new Map();
    let command;
    const warnings = [];
    workingMode({ on: (name, handler) => handlers.set(name, handler), registerCommand: (_name, value) => { command = value; }, registerTool() {}, events: { emit() {} } });
    const ctx = {
      mode: "rpc", hasUI: true, cwd: "/work/DataRecovery", isIdle: () => false, hasPendingMessages: () => false,
      sessionManager: { getBranch: () => [], buildContextEntries: () => [], getSessionId: () => "s-1", getSessionName: () => 'Nightly "merge"' },
      ui: { setStatus() {}, notify: (text, level) => warnings.push([level, text]) },
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));
    const turn = () => handlers.get("before_agent_start")({}, ctx);

    // A session restored with an old AFK selection stays quiet until a turn runs.
    writeFileSync(power, "Battery Power");
    const afkBlock = { type: "custom_message", customType: "working-mode", details: { schemaVersion: 2, seq: 1, selection: { ...defaults, attention: "AFK" }, aligned: false } };
    handlers.get("session_start")({ reason: "startup" }, { ...ctx, sessionManager: { getBranch: () => [afkBlock], buildContextEntries: () => [afkBlock] } });
    await settle();
    assert.deepEqual(alarms(), []);
    await command.handler("attention default", ctx);

    // Non-AFK turns and AFK still preparing alignment stay quiet.
    turn();
    await command.handler("alignment align", ctx);
    await command.handler("attention afk", ctx);
    turn();
    await settle();
    assert.deepEqual(alarms(), []);
    await command.handler("alignment default", ctx);

    writeFileSync(power, "AC Power");
    turn();
    await settle();
    assert.deepEqual(warnings, []);
    assert.deepEqual(alarms(), []);

    await command.handler("attention default", ctx);
    writeFileSync(power, "Battery Power");
    await command.handler("attention afk", ctx);
    turn();
    // The dialog spawns only after pgrep finds none: wait for all three, not a fixed second.
    for (const until = Date.now() + 10_000; alarms().length < 3 && Date.now() < until;) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(warnings, [["error", AFK_BATTERY_WARNING]]);
    assert.deepEqual(alarms(), ["afplay", "osascript", "say"]);
    // The dialog names the session to switch, with quotes stripped so AppleScript stays valid.
    assert.match(readFileSync(dialog, "utf8"), /AFK session: Nightly merge \(DataRecovery\)[\s\S]*-- pi-workbench-afk-battery-s-1/);

    // Switching Attention away from AFK stops the repeating alarm, even mid-turn.
    const cleared = [];
    const realClear = globalThis.clearInterval;
    globalThis.clearInterval = (timer) => { if (timer) cleared.push(timer); realClear(timer); };
    try { await command.handler("attention switching", ctx); } finally { globalThis.clearInterval = realClear; }
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0]._destroyed, true);

    // A session disposed without session_shutdown leaves a stale ctx; the next check stops the alarm.
    let stale = false;
    const staleCtx = { ...ctx, get hasUI() { if (stale) throw new Error("stale"); return true; } };
    const realSet = globalThis.setInterval;
    let tick;
    globalThis.setInterval = (fn, ms) => { tick = fn; return realSet(fn, ms); };
    try {
      await command.handler("attention afk", staleCtx);
      handlers.get("before_agent_start")({}, staleCtx);
    } finally { globalThis.setInterval = realSet; }
    await settle();
    stale = true;
    const stopped = [];
    globalThis.clearInterval = (timer) => { if (timer) stopped.push(timer); realClear(timer); };
    try { await tick(); } finally { globalThis.clearInterval = realClear; }
    assert.equal(stopped.length, 1);
    handlers.get("session_shutdown")();
  } finally {
    writeFileSync(power, "AC Power");
  }
});

test("the AFK battery alarm sounds only while work runs: a turn, queued input, a delegate or a background bash job", async () => {
  const alarms = () => readFileSync(calls, "utf8").split("\n").filter(Boolean).sort();
  const loud = ["afplay", "osascript", "say"];
  const sounded = async () => {
    for (const until = Date.now() + 10_000; alarms().length < 3 && Date.now() < until;) await new Promise((resolve) => setTimeout(resolve, 50));
    return alarms();
  };
  const quiet = async () => { await new Promise((resolve) => setTimeout(resolve, 300)); return alarms(); };
  writeFileSync(calls, "");
  const handlers = new Map();
  const listeners = [];
  let command;
  const warnings = [];
  workingMode({
    on: (name, handler) => handlers.set(name, handler), registerCommand: (_name, value) => { command = value; }, registerTool() {},
    events: { emit() {}, on: (channel, listener) => channel === "pi-workbench:activity" && listeners.push(listener) },
  });
  const activity = (event) => listeners.forEach((listener) => listener(event));
  let idle = false;
  let pending = false;
  const ctx = {
    mode: "rpc", hasUI: true, cwd: "/work/Idle", isIdle: () => idle, hasPendingMessages: () => pending,
    sessionManager: { getBranch: () => [], buildContextEntries: () => [], getSessionId: () => "s-2", getSessionName: () => undefined },
    ui: { setStatus() {}, notify: (text, level) => warnings.push([level, text]) },
  };
  const realSet = globalThis.setInterval;
  let tick;
  globalThis.setInterval = (fn, ms) => { tick = fn; return realSet(fn, ms); };
  try {
    writeFileSync(power, "Battery Power");
    await command.handler("attention afk", ctx);
    // (2) A running turn on battery alarms.
    handlers.get("before_agent_start")({}, ctx);
    assert.deepEqual(await sounded(), loud);
    assert.equal(warnings.length, 1);

    // (1) Idle after agent_end: the next tick stays quiet.
    idle = true;
    handlers.get("agent_end")();
    writeFileSync(calls, "");
    await tick();
    assert.deepEqual(await quiet(), [], "an idle AFK session does not alarm");

    // (3) A running delegate with no turn alarms; (4) its end stops the alarm.
    activity({ type: "upsert", item: { id: "delegate:e-1", kind: "subagent", startedAt: "2026-11-23T00:00:00.000Z" } });
    await tick();
    assert.deepEqual(await sounded(), loud, "a running Subagent keeps the alarm");
    assert.equal(warnings.length, 2, "the in-app warning re-arms when work starts again");
    writeFileSync(calls, "");
    activity({ type: "upsert", item: { id: "delegate:e-1", kind: "subagent", endedAt: "2026-11-23T00:01:00.000Z" } });
    await tick();
    assert.deepEqual(await quiet(), [], "an ended delegate does not count");

    // (3) A background bash job with no turn alarms; (4) its removal stops the alarm.
    activity({ type: "upsert", item: { id: "background-bash:job-1", kind: "shell", activity: "running" } });
    await tick();
    assert.deepEqual(await sounded(), loud, "a background bash job keeps the alarm");
    writeFileSync(calls, "");
    activity({ type: "remove", id: "background-bash:job-1" });
    await tick();
    assert.deepEqual(await quiet(), [], "a finished job does not count");

    // Queued input counts as work.
    pending = true;
    await tick();
    assert.deepEqual(await sounded(), loud, "queued input keeps the alarm");
    pending = false;
    handlers.get("session_shutdown")();
  } finally {
    globalThis.setInterval = realSet;
    writeFileSync(power, "AC Power");
  }
});

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
  assert.match(block, /When Thomas writes in the session conversation, he is temporarily at his computer: answer and ask there \(decisions via `ask_user`\) for as long as he replies there; only after a conversation question stays unanswered for 15 minutes do new questions and milestone updates go by phone again\./);
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

test("Orchestration Cockpit posts the Cockpit guidance: one worker per Workstream, questions on the Page", async () => {
  const s = await session();
  await s.session.prompt("/mode orchestration cockpit");
  await s.session.prompt("one");
  const [block] = s.blocks(s.last());
  assert.match(block, /Orchestration: Cockpit/);
  assert.match(block, /Orchestration — Cockpit: .*one durable worker/);
  assert.match(block, /one tab per worker/);
  assert.match(block, /~\/\.pi-workbench\/workers\/status\/<workerId>\.json/);
  assert.match(block, /Every Decision stands alone/);
  assert.match(block, /as a Page Decision/);
  assert.match(block, /Workers never post/);
  assert.deepEqual(s.snapshots.at(-1).selected, { ...defaults, orchestration: "Cockpit" });
  s.session.dispose();
});

test("Cockpit sets where questions live; Attention alone decides whether and how Thomas is contacted", () => {
  const cockpit = axes.orchestration.values.Cockpit;
  // No unconditional ping: every outward contact line defers to the Attention axis.
  assert.doesNotMatch(cockpit, /post one line in Chat/);
  assert.match(cockpit, /follows your Attention setting/);
  assert.match(cockpit, /send nothing when it says not to contact him/);
  // Every Attention value leaves a named channel (or a named silence) for the tab-changed line.
  const channel = {
    Default: /the conversation, when Attention names none/,
    Focused: /this conversation/,
    Switching: /request_attention/,
    Phone: /notify_human/,
    AFK: /Do not contact Thomas/,
  };
  assert.deepEqual(Object.keys(axes.attention.values), Object.keys(channel), "every Attention value is covered");
  for (const attention of Object.keys(axes.attention.values)) {
    const block = renderBlock({ ...defaults, attention, orchestration: "Cockpit" }, 1, true);
    assert.ok(block.includes(cockpit), attention);
    assert.ok(block.includes(axes.attention.values[attention]), attention);
    assert.match(block, channel[attention], attention);
    // Attention's own question channel (ask_user, ask_human, Chat) yields to the Page explicitly, not silently.
    if (/ask_user|ask_human/.test(axes.attention.values[attention])) assert.match(cockpit, /instead of the question channel your Attention setting names/, attention);
  }
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

test("Test and Challenge require seeing each new check fail", () => {
  for (const value of ["Test", "Challenge"]) assert.match(axes.checking.values[value], /check failing on the unfixed or deliberately broken code, or say why you could not/);
});

test("Challenge names the blind review pair, author swaps, and the Muse fallback", () => {
  const text = axes.checking.values.Challenge;
  assert.match(text, /two background `review` subagents with the same brief, blind to each other/);
  assert.match(text, /`openai\/gpt-6\.2-sol`[\s\S]*`meta\/muse-ember-1\.0`, both at high/);
  assert.match(text, /OpenAI author use `anthropic\/claude-opus-5-5` instead of Sol; for a Meta author use Opus instead of Ember/);
  assert.match(text, /When Ember is in the pair and Muse quota is below its floor or Ember fails to launch or is rate-limited, run the other reviewer alone and say so in the report/);
  assert.ok(text.indexOf("for a Meta author use Opus instead of Ember") < text.indexOf("When Ember is in the pair"), "the fallback follows the swap, so a Meta author's Sol+Opus pair has none");
  assert.match(text, /note which reviewer found each/);
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
  let command;
  const tools = {};
  const snapshots = [];
  const sent = [];
  workingMode({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (_name, value) => { command = value; },
    registerTool: (value) => { tools[value.name] = value; },
    sendMessage: (message) => sent.push(message),
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
  const call = async (name, params) => {
    const result = await tools[name].execute("t1", params, undefined, undefined, ctx);
    context.push({ type: "message", message: { role: "toolResult", toolName: name, isError: false, details: result.details } });
    return result.content[0].text;
  };
  const confirm = () => call(ALIGNMENT_TOOL, { agreement: "ship X; check Y" });
  const reset = () => call(ALIGNMENT_RESET_TOOL, { reason: "new task Z" });
  return { mode: (args) => command.handler(args, ctx), prompt, confirm, reset, snapshots, sent };
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
  assert.match(started, /Alignment is reached\. When Thomas changes the scope or direction, call `alignment_reset` before continuing\./);
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

test("the agent can reset alignment for a new task", async () => {
  const s = fakePi();
  await s.mode("alignment align");
  await s.mode("attention afk");
  s.prompt();
  await s.confirm();
  s.prompt();
  assert.match(await s.reset(), /^Alignment cleared\. AFK has not started[\s\S]*five bullets/);
  assert.equal(s.snapshots.at(-1).aligned, false);
  assert.match(s.prompt().content, /AFK \(preparing\)/);
});

test("resume after a reset restores unaligned state", () => {
  const selection = { ...defaults, alignment: "Align", attention: "AFK" };
  const branch = [
    { type: "custom_message", customType: "working-mode", details: { schemaVersion: 2, seq: 1, selection, aligned: false } },
    { type: "message", message: { role: "toolResult", toolName: ALIGNMENT_TOOL, isError: false } },
    { type: "message", message: { role: "toolResult", toolName: ALIGNMENT_RESET_TOOL, isError: false } },
  ];
  assert.equal(fakePi(branch).snapshots.at(-1).aligned, false);
});

test("ask_user stays offered to the model in every Attention value", async () => {
  const askUser = (pi) => pi.registerTool({ name: "ask_user", label: "Ask", description: "ask", parameters: { type: "object", properties: {} }, async execute() { return { content: [] }; } });
  const s = await session(undefined, undefined, { factories: [askUser], tools: ["ask_user"] });
  const offered = () => s.session.getActiveToolNames().includes("ask_user");
  await s.session.prompt("default");
  assert.equal(offered(), true);
  await s.session.prompt("/mode attention switching");
  await s.session.prompt("switching");
  assert.equal(offered(), true);
  await s.session.prompt("/mode attention focused");
  await s.session.prompt("focused");
  assert.equal(offered(), true);
  s.session.dispose();
});


test("Thomas can reset alignment himself with /mode unalign, and the agent hears it at once", async () => {
  const s = fakePi();
  await s.mode("alignment align");
  s.prompt();
  await s.confirm();
  assert.equal(s.snapshots.at(-1).aligned, true);
  await s.mode("unalign");
  assert.equal(s.snapshots.at(-1).aligned, false);
  const sent = s.sent.at(-1);
  assert.doesNotMatch(sent.content, /Alignment is reached/);
  assert.match(sent.content, /Acknowledge this change/);
});

const text = (message) => typeof message.content === "string" ? message.content : message.content?.map?.((part) => part.text ?? "").join("") ?? "";
const until = async (check) => { for (let i = 0; i < 200 && !check(); i++) await tick(); assert.ok(check(), "timed out"); };
const ask = (askId, questions, context) => ({ askId, askedAt: "t", updatedAt: "t", revision: "r", context, questions });
const question = (id, extra = {}) => ({ id, question: `Question ${id}?`, options: [], ...extra });
const posted = (sessionId, value) => ({ type: "message", message: { role: "toolResult", toolName: "ask_user", isError: false, details: { sessionId, ask: value } } });

test("open question sets follow PI WEB's transcript rules: posts, revisions, withdrawals, partial and full closes, other sessions", () => {
  const branch = [
    posted("me", ask("a1", [question("x"), question("y")])),
    posted("me", ask("a2", [question("z")])),
    posted("me", ask("a3", [question("w")])),
    posted("other", ask("a4", [question("v")])),
    posted("me", ask("a5", [question("u")])),
    posted("me", ask("a1", [question("x"), question("y", { question: "Revised y?" })])),
    { type: "custom", customType: "pi-web.ask.closed", data: { askId: "a1", reason: "submitted", partial: true, revision: "r2", questions: [{ question: { id: "x" } }] } },
    { type: "custom", customType: "pi-web.ask.closed", data: { askId: "a2", reason: "submitted", questions: [] } },
    { type: "message", message: { role: "toolResult", toolName: "ask_user", isError: false, details: { withdrawn: { askId: "a3" } } } },
    { type: "custom_message", customType: "pi-web.ask.answers", details: { askId: "a5" } },
  ];
  assert.deepEqual(openAsks(branch, "me").map((open) => [open.askId, open.questions.map((q) => q.question)]), [["a1", ["Revised y?"]]]);
});

test("/back clears the context to the checkpoint pointer and open questions, resets Working Mode, and orients", async () => {
  const s = await session();
  await s.session.prompt("/mode alignment align");
  await s.session.prompt("/mode attention afk");
  await s.session.prompt("old work one");
  await s.session.prompt("old work two");
  const id = s.sessionManager.getSessionId();
  s.sessionManager.appendMessage({ role: "toolResult", toolCallId: "c1", toolName: "ask_user", content: [], isError: false, timestamp: Date.now(),
    details: { sessionId: id, ask: ask("f0e4481d", [question("route", { detail: "Same session or new?", options: [{ value: "compact", label: "Compact", recommended: true }] })], "Going AFK and back") } });
  const before = s.requests.length;
  await s.session.prompt("/back");
  await until(() => s.requests.length > before);
  const context = s.last().messages.map(text).join("\n");
  assert.doesNotMatch(context, /old work/);
  assert.match(context, /run `workstreams` to find it/);
  assert.match(context, /Question set f0e4481d[\s\S]*Going AFK and back[\s\S]*route: Question route\?[\s\S]*Same session or new\?[\s\S]*`compact` Compact \(recommended\)/);
  assert.ok(context.endsWith(BACK_PROMPT));
  assert.equal(s.blocks(s.last()).length, 0);
  assert.deepEqual(s.snapshots.at(-1).selected, defaults);
  assert.equal(s.snapshots.at(-1).aligned, false);
  // The session file keeps the removed conversation.
  assert.ok(s.sessionManager.getEntries().some((entry) => entry.type === "message" && text(entry.message) === "old work one"));
  s.session.dispose();
});

test("/back on a session too small to compact keeps the context and still orients", async () => {
  const s = await session(undefined, undefined, { keepRecentTokens: 100_000 });
  await s.session.prompt("/mode attention afk");
  await s.session.prompt("old work");
  const before = s.requests.length;
  await s.session.prompt("/back");
  await until(() => s.requests.length > before);
  const context = s.last().messages.map(text).join("\n");
  assert.match(context, /old work/);
  assert.ok(context.endsWith(BACK_PROMPT));
  assert.deepEqual(s.snapshots.at(-1).selected, defaults);
  s.session.dispose();
});

test("AFK asks once for a closing checkpoint when it settles idle after unsaved work", async () => {
  const noop = (pi) => pi.registerTool({ name: "noop", label: "Noop", description: "noop", parameters: { type: "object", properties: {} }, async execute() { return { content: [{ type: "text", text: "done" }] }; } });
  // Each prompt's first reply calls the tool with the prompt's command, then the model answers "ok".
  const run = async (attention, command) => {
    let calls = 0;
    const s = await session(undefined, undefined, { factories: [noop], tools: ["noop"],
      respond: (n) => n === 2 && calls++ === 0 ? fauxAssistantMessage([fauxToolCall("noop", { command })], { stopReason: "toolUse" }) : undefined });
    await s.session.prompt(`/mode attention ${attention}`);
    await s.session.prompt("start");
    await s.session.prompt("work");
    for (let i = 0; i < 30; i++) await tick();
    const nudges = s.requests.filter((request) => request.messages.some((message) => text(message) === AFK_CLOSE_PROMPT)).length;
    s.session.dispose();
    return { nudges, requests: s.requests.length };
  };
  const afk = await run("afk", "git status");
  assert.equal(afk.nudges, 1);
  assert.equal(afk.requests, 4); // start, work + tool result, one nudge run; the nudge run does not nudge again
  assert.equal((await run("afk", "workstreams checkpoint ws-1 --title x")).nudges, 0);
  assert.equal((await run("focused", "git status")).nudges, 0);
});
