const PROJECTION_PATH = ".pi-workbench/projection.json";
const PANEL_ID = "pi-workbench:run.panel";
const projectionCache = new Map();

export function parseWorkbenchProjection(value) {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.run)) return undefined;
  const run = value.run;
  if (!isString(run.id) || !isString(run.outcome) || !isString(run.status) || !isNonNegativeInteger(run.revision)) return undefined;
  if (!isRecord(run.authority) || !isString(run.authority.controlLease) || !isString(run.authority.summary)) return undefined;
  if (!Array.isArray(value.attention) || !value.attention.every(isAttentionItem)) return undefined;
  if (!Array.isArray(value.activity) || !value.activity.every(isActivityItem)) return undefined;
  if (!Array.isArray(value.evidence) || !value.evidence.every(isEvidenceItem)) return undefined;
  return value;
}

export default {
  apiVersion: 1,
  name: "Pi Workbench",
  activate: ({ html }) => {
    installRunStatusElement();
    return {
      contributions: {
        actions: [
          {
            id: "run.open-status",
            title: "Open Workbench Run Status",
            description: "Inspect the recorded Run projection for the selected workspace",
            group: "Pi Workbench",
            enabled: ({ state }) => state.selectedWorkspace !== undefined,
            disabledReason: ({ state }) => state.selectedWorkspace === undefined ? "Select a workspace first." : undefined,
            run: ({ selectWorkspaceTool }) => { selectWorkspaceTool(PANEL_ID); },
          },
        ],
        workspaceLabels: [
          {
            id: "run.label",
            order: 20,
            items: (context) => {
              const cached = cachedProjection(context);
              if (cached.status === "missing" || cached.status === "error") return [];
              if (cached.status !== "ready") return [];
              const count = cached.projection.attention.length;
              return [{
                type: "text",
                text: count === 0 ? `Run: ${humanize(cached.projection.run.status)}` : `Run: ${String(count)} needs judgment`,
                title: `${cached.projection.run.outcome} · revision ${String(cached.projection.run.revision)}`,
              }];
            },
          },
        ],
        workspacePanels: [
          {
            id: "run.panel",
            title: "Run",
            order: 20,
            badge: (context) => {
              const cached = cachedProjection(context);
              return cached.status === "ready" && cached.projection.attention.length > 0 ? cached.projection.attention.length : undefined;
            },
            render: (context) => html`<pi-workbench-run-status .context=${context}></pi-workbench-run-status>`,
          },
        ],
      },
    };
  },
};

function installRunStatusElement() {
  if (customElements.get("pi-workbench-run-status") !== undefined) return;

  class PiWorkbenchRunStatus extends HTMLElement {
    #context;
    #loadKey;
    #projection;
    #error = "";
    #loading = false;
    #evidencePreview = "";

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }

    set context(value) {
      this.#context = value;
      const nextKey = `${value.machine.id}:${value.workspace.id}`;
      if (nextKey === this.#loadKey) return;
      this.#loadKey = nextKey;
      void this.#load();
    }

    connectedCallback() {
      this.#render();
      if (this.#context !== undefined && this.#projection === undefined && !this.#loading) void this.#load();
    }

    async #load() {
      const context = this.#context;
      if (context === undefined) return;
      this.#loading = true;
      this.#error = "";
      this.#evidencePreview = "";
      this.#render();
      try {
        const result = await loadProjection(context);
        if (context !== this.#context) return;
        this.#projection = result.projection;
        if (result.source === "fixture") this.#error = `No ${PROJECTION_PATH} was found; showing the recorded adapter fixture.`;
      } catch (error) {
        if (context !== this.#context) return;
        this.#projection = undefined;
        this.#error = errorMessage(error);
      } finally {
        if (context === this.#context) {
          this.#loading = false;
          this.#render();
          context.host.requestRender();
        }
      }
    }

    async #inspectEvidence(path) {
      const context = this.#context;
      if (context === undefined) return;
      this.#evidencePreview = "Loading evidence…";
      this.#render();
      try {
        const file = await context.files.readFile(path);
        if (context !== this.#context) return;
        this.#evidencePreview = file.binary ? `${path} is binary and cannot be previewed here.` : boundedText(file.content, file.truncated === true);
      } catch (error) {
        if (context !== this.#context) return;
        this.#evidencePreview = `Could not read ${path}: ${errorMessage(error)}`;
      }
      this.#render();
    }

    #render() {
      const root = this.shadowRoot;
      if (root === null) return;
      root.replaceChildren();
      root.append(styleElement());
      const main = document.createElement("main");
      main.setAttribute("aria-live", "polite");
      if (this.#loading) {
        main.append(message("Loading Workbench projection…", "muted"));
      } else if (this.#projection === undefined) {
        main.append(message(this.#error || "Run projection is unavailable.", "error"));
      } else {
        main.append(this.#renderProjection(this.#projection));
      }
      root.append(main);
    }

    #renderProjection(projection) {
      const fragment = document.createDocumentFragment();
      const header = document.createElement("header");
      const heading = document.createElement("div");
      heading.append(label("Run status"), strong(projection.run.outcome));
      header.append(heading);
      const reload = button("Reload", () => { projectionCache.delete(this.#loadKey); void this.#load(); });
      header.append(reload);
      fragment.append(header);

      if (this.#error !== "") fragment.append(message(this.#error, "notice"));
      fragment.append(detailGrid([
        ["State", humanize(projection.run.status)],
        ["Revision", String(projection.run.revision)],
        ["Control", humanize(projection.run.authority.controlLease)],
      ]));
      fragment.append(message(projection.run.authority.summary, "authority"));

      const attentionSection = section("Needs judgment", projection.attention.length === 0 ? "No Human Attention is required." : undefined);
      for (const item of projection.attention) attentionSection.append(attentionCard(item));
      fragment.append(attentionSection);

      const activitySection = section("Progressing without me", projection.activity.length === 0 ? "No autonomous activity is recorded." : undefined);
      for (const item of projection.activity) activitySection.append(activityRow(item));
      fragment.append(activitySection);

      const evidenceSection = section("Primary Evidence", projection.evidence.length === 0 ? "No evidence is referenced." : undefined);
      for (const item of projection.evidence) {
        const row = document.createElement("div");
        row.className = "evidence-row";
        const copy = document.createElement("div");
        copy.append(strong(item.title), message(`${item.kind} · ${item.path}`, "muted"));
        row.append(copy, button("Inspect", () => { void this.#inspectEvidence(item.path); }));
        evidenceSection.append(row);
      }
      if (this.#evidencePreview !== "") {
        const preview = document.createElement("pre");
        preview.textContent = this.#evidencePreview;
        evidenceSection.append(preview);
      }
      fragment.append(evidenceSection);
      return fragment;
    }
  }

  customElements.define("pi-workbench-run-status", PiWorkbenchRunStatus);
}

function cachedProjection(context) {
  const key = `${context.machine.id}:${context.workspace.id}`;
  const existing = projectionCache.get(key);
  if (existing !== undefined) return existing;
  const pending = { status: "loading" };
  projectionCache.set(key, pending);
  void loadProjection(context).then((result) => {
    projectionCache.set(key, { status: "ready", projection: result.projection });
    context.host.requestRender();
  }).catch((error) => {
    const missing = errorMessage(error).includes("Path does not exist") || errorMessage(error).includes("ENOENT");
    projectionCache.set(key, { status: missing ? "missing" : "error", message: errorMessage(error) });
    context.host.requestRender();
  });
  return pending;
}

async function loadProjection(context) {
  try {
    const file = await context.files.readFile(PROJECTION_PATH);
    if (file.binary) throw new Error(`${PROJECTION_PATH} must be UTF-8 JSON.`);
    return { projection: parseProjectionText(file.content, PROJECTION_PATH), source: "workspace" };
  } catch (workspaceError) {
    if (!isMissingFileError(workspaceError)) throw workspaceError;
    const response = await fetch(new URL("./fixtures/recorded-projection.json", import.meta.url));
    if (!response.ok) throw new Error(`Recorded Workbench fixture failed to load (${String(response.status)}).`);
    return { projection: parseWorkbenchProjection(await response.json()) ?? invalidProjection("recorded fixture"), source: "fixture" };
  }
}

function parseProjectionText(text, source) {
  try {
    const projection = parseWorkbenchProjection(JSON.parse(text));
    return projection ?? invalidProjection(source);
  } catch (error) {
    throw new Error(`${source} is not valid Workbench projection JSON: ${errorMessage(error)}`);
  }
}

function invalidProjection(source) {
  throw new Error(`${source} does not match Workbench projection version 1.`);
}

function isAttentionItem(value) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.category)
    && isString(value.urgency)
    && isString(value.requiredJudgment)
    && isString(value.materiality)
    && isString(value.recommendedResponse)
    && isString(value.deferralBehavior)
    && isNonNegativeInteger(value.revision);
}

function isActivityItem(value) {
  return isRecord(value) && isString(value.id) && isString(value.summary) && isString(value.state);
}

function isEvidenceItem(value) {
  return isRecord(value) && isString(value.id) && isString(value.title) && isString(value.kind) && isString(value.path);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isMissingFileError(error) {
  const messageText = errorMessage(error);
  return messageText.includes("Path does not exist") || messageText.includes("ENOENT") || messageText.includes("not found");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function humanize(value) {
  return value.replaceAll("_", " ");
}

function boundedText(content, alreadyTruncated) {
  const limit = 4_000;
  const bounded = content.length > limit ? `${content.slice(0, limit)}\n\n… preview truncated` : content;
  return alreadyTruncated && content.length <= limit ? `${bounded}\n\n… source response truncated` : bounded;
}

function styleElement() {
  const style = document.createElement("style");
  style.textContent = `
    :host { display: block; color: var(--pi-text); font: 13px system-ui, sans-serif; }
    main { display: grid; gap: var(--pi-toolbar-gap, 8px); padding: var(--pi-panel-padding, 12px); }
    header, .evidence-row { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--pi-toolbar-gap, 8px); }
    header > div, .evidence-row > div { min-width: 0; display: grid; gap: 4px; }
    strong { overflow-wrap: anywhere; }
    .eyebrow { color: var(--pi-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    button { min-height: var(--pi-control-min-size, 34px); border: 1px solid var(--pi-border); border-radius: 7px; background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-control-padding-block, 7px) var(--pi-control-padding-inline, 9px); cursor: pointer; }
    button:hover, button:focus-visible { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    .detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--pi-border); border-radius: 8px; overflow: hidden; }
    .detail { min-width: 0; display: grid; gap: 3px; padding: var(--pi-message-padding, 12px); border-right: 1px solid var(--pi-border); background: var(--pi-surface); }
    .detail:last-child { border-right: 0; }
    .detail span:first-child { color: var(--pi-muted); font-size: 11px; }
    .message { margin: 0; color: var(--pi-text); line-height: 1.4; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); font-size: 12px; }
    .error { color: var(--pi-danger); }
    .notice, .authority { padding: var(--pi-message-padding, 12px); border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); }
    .notice { color: var(--pi-warning); }
    section { display: grid; gap: var(--pi-toolbar-gap, 8px); padding-top: var(--pi-panel-padding, 12px); border-top: 1px solid var(--pi-border-muted); }
    h2 { margin: 0; font-size: 13px; }
    .attention-card { display: grid; gap: 7px; padding: var(--pi-message-padding, 12px); border: 1px solid var(--pi-accent-border); border-radius: 9px; background: var(--pi-selection-bg); }
    .attention-card dl { display: grid; gap: 6px; margin: 0; }
    .attention-card dl > div { display: grid; gap: 2px; }
    dt { color: var(--pi-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    dd { margin: 0; line-height: 1.4; overflow-wrap: anywhere; }
    .activity-row, .evidence-row { padding: var(--pi-list-row-padding-block, 7px) var(--pi-list-row-padding-inline, 9px); border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); }
    pre { max-height: 260px; margin: 0; overflow: auto; padding: var(--pi-message-padding, 12px); border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); font: 12px/1.45 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (max-width: 380px) { .detail-grid { grid-template-columns: minmax(0, 1fr); } .detail { border-right: 0; border-bottom: 1px solid var(--pi-border); } .detail:last-child { border-bottom: 0; } }
  `;
  return style;
}

function label(text) {
  const element = document.createElement("span");
  element.className = "eyebrow";
  element.textContent = text;
  return element;
}

function strong(text) {
  const element = document.createElement("strong");
  element.textContent = text;
  return element;
}

function button(text, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
}

function message(text, className) {
  const element = document.createElement("p");
  element.className = `message ${className}`;
  element.textContent = text;
  return element;
}

function detailGrid(items) {
  const grid = document.createElement("div");
  grid.className = "detail-grid";
  for (const [name, value] of items) {
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.append(message(name, "muted"), strong(value));
    grid.append(detail);
  }
  return grid;
}

function section(title, emptyText) {
  const element = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = title;
  element.append(heading);
  if (emptyText !== undefined) element.append(message(emptyText, "muted"));
  return element;
}

function attentionCard(item) {
  const article = document.createElement("article");
  article.className = "attention-card";
  article.append(label(`${humanize(item.category)} · ${humanize(item.urgency)}`), strong(item.requiredJudgment));
  const details = document.createElement("dl");
  for (const [name, value] of [["Why now", item.materiality], ["Recommended response", item.recommendedResponse], ["If deferred", item.deferralBehavior]]) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = name;
    const description = document.createElement("dd");
    description.textContent = value;
    row.append(term, description);
    details.append(row);
  }
  article.append(details);
  return article;
}

function activityRow(item) {
  const row = document.createElement("div");
  row.className = "activity-row";
  row.append(strong(item.summary), message(humanize(item.state), "muted"));
  return row;
}
