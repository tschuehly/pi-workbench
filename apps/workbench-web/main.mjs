import { createChat } from './client.mjs';
import { createCatalog } from './catalog.mjs';
const $ = id => document.getElementById(id);
const params = new URL(location.href).searchParams;
const messageText = message => typeof message.content === 'string' ? message.content : (message.content ?? []).map(part => part?.type === 'text' ? part.text : '').join('');
const draft = $('draft');
let draftKey = null;
const storage = (() => { try { return sessionStorage; } catch { return undefined; } })();
const saveDraft = () => { if (!draftKey) return; try { if (draft.value) storage?.setItem(draftKey, draft.value); else storage?.removeItem(draftKey); } catch { /* Editing still works without storage. */ } };
draft.addEventListener('input', saveDraft);
const chat = createChat({ fetch: (...args) => fetch(...args), socket: path => new WebSocket(new URL(path, location.href).href.replace(/^http/, 'ws')), changed: renderChat });
const catalog = createCatalog({ fetch: (...args) => fetch(...args), storage, changed: renderCatalog });
const button = (label, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.onclick = action; return node; };

function renderCatalog(view) {
  const host = $('catalog'); host.replaceChildren();
  $('catalog-error').textContent = view.error ?? (view.creationUnknown ? 'Creation outcome unknown. Refresh the list and check for a new session before trying again.' : '');
  if (view.loading && !view.selectedWorkspace) host.append(document.createTextNode('Loading workspaces…'));
  for (const project of view.projects) {
    const tab = button(project.name, () => void chooseWorkspace(project.id, view.workspaces.find(w => w.projectId === project.id)?.id));
    if (project.id === view.selectedProject?.id) tab.setAttribute('aria-current', 'true');
    host.append(tab);
  }
  if (!view.selectedWorkspace) return;
  const label = document.createElement('label'); label.textContent = 'Workspace ';
  const picker = document.createElement('select'); picker.setAttribute('aria-label', 'Workspace');
  for (const w of view.workspaces.filter(w => w.projectId === view.selectedProject.id)) {
    const option = document.createElement('option'); option.value = w.id; option.textContent = `${w.label} · ${w.path}`; picker.append(option);
  }
  picker.value = view.selectedWorkspace.id;
  picker.onchange = () => void chooseWorkspace(view.selectedProject.id, picker.value);
  label.append(picker); host.append(label);
  const list = document.createElement('ul');
  for (const s of view.sessions) {
    const row = document.createElement('li');
    const item = button(s.name || s.firstMessage || s.id, () => openSession(catalog.select(s.id)));
    if (s.id === view.selectedSession?.id) item.setAttribute('aria-current', 'page');
    row.append(item); list.append(row);
  }
  host.append(list);
  const create = button(view.creating ? 'Creating…' : 'New Chat', () => void startSession());
  create.disabled = view.loading || view.creating || view.creationUnknown; host.append(create);
  host.append(button('Refresh sessions', () => void catalog.refresh()));
  if (view.creationUnknown) host.append(button('I verified no new session exists; allow another attempt', () => {
    if (window.confirm('Check the refreshed session list and any other windows first. The prior request may still create a session. Unlock another attempt?')) catalog.acknowledgeUnknown();
  }));
}
function clearChat() {
  chat.stop(); saveDraft(); draftKey = null; draft.value = '';
  $('connection').textContent = 'Choose a session'; $('error').textContent = '';
  for (const id of ['history', 'partial', 'ask']) $(id).replaceChildren();
  $('earlier').hidden = true; $('stop').hidden = true; $('queue').hidden = true; $('send').disabled = true;
}
function openSession(identity) {
  saveDraft();
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ machine: identity.machineId, project: identity.projectId, workspace: identity.workspaceId, cwd: identity.cwd, id: identity.sessionId })) url.searchParams.set(key, value);
  history.replaceState(null, '', url);
  draftKey = `workbench:chat-proof:draft:${JSON.stringify([identity.machineId, identity.projectId, identity.workspaceId, identity.sessionId])}`;
  try { draft.value = storage?.getItem(draftKey) ?? ''; } catch { draft.value = ''; }
  chat.select(identity.sessionId, identity.cwd, identity.machineId);
}
async function chooseWorkspace(projectId, workspaceId) {
  if (!workspaceId) return;
  clearChat();
  const url = new URL(location.href);
  for (const key of ['id', 'cwd', 'project', 'workspace']) url.searchParams.delete(key);
  history.replaceState(null, '', url);
  await catalog.choose(projectId, workspaceId);
}
async function startSession() { const identity = await catalog.create(); if (identity) openSession(identity); }
function renderChat(view) {
  $('connection').textContent = `${view.id} · ${view.connection}`;
  $('error').textContent = view.error ?? '';
  $('earlier').hidden = !view.start;
  $('send').disabled = view.sending || view.connection !== 'connected';
  $('queue').hidden = !view.status?.isStreaming;
  $('stop').hidden = !view.status?.isStreaming;
  $('history').replaceChildren(...view.messages.map(message => {
    const item = document.createElement('article'); item.textContent = `${message.role ?? 'message'}: ${messageText(message)}`; return item;
  }));
  $('partial').replaceChildren();
  if (view.partial) { const item = document.createElement('article'); item.textContent = `assistant (streaming): ${messageText(view.partial)}`; $('partial').append(item); }
  const target = $('ask'); target.replaceChildren();
  if (view.pendingAsk) {
    const form = document.createElement('form');
    for (const question of view.pendingAsk.questions) {
      const label = document.createElement('fieldset');
      const legend = document.createElement('legend'); legend.textContent = question.question; label.append(legend);
      for (const option of question.options) {
        const choice = document.createElement('label'); const input = document.createElement('input');
        input.type = question.multiple ? 'checkbox' : 'radio'; input.name = `choice-${question.id}`; input.value = option.value;
        choice.append(input, document.createTextNode(option.label)); label.append(choice);
      }
      const input = document.createElement('input'); input.name = `other-${question.id}`; input.type = 'text'; input.setAttribute('aria-label', `Other answer: ${question.question}`);
      label.append(input); form.append(label);
    }
    const submit = document.createElement('button'); submit.textContent = 'Answer'; form.append(submit);
    form.onsubmit = event => { event.preventDefault(); void chat.answer(view.pendingAsk.questions.map(q => ({ id: q.id, values: [...form.querySelectorAll('input:checked')].filter(input => input.name === `choice-${q.id}`).map(input => input.value), otherText: form.elements.namedItem(`other-${q.id}`).value }))); };
    target.append(form);
  }
}
$('earlier').onclick = () => void chat.earlier();
$('stop').onclick = () => void chat.stopTurn();
async function submit(behavior) {
  const text = draft.value, key = draftKey;
  if (!text.trim() || !key) return;
  const accepted = await chat.send(text, behavior);
  if (accepted && draftKey === key && draft.value === text) { draft.value = ''; saveDraft(); }
}
$('composer').onsubmit = event => { event.preventDefault(); void submit(); };
$('queue').onclick = () => void submit('followUp');
draft.onkeydown = event => { if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return; event.preventDefault(); if (!event.repeat) void submit(); };
clearChat();
void catalog.load(params.get('machine') ?? 'local', {
  projectId: params.get('project') ?? undefined, workspaceId: params.get('workspace') ?? undefined,
  sessionId: params.get('id') ?? undefined, cwd: params.get('cwd') ?? undefined,
}).then(identity => { if (identity) openSession(identity); });
