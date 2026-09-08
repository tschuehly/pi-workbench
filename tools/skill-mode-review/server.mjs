#!/usr/bin/env node
// atelier kernel — serves an agent-authored Surface and hosts its durable interaction loop.
// Vendored from the atelier skill: copy into <project>/tools/, own it, extend it.
// Zero dependencies (node:http). Upgrade path: diff against the skill's assets/server.mjs.
//
//   node tools/review-server.mjs                          # serve + print URL
//   PORT=4747 UI=tools/my-surface.html STORE=2026-08-27 node tools/review-server.mjs
//
// The server is deliberately ignorant of content: it knows Region KEYS as opaque strings and
// nothing about the document tree. Identity, layout, and rendering belong to the Surface.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.ROOT || path.join(HERE, '..'));   // dir served statically
const PORT = Number(process.env.PORT || 4747);
const HOST = process.env.HOST || '127.0.0.1';
const UI   = path.resolve(process.env.UI || path.join(HERE, 'surface.html'));
const NAME = process.env.STORE || 'atelier';
const DATA_DIR = path.join(ROOT, '.review');                             // gitignore this
const STORE_FILE = path.join(DATA_DIR, `${NAME}.json`);
await fsp.mkdir(DATA_DIR, { recursive: true });

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
  '.svg':'image/svg+xml', '.gif':'image/gif', '.woff2':'font/woff2', '.woff':'font/woff', '.mp4':'video/mp4',
  '.webm':'video/webm', '.mp3':'audio/mpeg', '.ico':'image/x-icon', '.txt':'text/plain', '.md':'text/markdown' };

// ---- durable store ----
// Every address is ONE Region key (a path like "onboarding/provider"). There is no Card/Section split.
// { name, threads:{[region]:[{id,text,tags,sev,anchor?}]},          ← human drafts, client-owned
//   sent:{[commentId]:iso}, replies:{[commentId]:[{ts,msg,author}]}, commentState:{[commentId]:{value,ts}},
//   proposals:{[id]:{id,region,threadId,question,options,explanationRequests,explanations,status,choiceIndex,custom,ts,decidedAt}},
//   updates:{[id]:{id,region,title,body,ts,dismissedAt}},
//   changed:{[region]:{ts}},                                        ← named by Ready, cleared by ack
//   log:[{seq,kind,region,id,ts,...}], seq }
// Attention is NOT stored: the Surface derives it from changed/proposals/commentState/updates.
// Normal protocol actions preserve Threads. A Thread whose Region left the document stays in
// `threads`; the Surface shows it as archived.
function emptyStore(){ return { name:NAME, threads:{}, sent:{}, replies:{}, commentState:{},
  proposals:{}, updates:{}, changed:{}, log:[], seq:0 }; }
const COMMENT_STATES = ['open','acknowledged','in_progress','implemented','accepted','rejected'];
let store = emptyStore();
try { store = { ...emptyStore(), ...JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) }; } catch {}

let saveTimer = null;
function persist(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    // A failed write must stay visible but never take the server down with it: the human's open
    // Surface keeps working, and the next mutation retries.
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = STORE_FILE + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(store, null, 2));
      await fsp.rename(tmp, STORE_FILE);
    } catch (error){ console.error('store write failed:', error.message); }
  }, 60);
}
// Stopping the server must not cost the human the comment they just sent. The debounce is the
// reason a plain kill loses writes, so both stop signals flush it synchronously first.
function persistNow(){
  clearTimeout(saveTimer); saveTimer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive:true });
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_FILE);
  } catch (error){ console.error('store write failed:', error.message); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { persistNow(); process.exit(0); });
function appendLog(kind, region, id, extra){
  store.seq += 1;
  store.log.push({ seq: store.seq, kind, region: region||null, id: id||null, ts: new Date().toISOString(), ...extra });
  if (store.log.length > 5000) store.log = store.log.slice(-4000);
  notifyPollers();
}

// ---- long-poll ----
const pollers = new Set();
function notifyPollers(){
  for (const p of [...pollers]){
    const events = store.log.filter(e => e.seq > p.cursor);
    if (events.length){ clearTimeout(p.timer); pollers.delete(p); sendJSON(p.res, 200, { cursor: store.seq, events }); }
  }
}

// ---- helpers ----
const sendJSON = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(b), 'Cache-Control':'no-store' }); res.end(b); };
const readBody = (req) => new Promise((resolve) => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{resolve(JSON.parse(d||'{}'));}catch{resolve({});} }); });
const commentBody = (c) => { const { id, ...rest } = c; return rest; };
const findComment = (region, id) => (store.threads[region]||[]).find(c=>c.id===id);
const str = (v, max) => { const s = typeof v==='string' ? v.trim() : ''; return s.length && s.length<=max ? s : null; };

function resolveStatic(urlPath){
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const p = path.normalize(path.join(ROOT, clean));
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) return null;
  return p;
}

function serveStatic(req, res, filePath){
  fs.stat(filePath, (err, st) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    if (st.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.stat(filePath, (e2, st2) => {
      if (e2){ res.writeHead(404); res.end('not found'); return; }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      if (range && (type.startsWith('video') || type.startsWith('audio'))){
        const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
        const start = m[1] ? parseInt(m[1],10) : 0;
        const end = m[2] ? parseInt(m[2],10) : st2.size - 1;
        res.writeHead(206, { 'Content-Type':type, 'Content-Range':`bytes ${start}-${end}/${st2.size}`,
          'Accept-Ranges':'bytes', 'Content-Length': end-start+1, 'Cache-Control':'no-store' });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type':type, 'Content-Length':st2.size, 'Cache-Control':'no-store' });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {                        // one bad request must not end the session
    console.error('request failed:', req.method, req.url, error.message);
    if (!res.headersSent) sendJSON(res, 500, { ok:false, error:'internal error' });
    else res.end();
  });
});

async function handle(req, res){
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/state'){
    if (req.method === 'GET') return sendJSON(res, 200, store);
    if (req.method === 'POST'){                          // autosave drafts: client owns `threads`
      const body = await readBody(req);
      if (body && body.threads && typeof body.threads === 'object'){ store.threads = body.threads; persist(); }
      return sendJSON(res, 200, { ok:true });
    }
  }

  // ---- the agent's turn boundary -------------------------------------------------------
  // Ready is the ONLY thing that moves new content onto the human's screen. `changed` names the
  // Regions whose MEANING changed; it accumulates until the human acknowledges each one.
  if (p === '/api/ready' && req.method === 'POST'){      // { changed:[regionKey] }
    const { changed } = await readBody(req);
    if (!Array.isArray(changed)) return sendJSON(res, 400, { ok:false, error:'need changed[]' });
    const keys = [];
    for (const candidate of changed){
      const key = str(candidate, 300);
      if (!key) return sendJSON(res, 400, { ok:false, error:'each changed entry must be a bounded region key' });
      keys.push(key);
    }
    const ts = new Date().toISOString();
    for (const key of keys) store.changed[key] = { ts };
    appendLog('ready', null, null, { changed: keys });  // the Surface cannot validate keys server-side
    persist();                                          // (no region registry) — it warns on unknown keys
    return sendJSON(res, 200, { ok:true, changed: keys, cursor: store.seq });
  }

  if (p === '/api/ack' && req.method === 'POST'){        // { region } — human cleared the changed marker
    const { region } = await readBody(req);
    const key = str(region, 300);
    if (!key) return sendJSON(res, 400, { ok:false, error:'need region' });
    if (store.changed[key]){ delete store.changed[key]; appendLog('ack', key, null, {}); persist(); }
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  // ---- agent → human messages ----------------------------------------------------------
  // An Update needs no answer. Anything needing an answer is a Proposal. Whether an Update also
  // raises a desktop notification is the HUMAN's page preference, never the agent's choice.
  if (p === '/api/update' && req.method === 'POST'){     // { region, title, body? }
    const { region, title, body } = await readBody(req);
    const key = str(region, 300), head = str(title, 200);
    if (!key || !head) return sendJSON(res, 400, { ok:false, error:'need region and title' });
    const id = `upd-${++store.seq}`;
    store.updates[id] = { id, region:key, title:head, body: body==null ? '' : String(body).slice(0,2000),
      ts:new Date().toISOString(), dismissedAt:null };
    appendLog('update', key, id, { title:head }); persist();
    return sendJSON(res, 200, { ok:true, id, cursor: store.seq });
  }

  if (p === '/api/update-dismiss' && req.method === 'POST'){ // { id }
    const { id } = await readBody(req);
    const update = store.updates[String(id||'')];
    if (!update) return sendJSON(res, 404, { ok:false, error:'unknown update' });
    update.dismissedAt = new Date().toISOString();
    appendLog('update-dismissed', update.region, update.id, {}); persist();
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  // ---- Threads -------------------------------------------------------------------------
  if (p === '/api/send' && req.method === 'POST'){       // { region, id } — dispatch ONE comment
    const { region, id } = await readBody(req);
    const c = findComment(region, id);
    if (c){ store.sent[id] = new Date().toISOString();
      if (!store.commentState[id]) store.commentState[id] = { value:'open', ts:new Date().toISOString() };
      appendLog('sent', region, id, { comment: commentBody(c) });
      // Sending proves the human read this Region; let every open page observe the normal ack.
      if (store.changed[region]){ delete store.changed[region]; appendLog('ack', region, null, {}); }
      persist(); }
    return sendJSON(res, 200, { ok: !!c, cursor: store.seq });
  }

  if (p === '/api/reply' && req.method === 'POST'){      // { region, id, msg, state? } — agent reply
    const { region, id, msg, state } = await readBody(req);
    if (state==='rejected') return sendJSON(res, 400, { ok:false, error:'use /api/comment-reject with a non-empty msg' });
    (store.replies[id] ||= []).push({ ts:new Date().toISOString(), msg:String(msg||''), author:'agent' });
    appendLog('reply', region, id, { msg });
    if (state && COMMENT_STATES.includes(state)){ store.commentState[id] = { value:state, ts:new Date().toISOString() }; appendLog('comment-state', region, id, { state }); }
    persist();
    return sendJSON(res, 200, { ok:true });
  }

  if (p === '/api/comment-reject' && req.method === 'POST'){ // { region, id, msg } — atomic follow-up + rejection
    const { region, id, msg } = await readBody(req);
    const text = str(msg, 4000);
    if (!findComment(region, id) || !store.sent[id]) return sendJSON(res, 404, { ok:false, error:'unknown sent comment' });
    if (store.commentState[id]?.value!=='implemented') return sendJSON(res, 409, { ok:false, error:'only an implemented comment can be rejected' });
    if (!text) return sendJSON(res, 400, { ok:false, error:'need a rejection follow-up of at most 4000 characters' });
    const ts = new Date().toISOString();
    (store.replies[id] ||= []).push({ ts, msg:text, author:'human' });
    store.commentState[id] = { value:'rejected', ts };
    appendLog('comment-rejected', region, id, { state:'rejected', msg:text }); persist();
    return sendJSON(res, 200, { ok:true, state:'rejected', cursor: store.seq });
  }

  // open → acknowledged → in_progress → implemented (agent) → accepted (human, terminal).
  // Rejection uses /api/comment-reject so the follow-up and the wake event are atomic.
  if (p === '/api/comment-state' && req.method === 'POST'){ // { region, id, state }
    const { region, id, state } = await readBody(req);
    if (!COMMENT_STATES.includes(state)) return sendJSON(res, 400, { ok:false, error:'invalid state', allowed:COMMENT_STATES });
    if (state==='rejected') return sendJSON(res, 400, { ok:false, error:'use /api/comment-reject with a non-empty msg' });
    if (id){ store.commentState[id] = { value:state, ts:new Date().toISOString() }; appendLog('comment-state', region||null, id, { state }); persist(); }
    return sendJSON(res, 200, { ok: !!id, state, cursor: store.seq });
  }

  // ---- Proposals: every question the agent has takes this shape -------------------------
  if (p === '/api/propose' && req.method === 'POST'){    // { region, question, options[], threadId? }
    const { region, question, options, threadId } = await readBody(req);
    const key = str(region, 300), q = str(question, 2000);
    if (!key || !q || !Array.isArray(options) || !options.length)
      return sendJSON(res, 400, { ok:false, error:'need region, question, options[]' });
    const open = Object.values(store.proposals).find(pr => pr.status==='open'
      && (pr.region===key || (threadId && pr.threadId===threadId)));
    if (open) return sendJSON(res, 409, { ok:false, error:'resolve the existing open Proposal before asking another', proposalId:open.id });
    const id = `prop-${++store.seq}`;
    store.proposals[id] = { id, region:key, threadId:threadId||null, question:q, options,
      explanationRequests:{}, explanations:{}, status:'open', choiceIndex:null, custom:null,
      ts:new Date().toISOString(), decidedAt:null };
    appendLog('proposal', key, threadId||null, { proposalId:id }); persist();
    return sendJSON(res, 200, { ok:true, id });
  }

  if (p === '/api/decide' && req.method === 'POST'){     // { id, choiceIndex, custom }
    const { id, choiceIndex, custom } = await readBody(req);
    const pr = store.proposals[id];
    if (pr){
      pr.status='decided'; pr.choiceIndex = (choiceIndex===undefined?null:choiceIndex);
      pr.custom = custom||null; pr.decidedAt = new Date().toISOString();
      appendLog('decision', pr.region, pr.threadId, { proposalId:id, choiceIndex:pr.choiceIndex, custom:pr.custom });
      // A decision proves the human reviewed the Proposal's Region.
      if (store.changed[pr.region]){ delete store.changed[pr.region]; appendLog('ack', pr.region, null, {}); }
      persist();
    }
    return sendJSON(res, 200, { ok: !!pr, cursor: store.seq });
  }

  if (p === '/api/explain-request' && req.method === 'POST'){ // { id, optionIndex, answer }
    const { id, optionIndex, answer } = await readBody(req);
    const pr = store.proposals[id], text = str(answer, 2000);
    if (!pr || optionIndex===undefined || !text)
      return sendJSON(res, 400, { ok:false, error:'need proposal id, optionIndex, and answer' });
    const ts = new Date().toISOString();
    (pr.explanationRequests ||= {})[String(optionIndex)] = { status:'requested', answer:text, ts };
    appendLog('explain-request', pr.region, pr.threadId, { proposalId:id, optionIndex, answer:text }); persist();
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  if (p === '/api/explain' && req.method === 'POST'){    // { id, optionIndex, text } — agent answers
    const { id, optionIndex, text } = await readBody(req);
    const pr = store.proposals[id], body = str(text, 4000);
    if (!pr || optionIndex===undefined || !body)
      return sendJSON(res, 400, { ok:false, error:'need proposal id, optionIndex, and text' });
    const key = String(optionIndex), ts = new Date().toISOString();
    (pr.explanations ||= {})[key] = { text:body, ts };
    (pr.explanationRequests ||= {})[key] = { ...(pr.explanationRequests[key]||{}), status:'answered', ts };
    appendLog('explanation', pr.region, pr.threadId, { proposalId:id, optionIndex, text:body }); persist();
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  if (p === '/api/event' && req.method === 'POST'){      // { kind, region?, data?, wake? } — bespoke event
    const { kind, region, data, wake } = await readBody(req);
    const action = str(kind, 100), target = region==null ? null : str(region, 300);
    if (!action) return sendJSON(res, 400, { ok:false, error:'need a bounded event kind' });
    if (wake === true) appendLog('command', target, null, { action, data: data ?? null });
    else appendLog(action, target, null, data == null ? {} : { data });
    persist();
    return sendJSON(res, 200, { ok:true, kind: wake===true?'command':action, cursor: store.seq });
  }

  if (p === '/api/poll'){                                // long-poll: events with seq > cursor
    const cursor = Number(url.searchParams.get('cursor') || 0);
    const events = store.log.filter(e => e.seq > cursor);
    if (events.length) return sendJSON(res, 200, { cursor: store.seq, events });
    const poller = { res, cursor };
    poller.timer = setTimeout(()=>{ pollers.delete(poller); sendJSON(res, 200, { cursor, events: [] }); }, 25000);
    pollers.add(poller);
    req.on('close', ()=>{ clearTimeout(poller.timer); pollers.delete(poller); });
    return;
  }

  // ---- task endpoints (add yours here) ----

  // ---- static ----
  if (p === '/') return serveStatic(req, res, UI);
  if (p === '/atelier.mjs' || p === '/atelier.css') return serveStatic(req, res, path.join(HERE, p.slice(1)));
  const fp = resolveStatic(p);
  if (!fp){ res.writeHead(403); res.end('forbidden'); return; }
  serveStatic(req, res, fp);
}

server.listen(PORT, HOST, ()=>{
  console.log(`▶ Atelier  http://${HOST}:${PORT}/`);
  console.log(`  root:  ${ROOT}`);
  console.log(`  ui:    ${UI}`);
  console.log(`  store: ${STORE_FILE}`);
});
