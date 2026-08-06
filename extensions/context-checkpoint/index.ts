import type { CompactionResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createCheckpointCoordinator,
  latestAssistantToolCallCount,
  MAX_NEXT_PHASE_CHARS,
  MAX_SUMMARY_FOCUS_CHARS,
  validateCheckpointRequest,
} from "./coordinator.mjs";

type CheckpointRequest = {
  summaryFocus: string;
  nextPhase: string;
};

type ResumeOutcome = {
  request: CheckpointRequest;
  status: "compacted" | "failed";
  result?: CompactionResult;
  error?: unknown;
};

export default function contextCheckpointExtension(pi: ExtensionAPI) {
  const coordinator = createCheckpointCoordinator((outcome: ResumeOutcome) => {
    const failed = outcome.status === "failed";
    const diagnostic = failed ? errorMessage(outcome.error) : undefined;
    const content = failed
      ? [
          `Context checkpoint failed: ${diagnostic}.`,
          "Report the checkpoint failure, then continue only if the remaining context is sufficient.",
          `Requested next phase: ${outcome.request.nextPhase}`,
        ].join("\n\n")
      : [
          "Context checkpoint completed.",
          `Continue with the requested next phase: ${outcome.request.nextPhase}`,
          "Use the compacted checkpoint as context, but verify repository state before relying on consequential claims.",
        ].join("\n\n");

    pi.sendMessage(
      {
        customType: "context-checkpoint",
        content,
        display: true,
        details: {
          status: outcome.status,
          nextPhase: outcome.request.nextPhase,
          ...(diagnostic === undefined ? {} : { diagnostic }),
        },
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  });

  pi.registerTool({
    name: "compact_and_continue",
    label: "Compact and Continue",
    description:
      "End the current agent run at a coherent phase boundary, compact older session context using a short focus directive, then automatically start the next phase in the same session. summaryFocus directs Pi's summarizer; it is not a handoff summary and must be 1200 characters or fewer.",
    promptSnippet: "Compact context at a coherent phase boundary and continue with a named next phase",
    promptGuidelines: [
      "Call compact_and_continue alone as the final action of a completed phase, after saving and verifying work that must survive compaction.",
      "Use compact_and_continue only when the next phase is concrete and materially benefits from a smaller context; do not use it to avoid difficult reasoning or unfinished work.",
      "Keep compact_and_continue summaryFocus at 1200 characters or fewer; use it as a short summarizer directive and reference existing evidence paths instead of restating session history.",
      "Do not create a progress file solely for compact_and_continue or call generated notes authoritative, durable checkpoints, Continuation Artifacts, or cross-session handoffs.",
    ],
    parameters: Type.Object({
      summaryFocus: Type.String({
        minLength: 1,
        description: `Brief directive to Pi's summarizer, not a handoff summary; at most ${MAX_SUMMARY_FOCUS_CHARS} characters`,
      }),
      nextPhase: Type.String({
        minLength: 1,
        description: `One concrete next phase to begin automatically after compaction; at most ${MAX_NEXT_PHASE_CHARS} characters`,
      }),
    }),
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const request = {
        summaryFocus: params.summaryFocus.trim(),
        nextPhase: params.nextPhase.trim(),
      };
      const validationError = validateCheckpointRequest(request);
      if (validationError !== undefined) throw new Error(validationError);

      const siblingToolCalls = latestAssistantToolCallCount(ctx.sessionManager.getBranch());
      if (siblingToolCalls > 1) {
        return {
          content: [{
            type: "text",
            text: "Checkpoint not scheduled: compact_and_continue must be called alone in its assistant tool batch. Finish the current work, then call it as the sole final action.",
          }],
          details: { accepted: false, state: "batched", ...request },
          terminate: false,
        };
      }

      const scheduled = coordinator.request(request);
      return {
        content: [
          {
            type: "text",
            text: scheduled.accepted
              ? "Context checkpoint scheduled. This agent run will end; Pi will compact the session and automatically begin the requested next phase."
              : `A context checkpoint is already ${scheduled.state}; this request was not added.`,
          },
        ],
        details: { ...scheduled, ...request },
        terminate: scheduled.accepted,
      };
    },
  });

  pi.on("agent_settled", (_event, ctx) => {
    coordinator.onAgentSettled((options: Parameters<typeof ctx.compact>[0]) => ctx.compact(options));
  });

  pi.on("session_shutdown", () => {
    coordinator.dispose();
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
