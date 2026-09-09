// atelier kernel — light-DOM custom elements over one durable store.
//
// The agent authors the document; this file supplies identity, durable state and behavior.
// Nothing here renders content or imposes layout. All chrome is scoped under .atl-* so a content
// library (daisyUI/Tailwind) can never restyle it by tag, and the kernel never restyles the agent.
//
//   <script type="module" src="/atelier.mjs"></script>
//   <atelier-region key="onboarding">
//     <atelier-region key="provider" comments="side"> …agent HTML… </atelier-region>
//   </atelier-region>
//
// A Region's identity is the path of local keys from the root: "onboarding/provider".

// ===== store =========================================================================
// Server-owned state. `threads` is the only client-owned slice (drafts autosave back).
export const S = { threads:{}, sent:{}, replies:{}, commentState:{}, proposals:{}, updates:{},
  changed:{}, log:[], seq:0 };
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (focused = captureInteractionFocus()) => {
  listeners.forEach(fn => fn());
  if (focused) focusInteraction(focused);
};

const post = async (path, body) => {
  const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body||{}) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `${path} failed`);
  return j;
};
async function pull(){
  const r = await fetch('/api/state');
  Object.assign(S, await r.json());
}
const saveNow = () => post('/api/state', { threads:S.threads });
// Human drafts are local to this browser: keeping them out of the shared store means a store
// update arriving mid-sentence can never overwrite what the human is typing.
const DRAFT = 'atelier:draft:';
const draftGet = (key) => { try { return localStorage.getItem(DRAFT + key); } catch { return null; } };
const draftSet = (key, value) => { try { localStorage.setItem(DRAFT + key, value); } catch {} };
const draftClear = (key) => { try { localStorage.removeItem(DRAFT + key); localStorage.removeItem(DRAFT + key + ':open'); } catch {} };
function clearDrafts(prefix){
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(DRAFT + prefix)) localStorage.removeItem(key); } catch {}
}
function captureEditor(root){
  const input = document.activeElement;
  return input instanceof HTMLTextAreaElement && root.contains(input) && input.dataset.draft
    ? { key:input.dataset.draft, start:input.selectionStart, end:input.selectionEnd } : null;
}
function wireEditors(root, active){
  root.querySelectorAll('form[data-editor]').forEach(form => { form.hidden = draftGet(form.dataset.editor + ':open') !== 'open'; });
  root.querySelectorAll('textarea[data-draft]').forEach(input => {
    const saved = draftGet(input.dataset.draft); if (saved !== null) input.value = saved;
    input.addEventListener('input', () => draftSet(input.dataset.draft, input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.metaKey){ event.preventDefault(); input.form?.requestSubmit(); }
    });
  });
  if (active){
    const input = [...root.querySelectorAll('textarea[data-draft]')].find(el => el.dataset.draft === active.key);
    if (input && !input.closest('[hidden]')){ input.focus(); input.setSelectionRange(active.start, active.end); }
  }
}
function openEditor(form){
  form.hidden = false; draftSet(form.dataset.editor + ':open', 'open'); form.querySelector('textarea')?.focus();
}
function closeEditor(form){
  const key = form.dataset.editor; draftClear(key); form.hidden = true;
}

// ===== derived attention =============================================================
// Attention is never stored. Each item points at a Region and belongs to exactly one side:
// `owner:'human'` means it is waiting on you, `owner:'agent'` means it is waiting on the agent.
export function attention(){
  const items = [];
  for (const [region, meta] of Object.entries(S.changed))
    items.push({ kind:'changed', region, id:region, owner:'human', label:'Changed', ts:meta.ts });
  for (const u of Object.values(S.updates)) if (!u.dismissedAt)
    items.push({ kind:'update', region:u.region, id:u.id, owner:'human', label:u.title, ts:u.ts });
  for (const pr of Object.values(S.proposals)){
    if (pr.status === 'open') items.push({ kind:'decision', region:pr.region, id:pr.id, owner:'human', label:pr.question, ts:pr.ts });
    for (const [index, req] of Object.entries(pr.explanationRequests||{}))
      if (req.status === 'requested')
        items.push({ kind:'explanation', region:pr.region, id:`${pr.id}:${index}`, owner:'agent', label:pr.options[index]||'Option', ts:req.ts });
  }
  for (const [region, thread] of Object.entries(S.threads)) for (const c of thread){
    const value = S.commentState[c.id]?.value;
    if (!value) continue;
    if (value === 'implemented') items.push({ kind:'verdict', region, id:c.id, owner:'human', label:c.text||'Comment', ts:S.commentState[c.id].ts });
    else if (value === 'rejected') items.push({ kind:'rework', region, id:c.id, owner:'agent', label:c.text||'Comment', ts:S.commentState[c.id].ts });
    else if (['open','acknowledged','in_progress'].includes(value))
      items.push({ kind:'request', region, id:c.id, owner:'agent', label:c.text||'Comment', ts:S.commentState[c.id].ts });
  }
  return items;
}
const attentionFor = (region, owner) => attention().filter(a => a.region === region && (!owner || a.owner === owner));

// ===== regions =======================================================================
const regionEls = () => [...document.querySelectorAll('atelier-region')];
const regionKeys = () => new Set(regionEls().map(el => el.regionKey));
function regionPath(el){
  const parts = [];
  for (let node = el; node; node = node.parentElement?.closest('atelier-region')){
    parts.unshift((node.getAttribute('key')||'').trim() || 'unnamed');
    if (!node.parentElement) break;
  }
  return parts.join('/');
}
export const findRegion = (key) => regionEls().find(el => el.regionKey === key) || null;
const esc = (s) => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uid = () => 'c-' + Math.random().toString(36).slice(2, 10);

class AtelierRegion extends HTMLElement {
  connectedCallback(){
    // Identity only. Chrome is mounted after the document parses, so appended nodes can never
    // land in the middle of content the parser has not reached yet.
    this.regionKey = regionPath(this);
    this.setAttribute('data-review-region', '');
    this.setAttribute('data-region-key', this.regionKey);
  }
  get placement(){ return this.getAttribute('comments') || 'below'; }
  get label(){ return this.getAttribute('label') || this.querySelector('h1,h2,h3,h4')?.textContent?.trim() || this.regionKey; }
}
customElements.define('atelier-region', AtelierRegion);

// ===== attention marker ==============================================================
// Placeable anywhere: inside prose, in a heading, in a nav, beside a diagram.
//   <atelier-attention/>                       marker for the Region it sits in
//   <atelier-attention for="a/b" mode="count"/> counter for another Region and its descendants
class AtelierAttention extends HTMLElement {
  connectedCallback(){
    // Capture slotted text ONCE: rendering replaces this element's own children, so reading it
    // later would return whatever the last render wrote (or nothing at all).
    this.slotted ??= this.textContent.trim();
    this.unsub = subscribe(()=>this.render());
    this.render();
  }
  disconnectedCallback(){ this.unsub?.(); }
  get target(){ return this.getAttribute('for') || this.closest('atelier-region')?.regionKey || ''; }
  render(){
    const key = this.target, owner = this.getAttribute('owner') || '';
    const mode = this.getAttribute('mode') || 'badge';
    // count rolls up descendants: every Region key under this path
    const items = mode === 'count'
      ? attention().filter(a => (a.region === key || a.region.startsWith(key + '/')) && (!owner || a.owner === owner))
      : attentionFor(key, owner);
    // A count is a readout the agent placed in a sentence, so it prints zero rather than vanishing
    // and leaving a dangling label. Every other mode is a marker: no marker means nothing waiting.
    if (mode === 'count'){
      this.innerHTML = `<span class="atl-badge${items.length ? '' : ' atl-badge--zero'}">${items.length}</span>`;
      return;
    }
    if (!items.length){ this.innerHTML = ''; return; }
    const changed = items.some(a => a.kind === 'changed');
    if (mode === 'dot'){ this.innerHTML = `<span class="atl-dot" title="${esc(items.length)} open"></span>`; return; }
    if (mode === 'label'){ this.innerHTML = `<span class="atl-badge">${esc(this.slotted || items[0].label)}</span>`; return; }
    // One marker per Region, showing the most urgent kind plus how many others wait behind it —
    // a Region can carry a changed marker, an open Proposal and a verdict at the same time.
    const lead = changed ? 'CHANGED' : items[0].kind.toUpperCase();
    const rest = items.length > 1 ? `<span class="atl-badge">+${items.length-1}</span>` : '';
    this.innerHTML = `<span class="atl-badge ${changed?'atl-badge--changed':''}" title="${esc(items.map(a=>a.kind).join(', '))}">${lead}</span>${rest}` +
      (changed ? `<button class="atl-icon" data-ack aria-label="Mark as reviewed" title="Mark as reviewed">✓</button>` : '');
    this.querySelector('[data-ack]')?.addEventListener('click', () => ack(key));
  }
}
customElements.define('atelier-attention', AtelierAttention);

export async function ack(region){ await post('/api/ack', { region }); await refresh(); }

// ===== threads =======================================================================
// Placement is the agent's call, and the test is whether the human must see the comment and its
// context at the same time: `below` (default), `side` (gutter beside the content), `sheet`
// (fixed bottom panel; the document keeps scrolling normally).
const threadOf = (region) => (S.threads[region] ||= []);

class AtelierComments extends HTMLElement {
  connectedCallback(){
    const region = this.region = this.getAttribute('for') || this.closest('atelier-region')?.regionKey || '';
    this.className = 'atl-thread';
    // Structure is built once; only the comment list re-renders, so the textarea keeps its value,
    // its focus and the caret while the agent's replies stream in.
    this.innerHTML = `<div class="atl-list"></div>
      <form class="atl-compose">
        <textarea class="atl-input" data-draft="${esc(region)}" rows="2" aria-label="Comment on this Region" placeholder="Comment on this Region…"></textarea>
        <button class="atl-send" type="submit">Send</button>
      </form>`;
    this.list = this.querySelector('.atl-list');
    this.input = this.querySelector('.atl-input');
    wireEditors(this);
    this.querySelector('.atl-compose').addEventListener('submit', event => { event.preventDefault(); this.send(); });
    this.unsub = subscribe(()=>this.renderList());
    this.renderList();
  }
  disconnectedCallback(){ this.unsub?.(); }
  renderList(){
    const active = captureEditor(this.list);
    this.list.innerHTML = threadOf(this.region).map(c => commentHtml(this.region, c)).join('');
    wireVerdicts(this.list, this.region, active);
  }
  async send(){
    const text = this.input.value.trim(); if (!text) return;
    const comment = { id: uid(), text };
    threadOf(this.region).push(comment);
    await saveNow();                                     // durable before dispatch, never the reverse
    await post('/api/send', { region:this.region, id:comment.id });
    this.input.value = '';
    draftClear(this.region);
    await refresh();
  }
}
customElements.define('atelier-comments', AtelierComments);

const CSTATE = { open:'Open', acknowledged:'Acknowledged', in_progress:'In progress',
  implemented:'Implemented · your call', accepted:'Accepted', rejected:'Rejected · rework' };

function commentHtml(region, c){
  const sent = !!S.sent[c.id], state = S.commentState[c.id]?.value;
  const replies = (S.replies[c.id]||[]).map(r =>
    `<div class="atl-reply atl-reply--${esc(r.author)}"><b>${r.author==='agent'?'Agent':'You'}</b>${esc(r.msg)}</div>`).join('');
  const verdict = state === 'implemented'
    ? `<div class="atl-verdict"><button class="atl-btn" data-accept="${esc(c.id)}">Accept</button>
       <button class="atl-btn" data-reject-open="${esc(c.id)}">Reject…</button></div>
       <form class="atl-followup" data-editor="reject:${esc(c.id)}" data-reject="${esc(c.id)}" hidden>
         <textarea class="atl-input" data-draft="reject:${esc(c.id)}" rows="2" aria-label="Reason for rejection" placeholder="What is still wrong?"></textarea>
         <button class="atl-send" type="submit">Send changes</button>
         <button class="atl-btn" type="button" data-cancel-editor>Cancel</button>
       </form>` : '';
  return `<div class="atl-comment ${sent?'atl-comment--sent':''}" data-comment="${esc(c.id)}">
    ${c.anchor?.quote ? `<div class="atl-quote">${esc(c.anchor.quote)}</div>` : ''}
    <div class="atl-text">${esc(c.text)}</div>
    ${state ? `<div class="atl-state">${esc(CSTATE[state]||state)}</div>` : ''}
    ${replies}${verdict}</div>`;
}

function wireVerdicts(root, region, active){
  wireEditors(root, active);
  root.querySelectorAll('[data-accept]').forEach(button => button.addEventListener('click', async () => {
    await post('/api/comment-state', { region, id:button.dataset.accept, state:'accepted' }); await refresh();
  }));
  root.querySelectorAll('[data-reject-open]').forEach(button => button.addEventListener('click', () => {
    openEditor(button.closest('.atl-comment').querySelector('form[data-reject]'));
  }));
  root.querySelectorAll('form[data-reject]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const msg = form.querySelector('textarea').value.trim(); if (!msg) return;
    await post('/api/comment-reject', { region, id:form.dataset.reject, msg });
    draftClear(form.dataset.editor); await refresh();
  }));
  root.querySelectorAll('[data-cancel-editor]').forEach(button => button.addEventListener('click', () => closeEditor(button.closest('form'))));
}

// ===== proposals =====================================================================
// A question with named options. This is how the agent asks instead of blocking on chat: the
// question sits in the Region it is about, so the human answers with the evidence in front of them.
class AtelierProposal extends HTMLElement {
  connectedCallback(){
    this.className = 'atl-proposals';
    this.unsub = subscribe(()=>this.render());
    this.render();
  }
  disconnectedCallback(){ this.unsub?.(); }
  get target(){ return this.getAttribute('for') || this.closest('atelier-region')?.regionKey || ''; }
  render(){
    const active = captureEditor(this), key = this.target;
    const list = Object.values(S.proposals)
      .filter(pr => pr.region === key && pr.status !== 'superseded')
      .sort((a,b) => a.ts < b.ts ? -1 : 1);
    this.innerHTML = list.map(proposalHtml).join('');
    this.wire(active);
  }
  wire(active){
    wireEditors(this, active);
    this.querySelectorAll('[data-choose]').forEach(button => button.addEventListener('click', async () => {
      const [id, index] = button.dataset.choose.split('|');
      await post('/api/decide', { id, choiceIndex:Number(index) });
      clearDrafts(`proposal:${id}:`); await refresh();
    }));
    this.querySelectorAll('[data-why]').forEach(button => button.addEventListener('click', () => {
      const [id, index] = button.dataset.why.split('|');
      openEditor([...this.querySelectorAll('form[data-explain]')]
        .find(form => form.dataset.explain === `${id}|${index}`));
    }));
    this.querySelectorAll('form[data-explain]').forEach(form => form.addEventListener('submit', async event => {
      event.preventDefault();
      const [id, index] = form.dataset.explain.split('|'), question = form.querySelector('textarea').value.trim();
      if (!question) return;
      await post('/api/explain-request', { id, optionIndex:Number(index), answer:question });
      draftClear(form.dataset.editor); await refresh();
    }));
    this.querySelectorAll('[data-custom]').forEach(form => form.addEventListener('submit', async event => {
      event.preventDefault();
      const custom = form.querySelector('textarea').value.trim(); if (!custom) return;
      await post('/api/decide', { id:form.dataset.custom, custom });
      clearDrafts(`proposal:${form.dataset.custom}:`); await refresh();
    }));
    this.querySelectorAll('[data-cancel-editor]').forEach(button => button.addEventListener('click', () => closeEditor(button.closest('form'))));
  }
}
customElements.define('atelier-proposal', AtelierProposal);

function proposalHtml(pr){
  if (pr.status === 'decided'){
    const chosen = pr.custom || pr.options[pr.choiceIndex] || 'decided';
    return `<div class="atl-proposal atl-proposal--decided" data-proposal="${esc(pr.id)}">
      <div class="atl-proposal__q">${esc(pr.question)}</div>
      <div class="atl-state">Decided · ${esc(chosen)}</div></div>`;
  }
  const options = pr.options.map((label, index) => {
    const req = pr.explanationRequests?.[index], answer = pr.explanations?.[index];
    // An option the human asked about carries the exchange with it, so the reason for the choice
    // stays attached to the choice.
    const aside = answer ? `<div class="atl-explain">${esc(answer.text)}</div>`
      : req?.status === 'requested' ? `<div class="atl-explain atl-explain--waiting">Asked: ${esc(req.answer)}</div>` : '';
    const draft = `proposal:${pr.id}:why:${index}`;
    return `<div class="atl-option">
      <button class="atl-btn" data-choose="${esc(pr.id)}|${index}">${esc(label)}</button>
      <button class="atl-icon" data-why="${esc(pr.id)}|${index}" aria-label="Ask about this option" title="Ask about this option">?</button>
      <form class="atl-followup" data-editor="${esc(draft)}" data-explain="${esc(pr.id)}|${index}" hidden>
        <textarea class="atl-input" data-draft="${esc(draft)}" rows="2" aria-label="Question about this option" placeholder="What do you want explained?"></textarea>
        <button class="atl-send" type="submit">Ask agent</button>
        <button class="atl-btn" type="button" data-cancel-editor>Cancel</button>
      </form>
      ${aside}</div>`;
  }).join('');
  return `<div class="atl-proposal" data-proposal="${esc(pr.id)}">
    <div class="atl-proposal__q">${esc(pr.question)}</div>
    <div class="atl-options">${options}</div>
    <form class="atl-custom" data-custom="${esc(pr.id)}">
      <textarea class="atl-input" data-draft="proposal:${esc(pr.id)}:custom" rows="2" aria-label="Answer in your own words" placeholder="…or answer in your own words"></textarea>
      <button class="atl-send" type="submit">Answer</button>
    </form></div>`;
}

// ===== updates =======================================================================
// A durable agent message. Unlike a toast it survives reload, and unlike a chat line it is
// attached to the Region it is about and stays until the human dismisses it.
class AtelierUpdate extends HTMLElement {
  connectedCallback(){
    this.className = 'atl-updates';
    this.unsub = subscribe(()=>this.render());
    this.render();
  }
  disconnectedCallback(){ this.unsub?.(); }
  get target(){ return this.getAttribute('for') || this.closest('atelier-region')?.regionKey || ''; }
  render(){
    const key = this.target;
    const list = Object.values(S.updates).filter(u => u.region === key && !u.dismissedAt);
    this.innerHTML = list.map(u => `<div class="atl-update" data-update="${esc(u.id)}">
      <div class="atl-update__body"><b>${esc(u.title)}</b>${u.body ? `<span>${esc(u.body)}</span>` : ''}</div>
      <button class="atl-icon" data-dismiss="${esc(u.id)}" aria-label="Dismiss">✕</button></div>`).join('');
    this.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', async () => {
      await post('/api/update-dismiss', { id:b.dataset.dismiss });
      await refresh();
    }));
  }
}
customElements.define('atelier-update', AtelierUpdate);

// ===== desktop notifications =========================================================
// One switch for the whole Surface, and only two things ring it: an Update and a Ready. Anything
// else would train the human to ignore it. Define this before Cockpit upgrades call notifyOn().
const NOTIFY = 'atelier:notify';
const notifyOn = () => { try { return localStorage.getItem(NOTIFY) === 'on' && Notification?.permission === 'granted'; } catch { return false; } };
async function toggleNotifications(){
  try {
    if (notifyOn()){ localStorage.setItem(NOTIFY, 'off'); return; }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    localStorage.setItem(NOTIFY, permission === 'granted' ? 'on' : 'off');
  } catch {}
}
function notify(title, body){
  if (!notifyOn()) return;
  try { new Notification(title, { body, tag:'atelier' }); } catch {}
}

// ===== cockpit =======================================================================
// The whole Surface's open loops in one list, split by whose turn it is. Placed by the agent
// (sidebar, header, wherever), never auto-mounted — a Surface with one Region does not need one.
class AtelierCockpit extends HTMLElement {
  connectedCallback(){
    this.className = 'atl-cockpit';
    this.filter = this.getAttribute('owner') || 'human';
    this.innerHTML = `<div class="atl-cockpit__head">
        <div class="atl-cockpit__filters">
          <button class="atl-btn" data-filter="human">You</button>
          <button class="atl-btn" data-filter="agent">Agent</button>
          <button class="atl-btn" data-filter="">All</button>
        </div>
        <button class="atl-btn" data-notify></button>
      </div><div class="atl-cockpit__list"></div>`;
    this.list = this.querySelector('.atl-cockpit__list');
    this.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
      this.filter = b.dataset.filter; this.render();
    }));
    this.querySelector('[data-notify]').addEventListener('click', () => toggleNotifications().then(()=>this.render()));
    this.unsub = subscribe(()=>this.render());
    this.render();
  }
  disconnectedCallback(){ this.unsub?.(); }
  render(){
    const items = attention().filter(a => !this.filter || a.owner === this.filter);
    this.querySelectorAll('[data-filter]').forEach(b =>
      b.classList.toggle('atl-btn--on', b.dataset.filter === this.filter));
    const toggle = this.querySelector('[data-notify]');
    toggle.textContent = notifyOn() ? '🔔 Desktop on' : '🔕 Desktop off';
    toggle.classList.toggle('atl-btn--on', notifyOn());
    this.list.innerHTML = items.length
      ? items.map(a => `<button class="atl-cockpit__row" data-goto="${esc(a.region)}" data-kind="${esc(a.kind)}" data-interaction-id="${esc(a.id)}">
          <span class="atl-badge ${a.kind==='changed'?'atl-badge--changed':''}">${esc(a.kind)}</span>
          <span class="atl-cockpit__label">${esc(a.label)}</span>
          <span class="atl-cockpit__region">${esc(a.region)}</span></button>`).join('')
      : `<div class="atl-state">Nothing waiting.</div>`;
    this.list.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => reveal({
      region:button.dataset.goto, kind:button.dataset.kind, id:button.dataset.interactionId,
    })));
  }
}
customElements.define('atelier-cockpit', AtelierCockpit);

// Dynamic Surfaces own filtering, selection and Region creation. Registering one resolver lets
// them do that work before the kernel mounts chrome and locates the exact interaction.
let revealResolver = null;
export function setRevealResolver(resolver){ revealResolver = typeof resolver === 'function' ? resolver : null; }
const THREAD_ATTENTION = new Set(['request', 'verdict', 'rework']);
const exact = (root, attribute, id) => [...root.querySelectorAll(`[${attribute}]`)]
  .find(el => el.getAttribute(attribute) === String(id)) || null;
function interactionElements(region, item){
  if (!item.kind) return { host:region, control:region };
  let host = null, control = null;
  if (item.kind === 'changed'){
    host = region.querySelector(':scope > .atl-bar atelier-attention');
    control = host?.querySelector('[data-ack]');
  } else if (item.kind === 'update'){
    host = exact(region, 'data-update', item.id);
    control = host?.querySelector('[data-dismiss]');
  } else if (item.kind === 'decision'){
    host = exact(region, 'data-proposal', item.id);
    control = host?.querySelector('[data-choose]');
  } else if (item.kind === 'explanation'){
    const split = String(item.id).lastIndexOf(':'), id = String(item.id).slice(0, split), index = Number(String(item.id).slice(split + 1));
    const proposal = exact(region, 'data-proposal', id);
    host = proposal?.querySelectorAll('.atl-option')[index] || null;
    control = host;
  } else if (THREAD_ATTENTION.has(item.kind)){
    const comments = item.comments?.isConnected ? item.comments.querySelectorAll('[data-comment]') : document.querySelectorAll('[data-comment]');
    host = [...comments].find(el =>
      el.dataset.comment === String(item.id) && el.closest('atelier-comments')?.region === region.regionKey) || null;
    control = item.kind === 'verdict' ? host?.querySelector('[data-accept]') : host;
  }
  return { host, control };
}
function focusControl(control){
  const temporary = !control.matches('button, input, textarea, select, a, [tabindex]');
  if (temporary){
    control.tabIndex = -1;
    control.addEventListener('blur', () => control.removeAttribute('tabindex'), { once:true });
  }
  control.focus({ preventScroll:true });
  if (document.activeElement === control) return true;
  if (temporary) control.removeAttribute('tabindex');
  return false;
}
function focusInteraction(item){
  if (item.cockpit?.isConnected){
    const row = [...item.cockpit.querySelectorAll('.atl-cockpit__row')].find(el =>
      el.dataset.goto === item.region && el.dataset.kind === item.kind && el.dataset.interactionId === String(item.id));
    if (row){ row.focus({ preventScroll:true }); return true; }
  }
  const region = findRegion(item.region);
  if (!region) return false;
  const { control } = interactionElements(region, item);
  if (!control) return false;
  return focusControl(control);
}
function captureInteractionFocus(){
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const row = active.closest('.atl-cockpit__row');
  if (row) return { cockpit:row.closest('atelier-cockpit'), region:row.dataset.goto, kind:row.dataset.kind, id:row.dataset.interactionId };
  const comments = active.closest('atelier-comments'), region = comments?.region || active.closest('atelier-region')?.regionKey;
  if (!region) return null;
  const update = active.closest('[data-update]');
  if (update) return { region, kind:'update', id:update.dataset.update };
  const proposal = active.closest('[data-proposal]');
  if (proposal && active.matches('.atl-option')){
    const options = [...proposal.querySelectorAll('.atl-option')], index = options.indexOf(active);
    return { region, kind:'explanation', id:`${proposal.dataset.proposal}:${index}` };
  }
  if (proposal && active.matches('[data-choose]')) return { region, kind:'decision', id:proposal.dataset.proposal };
  const comment = active.closest('[data-comment]');
  if (comment && (active === comment || active.matches('[data-accept]'))){
    const value = S.commentState[comment.dataset.comment]?.value;
    const kind = value === 'implemented' ? 'verdict' : value === 'rejected' ? 'rework'
      : ['open','acknowledged','in_progress'].includes(value) ? 'request' : null;
    return kind ? { region, kind, id:comment.dataset.comment, comments } : null;
  }
  if (active.matches('[data-ack]')) return { region, kind:'changed', id:region };
  return null;
}
function revealFailure(item, error){
  const reason = error ? `: ${error.message || error}` : '';
  warn(`Could not reveal ${item.kind || 'Region'} ${item.id || item.region || ''} in ${item.region || 'this Surface'}${reason}`, 'reveal');
  return false;
}
function finishReveal(item){
  mountAll();
  const region = findRegion(item.region);
  if (!region) return revealFailure(item);
  if (THREAD_ATTENTION.has(item.kind) && region.placement === 'sheet' &&
      sheet?.querySelector('atelier-comments')?.region !== region.regionKey)
    openSheet(region.regionKey, region.label, region.querySelector(':scope > .atl-bar .atl-comment-btn'));
  const { host, control } = interactionElements(region, item);
  if (!host || !control || !host.getClientRects().length || !control.getClientRects().length) return revealFailure(item);
  host.scrollIntoView({ behavior:'smooth', block:'center' });
  host.classList.add('atl-flash');
  setTimeout(()=>host.classList.remove('atl-flash'), 1200);
  if (!focusControl(control)) return revealFailure(item);
  warn('', 'reveal');
  return true;
}
export function reveal(region, interaction = {}){
  const item = region && typeof region === 'object' ? region : { ...interaction, region };
  if (!item.region) return revealFailure(item);
  let pending;
  try { pending = revealResolver?.(item); }
  catch (error){ return revealFailure(item, error); }
  return pending?.then ? pending.then(() => finishReveal(item)).catch(error => revealFailure(item, error)) : finishReveal(item);
}

// ===== chrome mounting ===============================================================
// One pass after parse (and after every swap): give each Region its marker, comment affordance and
// thread mount, without disturbing the agent's own markup.
function mountRegion(el){
  if (el._mounted) return;
  el._mounted = true;
  const bar = document.createElement('div');
  bar.className = 'atl-bar';
  bar.innerHTML = `<atelier-attention></atelier-attention>
    <button class="atl-icon atl-comment-btn" aria-label="Comment on ${esc(el.label)}" title="Comment on ${esc(el.label)}">
      <span aria-hidden="true">💬</span><span class="atl-count"></span></button>`;
  el.prepend(bar);

  // An agent message must never be invisible: every Region hosts its own Updates and Proposals
  // above the content, and both render nothing at all when there is nothing pending.
  const updates = document.createElement('atelier-update');
  const proposals = document.createElement('atelier-proposal');
  updates.setAttribute('for', el.regionKey);
  proposals.setAttribute('for', el.regionKey);
  bar.after(updates, proposals);

  const placement = el.placement;
  el.classList.add('atl-region', `atl-region--${placement}`);
  if (placement !== 'sheet'){
    const mount = document.createElement('atelier-comments');
    mount.setAttribute('for', el.regionKey);
    el.append(mount);
    el._thread = mount;
  }
  bar.querySelector('.atl-comment-btn').addEventListener('click', event => {
    if (placement === 'sheet') openSheet(el.regionKey, el.label, event.currentTarget);
    else el._thread?.querySelector('.atl-compose .atl-input')?.focus();
  });
}
function mountAll(){
  regionEls().forEach(mountRegion);
  renderCounts();
}
function renderCounts(){
  for (const el of regionEls()){
    const n = threadOf(el.regionKey).filter(c => S.sent[c.id]).length;
    const badge = el.querySelector(':scope > .atl-bar .atl-count');
    if (badge) badge.textContent = n ? String(n) : '';
  }
}

// ===== sheet =========================================================================
// One shared bottom panel for the whole Surface. A matching spacer keeps the page's last content
// scrollable above it and follows textarea resizing.
let sheet = null, sheetSpace = null, sheetOpener = null, sheetObserver = null;
const sizeSheetSpace = () => { if (sheet && sheetSpace) sheetSpace.style.height = `${sheet.offsetHeight}px`; };
function closeSheet(){
  if (!sheet) return;
  sheetObserver?.disconnect(); sheetObserver = null;
  sheet.remove(); sheetSpace?.remove(); sheet = sheetSpace = null;
  document.removeEventListener('keydown', onSheetKeydown);
  const opener = sheetOpener; sheetOpener = null; if (opener?.isConnected) opener.focus();
}
function onSheetKeydown(event){
  if (event.key === 'Escape' && sheet){ event.preventDefault(); closeSheet(); }
}
function openSheet(region, label, opener){
  sheetOpener = opener;
  if (!sheet){
    sheetSpace = document.createElement('div'); sheetSpace.className = 'atl-sheet-space';
    sheet = document.createElement('div'); sheet.className = 'atl-sheet';
    document.body.append(sheetSpace, sheet);
    sheetObserver = new ResizeObserver(sizeSheetSpace); sheetObserver.observe(sheet);
    document.addEventListener('keydown', onSheetKeydown);
  }
  sheet.innerHTML = `<div class="atl-sheet__head"><b></b><button class="atl-icon" data-close aria-label="Close">✕</button></div>`;
  sheet.querySelector('b').textContent = label;
  const mount = document.createElement('atelier-comments');
  mount.setAttribute('for', region); sheet.append(mount);
  sheet.querySelector('[data-close]').addEventListener('click', closeSheet);
  requestAnimationFrame(sizeSheetSpace);
  mount.querySelector('.atl-compose .atl-input')?.focus();
}

// ===== live loop =====================================================================
export async function refresh(){ await pull(); emit(); renderCounts(); }

let pollCursor = 0;
async function pollLoop(){
  for (;;){
    try {
      const r = await fetch('/api/poll?cursor=' + encodeURIComponent(pollCursor));
      const j = await r.json();
      pollCursor = j.cursor || pollCursor;
      if (j.events?.length){
        await refresh();
        for (const e of j.events){
          if (e.kind === 'ready') onReady(e);
          if (e.kind === 'update') notify(e.title || 'Update', e.region || '');
        }
        const ready = j.events.filter(e => e.kind === 'ready').pop();
        if (ready) notify('Ready to review', `${(ready.changed||[]).length} Region(s) changed`);
      }
      document.documentElement.removeAttribute('data-atl-offline');
    } catch {
      document.documentElement.setAttribute('data-atl-offline', '');
      await new Promise(res => setTimeout(res, 3000));
      // A long-poll answers only when something happens, so waiting for one to succeed would leave
      // a recovered Surface looking dead for up to 25 seconds. Probe with a cheap read instead, and
      // leave the cursor alone so the next poll still delivers whatever was missed while offline.
      try { await refresh(); document.documentElement.removeAttribute('data-atl-offline'); } catch {}
    }
  }
}

// Ready is the agent's turn boundary and the ONLY trigger that changes what is on screen.
// Only the named Regions are replaced: everything else keeps its scroll position, and Threads are
// separate elements whose content comes from the store, so nothing in flight is lost.
async function onReady(event){
  const named = event.changed || [];
  if (!named.length) return;
  let doc;
  try {
    const r = await fetch(location.pathname, { cache:'no-store' });
    doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  } catch { return; }

  const incoming = new Map([...doc.querySelectorAll('atelier-region')].map(el => [regionPath(el), el]));
  const unknown = named.filter(key => !incoming.has(key));
  // A named Region that exists in the new document but not in the open page is a structural
  // change, not a content change: reload rather than guess where it belongs.
  const added = named.filter(key => incoming.has(key) && !findRegion(key));
  if (added.length) return location.reload();

  const focused = captureInteractionFocus();
  for (const key of named){
    const current = findRegion(key), next = incoming.get(key);
    if (!current || !next) continue;
    current.replaceWith(document.importNode(next, true));
  }
  mountAll();
  emit(focused);
  warn(unknown.length ? `Ready named ${unknown.length} Region(s) this Surface does not contain: ${unknown.join(', ')}` : '');
  document.dispatchEvent(new CustomEvent('atelier:ready', { detail:{ changed:named, unknown } }));
}

// The server keeps no Region registry, so a mistyped key in a Ready can only be caught here.
function warn(message, kind = 'ready'){
  let stack = document.querySelector('.atl-warnings');
  let bar = stack?.querySelector(`.atl-warn[data-warning="${kind}"]`);
  if (!message){ bar?.remove(); if (stack && !stack.children.length) stack.remove(); return; }
  if (!stack){ stack = document.createElement('div'); stack.className = 'atl-warnings'; document.body.prepend(stack); }
  if (!bar){
    bar = document.createElement('div'); bar.className = 'atl-warn';
    bar.dataset.warning = kind; bar.setAttribute('role', 'alert'); stack.append(bar);
  }
  bar.textContent = message;
}

async function boot(){
  await pull();
  mountAll();
  emit();
  pollCursor = S.seq;                                 // start live: history is already in the state
  pollLoop();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
