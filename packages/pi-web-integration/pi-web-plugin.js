import { createWorkbenchWorkstreamClient, reconcileWorkstreams } from "./workstream-client.js";

const PROJECTION_PATH = ".pi-workbench/projection.json";
const PANEL_ID = "pi-workbench:run.panel";
const projectionCache = new Map();
const recordedWorkstreamState = { status: "idle", snapshots: [], sequence: 0, error: "", notice: "", promise: undefined };
let workstreamClient;

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
  activate: ({ html, svg, service }) => {
    workstreamClient = service === undefined ? undefined : createWorkbenchWorkstreamClient(service);
    installRunStatusElement();
    installWorkstreamsElement();
    return {
      contributions: {
        navigationEntries: [
          {
            id: "workstreams.navigation",
            title: "Workstreams",
            primaryView: "workstreams.view",
            order: 10,
            icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"></path><circle cx="18" cy="18" r="2"></circle></svg>`,
            badge: () => recordedWorkstreamState.status === "ready" ? recordedWorkstreamState.snapshots.filter((snapshot) => !snapshot.closed).length : undefined,
          },
        ],
        primaryViews: [
          {
            id: "workstreams.view",
            title: "Workstreams",
            ariaLabel: "Workstreams",
            order: 10,
            render: (context) => html`<pi-workbench-workstreams .context=${context}></pi-workbench-workstreams>`,
          },
        ],
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

function installWorkstreamsElement() {
  if (customElements.get("pi-workbench-workstreams") !== undefined) return;

  class PiWorkbenchWorkstreams extends HTMLElement {
    #context;
    #watchTimer;

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }

    set context(value) {
      this.#context = value;
      void loadRecordedWorkstreams(value).finally(() => { this.#render(); });
      this.#render();
    }

    connectedCallback() {
      if (this.#context !== undefined) void loadRecordedWorkstreams(this.#context).finally(() => { this.#render(); });
      this.#scheduleWatch();
      this.#render();
    }

    disconnectedCallback() {
      if (this.#watchTimer !== undefined) window.clearTimeout(this.#watchTimer);
      this.#watchTimer = undefined;
    }

    #scheduleWatch() {
      if (!this.isConnected || this.#watchTimer !== undefined) return;
      this.#watchTimer = window.setTimeout(() => {
        this.#watchTimer = undefined;
        const context = this.#context;
        if (context !== undefined && context.connection?.status !== "reconnecting") {
          void loadRecordedWorkstreams(context, true).finally(() => { this.#render(); this.#scheduleWatch(); });
        } else {
          this.#scheduleWatch();
        }
      }, 2_000);
    }

    #retry() {
      recordedWorkstreamState.status = "idle";
      recordedWorkstreamState.error = "";
      recordedWorkstreamState.promise = undefined;
      if (this.#context !== undefined) void loadRecordedWorkstreams(this.#context).finally(() => { this.#render(); });
      this.#render();
    }

    async #mutate(operation) {
      if (workstreamClient === undefined) return;
      recordedWorkstreamState.error = "";
      try {
        const receipt = await operation(workstreamClient);
        recordedWorkstreamState.notice = `Accepted revision ${String(receipt.acceptedRevision)} at sequence ${String(receipt.sequence)}.`;
        if (recordedWorkstreamState.promise !== undefined) await recordedWorkstreamState.promise;
        await loadRecordedWorkstreams(this.#context, true);
      } catch (error) {
        recordedWorkstreamState.error = errorMessage(error);
      }
      this.#render();
    }

    #create() {
      const title = window.prompt("Workstream title");
      if (title === null || title.trim() === "") return;
      const id = newId("ws");
      const key = newId("create");
      void this.#mutate((client) => client.create({ workstreamId: id, idempotencyKey: key, title: title.trim(), producer: "owner" }));
    }

    #appendLink(snapshot) {
      const reference = window.prompt("Link reference (file, repository, artifact, or URL)");
      if (reference === null || reference.trim() === "") return;
      const key = newId("append");
      void this.#mutate((client) => client.append({
        workstreamId: snapshot.id,
        expectedRevision: snapshot.revision,
        idempotencyKey: key,
        records: [{ type: "link.upsert", producer: "owner", payload: { link: { id: newId("link"), kind: "reference", reference: reference.trim() } } }],
      }));
    }

    #close(snapshot) {
      if (!window.confirm(`Close ${snapshot.title}?`)) return;
      const key = newId("close");
      void this.#mutate((client) => client.close({ workstreamId: snapshot.id, expectedRevision: snapshot.revision, idempotencyKey: key, producer: "owner" }));
    }

    #render() {
      const root = this.shadowRoot;
      if (root === null) return;
      root.replaceChildren();
      root.append(workstreamsStyleElement());
      const main = document.createElement("main");
      main.setAttribute("aria-live", "polite");
      const context = this.#context;
      if (context?.connection?.status === "reconnecting") {
        main.append(message(`PI WEB is reconnecting${context.connection.message ? `: ${context.connection.message}` : "."} The last recorded Workstream projection remains visible.`, "connection"));
      }
      if (recordedWorkstreamState.status === "loading" || recordedWorkstreamState.status === "idle") {
        main.append(workstreamState("Loading Workstreams…", "Reading the deterministic recorded projection."));
      } else if (recordedWorkstreamState.status === "error") {
        const state = workstreamState("Workstreams could not be loaded", recordedWorkstreamState.error);
        state.append(button("Try again", () => { this.#retry(); }));
        main.append(state);
      } else if (recordedWorkstreamState.snapshots.length === 0) {
        const empty = workstreamState("No Workstreams yet", "Create a finite attention container to begin.");
        empty.append(button("Create Workstream", () => { this.#create(); }));
        main.append(empty);
      } else {
        if (recordedWorkstreamState.notice !== "") main.append(message(recordedWorkstreamState.notice, "receipt"));
        main.append(renderWorkstreams(
          recordedWorkstreamState.snapshots,
          recordedWorkstreamState.sequence,
          () => { this.#create(); },
          (snapshot) => { this.#appendLink(snapshot); },
          (snapshot) => { this.#close(snapshot); },
        ));
      }
      root.append(main);
    }
  }

  customElements.define("pi-workbench-workstreams", PiWorkbenchWorkstreams);
}

async function loadRecordedWorkstreams(context, force = false) {
  if (recordedWorkstreamState.status === "ready" && !force) return;
  if (recordedWorkstreamState.promise !== undefined) return recordedWorkstreamState.promise;
  if (workstreamClient === undefined) {
    recordedWorkstreamState.status = "error";
    recordedWorkstreamState.error = "This PI WEB version does not provide the typed plugin service transport.";
    return;
  }
  if (recordedWorkstreamState.status !== "ready") recordedWorkstreamState.status = "loading";
  context.host.requestRender();
  recordedWorkstreamState.promise = reconcileWorkstreams(workstreamClient, {
    snapshots: recordedWorkstreamState.snapshots,
    sequence: recordedWorkstreamState.sequence,
  })
    .then((projection) => {
      recordedWorkstreamState.status = "ready";
      recordedWorkstreamState.snapshots = projection.snapshots;
      recordedWorkstreamState.sequence = projection.sequence;
      recordedWorkstreamState.error = "";
    })
    .catch((error) => {
      recordedWorkstreamState.status = "error";
      recordedWorkstreamState.error = errorMessage(error);
    })
    .finally(() => {
      recordedWorkstreamState.promise = undefined;
      context.host.requestRender();
    });
  return recordedWorkstreamState.promise;
}

function renderWorkstreams(snapshots, sequence, onCreate, onAppendLink, onClose) {
  const fragment = document.createDocumentFragment();
  const header = document.createElement("header");
  const heading = document.createElement("div");
  heading.append(label("Attention continuity"), strong("Workstreams"), message("Resume the session with the clearest next action. Changes are persisted by the Workbench Workstream Store.", "muted"));
  const actions = document.createElement("div");
  actions.className = "header-actions";
  actions.append(message(`Sequence ${String(sequence)}`, "sequence"), button("Create", onCreate));
  header.append(heading, actions);
  fragment.append(header);

  const open = snapshots.filter((snapshot) => !snapshot.closed);
  const closed = snapshots.filter((snapshot) => snapshot.closed);
  const openSection = section("Current", open.length === 0 ? "No current Workstreams." : undefined);
  for (const snapshot of open) openSection.append(workstreamArticle(snapshot, onAppendLink, onClose));
  fragment.append(openSection);
  if (closed.length > 0) {
    const closedSection = section("Closed");
    closedSection.classList.add("closed-section");
    for (const snapshot of closed) closedSection.append(workstreamArticle(snapshot, onAppendLink, onClose));
    fragment.append(closedSection);
  }
  return fragment;
}

function workstreamArticle(snapshot, onAppendLink, onClose) {
  const article = document.createElement("article");
  article.className = `workstream${snapshot.closed ? " closed" : ""}`;
  const heading = document.createElement("div");
  heading.className = "workstream-heading";
  const title = document.createElement("div");
  title.append(strong(snapshot.title), message(`${snapshot.closed ? "Closed" : "Current"} · revision ${String(snapshot.revision)}`, "muted"));
  heading.append(title);
  if (snapshot.humanTasks.length > 0) heading.append(message(`${String(snapshot.humanTasks.length)} human task${snapshot.humanTasks.length === 1 ? "" : "s"}`, "task-count"));
  article.append(heading);

  if (snapshot.sessions.length === 0) {
    article.append(message("No active sessions.", "muted"));
  } else {
    const sessions = document.createElement("div");
    sessions.className = "sessions";
    for (const session of snapshot.sessions) sessions.append(sessionRow(session));
    article.append(sessions);
  }

  if (snapshot.humanTasks.length > 0) {
    const tasks = document.createElement("div");
    tasks.className = "tasks";
    tasks.append(label("Needs you"));
    for (const task of snapshot.humanTasks) tasks.append(strong(task.title), ...(task.detail ? [message(task.detail, "muted")] : []));
    article.append(tasks);
  }

  if (snapshot.links.length > 0) article.append(message(snapshot.links.map((link) => link.label ?? link.reference).join(" · "), "links"));
  if (!snapshot.closed) {
    const actions = document.createElement("div");
    actions.className = "workstream-actions";
    actions.append(button("Add link", () => { onAppendLink(snapshot); }), button("Close", () => { onClose(snapshot); }));
    article.append(actions);
  }
  return article;
}

function sessionRow(session) {
  const row = document.createElement("div");
  row.className = "session";
  const header = document.createElement("div");
  header.className = "session-heading";
  header.append(strong(session.id), message(humanize(session.status), "state"));
  row.append(header);
  if (session.latestCheckpoint !== null) {
    row.append(message(session.latestCheckpoint.next, "next"), message(`Changed: ${session.latestCheckpoint.whatChanged}`, "muted"), message(`Remains: ${session.latestCheckpoint.remains}`, "muted"));
  } else {
    row.append(message("No current checkpoint is available.", "muted"));
  }
  if (session.checkpointFailure !== null) row.append(message(session.checkpointFailure, "checkpoint-error"));
  return row;
}

function workstreamState(title, detail) {
  const state = document.createElement("section");
  state.className = "workstream-state";
  const heading = document.createElement("h1");
  heading.textContent = title;
  state.append(heading, message(detail, "muted"));
  return state;
}

function workstreamsStyleElement() {
  const style = document.createElement("style");
  style.textContent = `
    :host { box-sizing: border-box; flex: 1 1 auto; min-width: 0; min-height: 0; display: block; color: var(--pi-text); background: var(--pi-bg); font: 14px system-ui, sans-serif; }
    main { box-sizing: border-box; width: min(100%, var(--pi-content-max-width, 1100px)); min-height: 100%; display: grid; align-content: start; gap: calc(var(--pi-panel-padding, 12px) * 1.5); margin: 0 auto; padding: clamp(16px, 3vw, 36px); }
    header, .workstream-heading, .session-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--pi-toolbar-gap, 8px); }
    header > div, .workstream-heading > div { min-width: 0; display: grid; gap: 5px; }
    .header-actions, .workstream-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--pi-toolbar-gap, 8px); }
    header strong { font-size: clamp(22px, 3vw, 34px); letter-spacing: -.025em; }
    section { display: grid; gap: var(--pi-message-gap, 10px); }
    h2 { margin: 0 0 4px; color: var(--pi-text-bright); font-size: 13px; }
    .workstream { display: grid; gap: var(--pi-message-gap, 10px); padding: var(--pi-message-padding, 14px) 0; border-top: 1px solid var(--pi-border); }
    .workstream.closed { color: var(--pi-muted); }
    .sessions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: var(--pi-message-gap, 10px); }
    .session { min-width: 0; display: grid; align-content: start; gap: 6px; padding: var(--pi-message-padding, 12px); border-radius: 10px; background: var(--pi-surface); }
    .session strong, .workstream strong { overflow-wrap: anywhere; }
    .message { margin: 0; line-height: 1.45; overflow-wrap: anywhere; }
    .muted, .links { color: var(--pi-muted); font-size: 12px; }
    .eyebrow { color: var(--pi-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .sequence, .state, .task-count { flex: 0 0 auto; border-radius: 999px; background: var(--pi-surface); color: var(--pi-muted); padding: 3px 7px; font-size: 11px; white-space: nowrap; }
    .task-count { background: var(--pi-warning-surface); color: var(--pi-warning); }
    .next { color: var(--pi-text-bright); font-weight: 650; }
    .tasks { display: grid; gap: 4px; padding: var(--pi-message-padding, 12px); background: var(--pi-warning-surface); }
    .checkpoint-error, .connection { padding: var(--pi-message-padding, 12px); background: var(--pi-warning-surface); color: var(--pi-warning); }
    .connection { border-radius: 8px; }
    .receipt { padding: var(--pi-message-padding, 12px); border-radius: 8px; background: var(--pi-success-surface); color: var(--pi-success); }
    .closed-section { opacity: .78; }
    .workstream-state { width: min(100%, 520px); align-self: center; justify-self: center; padding: clamp(24px, 6vw, 64px); text-align: center; }
    .workstream-state h1 { margin: 0; color: var(--pi-text); font-size: 20px; }
    button { justify-self: center; min-height: var(--pi-control-min-size, 34px); border: 0; border-radius: 6px; background: var(--pi-selection-bg); color: var(--pi-text); padding: var(--pi-control-padding-block, 7px) var(--pi-control-padding-inline, 9px); cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    @media (max-width: 520px) { main { padding: var(--pi-panel-padding, 12px); } header { align-items: flex-start; } header strong { font-size: 24px; } .sequence { display: none; } .sessions { grid-template-columns: minmax(0, 1fr); } }
    @media (pointer: coarse) { button { min-height: 44px; } }
  `;
  return style;
}

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

function newId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
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
