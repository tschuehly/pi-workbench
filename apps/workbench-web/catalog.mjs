// Owned, validated subset of PI WEB's project/workspace/session catalog protocol.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const string = x => typeof x === 'string' && x.length > 0;
const invalid = name => { throw new Error(`Invalid ${name} response`); };
export function project(x) {
  if (!object(x) || !string(x.id) || !string(x.name) || !string(x.path) || !string(x.createdAt)) invalid('project');
  return x;
}
export function resolution(x, id) {
  if (!object(x) || x.projectId !== id || !['provider', 'folder', 'degraded'].includes(x.status) || !Array.isArray(x.workspaces) || !x.workspaces.length || !Array.isArray(x.diagnostics)) invalid('workspace resolution');
  if (x.workspaces.some(w => !object(w) || !string(w.id) || w.projectId !== id || !string(w.path) || !string(w.label) || typeof w.isMain !== 'boolean' || !object(w.effectiveConfig))) invalid('workspace');
  return x;
}
export function session(x, cwd) {
  if (!object(x) || !string(x.id) || !string(x.cwd) || x.cwd !== cwd || typeof x.path !== 'string' || !string(x.created) || !string(x.modified) || !Number.isSafeInteger(x.messageCount) || x.messageCount < 0 || typeof x.firstMessage !== 'string') invalid('session');
  return x;
}

export function createCatalog({ fetch: request, storage, changed = () => {}, token = () => crypto.randomUUID() }) {
  let machine = 'local', generation = 0;
  let view = { projects: [], workspaces: [], sessions: [], selectedProject: null, selectedWorkspace: null, selectedSession: null, error: null, loading: false, creating: false, creationUnknown: false };
  const emit = () => changed({ ...view, projects: [...view.projects], workspaces: [...view.workspaces], sessions: [...view.sessions] });
  const base = () => `/api/machines/${encodeURIComponent(machine)}`;
  const key = w => `workbench:pending-create:${JSON.stringify([machine, w.projectId, w.id, w.path])}`;
  const pending = w => { try { return storage?.getItem(key(w)) ?? null; } catch { return 'storage-unavailable'; } };
  async function json(path, options) {
    const response = await request(path, options);
    if (!response.ok) throw new Error(`${response.status} ${path}: ${await response.text()}`);
    return response.json();
  }
  const identity = s => ({ machineId: machine, projectId: view.selectedProject.id, workspaceId: view.selectedWorkspace.id, cwd: view.selectedWorkspace.path, sessionId: s.id });
  async function load(machineId = 'local', initial = {}) {
    if (!string(machineId)) throw new Error('Machine id is required');
    const epoch = ++generation;
    machine = machineId;
    view = { projects: [], workspaces: [], sessions: [], selectedProject: null, selectedWorkspace: null, selectedSession: null, error: null, loading: true, creating: false, creationUnknown: false }; emit();
    try {
      const projects = await json(`${base()}/projects`);
      if (!Array.isArray(projects)) invalid('projects');
      projects.forEach(project);
      const resolved = await Promise.all(projects.map(async p => resolution(await json(`${base()}/projects/${encodeURIComponent(p.id)}/workspaces`), p.id)));
      if (epoch !== generation) return null;
      view.projects = projects;
      view.workspaces = resolved.flatMap(r => r.workspaces);
      const matches = view.workspaces.filter(w => w.path === initial.cwd && (initial.projectId === undefined || w.projectId === initial.projectId) && (initial.workspaceId === undefined || w.id === initial.workspaceId));
      const initialError = initial.cwd && matches.length !== 1 ? (matches.length ? 'Multiple catalog workspaces match this path. Choose one explicitly.' : 'This Chat directory is not in the registered workspace catalog. Choose a workspace; no identity was invented.') : null;
      const selected = matches.length === 1 ? matches[0] : view.workspaces.find(w => w.projectId === initial.projectId && w.id === initial.workspaceId) ?? view.workspaces[0];
      view.loading = false; emit();
      if (!selected) return null;
      await choose(selected.projectId, selected.id);
      if (generation !== epoch + 1) return null;
      if (initialError) { view.error = initialError; emit(); }
      if (initial.sessionId && matches.length === 1) {
        try {
          if (!view.sessions.some(s => s.id === initial.sessionId)) await selectActive(initial.sessionId);
          if (generation === epoch + 1) return select(initial.sessionId);
        } catch (e) { if (generation === epoch + 1) { view.error = `Session is not available in this workspace: ${String(e)}`; emit(); } }
      }
      return null;
    } catch (e) { if (epoch === generation) { view.error = String(e); view.loading = false; emit(); } return null; }
  }
  async function choose(projectId, workspaceId) {
    const epoch = ++generation;
    const p = view.projects.find(item => item.id === projectId);
    const w = view.workspaces.find(item => item.projectId === projectId && item.id === workspaceId);
    if (!p || !w) throw new Error('Unknown catalog workspace');
    view.selectedProject = p; view.selectedWorkspace = w; view.selectedSession = null; view.sessions = []; view.loading = true; view.error = null; view.creationUnknown = pending(w) !== null; emit();
    try {
      const list = await json(`${base()}/sessions?cwd=${encodeURIComponent(w.path)}`);
      if (!Array.isArray(list)) invalid('sessions');
      list.forEach(s => session(s, w.path));
      if (epoch !== generation) return;
      view.sessions = list.filter(s => !s.archived); view.loading = false; emit();
    } catch (e) { if (epoch === generation) { view.error = String(e); view.loading = false; emit(); } }
  }
  function select(id) {
    const s = view.sessions.find(item => item.id === id);
    if (!s || !view.selectedWorkspace || !view.selectedProject) throw new Error('Session is not in the selected catalog workspace');
    view.selectedSession = s; emit();
    return identity(s);
  }
  async function selectActive(id) {
    const w = view.selectedWorkspace, epoch = generation;
    const active = await json(`${base()}/sessions/${encodeURIComponent(id)}/status?cwd=${encodeURIComponent(w.path)}`);
    if (epoch !== generation) return;
    if (!object(active) || active.sessionId !== id) invalid('active session');
    view.sessions = [{ id, cwd: w.path, name: 'New Chat (not yet saved)', transient: true }, ...view.sessions]; emit();
  }
  async function refresh() {
    const w = view.selectedWorkspace, selected = view.selectedSession?.id;
    if (!w) return;
    await choose(w.projectId, w.id);
    if (selected && !view.error) {
      try { if (!view.sessions.some(s => s.id === selected)) await selectActive(selected); select(selected); }
      catch { /* The transient session is no longer available; do not fabricate it. */ }
    }
  }
  async function create() {
    const w = view.selectedWorkspace;
    if (!w || view.loading || view.creating || view.creationUnknown) return null;
    let startupToken;
    try {
      startupToken = token();
      if (!string(startupToken) || !storage) throw new Error('Safe create tracking is unavailable');
      storage.setItem(key(w), startupToken);
    } catch (e) { view.error = String(e); view.creationUnknown = true; emit(); return null; }
    const epoch = generation, createdKey = key(w);
    view.creating = true; view.error = null; emit();
    try {
      const created = session(await json(`${base()}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: w.path, startupToken }) }), w.path);
      storage.removeItem(createdKey);
      if (epoch !== generation) return null;
      view.sessions = [created, ...view.sessions.filter(s => s.id !== created.id)];
      view.creating = false; view.creationUnknown = false;
      return select(created.id);
    } catch (e) {
      // The POST may have succeeded before a lost response. startupToken is a label,
      // NOT an idempotency key. Never retry it automatically or silently unlock.
      if (epoch === generation) { view.error = `Creation outcome unknown: ${String(e)}. Check sessions before creating again.`; view.creating = false; view.creationUnknown = true; emit(); }
      return null;
    }
  }
  function acknowledgeUnknown() {
    const w = view.selectedWorkspace;
    if (!w || !view.creationUnknown) return;
    try { storage.removeItem(key(w)); view.creationUnknown = pending(w) !== null; view.error = null; emit(); }
    catch (e) { view.error = String(e); emit(); }
  }
  return { load, choose, select, selectActive, refresh, create, acknowledgeUnknown, get view() { return view; }, get machineId() { return machine; } };
}
