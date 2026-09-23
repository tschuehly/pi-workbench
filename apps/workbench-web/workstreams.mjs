// Unsubmitted answers follow their Workstream across registered workspaces in this browser tab.
export function createTaskDrafts(storage) {
  const fallback = new Map();
  const key = (scope, workstreamId, taskId) => `workbench:workstream:draft:${JSON.stringify([scope.machineId, workstreamId, taskId])}`;
  return {
    get(scope, workstreamId, taskId) {
      const id = key(scope, workstreamId, taskId);
      if (fallback.has(id)) return fallback.get(id);
      try { return storage?.getItem(id) ?? ''; } catch { return ''; }
    },
    set(scope, workstreamId, taskId, text) {
      const id = key(scope, workstreamId, taskId);
      try {
        if (text) storage?.setItem(id, text);
        else storage?.removeItem(id);
        if (storage) fallback.delete(id);
        else if (text) fallback.set(id, text);
        else fallback.delete(id);
      } catch { if (text) fallback.set(id, text); else fallback.delete(id); }
    },
    get volatile() { return fallback.size > 0; },
  };
}

// Scoped PI WEB transport; snapshot semantics and validation stay in Workbench's workstream-client.
export function createWorkstreams({ fetch: request, validateClient, storage, changed = () => {} }) {
  let generation = 0, client = null, watchSequence = 0;
  const emptyView = (scope = null, loading = false) => ({ summaries: [], snapshot: null, loading, answering: false, pendingAnswer: false, answerConflict: null, needsRefresh: false, creating: false, pendingCreate: false, error: null, scope });
  let view = emptyView();
  let pendingRequest = null, pendingKey = null, createRequest = null;
  const createKey = machineId => `workbench:workstream:create:${machineId}`;
  function savedCreate(machineId) {
    const raw = storage?.getItem(createKey(machineId));
    if (!raw) return null;
    let saved;
    try { saved = JSON.parse(raw); } catch { throw new Error('Saved Workstream creation is damaged; recover it before creating another.'); }
    if (saved?.producer !== 'workbench-web' || !/^ws-[0-9a-f-]{36}$/i.test(saved.workstreamId) || !/^workbench-create-[0-9a-f-]{36}$/i.test(saved.idempotencyKey) || typeof saved.title !== 'string' || !saved.title.trim() || saved.title.length > 200) throw new Error('Saved Workstream creation is invalid; recover it before creating another.');
    return saved;
  }
  const emit = () => changed({ ...view });
  const nonempty = x => typeof x === 'string' && x.trim() !== '';
  async function json(path, options) {
    const response = await request(path, options);
    const length = Number(response.headers?.get('content-length'));
    if (Number.isFinite(length) && length > 2_000_000) throw new Error('Workstream response is too large');
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 2_000_000) throw new Error('Workstream response is too large');
    if (!response.ok) throw new Error(`Workstream request returned HTTP ${response.status}`);
    return JSON.parse(text);
  }
  async function load(scope) {
    const epoch = ++generation;
    client = null;
    pendingRequest = null; pendingKey = null; createRequest = null;
    watchSequence = 0;
    view = emptyView(scope, true); emit();
    try {
      if (scope.machineId !== 'local' || !nonempty(scope.projectId) || !nonempty(scope.workspaceId)) throw new Error('Choose a registered local workspace first');
      const plugins = await json('/api/plugins');
      const plugin = plugins.plugins?.find(item => item.id === 'pi-workbench' && item.server?.state === 'active');
      const revision = plugin?.server?.activeRevision;
      if (!nonempty(revision)) throw new Error('The Workbench Workstream service is not active');
      const service = { request: (operation, input) => json(`/api/paired-plugin-backends/pi-workbench/projects/${encodeURIComponent(scope.projectId)}/workspaces/${encodeURIComponent(scope.workspaceId)}/${encodeURIComponent(operation)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision, input }),
      }) };
      const validated = validateClient(service);
      const summaries = await validated.list();
      if (epoch !== generation) return;
      client = validated;
      createRequest = savedCreate(scope.machineId);
      view = { ...view, summaries, loading: false, pendingCreate: createRequest !== null }; emit();
      if (createRequest) {
        const saved = createRequest;
        try {
          const existing = await validated.inspect(saved.workstreamId);
          if (existing.title !== saved.title) throw new Error('An unrelated Workstream has the saved creation identity. Do not retry.');
          if (epoch !== generation) return;
          storage.removeItem(createKey(scope.machineId)); createRequest = null;
          view = { ...view, pendingCreate: false }; emit();
        } catch (error) {
          if (error?.code !== 'WORKSTREAM_NOT_FOUND' && epoch === generation) { view = { ...view, error: `Could not reconcile saved Workstream creation: ${String(error)}` }; emit(); }
        }
      }
      if (epoch === generation && summaries.length) await select(summaries[0].id);
    } catch (error) { if (epoch === generation) { view = { ...view, loading: false, error: String(error) }; emit(); } }
  }
  async function select(id) {
    if (!view.summaries.some(item => item.id === id) || !client) throw new Error('Unknown Workstream');
    const epoch = ++generation;
    const selectedClient = client;
    view = { ...view, snapshot: null, loading: true, error: view.pendingCreate ? view.error : null }; emit();
    try {
      const snapshot = await selectedClient.inspect(id);
      if (snapshot.id !== id) throw new Error('Workstream identity mismatch');
      if (epoch === generation) { const answerConflict = reconcileAnswer(snapshot); view = { ...view, snapshot, loading: false, pendingAnswer: pendingRequest !== null, answerConflict, needsRefresh: false, error: answerConflict ? 'Another answer was recorded. Your different saved answer is preserved below; copy it before dismissing.' : view.pendingCreate ? view.error : null }; emit(); }
    } catch (error) { if (epoch === generation) { view = { ...view, snapshot: null, loading: false, error: String(error) }; emit(); } }
  }
  async function checkUpdates() {
    if (!client || !view.snapshot || view.loading || view.answering || view.needsRefresh) return;
    const epoch = generation, selectedClient = client;
    try {
      const batch = await selectedClient.watch({ afterSequence: watchSequence });
      if (epoch !== generation || selectedClient !== client || !view.snapshot) return;
      watchSequence = batch.nextSequence;
      const newer = batch.mode === 'snapshot'
        ? batch.snapshots.some(item => item.id === view.snapshot.id && item.revision > view.snapshot.revision)
        : batch.events.some(item => item.workstreamId === view.snapshot.id && item.revision > view.snapshot.revision);
      if (newer) { view = { ...view, needsRefresh: true, error: 'Workstream changed; refresh and review the latest task before answering.' }; emit(); }
    } catch (error) { if (epoch === generation) { view = { ...view, error: `Could not check Workstream updates: ${String(error)}` }; emit(); } }
  }
  async function create(title) {
    if (!client || !view.scope || view.loading || view.creating || view.pendingCreate) throw new Error('A pending creation must be reconciled before creating another Workstream.');
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Workstream title must be 1–200 characters.');
    if (!storage) throw new Error('Browser storage is unavailable; creation cannot be tracked safely.');
    if (savedCreate(view.scope.machineId)) throw new Error('A pending creation must be reconciled before creating another Workstream.');
    const id = crypto.randomUUID();
    const request = { workstreamId: `ws-${id}`, idempotencyKey: `workbench-create-${id}`, title: title.trim(), producer: 'workbench-web' };
    storage.setItem(createKey(view.scope.machineId), JSON.stringify(request));
    createRequest = request;
    view = { ...view, pendingCreate: true }; emit();
    return submitCreate();
  }
  async function retryCreate() {
    if (!client || !view.scope || view.loading || view.creating || !createRequest) throw new Error('No exact saved Workstream creation can be retried.');
    return submitCreate();
  }
  async function submitCreate() {
    const epoch = generation, selectedClient = client, request = createRequest, machineId = view.scope.machineId;
    view = { ...view, creating: true, error: null }; emit();
    try {
      const receipt = await selectedClient.create(request);
      if (receipt.workstreamId !== request.workstreamId || receipt.idempotencyKey !== request.idempotencyKey || receipt.acceptedRevision !== 1) throw new Error('Creation receipt does not match the saved request.');
      storage.removeItem(createKey(machineId));
      if (epoch !== generation) return;
      createRequest = null;
      const summaries = await selectedClient.list();
      if (epoch !== generation) return;
      view = { ...view, summaries, creating: false, pendingCreate: false }; emit();
      if (!summaries.some(item => item.id === request.workstreamId)) throw new Error('Created Workstream is not in the current list. Refresh before trying again.');
      await select(request.workstreamId);
    } catch (error) {
      if (epoch === generation) { view = { ...view, creating: false, pendingCreate: createRequest !== null, error: `${createRequest ? 'Creation outcome unknown' : 'Created Workstream could not be loaded'}: ${String(error)}` }; emit(); }
    }
  }
  const answerPrefix = 'workbench:workstream:answer:';
  function answerKey(id) { return `${answerPrefix}${JSON.stringify([view.scope.machineId, id])}`; }
  function savedAnswer(snapshot) {
    const keys = [answerKey(snapshot.id)];
    // Earlier proof builds stored retry requests under the selected workspace. A Workstream may
    // span registered workspaces, so find those exact requests before allowing a new answer.
    for (let i = 0; i < (storage?.length ?? 0); i++) {
      const key = storage.key(i);
      if (!key?.startsWith(answerPrefix)) continue;
      let parts;
      try { parts = JSON.parse(key.slice(answerPrefix.length)); } catch { continue; }
      if (Array.isArray(parts) && parts.length === 4 && parts[0] === view.scope.machineId && parts[3] === snapshot.id) keys.push(key);
    }
    const found = keys.map(key => [key, storage?.getItem(key)]).filter(([, value]) => value);
    if (found.length > 1) throw new Error('Multiple saved answer requests exist for this Workstream. Copy and reconcile them before answering again.');
    return found[0];
  }
  function reconcileAnswer(snapshot) {
    pendingRequest = null; pendingKey = null;
    const found = savedAnswer(snapshot);
    if (!found) return null;
    const [key, raw] = found;
    pendingKey = key;
    let saved;
    try { saved = JSON.parse(raw); } catch { throw new Error('Saved answer request is damaged; do not answer again until it is recovered.'); }
    const record = saved?.records?.[0];
    if (saved.workstreamId !== snapshot.id || !Number.isSafeInteger(saved.expectedRevision) || saved.expectedRevision < 1 || typeof saved.idempotencyKey !== 'string' || !saved.idempotencyKey || saved.records?.length !== 1 || record?.type !== 'human-task.answered' || record.producer !== 'workbench-web' || typeof record.payload?.taskId !== 'string' || typeof record.payload?.answerId !== 'string' || !record.payload.answerId || !validSavedAnswer(record.payload.answer)) throw new Error('Saved answer request is invalid; do not answer again until it is recovered.');
    const task = snapshot.humanTasks.find(item => item.id === record.payload.taskId);
    if (task && task.status !== 'pending') {
      if (task.answerReceipt?.answerId !== record.payload.answerId) return saved;
      storage.removeItem(key); pendingKey = null;
      return null;
    }
    pendingRequest = saved;
    return null;
  }
  async function answer(taskId, answerValue) {
    const snapshot = view.snapshot;
    if (!client || !snapshot || view.loading || view.answering || view.needsRefresh || pendingRequest || view.answerConflict) throw new Error('Refresh or reconcile the pending answer before submitting another.');
    const task = snapshot.humanTasks.find(item => item.id === taskId);
    if (snapshot.closed || !validAnswer(task, answerValue)) throw new Error('This task is not open with that answer.');
    if (!storage) throw new Error('Browser storage is unavailable; an answer cannot safely be submitted.');
    const answerId = globalThis.crypto.randomUUID();
    const submission = { workstreamId: snapshot.id, expectedRevision: snapshot.revision, idempotencyKey: `workbench-answer-${answerId}`, records: [{ type: 'human-task.answered', producer: 'workbench-web', payload: { taskId, answerId, answer: answerValue } }] };
    pendingKey = answerKey(snapshot.id);
    storage.setItem(pendingKey, JSON.stringify(submission));
    pendingRequest = submission;
    return submitAnswer(submission);
  }
  function dismissAnswerConflict() {
    if (!view.answerConflict || !view.snapshot || view.loading) throw new Error('No conflicting saved answer can be dismissed.');
    storage.removeItem(pendingKey);
    pendingKey = null;
    view = { ...view, answerConflict: null, error: null }; emit();
  }
  async function retryAnswer() {
    if (!pendingRequest || !client || !view.snapshot || view.answering || view.loading) throw new Error('No pending answer can be retried.');
    return submitAnswer(pendingRequest);
  }
  async function submitAnswer(submission) {
    const epoch = generation, selectedClient = client, key = pendingKey;
    view = { ...view, answering: true, pendingAnswer: true, error: null }; emit();
    try {
      const receipt = await selectedClient.append(submission);
      if (receipt.workstreamId !== submission.workstreamId || receipt.idempotencyKey !== submission.idempotencyKey || receipt.acceptedRevision !== submission.expectedRevision + 1) throw new Error('Answer receipt does not match the submitted request.');
      const snapshot = await selectedClient.inspect(submission.workstreamId);
      if (epoch === generation) { const answerConflict = reconcileAnswer(snapshot); view = { ...view, snapshot, answering: false, pendingAnswer: pendingRequest !== null, answerConflict, needsRefresh: false, error: answerConflict ? 'Another answer was recorded. Your different saved answer is preserved below; copy it before dismissing.' : null }; emit(); }
    } catch (error) {
      if (error?.code === 'STALE_REVISION' || error?.code === 'INVALID_TRANSITION') {
        storage.removeItem(key);
        if (epoch === generation) { pendingRequest = null; pendingKey = null; view = { ...view, answering: false, pendingAnswer: false, needsRefresh: true, error: 'Workstream changed; refresh and review the task before answering again.' }; emit(); }
      } else if (epoch === generation) { view = { ...view, answering: false, pendingAnswer: true, error: `Answer outcome unknown: ${String(error)}. Refresh to check it, or retry the exact saved request.` }; emit(); }
    }
  }
  function clear() { ++generation; client = null; pendingRequest = null; pendingKey = null; createRequest = null; watchSequence = 0; view = emptyView(); emit(); }
  return { load, select, checkUpdates, clear, create, retryCreate, answer, retryAnswer, dismissAnswerConflict, get view() { return view; } };
}
function validSavedAnswer(answer) {
  if (!answer || !['yes-no', 'choice', 'free-text'].includes(answer.kind)) return false;
  if (answer.kind === 'free-text') return typeof answer.text === 'string' && answer.text.trim().length > 0 && answer.text.length <= 4_000;
  return typeof answer.optionId === 'string' && answer.optionId.trim().length > 0;
}
function validAnswer(task, answer) {
  return task?.status === 'pending' && task.answerKind === answer?.kind && validSavedAnswer(answer)
    && (answer.kind === 'free-text' || task.options.some(option => option.id === answer.optionId));
}
