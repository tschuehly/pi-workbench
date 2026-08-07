import { projectWorkstreamBrief } from "./workstream-brief-projection.js";

export const NAVIGATOR_MIN_WIDTH = 240;
export const NAVIGATOR_MAX_WIDTH = 520;
export const NAVIGATOR_WIDTH_PREFERENCE = "unified-navigation.width";
export const NAVIGATOR_MODE_PREFERENCE = "unified-navigation.mode";

export function contextHostIdentityChanges(previous, next) {
  return {
    attention: previous?.attention !== next?.attention,
    sessionNavigation: previous?.sessionNavigation !== next?.sessionNavigation,
  };
}

export function normalizeSessionNavigationSnapshot(snapshot) {
  if (snapshot === undefined) return { available: false, complete: false, reconnecting: false, sessions: [] };
  if (!isRecord(snapshot) || !Array.isArray(snapshot.sessions) || !Array.isArray(snapshot.failedScopes)) {
    return { available: true, complete: false, reconnecting: false, sessions: [] };
  }
  const sessions = snapshot.sessions.map((item) => {
    const location = item?.location;
    if (![location?.machineId, location?.projectId, location?.workspaceId, location?.sessionId].every(nonEmpty)) return undefined;
    return {
      sessionId: location.sessionId,
      machineId: location.machineId,
      projectId: location.projectId,
      workspaceId: location.workspaceId,
      title: nonEmpty(item.title) ? item.title : location.sessionId,
      summary: typeof item.summary === "string" ? item.summary : "",
      archived: item.status === "archived",
      modifiedAt: typeof item.modifiedAt === "string" ? item.modifiedAt : "",
      identity: item.identity,
    };
  });
  if (sessions.some((item) => item === undefined)) return { available: true, complete: false, reconnecting: false, sessions: [] };
  const loading = snapshot.loading === true;
  const reconnecting = !loading && snapshot.reconnectComplete !== true;
  return {
    available: true,
    complete: !loading && !reconnecting && snapshot.failedScopes.length === 0,
    reconnecting,
    scopeUnavailable: !loading && !reconnecting && snapshot.failedScopes.length > 0,
    failedScopes: [...snapshot.failedScopes],
    machine: snapshot.machine,
    selectedIdentity: snapshot.selectedIdentity,
    sessions,
  };
}

export function selectedDestinationFromIdentity(joined, identity) {
  if (joined?.status !== "ready" || !nonEmpty(identity)) return undefined;
  const chat = joined.chats.find((candidate) => candidate.identity === identity);
  if (chat !== undefined) return { type: "chat", sessionKey: completeSessionKey(chat), location: sessionLocation(chat) };
  const native = joined.nativeSessions.find((candidate) => candidate.identity === identity);
  if (native === undefined) return undefined;
  const nativeKey = completeSessionKey(native);
  for (const workstream of joined.workstreams) {
    const session = workstream.sessions.find((candidate) => candidate.status === "active"
      && completeSessionKey({ ...candidate, sessionId: candidate.id }) === nativeKey);
    if (session !== undefined) return {
      type: "workstream-session",
      workstreamId: workstream.id,
      sessionId: session.id,
      location: sessionLocation(native),
    };
  }
  return undefined;
}

export function workstreamNavigatorItem(workstream, rememberedSessionKey) {
  const brief = projectWorkstreamBrief(workstream, rememberedSessionKey);
  const unresolvedTasks = brief.unresolvedHumanTasks.length;
  const health = brief.sessions.reduce((result, session) => worseHealth(result, session.checkpointStatus), "current");
  return {
    id: workstream.id,
    title: workstream.title,
    revision: workstream.revision,
    closed: workstream.closed === true,
    unresolvedTasks,
    sessionCount: brief.sessions.length,
    health: brief.sessions.length === 0 ? "missing" : health,
    continuation: brief.continuation,
  };
}

export function resizeNavigatorWidth(width, delta) {
  const next = Number(width) + Number(delta);
  if (!Number.isFinite(next)) return NAVIGATOR_MIN_WIDTH;
  return Math.min(NAVIGATOR_MAX_WIDTH, Math.max(NAVIGATOR_MIN_WIDTH, Math.round(next)));
}

export function navigatorKeyboardDelta(key, shiftKey = false) {
  const step = shiftKey ? 40 : 12;
  if (key === "ArrowLeft") return -step;
  if (key === "ArrowRight") return step;
  if (key === "Home") return -Infinity;
  if (key === "End") return Infinity;
  return undefined;
}

export function canonicalSurfaceRenderKey(snapshot, sessionId, rememberedSessionKey) {
  const identity = nonEmpty(snapshot?.id) ? snapshot.id : "missing";
  const revision = Number.isSafeInteger(snapshot?.revision) ? snapshot.revision : "invalid";
  return sessionId === undefined
    ? `brief:${identity}:${String(revision)}:${rememberedSessionKey ?? ""}`
    : `context:${identity}:${String(revision)}:${sessionId}`;
}

export function navigatorContinuationText(item) {
  if (nonEmpty(item?.continuation?.next)) return item.continuation.next;
  if (item?.sessionCount === 0) return "No sessions yet.";
  if (nonEmpty(item?.continuation?.reason)) return item.continuation.reason;
  return "Confirmed continuation unavailable.";
}

export function unifiedNavigatorRenderKey(options) {
  return `unified-navigator:${stableValueKey({
    status: options?.joined?.status,
    reason: options?.joined?.reason,
    chats: options?.joined?.chats,
    retainedNativeSessions: options?.joined?.retainedNativeSessions,
    workstreams: options?.joined?.workstreams,
    machine: options?.machine,
    navigationMode: options?.navigation?.mode,
    destination: options?.destination,
    pending: options?.pending === true,
    attentionItems: options?.attentionItems,
    refreshAvailable: typeof options?.onRefresh === "function",
  })}`;
}

export function expandedSessionListRenderKey(snapshot, options) {
  const attention = (snapshot?.sessions ?? []).map((session) => [session.id, attentionForWorkstreamSession(options?.attentionItems, session)]);
  return `expanded-sessions:${stableValueKey({
    workstreamId: snapshot?.id,
    sessions: snapshot?.sessions,
    selectedSessionId: options?.selectedSessionId,
    selectionPending: options?.selectionPending === true,
    attention,
  })}`;
}

export function inventoryNoticeRenderKey(joined, refreshAvailable) {
  return `inventory-notice:${stableValueKey({
    status: joined?.status,
    reason: joined?.reason,
    retainedNativeSessionCount: joined?.retainedNativeSessions?.length ?? 0,
    refreshAvailable: refreshAvailable === true,
  })}`;
}

export function unifiedChatBannerRenderKey(options) {
  return `chat-banner:${stableValueKey({
    reconnecting: options?.reconnecting === true,
    inventoryStatus: options?.joined?.status,
    selectionError: options?.error,
    refreshError: options?.refreshError,
    refreshAvailable: typeof options?.onRefresh === "function",
  })}`;
}

export function dedicatedBannerRenderKey(snapshot, options) {
  const repairSession = (snapshot?.sessions ?? []).find((session) => session.id === options?.anchorRepair?.sessionId);
  return `banner:${stableValueKey({
    workstreamId: snapshot?.id,
    revision: snapshot?.revision,
    closed: snapshot?.closed === true,
    reconnecting: options?.reconnecting === true,
    selectionError: options?.selectionError,
    refreshError: options?.refreshError,
    startLocationIncomplete: options?.startLocationIncomplete === true,
    startRecoveryActionAvailable: typeof options?.context?.host?.openActions === "function",
    refreshAvailable: typeof options?.onRefresh === "function",
    error: options?.error,
    notice: options?.notice,
    anchorRepair: options?.anchorRepair,
    repairSession: repairSession === undefined ? undefined : {
      id: repairSession.id,
      status: repairSession.status,
      machineId: repairSession.machineId,
      projectId: repairSession.projectId,
      workspaceId: repairSession.workspaceId,
    },
  })}`;
}

export function collapsedSessionTabsRenderKey(snapshot, options) {
  const attention = (snapshot?.sessions ?? []).map((session) => [session.id, attentionForWorkstreamSession(options?.attentionItems, session)]);
  return `session-tabs:${stableValueKey({
    workstreamId: snapshot?.id,
    revision: snapshot?.revision,
    closed: snapshot?.closed === true,
    selectedSessionId: options?.selectedSessionId,
    sessionsPaneOpen: options?.sessionsPaneOpen === true,
    attention,
  })}`;
}

export function hostSurfaceActivationKey(sessionKey, surface) {
  if (!nonEmpty(sessionKey) || !["chat", "files", "git", "terminal"].includes(surface)) return undefined;
  return `${sessionKey}:${surface}`;
}

export function navigatorFocusKey(destination) {
  if (destination?.type === "chat" && nonEmpty(destination.sessionKey)) return `chat:${destination.sessionKey}`;
  if ((destination?.type === "workstream" || destination?.type === "workstream-session") && nonEmpty(destination.workstreamId)) return `workstream:${destination.workstreamId}`;
  return undefined;
}

export function narrowOverlayKeyboardAction({ narrow, open, focusInside, key }) {
  if (!narrow || !open || !focusInside) return "ignore";
  if (key === "Escape") return "close";
  if (key === "Tab") return "cycle";
  return "ignore";
}

export function formatDateTime(value, unavailable = "Time unavailable") {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return unavailable;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatModifiedTime(value) {
  return formatDateTime(value, "Modified time unavailable");
}

export function attentionForWorkstreamSession(items, session) {
  if (!Array.isArray(items) || !nonEmpty(session?.id)) return undefined;
  return items.find((item) => item?.sessionId === session.id
    && (!nonEmpty(session.machineId) || item.machineId === session.machineId));
}

function completeSessionKey(session) {
  return `${session.machineId}\u0000${session.sessionId}\u0000${session.projectId}\u0000${session.workspaceId}`;
}

function sessionLocation(session) {
  return { sessionId: session.sessionId, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId };
}

function worseHealth(left, right) {
  const order = { current: 0, missing: 1, stale: 2, failed: 3 };
  return (order[right] ?? 3) > (order[left] ?? 3) ? right : left;
}

function stableValueKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValueKey(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}
