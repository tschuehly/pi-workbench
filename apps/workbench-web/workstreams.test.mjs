import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkstreams, createTaskDrafts } from './workstreams.mjs';
import { createWorkbenchWorkstreamClient } from '../../packages/pi-web-integration/workstream-client.js';

const fixture = JSON.parse(await readFile(new URL('../../packages/pi-web-integration/fixtures/recorded-workstreams.json', import.meta.url)));
const snapshot = fixture.snapshots[0];
const scope = { machineId: 'local', projectId: 'registered-project', workspaceId: 'registered-workspace' };
const ok = value => ({ ok: true, headers: new Headers(), text: async () => JSON.stringify(value) });
test('free-text drafts survive reload and follow a Workstream across registered workspaces', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const first = createTaskDrafts(storage);
  first.set(scope, 'ws-one', 'task-a', 'Unsubmitted <img onerror=evil()>');
  assert.equal(createTaskDrafts(storage).get(scope, 'ws-one', 'task-a'), 'Unsubmitted <img onerror=evil()>');
  assert.equal(first.get({ ...scope, workspaceId: 'other' }, 'ws-one', 'task-a'), 'Unsubmitted <img onerror=evil()>');
  assert.equal(first.get({ ...scope, machineId: 'remote' }, 'ws-one', 'task-a'), '');
  assert.equal(first.get(scope, 'ws-other', 'task-a'), '');
  assert.equal(first.get(scope, 'ws-one', 'task-b'), '');
  first.set(scope, 'ws-one', 'task-a', '');
  assert.equal(createTaskDrafts(storage).get(scope, 'ws-one', 'task-a'), '');
  assert.equal(first.volatile, false);
});
test('storage failure keeps a volatile draft visible in the current tab', () => {
  const drafts = createTaskDrafts({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } });
  drafts.set(scope, 'ws-one', 'task-a', 'Do not lose this');
  assert.equal(drafts.get(scope, 'ws-one', 'task-a'), 'Do not lose this');
  assert.equal(drafts.volatile, true);
  drafts.set(scope, 'ws-one', 'task-a', '');
  assert.equal(drafts.volatile, false);
});
function harness(overrides = {}) {
  const calls = [];
  const fetch = async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/plugins') return ok({ plugins: [{ id: 'pi-workbench', server: { state: 'active', activeRevision: 'fixture-revision' } }] });
    const { revision, input } = JSON.parse(options.body);
    assert.equal(revision, 'fixture-revision');
    if (path.endsWith('/list')) return ok({ ok: true, value: [{ id: snapshot.id, title: snapshot.title, revision: snapshot.revision, updatedAt: snapshot.updatedAt, activeSessionCount: 1, pendingSessionCount: 0, failedSessionCount: 0, unresolvedHumanTaskCount: 1, closed: false }] });
    if (path.endsWith('/inspect')) return ok({ ok: true, value: overrides.inspect ?? snapshot });
    if (path.endsWith('/watch')) return ok({ ok: true, value: overrides.watch ?? { mode: 'replay', events: [], nextSequence: 10 } });
    assert.fail(`Unexpected operation: ${path} ${JSON.stringify(input)}`);
  };
  return { calls, client: createWorkstreams({ fetch, validateClient: createWorkbenchWorkstreamClient, storage: overrides.storage }) };
}
test('loads a validated scoped Workstream and never uses another project/workspace', async () => {
  const { client, calls } = harness();
  await client.load(scope);
  assert.equal(client.view.snapshot?.id, snapshot.id);
  assert.equal(client.view.snapshot?.sessions[0]?.latestCheckpoint?.id, snapshot.sessions[0]?.latestCheckpoint?.id);
  assert.equal(client.view.error, null);
  assert.equal(calls.length, 3);
  for (const call of calls.slice(1)) assert.match(call.path, /^\/api\/paired-plugin-backends\/pi-workbench\/projects\/registered-project\/workspaces\/registered-workspace\/(list|inspect)$/);
});
test('watching a newer authoritative revision locks a stale Human Task answer until refresh', async () => {
  const { client, calls } = harness({ watch: { mode: 'replay', events: [{ sequence: 11, workstreamId: snapshot.id, revision: snapshot.revision + 1, recordedAt: snapshot.updatedAt, records: [] }], nextSequence: 11 } });
  await client.load(scope);
  await client.checkUpdates();
  assert.equal(client.view.needsRefresh, true);
  assert.match(client.view.error, /refresh and review/);
  assert.equal(JSON.parse(calls.at(-1).options.body).input.afterSequence, 0);
  await assert.rejects(client.answer('task-review-interface', { kind: 'yes-no', optionId: 'yes' }), /Refresh or reconcile/);
  await client.load(scope);
  assert.equal(client.view.needsRefresh, false);
});
test('clearing a workspace invalidates an outstanding inspect result', async () => {
  let release;
  const inspected = new Promise(resolve => { release = resolve; });
  let started;
  const inspectStarted = new Promise(resolve => { started = resolve; });
  const fetch = async path => {
    if (path === '/api/plugins') return ok({ plugins: [{ id: 'pi-workbench', server: { state: 'active', activeRevision: 'fixture-revision' } }] });
    if (path.endsWith('/list')) return ok({ ok: true, value: [{ id: snapshot.id, title: snapshot.title, revision: snapshot.revision, updatedAt: snapshot.updatedAt, activeSessionCount: 1, pendingSessionCount: 0, failedSessionCount: 0, unresolvedHumanTaskCount: 1, closed: false }] });
    started(); return inspected;
  };
  const pending = createWorkstreams({ fetch, validateClient: createWorkbenchWorkstreamClient });
  const loading = pending.load(scope);
  await inspectStarted;
  pending.clear();
  release(ok({ ok: true, value: snapshot }));
  await loading;
  assert.equal(pending.view.snapshot, null);
  assert.equal(pending.view.scope, null);
});
test('requires an active revision-paired service and rejects invalid snapshots', async () => {
  const inactive = createWorkstreams({ fetch: async () => ok({ plugins: [{ id: 'pi-workbench', server: { state: 'failed' } }] }), validateClient: createWorkbenchWorkstreamClient });
  await inactive.load(scope);
  assert.match(inactive.view.error, /not active/);
  const invalid = harness({ inspect: { ...snapshot, sessions: [{ id: 'untrusted', status: 'active' }] } });
  await invalid.client.load(scope);
  assert.equal(invalid.client.view.snapshot, null);
  assert.match(invalid.client.view.error, /INVALID_RESPONSE|invalid inspect value/);
});
test('answers with the viewed revision, persists the exact retry, and reconciles an unknown committed answer', async () => {
  const saved = new Map(), appended = [];
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  let current = structuredClone(snapshot), disconnect = true;
  const fetch = async (path, options) => {
    if (path === '/api/plugins') return ok({ plugins: [{ id: 'pi-workbench', server: { state: 'active', activeRevision: 'fixture-revision' } }] });
    const { input } = JSON.parse(options.body);
    if (path.endsWith('/list')) return ok({ ok: true, value: [{ id: snapshot.id, title: snapshot.title, revision: snapshot.revision, updatedAt: snapshot.updatedAt, activeSessionCount: 1, pendingSessionCount: 0, failedSessionCount: 0, unresolvedHumanTaskCount: 1, closed: false }] });
    if (path.endsWith('/inspect')) return ok({ ok: true, value: current });
    if (path.endsWith('/append')) {
      appended.push(input);
      assert.equal(input.expectedRevision, snapshot.revision);
      const { taskId, answerId, answer } = input.records[0].payload;
      current = { ...current, revision: snapshot.revision + 1, humanTasks: current.humanTasks.map(task => task.id === taskId ? { ...task, status: 'answered', answer, answerReceipt: { answerId, taskId, acceptedRevision: snapshot.revision + 1, recordedAt: current.updatedAt, producer: 'workbench-web', sourceSessionId: null } } : task) };
      if (disconnect) throw new Error('socket disconnected after commit');
      return ok({ ok: true, value: { workstreamId: snapshot.id, acceptedRevision: current.revision, snapshotReference: { workstreamId: snapshot.id, revision: current.revision }, sequence: 3, idempotencyKey: input.idempotencyKey, recordedAt: current.updatedAt } });
    }
    assert.fail(`Unexpected ${path}`);
  };
  const make = () => createWorkstreams({ fetch, storage, validateClient: createWorkbenchWorkstreamClient });
  const first = make(); await first.load(scope);
  await assert.rejects(first.answer('task-density-choice', { kind: 'choice', optionId: 'compact' }), /not open/);
  await first.answer('task-review-interface', { kind: 'yes-no', optionId: 'yes' });
  assert.match(first.view.error, /outcome unknown/);
  assert.equal(first.view.pendingAnswer, true);
  assert.equal(appended.length, 1);
  await assert.rejects(first.answer('task-review-interface', { kind: 'yes-no', optionId: 'no' }), /reconcile/);
  const reloaded = make(); await reloaded.load(scope);
  assert.equal(reloaded.view.snapshot.humanTasks[0].status, 'answered');
  assert.equal(reloaded.view.pendingAnswer, false);
  assert.equal(saved.size, 0);
  assert.equal(appended.length, 1);
  disconnect = false;
});
test('a competing answer preserves the unknown saved payload until explicit dismissal', async () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key), key: index => [...saved.keys()][index] ?? null, get length() { return saved.size; } };
  const request = { workstreamId: snapshot.id, expectedRevision: snapshot.revision - 1, idempotencyKey: 'workbench-answer-saved', records: [{ type: 'human-task.answered', producer: 'workbench-web', payload: { taskId: 'task-review-interface', answerId: 'saved', answer: { kind: 'yes-no', optionId: 'no' } } }] };
  storage.setItem(`workbench:workstream:answer:${JSON.stringify([scope.machineId, scope.projectId, scope.workspaceId, snapshot.id])}`, JSON.stringify(request));
  const task = { ...snapshot.humanTasks[0], status: 'answered', answer: { kind: 'yes-no', optionId: 'yes' }, answerReceipt: { answerId: 'other', taskId: 'task-review-interface', acceptedRevision: snapshot.revision, recordedAt: snapshot.updatedAt, producer: 'owner', sourceSessionId: null } };
  const { client } = harness({ storage, inspect: { ...snapshot, humanTasks: [task, ...snapshot.humanTasks.slice(1)] } });
  await client.load({ ...scope, workspaceId: 'another-registered-workspace' });
  assert.equal(client.view.snapshot?.id, snapshot.id);
  assert.equal(client.view.answerConflict?.records[0].payload.answer.optionId, 'no');
  assert.equal(client.view.pendingAnswer, false);
  assert.equal(saved.size, 1);
  await assert.rejects(client.retryAnswer(), /No pending answer/);
  await assert.rejects(client.answer('task-density-choice', { kind: 'choice', optionId: 'compact' }), /reconcile/);
  client.dismissAnswerConflict();
  assert.equal(saved.size, 0);
  assert.equal(client.view.answerConflict, null);
});
test('unknown answer in a Workstream follows the exact request across workspace switches', async () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key), key: index => [...saved.keys()][index] ?? null, get length() { return saved.size; } };
  const request = { workstreamId: snapshot.id, expectedRevision: snapshot.revision, idempotencyKey: 'workbench-answer-across-workspaces', records: [{ type: 'human-task.answered', producer: 'workbench-web', payload: { taskId: 'task-review-interface', answerId: 'across-workspaces', answer: { kind: 'yes-no', optionId: 'yes' } } }] };
  storage.setItem(`workbench:workstream:answer:${JSON.stringify([scope.machineId, snapshot.id])}`, JSON.stringify(request));
  const { client } = harness({ storage });
  await client.load({ ...scope, workspaceId: 'another-registered-workspace' });
  assert.equal(client.view.pendingAnswer, true);
  assert.equal(client.view.answerConflict, null);
  await assert.rejects(client.answer('task-review-interface', { kind: 'yes-no', optionId: 'no' }), /reconcile/);
  assert.equal(saved.size, 1);
});
test('an unknown uncommitted answer retries the exact request; stale revisions require a new review', async () => {
  const saved = new Map(), appended = [];
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  let revision = snapshot.revision, mode = 'disconnect', taskChanged = false;
  const fetch = async (path, options) => {
    if (path === '/api/plugins') return ok({ plugins: [{ id: 'pi-workbench', server: { state: 'active', activeRevision: 'fixture-revision' } }] });
    const { input } = JSON.parse(options.body);
    if (path.endsWith('/list')) return ok({ ok: true, value: [{ id: snapshot.id, title: snapshot.title, revision: snapshot.revision, updatedAt: snapshot.updatedAt, activeSessionCount: 1, pendingSessionCount: 0, failedSessionCount: 0, unresolvedHumanTaskCount: 1, closed: false }] });
    if (path.endsWith('/inspect')) return ok({ ok: true, value: { ...snapshot, revision, humanTasks: taskChanged ? snapshot.humanTasks.map(task => task.id === 'task-review-interface' ? { ...task, answerKind: 'choice', options: [{ id: 'later', label: 'Later' }] } : task) : snapshot.humanTasks } });
    appended.push(input);
    if (mode === 'disconnect') throw new Error('disconnected before commit');
    return ok({ ok: false, error: { code: 'STALE_REVISION', message: 'revision changed', details: { currentRevision: ++revision } } });
  };
  const first = createWorkstreams({ fetch, storage, validateClient: createWorkbenchWorkstreamClient });
  await first.load(scope);
  await first.answer('task-review-interface', { kind: 'yes-no', optionId: 'yes' });
  taskChanged = true;
  const reloaded = createWorkstreams({ fetch, storage, validateClient: createWorkbenchWorkstreamClient });
  await reloaded.load(scope);
  assert.equal(reloaded.view.pendingAnswer, true);
  mode = 'stale'; await reloaded.retryAnswer();
  assert.deepEqual(appended[0], appended[1]);
  assert.equal(reloaded.view.pendingAnswer, false);
  assert.match(reloaded.view.error, /refresh and review/);
  assert.equal(reloaded.view.needsRefresh, true);
  await assert.rejects(reloaded.answer('task-review-interface', { kind: 'yes-no', optionId: 'no' }), /Refresh or reconcile/);
  assert.equal(saved.size, 0);
});
test('does not invent remote scope or accept mismatched inspected identity', async () => {
  const { client, calls } = harness();
  await client.load({ ...scope, machineId: 'remote' });
  assert.match(client.view.error, /registered local workspace/);
  assert.equal(calls.length, 0);
  const invalid = harness({ inspect: { ...snapshot, id: 'other-workstream' } });
  await invalid.client.load(scope);
  assert.equal(invalid.client.view.snapshot, null);
  assert.match(invalid.client.view.error, /identity mismatch/);
});
test('Workstream creation reuses one saved request after an unknown response, including after reload', async () => {
  const saved = new Map(), attempts = [];
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  let committed = false;
  const fetch = async (path, options) => {
    if (path === '/api/plugins') return ok({ plugins: [{ id: 'pi-workbench', server: { state: 'active', activeRevision: 'fixture-revision' } }] });
    const { input } = JSON.parse(options.body);
    if (path.endsWith('/list')) return ok({ ok: true, value: committed ? [{ id: attempts[0].workstreamId, title: attempts[0].title, revision: 1, updatedAt: snapshot.updatedAt, activeSessionCount: 0, pendingSessionCount: 0, failedSessionCount: 0, unresolvedHumanTaskCount: 0, closed: false }] : [] });
    if (path.endsWith('/inspect')) return committed ? ok({ ok: true, value: { ...snapshot, id: input.workstreamId, title: attempts[0].title, revision: 1, sessions: [], humanTasks: [] } }) : ok({ ok: false, error: { code: 'WORKSTREAM_NOT_FOUND', message: 'Not found' } });
    if (path.endsWith('/create')) {
      attempts.push(input);
      if (!committed) throw new Error('Lost before commit');
      return ok({ ok: true, value: { workstreamId: input.workstreamId, acceptedRevision: 1, snapshotReference: { workstreamId: input.workstreamId, revision: 1 }, sequence: 1, idempotencyKey: input.idempotencyKey, recordedAt: snapshot.updatedAt } });
    }
    assert.fail(`Unexpected ${path}`);
  };
  const make = () => createWorkstreams({ fetch, storage, validateClient: createWorkbenchWorkstreamClient });
  const first = make(); await first.load(scope);
  await first.create('Daily work');
  assert.equal(first.view.pendingCreate, true);
  await assert.rejects(first.create('Duplicate'), /pending creation/);
  assert.equal(saved.size, 1);
  const reloaded = make(); await reloaded.load(scope);
  assert.equal(reloaded.view.pendingCreate, true);
  committed = true;
  await reloaded.retryCreate();
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(saved.size, 0);
  assert.equal(reloaded.view.snapshot?.id, attempts[0].workstreamId);
  assert.equal(reloaded.view.pendingCreate, false);
});
test('a lost create response is reconciled by exact Workstream identity without another create', async () => {
  const saved = new Map(), attempts = [];
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const fetch = async (path, options) => {
    if (path === '/api/plugins') return ok({ plugins: [{ id: 'pi-workbench', server: { state: 'active', activeRevision: 'fixture-revision' } }] });
    const { input } = JSON.parse(options.body);
    if (path.endsWith('/list')) return ok({ ok: true, value: attempts.length ? [{ id: attempts[0].workstreamId, title: attempts[0].title, revision: 1, updatedAt: snapshot.updatedAt, activeSessionCount: 0, pendingSessionCount: 0, failedSessionCount: 0, unresolvedHumanTaskCount: 0, closed: false }] : [] });
    if (path.endsWith('/inspect')) return ok({ ok: true, value: { ...snapshot, id: input.workstreamId, title: attempts[0].title, revision: 1, sessions: [], humanTasks: [] } });
    if (path.endsWith('/create')) { attempts.push(input); throw new Error('Lost after commit'); }
    assert.fail(`Unexpected ${path}`);
  };
  const make = () => createWorkstreams({ fetch, storage, validateClient: createWorkbenchWorkstreamClient });
  const first = make(); await first.load(scope); await first.create('Recovered work');
  assert.equal(first.view.pendingCreate, true);
  const reloaded = make(); await reloaded.load(scope);
  assert.equal(reloaded.view.pendingCreate, false);
  assert.equal(reloaded.view.snapshot?.id, attempts[0].workstreamId);
  assert.equal(attempts.length, 1);
  assert.equal(saved.size, 0);
});
