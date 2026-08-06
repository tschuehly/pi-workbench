import { createWorkbenchWorkstreamClient, reconcileWorkstreams } from "./workstream-client.js";
import { WorkstreamSessionCoordinator } from "./workstream-session-coordinator.js";

const PROJECTION_PATH = ".pi-workbench/projection.json";
const PANEL_ID = "pi-workbench:run.panel";
const projectionCache = new Map();
const recordedWorkstreamState = { status: "idle", snapshots: [], sequence: 0, error: "", notice: "", selectedWorkstreamId: undefined, focusKey: undefined, promise: undefined };
let workstreamClient;
let connectedWorkstreamsElement;

export function dedicatedWorkstreamLayout({ tool, sessionsPaneOpen, tasksPaneOpen }) {
  const surface = tool === "files" || tool === "git" ? tool : "chat";
  return {
    sessionsPaneVisible: sessionsPaneOpen === true,
    tasksPaneVisible: tasksPaneOpen === true,
    surface,
    scope: surface === "git" ? "selected-session-checkout-observed-unattributed" : "selected-session-checkout",
  };
}

export function transitionDedicatedWorkstreamUi(state, action) {
  switch (action.type) {
    case "select-surface":
      return action.surface === "terminal"
        ? { ...state, terminalOpen: true }
        : { ...state, tool: action.surface, mobilePane: "workspace" };
    case "select-mobile-pane": return { ...state, mobilePane: action.pane };
    case "toggle-sessions": return { ...state, sessionsPaneOpen: !state.sessionsPaneOpen };
    case "toggle-tasks": return { ...state, tasksPaneOpen: !state.tasksPaneOpen };
    case "toggle-terminal": return { ...state, terminalOpen: !state.terminalOpen };
    default: return state;
  }
}

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
        sessionStartGuards: [
          {
            id: "workstreams.session-home",
            disabledReason: () => "Start new sessions from a Workstream so every interactive session has one durable home.",
          },
        ],
        primaryViews: [
          {
            id: "workstreams.view",
            title: "Workstreams",
            ariaLabel: "Workstreams",
            layout: () => recordedWorkstreamState.selectedWorkstreamId === undefined ? "default" : "dedicated",
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
    #selectedWorkstreamId;
    #selectedSessionId;
    #tool = "chat";
    #sessionsPaneOpen = true;
    #tasksPaneOpen = true;
    #terminalOpen = false;
    #mobilePane = "workspace";
    #surfaceSelectionRelease;
    #main;
    #dedicatedView;

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      root.append(workstreamsStyleElement());
      this.#main = document.createElement("main");
      root.append(this.#main);
    }

    set context(value) {
      this.#context = value;
      void loadRecordedWorkstreams(value).finally(() => { this.#render(); });
      this.#render();
    }

    connectedCallback() {
      connectedWorkstreamsElement = this;
      if (this.#context !== undefined) void loadRecordedWorkstreams(this.#context).finally(() => { this.#render(); });
      this.#scheduleWatch();
      this.#render();
    }

    disconnectedCallback() {
      if (this.#watchTimer !== undefined) window.clearTimeout(this.#watchTimer);
      this.#watchTimer = undefined;
      if (connectedWorkstreamsElement === this) connectedWorkstreamsElement = undefined;
      this.#releaseSurfaceSelection();
    }

    #restoreFocusAfterHostRender(focusKey) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const current = connectedWorkstreamsElement;
          if (current === undefined) return;
          const target = focusKey === "dedicated:title"
            ? current.#dedicatedView?.title
            : [...current.#main.querySelectorAll("[data-focus-key]")].find((control) => control.dataset.focusKey === focusKey);
          target?.focus({ preventScroll: true });
          if (target !== undefined) recordedWorkstreamState.focusKey = undefined;
        });
      });
    }

    #releaseSurfaceSelection() {
      this.#surfaceSelectionRelease?.();
      this.#surfaceSelectionRelease = undefined;
    }

    #syncSurfaceSelection(active) {
      if (!active) {
        this.#releaseSurfaceSelection();
        return;
      }
      if (this.#surfaceSelectionRelease !== undefined) return;
      this.#surfaceSelectionRelease = this.#context?.surfaceHost?.registerSelectionHandler?.((surface) => {
        this.#selectSurface(surface);
      });
    }

    #selectSurface(surface) {
      this.#context?.surfaceHost?.activate?.(surface);
      const focusTarget = surface === "terminal" ? this.#dedicatedView?.terminalToggle : this.#dedicatedView?.toolButtons.get(surface);
      focusTarget?.focus({ preventScroll: true });
      this.#transition({ type: "select-surface", surface });
    }

    #transition(action) {
      const next = transitionDedicatedWorkstreamUi({
        tool: this.#tool,
        sessionsPaneOpen: this.#sessionsPaneOpen,
        tasksPaneOpen: this.#tasksPaneOpen,
        terminalOpen: this.#terminalOpen,
        mobilePane: this.#mobilePane,
      }, action);
      this.#tool = next.tool;
      this.#sessionsPaneOpen = next.sessionsPaneOpen;
      this.#tasksPaneOpen = next.tasksPaneOpen;
      this.#terminalOpen = next.terminalOpen;
      this.#mobilePane = next.mobilePane;
      if (action.type === "select-surface" && action.surface !== "terminal") {
        writeLocalPreference("tool", next.tool);
        writeLocalPreference("mobile-pane", next.mobilePane);
      } else if (action.type === "select-mobile-pane") writeLocalPreference("mobile-pane", next.mobilePane);
      else if (action.type === "toggle-sessions") writeLocalPreference("sessions-open", String(next.sessionsPaneOpen));
      else if (action.type === "toggle-tasks") writeLocalPreference("tasks-open", String(next.tasksPaneOpen));
      this.#render();
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

    #coordinator() {
      if (workstreamClient === undefined || this.#context?.sessions === undefined) throw new Error("Attended session launch is unavailable.");
      return new WorkstreamSessionCoordinator(workstreamClient, this.#context.sessions);
    }

    #openWorkstream(snapshot) {
      recordedWorkstreamState.focusKey = "dedicated:title";
      this.#selectedWorkstreamId = snapshot.id;
      recordedWorkstreamState.selectedWorkstreamId = snapshot.id;
      this.#selectedSessionId = snapshot.sessions.find((session) => session.status === "active")?.id;
      this.#tool = readLocalPreference("tool", "chat", ["chat", "files", "git"]);
      this.#sessionsPaneOpen = readLocalBoolean("sessions-open", true);
      this.#tasksPaneOpen = readLocalBoolean("tasks-open", snapshot.humanTasks.length > 0);
      this.#mobilePane = readLocalPreference("mobile-pane", "workspace", ["sessions", "workspace", "tasks"]);
      this.#context?.host?.requestRender();
      this.#render();
      this.#restoreFocusAfterHostRender("dedicated:title");
      const selected = snapshot.sessions.find((session) => session.id === this.#selectedSessionId);
      if (selected !== undefined) void this.#selectSession(selected);
    }

    #returnToPortfolio() {
      recordedWorkstreamState.focusKey = `${this.#selectedWorkstreamId}:open`;
      this.#selectedWorkstreamId = undefined;
      recordedWorkstreamState.selectedWorkstreamId = undefined;
      this.#selectedSessionId = undefined;
      this.#terminalOpen = false;
      this.#dedicatedView = undefined;
      this.#releaseSurfaceSelection();
      this.#context?.host?.requestRender();
      this.#render();
      this.#restoreFocusAfterHostRender(recordedWorkstreamState.focusKey);
    }

    async #selectSession(session) {
      this.#selectedSessionId = session.id;
      this.#mobilePane = "workspace";
      this.#render();
      if (session.status !== "active" || this.#context?.sessions === undefined) return;
      try {
        if (typeof this.#context.sessions.select === "function") {
          await this.#context.sessions.select({ sessionId: session.id, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId });
        } else {
          throw new Error("This PI WEB version cannot preserve the Workstream shell while selecting a session.");
        }
      } catch (error) {
        recordedWorkstreamState.error = errorMessage(error);
      }
      this.#render();
    }

    #start(snapshot) {
      void this.#mutate(async () => {
        const session = await this.#coordinator().launch(snapshot);
        recordedWorkstreamState.notice = `Started session ${session.id}.`;
        return { acceptedRevision: (await workstreamClient.inspect(snapshot.id)).revision, sequence: recordedWorkstreamState.sequence };
      });
    }

    #resume(session) {
      void this.#coordinator().resume(session).catch((error) => { recordedWorkstreamState.error = errorMessage(error); this.#render(); });
    }

    #requestCheckpoint(session) {
      if (this.#context?.sessions === undefined) { recordedWorkstreamState.error = "Attended session controls are unavailable."; this.#render(); return; }
      const location = { sessionId: session.id, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId };
      void this.#context.sessions.prompt(location, "Propose a concise attended Workstream checkpoint with exactly three labeled parts: What changed, What remains, and Next useful action. Do not persist it; I will review and confirm it in the Workstreams view.")
        .catch((error) => { recordedWorkstreamState.error = errorMessage(error); this.#render(); });
    }

    #saveCheckpoint(snapshot, session) {
      const prior = session.latestCheckpoint;
      const whatChanged = window.prompt("What changed? Review and correct Pi's proposal before saving.", prior?.whatChanged ?? "");
      if (whatChanged === null || whatChanged.trim() === "") return;
      const remains = window.prompt("What remains?", prior?.remains ?? "");
      if (remains === null || remains.trim() === "") return;
      const next = window.prompt("Next useful action?", prior?.next ?? "");
      if (next === null || next.trim() === "") return;
      if (!window.confirm(`Save this checkpoint?\n\nChanged: ${whatChanged}\n\nRemains: ${remains}\n\nNext: ${next}`)) return;
      void this.#mutate(async (client) => {
        try {
          return await client.append({
            workstreamId: snapshot.id,
            expectedRevision: snapshot.revision,
            idempotencyKey: newId("checkpoint"),
            records: [{ type: "checkpoint.replaced", producer: "owner", sourceSessionId: session.id, payload: { sessionId: session.id, checkpoint: { id: newId("cp"), whatChanged: whatChanged.trim(), remains: remains.trim(), next: next.trim() } } }],
          });
        } catch (error) {
          const current = await client.inspect(snapshot.id);
          return client.append({
            workstreamId: snapshot.id,
            expectedRevision: current.revision,
            idempotencyKey: newId("checkpoint-failed"),
            records: [{ type: "checkpoint.failed", producer: "pi-web", sourceSessionId: session.id, payload: { sessionId: session.id, reason: `Confirmed checkpoint was not saved: ${errorMessage(error)}` } }],
          });
        }
      });
    }

    #addTask(snapshot) {
      const title = window.prompt("Human task");
      if (title === null || title.trim() === "") return;
      const detail = window.prompt("Detail (optional)");
      void this.#mutate((client) => client.append({ workstreamId: snapshot.id, expectedRevision: snapshot.revision, idempotencyKey: newId("task"), records: [{ type: "human-task.upsert", producer: "owner", payload: { task: { id: newId("task"), title: title.trim(), ...(detail?.trim() ? { detail: detail.trim() } : {}) } } }] }));
    }

    #resolveTask(snapshot, task) {
      void this.#mutate((client) => client.append({ workstreamId: snapshot.id, expectedRevision: snapshot.revision, idempotencyKey: newId("task-resolved"), records: [{ type: "human-task.resolved", producer: "owner", payload: { taskId: task.id } }] }));
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
      const main = this.#main;
      const context = this.#context;
      const selected = recordedWorkstreamState.snapshots.find((snapshot) => snapshot.id === this.#selectedWorkstreamId);
      this.#syncSurfaceSelection(selected !== undefined);

      if (selected !== undefined && recordedWorkstreamState.status === "ready") {
        const options = {
          context,
          selectedSessionId: this.#selectedSessionId,
          tool: this.#tool,
          sessionsPaneOpen: this.#sessionsPaneOpen,
          tasksPaneOpen: this.#tasksPaneOpen,
          terminalOpen: this.#terminalOpen,
          mobilePane: this.#mobilePane,
          reconnecting: context?.connection?.status === "reconnecting",
          error: recordedWorkstreamState.error,
          notice: recordedWorkstreamState.notice,
          onBack: () => { this.#returnToPortfolio(); },
          onSelectSession: (session) => { void this.#selectSession(session); },
          onSelectTool: (tool) => { this.#selectSurface(tool); },
          onSelectMobilePane: (pane) => { this.#transition({ type: "select-mobile-pane", pane }); },
          onToggleSessions: () => { this.#transition({ type: "toggle-sessions" }); },
          onToggleTasks: () => { this.#transition({ type: "toggle-tasks" }); },
          onToggleTerminal: () => {
            if (!this.#terminalOpen) this.#context?.surfaceHost?.activate?.("terminal");
            this.#transition({ type: "toggle-terminal" });
          },
          onStart: () => { this.#start(selected); },
          onResume: (session) => { this.#resume(session); },
          onRequestCheckpoint: (session) => { this.#requestCheckpoint(session); },
          onSaveCheckpoint: (session) => { this.#saveCheckpoint(selected, session); },
          onResolveTask: (task) => { this.#resolveTask(selected, task); },
        };
        if (this.#dedicatedView?.workstreamId !== selected.id) {
          this.#dedicatedView = createDedicatedWorkstream(selected, options);
          main.replaceChildren(this.#dedicatedView.element);
        }
        main.className = "dedicated-workstream";
        updateDedicatedWorkstream(this.#dedicatedView, selected, options);
        if (recordedWorkstreamState.focusKey === "dedicated:title") settleFocus(this.#dedicatedView.title, "dedicated:title");
        return;
      }

      this.#dedicatedView = undefined;
      const focusedKey = this.shadowRoot?.activeElement?.dataset?.focusKey ?? recordedWorkstreamState.focusKey;
      main.className = "";
      main.replaceChildren();
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
        if (recordedWorkstreamState.error !== "") main.append(message(recordedWorkstreamState.error, "checkpoint-error"));
        if (recordedWorkstreamState.notice !== "") main.append(message(recordedWorkstreamState.notice, "receipt"));
        main.append(renderWorkstreams(
          recordedWorkstreamState.snapshots,
          recordedWorkstreamState.sequence,
          () => { this.#create(); },
          (snapshot) => { this.#start(snapshot); },
          (session) => { this.#resume(session); },
          (session) => { this.#requestCheckpoint(session); },
          (snapshot, session) => { this.#saveCheckpoint(snapshot, session); },
          (snapshot) => { this.#addTask(snapshot); },
          (snapshot, task) => { this.#resolveTask(snapshot, task); },
          (snapshot) => { this.#appendLink(snapshot); },
          (snapshot) => { this.#close(snapshot); },
          (snapshot) => { this.#openWorkstream(snapshot); },
        ));
      }
      if (focusedKey !== undefined) {
        const target = [...main.querySelectorAll("[data-focus-key]")].find((control) => control.dataset.focusKey === focusedKey);
        if (target !== undefined) settleFocus(target, focusedKey);
      }
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
    .then(async (projection) => {
      if (context.sessions !== undefined) {
        const coordinator = new WorkstreamSessionCoordinator(workstreamClient, context.sessions);
        const reconciled = (await Promise.all(projection.snapshots.map((snapshot) => coordinator.reconcile(snapshot)))).flat();
        if (reconciled.some((result) => result.status === "confirmed")) {
          projection = await reconcileWorkstreams(workstreamClient, projection);
        }
      }
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

function renderWorkstreams(snapshots, sequence, onCreate, onStart, onResume, onRequestCheckpoint, onSaveCheckpoint, onAddTask, onResolveTask, onAppendLink, onClose, onOpen) {
  const fragment = document.createDocumentFragment();
  const header = document.createElement("header");
  const heading = document.createElement("div");
  heading.append(strong("Workstreams"), message("Pick up the next useful continuation without reconstructing it from chat history.", "muted portfolio-intro"));
  const actions = document.createElement("div");
  actions.className = "header-actions";
  actions.append(message(`Projection sequence ${String(sequence)}`, "sequence"), keyedButton("Create Workstream", "portfolio:create", onCreate));
  header.append(heading, actions);
  fragment.append(header);

  const current = snapshots.filter((snapshot) => !snapshot.closed);
  const closed = snapshots.filter((snapshot) => snapshot.closed);
  const currentSection = section("Current Workstreams", current.length === 0 ? "No current Workstreams." : undefined);
  currentSection.classList.add("portfolio-list");
  for (const snapshot of current) currentSection.append(workstreamArticle(snapshot, onStart, onResume, onRequestCheckpoint, onSaveCheckpoint, onAddTask, onResolveTask, onAppendLink, onClose, onOpen));
  fragment.append(currentSection);
  if (closed.length > 0) {
    const history = document.createElement("details");
    history.className = "closed-history";
    const summary = document.createElement("summary");
    summary.textContent = `Closed Workstreams · ${String(closed.length)}`;
    history.append(summary);
    const closedSection = section("Closed history");
    closedSection.classList.add("portfolio-list", "closed-section");
    for (const snapshot of closed) closedSection.append(workstreamArticle(snapshot, onStart, onResume, onRequestCheckpoint, onSaveCheckpoint, onAddTask, onResolveTask, onAppendLink, onClose, onOpen));
    history.append(closedSection);
    fragment.append(history);
  }
  return fragment;
}

function workstreamArticle(snapshot, onStart, onResume, onRequestCheckpoint, onSaveCheckpoint, onAddTask, onResolveTask, onAppendLink, onClose, onOpen) {
  const article = document.createElement("article");
  article.className = `workstream portfolio-row${snapshot.closed ? " closed" : ""}`;
  article.style.setProperty("--workstream-color", workstreamColor(snapshot.id));

  const marker = document.createElement("span");
  marker.className = "portfolio-marker";
  marker.setAttribute("aria-hidden", "true");
  const content = document.createElement("div");
  content.className = "portfolio-content";
  const heading = document.createElement("div");
  heading.className = "workstream-heading";
  const title = document.createElement("div");
  title.append(strong(snapshot.title), message(`${snapshot.closed ? "Closed" : "Current"} · revision ${String(snapshot.revision)}`, "diagnostic"));
  heading.append(title);
  if (snapshot.humanTasks.length > 0) heading.append(message(`${String(snapshot.humanTasks.length)} needs you`, "task-count"));
  content.append(heading);

  const active = snapshot.sessions.filter((session) => session.status === "active");
  const continuation = active.find((session) => session.latestCheckpoint?.next)?.latestCheckpoint?.next;
  const focal = document.createElement("div");
  focal.className = "portfolio-continuation";
  focal.append(label("Next useful continuation"), strong(continuation ?? (active.length > 0 ? "Review the active sessions and confirm a checkpoint." : "Start a session from an explicit checkout.")));
  content.append(focal);

  if (snapshot.humanTasks.length > 0) {
    const attention = document.createElement("div");
    attention.className = "portfolio-attention";
    attention.append(label("Human Attention"), message(snapshot.humanTasks.map((task) => task.title).join(" · "), "message"));
    content.append(attention);
  }

  if (active.length > 0) {
    const purposes = document.createElement("div");
    purposes.className = "portfolio-sessions";
    for (const session of active) {
      const row = document.createElement("div");
      row.className = "portfolio-session";
      row.append(strong(session.purpose ?? session.latestCheckpoint?.next ?? "Active Pi session"), message(sessionAnchor(session), "session-anchor"), message(`Session ${session.id}`, "diagnostic"));
      purposes.append(row);
    }
    content.append(purposes);
  }

  const actions = document.createElement("div");
  actions.className = "workstream-actions";
  actions.append(keyedButton(snapshot.closed ? "Open history" : active.length > 0 ? "Resume" : "Open", `${snapshot.id}:open`, () => { onOpen(snapshot); }));
  if (!snapshot.closed) actions.append(
    keyedButton("Start session", `${snapshot.id}:start`, () => { onStart(snapshot); }),
    keyedButton("Add task", `${snapshot.id}:task`, () => { onAddTask(snapshot); }),
    keyedButton("Add link", `${snapshot.id}:link`, () => { onAppendLink(snapshot); }),
    keyedButton("Close", `${snapshot.id}:close`, () => { onClose(snapshot); }),
  );
  article.append(marker, content, actions);
  return article;
}

function createDedicatedWorkstream(snapshot, options) {
  const view = { workstreamId: snapshot.id, options, surfaces: new Map() };
  const shell = document.createElement("section");
  shell.className = "workstream-shell";
  view.element = shell;

  const banner = document.createElement("div");
  banner.className = "shell-banner";
  banner.setAttribute("aria-live", "polite");
  view.banner = banner;

  const topbar = document.createElement("header");
  topbar.className = "workstream-topbar";
  const identity = document.createElement("div");
  identity.className = "workstream-identity";
  identity.append(iconButton("←", "Back to all Workstreams", () => { view.options.onBack(); }));
  const swatch = document.createElement("span");
  swatch.className = "workstream-swatch";
  swatch.setAttribute("aria-hidden", "true");
  const title = document.createElement("div");
  view.title = document.createElement("h1");
  view.title.className = "shell-title";
  view.title.tabIndex = -1;
  view.identityMeta = message("", "muted");
  title.append(view.title, view.identityMeta);
  identity.append(swatch, title);

  const tools = document.createElement("nav");
  tools.className = "workstream-tools";
  tools.setAttribute("aria-label", "Selected session tools");
  view.toolButtons = new Map();
  for (const [tool, labelText] of [["chat", "Chat"], ["files", "Files"], ["git", "Git"]]) {
    const control = button(labelText, () => { view.options.onSelectTool(tool); });
    view.toolButtons.set(tool, control);
    tools.append(control);
  }
  const utilities = document.createElement("div");
  utilities.className = "workstream-utilities";
  view.connection = message("", "scope-label connection-state");
  utilities.append(view.connection);
  if (typeof options.context?.host?.openActions === "function") utilities.append(button("Actions", () => { view.options.context.host.openActions(); }));
  topbar.append(identity, tools, utilities);

  const mobileNavigation = document.createElement("nav");
  mobileNavigation.className = "mobile-pane-navigation";
  mobileNavigation.setAttribute("aria-label", "Workstream destinations");
  view.mobileButtons = new Map();
  for (const pane of ["sessions", "workspace", "tasks"]) {
    const control = button("", () => { view.options.onSelectMobilePane(pane); });
    view.mobileButtons.set(pane, control);
    mobileNavigation.append(control);
  }

  const body = document.createElement("div");
  body.className = "workstream-body";
  view.body = body;

  const sessions = document.createElement("aside");
  sessions.className = "sessions-pane";
  sessions.id = "workstream-sessions-pane";
  sessions.setAttribute("aria-labelledby", "workstream-sessions-heading");
  const sessionsHeading = document.createElement("div");
  sessionsHeading.className = "pane-heading";
  const sessionsTitle = document.createElement("h2");
  sessionsTitle.id = "workstream-sessions-heading";
  sessionsTitle.textContent = "Sessions";
  sessionsHeading.append(sessionsTitle, button("New session", () => { view.options.onStart(); }));
  view.sessionsList = document.createElement("div");
  view.sessionsList.className = "pane-list";
  sessions.append(sessionsHeading, view.sessionsList);

  view.sessionsEdge = edgeButton("Sessions", true, "left", () => { view.options.onToggleSessions(); });

  const workspace = document.createElement("section");
  workspace.className = "workspace-pane";
  workspace.setAttribute("aria-labelledby", "workstream-workspace-heading");
  const workspaceHeading = document.createElement("div");
  workspaceHeading.className = "workspace-heading";
  const workspaceCopy = document.createElement("div");
  view.toolName = document.createElement("h2");
  view.toolName.id = "workstream-workspace-heading";
  view.scope = message("", "scope-label");
  workspaceCopy.append(view.toolName, view.scope);
  view.checkpointActions = document.createElement("div");
  view.checkpointActions.className = "checkpoint-actions";
  workspaceHeading.append(workspaceCopy, view.checkpointActions);
  view.surfaceStack = document.createElement("div");
  view.surfaceStack.className = "surface-stack";
  for (const surface of ["chat", "files", "git"]) {
    const container = mountedHostSurface(options.context, surface);
    container.dataset.surface = surface;
    view.surfaces.set(surface, container);
    view.surfaceStack.append(container);
  }
  view.workspaceEmpty = message("", "empty-pane workspace-empty");
  workspace.append(workspaceHeading, view.workspaceEmpty, view.surfaceStack);

  view.tasksEdge = edgeButton("Human Tasks", true, "right", () => { view.options.onToggleTasks(); });

  const tasks = document.createElement("aside");
  tasks.className = "tasks-pane";
  tasks.id = "workstream-tasks-pane";
  tasks.setAttribute("aria-labelledby", "workstream-tasks-heading");
  const tasksHeading = document.createElement("div");
  tasksHeading.className = "pane-heading";
  view.tasksTitle = document.createElement("h2");
  view.tasksTitle.id = "workstream-tasks-heading";
  tasksHeading.append(view.tasksTitle);
  view.tasksList = document.createElement("div");
  view.tasksList.className = "pane-list";
  tasks.append(tasksHeading, view.tasksList);
  body.append(sessions, view.sessionsEdge, workspace, view.tasksEdge, tasks);

  const terminal = document.createElement("section");
  terminal.className = "terminal-drawer";
  view.terminal = terminal;
  view.terminalToggle = button("", () => { view.options.onToggleTerminal(); });
  view.terminalToggle.title = "Terminal for selected session checkout";
  view.terminalScope = message("", "terminal-scope");
  view.terminalContent = document.createElement("div");
  view.terminalContent.className = "terminal-content";
  terminal.append(view.terminalToggle, view.terminalScope, view.terminalContent);

  shell.append(banner, topbar, mobileNavigation, body, terminal);
  updateDedicatedWorkstream(view, snapshot, options);
  return view;
}

function updateDedicatedWorkstream(view, snapshot, options) {
  view.options = options;
  view.element.style.setProperty("--workstream-color", workstreamColor(snapshot.id));
  view.title.textContent = snapshot.title;
  const active = snapshot.sessions.filter((session) => session.status === "active");
  view.identityMeta.textContent = `Revision ${String(snapshot.revision)} · ${String(active.length)} active session${active.length === 1 ? "" : "s"}`;
  view.connection.textContent = options.reconnecting ? "Reconnecting" : "Connected";
  view.connection.classList.toggle("reconnecting", options.reconnecting);

  view.banner.replaceChildren();
  if (options.reconnecting) view.banner.append(message("Reconnecting. The last recorded Workstream projection remains visible.", "connection"));
  if (options.error) view.banner.append(message(options.error, "checkpoint-error"));
  else if (options.notice) view.banner.append(message(options.notice, "receipt"));
  view.banner.hidden = view.banner.childElementCount === 0;

  for (const [tool, control] of view.toolButtons) control.setAttribute("aria-pressed", String(options.tool === tool));
  const mobileLabels = {
    sessions: `Sessions · ${String(active.length)}`,
    workspace: "Workspace",
    tasks: `Human Tasks · ${String(snapshot.humanTasks.length)}`,
  };
  for (const [pane, control] of view.mobileButtons) {
    control.textContent = mobileLabels[pane];
    control.setAttribute("aria-pressed", String(options.mobilePane === pane));
  }

  view.body.className = `workstream-body mobile-${options.mobilePane}${options.sessionsPaneOpen ? "" : " sessions-collapsed"}${options.tasksPaneOpen ? "" : " tasks-collapsed"}`;
  updateEdgeButton(view.sessionsEdge, "Sessions", options.sessionsPaneOpen, "left", active.length);
  updateEdgeButton(view.tasksEdge, "Human Tasks", options.tasksPaneOpen, "right", snapshot.humanTasks.length);

  view.sessionsList.replaceChildren();
  if (snapshot.sessions.length === 0) view.sessionsList.append(message("No sessions yet. Start one from an explicitly selected PI WEB checkout.", "empty-pane"));
  for (const session of snapshot.sessions) {
    const row = button("", () => { options.onSelectSession(session); });
    row.className = `dedicated-session${session.id === options.selectedSessionId ? " selected" : ""}`;
    row.setAttribute("aria-pressed", String(session.id === options.selectedSessionId));
    row.disabled = session.status !== "active";
    const copy = document.createElement("span");
    const purpose = session.purpose ?? session.latestCheckpoint?.next ?? `${humanize(session.status)} session`;
    copy.append(strong(purpose), message(`${sessionAnchor(session)} · ${humanize(session.status)}`, "session-anchor"), message(`Session ${session.id}`, "diagnostic"));
    if (session.checkpointFailure !== null) copy.append(message(session.checkpointFailure, "checkpoint-error inline-error"));
    row.append(copy);
    view.sessionsList.append(row);
  }

  const selected = snapshot.sessions.find((session) => session.id === options.selectedSessionId);
  const layout = dedicatedWorkstreamLayout(options);
  const toolName = surfaceLabel(layout.surface);
  view.toolName.textContent = toolName;
  const scope = layout.scope === "selected-session-checkout-observed-unattributed"
    ? "Selected checkout · current observed changes, unattributed"
    : "Selected session checkout";
  view.scope.textContent = `${scope}${selected === undefined ? "" : ` · ${sessionAnchor(selected)}`}`;
  view.checkpointActions.replaceChildren();
  if (selected?.status === "active" && !snapshot.closed) {
    view.checkpointActions.append(
      button("Resume", () => { options.onResume(selected); }),
      button("Ask Pi", () => { options.onRequestCheckpoint(selected); }),
      button("Confirm checkpoint", () => { options.onSaveCheckpoint(selected); }),
    );
  }

  const surfacesAvailable = options.context?.surfaceHost !== undefined;
  view.workspaceEmpty.hidden = selected !== undefined && surfacesAvailable;
  view.workspaceEmpty.textContent = selected === undefined
    ? `Select an active session to open ${toolName}.`
    : "Update PI WEB to use host-owned Chat, Files, Git, and Terminal surfaces.";
  view.surfaceStack.hidden = selected === undefined || !surfacesAvailable;
  for (const [surface, container] of view.surfaces) setSurfaceVisibility(container, selected !== undefined && surface === options.tool);

  view.tasksTitle.textContent = `Human Tasks · ${String(snapshot.humanTasks.length)}`;
  view.tasksList.replaceChildren();
  if (snapshot.humanTasks.length === 0) view.tasksList.append(message("Nothing needs your attention right now.", "empty-pane"));
  for (const task of snapshot.humanTasks) {
    const row = document.createElement("div");
    row.className = "dedicated-task";
    const copy = document.createElement("div");
    copy.append(strong(task.title));
    if (task.detail) copy.append(message(task.detail, "muted"));
    copy.append(message(task.sourceSessionId ? `From session ${task.sourceSessionId}` : "Source session not recorded", "task-source"));
    row.append(copy);
    if (!snapshot.closed) row.append(button("Resolve", () => { options.onResolveTask(task); }));
    view.tasksList.append(row);
  }

  view.terminal.classList.toggle("open", options.terminalOpen);
  view.terminalToggle.textContent = options.terminalOpen ? "Hide Terminal ↓" : "Terminal ↑";
  view.terminalToggle.setAttribute("aria-expanded", String(options.terminalOpen));
  view.terminalScope.textContent = selected === undefined ? "Select a session checkout before opening Terminal." : `Selected session checkout · ${sessionAnchor(selected)}`;
  view.terminalScope.hidden = !options.terminalOpen;
  view.terminalContent.hidden = !options.terminalOpen || selected === undefined;
  if (options.terminalOpen && selected !== undefined && view.terminalSurface === undefined) {
    view.terminalSurface = mountedHostSurface(options.context, "terminal");
    view.terminalContent.append(view.terminalSurface);
  }
}

function setSurfaceVisibility(container, visible) {
  container.hidden = !visible;
  container.inert = !visible;
  container.setAttribute("aria-hidden", String(!visible));
}

function mountedHostSurface(context, surface) {
  const container = document.createElement("div");
  container.className = `host-surface ${surface}-surface`;
  try {
    context?.surfaceHost?.mount(container, surface);
  } catch (error) {
    container.append(message(`Could not open ${surface}: ${errorMessage(error)}`, "checkpoint-error"));
  }
  return container;
}

function edgeButton(name, open, side, onToggle) {
  const edge = document.createElement("div");
  edge.className = "pane-edge";
  const control = iconButton("", "", onToggle);
  const edgeIcon = document.createElement("span");
  edgeIcon.className = "edge-icon";
  const railLabel = document.createElement("span");
  railLabel.className = "rail-label";
  control.append(edgeIcon, railLabel);
  edge.append(control);
  updateEdgeButton(edge, name, open, side, 0);
  return edge;
}

function updateEdgeButton(edge, name, open, side, count) {
  const control = edge.querySelector("button");
  if (control === null) return;
  const labelText = `${open ? "Collapse" : "Expand"} ${name} pane`;
  control.title = labelText;
  control.setAttribute("aria-label", labelText);
  control.setAttribute("aria-expanded", String(open));
  control.setAttribute("aria-controls", name === "Sessions" ? "workstream-sessions-pane" : "workstream-tasks-pane");
  const edgeIcon = control.querySelector(".edge-icon");
  if (edgeIcon !== null) edgeIcon.textContent = side === "left" ? (open ? "‹" : "›") : (open ? "›" : "‹");
  const railLabel = control.querySelector(".rail-label");
  if (railLabel !== null) railLabel.textContent = `${name} · ${String(count)}`;
  edge.classList.toggle("collapsed", !open);
}

function iconButton(text, labelText, onClick) {
  const control = button(text, onClick);
  control.className = "icon-button";
  control.title = labelText;
  control.setAttribute("aria-label", labelText);
  return control;
}

export function sessionAnchor(session) {
  const parts = [session.repository ?? session.projectId, session.checkout ?? session.workspaceId, session.machineId].filter((value) => typeof value === "string" && value !== "");
  return parts.length === 0 ? "Checkout anchor unavailable" : parts.join(" · ");
}

function surfaceLabel(surface) {
  return surface === "git" ? "Git" : `${surface[0].toUpperCase()}${surface.slice(1)}`;
}

function readLocalPreference(name, fallback, allowed) {
  try {
    const value = window.localStorage.getItem(`pi-workbench.workstreams.${name}`);
    return value !== null && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readLocalBoolean(name, fallback) {
  return readLocalPreference(name, String(fallback), ["true", "false"]) === "true";
}

function writeLocalPreference(name, value) {
  try {
    window.localStorage.setItem(`pi-workbench.workstreams.${name}`, value);
  } catch {
    // Browser-local presentation preferences are optional.
  }
}

function workstreamColor(id) {
  const palette = ["#c45d3e", "#3978b8", "#7b5ca8", "#33806a", "#ad6b18", "#a44f74"];
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function workstreamState(title, detail) {
  const state = document.createElement("section");
  state.className = "workstream-state";
  state.setAttribute("role", "status");
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
    main.dedicated-workstream { width: 100%; height: 100%; min-height: 0; margin: 0; padding: 0; display: flex; overflow: hidden; }
    header, .workstream-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--pi-toolbar-gap, 8px); }
    [hidden] { display: none !important; }
    .workstream-shell { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--pi-bg); }
    .shell-banner { flex: 0 0 auto; display: grid; }
    .workstream-topbar { min-height: 52px; flex: 0 0 auto; align-items: center; padding: 0 var(--pi-panel-padding, 12px); border-bottom: 1px solid var(--pi-border); box-shadow: inset 0 3px var(--workstream-color); background: color-mix(in srgb, var(--workstream-color) 8%, var(--pi-bg)); }
    .workstream-identity { min-width: 0; display: flex; align-items: center; gap: var(--pi-toolbar-gap, 8px); }
    .workstream-identity > div { min-width: 0; display: grid; gap: 2px; }
    .workstream-identity .shell-title, .workstream-identity p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .workstream-identity .shell-title { margin: 0; color: var(--pi-text-bright); font-size: 14px; letter-spacing: 0; }
    .workstream-swatch { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 3px; background: var(--workstream-color); }
    .workstream-tools, .workstream-utilities, .mobile-pane-navigation, .checkpoint-actions { display: flex; align-items: center; gap: 3px; }
    .mobile-pane-navigation { display: none; }
    .workstream-tools button { background: transparent; color: var(--pi-muted); }
    .workstream-tools button[aria-pressed="true"] { background: var(--pi-selection-bg); color: var(--pi-text); font-weight: 700; }
    .scope-label { color: var(--pi-muted); font-size: 11px; }
    .workstream-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 280px 22px minmax(360px, 1fr) 22px 320px; overflow: hidden; }
    .workstream-body.sessions-collapsed { grid-template-columns: 0 42px minmax(360px, 1fr) 22px 320px; }
    .workstream-body.tasks-collapsed { grid-template-columns: 280px 22px minmax(360px, 1fr) 42px 0; }
    .workstream-body.sessions-collapsed.tasks-collapsed { grid-template-columns: 0 42px minmax(360px, 1fr) 42px 0; }
    .sessions-pane, .tasks-pane { min-width: 0; min-height: 0; overflow: auto; background: var(--pi-surface); }
    .sessions-pane { grid-column: 1; }
    .workspace-pane { grid-column: 3; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--pi-bg); }
    .tasks-pane { grid-column: 5; }
    .sessions-collapsed .sessions-pane, .tasks-collapsed .tasks-pane { visibility: hidden; overflow: hidden; }
    .pane-edge { min-width: 0; min-height: 0; display: grid; place-items: center; background: var(--pi-border-muted); }
    .sessions-pane + .pane-edge { grid-column: 2; }
    .workspace-pane + .pane-edge { grid-column: 4; }
    .pane-edge .icon-button { width: 22px; height: 52px; min-height: 52px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-bg); color: var(--pi-muted); }
    .pane-edge.collapsed .icon-button { width: 42px; height: 100%; min-height: 0; flex-direction: column; border: 0; border-radius: 0; background: var(--pi-surface); }
    .rail-label { display: none; writing-mode: vertical-rl; transform: rotate(180deg); color: var(--pi-text-secondary, var(--pi-muted)); font-size: 11px; font-weight: 650; white-space: nowrap; }
    .pane-edge.collapsed .rail-label { display: inline; }
    .pane-heading, .workspace-heading { min-height: 49px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--pi-border); }
    .pane-heading h2, .workspace-heading h2 { margin: 0; }
    .workspace-heading { flex: 0 0 auto; }
    .workspace-heading > div:first-child { min-width: 0; display: grid; gap: 3px; }
    .checkpoint-actions { flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
    .checkpoint-actions button { font-size: 11px; }
    .pane-list { min-height: 0; display: flex; flex-direction: column; }
    .dedicated-session { width: 100%; min-height: auto; display: block; border-radius: 0; background: transparent; padding: 10px 12px; text-align: left; }
    .dedicated-session > span { min-width: 0; display: grid; gap: 4px; }
    .dedicated-session.selected { background: var(--pi-selection-bg); }
    .session-anchor { color: var(--pi-text-secondary, var(--pi-text)); font-size: 12px; line-height: 1.35; }
    .diagnostic { color: var(--pi-muted); font-size: 10px; }
    .inline-error { padding: 6px; font-size: 11px; }
    .dedicated-task { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border-muted); }
    .dedicated-task > div { min-width: 0; display: grid; gap: 5px; }
    .task-source { color: var(--pi-muted); font-size: 11px; }
    .empty-pane { padding: 18px 12px; color: var(--pi-muted); }
    .surface-stack { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; overflow: hidden; }
    .host-surface { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; overflow: hidden; }
    .host-surface > * { flex: 1 1 auto; min-width: 0; min-height: 0; }
    .workspace-empty { flex: 1 1 auto; }
    .terminal-drawer { flex: 0 0 auto; display: grid; justify-items: center; border-top: 1px solid var(--pi-border); background: var(--pi-bg); }
    .terminal-drawer > button { min-width: 130px; min-height: 24px; padding-block: 2px; border-radius: 8px 8px 0 0; }
    .terminal-drawer.open { height: min(280px, 38vh); grid-template: auto auto minmax(0, 1fr) / minmax(0, 1fr); justify-items: stretch; }
    .terminal-drawer.open > button { justify-self: center; }
    .terminal-scope { padding: 4px 12px; color: var(--pi-muted); font-size: 11px; }
    .terminal-content { min-width: 0; min-height: 0; display: flex; overflow: hidden; }
    .terminal-drawer .host-surface { width: 100%; }
    .icon-button { flex: 0 0 auto; }
    header > div, .workstream-heading > div { min-width: 0; display: grid; gap: 5px; }
    .header-actions, .workstream-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--pi-toolbar-gap, 8px); }
    main:not(.dedicated-workstream) > header strong { font-size: clamp(22px, 3vw, 34px); letter-spacing: -.025em; }
    section { display: grid; gap: var(--pi-message-gap, 10px); }
    h2 { margin: 0 0 4px; color: var(--pi-text-bright); font-size: 13px; }
    .workstream { display: grid; gap: var(--pi-message-gap, 10px); padding: var(--pi-message-padding, 14px) 0; border-top: 1px solid var(--pi-border); }
    .workstream.closed { color: var(--pi-muted); }
    .portfolio-list { gap: 0; }
    .portfolio-row { grid-template-columns: 4px minmax(0, 1fr) auto; gap: 16px; padding: 18px 0; }
    .portfolio-marker { width: 4px; min-height: 100%; border-radius: 4px; background: var(--workstream-color); }
    .portfolio-content { min-width: 0; display: grid; gap: 12px; }
    .portfolio-continuation { display: grid; gap: 4px; }
    .portfolio-continuation > strong { color: var(--pi-text-bright); font-size: 16px; line-height: 1.35; }
    .portfolio-attention { display: grid; gap: 3px; padding: 9px 10px; background: var(--pi-warning-surface); color: var(--pi-warning); }
    .portfolio-sessions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 8px 18px; }
    .portfolio-session { min-width: 0; display: grid; gap: 3px; }
    .portfolio-row > .workstream-actions { align-self: center; max-width: 180px; flex-wrap: wrap; }
    .portfolio-intro { max-width: 65ch; }
    .closed-history { border-top: 1px solid var(--pi-border); padding-top: 12px; }
    .closed-history summary { color: var(--pi-muted); cursor: pointer; font-weight: 650; }
    .workstream strong { overflow-wrap: anywhere; }
    .message { margin: 0; line-height: 1.45; overflow-wrap: anywhere; }
    .muted, .links { color: var(--pi-muted); font-size: 12px; }
    .eyebrow { color: var(--pi-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .sequence, .state, .task-count { flex: 0 0 auto; border-radius: 999px; background: var(--pi-surface); color: var(--pi-muted); padding: 3px 7px; font-size: 11px; white-space: nowrap; }
    .task-count { background: var(--pi-warning-surface); color: var(--pi-warning); }
    .next { color: var(--pi-text-bright); font-weight: 650; }
    .tasks { display: grid; gap: 8px; padding: var(--pi-message-padding, 12px); background: var(--pi-warning-surface); }
    .task-row { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
    .task-row > div { display: grid; gap: 3px; min-width: 0; }
    @media (max-width: 980px) {
      .workstream-body { grid-template-columns: 230px 22px minmax(320px, 1fr) 22px 250px; }
      .workstream-body.sessions-collapsed { grid-template-columns: 0 42px minmax(320px, 1fr) 22px 250px; }
      .workstream-body.tasks-collapsed { grid-template-columns: 230px 22px minmax(320px, 1fr) 42px 0; }
      .workstream-body.sessions-collapsed.tasks-collapsed { grid-template-columns: 0 42px minmax(320px, 1fr) 42px 0; }
    }
    @media (max-width: 720px) {
      .workstream-actions { flex-wrap: wrap; justify-content: flex-start; }
      .workstream-topbar { flex-wrap: wrap; align-content: center; padding-block: 6px; }
      .workstream-utilities > .scope-label { display: none; }
      .mobile-pane-navigation { display: flex; flex: 0 0 auto; justify-content: center; padding: 6px; border-bottom: 1px solid var(--pi-border); background: var(--pi-surface); }
      .mobile-pane-navigation button[aria-pressed="true"] { background: var(--pi-selection-bg); font-weight: 700; }
      .workstream-body, .workstream-body.sessions-collapsed, .workstream-body.tasks-collapsed, .workstream-body.sessions-collapsed.tasks-collapsed { grid-template-columns: minmax(0, 1fr); }
      .sessions-pane, .tasks-pane, .workspace-pane, .pane-edge { display: none; }
      .workstream-body.mobile-sessions .sessions-pane, .workstream-body.mobile-workspace .workspace-pane, .workstream-body.mobile-tasks .tasks-pane { display: flex; grid-column: 1; visibility: visible; }
      .workstream-body.mobile-sessions .sessions-pane, .workstream-body.mobile-tasks .tasks-pane { flex-direction: column; }
      .workspace-heading { align-items: flex-start; }
      .checkpoint-actions { max-width: 48%; }
    }
    .checkpoint-error, .connection { padding: var(--pi-message-padding, 12px); background: var(--pi-warning-surface); color: var(--pi-warning); }
    .connection { border-radius: 8px; }
    .receipt { padding: var(--pi-message-padding, 12px); border-radius: 8px; background: var(--pi-success-surface); color: var(--pi-success); }
    .closed-section { opacity: .78; }
    .workstream-state { width: min(100%, 520px); align-self: center; justify-self: center; padding: clamp(24px, 6vw, 64px); text-align: center; }
    .workstream-state h1 { margin: 0; color: var(--pi-text); font-size: 20px; }
    button { justify-self: center; min-height: var(--pi-control-min-size, 34px); border: 0; border-radius: 6px; background: var(--pi-selection-bg); color: var(--pi-text); padding: var(--pi-control-padding-block, 7px) var(--pi-control-padding-inline, 9px); cursor: pointer; }
    button:hover:not(:disabled) { background: var(--pi-surface-hover, var(--pi-selection-bg)); }
    button:disabled { cursor: not-allowed; opacity: .58; }
    button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    @media (max-width: 520px) { main { padding: var(--pi-panel-padding, 12px); } header { align-items: flex-start; } main:not(.dedicated-workstream) > header strong { font-size: 24px; } .sequence { display: none; } .portfolio-row { grid-template-columns: 4px minmax(0, 1fr); } .portfolio-row > .workstream-actions { grid-column: 2; max-width: none; justify-content: flex-start; } }
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

function keyedButton(text, focusKey, onClick) {
  const element = button(text, onClick);
  element.dataset.focusKey = focusKey;
  return element;
}

function settleFocus(element, focusKey) {
  element.focus({ preventScroll: true });
  window.requestAnimationFrame(() => {
    if (!element.isConnected || recordedWorkstreamState.focusKey !== focusKey) return;
    element.focus({ preventScroll: true });
    recordedWorkstreamState.focusKey = undefined;
  });
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
