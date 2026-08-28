export const ACTIVITY_CHANNEL = "pi-workbench:activity";
export const ACTIVITY_SUMMARY_LIMIT = 120;

const KINDS = new Set(["subagent", "worker", "monitor", "shell"]);
const ICONS = { subagent: "🤖", worker: "🧰", monitor: "👀", shell: "💻" };

export function upsertActivity(pi, item) {
  pi.events.emit(ACTIVITY_CHANNEL, { type: "upsert", item });
}

export function removeActivity(pi, id) {
  pi.events.emit(ACTIVITY_CHANNEL, { type: "remove", id });
}

export function createActivitySurface() {
  const items = new Map();
  let ui;

  const render = () => {
    if (ui !== undefined) ui.setWidget(ACTIVITY_CHANNEL, renderActivityLines([...items.values()]));
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
      } else {
        if (JSON.stringify(items.get(normalized.item.id)) === JSON.stringify(normalized.item)) return;
        items.set(normalized.item.id, normalized.item);
      }
      render();
    },
    dispose() {
      items.clear();
      if (ui !== undefined) ui.setWidget(ACTIVITY_CHANNEL, undefined);
      ui = undefined;
    },
  };
}

export function renderActivityLines(items) {
  if (items.length === 0) return undefined;
  return [`Active · ${items.length}`, ...items.map(renderActivityLine)];
}

export function shortModel(value) {
  const id = String(value ?? "").split("/").at(-1)?.replace(/^(?:claude|gpt)-/, "").replace(/-\d{8}$/, "") ?? "";
  const words = id.split("-").filter(Boolean);
  const compact = [];
  for (const word of words) {
    if (/^\d+$/.test(word) && /^\d+(?:\.\d+)*$/.test(compact.at(-1) ?? "")) compact[compact.length - 1] += `.${word}`;
    else compact.push(/^\d/.test(word) ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`);
  }
  return bounded(compact.join(" ") || "unknown model", 32);
}

function renderActivityLine(item) {
  const icon = ICONS[item.kind];
  if (item.kind === "shell") return `${icon} ${bounded(clean(item.objective) || "shell", ACTIVITY_SUMMARY_LIMIT)}`;
  const identity = item.name === undefined ? formatRole(item.role) : `${item.name}${item.role === undefined ? "" : ` · ${formatRole(item.role)}`}`;
  const model = item.model === undefined ? "" : ` · ${shortModel(item.model)}`;
  return `${icon} ${identity ?? item.kind}${model} — ${activitySentence(item)}`;
}

function activitySentence(item) {
  const objective = clean(item.objective);
  const current = clean(item.activity);
  const activity = current === "starting" || current === "running" ? "" : current;
  const text = objective === "" ? activity : activity === "" ? objective : `${objective}; ${activity}`;
  return bounded(text || "working", ACTIVITY_SUMMARY_LIMIT);
}

function normalizeActivityEvent(value) {
  if (!isRecord(value)) return undefined;
  if (value.type === "remove") {
    const id = requiredText(value.id, 128);
    return id === undefined ? undefined : { type: "remove", id };
  }
  if (value.type !== "upsert" || !isRecord(value.item)) return undefined;
  const id = requiredText(value.item.id, 128);
  const kind = value.item.kind;
  if (id === undefined || typeof kind !== "string" || !KINDS.has(kind)) return undefined;
  return {
    type: "upsert",
    item: {
      id,
      kind,
      ...optionalText("name", value.item.name, 48),
      ...optionalText("role", value.item.role, 32),
      ...optionalText("model", value.item.model, 96),
      ...optionalText("effort", value.item.effort, 16),
      ...optionalText("objective", value.item.objective, 240),
      ...optionalText("activity", value.item.activity, 120),
    },
  };
}

function optionalText(key, value, max) {
  return typeof value === "string" && value.trim() !== "" ? { [key]: bounded(clean(value), max) } : {};
}

function requiredText(value, max) {
  return typeof value === "string" && value.trim() !== "" ? bounded(clean(value), max) : undefined;
}

function formatRole(value) {
  return value === undefined ? undefined : value.replaceAll("-", " ");
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
