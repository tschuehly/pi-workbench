import { execFile } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { PiRpcExecutionAdapter } from "../../packages/pi-execution-adapter/src/index.js";
import { createUserLocalWorkerRegistry } from "../../packages/worker-registry/src/index.js";
import { removeActivity, upsertActivity } from "../activity/activity.mjs";
import { createCompletionWakeup, settleWorkerReceipt, workerReceiptFailureResult } from "./completion-wakeup.mjs";
import { activityText, progressText, recordProgress, renderProgressLog } from "./progress-log.mjs";

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
  "implementation", "problem-solving", "design", "escalation", "investigation",
  "independent-judgment", "challenge", "synthesis", "independent-review", "mechanics",
] as const;
const INDEPENDENT_ROLES = new Set<string>(["independent-judgment", "challenge", "independent-review"]);
const WORKER_ROLES = COGNITIVE_ROLES.filter((role) => !INDEPENDENT_ROLES.has(role));
const TERMINAL_OUTCOMES = new Set(["success", "preflight_failed", "launch_failed", "execution_failed", "cancelled", "timed_out", "outcome_unknown"]);

const Params = Type.Object({
  task: Type.String({ minLength: 1, description: "Self-contained bounded assignment naming relevant paths, constraints, and expected output" }),
  profile: StringEnum(Object.keys(PROFILES) as (keyof typeof PROFILES)[], { description: "Bundled Level 1 child behavior profile" }),
  cognitiveRole: StringEnum(COGNITIVE_ROLES, { description: "Required kind of thinking; never a model name" }),
  independentOfProvider: Type.Optional(Type.String({ minLength: 1, description: "Author provider to route away from for independent-judgment, challenge, or independent-review. Defaults to the active parent model provider; set it explicitly for child-authored work." })),
  background: Type.Optional(Type.Boolean({ description: "Prefer true for most delegation: launch without blocking, then reconcile after the terminal wakeup with subagent_collect. The child still dies when the attended session ends." })),
});

const IdParam = Type.Object({ executionId: Type.String({ minLength: 1, description: "Execution identifier returned by a background subagent launch" }) });
const StatusParams = Type.Object({ executionId: Type.Optional(Type.String({ minLength: 1, description: "One execution to inspect; omit to list every child launched this session" })) });
const CancelParams = Type.Object({ executionId: Type.String({ minLength: 1 }), reason: Type.Optional(Type.String({ description: "Why the child is being cancelled" })) });

const WorkerCreateParams = Type.Object({
  name: Type.String({ minLength: 1, description: "Short human-readable worker name" }),
  scope: Type.String({ minLength: 1, description: "One semantic scope statement this worker retains context for" }),
  profile: StringEnum(Object.keys(PROFILES) as (keyof typeof PROFILES)[], { description: "Bundled Level 1 child behavior profile" }),
});
const WorkerDispatchParams = Type.Object({
  workerId: Type.String({ minLength: 1, description: "Durable worker identifier returned by worker_create or worker_status" }),
  task: Type.String({ minLength: 1, description: "Self-contained bounded assignment naming relevant paths, constraints, and expected output. Continuity supplements explicit tasking; it never replaces it." }),
  cognitiveRole: StringEnum(WORKER_ROLES, { description: "Required kind of thinking; Independence roles are subagent-only because independence requires fresh context" }),
  background: Type.Optional(Type.Boolean({ description: "Prefer true for most Worker dispatches: launch without blocking, then reconcile after the terminal wakeup with subagent_collect." })),
  acknowledgeInspection: Type.Optional(Type.Boolean({ description: "Confirm the lead inspected a previous outcome_unknown dispatch before dispatching this worker again" })),
});
const WorkerStatusParams = Type.Object({ workerId: Type.Optional(Type.String({ minLength: 1, description: "One worker to inspect; omit to list every durable worker for this machine" })) });
const WorkerRetireParams = Type.Object({
  workerId: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1, description: "Why the worker's scope is finished or its context is no longer trustworthy" }),
});

type Observation = { type: string; at: string; detail?: unknown };
type ProgressEntry = { at: string; key: string; text: string };
type LaunchMeta = { profile: string; cognitiveRole: string; taskPreview: string; launchedAt: string; workerId?: string; workerName?: string };

export default function subagentExtension(pi: ExtensionAPI) {
  const adapter = new PiRpcExecutionAdapter();
  const launched = new Map<string, LaunchMeta>();
  const registry = createUserLocalWorkerRegistry();
  const workerExecutions = new Map<string, string>();
  const pendingWorkerCompletions = new Set<Promise<unknown>>();
  const pendingSubagentCompletions = new Set<Promise<unknown>>();
  const completionWakeup = createCompletionWakeup({
    sendMessage: (message: any, options: any) => pi.sendMessage(message, options),
  });

  pi.on("session_shutdown", async () => {
    completionWakeup.shutdown();
    await adapter.cancelAll("Attended parent session ended.");
    await Promise.allSettled([...pendingWorkerCompletions, ...pendingSubagentCompletions]);
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Launch one fresh attended child Pi for one bounded assignment. Use background:true when the lead has distinct useful work or needs to remain responsive; otherwise omit it and reconcile the compact result directly.",
    promptSnippet: "Delegate one bounded attended assignment to a fresh child Pi",
    promptGuidelines: [
      "Delegate execution only after the assignment's direction and verification are established. Use a subagent when context isolation, mechanical volume, parallelism, or genuinely independent judgment materially improves the result; work inline while the task needs continuous owner steering or is smaller than a handoff brief.",
      "Use a durable worker only when repeated assignments in one stable semantic scope demonstrably benefit from preserved context; otherwise use fresh subagents.",
      "Use one invocation for one bounded assignment while the user is attending.",
      "Use background:true when the lead has distinct useful work or needs to remain responsive; otherwise run the Subagent in the foreground. Reconcile every background result with subagent_collect and cancel with subagent_cancel.",
      "Correct an assignment by cancelling it and launching a new child; do not imply managed authority, recovery, or durable background work that survives the session.",
      "If an independent child fails to launch or complete, disclose that failure; never present the parent's own review as independent.",
    ],
    parameters: Params,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const profile = PROFILES[params.profile];
      if (profile === undefined) {
        return failure("preflight_failed", `Unknown child profile: ${params.profile}.`);
      }

      const needsIndependence = INDEPENDENT_ROLES.has(params.cognitiveRole);
      if (!needsIndependence && params.independentOfProvider !== undefined) {
        return failure("preflight_failed", `Cognitive Role '${params.cognitiveRole}' does not use independentOfProvider.`);
      }
      const independentOfProvider = needsIndependence ? (params.independentOfProvider ?? ctx.model?.provider) : undefined;
      if (needsIndependence && independentOfProvider === undefined) {
        return failure("preflight_failed", `Cognitive Role '${params.cognitiveRole}' requires an author provider for independent routing.`);
      }

      let binding;
      try {
        binding = await resolveBinding(params.cognitiveRole, independentOfProvider);
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

      const meta = {
        profile: params.profile,
        cognitiveRole: params.cognitiveRole,
        taskPreview: bounded(params.task, 200),
        launchedAt: receipt.acceptedAt,
      };
      launched.set(receipt.executionId, meta);
      const activity = {
        id: `delegate:${receipt.executionId}`,
        kind: "subagent",
        role: params.cognitiveRole,
        model: `${binding.provider}/${binding.model}`,
        effort: binding.effort,
        objective: params.task,
        activity: "starting",
      };
      upsertActivity(pi, activity);
      void watchActivity(pi, adapter, receipt.executionId, activity);

      if (params.background === true) {
        const completion = adapter.result(receipt.executionId).then((final) => {
          completionWakeup.notify({
            executionId: receipt.executionId,
            outcome: final.outcome,
            profile: params.profile,
            cognitiveRole: params.cognitiveRole,
          });
        });
        const tracked = completion.catch(() => {});
        pendingSubagentCompletions.add(tracked);
        void tracked.then(() => pendingSubagentCompletions.delete(tracked));
        return {
          content: [{ type: "text", text: `Launched background subagent ${receipt.executionId} (${params.profile} · ${params.cognitiveRole}). Its terminal outcome will wake this lead once; reconcile with subagent_collect, watch with subagent_status, stop with subagent_cancel.` }],
          details: { outcome: "launched", executionId: receipt.executionId, profile: params.profile, cognitiveRole: params.cognitiveRole, acceptedAt: receipt.acceptedAt },
        };
      }

      return streamToResult(adapter, receipt.executionId, params.profile, params.cognitiveRole, receipt.acceptedAt, signal, onUpdate, { cancelOnAbort: true });
    },
  });

  pi.registerTool({
    name: "subagent_collect",
    label: "Subagent collect",
    description: "Stream the remaining progress of a backgrounded child and return its compact terminal result. Aborting collect stops waiting but leaves the child running.",
    promptSnippet: "Reconcile one backgrounded child Pi",
    parameters: IdParam,
    async execute(_toolCallId, params, signal, onUpdate) {
      completionWakeup.beginReconciliation(params.executionId);
      const meta = launched.get(params.executionId);
      const result = await streamToResult(adapter, params.executionId, meta?.profile ?? "unknown", meta?.cognitiveRole ?? "unknown", meta?.launchedAt ?? new Date().toISOString(), signal, onUpdate, { cancelOnAbort: false });
      const outcome = (result as { details?: { outcome?: unknown } }).details?.outcome;
      completionWakeup.finishReconciliation(params.executionId, typeof outcome === "string" && TERMINAL_OUTCOMES.has(outcome));
      return result;
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
        return `- ${s.executionId} [${state}] ${s.profile} · ${s.cognitiveRole}${meta?.workerName !== undefined ? ` · worker \"${meta.workerName}\"` : ""}${meta ? ` — ${meta.taskPreview}` : ""}`;
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
      completionWakeup.markHandled(params.executionId);
      try {
        const receipt = await adapter.cancel(params.executionId, params.reason ?? "Cancelled by the attended lead.");
        return { content: [{ type: "text", text: `${params.executionId}: ${receipt.outcome}.` }], details: receipt, ...(receipt.outcome === "outcome_unknown" ? { isError: true } : {}) };
      } catch (error) {
        return failure("outcome_unknown", errorMessage(error));
      }
    },
  });

  pi.registerTool({
    name: "worker_create",
    label: "Worker create",
    description: "Create one durable attended worker: a machine-local identity bound to one semantic scope and this repository root. Creation writes a record and starts no process. Prefer fresh subagents; create a worker only when repeated bounded actions in one scope benefit from preserved context.",
    promptSnippet: "Create one durable attended worker for one semantic scope",
    promptGuidelines: [
      "Worker identity is durable across sessions: check worker_status for an existing worker covering the scope and reuse or retire it before creating another.",
    ],
    parameters: WorkerCreateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const record = await registry.create({ name: params.name, scope: params.scope, profile: params.profile, repositoryRoot: ctx.cwd });
        return {
          content: [{ type: "text", text: `Created worker ${record.workerId} \"${record.name}\" (${record.profile}) for scope \"${record.scope}\", bound to ${record.repositoryRoot}. Dispatch bounded assignments with worker_dispatch.` }],
          details: record,
        };
      } catch (error) {
        return registryFailure(error);
      }
    },
  });

  pi.registerTool({
    name: "worker_dispatch",
    label: "Worker dispatch",
    description: "Dispatch one bounded attended assignment to a durable worker, resuming its persisted Pi session for continuity within its scope. Use background:true when the lead has distinct useful work or needs to remain responsive; otherwise omit it. One dispatch at a time per worker; no execution survives the attended session.",
    promptSnippet: "Dispatch one bounded assignment to a durable attended worker",
    promptGuidelines: [
      "Prefer fresh subagents; dispatch a worker only when its preserved scope context is valuable for this assignment.",
      "Keep every worker task self-contained with paths, constraints, and expected output; continuity supplements explicit tasking.",
      "Use background:true when the lead has distinct useful work or needs to remain responsive; otherwise run the Worker dispatch in the foreground. Reconcile every background result with subagent_collect.",
      "Independence roles are subagent-only: never present worker output as independent judgment or review.",
      "A worker runs one dispatch at a time; a busy worker fails preflight instead of queueing.",
      "After an outcome_unknown dispatch, inspect the worker before dispatching again with acknowledgeInspection:true.",
    ],
    parameters: WorkerDispatchParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (INDEPENDENT_ROLES.has(params.cognitiveRole)) {
        return failure("preflight_failed", `Independence requires fresh context; Cognitive Role '${params.cognitiveRole}' is subagent-only.`);
      }
      let begin;
      try {
        begin = await registry.beginDispatch(params.workerId, { pid: process.pid, repositoryRoot: ctx.cwd, acknowledgeInspection: params.acknowledgeInspection === true });
      } catch (error) {
        return registryFailure(error);
      }
      const abandon = async (diagnostic: string) => {
        try { await registry.completeDispatch(params.workerId, begin.lockToken, { outcome: "preflight_failed", cognitiveRole: params.cognitiveRole, diagnostic }); } catch {}
      };
      const profile = PROFILES[begin.profile as keyof typeof PROFILES];
      if (profile === undefined) {
        await abandon(`Worker profile '${begin.profile}' is not a bundled profile.`);
        return failure("preflight_failed", `Worker profile '${begin.profile}' is not a bundled profile.`);
      }
      let binding;
      try {
        binding = await resolveBinding(params.cognitiveRole);
      } catch (error) {
        await abandon(errorMessage(error));
        return failure("preflight_failed", errorMessage(error));
      }
      const continuing = begin.continuationSessionId !== null;
      const preamble = `You are the durable attended worker \"${begin.name}\" with the semantic scope \"${begin.scope}\".${continuing ? " This dispatch resumes your persisted session; the earlier conversation above is your own prior work in this scope." : " This is your first dispatch in this scope."}`;
      let receipt;
      try {
        receipt = await adapter.dispatch({
          task: `${profile.instruction}\n\n${preamble}\n\nAssignment:\n${params.task}`,
          profile: begin.profile,
          cognitiveRole: params.cognitiveRole,
          cwd: ctx.cwd,
          tools: [...profile.tools],
          binding,
          ...(continuing ? { continuation: { sessionId: begin.continuationSessionId! } } : {}),
        });
      } catch (error) {
        await abandon(errorMessage(error));
        return failure("preflight_failed", errorMessage(error));
      }
      workerExecutions.set(params.workerId, receipt.executionId);
      const meta = {
        profile: begin.profile,
        cognitiveRole: params.cognitiveRole,
        taskPreview: bounded(params.task, 200),
        launchedAt: receipt.acceptedAt,
        workerId: params.workerId,
        workerName: begin.name,
      };
      launched.set(receipt.executionId, meta);
      const activity = {
        id: `delegate:${receipt.executionId}`,
        kind: "worker",
        name: begin.name,
        role: params.cognitiveRole,
        model: `${binding.provider}/${binding.model}`,
        effort: binding.effort,
        objective: params.task,
        activity: "starting",
      };
      upsertActivity(pi, activity);
      void watchActivity(pi, adapter, receipt.executionId, activity);
      const heartbeat = setInterval(() => { void registry.heartbeat(params.workerId, begin.lockToken).catch(() => {}); }, 15_000);
      heartbeat.unref();
      let workerReceiptError: unknown;
      const completion = (async () => {
        let usage: unknown;
        const usageWatch = (async () => { for await (const observation of adapter.observe(receipt.executionId)) if (observation.type === "usage") usage = observation.detail; })().catch(() => {});
        const final = await adapter.result(receipt.executionId);
        await usageWatch;
        clearInterval(heartbeat);
        await settleWorkerReceipt({
          settle: () => registry.completeDispatch(params.workerId, begin.lockToken, {
            executionId: receipt.executionId,
            outcome: final.outcome,
            cognitiveRole: params.cognitiveRole,
            provider: final.provider,
            model: final.model,
            effort: final.effort,
            sessionId: final.sessionId,
            acceptedAt: receipt.acceptedAt,
            endedAt: new Date().toISOString(),
            usage,
            diagnostic: final.diagnostic,
          }),
          wakeup: completionWakeup,
          background: params.background === true,
          completion: {
            executionId: receipt.executionId,
            outcome: final.outcome,
            profile: begin.profile,
            cognitiveRole: params.cognitiveRole,
            workerId: params.workerId,
            workerName: begin.name,
          },
        });
      })();
      const tracked = completion.catch((error) => {
        workerReceiptError = error;
        clearInterval(heartbeat);
      });
      pendingWorkerCompletions.add(tracked);
      void tracked.then(() => pendingWorkerCompletions.delete(tracked));

      if (params.background === true) {
        return {
          content: [{ type: "text", text: `Dispatched worker \"${begin.name}\" in the background: ${receipt.executionId} (${begin.profile} · ${params.cognitiveRole}${continuing ? ", resuming its session" : ", first dispatch"}). Its terminal outcome will wake this lead once after the Worker receipt settles; a receipt failure wakes bounded outcome_unknown attention instead. Reconcile with subagent_collect, watch with subagent_status, stop with subagent_cancel.` }],
          details: { outcome: "launched", executionId: receipt.executionId, workerId: params.workerId, workerName: begin.name, profile: begin.profile, cognitiveRole: params.cognitiveRole, continuing, acceptedAt: receipt.acceptedAt },
        };
      }

      const result = await streamToResult(adapter, receipt.executionId, begin.profile, params.cognitiveRole, receipt.acceptedAt, signal, onUpdate, { cancelOnAbort: true });
      await tracked;
      if (workerReceiptError !== undefined) return workerReceiptFailureResult(result, receipt.executionId, params.workerId, workerReceiptError);
      return result;
    },
  });

  pi.registerTool({
    name: "worker_status",
    label: "Worker status",
    description: "Inspect one durable worker's record and any live dispatch, or list every durable worker recorded for this machine.",
    promptSnippet: "Inspect durable attended workers",
    parameters: WorkerStatusParams,
    async execute(_toolCallId, params) {
      try {
        if (params.workerId !== undefined) {
          const record = await registry.inspect(params.workerId);
          const latest = record.receipts[record.receipts.length - 1];
          const lines = [
            `${record.workerId} \"${record.name}\" (${record.profile})${record.retired !== null ? ` [retired ${record.retired.at}: ${record.retired.reason}]` : ""}`,
            `Scope: ${record.scope}`,
            `Root: ${record.repositoryRoot} · created ${record.createdAt} · ${record.receipts.length} recorded dispatch(es) · latest session ${record.sessionLineage[record.sessionLineage.length - 1] ?? "none"}`,
          ];
          if (record.lock !== null) lines.push(`Locked by pid ${record.lock.pid} since ${record.lock.acquiredAt} (last heartbeat ${record.lock.heartbeatAt}).`);
          if (record.requiresInspection !== null) lines.push(`Requires inspection since ${record.requiresInspection.at}: ${record.requiresInspection.diagnostic ?? "unknown outcome"}. Dispatch again only with acknowledgeInspection:true.`);
          if (latest !== undefined) lines.push(`Last dispatch: ${latest.outcome} · ${latest.provider ?? "?"}/${latest.model ?? "?"}:${latest.effort ?? "?"} · ended ${latest.endedAt}${latest.usage !== null ? ` · usage ${bounded(JSON.stringify(latest.usage), 200)}` : ""}`);
          const executionId = workerExecutions.get(params.workerId);
          let live;
          if (executionId !== undefined) {
            try {
              const status = adapter.status(executionId);
              if (status.running) { live = status; lines.push(`Live dispatch ${executionId}: ${status.latestObservation === undefined ? "no activity yet" : progressText(status.latestObservation)}`); }
            } catch {}
          }
          return { content: [{ type: "text", text: lines.join("\n") }], details: { record, live } };
        }
        const summaries = await registry.list();
        if (summaries.length === 0) return { content: [{ type: "text", text: "No durable workers are recorded on this machine." }], details: { workers: [] } };
        const lines = summaries.map((s) => `- ${s.workerId} \"${s.name}\" (${s.profile}) [${s.retired ? "retired" : s.locked ? "dispatching" : s.requiresInspection ? "needs inspection" : "idle"}] ${s.dispatchCount} dispatch(es), last ${s.latestOutcome ?? "none"} — ${s.scope}`);
        return { content: [{ type: "text", text: lines.join("\n") }], details: { workers: summaries } };
      } catch (error) {
        return registryFailure(error);
      }
    },
  });

  pi.registerTool({
    name: "worker_retire",
    label: "Worker retire",
    description: "Immutably retire a durable worker whose scope is finished or whose accumulated context is no longer trustworthy. A retired worker cannot be dispatched again; start a fresh worker or subagent instead.",
    promptSnippet: "Retire one durable attended worker",
    parameters: WorkerRetireParams,
    async execute(_toolCallId, params) {
      try {
        const retired = await registry.retire(params.workerId, params.reason);
        return { content: [{ type: "text", text: `Retired worker ${params.workerId} at ${retired.at}: ${retired.reason}` }], details: { workerId: params.workerId, ...retired } };
      } catch (error) {
        return registryFailure(error);
      }
    },
  });
}

async function watchActivity(pi: ExtensionAPI, adapter: PiRpcExecutionAdapter, executionId: string, activity: Record<string, unknown>) {
  try {
    for await (const observation of adapter.observe(executionId)) upsertActivity(pi, { ...activity, activity: activityText(observation) });
  } catch {
    // The execution result carries the diagnostic; this watcher owns presentation only.
  } finally {
    removeActivity(pi, `delegate:${executionId}`);
  }
}

async function streamToResult(
  adapter: PiRpcExecutionAdapter,
  executionId: string,
  profile: string,
  cognitiveRole: string,
  launchedAt: string,
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
  const progressEntries: ProgressEntry[] = [];
  const parsedStartedAt = Date.parse(launchedAt);
  const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now();
  const renderUpdate = () => onUpdate?.({
    content: [{ type: "text", text: renderProgressLog({ entries: progressEntries, startedAt, now: Date.now(), profile, cognitiveRole }) }],
    details: { executionId, profile, cognitiveRole, observations: [...observations] },
  });
  const heartbeat = setInterval(renderUpdate, 5_000);
  heartbeat.unref();
  const observing = (async () => {
    for await (const observation of adapter.observe(executionId)) {
      if (detached) return;
      observations.push({ type: observation.type, at: observation.at, detail: observation.detail });
      if (observations.length > 30) observations.shift();
      recordProgress(progressEntries, observation);
      renderUpdate();
    }
  })();

  const detachedRace = new Promise<"detached">((resolve) => {
    if (!options.cancelOnAbort) signal?.addEventListener("abort", () => resolve("detached"), { once: true });
  });
  const settled = await Promise.race([result.then(() => "done" as const), detachedRace]);
  clearInterval(heartbeat);
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

async function resolveBinding(cognitiveRole: string, independentOfProvider?: string): Promise<any> {
  const args = [resolver, cognitiveRole, ...(independentOfProvider === undefined ? [] : ["--independent-of", independentOfProvider])];
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, args, { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 15_000 }, (error, output, stderr) => {
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

function registryFailure(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  const diagnostic = errorMessage(error);
  const coded = typeof code === "string" ? `[${code}] ${diagnostic}` : diagnostic;
  return { content: [{ type: "text" as const, text: `preflight_failed: ${coded}` }], details: { outcome: "preflight_failed", ...(typeof code === "string" ? { code } : {}), diagnostic }, isError: true };
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
