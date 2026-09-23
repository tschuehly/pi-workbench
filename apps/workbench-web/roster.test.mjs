import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delegates } from './roster.mjs';
const status = items => ({ extensionStatuses: { 'pi-workbench:activity': JSON.stringify({ schemaVersion: 1, items }) } });
test('uses actual reported bindings and distinguishes running from uncollected', () => {
  const result = delegates(status([
    { id: 'delegate:worker-1', kind: 'worker', name: 'Files', role: 'implementation', model: 'openai/gpt-6-luna', effort: 'high', objective: 'Inspect files', activity: 'reading files', reportedStatus: 'Checking boundaries' },
    { id: 'delegate:subagent-2', kind: 'subagent', name: 'Review', model: 'anthropic/claude', activity: 'success' },
  ]));
  assert.equal(result.available, true);
  assert.deepEqual(result.items.map(item => [item.model, item.terminal]), [['openai/gpt-6-luna', false], ['anthropic/claude', true]]);
  assert.equal(delegates(status([])).available, true);
  assert.equal(delegates(undefined).available, false);
});
test('malformed or oversized extension status cannot invent completed rows', () => {
  assert.deepEqual(delegates({ extensionStatuses: { 'pi-workbench:activity': '{bad' } }), { available: false, items: [] });
  assert.deepEqual(delegates(status([{ id: 'same', kind: 'worker' }, { id: 'same', kind: 'subagent' }])), { available: false, items: [] });
  assert.deepEqual(delegates(status([{ id: 'unsafe id', kind: 'worker' }])), { available: false, items: [] });
  assert.deepEqual(delegates(status([{ id: 'ok', kind: 'worker', objective: 'x'.repeat(241) }])), { available: false, items: [] });
  assert.equal(delegates({ extensionStatuses: { 'pi-workbench:activity': 'x'.repeat(65_537) } }).available, false);
});
