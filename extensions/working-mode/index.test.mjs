import assert from "node:assert/strict";
import test from "node:test";
import workingModeExtension from "./index.ts";

function harness(mode = "tui") {
  const events = new Map();
  const commands = new Map();
  const statuses = new Map();
  const notifications = [];
  const choices = [];
  const pickers = [];
  const ctx = {
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    ui: {
      setStatus: (key, value) => statuses.set(key, value),
      notify: (message, level) => notifications.push({ message, level }),
      select: async (title, values) => {
        pickers.push({ title, values });
        return choices.shift();
      },
    },
  };
  workingModeExtension({
    on: (name, handler) => events.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
  });
  const start = (reason = "startup") => events.get("session_start")({ reason }, ctx);
  const prompt = () => events.get("before_agent_start")({ systemPrompt: "Existing policy" }, ctx);
  const choose = async (...values) => {
    choices.push(...values);
    await commands.get("mode").handler("", ctx);
  };
  start();
  return { events, commands, statuses, notifications, choices, pickers, ctx, start, prompt, choose };
}

test("starts without a setup dialog; changes each axis independently for subsequent prompts", async () => {
  const h = harness();
  assert.equal(h.pickers.length, 0);
  assert.equal(h.statuses.get("working-mode"), "Alignment: Vibe · Checking: unset (guidance)");
  const first = h.prompt().systemPrompt;
  assert.match(first, /^Existing policy\n\n/);
  assert.match(first, /unset does not mean no checks/);

  await h.choose("Alignment: Vibe", "Plan");
  assert.match(h.prompt().systemPrompt, /Alignment: Plan\./);
  assert.match(h.prompt().systemPrompt, /Checking: unset\./);
  await h.choose("Checking: unset", "adversarial");
  assert.match(h.prompt().systemPrompt, /fresh independent challenge/);
  assert.match(h.prompt().systemPrompt, /Alignment: Plan\./);
  assert.equal(h.statuses.get("working-mode"), "Alignment: Plan · Checking: adversarial (guidance)");
  assert.match(h.notifications.at(-1).message, /Applies to the next prompt; not saved/);
  assert.match(first, /Alignment: Vibe\./, "the already-built prompt stays unchanged");
  assert.equal(h.prompt().systemPrompt.match(/# Working Mode/g).length, 1);
});

test("every choice has guidance, and unset clears the selected Checking floor", async () => {
  const h = harness();
  let previous = "Vibe";
  for (const [value, expected] of [
    ["Align", /ask the owner whether its direction is right/],
    ["Plan", /outcome, approach, boundaries, and evidence/],
    ["Spec", /required behavior, constraints, and acceptance evidence/],
    ["Vibe", /Work normally in chat/],
  ]) {
    await h.choose(`Alignment: ${previous}`, value);
    assert.match(h.prompt().systemPrompt, expected);
    assert.match(h.prompt().systemPrompt, /Checking: unset\./);
    previous = value;
  }
  previous = "unset";
  for (const [value, expected] of [
    ["light", /inspect or exercise the changed result directly/],
    ["tests", /run relevant automated tests/],
    ["adversarial", /fresh independent challenge/],
    ["unset", /No Checking floor is selected/],
  ]) {
    await h.choose(`Checking: ${previous}`, value);
    assert.match(h.prompt().systemPrompt, expected);
    assert.match(h.prompt().systemPrompt, /Alignment: Vibe\./);
    previous = value;
  }
  assert.doesNotMatch(h.prompt().systemPrompt, /obtain a fresh independent challenge/);
});

test("cancel, invalid selections, and unsupported arguments leave both choices unchanged", async () => {
  const h = harness();
  const original = h.prompt();
  for (const choices of [[undefined], ["Alignment: Vibe", undefined], ["Checking: unset", undefined],
    ["Alignment: Vibe", "toString"], ["Checking: unset", "bogus"]]) {
    await h.choose(...choices);
    assert.deepEqual(h.prompt(), original);
  }
  await h.commands.get("mode").handler("tests", h.ctx);
  assert.match(h.notifications.at(-1).message, /without arguments/);
  assert.deepEqual(h.prompt(), original);
});

test("resets on session start, reload, new, resume, and fork; does not own tools or persistence", async () => {
  const h = harness();
  assert.deepEqual([...h.events.keys()].sort(), ["before_agent_start", "session_start"]);
  for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
    await h.choose("Alignment: Vibe", "Spec");
    await h.choose("Checking: unset", "tests");
    h.start(reason);
    assert.equal(h.statuses.get("working-mode"), "Alignment: Vibe · Checking: unset (guidance)");
    assert.match(h.prompt().systemPrompt, /Alignment: Vibe\./);
    assert.match(h.prompt().systemPrompt, /Checking: unset\./);
  }
  assert.equal(harness().statuses.get("working-mode"), "Alignment: Vibe · Checking: unset (guidance)");
});

test("non-terminal sessions receive neither pickers nor mode prompt guidance", async () => {
  for (const mode of ["rpc", "print", "json"]) {
    const h = harness(mode);
    await h.choose();
    assert.equal(h.statuses.size, 0);
    assert.equal(h.pickers.length, 0);
    assert.equal(h.prompt(), undefined);
    assert.equal(h.notifications.length, mode === "rpc" ? 1 : 0);
  }
});
