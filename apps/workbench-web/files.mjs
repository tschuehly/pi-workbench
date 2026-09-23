// Workspace-only text viewing/editing over PI WEB's bounded tree/file routes.
// Render text with textContent. No preview, symlink traversal, or blind overwrite.
const MAX_FILE = 512 * 1024, MAX_RESPONSE = 2 * 1024 * 1024;
const safePath = value => typeof value === 'string' && value.length <= 2048 && value.length > 0 && !value.startsWith('~') && !value.includes('\\') && !value.includes('\0') && !/^[a-z]:/i.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const fail = message => { throw new Error(message); };
async function json(response) {
  const reader = response.body?.getReader();
  if (!reader) fail('Response has no body');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_RESPONSE) fail('Response exceeds the Files limit');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('Invalid Files response'); }
  if (!response.ok) fail(`${response.status}: ${typeof data?.error === 'string' ? data.error.slice(0, 240) : 'Files request failed'}`);
  return data;
}
function tree(data, requested) {
  if (data?.path !== requested || !Array.isArray(data.entries) || data.entries.length > 1000 || typeof data.truncated !== 'boolean') fail('Invalid file tree');
  const entries = []; let skipped = 0;
  for (const entry of data.entries) {
    if (!entry || !['file', 'directory', 'symlink'].includes(entry.type) || typeof entry.path !== 'string' || typeof entry.name !== 'string'
      || entry.name.includes('/') || entry.path !== (requested ? `${requested}/` : '') + entry.name) fail('Invalid file tree entry');
    if (!safePath(entry.path) || !safePath(entry.name)) { skipped++; continue; }
    entries.push(entry);
  }
  return { ...data, entries, skipped };
}
async function file(data, requested) {
  if (data?.path !== requested || !Number.isSafeInteger(data.size) || data.size < 0 || typeof data.content !== 'string'
    || typeof data.binary !== 'boolean' || typeof data.truncated !== 'boolean'
    || data.encoding !== 'utf8' || data.content.length > MAX_FILE ||
    (data.version !== undefined && !/^[0-9a-f]{64}$/.test(data.version))) fail('Invalid file response');
  if (!data.binary && !data.truncated) {
    const bytes = new TextEncoder().encode(data.content);
    if (bytes.length > MAX_FILE) fail('File exceeds the editor limit');
    if (data.version) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      data.editable = bytes.length === data.size && [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') === data.version;
    }
  }
  return data;
}
export function createFiles({ fetch, changed, confirm }) {
  let scope, generation = 0, treeSeq = 0, readSeq = 0;
  const state = { entries: [], directories: {}, loaded: undefined, buffer: '', loading: false, saving: false, conflict: false, unknown: false, error: '', treeTruncated: false };
  const emit = () => changed({ ...state, directories: { ...state.directories }, dirty: !!state.loaded && state.buffer !== state.loaded.content, scope });
  const base = () => `/api/machines/local/projects/${encodeURIComponent(scope.projectId)}/workspaces/${encodeURIComponent(scope.id)}`;
  const request = async (url, options) => json(await fetch(url, options));
  async function list(path = '') {
    if (!scope || path && !safePath(path)) return;
    const current = generation, seq = ++treeSeq;
    try {
      const data = tree(await request(`${base()}/tree?path=${encodeURIComponent(path)}`), path);
      if (current !== generation || seq !== treeSeq) return;
      if (path) state.directories[path] = data.entries;
      else { state.entries = data.entries; state.treeTruncated = data.truncated; }
      if (data.truncated || data.skipped) state.error = `${data.truncated ? 'File list is incomplete; some entries are not shown. ' : ''}${data.skipped ? `Skipped ${data.skipped} file names this viewer cannot safely open.` : ''}`;
      else if (/^(File list is incomplete|Skipped )/.test(state.error)) state.error = '';
      emit();
    } catch (error) { if (current === generation && seq === treeSeq) { state.error = `Could not list files: ${String(error)}`; emit(); } }
  }
  function canLeave() {
    if (state.saving) return false;
    return !state.unknown && (!state.loaded || state.buffer === state.loaded.content) || confirm(state.unknown ? 'The save outcome is uncertain. Copy any edits you need first. Leave Files and discard this edit?' : 'Discard unsaved file edits?');
  }
  function select(next) {
    if (next && (!next.id || !next.projectId || next.machineId !== 'local')) throw new Error('Files require a registered local workspace');
    if (scope?.projectId === next?.projectId && scope?.id === next?.id && scope?.machineId === next?.machineId) return;
    scope = next; ++generation; ++treeSeq; ++readSeq;
    Object.assign(state, { entries: [], directories: {}, loaded: undefined, buffer: '', loading: false, saving: false, conflict: false, unknown: false, error: '', treeTruncated: false });
    emit(); if (scope) void list();
  }
  async function toggle(path) {
    if (!safePath(path) || !scope) return;
    if (state.directories[path]) { delete state.directories[path]; emit(); return; }
    if (Object.keys(state.directories).length >= 20) { state.error = 'Close a folder before opening more than 20 folders.'; emit(); return; }
    await list(path);
  }
  async function open(path, reload = false) {
    if (!safePath(path) || !scope || state.saving || !reload && state.loaded?.path === path || !canLeave()) return;
    state.unknown = false;
    const current = generation, seq = ++readSeq;
    state.loading = true; state.error = ''; emit();
    try {
      const data = await file(await request(`${base()}/file?path=${encodeURIComponent(path)}`), path);
      if (current !== generation || seq !== readSeq) return;
      state.loaded = data; state.buffer = data.content; state.conflict = false;
      if (data.binary || data.truncated || !data.editable) state.error = 'View only: binary, truncated, unversioned, or non-UTF-8 source cannot be edited safely.';
    } catch (error) { if (current === generation && seq === readSeq) state.error = `Could not open file: ${String(error)}`; }
    finally { if (current === generation && seq === readSeq) { state.loading = false; emit(); } }
  }
  function edit(text) {
    if (!state.loaded?.editable || state.saving || state.loading || state.unknown) return;
    state.buffer = text; state.error = ''; state.conflict = false; emit();
  }
  async function save() {
    const loaded = state.loaded;
    if (!scope || !loaded?.editable || state.saving || state.loading || state.unknown || state.buffer === loaded.content) return;
    const content = state.buffer, bytes = new TextEncoder().encode(content);
    if (bytes.length > MAX_FILE) { state.error = 'File exceeds the 512 KiB editor limit.'; emit(); return; }
    state.saving = true; state.error = ''; state.conflict = false; emit();
    const current = generation, path = loaded.path;
    const url = `${base()}/file?${new URLSearchParams({ path, expectedVersion: loaded.version, createDirs: 'false' })}`;
    let committed = false;
    try {
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: bytes });
      if (!response.ok) {
        await json(response); // A definite HTTP conflict permits re-review, never automatic overwrite.
        return;
      }
      const receipt = await json(response);
      if (receipt?.path !== path || receipt.created !== false) fail('Invalid save receipt');
      committed = true;
      const verified = await file(await request(`${base()}/file?path=${encodeURIComponent(path)}`), path);
      if (current !== generation) return;
      if (!verified.editable || verified.content !== content) fail('Saved, but the new file differs from the edit');
      state.loaded = verified; state.buffer = verified.content;
    } catch (error) {
      if (current !== generation) return;
      const conflict = !committed && /^Error: 409:/.test(String(error));
      state.conflict = conflict;
      // A missing response or failed verification may have committed. Keep edits;
      // don't allow another write with an unproven precondition.
      state.unknown = committed || !conflict && !/^Error: 4\d\d:/.test(String(error));
      state.error = `${conflict ? 'Conflict: file changed or was deleted.' : committed ? 'Saved, but verification failed.' : 'Save outcome uncertain or failed.'} Edits are preserved. ${String(error)}`;
    } finally { if (current === generation) { state.saving = false; emit(); } }
  }
  async function recheck() {
    if (!state.unknown || !scope || !state.loaded) return;
    const current = generation, path = state.loaded.path;
    try {
      const verified = await file(await request(`${base()}/file?path=${encodeURIComponent(path)}`), path);
      if (current !== generation) return;
      if (verified.editable && verified.content === state.buffer) {
        state.loaded = verified; state.unknown = false; state.error = 'The current file matches your edit. The loaded version is verified.';
      } else state.error = 'The current file differs from your edit. Copy edits before leaving; no further save is allowed until you reload.';
    } catch (error) { if (current === generation) state.error = `Could not verify file: ${String(error)}`; }
    if (current === generation) emit();
  }
  const unload = event => { if (!state.unknown && (!state.loaded || state.buffer === state.loaded.content)) return; event.preventDefault(); event.returnValue = ''; };
  emit();
  return { state, select, list, toggle, open, edit, save, recheck, canLeave, unload };
}
