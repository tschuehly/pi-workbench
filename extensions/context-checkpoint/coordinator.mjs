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

export function compactionInstructions(request) {
  return [
    "Create a phase-boundary context checkpoint for the model that will continue this same session.",
    `Summary focus: ${request.summaryFocus}`,
    `Next phase: ${request.nextPhase}`,
    "Preserve completed work, exact paths and identifiers, verification results, unresolved risks, and the concrete starting point for the next phase. Do not claim that compaction is a durable cross-session handoff.",
  ].join("\n");
}
