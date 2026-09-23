import { session } from './catalog.mjs';

const valid = x => typeof x === 'string' && x.trim() !== '';
const key = associationKey => `workbench:workstream:launch-prompt:${associationKey}`;
const rejected = message => Object.assign(new Error(message), { code: 'SESSION_START_REJECTED', nonCreationProven: true });
const same = (a, b) => a?.machineId === b.machineId && a?.projectId === b.projectId && a?.workspaceId === b.workspaceId;

export function savedLaunchPrompt(storage, associationKey) {
  if (!valid(associationKey)) throw new Error('Invalid launch association key');
  const raw = storage.getItem(key(associationKey));
  if (raw === null) return null;
  let saved;
  try { saved = JSON.parse(raw); } catch { throw new Error('Saved launch prompt is damaged'); }
  if (saved?.associationKey !== associationKey || !valid(saved.prompt) || !valid(saved.location?.cwd) || saved.location.machineId !== 'local' || !valid(saved.location.projectId) || !valid(saved.location.workspaceId)) throw new Error('Saved launch prompt is invalid');
  return saved;
}

export function createWorkstreamHost({ catalog, fetch: request, storage, open }) {
  function scope(location, selected = false) {
    const view = catalog.view;
    if (catalog.machineId !== 'local' || location?.machineId !== 'local' || !valid(location.projectId) || !valid(location.workspaceId)) throw new Error('A registered local workspace is required');
    const matches = view.workspaces.filter(w => w.projectId === location.projectId && w.id === location.workspaceId && valid(w.path));
    if (matches.length !== 1 || (location.cwd !== undefined && location.cwd !== matches[0].path)) throw new Error('Workspace identity or cwd does not match the registered catalog');
    if (selected && (view.loading || !same(location, { machineId: 'local', projectId: view.selectedProject?.id, workspaceId: view.selectedWorkspace?.id }) || view.selectedWorkspace?.path !== matches[0].path)) throw new Error('Select the requested local workspace before starting a session');
    return { machineId: 'local', projectId: location.projectId, workspaceId: location.workspaceId, cwd: matches[0].path };
  }
  async function json(url, options) {
    const response = await request(url, options);
    if (!response.ok) throw new Error(`Session request returned HTTP ${response.status}`);
    return response.json();
  }
  const identity = (id, location) => ({ id, location: { machineId: location.machineId, projectId: location.projectId, workspaceId: location.workspaceId } });
  return {
    currentLocation() {
      const view = catalog.view;
      if (catalog.machineId !== 'local' || !view.selectedProject || !view.selectedWorkspace || view.loading) return null;
      const location = { machineId: 'local', projectId: view.selectedProject.id, workspaceId: view.selectedWorkspace.id };
      try { scope(location, true); return location; } catch { return null; }
    },
    async start({ startupToken, initialPrompt, location }) {
      let registered;
      try {
        if (!valid(startupToken) || typeof initialPrompt !== 'string' || !initialPrompt.trim()) throw new Error('Launch token and prompt are required');
        registered = scope(location, true);
        if (!storage || storage.getItem(key(startupToken)) !== null) throw new Error('Launch prompt storage unavailable or launch already recorded');
        const saved = { associationKey: startupToken, prompt: initialPrompt, location: registered };
        storage.setItem(key(startupToken), JSON.stringify(saved));
        if (storage.getItem(key(startupToken)) !== JSON.stringify(saved)) throw new Error('Launch prompt could not be persisted');
      } catch (error) { throw rejected(String(error)); }
      // From the first POST onward, even HTTP errors and invalid responses have unknown creation outcome.
      const result = session(await json('/api/machines/local/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: registered.cwd, startupToken }) }), registered.cwd);
      return identity(result.id, registered);
    },
    async findByStartupToken(startupToken, location) {
      if (!valid(startupToken)) throw new Error('Launch token is required');
      const registered = scope(location);
      const result = await json(`/api/machines/local/sessions/workstream-launch/${encodeURIComponent(startupToken)}?cwd=${encodeURIComponent(registered.cwd)}`);
      if (result?.status === 'unknown') return undefined;
      if (result?.status !== 'found' || !valid(result.sessionId) || result.cwd !== registered.cwd) throw new Error('Invalid launch lookup response');
      return identity(result.sessionId, registered);
    },
    async resolveSessionLocation({ machineId, sessionId }) {
      if (machineId !== 'local' || !valid(sessionId) || catalog.machineId !== 'local') throw new Error('Only registered local sessions can be resolved');
      const scopes = catalog.view.workspaces.map(w => ({ machineId: 'local', projectId: w.projectId, workspaceId: w.id, cwd: w.path })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      if (!scopes.length || scopes.some(w => !valid(w.projectId) || !valid(w.workspaceId) || !valid(w.cwd)) || new Set(scopes.map(w => JSON.stringify([w.projectId, w.workspaceId]))).size !== scopes.length) throw new Error('Invalid registered workspace catalog');
      const scans = await Promise.all(scopes.map(async location => {
        try {
          const list = await json(`/api/machines/local/sessions?cwd=${encodeURIComponent(location.cwd)}`);
          if (!Array.isArray(list)) throw new Error('Invalid session list');
          list.forEach(s => session(s, location.cwd));
          return { location, ids: list.map(s => s.id).sort() };
        } catch { return { location, failed: true }; }
      }));
      const failedScopes = scans.filter(s => s.failed).map(s => s.location);
      if (failedScopes.length) return { type: 'unavailable', failedScopes };
      const matches = scans.filter(s => s.ids.includes(sessionId));
      if (!matches.length) return { type: 'missing' };
      const bytes = new TextEncoder().encode(JSON.stringify([sessionId, scans]));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const evidenceId = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      const verifiedAt = new Date().toISOString();
      const locations = matches.map(({ location }) => ({ location: { machineId: 'local', projectId: location.projectId, workspaceId: location.workspaceId }, evidence: { evidenceId, matchedCwd: location.cwd, scannedScopeCount: scopes.length, verifiedAt } }));
      return locations.length === 1 ? { type: 'found', ...locations[0] } : { type: 'ambiguous', locations };
    },
    open: location => open(location),
  };
}
