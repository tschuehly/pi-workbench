import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, ask, event, page, snapshot, status, models, thinkingLevels } from './client.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const msg = (text, entryId) => ({ role: 'assistant', content: [{ type: 'text', text }], entryId });
const pending = { askId: 'a', askedAt: 'now', questions: [{ id: 'q', question: 'Why?', options: [] }] };
const state = (id, extra = {}) => ({ sessionId: id, isStreaming: true, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0, ...extra });
function fake() {
  const sockets = [], requests = [], views = [], retries = [];
  const chat = createChat({
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    socket: url => { const ws = { url, readyState: 0, close() { this.closed = true; this.readyState = 3; }, frame(e) { this.onmessage({ data: JSON.stringify(e) }); }, open() { this.readyState = 1; this.onopen(); }, drop() { this.readyState = 3; this.onclose(); } }; sockets.push(ws); return ws; },
    changed: v => views.push(v), retry: fn => retries.push(fn),
  });
  const reply = (suffix, body, code = 200) => { const i = requests.findIndex(r => r.url.includes(suffix)); assert.notEqual(i, -1, suffix); requests.splice(i, 1)[0].resolve({ ok: code === 200, status: code, json: async () => body, text: async () => String(body) }); };
  const seed = async (id, overrides = {}) => {
    reply('/stream-snapshot?', overrides.snapshot ?? { seq: 2, partial: msg('seed') });
    await tick();
    reply('/messages?', overrides.page ?? { messages: [msg('old', 'm1')], start: 1, total: 2 });
    reply('/status?', overrides.status ?? state(id, { pendingAsk: pending }));
    await tick();
    if (requests.some(r => r.url.includes('/models?'))) reply('/models?', overrides.models ?? { models: [{ provider: 'fixture', id: 'mock', name: 'Fixture model' }] });
    if (requests.some(r => r.url.includes('/thinking-levels?'))) reply('/thinking-levels?', overrides.levels ?? { levels: ['off', 'high'] });
    await tick();
  };
  return { chat, sockets, requests, views, retries, reply, seed, last: () => views.at(-1) };
}
test('buffer, sort, discard watermark, dedupe, gap reseed, page and reconnect', async () => {
  const f = fake(); f.chat.select('s', '/repo'); const ws = f.sockets[0]; ws.open();
  ws.frame({ type: 'assistant.delta', seq: 4, text: 'B' }); ws.frame({ type: 'assistant.delta', seq: 2, text: 'ignored' }); ws.frame({ type: 'assistant.delta', seq: 3, text: 'A' });
  await f.seed('s');
  assert.equal(f.last().partial.content.at(-1).text, 'B');
  ws.frame({ type: 'assistant.delta', seq: 4, text: 'duplicate' });
  assert.equal(f.last().partial.content.at(-1).text, 'B');
  f.chat.earlier(); f.reply('before=1', { messages: [msg('first', 'm0')], start: 0, total: 2 }); await tick();
  assert.deepEqual(f.last().messages.map(m => m.entryId), ['m0','m1']);
  ws.frame({ type: 'message.append', seq: 5, message: msg('new', 'm2') });
  assert.deepEqual(f.last().messages.map(m => m.entryId), ['m0','m1','m2']);
  ws.frame({ type: 'message.end', seq: 6, message: msg('final', 'm2') });
  assert.deepEqual(f.last().messages.map(m => m.entryId), ['m0','m1','m2']);
  ws.frame({ type: 'assistant.delta', seq: 8, text: 'gap' }); await f.seed('s', { snapshot: { seq: 8, partial: msg('recovered') } });
  assert.equal(f.last().partial.content[0].text, 'recovered');
  ws.drop(); assert.equal(f.last().connection, 'reconnecting'); f.retries.shift()(); f.sockets[1].open();
  await f.seed('s', { snapshot: { seq: 9, partial: msg('resumed') } });
  assert.equal(f.last().partial.content[0].text, 'resumed');
});
test('composer keeps failed draft, binds send/stop to origin, and validates responses', async () => {
  const f = fake(); f.chat.select('s', '/repo'); f.sockets[0].open(); await f.seed('s');
  assert.equal(await f.chat.send('   '), false);
  const send = f.chat.send('first line\nsecond line', 'steer');
  assert.equal(f.last().sending, true);
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { cwd: '/repo', text: 'first line\nsecond line', streamingBehavior: 'steer' });
  f.reply('/prompt', { accepted: true }); assert.equal(await send, true);
  assert.equal(f.last().sending, false);
  const stop = f.chat.stopTurn(); f.reply('/stop', { stopped: true }); await stop;
  const failed = f.chat.send('keep draft'); f.reply('/prompt', 'unavailable', 503);
  assert.equal(await failed, false); assert.match(f.last().error, /503/);
  const stale = f.chat.send('old session');
  f.chat.select('new', '/other'); f.sockets[1].open();
  f.reply('/prompt', { accepted: true }); await stale;
  assert.equal(f.last().id, 'new'); assert.equal(f.last().sending, false);
  await f.seed('new', { status: state('new') });
});

test('ask answer uses original identity, handles stale response and errors', async () => {
  const f = fake(); f.chat.select('s', '/repo'); f.sockets[0].open(); await f.seed('s');
  f.chat.answer([{ id: 'q', values: [], otherText: 'because' }]);
  const req = f.requests[0]; assert.equal(JSON.parse(req.options.body).askId, 'a'); assert.equal(JSON.parse(req.options.body).cwd, '/repo');
  f.reply('/ask/submit', { result: 'stale', sessionStatus: state('s') }); await tick();
  assert.equal(f.last().pendingAsk, null);
  f.chat.answer([]); assert.equal(f.requests.length, 0);
  f.sockets[0].frame({ type: 'ask.opened', seq: 3, ask: pending });
  f.chat.answer([]); f.reply('/ask/submit', 'denied', 403); await tick();
  assert.match(f.last().error, /403/); assert.equal(f.last().pendingAsk.askId, 'a');
});
test('history after snapshot retains a completion at the watermark without duplication', async () => {
  const f = fake(); f.chat.select('s', '/repo'); const ws = f.sockets[0]; ws.open();
  f.reply('/stream-snapshot?', { seq: 5, partial: null });
  await tick();
  ws.frame({ type: 'message.end', seq: 5, message: msg('finished', 'm2') });
  f.reply('/messages?', { messages: [msg('finished', 'm2')], start: 0, total: 1 });
  f.reply('/status?', state('s'));
  await tick();
  assert.deepEqual(f.last().messages.map(m => m.entryId), ['m2']);
  assert.equal(f.last().partial, null);
});

test('failed join retries with buffered frames and recovers', async () => {
  const f = fake(); f.chat.select('s', '/repo'); const ws = f.sockets[0]; ws.open();
  f.reply('/stream-snapshot?', 'unavailable', 503); await tick();
  assert.match(f.last().error, /503/);
  ws.frame({ type: 'assistant.delta', seq: 3, text: 'late' });
  f.retries.shift()();
  await f.seed('s');
  assert.equal(f.last().partial.content.at(-1).text, 'late');
});

test('old join cannot overwrite a newer reconnect', async () => {
  const f = fake(); f.chat.select('s', '/repo'); f.sockets[0].open();
  f.sockets[0].drop(); f.retries.shift()(); f.sockets[1].open();
  await f.seed('s', { snapshot: { seq: 5, partial: msg('stale') } });
  assert.notEqual(f.last().partial?.content?.[0]?.text, 'stale');
  await f.seed('s', { snapshot: { seq: 6, partial: msg('new') } });
  assert.equal(f.last().partial.content[0].text, 'new');
});
test('server queue remains authoritative for steer, promote and clear', async () => {
  const f = fake(), queued = [{ kind: 'followUp', text: 'later' }, { kind: 'steer', text: 'now' }];
  f.chat.select('s', '/repo'); f.sockets[0].open(); await f.seed('s', { status: state('s', { queuedMessages: queued, pendingMessageCount: 2 }) });
  const steer = f.chat.send('intervene');
  assert.equal(JSON.parse(f.requests[0].options.body).streamingBehavior, 'steer');
  f.reply('/prompt', { accepted: true }); assert.equal(await steer, true);
  const followUp = f.chat.send('wait', 'followUp');
  assert.equal(JSON.parse(f.requests[0].options.body).streamingBehavior, 'followUp');
  f.reply('/prompt', { accepted: true }); assert.equal(await followUp, true);
  assert.equal(await f.chat.promoteQueued({ kind: 'followUp', text: 'absent' }), false);
  const promoted = f.chat.promoteQueued(queued[0]);
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { cwd: '/repo', kind: 'followUp', text: 'later' });
  assert.equal(await f.chat.clearQueue(), false);
  f.reply('/queue/promote', state('s', { queuedMessages: [{ kind: 'steer', text: 'later' }, queued[1]], pendingMessageCount: 2 }));
  assert.equal(await promoted, true); assert.equal(f.last().status.queuedMessages[0].kind, 'steer');
  const clear = f.chat.clearQueue(); f.reply('/queue/clear', state('s'));
  assert.equal(await clear, true); assert.deepEqual(f.last().status.queuedMessages, []);
  const failed = f.chat.promoteAll(); assert.equal(await failed, false);
  f.sockets[0].frame({ type: 'status.update', seq: 3, status: state('s', { queuedMessages: [queued[0]], pendingMessageCount: 1 }) });
  const all = f.chat.promoteAll(); f.chat.select('other', '/other'); f.sockets[1].open();
  f.reply('/queue/promote-all', state('s', { queuedMessages: [{ kind: 'steer', text: 'later' }], pendingMessageCount: 1 }));
  assert.equal(await all, true); await f.seed('other'); assert.equal(f.last().id, 'other');
});
test('model/thinking controls use offered values, bind to original session and consume server status', async () => {
  const f = fake(); f.chat.select('s', '/repo', 'local'); f.sockets[0].open(); await f.seed('s', { status: state('s', { model: { provider: 'fixture', id: 'mock' }, thinkingLevel: 'off' }) });
  assert.deepEqual(f.last().models, [{ provider: 'fixture', id: 'mock', name: 'Fixture model' }]);
  assert.deepEqual(f.last().thinkingLevels, ['off', 'high']);
  await assert.rejects(f.chat.changeModel(['unknown', 'model']), /not available/);
  await assert.rejects(f.chat.changeThinking('impossible'), /not available/);
  const thinking = f.chat.changeThinking('high');
  assert.equal(f.last().controlBusy, true);
  assert.equal(await f.chat.changeModel(['fixture', 'mock']), false);
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { cwd: '/repo', level: 'high' });
  f.reply('/thinking-level', state('s', { thinkingLevel: 'high' }));
  assert.equal(await thinking, true); assert.equal(f.last().status.thinkingLevel, 'high');
  const failed = f.chat.changeThinking('off'); f.reply('/thinking-level', 'unavailable', 503);
  assert.equal(await failed, false); assert.match(f.last().error, /outcome unknown.*503/);
  const model = f.chat.changeModel(['fixture', 'mock']);
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { cwd: '/repo', provider: 'fixture', modelId: 'mock' });
  f.chat.select('other', '/other'); f.sockets[1].open();
  f.reply('/model', state('s', { model: { provider: 'fixture', id: 'mock' } }));
  assert.equal(await model, true); assert.equal(f.last().id, 'other');
  await f.seed('other');
  assert.equal(f.last().status.model, undefined);
});
test('rejects malformed consumed data and ignores stale session HTTP/socket', async () => {
  assert.throws(() => models({ models: [{ provider: '', id: 'x' }] }));
  assert.throws(() => models({ models: [{ provider: 'a', id: 'b' }, { provider: 'a', id: 'b' }] }));
  assert.throws(() => thinkingLevels({ levels: ['off', 1] }));
  assert.throws(() => status(state('s', { thinkingLevel: 3 }), 's'));
  assert.throws(() => status(state('s', { queuedMessages: [{ kind: 'future', text: 'bad' }] }), 's'));
  assert.throws(() => page({ messages: [], start: -1, total: 0 }));
  assert.throws(() => page({ messages: [{ content: [{ type: 'text', text: 3 }] }], start: 0, total: 1 }));
  assert.throws(() => snapshot({ seq: 1.5, partial: null }));
  assert.throws(() => ask({ ...pending, questions: [{ id: 'q', question: 'Q', options: [] }, { id: 'q', question: 'Q', options: [] }] }));
  assert.throws(() => status({ ...state('s'), pendingAsk: { askId: 'a' } }, 's'));
  assert.throws(() => event({ type: 'ask.closed', seq: 1, askId: 'a', reason: 'wrong' }, 's'));
  const f = fake(); f.chat.select('old', '/old'); f.sockets[0].open();
  f.chat.select('new', '/new'); f.sockets[1].open();
  await f.seed('old'); f.sockets[0].frame({ type: 'ask.opened', seq: 3, ask: pending });
  await f.seed('new', { status: state('new') });
  assert.equal(f.last().id, 'new'); assert.equal(f.last().pendingAsk, null);
  assert.equal(f.sockets[0].closed, true);
});
