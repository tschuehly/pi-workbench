import { projectWorkstreamBrief } from "./workstream-brief-projection.js";

export const NAVIGATOR_MIN_WIDTH = 240;
export const NAVIGATOR_MAX_WIDTH = 520;
export const NAVIGATOR_WIDTH_PREFERENCE = "unified-navigation.width";
export const NAVIGATOR_MODE_PREFERENCE = "unified-navigation.mode";
export const NARROW_VIEWPORT_MAX_WIDTH = 760;
export const NARROW_VIEWPORT_MEDIA_QUERY = `(max-width: ${String(NARROW_VIEWPORT_MAX_WIDTH)}px)`;
const RENDER_KEY_DIGEST_LANES = Object.freeze([
  0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
  0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
]);

export function narrowViewportMatches(matchMedia = (query) => globalThis.matchMedia?.(query)) {
  return matchMedia(NARROW_VIEWPORT_MEDIA_QUERY)?.matches === true;
}

export function sessionNavigationCompatibility(sessionNavigation) {
  return sessionNavigation === undefined
    ? {
        supported: false,
        message: "Update PI WEB to enable Chats + Workstreams. This older host does not provide session navigation; Workstreams-only mode remains available.",
      }
    : { supported: true, message: undefined };
}

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

export function attentionDestinationFromItem(joined, item) {
  if (joined?.status !== "ready" || !Array.isArray(joined.chats) || !Array.isArray(joined.nativeSessions) || !Array.isArray(joined.workstreams)) {
    return attentionLookupFailure("ATTENTION_INVENTORY_UNAVAILABLE", "Cannot focus this ask until the complete Chat and Workstream inventory is ready.");
  }
  if (![item?.identity, item?.machineId, item?.projectId, item?.workspaceId, item?.sessionId, item?.askId].every(nonEmpty)) {
    return attentionLookupFailure("ATTENTION_IDENTITY_INCOMPLETE", "Cannot focus this ask because its complete machine/project/workspace/session identity is unavailable.");
  }
  const matchesItem = (candidate) => candidate.identity === item.identity
    && candidate.machineId === item.machineId
    && candidate.projectId === item.projectId
    && candidate.workspaceId === item.workspaceId
    && candidate.sessionId === item.sessionId;
  const nativeMatches = joined.nativeSessions.filter(matchesItem);
  if (nativeMatches.length !== 1) {
    return attentionLookupFailure("ATTENTION_DESTINATION_NOT_FOUND", "No ready Chat or active Workstream session matches this ask's complete identity.");
  }
  const native = nativeMatches[0];
  const sessionKey = completeSessionKey(native);
  const chats = joined.chats.filter((candidate) => matchesItem(candidate) && completeSessionKey(candidate) === sessionKey);
  const workstreamMatches = [];
  for (const workstream of joined.workstreams) {
    for (const session of workstream.sessions ?? []) {
      if (session.status === "active" && completeSessionKey({ ...session, sessionId: session.id }) === sessionKey) {
        workstreamMatches.push({ workstream, session });
      }
    }
  }
  if (chats.length === 1 && workstreamMatches.length === 0) {
    return { ok: true, kind: "chat", chat: chats[0], destination: { type: "chat", sessionKey, location: sessionLocation(native) } };
  }
  if (chats.length === 0 && workstreamMatches.length === 1) {
    const { workstream, session } = workstreamMatches[0];
    return {
      ok: true,
      kind: "workstream-session",
      workstreamId: workstream.id,
      session,
      destination: { type: "workstream-session", workstreamId: workstream.id, sessionId: session.id, location: sessionLocation(native) },
    };
  }
  return attentionLookupFailure("ATTENTION_DESTINATION_MISMATCH", "The ready inventory does not identify exactly one destination for this ask.");
}

export function destinationsMatch(left, right) {
  if (left?.type !== right?.type || !sameCompleteLocation(left?.location, right?.location)) return false;
  if (left.type === "chat") return nonEmpty(left.sessionKey) && left.sessionKey === right.sessionKey;
  if (left.type === "workstream-session") return nonEmpty(left.workstreamId) && left.workstreamId === right.workstreamId
    && nonEmpty(left.sessionId) && left.sessionId === right.sessionId;
  return false;
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

export function workstreamsRootRenderKey(options) {
  return `workstreams-root:${boundedStableValueKey(options)}`;
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
    sessionNavigationSupported: options?.sessionNavigationCompatibility?.supported !== false,
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

export function inventoryNoticeRenderKey(joined, refreshAvailable, sessionNavigationSupported = true) {
  return `inventory-notice:${stableValueKey({
    status: joined?.status,
    reason: joined?.reason,
    retainedNativeSessionCount: joined?.retainedNativeSessions?.length ?? 0,
    refreshAvailable: refreshAvailable === true,
    sessionNavigationSupported,
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

function attentionLookupFailure(code, message) {
  return { ok: false, error: { code, message } };
}

function sameCompleteLocation(left, right) {
  const fields = ["machineId", "projectId", "workspaceId", "sessionId"];
  return fields.every((field) => nonEmpty(left?.[field]) && left[field] === right?.[field]);
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

export function boundedStableValueKey(value) {
  const digest = stableDigest();
  const seen = new WeakMap();
  const symbols = new Map();
  const stack = [{ kind: "value", value }];
  let nextObjectId = 0;
  let nextSymbolId = 0;

  while (stack.length > 0) {
    const task = stack.pop();
    if (task.kind === "token") {
      digest.add(task.tag, task.value);
      continue;
    }
    if (task.kind === "property") {
      let propertyValue;
      try { propertyValue = task.owner[task.key]; }
      catch {
        digest.add("unreadable", task.key);
        continue;
      }
      stack.push({ kind: "value", value: propertyValue });
      continue;
    }

    const candidate = task.value;
    if ((typeof candidate !== "object" && typeof candidate !== "function") || candidate === null) {
      addPrimitiveToDigest(digest, candidate, symbols, () => nextSymbolId++);
      continue;
    }

    const priorId = seen.get(candidate);
    if (priorId !== undefined) {
      digest.add("reference", priorId);
      continue;
    }
    const objectId = nextObjectId++;
    seen.set(candidate, objectId);

    const type = safeObjectType(candidate);
    digest.add("object", `${objectId}:${type}`);
    addIntrinsicValueToDigest(digest, candidate, type);

    let keys;
    try { keys = Object.keys(candidate).sort(); }
    catch {
      digest.add("keys", "unreadable");
      continue;
    }
    const intrinsicChildren = safeIntrinsicChildren(digest, candidate, type);
    digest.add("intrinsic-children", intrinsicChildren.length);
    digest.add("keys", keys.length);
    stack.push({ kind: "token", tag: "end", value: objectId });
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      stack.push({ kind: "property", owner: candidate, key });
      stack.push({ kind: "token", tag: "key", value: key });
    }
    for (let index = intrinsicChildren.length - 1; index >= 0; index -= 1) {
      const child = intrinsicChildren[index];
      stack.push({ kind: "value", value: child.value });
      stack.push({ kind: "token", tag: child.tag, value: child.index });
    }
  }

  return `digest-v1:${digest.hex()}`;
}

function stableValueKey(value) {
  return boundedStableValueKey(value);
}

function addPrimitiveToDigest(digest, value, symbols, allocateSymbolId) {
  const type = value === null ? "null" : typeof value;
  if (type === "number") {
    const representation = Number.isNaN(value) ? "NaN"
      : value === Infinity ? "+Infinity"
        : value === -Infinity ? "-Infinity"
          : Object.is(value, -0) ? "-0" : String(value);
    digest.add(type, representation);
    return;
  }
  if (type === "symbol") {
    let id = symbols.get(value);
    if (id === undefined) {
      id = allocateSymbolId();
      symbols.set(value, id);
    }
    digest.add(type, `${id}:${Symbol.keyFor(value) ?? ""}:${value.description ?? ""}`);
    return;
  }
  if (type === "function") {
    let source;
    try { source = Function.prototype.toString.call(value); }
    catch { source = "unreadable"; }
    digest.add(type, source);
    return;
  }
  digest.add(type, type === "undefined" || type === "null" ? "" : String(value));
}

function safeObjectType(value) {
  try { return Object.prototype.toString.call(value); }
  catch { return "[object Unreadable]"; }
}

function addIntrinsicValueToDigest(digest, value, type) {
  try {
    if (type === "[object Function]" || type === "[object AsyncFunction]" || type === "[object GeneratorFunction]") {
      digest.add("function", Function.prototype.toString.call(value));
    } else if (type === "[object Date]") digest.add("date", Date.prototype.getTime.call(value));
    else if (type === "[object RegExp]") {
      const source = Object.getOwnPropertyDescriptor(RegExp.prototype, "source").get.call(value);
      const flags = Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get.call(value);
      digest.add("regexp-source", source);
      digest.add("regexp-flags", flags);
    } else if (type === "[object ArrayBuffer]") {
      const bytes = new Uint8Array(value);
      digest.add("array-buffer", Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    }
  } catch {
    digest.add("intrinsic", "unreadable");
  }
}

function safeIntrinsicChildren(digest, value, type) {
  try {
    if (type === "[object Map]") {
      return Array.from(Map.prototype.entries.call(value)).flatMap(([key, item], index) => [
        { tag: "map-key", index, value: key },
        { tag: "map-value", index, value: item },
      ]);
    }
    if (type === "[object Set]") {
      return Array.from(Set.prototype.values.call(value), (item, index) => ({ tag: "set-value", index, value: item }));
    }
  } catch {
    digest.add("intrinsic-children", "unreadable");
  }
  return [];
}

function stableDigest() {
  const lanes = RENDER_KEY_DIGEST_LANES.slice();
  const write = (input) => {
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      for (let lane = 0; lane < lanes.length; lane += 1) {
        lanes[lane] = Math.imul(lanes[lane] ^ code ^ lane, 0x01000193) >>> 0;
      }
    }
  };
  return {
    add(tag, value) {
      const text = String(value);
      write(`${tag.length}:${tag}:${text.length}:`);
      write(text);
    },
    hex() {
      return lanes.map((lane, index) => {
        let mixed = lane ^ (lane >>> 16) ^ Math.imul(index + 1, 0x9e3779b9);
        mixed = Math.imul(mixed ^ (mixed >>> 15), 0x85ebca6b);
        mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
        return ((mixed ^ (mixed >>> 16)) >>> 0).toString(16).padStart(8, "0");
      }).join("");
    },
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}
