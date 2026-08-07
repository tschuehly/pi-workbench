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

export function formatModifiedTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Modified time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}
