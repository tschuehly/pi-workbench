import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicFakeWorkstreamClient, parseRecordedWorkstreams } from "../fake-workstream-client.js";
import { completeSessionKey, createUnifiedNavigationState, joinChatsAndWorkstreams, parseDestinationPreference, reduceUnifiedNavigation, rememberedSessionSurface, serializeDestinationPreference, sessionSurfacePreferenceName } from "../unified-navigation-state.js";
import { projectSessionContext, projectWorkstreamBrief, selectWorkstreamSession, workstreamSessionKey } from "../workstream-brief-projection.js";

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
  const failedScope = joinChatsAndWorkstreams({ ...fixture.native, complete: false, scopeUnavailable: true }, fixture.workstreams);
  assert.equal(failedScope.status, "unavailable");
  assert.equal(failedScope.retainedNativeSessions.length, fixture.native.sessions.length);
  const reconnecting = joinChatsAndWorkstreams(fixture.native, fixture.states.workstreamReconnect);
  assert.equal(reconnecting.status, "reconnecting");
  assert.equal(reconnecting.workstreams.length, 3);
  assert.deepEqual(joinChatsAndWorkstreams(fixture.states.completeEmpty, fixture.workstreams).chats, []);
  const chatsWithoutWorkstreams = joinChatsAndWorkstreams(fixture.native, { ...fixture.workstreams, snapshots: [] });
  assert.equal(chatsWithoutWorkstreams.status, "ready");
  assert.equal(chatsWithoutWorkstreams.chats.length, fixture.native.sessions.length);
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
  assert.deepEqual(duplicate.workstreams, fixture.workstreams.snapshots);
  for (const [native, workstreams] of [
    [{ complete: true, sessions: [{}] }, fixture.workstreams],
    [fixture.native, { complete: true, snapshots: [{ id: "broken" }] }],
  ]) {
    const malformed = joinChatsAndWorkstreams(native, workstreams);
    assert.equal(malformed.status, "invalid");
    assert.deepEqual(malformed.chats, []);
  }
});

test("exact destination preferences round-trip without accepting malformed values", () => {
  const chat = joined.chats[0];
  const destination = { type: "chat", sessionKey: completeSessionKey(chat), location: chat };
  assert.deepEqual(parseDestinationPreference(serializeDestinationPreference(destination)), destination);
  assert.equal(parseDestinationPreference("{broken").type, "root");
  assert.equal(parseDestinationPreference(JSON.stringify({ type: "chat" })).type, "root");
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
  assert.equal(state.selectionError.destination.sessionId, "session-b");
  state = reduceUnifiedNavigation(state, { type: "inventories-reconciled", joined });
  assert.equal(state.selectionError.code, "SESSION_WORKSPACE_UNAVAILABLE");
});

test("persisted surface preference names use the complete session identity without global fallback", () => {
  const first = { machineId: "studio", sessionId: "same", projectId: "project-a", workspaceId: "main" };
  const second = { ...first, projectId: "project-b" };
  assert.notEqual(sessionSurfacePreferenceName(first), sessionSurfacePreferenceName(second));
  assert.match(decodeURIComponent(sessionSurfacePreferenceName(first)), /studio\u0000same\u0000project-a\u0000main/);
  assert.equal(rememberedSessionSurface(undefined), "chat");
  assert.equal(rememberedSessionSurface("context", false), "chat");
  assert.equal(rememberedSessionSurface("context", true), "context");
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
  const legacyBrief = { type: "workstream", workstreamId: "ws-unified" };
  assert.deepEqual(reduceUnifiedNavigation(createUnifiedNavigationState(), {
    type: "restore", destination: legacyBrief, joined: { status: "unavailable", chats: [], workstreams: joined.workstreams },
  }).destination, legacyBrief);
  let state = reduceUnifiedNavigation(createUnifiedNavigationState(), { type: "restore", destination, joined });
  assert.equal(state.destination.type, "chat");
  state = reduceUnifiedNavigation(state, { type: "inventories-reconciled", joined: { status: "ready", chats: [], workstreams: joined.workstreams } });
  assert.equal(state.destination.type, "root");

  state = createUnifiedNavigationState({ destination: { type: "workstream-session", workstreamId: "ws-unified", sessionId: "removed" } });
  assert.deepEqual(reduceUnifiedNavigation(state, { type: "inventories-reconciled", joined }).destination, { type: "workstream", workstreamId: "ws-unified" });

  const nonActive = fixture.workstreams.snapshots[0].sessions.find((session) => session.status !== "active");
  const storedNonActive = { type: "workstream-session", workstreamId: "ws-unified", sessionId: nonActive.id };
  assert.deepEqual(reduceUnifiedNavigation(createUnifiedNavigationState(), {
    type: "restore", destination: storedNonActive, joined,
  }).destination, { type: "workstream", workstreamId: "ws-unified" });

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
  const remembered = projectWorkstreamBrief(workstream, workstreamSessionKey(workstream.sessions[1]));
  assert.deepEqual(remembered.continuation, { resumable: true, status: "stale", sessionStatus: "active", sessionId: "session-b", next: "Run host tests.", reason: "The catalog changed." });
  assert.deepEqual(remembered.unresolvedHumanTasks.map((task) => task.status), ["pending", "answered"]);
  assert.equal(remembered.unresolvedHumanTasks.some((task) => task.id === "task-resolved"), false);
  assert.equal(remembered.sessions.find((session) => session.id === "session-a").whatChanged, "The destination model is fixed.");
  assert.equal(remembered.sessions.find((session) => session.id === "session-c").checkpointStatus, "failed");
  assert.equal(remembered.sessions.find((session) => session.id === "session-c").confirmedCheckpointAvailable, true);
  assert.equal(remembered.sessions.find((session) => session.id === "session-c").priorCheckpointAvailable, true);
  assert.equal(remembered.sessions.find((session) => session.id === "pending:launch").checkpointStatus, "missing");
  assert.equal(Object.hasOwn(remembered, "whatChanged"), false);
  assert.deepEqual(remembered.checkpointHealth.slice(0, 3), [
    { sessionId: "session-a", status: "current" },
    { sessionId: "session-b", status: "stale" },
    { sessionId: "session-c", status: "failed" },
  ]);
  assert.match(projectWorkstreamBrief(workstream, workstreamSessionKey(workstream.sessions[2])).continuation.reason, /rejected/);
  assert.deepEqual(projectWorkstreamBrief(fixture.workstreams.snapshots[1]).continuation, {
    resumable: false,
    status: "missing-anchor",
    sessionStatus: "active",
    sessionId: "session-anchorless",
    next: undefined,
    reason: "An active session exists, but its complete machine, project, and workspace anchor is missing.",
  });
  const closed = projectWorkstreamBrief(fixture.workstreams.snapshots.find((workstream) => workstream.id === "ws-closed"));
  assert.equal(closed.closedAt, "2026-08-01T10:00:00.000Z");
  const malformed = projectWorkstreamBrief({ id: "malformed", title: "Malformed" });
  assert.deepEqual(malformed.sessions, []);
});

test("continuation reports pending, failed, and missing without claiming those sessions are resumable", () => {
  const base = { id: "ws", title: "States", revision: 1, closed: false, humanTasks: [], links: [] };
  const pending = projectWorkstreamBrief({ ...base, sessions: [{ id: "pending", status: "pending", machineId: "m", projectId: "p", workspaceId: "w" }] }).continuation;
  assert.deepEqual({ resumable: pending.resumable, status: pending.status, sessionStatus: pending.sessionStatus }, { resumable: false, status: "pending", sessionStatus: "pending" });
  const failedBrief = projectWorkstreamBrief({ ...base, sessions: [{ id: "failed", status: "failed", machineId: "m", projectId: "p", workspaceId: "w", launchFailure: { reason: "quota denied" } }] });
  const failed = failedBrief.continuation;
  assert.equal(failed.resumable, false);
  assert.equal(failed.status, "missing");
  assert.equal(failed.sessionStatus, "failed");
  assert.equal(failed.reason, "Session launch failed: quota denied");
  assert.deepEqual(failedBrief.checkpointHealth, [{ sessionId: "failed", status: "missing" }]);
  assert.equal(failedBrief.sessions[0].launchFailure.reason, "quota denied");
  const missing = projectWorkstreamBrief({ ...base, sessions: [] }).continuation;
  assert.deepEqual({ resumable: missing.resumable, status: missing.status, sessionId: missing.sessionId }, { resumable: false, status: "missing", sessionId: undefined });
});

test("selected-session Context switches checkpoint and task scope without leaking peer-session tasks", () => {
  const workstream = fixture.workstreams.snapshots[0];
  const first = projectSessionContext(workstream, "session-a");
  const second = projectSessionContext(workstream, "session-b");

  assert.equal(first.session.whatChanged, "The destination model is fixed.");
  assert.equal(first.session.anchor.complete, true);
  assert.deepEqual(first.humanTasks.map((task) => task.id), ["task-pending"]);
  assert.equal(second.session.checkpointStatus, "stale");
  assert.deepEqual(second.humanTasks.map((task) => task.id), ["task-answered"]);
  assert.equal(second.links[0].id, "link-plan");
  assert.equal(projectSessionContext(workstream, "not-a-session"), undefined);
});
