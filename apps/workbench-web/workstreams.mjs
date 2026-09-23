// Scoped PI WEB transport; snapshot semantics and validation stay in Workbench's workstream-client.
export function createWorkstreams({ fetch: request, validateClient, changed = () => {} }) {
  let generation = 0, client = null;
  let view = { summaries: [], snapshot: null, loading: false, error: null, scope: null };
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
    view = { summaries: [], snapshot: null, loading: true, error: null, scope }; emit();
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
      if (epoch === generation) { view = { ...view, snapshot, loading: false }; emit(); }
    } catch (error) { if (epoch === generation) { view = { ...view, snapshot: null, loading: false, error: String(error) }; emit(); } }
  }
  function clear() { ++generation; client = null; view = { summaries: [], snapshot: null, loading: false, error: null, scope: null }; emit(); }
  return { load, select, clear, get view() { return view; } };
}
