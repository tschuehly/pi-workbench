import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkstreams } from './workstreams.mjs';
import { createWorkbenchWorkstreamClient } from '../../packages/pi-web-integration/workstream-client.js';

const fixture = JSON.parse(await readFile(new URL('../../packages/pi-web-integration/fixtures/recorded-workstreams.json', import.meta.url)));
const snapshot = fixture.snapshots[0];
const scope = { machineId: 'local', projectId: 'registered-project', workspaceId: 'registered-workspace' };
const ok = value => ({ ok: true, headers: new Headers(), text: async () => JSON.stringify(value) });
function harness(overrides = {}) {
  const calls = [];
  const fetch = async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/plugins') return ok({ plugins: [{ id: 'pi-workbench', server: { state: 'active', activeRevision: 'fixture-revision' } }] });
    const { revision, input } = JSON.parse(options.body);
    assert.equal(revision, 'fixture-revision');
    if (path.endsWith('/list')) return ok({ ok: true, value: [{ id: snapshot.id, title: snapshot.title, revision: snapshot.revision, updatedAt: snapshot.updatedAt, activeSessionCount: 1, pendingSessionCount: 0, failedSessionCount: 0, unresolvedHumanTaskCount: 1, closed: false }] });
    if (path.endsWith('/inspect')) return ok({ ok: true, value: overrides.inspect ?? snapshot });
    assert.fail(`Unexpected operation: ${path} ${JSON.stringify(input)}`);
  };
  return { calls, client: createWorkstreams({ fetch, validateClient: createWorkbenchWorkstreamClient }) };
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
