import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicFakeWorkstreamClient, parseRecordedWorkstreams } from "../fake-workstream-client.js";
import { completeSessionKey, createUnifiedNavigationState, joinChatsAndWorkstreams, reduceUnifiedNavigation } from "../unified-navigation-state.js";
import { projectWorkstreamBrief, selectWorkstreamSession, workstreamSessionKey } from "../workstream-brief-projection.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/unified-navigation.json", import.meta.url), "utf8"));
const joined = joinChatsAndWorkstreams(fixture.native, fixture.workstreams);

test("paired fixture positively excludes associated sessions only after both inventories complete", () => {
  assert.equal(joined.status, "ready");
  assert.deepEqual(joined.chats.map((chat) => chat.sessionId), ["chat-review", "chat-ask"]);
  assert.equal(joined.chats.some((chat) => chat.sessionId === "session-anchorless"), false);
  assert.equal(joinChatsAndWorkstreams(fixture.states.partialNative, fixture.workstreams).status, "loading");
  const nativeReconnect = joinChatsAndWorkstreams(fixture.states.nativeReconnect, fixture.workstreams);
  assert.equal(nativeReconnect.status, "reconnecting");
  assert.equal(nativeReconnect.retainedNativeSessions.length > 0, true);
  const reconnecting = joinChatsAndWorkstreams(fixture.native, fixture.states.workstreamReconnect);
  assert.equal(reconnecting.status, "reconnecting");
  assert.equal(reconnecting.workstreams.length, 3);
  assert.deepEqual(joinChatsAndWorkstreams(fixture.states.completeEmpty, fixture.workstreams).chats, []);
  assert.equal(joinChatsAndWorkstreams(fixture.states.hostUnavailable, fixture.workstreams).status, "unavailable");
});

test("paired Workstream fixture is accepted by the canonical projection validator", () => {
  assert.notEqual(parseRecordedWorkstreams(fixture.workstreams), undefined);
  assert.equal(fixture.attention.items.some((item) => item.sessionId === "chat-ask"), true);
  assert.equal(fixture.attention.items.some((item) => item.sessionId === "session-b"), true);
  assert.equal(fixture.workstreams.snapshots.find((workstream) => workstream.id === "ws-closed").closed, true);
  assert.equal(fixture.native.sessions.find((session) => session.sessionId === "chat-review").archived, true);
});

test("anchor repair keeps the canonical association out of Chats before and after repair", async () => {
  assert.equal(joinChatsAndWorkstreams(fixture.native, fixture.workstreams).chats.some((chat) => chat.sessionId === "session-anchorless"), false);
  const client = new DeterministicFakeWorkstreamClient(fixture.workstreams);
  await client.append(fixture.anchorRepair.request);
  const repaired = await client.inspect("ws-anchor-repair");
  assert.equal(workstreamSessionKey(repaired.sessions[0]), completeSessionKey(fixture.anchorRepair.expectedLocation));
  const after = joinChatsAndWorkstreams(fixture.native, { ...fixture.workstreams, snapshots: [
    ...fixture.workstreams.snapshots.filter((workstream) => workstream.id !== repaired.id),
    repaired,
  ] });
  assert.equal(after.chats.some((chat) => chat.sessionId === "session-anchorless"), false);
});

test("duplicate homes and malformed complete state fail closed instead of classifying Chats", () => {
  const duplicate = joinChatsAndWorkstreams({ complete: true, sessions: fixture.states.duplicateHome }, fixture.workstreams);
  assert.equal(duplicate.status, "invalid");
  assert.deepEqual(duplicate.chats, []);
  assert.match(duplicate.reason, /more than one complete home/);
  for (const [native, workstreams] of [
    [{ complete: true, sessions: [{}] }, fixture.workstreams],
    [fixture.native, { complete: true, snapshots: [{ id: "broken" }] }],
  ]) {
    const malformed = joinChatsAndWorkstreams(native, workstreams);
    assert.equal(malformed.status, "invalid");
    assert.deepEqual(malformed.chats, []);
  }
});

test("root, Chat, Workstream brief, and Workstream session transitions retain one destination", () => {
  const chat = joined.chats[0];
  let state = createUnifiedNavigationState();
  state = reduceUnifiedNavigation(state, { type: "selection-requested", token: 1, destination: { type: "chat", sessionKey: completeSessionKey(chat), location: chat } });
  assert.equal(state.destination.type, "root");
  state = reduceUnifiedNavigation(state, { type: "selection-succeeded", token: 1 });
  assert.equal(state.destination.type, "chat");

  state = reduceUnifiedNavigation(state, { type: "select-workstream", workstreamId: "ws-unified" });
  assert.deepEqual(state.destination, { type: "workstream", workstreamId: "ws-unified" });
  state = reduceUnifiedNavigation(state, { type: "selection-requested", token: 2, destination: { type: "workstream-session", workstreamId: "ws-unified", sessionId: "session-a", location: { machineId: "studio", projectId: "pi-workbench", workspaceId: "feature/unified" } } });
  state = reduceUnifiedNavigation(state, { type: "selection-succeeded", token: 2 });
  assert.equal(state.destination.type, "workstream-session");
  assert.equal(state.rememberedSessionByWorkstream["ws-unified"], completeSessionKey({ machineId: "studio", projectId: "pi-workbench", workspaceId: "feature/unified", sessionId: "session-a" }));
  assert.equal(selectWorkstreamSession(fixture.workstreams.snapshots[0], state.rememberedSessionByWorkstream["ws-unified"]).id, "session-a");
  assert.deepEqual(reduceUnifiedNavigation(state, { type: "back" }).destination, { type: "workstream", workstreamId: "ws-unified" });
  assert.equal(reduceUnifiedNavigation(reduceUnifiedNavigation(state, { type: "back" }), { type: "back" }).destination.type, "root");
});

test("selection races and typed failures leave the prior destination visible", () => {
  let state = reduceUnifiedNavigation(createUnifiedNavigationState({ destination: { type: "workstream", workstreamId: "ws-unified" } }), {
    type: "selection-requested", token: 4, destination: { type: "workstream-session", workstreamId: "ws-unified", sessionId: "session-a", location: { machineId: "studio", projectId: "pi-workbench", workspaceId: "feature/unified" } },
  });
  state = reduceUnifiedNavigation(state, { type: "selection-requested", token: 5, destination: { type: "workstream-session", workstreamId: "ws-unified", sessionId: "session-b", location: { machineId: "studio", projectId: "pi-web", workspaceId: "pi-workbench" } } });
  assert.equal(reduceUnifiedNavigation(state, { type: "selection-succeeded", token: 4 }), state);
  state = reduceUnifiedNavigation(state, { type: "selection-failed", token: 5, error: { code: "SESSION_WORKSPACE_UNAVAILABLE" } });
  assert.deepEqual(state.destination, { type: "workstream", workstreamId: "ws-unified" });
  assert.equal(state.selectionError.code, "SESSION_WORKSPACE_UNAVAILABLE");
});

test("surface and Terminal memory is session-scoped and Context is unavailable to native Chats", () => {
  const chat = joined.chats[0];
  let state = createUnifiedNavigationState({ destination: { type: "chat", sessionKey: completeSessionKey(chat), location: chat } });
  assert.equal(reduceUnifiedNavigation(state, { type: "select-surface", surface: "context" }), state);
  state = reduceUnifiedNavigation(state, { type: "select-surface", surface: "files" });
  state = reduceUnifiedNavigation(state, { type: "set-terminal", open: true, height: 900 });
  assert.equal(Object.values(state.surfaceBySession)[0], "files");
  assert.deepEqual(Object.values(state.terminalBySession)[0], { open: true, height: 640 });

  state = { ...state, destination: { type: "workstream-session", workstreamId: "ws-unified", sessionId: "session-a", location: { machineId: "studio", projectId: "pi-workbench", workspaceId: "feature/unified" } } };
  state = reduceUnifiedNavigation(state, { type: "select-surface", surface: "context" });
  assert.equal(state.surfaceBySession[completeSessionKey({ machineId: "studio", projectId: "pi-workbench", workspaceId: "feature/unified", sessionId: "session-a" })], "context");
});

test("Terminal visibility changes preserve the remembered per-session height", () => {
  const chat = joined.chats[0];
  let state = createUnifiedNavigationState({ destination: { type: "chat", sessionKey: completeSessionKey(chat), location: chat } });
  state = reduceUnifiedNavigation(state, { type: "set-terminal", open: true, height: 480 });
  state = reduceUnifiedNavigation(state, { type: "set-terminal", open: false });
  assert.deepEqual(Object.values(state.terminalBySession)[0], { open: false, height: 480 });
});

test("navigation modes are mutually exclusive and widths are bounded", () => {
  let state = reduceUnifiedNavigation(createUnifiedNavigationState(), { type: "set-navigation", mode: "collapsed", width: 1000, overlayOpen: true });
  assert.deepEqual(state.navigation, { mode: "collapsed", width: 520, overlayOpen: false });
  state = reduceUnifiedNavigation(state, { type: "set-navigation", mode: "narrow-overlay", width: 200, overlayOpen: true });
  assert.deepEqual(state.navigation, { mode: "narrow-overlay", width: 240, overlayOpen: true });
});

test("restore waits for complete inventories and invalidation falls back deterministically", () => {
  const chat = joined.chats[0];
  const destination = { type: "chat", sessionKey: completeSessionKey(chat), location: chat };
  assert.equal(reduceUnifiedNavigation(createUnifiedNavigationState(), { type: "restore", destination, joined: { status: "loading", chats: [], workstreams: [] } }).destination.type, "root");
  let state = reduceUnifiedNavigation(createUnifiedNavigationState(), { type: "restore", destination, joined });
  assert.equal(state.destination.type, "chat");
  state = reduceUnifiedNavigation(state, { type: "inventories-reconciled", joined: { status: "ready", chats: [], workstreams: joined.workstreams } });
  assert.equal(state.destination.type, "root");

  state = createUnifiedNavigationState({ destination: { type: "workstream-session", workstreamId: "ws-unified", sessionId: "removed" } });
  assert.deepEqual(reduceUnifiedNavigation(state, { type: "inventories-reconciled", joined }).destination, { type: "workstream", workstreamId: "ws-unified" });

  state = reduceUnifiedNavigation(createUnifiedNavigationState(), { type: "selection-requested", token: 8, destination: { type: "workstream-session", workstreamId: "ws-unified", sessionId: "removed" } });
  state = reduceUnifiedNavigation(state, { type: "inventories-reconciled", joined });
  assert.equal(state.pendingSelection, undefined);
  assert.equal(reduceUnifiedNavigation(state, { type: "selection-succeeded", token: 8 }).destination.type, "root");

  const unavailableSession = {
    type: "workstream-session", workstreamId: "ws-unified", sessionId: "session-a",
    location: { machineId: "studio", projectId: "pi-workbench", workspaceId: "feature/unified" },
  };
  state = reduceUnifiedNavigation(createUnifiedNavigationState({ selectionError: { code: "STALE" } }), { type: "selection-requested", token: 9, destination: unavailableSession });
  state = { ...state, selectionError: { code: "STALE" } };
  state = reduceUnifiedNavigation(state, { type: "inventories-reconciled", joined: { ...joined, nativeSessions: joined.nativeSessions.filter((session) => session.sessionId !== "session-a") } });
  assert.equal(state.pendingSelection, undefined);
  assert.equal(state.selectionError, undefined);
});

test("malformed reducer state fails closed", () => {
  const state = reduceUnifiedNavigation({ destination: null }, { type: "back" });
  assert.equal(state.destination.type, "root");
  assert.equal(state.pendingSelection, undefined);
});

test("brief projection preserves sourced per-session fields and checkpoint truth without aggregation", () => {
  const workstream = fixture.workstreams.snapshots[0];
  const remembered = projectWorkstreamBrief(workstream, "session-b");
  assert.deepEqual(remembered.continuation, { status: "stale", sessionId: "session-b", next: "Run host tests." });
  assert.deepEqual(remembered.unresolvedHumanTasks.map((task) => task.status), ["pending", "answered"]);
  assert.equal(remembered.unresolvedHumanTasks.some((task) => task.id === "task-resolved"), false);
  assert.equal(remembered.sessions.find((session) => session.id === "session-a").whatChanged, "The destination model is fixed.");
  assert.equal(remembered.sessions.find((session) => session.id === "session-c").checkpointStatus, "failed");
  assert.equal(remembered.sessions.find((session) => session.id === "session-c").priorCheckpointAvailable, true);
  assert.equal(remembered.sessions.find((session) => session.id === "pending:launch").checkpointStatus, "missing");
  assert.equal(Object.hasOwn(remembered, "whatChanged"), false);
  const closed = projectWorkstreamBrief(fixture.workstreams.snapshots.find((workstream) => workstream.id === "ws-closed"));
  assert.equal(closed.closedAt, "2026-08-01T10:00:00.000Z");
  const malformed = projectWorkstreamBrief({ id: "malformed", title: "Malformed" });
  assert.deepEqual(malformed.sessions, []);
});
