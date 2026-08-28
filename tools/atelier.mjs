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
const emit = () => listeners.forEach(fn => fn());

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
// An unsent draft is local to this browser: keeping it out of the shared store means a store
// update arriving mid-sentence can never overwrite what the human is typing.
const DRAFT = 'atelier:draft:';

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
      <div class="atl-compose">
        <textarea class="atl-input" rows="2" placeholder="Comment on this Region…"></textarea>
        <button class="atl-send" type="button">Send</button>
      </div>`;
    this.list = this.querySelector('.atl-list');
    this.input = this.querySelector('.atl-input');
    try { this.input.value = localStorage.getItem(DRAFT + region) || ''; } catch {}
    this.input.addEventListener('input', () => { try { localStorage.setItem(DRAFT + region, this.input.value); } catch {} });
    this.querySelector('.atl-send').addEventListener('click', () => this.send());
    this.unsub = subscribe(()=>this.renderList());
    this.renderList();
  }
  disconnectedCallback(){ this.unsub?.(); }
  renderList(){
    this.list.innerHTML = threadOf(this.region).map(c => commentHtml(this.region, c)).join('');
    wireVerdicts(this.list, this.region);
  }
  async send(){
    const text = this.input.value.trim(); if (!text) return;
    const comment = { id: uid(), text, queued:false };
    threadOf(this.region).push(comment);
    await saveNow();                                     // durable before dispatch, never the reverse
    await post('/api/send', { region:this.region, id:comment.id });
    this.input.value = '';
    try { localStorage.removeItem(DRAFT + this.region); } catch {}
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
       <button class="atl-btn" data-reject="${esc(c.id)}">Reject…</button></div>` : '';
  return `<div class="atl-comment ${sent?'atl-comment--sent':''}" data-comment="${esc(c.id)}">
    ${c.anchor?.quote ? `<div class="atl-quote">${esc(c.anchor.quote)}</div>` : ''}
    <div class="atl-text">${esc(c.text)}</div>
    ${state ? `<div class="atl-state">${esc(CSTATE[state]||state)}</div>` : ''}
    ${replies}${verdict}</div>`;
}

function wireVerdicts(root, region){
  root.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
    await post('/api/comment-state', { region, id:b.dataset.accept, state:'accepted' }); await refresh();
  }));
  root.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
    const msg = prompt('What is still wrong?');            // a rejection without a reason wastes the next turn
    if (!msg?.trim()) return;
    await post('/api/comment-reject', { region, id:b.dataset.reject, msg }); await refresh();
  }));
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
    const key = this.target;
    const list = Object.values(S.proposals)
      .filter(pr => pr.region === key && pr.status !== 'superseded')
      .sort((a,b) => a.ts < b.ts ? -1 : 1);
    this.innerHTML = list.map(proposalHtml).join('');
    this.wire();
  }
  wire(){
    this.querySelectorAll('[data-choose]').forEach(b => b.addEventListener('click', async () => {
      const [id, index] = b.dataset.choose.split('|');
      await post('/api/decide', { id, choiceIndex:Number(index) });
      await refresh();
    }));
    this.querySelectorAll('[data-why]').forEach(b => b.addEventListener('click', async () => {
      const [id, index] = b.dataset.why.split('|');
      const question = prompt('What do you want explained about this option?');
      if (!question?.trim()) return;
      await post('/api/explain-request', { id, optionIndex:Number(index), answer:question });
      await refresh();
    }));
    this.querySelectorAll('[data-custom]').forEach(form => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const custom = input.value.trim(); if (!custom) return;
      await post('/api/decide', { id: form.dataset.custom, custom });
      await refresh();
    }));
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
    return `<div class="atl-option">
      <button class="atl-btn" data-choose="${esc(pr.id)}|${index}">${esc(label)}</button>
      <button class="atl-icon" data-why="${esc(pr.id)}|${index}" aria-label="Ask about this option" title="Ask about this option">?</button>
      ${aside}</div>`;
  }).join('');
  return `<div class="atl-proposal" data-proposal="${esc(pr.id)}">
    <div class="atl-proposal__q">${esc(pr.question)}</div>
    <div class="atl-options">${options}</div>
    <form class="atl-custom" data-custom="${esc(pr.id)}">
      <input class="atl-input" placeholder="…or answer in your own words">
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
      ? items.map(a => `<button class="atl-cockpit__row" data-goto="${esc(a.region)}">
          <span class="atl-badge ${a.kind==='changed'?'atl-badge--changed':''}">${esc(a.kind)}</span>
          <span class="atl-cockpit__label">${esc(a.label)}</span>
          <span class="atl-cockpit__region">${esc(a.region)}</span></button>`).join('')
      : `<div class="atl-state">Nothing waiting.</div>`;
    this.list.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => reveal(b.dataset.goto)));
  }
}
customElements.define('atelier-cockpit', AtelierCockpit);

// Jumping to a Region has to say which one it landed on, or a long Surface leaves the human
// hunting for what just scrolled into view.
export function reveal(key){
  const el = findRegion(key);
  if (!el) return false;
  el.scrollIntoView({ behavior:'smooth', block:'start' });
  el.classList.add('atl-flash');
  setTimeout(()=>el.classList.remove('atl-flash'), 1200);
  return true;
}

// ===== desktop notifications =========================================================
// One switch for the whole Surface, and only two things ring it: an Update and a Ready. Anything
// else would train the human to ignore it.
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
  bar.querySelector('.atl-comment-btn').addEventListener('click', () => {
    if (placement === 'sheet') openSheet(el.regionKey, el.label);
    else el._thread?.querySelector('.atl-input')?.focus();
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
// One shared bottom panel for the whole Surface. It overlays the lower viewport instead of
// reflowing the document, so the content above keeps scrolling normally.
let sheet = null;
function openSheet(region, label){
  if (!sheet){
    sheet = document.createElement('div');
    sheet.className = 'atl-sheet';
    document.body.append(sheet);
  }
  sheet.innerHTML = `<div class="atl-sheet__head"><b></b><button class="atl-icon" data-close aria-label="Close">✕</button></div>`;
  sheet.querySelector('b').textContent = label;
  const mount = document.createElement('atelier-comments');
  mount.setAttribute('for', region);
  sheet.append(mount);
  sheet.querySelector('[data-close]').addEventListener('click', ()=>{ sheet.remove(); sheet = null; });
  sheet.classList.add('atl-sheet--open');
  mount.querySelector('.atl-input')?.focus();
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

  for (const key of named){
    const current = findRegion(key), next = incoming.get(key);
    if (!current || !next) continue;
    current.replaceWith(document.importNode(next, true));
  }
  mountAll();
  emit();
  warn(unknown.length ? `Ready named ${unknown.length} Region(s) this Surface does not contain: ${unknown.join(', ')}` : '');
  document.dispatchEvent(new CustomEvent('atelier:ready', { detail:{ changed:named, unknown } }));
}

// The server keeps no Region registry, so a mistyped key in a Ready can only be caught here.
function warn(message){
  let bar = document.querySelector('.atl-warn');
  if (!message){ bar?.remove(); return; }
  if (!bar){ bar = document.createElement('div'); bar.className = 'atl-warn'; document.body.prepend(bar); }
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
