import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const axes = {
  alignment: {
    label: "Alignment",
    values: {
      Default: "",
      Align: "Investigate freely, but before the first edit, delegation, or long-running job on nontrivial work, stop and confirm shared understanding: state the outcome, scope, consequential assumptions, and how success will be checked in at most five bullets, ask Thomas to confirm or correct them, and wait for his answer. Do not ask again about what he already confirmed. After confirmation, implement one bounded slice and return with evidence before starting the next. Record lasting decisions in existing documentation.",
      Plan: "Before implementation, persist a plan with the outcome, approach, boundaries, and evidence, then obtain Thomas's acceptance and wait for it before editing code. Reuse the accepted plan and adapt ordinary tactics within it.",
      Spec: "Before implementation, persist a specification with user stories, required behavior, constraints, and acceptance criteria, then obtain Thomas's acceptance and wait for it before editing code. Reuse the accepted specification; adapt implementation within its criteria.",
    },
  },
  attention: {
    label: "Attention",
    values: {
      Default: "",
      Focused: "Thomas is watching this conversation now. Work in short steps and report each meaningful finding or step in a few lines. Ask in the conversation as soon as a question arises, one question at a time, instead of guessing or batching; keep working on anything the question does not affect. Do not use phone tools.",
      Switching: "Thomas works in other sessions and reads this one only occasionally. Do not interrupt for single questions: keep working on everything an open decision does not block, and write only when blocked or finished. Then send one conversation message: a one-line status, then a numbered list of open decisions, each with the context needed and a recommended default, so he can answer like \"1 yes, 2 b\" without rereading the session. Do not use phone tools.",
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
      Subagents: "Parallelize by default; this overrides any general preference to work inline. Before each task, split it into independent parts such as research questions, files, modules, or checks. When two or more exist, launch them as parallel background subagents in the same turn. Also delegate mechanical volume such as bulk reading, scans, and broad edits. Keep the main session for steering, integration, and talking with Thomas; do inline only what is smaller than writing its brief.",
      Workers: "Organize multi-step work around durable workers; this overrides any general preference for fresh subagents. At the start, name the scopes that will receive repeated tasks, such as a module, repository area, or review lane, create one worker per scope, and route every task in that scope to its worker. Run workers for independent scopes in parallel. A worker may delegate only to a leaf subagent; continuity is not independent review. Keep the main session for steering, integration, and talking with Thomas.",
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
const usage = `/mode send delivers the pending change now · /mode <axis> <value>: ${axisNames.map((axis) => `${axis} <${Object.keys(axes[axis].values).join("|").toLowerCase()}>`).join(" · ")}`;

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

export function renderBlock(selection: WorkingModeState, seq: number, sent = false) {
  const summary = axisNames.map((axis) => `${axes[axis].label}: ${selection[axis]}`).join(" · ");
  const guidance = axisNames
    .filter((axis) => selection[axis] !== defaults[axis])
    .map((axis) => `${axes[axis].label} — ${selection[axis]}: ${(axes[axis].values as Record<string, string>)[selection[axis]]}`);
  return [
    `<working-mode seq="${seq}">`,
    `Thomas selected Working Mode ${summary}.`,
    guidance.length
      ? "Follow this guidance until a newer block replaces it. It grants no extra permissions, and Thomas's explicit instructions in the conversation override it.\n\n" + guidance.join("\n\n")
      : "Every value is at its starting setting; no Working Mode guidance applies.",
    "",
    "This block replaces every earlier <working-mode> block.",
    ...(sent ? ["Acknowledge this change in one sentence and continue under it."] : []),
    "</working-mode>",
  ].join("\n");
}

export default function workingModeExtension(pi: ExtensionAPI) {
  let selected: WorkingModeState = { ...defaults };
  let applied: WorkingModeState | null = null;
  // Block sent by `/mode send` that may still wait in the steer queue, outside the session branch.
  let queued: WorkingModeDetails | null = null;

  /** Next block to deliver, or null when the model already sees (or will see) the selection. */
  function pendingBlock(ctx: ExtensionContext, sent: boolean) {
    // Compare with the block the model can still see; compaction may have summarized it away.
    const seen = queued?.selection ?? latestBlock(ctx.sessionManager.buildContextEntries())?.selection ?? defaults;
    if (same(seen, selected)) return null;
    const seq = Math.max(queued?.seq ?? 0, latestBlock(ctx.sessionManager.getBranch())?.seq ?? 0) + 1;
    const details: WorkingModeDetails = { schemaVersion: 2, seq, selection: { ...selected } };
    return { customType: CUSTOM_TYPE, content: renderBlock(selected, seq, sent), display: true, details };
  }

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
    queued = null;
    publish(ctx, "selected");
  });

  // A run's end means a queued steer either landed in the branch or was dropped (abort, clearQueue).
  // ponytail: a steer queued after the loop's last queue check can survive into the next run and
  // duplicate the block there; track message_end of the queued block if that shows up in practice.
  pi.on("agent_end", () => { queued = null; });

  pi.registerCommand("mode", {
    description: "Choose Working Mode guidance for the next prompt; /mode send delivers it now",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "send") {
        const message = pendingBlock(ctx, true);
        if (!message) {
          if (ctx.hasUI) ctx.ui.notify("Working Mode unchanged", "info");
          return;
        }
        queued = message.details;
        applied = { ...selected };
        publish(ctx, "applied");
        // Idle: starts a turn. Streaming: steers the running turn after its current tool calls.
        pi.sendMessage(message, { triggerTurn: true, deliverAs: "steer" });
        return;
      }
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
    const message = pendingBlock(ctx, false);
    return message ? { message } : undefined;
  });
}
