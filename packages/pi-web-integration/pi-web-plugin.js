import { createWorkbenchWorkstreamClient, reconcileWorkstreams } from "./workstream-client.js";
import { WorkstreamSessionCoordinator } from "./workstream-session-coordinator.js";
import { projectSessionContext, projectWorkstreamBrief, selectWorkstreamSession } from "./workstream-brief-projection.js";
import { completeSessionKey, createUnifiedNavigationState, joinChatsAndWorkstreams, parseDestinationPreference, parseTerminalPreference, reduceUnifiedNavigation, rememberedSessionSurface, renderedTerminalHeightBounds, serializeDestinationPreference, serializeTerminalPreference, sessionSurfacePreferenceName, sessionTerminalPreferenceName, terminalKeyboardDelta, TERMINAL_DEFAULT_HEIGHT } from "./unified-navigation-state.js";
import { attentionDestinationFromItem, attentionForWorkstreamSession, canonicalSurfaceRenderKey, collapsedSessionTabsRenderKey, contextHostIdentityChanges, dedicatedBannerRenderKey, destinationsMatch, expandedSessionListRenderKey, formatDateTime, formatModifiedTime, hostSurfaceActivationKey, inventoryNoticeRenderKey, NARROW_VIEWPORT_MEDIA_QUERY, NAVIGATOR_MAX_WIDTH, NAVIGATOR_MIN_WIDTH, NAVIGATOR_MODE_PREFERENCE, NAVIGATOR_WIDTH_PREFERENCE, navigatorContinuationText, navigatorFocusKey, navigatorKeyboardDelta, narrowOverlayKeyboardAction, narrowViewportMatches, normalizeSessionNavigationSnapshot, resizeNavigatorWidth, selectedDestinationFromIdentity, sessionNavigationCompatibility, unifiedChatBannerRenderKey, unifiedNavigatorRenderKey, workstreamsRootRenderKey, workstreamNavigatorItem } from "./unified-navigation-view-model.js";

const PROJECTION_PATH = ".pi-workbench/projection.json";
const PANEL_ID = "pi-workbench:run.panel";
const INCOMPLETE_START_MESSAGE = "Select a complete machine, project, and workspace in Projects/checkouts before starting a Workstream session.";
const projectionCache = new Map();
const workstreamReconciliationConflicts = new Map();
const workstreamStartsInFlight = new Set();
const recordedWorkstreamState = { status: "idle", snapshots: [], sequence: 0, error: "", notice: "", selectedWorkstreamId: undefined, focusKey: undefined, promise: undefined };
let workstreamClient;
let connectedWorkstreamsElement;

export function dedicatedWorkstreamLayout({ tool, sessionsPaneOpen }) {
  const surface = ["chat", "context", "files", "git"].includes(tool) ? tool : "chat";
  return {
    sessionsPaneVisible: sessionsPaneOpen === true,
    surface,
    scope: surface === "context" ? "canonical-selected-session-context"
      : surface === "git" ? "selected-session-checkout-observed-unattributed" : "selected-session-checkout",
  };
}

export function checkpointProposalPrompt() {
  return "Propose a concise attended Workstream checkpoint with exactly five labeled parts: What changed, What remains, Next useful action, Next-session prompt, and References. Make the next-session prompt exact and paste-ready for a fresh attended Pi session; list only concrete paths or identifiers under References. Do not persist it; I will review and confirm it in the Workstreams view.";
}

export function normalizeDedicatedMobilePane(value) {
  return value === "sessions" ? "sessions" : "workspace";
}

export function dedicatedMobileControlState(state, control) {
  return { selected: normalizeDedicatedMobilePane(state.mobilePane) === control };
}

export function transitionDedicatedWorkstreamUi(state, action) {
  switch (action.type) {
    case "select-surface":
      return action.surface === "terminal"
        ? { ...state, terminalOpen: true }
        : { ...state, tool: action.surface, mobilePane: "workspace" };
    case "select-mobile-pane": return { ...state, mobilePane: normalizeDedicatedMobilePane(action.pane) };
    case "toggle-sessions": return { ...state, sessionsPaneOpen: !state.sessionsPaneOpen };
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

export function startLocationRecoveryVisible(active, location, reset = false) {
  return !reset && active === true && !completeSessionLocation(location);
}

export function currentSessionLocationResult(sessions) {
  try {
    return { ok: true, location: sessions?.currentLocation?.() };
  } catch (error) {
    return { ok: false, error: typedHostError(error, "CURRENT_LOCATION_FAILED") };
  }
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

export const WORKBENCH_SHELL_PROFILE = {
  id: "shell.workbench",
  title: "Pi Workbench",
  description: "Use the existing Workbench primary view as the starting composition while PI WEB keeps protected recovery available.",
  recommended: true,
  defaultPrimaryView: "workstreams.view",
  navigationEntries: ["workstreams.navigation"],
  surfaceContributions: ["core:workspace.files", "core:workspace.git", "core:workspace.terminal", "run.panel"],
  regions: {
    "context-bar": [],
    status: [],
    "surface-strip": [],
    "contextual-actions": [],
  },
  initialPanels: {
    navigation: { visible: false, size: 320 },
    workspace: { visible: false, size: 480 },
  },
  presentationProfile: "compact",
};

export default {
  apiVersion: 1,
  name: "Pi Workbench",
  activate: ({ html, svg, service }) => {
    workstreamClient = service === undefined ? undefined : createWorkbenchWorkstreamClient(service);
    installRunStatusElement();
    installWorkstreamsElement();
    return {
      contributions: {
        shellProfiles: [WORKBENCH_SHELL_PROFILE],
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
    #startLocationIncomplete = false;
    #lastHostActivationKey;
    #main;
    #statusRegion;
    #alertRegion;
    #dedicatedView;
    #chatView;
    #narrowViewportQuery;
    #narrowViewportChange = (event) => {
      if (event.matches !== true) this.#mobilePane = "workspace";
      this.#render();
    };

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      root.append(workstreamsStyleElement());
      ({ status: this.#statusRegion, alert: this.#alertRegion } = createLiveRegions());
      this.#main = document.createElement("main");
      root.append(this.#statusRegion, this.#alertRegion, this.#main);
    }

    set context(value) {
      if (this.#context?.surfaceHost !== value?.surfaceHost) this.#lastHostActivationKey = undefined;
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
      this.#bindNarrowViewport();
      if (this.#context !== undefined) {
        this.#bindContextHosts(this.#context);
        void loadRecordedWorkstreams(this.#context).finally(() => { this.#reconcileUnifiedState(); this.#render(); });
      }
      this.#scheduleWatch();
      this.#render();
    }

    disconnectedCallback() {
      if (this.#watchTimer !== undefined) window.clearTimeout(this.#watchTimer);
      this.#releaseNarrowViewport();
      this.#watchTimer = undefined;
      if (connectedWorkstreamsElement === this) connectedWorkstreamsElement = undefined;
      this.#releaseSurfaceSelection();
      this.#attentionRelease?.();
      this.#attentionRelease = undefined;
      this.#sessionNavigationRelease?.();
      this.#sessionNavigationRelease = undefined;
      this.#contextHostsBound = false;
    }

    #bindNarrowViewport() {
      this.#releaseNarrowViewport();
      this.#narrowViewportQuery = globalThis.matchMedia?.(NARROW_VIEWPORT_MEDIA_QUERY);
      this.#narrowViewportQuery?.addEventListener?.("change", this.#narrowViewportChange);
    }

    #releaseNarrowViewport() {
      this.#narrowViewportQuery?.removeEventListener?.("change", this.#narrowViewportChange);
      this.#narrowViewportQuery = undefined;
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
        this.#selectSurface(surface, false);
      });
    }

    #selectSurface(surface, activateHost = true) {
      if (surface === "terminal" && this.#destinationSessionKey() === undefined) return;
      if (surface === "context" && this.#unifiedState.destination.type !== "workstream-session") return;
      if (surface !== "terminal" && ["chat", "context", "files", "git"].includes(surface)) {
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "select-surface", surface });
      }
      this.#transition({ type: "select-surface", surface });
      if (activateHost) this.#activateHostSurface(surface);
      else {
        const activeKey = hostSurfaceActivationKey(this.#destinationSessionKey(), surface);
        if (activeKey !== undefined) this.#lastHostActivationKey = activeKey;
      }
      const focusTarget = surface === "terminal"
        ? this.#selectedChat === undefined ? this.#dedicatedView?.terminalToggle : this.#chatView?.terminalToggle
        : this.#selectedChat === undefined ? this.#dedicatedView?.toolButtons.get(surface) : this.#chatView?.toolButtons.get(surface);
      focusTarget?.focus({ preventScroll: true });
    }

    #activateHostSurface(surface, force = false) {
      const key = hostSurfaceActivationKey(this.#destinationSessionKey(), surface);
      if (key === undefined || !force && key === this.#lastHostActivationKey) return;
      this.#lastHostActivationKey = key;
      this.#context?.surfaceHost?.activate?.(surface);
    }

    #clearStartLocationRecovery(reset = false) {
      let location;
      if (!reset) {
        try { location = this.#context?.sessions?.currentLocation?.(); } catch { location = undefined; }
      }
      const visible = startLocationRecoveryVisible(this.#startLocationIncomplete, location, reset);
      this.#startLocationIncomplete = visible;
    }

    #destinationSessionKey() {
      const destination = this.#unifiedState.destination;
      return destination.type === "chat" ? destination.sessionKey
        : destination.type === "workstream-session" ? completeSessionKey({ ...destination.location, sessionId: destination.sessionId }) : undefined;
    }

    #selectedSurface(fallback = "chat") {
      const key = this.#destinationSessionKey();
      return key === undefined ? fallback : this.#unifiedState.surfaceBySession[key] ?? fallback;
    }

    #restoreSessionSurface(allowContext) {
      const key = this.#destinationSessionKey();
      const surface = key === undefined ? "chat" : rememberedSessionSurface(this.#readPreference(sessionSurfacePreferenceName(key)), allowContext);
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "select-surface", surface });
      this.#tool = this.#selectedSurface("chat");
      return this.#tool;
    }

    #terminalPreference() {
      const key = this.#destinationSessionKey();
      return key === undefined ? undefined : this.#unifiedState.terminalBySession[key];
    }

    #restoreTerminalPreference() {
      const key = this.#destinationSessionKey();
      if (key === undefined) return { open: false, height: TERMINAL_DEFAULT_HEIGHT };
      const preference = parseTerminalPreference(this.#readPreference(sessionTerminalPreferenceName(key), ""));
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "set-terminal", ...preference });
      return preference;
    }

    #writeTerminalPreference(expectedKey = this.#destinationSessionKey()) {
      const key = this.#destinationSessionKey();
      const preference = key === undefined || key !== expectedKey ? undefined : this.#unifiedState.terminalBySession[key];
      if (preference !== undefined) this.#writePreference(sessionTerminalPreferenceName(key), serializeTerminalPreference(preference));
    }

    #setTerminalHeight(height, persist = false) {
      const key = this.#destinationSessionKey();
      if (key === undefined) return;
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "set-terminal", open: true, height });
      if (persist) this.#writeTerminalPreference(key);
      this.#render();
    }

    #transition(action) {
      const terminalKey = this.#destinationSessionKey();
      if ((action.type === "toggle-terminal" || action.type === "select-surface" && action.surface === "terminal") && terminalKey === undefined) return;
      const next = transitionDedicatedWorkstreamUi({
        tool: this.#tool,
        sessionsPaneOpen: this.#sessionsPaneOpen,
        terminalOpen: this.#terminalPreference()?.open === true,
        mobilePane: this.#mobilePane,
      }, action);
      this.#tool = next.tool;
      this.#sessionsPaneOpen = next.sessionsPaneOpen;
      this.#mobilePane = next.mobilePane;
      if (action.type === "select-surface" && action.surface !== "terminal") {
        const key = this.#destinationSessionKey();
        if (key !== undefined && this.#selectedSurface() === action.surface) this.#writePreference(sessionSurfacePreferenceName(key), action.surface);
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
      } else if (action.type === "toggle-terminal" || action.type === "select-surface" && action.surface === "terminal") {
        const remembered = this.#unifiedState.terminalBySession[terminalKey];
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "set-terminal", open: next.terminalOpen, height: remembered?.height });
        this.#writeTerminalPreference(terminalKey);
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
      this.#clearStartLocationRecovery(true);
      recordedWorkstreamState.error = "";
      try {
        const receipt = await operation(workstreamClient);
        recordedWorkstreamState.notice = typeof receipt.notice === "string"
          ? receipt.notice
          : `Accepted revision ${String(receipt.acceptedRevision)} at sequence ${String(receipt.sequence)}.`;
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
      this.#tool = "chat";
      this.#sessionsPaneOpen = this.#readBoolean("sessions-open", true);
      this.#mobilePane = normalizeDedicatedMobilePane(this.#readPreference("mobile-pane", "workspace", ["sessions", "workspace"]));
    }

    #openWorkstream(snapshot) {
      this.#clearStartLocationRecovery(true);
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
      this.#clearStartLocationRecovery(true);
      recordedWorkstreamState.focusKey = this.#selectedChat === undefined
        ? navigatorFocusKey({ type: "workstream", workstreamId: this.#selectedWorkstreamId })
        : navigatorFocusKey({ type: "chat", sessionKey: completeSessionKey(this.#selectedChat) });
      this.#selectedWorkstreamId = undefined;
      this.#selectedChat = undefined;
      recordedWorkstreamState.selectedWorkstreamId = undefined;
      this.#writePreference("selected-workstream", "");
      this.#selectedSessionId = undefined;
      this.#anchorRepair = undefined;
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
      this.#clearStartLocationRecovery(true);
      if (session.status !== "active") return false;
      const workstreamId = requestedWorkstreamId;
      if (workstreamId === undefined) return false;
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
        return false;
      }
      const destination = { type: "workstream-session", workstreamId, sessionId: session.id, location };
      const token = ++this.#selectionToken;
      this.#anchorRepair = undefined;
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-requested", token, destination });
      this.#render();
      try {
        await selectWorkstreamSessionLocation(this.#context, session, requireSessionNavigation);
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-succeeded", token });
        if (this.#unifiedState.destination !== destination) return false;
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
        const restoredSurface = this.#restoreSessionSurface(true);
        this.#activateHostSurface(restoredSurface, true);
        this.#restoreTerminalPreference();
        this.#mobilePane = "workspace";
        window.requestAnimationFrame(() => { this.#dedicatedView?.surfaces.get(this.#selectedSurface("chat"))?.focus({ preventScroll: true }); });
        this.#render();
        return true;
      } catch (error) {
        if (this.#unifiedState.pendingSelection?.token !== token) return false;
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-failed", token, error: typedSelectionError(error) });
        this.#recordSessionFailure(session, error, workstreamId);
      }
      this.#render();
      return false;
    }

    async #selectChat(chat) {
      this.#clearStartLocationRecovery(true);
      const location = { sessionId: chat.sessionId, machineId: chat.machineId, projectId: chat.projectId, workspaceId: chat.workspaceId };
      const destination = { type: "chat", sessionKey: completeSessionKey(chat), location };
      const token = ++this.#selectionToken;
      this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-requested", token, destination });
      this.#render();
      try {
        if (typeof this.#context?.sessionNavigation?.select !== "function") throw new Error("Native Chat navigation is unavailable in this PI WEB version.");
        await this.#context.sessionNavigation.select(location);
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-succeeded", token });
        if (this.#unifiedState.destination !== destination) return false;
        this.#selectedWorkstreamId = undefined;
        recordedWorkstreamState.selectedWorkstreamId = undefined;
        this.#selectedSessionId = undefined;
        this.#dedicatedView = undefined;
        this.#selectedChat = chat;
        const restoredSurface = this.#restoreSessionSurface(false);
        this.#restoreTerminalPreference();
        this.#writeDestinationPreference();
        this.#activateHostSurface(restoredSurface, true);
        window.requestAnimationFrame(() => { this.#chatView?.surfaces.get(this.#selectedSurface("chat"))?.focus({ preventScroll: true }); });
        this.#render();
        return true;
      } catch (error) {
        if (this.#unifiedState.pendingSelection?.token !== token) return false;
        this.#unifiedState = reduceUnifiedNavigation(this.#unifiedState, { type: "selection-failed", token, error: typedSelectionError(error) });
      }
      this.#render();
      return false;
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
      this.#clearStartLocationRecovery(true);
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
      if (workstreamStartsInFlight.has(snapshot.id)) {
        recordedWorkstreamState.notice = `A new session for ${snapshot.title} is already being started.`;
        this.#render();
        return;
      }
      const currentLocation = currentSessionLocationResult(this.#context?.sessions);
      if (!currentLocation.ok) {
        this.#startLocationIncomplete = false;
        recordedWorkstreamState.error = startLocationFailureMessage(currentLocation.error);
        this.#render();
        return;
      }
      const { location } = currentLocation;
      if (!completeSessionLocation(location)) {
        this.#startLocationIncomplete = true;
        this.#render();
        return;
      }
      this.#startLocationIncomplete = false;
      recordedWorkstreamState.error = "";
      if (!window.confirm(`Start a new session for ${snapshot.title} at this checkout?\n\n${sessionAnchor(location)}`)) { this.#render(); return; }
      workstreamStartsInFlight.add(snapshot.id);
      void this.#mutate(async () => {
        const session = await this.#coordinator().launch(snapshot);
        const notice = session.workstreamAssociation === "pending"
          ? `Started session ${session.id}; its Workstream association is pending reconciliation.`
          : session.workstreamAssociation === "conflict"
            ? `Started session ${session.id}, but its Workstream association has a conflict requiring attention.`
            : `Started session ${session.id}.`;
        return { acceptedRevision: snapshot.revision, sequence: recordedWorkstreamState.sequence, notice };
      }).finally(() => {
        workstreamStartsInFlight.delete(snapshot.id);
        this.#render();
      });
    }

    #resume(session) {
      this.#clearStartLocationRecovery(true);
      recordedWorkstreamState.error = "";
      void Promise.resolve().then(() => this.#coordinator().resume(session)).catch((error) => {
        if (this.#recordSessionFailure(session, error) === undefined) recordedWorkstreamState.error = errorMessage(error);
        this.#render();
      });
    }

    #requestCheckpoint(session) {
      this.#clearStartLocationRecovery(true);
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
      void this.#focusAttentionDestination(item);
    }

    async #focusAttentionDestination(item) {
      const target = attentionDestinationFromItem(this.#joinedNavigation(), item);
      if (!target.ok) {
        recordedWorkstreamState.error = `${target.error.code}: ${target.error.message}`;
        this.#render();
        return;
      }
      const selected = target.kind === "chat"
        ? await this.#selectChat(target.chat)
        : await this.#selectSession(target.session, target.workstreamId, true);
      if (!selected || !destinationsMatch(this.#unifiedState.destination, target.destination)) return;
      try {
        if (typeof this.#context?.attention?.focus !== "function") throw typedAttentionError(undefined, "ATTENTION_FOCUS_UNAVAILABLE", "Live ask focus is unavailable in this PI WEB version.");
        const focused = await this.#context.attention.focus(item);
        if (!focused) throw typedAttentionError(undefined, "ATTENTION_FOCUS_REJECTED", "The selected ask is no longer available to focus.");
      } catch (error) {
        const failure = typedAttentionError(error, "ATTENTION_FOCUS_FAILED", "Could not focus the selected live ask.");
        recordedWorkstreamState.error = `${failure.code}: ${failure.message}`;
        this.#render();
      }
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
      const currentDestinationKey = this.#selectedChat !== undefined ? `chat:${completeSessionKey(this.#selectedChat)}`
        : this.#selectedWorkstreamId === undefined ? "root"
          : this.#selectedSessionId === undefined ? `workstream:${this.#selectedWorkstreamId}` : `workstream-session:${this.#selectedWorkstreamId}:${this.#selectedSessionId}`;
      const nextDestinationKey = destination.type === "chat" ? `chat:${destination.sessionKey}`
        : destination.type === "workstream" ? `workstream:${destination.workstreamId}`
          : destination.type === "workstream-session" ? `workstream-session:${destination.workstreamId}:${destination.sessionId}` : "root";
      if (currentDestinationKey !== nextDestinationKey) this.#clearStartLocationRecovery(true);
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
          this.#selectedSessionId = undefined;
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

    #updateLiveRegion(announcement) {
      updateLiveRegions({ status: this.#statusRegion, alert: this.#alertRegion }, announcement);
    }

    #render() {
      this.#clearStartLocationRecovery();
      const main = this.#main;
      const context = this.#context;
      const joined = this.#joinedNavigation();
      this.#updateLiveRegion(workstreamsAnnouncement({
        connectionStatus: context?.connection?.status,
        connectionMessage: context?.connection?.message,
        workstreamStatus: recordedWorkstreamState.status,
        error: recordedWorkstreamState.error,
        notice: recordedWorkstreamState.notice,
        selectionError: this.#unifiedState.selectionError,
        refreshError: this.#navigationRefreshError,
        inventoryStatus: joined.status,
        inventoryReason: joined.reason,
        startLocationIncomplete: this.#startLocationIncomplete,
        anchorRepair: this.#anchorRepair,
      }));
      const selected = recordedWorkstreamState.snapshots.find((snapshot) => snapshot.id === this.#selectedWorkstreamId);
      this.#syncSurfaceSelection(selected !== undefined || this.#selectedChat !== undefined);

      if (this.#selectedChat !== undefined && this.#unifiedState.destination.type === "chat") {
        const chatOptions = {
          context, chat: this.#selectedChat, error: this.#unifiedState.selectionError,
          refreshError: this.#navigationRefreshError,
          reconnecting: context?.connection?.status === "reconnecting" || joined.status === "reconnecting",
          joined, machine: this.#nativeNavigation.machine ?? context?.machine,
          attentionItems: this.#attentionItems, navigation: this.#unifiedState.navigation,
          destination: this.#unifiedState.destination, surface: this.#selectedSurface("chat"),
          terminalOpen: this.#unifiedState.terminalBySession[this.#destinationSessionKey()]?.open === true,
          terminalHeight: this.#unifiedState.terminalBySession[this.#destinationSessionKey()]?.height,
          pending: this.#unifiedState.pendingSelection !== undefined,
          sessionNavigationCompatibility: sessionNavigationCompatibility(context?.sessionNavigation),
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
          onToggleTerminal: () => {
            const opening = this.#terminalPreference()?.open !== true;
            this.#transition({ type: "toggle-terminal" });
            if (opening) this.#activateHostSurface("terminal");
          },
          onTerminalResize: (height, persist) => { this.#setTerminalHeight(height, persist); },
          anchor: `${sessionAnchor(this.#selectedChat)} · Session ${this.#selectedChat.sessionId}`,
        };
        if (hostedChatViewRequiresRemount(this.#chatView, context?.surfaceHost)) {
          this.#chatView = createUnifiedChatDestination(chatOptions);
          main.replaceChildren(this.#chatView.element);
        }
        main.className = "dedicated-workstream";
        main.removeAttribute("data-render-key");
        updateUnifiedChatDestination(this.#chatView, chatOptions);
        return;
      }

      if (selected !== undefined && recordedWorkstreamState.status === "ready") {
        const options = {
          context,
          selectedSessionId: this.#selectedSessionId,
          rememberedSessionKey: this.#readPreference(`selected-session:${selected.id}`),
          tool: this.#selectedSurface(this.#tool),
          sessionsPaneOpen: this.#sessionsPaneOpen,
          terminalOpen: this.#unifiedState.destination.type === "workstream-session"
            ? this.#unifiedState.terminalBySession[completeSessionKey({ ...this.#unifiedState.destination.location, sessionId: this.#unifiedState.destination.sessionId })]?.open === true
            : false,
          terminalHeight: this.#unifiedState.destination.type === "workstream-session"
            ? this.#unifiedState.terminalBySession[completeSessionKey({ ...this.#unifiedState.destination.location, sessionId: this.#unifiedState.destination.sessionId })]?.height
            : undefined,
          mobilePane: this.#mobilePane,
          reconnecting: context?.connection?.status === "reconnecting",
          joined,
          sessionNavigationCompatibility: sessionNavigationCompatibility(context?.sessionNavigation),
          error: recordedWorkstreamState.error,
          notice: recordedWorkstreamState.notice,
          startLocationIncomplete: this.#startLocationIncomplete,
          onBack: () => { this.#returnToPortfolio(); },
          onOpenBrief: () => {
            this.#clearStartLocationRecovery(true);
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
          onToggleTerminal: () => {
            const opening = this.#terminalPreference()?.open !== true;
            this.#transition({ type: "toggle-terminal" });
            if (opening) this.#activateHostSurface("terminal");
          },
          onTerminalResize: (height, persist) => { this.#setTerminalHeight(height, persist); },
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
          onAppendLink: () => { this.#appendLink(selected); },
          onClose: () => { this.#close(selected); },
        };
        if (this.#dedicatedView?.workstreamId !== selected.id || this.#dedicatedView.surfaceHost !== context?.surfaceHost) {
          this.#dedicatedView = createDedicatedWorkstream(selected, options);
          main.replaceChildren(this.#dedicatedView.element);
        }
        main.className = "dedicated-workstream";
        main.removeAttribute("data-render-key");
        updateDedicatedWorkstream(this.#dedicatedView, selected, options);
        if (recordedWorkstreamState.focusKey === "dedicated:title") settleFocus(this.#dedicatedView.title, "dedicated:title");
        return;
      }

      this.#dedicatedView = undefined;
      this.#chatView = undefined;
      const focusedKey = this.shadowRoot?.activeElement?.dataset?.focusKey ?? recordedWorkstreamState.focusKey;
      const rootRenderKey = workstreamsRootRenderKey({
        connectionStatus: context?.connection?.status,
        connectionMessage: context?.connection?.message,
        workstreamStatus: recordedWorkstreamState.status,
        error: recordedWorkstreamState.error,
        notice: recordedWorkstreamState.notice,
        selectionError: this.#unifiedState.selectionError,
        refreshError: this.#navigationRefreshError,
        joined,
        machine: this.#nativeNavigation.machine ?? context?.machine,
        attentionItems: this.#attentionItems,
        navigation: this.#unifiedState.navigation,
        destination: this.#unifiedState.destination,
        pending: this.#unifiedState.pendingSelection !== undefined,
        sessionNavigationSupported: context?.sessionNavigation !== undefined,
        sessionNavigationRefreshAvailable: typeof context?.sessionNavigation?.refresh === "function",
      });
      if (main.dataset.renderKey === rootRenderKey) return;
      main.dataset.renderKey = rootRenderKey;
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
          joined,
          machine: this.#nativeNavigation.machine ?? context?.machine,
          attentionItems: this.#attentionItems,
          navigation: this.#unifiedState.navigation,
          destination: this.#unifiedState.destination,
          pending: this.#unifiedState.pendingSelection !== undefined,
          sessionNavigationCompatibility: sessionNavigationCompatibility(context?.sessionNavigation),
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
      let reconciliationError = "";
      if (context.sessions !== undefined) {
        const coordinator = new WorkstreamSessionCoordinator(workstreamClient, context.sessions);
        const currentPending = new Set(projection.snapshots.filter((snapshot) => !snapshot.closed).flatMap((snapshot) => snapshot.sessions.filter((session) => session.status === "pending" && typeof session.associationKey === "string").map((session) => session.associationKey)));
        for (const associationKey of workstreamReconciliationConflicts.keys()) if (!currentPending.has(associationKey)) workstreamReconciliationConflicts.delete(associationKey);
        const candidates = projection.snapshots.filter((snapshot) => !snapshot.closed && snapshot.sessions.some((session) => session.status === "pending" && typeof session.associationKey === "string"
          && (session.associationKey.startsWith("pi-web:") || session.associationKey.startsWith("launch-"))
          && !workstreamReconciliationConflicts.has(session.associationKey)));
        const reconciled = (await Promise.all(candidates.map((snapshot) => coordinator.reconcile(snapshot)))).flat();
        for (const result of reconciled) if (result.status === "conflict" && result.associationKey !== undefined) workstreamReconciliationConflicts.set(result.associationKey, result.reason);
        const conflict = reconciled.find((result) => result.status === "conflict");
        if (conflict !== undefined) reconciliationError = conflict.reason;
        else if (workstreamReconciliationConflicts.size > 0) reconciliationError = workstreamReconciliationConflicts.values().next().value;
        if (reconciled.some((result) => ["confirmed", "cancelled", "failed"].includes(result.status))) {
          projection = await reconcileWorkstreams(workstreamClient, projection);
        }
      }
      recordedWorkstreamState.status = "ready";
      recordedWorkstreamState.snapshots = projection.snapshots;
      recordedWorkstreamState.sequence = projection.sequence;
      recordedWorkstreamState.error = reconciliationError;
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
  const inventoryNotice = unifiedInventoryNotice(joined, options.onRefresh, options.sessionNavigationCompatibility);
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
  const continuation = navigatorContinuationText(item);
  copy.append(strong(item.title), message(continuation, "muted"), message(`Revision ${String(item.revision)} · ${String(item.sessionCount)} sessions · ${humanize(item.health)} checkpoint`, "session-anchor"));
  const status = message(item.closed ? "Closed" : item.unresolvedTasks === 0 ? "Current" : `${String(item.unresolvedTasks)} need you`, item.unresolvedTasks === 0 ? "navigation-state" : "attention-action navigation-state");
  control.append(copy, status);
  control.setAttribute("aria-label", `${item.title}. ${status.textContent}. ${humanize(item.health)} checkpoint. ${continuation}`);
  return control;
}

function unifiedInventoryNotice(joined, onRefresh, compatibility = { supported: true }) {
  if (joined.status === "ready") return undefined;
  const detail = !compatibility.supported
    ? compatibility.message
    : joined.status === "unavailable"
      ? "Chat inventory is temporarily unavailable. Retained native sessions remain unclassified; canonical Workstreams remain available."
      : joined.status === "invalid" ? `${joined.reason ?? "Chat inventory is invalid."} Retained native sessions remain unclassified; canonical Workstreams remain available.`
        : joined.status === "reconnecting" ? "Reconnecting Chat inventory. Retained native sessions remain unclassified until reconciliation completes."
          : "Loading and reconciling Chat inventory with canonical Workstream associations.";
  const notice = document.createElement("div");
  notice.className = "connection unified-inventory-state";
  notice.append(message(detail));
  if (compatibility.supported && (joined.status === "unavailable" || joined.status === "reconnecting") && onRefresh !== undefined) notice.append(button("Refresh Chats", onRefresh));
  return notice;
}

export function hostedChatViewRequiresRemount(view, surfaceHost) {
  return view === undefined || view.surfaceHost !== surfaceHost;
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
    syncUnifiedChatOverlay(view, narrowViewportMatches());
  };
  view.navigate = button("Navigate", () => {
    if (!narrowViewportMatches()) return;
    view.overlayOpen = true;
    syncUnifiedChatOverlay(view, true);
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
  view.surfaceTabs = document.createElement("div");
  view.tools.append(view.navigatorToggle, view.surfaceTabs);
  view.toolButtons = new Map();
  for (const [surface, labelText] of [["chat", "Chat"], ["files", "Files"], ["git", "Git"]]) {
    const control = button(labelText, () => { view.options.onSelectSurface(surface); });
    view.toolButtons.set(surface, control);
    view.surfaceTabs.append(control);
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
  view.navigationContent = document.createElement("div");
  view.navigationContent.className = "unified-navigation-content";
  view.navigation.append(view.overlayClose, view.navigationContent);
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
  installTerminalDock(view);
  view.navigation.addEventListener("keydown", (event) => {
    const active = view.element.getRootNode().activeElement;
    const action = narrowOverlayKeyboardAction({ narrow: narrowViewportMatches(), open: view.overlayOpen, focusInside: view.navigation.contains(active), key: event.key });
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
  view.backgroundElements = [view.banner, header, view.separator, view.content, view.terminal];
  shell.append(view.banner, header, view.body, view.terminal);
  view.element = shell;
  view.options = options;
  return view;
}

function updateUnifiedChatDestination(view, options) {
  view.options = options;
  view.sessionKey = completeSessionKey(options.chat);
  view.surfaceHost = options.context?.surfaceHost;
  view.element.style.setProperty("--navigator-width", `${String(options.navigation.width)}px`);
  view.title.textContent = options.chat.title;
  view.scope.textContent = `Chat · ${sessionAnchor(options.chat)}`;
  updateRenderedRegion(view.banner, unifiedChatBannerRenderKey(options), () => renderUnifiedChatBanner(options));
  view.banner.hidden = view.banner.childElementCount === 0;
  updateRenderedRegion(view.navigationContent, unifiedNavigatorRenderKey(options), () => renderUnifiedHierarchy(options), view.navigation);
  syncUnifiedChatOverlay(view, narrowViewportMatches());
  retainModalFocus(view.navigation, view.overlayClose, narrowViewportMatches() && view.overlayOpen);
  view.navigatorToggle.textContent = options.navigation.mode === "collapsed" ? "Expand navigator" : "Collapse navigator";
  view.navigatorToggle.setAttribute("aria-expanded", String(options.navigation.mode !== "collapsed"));
  view.body.className = `unified-destination-body ${options.navigation.mode}`;
  view.separator.hidden = options.navigation.mode === "collapsed";
  view.separator.setAttribute("aria-valuenow", String(options.navigation.width));
  view.separator.setAttribute("aria-valuetext", `${String(options.navigation.width)} pixels`);
  for (const [surface, control] of view.toolButtons) {
    const active = surface === options.surface;
    if (active) control.setAttribute("aria-current", "page");
    else control.removeAttribute("aria-current");
  }
  for (const [surface, container] of view.surfaces) setSurfaceVisibility(container, surface === options.surface);
  updateTerminalDock(view, options, true, options.anchor);
}

function syncUnifiedChatOverlay(view, narrow) {
  if (!narrow) view.overlayOpen = false;
  const open = narrow && view.overlayOpen;
  view.navigation.hidden = narrow && !open;
  view.navigation.setAttribute("role", open ? "dialog" : "navigation");
  if (open) view.navigation.setAttribute("aria-modal", "true");
  else view.navigation.removeAttribute("aria-modal");
  view.navigate.setAttribute("aria-expanded", String(open));
  view.scrim.hidden = !open;
  view.scrim.inert = !open;
  view.scrim.setAttribute("aria-hidden", String(!open));
  setOverlayBackgroundInert(view.backgroundElements, open);
}

function renderUnifiedChatBanner(options) {
  const content = document.createDocumentFragment();
  if (options.reconnecting) content.append(message("Reconnecting. This Chat remains visible, but its inventory may be stale.", "connection"));
  else if (options.joined.status === "unavailable") content.append(message("Chat inventory is unavailable. This selected native session may be stale.", "connection"));
  if (options.error !== undefined) content.append(renderSelectionRecovery(options.error, options));
  if (options.refreshError !== undefined) content.append(message(selectionFailureMessage(options.refreshError), "checkpoint-error"));
  return content;
}

function selectionFailureMessage(error) {
  const code = error?.code === undefined ? "SESSION_SELECTION_FAILED" : String(error.code);
  const detail = error?.message === undefined ? "The selected location could not be opened." : String(error.message);
  return `${detail} (${code}). The previous destination remains open.`;
}

function renderStartLocationRecovery(options) {
  const recovery = document.createElement("div");
  recovery.className = "checkpoint-error selection-recovery";
  recovery.append(message(INCOMPLETE_START_MESSAGE));
  if (typeof options.context?.host?.openActions === "function") {
    const actions = document.createElement("div");
    actions.className = "recovery-actions";
    actions.append(keyedButton("Open Actions / Projects", "start-recovery:open-actions", () => { options.context.host.openActions(); }));
    recovery.append(actions);
  }
  return recovery;
}

function renderSelectionRecovery(error, options) {
  const recovery = document.createElement("div");
  recovery.className = "checkpoint-error selection-recovery";
  recovery.append(message(selectionFailureMessage(error)));
  const actions = document.createElement("div");
  actions.className = "recovery-actions";
  actions.append(keyedButton("Retry open", "selection-recovery:retry", options.onRetrySelection));
  if (options.onRefresh !== undefined) actions.append(keyedButton("Refresh Chats", "selection-recovery:refresh", options.onRefresh));
  recovery.append(actions);
  return recovery;
}

export function typedHostError(error, fallbackCode) {
  return { code: typeof error?.code === "string" ? error.code : fallbackCode, message: errorMessage(error) };
}

export function startLocationFailureMessage(error) {
  return `${error.message} (${error.code}). A new Workstream session was not started.`;
}

function typedSelectionError(error) {
  return typedHostError(error, "SESSION_SELECTION_FAILED");
}

function typedAttentionError(error, fallbackCode, fallbackMessage) {
  if (error === undefined) return { code: fallbackCode, message: fallbackMessage };
  const typed = typedHostError(error, fallbackCode);
  return { ...typed, message: typed.message || fallbackMessage };
}

function createDedicatedWorkstream(snapshot, options) {
  const view = { workstreamId: snapshot.id, surfaceHost: options.context?.surfaceHost, options, surfaces: new Map() };
  const shell = document.createElement("section");
  shell.className = "workstream-shell";
  view.element = shell;

  const banner = document.createElement("div");
  banner.className = "shell-banner";
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
  for (const [tool, labelText] of [["chat", "Chat"], ["context", "Context"], ["files", "Files"], ["git", "Git"]]) {
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

  view.sessionTabs = document.createElement("nav");
  view.sessionTabs.className = "session-tabs";
  view.sessionTabs.setAttribute("aria-label", "Workstream session tabs");

  const mobileNavigation = document.createElement("nav");
  mobileNavigation.className = "mobile-pane-navigation";
  mobileNavigation.setAttribute("aria-label", "Workstream destinations");
  view.mobileButtons = new Map();
  for (const destination of ["sessions", "workspace"]) {
    const control = button("", () => { view.options.onSelectMobilePane(destination); });
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
  view.workspace = workspace;
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
  view.hostUnavailable = message("Update PI WEB to use host-owned Chat, Files, Git, and Terminal surfaces.", "empty-pane host-surface-unavailable");
  view.surfaceStack.append(view.hostUnavailable);
  view.contextSurface = document.createElement("section");
  view.contextSurface.className = "adapter-context-surface";
  view.contextSurface.dataset.surface = "context";
  view.contextSurface.tabIndex = -1;
  view.surfaces.set("context", view.contextSurface);
  view.surfaceStack.append(view.contextSurface);
  view.briefSurface = document.createElement("article");
  view.briefSurface.className = "workstream-brief";
  workspace.append(workspaceHeading, view.briefSurface, view.surfaceStack);
  view.scrim = button("Close navigator", () => {
    view.options.onSelectMobilePane("workspace");
    view.mobileButtons.get("sessions")?.focus({ preventScroll: true });
  });
  view.scrim.className = "overlay-scrim";
  body.append(sessions, view.scrim, view.sessionsEdge, workspace);

  installTerminalDock(view);

  sessions.addEventListener("keydown", (event) => {
    const active = view.element.getRootNode().activeElement;
    if (!narrowViewportMatches() || view.options.mobilePane !== "sessions" || !sessions.contains(active)) return;
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
  view.backgroundElements = [banner, topbar, view.sessionTabs, mobileNavigation, view.sessionsEdge, workspace, view.terminal];
  shell.append(banner, topbar, view.sessionTabs, mobileNavigation, body, view.terminal);
  updateDedicatedWorkstream(view, snapshot, options);
  return view;
}

function renderDedicatedBanner(snapshot, options) {
  const content = document.createDocumentFragment();
  if (options.reconnecting) content.append(message("Reconnecting. The last recorded Workstream projection remains visible.", "connection"));
  if (options.selectionError !== undefined) content.append(renderSelectionRecovery(options.selectionError, options));
  if (options.refreshError !== undefined) content.append(message(selectionFailureMessage(options.refreshError), "checkpoint-error"));
  else if (options.startLocationIncomplete) content.append(renderStartLocationRecovery(options));
  else if (options.error) content.append(message(options.error, "checkpoint-error"));
  else if (options.notice) content.append(message(options.notice, "receipt"));
  const repairSession = snapshot.sessions.find((session) => session.id === options.anchorRepair?.sessionId);
  if (!snapshot.closed && repairSession?.status === "active" && !completeSessionLocation(repairSession)) {
    content.append(renderSessionAnchorRepair(options.anchorRepair, repairSession, options));
  }
  return content;
}

function renderCollapsedSessionTabs(snapshot, options) {
  const content = document.createDocumentFragment();
  content.append(keyedButton("Expand navigator", "session-tabs:expand", () => { options.onToggleSessions(); }));
  const destinations = document.createElement("div");
  destinations.className = "collapsed-session-destinations";
  const briefTab = keyedButton("Brief", "session-tabs:brief", () => { options.onOpenBrief(); });
  if (options.selectedSessionId === undefined) briefTab.setAttribute("aria-current", "page");
  destinations.append(briefTab);
  for (const session of snapshot.sessions) {
    const attention = attentionForWorkstreamSession(options.attentionItems, session);
    const entry = document.createElement("div");
    entry.className = "collapsed-session-entry";
    const tabLabel = `${session.purpose ?? session.latestCheckpoint?.next ?? `${humanize(session.status)} session`}${attention === undefined ? "" : " · Needs answer"}`;
    const tab = keyedButton(tabLabel, `session-tabs:session:${session.id}`, () => { options.onSelectSession(session); });
    tab.disabled = session.status !== "active";
    if (session.id === options.selectedSessionId) tab.setAttribute("aria-current", "page");
    tab.title = `${sessionAnchor(session)} · Session ${session.id}${attention === undefined ? "" : " · Needs answer"}`;
    entry.append(tab);
    if (attention !== undefined && session.status === "active") {
      const focus = keyedButton("Focus pending ask", `session-tabs:attention:${session.id}`, () => { options.onFocusAttention(attention); });
      focus.className = "attention-navigation-action";
      focus.setAttribute("aria-label", `Focus pending ask in session ${session.id}`);
      entry.append(focus);
    }
    destinations.append(entry);
  }
  content.append(destinations);
  if (!snapshot.closed) content.append(keyedButton("New session +", "session-tabs:new", () => { options.onStart(); }));
  return content;
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

  updateRenderedRegion(view.banner, dedicatedBannerRenderKey(snapshot, options), () => renderDedicatedBanner(snapshot, options));
  view.banner.hidden = view.banner.childElementCount === 0;

  for (const [tool, control] of view.toolButtons) {
    const selectedTool = options.selectedSessionId !== undefined && options.tool === tool;
    control.disabled = options.selectedSessionId === undefined;
    if (selectedTool) control.setAttribute("aria-current", "page");
    else control.removeAttribute("aria-current");
  }
  const mobileLabels = {
    sessions: `Navigate · ${String(active.length)}`,
    workspace: options.selectedSessionId === undefined ? "Brief" : surfaceLabel(options.tool),
  };
  for (const [destination, control] of view.mobileButtons) {
    const controlState = dedicatedMobileControlState(options, destination);
    control.textContent = mobileLabels[destination];
    control.setAttribute("aria-label", destination === "workspace"
      ? `Open Workspace${options.selectedSessionId === undefined ? " brief" : ` · ${surfaceLabel(options.tool)}`}`
      : "Open Workstream session navigator");
    if (controlState.selected) control.setAttribute("aria-current", "page");
    else control.removeAttribute("aria-current");
    if (destination === "sessions") {
      control.setAttribute("aria-expanded", String(controlState.selected));
      control.setAttribute("aria-controls", "workstream-sessions-pane");
    } else {
      control.removeAttribute("aria-expanded");
      control.removeAttribute("aria-controls");
    }
  }

  const narrowNavigatorOpen = narrowViewportMatches() && options.mobilePane === "sessions";
  view.body.className = `workstream-body mobile-${options.mobilePane}${options.sessionsPaneOpen ? "" : " sessions-collapsed"}`;
  view.scrim.hidden = !narrowNavigatorOpen;
  view.scrim.inert = !narrowNavigatorOpen;
  view.scrim.setAttribute("aria-hidden", String(!narrowNavigatorOpen));
  setOverlayBackgroundInert(view.backgroundElements, narrowNavigatorOpen);
  view.sessionsPane = view.sessionsPane ?? view.element.querySelector(".sessions-pane");
  view.sessionsPane.setAttribute("role", narrowNavigatorOpen ? "dialog" : "navigation");
  if (narrowNavigatorOpen) view.sessionsPane.setAttribute("aria-modal", "true");
  else view.sessionsPane.removeAttribute("aria-modal");
  view.sessionsCollapse.setAttribute("aria-expanded", String(options.sessionsPaneOpen));
  view.sessionsEdge.hidden = !options.sessionsPaneOpen;
  view.sessionsEdge.setAttribute("aria-valuenow", String(options.navigatorWidth));
  view.sessionsEdge.setAttribute("aria-valuetext", `${String(options.navigatorWidth)} pixels`);
  view.sessionTabs.hidden = options.sessionsPaneOpen;
  updateRenderedRegion(view.sessionTabs, collapsedSessionTabsRenderKey(snapshot, options), () => renderCollapsedSessionTabs(snapshot, options));

  const inventoryNotice = unifiedInventoryNotice(options.joined, options.onRefresh, options.sessionNavigationCompatibility);
  updateRenderedRegion(
    view.navigationNotice,
    inventoryNoticeRenderKey(options.joined, options.onRefresh !== undefined, options.sessionNavigationCompatibility?.supported !== false),
    () => inventoryNotice ?? document.createDocumentFragment(),
  );
  view.navigationNotice.hidden = inventoryNotice === undefined;
  updateRenderedRegion(
    view.sessionsList,
    expandedSessionListRenderKey(snapshot, options),
    () => renderExpandedSessionList(snapshot, options),
    view.sessionsPane,
  );
  retainModalFocus(view.sessionsPane, view.sessionsClose, narrowNavigatorOpen);

  const selected = snapshot.sessions.find((session) => session.id === options.selectedSessionId);
  const layout = dedicatedWorkstreamLayout(options);
  const toolName = selected === undefined ? "Workstream brief" : surfaceLabel(layout.surface);
  view.toolName.textContent = toolName;
  const scope = selected === undefined ? `Canonical Workstream · revision ${String(snapshot.revision)}`
    : layout.scope === "canonical-selected-session-context" ? "Canonical selected-session context"
      : layout.scope === "selected-session-checkout-observed-unattributed"
        ? "Selected checkout · current observed changes, unattributed"
        : "Selected session checkout";
  view.scope.textContent = `${scope}${selected === undefined ? "" : ` · ${sessionAnchor(selected)}`}`;
  const actionRenderKey = `actions:${String(snapshot.revision)}:${selected?.id ?? "brief"}:${snapshot.closed ? "closed" : "open"}`;
  if (view.checkpointActions.dataset.renderKey !== actionRenderKey) {
    const focusedAction = focusedDescendantKey(view.checkpointActions);
    view.checkpointActions.replaceChildren();
    view.checkpointActions.dataset.renderKey = actionRenderKey;
    if (selected?.status === "active" && !snapshot.closed) {
      view.checkpointActions.append(
        keyedButton("Resume", `session:${selected.id}:resume`, () => { view.options.onResume(selected); }),
        keyedButton("Ask Pi", `session:${selected.id}:ask`, () => { view.options.onRequestCheckpoint(selected); }),
        keyedButton("Confirm checkpoint", `session:${selected.id}:checkpoint`, () => { view.options.onSaveCheckpoint(selected); }),
      );
    } else if (selected === undefined && !snapshot.closed) {
      view.checkpointActions.append(
        keyedButton("Add reference link", "brief:add-reference", () => { view.options.onAppendLink(); }),
        keyedButton("Close Workstream", "brief:close", () => { view.options.onClose(); }),
      );
    }
    restoreDescendantFocus(view.checkpointActions, focusedAction);
  }

  const surfacesAvailable = options.context?.surfaceHost !== undefined;
  const brief = projectWorkstreamBrief(snapshot, options.rememberedSessionKey);
  view.briefSurface.hidden = selected !== undefined;
  if (selected === undefined) {
    updateCanonicalSurface(view.briefSurface, canonicalSurfaceRenderKey(snapshot, undefined, options.rememberedSessionKey), () => renderWorkstreamBrief(brief, snapshot, view));
  }
  view.surfaceStack.hidden = selected === undefined;
  for (const [surface, container] of view.surfaces) {
    const available = surface === "context" || surfacesAvailable;
    setSurfaceVisibility(container, selected !== undefined && available && surface === options.tool);
  }
  if (selected !== undefined && options.tool === "context") {
    updateCanonicalSurface(view.contextSurface, canonicalSurfaceRenderKey(snapshot, selected.id), () => renderSessionContext(projectSessionContext(snapshot, selected.id), snapshot, view));
  }
  view.hostUnavailable.hidden = selected === undefined || options.tool === "context" || surfacesAvailable;

  updateTerminalDock(view, options, selected !== undefined, selected === undefined ? undefined : `${sessionAnchor(selected)} · Session ${selected.id}`);
}

function renderExpandedSessionList(snapshot, options) {
  const content = document.createDocumentFragment();
  if (snapshot.sessions.length === 0) content.append(message("No sessions yet. Start one from an explicitly selected PI WEB checkout.", "empty-pane"));
  for (const session of snapshot.sessions) {
    const attention = attentionForWorkstreamSession(options.attentionItems, session);
    const entry = document.createElement("div");
    entry.className = "dedicated-session-entry";
    const row = keyedButton("", `session:${snapshot.id}:${session.id}`, () => { options.onSelectSession(session); });
    row.className = `dedicated-session${session.id === options.selectedSessionId ? " selected" : ""}`;
    if (session.id === options.selectedSessionId) row.setAttribute("aria-current", "page");
    row.disabled = session.status !== "active" || options.selectionPending;
    const copy = document.createElement("span");
    const purpose = session.purpose ?? session.latestCheckpoint?.next ?? `${humanize(session.status)} session`;
    copy.append(strong(purpose), message(`${sessionAnchor(session)} · ${humanize(session.status)}`, "session-anchor"), message(`Session ${session.id}`, "diagnostic"));
    if (session.launchFailure != null) copy.append(message(`Launch failed: ${typeof session.launchFailure === "string" ? session.launchFailure : session.launchFailure.reason}`, "checkpoint-error inline-error"));
    if (session.checkpointFailure != null) copy.append(message(`Checkpoint failed: ${typeof session.checkpointFailure === "string" ? session.checkpointFailure : session.checkpointFailure.reason}`, "checkpoint-error inline-error"));
    if (session.checkpointStaleness != null) copy.append(message(`Checkpoint stale: ${session.checkpointStaleness.reason}`, "checkpoint-error inline-error"));
    row.append(copy);
    entry.append(row);
    if (attention !== undefined) {
      const focus = keyedButton("Focus pending ask", `session:${snapshot.id}:${session.id}:attention`, () => { options.onFocusAttention(attention); });
      focus.className = "attention-navigation-action";
      entry.append(focus);
    }
    content.append(entry);
  }
  return content;
}

function updateCanonicalSurface(container, renderKey, render) {
  updateRenderedRegion(container, renderKey, render);
}

function updateRenderedRegion(container, renderKey, render, scrollContainer = container) {
  if (container.dataset.renderKey === renderKey) return;
  const scrollTop = scrollContainer.scrollTop;
  const scrollLeft = scrollContainer.scrollLeft;
  const focusedKey = focusedDescendantKey(container);
  container.replaceChildren(render());
  container.dataset.renderKey = renderKey;
  scrollContainer.scrollTop = scrollTop;
  scrollContainer.scrollLeft = scrollLeft;
  restoreDescendantFocus(container, focusedKey);
}

function focusedDescendantKey(container) {
  const active = container.getRootNode().activeElement;
  return active !== null && container.contains(active) ? active.dataset?.focusKey : undefined;
}

function restoreDescendantFocus(container, focusKey) {
  if (focusKey === undefined) return;
  const target = [...container.querySelectorAll("[data-focus-key]")].find((control) => control.dataset.focusKey === focusKey);
  target?.focus({ preventScroll: true });
}

function renderWorkstreamBrief(brief, snapshot, view) {
  const content = document.createDocumentFragment();

  const identity = briefSection("Workstream");
  identity.append(strong(brief.title ?? brief.id ?? "Untitled Workstream"));
  identity.append(message(`Revision ${String(brief.revision)} · ${brief.closed ? "Closed" : "Open"}${brief.closedAt === null ? "" : ` · closed ${formatDateTime(brief.closedAt)}`}`, "brief-state"));
  const health = document.createElement("div");
  health.className = "brief-health-list";
  if (brief.checkpointHealth.length === 0) health.append(message("No sessions; checkpoint health is missing.", "muted"));
  for (const item of brief.checkpointHealth) health.append(message(`Session ${item.sessionId}: ${humanize(item.status)} checkpoint`, `checkpoint-health ${item.status}`));
  identity.append(health);
  content.append(identity);

  const continuation = briefSection("Next resumable session");
  if (!brief.continuation.resumable) {
    continuation.append(strong("No resumable session"));
    if (brief.continuation.sessionId !== undefined) continuation.append(message(`Session ${brief.continuation.sessionId} · ${humanize(brief.continuation.sessionStatus)} · ${humanize(brief.continuation.status)}`, `checkpoint-health ${brief.continuation.status}`));
    continuation.append(message(brief.continuation.reason, "checkpoint-error inline-error"));
  } else {
    continuation.append(strong(`Session ${brief.continuation.sessionId} · active · complete anchor`));
    continuation.append(message(`${humanize(brief.continuation.status)} checkpoint`, `checkpoint-health ${brief.continuation.status}`));
    if (brief.continuation.next !== undefined) continuation.append(message(brief.continuation.next, "next"));
    if (brief.continuation.status !== "current") continuation.append(message(brief.continuation.reason ?? "Confirmed continuation is unavailable.", "checkpoint-error inline-error"));
  }
  content.append(continuation);

  const tasks = briefSection(`Unresolved Human Tasks · ${String(brief.unresolvedHumanTasks.length)}`);
  appendHumanTasks(tasks, brief.unresolvedHumanTasks, snapshot, view);
  content.append(tasks);

  const updates = briefSection("Per-session confirmed updates");
  if (brief.sessions.length === 0) updates.append(message("No sessions have been recorded.", "muted"));
  for (const session of brief.sessions) updates.append(renderConfirmedUpdate(session));
  content.append(updates);

  const index = briefSection("Session index");
  if (brief.sessions.length === 0) index.append(message("No sessions.", "muted"));
  for (const session of brief.sessions) {
    const row = document.createElement("div");
    row.className = "brief-index-row";
    row.append(strong(`Session ${session.id}`), message(humanize(session.status), `session-status ${session.status}`));
    row.append(message(session.anchor.complete ? sessionAnchor(session.anchor) : "Complete checkout anchor missing", session.anchor.complete ? "session-anchor" : "checkpoint-error inline-error"));
    index.append(row);
  }
  content.append(index);

  const links = briefSection(`Links · ${String(brief.links.length)}`);
  appendLinks(links, brief.links);
  content.append(links);
  return content;
}

function renderSessionContext(context, snapshot, view) {
  const content = document.createDocumentFragment();
  if (context === undefined) {
    content.append(message("Selected session context is unavailable.", "checkpoint-error"));
    return content;
  }
  const actions = document.createElement("div");
  actions.className = "context-actions";
  actions.append(keyedButton("Open full brief", "context:open-brief", () => { view.options.onOpenBrief(); }));
  content.append(actions);

  const checkpoint = briefSection(`Selected checkpoint · ${humanize(context.session.checkpointStatus)}`);
  checkpoint.append(message(`Session ${context.session.id}`, "diagnostic"));
  checkpoint.append(message(context.session.anchor.complete ? sessionAnchor(context.session.anchor) : "Complete checkout anchor missing", context.session.anchor.complete ? "session-anchor" : "checkpoint-error inline-error"));
  checkpoint.append(renderConfirmedUpdate(context.session));
  content.append(checkpoint);

  const tasks = briefSection(`Relevant Human Tasks · ${String(context.humanTasks.length)}`);
  appendHumanTasks(tasks, context.humanTasks, snapshot, view);
  content.append(tasks);
  const links = briefSection(`Relevant links · ${String(context.links.length)}`);
  appendLinks(links, context.links);
  content.append(links);
  return content;
}

function renderConfirmedUpdate(session) {
  const item = document.createElement("article");
  item.className = "confirmed-update";
  item.append(strong(`Session ${session.id} · ${humanize(session.checkpointStatus)}`));
  if (session.launchFailure !== null && session.launchFailure !== undefined) item.append(message(`Session launch failed: ${typeof session.launchFailure === "string" ? session.launchFailure : session.launchFailure.reason}`, "checkpoint-error inline-error"));
  if (session.checkpointFailure !== null && session.checkpointFailure !== undefined) {
    item.append(message(`Checkpoint failed: ${typeof session.checkpointFailure === "string" ? session.checkpointFailure : session.checkpointFailure.reason}`, "checkpoint-error inline-error"));
    if (session.priorCheckpointAvailable) item.append(message("The fields below are from the prior confirmed checkpoint retained after that failure.", "prior-confirmed-checkpoint"));
  }
  if (session.checkpointStaleness !== null && session.checkpointStaleness !== undefined) item.append(message(`Checkpoint stale: ${session.checkpointStaleness.reason}`, "checkpoint-error inline-error"));
  if (!session.confirmedCheckpointAvailable) {
    item.append(message("No confirmed checkpoint fields are available.", "muted"));
    return item;
  }
  item.append(field("What changed", session.whatChanged), field("What remains", session.remains), field("Next useful action", session.next));
  const prompt = field("Next-session prompt", session.nextSessionPrompt ?? "Unavailable for this confirmed checkpoint");
  if (typeof session.nextSessionPrompt === "string") prompt.append(keyedButton("Copy exact prompt", `checkpoint:${session.id}:copy-prompt`, () => { void copyNextSessionPrompt(session.nextSessionPrompt); }));
  item.append(prompt);
  const references = field("References", session.references.length === 0 ? "None recorded" : session.references.join("\n"));
  references.classList.add("checkpoint-references");
  item.append(references);
  return item;
}

function appendHumanTasks(container, tasks, snapshot, view) {
  if (tasks.length === 0) container.append(message("Nothing unresolved needs owner attention.", "muted"));
  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "dedicated-task";
    const copy = document.createElement("div");
    copy.append(strong(task.title));
    if (task.detail) copy.append(message(task.detail, "muted"));
    copy.append(message(`Materiality: ${task.materiality ?? "not recorded"}`, "task-source"));
    copy.append(message(task.sourceSessionId ? `Source: session ${task.sourceSessionId}` : "Source session not recorded", "task-source"));
    if (task.status === "answered" && task.answer !== null) {
      const answerText = task.answer.kind === "free-text" ? task.answer.text : task.options.find((option) => option.id === task.answer.optionId)?.label ?? task.answer.optionId;
      copy.append(message(`Answered: ${answerText}`, "receipt inline-answer"));
    }
    row.append(copy);
    const taskActions = document.createElement("div");
    taskActions.className = "task-answer-actions";
    if (!snapshot.closed && task.status === "pending" && task.answerKind === "free-text") taskActions.append(keyedButton("Answer", `task:${task.id}:answer`, () => {
      const text = window.prompt(task.title, task.answer?.text ?? "");
      if (text?.trim()) view.options.onAnswerTask(task, { kind: "free-text", text: text.trim() });
    }));
    else if (!snapshot.closed && task.status === "pending" && (task.answerKind === "yes-no" || task.answerKind === "choice")) {
      for (const choice of task.options) taskActions.append(keyedButton(`Answer: ${choice.label}`, `task:${task.id}:answer:${choice.id}`, () => { view.options.onAnswerTask(task, { kind: task.answerKind, optionId: choice.id }); }));
    }
    if (!snapshot.closed && (task.answerKind == null || task.status === "answered")) taskActions.append(keyedButton("Resolve", `task:${task.id}:resolve`, () => { view.options.onResolveTask(task); }));
    row.append(taskActions);
    container.append(row);
  }
}

function appendLinks(container, links) {
  if (links.length === 0) container.append(message("No ordinary Workstream links recorded.", "muted"));
  for (const link of links) container.append(message(link.label == null || link.label === "" ? link.reference : `${link.label} · ${link.reference}`, "links"));
}

function briefSection(titleText) {
  const container = document.createElement("section");
  container.className = "brief-section";
  const heading = document.createElement("h3");
  heading.textContent = titleText;
  container.append(heading);
  return container;
}

function field(name, value) {
  const container = document.createElement("div");
  container.className = "checkpoint-field";
  container.append(label(name), message(value ?? "Not recorded", "checkpoint-field-value"));
  return container;
}

function renderSessionAnchorRepair(repair, session, options) {
  const presentation = sessionAnchorRepairPresentation(repair);
  const panel = document.createElement("section");
  panel.className = "anchor-repair";
  panel.append(strong(presentation.title), message(presentation.guidance, "muted"));
  const actions = document.createElement("div");
  actions.className = "anchor-repair-actions";
  if (repair.status === "found") {
    actions.append(message(presentation.candidates[0].label, "session-anchor"));
  } else if (repair.status === "ambiguous") {
    repair.result.locations.forEach((candidate, index) => {
      const choice = keyedButton(presentation.candidates[index].label, `anchor-repair:candidate:${String(index)}`, () => { options.onSelectAnchorRepairCandidate(candidate); });
      choice.setAttribute("aria-pressed", String(presentation.candidates[index].selected));
      actions.append(choice);
    });
  }
  if (presentation.confirmEnabled) actions.append(keyedButton("Confirm session location", "anchor-repair:confirm", () => { options.onConfirmSessionAnchor(session); }));
  if (presentation.retryEnabled) {
    const machineName = repair.machine.name === repair.machine.id ? repair.machine.id : `${repair.machine.name} (${repair.machine.id})`;
    actions.append(keyedButton(`Scan ${machineName}`, "anchor-repair:scan", () => { options.onResolveSessionAnchor(session); }));
  }
  panel.append(actions);
  return panel;
}

function retainModalFocus(modal, fallback, open) {
  if (!open || !modal.isConnected) return;
  const active = modal.getRootNode().activeElement;
  if (!modal.contains(active)) fallback.focus({ preventScroll: true });
}

function setOverlayBackgroundInert(elements, inert) {
  for (const element of elements) {
    element.inert = inert;
    element.setAttribute("aria-hidden", String(inert));
  }
}

function setSurfaceVisibility(container, visible) {
  container.hidden = !visible;
  container.inert = !visible;
  container.setAttribute("aria-hidden", String(!visible));
}

function installTerminalDock(view) {
  view.terminal = document.createElement("section");
  view.terminal.className = "terminal-drawer";
  view.terminalResize = document.createElement("div");
  view.terminalResize.className = "terminal-resize-separator";
  configureTerminalResizeSeparator(view.terminalResize, () => view.options.terminalHeight, (height, persist) => { view.options.onTerminalResize(height, persist); });
  view.terminalToggle = button("", () => { view.options.onToggleTerminal(); });
  view.terminalToggle.title = "Terminal for selected session checkout";
  view.terminalScope = message("", "terminal-scope");
  view.terminalContent = document.createElement("div");
  view.terminalContent.className = "terminal-content";
  view.terminalContent.id = "selected-session-terminal-dock";
  view.terminalToggle.setAttribute("aria-controls", view.terminalContent.id);
  view.terminal.append(view.terminalResize, view.terminalToggle, view.terminalScope, view.terminalContent);
}

function updateTerminalDock(view, options, enabled, anchor) {
  const bounds = renderedTerminalHeightBounds(options.terminalHeight, window.innerHeight);
  view.terminal.classList.toggle("open", options.terminalOpen && enabled);
  view.terminal.style.height = options.terminalOpen && enabled ? `${String(bounds.height)}px` : "";
  view.terminalToggle.textContent = options.terminalOpen && enabled ? "Hide Terminal ↓" : enabled ? `Terminal ↑ · ${anchor}` : "Terminal ↑";
  view.terminalToggle.disabled = !enabled;
  view.terminalToggle.title = enabled ? `Terminal for ${anchor}` : "Select a Workstream session before opening Terminal";
  view.terminalToggle.setAttribute("aria-label", enabled ? `${options.terminalOpen ? "Hide" : "Open"} Terminal for ${anchor}` : "Terminal unavailable without a selected session checkout");
  view.terminalToggle.setAttribute("aria-expanded", String(options.terminalOpen && enabled));
  view.terminalScope.textContent = enabled ? `Selected session checkout · ${anchor}` : "Terminal unavailable without a selected session checkout.";
  view.terminalScope.hidden = !options.terminalOpen || !enabled;
  view.terminalResize.hidden = !options.terminalOpen || !enabled;
  view.terminalResize.setAttribute("aria-valuemin", String(bounds.minHeight));
  view.terminalResize.setAttribute("aria-valuemax", String(bounds.maxHeight));
  view.terminalResize.setAttribute("aria-valuenow", String(bounds.height));
  view.terminalResize.setAttribute("aria-valuetext", `${String(bounds.height)} pixels high; maximum ${String(bounds.maxHeight)} pixels for this viewport`);
  view.terminalContent.hidden = !options.terminalOpen || !enabled;
  if (options.terminalOpen && enabled && view.terminalSurface === undefined) {
    view.terminalSurface = mountedHostSurface(options.context, "terminal");
    view.terminalContent.append(view.terminalSurface);
  }
}

export function hostedSurfaceMountOptions(surface) {
  return surface === "chat" ? { chatStatusPlacement: "prompt-editor" } : undefined;
}

function mountedHostSurface(context, surface) {
  const container = document.createElement("div");
  container.className = `host-surface ${surface}-surface`;
  container.tabIndex = -1;
  try {
    const mountOptions = hostedSurfaceMountOptions(surface);
    if (mountOptions === undefined) context?.surfaceHost?.mount(container, surface);
    else context?.surfaceHost?.mount(container, surface, mountOptions);
  } catch (error) {
    container.append(message(`Could not open ${surface}: ${errorMessage(error)}`, "checkpoint-error"));
  }
  return container;
}

function configureTerminalResizeSeparator(edge, getHeight, onResize) {
  edge.setAttribute("role", "separator");
  edge.setAttribute("aria-label", "Resize Terminal dock");
  edge.setAttribute("aria-orientation", "horizontal");
  edge.tabIndex = 0;
  edge.addEventListener("keydown", (event) => {
    const delta = terminalKeyboardDelta(event.key, event.shiftKey);
    if (delta === undefined) return;
    event.preventDefault();
    const bounds = renderedTerminalHeightBounds(getHeight(), window.innerHeight);
    const requestedHeight = delta === -Infinity ? bounds.minHeight
      : delta === Infinity ? bounds.maxHeight : bounds.height + delta;
    onResize(renderedTerminalHeightBounds(requestedHeight, window.innerHeight).height, true);
  });
  let drag;
  edge.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const startHeight = renderedTerminalHeightBounds(getHeight(), window.innerHeight).height;
    drag = { pointerId: event.pointerId, startY: event.clientY, startHeight, height: startHeight };
    edge.setPointerCapture?.(event.pointerId);
  });
  edge.addEventListener("pointermove", (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag.height = renderedTerminalHeightBounds(drag.startHeight + drag.startY - event.clientY, window.innerHeight).height;
    onResize(drag.height, false);
  });
  const finish = (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    edge.releasePointerCapture?.(event.pointerId);
    const height = drag.height;
    drag = undefined;
    onResize(height, true);
  };
  edge.addEventListener("pointerup", finish);
  edge.addEventListener("pointercancel", finish);
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

function createLiveRegions() {
  const status = document.createElement("div");
  status.className = "live-region";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const alert = document.createElement("div");
  alert.className = "live-region";
  alert.setAttribute("role", "alert");
  alert.setAttribute("aria-live", "assertive");
  alert.setAttribute("aria-atomic", "true");
  return { status, alert };
}

function updateLiveRegions(regions, announcement) {
  const key = `${announcement?.severity ?? "off"}:${announcement?.text ?? ""}`;
  if (regions.status.dataset.announcementKey === key) return;
  regions.status.dataset.announcementKey = key;
  regions.alert.dataset.announcementKey = key;
  const statusText = announcement?.severity === "status" ? announcement.text : "";
  const alertText = announcement?.severity === "alert" ? announcement.text : "";
  if (regions.status.textContent !== statusText) regions.status.textContent = statusText;
  if (regions.alert.textContent !== alertText) regions.alert.textContent = alertText;
}

function workstreamsAnnouncement(state) {
  if (state.workstreamStatus === "error" || state.error !== "") return { severity: "alert", text: state.error || "Workstreams could not be loaded." };
  if (state.selectionError !== undefined) return { severity: "alert", text: selectionFailureMessage(state.selectionError) };
  if (state.refreshError !== undefined) return { severity: "alert", text: selectionFailureMessage(state.refreshError) };
  if (state.startLocationIncomplete) return { severity: "alert", text: INCOMPLETE_START_MESSAGE };
  if (state.connectionStatus === "reconnecting") return { severity: "status", text: `PI WEB is reconnecting${state.connectionMessage ? `: ${state.connectionMessage}` : "."}` };
  if (state.notice !== "") return { severity: "status", text: state.notice };
  if (state.inventoryStatus === "reconnecting") return { severity: "status", text: "Reconnecting Chat inventory." };
  if (state.inventoryStatus === "unavailable") return { severity: "status", text: "Chat inventory is unavailable." };
  if (state.inventoryStatus === "invalid") return { severity: "alert", text: state.inventoryReason ?? "Chat inventory is invalid." };
  if (state.anchorRepair !== undefined) return { severity: "status", text: sessionAnchorRepairPresentation(state.anchorRepair).title };
  return undefined;
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
    :host { box-sizing: border-box; flex: 1 1 auto; min-width: 0; min-height: 0; display: block; overflow-x: hidden; color: var(--pi-text); background: var(--pi-bg); font: 14px system-ui, sans-serif; }
    .live-region { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    main { box-sizing: border-box; width: min(100%, 1280px); min-height: 100%; display: grid; align-content: start; gap: 0; margin: 0 auto; padding: clamp(68px, 7vw, 92px) clamp(20px, 5vw, 72px) 40px; }
    main.dedicated-workstream { width: 100%; height: 100%; min-height: 0; margin: 0; padding: 0; display: flex; overflow: hidden; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--pi-toolbar-gap, 8px); }
    .portfolio-header { align-items: end; gap: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--pi-border); }
    .portfolio-header > div:first-child { max-width: 760px; }
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
    .shell-banner:not(:empty) { margin-left: 66px; }
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
    .workstream-tools, .workstream-tools > div, .workstream-utilities, .mobile-pane-navigation, .checkpoint-actions { display: flex; align-items: center; gap: 3px; }
    .mobile-pane-navigation { display: none; }
    .session-tabs { flex: 0 0 auto; min-width: 0; overflow-x: auto; display: flex; align-items: center; gap: 4px; padding: 6px 10px 6px 66px; border-bottom: 1px solid var(--pi-border); background: var(--pi-surface); }
    .collapsed-session-destinations { min-width: 0; display: flex; flex: 0 0 auto; align-items: center; gap: 2px; }
    .collapsed-session-entry { min-width: 0; display: flex; flex: 0 0 auto; align-items: center; gap: 2px; }
    .collapsed-session-entry .attention-navigation-action { position: static; }
    .session-tabs button { flex: 0 0 auto; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-tabs button[aria-current="page"] { background: var(--pi-selection-bg); color: var(--pi-text-bright); font-weight: 700; }
    .workstream-tools button { background: transparent; color: var(--pi-muted); }
    .workstream-tools button[aria-current="page"] { background: var(--pi-selection-bg); color: var(--pi-text); font-weight: 700; }
    .scope-label { color: var(--pi-muted); font-size: 11px; }
    .workstream-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: var(--navigator-width, 320px) 22px minmax(360px, 1fr); overflow: hidden; }
    .workstream-body.sessions-collapsed { grid-template-columns: 0 0 minmax(360px, 1fr); }
    .sessions-pane { min-width: 0; min-height: 0; overflow: auto; background: var(--pi-surface); grid-column: 1; }
    .workspace-pane { grid-column: 3; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--pi-bg); }
    .sessions-collapsed .sessions-pane { visibility: hidden; overflow: hidden; }
    .workstream-brief, .adapter-context-surface { min-width: 0; min-height: 0; overflow: auto; align-content: start; }
    .workstream-brief { flex: 1 1 auto; width: min(100%, 980px); box-sizing: border-box; margin: 0 auto; padding: clamp(16px, 3vw, 34px); }
    .adapter-context-surface { flex: 1 1 auto; padding: clamp(14px, 2vw, 24px); }
    .brief-section { min-width: 0; gap: 9px; padding: 18px 0; border-bottom: 1px solid var(--pi-border-muted); }
    .brief-section:last-child { border-bottom: 0; }
    .brief-section h3 { margin: 0; color: var(--pi-text-bright); font-size: 13px; }
    .brief-health-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .checkpoint-health, .session-status { width: max-content; border-radius: 999px; background: var(--pi-surface); padding: 3px 7px; font-size: 11px; }
    .checkpoint-health.stale, .checkpoint-health.failed, .checkpoint-health.missing { background: var(--pi-warning-surface); color: var(--pi-warning); }
    .confirmed-update { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--pi-border-muted); border-radius: 8px; }
    .checkpoint-field { display: grid; gap: 3px; }
    .checkpoint-field-value, .checkpoint-references { white-space: pre-wrap; user-select: text; }
    .checkpoint-field > button { width: max-content; }
    .brief-index-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 12px; padding: 10px 0; border-bottom: 1px solid var(--pi-border-muted); }
    .brief-index-row .session-anchor, .brief-index-row .checkpoint-error { grid-column: 1 / -1; }
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
    .pane-heading h2, .workspace-heading h2 { margin: 0; font-size: 16px; }
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
    .terminal-drawer { flex: 0 0 auto; min-height: 0; display: grid; gap: 0; justify-items: center; border-top: 1px solid var(--pi-border); background: var(--pi-bg); }
    .terminal-drawer > button { min-width: 130px; max-width: min(100%, 56ch); min-height: max(44px, var(--pi-control-min-size, 44px)); overflow: hidden; padding-block: 2px; border-radius: 8px 8px 0 0; text-overflow: ellipsis; white-space: nowrap; }
    .terminal-drawer.open { grid-template: 6px auto auto minmax(0, 1fr) / minmax(0, 1fr); justify-items: stretch; }
    .terminal-drawer.open > button { justify-self: center; }
    .terminal-resize-separator { position: relative; z-index: 2; width: 100%; min-height: 6px; background: var(--pi-border-muted); cursor: row-resize; touch-action: none; }
    .terminal-resize-separator::before { position: absolute; right: 0; bottom: 0; left: 0; height: max(44px, var(--pi-control-min-size, 44px)); content: ""; }
    .terminal-resize-separator:focus-visible { z-index: 3; outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .terminal-scope { min-width: 0; overflow: hidden; padding: 4px 12px; color: var(--pi-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .terminal-content { min-width: 0; min-height: 0; display: flex; overflow: hidden; }
    .terminal-drawer .host-surface { width: 100%; }
    .icon-button { flex: 0 0 auto; }
    header > div { min-width: 0; display: grid; gap: 5px; }
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
      .unified-destination-body:not(.collapsed) { grid-template-columns: min(var(--navigator-width, 320px), 42vw) 12px minmax(320px, 1fr); }
      .workstream-body { grid-template-columns: min(var(--navigator-width, 320px), 42vw) 22px minmax(320px, 1fr); }
      .workstream-body.sessions-collapsed { grid-template-columns: 0 0 minmax(320px, 1fr); }
    }
    @media (max-width: 760px) {
      .workstream-actions { flex-wrap: wrap; justify-content: flex-start; }
      .workstream-topbar { flex-wrap: wrap; align-content: center; padding: 6px 8px 6px 58px; }
      .workstream-utilities > .scope-label { display: none; }
      .session-tabs { display: none; }
      .mobile-pane-navigation { display: flex; flex: 0 0 auto; justify-content: center; padding: 6px; border-bottom: 1px solid var(--pi-border); background: var(--pi-surface); }
      .mobile-pane-navigation button[aria-current="page"] { background: var(--pi-selection-bg); font-weight: 700; }
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
      .workspace-heading { align-items: flex-start; }
      .checkpoint-actions { max-width: 48%; }
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
    @media (max-width: 520px) {
      .unified-destination-navigation, .workstream-body.mobile-sessions .sessions-pane { width: 100%; border-right: 0; box-shadow: none; }
      .pane-heading { display: grid; grid-template-columns: minmax(0, 1fr); }
      .pane-heading-actions { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pane-heading-actions button { min-width: 0; white-space: normal; }
      .shell-banner:not(:empty) { margin-left: 58px; }
      .portfolio-header { display: grid; }
      .portfolio-header .header-actions { justify-content: flex-start; }
      .portfolio-header > div:first-child > strong { font-size: 28px; }
      .portfolio-intro { font-size: 14px; }
    }
    @media (pointer: coarse) {
      :host button, .dedicated-session, .attention-navigation-action, .context-actions button, .task-answer-actions button, .terminal-drawer > button { min-height: max(44px, var(--pi-control-min-size, 44px)); }
      .unified-navigation-entry:has(.attention-navigation-action) .unified-navigation-row,
      .dedicated-session-entry:has(.attention-navigation-action) .dedicated-session { padding-bottom: calc(max(44px, var(--pi-control-min-size, 44px)) + 14px); }
    }
    @media (pointer: coarse) and (min-width: 761px) {
      .unified-destination-body:not(.collapsed) { grid-template-columns: min(var(--navigator-width, 320px), 42vw) max(44px, var(--pi-control-min-size, 44px)) minmax(320px, 1fr); }
      .workstream-body:not(.sessions-collapsed) { grid-template-columns: min(var(--navigator-width, 320px), 42vw) max(44px, var(--pi-control-min-size, 44px)) minmax(320px, 1fr); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; scroll-behavior: auto !important; transition: none !important; }
    }
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
    #main;
    #statusRegion;
    #alertRegion;

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      ({ status: this.#statusRegion, alert: this.#alertRegion } = createLiveRegions());
      this.#main = document.createElement("main");
      root.append(styleElement(), this.#statusRegion, this.#alertRegion, this.#main);
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
      const main = this.#main;
      main.replaceChildren();
      const announcement = this.#loading
        ? { severity: "status", text: "Loading Workbench projection." }
        : this.#projection === undefined
          ? { severity: "alert", text: this.#error || "Run projection is unavailable." }
          : this.#error !== "" ? { severity: "status", text: this.#error } : undefined;
      updateLiveRegions({ status: this.#statusRegion, alert: this.#alertRegion }, announcement);
      if (this.#loading) {
        main.append(message("Loading Workbench projection…", "muted"));
      } else if (this.#projection === undefined) {
        main.append(message(this.#error || "Run projection is unavailable.", "error"));
      } else {
        main.append(this.#renderProjection(this.#projection));
      }
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
    .live-region { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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

function message(text, className = "") {
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
