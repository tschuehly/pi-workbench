import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, ask, event, page, snapshot, status } from './client.mjs';
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
test('ask answer uses original identity, handles stale response and errors', async () => {
  const f = fake(); f.chat.select('s', '/repo'); f.sockets[0].open(); f.seed('s'); await tick();
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
test('rejects malformed consumed data and ignores stale session HTTP/socket', async () => {
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
