export function createCheckpointCoordinator(resume) {
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
      return { accepted: true, state: "pending" };
    },

    onAgentSettled(compact) {
      if (disposed || pending === undefined || compacting) return false;

      const request = pending;
      pending = undefined;
      compacting = true;
      let finished = false;

      const finish = (outcome) => {
        if (finished || disposed) return;
        finished = true;
        compacting = false;
        resume({ request, ...outcome });
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
