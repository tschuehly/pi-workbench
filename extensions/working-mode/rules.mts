// Working Mode rules shared by the Pi extension (index.ts) and the Durable Chat host: the four axes, their guidance,
// the rendered <working-mode> block and the AFK alignment gate. Pure: no Pi or Durable imports.
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
      Switching: "Thomas works in other sessions and reads this one only occasionally. Do not interrupt for single questions: keep working on everything an open decision does not block. Post each open decision with `ask_user` as soon as it arises, with a short `context` (at most five lines: the finding the decision rests on) and options that each state their consequence, one marked recommended, so he can answer without rereading the session; update or withdraw it when it changes. Write in the conversation only when blocked or finished: one status line. Do not use phone tools.",
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
  aligned: boolean;
};
export type WorkingModeDetails = { schemaVersion: 2; seq: number; selection: WorkingModeState; aligned?: boolean };

export const ALIGNMENT_TOOL = "alignment_reached";
export const ALIGNMENT_RESET_TOOL = "alignment_reset";

/** How each Alignment value reaches alignment before AFK starts; Default needs none. */
const afkPreparation: Record<string, string> = {
  Align: "state the outcome, scope, consequential assumptions, and success check in at most five bullets, followed by the checklist you will work through while he is away",
  Plan: "persist the plan, including the checklist you will work through while he is away, and ask him to accept it",
  Spec: "persist the specification, including the checklist you will work through while he is away, and ask him to accept it",
};

/** AFK waits for alignment when an Alignment value asks for it and Thomas has not yet confirmed. */
export const afkPending = (selection: WorkingModeState, aligned: boolean) =>
  selection.attention === "AFK" && selection.alignment !== "Default" && !aligned;

export function afkPreparationText(selection: WorkingModeState) {
  return `AFK has not started: alignment is not reached yet. Prepare to go AFK while Thomas is still here: stay interactive in this conversation and do not use phone tools. In one message, ${afkPreparation[selection.alignment]}. In the same message, add a numbered list of every question you can foresee while he is away, each with a recommended default. Wait for his answer. Once he confirms, call \`${ALIGNMENT_TOOL}\` with the agreed outcome and checklist; from then on the AFK rules apply.`;
}

export const CUSTOM_TYPE = "working-mode";
export const defaults: WorkingModeState = { alignment: "Default", attention: "Default", checking: "Default", orchestration: "Main" };
export const axisNames = Object.keys(axes) as Axis[];
export const usage = `/mode send delivers the pending change now · /mode <axis> <value>: ${axisNames.map((axis) => `${axis} <${Object.keys(axes[axis].values).join("|").toLowerCase()}>`).join(" · ")}`;

export function isSelection(value: any): value is WorkingModeState {
  return !!value && axisNames.every((axis) => typeof value[axis] === "string" && Object.hasOwn(axes[axis].values, value[axis]));
}

export const same = (a: WorkingModeState, b: WorkingModeState) => axisNames.every((axis) => a[axis] === b[axis]);

export function renderBlock(selection: WorkingModeState, seq: number, aligned = false, sent = false) {
  const summary = axisNames.map((axis) => `${axes[axis].label}: ${selection[axis]}`).join(" · ");
  const guidance = axisNames
    .filter((axis) => selection[axis] !== defaults[axis])
    .map((axis) => axis === "attention" && afkPending(selection, aligned)
      ? `Attention — AFK (preparing): ${afkPreparationText(selection)}`
      : `${axes[axis].label} — ${selection[axis]}: ${(axes[axis].values as Record<string, string>)[selection[axis]]}`);
  return [
    `<working-mode seq="${seq}">`,
    `Thomas selected Working Mode ${summary}.${aligned ? " Alignment is reached. When Thomas changes the scope or direction, call `alignment_reset` before continuing." : ""}`,
    guidance.length
      ? "Follow this guidance until a newer block replaces it. It grants no extra permissions, and Thomas's explicit instructions in the conversation override it.\n\n" + guidance.join("\n\n")
      : "Every value is at its starting setting; no Working Mode guidance applies.",
    "",
    "This block replaces every earlier <working-mode> block.",
    ...(sent ? ["Acknowledge this change in one sentence and continue under it."] : []),
    "</working-mode>",
  ].join("\n");
}


export const alignmentTool = {
  label: "Alignment reached",
  description: "Record that Thomas confirmed the outcome, scope, and success check (or accepted the plan or specification). Call only after his explicit confirmation.",
  agreement: "The agreed outcome and checklist, briefly",
};
export const alignmentResetTool = {
  label: "Alignment reset",
  description: "Clear the confirmed alignment as soon as Thomas changes the scope or direction, or the work turns to a new task that needs a new agreement with Thomas.",
  reason: "The new task, briefly",
};

/** Result text of `alignment_reached`; `wasPending` when AFK waited for this alignment. */
export function alignmentReachedText(wasPending: boolean) {
  return wasPending ? `Alignment recorded. AFK starts now: ${axes.attention.values.AFK}` : "Alignment recorded.";
}

/** Result text of `alignment_reset` for the selection after the reset. */
export function alignmentResetText(selection: WorkingModeState) {
  return afkPending(selection, false) ? `Alignment cleared. ${afkPreparationText(selection)}` : "Alignment cleared.";
}

/** Apply `/mode <axis> <value>` (case-insensitive) to a selection; undefined when the arguments are invalid. */
export function selectFromArgs(selection: WorkingModeState, aligned: boolean, args: string): { selection: WorkingModeState; aligned: boolean } | undefined {
  const [name, value, ...extra] = args.trim().toLowerCase().split(/\s+/);
  const axis = name as Axis;
  if (extra.length || !axisNames.includes(axis)) return undefined;
  const match = Object.keys(axes[axis].values).find((candidate) => candidate.toLowerCase() === value);
  if (!match) return undefined;
  // Changing the Alignment value asks for a new agreement.
  return { selection: { ...selection, [axis]: match }, aligned: axis === "alignment" && match !== selection.alignment ? false : aligned };
}
