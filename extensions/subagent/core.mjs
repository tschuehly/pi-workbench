// Runtime-neutral delegation rules shared by the legacy subagent extension (index.ts, RPC children) and the Durable
// Chat host (packages/durable-pilot/src/delegation.ts, native child conversations): profiles and their tool
// allowlists, Cognitive Roles, routing through the model-orchestration resolver, and bounded bulk collection.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RESOLVER = path.resolve(here, "../../skills/model-orchestration/scripts/resolve-runtime-binding.mjs");

export const DELEGATION_TOOLS = ["subagent", "subagent_collect", "subagent_status", "subagent_cancel", "subagent_steer"];
// The web tools are the ceiling web_enable activates within: Pi drops tools missing from --tools, so a
// web_enable-only list would leave it nothing to enable. keepChildWebToolsLazy keeps them inactive until then.
export const WEB_TOOLS = ["web_search", "source_check", "fetch_content", "get_search_content"];
export const CHILD_TOOLS = ["read", "bash", "grep", "find", "ls", "report_status", "compact_and_continue", "web_enable", ...WEB_TOOLS];
export const STATUS_INSTRUCTION = "Keep going while a step needs no input from the lead; stop early only when the assignment's stop condition applies or you cannot continue. Start your final report with anything you need from the lead, then what you changed and what you found. To wait for a job, log, check, or server, make one bash call to `wait-until --timeout SECONDS` with any of `--file PATH [--match REGEX]`, `--pid PID`, `--cmd 'SHELL'`, `--url URL`, and no shorter bash timeout; it stays silent and returns when the first condition holds (exit 0) or at the timeout (exit 124). Never wait with sleep, tail -f, or repeated checks.";
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
    instruction: "Coordinate this scope (cognitive role: coordination). You do not edit files yourself: launch one fresh bounded leaf Subagent per phase, take its result from the completion notice (collect only what the notice names), and keep only intent, decisions, and compact child evidence in your own context. Check each leaf's evidence before you accept its result. Run at most one writing leaf at a time. Leaves never commit or publish; after their evidence passes you may make one mechanical scope-only checkpoint commit with bash. You cannot create workers.",
  },
};

export const LEAF_PROFILES = ["scout", "planner", "reviewer", "implementer", "plain"];
export const WORKER_PROFILES = [...LEAF_PROFILES, "coordinator"];
export const NO_NESTED_WORKERS = "Workers cannot create or dispatch Workers. The supported hierarchy is lead → Worker → leaf Subagent; delegate this work to a fresh leaf Subagent instead.";

export const COGNITIVE_ROLES = ["routine", "implementation", "frontier", "coordination", "review", "light-review"];
// Latitude is how much the child must decide for itself: how unclear the problem is and how little
// the brief specifies. It selects the model tier; skills/model-orchestration/references/routing-policy.json
// names the models.
export const ROLE_GUIDE = "How much the child must decide; picks the model tier (see the model-orchestration skill).\nroutine: you can list what to check or change\nimplementation: you can state the finish line, not the approach\nfrontier: you have only a symptom or an open question\ncoordination: a Worker owning one scope\nreview: independent other-family judgment; state the lens\nlight-review: other-family check of PR text, docs, or finding triage; never code";
export const MODEL_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const INDEPENDENT_ROLES = new Set(["review", "light-review"]);
export const WORKER_ROLES = COGNITIVE_ROLES.filter((role) => !INDEPENDENT_ROLES.has(role));
export const UPDATE_REQUEST = "The lead asks for a progress update: call report_status with your next tool call, saying where you stand, then continue your assignment.";

export function providerOf(qualifiedModel) {
  if (qualifiedModel === undefined) return undefined;
  const slash = qualifiedModel.indexOf("/");
  return slash > 0 && slash < qualifiedModel.length - 1 ? qualifiedModel.slice(0, slash) : undefined;
}

/** The resolver's model binding for a role; `extraArgs` (e.g. `--catalog <file>`) pass through. Rejects on BLOCKED. */
export async function resolveBinding(cognitiveRole, independentOfProvider, independentOfModel, modelOverride, effort, excludeFamilies, resolverPath = RESOLVER, extraArgs = []) {
  const args = [
    resolverPath, cognitiveRole,
    ...(modelOverride === undefined ? [] : ["--model", modelOverride]),
    ...(effort === undefined ? [] : ["--effort", effort]),
    ...(independentOfProvider === undefined ? [] : ["--independent-of", independentOfProvider]),
    ...(independentOfModel === undefined ? [] : ["--independent-of-model", independentOfModel]),
    ...(excludeFamilies ?? []).flatMap((family) => ["--exclude-family", family]),
    ...extraArgs,
  ];
  const innerTimeout = positiveTimeout(process.env.PI_WORKBENCH_ROUTING_TIMEOUT_MS, 15_000);
  const startedAt = Date.now();
  const stdout = await new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: innerTimeout * 2 + 5_000 }, (error, output, stderr) => {
      if (error !== null) {
        const stderrText = String(stderr).trim();
        const stages = [...stderrText.matchAll(/^STAGE=(\S+)$/gm)];
        reject(new Error(`Routing resolver failed: elapsedMs=${Date.now() - startedAt} killed=${error.killed === true} signal=${error.signal ?? "none"} exitCode=${error.code ?? "none"} lastStage=${stages.at(-1)?.[1] ?? "unknown"}\nresolver stderr:\n${stderrText || "(empty)"}${stderrText === "" ? `\n${String(output || error.message).trim()}` : ""}`));
      } else resolve(output);
    });
  });
  let value;
  try { value = JSON.parse(stdout); } catch (error) { throw new Error(`Routing returned invalid JSON: ${errorMessage(error)}`); }
  if (value?.status !== "pass" || value.modelBinding?.cognitiveRole !== cognitiveRole) throw new Error("Routing did not return the requested resolved binding.");
  return value.modelBinding;
}

const BULK_COLLECT_MAX_CHARS = 24_000;
const REMAINDER_NAMES = 10;

/**
 * Reconciles the terminal-uncollected set the extension already owns, so a lead never restates
 * identifiers it was just shown and cannot silently drop a finished child. Collection stops once
 * the budget is spent: a child that was not read stays uncollected and is named, because marking
 * it collected without showing its result is the loss this tool exists to prevent.
 */
export async function collectAll({ pending, running, settling = [], collectOne, maxChars = BULK_COLLECT_MAX_CHARS }) {
  const entries = [];
  const remaining = [];
  let used = 0;
  for (const executionId of pending) {
    if (entries.length > 0 && used >= maxChars) { remaining.push(executionId); continue; }
    const result = await collectOne(executionId);
    const text = (result?.content ?? []).filter((part) => part?.type === "text").map((part) => String(part.text ?? "")).join("\n");
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
    content: [{ type: "text", text: [[header, ...notes].join(" "), ...sections].join("\n\n") }],
    details: {
      collected: entries.map((entry) => ({ executionId: entry.executionId, outcome: entry.outcome })),
      remaining,
      running,
    },
    ...(entries.some((entry) => entry.isError) ? { isError: true } : {}),
  };
}

function positiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
