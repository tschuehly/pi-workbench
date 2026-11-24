/** `barrierFor()` returns the current session's barrier; it is resolved at each use. */
export function createCheckpointCoordinator(resume, barrierFor) {
  let pending;
  let compacting = false;
  let disposed = false;

  return {
    request(request) {
      if (disposed || pending !== undefined || compacting) {
        return {
          accepted: false,
          state: disposed ? "disposed" : compacting ? "compacting" : "pending",
        };
      }

      pending = { ...request };
      // Block child wakes from acceptance, not from agent_settled: a child that finishes
      // in between would otherwise trigger a turn on the far side of the boundary.
      barrierFor().open();
      return { accepted: true, state: "pending" };
    },

    onAgentSettled(compact) {
      if (disposed || pending === undefined || compacting) return false;

      const request = pending;
      pending = undefined;
      compacting = true;
      const barrier = barrierFor();
      barrier.beginCompaction();
      let finished = false;

      const finish = (outcome) => {
        if (finished || disposed) return;
        finished = true;
        compacting = false;
        resume({ request, ...outcome });
        // The checkpoint result is sent; queued child wakes follow at the resumed turn's
        // first boundary so they cannot race its start.
        barrier.handOff();
      };

      try {
        compact({
          customInstructions: compactionInstructions(request),
          onComplete: (result) => finish({ status: "compacted", result }),
          onError: (error) => finish({ status: "failed", error }),
        });
      } catch (error) {
        finish({ status: "failed", error });
      }

      return true;
    },

    dispose() {
      disposed = true;
      pending = undefined;
      compacting = false;
      barrierFor().dispose();
    },
  };
}

export function latestAssistantToolCallCount(branch) {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) return 0;
    return content.filter((block) => block?.type === "toolCall").length;
  }
  return 0;
}

// ponytail: one fixed ceiling for every model; derive it from the context window if windows diverge.
export const CONTEXT_CEILING_TOKENS = 200_000;
export const CONTEXT_CEILING_STEP_TOKENS = 50_000;

/** A boundary entry at the ceiling and every further step above it, until a compaction drops the context back. */
export function createContextCeiling(threshold = CONTEXT_CEILING_TOKENS, step = CONTEXT_CEILING_STEP_TOKENS) {
  let lastLevel = -1;
  let shown = false;
  const levelOf = (tokens) => (tokens < threshold ? -1 : Math.floor((tokens - threshold) / step));
  // workstream: the lead Chat's home Workstream id (Durable only), which points it to checkpoint_and_continue instead.
  const ceiling = (tokens, workstream) => {
    if (typeof tokens !== "number") return undefined;
    const level = levelOf(tokens);
    // A drop means a compaction summarized the earlier reminders away, so the next one is full again.
    if (level < lastLevel) shown = false;
    const crossed = level > lastLevel;
    lastLevel = level;
    if (!crossed) return undefined;
    const k = Math.round(tokens / 1000);
    const content = shown
      ? `Context is now at ${k}k tokens. Plan to ${workstream ? "checkpoint and continue" : "compact"} when this phase ends.`
      : `Context is at ${k}k tokens, with plenty of room left. Carry on with the current phase. Once it is done, `
        + (workstream
          ? `write the checkpoint of this session's Workstream ${workstream} (everything the next phase needs), then call checkpoint_and_continue with the next phase.`
          : "compact with compact_and_continue, naming what the summary must keep and the next phase.");
    shown = true;
    return {
      type: "custom_message",
      customType: "context-ceiling",
      display: true,
      content,
      details: { tokens, threshold, step },
    };
  };
  /** Whether these tokens would add a note, without recording them. */
  ceiling.wouldFire = (tokens) => typeof tokens === "number" && levelOf(tokens) > lastLevel;
  return ceiling;
}

// Words, not characters or tokens: models estimate words best, and the code counts them exactly.
export const MAX_SUMMARY_FOCUS_WORDS = 750;
export const MAX_NEXT_PHASE_WORDS = 120;

const VAGUE_PHASE = /\bphase you are on\b|^(continue|carry on|keep going|resume|same|next( phase| step)?|(the )?current (phase|step|task|work))[.!]*$/i;

export const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

/** nextPhase alone, shared with checkpoint_and_continue; undefined when valid. */
export function validateNextPhase(nextPhase) {
  if (nextPhase.length === 0) return "nextPhase must contain non-whitespace text";
  const words = wordCount(nextPhase);
  if (words > MAX_NEXT_PHASE_WORDS) return `nextPhase is ${words} words; shorten it to ${MAX_NEXT_PHASE_WORDS} or fewer and name one concrete phase.`;
  // The fresh context has no earlier turn to resolve a placeholder against.
  if (VAGUE_PHASE.test(nextPhase)) return `nextPhase "${nextPhase}" is a placeholder; name the concrete work: what to do and where it stands.`;
  return undefined;
}

export function validateCheckpointRequest(request) {
  if (request.summaryFocus.length === 0 || request.nextPhase.length === 0) {
    return "summaryFocus and nextPhase must contain non-whitespace text";
  }
  const words = wordCount(request.summaryFocus);
  if (words > MAX_SUMMARY_FOCUS_WORDS) {
    return `summaryFocus is ${words} words; shorten it to ${MAX_SUMMARY_FOCUS_WORDS} or fewer. It is a brief directive to Pi's summarizer, not the summary itself. Reference existing evidence paths instead of restating session history.`;
  }
  return validateNextPhase(request.nextPhase);
}

export function compactionInstructions(request) {
  return [
    "Create a phase-boundary context checkpoint for the model that will continue this same session.",
    `Summary focus directive: ${request.summaryFocus}`,
    `Next phase: ${request.nextPhase}`,
    "Independently preserve the plan goal, completed work, exact paths and identifiers, verification results, unresolved risks, and the concrete starting point for the next phase.",
    "Do not call generated notes or summaries authoritative state, a durable checkpoint, a Continuation Artifact, or a cross-session handoff.",
  ].join("\n");
}

// Owner budget (2026-11-21): warn above 30k for now; target 20k; above it, the next config slip is visible.
export const STARTUP_BUDGET_TOKENS = 30_000;

/** The first reply's prompt (input + cache read + cache write) is what the session loaded before its first message. */
export function startupBudgetNotice(message, earlierReplies, budget = STARTUP_BUDGET_TOKENS) {
  if (message?.role !== "assistant" || earlierReplies !== 0) return undefined;
  const u = message.usage ?? {};
  const tokens = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
  if (tokens <= budget) return undefined;
  return `This session started at ${Math.round(tokens / 1000)}k tokens, above the ${Math.round(budget / 1000)}k startup budget. `
    + "Find what grew: node ~/IdeaProjects/pi-workbench.durable-installed/scripts/context-usage.mjs --cwd <dir>, "
    + "then again with -- --no-mcp, --no-skills or --no-context-files.";
}
