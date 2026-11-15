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
  return (tokens) => {
    if (typeof tokens !== "number") return undefined;
    const level = tokens < threshold ? -1 : Math.floor((tokens - threshold) / step);
    // A drop means a compaction summarized the earlier reminders away, so the next one is full again.
    if (level < lastLevel) shown = false;
    const crossed = level > lastLevel;
    lastLevel = level;
    if (!crossed) return undefined;
    const k = Math.round(tokens / 1000);
    const content = shown
      ? `Context is now at ${k}k tokens. Plan to compact when this phase ends.`
      : `Context is at ${k}k tokens, with plenty of room left. Carry on with the current phase. Once it is done and your running children are back, compact with compact_and_continue, naming what the summary must keep and the next phase.`;
    shown = true;
    return {
      type: "custom_message",
      customType: "context-ceiling",
      display: true,
      content,
      details: { tokens, threshold, step },
    };
  };
}

export const MAX_SUMMARY_FOCUS_CHARS = 1200;
export const MAX_NEXT_PHASE_CHARS = 800;

export function validateCheckpointRequest(request) {
  if (request.summaryFocus.length === 0 || request.nextPhase.length === 0) {
    return "summaryFocus and nextPhase must contain non-whitespace text";
  }
  if (request.summaryFocus.length > MAX_SUMMARY_FOCUS_CHARS) {
    return `summaryFocus is ${request.summaryFocus.length} characters; shorten it to ${MAX_SUMMARY_FOCUS_CHARS} or fewer. It is a brief directive to Pi's summarizer, not the summary itself. Reference existing evidence paths instead of restating session history.`;
  }
  if (request.nextPhase.length > MAX_NEXT_PHASE_CHARS) {
    return `nextPhase is ${request.nextPhase.length} characters; shorten it to ${MAX_NEXT_PHASE_CHARS} or fewer and name one concrete phase.`;
  }
  return undefined;
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
