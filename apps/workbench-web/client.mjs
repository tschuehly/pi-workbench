// Source note: join watermark and pending-ask behavior adapted from PI WEB's
// sessionController.ts and apiTypes.ts (sibling checkout); this is an independently maintained subset.
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fail = name => { throw new Error(`Invalid ${name} response`); };
const text = x => typeof x === 'string' && x.length > 0;
const seq = x => Number.isSafeInteger(x) && x >= 0;

export function ask(x) {
  if (!record(x) || !text(x.askId) || !text(x.askedAt) || !Array.isArray(x.questions) || !x.questions.length) fail('ask');
  const ids = new Set();
  for (const q of x.questions) {
    if (!record(q) || !text(q.id) || !text(q.question) || ids.has(q.id) || !Array.isArray(q.options) || (q.multiple !== undefined && typeof q.multiple !== 'boolean')) fail('ask question');
    ids.add(q.id);
    const values = new Set();
    for (const o of q.options) {
      if (!record(o) || !text(o.value) || !text(o.label) || values.has(o.value)) fail('ask option');
      values.add(o.value);
    }
  }
  return x;
}
export function status(x, id) {
  if (!record(x) || x.sessionId !== id || typeof x.isStreaming !== 'boolean' || typeof x.isCompacting !== 'boolean' || typeof x.isBashRunning !== 'boolean' || !seq(x.pendingMessageCount) || !Array.isArray(x.queuedMessages) || !record(x.tokens) || !['input','output','cacheRead','cacheWrite','total'].every(k => typeof x.tokens[k] === 'number' && Number.isFinite(x.tokens[k])) || typeof x.cost !== 'number' || !Number.isFinite(x.cost)) fail('status');
  if (x.pendingAsk !== undefined) ask(x.pendingAsk);
  if (x.model !== undefined && (!record(x.model) || (x.model.provider !== undefined && !text(x.model.provider)) || (x.model.id !== undefined && !text(x.model.id)) || (x.model.name !== undefined && typeof x.model.name !== 'string'))) fail('status model');
  if (x.thinkingLevel !== undefined && typeof x.thinkingLevel !== 'string') fail('status thinking level');
  return x;
}
export function models(x) {
  if (!record(x) || !Array.isArray(x.models)) fail('models');
  const keys = new Set();
  for (const m of x.models) {
    if (!record(m) || !text(m.provider) || !text(m.id) || (m.name !== undefined && typeof m.name !== 'string')) fail('model');
    const key = JSON.stringify([m.provider, m.id]);
    if (keys.has(key)) fail('duplicate model');
    keys.add(key);
  }
  return x.models;
}
export function thinkingLevels(x) {
  if (!record(x) || !Array.isArray(x.levels) || x.levels.some(level => !text(level)) || new Set(x.levels).size !== x.levels.length) fail('thinking levels');
  return x.levels;
}
function message(m) {
  if (!record(m) || (m.entryId !== undefined && !text(m.entryId)) || (m.content !== undefined && typeof m.content !== 'string' && (!Array.isArray(m.content) || m.content.some(p => !record(p) || (p.type === 'text' && typeof p.text !== 'string'))))) fail('message');
  return m;
}
export function page(x) {
  if (!record(x) || !Array.isArray(x.messages) || !seq(x.start) || !seq(x.total) || x.start + x.messages.length > x.total) fail('message page');
  x.messages.forEach(message);
  return x;
}
export function snapshot(x) {
  if (!record(x) || !seq(x.seq) || !('partial' in x)) fail('stream snapshot');
  if (x.partial !== null) message(x.partial);
  return x;
}
export function event(x, id) {
  if (!record(x) || !seq(x.seq) || !text(x.type)) fail('event');
  switch (x.type) {
    case 'message.append': message(x.message); break;
    case 'message.end': if (x.message !== undefined) message(x.message); break;
    case 'assistant.delta': if (typeof x.text !== 'string') fail('event delta'); break;
    case 'status.update': status(x.status, id); break;
    case 'ask.opened': ask(x.ask); break;
    case 'ask.closed': if (!text(x.askId) || !['submitted','superseded','cancelled'].includes(x.reason)) fail('event ask close'); break;
    default: break; // Other PI WEB frames are intentionally not rendered by this proof.
  }
  return x;
}

export function createChat({ fetch: request, socket: connect, changed = () => {}, retry = (fn, ms) => setTimeout(fn, ms) }) {
  let current, generation = 0;
  const emit = () => { if (current) changed({ ...current.view, messages: [...current.view.messages] }); };
  async function json(url, options) {
    const response = await request(url, options);
    if (!response.ok) throw new Error(`${response.status} ${url}: ${await response.text()}`);
    return response.json();
  }
  function stop() { generation++; current?.ws?.close(); current = undefined; }
  function select(id, cwd, machine = 'local') {
    stop();
    if (!text(id) || !text(cwd) || !text(machine)) throw new Error('Session id, cwd and machine are required');
    const token = generation, base = `/api/machines/${encodeURIComponent(machine)}/sessions/${encodeURIComponent(id)}`;
    const url = path => `${base}/${path}?cwd=${encodeURIComponent(cwd)}`;
    const c = current = { id, cwd, base, url, view: { id, cwd, messages: [], start: 0, total: 0, partial: null, pendingAsk: null, sending: false, models: [], thinkingLevels: [], controlsLoading: true, controlBusy: false, connection: 'connecting', error: null }, seq: 0, pending: [], joining: true, ws: null, epoch: 0, controlsEpoch: 0 };
    const alive = () => current === c && token === generation;
    function apply(e) {
      if (e.seq <= c.seq) return;
      if (e.seq !== c.seq + 1) { reseed(); return; }
      c.seq = e.seq;
      switch (e.type) {
        case 'message.append':
        case 'message.end':
          if (e.message && (!e.message.entryId || !c.view.messages.some(m => m.entryId === e.message.entryId))) c.view.messages.push(e.message);
          if (e.type === 'message.end') c.view.partial = null;
          break;
        case 'assistant.delta': {
          const content = c.view.partial?.content;
          c.view.partial = { ...(c.view.partial ?? {}), content: [...(typeof content === 'string' ? [{ type: 'text', text: content }] : content ?? []), { type: 'text', text: e.text }] };
          break;
        }
        case 'ask.opened': c.view.pendingAsk = e.ask; break;
        case 'ask.closed': if (c.view.pendingAsk?.askId === e.askId) c.view.pendingAsk = null; break;
        case 'status.update': c.view.pendingAsk = e.status.pendingAsk ?? null; c.view.status = e.status; break;
      }
      emit();
    }
    async function loadControls() {
      const epoch = ++c.controlsEpoch;
      c.view.controlsLoading = true; emit();
      try {
        const [availableModels, availableLevels] = await Promise.all([json(url('models')), json(url('thinking-levels'))]);
        if (!alive() || epoch !== c.controlsEpoch) return;
        c.view.models = models(availableModels);
        c.view.thinkingLevels = thinkingLevels(availableLevels);
        c.view.controlsLoading = false; emit();
      } catch (e) {
        if (alive() && epoch === c.controlsEpoch) { c.view.controlsLoading = false; c.view.error = `Model/thinking controls unavailable: ${String(e)}`; emit(); }
      }
    }
    async function seed() {
      const epoch = c.epoch;
      c.joining = true;
      try {
        // Snapshot first: a history page fetched before its watermark could miss
        // a completed message whose final event is then discarded as old.
        const snap = await json(url('stream-snapshot'));
        const [p, s] = await Promise.all([json(url('messages') + '&limit=100'), json(url('status'))]);
        if (!alive() || epoch !== c.epoch) return;
        const history = page(p), state = status(s, id), stream = snapshot(snap);
        c.view.messages = history.messages;
        c.view.start = history.start;
        c.view.total = history.total;
        c.view.status = state;
        c.view.pendingAsk = state.pendingAsk ?? null;
        c.view.partial = stream.partial;
        c.seq = stream.seq;
        c.view.error = null;
        c.view.connection = 'connected';
        c.joining = false;
        const frames = c.pending.splice(0).sort((a, b) => a.seq - b.seq);
        for (const frame of frames) { if (c.joining) break; apply(frame); }
        emit();
        void loadControls();
      } catch (e) {
        if (alive() && epoch === c.epoch) {
          c.view.error = String(e); c.view.connection = 'error'; emit();
          retry(() => { if (alive() && epoch === c.epoch && c.ws?.readyState === 1) void seed(); }, 500);
        }
      }
    }
    function reseed() { if (!c.joining) { c.pending = []; void seed(); } }
    function open() {
      if (!alive()) return;
      c.epoch++;
      c.joining = true;
      c.pending = [];
      c.view.connection = 'connecting'; emit();
      const ws = c.ws = connect(url('events'));
      ws.onopen = () => { if (alive() && c.ws === ws) void seed(); };
      ws.onmessage = ({ data }) => {
        if (!alive() || c.ws !== ws) return;
        try {
          const frame = event(JSON.parse(data), id);
          if (c.joining) c.pending.push(frame);
          else apply(frame);
        } catch (e) { c.view.error = String(e); emit(); reseed(); }
      };
      ws.onclose = () => {
        if (!alive() || c.ws !== ws) return;
        c.epoch++;
        c.view.connection = 'reconnecting'; emit();
        retry(() => { if (alive() && c.ws === ws) open(); }, 500);
      };
      ws.onerror = () => { if (alive() && c.ws === ws) { c.view.error = 'WebSocket failed'; emit(); } };
    }
    open();
  }
  async function earlier() {
    const c = current;
    if (!c || !c.view.start) return;
    const at = c.view.start;
    try {
      const p = page(await json(c.url('messages') + `&before=${at}&limit=100`));
      if (current !== c || c.view.start !== at) return;
      if (p.start + p.messages.length !== at) throw new Error('History page discontinuity');
      c.view.messages = [...p.messages, ...c.view.messages]; c.view.start = p.start; c.view.total = p.total; emit();
    } catch (e) { if (current === c) { c.view.error = String(e); emit(); } }
  }
  async function send(text, streamingBehavior) {
    const c = current;
    if (!c || typeof text !== 'string' || !text.trim() || c.view.sending) return false;
    if (streamingBehavior !== undefined && !['steer', 'followUp'].includes(streamingBehavior)) throw new Error('Invalid streaming behavior');
    c.view.sending = true; c.view.error = null; emit();
    try {
      const result = await json(`${c.base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: c.cwd, text, ...(streamingBehavior === undefined ? {} : { streamingBehavior }) }) });
      if (!record(result) || result.accepted !== true) throw new Error('Invalid prompt response');
      return true;
    } catch (e) {
      if (current === c) { c.view.error = String(e); emit(); }
      return false;
    } finally { if (current === c) { c.view.sending = false; emit(); } }
  }
  async function changeControl(kind, value) {
    const c = current;
    if (!c || c.view.controlsLoading || c.view.controlBusy || c.view.connection !== 'connected') return false;
    if (kind === 'model') {
      if (!Array.isArray(value) || value.length !== 2 || !c.view.models.some(m => m.provider === value[0] && m.id === value[1])) throw new Error('Model is not available in this session');
    } else if (kind === 'thinking') {
      if (!c.view.thinkingLevels.includes(value)) throw new Error('Thinking level is not available in this session');
    } else throw new Error('Invalid control');
    c.view.controlBusy = true; c.view.error = null; emit();
    try {
      const body = kind === 'model' ? { cwd: c.cwd, provider: value[0], modelId: value[1] } : { cwd: c.cwd, level: value };
      const result = status(await json(`${c.base}/${kind === 'model' ? 'model' : 'thinking-level'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), c.id);
      if (current === c) { c.view.status = result; c.view.pendingAsk = result.pendingAsk ?? null; emit(); }
      return true;
    } catch (e) {
      if (current === c) { c.view.error = `Control update outcome unknown: ${String(e)}. Check the displayed status before another change.`; emit(); }
      return false;
    } finally { if (current === c) { c.view.controlBusy = false; emit(); } }
  }
  async function stopTurn() {
    const c = current;
    if (!c) return;
    try {
      const result = await json(`${c.base}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: c.cwd }) });
      if (!record(result) || result.stopped !== true) throw new Error('Invalid stop response');
    } catch (e) { if (current === c) { c.view.error = String(e); emit(); } }
  }
  async function answer(answers) {
    const c = current, pending = c?.view.pendingAsk;
    if (!c || !pending) return;
    if (!Array.isArray(answers) || answers.some(a => !record(a) || !pending.questions.some(q => q.id === a.id) || !Array.isArray(a.values) || !a.values.every(text) || (a.otherText !== undefined && typeof a.otherText !== 'string'))) throw new Error('Invalid answers');
    try {
      const result = await json(`${c.base}/ask/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: c.cwd, askId: pending.askId, answers }) });
      if (!record(result) || !['closed','stale'].includes(result.result)) throw new Error('Invalid ask response');
      const updated = status(result.sessionStatus, c.id);
      if (current === c) { c.view.pendingAsk = updated.pendingAsk ?? null; c.view.status = updated; emit(); }
    } catch (e) { if (current === c) { c.view.error = String(e); emit(); } }
  }
  return { select, stop, earlier, answer, send, stopTurn, changeModel: value => changeControl('model', value), changeThinking: value => changeControl('thinking', value) };
}
