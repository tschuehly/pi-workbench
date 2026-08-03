import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicFakeWorkstreamClient, parseRecordedWorkstreams } from "../fake-workstream-client.js";
import { parseWorkbenchProjection } from "../pi-web-plugin.js";
import { createWorkbenchWorkstreamClient, reconcileWorkstreams, WorkstreamClientError } from "../workstream-client.js";

const fixtureUrl = new URL("../fixtures/recorded-projection.json", import.meta.url);

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
  assert.equal(reconciliation.mode, "snapshot");
  assert.equal(reconciliation.snapshots.length, 2);
  assert.deepEqual(caughtUp, { mode: "replay", events: [], nextSequence: 12 });
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
      records: [{ type: "link.upsert", producer: "owner", payload: { link: { id: "link-browser", kind: "reference", reference: "docs/plans/level-adoption.md" } } }],
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

test("typed Workstream client preserves semantic service errors", async () => {
  const client = createWorkbenchWorkstreamClient({ request: async () => ({ ok: false, error: { code: "STALE_REVISION", message: "stale" } }) });
  await assert.rejects(client.close({}), (error) => error instanceof WorkstreamClientError && error.code === "STALE_REVISION");
});

test("rejects malformed recorded Workstream projections", () => {
  assert.equal(parseRecordedWorkstreams({ version: 2, sequence: 1, snapshots: [] }), undefined);
  assert.equal(parseRecordedWorkstreams({ version: 1, sequence: 1, snapshots: [{ id: "incomplete" }] }), undefined);
});
