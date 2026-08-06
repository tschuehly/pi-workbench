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
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Investigate only. Do not mutate files. Return compact evidence and conclusions to the attending lead.",
  },
  planner: {
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Produce a bounded plan or design judgment. Do not mutate files. Name assumptions, risks, and verification.",
  },
  reviewer: {
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Review independently. Do not mutate files. Lead with actionable findings and cite repository paths.",
  },
  implementer: {
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
  background: Type.Optional(Type.Boolean({ description: "Launch and return a handle immediately instead of blocking. Reconcile later with subagent_collect. The child still dies when the attended session ends." })),
});

const IdParam = Type.Object({ executionId: Type.String({ minLength: 1, description: "Execution identifier returned by a background subagent launch" }) });
const StatusParams = Type.Object({ executionId: Type.Optional(Type.String({ minLength: 1, description: "One execution to inspect; omit to list every child launched this session" })) });
const CancelParams = Type.Object({ executionId: Type.String({ minLength: 1 }), reason: Type.Optional(Type.String({ description: "Why the child is being cancelled" })) });

type Observation = { type: string; detail?: unknown };
type LaunchMeta = { profile: string; cognitiveRole: string; taskPreview: string; launchedAt: string };

export default function subagentExtension(pi: ExtensionAPI) {
  const adapter = new PiRpcExecutionAdapter();
  const launched = new Map<string, LaunchMeta>();

  pi.on("session_shutdown", async () => {
    await adapter.cancelAll("Attended parent session ended.");
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Launch one fresh attended child Pi for one bounded assignment. By default progress is streamed and the tool blocks until the child finishes; with background:true it returns a handle immediately. The lead must reconcile the compact result.",
    promptSnippet: "Delegate one bounded attended assignment to a fresh child Pi",
    promptGuidelines: [
      "Use one invocation for one bounded assignment while the user is attending.",
      "Use background:true to launch several children and keep working; reconcile each with subagent_collect and cancel with subagent_cancel.",
      "Correct an assignment by cancelling it and launching a new child; do not imply managed authority, recovery, or durable background work that survives the session.",
      "If an independent child fails to launch or complete, disclose that failure; never present the parent's own review as independent.",
    ],
    parameters: Params,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const profile = PROFILES[params.profile];
      if (profile === undefined) {
        return failure("preflight_failed", `Unknown child profile: ${params.profile}.`);
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

      launched.set(receipt.executionId, {
        profile: params.profile,
        cognitiveRole: params.cognitiveRole,
        taskPreview: bounded(params.task, 200),
        launchedAt: receipt.acceptedAt,
      });

      if (params.background === true) {
        return {
          content: [{ type: "text", text: `Launched background subagent ${receipt.executionId} (${params.profile} · ${params.cognitiveRole}). Reconcile with subagent_collect, watch with subagent_status, stop with subagent_cancel.` }],
          details: { outcome: "launched", executionId: receipt.executionId, profile: params.profile, cognitiveRole: params.cognitiveRole, acceptedAt: receipt.acceptedAt },
        };
      }

      return streamToResult(adapter, receipt.executionId, params.profile, params.cognitiveRole, signal, onUpdate, { cancelOnAbort: true });
    },
  });

  pi.registerTool({
    name: "subagent_collect",
    label: "Subagent collect",
    description: "Stream the remaining progress of a backgrounded child and return its compact terminal result. Aborting collect stops waiting but leaves the child running.",
    promptSnippet: "Reconcile one backgrounded child Pi",
    parameters: IdParam,
    async execute(_toolCallId, params, signal, onUpdate) {
      const meta = launched.get(params.executionId);
      return streamToResult(adapter, params.executionId, meta?.profile ?? "unknown", meta?.cognitiveRole ?? "unknown", signal, onUpdate, { cancelOnAbort: false });
    },
  });

  pi.registerTool({
    name: "subagent_status",
    label: "Subagent status",
    description: "Non-blocking snapshot of one child, or a list of every child launched this session.",
    promptSnippet: "Inspect backgrounded child Pi progress",
    parameters: StatusParams,
    async execute(_toolCallId, params) {
      if (params.executionId !== undefined) {
        let status;
        try { status = adapter.status(params.executionId); } catch (error) { return failure("outcome_unknown", errorMessage(error)); }
        const meta = launched.get(params.executionId);
        const state = status.running ? "running" : (status.outcome ?? "finished");
        const line = status.latestObservation === undefined ? "no activity yet" : progressText(status.latestObservation);
        return {
          content: [{ type: "text", text: `${params.executionId} [${state}] ${status.provider}/${status.model}:${status.effort} — ${line}${meta ? `\nTask: ${meta.taskPreview}` : ""}` }],
          details: { ...status, taskPreview: meta?.taskPreview },
        };
      }
      const summaries = adapter.list();
      if (summaries.length === 0) return { content: [{ type: "text", text: "No subagents have been launched this session." }], details: { children: [] } };
      const lines = summaries.map((s) => {
        const meta = launched.get(s.executionId);
        const state = s.running ? "running" : (s.outcome ?? "finished");
        return `- ${s.executionId} [${state}] ${s.profile} · ${s.cognitiveRole}${meta ? ` — ${meta.taskPreview}` : ""}`;
      });
      return { content: [{ type: "text", text: lines.join("\n") }], details: { children: summaries } };
    },
  });

  pi.registerTool({
    name: "subagent_cancel",
    label: "Subagent cancel",
    description: "Cancel a running child and confirm its termination.",
    promptSnippet: "Cancel one child Pi",
    parameters: CancelParams,
    async execute(_toolCallId, params) {
      try {
        const receipt = await adapter.cancel(params.executionId, params.reason ?? "Cancelled by the attended lead.");
        return { content: [{ type: "text", text: `${params.executionId}: ${receipt.outcome}.` }], details: receipt, ...(receipt.outcome === "outcome_unknown" ? { isError: true } : {}) };
      } catch (error) {
        return failure("outcome_unknown", errorMessage(error));
      }
    },
  });
}

async function streamToResult(
  adapter: PiRpcExecutionAdapter,
  executionId: string,
  profile: string,
  cognitiveRole: string,
  signal: AbortSignal | undefined,
  onUpdate: ((update: { content: { type: "text"; text: string }[]; details?: unknown }) => void) | undefined,
  options: { cancelOnAbort: boolean },
) {
  let result;
  try { result = adapter.result(executionId); } catch (error) { return failure("outcome_unknown", errorMessage(error)); }

  let detached = false;
  const abort = () => {
    if (options.cancelOnAbort) void adapter.cancel(executionId, "Cancelled from the attended parent tool.");
    else detached = true;
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  const observations: Observation[] = [];
  const observing = (async () => {
    for await (const observation of adapter.observe(executionId)) {
      if (detached) return;
      observations.push({ type: observation.type, detail: observation.detail });
      if (observations.length > 30) observations.shift();
      onUpdate?.({
        content: [{ type: "text", text: progressText(observation) }],
        details: { executionId, profile, cognitiveRole, observations: [...observations] },
      });
    }
  })();

  const detachedRace = new Promise<"detached">((resolve) => {
    if (!options.cancelOnAbort) signal?.addEventListener("abort", () => resolve("detached"), { once: true });
  });
  const settled = await Promise.race([result.then(() => "done" as const), detachedRace]);
  signal?.removeEventListener("abort", abort);

  if (settled === "detached") {
    return {
      content: [{ type: "text", text: `Stopped watching ${executionId}; the child is still running. Use subagent_status or subagent_collect.` }],
      details: { outcome: "detached", executionId, observations },
    };
  }

  const final = await result;
  await observing;
  const summary = final.outcome === "success"
    ? final.text || "Child completed without a text result."
    : `${final.outcome}: ${final.diagnostic ?? final.text ?? "No diagnostic was reported."}`;
  return {
    content: [{ type: "text", text: summary }],
    details: { executionId, ...final, observations },
    ...(final.outcome === "success" ? {} : { isError: true }),
  };
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

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
