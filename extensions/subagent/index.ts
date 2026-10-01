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
// The web tools are the ceiling web_enable activates within: Pi drops tools missing from --tools, so a
// web_enable-only list would leave it nothing to enable. keepChildWebToolsLazy keeps them inactive until then.
const WEB_TOOLS = ["web_search", "source_check", "fetch_content", "get_search_content"];
const CHILD_TOOLS = ["read", "bash", "grep", "find", "ls", "report_status", "web_enable", "web_search", "source_check", "fetch_content", "get_search_content"] as const;
const STATUS_INSTRUCTION = "Keep going while a step needs no input from the lead; stop early only when the assignment's stop condition applies or you cannot continue. Start your final report with anything you need from the lead, then what you changed and what you found.";
export const PROFILES = {
  scout: {
    tools: [...CHILD_TOOLS],
    instruction: "Investigate only. Do not mutate files unless the assignment says otherwise. Return compact evidence and conclusions to the attending lead. Mark anything you could not confirm and say where you looked.",
  },
  planner: {
    tools: [...CHILD_TOOLS],
    instruction: "Produce a bounded plan or design judgment. Do not mutate files unless the assignment says otherwise. State assumptions, options, risks, verification, and one recommendation.",
  },
  reviewer: {
    tools: [...CHILD_TOOLS],
    instruction: "Review independently. Do not mutate files unless the assignment says otherwise. List only problems you would block on. For each, give the file and line, why it is wrong, and how to show it fails. Say what you did not check.",
  },
  implementer: {
    tools: [...CHILD_TOOLS, "edit", "write"],
    instruction: "Implement only the bounded assignment and continue until its done condition holds. Verify your changes and report files changed, checks, and remaining risks. Never push or publish. Do not commit unless the assignment explicitly authorizes a scope-only commit; then commit exactly what it names.",
  },
  plain: {
    tools: [...CHILD_TOOLS, "edit", "write"],
    instruction: "",
  },
  // Worker-only. A coordinator holds one scope's durable context and delegates the work itself to
  // fresh leaf Subagents; it has no edit or write tool, and no Worker lifecycle tool, so the
  // hierarchy stays exactly lead → Worker → leaf.
  coordinator: {
    tools: [...CHILD_TOOLS, ...DELEGATION_TOOLS],
    instruction: "Coordinate this scope (cognitive role: coordination). You do not edit files yourself: launch one fresh bounded leaf Subagent per phase, collect it exactly once, and keep only intent, decisions, and compact child evidence in your own context. Check each leaf's evidence before you accept its result. Run at most one writing leaf at a time. Leaves never commit or publish; after their evidence passes you may make one mechanical scope-only checkpoint commit with bash. You cannot create workers.",
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

const COGNITIVE_ROLES = ["routine", "implementation", "frontier", "coordination", "review"] as const;
// Latitude is how much the child must decide for itself: how unclear the problem is and how little
// the brief specifies. It selects the model tier; skills/model-orchestration/references/routing-policy.json
// names the models.
const ROLE_GUIDE = "How much the child must decide; picks the model tier (see the model-orchestration skill).\nroutine: you can list what to check or change\nimplementation: you can state the finish line, not the approach\nfrontier: you have only a symptom or an open question\ncoordination: a Worker owning one scope\nreview: independent other-family judgment; state the lens";
const MODEL_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const INDEPENDENT_ROLES = new Set<string>(["review"]);
const WORKER_ROLES = COGNITIVE_ROLES.filter((role) => !INDEPENDENT_ROLES.has(role));
const TERMINAL_OUTCOMES = new Set(["success", "preflight_failed", "launch_failed", "execution_failed", "cancelled", "outcome_unknown"]);
// Session custom entries that let a reloaded runtime answer for children an earlier runtime launched.
export const CHILD_RECORD = "pi-workbench.subagent-child";
const RETAINED_TEXT_MAX = 8_000;

const Params = Type.Object({
  task: Type.String({ minLength: 1, description: "Self-contained bounded assignment: the task, relevant paths and constraints, 'Done means …' (a checkable finish line), 'Stop and ask only if …', and the expected output" }),
  name: Type.Optional(Type.String({ minLength: 1, description: "Short human-readable label for this child, a few words not a sentence (e.g. 'Fix login redirect'). Names the delegate roster row and the child session; falls back to a label derived from task when omitted." })),
  profile: StringEnum(LEAF_PROFILES, { description: "Bundled Level 1 child behavior profile" }),
  cognitiveRole: StringEnum(COGNITIVE_ROLES, { description: ROLE_GUIDE }),
  modelOverride: Type.Optional(Type.String({ minLength: 3, description: "Exact '<provider>/<model>': an owner request, the reserve model claude-fable-5-1 as second frontier panel member, or the other family's strong model for review of frontier work; review still checks the family" })),
  effort: Type.Optional(StringEnum(MODEL_EFFORTS, { description: "Explicit Model Effort; the Cognitive Role still selects the model" })),
  independentOfProvider: Type.Optional(Type.String({ minLength: 1, description: "Author provider to route away from for review. Use only when the exact author model is genuinely unavailable; explicit providers never inherit the active parent's model." })),
  independentOfModel: Type.Optional(Type.String({ minLength: 1, description: "Exact '<provider>/<model>' that authored the bytes under review, from the author's completion receipt. Independent roles default to the active parent provider/model; distinct-model overlays require this exact value." })),
  excludeFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Additional model families to reject during cross-family independent routing; propagated unchanged as repeatable exclusions and unavailable under distinct-model overlays" })),
  telemetryConcept: Type.Optional(Type.String({ minLength: 1, description: "Exact Studio concept slug when this execution is concept-bound" })),
  background: Type.Optional(Type.Boolean({ description: "Return immediately; a completion signal arrives later." })),
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
  task: Type.String({ minLength: 1, description: "Self-contained bounded assignment: the task, relevant paths and constraints, 'Done means …', 'Stop and ask only if …', and the expected output. Continuity supplements explicit tasking; it never replaces it." }),
  cognitiveRole: StringEnum(WORKER_ROLES, { description: `${ROLE_GUIDE}\nreview is subagent-only here: independence requires fresh context` }),
  modelOverride: Type.Optional(Type.String({ minLength: 3, description: "Owner-requested exception selecting one exact '<provider>/<model>'" })),
  effort: Type.Optional(StringEnum(MODEL_EFFORTS, { description: "Explicit Model Effort; the Cognitive Role still selects the model" })),
  telemetryConcept: Type.Optional(Type.String({ minLength: 1, description: "Exact Studio concept slug when this execution is concept-bound" })),
  background: Type.Optional(Type.Boolean({ description: "Return immediately; a completion signal arrives later." })),
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
/** A background Worker's registry receipt settles after its child result. */
type WorkerReceipt = { workerId: string; settled: Promise<{ error: unknown } | undefined>; isSettled: boolean };
type ChildRecord = {
  executionId: string; kind?: string; name?: string; profile?: string; cognitiveRole?: string; model?: string;
  taskPreview?: string; launchedAt?: string; workerId?: string; workerName?: string; status?: string; text?: string; truncated?: boolean;
  diagnostic?: string; childSessionId?: string; collected?: boolean;
};

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
  if (process.env.PI_WORKBENCH_EXECUTION_KIND !== undefined) keepChildWebToolsLazy(pi);
  // Children an earlier runtime of this session launched; the live adapter no longer knows them.
  let retained = new Map<string, ChildRecord>();
  let shuttingDown = false;
  const record = (data: ChildRecord) => { try { pi.appendEntry?.(CHILD_RECORD, data); } catch {} };
  // A child cancelled by session shutdown stays `running` in the record, so the next runtime reports it interrupted.
  const recordSettled = (executionId: string, final: { outcome: string; text?: string; truncated?: boolean; diagnostic?: string; sessionId?: string }) => {
    if (shuttingDown) return;
    const text = final.text ?? "";
    record({ executionId, status: final.outcome, text: bounded(text, RETAINED_TEXT_MAX), truncated: final.truncated === true || text.length > RETAINED_TEXT_MAX, diagnostic: final.diagnostic, childSessionId: final.sessionId });
  };
  const markCollected = (executionId: string) => {
    collected.add(executionId);
    record({ executionId, collected: true });
  };
  const retainedOnly = (executionId: string) => launched.has(executionId) ? undefined : retained.get(executionId);
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    shuttingDown = false;
    retained = restoreChildRecords(ctx.sessionManager.getBranch?.() ?? []);
    for (const child of retained.values()) if (child.collected === true) collected.add(child.executionId);
  });

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
    shuttingDown = true;
    foreground.clear();
    completionWakeup.shutdown();
    await adapter.cancelAll("Attended parent session ended.");
    await Promise.allSettled([...pendingWorkerCompletions, ...pendingSubagentCompletions]);
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Launch one fresh attended child Pi for one bounded assignment. Prefer background:true, finish genuinely independent work, then end the turn; the completion signal starts the next turn. Never sleep, poll, or collect to wait. Omit background only when the result is the immediate next input and nothing useful can happen first.",
    promptSnippet: "Delegate one bounded attended assignment to a fresh child Pi",
    promptGuidelines: [
      "Delegate execution only after the assignment's direction and verification are established. Use a subagent when context isolation, mechanical volume, parallelism, or genuinely independent judgment materially improves the result; work inline while the task needs continuous owner steering or is smaller than a handoff brief.",
      "Use a durable worker only when repeated assignments in one stable semantic scope demonstrably benefit from preserved context; otherwise use fresh subagents.",
      "Use one invocation for one bounded assignment while the user is attending.",
      "Write every brief with the task, 'Done means …' as a checkable finish line, 'Stop and ask only if …', and the expected output. Do not add 'think carefully' lines; Model Effort controls thinking.",
      "Correct an assignment by cancelling it and launching a new child; do not imply managed authority, recovery, or durable background work that survives the session.",
      "Read the model in the launch result; it must match the tier you intended. Use modelOverride for an owner-requested model, for Fable as the second member of a frontier panel on the hardest problems, or for the other family's strong model when reviewing frontier work. Effort is a ceiling the role sets; frontier and review never go below xhigh.",
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
        binding = await resolveBinding(params.cognitiveRole, independentOfProvider, independentOfModel, params.modelOverride, params.effort, params.excludeFamilies, options.resolverPath);
      } catch (error) {
        return failure("preflight_failed", errorMessage(error));
      }

      const parentSessionId = ctx.sessionManager.getSessionId();
      const childTask = [profile.instruction, STATUS_INSTRUCTION, `Assignment:\n${params.task}`].filter(Boolean).join("\n\n");
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
          ...parentSessionFile(ctx),
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
      record({ executionId: receipt.executionId, kind: "subagent", name: taskLabel(params.name ?? params.task), ...meta, model: `${binding.provider}/${binding.model}:${binding.effort}`, status: "running" });
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
        recordSettled(receipt.executionId, final);
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
        content: [{ type: "text" as const, text: `${verb} subagent ${receipt.executionId} in the background on ${binding.provider}/${binding.model}:${binding.effort}${binding.fallback ? ` (fallback from ${binding.fallback.from}: ${binding.fallback.reason})` : ""} (${params.profile} · ${params.cognitiveRole}).` }],
        details: { outcome: "launched", executionId: receipt.executionId, profile: params.profile, cognitiveRole: params.cognitiveRole, acceptedAt: receipt.acceptedAt },
      });
      if (backgrounded) return backgroundResult("Launched");

      try {
        const result = await streamToResult(adapter, receipt.executionId, params.profile, params.cognitiveRole, receipt.acceptedAt, signal, onUpdate, { cancelOnAbort: true, detachSignal: detachController.signal });
        if ((result as { details?: { outcome?: unknown } }).details?.outcome === "detached") return backgroundResult("Moved");
        markCollected(receipt.executionId);
        return result;
      } finally {
        foreground.delete(receipt.executionId);
      }
    },
  });

  pi.registerTool({
    name: "subagent_collect",
    label: "Subagent collect",
    description: "Reconcile background children. Without executionId, collect all ready terminal children; repeat only for a reported budget-limited remainder. With one, return an immediate bounded snapshot if running or if a finished Worker receipt is still settling, otherwise the compact terminal result. Receipt failures collect as outcome_unknown.",
    promptSnippet: "Reconcile backgrounded child Pi results",
    parameters: CollectParams,
    async execute(_toolCallId, params, signal, onUpdate) {
      // Callers pass only terminal children; reconciliation suppresses their completion-wakeup race.
      const collectOne = async (executionId: string) => {
        const kept = retainedOnly(executionId);
        if (kept !== undefined) {
          markCollected(executionId);
          kept.collected = true;
          return retainedResult(kept);
        }
        reconciling.add(executionId);
        completionWakeup.beginReconciliation(executionId);
        const meta = launched.get(executionId);
        const result = await streamToResult(adapter, executionId, meta?.profile ?? "unknown", meta?.cognitiveRole ?? "unknown", meta?.launchedAt ?? new Date().toISOString(), signal, onUpdate, { cancelOnAbort: false });
        const outcome = (result as { details?: { outcome?: unknown } }).details?.outcome;
        const terminal = typeof outcome === "string" && TERMINAL_OUTCOMES.has(outcome);
        if (terminal) markCollected(executionId);
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
        if (retainedOnly(params.executionId) !== undefined) return collectOne(params.executionId);
        let status;
        try { status = adapter.status(params.executionId); } catch (error) { return failure("outcome_unknown", errorMessage(error)); }
        if (status.running) {
          const latest = status.latestObservation === undefined ? "no activity yet" : (activityText(status.latestObservation) ?? progressText(status.latestObservation));
          return {
            content: [{ type: "text", text: `${params.executionId} [running] ${status.provider}/${status.model}:${status.effort} — ${latest}\nStill running; end this turn—the completion signal wakes the lead for the next turn.` }],
            details: status,
          };
        }
        const workerReceipt = workerReceipts.get(params.executionId);
        if (workerReceipt !== undefined && !workerReceipt.isSettled) {
          return {
            content: [{ type: "text", text: `${params.executionId} [settling] child finished; Worker receipt not yet settled — end this turn, the completion signal arrives after it settles.` }],
            details: { ...status, receiptStatus: "settling" },
          };
        }
        return collectOne(params.executionId);
      }
      const roster = adapter.list();
      // Reserve the whole set before the first await: parallel tool calls in one batch would
      // otherwise read the same roster and collect the same children twice.
      const settling = roster
        .filter((child) => !child.running && !collected.has(child.executionId) && !reconciling.has(child.executionId) && workerReceipts.get(child.executionId)?.isSettled === false)
        .map((child) => child.executionId);
      const kept = [...retained.values()].filter((child) => !launched.has(child.executionId)).map((child) => ({ executionId: child.executionId, running: false }));
      const pending = reservePending([...roster, ...kept], collected, reconciling, new Set(settling));
      try {
        return await collectAll({ pending, running: roster.filter((child) => child.running).length, settling, collectOne });
      } finally {
        for (const executionId of pending) reconciling.delete(executionId);
      }
    },
  });

  pi.registerTool({
    name: "subagent_status",
    label: "Subagent status",
    description: "Diagnostic, non-blocking snapshot of one child, or the running and terminal-but-uncollected direct children. Pass all:true for the full session roster.",
    promptSnippet: "Inspect backgrounded child Pi progress",
    parameters: StatusParams,
    async execute(_toolCallId, params) {
      if (params.executionId !== undefined) {
        const kept = retainedOnly(params.executionId);
        if (kept !== undefined) {
          return {
            content: [{ type: "text", text: `${retainedLine(kept, collected.has(kept.executionId))}${kept.taskPreview ? `\nTask: ${kept.taskPreview}` : ""}` }],
            details: { ...kept, outcome: kept.status, retained: true },
          };
        }
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
      const kept = [...retained.values()].filter((child) => !launched.has(child.executionId));
      const keptShown = all ? kept : kept.filter((child) => !collected.has(child.executionId));
      const running = roster.filter((s) => s.running).length;
      const uncollected = roster.filter((s) => !s.running && !collected.has(s.executionId)).length + kept.filter((child) => !collected.has(child.executionId)).length;
      const total = roster.length + kept.length;
      const current = harnessRevision();
      const stale = current === LOADED_HARNESS_REVISION ? "" : `\nHarness drift: this lead loaded delegation revision ${LOADED_HARNESS_REVISION}, but ${current} is on disk. Restart the lead before relying on the changed hierarchy rules.`;
      const counts = `${running} running, ${uncollected} terminal and uncollected, ${total} launched this session.${stale}`;
      if (summaries.length === 0 && keptShown.length === 0) {
        return { content: [{ type: "text", text: `${counts}${all ? "" : " Nothing needs reconciliation; use all:true for the full roster."}` }], details: { children: [], running, uncollected, total } };
      }
      const lines = summaries.map((s) => {
        const meta = launched.get(s.executionId);
        const state = s.running ? "running" : `${s.outcome ?? "finished"}${collected.has(s.executionId) ? ", collected" : ", uncollected"}`;
        return `- ${s.executionId} [${state}] ${s.kind} · ${s.profile} · ${s.cognitiveRole}${meta?.workerName !== undefined ? ` · worker \"${meta.workerName}\"` : ""}${meta ? ` — ${meta.taskPreview}` : ""}`;
      });
      for (const child of keptShown) lines.push(`- ${retainedLine(child, collected.has(child.executionId))}${child.taskPreview ? ` — ${child.taskPreview}` : ""}`);
      return { content: [{ type: "text", text: `${counts}\n${lines.join("\n")}` }], details: { children: [...summaries, ...keptShown.map((child) => ({ ...child, outcome: child.status, retained: true }))], running, uncollected, total } };
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
      markCollected(params.executionId);
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
    description: "Dispatch one bounded assignment to a durable worker with scoped session continuity. background works as in subagent. Owner-requested modelOverride changes the model; effort may be set independently. One dispatch at a time; none survives the attended session.",
    promptSnippet: "Dispatch one bounded assignment to a durable attended worker",
    promptGuidelines: [
      "Prefer fresh subagents; dispatch a worker only when its preserved scope context is valuable for this assignment.",
      "Keep every worker task self-contained with paths, constraints, 'Done means …', 'Stop and ask only if …', and expected output; continuity supplements explicit tasking.",
      "Independence roles are subagent-only: never present worker output as independent judgment or review.",
      "A worker runs one dispatch at a time; a busy worker fails preflight instead of queueing.",
      "After an outcome_unknown dispatch, inspect the worker before dispatching again with acknowledgeInspection:true.",
      "Use worker_dispatch modelOverride only when the owner or run contract requests an exact model; Cognitive Role routing remains the default. Choose the role by how much the Worker must decide, never for its effort.",
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
        binding = await resolveBinding(params.cognitiveRole, undefined, undefined, params.modelOverride, params.effort, undefined, options.resolverPath);
      } catch (error) {
        await abandon(errorMessage(error));
        return failure("preflight_failed", errorMessage(error));
      }
      const continuing = begin.continuationSessionId !== null;
      const preamble = `You are the durable attended worker \"${begin.name}\" with the semantic scope \"${begin.scope}\".${continuing ? " This dispatch resumes your persisted session; the earlier conversation above is your own prior work in this scope." : " This is your first dispatch in this scope."}`;
      const childTask = [profile.instruction, STATUS_INSTRUCTION, preamble, `Assignment:\n${params.task}`].filter(Boolean).join("\n\n");
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
          ...parentSessionFile(ctx),
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
      record({ executionId: receipt.executionId, kind: "worker", name: begin.name, ...meta, model: `${binding.provider}/${binding.model}:${binding.effort}`, status: "running" });
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
      let receiptSettled = false;
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
        recordSettled(receipt.executionId, final);
        await usageWatch;
        clearInterval(heartbeat);
        await settleWorkerReceipt({
          settle: async () => {
            try {
              await registry.completeDispatch(params.workerId, begin.lockToken, {
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
              });
            } finally {
              receiptSettled = true;
            }
          },
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
      const tracked = completion.then(
        () => { receiptSettled = true; return undefined; },
        (error: unknown) => {
          receiptSettled = true;
          clearInterval(heartbeat);
          return { error };
        },
      );
      workerReceipts.set(receipt.executionId, { workerId: params.workerId, settled: tracked, get isSettled() { return receiptSettled; } });
      pendingWorkerCompletions.add(tracked);
      void tracked.then(() => pendingWorkerCompletions.delete(tracked));

      const backgroundResult = (verb: string) => ({
        content: [{ type: "text" as const, text: `${verb} worker \"${begin.name}\" in the background using ${binding.provider}/${binding.model}:${binding.effort}: ${receipt.executionId} (${begin.profile} · ${params.cognitiveRole}${continuing ? ", resuming its session" : ", first dispatch"}). The completion signal arrives after its receipt settles; a receipt failure sends separate outcome_unknown attention.` }],
        details: { outcome: "launched", executionId: receipt.executionId, workerId: params.workerId, workerName: begin.name, profile: begin.profile, cognitiveRole: params.cognitiveRole, provider: binding.provider, model: binding.model, effort: binding.effort, modelOverride: params.modelOverride ?? null, continuing, acceptedAt: receipt.acceptedAt },
      });
      if (backgrounded) return backgroundResult("Dispatched");

      try {
        const result = await streamToResult(adapter, receipt.executionId, begin.profile, params.cognitiveRole, receipt.acceptedAt, signal, onUpdate, { cancelOnAbort: true, detachSignal: detachController.signal });
        if ((result as { details?: { outcome?: unknown } }).details?.outcome === "detached") return backgroundResult("Moved");
        markCollected(receipt.executionId);
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
        const lines = summaries.map((s) => `- ${s.workerId} \"${s.name}\" (${s.profile}) [${s.retired ? "retired" : s.locked ? "dispatching" : s.requiresInspection ? "needs inspection" : "idle"}] ${s.dispatchCount} dispatch(es), last ${s.latestOutcome ?? "none"} — ${s.scope}${s.requiresInspection === null ? "" : ` — ${s.requiresInspection.diagnostic ?? "unknown outcome"}`}`);
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

/**
 * pi-web-access narrows a fresh session to web_enable at session_start, but under a --tools allowlist
 * Pi re-activates every allowed tool whenever any extension registers a tool later (pi-claude-code-use
 * and pi-mcp-adapter do). Re-narrow before each request until web_enable succeeds or the resumed
 * transcript already declared web tools. Without web_enable (eager pi-web-access) nothing changes.
 */
export function keepChildWebToolsLazy(pi: Pick<ExtensionAPI, "on" | "getActiveTools" | "setActiveTools">) {
  let enabled = false;
  const narrow = () => {
    const active = pi.getActiveTools();
    if (enabled || !active.includes("web_enable")) return;
    const next = active.filter((name) => !WEB_TOOLS.includes(name));
    if (next.length !== active.length) pi.setActiveTools(next);
  };
  pi.on("session_start", (_event, ctx) => {
    const declared = new Set<string>();
    for (const message of ctx.sessionManager.buildSessionProjection().messages as any[]) {
      if (message.role !== "system") continue;
      for (const tool of message.toolsRemoved ?? []) declared.delete(tool.name);
      for (const tool of message.toolsAdded ?? []) declared.add(tool.name);
    }
    enabled = WEB_TOOLS.some((name) => declared.has(name));
  });
  pi.on("tool_execution_end", (event) => { if (event.toolName === "web_enable" && event.isError !== true) enabled = true; });
  pi.on("before_agent_start", narrow);
  pi.on("turn_end", narrow);
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
  let currentActivity = activity.activity;
  try {
    for await (const observation of adapter.observe(executionId)) {
      const text = activityText(observation);
      const reported = reportedStatusText(observation);
      if (reported !== undefined) reportedStatus = reported;
      if (text === undefined && reported === undefined) continue;
      if (text !== undefined) currentActivity = text;
      upsertActivity(pi, {
        ...activity,
        activity: currentActivity,
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
      content: [{ type: "text", text: `Stopped watching ${executionId}; the child keeps running and its completion signal arrives later.` }],
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

/**
 * Folds this extension's custom entries on the active branch into one record per child. A child
 * with no terminal record was live when its runtime ended (reload, session switch, quit, or crash):
 * that runtime cancelled it, so it is reported as interrupted and never resumed or relaunched.
 */
export function restoreChildRecords(entries: any[]): Map<string, ChildRecord> {
  const records = new Map<string, ChildRecord>();
  for (const entry of entries) {
    if (entry?.type !== "custom" || entry.customType !== CHILD_RECORD || typeof entry.data?.executionId !== "string") continue;
    records.set(entry.data.executionId, { ...records.get(entry.data.executionId), ...entry.data });
  }
  for (const [executionId, child] of records) {
    // A cancel or collect of an ID this session never launched leaves no launch record to restore.
    if (child.launchedAt === undefined) records.delete(executionId);
    else if (child.status === undefined || child.status === "running") child.status = "interrupted";
  }
  return records;
}

function retainedLine(child: ChildRecord, isCollected: boolean): string {
  return `${child.executionId} [${child.status}${isCollected ? ", collected" : ", uncollected"}] ${child.kind ?? "subagent"} \u00b7 ${child.profile ?? "?"} \u00b7 ${child.cognitiveRole ?? "?"} \u00b7 ${child.model ?? "?"}${child.workerName !== undefined ? ` \u00b7 worker "${child.workerName}"` : ""} \u2014 retained from an earlier runtime of this session`;
}

/** The compact terminal result for a child an earlier runtime launched, from its retained record. */
export function retainedResult(child: ChildRecord) {
  const outcome = child.status ?? "interrupted";
  const locator = child.childSessionId ? ` \u00b7 child session ${child.childSessionId}` : "";
  const summary = outcome === "interrupted"
    ? `interrupted: ${child.executionId} was still running when an earlier runtime of this session ended (extension reload or session shutdown). That runtime cancelled it; it is not resumed or relaunched. Launch a new child if the work is still needed.`
    : outcome === "success"
      ? child.text || "Child completed without a text result."
      : `${outcome}: ${child.diagnostic ?? child.text ?? "No diagnostic was reported."}`;
  const receiptLine = `\n\nRetained receipt: ${child.model ?? "?"} \u00b7 ${child.kind ?? "subagent"} \u00b7 ${child.profile ?? "?"} \u00b7 ${child.cognitiveRole ?? "?"} \u00b7 outcome ${outcome}${locator}${child.truncated ? " \u00b7 TRUNCATED, cannot satisfy verification" : ""}`;
  return {
    content: [{ type: "text" as const, text: `${summary}${receiptLine}` }],
    details: { ...child, outcome, retained: true },
    ...(outcome === "success" ? {} : { isError: true }),
  };
}

const BULK_COLLECT_MAX_CHARS = 24_000;
const REMAINDER_NAMES = 10;

/** Claims the ready terminal-uncollected set before the first await so parallel calls cannot double-collect. */
export function reservePending(roster: { executionId: string; running: boolean }[], collected: Set<string>, reconciling: Set<string>, settling: ReadonlySet<string> = new Set()): string[] {
  const pending = roster
    .filter((child) => !child.running && !collected.has(child.executionId) && !reconciling.has(child.executionId) && !settling.has(child.executionId))
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
export async function collectAll({ pending, running, settling = [], collectOne, maxChars = BULK_COLLECT_MAX_CHARS }: {
  pending: string[];
  running: number;
  settling?: string[];
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
    settling.length === 0 ? "" : `${settling.length} ${settling.length === 1 ? "Worker" : "Workers"} settling: ${settling.slice(0, REMAINDER_NAMES).join(", ")}${settling.length > REMAINDER_NAMES ? `, and ${settling.length - REMAINDER_NAMES} more` : ""}.`,
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

async function resolveBinding(cognitiveRole: string, independentOfProvider?: string, independentOfModel?: string, modelOverride?: string, effort?: string, excludeFamilies?: string[], resolverPath = resolver): Promise<any> {
  const args = [
    resolverPath, cognitiveRole,
    ...(modelOverride === undefined ? [] : ["--model", modelOverride]),
    ...(effort === undefined ? [] : ["--effort", effort]),
    ...(independentOfProvider === undefined ? [] : ["--independent-of", independentOfProvider]),
    ...(independentOfModel === undefined ? [] : ["--independent-of-model", independentOfModel]),
    ...(excludeFamilies ?? []).flatMap((family) => ["--exclude-family", family]),
  ];
  const innerTimeout = positiveTimeout(process.env.PI_WORKBENCH_ROUTING_TIMEOUT_MS, 15_000);
  const startedAt = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, args, { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: innerTimeout * 2 + 5_000 }, (error, output, stderr) => {
      if (error !== null) {
        const stderrText = String(stderr).trim();
        const stages = [...stderrText.matchAll(/^STAGE=(\S+)$/gm)];
        reject(new Error(`Routing resolver failed: elapsedMs=${Date.now() - startedAt} killed=${error.killed === true} signal=${error.signal ?? "none"} exitCode=${error.code ?? "none"} lastStage=${stages.at(-1)?.[1] ?? "unknown"}\nresolver stderr:\n${stderrText || "(empty)"}${stderrText === "" ? `\n${String(output || error.message).trim()}` : ""}`));
      } else resolve(output);
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

// Recorded as parentSession in the child's session header so session tools can tell children from leads.
function parentSessionFile(ctx: ExtensionContext): { parentSessionFile?: string } {
  const file = ctx.sessionManager.getSessionFile?.();
  return file === undefined ? {} : { parentSessionFile: file };
}

export function taskGoal(task: string): string {
  return bounded(taskLabel(task.split(/\r?\n/, 1)[0], 160), 160);
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function positiveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
