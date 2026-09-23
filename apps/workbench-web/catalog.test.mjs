import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog, project, resolution, session } from './catalog.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const p = id => ({ id: `p${id}`, name: `Project ${id}`, path: `/repo${id}`, createdAt: 'now' });
const w = id => ({ id: `w${id}`, projectId: `p${id}`, path: `/repo${id}`, label: 'main', isMain: true, effectiveConfig: {} });
const s = (id, cwd) => ({ id, cwd, path: '/agent/session.jsonl', name: 'Chat', created: 'now', modified: 'now', messageCount: 1, firstMessage: 'hello' });
const ok = body => ({ ok: true, json: async () => body });
function fixture() {
  const requests = [], values = new Map(), views = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }));
  const catalog = createCatalog({ fetch, storage, changed: v => views.push(v), token: () => 'unique-token' });
  const reply = (part, body) => { const i = requests.findIndex(r => r.url.includes(part)); assert.notEqual(i, -1, part); requests.splice(i, 1)[0].resolve(ok(body)); };
  async function load(initial = {}) {
    const loading = catalog.load('local', initial);
    reply('/projects', [p(1), p(2)]); await tick();
    reply('/projects/p1/workspaces', { status: 'folder', projectId: 'p1', workspaces: [w(1)], diagnostics: [] });
    reply('/projects/p2/workspaces', { status: 'folder', projectId: 'p2', workspaces: [w(2)], diagnostics: [] });
    await tick();
    reply('/sessions?cwd=', [s('s1', '/repo1')]);
    return loading;
  }
  return { catalog, requests, storage, views, values, reply, load };
}
test('validated project/workspace/session boundaries reject mismatches', () => {
  assert.throws(() => project({ id: 'p' }), /Invalid project/);
  assert.throws(() => resolution({ status: 'folder', projectId: 'p', workspaces: [w(2)], diagnostics: [] }, 'p'), /Invalid workspace/);
  assert.throws(() => session(s('one', '/wrong'), '/repo1'), /Invalid session/);
});
test('catalog resolves full identity; missing/ad-hoc identity is not fabricated', async () => {
  const f = fixture(); const loading = f.load({ cwd: '/repo1', sessionId: 's1' });
  assert.deepEqual(await loading, { machineId: 'local', projectId: 'p1', workspaceId: 'w1', cwd: '/repo1', sessionId: 's1' });
  const other = f.catalog.choose('p2', 'w2');
  f.reply('/sessions?cwd=', [s('s2', '/repo2')]); await other;
  assert.deepEqual(f.catalog.select('s2'), { machineId: 'local', projectId: 'p2', workspaceId: 'w2', cwd: '/repo2', sessionId: 's2' });
  assert.throws(() => f.catalog.select('s1'), /not in the selected catalog/);
  const g = fixture(); const missing = g.load({ cwd: '/ad-hoc', sessionId: 's1' });
  assert.equal(await missing, null);
  assert.match(g.catalog.view.error, /not in the registered workspace catalog/);
});
test('create is single-flight; a lost response locks retries through reload', async () => {
  const f = fixture(); await f.load();
  const creating = f.catalog.create();
  assert.equal(f.requests.filter(r => r.url.endsWith('/sessions')).length, 1);
  assert.equal(await f.catalog.create(), null);
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { cwd: '/repo1', startupToken: 'unique-token' });
  const request = f.requests.shift(); request.resolve({ ok: false, status: 503, text: async () => 'lost response' });
  assert.equal(await creating, null);
  assert.equal(f.catalog.view.creationUnknown, true);
  assert.equal(await f.catalog.create(), null);
  // Selecting the same workspace from the catalog reloads the persisted lock.
  const reload = f.catalog.load('local');
  f.reply('/projects', [p(1), p(2)]); await tick();
  f.reply('/projects/p1/workspaces', { status: 'folder', projectId: 'p1', workspaces: [w(1)], diagnostics: [] });
  f.reply('/projects/p2/workspaces', { status: 'folder', projectId: 'p2', workspaces: [w(2)], diagnostics: [] }); await tick();
  f.reply('/sessions?cwd=', [s('s1', '/repo1')]); await reload;
  assert.equal(f.catalog.view.creationUnknown, true);
  assert.equal(await f.catalog.create(), null);
});
test('reload reattaches a server-confirmed transient session and rejects a missing one', async () => {
  const f = fixture();
  const loading = f.load({ cwd: '/repo1', sessionId: 'transient' });
  await tick(); await tick();
  f.reply('/sessions/transient/status?', { sessionId: 'transient' });
  assert.deepEqual(await loading, { machineId: 'local', projectId: 'p1', workspaceId: 'w1', cwd: '/repo1', sessionId: 'transient' });
  assert.equal(f.catalog.view.selectedSession.transient, true);
  const g = fixture();
  const missing = g.load({ cwd: '/repo1', sessionId: 'gone' });
  await tick(); await tick();
  const request = g.requests.shift(); assert.match(request.url, /sessions\/gone\/status/);
  request.resolve({ ok: false, status: 404, text: async () => 'not found' });
  assert.equal(await missing, null);
  assert.match(g.catalog.view.error, /not available in this workspace/);
});
test('successful creation uses server identity; wrong cwd is an unknown outcome', async () => {
  const f = fixture(); await f.load();
  const created = f.catalog.create(); f.reply('/sessions', s('new', '/repo1'));
  assert.deepEqual(await created, { machineId: 'local', projectId: 'p1', workspaceId: 'w1', cwd: '/repo1', sessionId: 'new' });
  assert.equal(f.values.size, 0);
  const wrong = f.catalog.create(); f.reply('/sessions', s('bad', '/repo2'));
  assert.equal(await wrong, null); assert.equal(f.catalog.view.creationUnknown, true);
  assert.equal(f.values.size, 1);
});
