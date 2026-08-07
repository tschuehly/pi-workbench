import assert from "node:assert/strict";
import test from "node:test";
import { attentionForWorkstreamSession, canonicalSurfaceRenderKey, collapsedSessionTabsRenderKey, contextHostIdentityChanges, dedicatedBannerRenderKey, expandedSessionListRenderKey, formatDateTime, hostSurfaceActivationKey, inventoryNoticeRenderKey, navigatorContinuationText, navigatorFocusKey, navigatorKeyboardDelta, narrowOverlayKeyboardAction, normalizeSessionNavigationSnapshot, resizeNavigatorWidth, selectedDestinationFromIdentity, unifiedNavigatorRenderKey, workstreamNavigatorItem } from "../unified-navigation-view-model.js";

const hostSnapshot = {
  sequence: 3,
  machine: { id: "studio", name: "Studio Mac" },
  selectedIdentity: "native-id",
  loading: false,
  reconnectComplete: true,
  failedScopes: [],
  sessions: [{
    identity: "native-id",
    sessionId: "ignored-flat-id",
    title: "Review changes",
    summary: "Waiting",
    status: "current",
    modifiedAt: "2026-08-04T10:00:00.000Z",
    location: { machineId: "studio", projectId: "pi-web", workspaceId: "main", sessionId: "chat-review" },
  }],
};

test("fresh context objects do not change stable host identities", () => {
  const attention = {};
  const sessionNavigation = {};
  assert.deepEqual(contextHostIdentityChanges(
    { attention, sessionNavigation },
    { attention, sessionNavigation, transientState: {} },
  ), { attention: false, sessionNavigation: false });
  assert.deepEqual(contextHostIdentityChanges(
    { attention, sessionNavigation },
    { attention, sessionNavigation: {} },
  ), { attention: false, sessionNavigation: true });
});

test("normalizes only a complete public session-navigation snapshot", () => {
  const normalized = normalizeSessionNavigationSnapshot(hostSnapshot);
  assert.equal(normalized.complete, true);
  assert.deepEqual(normalized.sessions[0], {
    sessionId: "chat-review", machineId: "studio", projectId: "pi-web", workspaceId: "main",
    title: "Review changes", summary: "Waiting", archived: false,
    modifiedAt: "2026-08-04T10:00:00.000Z", identity: "native-id",
  });
  assert.equal(normalizeSessionNavigationSnapshot({ ...hostSnapshot, loading: true }).complete, false);
  assert.equal(normalizeSessionNavigationSnapshot({ ...hostSnapshot, reconnectComplete: false }).reconnecting, true);
  const failedScope = normalizeSessionNavigationSnapshot({ ...hostSnapshot, failedScopes: [{ type: "project" }] });
  assert.equal(failedScope.complete, false);
  assert.equal(failedScope.scopeUnavailable, true);
  assert.equal(failedScope.reconnecting, false);
  assert.equal(normalizeSessionNavigationSnapshot(undefined).available, false);
});

test("selected host identity maps to an exact Chat or canonical Workstream session", () => {
  const chat = normalizeSessionNavigationSnapshot(hostSnapshot).sessions[0];
  const ready = { status: "ready", chats: [chat], nativeSessions: [chat], workstreams: [] };
  assert.deepEqual(selectedDestinationFromIdentity(ready, "native-id"), {
    type: "chat",
    sessionKey: "studio\u0000chat-review\u0000pi-web\u0000main",
    location: { sessionId: "chat-review", machineId: "studio", projectId: "pi-web", workspaceId: "main" },
  });
  const workstream = {
    id: "ws-1", sessions: [{ id: "chat-review", status: "active", machineId: "studio", projectId: "pi-web", workspaceId: "main" }],
  };
  assert.equal(selectedDestinationFromIdentity({ ...ready, chats: [], workstreams: [workstream] }, "native-id").workstreamId, "ws-1");
  assert.equal(selectedDestinationFromIdentity(ready, "other"), undefined);
});

test("navigator summaries remain mechanical and sourced", () => {
  const item = workstreamNavigatorItem({
    id: "ws-1", title: "Ship navigation", revision: 4, closed: false, links: [],
    humanTasks: [{ id: "task", status: "pending" }],
    sessions: [{ id: "session", status: "active", machineId: "studio", projectId: "p", workspaceId: "w", latestCheckpoint: { next: "Run checks." }, checkpointFailure: null, checkpointStaleness: { reason: "changed" } }],
  });
  assert.deepEqual(item.continuation, { resumable: true, status: "stale", sessionStatus: "active", sessionId: "session", next: "Run checks.", reason: "changed" });
  assert.equal(item.health, "stale");
  assert.equal(item.unresolvedTasks, 1);
});

test("navigator continuation prefers a sourced launch failure to generic unavailability", () => {
  assert.equal(navigatorContinuationText({ sessionCount: 1, continuation: { sessionStatus: "failed", reason: "Session launch failed: quota denied" } }), "Session launch failed: quota denied");
  assert.equal(navigatorContinuationText({ sessionCount: 1, continuation: {} }), "Confirmed continuation unavailable.");
  assert.equal(navigatorContinuationText({ sessionCount: 0, continuation: { reason: "No Workstream session is available." } }), "No sessions yet.");
  assert.equal(navigatorContinuationText({ sessionCount: 1, continuation: { next: "Run checks.", reason: "stale" } }), "Run checks.");
});

test("expanded session keys cover contents, pending selection, current session, and attention", () => {
  const snapshot = { id: "ws", revision: 7, sessions: [{ id: "session-a", status: "active", machineId: "studio", purpose: "Review" }] };
  const options = { selectedSessionId: "session-a", selectionPending: false, attentionItems: [] };
  const key = expandedSessionListRenderKey(snapshot, options);
  assert.equal(key, expandedSessionListRenderKey({ ...snapshot, revision: 8, sessions: snapshot.sessions.map((session) => ({ ...session })) }, { ...options, attentionItems: [] }));
  assert.notEqual(key, expandedSessionListRenderKey({ ...snapshot, sessions: [{ ...snapshot.sessions[0], purpose: "Fix" }] }, options));
  assert.notEqual(key, expandedSessionListRenderKey(snapshot, { ...options, selectionPending: true }));
  assert.notEqual(key, expandedSessionListRenderKey(snapshot, { ...options, selectedSessionId: undefined }));
  assert.notEqual(key, expandedSessionListRenderKey(snapshot, { ...options, attentionItems: [{ id: "ask", sessionId: "session-a", machineId: "studio" }] }));
});

test("unified navigator keys cover contents, pending, current destination, inventory errors, and reconnect", () => {
  const options = {
    joined: { status: "ready", chats: [{ sessionId: "chat", title: "Chat" }], retainedNativeSessions: [], workstreams: [] },
    machine: { id: "studio", name: "Studio" },
    navigation: { mode: "expanded" },
    destination: { type: "root" },
    pending: false,
    attentionItems: [],
  };
  const key = unifiedNavigatorRenderKey(options);
  assert.equal(key, unifiedNavigatorRenderKey(structuredClone(options)));
  assert.notEqual(key, unifiedNavigatorRenderKey({ ...options, pending: true }));
  assert.notEqual(key, unifiedNavigatorRenderKey({ ...options, destination: { type: "chat", sessionKey: "chat-key" } }));
  assert.notEqual(key, unifiedNavigatorRenderKey({ ...options, joined: { ...options.joined, chats: [{ sessionId: "chat", title: "Renamed" }] } }));
  assert.notEqual(key, unifiedNavigatorRenderKey({ ...options, joined: { ...options.joined, status: "invalid", reason: "Malformed inventory" } }));
  assert.notEqual(key, unifiedNavigatorRenderKey({ ...options, joined: { ...options.joined, status: "reconnecting" } }));
  assert.notEqual(inventoryNoticeRenderKey({ status: "invalid", reason: "first", retainedNativeSessions: [] }, false), inventoryNoticeRenderKey({ status: "invalid", reason: "second", retainedNativeSessions: [] }, false));
});

test("canonical surfaces use deterministic revision, session, and remembered-continuation keys", () => {
  const snapshot = { id: "ws", revision: 7 };
  assert.equal(canonicalSurfaceRenderKey(snapshot, undefined, "remembered"), "brief:ws:7:remembered");
  assert.equal(canonicalSurfaceRenderKey(snapshot, "session-a"), "context:ws:7:session-a");
  assert.notEqual(canonicalSurfaceRenderKey(snapshot, "session-a"), canonicalSurfaceRenderKey({ ...snapshot, revision: 8 }, "session-a"));
  assert.notEqual(formatDateTime("2026-08-01T10:00:00.000Z"), "Time unavailable");
  assert.equal(formatDateTime("not-a-date"), "Time unavailable");
});

test("banner and collapsed-session keys ignore polling alone but include repair and attention changes", () => {
  const snapshot = { id: "ws", revision: 7, closed: false, sessions: [{ id: "session-a", status: "active", machineId: "studio" }] };
  const banner = { reconnecting: false, anchorRepair: { status: "offered", sessionId: "session-a", machine: { name: "Studio", id: "studio" } } };
  assert.equal(dedicatedBannerRenderKey(snapshot, banner), dedicatedBannerRenderKey(snapshot, { ...banner, anchorRepair: { sessionId: "session-a", machine: { id: "studio", name: "Studio" }, status: "offered" } }));
  assert.notEqual(dedicatedBannerRenderKey(snapshot, banner), dedicatedBannerRenderKey(snapshot, { ...banner, anchorRepair: { ...banner.anchorRepair, status: "resolving" } }));

  const tabs = { selectedSessionId: "session-a", attentionItems: [] };
  assert.equal(collapsedSessionTabsRenderKey(snapshot, tabs), collapsedSessionTabsRenderKey(snapshot, { ...tabs, attentionItems: [] }));
  assert.notEqual(collapsedSessionTabsRenderKey(snapshot, tabs), collapsedSessionTabsRenderKey(snapshot, { ...tabs, attentionItems: [{ id: "ask-1", sessionId: "session-a", machineId: "studio" }] }));
});

test("host activation keys exclude adapter-owned Context and remain session scoped", () => {
  assert.equal(hostSurfaceActivationKey("session-key", "context"), undefined);
  assert.equal(hostSurfaceActivationKey("session-key", "files"), "session-key:files");
  assert.notEqual(hostSurfaceActivationKey("first", "git"), hostSurfaceActivationKey("second", "git"));
});

test("navigator focus keys use complete Chat identity and stable Workstream identity", () => {
  assert.equal(navigatorFocusKey({ type: "chat", sessionKey: "machine\\0session\\0project\\0workspace" }), "chat:machine\\0session\\0project\\0workspace");
  assert.equal(navigatorFocusKey({ type: "workstream-session", workstreamId: "ws-1" }), "workstream:ws-1");
});

test("Workstream session attention uses machine identity when the anchor provides it", () => {
  const items = [
    { machineId: "laptop", sessionId: "session-1" },
    { machineId: "studio", sessionId: "session-1" },
  ];
  assert.equal(attentionForWorkstreamSession(items, { id: "session-1", machineId: "studio" }), items[1]);
  assert.equal(attentionForWorkstreamSession(items, { id: "session-1" }), items[0]);
  assert.equal(attentionForWorkstreamSession(items, { id: "other", machineId: "studio" }), undefined);
});

test("overlay keyboard handling is inert outside an open narrow navigator", () => {
  assert.equal(narrowOverlayKeyboardAction({ narrow: false, open: true, focusInside: true, key: "Tab" }), "ignore");
  assert.equal(narrowOverlayKeyboardAction({ narrow: true, open: false, focusInside: true, key: "Tab" }), "ignore");
  assert.equal(narrowOverlayKeyboardAction({ narrow: true, open: true, focusInside: false, key: "Escape" }), "ignore");
  assert.equal(narrowOverlayKeyboardAction({ narrow: true, open: true, focusInside: true, key: "Tab" }), "cycle");
  assert.equal(narrowOverlayKeyboardAction({ narrow: true, open: true, focusInside: true, key: "Escape" }), "close");
});

test("pointer and keyboard resize values share bounded behavior", () => {
  assert.equal(resizeNavigatorWidth(320, 80), 400);
  assert.equal(resizeNavigatorWidth(500, 80), 520);
  assert.equal(resizeNavigatorWidth(250, -80), 240);
  assert.equal(navigatorKeyboardDelta("ArrowLeft"), -12);
  assert.equal(navigatorKeyboardDelta("ArrowRight", true), 40);
  assert.equal(navigatorKeyboardDelta("Escape"), undefined);
});
