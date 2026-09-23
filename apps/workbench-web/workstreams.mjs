// Scoped PI WEB transport; snapshot semantics and validation stay in Workbench's workstream-client.
export function createWorkstreams({ fetch: request, validateClient, storage, changed = () => {} }) {
  let generation = 0, client = null;
  let view = { summaries: [], snapshot: null, loading: false, answering: false, pendingAnswer: false, needsRefresh: false, error: null, scope: null };
  let pendingRequest = null;
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
    pendingRequest = null;
    view = { summaries: [], snapshot: null, loading: true, answering: false, pendingAnswer: false, needsRefresh: false, error: null, scope }; emit();
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
      view = { ...view, summaries, loading: false }; emit();
      if (summaries.length) await select(summaries[0].id);
    } catch (error) { if (epoch === generation) { view = { ...view, loading: false, error: String(error) }; emit(); } }
  }
  async function select(id) {
    if (!view.summaries.some(item => item.id === id) || !client) throw new Error('Unknown Workstream');
    const epoch = ++generation;
    const selectedClient = client;
    view = { ...view, snapshot: null, loading: true, error: null }; emit();
    try {
      const snapshot = await selectedClient.inspect(id);
      if (snapshot.id !== id) throw new Error('Workstream identity mismatch');
      if (epoch === generation) { reconcileAnswer(snapshot); view = { ...view, snapshot, loading: false, pendingAnswer: pendingRequest !== null, needsRefresh: false }; emit(); }
    } catch (error) { if (epoch === generation) { view = { ...view, snapshot: null, loading: false, error: String(error) }; emit(); } }
  }
  function answerKey(id) { return `workbench:workstream:answer:${JSON.stringify([view.scope.machineId, view.scope.projectId, view.scope.workspaceId, id])}`; }
  function reconcileAnswer(snapshot) {
    pendingRequest = null;
    const raw = storage?.getItem(answerKey(snapshot.id));
    if (!raw) return;
    let saved;
    try { saved = JSON.parse(raw); } catch { throw new Error('Saved answer request is damaged; do not answer again until it is recovered.'); }
    const record = saved?.records?.[0];
    if (saved.workstreamId !== snapshot.id || !Number.isSafeInteger(saved.expectedRevision) || saved.expectedRevision < 1 || typeof saved.idempotencyKey !== 'string' || !saved.idempotencyKey || saved.records?.length !== 1 || record?.type !== 'human-task.answered' || record.producer !== 'workbench-web' || typeof record.payload?.taskId !== 'string' || typeof record.payload?.answerId !== 'string' || !record.payload.answerId || !validSavedAnswer(record.payload.answer)) throw new Error('Saved answer request is invalid; do not answer again until it is recovered.');
    const task = snapshot.humanTasks.find(item => item.id === record.payload.taskId);
    if (task && task.status !== 'pending') {
      storage.removeItem(answerKey(snapshot.id));
      if (task.answerReceipt?.answerId !== record.payload.answerId) throw new Error('Another answer was recorded. Review the task before proceeding.');
      return;
    }
    pendingRequest = saved;
  }
  async function answer(taskId, answerValue) {
    const snapshot = view.snapshot;
    if (!client || !snapshot || view.loading || view.answering || view.needsRefresh || pendingRequest) throw new Error('Refresh or reconcile the pending answer before submitting another.');
    const task = snapshot.humanTasks.find(item => item.id === taskId);
    if (snapshot.closed || !validAnswer(task, answerValue)) throw new Error('This task is not open with that answer.');
    if (!storage) throw new Error('Browser storage is unavailable; an answer cannot safely be submitted.');
    const answerId = globalThis.crypto.randomUUID();
    const submission = { workstreamId: snapshot.id, expectedRevision: snapshot.revision, idempotencyKey: `workbench-answer-${answerId}`, records: [{ type: 'human-task.answered', producer: 'workbench-web', payload: { taskId, answerId, answer: answerValue } }] };
    storage.setItem(answerKey(snapshot.id), JSON.stringify(submission));
    pendingRequest = submission;
    return submitAnswer(submission);
  }
  async function retryAnswer() {
    if (!pendingRequest || !client || !view.snapshot || view.answering || view.loading) throw new Error('No pending answer can be retried.');
    return submitAnswer(pendingRequest);
  }
  async function submitAnswer(submission) {
    const epoch = generation, selectedClient = client, key = answerKey(submission.workstreamId);
    view = { ...view, answering: true, pendingAnswer: true, error: null }; emit();
    try {
      const receipt = await selectedClient.append(submission);
      if (receipt.workstreamId !== submission.workstreamId || receipt.idempotencyKey !== submission.idempotencyKey || receipt.acceptedRevision !== submission.expectedRevision + 1) throw new Error('Answer receipt does not match the submitted request.');
      const snapshot = await selectedClient.inspect(submission.workstreamId);
      if (epoch === generation) { reconcileAnswer(snapshot); view = { ...view, snapshot, answering: false, pendingAnswer: pendingRequest !== null }; emit(); }
    } catch (error) {
      if (error?.code === 'STALE_REVISION' || error?.code === 'INVALID_TRANSITION') {
        storage.removeItem(key);
        if (epoch === generation) { pendingRequest = null; view = { ...view, answering: false, pendingAnswer: false, needsRefresh: true, error: 'Workstream changed; refresh and review the task before answering again.' }; emit(); }
      } else if (epoch === generation) { view = { ...view, answering: false, pendingAnswer: true, error: `Answer outcome unknown: ${String(error)}. Refresh to check it, or retry the exact saved request.` }; emit(); }
    }
  }
  function clear() { ++generation; client = null; pendingRequest = null; view = { summaries: [], snapshot: null, loading: false, answering: false, pendingAnswer: false, needsRefresh: false, error: null, scope: null }; emit(); }
  return { load, select, clear, answer, retryAnswer, get view() { return view; } };
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
