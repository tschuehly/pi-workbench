import assert from "node:assert/strict";
import test from "node:test";
import { attentionForWorkstreamSession, contextHostIdentityChanges, navigatorFocusKey, navigatorKeyboardDelta, narrowOverlayKeyboardAction, normalizeSessionNavigationSnapshot, resizeNavigatorWidth, selectedDestinationFromIdentity, workstreamNavigatorItem } from "../unified-navigation-view-model.js";

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
  assert.deepEqual(item.continuation, { status: "stale", sessionId: "session", next: "Run checks." });
  assert.equal(item.health, "stale");
  assert.equal(item.unresolvedTasks, 1);
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
