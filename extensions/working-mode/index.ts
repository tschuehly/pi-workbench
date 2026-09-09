import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSkillsForPrompt, type ExtensionAPI, type ExtensionContext, type Skill } from "@earendil-works/pi-coding-agent";

const checkoutRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const manualOnly = new Set([
  "grilling", "domain-modeling", "to-spec", "autonomous-grill", "grill-with-docs", "handoff",
  "improve-codebase-architecture", "process-scan-inbox", "setup-matt-pocock-skills", "teach",
  "to-tickets", "triage", "wayfinder", "workbench-compound", "analyze-source-for-workbench",
  "marketing-studio", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help",
  "customize-pi-web-presentation",
]);
const adversarialOnly = new Set(["code-review", "ponytail-review"]);

function isInsideCheckout(cwd: string) {
  try {
    const current = realpathSync(cwd);
    return current === checkoutRoot || current.startsWith(`${checkoutRoot}${sep}`);
  } catch {
    return false;
  }
}

function filterSkillCatalog(systemPrompt: string, skills: Skill[], checking: keyof typeof checkingGuidance) {
  const catalog = formatSkillsForPrompt(skills);
  if (!catalog) return systemPrompt;
  const at = systemPrompt.indexOf(catalog);
  if (at < 0 || systemPrompt.indexOf(catalog, at + catalog.length) >= 0) return systemPrompt;

  const visible = skills.filter(({ name }) =>
    !manualOnly.has(name) &&
    (!adversarialOnly.has(name) || checking === "adversarial") &&
    (name !== "tdd" || checking === "tests" || checking === "adversarial")
  );
  return systemPrompt.slice(0, at) + formatSkillsForPrompt(visible) + systemPrompt.slice(at + catalog.length);
}

const alignmentGuidance = {
  Vibe: "Work normally in chat, aligning continuously without a separate artifact, extra pause boundary, or automatic mode switch.",
  Align: "Before one unconfirmed product, architecture, scope, or quality choice becomes durable implementation or parallel work, present the coherent change and ask the owner whether its direction is right. Proceed within accepted direction; ask again if evidence invalidates it or materially changes its consequences.",
  Plan: "Before implementing the task, obtain owner acceptance of its outcome, approach, boundaries, and evidence. Reuse accepted direction in this conversation; keep implementation details adaptive.",
  Spec: "Before implementing the task, obtain owner acceptance of required behavior, constraints, and acceptance evidence. Reuse accepted requirements in this conversation; implementation strategy may adapt.",
};
const checkingGuidance = {
  unset: "No Checking floor is selected by this control. Follow explicit owner direction, repository policy, and the task's consequences; unset does not mean no checks.",
  light: "Before claiming completion, inspect or exercise the changed result directly. This selection alone requires neither test-writing nor a separate review pass.",
  tests: "Before claiming completion, run relevant automated tests that prove the changed behavior and report the exact result.",
  adversarial: "Before claiming completion, produce relevant deterministic evidence, then obtain a fresh independent challenge against the result. Use model-orchestration for independent routing. If required evidence or independent challenge is unavailable, report the gap rather than claiming completion.",
};

export default function workingModeExtension(pi: ExtensionAPI) {
  let alignment: keyof typeof alignmentGuidance = "Vibe";
  let checking: keyof typeof checkingGuidance = "unset";

  function showStatus(ctx: ExtensionContext) {
    if (ctx.mode === "tui") {
      ctx.ui.setStatus("working-mode", `Alignment: ${alignment} · Checking: ${checking} (guidance)`);
    }
  }

  pi.on("session_start", (_event, ctx) => {
    alignment = "Vibe";
    checking = "unset";
    showStatus(ctx);
  });

  pi.registerCommand("mode", {
    description: "Choose Alignment and Checking guidance for the next prompt (not saved)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("/mode is available in the Pi terminal only.", "warning");
        return;
      }
      if (args.trim()) {
        ctx.ui.notify("Use /mode without arguments to open the picker.", "warning");
        return;
      }
      const axis = await ctx.ui.select("Working Mode — prompt guidance, not permissions", [
        `Alignment: ${alignment}`,
        `Checking: ${checking}`,
      ]);
      if (axis === `Alignment: ${alignment}`) {
        const value = await ctx.ui.select("Alignment — shared understanding", Object.keys(alignmentGuidance));
        if (!value || !Object.hasOwn(alignmentGuidance, value)) return;
        alignment = value as keyof typeof alignmentGuidance;
      } else if (axis === `Checking: ${checking}`) {
        const value = await ctx.ui.select("Checking — minimum completion evidence", Object.keys(checkingGuidance));
        if (!value || !Object.hasOwn(checkingGuidance, value)) return;
        checking = value as keyof typeof checkingGuidance;
      } else {
        return;
      }
      showStatus(ctx);
      ctx.ui.notify(`Alignment: ${alignment} · Checking: ${checking}. Applies to the next prompt; not saved.`, "info");
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    const systemPrompt = isInsideCheckout(event.systemPromptOptions.cwd)
      ? filterSkillCatalog(event.systemPrompt, event.systemPromptOptions.skills ?? [], checking)
      : event.systemPrompt;
    return {
      systemPrompt: `${systemPrompt}\n\n# Working Mode (prompt guidance)\nAlignment: ${alignment}. ${alignmentGuidance[alignment]}\nChecking: ${checking}. ${checkingGuidance[checking]}\nAlignment and Checking are independent. Preserve explicit owner direction and repository constraints; a selected Checking floor cannot silently remove required checks. These choices change behavior, not permissions, tool availability, authority, Human Attention, delegation, durability, or workspace protection. Keep accepted direction in the conversation rather than a separate mutable plan file.`,
    };
  });
}
