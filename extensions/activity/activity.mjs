export const ACTIVITY_CHANNEL = "pi-workbench:activity";
export const ACTIVITY_SUMMARY_LIMIT = 100;

const KINDS = new Set(["subagent", "worker", "monitor", "shell"]);
const ICONS = { subagent: "🤖", worker: "🧰", monitor: "👀", shell: "💻" };

export function upsertActivity(pi, item) {
  pi.events.emit(ACTIVITY_CHANNEL, { type: "upsert", item });
}

export function removeActivity(pi, id) {
  pi.events.emit(ACTIVITY_CHANNEL, { type: "remove", id });
}

export function completeActivity(pi, item) {
  pi.events.emit(ACTIVITY_CHANNEL, { type: "complete", item });
}

export function createActivitySurface() {
  const items = new Map();
  const completed = [];
  let ui;

  const render = () => {
    if (ui !== undefined) ui.setWidget(ACTIVITY_CHANNEL, renderActivityLines([...items.values()], completed));
  };

  return {
    attach(nextUi) {
      ui = nextUi;
      render();
    },
    update(event) {
      const normalized = normalizeActivityEvent(event);
      if (normalized === undefined) return;
      if (normalized.type === "remove") {
        if (!items.delete(normalized.id)) return;
      } else if (normalized.type === "complete") {
        items.delete(normalized.item.id);
        const previous = completed.findIndex((item) => item.id === normalized.item.id);
        if (previous !== -1) completed.splice(previous, 1);
        completed.unshift(normalized.item);
        if (completed.length > 3) completed.length = 3;
      } else {
        if (completed.some((item) => item.id === normalized.item.id)) return;
        if (JSON.stringify(items.get(normalized.item.id)) === JSON.stringify(normalized.item)) return;
        items.set(normalized.item.id, normalized.item);
      }
      render();
    },
    clearCompleted() {
      if (completed.length === 0) return;
      completed.length = 0;
      render();
    },
    dispose() {
      items.clear();
      completed.length = 0;
      if (ui !== undefined) ui.setWidget(ACTIVITY_CHANNEL, undefined);
      ui = undefined;
    },
  };
}

export function renderActivityLines(items, completed = []) {
  if (items.length === 0 && completed.length === 0) return undefined;
  return [
    ...(completed.length === 0 ? [] : ["Done", ...completed.map(renderCompletionLine)]),
    ...(items.length === 0 ? [] : [`Active · ${items.length}`, ...items.map(renderActivityLine)]),
  ];
}

export function shortModel(value) {
  const id = String(value ?? "").split("/").at(-1)?.replace(/-\d{8}$/, "") ?? "";
  const claude = id.match(/^(?:claude-)?(opus|sonnet|fable|haiku)-(\d+(?:-\d+)*)/);
  if (claude !== null) return `${claude[1] === "sonnet" ? "Sn" : claude[1][0].toUpperCase()}${claude[2].replaceAll("-", ".")}`;
  const gpt = id.match(/^gpt-(\d+(?:\.\d+)*)(?:-(terra|sol|luna))?/);
  if (gpt !== null) return `${gpt[2]?.[0].toUpperCase() ?? "G"}${gpt[1]}`;
  return bounded(id.replace(/^(?:claude|gpt)-/, "") || "model", 12);
}

function renderActivityLine(item) {
  const icon = ICONS[item.kind];
  if (item.kind === "shell") return bounded(`${icon} ${clean(item.objective) || "shell"}`, ACTIVITY_SUMMARY_LIMIT);
  const current = clean(item.activity);
  const action = current === "" || current === "starting" || current === "running"
    ? clean(item.objective) || "working"
    : current;
  const metadata = [item.name, shortRole(item.role), item.model === undefined ? undefined : shortModel(item.model)].filter(Boolean);
  return bounded(`${icon} ${bounded(action, 56)}${metadata.length === 0 ? "" : ` · ${metadata.join(" · ")}`}`, ACTIVITY_SUMMARY_LIMIT);
}

function renderCompletionLine(item) {
  const icon = item.outcome === "success" ? "✅" : "⚠️";
  const actor = item.name ?? shortRole(item.role) ?? item.kind;
  return bounded(`${icon} ${clean(item.summary) || item.outcome} · ${actor}`, ACTIVITY_SUMMARY_LIMIT);
}

function normalizeActivityEvent(value) {
  if (!isRecord(value)) return undefined;
  if (value.type === "remove") {
    const id = requiredText(value.id, 128);
    return id === undefined ? undefined : { type: "remove", id };
  }
  if ((value.type !== "upsert" && value.type !== "complete") || !isRecord(value.item)) return undefined;
  const item = normalizeActivityItem(value.item);
  if (item === undefined) return undefined;
  if (value.type === "upsert") return { type: "upsert", item };
  const outcome = requiredText(value.item.outcome, 64);
  if (outcome === undefined) return undefined;
  return { type: "complete", item: { ...item, outcome, ...optionalText("summary", value.item.summary, 160) } };
}

function normalizeActivityItem(value) {
  const id = requiredText(value.id, 128);
  const kind = value.kind;
  if (id === undefined || typeof kind !== "string" || !KINDS.has(kind)) return undefined;
  return {
    id,
    kind,
    ...optionalText("name", value.name, 48),
    ...optionalText("role", value.role, 32),
    ...optionalText("model", value.model, 96),
    ...optionalText("effort", value.effort, 16),
    ...optionalText("objective", value.objective, 240),
    ...optionalText("activity", value.activity, 120),
  };
}

function optionalText(key, value, max) {
  return typeof value === "string" && value.trim() !== "" ? { [key]: bounded(clean(value), max) } : {};
}

function requiredText(value, max) {
  return typeof value === "string" && value.trim() !== "" ? bounded(clean(value), max) : undefined;
}

function shortRole(value) {
  const roles = {
    "independent-review": "review",
    "independent-judgment": "judge",
    implementation: "build",
    "problem-solving": "solve",
    investigation: "inspect",
    escalation: "escalate",
    synthesis: "synthesize",
  };
  return typeof value === "string" && Object.hasOwn(roles, value) ? roles[value] : value;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().replace(/[.;:]$/, "");
}

function bounded(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
