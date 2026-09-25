import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const axes = {
  alignment: {
    label: "Alignment",
    values: {
      Default: "",
      Align: "For nontrivial work, check shared understanding: surface consequential assumptions, resolve important ambiguities, and agree the outcome, scope, and success criteria. Reuse what Thomas has already confirmed; record lasting decisions in existing documentation.",
      Plan: "Before implementation, persist a plan with the outcome, approach, boundaries, and evidence, then obtain Thomas's acceptance. Reuse the accepted plan and adapt ordinary tactics within it.",
      Spec: "Before implementation, persist a specification with user stories, required behavior, constraints, and acceptance criteria, then obtain Thomas's acceptance. Reuse the accepted specification; adapt implementation within its criteria.",
    },
  },
  attention: {
    label: "Attention",
    values: {
      Default: "",
      Focused: "Thomas is following the session conversation; ask there promptly when a quick answer improves direction.",
      Switching: "Thomas moves among sessions but remains available; batch questions in the session conversation and make each self-contained so he can answer without rereading the session.",
      Phone: "Thomas is away from the session conversation but reachable by phone. This setting, not a guess about his presence, selects the phone channel. Ask every question through `ask_human`, never in the session conversation; ask only real blockers and make each question concise and self-contained. When a milestone finishes or you stop to wait, send one `notify_human` update; use it only for updates that need no answer. Start the first line with `❓` for a question or `ℹ️` for an update. Batch open decisions into one `ask_human` call with a numbered list and a safe default per item. Give every `ask_human` call a finite `timeoutMs` matched to the response window; state the fallback when timeout matters.",
      AFK: "Before treating a choice as blocked, recheck the agreed goal and success criteria. For a material doubt, ask an advisor to challenge the assumption or find an in-scope route; an advisor cannot approve a different goal. Continue with a changed approach only if it preserves the agreed outcome, behavior, scope, and success criteria; record the reason in an accepted plan or specification when one exists. If advice is unavailable or unclear, use only a low-cost, reversible local step within those bounds; record uncertainty and how to undo it. With advisor backing, decide product, architecture, scope, or quality questions the agreement leaves open; record the decision, the advice, and how to undo it. Do not contact Thomas. If no advisor is available and no reversible in-scope step remains, list the question for Thomas's return, pause affected work, and continue independent work.",
    },
  },
  checking: {
    label: "Checking",
    values: {
      Default: "",
      Exercise: "Inspect or exercise the changed result directly and report the evidence. Apply stronger checks required by Thomas, the repository, or the task; report any evidence gap.",
      Test: "Produce automated proof of the changed behavior, adding a relevant test when needed, and report the exact result. Apply stronger required checks; report any evidence gap.",
      Challenge: "Prove the changed behavior with an automated check, adding a test when needed, and report its exact result. Then obtain fresh independent scrutiny and report unresolved findings and evidence gaps. Apply stronger required checks.",
    },
  },
  orchestration: {
    label: "Orchestration",
    values: {
      Main: "Perform the primary work in the main session. Required advisors and independent checks remain available.",
      Subagents: "Delegate a bounded task when isolation, volume, or an independent check helps; reconcile the result. Keep trivial work in the main session.",
      Workers: "Use a scope-owning worker when repeated bounded tasks benefit from retained context. A worker may delegate only to a leaf subagent; continuity is not independent review. Keep trivial work in the main session.",
    },
  },
} as const;

type Axes = typeof axes;
export type Axis = keyof Axes;
export type WorkingModeState = { [A in Axis]: keyof Axes[A]["values"] };
export type WorkingModeSnapshot = {
  schemaVersion: 2;
  phase: "selected" | "applied";
  selected: WorkingModeState;
  applied: WorkingModeState | null;
};
export type WorkingModeDetails = { schemaVersion: 2; seq: number; selection: WorkingModeState };

export const CUSTOM_TYPE = "working-mode";
export const defaults: WorkingModeState = { alignment: "Default", attention: "Default", checking: "Default", orchestration: "Main" };
const axisNames = Object.keys(axes) as Axis[];
const usage = `/mode <axis> <value>: ${axisNames.map((axis) => `${axis} <${Object.keys(axes[axis].values).join("|").toLowerCase()}>`).join(" · ")}`;

export function isSelection(value: any): value is WorkingModeState {
  return !!value && axisNames.every((axis) => typeof value[axis] === "string" && Object.hasOwn(axes[axis].values, value[axis]));
}

const same = (a: WorkingModeState, b: WorkingModeState) => axisNames.every((axis) => a[axis] === b[axis]);

/** Latest Working Mode block among the given entries, or null. */
function latestBlock(entries: readonly any[]): WorkingModeDetails | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "custom_message" && entry.customType === CUSTOM_TYPE && isSelection(entry.details?.selection)) return entry.details;
  }
  return null;
}

export function renderBlock(selection: WorkingModeState, seq: number) {
  const summary = axisNames.map((axis) => `${axes[axis].label}: ${selection[axis]}`).join(" · ");
  const guidance = axisNames
    .filter((axis) => selection[axis] !== defaults[axis])
    .map((axis) => `${axes[axis].label} — ${selection[axis]}: ${(axes[axis].values as Record<string, string>)[selection[axis]]}`);
  return [
    `<working-mode seq="${seq}">`,
    `Thomas selected Working Mode ${summary}.`,
    guidance.length
      ? "This is behavior guidance, not permission; explicit owner direction and repository instructions still apply.\n\n" + guidance.join("\n\n")
      : "Every value is at its starting setting; no Working Mode guidance applies.",
    "",
    "This block replaces every earlier <working-mode> block.",
    "</working-mode>",
  ].join("\n");
}

export default function workingModeExtension(pi: ExtensionAPI) {
  let selected: WorkingModeState = { ...defaults };
  let applied: WorkingModeState | null = null;

  const publish = (ctx: ExtensionContext, phase: WorkingModeSnapshot["phase"]) => {
    const value: WorkingModeSnapshot = { schemaVersion: 2, phase, selected: { ...selected }, applied };
    pi.events?.emit("pi-workbench:working-mode", value);
    ctx.ui.setStatus("working-mode", ctx.mode === "tui"
      ? axisNames.map((axis) => `${axes[axis].label}: ${selected[axis]}`).join(" · ")
      : JSON.stringify(value));
  };

  function applyArgs(args: string) {
    const [name, value, ...extra] = args.trim().toLowerCase().split(/\s+/);
    const axis = name as Axis;
    if (extra.length || !axisNames.includes(axis)) return false;
    const match = Object.keys(axes[axis].values).find((candidate) => candidate.toLowerCase() === value);
    if (!match) return false;
    selected = { ...selected, [axis]: match };
    return true;
  }

  pi.on("session_start", (_event, ctx) => {
    selected = { ...(latestBlock(ctx.sessionManager.getBranch())?.selection ?? defaults) };
    applied = null;
    publish(ctx, "selected");
  });

  pi.registerCommand("mode", {
    description: "Choose Working Mode guidance for the next prompt",
    handler: async (args, ctx) => {
      if (args.trim()) {
        if (!applyArgs(args)) {
          if (ctx.hasUI) ctx.ui.notify(usage, "warning");
          return;
        }
      } else if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify(usage, "info");
        return;
      } else {
        const choice = await ctx.ui.select("Working Mode — guidance, not permissions", axisNames.map((axis) => `${axes[axis].label}: ${selected[axis]}`));
        const axis = axisNames.find((name) => choice === `${axes[name].label}: ${selected[name]}`);
        if (!axis) return;
        const value = await ctx.ui.select(axes[axis].label, Object.keys(axes[axis].values));
        if (!value || !Object.hasOwn(axes[axis].values, value)) return;
        selected = { ...selected, [axis]: value };
      }
      publish(ctx, "selected");
      if (ctx.mode === "tui") ctx.ui.notify("Working Mode applies with the next prompt.", "info");
    },
  });

  pi.on("before_agent_start", (_event, ctx) => {
    applied = { ...selected };
    publish(ctx, "applied");
    // Compare with the block the model can still see; compaction may have summarized it away.
    const seen = latestBlock(ctx.sessionManager.buildContextEntries())?.selection ?? defaults;
    if (same(seen, selected)) return;
    const seq = (latestBlock(ctx.sessionManager.getBranch())?.seq ?? 0) + 1;
    const details: WorkingModeDetails = { schemaVersion: 2, seq, selection: { ...selected } };
    return { message: { customType: CUSTOM_TYPE, content: renderBlock(selected, seq), display: true, details } };
  });
}
