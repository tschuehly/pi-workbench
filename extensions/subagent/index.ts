import { execFile } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { PiRpcExecutionAdapter } from "../../packages/pi-execution-adapter/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const resolver = path.resolve(here, "../../skills/model-orchestration/scripts/resolve-runtime-binding.mjs");
const PROFILES = {
  scout: {
    roles: ["wide-evidence-gathering", "system-comprehension", "bounded-advice"],
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Investigate only. Do not mutate files. Return compact evidence and conclusions to the attending lead.",
  },
  planner: {
    roles: ["consequential-deliberation", "system-comprehension", "bounded-advice"],
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Produce a bounded plan or design judgment. Do not mutate files. Name assumptions, risks, and verification.",
  },
  reviewer: {
    roles: ["hard-execution", "bounded-advice", "gpt-adversary", "gpt-diff-review"],
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Review independently. Do not mutate files. Lead with actionable findings and cite repository paths.",
  },
  implementer: {
    roles: ["routine-execution", "hard-execution", "background-mechanics"],
    tools: ["read", "bash", "grep", "find", "ls", "edit", "write"],
    instruction: "Implement only the bounded assignment. Verify your changes and report files changed, checks, and remaining risks. Do not commit or publish.",
  },
} as const;

const COGNITIVE_ROLES = [
  "routine-execution", "hard-execution", "consequential-deliberation", "exceptional-escalation",
  "wide-evidence-gathering", "bounded-advice", "gpt-adversary", "system-comprehension",
  "gpt-diff-review", "background-mechanics",
] as const;

const Params = Type.Object({
  task: Type.String({ minLength: 1, description: "Self-contained bounded assignment naming relevant paths, constraints, and expected output" }),
  profile: StringEnum(Object.keys(PROFILES) as (keyof typeof PROFILES)[], { description: "Bundled Level 1 child behavior profile" }),
  cognitiveRole: StringEnum(COGNITIVE_ROLES, { description: "Required kind of thinking; never a model name" }),
});

type Observation = { type: string; detail?: unknown };

export default function subagentExtension(pi: ExtensionAPI) {
  const adapter = new PiRpcExecutionAdapter();

  pi.on("session_shutdown", async () => {
    await adapter.cancelAll("Attended parent session ended.");
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Launch one fresh attended child Pi for one bounded assignment. Progress is visible and cancellable; the lead must reconcile the compact result.",
    promptSnippet: "Delegate one bounded attended assignment to a fresh child Pi",
    promptGuidelines: [
      "Use one invocation for one bounded assignment while the user is attending.",
      "Correct an assignment by cancelling it and launching a new child; do not imply managed authority, recovery, or background work.",
    ],
    parameters: Params,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const profile = PROFILES[params.profile];
      if (profile === undefined || !(profile.roles as readonly string[]).includes(params.cognitiveRole)) {
        return failure("preflight_failed", `Profile ${params.profile} does not allow Cognitive Role ${params.cognitiveRole}.`);
      }

      let binding;
      try {
        binding = await resolveBinding(params.cognitiveRole);
      } catch (error) {
        return failure("preflight_failed", errorMessage(error));
      }

      let receipt;
      try {
        receipt = await adapter.dispatch({
          task: `${profile.instruction}\n\nAssignment:\n${params.task}`,
          profile: params.profile,
          cognitiveRole: params.cognitiveRole,
          cwd: ctx.cwd,
          tools: [...profile.tools],
          binding,
        });
      } catch (error) {
        return failure("preflight_failed", errorMessage(error));
      }

      const abort = () => { void adapter.cancel(receipt.executionId, "Cancelled from the attended parent tool."); };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });

      const observations: Observation[] = [];
      const observing = (async () => {
        for await (const observation of adapter.observe(receipt.executionId)) {
          observations.push({ type: observation.type, detail: observation.detail });
          if (observations.length > 30) observations.shift();
          onUpdate?.({
            content: [{ type: "text", text: progressText(observation) }],
            details: { executionId: receipt.executionId, profile: params.profile, cognitiveRole: params.cognitiveRole, observations: [...observations] },
          });
        }
      })();

      const result = await adapter.result(receipt.executionId);
      await observing;
      signal?.removeEventListener("abort", abort);
      const summary = result.outcome === "success"
        ? result.text || "Child completed without a text result."
        : `${result.outcome}: ${result.diagnostic ?? result.text ?? "No diagnostic was reported."}`;
      return {
        content: [{ type: "text", text: summary }],
        details: { executionId: receipt.executionId, ...result, observations },
        ...(result.outcome === "success" ? {} : { isError: true }),
      };
    },
  });
}

async function resolveBinding(cognitiveRole: string): Promise<any> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, [resolver, cognitiveRole], { encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, output, stderr) => {
      if (error !== null) reject(new Error(String(stderr || output || error.message).trim()));
      else resolve(output);
    });
  });
  let value: any;
  try { value = JSON.parse(stdout); } catch (error) { throw new Error(`Routing returned invalid JSON: ${errorMessage(error)}`); }
  if (value?.status !== "pass" || value.modelBinding?.cognitiveRole !== cognitiveRole) throw new Error("Routing did not return the requested resolved binding.");
  return value.modelBinding;
}

function failure(outcome: string, diagnostic: string) {
  return { content: [{ type: "text" as const, text: `${outcome}: ${diagnostic}` }], details: { outcome, diagnostic }, isError: true };
}

function progressText(observation: { type: string; detail?: any }): string {
  if (observation.type.startsWith("tool_")) return `${observation.type.replaceAll("_", " ")}: ${String(observation.detail?.toolName ?? "tool")}`;
  if (observation.type === "assistant_progress") return "Child Pi is responding…";
  if (observation.type === "quota_degraded") return `Quota telemetry ${String(observation.detail?.telemetryStatus ?? "unavailable")}; attempting verified model launch.`;
  if (observation.type === "binding_verified") return `Binding verified: ${String(observation.detail?.provider)}/${String(observation.detail?.model)}:${String(observation.detail?.effort)}`;
  if (observation.type === "terminal") return `Child ${String(observation.detail?.outcome ?? "finished")}.`;
  return observation.type.replaceAll("_", " ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
