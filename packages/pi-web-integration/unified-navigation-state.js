const ROOT_DESTINATION = Object.freeze({ type: "root" });
const VALID_SURFACES = new Set(["chat", "context", "files", "git"]);

export function rootDestination() {
  return ROOT_DESTINATION;
}

export function nativeSessionIdentity(session) {
  return `${session.machineId}\u0000${session.sessionId}`;
}

export function completeSessionKey(session) {
  return `${nativeSessionIdentity(session)}\u0000${session.projectId}\u0000${session.workspaceId}`;
}

export function joinChatsAndWorkstreams(nativeSnapshot, workstreamProjection) {
  if (nativeSnapshot === undefined || workstreamProjection === undefined
      || nativeSnapshot?.available === false || workstreamProjection?.available === false) {
    return joinFailure("unavailable", workstreamProjection);
  }
  if (!isRecord(nativeSnapshot) || !isRecord(workstreamProjection)
      || !Array.isArray(nativeSnapshot.sessions) || !Array.isArray(workstreamProjection.snapshots)
      || !nativeSnapshot.sessions.every(isCompleteNativeSession)
      || !workstreamProjection.snapshots.every(isWorkstreamSnapshot)) {
    return joinFailure("invalid", workstreamProjection, "Session inventory or Workstream projection is malformed.");
  }
  if (nativeSnapshot.complete !== true || workstreamProjection.complete !== true) {
    return {
      status: nativeSnapshot.reconnecting === true || workstreamProjection.reconnecting === true ? "reconnecting" : "loading",
      chats: [],
      workstreams: workstreamProjection.snapshots,
      retainedNativeSessions: nativeSnapshot.sessions,
      nativeSessions: [],
    };
  }

  const nativeByIdentity = new Map();
  for (const session of nativeSnapshot.sessions) {
    const identity = nativeSessionIdentity(session);
    const prior = nativeByIdentity.get(identity);
    if (prior !== undefined && completeSessionKey(prior) !== completeSessionKey(session)) {
      return joinFailure("invalid", workstreamProjection, `Session ${session.sessionId} has more than one complete home on ${session.machineId}.`);
    }
    nativeByIdentity.set(identity, session);
  }

  const anchoredAssociations = new Set();
  const anchorlessAssociations = new Set();
  for (const workstream of workstreamProjection.snapshots) {
    for (const session of workstream.sessions) {
      if (completeWorkstreamSession(session)) anchoredAssociations.add(nativeSessionIdentity({ machineId: session.machineId, sessionId: session.id }));
      else anchorlessAssociations.add(session.id);
    }
  }

  const nativeSessions = [...nativeByIdentity.values()];
  return {
    status: "ready",
    chats: nativeSessions.filter((session) => !anchoredAssociations.has(nativeSessionIdentity(session)) && !anchorlessAssociations.has(session.sessionId)),
    workstreams: workstreamProjection.snapshots,
    retainedNativeSessions: nativeSessions,
    nativeSessions,
  };
}

export function createUnifiedNavigationState(overrides = {}) {
  return {
    destination: ROOT_DESTINATION,
    pendingSelection: undefined,
    navigation: { mode: "expanded", width: 320, overlayOpen: false },
    surfaceBySession: {},
    terminalBySession: {},
    rememberedSessionByWorkstream: {},
    selectionError: undefined,
    ...overrides,
  };
}

export function reduceUnifiedNavigation(inputState, action) {
  const state = validState(inputState) ? inputState : createUnifiedNavigationState();
  if (!isRecord(action) || typeof action.type !== "string") return state;

  switch (action.type) {
    case "select-root": return { ...state, destination: ROOT_DESTINATION, pendingSelection: undefined, selectionError: undefined };
    case "select-workstream":
      return nonEmpty(action.workstreamId)
        ? { ...state, destination: { type: "workstream", workstreamId: action.workstreamId }, pendingSelection: undefined, selectionError: undefined }
        : { ...state, pendingSelection: undefined, selectionError: undefined };
    case "selection-requested":
      return validSelectableDestination(action.destination)
        ? { ...state, pendingSelection: { token: action.token, destination: action.destination }, selectionError: undefined }
        : { ...state, pendingSelection: undefined, selectionError: undefined };
    case "selection-succeeded": {
      if (state.pendingSelection?.token !== action.token) return state;
      const destination = state.pendingSelection.destination;
      const rememberedKey = destination.type === "workstream-session" ? destinationSessionKey(destination) ?? destination.sessionId : undefined;
      return {
        ...state,
        destination,
        pendingSelection: undefined,
        selectionError: undefined,
        rememberedSessionByWorkstream: destination.type === "workstream-session"
          ? { ...state.rememberedSessionByWorkstream, [destination.workstreamId]: rememberedKey }
          : state.rememberedSessionByWorkstream,
      };
    }
    case "selection-failed":
      return state.pendingSelection?.token !== action.token ? state : { ...state, pendingSelection: undefined, selectionError: action.error };
    case "back":
      if (state.destination.type === "workstream-session") return { ...state, destination: { type: "workstream", workstreamId: state.destination.workstreamId }, pendingSelection: undefined, selectionError: undefined };
      return { ...state, destination: ROOT_DESTINATION, pendingSelection: undefined, selectionError: undefined };
    case "select-surface": {
      if (!VALID_SURFACES.has(action.surface)) return state;
      const sessionKey = destinationSessionKey(state.destination);
      if (sessionKey === undefined || (state.destination.type === "chat" && action.surface === "context")) return state;
      return { ...state, surfaceBySession: { ...state.surfaceBySession, [sessionKey]: action.surface } };
    }
    case "set-terminal": {
      const sessionKey = destinationSessionKey(state.destination);
      if (sessionKey === undefined) return state;
      const prior = state.terminalBySession[sessionKey];
      return { ...state, terminalBySession: { ...state.terminalBySession, [sessionKey]: { open: action.open === true, height: bounded(action.height, 120, 640, prior?.height ?? 260) } } };
    }
    case "set-navigation": {
      const mode = ["expanded", "collapsed", "narrow-overlay"].includes(action.mode) ? action.mode : state.navigation.mode;
      return { ...state, navigation: { mode, width: bounded(action.width, 240, 520, state.navigation.width), overlayOpen: mode === "narrow-overlay" && action.overlayOpen === true } };
    }
    case "inventories-reconciled": return reconcileDestination(state, action.joined);
    case "restore": {
      if (action.joined?.status !== "ready") return { ...state, destination: ROOT_DESTINATION, pendingSelection: undefined, selectionError: undefined };
      if (destinationExists(action.destination, action.joined)) return { ...state, destination: action.destination, pendingSelection: undefined, selectionError: undefined };
      const workstreamId = action.destination?.type === "workstream-session" ? action.destination.workstreamId : undefined;
      const fallback = workstreamId !== undefined && action.joined.workstreams.some((candidate) => candidate.id === workstreamId)
        ? { type: "workstream", workstreamId }
        : ROOT_DESTINATION;
      return { ...state, destination: fallback, pendingSelection: undefined, selectionError: undefined };
    }
    default: return state;
  }
}

export function destinationExists(destination, joined) {
  if (!validDestination(destination) || joined?.status !== "ready" || !Array.isArray(joined.chats) || !Array.isArray(joined.workstreams)) return false;
  if (destination.type === "root") return true;
  if (destination.type === "chat") return joined.chats.some((session) => completeSessionKey(session) === destination.sessionKey);
  const workstream = joined.workstreams.find((candidate) => candidate.id === destination.workstreamId);
  if (workstream === undefined) return false;
  if (destination.type === "workstream") return true;
  const canonical = workstream.sessions.find((session) => session.status === "active" && session.id === destination.sessionId);
  if (canonical === undefined || !completeWorkstreamSession(canonical) || !Array.isArray(joined.nativeSessions)) return false;
  const canonicalKey = completeSessionKey({ ...canonical, sessionId: canonical.id });
  return destinationSessionKey(destination) === canonicalKey
    && joined.nativeSessions.some((session) => completeSessionKey(session) === canonicalKey);
}

function reconcileDestination(state, joined) {
  if (joined?.status !== "ready") return state;
  const pendingSelection = state.pendingSelection !== undefined && !destinationExists(state.pendingSelection.destination, joined) ? undefined : state.pendingSelection;
  if (destinationExists(state.destination, joined)) {
    return pendingSelection === state.pendingSelection && state.selectionError === undefined
      ? state
      : { ...state, pendingSelection, selectionError: undefined };
  }
  if (state.destination.type === "workstream-session" && joined.workstreams.some((candidate) => candidate.id === state.destination.workstreamId)) {
    return { ...state, destination: { type: "workstream", workstreamId: state.destination.workstreamId }, pendingSelection: undefined, selectionError: undefined };
  }
  return { ...state, destination: ROOT_DESTINATION, pendingSelection: undefined, selectionError: undefined };
}

function destinationSessionKey(destination) {
  if (destination.type === "chat") return destination.sessionKey;
  if (destination.type === "workstream-session" && completeLocation(destination.location)) {
    return completeSessionKey({ ...destination.location, sessionId: destination.sessionId });
  }
  return undefined;
}

function joinFailure(status, projection, reason) {
  const workstreams = status !== "invalid" && Array.isArray(projection?.snapshots) ? projection.snapshots : [];
  return { status, ...(reason === undefined ? {} : { reason }), chats: [], workstreams, retainedNativeSessions: [], nativeSessions: [] };
}

function isWorkstreamSnapshot(value) {
  return isRecord(value) && nonEmpty(value.id) && nonEmpty(value.title) && Number.isSafeInteger(value.revision)
    && typeof value.closed === "boolean" && Array.isArray(value.sessions) && value.sessions.every(isWorkstreamSession)
    && Array.isArray(value.humanTasks) && Array.isArray(value.links);
}

function isWorkstreamSession(value) {
  return isRecord(value) && nonEmpty(value.id) && ["active", "pending", "failed"].includes(value.status)
    && [value.machineId, value.projectId, value.workspaceId].every((part) => part === undefined || nonEmpty(part));
}

function completeWorkstreamSession(value) {
  return nonEmpty(value?.id) && completeLocation(value);
}

function isCompleteNativeSession(value) {
  return isRecord(value) && completeLocation(value) && nonEmpty(value.sessionId);
}

function completeLocation(value) {
  return nonEmpty(value?.machineId) && nonEmpty(value?.projectId) && nonEmpty(value?.workspaceId);
}

function validState(value) {
  return isRecord(value) && validDestination(value.destination)
    && (value.pendingSelection === undefined || isRecord(value.pendingSelection) && validSelectableDestination(value.pendingSelection.destination))
    && isRecord(value.navigation) && isRecord(value.surfaceBySession) && isRecord(value.terminalBySession)
    && isRecord(value.rememberedSessionByWorkstream);
}

function validDestination(value) {
  if (!isRecord(value)) return false;
  if (value.type === "root") return true;
  if (value.type === "workstream") return nonEmpty(value.workstreamId);
  if (value.type === "chat") return nonEmpty(value.sessionKey);
  return value.type === "workstream-session" && nonEmpty(value.workstreamId) && nonEmpty(value.sessionId);
}

function validSelectableDestination(value) {
  return validDestination(value) && (value.type === "chat" || value.type === "workstream-session") && destinationSessionKey(value) !== undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function bounded(value, minimum, maximum, fallback) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}
