import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryWorkstreamAdapter, WorkstreamStore } from '../../packages/workstream-store/src/index.js';
import { createWorkstreamLaunch } from './workstream-launch.mjs';
import { createWorkstreamHost } from './workstream-host.mjs';

const location = { machineId: 'local', projectId: 'p', workspaceId: 'w' };
async function fixture() {
  const store = new WorkstreamStore({ adapter: new InMemoryWorkstreamAdapter() });
  await store.create({ workstreamId: 'ws-1', idempotencyKey: 'create', title: 'Test', producer: 'owner' });
  const values = new Map(), calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
  const catalog = { machineId: 'local', view: { loading: false, selectedProject: { id: 'p' }, selectedWorkspace: { id: 'w', path: '/repo' }, workspaces: [{ id: 'w', projectId: 'p', path: '/repo' }] } };
  let respond = () => ({ ok: true, json: async () => ({ id: 'new', cwd: '/repo', path: '', created: 'now', modified: 'now', messageCount: 0, firstMessage: '' }) });
  const host = createWorkstreamHost({ catalog, storage, fetch: async (url, options) => { calls.push({ url, options }); return respond(url, options); }, open: () => {} });
  const service = { request: async (operation, input) => { try { return { ok: true, value: await store[operation](operation === 'inspect' ? input.workstreamId : input) }; } catch (error) { return { ok: false, error: { code: error.code ?? 'ERROR', message: error.message } }; } } };
  const make = () => createWorkstreamLaunch({ service, host, storage });
  return { store, storage, calls, catalog, host, make, setRespond: fn => { respond = fn; } };
}
test('blank preflight, exact persisted prompt and confirmed identity; retry does not POST', async () => {
  const f = await fixture(), launch = f.make();
  const request = { kind: 'blank', workstreamId: 'ws-1', operationId: 'blank-1', location };
  f.catalog.view.selectedWorkspace = { id: 'other', path: '/other' };
  assert.equal((await launch.launch(request)).cause, 'HOST_LOCATION_UNAVAILABLE');
  assert.equal(f.calls.length, 0);
  f.catalog.view.selectedWorkspace = { id: 'w', path: '/repo' };
  assert.equal((await launch.launch(request)).type, 'confirmed');
  assert.equal(f.calls.length, 1);
  const prompt = launch.savedPrompt('blank-1');
  assert.match(prompt.prompt, /Workstream “Test”/);
  assert.equal(prompt.location.cwd, '/repo');
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { cwd: '/repo', startupToken: 'workbench-web:blank-1' });
  assert.equal((await f.make().launch(request)).type, 'confirmed');
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.make().launch({ ...request, location: { ...location, workspaceId: 'other' } }), /different request/);
});
test('proven pre-POST rejection returns failed and resumes terminal outcome', async () => {
  const f = await fixture();
  const request = { kind: 'blank', workstreamId: 'ws-1', operationId: 'denied', location };
  const original = f.make();
  // Force a host preflight rejection after the coordinator has appended pending.
  const rejected = createWorkstreamLaunch({
    service: { request: async (operation, input) => { try { return { ok: true, value: await f.store[operation](operation === 'inspect' ? input.workstreamId : input) }; } catch (error) { return { ok: false, error: { code: error.code ?? 'ERROR', message: error.message } }; } } },
    host: { currentLocation: () => location, start: async () => { throw Object.assign(new Error('storage denied'), { nonCreationProven: true }); }, findByStartupToken: async () => undefined },
    storage: f.storage,
  });
  assert.equal((await rejected.launch(request)).type, 'failed');
  assert.equal((await original.resume('denied')).type, 'failed');
  assert.equal(f.calls.length, 0);
});
test('lost creation response reconciles via lookup without duplicate POST', async () => {
  const f = await fixture();
  f.setRespond((url) => url.includes('workstream-launch/')
    ? { ok: true, json: async () => ({ status: 'found', sessionId: 'created', cwd: '/repo' }) }
    : Promise.reject(new Error('lost response')));
  const request = { kind: 'blank', workstreamId: 'ws-1', operationId: 'lost', location };
  assert.equal((await f.make().launch(request)).type, 'pending');
  assert.equal((await f.make().resume('lost')).type, 'confirmed');
  assert.equal((await f.make().launch(request)).type, 'confirmed');
  assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1);
  assert.equal((await f.store.inspect('ws-1')).sessions.find(s => s.associationKey === 'workbench-web:lost').status, 'active');
});
test('a different operation cannot start while a saved launch has unknown outcome', async () => {
  const f = await fixture();
  f.setRespond(() => Promise.reject(new Error('lost response')));
  const first = { kind: 'blank', workstreamId: 'ws-1', operationId: 'first', location };
  assert.equal((await f.make().launch(first)).type, 'pending');
  const second = { ...first, operationId: 'second' };
  await assert.rejects(f.make().launch(second), /saved launch is unresolved/);
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 1);
  f.setRespond((url) => url.includes('workstream-launch/') ? { ok: true, json: async () => ({ status: 'found', sessionId: 'created', cwd: '/repo' }) } : { ok: true, json: async () => ({ id: 'second-session', cwd: '/repo', path: '', created: 'now', modified: 'now', messageCount: 0, firstMessage: '' }) });
  assert.equal((await f.make().resume('first')).type, 'confirmed');
  assert.equal(f.make().unresolved(await f.store.inspect('ws-1')), false);
  assert.equal((await f.make().launch(second)).type, 'confirmed');
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 2);
});

test('repairs an anchorless session only after an exact registered-scope recheck', async () => {
  const f = await fixture();
  await f.store.append({ workstreamId: 'ws-1', expectedRevision: 1, idempotencyKey: 'legacy', records: [
    { type: 'session.pending', producer: 'owner', payload: { associationKey: 'legacy', sessionId: 'old' } },
    { type: 'session.confirmed', producer: 'owner', payload: { associationKey: 'legacy', sessionId: 'old' } },
  ] });
  const saved = await f.store.inspect('ws-1');
  f.setRespond(() => ({ ok: true, json: async () => [{ id: 'old', cwd: '/repo', path: '/old.jsonl', created: 'now', modified: 'now', messageCount: 0, firstMessage: '' }] }));
  const found = await f.make().resolveAnchor('old');
  assert.equal(found.type, 'found');
  const repaired = await f.make().repairAnchor(saved, 'old', found);
  assert.equal(repaired.sessions.find(session => session.id === 'old').workspaceId, 'w');
  await assert.rejects(f.make().repairAnchor(saved, 'old', found), /changed/);
});

test('rejects changed complete-scan evidence without appending an anchor', async () => {
  const f = await fixture();
  await f.store.append({ workstreamId: 'ws-1', expectedRevision: 1, idempotencyKey: 'legacy', records: [
    { type: 'session.pending', producer: 'owner', payload: { associationKey: 'legacy', sessionId: 'old' } },
    { type: 'session.confirmed', producer: 'owner', payload: { associationKey: 'legacy', sessionId: 'old' } },
  ] });
  const saved = await f.store.inspect('ws-1');
  const one = { id: 'old', cwd: '/repo', path: '/old.jsonl', created: 'now', modified: 'now', messageCount: 0, firstMessage: '' };
  f.setRespond(() => ({ ok: true, json: async () => [one] }));
  const found = await f.make().resolveAnchor('old');
  f.setRespond(() => ({ ok: true, json: async () => [one, { ...one, id: 'another' }] }));
  await assert.rejects(f.make().repairAnchor(saved, 'old', found), /evidence changed/);
  assert.equal((await f.store.inspect('ws-1')).revision, saved.revision);
});

test('checkpoint launch prompt starts from orient and the checkpoint, is never sent, and saved request survives reload', async () => {
  const f = await fixture();
  await f.store.append({ workstreamId: 'ws-1', expectedRevision: 1, idempotencyKey: 'source', records: [
    { type: 'session.pending', producer: 'owner', payload: { associationKey: 'source', sessionId: 'old', ...location } },
    { type: 'session.confirmed', producer: 'owner', sourceSessionId: 'old', payload: { associationKey: 'source', sessionId: 'old', ...location } },
  ] });
  await f.store.append({ workstreamId: 'ws-1', expectedRevision: 2, idempotencyKey: 'checkpoint', records: [{ type: 'checkpoint.replaced', producer: 'owner', payload: { sessionId: 'old', checkpoint: { id: 'cp', whatChanged: 'done', remains: 'more', next: 'go', waitingOn: 'agent' } } }] });
  const selection = (await f.make().inspectContinuation('ws-1')).candidates[0].selection;
  const request = { kind: 'checkpoint', workstreamId: 'ws-1', operationId: 'next', selection };
  assert.equal((await f.make().launch(request)).type, 'confirmed');
  assert.match(f.make().savedPrompt('next').prompt, /`orient` skill[\s\S]*--- BEGIN OWNER-CONFIRMED CHECKPOINT ---\n\nWhat changed: done\nWhat remains: more\nNext: go\nWaiting on: agent\n\n--- END/);
  assert.deepEqual(f.make().saved('next'), request);
  assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1);
  assert.equal((await f.make().resume('next')).type, 'confirmed');
});
