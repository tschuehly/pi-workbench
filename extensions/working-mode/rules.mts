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
      Focused: "Thomas is watching this conversation now. Work in short steps and report each meaningful finding or step in a few lines. Post each decision with `ask_user` as soon as it arises instead of guessing or asking in prose; he answers right away, so keep working only on what it does not affect. Do not use phone tools.",
      Switching: "Thomas works in other sessions and reads this one only occasionally. Do not interrupt for single questions: keep working on everything an open decision does not block. Post each open decision with `ask_user` as soon as it arises, with a short `context` (at most five lines: the finding the decision rests on) and options that each state their consequence, one marked recommended, so he can answer without rereading the session; update or withdraw it when it changes. Write in the conversation only when blocked or finished, as one short message he understands without the earlier conversation: what he asked for, what was done and its result, and what is open or needed from him. Apply the write-for-humans skill. When he must act on it, also call `request_attention` with a self-contained reason. Do not use phone tools.",
      Phone: "Thomas is away from the session conversation but reachable by phone. This setting, not a guess about his presence, selects the phone channel. Ask every question through `ask_human`, never in the session conversation; ask only real blockers and make each question concise and self-contained. When a milestone finishes or you stop to wait, send one `notify_human` update; use it only for updates that need no answer. Start the first line with `❓` for a question or `ℹ️` for an update. Batch open decisions into one `ask_human` call with a numbered list and a safe default per item. Give every `ask_human` call a finite `timeoutMs` matched to the response window; state the fallback when timeout matters. When Thomas writes in the session conversation, he is temporarily at his computer: answer and ask there (decisions via `ask_user`) for as long as he replies there; only after a conversation question stays unanswered for 15 minutes do new questions and milestone updates go by phone again.",
      AFK: "Before treating a choice as blocked, recheck the agreed goal and success criteria. For a material doubt, ask an advisor to challenge the assumption or find an in-scope route; an advisor cannot approve a different goal. Continue with a changed approach only if it preserves the agreed outcome, behavior, scope, and success criteria; record the reason in an accepted plan or specification when one exists. If advice is unavailable or unclear, use only a low-cost, reversible local step within those bounds; record uncertainty and how to undo it. With advisor backing, decide product, architecture, scope, or quality questions the agreement leaves open; record the decision, the advice, and how to undo it. Do not contact Thomas. If no advisor is available and no reversible in-scope step remains, list the question for Thomas's return, pause affected work, and continue independent work.",
    },
  },
  checking: {
    label: "Checking",
    values: {
      Default: "",
      Exercise: "Inspect or exercise the changed result directly and report the evidence. Apply stronger checks required by Thomas, the repository, or the task; report any evidence gap.",
      Test: "Produce automated proof of the changed behavior, adding a relevant test when needed, and report the exact result. Show each new or changed check failing on the unfixed or deliberately broken code, or say why you could not. Apply stronger required checks; report any evidence gap.",
      Challenge: "Prove the changed behavior with an automated check, adding a test when needed, and report its exact result. Show each new or changed check failing on the unfixed or deliberately broken code, or say why you could not. Then obtain fresh independent scrutiny from a review pair: in the same turn, launch two background `review` subagents with the same brief, blind to each other, one with `modelOverride` `openai/gpt-6.2-sol` and one with `meta/muse-ember-1.0`, both at high with the author as `independentOfModel`. For an OpenAI author use `anthropic/claude-opus-5-5` instead of Sol; for a Meta author use Opus instead of Ember. When Ember is in the pair and Muse quota is below its floor or Ember fails to launch or is rate-limited, run the other reviewer alone and say so in the report (model-orchestration's Checking reference). Merge duplicate findings, note which reviewer found each, and report unresolved findings and evidence gaps. Apply stronger required checks.",
    },
  },
  orchestration: {
    label: "Orchestration",
    values: {
      Main: "Perform the primary work in the main session. Required advisors and independent checks remain available.",
      Subagents: "Parallelize by default; this overrides any general preference to work inline. Before each task, split it into independent parts such as research questions, files, modules, or checks. When two or more exist, launch them as parallel background subagents in the same turn. Also delegate mechanical volume such as bulk reading, scans, and broad edits. Keep the main session for steering, integration, and talking with Thomas; do inline only what is smaller than writing its brief.",
      Workers: "Organize multi-step work around durable workers; this overrides any general preference for fresh subagents. At the start, name the scopes that will receive repeated tasks, such as a module, repository area, or review lane, create one worker per scope, and route every task in that scope to its worker. Run workers for independent scopes in parallel. A worker may delegate only to a leaf subagent; continuity is not independent review. Keep the main session for steering, integration, and talking with Thomas.",
      Cockpit: "Run the work as a Cockpit; this overrides any general preference for fresh subagents. Give each Workstream one durable worker (create the Workstream if it is missing) and dispatch workers in the background, in parallel. Keep one Atelier Page for this Chat with one tab per worker, titled with its Workstream title; you are its Receiver. A fresh subagent writes the Page HTML from each worker's report and its status file `~/.pi-workbench/workers/status/<workerId>.json`; you write no HTML. Each worker report, and its tab, has these sections: For, Now, Needs you, Your choices, To send, Where it stands, If you say nothing. Each report rewrites its tab in place; never append older reports. Every Decision stands alone: it names its subject, options, and their consequences so Thomas can answer without the rest of the tab; the Page writer sends unclear ones back to the worker. Ask every question as a Page Decision, instead of the question channel your Attention setting names, unless the Page is unreachable. Whether, when, and how you tell Thomas that a tab changed follows your Attention setting: send one line with the tab link through the channel it names (the conversation, when Attention names none), and send nothing when it says not to contact him. Workers never post or send anything outward; they draft Sends, and you post a Send only after Thomas approves it. Relay a tab's answers to its worker in one `worker_dispatch`. Open each Comment reply with one line on what changed since the Comment, and put anything that changes a Decision into its card. When a worker retires or the day ends, write a Workstream checkpoint from its tab.",
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
export const usage = `/mode send delivers the pending change now · /mode unalign clears the confirmed alignment now · /mode <axis> <value>: ${axisNames.map((axis) => `${axis} <${Object.keys(axes[axis].values).join("|").toLowerCase()}>`).join(" · ")}`;

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

// PI WEB's ask_user transcript records (pi-web src/shared/apiTypes.ts, pendingAskStore.ts).
const ASK_CLOSED = "pi-web.ask.closed";
const ASK_ANSWERS = "pi-web.ask.answers";

/** Question sets this session posted that are still open on the branch, as PI WEB's openAsksFromTranscript rebuilds them. */
export function openAsks(branch: readonly any[], sessionId: string): any[] {
  const open = new Map<string, any>();
  for (const entry of branch) {
    const message = entry?.type === "message" ? entry.message : undefined;
    if (message?.role === "toolResult" && message.toolName === "ask_user" && !message.isError) {
      const details = message.details;
      if (details?.sessionId === sessionId && typeof details.ask?.askId === "string" && Array.isArray(details.ask.questions)) open.set(details.ask.askId, details.ask);
      if (typeof details?.withdrawn?.askId === "string") open.delete(details.withdrawn.askId);
    } else if (entry?.type === "custom" && entry.customType === ASK_CLOSED) {
      const outcome = entry.data;
      const ask = open.get(outcome?.askId);
      if (!ask || !Array.isArray(outcome.questions)) continue;
      // A partial send closes only the questions it sent.
      if (outcome.partial !== true) { open.delete(ask.askId); continue; }
      const sent = new Set(outcome.questions.map((record: any) => record?.question?.id));
      open.set(ask.askId, { ...ask, questions: ask.questions.filter((question: any) => !sent.has(question.id)) });
    } else if (entry?.type === "custom_message" && entry.customType === ASK_ANSWERS && entry.details?.partial !== true) {
      open.delete(entry.details?.askId);
    }
  }
  return [...open.values()].filter((ask) => ask.questions.length > 0);
}

/** The open question sets verbatim, or a line saying there are none. */
function openSets(asks: readonly any[]) {
  const sets = asks.map((ask) => [
    `### Question set ${ask.askId}`,
    ...(ask.context ? [ask.context] : []),
    ...ask.questions.map((question: any) => [
      `- **${question.id}: ${question.question}**`,
      ...(question.detail ? [`  ${question.detail.replace(/\n/g, "\n  ")}`] : []),
      ...(question.options ?? []).map((option: any) => `  - \`${option.value}\` ${option.label}${option.recommended ? " (recommended)" : ""}${option.detail ? `: ${option.detail}` : ""}`),
    ].join("\n")),
  ].join("\n\n"));
  return sets.length
    ? `These question sets are still open in Thomas's composer. Do not repost them; update or withdraw one only if the evidence shows it is stale.\n\n${sets.join("\n\n")}`
    : "No question sets are open.";
}

const REENTRY = "The re-entry source is this session's home Workstream: run `workstreams` to find it, then read its latest checkpoint. Verify repository and remote state before relying on any recorded claim.";

/** Compaction summary that replaces the whole context on `/back`: a pointer to the checkpoint plus the open questions verbatim. */
export function backSummary(asks: readonly any[]) {
  return [
    "Thomas ran /back on his return. The earlier conversation was removed from your context on purpose; nothing was summarized from it.",
    REENTRY,
    openSets(asks),
  ].join("\n\n");
}

/** The new context `checkpoint_and_continue` starts: /back's pointer and open sets, then the next phase. */
export function checkpointHandoff(asks: readonly any[], nextPhase: string) {
  return [
    "You wrote this session's Workstream checkpoint and called checkpoint_and_continue. The earlier conversation was removed from your context on purpose; nothing was summarized from it.",
    REENTRY,
    openSets(asks),
    `Continue with the next phase: ${nextPhase}`,
  ].join("\n\n");
}

export const BACK_TYPE = "working-mode-back";
export const BACK_PROMPT = "Thomas is back. Use the orient skill to give a brief re-entry from this session's home Workstream and its latest checkpoint (if the session has no home Workstream, orient from the summary alone and say so). Fold each question set still open in Thomas's composer into the orientation next to its context, by its id. Then stop.";

/** `/checkpoint [next phase]`: the model saves first, so nothing unsaved drops out with the context. */
export const checkpointPrompt = (nextPhase: string) => `Thomas ran /checkpoint. Bring the current step to a safe stopping point. Then write this session's Workstream checkpoint (Workstreams skill, section 3) with everything the next phase needs, and call checkpoint_and_continue alone with the next phase: ${nextPhase === "" ? "the phase you are on" : nextPhase}. If the session has no home Workstream, call compact_and_continue alone instead, with the same next phase.`;

export const AFK_CLOSE_TYPE = "working-mode-afk-close";
export const AFK_CLOSE_PROMPT = "AFK closing step: you are idle and nothing is running. Run `workstreams` to find this session's home Workstream. If it has one, write its checkpoint now (Workstreams skill, section 3), carrying every open question for Thomas's return. If it has none, write one final message that stands on its own: what is done, every open question with your recommendation, and the next move. Start no new work. Then stop.";

/** True for a tool call that writes a Workstream checkpoint. */
export const writesCheckpoint = (input: unknown) => /\bworkstreams\s+checkpoint\b/.test(JSON.stringify(input ?? ""));
