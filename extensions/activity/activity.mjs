import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const ACTIVITY_CHANNEL = "pi-workbench:activity";
export const ACTIVITY_SCHEMA_VERSION = 1;
export const ACTIVITY_MAX_ITEMS = 64;

const KINDS = new Set(["subagent", "worker", "monitor", "shell"]);
const ICONS = { subagent: "🤖", worker: "🧰", monitor: "👀", shell: "💻" };
const CARD_MIN_WIDTH = 49;
const CARD_MAX_WIDTH = 80;
const CARD_GAP = 2;
const CARD_MAX_COLUMNS = 3;
const MIN_ACTION_WIDTH = 6;

export function upsertActivity(pi, item) {
  pi.events.emit(ACTIVITY_CHANNEL, { type: "upsert", item });
}

export function removeActivity(pi, id) {
  pi.events.emit(ACTIVITY_CHANNEL, { type: "remove", id });
}

export function createActivitySurface() {
  const items = new Map();
  let ui;
  let mode;
  let requestRender;

  const publishSnapshot = () => {
    if (mode !== "rpc") return;
    const roster = [...items.values()].filter((item) => item.kind === "subagent" || item.kind === "worker").slice(-ACTIVITY_MAX_ITEMS);
    ui.setStatus(ACTIVITY_CHANNEL, JSON.stringify({ schemaVersion: ACTIVITY_SCHEMA_VERSION, items: roster }));
  };

  return {
    attach(nextUi) {
      ui = nextUi;
      mode = "tui";
      ui.setWidget(ACTIVITY_CHANNEL, (tui) => {
        requestRender = () => tui.requestRender();
        return {
          render: (width) => renderActivityLines([...items.values()], width) ?? [],
          invalidate() {},
        };
      });
    },
    attachRpc(nextUi) {
      ui = nextUi;
      mode = "rpc";
      publishSnapshot();
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
      requestRender?.();
      publishSnapshot();
    },
    dispose() {
      items.clear();
      if (mode === "tui") ui?.setWidget(ACTIVITY_CHANNEL, undefined);
      if (mode === "rpc") ui?.setStatus(ACTIVITY_CHANNEL, undefined);
      requestRender = undefined;
      ui = undefined;
      mode = undefined;
    },
  };
}

export function renderActivityLines(items, width = 120) {
  if (items.length === 0 || width < 1) return undefined;
  const columns = Math.max(1, Math.min(CARD_MAX_COLUMNS, items.length, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP))));
  const availableCardWidth = Math.floor((width - CARD_GAP * (columns - 1)) / columns);
  const cardWidth = columns === 1 ? availableCardWidth : Math.min(CARD_MAX_WIDTH, availableCardWidth);
  const rows = [];
  for (let index = 0; index < items.length; index += columns) {
    const cards = items.slice(index, index + columns).map((item) => renderActivityPill(item, cardWidth));
    rows.push(cards.map((card, cardIndex) => cardIndex === cards.length - 1 ? card : padToWidth(card, cardWidth)).join(" ".repeat(CARD_GAP)));
  }
  const visibleRows = rows.length <= 9 ? rows : [...rows.slice(0, 8), truncateToWidth(`… ${items.length - columns * 8} more`, width)];
  return [truncateToWidth(`Active · ${items.length}`, width), ...visibleRows];
}

export function shortModel(value) {
  const id = String(value ?? "").split("/").at(-1)?.replace(/-\d{8}$/, "") ?? "";
  const gpt = id.match(/^gpt-(\d+(?:[.-]\d+)*?)-(terra|sol|luna)$/);
  if (gpt !== null) return `${capitalize(gpt[2])} ${gpt[1].replaceAll("-", ".")}`;
  const words = id.replace(/^(?:claude|gpt)-/, "").split("-").filter(Boolean);
  const compact = [];
  for (const word of words) {
    if (/^\d+$/.test(word) && /^\d+(?:\.\d+)*$/.test(compact.at(-1) ?? "")) compact[compact.length - 1] += `.${word}`;
    else compact.push(/^\d/.test(word) ? word : capitalize(word));
  }
  return bounded(compact.join(" ") || "unknown model", 14);
}

function renderActivityPill(item, width) {
  const prefix = `${ICONS[item.kind]} `;
  const metadata = activityMetadata(item, Math.max(0, width - visibleWidth(prefix) - MIN_ACTION_WIDTH - 4));
  const suffix = metadata === "" ? "" : `  ⟨${metadata}⟩`;
  const actionWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));
  const line = `${prefix}${truncateToWidth(activityAction(item), actionWidth, "…")}${suffix}`;
  return truncateToWidth(line, width, "…");
}

function activityAction(item) {
  const current = clean(item.activity);
  if (item.kind === "shell") return clean(item.objective) || "running shell";
  if (item.kind === "monitor" && (current === "" || current === "watching" || current === "starting")) return clean(item.objective) || "watching";
  return current === "" || current === "running" ? "starting" : current;
}

function activityMetadata(item, width) {
  if (width < 1) return "";
  const name = bounded(clean(item.name), 8);
  const role = shortRole(item.role);
  const model = item.model === undefined ? "" : shortModel(item.model);
  const effort = bounded(clean(item.effort), 6);
  const candidates = [[name, role, model, effort], [name, model, effort], [model, effort]];
  for (const parts of candidates) {
    const text = parts.filter(Boolean).join(" · ");
    if (visibleWidth(text) <= width) return text;
  }
  if (model !== "" && effort !== "") {
    const modelWidth = width - visibleWidth(effort) - 3;
    if (modelWidth > 0) return `${truncateToWidth(model, modelWidth, "…")} · ${effort}`;
  }
  return truncateToWidth(model || effort || name || role || "", width, "…");
}

function padToWidth(value, width) {
  return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
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

function shortRole(value) {
  const roles = {
    "independent-review": "review",
    "independent-judgment": "judge",
    implementation: "build",
    "problem-solving": "solve",
    investigation: "inspect",
    design: "design",
    escalation: "escalate",
    challenge: "challenge",
    synthesis: "synthesize",
    mechanics: "mechanics",
    coordination: "coordinate",
  };
  return typeof value === "string" && Object.hasOwn(roles, value) ? roles[value] : value?.replaceAll("-", " ");
}

function capitalize(value) {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function clean(value) {
  return stripTerminalSequences(String(value ?? "")).replace(/\s+/g, " ").trim().replace(/[.;:]$/, "");
}

function bounded(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
