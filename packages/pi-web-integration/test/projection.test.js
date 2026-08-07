import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicFakeWorkstreamClient, parseRecordedWorkstreams } from "../fake-workstream-client.js";
import { checkpointProposalPrompt, copyNextSessionPrompt, dedicatedWorkstreamLayout, parseWorkbenchProjection, sessionAnchor, transitionDedicatedWorkstreamUi } from "../pi-web-plugin.js";
import { createWorkbenchWorkstreamClient, reconcileWorkstreams, WorkstreamClientError } from "../workstream-client.js";
import { WorkstreamSessionCoordinator, workstreamPrompt } from "../workstream-session-coordinator.js";

const fixtureUrl = new URL("../fixtures/recorded-projection.json", import.meta.url);

test("dedicated Workstream tools preserve Sessions and Human Tasks with truthful scope", () => {
  assert.deepEqual(dedicatedWorkstreamLayout({ tool: "files", sessionsPaneOpen: true, tasksPaneOpen: true }), {
    sessionsPaneVisible: true,
    tasksPaneVisible: true,
    surface: "files",
    scope: "selected-session-checkout",
  });
  assert.deepEqual(dedicatedWorkstreamLayout({ tool: "git", sessionsPaneOpen: true, tasksPaneOpen: true }), {
    sessionsPaneVisible: true,
    tasksPaneVisible: true,
    surface: "git",
    scope: "selected-session-checkout-observed-unattributed",
  });
});

test("dedicated Workstream UI transitions preserve pane state and checkout-scoped tool state", () => {
  const initial = { tool: "chat", sessionsPaneOpen: true, tasksPaneOpen: true, terminalOpen: false, mobilePane: "sessions" };
  const files = transitionDedicatedWorkstreamUi(initial, { type: "select-surface", surface: "files" });
  assert.deepEqual(files, { ...initial, tool: "files", mobilePane: "workspace" });

  const terminal = transitionDedicatedWorkstreamUi(files, { type: "select-surface", surface: "terminal" });
  assert.deepEqual(terminal, { ...files, terminalOpen: true });
  assert.equal(terminal.tool, "files");

  const collapsed = transitionDedicatedWorkstreamUi(terminal, { type: "toggle-tasks" });
  assert.equal(collapsed.tasksPaneOpen, false);
  assert.equal(collapsed.sessionsPaneOpen, true);
  assert.equal(collapsed.tool, "files");
});

test("checkout scope follows the selected Workstream session anchor", () => {
  assert.equal(sessionAnchor({ projectId: "pi-web", workspaceId: "feature/workstreams", machineId: "studio" }), "pi-web · feature/workstreams · studio");
  assert.equal(sessionAnchor({ projectId: "workbench", workspaceId: "main", machineId: "laptop" }), "workbench · main · laptop");
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
  const caughtUp = await client.watch({ afterSequence: 12 });

  assert.deepEqual(current.map((workstream) => workstream.id), ["ws-workstream-store"]);
  assert.equal(inspected.sessions.length, 2);
  assert.match(inspected.sessions[0].latestCheckpoint.nextSessionPrompt, /Continue connecting the Workstream Store/);
  assert.equal(inspected.sessions[1].latestCheckpoint.nextSessionPrompt, null);
  assert.equal(reconciliation.mode, "snapshot");
  assert.equal(reconciliation.snapshots.length, 2);
  assert.deepEqual(caughtUp, { mode: "replay", events: [], nextSequence: 12 });
});

test("checkpoint proposal and new-session guidance carry the complete attended contract", () => {
  const proposal = checkpointProposalPrompt();
  assert.match(proposal, /exactly five labeled parts/);
  assert.match(proposal, /Next-session prompt/);
  assert.match(proposal, /References/);

  const startup = workstreamPrompt({ id: "ws-1", title: "Pair" }, "launch-1");
  assert.match(startup, /exact paste-ready prompt/);
  assert.match(startup, /concrete references/);
  assert.match(startup, /review and confirm every field/);
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
        snapshot.sessions = [{ id: record.payload.sessionId, status: "active", associationKey: record.payload.associationKey }];
        throw new Error("response lost after commit");
      }
      return { acceptedRevision: snapshot.revision, sequence: snapshot.revision };
    },
  };
  const host = {
    currentLocation: () => ({ machineId: "local", workspaceId: "workspace-1" }),
    start: async () => { starts += 1; return { id: "runtime-1", location: { machineId: "local", workspaceId: "workspace-1" } }; },
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
    currentLocation: () => ({ machineId: "local", workspaceId: "workspace-1" }),
    start: async () => ({ id: "runtime-1", location: { machineId: "local", workspaceId: "workspace-1" } }),
    open: async () => {}, findByStartupToken: async () => undefined,
  };
  await assert.rejects(new WorkstreamSessionCoordinator(client, host).launch(snapshot), /store temporarily unavailable/);
  assert.equal(snapshot.sessions[0].status, "pending");
});

test("session launch failure records failure and does not retry the host start", async () => {
  const records = [];
  let revision = 1;
  let starts = 0;
  const client = {
    inspect: async () => ({ id: "ws-1", title: "Pair", revision, sessions: [], closed: false }),
    append: async (request) => { records.push(request.records[0].type); revision += 1; return { acceptedRevision: revision, sequence: revision }; },
  };
  const host = {
    currentLocation: () => ({ machineId: "local", workspaceId: "workspace-1" }),
    start: async () => { starts += 1; throw new Error("launch exploded"); },
    open: async () => {},
    findByStartupToken: async () => undefined,
  };
  await assert.rejects(new WorkstreamSessionCoordinator(client, host).launch({ id: "ws-1", title: "Pair", revision: 1, sessions: [], closed: false }), /launch exploded/);
  assert.equal(starts, 1);
  assert.deepEqual(records, ["session.pending", "session.failed"]);
});

test("typed Workstream client requires canonical projected next-session prompts", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/recorded-workstreams.json", import.meta.url), "utf8"));
  const valid = createWorkbenchWorkstreamClient({ request: async () => ({ ok: true, value: fixture.snapshots[0] }) });
  assert.equal((await valid.inspect("ws-workstream-store")).sessions[1].latestCheckpoint.nextSessionPrompt, null);

  delete fixture.snapshots[0].sessions[0].latestCheckpoint.nextSessionPrompt;
  const missing = createWorkbenchWorkstreamClient({ request: async () => ({ ok: true, value: fixture.snapshots[0] }) });
  await assert.rejects(missing.inspect("ws-workstream-store"), (error) => error instanceof WorkstreamClientError && error.code === "INVALID_RESPONSE");
});

test("fake Workstream client rejects replacement checkpoints without the required prompt", async () => {
  const fixture = parseRecordedWorkstreams(JSON.parse(await readFile(new URL("../fixtures/recorded-workstreams.json", import.meta.url), "utf8")));
  const client = new DeterministicFakeWorkstreamClient(fixture);
  await assert.rejects(client.append({
    workstreamId: "ws-workstream-store",
    expectedRevision: 4,
    idempotencyKey: "missing-next-session-prompt",
    records: [{ type: "checkpoint.replaced", producer: "owner", payload: { sessionId: "session-store-contract", checkpoint: { id: "cp-invalid", whatChanged: "Changed", remains: "Remains", next: "Next" } } }],
  }), /requires a next-session prompt/);
});

test("typed Workstream client preserves semantic service errors", async () => {
  const client = createWorkbenchWorkstreamClient({ request: async () => ({ ok: false, error: { code: "STALE_REVISION", message: "stale" } }) });
  await assert.rejects(client.close({}), (error) => error instanceof WorkstreamClientError && error.code === "STALE_REVISION");
});

test("rejects malformed recorded Workstream projections", () => {
  assert.equal(parseRecordedWorkstreams({ version: 2, sequence: 1, snapshots: [] }), undefined);
  assert.equal(parseRecordedWorkstreams({ version: 1, sequence: 1, snapshots: [{ id: "incomplete" }] }), undefined);
});
