import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicFakeWorkstreamClient, parseRecordedWorkstreams } from "../fake-workstream-client.js";
import { checkpointProposalPrompt, copyNextSessionPrompt, currentSessionLocationResult, dedicatedMobileControlState, dedicatedWorkstreamLayout, hostedChatViewRequiresRemount, hostedSurfaceMountOptions, normalizeDedicatedMobilePane, parseWorkbenchProjection, recordedWorkstreamSelection, sessionAnchor, startLocationFailureMessage, startLocationRecoveryVisible, transitionDedicatedWorkstreamUi, typedHostError } from "../pi-web-plugin.js";
import { createWorkbenchWorkstreamClient, reconcileWorkstreams, WorkstreamClientError } from "../workstream-client.js";
import { WorkstreamSessionCoordinator } from "../workstream-session-coordinator.js";

const fixtureUrl = new URL("../fixtures/recorded-projection.json", import.meta.url);
const pluginSource = await readFile(new URL("../pi-web-plugin.js", import.meta.url), "utf8");

test("restores the recorded Workstream and remembered active session after the host reconstructs the plugin element", () => {
  const snapshots = [{ id: "ws-other", sessions: [] }, { id: "ws-selected", sessions: [
    { id: "session-first", status: "active" },
    { id: "session-remembered", status: "active" },
  ] }];

  assert.deepEqual(recordedWorkstreamSelection(snapshots, "ws-selected", "session-remembered"), {
    snapshot: snapshots[1],
    sessionId: "session-remembered",
  });
  assert.equal(recordedWorkstreamSelection(snapshots, "missing", "session-remembered"), undefined);
});

test("hosted Chat requests prompt-editor status placement without changing other surface mounts", () => {
  assert.deepEqual(hostedSurfaceMountOptions("chat"), { chatStatusPlacement: "prompt-editor" });
  assert.equal(hostedSurfaceMountOptions("files"), undefined);
  assert.equal(hostedSurfaceMountOptions("terminal"), undefined);
});

test("native Chat destinations retain mounted host surfaces while the surface host is stable", () => {
  const surfaceHost = {};
  assert.equal(hostedChatViewRequiresRemount(undefined, surfaceHost), true);
  assert.equal(hostedChatViewRequiresRemount({ sessionKey: "old", surfaceHost }, surfaceHost), false);
  assert.equal(hostedChatViewRequiresRemount({ sessionKey: "old", surfaceHost }, {}), true);
});

test("Terminal dock uses its retained view node and bounded accessible presentation", () => {
  assert.match(pluginSource, /shell\.append\(banner, topbar, view\.sessionTabs, mobileNavigation, body, view\.terminal\)/);
  assert.doesNotMatch(pluginSource, /terminalContext|body, terminal\)/);
  assert.doesNotMatch(pluginSource, /max-height:\s*min\(60dvh/);
  assert.match(pluginSource, /\.terminal-drawer > button \{[^}]*min-height: max\(44px, var\(--pi-control-min-size, 44px\)\)/);
  assert.match(pluginSource, /\.terminal-drawer\.open \{ grid-template: 6px/);
  assert.match(pluginSource, /\.terminal-resize-separator::before \{[^}]*bottom: 0;[^}]*height: max\(44px, var\(--pi-control-min-size, 44px\)\)/);
  assert.doesNotMatch(pluginSource, /\.terminal-resize-separator \{[^}]*min-height: 44px/);
});

test("dedicated Workstream surfaces give Context canonical selected-session scope", () => {
  assert.deepEqual(dedicatedWorkstreamLayout({ tool: "files", sessionsPaneOpen: true }), {
    sessionsPaneVisible: true,
    surface: "files",
    scope: "selected-session-checkout",
  });
  assert.deepEqual(dedicatedWorkstreamLayout({ tool: "context", sessionsPaneOpen: true }), {
    sessionsPaneVisible: true,
    surface: "context",
    scope: "canonical-selected-session-context",
  });
});

test("dedicated Workstream UI transitions select Context as a peer surface", () => {
  const initial = { tool: "chat", sessionsPaneOpen: true, terminalOpen: false, mobilePane: "sessions" };
  const context = transitionDedicatedWorkstreamUi(initial, { type: "select-surface", surface: "context" });
  assert.deepEqual(context, { ...initial, tool: "context", mobilePane: "workspace" });

  const terminal = transitionDedicatedWorkstreamUi(context, { type: "select-surface", surface: "terminal" });
  assert.deepEqual(terminal, { ...context, terminalOpen: true });
  assert.equal(terminal.tool, "context");
});

test("narrow navigation remains a one-pane Sessions or Workspace choice", () => {
  assert.equal(normalizeDedicatedMobilePane("tasks"), "workspace");
  assert.equal(transitionDedicatedWorkstreamUi({ mobilePane: "sessions" }, { type: "select-mobile-pane", pane: "tasks" }).mobilePane, "workspace");
  assert.deepEqual(dedicatedMobileControlState({ mobilePane: "workspace" }, "workspace"), { selected: true });
  assert.deepEqual(dedicatedMobileControlState({ mobilePane: "workspace" }, "sessions"), { selected: false });
});

test("checkout scope follows the selected Workstream session anchor", () => {
  assert.equal(sessionAnchor({ projectId: "pi-web", workspaceId: "feature/workstreams", machineId: "studio" }), "pi-web · feature/workstreams · studio");
  assert.equal(sessionAnchor({ projectId: "workbench", workspaceId: "main", machineId: "laptop" }), "workbench · main · laptop");
});

test("incomplete-start recovery clears for a complete checkout or destination reset", () => {
  const incomplete = { machineId: "studio", workspaceId: "main" };
  const complete = { ...incomplete, projectId: "workbench" };
  assert.equal(startLocationRecoveryVisible(true, incomplete), true);
  assert.equal(startLocationRecoveryVisible(true, complete), false);
  assert.equal(startLocationRecoveryVisible(true, incomplete, true), false);
});

test("current-location host failures retain typed codes and receive a typed fallback", () => {
  assert.deepEqual(currentSessionLocationResult({ currentLocation() { throw Object.assign(new Error("catalog offline"), { code: "CATALOG_OFFLINE" }); } }), {
    ok: false,
    error: { code: "CATALOG_OFFLINE", message: "catalog offline" },
  });
  const failed = currentSessionLocationResult({ currentLocation() { throw new Error("host threw"); } });
  assert.deepEqual(failed, { ok: false, error: { code: "CURRENT_LOCATION_FAILED", message: "host threw" } });
  assert.equal(startLocationFailureMessage(failed.error), "host threw (CURRENT_LOCATION_FAILED). A new Workstream session was not started.");
  assert.deepEqual(currentSessionLocationResult({ currentLocation: () => ({ machineId: "studio", projectId: "workbench", workspaceId: "main" }) }), {
    ok: true,
    location: { machineId: "studio", projectId: "workbench", workspaceId: "main" },
  });
  assert.deepEqual(typedHostError("host string", "CURRENT_LOCATION_FAILED"), { code: "CURRENT_LOCATION_FAILED", message: "host string" });
});

test("accepts the deterministic recorded projection", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const projection = parseWorkbenchProjection(fixture);

  assert.equal(projection?.run.id, "run-compact-probe-001");
  assert.equal(projection?.run.revision, 7);
  assert.equal(projection?.attention.length, 1);
  assert.equal(projection?.evidence[0]?.path, "docs/integrations/pi-web/customization-plan.md");
});

test("rejects unknown versions and incomplete canonical fields", () => {
  assert.equal(parseWorkbenchProjection({ version: 2, run: {} }), undefined);
  assert.equal(parseWorkbenchProjection({
    version: 1,
    run: { id: "run-1", outcome: "Outcome", status: "active", revision: 1, authority: {} },
    attention: [],
    activity: [],
    evidence: [],
  }), undefined);
});

test("fake Workstream client deterministically lists, inspects, and reconciles the recorded projection", async () => {
  const fixtureUrl = new URL("../fixtures/recorded-workstreams.json", import.meta.url);
  const fixture = parseRecordedWorkstreams(JSON.parse(await readFile(fixtureUrl, "utf8")));
  assert.notEqual(fixture, undefined);
  const client = new DeterministicFakeWorkstreamClient(fixture);

  const current = await client.list();
  const inspected = await client.inspect("ws-workstream-store");
  const reconciliation = await client.watch({ afterSequence: 0 });
  const caughtUp = await client.watch({ afterSequence: 16 });

  assert.deepEqual(current.map((workstream) => workstream.id), ["ws-workstream-store"]);
  assert.equal(current[0].failedSessionCount, 1);
  assert.equal(current[0].unresolvedHumanTaskCount, 1);
  assert.equal(inspected.sessions.length, 5);
  assert.match(inspected.sessions[0].latestCheckpoint.nextSessionPrompt, /Continue connecting the Workstream Store/);
  assert.equal(inspected.sessions.find((session) => session.id === "session-stale-checkpoint")?.latestCheckpoint.nextSessionPrompt, null);
  assert.equal(inspected.sessions.find((session) => session.status === "failed")?.launchFailure.reason, "PI WEB could not create the attended session.");
  assert.equal(inspected.sessions.find((session) => session.checkpointStaleness !== null)?.checkpointStaleness.checkpointId, "checkpoint-before-protocol-change");
  assert.equal(inspected.humanTasks.find((task) => task.status === "answered")?.answer.optionId, "change");
  assert.equal(reconciliation.mode, "snapshot");
  assert.equal(reconciliation.snapshots.length, 2);
  assert.deepEqual(caughtUp, { mode: "replay", events: [], nextSequence: 16 });
});

test("fake and typed clients project pending derivation and remove cancelled associations", async () => {
  const client = new DeterministicFakeWorkstreamClient({ version: 1, sequence: 0, snapshots: [] });
  await client.create({ workstreamId: "ws-derived", idempotencyKey: "create-derived", title: "Derived", producer: "owner" });
  await client.append({
    workstreamId: "ws-derived",
    expectedRevision: 1,
    idempotencyKey: "pending-derived",
    records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:fork-1", machineId: "studio", projectId: "pi-web", workspaceId: "main", derivationKind: "fork" } }],
  });
  const pending = await client.inspect("ws-derived");
  assert.equal(pending.sessions[0].derivationKind, "fork");

  const typed = createWorkbenchWorkstreamClient({ request: async () => ({ ok: true, value: pending }) });
  assert.equal((await typed.inspect("ws-derived")).sessions[0].derivationKind, "fork");

  await client.append({
    workstreamId: "ws-derived",
    expectedRevision: 2,
    idempotencyKey: "cancel-derived",
    records: [{ type: "session.cancelled", producer: "pi-web", payload: { associationKey: "pi-web:fork-1", reason: "Owner cancelled" } }],
  });
  assert.deepEqual((await client.inspect("ws-derived")).sessions, []);
  await assert.rejects(client.append({
    workstreamId: "ws-derived",
    expectedRevision: 3,
    idempotencyKey: "reuse-cancelled-derived",
    records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:fork-1", machineId: "studio", projectId: "pi-web", workspaceId: "main", derivationKind: "fork" } }],
  }), /already used/);
  await client.append({
    workstreamId: "ws-derived",
    expectedRevision: 3,
    idempotencyKey: "pending-checkpoint-derived",
    records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "pi-web:checkpoint-2", machineId: "studio", projectId: "pi-web", workspaceId: "main", derivationKind: "checkpoint" } }],
  });
  await client.append({
    workstreamId: "ws-derived",
    expectedRevision: 4,
    idempotencyKey: "confirm-checkpoint-derived",
    records: [{ type: "session.confirmed", producer: "pi-web", payload: { sessionId: "derived-active", associationKey: "pi-web:checkpoint-2", machineId: "studio", projectId: "pi-web", workspaceId: "main" } }],
  });
  assert.equal((await client.inspect("ws-derived")).sessions[0].derivationKind, undefined);

  const malformed = structuredClone(pending);
  malformed.sessions[0].derivationKind = "blank";
  assert.equal(parseRecordedWorkstreams({ version: 1, sequence: 2, snapshots: [malformed] }), undefined);
  const malformedTyped = createWorkbenchWorkstreamClient({ request: async () => ({ ok: true, value: malformed }) });
  await assert.rejects(malformedTyped.inspect("ws-derived"), (error) => error instanceof WorkstreamClientError && error.code === "INVALID_RESPONSE");
});

test("checkpoint proposal guidance carries the complete attended contract", () => {
  const proposal = checkpointProposalPrompt();
  assert.match(proposal, /exactly five labeled parts/);
  assert.match(proposal, /Next-session prompt/);
  assert.match(proposal, /References/);
});

test("copies the exact next-session prompt and falls back when clipboard access fails", async () => {
  let copied;
  const clipboardResult = await copyNextSessionPrompt("Continue exactly here.", {
    clipboard: { writeText: async (value) => { copied = value; } },
    fallback: () => assert.fail("fallback should not be used"),
  });
  assert.equal(clipboardResult, "clipboard");
  assert.equal(copied, "Continue exactly here.");

  let fallback;
  const fallbackResult = await copyNextSessionPrompt("Resume safely.", {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
    fallback: (value) => { fallback = value; },
  });
  assert.equal(fallbackResult, "fallback");
  assert.equal(fallback, "Resume safely.");
});

test("typed Workstream client uses all operations and persists across web-process service replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-workbench-web-client-"));
  const previous = process.env.PI_WORKBENCH_WORKSTREAM_DIR;
  process.env.PI_WORKBENCH_WORKSTREAM_DIR = directory;
  try {
    const firstService = (await import(`../workstream-service.js?instance=first-${Date.now()}`)).default;
    const first = createWorkbenchWorkstreamClient({ request: (operation, input) => firstService.handle({ operation, input }) });
    const created = await first.create({ workstreamId: "ws-browser", idempotencyKey: "create-browser", title: "Browser continuity", producer: "owner" });
    const appended = await first.append({
      workstreamId: "ws-browser",
      expectedRevision: created.acceptedRevision,
      idempotencyKey: "append-browser",
      records: [{ type: "link.upsert", producer: "owner", payload: { link: { id: "link-browser", kind: "reference", reference: "docs/plans/level-1.md" } } }],
    });
    assert.equal((await first.list()).length, 1);
    assert.equal((await first.inspect("ws-browser")).links.length, 1);
    const serverPlugin = (await import(`../server-plugin.js?instance=${Date.now()}`)).default;
    assert.equal(serverPlugin.apiVersion, 3);
    const serverResult = await serverPlugin.activate().peer.request({
      operation: "inspect",
      input: { workstreamId: "ws-browser" },
      signal: new AbortController().signal,
      project: { id: "project" },
      workspace: { id: "workspace" },
    });
    assert.equal(serverResult.ok, true);
    assert.equal(serverResult.value.id, "ws-browser");
    const replay = await first.watch({ afterSequence: created.sequence });
    assert.equal(replay.mode, "replay");
    assert.deepEqual(replay.events.map((event) => event.sequence), [appended.sequence]);

    const replacementService = (await import(`../workstream-service.js?instance=replacement-${Date.now()}`)).default;
    const replacement = createWorkbenchWorkstreamClient({ request: (operation, input) => replacementService.handle({ operation, input }) });
    assert.equal((await replacement.inspect("ws-browser")).revision, 2);
    const closed = await replacement.close({ workstreamId: "ws-browser", expectedRevision: 2, idempotencyKey: "close-browser", producer: "owner" });
    assert.equal(closed.acceptedRevision, 3);
    assert.equal((await replacement.list({ includeClosed: true }))[0].closed, true);
  } finally {
    if (previous === undefined) delete process.env.PI_WORKBENCH_WORKSTREAM_DIR;
    else process.env.PI_WORKBENCH_WORKSTREAM_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("reconnect reconciliation applies ordered replay or replaces from a snapshot", async () => {
  const snapshots = [{ id: "ws-1", title: "One", revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", sessions: [], humanTasks: [], links: [], closed: false, closedAt: null }];
  const replayClient = {
    watch: async () => ({ mode: "replay", events: [{ sequence: 3, workstreamId: "ws-1" }], nextSequence: 3 }),
    inspect: async () => ({ ...snapshots[0], revision: 2, updatedAt: "2026-01-02T00:00:00.000Z" }),
  };
  const replayed = await reconcileWorkstreams(replayClient, { snapshots, sequence: 2 });
  assert.equal(replayed.mode, "replay");
  assert.equal(replayed.snapshots[0].revision, 2);

  const snapshotClient = { watch: async () => ({ mode: "snapshot", snapshots, nextSequence: 9 }) };
  const reconciled = await reconcileWorkstreams(snapshotClient, { snapshots: [], sequence: 1 });
  assert.equal(reconciled.mode, "snapshot");
  assert.equal(reconciled.sequence, 9);
  assert.equal(reconciled.snapshots[0].id, "ws-1");
});

test("session launch records pending before start and confirms exactly one runtime session", async () => {
  const calls = [];
  let snapshot = { id: "ws-1", title: "Pair", revision: 1, sessions: [], closed: false };
  const client = {
    inspect: async () => structuredClone(snapshot),
    append: async (request) => {
      calls.push(request.records[0].type);
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      return { acceptedRevision: snapshot.revision, sequence: snapshot.revision };
    },
  };
  const host = {
    currentLocation: () => ({ machineId: "local", projectId: "project-1", workspaceId: "workspace-1" }),
    start: async ({ startupToken, initialPrompt }) => {
      assert.equal(calls[0], "session.pending");
      assert.match(initialPrompt, /Workstream “Pair”/);
      assert.match(initialPrompt, /Level 1 Pair posture/);
      assert.match(initialPrompt, /exact paste-ready prompt/);
      assert.match(initialPrompt, /review and confirm every field before persistence/);
      return { id: "session-runtime", location: { machineId: "local", projectId: "project-1", workspaceId: "workspace-1" } };
    },
    open: async () => {},
    findByStartupToken: async () => undefined,
  };
  const result = await new WorkstreamSessionCoordinator(client, host).launch(snapshot);
  assert.equal(result.id, "session-runtime");
  assert.deepEqual(calls, ["session.pending", "session.confirmed"]);
});

test("confirmation response loss reconciles the accepted association without failing or relaunching", async () => {
  let starts = 0;
  let snapshot = { id: "ws-1", title: "Pair", revision: 1, sessions: [], closed: false };
  const client = {
    inspect: async () => structuredClone(snapshot),
    append: async (request) => {
      const record = request.records[0];
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      if (record.type === "session.pending") snapshot.sessions = [{ id: `pending:${record.payload.associationKey}`, status: "pending", associationKey: record.payload.associationKey }];
      if (record.type === "session.confirmed") {
        snapshot.sessions = [{ id: record.payload.sessionId, status: "active", associationKey: record.payload.associationKey, machineId: record.payload.machineId, projectId: record.payload.projectId, workspaceId: record.payload.workspaceId }];
        throw new Error("response lost after commit");
      }
      return { acceptedRevision: snapshot.revision, sequence: snapshot.revision };
    },
  };
  const host = {
    currentLocation: () => ({ machineId: "local", projectId: "project-1", workspaceId: "workspace-1" }),
    start: async () => { starts += 1; return { id: "runtime-1", location: { machineId: "local", projectId: "project-1", workspaceId: "workspace-1" } }; },
    open: async () => {}, findByStartupToken: async () => undefined,
  };
  const result = await new WorkstreamSessionCoordinator(client, host).launch(snapshot);
  assert.equal(result.id, "runtime-1");
  assert.equal(starts, 1);
  assert.deepEqual(snapshot.sessions.map((session) => session.id), ["runtime-1"]);
});

test("confirmation failure leaves the created session pending for reconnect reconciliation", async () => {
  let snapshot = { id: "ws-1", title: "Pair", revision: 1, sessions: [], closed: false };
  const client = {
    inspect: async () => structuredClone(snapshot),
    append: async (request) => {
      const record = request.records[0];
      if (record.type === "session.pending") {
        snapshot = { ...snapshot, revision: 2, sessions: [{ id: `pending:${record.payload.associationKey}`, status: "pending", associationKey: record.payload.associationKey }] };
        return { acceptedRevision: 2, sequence: 2 };
      }
      throw new Error("store temporarily unavailable");
    },
  };
  const host = {
    currentLocation: () => ({ machineId: "local", projectId: "project-1", workspaceId: "workspace-1" }),
    start: async () => ({ id: "runtime-1", location: { machineId: "local", projectId: "project-1", workspaceId: "workspace-1" } }),
    open: async () => {}, findByStartupToken: async () => undefined,
  };
  const result = await new WorkstreamSessionCoordinator(client, host).launch(snapshot);
  assert.equal(result.id, "runtime-1");
  assert.equal(result.workstreamAssociation, "pending");
  assert.match(result.workstreamAssociationReason, /store temporarily unavailable/);
  assert.equal(snapshot.sessions[0].status, "pending");
});

test("an unproven launch exception remains pending and does not retry the host start", async () => {
  const records = [];
  let revision = 1;
  let starts = 0;
  let sessions = [];
  const client = {
    inspect: async () => ({ id: "ws-1", title: "Pair", revision, sessions, closed: false }),
    append: async (request) => {
      const record = request.records[0];
      records.push(record.type);
      revision += 1;
      if (record.type === "session.pending") sessions = [{ id: `pending:${record.payload.associationKey}`, status: "pending", associationKey: record.payload.associationKey, machineId: record.payload.machineId, projectId: record.payload.projectId, workspaceId: record.payload.workspaceId }];
      return { acceptedRevision: revision, sequence: revision };
    },
  };
  const host = {
    currentLocation: () => ({ machineId: "local", projectId: "project-1", workspaceId: "workspace-1" }),
    start: async () => { starts += 1; throw new Error("launch transport dropped"); },
    open: async () => {},
    findByStartupToken: async () => undefined,
  };
  await assert.rejects(new WorkstreamSessionCoordinator(client, host).launch({ id: "ws-1", title: "Pair", revision: 1, sessions: [], closed: false }), (error) => error.code === "SESSION_LAUNCH_PENDING");
  assert.equal(starts, 1);
  assert.deepEqual(records, ["session.pending"]);
  assert.equal(sessions[0].status, "pending");
});

test("a checked pre-creation rejection records session failure", async () => {
  const records = [];
  let revision = 1;
  let sessions = [];
  const client = {
    inspect: async () => ({ id: "ws-1", title: "Pair", revision, sessions, closed: false }),
    append: async (request) => {
      const record = request.records[0];
      records.push(record.type);
      revision += 1;
      if (record.type === "session.pending") sessions = [{ id: `pending:${record.payload.associationKey}`, status: "pending", associationKey: record.payload.associationKey, machineId: record.payload.machineId, projectId: record.payload.projectId, workspaceId: record.payload.workspaceId }];
      if (record.type === "session.failed") sessions = [{ ...sessions[0], status: "failed" }];
      return { acceptedRevision: revision, sequence: revision };
    },
  };
  const rejection = Object.assign(new Error("location rejected before creation"), { code: "SESSION_START_REJECTED" });
  const host = {
    currentLocation: () => ({ machineId: "local", projectId: "project-1", workspaceId: "workspace-1" }),
    start: async () => { throw rejection; },
    open: async () => {},
    findByStartupToken: async () => undefined,
  };
  await assert.rejects(new WorkstreamSessionCoordinator(client, host).launch({ id: "ws-1", title: "Pair", revision: 1, sessions: [], closed: false }), (error) => error.code === "SESSION_LAUNCH_FAILED");
  assert.deepEqual(records, ["session.pending", "session.failed"]);
});

test("a host location change after readiness fails before creating a session", async () => {
  const records = [];
  let revision = 1;
  let sessions = [];
  const client = {
    inspect: async () => ({ id: "ws-1", title: "Pair", revision, sessions, closed: false }),
    append: async (request) => {
      const record = request.records[0];
      records.push(record.type);
      revision += 1;
      if (record.type === "session.pending") sessions = [{ id: `pending:${record.payload.associationKey}`, status: "pending", associationKey: record.payload.associationKey, machineId: record.payload.machineId, projectId: record.payload.projectId, workspaceId: record.payload.workspaceId }];
      if (record.type === "session.failed") sessions = [{ ...sessions[0], status: "failed" }];
      return { acceptedRevision: revision, sequence: revision };
    },
  };
  let locationReads = 0;
  let starts = 0;
  const host = {
    currentLocation: () => {
      locationReads += 1;
      return locationReads < 3
        ? { machineId: "local", projectId: "project-1", workspaceId: "workspace-1" }
        : { machineId: "local", projectId: "project-1", workspaceId: "other" };
    },
    start: async () => { starts += 1; return { id: "must-not-start" }; },
    open: async () => {},
    findByStartupToken: async () => undefined,
  };
  await assert.rejects(new WorkstreamSessionCoordinator(client, host).launch({ id: "ws-1", title: "Pair", revision: 1, sessions: [], closed: false }), (error) => error.code === "SESSION_LAUNCH_FAILED");
  assert.equal(starts, 0);
  assert.deepEqual(records, ["session.pending", "session.failed"]);
});

test("typed Workstream client rejects malformed canonical success values", async () => {
  const client = createWorkbenchWorkstreamClient({ request: async () => ({ ok: true, value: { id: "incomplete" } }) });
  await assert.rejects(client.inspect("ws-1"), (error) => error instanceof WorkstreamClientError && error.code === "INVALID_RESPONSE");

  const fixture = JSON.parse(await readFile(new URL("../fixtures/recorded-workstreams.json", import.meta.url), "utf8"));
  delete fixture.snapshots[0].sessions[0].latestCheckpoint.nextSessionPrompt;
  const missingPromptClient = createWorkbenchWorkstreamClient({ request: async () => ({ ok: true, value: fixture.snapshots[0] }) });
  await assert.rejects(missingPromptClient.inspect("ws-workstream-store"), (error) => error instanceof WorkstreamClientError && error.code === "INVALID_RESPONSE");

  fixture.snapshots[0].sessions[0].latestCheckpoint.nextSessionPrompt = null;
  const legacyPromptClient = createWorkbenchWorkstreamClient({ request: async () => ({ ok: true, value: fixture.snapshots[0] }) });
  assert.equal((await legacyPromptClient.inspect("ws-workstream-store")).sessions[0].latestCheckpoint.nextSessionPrompt, null);
});

test("fake Workstream client rejects replacement checkpoints without the required prompt", async () => {
  const fixture = parseRecordedWorkstreams(JSON.parse(await readFile(new URL("../fixtures/recorded-workstreams.json", import.meta.url), "utf8")));
  const client = new DeterministicFakeWorkstreamClient(fixture);
  await assert.rejects(client.append({
    workstreamId: "ws-workstream-store",
    expectedRevision: 8,
    idempotencyKey: "missing-next-session-prompt",
    records: [{ type: "checkpoint.replaced", producer: "owner", payload: { sessionId: "session-store-contract", checkpoint: { id: "cp-invalid", whatChanged: "Changed", remains: "Remains", next: "Next" } } }],
  }), /requires a next-session prompt/);
});

test("typed Workstream client structurally validates optional projected session anchors", async () => {
  const fixtureUrl = new URL("../fixtures/anchorless-active-session.json", import.meta.url);
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  fixture.snapshots[0].sessions[0].machineId = 42;
  assert.equal(parseRecordedWorkstreams(fixture), undefined);
  const client = createWorkbenchWorkstreamClient({ request: async () => ({ ok: true, value: fixture.snapshots[0] }) });
  await assert.rejects(client.inspect("ws-anchorless-session"), (error) => error instanceof WorkstreamClientError && error.code === "INVALID_RESPONSE");
});

test("fake client accepts anchorless confirmations and validates partial anchors and repairs", async () => {
  const fixtureUrl = new URL("../fixtures/anchorless-active-session.json", import.meta.url);
  const fixture = parseRecordedWorkstreams(JSON.parse(await readFile(fixtureUrl, "utf8")));
  const client = new DeterministicFakeWorkstreamClient(fixture);
  await client.append({
    workstreamId: "ws-anchorless-session",
    expectedRevision: 1,
    idempotencyKey: "pending-new",
    records: [{ type: "session.pending", producer: "pi-web", payload: { associationKey: "launch-new" } }],
  });
  await assert.rejects(client.append({
    workstreamId: "ws-anchorless-session",
    expectedRevision: 2,
    idempotencyKey: "confirm-partial",
    records: [{ type: "session.confirmed", producer: "pi-web", payload: { associationKey: "launch-new", sessionId: "session-new", machineId: "studio" } }],
  }), /provide machineId, projectId, and workspaceId together/);
  await client.append({
    workstreamId: "ws-anchorless-session",
    expectedRevision: 2,
    idempotencyKey: "confirm-incomplete",
    records: [{ type: "session.confirmed", producer: "session", payload: { associationKey: "launch-new", sessionId: "session-new" } }],
  });
  assert.equal((await client.inspect("ws-anchorless-session")).sessions.find((session) => session.id === "session-new").machineId, undefined);
  await assert.rejects(client.append({
    workstreamId: "ws-anchorless-session",
    expectedRevision: 3,
    idempotencyKey: "confirm-active-again",
    records: [{ type: "session.confirmed", producer: "session", payload: { associationKey: "launch-new", sessionId: "session-new" } }],
  }), /Pending association.*was not found/);
  await assert.rejects(client.append({
    workstreamId: "ws-anchorless-session",
    expectedRevision: 3,
    idempotencyKey: "repair-invalid",
    records: [{ type: "session.anchor.repaired", producer: "pi-web", payload: { sessionId: "session-photoquest-anchorless", machineId: "studio", projectId: "photoquest", workspaceId: "main", resolution: {} } }],
  }), /complete-machine-scan resolution evidence/);

  await client.append({
    workstreamId: "ws-anchorless-session",
    expectedRevision: 3,
    idempotencyKey: "repair-valid",
    records: [{ type: "session.anchor.repaired", producer: "pi-web", payload: { sessionId: "session-photoquest-anchorless", machineId: "studio", projectId: "photoquest", workspaceId: "main", resolution: { method: "complete-machine-scan", evidenceId: "catalog-1", matchedCwd: "/PhotoQuest", scannedScopeCount: 2, verifiedAt: "2026-08-01T09:00:01.000Z" } } }],
  });
  assert.equal((await client.inspect("ws-anchorless-session")).sessions[0].workspaceId, "main");
});

test("session launch refuses an incomplete selected location before writing a new association", async () => {
  let appends = 0;
  const client = { append: async () => { appends += 1; }, inspect: async () => ({}) };
  const host = { currentLocation: () => ({ machineId: "local", workspaceId: "main" }) };
  await assert.rejects(
    new WorkstreamSessionCoordinator(client, host).launch({ id: "ws-1", title: "Pair", revision: 1, sessions: [], closed: false }),
    /complete machine, project, and workspace location/,
  );
  assert.equal(appends, 0);
});

test("typed Workstream client preserves semantic service errors", async () => {
  const client = createWorkbenchWorkstreamClient({ request: async () => ({ ok: false, error: { code: "STALE_REVISION", message: "stale" } }) });
  await assert.rejects(client.close({}), (error) => error instanceof WorkstreamClientError && error.code === "STALE_REVISION");
});

test("rejects malformed recorded Workstream projections", () => {
  assert.equal(parseRecordedWorkstreams({ version: 2, sequence: 1, snapshots: [] }), undefined);
  assert.equal(parseRecordedWorkstreams({ version: 1, sequence: 1, snapshots: [{ id: "incomplete" }] }), undefined);
});
