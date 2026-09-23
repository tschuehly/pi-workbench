import { createChat } from './client.mjs';
const $ = id => document.getElementById(id);
const params = new URL(location.href).searchParams;
const messageText = message => typeof message.content === 'string' ? message.content : (message.content ?? []).map(part => part?.type === 'text' ? part.text : '').join('');
const chat = createChat({ fetch: (...args) => fetch(...args), socket: path => new WebSocket(new URL(path, location.href).href.replace(/^http/, 'ws')), changed: render });
const draftKey = `workbench:chat-proof:draft:${params.get('machine') ?? 'local'}:${params.get('id') ?? ''}:${params.get('cwd') ?? ''}`;
const draft = $('draft');
try { draft.value = sessionStorage.getItem(draftKey) ?? ''; } catch { /* Browser storage may be disabled. */ }
const saveDraft = () => { try { if (draft.value) sessionStorage.setItem(draftKey, draft.value); else sessionStorage.removeItem(draftKey); } catch { /* Editing still works without storage. */ } };
draft.addEventListener('input', saveDraft);
function render(view) {
  $('connection').textContent = `${view.id} · ${view.connection}`;
  $('error').textContent = view.error ?? '';
  $('earlier').hidden = !view.start;
  $('send').disabled = view.sending || view.connection !== 'connected';
  $('queue').hidden = !view.status?.isStreaming;
  $('stop').hidden = !view.status?.isStreaming;
  $('history').replaceChildren(...view.messages.map(message => {
    const item = document.createElement('article');
    item.textContent = `${message.role ?? 'message'}: ${messageText(message)}`;
    return item;
  }));
  $('partial').replaceChildren();
  if (view.partial) {
    const item = document.createElement('article');
    item.textContent = `assistant (streaming): ${messageText(view.partial)}`;
    $('partial').append(item);
  }
  const target = $('ask'); target.replaceChildren();
  if (view.pendingAsk) {
    const form = document.createElement('form');
    for (const question of view.pendingAsk.questions) {
      const label = document.createElement('fieldset');
      const legend = document.createElement('legend'); legend.textContent = question.question; label.append(legend);
      for (const option of question.options) {
        const choice = document.createElement('label');
        const input = document.createElement('input');
        input.type = question.multiple ? 'checkbox' : 'radio'; input.name = `choice-${question.id}`; input.value = option.value;
        choice.append(input, document.createTextNode(option.label)); label.append(choice);
      }
      const input = document.createElement('input'); input.name = `other-${question.id}`; input.type = 'text'; input.setAttribute('aria-label', `Other answer: ${question.question}`);
      label.append(input); form.append(label);
    }
    const button = document.createElement('button'); button.textContent = 'Answer'; form.append(button);
    form.onsubmit = event => { event.preventDefault(); void chat.answer(view.pendingAsk.questions.map(q => ({ id: q.id, values: [...form.querySelectorAll('input:checked')].filter(input => input.name === `choice-${q.id}`).map(input => input.value), otherText: form.elements.namedItem(`other-${q.id}`).value }))); };
    target.append(form);
  }
}
$('earlier').onclick = () => void chat.earlier();
$('stop').onclick = () => void chat.stopTurn();
async function submit(behavior) {
  const text = draft.value;
  if (!text.trim()) return;
  const accepted = await chat.send(text, behavior);
  if (accepted && draft.value === text) { draft.value = ''; saveDraft(); }
}
$('composer').onsubmit = event => { event.preventDefault(); void submit(); };
$('queue').onclick = () => void submit('followUp');
draft.onkeydown = event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!event.repeat) void submit();
};
try { chat.select(params.get('id'), params.get('cwd'), params.get('machine') ?? 'local'); }
catch (error) { $('error').textContent = String(error); }
