import { createChat, imageAttachments } from './client.mjs';
import { createCatalog } from './catalog.mjs';
const $ = id => document.getElementById(id);
const params = new URL(location.href).searchParams;
const messageText = message => typeof message.content === 'string' ? message.content : (message.content ?? []).map(part => part?.type === 'text' ? part.text : '').join('');
const draft = $('draft');
let draftKey = null, images = [], imageEpoch = 0, nextImage = 1, imageBusy = false, chatView = null;
const storage = (() => { try { return sessionStorage; } catch { return undefined; } })();
const saveDraft = () => { if (!draftKey) return; try { if (draft.value) storage?.setItem(draftKey, draft.value); else storage?.removeItem(draftKey); } catch { /* Editing still works without storage. */ } };
draft.addEventListener('input', saveDraft);
const chat = createChat({ fetch: (...args) => fetch(...args), socket: path => new WebSocket(new URL(path, location.href).href.replace(/^http/, 'ws')), changed: renderChat });
const catalog = createCatalog({ fetch: (...args) => fetch(...args), storage, changed: renderCatalog });
const button = (label, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.onclick = action; return node; };
function imageControls() {
  $('image-input').disabled = !draftKey || imageBusy || chatView?.sending || chatView?.connection !== 'connected';
  $('send').disabled = imageBusy || chatView?.sending || chatView?.sendUnknown || chatView?.connection !== 'connected';
  $('queue').disabled = imageBusy || chatView?.sending || chatView?.sendUnknown || chatView?.connection !== 'connected';
  for (const remove of $('images').querySelectorAll('button')) remove.disabled = imageBusy || chatView?.sending;
}
function renderImages() {
  $('images').replaceChildren(...images.map(image => {
    const row = document.createElement('div'); row.textContent = `${image.reference} ${image.name} `;
    row.append(button('Remove', () => { images = images.filter(other => other !== image); row.remove(); imageControls(); }));
    return row;
  }));
  imageControls();
}
function resetImages() { imageEpoch++; images = []; nextImage = 1; imageBusy = false; $('image-error').textContent = ''; renderImages(); }
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Image read failed'));
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.includes(';base64,')) reject(new Error('Image read failed'));
      else resolve(reader.result.split(';base64,')[1]);
    };
    reader.readAsDataURL(file);
  });
}
$('image-input').onchange = async event => {
  const files = [...(event.target.files ?? [])], epoch = imageEpoch;
  event.target.value = '';
  if (!draftKey || imageBusy || !files.length) return;
  if (images.length + files.length > 16 || files.some(file => !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) || images.reduce((sum, image) => sum + image.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 * 1024 || files.some(file => !file.size)) {
    $('image-error').textContent = 'Only non-empty PNG, JPEG, GIF and WebP images are supported (16 images, 4 MiB total). Other files cannot be attached yet.'; return;
  }
  imageBusy = true; $('image-error').textContent = ''; imageControls();
  try {
    const added = await Promise.all(files.map(async (file, index) => ({ kind: 'image', name: file.name, mimeType: file.type, data: await readImage(file), size: file.size, reference: `[PIC_${nextImage + index}]` })));
    if (epoch !== imageEpoch) return;
    imageAttachments([...images, ...added]);
    images = [...images, ...added]; nextImage += added.length; renderImages();
  } catch (error) { if (epoch === imageEpoch) $('image-error').textContent = `Could not stage images: ${String(error)}`; }
  finally { if (epoch === imageEpoch) { imageBusy = false; imageControls(); } }
};

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
  chat.stop(); saveDraft(); draftKey = null; draft.value = ''; chatView = null; resetImages();
  $('connection').textContent = 'Choose a session'; $('error').textContent = '';
  for (const id of ['history', 'partial', 'queued', 'ask', 'dialogs']) $(id).replaceChildren();
  $('earlier').hidden = true; $('stop').hidden = true; $('queue').hidden = true; $('retry-send').hidden = true; $('send').disabled = true;
  for (const id of ['model', 'thinking']) { $(id).replaceChildren(); $(id).disabled = true; $(id).dataset.options = ''; }
}
function openSession(identity) {
  saveDraft(); resetImages();
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
  chatView = view;
  $('connection').textContent = `${view.id} · ${view.connection}`;
  $('error').textContent = view.error ?? '';
  $('earlier').hidden = !view.start;
  imageControls();
  $('queue').hidden = !view.status?.isStreaming && !view.status?.isCompacting;
  $('retry-send').hidden = !view.sendUnknown;
  $('stop').hidden = !view.status?.isStreaming;
  $('send').textContent = view.status?.isStreaming && !view.status?.isCompacting ? 'Steer' : 'Send';
  const choices = [
    { id: 'model', options: view.models.map(m => [JSON.stringify([m.provider, m.id]), `${m.provider}/${m.name || m.id}`]), value: JSON.stringify([view.status?.model?.provider, view.status?.model?.id]), empty: 'No available models' },
    { id: 'thinking', options: view.thinkingLevels.map(level => [level, level]), value: view.status?.thinkingLevel, empty: 'No thinking levels' },
  ];
  for (const choice of choices) {
    const select = $(choice.id), signature = JSON.stringify([view.controlsLoading, choice.options]);
    if (select.dataset.options !== signature) {
      select.replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = view.controlsLoading ? 'Loading…' : choice.empty; select.append(placeholder);
      for (const [value, label] of choice.options) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
      select.dataset.options = signature;
    }
    select.value = choice.options.some(([value]) => value === choice.value) ? choice.value : '';
    select.disabled = view.controlsLoading || view.controlBusy || view.connection !== 'connected' || !choice.options.length;
  }
  $('history').replaceChildren(...view.messages.map(message => {
    const item = document.createElement('article'); item.textContent = `${message.role ?? 'message'}: ${messageText(message)}`; return item;
  }));
  $('partial').replaceChildren();
  if (view.partial) { const item = document.createElement('article'); item.textContent = `assistant (streaming): ${messageText(view.partial)}`; $('partial').append(item); }
  const queue = $('queued'); queue.replaceChildren();
  const queued = view.status?.queuedMessages ?? [];
  if (queued.length || view.status?.pendingMessageCount) {
    const heading = document.createElement('h2'); heading.textContent = `Queued messages (${view.status?.pendingMessageCount ?? queued.length})`; queue.append(heading);
    for (const [index, message] of queued.entries()) {
      const row = document.createElement('article'); row.textContent = `${message.kind === 'steer' ? 'Steer' : 'Follow-up'} ${index + 1}: ${message.text}`;
      if (message.kind === 'followUp') { const promote = button('Send now', () => void chat.promoteQueued(message)); promote.disabled = view.queueBusy || view.status?.isCompacting; row.append(promote); }
      queue.append(row);
    }
    if (queued.some(message => message.kind === 'followUp')) { const all = button('Send all now', () => void chat.promoteAll()); all.disabled = view.queueBusy || view.status?.isCompacting; queue.append(all); }
    const clear = button('Clear queue', () => { if (window.confirm('Remove all queued messages? Active work will continue.')) void chat.clearQueue(); }); clear.disabled = view.queueBusy; queue.append(clear);
  }
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
  const dialogs = $('dialogs'), pending = view.pendingDialogs?.[0];
  if (!pending) { dialogs.replaceChildren(); dialogs.dataset.dialogId = ''; }
  else {
    if (dialogs.dataset.dialogId !== pending.dialogId) {
      const form = document.createElement('form'); form.dataset.dialogId = pending.dialogId;
      const heading = document.createElement('h2'); heading.textContent = pending.title; form.append(heading);
      if (pending.message) { const detail = document.createElement('p'); detail.textContent = pending.message; form.append(detail); }
      if (pending.kind === 'select') {
        const label = document.createElement('label'); label.textContent = 'Choose '; const select = document.createElement('select'); select.name = 'answer'; select.setAttribute('aria-label', pending.title);
        for (const option of pending.options) { const entry = document.createElement('option'); entry.value = option; entry.textContent = option; select.append(entry); }
        label.append(select); form.append(label);
      } else if (pending.kind === 'input') {
        const label = document.createElement('label'); label.textContent = 'Answer '; const input = document.createElement('input'); input.name = 'answer'; input.type = 'text'; input.maxLength = 4000; input.placeholder = pending.placeholder ?? ''; input.setAttribute('aria-label', pending.title); label.append(input); form.append(label);
      }
      if (pending.kind === 'confirm') {
        form.append(button('Yes', () => void chat.answerDialog(pending.dialogId, true)), button('No', () => void chat.answerDialog(pending.dialogId, false)));
      } else { const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Answer'; form.append(submit); }
      form.append(button('Cancel dialog', () => void chat.cancelDialog(pending.dialogId)));
      form.onsubmit = event => { event.preventDefault(); if (pending.kind !== 'confirm') void chat.answerDialog(pending.dialogId, form.elements.namedItem('answer').value); };
      dialogs.replaceChildren(form); dialogs.dataset.dialogId = pending.dialogId;
    }
    for (const control of dialogs.querySelectorAll('button, input, select')) control.disabled = view.dialogBusy || view.connection !== 'connected';
    let remaining = dialogs.querySelector('small'); if (view.pendingDialogs.length > 1) {
      if (!remaining) { remaining = document.createElement('small'); dialogs.append(remaining); }
      remaining.textContent = `${view.pendingDialogs.length - 1} more extension ${view.pendingDialogs.length === 2 ? 'dialog' : 'dialogs'} waiting`;
    } else remaining?.remove();
  }
}
$('model').onchange = event => { if (event.target.value) void chat.changeModel(JSON.parse(event.target.value)); };
$('thinking').onchange = event => { if (event.target.value) void chat.changeThinking(event.target.value); };
$('earlier').onclick = () => void chat.earlier();
$('stop').onclick = () => void chat.stopTurn();
$('retry-send').onclick = () => { if (window.confirm('First check the transcript or session status: this prompt may have been accepted. Allow another send?')) chat.acknowledgeSendUnknown(); };
async function submit(behavior) {
  const text = draft.value, key = draftKey, epoch = imageEpoch, attachments = images.map(({ kind, name, mimeType, data, reference }) => ({ kind, name, mimeType, data, reference }));
  if ((!text.trim() && !attachments.length) || !key || imageBusy) return;
  const accepted = await chat.send(text, behavior, attachments);
  if (accepted && draftKey === key && draft.value === text && imageEpoch === epoch) { draft.value = ''; saveDraft(); resetImages(); }
}
$('composer').onsubmit = event => { event.preventDefault(); void submit(); };
$('queue').onclick = () => void submit('followUp');
draft.onkeydown = event => { if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return; event.preventDefault(); if (!event.repeat) void submit(); };
clearChat();
void catalog.load(params.get('machine') ?? 'local', {
  projectId: params.get('project') ?? undefined, workspaceId: params.get('workspace') ?? undefined,
  sessionId: params.get('id') ?? undefined, cwd: params.get('cwd') ?? undefined,
}).then(identity => { if (identity) openSession(identity); });
