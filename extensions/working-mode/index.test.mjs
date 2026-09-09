import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AgentSession, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import workingModeExtension from "./index.ts";

const checkoutRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manualOnly = [
  "grilling", "domain-modeling", "to-spec", "autonomous-grill", "grill-with-docs", "handoff",
  "improve-codebase-architecture", "process-scan-inbox", "setup-matt-pocock-skills", "teach",
  "to-tickets", "triage", "wayfinder", "workbench-compound", "analyze-source-for-workbench",
  "marketing-studio", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help",
  "customize-pi-web-presentation",
];
const allModes = [
  "define-goal", "write-for-humans", "codebase-design", "prototype", "atelier", "btw",
  "focus-handoff", "workstreams", "writing-for-agents", "mcp-scripting", "monitor", "ponytail",
  "agent-browser", "diagnosing-bugs", "research", "wizard", "model-orchestration",
];
const mappedNames = [...manualOnly, "code-review", "ponytail-review", "tdd", ...allModes, "unknown-skill"];
const skills = mappedNames.map((name) => ({
  name,
  description: `${name} description`,
  filePath: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "temporary", origin: "top-level" },
  disableModelInvocation: false,
}));

function harness(mode = "tui", { cwd = checkoutRoot, loadedSkills = skills } = {}) {
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
    setActiveTools: () => assert.fail("working-mode must not change tools"),
  });
  const start = (reason = "startup") => events.get("session_start")({ reason }, ctx);
  const basePrompt = (catalogSkills = loadedSkills) => `PREFIX${formatSkillsForPrompt(catalogSkills)}\nSUFFIX`;
  const prompt = ({ systemPrompt = basePrompt(), prompt: userPrompt = "task" } = {}) => events.get("before_agent_start")({
    prompt: userPrompt,
    systemPrompt,
    systemPromptOptions: { cwd, skills: loadedSkills, selectedTools: ["read", "bash"] },
  }, ctx);
  const choose = async (...values) => {
    choices.push(...values);
    await commands.get("mode").handler("", ctx);
  };
  start();
  return { events, commands, statuses, notifications, choices, pickers, ctx, start, prompt, choose, basePrompt };
}

function catalogNames(prompt) {
  const catalog = prompt.match(/<available_skills>[\s\S]*?<\/available_skills>/)?.[0] ?? "";
  return [...catalog.matchAll(/<name>([^<]+)<\/name>/g)].map((match) => match[1]);
}

test("starts without a setup dialog; changes each axis independently for subsequent prompts", async () => {
  const h = harness();
  assert.equal(h.pickers.length, 0);
  assert.equal(h.statuses.get("working-mode"), "Alignment: Vibe · Checking: unset (guidance)");
  const first = h.prompt().systemPrompt;
  assert.match(first, /^PREFIX/);
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

test("all 4x4 dial states apply the reviewed skill mapping with independent axes", async () => {
  for (const alignment of ["Vibe", "Align", "Plan", "Spec"]) {
    for (const checking of ["unset", "light", "tests", "adversarial"]) {
      const h = harness();
      if (alignment !== "Vibe") await h.choose("Alignment: Vibe", alignment);
      if (checking !== "unset") await h.choose("Checking: unset", checking);
      const names = catalogNames(h.prompt().systemPrompt);

      assert.equal(manualOnly.length, 21);
      for (const name of manualOnly) assert.ok(!names.includes(name), `${name} hidden for ${alignment}/${checking}`);
      assert.equal(names.includes("code-review"), checking === "adversarial");
      assert.equal(names.includes("ponytail-review"), checking === "adversarial");
      assert.equal(names.includes("tdd"), checking === "tests" || checking === "adversarial");
      assert.equal(mappedNames.length - 1, 41);
      for (const name of [...allModes, "unknown-skill"]) assert.ok(names.includes(name), `${name} visible`);
      assert.match(h.prompt().systemPrompt, new RegExp(`Alignment: ${alignment}\\.`));
      assert.match(h.prompt().systemPrompt, new RegExp(`Checking: ${checking}\\.`));
    }
  }
});

test("fresh prompts restore filtered entries when Checking changes", async () => {
  const h = harness();
  assert.deepEqual(catalogNames(h.prompt().systemPrompt).filter((name) => ["code-review", "tdd"].includes(name)), []);
  await h.choose("Checking: unset", "tests");
  assert.deepEqual(catalogNames(h.prompt().systemPrompt).filter((name) => ["code-review", "tdd"].includes(name)), ["tdd"]);
  await h.choose("Checking: tests", "adversarial");
  assert.deepEqual(catalogNames(h.prompt().systemPrompt).filter((name) => ["code-review", "tdd"].includes(name)), ["code-review", "tdd"]);
  await h.choose("Checking: adversarial", "light");
  assert.deepEqual(catalogNames(h.prompt().systemPrompt).filter((name) => ["code-review", "tdd"].includes(name)), []);
});

test("filters only the exact generated catalog and preserves all other prompt bytes", () => {
  const h = harness();
  const result = h.prompt().systemPrompt;
  assert.ok(result.startsWith("PREFIX"));
  assert.ok(result.includes("\nSUFFIX\n\n# Working Mode"));

  for (const prose of [
    "prefix <available_skills><skill><name>grilling</name></skill> malformed prose suffix",
    "A repository note says grilling and <name>code-review</name>; leave it alone.",
  ]) {
    assert.ok(h.prompt({ systemPrompt: prose }).systemPrompt.startsWith(`${prose}\n\n# Working Mode`));
  }

  const duplicate = `${h.basePrompt()}${formatSkillsForPrompt(skills)}`;
  assert.ok(h.prompt({ systemPrompt: duplicate }).systemPrompt.startsWith(`${duplicate}\n\n# Working Mode`));
});

test("installation-level manual-only flags and absent catalogs stay unchanged", async () => {
  const installed = skills.map((skill) => Object.freeze({ ...skill, disableModelInvocation: skill.name === "model-orchestration" }));
  Object.freeze(installed);
  const h = harness("tui", { loadedSkills: installed });
  await h.choose("Checking: unset", "adversarial");
  assert.ok(!catalogNames(h.prompt().systemPrompt).includes("model-orchestration"));
  assert.ok(catalogNames(h.prompt().systemPrompt).includes("unknown-skill"));
  for (const loadedSkills of [[], installed.map((skill) => ({ ...skill, disableModelInvocation: true }))]) {
    const empty = harness("tui", { loadedSkills });
    assert.ok(empty.prompt().systemPrompt.startsWith(`${empty.basePrompt()}\n\n# Working Mode`));
  }
});

test("actual Pi skill expansion remains intact while its automatic catalog entry is hidden", () => {
  const dir = mkdtempSync(join(tmpdir(), "working-mode-skill-"));
  const filePath = join(dir, "SKILL.md");
  writeFileSync(filePath, "---\nname: grilling\ndescription: Explicit test\n---\n\n# Explicit body\nDo the explicit workflow.\n");
  const explicitSkill = { ...skills[0], filePath, baseDir: dir };
  const errors = [];
  try {
    assert.equal(typeof AgentSession.prototype._expandSkillCommand, "function", "Pi private skill-expansion API changed");
    const expanded = AgentSession.prototype._expandSkillCommand.call({
      resourceLoader: { getSkills: () => ({ skills: [explicitSkill] }) },
      _extensionRunner: { emitError: (error) => errors.push(error) },
    }, "/skill:grilling focus here");
    assert.match(expanded, /^<skill name="grilling"/);
    assert.match(expanded, /# Explicit body/);
    assert.match(expanded, /focus here$/);

    const h = harness("tui", { loadedSkills: [explicitSkill] });
    const result = h.prompt({ prompt: expanded });
    assert.deepEqual(catalogNames(result.systemPrompt), []);
    assert.match(expanded, /Do the explicit workflow/);
    assert.deepEqual(errors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope follows real paths: checkout descendants and aliases work; sibling and escaping paths do not", () => {
  const external = mkdtempSync(join(tmpdir(), "working-mode-external-"));
  const aliases = mkdtempSync(join(tmpdir(), "working-mode-aliases-"));
  const checkoutAlias = join(aliases, "checkout");
  const escapeDir = join(checkoutRoot, "extensions/working-mode", `.scope-escape-${process.pid}`);
  const escapeLink = join(escapeDir, "outside");
  symlinkSync(checkoutRoot, checkoutAlias, "dir");
  mkdirSync(escapeDir);
  symlinkSync(external, escapeLink, "dir");
  try {
    for (const cwd of [checkoutRoot, join(checkoutRoot, "packages"), checkoutAlias]) {
      assert.ok(!catalogNames(harness("tui", { cwd }).prompt().systemPrompt).includes("grilling"), `filtered: ${cwd}`);
    }
    for (const cwd of [`${checkoutRoot}.credential-broker`, external, escapeLink]) {
      const result = harness("tui", { cwd }).prompt().systemPrompt;
      assert.ok(catalogNames(result).includes("grilling"), `isolated: ${cwd}`);
      assert.match(result, /# Working Mode/, "existing /mode guidance remains outside the trial scope");
    }
  } finally {
    rmSync(escapeDir, { recursive: true, force: true });
    rmSync(aliases, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
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

test("resets on session replacement and reload without owning tools or persistence", async () => {
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
});

test("non-terminal sessions receive neither filtering, pickers, nor mode prompt guidance", async () => {
  for (const mode of ["rpc", "print", "json"]) {
    const h = harness(mode);
    await h.choose();
    assert.equal(h.statuses.size, 0);
    assert.equal(h.pickers.length, 0);
    assert.equal(h.prompt(), undefined);
    assert.equal(h.notifications.length, mode === "rpc" ? 1 : 0);
  }
});
