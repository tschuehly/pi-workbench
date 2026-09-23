import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFiles } from './files.mjs';
const version = content => createHash('sha256').update(content).digest('hex');
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const file = (content, path = 'README.md') => ({ path, encoding: 'utf8', size: Buffer.byteLength(content), content, binary: false, truncated: false, version: version(content) });
const workspace = { machineId: 'local', projectId: 'p', id: 'w' };
function setup() {
  let current = '# Initial\n', external = false, failNetwork = false, confirm = false;
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push([url, options]);
    const path = new URL(url, 'http://localhost').searchParams.get('path');
    if (url.includes('/tree?')) return reply({ path, truncated: false, entries: path ? [{ name: 'notes.txt', path: 'docs/notes.txt', type: 'file' }] : [{ name: 'README.md', path: 'README.md', type: 'file' }, { name: 'docs', path: 'docs', type: 'directory' }, { name: 'link', path: 'link', type: 'symlink' }] });
    if (!options.method) return reply(file(current, path));
    if (external) return reply({ error: 'File changed or was deleted since it was loaded' }, 409);
    current = new TextDecoder().decode(options.body);
    if (failNetwork) throw new Error('connection lost after commit');
    return reply({ path, size: Buffer.byteLength(current), modifiedAt: '2026-09-23', created: false });
  };
  const files = createFiles({ fetch, confirm: () => confirm, changed: () => {} });
  files.select(workspace);
  return { files, calls, get current() { return current; }, set external(value) { external = value; }, set failNetwork(value) { failNetwork = value; }, set confirm(value) { confirm = value; } };
}
test('workspace tree and literal file read, version-checked write, verified reread', async () => {
  const fixture = setup(); const { files, calls } = fixture;
  await files.list(); await files.toggle('docs'); await files.open('README.md');
  assert.equal(files.state.loaded.editable, true);
  files.edit('# Changed\n'); assert.equal(files.canLeave(), false);
  await files.save();
  assert.equal(fixture.current, '# Changed\n');
  assert.equal(files.state.buffer, files.state.loaded.content);
  const write = calls.find(([, opts]) => opts.method === 'PUT');
  const url = new URL(write[0], 'http://localhost');
  assert.equal(url.searchParams.get('expectedVersion'), version('# Initial\n'));
  assert.equal(url.searchParams.get('createDirs'), 'false');
  assert.equal(url.pathname, '/api/machines/local/projects/p/workspaces/w/file');
  assert.equal(files.canLeave(), true);
});
test('conflict preserves draft; dirty switch and unload require confirmation', async () => {
  const fixture = setup(); const { files } = fixture;
  await files.open('README.md'); files.edit('# Mine'); fixture.external = true;
  await files.save();
  assert.equal(files.state.conflict, true); assert.equal(files.state.unknown, false);
  assert.equal(files.state.buffer, '# Mine');
  await files.open('docs/notes.txt'); assert.equal(files.state.loaded.path, 'README.md');
  const unload = { preventDefault() { this.prevented = true; } }; files.unload(unload);
  assert.equal(unload.prevented, true);
  fixture.confirm = true; await files.open('docs/notes.txt');
  assert.equal(files.state.loaded.path, 'docs/notes.txt');
});
test('uncertain save locks retry and reconciles exact current file', async () => {
  const fixture = setup(); const { files, calls } = fixture;
  await files.open('README.md'); files.edit('My edits'); fixture.failNetwork = true;
  await files.save(); assert.equal(files.state.unknown, true);
  const before = calls.filter(([, opts]) => opts.method === 'PUT').length;
  await files.save(); assert.equal(calls.filter(([, opts]) => opts.method === 'PUT').length, before);
  await files.recheck(); assert.equal(files.state.unknown, false);
  assert.equal(files.state.loaded.content, 'My edits'); assert.equal(files.canLeave(), true);
});
test('an in-flight file switch does not accept a later edit that would be overwritten', async () => {
  let release;
  const files = createFiles({ confirm: () => true, changed: () => {}, fetch: async url => {
    const path = new URL(url, 'http://localhost').searchParams.get('path');
    if (url.includes('/tree?')) return reply({ path, entries: [], truncated: false });
    if (path === 'next.txt') await new Promise(resolve => { release = resolve; });
    return reply(file('Original', path));
  } });
  files.select(workspace); await files.open('README.md'); files.edit('Dirty');
  const pending = files.open('next.txt');
  files.edit('Later edit'); assert.equal(files.state.buffer, 'Dirty');
  release(); await pending; assert.equal(files.state.loaded.path, 'next.txt');
});
test('an unrequestable filename cannot hide other safe files in its directory', async () => {
  const files = createFiles({ changed: () => {}, confirm: () => false, fetch: async () => reply({ path: '', truncated: false, entries: [
    { name: 'normal.txt', path: 'normal.txt', type: 'file' },
    { name: 'bad\\name.txt', path: 'bad\\name.txt', type: 'file' },
  ] }) });
  files.select(workspace); await files.list();
  assert.deepEqual(files.state.entries.map(entry => entry.name), ['normal.txt']);
  assert.match(files.state.error, /skipped/i);
});
test('rejects non-UTF-8 version mismatch, traversal entries and oversized saves', async () => {
  const bad = createFiles({ changed: () => {}, confirm: () => false, fetch: async url => {
    if (url.includes('/tree?')) return reply({ path: '', truncated: false, entries: [{ name: 'escape', path: '../escape', type: 'file' }] });
    return reply({ ...file('bad'), version: version('different') });
  } });
  bad.select(workspace); await bad.list(); assert.match(bad.state.error, /Invalid file tree entry/);
  await bad.open('README.md'); assert.equal(bad.state.loaded.editable, false);
  bad.edit('replacement'); assert.equal(bad.state.buffer, 'bad');
  await bad.open('~/outside.txt'); assert.equal(bad.state.loaded.path, 'README.md');
  await bad.open('C:/outside.txt'); assert.equal(bad.state.loaded.path, 'README.md');
  const fixture = setup(); await fixture.files.open('README.md'); fixture.files.edit('x'.repeat(512 * 1024 + 1));
  await fixture.files.save(); assert.match(fixture.files.state.error, /512 KiB/);
  assert.equal(fixture.calls.some(([, opts]) => opts.method === 'PUT'), false);
});
