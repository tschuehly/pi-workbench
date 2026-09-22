import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { PiRpcExecutionAdapter, taskLabel } from "../../packages/pi-execution-adapter/src/index.js";
import { createUserLocalWorkerRegistry } from "../../packages/worker-registry/src/index.js";
import { removeActivity, upsertActivity } from "../activity/activity.mjs";
import { EXECUTION_CHANNEL } from "../telemetry/telemetry.mjs";
import { checkpointBarrier } from "../context-checkpoint/checkpoint-barrier.mjs";
import { createCompletionWakeup, isNormalCompletionAttention, receiptSafeResult, settleWorkerReceipt } from "./completion-wakeup.mjs";
import { activityText, progressText, recordProgress, renderProgressLog, reportedStatusText } from "./progress-log.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const resolver = path.resolve(here, "../../skills/model-orchestration/scripts/resolve-runtime-binding.mjs");
const DELEGATION_TOOLS = ["subagent", "subagent_collect", "subagent_status", "subagent_cancel"] as const;
export const PROFILES = {
  scout: {
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Investigate only. Do not mutate files unless the assignment says otherwise. Return compact evidence and conclusions to the attending lead.",
  },
  planner: {
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Produce a bounded plan or design judgment. Do not mutate files unless the assignment says otherwise. Name assumptions, risks, and verification.",
  },
  reviewer: {
    tools: ["read", "bash", "grep", "find", "ls"],
    instruction: "Review independently. Do not mutate files unless the assignment says otherwise. Lead with actionable findings and cite repository paths.",
  },
  implementer: {
    tools: ["read", "bash", "grep", "find", "ls", "edit", "write"],
    instruction: "Implement only the bounded assignment. Verify your changes and report files changed, checks, and remaining risks. Never push or publish. Do not commit unless the assignment explicitly authorizes a scope-only commit; then commit exactly what it names.",
  },
  plain: {
    tools: ["read", "bash", "grep", "find", "ls", "edit", "write"],
    instruction: "",
  },
  // Worker-only. A coordinator holds one scope's durable context and delegates the work itself to
  // fresh leaf Subagents; it has no edit or write tool, and no Worker lifecycle tool, so the
  // hierarchy stays exactly lead → Worker → leaf.
  coordinator: {
    tools: ["read", "bash", "grep", "find", "ls", ...DELEGATION_TOOLS],
    instruction: "Coordinate this scope (cognitive role: coordination). You do not edit files yourself: launch one fresh bounded leaf Subagent per phase, collect it exactly once, and keep only intent, decisions, and compact child evidence in your own context. Run at most one writing leaf at a time. Leaves never commit or publish; after their evidence passes you may make one mechanical scope-only checkpoint commit with bash. You cannot create workers.",
  },
} as const;

const LEAF_PROFILES = ["scout", "planner", "reviewer", "implementer", "plain"] as const;
const WORKER_PROFILES = [...LEAF_PROFILES, "coordinator"] as const;
// A leaf launched inside a Worker is the deepest supported level.
const INSIDE_WORKER = process.env.PI_WORKBENCH_EXECUTION_KIND === "worker";
const NO_NESTED_WORKERS = "Workers cannot create or dispatch Workers. The supported hierarchy is lead → Worker → leaf Subagent; delegate this work to a fresh leaf Subagent instead.";

// A long-running lead keeps the revision it started with. After a harness change on disk, that lead
// is silently running the old delegation rules until it restarts, so make the drift observable.
const HARNESS_SOURCES = [path.resolve(here, "index.ts"), path.resolve(here, "../../packages/pi-execution-adapter/src/index.js"), resolver];
export function harnessRevision(files: string[] = HARNESS_SOURCES): string {
  const hash = createHash("sha256");
  for (const file of files) {
    try { hash.update(readFileSync(file)); } catch { hash.update(`missing:${file}`); }
  }
  return hash.digest("hex").slice(0, 12);
}
const LOADED_HARNESS_REVISION = harnessRevision();

const COGNITIVE_ROLES = [
  "implementation", "problem-solving", "design", "escalation", "investigation",
  "independent-judgment", "challenge", "synthesis", "independent-review", "mechanics", "coordination",
] as const;
const INDEPENDENT_ROLES = new Set<string>(["independent-judgment", "challenge", "independent-review"]);
const WORKER_ROLES = COGNITIVE_ROLES.filter((role) => !INDEPENDENT_ROLES.has(role));
const TERMINAL_OUTCOMES = new Set(["success", "preflight_failed", "launch_failed", "execution_failed", "cancelled", "outcome_unknown"]);

const Params = Type.Object({
  task: Type.String({ minLength: 1, description: "Self-contained bounded assignment naming relevant paths, constraints, and expected output" }),
  name: Type.Optional(Type.String({ minLength: 1, description: "Short human-readable label for this child, a few words not a sentence (e.g. 'Fix login redirect'). Names the delegate roster row and the child session; falls back to a label derived from task when omitted." })),
  profile: StringEnum(LEAF_PROFILES, { description: "Bundled Level 1 child behavior profile" }),
  cognitiveRole: StringEnum(COGNITIVE_ROLES, { description: "Required kind of thinking; never a model name" }),
  independentOfProvider: Type.Optional(Type.String({ minLength: 1, description: "Author provider to route away from for independent-judgment, challenge, or independent-review. Use only when the exact author model is genuinely unavailable; explicit providers never inherit the active parent's model." })),
  independentOfModel: Type.Optional(Type.String({ minLength: 1, description: "Exact '<provider>/<model>' that authored the bytes under review, from the author's completion receipt. Independent roles default to the active parent provider/model; distinct-model overlays require this exact value." })),
  excludeFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Additional model families to reject during cross-family independent routing; propagated unchanged as repeatable exclusions and unavailable under distinct-model overlays" })),
  telemetryConcept: Type.Optional(Type.String({ minLength: 1, description: "Exact Studio concept slug when this execution is concept-bound" })),
  background: Type.Optional(Type.Boolean({ description: "Prefer true. Finish genuinely independent work, then end the turn; the completion signal starts the next turn. Never collect to wait. Omit only when the result is the immediate next input and nothing useful can happen first; always omit inside a Worker." })),
});

const CollectParams = Type.Object({ executionId: Type.Optional(Type.String({ minLength: 1, description: "One execution to inspect or collect; omit to reconcile every terminal child that is not yet collected" })) });
const StatusParams = Type.Object({
  executionId: Type.Optional(Type.String({ minLength: 1, description: "One execution to inspect; omit to list running and terminal-but-uncollected direct children" })),
  all: Type.Optional(Type.Boolean({ description: "Include already-collected children for bounded diagnostics" })),
});
const CancelParams = Type.Object({ executionId: Type.String({ minLength: 1 }), reason: Type.Optional(Type.String({ description: "Why the child is being cancelled" })) });
const ReportStatusParams = Type.Object({
  status: Type.String({ minLength: 1, maxLength: 200, description: "One short present-tense line describing what you are doing right now" }),
});

const WorkerCreateParams = Type.Object({
  name: Type.String({ minLength: 1, description: "Short human-readable worker name" }),
  scope: Type.String({ minLength: 1, description: "One semantic scope statement this worker retains context for" }),
  profile: StringEnum(WORKER_PROFILES, { description: "Bundled Level 1 child behavior profile. Use 'coordinator' for a worker that owns one scope and delegates its work to fresh leaf Subagents." }),
});
const WorkerDispatchParams = Type.Object({
  workerId: Type.String({ minLength: 1, description: "Durable worker identifier returned by worker_create or worker_status" }),
  task: Type.String({ minLength: 1, description: "Self-contained bounded assignment naming relevant paths, constraints, and expected output. Continuity supplements explicit tasking; it never replaces it." }),
  cognitiveRole: StringEnum(WORKER_ROLES, { description: "Required kind of thinking; Independence roles are subagent-only because independence requires fresh context" }),
  modelOverride: Type.Optional(Type.String({ minLength: 3, description: "Optional exact '<provider>/<model>' requested by the owner; the Cognitive Role still selects Model Effort" })),
  telemetryConcept: Type.Optional(Type.String({ minLength: 1, description: "Exact Studio concept slug when this execution is concept-bound" })),
  background: Type.Optional(Type.Boolean({ description: "Prefer true. Finish genuinely independent work, then end the turn; the completion signal starts the next turn. Never collect to wait. Omit only for a result that is the immediate next input when nothing useful can happen first." })),
  acknowledgeInspection: Type.Optional(Type.Boolean({ description: "Confirm the lead inspected a previous outcome_unknown dispatch before dispatching this worker again" })),
});
const WorkerStatusParams = Type.Object({
  workerId: Type.Optional(Type.String({ minLength: 1, description: "One worker to inspect; omit to list active workers owned by this session" })),
  all: Type.Optional(Type.Boolean({ description: "Show all machine-local workers across sessions, including retired records, for diagnostics" })),
});
const WorkerRetireParams = Type.Object({
  workerId: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1, description: "Why the worker's scope is finished or its context is no longer trustworthy" }),
});

type Observation = { type: string; at: string; detail?: unknown };
type ProgressEntry = { at: string; key: string; text: string };
type LaunchMeta = { profile: string; cognitiveRole: string; taskPreview: string; launchedAt: string; workerId?: string; workerName?: string };
type ForegroundDispatch = { label: string; detach: () => void };
/** A background Worker's registry receipt settles after its child result, so collection awaits it. */
type WorkerReceipt = { workerId: string; settled: Promise<{ error: unknown } | undefined> };

export default function subagentExtension(pi: ExtensionAPI, options: { adapter?: PiRpcExecutionAdapter; resolverPath?: string } = {}) {
  const adapter = options.adapter ?? new PiRpcExecutionAdapter();
  const launched = new Map<string, LaunchMeta>();
  const collected = new Set<string>();
  const foreground = new Map<string, ForegroundDispatch>();
  const registry = createUserLocalWorkerRegistry();
  const workerExecutions = new Map<string, string>();
  const workerReceipts = new Map<string, WorkerReceipt>();
  const reconciling = new Set<string>();
  const dismissedActivity = new Set<string>();
  const pendingWorkerCompletions = new Set<Promise<unknown>>();
  const pendingSubagentCompletions = new Set<Promise<unknown>>();
  const completionWakeup = createCheckpointAwareWakeup(pi);

  const backgroundShortcut = {
    description: "Background the newest foreground Subagent or Worker",
    handler: (ctx: ExtensionContext) => {
      const label = detachLatestForeground(foreground);
      ctx.ui.notify(label === undefined ? "No Subagent or Worker can be backgrounded." : `${label} is running in the background.`, "info");
    },
  };
  pi.registerShortcut("super+b", backgroundShortcut);
  pi.registerShortcut("ctrl+alt+b", backgroundShortcut);

  // Delivery, not collection, clears coalesced completion attention: the lead is now looking at the
  // signal. A settled agent re-arms too, so an aborted or swallowed delivery cannot mute later children.
  pi.on("message_start", (event: { message?: unknown }) => {
    if (isNormalCompletionAttention(event.message)) completionWakeup.rearm();
  });
  pi.on("agent_settled", () => completionWakeup.rearm());

  pi.on("session_shutdown", async () => {
    foreground.clear();
    completionWakeup.shutdown();
    await adapter.cancelAll("Attended parent session ended.");
    await Promise.allSettled([...pendingWorkerCompletions, ...pendingSubagentCompletions]);
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Launch one fresh attended child Pi for one bounded assignment. Prefer background:true; omit only for a result that is the immediate next input when nothing useful can happen first.",
    promptSnippet: "Delegate one bounded attended assignment to a fresh child Pi",
    promptGuidelines: [
      "Delegate execution only after the assignment's direction and verification are established. Use a subagent when context isolation, mechanical volume, parallelism, or genuinely independent judgment materially improves the result; work inline while the task needs continuous owner steering or is smaller than a handoff brief.",
      "Use a durable worker only when repeated assignments in one stable semantic scope demonstrably benefit from preserved context; otherwise use fresh subagents.",
      "Use one invocation for one bounded assignment while the user is attending.",
      "Prefer background:true. Finish genuinely independent work, then end the turn; the coalesced completion signal starts the next turn. Answer it with subagent_collect without an executionId. Never collect to wait. Omit background only when the result is the immediate next input and nothing useful can happen first.",
      "Correct an assignment by cancelling it and launching a new child; do not imply managed authority, recovery, or durable background work that survives the session.",
      "Never sleep, poll, or call subagent_collect to wait for a background child.",
      "For independent roles, quote the exact author provider/model from its completion receipt when available. Use excludeFamilies only for additional cross-family exclusions; distinct-model overlays reject it, and non-independent roles reject both options.",
      "If an independent child fails to launch or complete, disclose that failure; never present the parent's own review as independent.",
      "Inside a Worker, a Subagent is the deepest supported level: keep it in the foreground, collect it once, and never launch a Worker from it.",
    ],
    parameters: Params,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const profile = PROFILES[params.profile];
      if (profile === undefined) {
        return failure("preflight_failed", `Unknown child profile: ${params.profile}.`);
      }
      // A nested leaf must settle before its Worker's dispatch returns, otherwise the lead would
      // reconcile a Worker whose own child is still writing.
      if (INSIDE_WORKER && params.background === true) {
        return failure("preflight_failed", "A Subagent launched inside a Worker must run in the foreground so it settles and is collected before the Worker dispatch returns.");
      }

      const needsIndependence = INDEPENDENT_ROLES.has(params.cognitiveRole);
      if (!needsIndependence && (params.independentOfProvider !== undefined || params.independentOfModel !== undefined || params.excludeFamilies !== undefined)) {
        return failure("preflight_failed", `Cognitive Role '${params.cognitiveRole}' does not use an independence constraint or family exclusion.`);
      }
      let independentOfProvider = needsIndependence ? params.independentOfProvider : undefined;
      let independentOfModel = needsIndependence ? params.independentOfModel : undefined;
      if (needsIndependence && independentOfProvider === undefined && independentOfModel === undefined) {
        if (ctx.model?.provider && ctx.model?.id) independentOfModel = `${ctx.model.provider}/${ctx.model.id}`;
        else independentOfProvider = ctx.model?.provider || undefined;
      }
      if (needsIndependence && independentOfProvider === undefined && independentOfModel === undefined) {
        return failure("preflight_failed", `Cognitive Role '${params.cognitiveRole}' requires an author provider or model for independent routing.`);
      }
      if (needsIndependence && independentOfModel !== undefined && providerOf(independentOfModel) === undefined) {
        return failure("preflight_failed", `independentOfModel must be '<provider>/<model>', got '${independentOfModel}'.`);
      }

      let binding;
      try {
        binding = await resolveBinding(params.cognitiveRole, independentOfProvider, independentOfModel, undefined, params.excludeFamilies, options.resolverPath);
      } catch (error) {
        return failure("preflight_failed", errorMessage(error));
      }

      const parentSessionId = ctx.sessionManager.getSessionId();
      const childTask = profile.instruction === "" ? params.task : `${profile.instruction}\n\nAssignment:\n${params.task}`;
      const telemetryConcept = params.telemetryConcept ?? inheritedConcept();
      let receipt;
      try {
        receipt = await adapter.dispatch({
          task: childTask,
          profile: params.profile,
          cognitiveRole: params.cognitiveRole,
          cwd: ctx.cwd,
          tools: [...profile.tools],
          binding,
          parentSessionId,
          kind: "subagent",
          ...(params.name === undefined ? {} : { name: params.name }),
          ...(telemetryConcept === undefined ? {} : { telemetryConcept }),
        });
      } catch (error) {
        return failure("preflight_failed", errorMessage(error));
      }
      emitExecutionEvent(pi, {
        type: "execution.launched", at: receipt.acceptedAt, sessionId: parentSessionId,
        executionId: receipt.executionId, kind: "subagent", task: childTask,
        profile: params.profile, cognitiveRole: params.cognitiveRole, concept: telemetryConcept ?? null,
        provider: binding.provider, model: binding.model, effort: binding.effort,
        independence: binding.independence ?? null,
      });

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
        name: taskLabel(params.name ?? params.task),
        role: params.cognitiveRole,
        model: `${binding.provider}/${binding.model}`,
        effort: binding.effort,
        objective: taskGoal(params.task),
        activity: "starting",
      };
      upsertActivity(pi, activity);
      let backgrounded = params.background === true;
      void watchActivity(pi, adapter, receipt.executionId, activity, () => backgrounded && !dismissedActivity.has(receipt.executionId));

      const detachController = new AbortController();
      if (!backgrounded) {
        foreground.set(receipt.executionId, {
          label: `Subagent (${params.profile} · ${params.cognitiveRole})`,
          detach: () => { backgrounded = true; detachController.abort(); },
        });
      }
      // Register terminal cleanup before waiting so it wins a same-tick detach race.
      const completion = adapter.result(receipt.executionId).then((final) => {
        foreground.delete(receipt.executionId);
        emitExecutionEvent(pi, {
          type: "execution.settled", at: new Date().toISOString(), sessionId: parentSessionId,
          executionId: receipt.executionId, kind: "subagent", childSessionId: final.sessionId ?? null,
          outcome: final.outcome,
        });
        if (backgrounded) {
          completionWakeup.notify({
            executionId: receipt.executionId,
            outcome: final.outcome,
            profile: params.profile,
            cognitiveRole: params.cognitiveRole,
          });
        }
      });
      const tracked = completion.catch(() => {});
      pendingSubagentCompletions.add(tracked);
      void tracked.then(() => pendingSubagentCompletions.delete(tracked));
      const backgroundResult = (verb: string) => ({
        content: [{ type: "text" as const, text: `${verb} subagent ${receipt.executionId} in the background (${params.profile} · ${params.cognitiveRole}). Finish genuinely independent work, then end the turn. The completion signal starts the next turn; answer it with subagent_collect without an executionId. Inspect with subagent_status; stop with subagent_cancel.` }],
        details: { outcome: "launched", executionId: receipt.executionId, profile: params.profile, cognitiveRole: params.cognitiveRole, acceptedAt: receipt.acceptedAt },
      });
      if (backgrounded) return backgroundResult("Launched");

      try {
        const result = await streamToResult(adapter, receipt.executionId, params.profile, params.cognitiveRole, receipt.acceptedAt, signal, onUpdate, { cancelOnAbort: true, detachSignal: detachController.signal });
        if ((result as { details?: { outcome?: unknown } }).details?.outcome === "detached") return backgroundResult("Moved");
        collected.add(receipt.executionId);
        return result;
      } finally {
        foreground.delete(receipt.executionId);
      }
    },
  });

  pi.registerTool({
    name: "subagent_collect",
    label: "Subagent collect",
    description: "Reconcile background children. Without executionId, collect all terminal-uncollected children. With one, return an immediate bounded snapshot if running or the compact result if terminal. Worker results wait for registry receipts; receipt failures collect as outcome_unknown.",
    promptSnippet: "Reconcile backgrounded child Pi results",
    promptGuidelines: [
      "Answer a completion signal with subagent_collect without an executionId; the extension owns the terminal-uncollected set. Name one only for a known-terminal result or running snapshot.",
      "Never sleep, poll, or collect to wait. After a background launch, finish genuinely independent work and end the turn; the completion signal starts the next turn.",
    ],
    parameters: CollectParams,
    async execute(_toolCallId, params, signal, onUpdate) {
      // Callers pass only terminal children; reconciliation suppresses their completion-wakeup race.
      const collectOne = async (executionId: string) => {
        reconciling.add(executionId);
        completionWakeup.beginReconciliation(executionId);
        const meta = launched.get(executionId);
        const result = await streamToResult(adapter, executionId, meta?.profile ?? "unknown", meta?.cognitiveRole ?? "unknown", meta?.launchedAt ?? new Date().toISOString(), signal, onUpdate, { cancelOnAbort: false });
        const outcome = (result as { details?: { outcome?: unknown } }).details?.outcome;
        const terminal = typeof outcome === "string" && TERMINAL_OUTCOMES.has(outcome);
        if (terminal) collected.add(executionId);
        completionWakeup.finishReconciliation(executionId, terminal);
        reconciling.delete(executionId);
        const reconciled = await receiptSafeResult({ result, executionId, terminal, receipt: workerReceipts.get(executionId) });
        if (terminal) {
          dismissedActivity.add(executionId);
          removeActivity(pi, `delegate:${executionId}`);
        }
        return reconciled;
      };
      if (params.executionId !== undefined) {
        let status;
        try { status = adapter.status(params.executionId); } catch (error) { return failure("outcome_unknown", errorMessage(error)); }
        if (status.running) {
          const latest = status.latestObservation === undefined ? "no activity yet" : (activityText(status.latestObservation) ?? progressText(status.latestObservation));
          return {
            content: [{ type: "text", text: `${params.executionId} [running] ${status.provider}/${status.model}:${status.effort} — ${latest}\nStill running; end this turn—the completion signal wakes the lead for the next turn.` }],
            details: status,
          };
        }
        return collectOne(params.executionId);
      }
      const roster = adapter.list();
      // Reserve the whole set before the first await: parallel tool calls in one batch would
      // otherwise read the same roster and collect the same children twice.
      const pending = reservePending(roster, collected, reconciling);
      try {
        return await collectAll({ pending, running: roster.filter((child) => child.running).length, collectOne });
      } finally {
        for (const executionId of pending) reconciling.delete(executionId);
      }
    },
  });

  pi.registerTool({
    name: "subagent_status",
    label: "Subagent status",
    description: "Non-blocking snapshot of one child, or the running and terminal-but-uncollected direct children. Pass all:true for the full session roster.",
    promptSnippet: "Inspect backgrounded child Pi progress",
    promptGuidelines: [
      "Default subagent_status is the actionable set: children still running plus terminal children you have not reconciled. A completion signal arrives once rather than per child: reconcile it with subagent_collect and use status to see what is still running. Use all:true only for bounded diagnostics.",
    ],
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
      const roster = adapter.list();
      const all = params.all === true;
      const summaries = all ? roster : roster.filter((s) => s.running || !collected.has(s.executionId));
      const running = roster.filter((s) => s.running).length;
      const uncollected = roster.filter((s) => !s.running && !collected.has(s.executionId)).length;
      const current = harnessRevision();
      const stale = current === LOADED_HARNESS_REVISION ? "" : `\nHarness drift: this lead loaded delegation revision ${LOADED_HARNESS_REVISION}, but ${current} is on disk. Restart the lead before relying on the changed hierarchy rules.`;
      const counts = `${running} running, ${uncollected} terminal and uncollected, ${roster.length} launched this session.${stale}`;
      if (summaries.length === 0) {
        return { content: [{ type: "text", text: `${counts}${all ? "" : " Nothing needs reconciliation; use all:true for the full roster."}` }], details: { children: [], running, uncollected, total: roster.length } };
      }
      const lines = summaries.map((s) => {
        const meta = launched.get(s.executionId);
        const state = s.running ? "running" : `${s.outcome ?? "finished"}${collected.has(s.executionId) ? ", collected" : ", uncollected"}`;
        return `- ${s.executionId} [${state}] ${s.kind} · ${s.profile} · ${s.cognitiveRole}${meta?.workerName !== undefined ? ` · worker \"${meta.workerName}\"` : ""}${meta ? ` — ${meta.taskPreview}` : ""}`;
      });
      return { content: [{ type: "text", text: `${counts}\n${lines.join("\n")}` }], details: { children: summaries, running, uncollected, total: roster.length } };
    },
  });

  pi.registerTool({
    name: "report_status",
    label: "Report status",
    description: "Report your own current one-line status for the delegate roster the lead and owner see; a new report replaces your previous one. Call this once when you start real work on your assignment, and again whenever your phase changes materially (for example moving from investigation to implementation, or hitting a blocker). Do not call it on every tool call or minor step.",
    promptSnippet: "Report your current one-line status to the delegate roster",
    parameters: ReportStatusParams,
    async execute(_toolCallId, params) {
      return { content: [{ type: "text" as const, text: `Reported: ${params.status}` }], details: { outcome: "reported", status: params.status } };
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
      collected.add(params.executionId);
      dismissedActivity.add(params.executionId);
      try {
        const receipt = await adapter.cancel(params.executionId, params.reason ?? "Cancelled by the attended lead.");
        return { content: [{ type: "text", text: `${params.executionId}: ${receipt.outcome}.` }], details: receipt, ...(receipt.outcome === "outcome_unknown" ? { isError: true } : {}) };
      } catch (error) {
        return failure("outcome_unknown", errorMessage(error));
      } finally {
        removeActivity(pi, `delegate:${params.executionId}`);
      }
    },
  });

  pi.registerTool({
    name: "worker_create",
    label: "Worker create",
    description: "Create one durable attended worker: a machine-local identity owned by this lead session and bound to one semantic scope and repository root. Creation writes a record and starts no process. Prefer fresh subagents; create a worker only when repeated bounded actions in one scope benefit from preserved context.",
    promptSnippet: "Create one session-owned durable attended worker for one semantic scope",
    promptGuidelines: [
      "Worker identity persists across reloads of its owning lead session; use worker_status to reuse or retire a worker before creating another for the same scope.",
    ],
    parameters: WorkerCreateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (INSIDE_WORKER) return failure("preflight_failed", NO_NESTED_WORKERS);
      if (ctx.sessionManager.getSessionFile() === undefined) {
        return failure("preflight_failed", "Durable workers require a persisted lead Pi session.");
      }
      try {
        const record = await registry.create({
          name: params.name,
          scope: params.scope,
          profile: params.profile,
          repositoryRoot: ctx.cwd,
          ownerSessionId: ctx.sessionManager.getSessionId(),
        });
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
    description: "Dispatch one bounded assignment to a durable worker with scoped session continuity. Prefer background:true; omit only for a result that is the immediate next input when nothing useful can happen first. Owner-requested modelOverride changes the model, not role-selected effort. One dispatch at a time; none survives the attended session.",
    promptSnippet: "Dispatch one bounded assignment to a durable attended worker",
    promptGuidelines: [
      "Prefer fresh subagents; dispatch a worker only when its preserved scope context is valuable for this assignment.",
      "Keep every worker task self-contained with paths, constraints, and expected output; continuity supplements explicit tasking.",
      "Prefer background:true. Finish genuinely independent work, then end the turn; the coalesced completion signal starts the next turn. Answer it with subagent_collect without an executionId. Never collect to wait. Omit background only when the result is the immediate next input and nothing useful can happen first.",
      "Independence roles are subagent-only: never present worker output as independent judgment or review.",
      "A worker runs one dispatch at a time; a busy worker fails preflight instead of queueing.",
      "After an outcome_unknown dispatch, inspect the worker before dispatching again with acknowledgeInspection:true.",
      "Use worker_dispatch modelOverride only when the owner or run contract requests an exact model; Cognitive Role routing remains the default.",
    ],
    parameters: WorkerDispatchParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (INSIDE_WORKER) return failure("preflight_failed", NO_NESTED_WORKERS);
      if (INDEPENDENT_ROLES.has(params.cognitiveRole)) {
        return failure("preflight_failed", `Independence requires fresh context; Cognitive Role '${params.cognitiveRole}' is subagent-only.`);
      }
      if (ctx.sessionManager.getSessionFile() === undefined) {
        return failure("preflight_failed", "Durable workers require a persisted lead Pi session.");
      }
      const parentSessionId = ctx.sessionManager.getSessionId();
      let begin;
      try {
        begin = await registry.beginDispatch(params.workerId, {
          pid: process.pid,
          repositoryRoot: ctx.cwd,
          ownerSessionId: parentSessionId,
          acknowledgeInspection: params.acknowledgeInspection === true,
        });
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
        binding = await resolveBinding(params.cognitiveRole, undefined, undefined, params.modelOverride, undefined, options.resolverPath);
      } catch (error) {
        await abandon(errorMessage(error));
        return failure("preflight_failed", errorMessage(error));
      }
      const continuing = begin.continuationSessionId !== null;
      const preamble = `You are the durable attended worker \"${begin.name}\" with the semantic scope \"${begin.scope}\".${continuing ? " This dispatch resumes your persisted session; the earlier conversation above is your own prior work in this scope." : " This is your first dispatch in this scope."}`;
      const childTask = [profile.instruction, preamble, `Assignment:\n${params.task}`].filter(Boolean).join("\n\n");
      let receipt;
      try {
        receipt = await adapter.dispatch({
          task: childTask,
          profile: begin.profile,
          cognitiveRole: params.cognitiveRole,
          cwd: ctx.cwd,
          tools: [...profile.tools],
          binding,
          parentSessionId,
          kind: "worker",
          ...(params.telemetryConcept === undefined ? {} : { telemetryConcept: params.telemetryConcept }),
          ...(continuing ? { continuation: { sessionId: begin.continuationSessionId! } } : {}),
        });
      } catch (error) {
        await abandon(errorMessage(error));
        return failure("preflight_failed", errorMessage(error));
      }
      emitExecutionEvent(pi, {
        type: "execution.launched", at: receipt.acceptedAt, sessionId: parentSessionId,
        executionId: receipt.executionId, kind: "worker", workerId: params.workerId, task: childTask,
        profile: begin.profile, cognitiveRole: params.cognitiveRole, concept: params.telemetryConcept ?? null,
        provider: binding.provider, model: binding.model, effort: binding.effort,
        modelOverride: params.modelOverride ?? null, independence: binding.independence ?? null,
      });
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
        objective: taskGoal(params.task),
        activity: "starting",
      };
      upsertActivity(pi, activity);
      let backgrounded = params.background === true;
      void watchActivity(pi, adapter, receipt.executionId, activity, () => backgrounded && !dismissedActivity.has(receipt.executionId));
      const heartbeat = setInterval(() => { void registry.heartbeat(params.workerId, begin.lockToken).catch(() => {}); }, 15_000);
      heartbeat.unref();
      const detachController = new AbortController();
      if (!backgrounded) {
        foreground.set(receipt.executionId, {
          label: `Worker “${begin.name}”`,
          detach: () => { backgrounded = true; detachController.abort(); },
        });
      }
      // Register terminal cleanup before waiting so it wins a same-tick detach race.
      const completion = (async () => {
        let usage: unknown;
        const usageWatch = (async () => { for await (const observation of adapter.observe(receipt.executionId)) if (observation.type === "usage") usage = observation.detail; })().catch(() => {});
        const final = await adapter.result(receipt.executionId);
        foreground.delete(receipt.executionId);
        emitExecutionEvent(pi, {
          type: "execution.settled", at: new Date().toISOString(), sessionId: parentSessionId,
          executionId: receipt.executionId, kind: "worker", workerId: params.workerId,
          childSessionId: final.sessionId ?? null, outcome: final.outcome,
        });
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
          background: backgrounded,
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
      const tracked = completion.then(() => undefined, (error: unknown) => {
        clearInterval(heartbeat);
        return { error };
      });
      workerReceipts.set(receipt.executionId, { workerId: params.workerId, settled: tracked });
      pendingWorkerCompletions.add(tracked);
      void tracked.then(() => pendingWorkerCompletions.delete(tracked));

      const backgroundResult = (verb: string) => ({
        content: [{ type: "text" as const, text: `${verb} worker \"${begin.name}\" in the background using ${binding.provider}/${binding.model}:${binding.effort}: ${receipt.executionId} (${begin.profile} · ${params.cognitiveRole}${continuing ? ", resuming its session" : ", first dispatch"}). Finish genuinely independent work, then end the turn. After the receipt settles, the completion signal starts the next turn; answer it with subagent_collect without an executionId. Receipt failures send separate outcome_unknown attention. Stop with subagent_cancel.` }],
        details: { outcome: "launched", executionId: receipt.executionId, workerId: params.workerId, workerName: begin.name, profile: begin.profile, cognitiveRole: params.cognitiveRole, provider: binding.provider, model: binding.model, effort: binding.effort, modelOverride: params.modelOverride ?? null, continuing, acceptedAt: receipt.acceptedAt },
      });
      if (backgrounded) return backgroundResult("Dispatched");

      try {
        const result = await streamToResult(adapter, receipt.executionId, begin.profile, params.cognitiveRole, receipt.acceptedAt, signal, onUpdate, { cancelOnAbort: true, detachSignal: detachController.signal });
        if ((result as { details?: { outcome?: unknown } }).details?.outcome === "detached") return backgroundResult("Moved");
        collected.add(receipt.executionId);
        return receiptSafeResult({ result, executionId: receipt.executionId, terminal: true, receipt: workerReceipts.get(receipt.executionId) });
      } finally {
        foreground.delete(receipt.executionId);
      }
    },
  });

  pi.registerTool({
    name: "worker_status",
    label: "Worker status",
    description: "Inspect this session's durable workers by default. Pass all:true only for machine-wide diagnostics, including workers from other sessions and retired records.",
    promptSnippet: "Inspect durable attended workers",
    parameters: WorkerStatusParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const ownerSessionId = ctx.sessionManager.getSessionId();
        if (params.workerId !== undefined) {
          const record = await registry.inspect(params.workerId);
          if (params.all !== true && record.ownerSessionId === undefined) {
            return failure("preflight_failed", `Worker ${params.workerId} is a legacy unowned record; use all:true to inspect it, then dispatch or retire it from this persisted session to claim it.`);
          }
          if (params.all !== true && record.ownerSessionId !== ownerSessionId) {
            return failure("preflight_failed", `Worker ${params.workerId} belongs to another lead session; use all:true only for diagnostics.`);
          }
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
        const summaries = params.all === true
          ? await registry.list({ all: true })
          : await registry.list({ ownerSessionId });
        if (summaries.length === 0) {
          const text = params.all === true
            ? "No durable workers are recorded on this machine."
            : "No active durable workers are recorded for this session. Use all:true for machine-wide diagnostics.";
          return { content: [{ type: "text", text }], details: { workers: [] } };
        }
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (INSIDE_WORKER) return failure("preflight_failed", NO_NESTED_WORKERS);
      if (ctx.sessionManager.getSessionFile() === undefined) {
        return failure("preflight_failed", "Durable workers require a persisted lead Pi session.");
      }
      try {
        const retired = await registry.retire(params.workerId, params.reason, { ownerSessionId: ctx.sessionManager.getSessionId() });
        return { content: [{ type: "text", text: `Retired worker ${params.workerId} at ${retired.at}: ${retired.reason}` }], details: { workerId: params.workerId, ...retired } };
      } catch (error) {
        return registryFailure(error);
      }
    },
  });
}

export async function watchActivity(
  pi: Pick<ExtensionAPI, "events">,
  adapter: Pick<PiRpcExecutionAdapter, "observe">,
  executionId: string,
  activity: Record<string, unknown>,
  retainTerminal: () => boolean = () => false,
) {
  let completed = false;
  // A self-report is sticky across unrelated tool calls: once the child reports, its status
  // survives until the next report, while the inferred `activity` keeps changing per tool call.
  let reportedStatus: string | undefined;
  try {
    for await (const observation of adapter.observe(executionId)) {
      const text = activityText(observation);
      const reported = reportedStatusText(observation);
      if (reported !== undefined) reportedStatus = reported;
      if (text === undefined && reported === undefined) continue;
      upsertActivity(pi, {
        ...activity,
        ...(text === undefined ? {} : { activity: text }),
        ...(reportedStatus === undefined ? {} : { reportedStatus }),
      });
    }
    completed = true;
  } catch {
    // The execution result carries the diagnostic; this watcher owns presentation only.
  } finally {
    if (!completed || !retainTerminal()) removeActivity(pi, `delegate:${executionId}`);
  }
}

export function emitExecutionEvent(pi: Pick<ExtensionAPI, "events">, event: Record<string, unknown>) {
  pi.events.emit(EXECUTION_CHANNEL, event);
}

export async function streamToResult(
  adapter: PiRpcExecutionAdapter,
  executionId: string,
  profile: string,
  cognitiveRole: string,
  launchedAt: string,
  signal: AbortSignal | undefined,
  onUpdate: ((update: { content: { type: "text"; text: string }[]; details?: unknown }) => void) | undefined,
  options: { cancelOnAbort: boolean; detachSignal?: AbortSignal },
) {
  let result;
  try { result = adapter.result(executionId); } catch (error) { return failure("outcome_unknown", errorMessage(error)); }

  let detached = false;
  let detach = () => {};
  const detachedRace = new Promise<"detached">((resolve) => {
    detach = () => {
      if (detached) return;
      detached = true;
      resolve("detached");
    };
  });
  const abort = () => {
    if (options.cancelOnAbort) void adapter.cancel(executionId, "Cancelled from the attended parent tool.");
    else detach();
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  if (options.detachSignal?.aborted) detach();
  else options.detachSignal?.addEventListener("abort", detach, { once: true });

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

  const settled = await Promise.race([result.then(() => "done" as const), detachedRace]);
  clearInterval(heartbeat);
  signal?.removeEventListener("abort", abort);
  options.detachSignal?.removeEventListener("abort", detach);

  if (settled === "detached") {
    return {
      content: [{ type: "text", text: `Stopped watching ${executionId}; the child is still running. Use subagent_status, then end the turn; the completion signal wakes the lead.` }],
      details: { outcome: "detached", executionId, observations },
    };
  }

  const final = await result;
  await observing;
  const summary = final.outcome === "success"
    ? final.text || "Child completed without a text result."
    : `${final.outcome}: ${final.diagnostic ?? final.text ?? "No diagnostic was reported."}`;
  // The author model must be citable from the completion itself: a later independent review passes
  // it as independentOfModel, and digging it out of a child session log is not a receipt.
  const independence = final.independence;
  const familyReceipt = independence && "selectedFamily" in independence
    ? ` · family ${independence.selectedFamily}${independence.excludedFamilies?.length ? ` · excluded ${independence.excludedFamilies.join(",")}` : ""}`
    : "";
  const receiptLine = `\n\nCompletion receipt: ${final.provider}/${final.model}:${final.effort} · ${final.kind ?? "subagent"} · ${final.profile} · ${final.cognitiveRole} · outcome ${final.outcome}${familyReceipt}${final.truncated ? " · TRUNCATED, cannot satisfy verification" : ""}`;
  return {
    content: [{ type: "text", text: `${summary}${receiptLine}` }],
    details: { executionId, ...final, observations },
    ...(final.outcome === "success" ? {} : { isError: true }),
  };
}

const BULK_COLLECT_MAX_CHARS = 24_000;
const REMAINDER_NAMES = 10;

/** Claims the terminal-uncollected set before the first await so parallel calls cannot double-collect. */
export function reservePending(roster: { executionId: string; running: boolean }[], collected: Set<string>, reconciling: Set<string>): string[] {
  const pending = roster
    .filter((child) => !child.running && !collected.has(child.executionId) && !reconciling.has(child.executionId))
    .map((child) => child.executionId);
  for (const executionId of pending) reconciling.add(executionId);
  return pending;
}

/**
 * Reconciles the terminal-uncollected set the extension already owns, so a lead never restates
 * identifiers it was just shown and cannot silently drop a finished child. Collection stops once
 * the budget is spent: a child that was not read stays uncollected and is named, because marking
 * it collected without showing its result is the loss this tool exists to prevent.
 */
export async function collectAll({ pending, running, collectOne, maxChars = BULK_COLLECT_MAX_CHARS }: {
  pending: string[];
  running: number;
  collectOne: (executionId: string) => Promise<any>;
  maxChars?: number;
}) {
  const entries: { executionId: string; outcome: string; text: string; isError: boolean; truncated: boolean }[] = [];
  const remaining: string[] = [];
  let used = 0;
  for (const executionId of pending) {
    if (entries.length > 0 && used >= maxChars) { remaining.push(executionId); continue; }
    const result = await collectOne(executionId);
    const text = (result?.content ?? []).filter((part: any) => part?.type === "text").map((part: any) => String(part.text ?? "")).join("\n");
    used += text.length;
    entries.push({ executionId, outcome: String(result?.details?.outcome ?? "unknown"), text, isError: result?.isError === true, truncated: result?.details?.truncated === true });
  }

  const total = entries.length + remaining.length;
  const header = total === 0
    ? "Nothing terminal to reconcile."
    : `Reconciled ${entries.length} of ${total} terminal children.`;
  const truncated = entries.filter((entry) => entry.truncated).length;
  const notes = [
    truncated === 0 ? "" : `${truncated} result(s) truncated — verification incomplete.`,
    remaining.length === 0 ? "" : `Bounded before reading ${remaining.length} more; they stay uncollected, so collect again or name one: ${remaining.slice(0, REMAINDER_NAMES).join(", ")}${remaining.length > REMAINDER_NAMES ? `, and ${remaining.length - REMAINDER_NAMES} more reached by collecting again` : ""}.`,
    running === 0 ? "" : `${running} ${running === 1 ? "child is" : "children are"} still running and cannot be collected yet.`,
  ].filter((note) => note !== "");
  const sections = entries.map((entry) => `${entry.executionId} [${entry.outcome}]\n${entry.text}`);
  return {
    content: [{ type: "text" as const, text: [[header, ...notes].join(" "), ...sections].join("\n\n") }],
    details: {
      collected: entries.map((entry) => ({ executionId: entry.executionId, outcome: entry.outcome })),
      remaining,
      running,
    },
    ...(entries.some((entry) => entry.isError) ? { isError: true } : {}),
  };
}

/**
 * A completion signal asks for a turn. While a context checkpoint is pending or compacting, the
 * shared barrier queues that signal instead and releases it exactly once after the checkpoint settles.
 */
export function createCheckpointAwareWakeup(pi: any, barrier = checkpointBarrier()) {
  return createCompletionWakeup({
    sendMessage: (message: any, options: any) => {
      const send = () => pi.sendMessage(message, options);
      // The coalesced normal signal holds one stable key so a later one replaces it; a
      // receipt-failure wake stays distinct per execution.
      const key = message?.details?.attention !== undefined
        ? `attention:${message.details.attention}`
        : message?.details?.executionId === undefined ? undefined : `${message.details.executionId}:receipt-failure`;
      if (!barrier.defer(send, key)) send();
    },
  });
}

// A leaf launched inside a concept-bound Worker phase inherits that concept slug.
export function inheritedConcept(env: Record<string, string | undefined> = process.env): string | undefined {
  const value = env.PI_WORKBENCH_TELEMETRY_CONCEPT;
  return value === undefined || value.trim() === "" ? undefined : value;
}

export function providerOf(qualifiedModel: string | undefined): string | undefined {
  if (qualifiedModel === undefined) return undefined;
  const slash = qualifiedModel.indexOf("/");
  return slash > 0 && slash < qualifiedModel.length - 1 ? qualifiedModel.slice(0, slash) : undefined;
}

async function resolveBinding(cognitiveRole: string, independentOfProvider?: string, independentOfModel?: string, modelOverride?: string, excludeFamilies?: string[], resolverPath = resolver): Promise<any> {
  const args = [
    resolverPath, cognitiveRole,
    ...(modelOverride === undefined ? [] : ["--model", modelOverride]),
    ...(independentOfProvider === undefined ? [] : ["--independent-of", independentOfProvider]),
    ...(independentOfModel === undefined ? [] : ["--independent-of-model", independentOfModel]),
    ...(excludeFamilies ?? []).flatMap((family) => ["--exclude-family", family]),
  ];
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

export function detachLatestForeground(foreground: Map<string, ForegroundDispatch>): string | undefined {
  const latest = [...foreground.entries()].at(-1);
  if (latest === undefined) return undefined;
  const [executionId, dispatch] = latest;
  foreground.delete(executionId);
  dispatch.detach();
  return dispatch.label;
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

export function taskGoal(task: string): string {
  return bounded(taskLabel(task.split(/\r?\n/, 1)[0], 160), 160);
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
