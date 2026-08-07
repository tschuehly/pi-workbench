import { createWorkbenchWorkstreamClient, reconcileWorkstreams } from "./workstream-client.js";
import { WorkstreamSessionCoordinator } from "./workstream-session-coordinator.js";
import { projectWorkstreamBrief, selectWorkstreamSession } from "./workstream-brief-projection.js";
import { completeSessionKey, createUnifiedNavigationState, joinChatsAndWorkstreams, parseDestinationPreference, reduceUnifiedNavigation, serializeDestinationPreference } from "./unified-navigation-state.js";
import { attentionForWorkstreamSession, contextHostIdentityChanges, formatModifiedTime, NAVIGATOR_MAX_WIDTH, NAVIGATOR_MIN_WIDTH, NAVIGATOR_MODE_PREFERENCE, NAVIGATOR_WIDTH_PREFERENCE, navigatorFocusKey, navigatorKeyboardDelta, narrowOverlayKeyboardAction, normalizeSessionNavigationSnapshot, resizeNavigatorWidth, selectedDestinationFromIdentity, workstreamNavigatorItem } from "./unified-navigation-view-model.js";

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

export function checkpointProposalPrompt() {
  return "Propose a concise attended Workstream checkpoint with exactly five labeled parts: What changed, What remains, Next useful action, Next-session prompt, and References. Make the next-session prompt exact and paste-ready for a fresh attended Pi session; list only concrete paths or identifiers under References. Do not persist it; I will review and confirm it in the Workstreams view.";
}

export function normalizeDedicatedMobilePane(value) {
  return value === "sessions" ? "sessions" : "workspace";
}

export function dedicatedMobileControlState(state, control) {
  if (control === "context") {
    return { pressed: state.tasksPaneOpen === true, expanded: state.tasksPaneOpen === true, controls: "workstream-context-drawer" };
  }
  return { pressed: normalizeDedicatedMobilePane(state.mobilePane) === control };
}

export function transitionDedicatedWorkstreamUi(state, action) {
  switch (action.type) {
    case "select-surface":
      return action.surface === "terminal"
        ? { ...state, terminalOpen: true }
        : { ...state, tool: action.surface, mobilePane: "workspace" };
    case "select-mobile-pane": return { ...state, mobilePane: normalizeDedicatedMobilePane(action.pane) };
    case "toggle-sessions": return { ...state, sessionsPaneOpen: !state.sessionsPaneOpen };
    case "toggle-tasks": return { ...state, tasksPaneOpen: !state.tasksPaneOpen };
    case "toggle-terminal": return { ...state, terminalOpen: !state.terminalOpen };
    default: return state;
  }
}

export function recordedWorkstreamSelection(snapshots, workstreamId, rememberedSessionId) {
  const snapshot = snapshots.find((candidate) => candidate.id === workstreamId);
  if (snapshot === undefined) return undefined;
  return { snapshot, sessionId: selectWorkstreamSession(snapshot, rememberedSessionId)?.id };
}

export function sessionAnchorRepairOffer(snapshot, session, error, machine) {
  const machineId = isString(session?.machineId) ? session.machineId : machine?.id;
  if (error?.code !== "SESSION_ANCHOR_MISSING"
      || snapshot?.closed === true
      || session?.status !== "active"
      || completeSessionLocation(session)
      || !isString(machineId)) return undefined;
  const machineName = machine?.id === machineId && isString(machine.name) ? machine.name : machineId;
  return {
    status: "offered",
    sessionId: session.id,
    machine: { id: machineId, name: machineName },
    failureMessage: errorMessage(error),
  };
}

export function sessionAnchorRepairPresentation(state) {
  const machineName = state.machine.name === state.machine.id ? state.machine.id : `${state.machine.name} (${state.machine.id})`;
  if (state.status === "offered") return {
    title: "Session location is missing",
    guidance: `${state.failureMessage} Search every registered ${machineName} workspace by exact session identity before choosing a repair.`,
    candidates: [],
    confirmEnabled: false,
    retryEnabled: true,
  };
  if (state.status === "resolving" || state.status === "repairing") return {
    title: state.status === "resolving" ? "Scanning session locations" : "Repairing session location",
    guidance: state.status === "resolving" ? `Checking every registered ${machineName} workspace.` : "Rechecking the selected catalog evidence before saving the append-only repair.",
    candidates: [],
    confirmEnabled: false,
    retryEnabled: false,
  };
  if (state.status === "found") return {
    title: "Confirm session location",
    guidance: `PI WEB found one exact session match after scanning all registered ${machineName} workspaces. Confirm this checkout before repairing the Workstream.`,
    candidates: [presentRepairCandidate(state.result, true)],
    confirmEnabled: true,
    retryEnabled: false,
  };
  if (state.status === "ambiguous") return {
    title: "Choose the session location",
    guidance: `PI WEB found multiple exact matches on ${machineName}. Select one checkout explicitly, then confirm it.`,
    candidates: state.result.locations.map((candidate) => presentRepairCandidate(candidate, sameRepairCandidate(candidate, state.selected))),
    confirmEnabled: state.selected !== undefined,
    retryEnabled: false,
  };
  if (state.status === "missing") return {
    title: "Session was not found",
    guidance: `No exact session match exists in the registered ${machineName} workspaces. Check whether the session belongs to another machine or whether its workspace must be registered.`,
    candidates: [],
    confirmEnabled: false,
    retryEnabled: true,
  };
  if (state.status === "unavailable") return {
    title: "Session scan is unavailable",
    guidance: `${String(state.result.failedScopes.length)} registered ${machineName} ${state.result.failedScopes.length === 1 ? "scope could" : "scopes could"} not be checked. Restore access, then try the scan again; no missing result has been inferred.`,
    candidates: [],
    confirmEnabled: false,
    retryEnabled: true,
  };
  return {
    title: "Session location was not repaired",
    guidance: state.failureMessage ?? "The resolver result changed. Scan again before confirming.",
    candidates: [],
    confirmEnabled: false,
    retryEnabled: true,
  };
}

function presentRepairCandidate(candidate, selected) {
  return { key: repairCandidateKey(candidate), label: sessionAnchor(candidate.location), selected };
}

function repairCandidateKey(candidate) {
  const location = candidate.location;
  return `${location.machineId}\u0000${location.projectId}\u0000${location.workspaceId}`;
}

function sameRepairCandidate(left, right) {
  return right !== undefined && repairCandidateKey(left) === repairCandidateKey(right) && left.evidence.evidenceId === right.evidence.evidenceId;
}

function completeSessionLocation(value) {
  return [value?.machineId, value?.projectId, value?.workspaceId].every(isString);
}

export async function selectWorkstreamSessionLocation(context, session, requireSessionNavigation = false) {
  const location = { sessionId: session.id, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId };
  if (!completeSessionLocation(session)) {
    if (typeof context?.sessions?.select !== "function") {
      throw Object.assign(new Error(`Session ${session.id} has no recorded machine, project, and workspace location.`), { code: "SESSION_ANCHOR_MISSING" });
    }
    await context.sessions.select(location);
    throw Object.assign(new Error(`Session ${session.id} opened, but its canonical Workstream location is still missing.`), { code: "SESSION_ANCHOR_MISSING" });
  }
  if (typeof context?.sessionNavigation?.select === "function") await context.sessionNavigation.select(location);
  else if (!requireSessionNavigation && typeof context?.sessions?.select === "function") await context.sessions.select(location);
  else throw new Error("This PI WEB version cannot preserve the Workstream shell while selecting a session.");
  return location;
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
            badge: (context) => {
              const liveAsks = context.attention?.snapshot?.().items.length ?? 0;
              const durableTasks = recordedWorkstreamState.status === "ready"
                ? recordedWorkstreamState.snapshots.flatMap((snapshot) => snapshot.humanTasks).filter((task) => task.status === "pending").length
                : 0;
              return liveAsks + durableTasks || undefined;
            },
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
            layout: "dedicated",
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
    #attentionRelease;
    #attentionHost;
    #sessionNavigationRelease;
    #sessionNavigationHost;
    #contextHostsBound = false;
    #attentionItems = [];
    #nativeNavigation = normalizeSessionNavigationSnapshot(undefined);
    #unifiedState = createUnifiedNavigationState();
    #selectionToken = 0;
    #destinationRestorePending = true;
    #selectedChat;
    #anchorRepair;
    #navigationRefreshError;
    #main;
    #dedicatedView;
    #chatView;

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      root.append(workstreamsStyleElement());
      this.#main = document.createElement("main");
      root.append(this.#main);
    }

    set context(value) {
      this.#context = value;
      this.#bindContextHosts(value);
      this.#restoreNavigationPreference();
      void loadRecordedWorkstreams(value).finally(() => { this.#reconcileUnifiedState(); this.#render(); });
      this.#render();
    }

    #bindContextHosts(value) {
      const changes = contextHostIdentityChanges({ attention: this.#attentionHost, sessionNavigation: this.#sessionNavigationHost }, value);
      const attentionChanged = changes.attention;
      if (attentionChanged || !this.#contextHostsBound) {
        this.#attentionRelease?.();
        this.#attentionHost = value.attention;
        this.#attentionItems = [...(value.attention?.snapshot?.()?.items ?? [])];
        this.#attentionRelease = value.attention?.watch?.((snapshot) => {
          this.#attentionItems = [...snapshot.items];
          this.#render();
        });
      }
      const navigationChanged = changes.sessionNavigation;
      if (!navigationChanged && this.#contextHostsBound) return;
      this.#sessionNavigationRelease?.();
      this.#sessionNavigationHost = value.sessionNavigation;
      this.#nativeNavigation = normalizeSessionNavigationSnapshot(value.sessionNavigation?.snapshot?.());
      this.#sessionNavigationRelease = value.sessionNavigation?.watch?.((snapshot) => {
        this.#nativeNavigation = normalizeSessionNavigationSnapshot(snapshot);
        this.#reconcileUnifiedState();
        this.#render();
      });
      if (navigationChanged) this.#destinationRestorePending = true;
      this.#contextHostsBound = true;
    }

    connectedCallback() {
      connectedWorkstreamsElement = this;
      if (this.#context !== undefined) {
        this.#bindContextHosts(this.#context);
        void loadRecordedWorkstreams(this.#context).finally(() => { this.#reconcileUnifiedState(); this.#render(); });
      }
      this.#scheduleWatch();
      this.#render();
    }

    disconnectedCallback() {
      if (this.#watchTimer !== undefined) window.clearTimeout(this.#watchTimer);
      this.#watchTimer = undefined;
      if (connectedWorkstreamsElement === this) connectedWorkstreamsElement = undefined;
      this.#releaseSurfaceSelection();
      this.#attentionRelease?.();
      this.#attentionRelease = undefined;
      this.#sessionNavigationRelease?.();
      this.#sessionNavigationRelease = undefined;
      this.#contextHostsBound = false;
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
      const focusTarget = surface === "terminal"
        ? this.#dedicatedView?.terminalToggle
        : this.#selectedChat === undefined ? this.#dedicatedView?.toolButtons.get(surface) : this.#chatView?.toolButtons.get(surface);
      focusTarget?.focus({ preventScroll: true });
      if (surface !== "terminal" && ["chat", "files", "git"].includes(surface)) {
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "select-surface", surface });
      }
      this.#transition({ type: "select-surface", surface });
    }

    #selectedSurface(fallback = "chat") {
      const destination = this.#unifiedState.destination;
      const key = destination.type === "chat" ? destination.sessionKey
        : destination.type === "workstream-session" ? completeSessionKey({ ...destination.location, sessionId: destination.sessionId }) : undefined;
      return key === undefined ? fallback : this.#unifiedState.surfaceBySession[key] ?? fallback;
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
        this.#writePreference("tool", next.tool);
        this.#writePreference("mobile-pane", next.mobilePane);
      } else if (action.type === "select-mobile-pane") {
        this.#writePreference("mobile-pane", next.mobilePane);
        if (next.mobilePane === "sessions") window.requestAnimationFrame(() => { this.#dedicatedView?.sessionsList?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true }); });
      }
      else if (action.type === "toggle-sessions") {
        const mode = next.sessionsPaneOpen ? "expanded" : "collapsed";
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "set-navigation", mode, width: this.#unifiedState.navigation.width });
        this.#writePreference(NAVIGATOR_MODE_PREFERENCE, mode);
        this.#writePreference("sessions-open", String(next.sessionsPaneOpen));
      } else if (action.type === "toggle-tasks") this.#writePreference("drawer-open", String(next.tasksPaneOpen));
      else if (action.type === "toggle-terminal" && this.#unifiedState.destination.type === "workstream-session") {
        const remembered = this.#unifiedState.terminalBySession[completeSessionKey({ ...this.#unifiedState.destination.location, sessionId: this.#unifiedState.destination.sessionId })];
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "set-terminal", open: next.terminalOpen, height: remembered?.height });
      }
      this.#render();
    }

    #scheduleWatch() {
      if (!this.isConnected || this.#watchTimer !== undefined) return;
      this.#watchTimer = window.setTimeout(() => {
        this.#watchTimer = undefined;
        const context = this.#context;
        if (context !== undefined && context.connection?.status !== "reconnecting") {
          void loadRecordedWorkstreams(context, true).finally(() => { this.#reconcileUnifiedState(); this.#render(); this.#scheduleWatch(); });
        } else {
          this.#scheduleWatch();
        }
      }, 2_000);
    }

    #retry() {
      recordedWorkstreamState.status = "idle";
      recordedWorkstreamState.error = "";
      recordedWorkstreamState.promise = undefined;
      if (this.#context !== undefined) void loadRecordedWorkstreams(this.#context).finally(() => { this.#reconcileUnifiedState(); this.#render(); });
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
      this.#reconcileUnifiedState();
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

    #applyWorkstreamSelection(snapshot) {
      this.#selectedWorkstreamId = snapshot.id;
      const rememberedSessionId = this.#readPreference(`selected-session:${snapshot.id}`);
      this.#selectedSessionId = recordedWorkstreamSelection([snapshot], snapshot.id, rememberedSessionId)?.sessionId;
      this.#tool = this.#readPreference("tool", "chat", ["chat", "files", "git"]);
      this.#sessionsPaneOpen = this.#readBoolean("sessions-open", true);
      this.#tasksPaneOpen = this.#readBoolean("drawer-open", snapshot.humanTasks.some((task) => task.status === "pending"));
      this.#mobilePane = normalizeDedicatedMobilePane(this.#readPreference("mobile-pane", "workspace", ["sessions", "workspace"]));
    }

    #openWorkstream(snapshot) {
      recordedWorkstreamState.focusKey = "dedicated:title";
      this.#anchorRepair = undefined;
      this.#selectedChat = undefined;
      this.#chatView = undefined;
      recordedWorkstreamState.selectedWorkstreamId = snapshot.id;
      this.#writePreference("selected-workstream", snapshot.id);
      this.#applyWorkstreamSelection(snapshot);
      this.#selectedSessionId = undefined;
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "select-workstream", workstreamId: snapshot.id });
      this.#writeDestinationPreference();
      this.#context?.host?.requestRender();
      this.#render();
      this.#restoreFocusAfterHostRender("dedicated:title");
    }

    #returnToPortfolio() {
      recordedWorkstreamState.focusKey = this.#selectedChat === undefined
        ? navigatorFocusKey({ type: "workstream", workstreamId: this.#selectedWorkstreamId })
        : navigatorFocusKey({ type: "chat", sessionKey: completeSessionKey(this.#selectedChat) });
      this.#selectedWorkstreamId = undefined;
      this.#selectedChat = undefined;
      recordedWorkstreamState.selectedWorkstreamId = undefined;
      this.#writePreference("selected-workstream", "");
      this.#selectedSessionId = undefined;
      this.#anchorRepair = undefined;
      this.#terminalOpen = false;
      this.#dedicatedView = undefined;
      this.#chatView = undefined;
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "select-root" });
      this.#writeDestinationPreference();
      this.#releaseSurfaceSelection();
      this.#context?.host?.requestRender();
      this.#render();
      this.#restoreFocusAfterHostRender(recordedWorkstreamState.focusKey);
    }

    async #selectSession(session, requestedWorkstreamId = this.#selectedWorkstreamId, requireSessionNavigation = false) {
      if (session.status !== "active") return;
      const workstreamId = requestedWorkstreamId;
      if (workstreamId === undefined) return;
      const location = { sessionId: session.id, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId };
      if (!completeSessionLocation(session)) {
        this.#anchorRepair = undefined;
        this.#render();
        try {
          await selectWorkstreamSessionLocation(this.#context, session, requireSessionNavigation);
        } catch (error) {
          const failure = typedSelectionError(error);
          if (this.#recordSessionFailure(session, failure, workstreamId) === undefined) recordedWorkstreamState.error = selectionFailureMessage(failure);
        }
        this.#render();
        return;
      }
      const destination = { type: "workstream-session", workstreamId, sessionId: session.id, location };
      const token = ++this.#selectionToken;
      this.#anchorRepair = undefined;
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-requested", token, destination });
      this.#render();
      try {
        await selectWorkstreamSessionLocation(this.#context, session, requireSessionNavigation);
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-succeeded", token });
        if (this.#unifiedState.destination !== destination) return;
        const snapshot = recordedWorkstreamState.snapshots.find((candidate) => candidate.id === workstreamId);
        if (snapshot !== undefined && this.#selectedWorkstreamId !== workstreamId) this.#applyWorkstreamSelection(snapshot);
        this.#selectedWorkstreamId = workstreamId;
        recordedWorkstreamState.selectedWorkstreamId = workstreamId;
        this.#selectedChat = undefined;
        this.#chatView = undefined;
        this.#selectedSessionId = session.id;
        if (this.#anchorRepair?.sessionId !== session.id) this.#anchorRepair = undefined;
        this.#writePreference(`selected-session:${workstreamId}`, completeSessionKey(location));
        this.#writeDestinationPreference();
        this.#tool = this.#selectedSurface(this.#tool);
        const terminal = this.#unifiedState.terminalBySession[completeSessionKey(location)];
        this.#terminalOpen = terminal?.open === true;
        this.#mobilePane = "workspace";
        window.requestAnimationFrame(() => { this.#dedicatedView?.surfaces.get("chat")?.focus({ preventScroll: true }); });
      } catch (error) {
        if (this.#unifiedState.pendingSelection?.token !== token) return;
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-failed", token, error: typedSelectionError(error) });
        this.#recordSessionFailure(session, error, workstreamId);
      }
      this.#render();
    }

    async #selectChat(chat) {
      const location = { sessionId: chat.sessionId, machineId: chat.machineId, projectId: chat.projectId, workspaceId: chat.workspaceId };
      const destination = { type: "chat", sessionKey: completeSessionKey(chat), location };
      const token = ++this.#selectionToken;
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-requested", token, destination });
      this.#render();
      try {
        if (typeof this.#context?.sessionNavigation?.select !== "function") throw new Error("Native Chat navigation is unavailable in this PI WEB version.");
        await this.#context.sessionNavigation.select(location);
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-succeeded", token });
        if (this.#unifiedState.destination !== destination) return;
        this.#selectedWorkstreamId = undefined;
        recordedWorkstreamState.selectedWorkstreamId = undefined;
        this.#selectedSessionId = undefined;
        this.#dedicatedView = undefined;
        this.#selectedChat = chat;
        this.#chatView = undefined;
        this.#tool = this.#selectedSurface("chat");
        this.#writeDestinationPreference();
        window.requestAnimationFrame(() => { this.#chatView?.surfaces.get(this.#selectedSurface("chat"))?.focus({ preventScroll: true }); });
      } catch (error) {
        if (this.#unifiedState.pendingSelection?.token !== token) return;
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-failed", token, error: typedSelectionError(error) });
      }
      this.#render();
    }

    #recordSessionFailure(session, error, workstreamId = this.#selectedWorkstreamId) {
      const snapshot = recordedWorkstreamState.snapshots.find((candidate) => candidate.id === workstreamId);
      const offer = sessionAnchorRepairOffer(snapshot, session, error, this.#context?.machine);
      this.#anchorRepair = offer;
      return offer;
    }

    #resolveSessionAnchor(session) {
      const machine = this.#anchorRepair?.machine;
      if (machine === undefined) return;
      const resolving = { status: "resolving", sessionId: session.id, machine };
      this.#anchorRepair = resolving;
      this.#render();
      void this.#coordinator().resolveSessionAnchor(session, machine.id)
        .then((result) => {
          if (this.#anchorRepair !== resolving) return;
          this.#anchorRepair = {
            status: result.status,
            sessionId: session.id,
            machine,
            result,
            ...(result.status === "found" ? { selected: result } : {}),
          };
        })
        .catch((error) => {
          if (this.#anchorRepair === resolving) this.#anchorRepair = { status: "error", sessionId: session.id, machine, failureMessage: errorMessage(error) };
        })
        .finally(() => { this.#render(); });
    }

    #selectAnchorRepairCandidate(candidate) {
      if (this.#anchorRepair?.status !== "ambiguous") return;
      this.#anchorRepair = { ...this.#anchorRepair, selected: candidate };
      this.#render();
    }

    #confirmSessionAnchor(snapshot, session) {
      const repair = this.#anchorRepair;
      const selected = repair?.status === "found" ? repair.result : repair?.status === "ambiguous" ? repair.selected : undefined;
      if (selected === undefined) return;
      const repairing = { ...repair, status: "repairing" };
      this.#anchorRepair = repairing;
      this.#render();
      void this.#coordinator().repairSessionAnchor(snapshot, session, selected)
        .then(async (receipt) => {
          recordedWorkstreamState.notice = `Repaired session ${session.id} at revision ${String(receipt.acceptedRevision)}.`;
          recordedWorkstreamState.error = "";
          if (this.#anchorRepair === repairing) this.#anchorRepair = undefined;
          await loadRecordedWorkstreams(this.#context, true);
          this.#reconcileUnifiedState();
        })
        .catch((error) => {
          if (this.#anchorRepair === repairing) this.#anchorRepair = { status: "error", sessionId: session.id, machine: repair.machine, failureMessage: errorMessage(error) };
        })
        .finally(() => { this.#render(); });
    }

    #start(snapshot) {
      void this.#mutate(async () => {
        const session = await this.#coordinator().launch(snapshot);
        recordedWorkstreamState.notice = `Started session ${session.id}.`;
        return { acceptedRevision: (await workstreamClient.inspect(snapshot.id)).revision, sequence: recordedWorkstreamState.sequence };
      });
    }

    #resume(session) {
      recordedWorkstreamState.error = "";
      void Promise.resolve().then(() => this.#coordinator().resume(session)).catch((error) => {
        if (this.#recordSessionFailure(session, error) === undefined) recordedWorkstreamState.error = errorMessage(error);
        this.#render();
      });
    }

    #requestCheckpoint(session) {
      if (this.#context?.sessions === undefined) { recordedWorkstreamState.error = "Attended session controls are unavailable."; this.#render(); return; }
      const location = { sessionId: session.id, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId };
      void this.#context.sessions.prompt(location, checkpointProposalPrompt())
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
      const nextSessionPromptInput = window.prompt("Exact prompt to paste into the next attended session (maximum 2,000 characters)", prior?.nextSessionPrompt ?? "");
      if (nextSessionPromptInput === null) return;
      const nextSessionPrompt = nextSessionPromptInput.trim();
      if (nextSessionPrompt === "" || nextSessionPrompt.length > 2_000) {
        recordedWorkstreamState.error = "The next-session prompt must contain 1 to 2,000 characters.";
        this.#render();
        return;
      }
      const referencesInput = window.prompt("References (optional; one path or identifier per line)", prior?.references?.join("\n") ?? "");
      if (referencesInput === null) return;
      const references = referencesInput.split("\n").map((value) => value.trim()).filter(Boolean);
      if (!window.confirm(`Save this checkpoint?\n\nChanged: ${whatChanged}\n\nRemains: ${remains}\n\nNext: ${next}\n\nNext-session prompt: ${nextSessionPrompt}\n\nReferences: ${references.join(", ") || "None"}`)) return;
      void this.#mutate(async (client) => {
        try {
          return await client.append({
            workstreamId: snapshot.id,
            expectedRevision: snapshot.revision,
            idempotencyKey: newId("checkpoint"),
            records: [{ type: "checkpoint.replaced", producer: "owner", sourceSessionId: session.id, payload: { sessionId: session.id, checkpoint: { id: newId("cp"), whatChanged: whatChanged.trim(), remains: remains.trim(), next: next.trim(), nextSessionPrompt, ...(references.length === 0 ? {} : { references }) } } }],
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
      const kindInput = window.prompt("Answer type: yes-no, choice, free-text, or none", "yes-no")?.trim().toLowerCase();
      if (kindInput === undefined) return;
      let typed = {};
      if (["yes-no", "choice", "free-text"].includes(kindInput)) {
        let options = [];
        if (kindInput === "yes-no") options = [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "change", label: "Change" }];
        else if (kindInput === "choice") {
          const labels = window.prompt("Choice labels, separated by commas")?.split(",").map((value) => value.trim()).filter(Boolean);
          if (!labels?.length) return;
          options = labels.map((value, index) => ({ id: `option-${String(index + 1)}`, label: value }));
        }
        const materiality = window.confirm("Is this answer material to the Workstream continuation?") ? "material" : "non-material";
        typed = { answerKind: kindInput, options, materiality };
      } else if (kindInput !== "none") {
        recordedWorkstreamState.error = "Answer type must be yes-no, choice, free-text, or none.";
        this.#render();
        return;
      }
      const sourceSessionId = this.#selectedSessionId;
      void this.#mutate((client) => client.append({ workstreamId: snapshot.id, expectedRevision: snapshot.revision, idempotencyKey: newId("task"), records: [{ type: "human-task.upsert", producer: "owner", ...(sourceSessionId === undefined ? {} : { sourceSessionId }), payload: { task: { id: newId("task"), title: title.trim(), ...(detail?.trim() ? { detail: detail.trim() } : {}), ...typed } } }] }));
    }

    #answerTask(snapshot, task, answer) {
      void this.#mutate((client) => client.append({
        workstreamId: snapshot.id,
        expectedRevision: snapshot.revision,
        idempotencyKey: newId("task-answer"),
        records: [{ type: "human-task.answered", producer: "owner", sourceSessionId: task.sourceSessionId ?? undefined, payload: { taskId: task.id, answerId: newId("answer"), answer } }],
      }));
    }

    #resolveTask(snapshot, task) {
      void this.#mutate((client) => client.append({ workstreamId: snapshot.id, expectedRevision: snapshot.revision, idempotencyKey: newId("task-resolved"), records: [{ type: "human-task.resolved", producer: "owner", payload: { taskId: task.id } }] }));
    }

    #focusAttention(item) {
      void this.#context?.attention?.focus?.(item).catch((error) => {
        recordedWorkstreamState.error = errorMessage(error);
        this.#render();
      });
    }

    async #refreshChats() {
      this.#navigationRefreshError = undefined;
      this.#render();
      try {
        if (typeof this.#context?.sessionNavigation?.refresh !== "function") throw new Error("Chat inventory refresh is unavailable in this PI WEB version.");
        await this.#context.sessionNavigation.refresh();
      } catch (error) {
        this.#navigationRefreshError = typedSelectionError(error);
      }
      this.#render();
    }

    #retrySelection() {
      const destination = this.#unifiedState.selectionError?.destination;
      const joined = this.#joinedNavigation();
      if (destination?.type === "chat") {
        const chat = joined.chats.find((candidate) => completeSessionKey(candidate) === destination.sessionKey);
        if (chat !== undefined) void this.#selectChat(chat);
        else void this.#refreshChats();
      } else if (destination?.type === "workstream-session") {
        const workstream = joined.workstreams.find((candidate) => candidate.id === destination.workstreamId);
        const session = workstream?.sessions.find((candidate) => candidate.id === destination.sessionId);
        if (session !== undefined) void this.#selectSession(session, destination.workstreamId);
        else void this.#refreshChats();
      }
    }

    #joinedNavigation() {
      return joinChatsAndWorkstreams(this.#nativeNavigation, {
        available: recordedWorkstreamState.status !== "error",
        complete: recordedWorkstreamState.status === "ready",
        reconnecting: this.#context?.connection?.status === "reconnecting",
        snapshots: recordedWorkstreamState.snapshots,
      });
    }

    #reconcileUnifiedState() {
      const joined = this.#joinedNavigation();
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "inventories-reconciled", joined });
      void this.#restoreDestinationPreference(joined);
      if (joined.status === "ready" && !this.#destinationRestorePending) this.#syncSelectionFromDestination(joined);
    }

    #syncSelectionFromDestination(joined) {
      const destination = this.#unifiedState.destination;
      if (destination.type === "chat") {
        this.#selectedChat = joined.chats.find((chat) => completeSessionKey(chat) === destination.sessionKey);
        this.#selectedWorkstreamId = undefined;
        this.#selectedSessionId = undefined;
        this.#dedicatedView = undefined;
      } else if (destination.type === "workstream" || destination.type === "workstream-session") {
        this.#selectedChat = undefined;
        this.#chatView = undefined;
        this.#selectedWorkstreamId = destination.workstreamId;
        this.#selectedSessionId = destination.type === "workstream-session" ? destination.sessionId : undefined;
      } else {
        this.#selectedChat = undefined;
        this.#selectedWorkstreamId = undefined;
        this.#selectedSessionId = undefined;
        this.#dedicatedView = undefined;
        this.#chatView = undefined;
      }
    }

    async #restoreDestinationPreference(joined) {
      if (!this.#destinationRestorePending || (joined.status !== "ready" && this.#sessionNavigationHost !== undefined)) return;
      this.#destinationRestorePending = false;
      const stored = this.#readPreference("unified-navigation.destination", "");
      const legacyWorkstreamId = this.#sessionNavigationHost === undefined ? this.#readPreference("selected-workstream", "") : "";
      const destination = stored === ""
        ? joined.status === "ready" ? selectedDestinationFromIdentity(joined, this.#nativeNavigation.selectedIdentity) ?? parseDestinationPreference(stored)
          : joined.workstreams.some((candidate) => candidate.id === legacyWorkstreamId)
            ? { type: "workstream", workstreamId: legacyWorkstreamId }
            : parseDestinationPreference(stored)
        : parseDestinationPreference(stored);
      if (destination.type === "chat") {
        const chat = joined.chats.find((candidate) => completeSessionKey(candidate) === destination.sessionKey);
        if (chat !== undefined) await this.#selectChat(chat);
        return;
      }
      if (destination.type === "workstream-session") {
        const snapshot = joined.workstreams.find((candidate) => candidate.id === destination.workstreamId);
        const session = snapshot?.sessions.find((candidate) => candidate.id === destination.sessionId);
        if (joined.status === "ready" && session?.status === "active" && completeSessionLocation(session)) {
          await this.#selectSession(session, destination.workstreamId, true);
          return;
        }
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "restore", destination, joined });
        this.#syncSelectionFromDestination(joined);
        if (snapshot !== undefined) {
          this.#applyWorkstreamSelection(snapshot);
          this.#selectedSessionId = undefined;
          recordedWorkstreamState.selectedWorkstreamId = snapshot.id;
        }
        this.#render();
        return;
      }
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "restore", destination, joined });
      this.#syncSelectionFromDestination(joined);
      if (destination.type === "workstream") {
        const snapshot = joined.workstreams.find((candidate) => candidate.id === destination.workstreamId);
        if (snapshot !== undefined) {
          this.#applyWorkstreamSelection(snapshot);
          recordedWorkstreamState.selectedWorkstreamId = snapshot.id;
        }
      }
      this.#tool = this.#selectedSurface(this.#tool);
      this.#render();
    }

    #writeDestinationPreference() {
      this.#writePreference("unified-navigation.destination", serializeDestinationPreference(this.#unifiedState.destination));
    }

    #restoreNavigationPreference() {
      const mode = this.#readPreference(NAVIGATOR_MODE_PREFERENCE, "expanded", ["expanded", "collapsed"]);
      const width = Number(this.#readPreference(NAVIGATOR_WIDTH_PREFERENCE, "320"));
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "set-navigation", mode, width });
      this.#sessionsPaneOpen = mode === "expanded";
    }

    #setNavigatorWidth(width) {
      const boundedWidth = resizeNavigatorWidth(width, 0);
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "set-navigation", mode: "expanded", width: boundedWidth });
      this.#writePreference(NAVIGATOR_WIDTH_PREFERENCE, String(boundedWidth));
      this.#render();
    }

    #readPreference(name, fallback, allowed) {
      const hosted = this.#context?.preferences?.get?.(name);
      if (hosted !== undefined) return allowed === undefined || allowed.includes(hosted) ? hosted : fallback;
      return readLocalPreference(name, fallback, allowed);
    }

    #readBoolean(name, fallback) {
      return this.#readPreference(name, String(fallback), ["true", "false"]) === "true";
    }

    #writePreference(name, value) {
      if (this.#context?.preferences?.set !== undefined) this.#context.preferences.set(name, value);
      else writeLocalPreference(name, value);
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
      this.#syncSurfaceSelection(selected !== undefined || this.#selectedChat !== undefined);

      if (this.#selectedChat !== undefined && this.#unifiedState.destination.type === "chat") {
        const chatOptions = {
          context, chat: this.#selectedChat, error: this.#unifiedState.selectionError,
          refreshError: this.#navigationRefreshError,
          reconnecting: context?.connection?.status === "reconnecting" || this.#joinedNavigation().status === "reconnecting",
          joined: this.#joinedNavigation(), machine: this.#nativeNavigation.machine ?? context?.machine,
          attentionItems: this.#attentionItems, navigation: this.#unifiedState.navigation,
          destination: this.#unifiedState.destination, surface: this.#selectedSurface("chat"),
          pending: this.#unifiedState.pendingSelection !== undefined,
          onBack: () => { this.#returnToPortfolio(); },
          onOpenChat: (chat) => { void this.#selectChat(chat); },
          onOpenWorkstream: (snapshot) => { this.#openWorkstream(snapshot); },
          onCreate: () => { this.#create(); },
          onFocusAttention: (item) => { this.#focusAttention(item); },
          onRetrySelection: () => { this.#retrySelection(); },
          onRefresh: typeof context?.sessionNavigation?.refresh === "function" ? () => { void this.#refreshChats(); } : undefined,
          onSelectSurface: (surface) => { this.#selectSurface(surface); },
          onToggleMode: () => { this.#transition({ type: "toggle-sessions" }); },
          onNavigatorResize: (width) => { this.#setNavigatorWidth(width); },
        };
        if (this.#chatView?.sessionKey !== this.#unifiedState.destination.sessionKey || this.#chatView.surfaceHost !== context?.surfaceHost) {
          this.#chatView = createUnifiedChatDestination(chatOptions);
          main.replaceChildren(this.#chatView.element);
        }
        main.className = "dedicated-workstream";
        updateUnifiedChatDestination(this.#chatView, chatOptions);
        return;
      }

      if (selected !== undefined && recordedWorkstreamState.status === "ready") {
        const options = {
          context,
          selectedSessionId: this.#selectedSessionId,
          tool: this.#selectedSurface(this.#tool),
          sessionsPaneOpen: this.#sessionsPaneOpen,
          tasksPaneOpen: this.#tasksPaneOpen,
          terminalOpen: this.#unifiedState.destination.type === "workstream-session"
            ? this.#unifiedState.terminalBySession[completeSessionKey({ ...this.#unifiedState.destination.location, sessionId: this.#unifiedState.destination.sessionId })]?.open === true
            : false,
          mobilePane: this.#mobilePane,
          reconnecting: context?.connection?.status === "reconnecting",
          joined: this.#joinedNavigation(),
          error: recordedWorkstreamState.error,
          notice: recordedWorkstreamState.notice,
          onBack: () => { this.#returnToPortfolio(); },
          onOpenBrief: () => {
            this.#selectedSessionId = undefined;
            this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "select-workstream", workstreamId: selected.id });
            this.#writeDestinationPreference();
            this.#render();
            window.requestAnimationFrame(() => { this.#dedicatedView?.title?.focus({ preventScroll: true }); });
          },
          onSelectSession: (session) => { void this.#selectSession(session); },
          onSelectTool: (tool) => { this.#selectSurface(tool); },
          onSelectMobilePane: (pane) => { this.#transition({ type: "select-mobile-pane", pane }); },
          navigatorWidth: this.#unifiedState.navigation.width,
          selectionPending: this.#unifiedState.pendingSelection !== undefined,
          selectionError: this.#unifiedState.selectionError,
          refreshError: this.#navigationRefreshError,
          onRetrySelection: () => { this.#retrySelection(); },
          onRefresh: typeof context?.sessionNavigation?.refresh === "function" ? () => { void this.#refreshChats(); } : undefined,
          onNavigatorResize: (width) => { this.#setNavigatorWidth(width); },
          onToggleSessions: () => { this.#transition({ type: "toggle-sessions" }); },
          onToggleTasks: () => { this.#transition({ type: "toggle-tasks" }); },
          onToggleTerminal: () => {
            if (!this.#terminalOpen) this.#context?.surfaceHost?.activate?.("terminal");
            this.#transition({ type: "toggle-terminal" });
          },
          onStart: () => { this.#start(selected); },
          onResume: (session) => { this.#resume(session); },
          anchorRepair: this.#anchorRepair,
          onResolveSessionAnchor: (session) => { this.#resolveSessionAnchor(session); },
          onSelectAnchorRepairCandidate: (candidate) => { this.#selectAnchorRepairCandidate(candidate); },
          onConfirmSessionAnchor: (session) => { this.#confirmSessionAnchor(selected, session); },
          onRequestCheckpoint: (session) => { this.#requestCheckpoint(session); },
          onSaveCheckpoint: (session) => { this.#saveCheckpoint(selected, session); },
          attentionItems: this.#attentionItems,
          onFocusAttention: (item) => { this.#focusAttention(item); },
          onAnswerTask: (task, answer) => { this.#answerTask(selected, task, answer); },
          onResolveTask: (task) => { this.#resolveTask(selected, task); },
          onAddTask: () => { this.#addTask(selected); },
          onAppendLink: () => { this.#appendLink(selected); },
          onClose: () => { this.#close(selected); },
        };
        if (this.#dedicatedView?.workstreamId !== selected.id || this.#dedicatedView.surfaceHost !== context?.surfaceHost) {
          this.#dedicatedView = createDedicatedWorkstream(selected, options);
          main.replaceChildren(this.#dedicatedView.element);
        }
        main.className = "dedicated-workstream";
        updateDedicatedWorkstream(this.#dedicatedView, selected, options);
        if (recordedWorkstreamState.focusKey === "dedicated:title") settleFocus(this.#dedicatedView.title, "dedicated:title");
        return;
      }

      this.#dedicatedView = undefined;
      this.#chatView = undefined;
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
      } else {
        if (recordedWorkstreamState.error !== "") main.append(message(recordedWorkstreamState.error, "checkpoint-error"));
        if (recordedWorkstreamState.notice !== "") main.append(message(recordedWorkstreamState.notice, "receipt"));
        if (this.#unifiedState.selectionError !== undefined) main.append(renderSelectionRecovery(this.#unifiedState.selectionError, {
          onRetrySelection: () => { this.#retrySelection(); },
          onRefresh: typeof context?.sessionNavigation?.refresh === "function" ? () => { void this.#refreshChats(); } : undefined,
        }));
        if (this.#navigationRefreshError !== undefined) main.append(message(selectionFailureMessage(this.#navigationRefreshError), "checkpoint-error"));
        main.append(renderUnifiedNavigator({
          joined: this.#joinedNavigation(),
          machine: this.#nativeNavigation.machine ?? context?.machine,
          attentionItems: this.#attentionItems,
          navigation: this.#unifiedState.navigation,
          destination: this.#unifiedState.destination,
          pending: this.#unifiedState.pendingSelection !== undefined,
          onCreate: () => { this.#create(); },
          onFocusAttention: (item) => { this.#focusAttention(item); },
          onOpenChat: (chat) => { void this.#selectChat(chat); },
          onOpenWorkstream: (snapshot) => { this.#openWorkstream(snapshot); },
          onRefresh: typeof context?.sessionNavigation?.refresh === "function" ? () => { void this.#refreshChats(); } : undefined,
          onToggleMode: () => { this.#transition({ type: "toggle-sessions" }); },
        }));
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

function renderUnifiedNavigator(options) {
  const { joined, machine, navigation } = options;
  const fragment = document.createDocumentFragment();
  const header = document.createElement("header");
  header.className = "portfolio-header unified-header";
  const heading = document.createElement("div");
  const title = document.createElement("h1");
  title.textContent = "Chats + Workstreams";
  heading.append(title, message("Move between machine-scoped Chats and canonical Workstreams.", "portfolio-intro"));
  const actions = document.createElement("div");
  actions.className = "header-actions";
  const mode = button(navigation.mode === "collapsed" ? "Expand navigator" : "Collapse navigator", options.onToggleMode);
  mode.setAttribute("aria-expanded", String(navigation.mode !== "collapsed"));
  mode.setAttribute("aria-controls", "unified-navigation-hierarchy");
  const create = button("New Workstream", options.onCreate);
  create.classList.add("primary-action");
  actions.append(mode, create);
  header.append(heading, actions);
  fragment.append(header);

  fragment.append(renderUnifiedHierarchy(options));
  return fragment;
}

function renderUnifiedHierarchy(options) {
  const { joined, machine, navigation } = options;
  const root = document.createElement("div");
  root.id = "unified-navigation-hierarchy";
  root.className = `unified-root-navigation ${navigation.mode}`;
  const inventoryNotice = unifiedInventoryNotice(joined, options.onRefresh);
  if (inventoryNotice !== undefined) root.append(inventoryNotice);
  const chats = section(`Chats · ${machine?.name ?? machine?.id ?? "selected machine"}`,
    joined.status === "ready" && joined.chats.length === 0 ? "No unmatched Chats on this machine." : undefined);
  chats.classList.add("unified-list", "chat-list");
  if (joined.status === "ready") {
    for (const chat of joined.chats) chats.append(chatNavigatorRow(chat, options));
  } else if (joined.retainedNativeSessions.length > 0) {
    chats.append(message(`${String(joined.retainedNativeSessions.length)} native session${joined.retainedNativeSessions.length === 1 ? " is" : "s are"} retained, but cannot be classified as Chats until reconciliation completes.`, "muted"));
  } else chats.append(message(joined.status === "unavailable" ? "Chat classification is unavailable." : "Chats have not loaded yet.", "muted"));
  const workstreams = section("Workstreams", joined.workstreams.length === 0 ? "No Workstreams yet." : undefined);
  workstreams.classList.add("unified-list", "workstream-list");
  for (const snapshot of joined.workstreams) workstreams.append(workstreamNavigatorRow(snapshot, options));
  root.append(chats, workstreams);
  return root;
}

function chatNavigatorRow(chat, options) {
  const row = document.createElement("div");
  row.className = "unified-navigation-entry";
  const sessionKey = completeSessionKey(chat);
  const control = keyedButton("", navigatorFocusKey({ type: "chat", sessionKey }), () => { options.onOpenChat(chat); });
  control.className = `unified-navigation-row chat-navigation-row${options.stale ? " stale" : ""}`;
  control.disabled = options.pending || options.stale === true;
  if (options.destination?.type === "chat" && options.destination.sessionKey === sessionKey) control.setAttribute("aria-current", "page");
  const attention = options.attentionItems.find((item) => item.machineId === chat.machineId && item.sessionId === chat.sessionId);
  const copy = document.createElement("span");
  copy.append(strong(chat.title), message(chat.summary || sessionAnchor(chat), "muted"), message(`${sessionAnchor(chat)} · ${formatModifiedTime(chat.modifiedAt)}`, "session-anchor"));
  const state = message(options.stale ? "Stale · unavailable" : chat.archived ? "Archived" : "Chat", "navigation-state");
  control.append(copy, state);
  control.setAttribute("aria-label", `${chat.title}. ${sessionAnchor(chat)}. ${attention === undefined ? state.textContent : "Needs answer"}.`);
  row.append(control);
  if (attention !== undefined && options.stale !== true) {
    const focus = button("Focus pending ask", () => { options.onFocusAttention(attention); });
    focus.className = "attention-navigation-action";
    focus.setAttribute("aria-label", `Focus pending ask in ${chat.title}`);
    row.append(focus);
  }
  return row;
}

function workstreamNavigatorRow(snapshot, options) {
  const item = workstreamNavigatorItem(snapshot);
  const control = keyedButton("", navigatorFocusKey({ type: "workstream", workstreamId: snapshot.id }), () => { options.onOpenWorkstream(snapshot); });
  control.className = "unified-navigation-row workstream-navigation-row";
  if ((options.destination?.type === "workstream" || options.destination?.type === "workstream-session") && options.destination.workstreamId === snapshot.id) control.setAttribute("aria-current", "page");
  const copy = document.createElement("span");
  const continuation = item.continuation.next ?? (item.sessionCount === 0 ? "No sessions yet." : "Confirmed continuation unavailable.");
  copy.append(strong(item.title), message(continuation, "muted"), message(`Revision ${String(item.revision)} · ${String(item.sessionCount)} sessions · ${humanize(item.health)} checkpoint`, "session-anchor"));
  const status = message(item.closed ? "Closed" : item.unresolvedTasks === 0 ? "Current" : `${String(item.unresolvedTasks)} need you`, item.unresolvedTasks === 0 ? "navigation-state" : "attention-action navigation-state");
  control.append(copy, status);
  control.setAttribute("aria-label", `${item.title}. ${status.textContent}. ${humanize(item.health)} checkpoint. ${continuation}`);
  return control;
}

function unifiedInventoryNotice(joined, onRefresh) {
  if (joined.status === "ready") return undefined;
  const detail = joined.status === "unavailable"
    ? "Chat inventory is unavailable. Retained native sessions remain unclassified; canonical Workstreams remain available."
    : joined.status === "invalid" ? `${joined.reason ?? "Chat inventory is invalid."} Retained native sessions remain unclassified; canonical Workstreams remain available.`
      : joined.status === "reconnecting" ? "Reconnecting Chat inventory. Retained native sessions remain unclassified until reconciliation completes."
        : "Loading and reconciling Chat inventory with canonical Workstream associations.";
  const notice = document.createElement("div");
  notice.className = "connection unified-inventory-state";
  notice.append(message(detail));
  if ((joined.status === "unavailable" || joined.status === "reconnecting") && onRefresh !== undefined) notice.append(button("Refresh Chats", onRefresh));
  return notice;
}

function createUnifiedChatDestination(options) {
  const view = { sessionKey: completeSessionKey(options.chat), surfaceHost: options.context?.surfaceHost, surfaces: new Map(), overlayOpen: false };
  const shell = document.createElement("section");
  shell.className = "workstream-shell unified-chat-shell";
  const header = document.createElement("header");
  header.className = "workstream-topbar";
  const identity = document.createElement("div");
  identity.className = "workstream-identity";
  view.closeOverlay = () => {
    view.overlayOpen = false;
    view.navigation.hidden = true;
    view.navigation.setAttribute("role", "navigation");
    view.navigation.removeAttribute("aria-modal");
    if (view.scrim !== undefined) view.scrim.hidden = true;
    view.navigate.setAttribute("aria-expanded", "false");
  };
  view.navigate = button("Navigate", () => {
    if (!matchMedia("(max-width: 720px)").matches) return;
    view.overlayOpen = true;
    view.navigation.hidden = false;
    view.navigation.setAttribute("role", "dialog");
    view.navigation.setAttribute("aria-modal", "true");
    view.scrim.hidden = false;
    view.navigate.setAttribute("aria-expanded", "true");
    view.overlayClose.focus({ preventScroll: true });
  });
  view.navigate.className = "narrow-navigate";
  view.navigate.setAttribute("aria-expanded", "false");
  view.navigate.setAttribute("aria-controls", "unified-destination-navigator");
  identity.append(iconButton("←", "Back to Chats and Workstreams", options.onBack), view.navigate);
  const copy = document.createElement("div");
  view.title = document.createElement("h1");
  view.title.className = "shell-title";
  view.title.tabIndex = -1;
  view.scope = message("", "scope-label");
  copy.append(view.title, view.scope);
  identity.append(copy);
  view.tools = document.createElement("nav");
  view.tools.className = "workstream-tools";
  view.tools.setAttribute("aria-label", "Chat checkout surfaces");
  view.navigatorToggle = button("Collapse navigator", () => { view.options.onToggleMode(); });
  view.navigatorToggle.setAttribute("aria-controls", "unified-destination-navigator");
  view.tools.append(view.navigatorToggle);
  view.toolButtons = new Map();
  for (const [surface, labelText] of [["chat", "Chat"], ["files", "Files"], ["git", "Git"]]) {
    const control = button(labelText, () => { view.options.onSelectSurface(surface); });
    view.toolButtons.set(surface, control);
    view.tools.append(control);
  }
  header.append(identity, view.tools);
  view.banner = document.createElement("div");
  view.banner.className = "shell-banner";
  view.navigation = document.createElement("aside");
  view.navigation.id = "unified-destination-navigator";
  view.navigation.className = "unified-destination-navigation";
  view.navigation.setAttribute("aria-label", "Navigate Chats and Workstreams");
  view.overlayClose = button("Close navigator", () => {
    view.closeOverlay();
    view.navigate.focus({ preventScroll: true });
  });
  view.overlayClose.className = "overlay-close";
  view.separator = document.createElement("div");
  view.separator.className = "unified-navigation-separator";
  configureResizeSeparator(view.separator, "Resize Chats and Workstreams navigator", () => view.options.navigation.width, (width) => { view.options.onNavigatorResize(width); });
  view.content = document.createElement("div");
  view.content.className = "unified-chat-content";
  for (const surface of ["chat", "files", "git"]) {
    const container = mountedHostSurface(options.context, surface);
    container.classList.add("unified-chat-surface");
    view.surfaces.set(surface, container);
    view.content.append(container);
  }
  view.scrim = button("Close navigator", () => {
    view.closeOverlay();
    view.navigate.focus({ preventScroll: true });
  });
  view.scrim.className = "overlay-scrim";
  view.body = document.createElement("div");
  view.body.className = "unified-destination-body";
  view.body.append(view.navigation, view.scrim, view.separator, view.content);
  view.navigation.addEventListener("keydown", (event) => {
    const active = view.element.getRootNode().activeElement;
    const action = narrowOverlayKeyboardAction({ narrow: matchMedia("(max-width: 720px)").matches, open: view.overlayOpen, focusInside: view.navigation.contains(active), key: event.key });
    if (action === "close") {
      event.preventDefault();
      view.closeOverlay();
      view.navigate.focus({ preventScroll: true });
      return;
    }
    if (action !== "cycle") return;
    const controls = [...view.navigation.querySelectorAll("button:not(:disabled)")];
    if (controls.length === 0) return;
    const current = controls.indexOf(active);
    const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current === controls.length - 1 ? 0 : current + 1);
    event.preventDefault();
    controls[next].focus({ preventScroll: true });
  });
  shell.append(view.banner, header, view.body);
  view.element = shell;
  view.options = options;
  return view;
}

function updateUnifiedChatDestination(view, options) {
  view.options = options;
  view.element.style.setProperty("--navigator-width", `${String(options.navigation.width)}px`);
  view.title.textContent = options.chat.title;
  view.scope.textContent = `Chat · ${sessionAnchor(options.chat)}`;
  view.banner.replaceChildren();
  if (options.reconnecting) view.banner.append(message("Reconnecting. This Chat remains visible, but its inventory may be stale.", "connection"));
  else if (options.joined.status === "unavailable") view.banner.append(message("Chat inventory is unavailable. This selected native session may be stale.", "connection"));
  if (options.error !== undefined) view.banner.append(renderSelectionRecovery(options.error, options));
  if (options.refreshError !== undefined) view.banner.append(message(selectionFailureMessage(options.refreshError), "checkpoint-error"));
  view.banner.hidden = view.banner.childElementCount === 0;
  const focusedKey = view.element.getRootNode().activeElement?.dataset?.focusKey;
  view.navigation.replaceChildren(view.overlayClose, renderUnifiedHierarchy(options));
  if (focusedKey !== undefined) [...view.navigation.querySelectorAll("[data-focus-key]")].find((control) => control.dataset.focusKey === focusedKey)?.focus({ preventScroll: true });
  const narrow = matchMedia("(max-width: 720px)").matches;
  if (!narrow) view.overlayOpen = false;
  view.navigation.hidden = narrow && !view.overlayOpen;
  view.navigation.setAttribute("role", narrow && view.overlayOpen ? "dialog" : "navigation");
  if (narrow && view.overlayOpen) view.navigation.setAttribute("aria-modal", "true");
  else view.navigation.removeAttribute("aria-modal");
  view.navigate.setAttribute("aria-expanded", String(narrow && view.overlayOpen));
  view.scrim.hidden = !narrow || !view.overlayOpen;
  view.navigatorToggle.textContent = options.navigation.mode === "collapsed" ? "Expand navigator" : "Collapse navigator";
  view.navigatorToggle.setAttribute("aria-expanded", String(options.navigation.mode !== "collapsed"));
  view.body.className = `unified-destination-body ${options.navigation.mode}`;
  view.separator.hidden = options.navigation.mode === "collapsed";
  view.separator.setAttribute("aria-valuenow", String(options.navigation.width));
  view.separator.setAttribute("aria-valuetext", `${String(options.navigation.width)} pixels`);
  for (const [surface, control] of view.toolButtons) {
    const active = surface === options.surface;
    control.setAttribute("aria-pressed", String(active));
    if (active) control.setAttribute("aria-current", "page");
    else control.removeAttribute("aria-current");
  }
  for (const [surface, container] of view.surfaces) setSurfaceVisibility(container, surface === options.surface);
}

function selectionFailureMessage(error) {
  const code = error?.code === undefined ? "SESSION_SELECTION_FAILED" : String(error.code);
  const detail = error?.message === undefined ? "The selected location could not be opened." : String(error.message);
  return `${detail} (${code}). The previous destination remains open.`;
}

function renderSelectionRecovery(error, options) {
  const recovery = document.createElement("div");
  recovery.className = "checkpoint-error selection-recovery";
  recovery.append(message(selectionFailureMessage(error)));
  const actions = document.createElement("div");
  actions.className = "recovery-actions";
  actions.append(button("Retry open", options.onRetrySelection));
  if (options.onRefresh !== undefined) actions.append(button("Refresh Chats", options.onRefresh));
  recovery.append(actions);
  return recovery;
}

function typedSelectionError(error) {
  return { code: typeof error?.code === "string" ? error.code : "SESSION_SELECTION_FAILED", message: errorMessage(error) };
}

function createDedicatedWorkstream(snapshot, options) {
  const view = { workstreamId: snapshot.id, surfaceHost: options.context?.surfaceHost, options, surfaces: new Map() };
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
  title.className = "identity-brief-control";
  title.setAttribute("role", "link");
  title.tabIndex = 0;
  title.addEventListener("click", () => { view.options.onOpenBrief(); });
  title.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    view.options.onOpenBrief();
  });
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
  view.drawerToggle = button("Workstream context", () => { view.options.onToggleTasks(); });
  utilities.append(view.drawerToggle);
  if (typeof options.context?.host?.openActions === "function") utilities.append(button("Actions", () => { view.options.context.host.openActions(); }));
  topbar.append(identity, tools, utilities);

  view.sessionTabs = document.createElement("nav");
  view.sessionTabs.className = "session-tabs";
  view.sessionTabs.setAttribute("aria-label", "Workstream session tabs");

  const mobileNavigation = document.createElement("nav");
  mobileNavigation.className = "mobile-pane-navigation";
  mobileNavigation.setAttribute("aria-label", "Workstream destinations");
  view.mobileButtons = new Map();
  for (const destination of ["sessions", "workspace", "context"]) {
    const control = button("", () => { destination === "context" ? view.options.onToggleTasks() : view.options.onSelectMobilePane(destination); });
    view.mobileButtons.set(destination, control);
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
  view.sessionsCollapse = button("Collapse navigator", () => { view.options.onToggleSessions(); });
  view.sessionsCollapse.setAttribute("aria-controls", "workstream-sessions-pane");
  view.sessionsClose = button("Close navigator", () => {
    view.options.onSelectMobilePane("workspace");
    view.mobileButtons.get("sessions")?.focus({ preventScroll: true });
  });
  view.sessionsClose.className = "overlay-close";
  const sessionActions = document.createElement("div");
  sessionActions.className = "pane-heading-actions";
  sessionActions.append(view.sessionsClose, view.sessionsCollapse, button("New session", () => { view.options.onStart(); }));
  sessionsHeading.append(sessionsTitle, sessionActions);
  view.navigationNotice = document.createElement("div");
  view.navigationNotice.className = "navigator-inventory-notice";
  view.sessionsList = document.createElement("div");
  view.sessionsList.className = "pane-list";
  sessions.append(sessionsHeading, view.navigationNotice, view.sessionsList);

  view.sessionsEdge = document.createElement("div");
  view.sessionsEdge.className = "pane-edge";
  configureResizeSeparator(view.sessionsEdge, "Resize Workstream navigator", () => view.options.navigatorWidth, (width) => { view.options.onNavigatorResize(width); });

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

  const tasks = document.createElement("section");
  tasks.className = "workstream-drawer";
  tasks.id = "workstream-context-drawer";
  tasks.setAttribute("aria-labelledby", "workstream-tasks-heading");
  const tasksHeading = document.createElement("div");
  tasksHeading.className = "pane-heading";
  view.tasksTitle = document.createElement("h2");
  view.tasksTitle.id = "workstream-tasks-heading";
  view.contextActions = document.createElement("div");
  view.contextActions.className = "context-actions";
  tasksHeading.append(view.tasksTitle, view.contextActions);
  view.tasksList = document.createElement("div");
  view.tasksList.className = "pane-list";
  tasks.append(tasksHeading, view.tasksList);
  view.scrim = button("Close navigator", () => {
    view.options.onSelectMobilePane("workspace");
    view.mobileButtons.get("sessions")?.focus({ preventScroll: true });
  });
  view.scrim.className = "overlay-scrim";
  body.append(sessions, view.scrim, view.sessionsEdge, workspace);

  const terminal = document.createElement("section");
  terminal.className = "terminal-drawer";
  view.terminal = terminal;
  view.terminalToggle = button("", () => { view.options.onToggleTerminal(); });
  view.terminalToggle.title = "Terminal for selected session checkout";
  view.terminalScope = message("", "terminal-scope");
  view.terminalContent = document.createElement("div");
  view.terminalContent.className = "terminal-content";
  terminal.append(view.terminalToggle, view.terminalScope, view.terminalContent);

  sessions.addEventListener("keydown", (event) => {
    const active = view.element.getRootNode().activeElement;
    if (!matchMedia("(max-width: 720px)").matches || view.options.mobilePane !== "sessions" || !sessions.contains(active)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      view.options.onSelectMobilePane("workspace");
      view.mobileButtons.get("sessions")?.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...sessions.querySelectorAll("button:not(:disabled)")];
    if (controls.length === 0) return;
    const current = controls.indexOf(view.element.getRootNode().activeElement);
    const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current === controls.length - 1 ? 0 : current + 1);
    event.preventDefault();
    controls[next].focus({ preventScroll: true });
  });
  shell.append(banner, topbar, view.sessionTabs, tasks, mobileNavigation, body, terminal);
  updateDedicatedWorkstream(view, snapshot, options);
  return view;
}

function updateDedicatedWorkstream(view, snapshot, options) {
  view.options = options;
  view.element.style.setProperty("--workstream-color", workstreamColor(snapshot.id));
  view.element.style.setProperty("--navigator-width", `${String(options.navigatorWidth)}px`);
  view.title.textContent = snapshot.title;
  const active = snapshot.sessions.filter((session) => session.status === "active");
  view.identityMeta.textContent = `Revision ${String(snapshot.revision)} · ${String(active.length)} active session${active.length === 1 ? "" : "s"}`;
  view.connection.textContent = options.reconnecting ? "Reconnecting" : "Connected";
  view.connection.classList.toggle("reconnecting", options.reconnecting);

  view.banner.replaceChildren();
  if (options.reconnecting) view.banner.append(message("Reconnecting. The last recorded Workstream projection remains visible.", "connection"));
  if (options.selectionError !== undefined) view.banner.append(renderSelectionRecovery(options.selectionError, options));
  if (options.refreshError !== undefined) view.banner.append(message(selectionFailureMessage(options.refreshError), "checkpoint-error"));
  else if (options.error) view.banner.append(message(options.error, "checkpoint-error"));
  else if (options.notice) view.banner.append(message(options.notice, "receipt"));
  const repairSession = snapshot.sessions.find((session) => session.id === options.anchorRepair?.sessionId);
  if (!snapshot.closed && repairSession?.status === "active" && !completeSessionLocation(repairSession)) {
    view.banner.append(renderSessionAnchorRepair(options.anchorRepair, repairSession, options));
  }
  view.banner.hidden = view.banner.childElementCount === 0;

  for (const [tool, control] of view.toolButtons) {
    const selectedTool = options.selectedSessionId !== undefined && options.tool === tool;
    control.setAttribute("aria-pressed", String(selectedTool));
    if (selectedTool) control.setAttribute("aria-current", "page");
    else control.removeAttribute("aria-current");
  }
  const mobileLabels = {
    sessions: `Navigate · ${String(active.length)}`,
    workspace: "Workspace",
    context: `Context · ${String(snapshot.humanTasks.filter((task) => task.status === "pending").length)}`,
  };
  for (const [destination, control] of view.mobileButtons) {
    const controlState = dedicatedMobileControlState(options, destination);
    control.textContent = mobileLabels[destination];
    control.setAttribute("aria-pressed", String(controlState.pressed));
    if (controlState.expanded === undefined) {
      control.removeAttribute("aria-expanded");
      control.removeAttribute("aria-controls");
    } else {
      control.setAttribute("aria-expanded", String(controlState.expanded));
      control.setAttribute("aria-controls", controlState.controls);
    }
  }

  const narrowNavigatorOpen = matchMedia("(max-width: 720px)").matches && options.mobilePane === "sessions";
  view.body.className = `workstream-body mobile-${options.mobilePane}${options.sessionsPaneOpen ? "" : " sessions-collapsed"}`;
  view.scrim.hidden = !narrowNavigatorOpen;
  view.sessionsPane = view.sessionsPane ?? view.element.querySelector(".sessions-pane");
  view.sessionsPane.setAttribute("role", narrowNavigatorOpen ? "dialog" : "navigation");
  if (narrowNavigatorOpen) view.sessionsPane.setAttribute("aria-modal", "true");
  else view.sessionsPane.removeAttribute("aria-modal");
  view.sessionsCollapse.setAttribute("aria-expanded", String(options.sessionsPaneOpen));
  view.sessionsEdge.hidden = !options.sessionsPaneOpen;
  view.sessionsEdge.setAttribute("aria-valuenow", String(options.navigatorWidth));
  view.sessionsEdge.setAttribute("aria-valuetext", `${String(options.navigatorWidth)} pixels`);
  view.drawerToggle.setAttribute("aria-expanded", String(options.tasksPaneOpen));
  view.drawerToggle.setAttribute("aria-controls", "workstream-context-drawer");
  view.drawerToggle.textContent = options.tasksPaneOpen ? "Hide context" : `Workstream context · ${String(snapshot.humanTasks.filter((task) => task.status === "pending").length)}`;
  view.tasksList.parentElement.hidden = !options.tasksPaneOpen;

  view.sessionTabs.hidden = options.sessionsPaneOpen;
  view.sessionTabs.replaceChildren();
  view.sessionTabs.append(button("Expand navigator", () => { options.onToggleSessions(); }));
  const briefTab = button("Brief", () => { options.onOpenBrief(); });
  briefTab.setAttribute("aria-pressed", String(!options.sessionsPaneOpen && options.selectedSessionId === undefined));
  if (options.selectedSessionId === undefined) briefTab.setAttribute("aria-current", "page");
  view.sessionTabs.append(briefTab);
  for (const session of snapshot.sessions) {
    const attention = attentionForWorkstreamSession(options.attentionItems, session);
    const entry = document.createElement("span");
    entry.className = "collapsed-session-entry";
    const tabLabel = `${session.purpose ?? session.latestCheckpoint?.next ?? `${humanize(session.status)} session`}${attention === undefined ? "" : " · Needs answer"}`;
    const tab = button(tabLabel, () => { options.onSelectSession(session); });
    tab.disabled = session.status !== "active";
    tab.setAttribute("aria-pressed", String(session.id === options.selectedSessionId));
    if (session.id === options.selectedSessionId) tab.setAttribute("aria-current", "page");
    tab.title = `${sessionAnchor(session)} · Session ${session.id}${attention === undefined ? "" : " · Needs answer"}`;
    entry.append(tab);
    if (attention !== undefined && session.status === "active") {
      const focus = button("Focus pending ask", () => { options.onFocusAttention(attention); });
      focus.className = "attention-navigation-action";
      focus.setAttribute("aria-label", `Focus pending ask in session ${session.id}`);
      entry.append(focus);
    }
    view.sessionTabs.append(entry);
  }
  if (!snapshot.closed) view.sessionTabs.append(button("New session +", () => { options.onStart(); }));

  const focusedSessionKey = view.element.getRootNode().activeElement?.dataset?.focusKey;
  view.navigationNotice.replaceChildren();
  const inventoryNotice = unifiedInventoryNotice(options.joined, options.onRefresh);
  if (inventoryNotice !== undefined) view.navigationNotice.append(inventoryNotice);
  view.navigationNotice.hidden = inventoryNotice === undefined;
  view.sessionsList.replaceChildren();
  if (snapshot.sessions.length === 0) view.sessionsList.append(message("No sessions yet. Start one from an explicitly selected PI WEB checkout.", "empty-pane"));
  for (const session of snapshot.sessions) {
    const attention = attentionForWorkstreamSession(options.attentionItems, session);
    const entry = document.createElement("div");
    entry.className = "dedicated-session-entry";
    const row = keyedButton("", `session:${snapshot.id}:${session.id}`, () => { options.onSelectSession(session); });
    row.className = `dedicated-session${session.id === options.selectedSessionId ? " selected" : ""}`;
    row.setAttribute("aria-pressed", String(session.id === options.selectedSessionId));
    if (session.id === options.selectedSessionId) row.setAttribute("aria-current", "page");
    row.disabled = session.status !== "active" || options.selectionPending;
    const copy = document.createElement("span");
    const purpose = session.purpose ?? session.latestCheckpoint?.next ?? `${humanize(session.status)} session`;
    copy.append(strong(purpose), message(`${sessionAnchor(session)} · ${humanize(session.status)}`, "session-anchor"), message(`Session ${session.id}`, "diagnostic"));
    if (session.launchFailure !== null) copy.append(message(`Launch failed: ${session.launchFailure.reason}`, "checkpoint-error inline-error"));
    if (session.checkpointFailure !== null) copy.append(message(session.checkpointFailure, "checkpoint-error inline-error"));
    if (session.checkpointStaleness !== null) copy.append(message(`Checkpoint stale: ${session.checkpointStaleness.reason}`, "checkpoint-error inline-error"));
    row.append(copy);
    entry.append(row);
    if (attention !== undefined) {
      const focus = button("Focus pending ask", () => { options.onFocusAttention(attention); });
      focus.className = "attention-navigation-action";
      entry.append(focus);
    }
    view.sessionsList.append(entry);
  }
  if (focusedSessionKey !== undefined) [...view.sessionsList.querySelectorAll("[data-focus-key]")].find((control) => control.dataset.focusKey === focusedSessionKey)?.focus({ preventScroll: true });

  const selected = snapshot.sessions.find((session) => session.id === options.selectedSessionId);
  const layout = dedicatedWorkstreamLayout(options);
  const toolName = selected === undefined ? "Workstream brief" : surfaceLabel(layout.surface);
  view.toolName.textContent = toolName;
  const scope = selected === undefined ? `Canonical Workstream · revision ${String(snapshot.revision)}` : layout.scope === "selected-session-checkout-observed-unattributed"
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
  const brief = projectWorkstreamBrief(snapshot, options.context?.preferences?.get?.(`selected-session:${snapshot.id}`));
  view.workspaceEmpty.textContent = selected === undefined
    ? brief.continuation.next === undefined
      ? "This Workstream has no confirmed continuation. Select a session to open its Chat."
      : `Next from session ${brief.continuation.sessionId}: ${brief.continuation.next} (${brief.continuation.status}). Select a session to open its Chat.`
    : "Update PI WEB to use host-owned Chat, Files, Git, and Terminal surfaces.";
  view.surfaceStack.hidden = selected === undefined || !surfacesAvailable;
  for (const [surface, container] of view.surfaces) setSurfaceVisibility(container, selected !== undefined && surface === options.tool);

  const unresolvedTasks = snapshot.humanTasks.filter((task) => task.status === "pending");
  const openTasks = snapshot.humanTasks.filter((task) => task.status === "pending" || task.status === "answered");
  view.tasksTitle.textContent = `Workstream context · revision ${String(snapshot.revision)}`;
  view.contextActions.replaceChildren();
  if (!snapshot.closed) view.contextActions.append(
    button("Add task", () => { options.onAddTask(); }),
    button("Add link", () => { options.onAppendLink(); }),
    button("Close Workstream", () => { options.onClose(); }),
  );
  view.tasksList.replaceChildren();
  const continuation = document.createElement("section");
  continuation.className = "drawer-section";
  continuation.append(label("Confirmed continuation"));
  const checkpoints = snapshot.sessions.filter((session) => session.latestCheckpoint !== null);
  if (checkpoints.length === 0) continuation.append(message("No confirmed checkpoints yet.", "muted"));
  for (const session of checkpoints) {
    const item = document.createElement("div");
    item.className = "drawer-checkpoint";
    item.append(
      strong(session.latestCheckpoint.next),
      message(`${sessionAnchor(session)} · ${session.latestCheckpoint.whatChanged}`, "muted"),
    );
    if (session.latestCheckpoint.nextSessionPrompt === null) {
      item.append(message("Next-session prompt unavailable for this earlier checkpoint.", "next-session-prompt muted"));
    } else item.append(
      message(session.latestCheckpoint.nextSessionPrompt, "next-session-prompt"),
      button("Copy next-session prompt", () => { void copyNextSessionPrompt(session.latestCheckpoint.nextSessionPrompt); }),
    );
    if (session.checkpointStaleness !== null) item.append(message(`Stale: ${session.checkpointStaleness.reason}`, "checkpoint-error inline-error"));
    continuation.append(item);
  }
  view.tasksList.append(continuation);

  const tasksSection = document.createElement("section");
  tasksSection.className = "drawer-section";
  tasksSection.append(label(`Human Tasks · ${String(unresolvedTasks.length)}`));
  if (unresolvedTasks.length === 0) tasksSection.append(message("Nothing needs your attention right now.", "muted"));
  for (const task of openTasks) {
    const row = document.createElement("div");
    row.className = "dedicated-task";
    const copy = document.createElement("div");
    copy.append(strong(task.title));
    if (task.detail) copy.append(message(task.detail, "muted"));
    copy.append(message(task.sourceSessionId ? `From session ${task.sourceSessionId}` : "Source session not recorded", "task-source"));
    if (task.status === "answered" && task.answer !== null) {
      const answerText = task.answer.kind === "free-text" ? task.answer.text : task.options.find((option) => option.id === task.answer.optionId)?.label ?? task.answer.optionId;
      copy.append(message(`Answered: ${answerText}`, "receipt inline-answer"));
    }
    row.append(copy);
    const taskActions = document.createElement("div");
    taskActions.className = "task-answer-actions";
    if (!snapshot.closed && task.status === "pending" && task.answerKind === "free-text") taskActions.append(button("Answer", () => {
      const text = window.prompt(task.title, task.answer?.text ?? "");
      if (text?.trim()) options.onAnswerTask(task, { kind: "free-text", text: text.trim() });
    }));
    else if (!snapshot.closed && task.status === "pending" && (task.answerKind === "yes-no" || task.answerKind === "choice")) {
      for (const option of task.options) taskActions.append(button(option.label, () => { options.onAnswerTask(task, { kind: task.answerKind, optionId: option.id }); }));
    }
    if (!snapshot.closed && (task.answerKind === null || task.status === "answered")) taskActions.append(button("Resolve", () => { options.onResolveTask(task); }));
    row.append(taskActions);
    tasksSection.append(row);
  }
  view.tasksList.append(tasksSection);

  if (snapshot.links.length > 0) {
    const linksSection = document.createElement("section");
    linksSection.className = "drawer-section";
    linksSection.append(label(`Links · ${String(snapshot.links.length)}`));
    for (const link of snapshot.links) linksSection.append(message(link.label ?? link.reference, "links"));
    view.tasksList.append(linksSection);
  }

  view.terminal.classList.toggle("open", options.terminalOpen);
  view.terminalToggle.textContent = options.terminalOpen ? "Hide Terminal ↓" : "Terminal ↑";
  view.terminalToggle.disabled = selected === undefined;
  view.terminalToggle.title = selected === undefined ? "Select a Workstream session before opening Terminal" : "Terminal for selected session checkout";
  view.terminalToggle.setAttribute("aria-expanded", String(options.terminalOpen));
  view.terminalScope.textContent = selected === undefined ? "Terminal unavailable without a selected session checkout." : `Selected session checkout · ${sessionAnchor(selected)}`;
  view.terminalScope.hidden = !options.terminalOpen;
  view.terminalContent.hidden = !options.terminalOpen || selected === undefined;
  if (options.terminalOpen && selected !== undefined && view.terminalSurface === undefined) {
    view.terminalSurface = mountedHostSurface(options.context, "terminal");
    view.terminalContent.append(view.terminalSurface);
  }
}

function renderSessionAnchorRepair(repair, session, options) {
  const presentation = sessionAnchorRepairPresentation(repair);
  const panel = document.createElement("section");
  panel.className = "anchor-repair";
  panel.setAttribute("aria-live", "polite");
  panel.append(strong(presentation.title), message(presentation.guidance, "muted"));
  const actions = document.createElement("div");
  actions.className = "anchor-repair-actions";
  if (repair.status === "found") {
    actions.append(message(presentation.candidates[0].label, "session-anchor"));
  } else if (repair.status === "ambiguous") {
    repair.result.locations.forEach((candidate, index) => {
      const choice = button(presentation.candidates[index].label, () => { options.onSelectAnchorRepairCandidate(candidate); });
      choice.setAttribute("aria-pressed", String(presentation.candidates[index].selected));
      actions.append(choice);
    });
  }
  if (presentation.confirmEnabled) actions.append(button("Confirm session location", () => { options.onConfirmSessionAnchor(session); }));
  if (presentation.retryEnabled) {
    const machineName = repair.machine.name === repair.machine.id ? repair.machine.id : `${repair.machine.name} (${repair.machine.id})`;
    actions.append(button(`Scan ${machineName}`, () => { options.onResolveSessionAnchor(session); }));
  }
  panel.append(actions);
  return panel;
}

function setSurfaceVisibility(container, visible) {
  container.hidden = !visible;
  container.inert = !visible;
  container.setAttribute("aria-hidden", String(!visible));
}

function mountedHostSurface(context, surface) {
  const container = document.createElement("div");
  container.className = `host-surface ${surface}-surface`;
  container.tabIndex = -1;
  try {
    context?.surfaceHost?.mount(container, surface);
  } catch (error) {
    container.append(message(`Could not open ${surface}: ${errorMessage(error)}`, "checkpoint-error"));
  }
  return container;
}

function configureResizeSeparator(edge, labelText, getWidth, onResize) {
  edge.setAttribute("role", "separator");
  edge.setAttribute("aria-label", labelText);
  edge.setAttribute("aria-orientation", "vertical");
  edge.setAttribute("aria-valuemin", String(NAVIGATOR_MIN_WIDTH));
  edge.setAttribute("aria-valuemax", String(NAVIGATOR_MAX_WIDTH));
  edge.tabIndex = 0;
  edge.addEventListener("keydown", (event) => {
    const delta = navigatorKeyboardDelta(event.key, event.shiftKey);
    if (delta === undefined) return;
    event.preventDefault();
    const width = delta === -Infinity ? NAVIGATOR_MIN_WIDTH : delta === Infinity ? NAVIGATOR_MAX_WIDTH : resizeNavigatorWidth(getWidth(), delta);
    onResize(width);
  });
  let drag;
  edge.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: getWidth() };
    edge.setPointerCapture?.(event.pointerId);
  });
  edge.addEventListener("pointermove", (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    onResize(resizeNavigatorWidth(drag.startWidth, event.clientX - drag.startX));
  });
  const finish = (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    edge.releasePointerCapture?.(event.pointerId);
    drag = undefined;
  };
  edge.addEventListener("pointerup", finish);
  edge.addEventListener("pointercancel", finish);
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
    return value !== null && (allowed === undefined || allowed.includes(value)) ? value : fallback;
  } catch {
    return fallback;
  }
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
    main { box-sizing: border-box; width: min(100%, 1280px); min-height: 100%; display: grid; align-content: start; gap: 0; margin: 0 auto; padding: clamp(68px, 7vw, 92px) clamp(20px, 5vw, 72px) 40px; }
    main.dedicated-workstream { width: 100%; height: 100%; min-height: 0; margin: 0; padding: 0; display: flex; overflow: hidden; }
    header, .workstream-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--pi-toolbar-gap, 8px); }
    .portfolio-header { align-items: end; gap: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--pi-border); }
    .portfolio-header > div:first-child { max-width: 720px; }
    .portfolio-header > div:first-child > strong, .portfolio-header h1 { margin: 0; color: var(--pi-text-bright); font-size: clamp(28px, 3vw, 38px); letter-spacing: -.025em; line-height: 1.05; }
    .unified-inventory-state { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 14px 0 0; }
    .unified-root-navigation { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(24px, 4vw, 56px); padding-top: 26px; }
    .unified-list { min-width: 0; align-content: start; gap: 0; }
    .unified-list > h2 { padding-bottom: 10px; border-bottom: 1px solid var(--pi-border); }
    .unified-navigation-entry, .dedicated-session-entry { position: relative; min-width: 0; }
    .unified-navigation-row { width: 100%; min-height: 82px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-radius: 0; border-bottom: 1px solid var(--pi-border-muted); background: transparent; padding: 12px 4px; text-align: left; }
    .attention-navigation-action { position: absolute; right: 4px; bottom: 7px; min-height: 24px; padding: 3px 7px; color: var(--pi-accent); font-size: 11px; }
    .unified-navigation-entry:has(.attention-navigation-action) .unified-navigation-row { padding-bottom: 38px; }
    .unified-navigation-row > span:first-child { min-width: 0; display: grid; gap: 4px; }
    .unified-navigation-row > span:first-child > strong { color: var(--pi-text-bright); overflow-wrap: anywhere; }
    .navigation-state { flex: 0 0 auto; color: var(--pi-muted); font-size: 11px; }
    .unified-root-navigation.collapsed { display: flex; gap: 4px; overflow-x: auto; padding-block: 12px; border-bottom: 1px solid var(--pi-border); }
    .unified-root-navigation.collapsed .unified-list { display: contents; }
    .unified-root-navigation.collapsed h2, .unified-root-navigation.collapsed .unified-list > .muted { display: none; }
    .unified-root-navigation.collapsed .unified-navigation-row { width: min(280px, 72vw); min-height: 52px; flex: 0 0 auto; border: 1px solid var(--pi-border); border-radius: 8px; padding: 8px 10px; }
    .unified-root-navigation.collapsed .unified-navigation-row .session-anchor { display: none; }
    .unified-chat-surface { flex: 1 1 auto; }
    .narrow-navigate { display: none; }
    .unified-destination-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: var(--navigator-width, 320px) 12px minmax(0, 1fr); overflow: hidden; }
    .unified-destination-navigation { min-width: 0; overflow: auto; background: var(--pi-surface); }
    .unified-destination-navigation .unified-root-navigation { grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 14px 10px; }
    .unified-navigation-separator { background: var(--pi-border-muted); cursor: col-resize; touch-action: none; }
    .unified-navigation-separator:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .unified-chat-content { min-width: 0; min-height: 0; display: flex; overflow: hidden; }
    .unified-destination-body.collapsed { grid-template: auto minmax(0, 1fr) / minmax(0, 1fr); }
    .unified-destination-body.collapsed .unified-destination-navigation { grid-row: 1; }
    .unified-destination-body.collapsed .unified-destination-navigation .unified-root-navigation { display: flex; padding: 6px 8px; }
    .unified-destination-body.collapsed .unified-chat-content { grid-row: 2; }
    .portfolio-header .header-actions { padding-bottom: 1px; }
    .portfolio-header .header-actions .primary-action { background: var(--pi-accent); color: var(--pi-accent-contrast, white); font-weight: 700; }
    .return-note { width: max-content; margin-bottom: 10px; border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 3px 8px; font-size: 11px; }
    .portfolio-intro { max-width: 68ch; margin-top: 8px; color: var(--pi-muted); font-size: 15px; line-height: 1.3; }
    [hidden] { display: none !important; }
    .workstream-shell { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--pi-bg); }
    .shell-banner { flex: 0 0 auto; display: grid; }
    .anchor-repair { display: grid; gap: 6px; padding: 12px 16px; border-bottom: 1px solid var(--pi-border); background: var(--pi-warning-surface, var(--pi-surface)); }
    .anchor-repair-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .anchor-repair-actions button[aria-pressed="true"] { background: var(--pi-selection-bg); color: var(--pi-text-bright); font-weight: 700; }
    .workstream-topbar { min-height: 52px; flex: 0 0 auto; align-items: center; padding: 0 var(--pi-panel-padding, 12px) 0 66px; border-bottom: 1px solid var(--pi-border); box-shadow: inset 0 3px var(--workstream-color); background: color-mix(in srgb, var(--workstream-color) 8%, var(--pi-bg)); }
    .workstream-identity { min-width: 0; display: flex; align-items: center; gap: var(--pi-toolbar-gap, 8px); }
    .workstream-identity > div { min-width: 0; display: grid; gap: 2px; }
    .identity-brief-control { border-radius: 5px; cursor: pointer; }
    .identity-brief-control:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 3px; }
    .workstream-identity .shell-title, .workstream-identity p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .workstream-identity .shell-title { margin: 0; color: var(--pi-text-bright); font-size: 14px; letter-spacing: 0; }
    .workstream-swatch { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 3px; background: var(--workstream-color); }
    .workstream-tools, .workstream-utilities, .mobile-pane-navigation, .checkpoint-actions { display: flex; align-items: center; gap: 3px; }
    .mobile-pane-navigation { display: none; }
    .session-tabs { flex: 0 0 auto; min-width: 0; overflow-x: auto; display: flex; align-items: center; gap: 4px; padding: 6px 10px 6px 66px; border-bottom: 1px solid var(--pi-border); background: var(--pi-surface); }
    .collapsed-session-entry { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 2px; }
    .session-tabs button { flex: 0 0 auto; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-tabs button[aria-pressed="true"] { background: var(--pi-selection-bg); color: var(--pi-text-bright); font-weight: 700; }
    .workstream-tools button { background: transparent; color: var(--pi-muted); }
    .workstream-tools button[aria-pressed="true"] { background: var(--pi-selection-bg); color: var(--pi-text); font-weight: 700; }
    .scope-label { color: var(--pi-muted); font-size: 11px; }
    .workstream-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: var(--navigator-width, 320px) 22px minmax(360px, 1fr); overflow: hidden; }
    .workstream-body.sessions-collapsed { grid-template-columns: 0 0 minmax(360px, 1fr); }
    .sessions-pane { min-width: 0; min-height: 0; overflow: auto; background: var(--pi-surface); grid-column: 1; }
    .workspace-pane { grid-column: 3; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--pi-bg); }
    .sessions-collapsed .sessions-pane { visibility: hidden; overflow: hidden; }
    .workstream-drawer { flex: 0 0 auto; max-height: min(42vh, 390px); overflow: auto; display: block; border-bottom: 1px solid var(--pi-border); background: var(--pi-surface); box-shadow: 0 12px 28px var(--pi-shadow-soft); }
    .workstream-drawer .pane-heading { position: sticky; top: 0; z-index: 2; background: var(--pi-surface); }
    .workstream-drawer .pane-list { width: min(100%, 1100px); margin: 0 auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
    .drawer-section { min-width: 0; align-content: start; gap: 8px; padding: 14px; border-right: 1px solid var(--pi-border-muted); }
    .drawer-section:last-child { border-right: 0; }
    .drawer-checkpoint { display: grid; gap: 4px; }
    .next-session-prompt { white-space: pre-wrap; user-select: text; }
    .drawer-checkpoint > button { width: max-content; }
    .pane-edge { min-width: 0; min-height: 0; background: var(--pi-border-muted); cursor: col-resize; touch-action: none; }
    .pane-edge:focus-visible { position: relative; z-index: 3; outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .sessions-pane + .pane-edge { grid-column: 2; }
    .pane-heading-actions, .recovery-actions { display: flex; align-items: center; gap: 4px; }
    .selection-recovery { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .navigator-inventory-notice .unified-inventory-state { margin: 0; padding: 8px 12px; border-bottom: 1px solid var(--pi-border); }
    .overlay-close, .overlay-scrim { display: none; }
    .pane-heading, .workspace-heading { min-height: 49px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--pi-border); }
    .context-actions { display: flex; align-items: center; gap: 5px; }
    .context-actions button { min-height: 30px; padding-block: 4px; font-size: 11px; }
    .pane-heading h2, .workspace-heading h2 { margin: 0; }
    .workspace-heading { flex: 0 0 auto; }
    .workspace-heading > div:first-child { min-width: 0; display: grid; gap: 3px; }
    .checkpoint-actions { flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
    .checkpoint-actions button { font-size: 11px; }
    .pane-list { min-height: 0; display: flex; flex-direction: column; }
    .dedicated-session { width: 100%; min-height: auto; display: block; border-radius: 0; background: transparent; padding: 10px 12px; text-align: left; }
    .dedicated-session-entry:has(.attention-navigation-action) .dedicated-session { padding-bottom: 38px; }
    .dedicated-session > span { min-width: 0; display: grid; gap: 4px; }
    .attention-action { color: var(--pi-warning); font-size: 11px; font-weight: 700; }
    .dedicated-session.selected { background: var(--pi-selection-bg); }
    .session-anchor { color: var(--pi-text-secondary, var(--pi-text)); font-size: 12px; line-height: 1.35; }
    .diagnostic { color: var(--pi-muted); font-size: 10px; }
    .inline-error { padding: 6px; font-size: 11px; }
    .dedicated-task { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border-muted); }
    .dedicated-task > div { min-width: 0; display: grid; gap: 5px; }
    .task-answer-actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
    .task-answer-actions button { min-height: 30px; padding-block: 4px; font-size: 11px; }
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
    section { display: grid; gap: var(--pi-message-gap, 10px); }
    h2 { margin: 0; color: var(--pi-text-bright); font-size: 13px; }
    .portfolio-list { gap: 0; }
    .portfolio-list > h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .portfolio-row { box-sizing: border-box; width: 100%; min-height: 98px; display: grid; grid-template-columns: minmax(220px, 1.25fr) minmax(320px, 1.8fr) minmax(170px, .7fr) minmax(90px, .45fr); align-items: start; gap: 22px; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: 18px 8px; text-align: left; }
    .portfolio-row:hover { background: var(--pi-surface-hover); }
    .portfolio-row:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .portfolio-row.closed { color: var(--pi-muted); }
    .portfolio-cell { min-width: 0; display: grid; gap: 6px; white-space: normal; }
    .portfolio-cell > strong { color: var(--pi-text-bright); font-size: 15px; line-height: 1.3; overflow-wrap: anywhere; }
    .portfolio-identity > strong { font-size: 16px; }
    .portfolio-status { width: max-content; max-width: 100%; border-radius: 999px; padding: 2px 7px; font-size: 11px; line-height: 1.3; }
    .portfolio-status.current { background: var(--pi-success-surface); color: var(--pi-success); }
    .portfolio-status.warning, .portfolio-status.missing { background: var(--pi-warning-surface); color: var(--pi-warning); }
    .portfolio-anchor, .portfolio-needs { line-height: 1.35; overflow-wrap: anywhere; }
    .closed-history { border-bottom: 1px solid var(--pi-border); padding-top: 12px; }
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
      .workstream-body { grid-template-columns: min(var(--navigator-width, 320px), 42vw) 22px minmax(320px, 1fr); }
      .workstream-body.sessions-collapsed { grid-template-columns: 0 0 minmax(320px, 1fr); }
      .workstream-drawer .pane-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 720px) {
      .workstream-actions { flex-wrap: wrap; justify-content: flex-start; }
      .workstream-topbar { flex-wrap: wrap; align-content: center; padding: 6px 8px 6px 58px; }
      .workstream-utilities > .scope-label { display: none; }
      .session-tabs { display: none; }
      .mobile-pane-navigation { display: flex; flex: 0 0 auto; justify-content: center; padding: 6px; border-bottom: 1px solid var(--pi-border); background: var(--pi-surface); }
      .mobile-pane-navigation button[aria-pressed="true"] { background: var(--pi-selection-bg); font-weight: 700; }
      .narrow-navigate { display: inline-flex; }
      .unified-destination-body, .unified-destination-body.collapsed { position: relative; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); overflow: visible; }
      .unified-destination-navigation { position: absolute; inset: 0 auto 0 0; z-index: 9; width: min(88vw, 360px); border-right: 1px solid var(--pi-border); box-shadow: 16px 0 36px var(--pi-shadow-soft); }
      .overlay-close { display: inline-flex; margin: 8px; }
      .overlay-scrim { position: absolute; inset: 0; z-index: 7; display: block; min-height: 0; border-radius: 0; background: color-mix(in srgb, black 44%, transparent); font-size: 0; }
      .unified-destination-body > .overlay-scrim { z-index: 8; }
      .unified-destination-navigation .unified-root-navigation, .unified-destination-body.collapsed .unified-destination-navigation .unified-root-navigation { display: grid; grid-template-columns: minmax(0, 1fr); overflow: visible; padding: 12px; }
      .unified-navigation-separator { display: none; }
      .unified-chat-content, .unified-destination-body.collapsed .unified-chat-content { grid-row: 1; grid-column: 1; }
      .workstream-body, .workstream-body.sessions-collapsed { position: relative; grid-template-columns: minmax(0, 1fr); overflow: visible; }
      .pane-edge { display: none; }
      .workspace-pane { display: flex; grid-column: 1; visibility: visible; }
      .sessions-pane { display: none; }
      .workstream-body.mobile-sessions .sessions-pane { position: absolute; inset: 0 auto 0 0; z-index: 8; width: min(88vw, 360px); display: flex; flex-direction: column; visibility: visible; border-right: 1px solid var(--pi-border); box-shadow: 16px 0 36px var(--pi-shadow-soft); }
      .workstream-drawer { max-height: 48vh; }
      .workstream-drawer .pane-list { grid-template-columns: minmax(0, 1fr); }
      .drawer-section { border-right: 0; border-bottom: 1px solid var(--pi-border-muted); }
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
    @media (max-width: 760px) {
      main { padding: 70px 14px 28px; }
      .unified-root-navigation, .unified-root-navigation.collapsed { display: grid; grid-template-columns: minmax(0, 1fr); overflow: visible; gap: 24px; }
      .unified-root-navigation.collapsed .unified-list { display: grid; }
      .unified-root-navigation.collapsed h2 { display: block; }
      .unified-root-navigation.collapsed .unified-navigation-row { width: 100%; }
      .portfolio-header { align-items: flex-start; }
      .portfolio-header .header-actions { flex: 0 0 auto; }
      .portfolio-row { grid-template-columns: minmax(0, 1fr) auto; gap: 12px 16px; padding: 16px 6px; }
      .portfolio-next { grid-column: 1 / -1; grid-row: 2; }
      .portfolio-anchor { grid-column: 1; grid-row: 3; }
      .portfolio-needs { grid-column: 2; grid-row: 1; text-align: right; }
    }
    @media (max-width: 520px) {
      .portfolio-header { display: grid; }
      .portfolio-header .header-actions { justify-content: flex-start; }
      .portfolio-header > div:first-child > strong { font-size: 28px; }
      .portfolio-intro { font-size: 14px; }
    }
    @media (pointer: coarse) { button:not(.unified-navigation-row):not(.dedicated-session):not(.overlay-scrim) { min-height: 44px; } }
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

export async function copyNextSessionPrompt(value, {
  clipboard = globalThis.navigator?.clipboard,
  fallback = (prompt) => { window.prompt("Copy next-session prompt", prompt); },
} = {}) {
  if (clipboard?.writeText !== undefined) {
    try {
      await clipboard.writeText(value);
      return "clipboard";
    } catch {
      // Fall through to a selectable prompt when clipboard access is unavailable.
    }
  }
  fallback(value);
  return "fallback";
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
