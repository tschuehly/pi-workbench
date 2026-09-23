import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkstreamHost, savedLaunchPrompt } from './workstream-host.mjs';

const s = (id, cwd) => ({ id, cwd, path: '/session.jsonl', created: 'now', modified: 'now', messageCount: 0, firstMessage: '' });
const ok = body => ({ ok: true, json: async () => body });
const one = { machineId: 'local', projectId: 'p1', workspaceId: 'w1' };
const two = { machineId: 'local', projectId: 'p2', workspaceId: 'w2' };
function fixture() {
  const values = new Map(), calls = [], opened = [];
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const catalog = { machineId: 'local', view: { loading: false, selectedProject: { id: 'p1' }, selectedWorkspace: { id: 'w1', path: '/one' }, workspaces: [{ id: 'w1', projectId: 'p1', path: '/one' }, { id: 'w2', projectId: 'p2', path: '/two' }] } };
  let respond = () => ok(s('new', '/one'));
  const fetch = async (url, options) => { calls.push({ url, options }); return respond(url, options); };
  const host = createWorkstreamHost({ catalog, fetch, storage, open: value => opened.push(value) });
  return { host, calls, values, storage, catalog, opened, setRespond: fn => { respond = fn; } };
}
test('saves exact reviewable draft before single POST; returns server identity without prompt send', async () => {
  const f = fixture();
  assert.deepEqual(f.host.currentLocation(), one);
  f.setRespond((url, options) => {
    assert.equal(f.storage.getItem('workbench:workstream:launch-prompt:launch-1') !== null, true);
    assert.deepEqual(JSON.parse(options.body), { cwd: '/one', startupToken: 'launch-1' });
    return ok(s('server-id', '/one'));
  });
  assert.deepEqual(await f.host.start({ startupToken: 'launch-1', initialPrompt: '  exact\n draft  ', location: one }), { id: 'server-id', location: one });
  assert.deepEqual(savedLaunchPrompt(f.storage, 'launch-1'), { associationKey: 'launch-1', prompt: '  exact\n draft  ', location: { ...one, cwd: '/one' } });
  assert.equal(f.calls.length, 1);
  await f.host.open(one); assert.deepEqual(f.opened, [one]);
});
test('storage denial and local scope validation reject before any POST', async () => {
  const f = fixture();
  for (const location of [{ ...one, cwd: '/wrong' }, { ...one, machineId: 'remote' }, two]) {
    await assert.rejects(f.host.start({ startupToken: 't', initialPrompt: 'draft', location }), e => e.code === 'SESSION_START_REJECTED' && e.nonCreationProven === true);
  }
  const denied = createWorkstreamHost({ catalog: f.catalog, fetch: () => { throw new Error('must not fetch'); }, storage: { getItem: () => null, setItem: () => { throw new Error('denied'); } }, open: () => {} });
  await assert.rejects(denied.start({ startupToken: 't', initialPrompt: 'draft', location: one }), e => e.code === 'SESSION_START_REJECTED' && e.nonCreationProven === true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.host.currentLocation()?.workspaceId, 'w1');
  f.catalog.machineId = 'remote'; assert.equal(f.host.currentLocation(), null);
});
test('lost response after creation stays unknown and saved draft blocks repeat POST', async () => {
  const f = fixture();
  f.setRespond(() => { throw new Error('response lost'); });
  await assert.rejects(f.host.start({ startupToken: 't', initialPrompt: 'draft', location: one }), e => e.message === 'response lost' && !e.nonCreationProven);
  await assert.rejects(f.host.start({ startupToken: 't', initialPrompt: 'draft', location: one }), e => e.code === 'SESSION_START_REJECTED');
  assert.equal(f.calls.length, 1);
  assert.equal(savedLaunchPrompt(f.storage, 't').prompt, 'draft');
  f.setRespond(() => ok(s('wrong', '/two')));
  await assert.rejects(f.host.start({ startupToken: 'another', initialPrompt: 'draft', location: one }), e => !e.nonCreationProven && /Invalid session/.test(e.message));
});
test('lookup accepts only exact registered cwd and validated found identity', async () => {
  const f = fixture();
  f.setRespond(() => ok({ status: 'found', sessionId: 'server-id', cwd: '/one' }));
  assert.deepEqual(await f.host.findByStartupToken('a/b', one), { id: 'server-id', location: one });
  assert.match(f.calls[0].url, /a%2Fb\?cwd=%2Fone$/);
  f.setRespond(() => ok({ status: 'found', sessionId: 'server-id', cwd: '/two' }));
  await assert.rejects(f.host.findByStartupToken('t', one), /Invalid launch lookup/);
  await assert.rejects(f.host.findByStartupToken('t', { ...one, cwd: '/two' }), /cwd does not match/);
  f.setRespond(() => ok({ status: 'unknown' }));
  assert.equal(await f.host.findByStartupToken('t', one), undefined);
});
test('complete scans produce stable evidence, ambiguous, missing, and unavailable', async () => {
  const f = fixture();
  f.setRespond(url => ok(url.includes('%2Fone') ? [s('target', '/one'), s('other', '/one')] : [s('target', '/two')]));
  const a = await f.host.resolveSessionLocation({ machineId: 'local', sessionId: 'target' });
  const b = await f.host.resolveSessionLocation({ machineId: 'local', sessionId: 'target' });
  assert.equal(a.type, 'ambiguous'); assert.equal(a.locations.length, 2);
  assert.match(a.locations[0].evidence.evidenceId, /^[0-9a-f]{64}$/);
  assert.equal(a.locations[0].evidence.evidenceId, b.locations[0].evidence.evidenceId);
  assert.equal(a.locations[0].evidence.scannedScopeCount, 2);
  assert.equal(a.locations[1].evidence.matchedCwd, '/two');
  f.setRespond(url => ok(url.includes('%2Fone') ? [s('target', '/one')] : []));
  assert.equal((await f.host.resolveSessionLocation({ machineId: 'local', sessionId: 'target' })).type, 'found');
  assert.deepEqual(await f.host.resolveSessionLocation({ machineId: 'local', sessionId: 'absent' }), { type: 'missing' });
  f.setRespond(url => url.includes('%2Ftwo') ? Promise.reject(new Error('offline')) : ok([s('target', '/one')]));
  assert.deepEqual(await f.host.resolveSessionLocation({ machineId: 'local', sessionId: 'target' }), { type: 'unavailable', failedScopes: [{ ...two, cwd: '/two' }] });
  const before = f.calls.length;
  await assert.rejects(f.host.resolveSessionLocation({ machineId: 'remote', sessionId: 'target' }), /Only registered local/);
  assert.equal(f.calls.length, before);
});
