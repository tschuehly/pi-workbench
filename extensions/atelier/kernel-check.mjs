// Real-browser check of the Kernel's human controls (decision 155). Needs agent-browser and PI_TMP:
//   node extensions/atelier/kernel-check.mjs [screenshot.png]
// Serves a light Page through the real host and drives it with real pointer and keyboard input.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appendLog, createHost, readLog } from "./index.ts";

const run = promisify(execFile), session = `atelier-kernel-${process.pid}`;
assert(process.env.PI_TMP, "Set PI_TMP to a disposable directory.");
const dir = await realpath(await mkdtemp(path.join(process.env.PI_TMP, "atelier-kernel-")));
const page = path.join(dir, "page.html");
// flip: the source opens #more and closes #less, as the human did; body: attributes on <body>.
const write = ({ plain = "A plain keyed paragraph.", dock = "", phrase = "Pick this phrase to comment on it.", flip = false, body = "", more = "" } = {}) => writeFile(page, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Kernel check</title>
<style>body{font:15px/1.5 system-ui;max-width:700px;margin:24px auto;background:#fff;color:#111}section,div[atl-key],p[atl-key]{border:1px solid #ccc;padding:8px;margin:8px 0}</style>
<body${body}>${dock}<p id="intro">Select this sentence to comment on the text itself.</p>
<p atl-key="plain" id="plain">${plain}</p>
<section atl-key="run" atl-ver="v1" id="run"><h2>Run</h2>
<div atl-key="turn-1" id="t1" atl-decide="1|2|3|4|5">Turn one answer text.</div>
<div atl-key="turn-2" id="t2" atl-decide="Confirm|Redo" atl-rec="Confirm" atl-note="Redo">Turn two answer.</div></section>
<details id="more"${flip ? " open" : ""}><summary id="more-s">More</summary><p>Inside.</p></details><details id="less"${flip ? "" : " open"}><summary id="less-s">Less</summary><p>Open by the Page.</p></details>
<p atl-key="quiet" id="quiet">Plain text with nothing focusable.</p>
<table><tr atl-key="row-a" id="ra" atl-decide="Keep|Drop"><td>Row A</td><td atl-slot id="slot"></td></tr></table>${more}
<section atl-key="long" id="long"><p id="phrase">${phrase}</p>${"<p>Filler below the phrase.</p>".repeat(40)}</section>
<script>window.states=[];document.addEventListener("atelier:state",(e)=>states.push(e.detail));</script>
<script type="module" src="atelier.js"></script></body></html>`);
await write();
const sent = [];
const host = createHost({ root: dir, undoMs: 3000, watchdogMs: 600_000, send: (m, done) => { sent.push(m.content); done(true); } });
const b = async (...args) => { const { stdout } = await run("agent-browser", ["--session", session, "--json", ...args], { timeout: 60_000 }); const r = JSON.parse(stdout); assert(r.success, JSON.stringify(r)); return r.data; };
const js = async (code) => (await b("eval", code)).result;
const until = (code) => b("wait", "--fn", code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decides = () => readLog(page).filter((e) => e.type === "decide");
const box = async (sel) => js(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right}})()`);
const opacity = (key) => js(`getComputedStyle(document.querySelector('[atl-ui=pin][data-key="${key}"] .atl-add')).opacity`);
const buttons = () => js("[...document.querySelectorAll('[data-atl=comment]')].map((b)=>b.dataset.key)");
const at = (x, y) => b("mouse", "move", String(Math.round(x)), String(Math.round(y)));
const click = async (sel) => { const r = await box(sel); await at(r.x + r.w / 2, r.y + r.h / 2); await b("mouse", "down"); await b("mouse", "up"); };

try {
  const { url } = await host.open(page);
  await b("set", "media", "dark"); // the OS is dark; the Page is light, so the Kernel must stay light
  await b("open", url);
  await until("document.querySelector('.atl-conn')?.textContent==='live'");

  assert.equal(await js("document.querySelector('.atl-test')"), null, "a Pi session's host shows no test mark");
  // Palette follows the Page, not the OS.
  assert.equal(await js("getComputedStyle(document.querySelector('[atl-ui=panel]')).backgroundColor"), "rgb(255, 255, 255)", "light panel on a light Page under a dark OS");
  // Comment button: no layout space, hidden until hover, innermost Key only, at the top-right corner.
  const withUi = (await box("#plain")).h;
  const without = await js("(()=>{const n=[...document.querySelectorAll('#plain>[atl-ui]')];n.forEach(x=>x.remove());const h=document.querySelector('#plain').getBoundingClientRect().height;n.forEach(x=>document.querySelector('#plain').append(x));return h})()");
  assert.equal(withUi, without, "Kernel UI on a Key without threads takes no layout space");
  // k-buttons: no Comment button per Key; the hovered or focused Key gets one, a Key with threads keeps its count.
  assert.deepEqual(await buttons(), [], "no Comment buttons before hover");
  await b("hover", "#t1"); await sleep(300);
  assert.deepEqual([await buttons(), await opacity("run/turn-1")], [["run/turn-1"], "1"], "only the innermost hovered Key has a button");
  const [t1, pin] = [await box("#t1"), await box('[atl-ui=pin][data-key="run/turn-1"] .atl-add')];
  assert(Math.abs(t1.right - pin.right) <= 8 && Math.abs(t1.y - pin.y) <= 8, `at the top-right corner: ${JSON.stringify({ t1, pin })}`);
  await b("hover", "#slot"); await sleep(300);
  assert.deepEqual(await buttons(), ["row-a"], "a Decision slot's button is its row's");
  assert.equal(await js("document.querySelector('#slot [atl-ui=decide]')!==null"), true, "row options render in its atl-slot cell");
  assert.match(await js("document.querySelector('.atl-bar').textContent"), /3 to answer/, "Page-declared Decisions count");

  // A Key's Comment opens as a box floating right beside its button, outside <body>, and the Page never scrolls
  // (owner 2026-10-19: "Comment on q1-overview" jumped far down a long Key). Esc closes it and focus returns.
  await js("document.getElementById('long').scrollIntoView({block:'start'}); true"); await sleep(300);
  const longTop = await box("#long"), yKey = await js("scrollY");
  await at(longTop.x + 40, longTop.y + 20); await sleep(300);
  const addBtn = await box('[atl-ui=pin][data-key="long"] .atl-add');
  await click('[atl-ui=pin][data-key="long"] .atl-add');
  await until("document.querySelector('[atl-ui=composer] textarea')===document.activeElement");
  await sleep(300);
  const kpop = await js("(()=>{const f=document.querySelector('[atl-ui=composer]'),r=f.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,outside:f.parentElement===document.documentElement,vh:innerHeight,vw:document.documentElement.clientWidth,y:scrollY}})()");
  assert.equal(kpop.y, yKey, "a Key Comment does not scroll the Page");
  assert(kpop.outside && kpop.top >= 0 && kpop.bottom <= kpop.vh && kpop.right <= kpop.vw && (Math.abs(kpop.top - addBtn.y - addBtn.h) <= 12 || Math.abs(addBtn.y - kpop.bottom) <= 12) && kpop.left <= addBtn.right && kpop.right >= addBtn.x, `the box floats right beside its Comment button: ${JSON.stringify({ kpop, addBtn })}`);
  await b("press", "Escape");
  await until("document.querySelector('[atl-ui=composer]')===null");
  assert.equal(await js("document.activeElement.closest('[atl-ui=pin]')?.dataset.key"), "long", "Esc returns focus to the Comment button");
  assert.equal(await js("scrollY"), yKey, "and nothing scrolled");
  await js("scrollTo(0,0); true"); await sleep(300);

  // Comment through the hover button; the composer is styled from the palette.
  await b("hover", "#plain"); await sleep(300);
  await click('[atl-ui=pin][data-key="plain"] .atl-add');
  await until("document.querySelector('[atl-ui=composer] textarea')===document.activeElement");
  const look = await js(`(()=>{const s=(q)=>getComputedStyle(document.querySelector(q));const t=s('[atl-ui=composer] textarea'),v=s('[atl-ui=composer] [type=submit]'),c=s('[atl-ui=composer] [data-atl=dismiss]'),l=s('[atl-ui=composer] .atl-label');return [t.backgroundColor,t.borderTopWidth,t.borderTopColor,t.borderTopLeftRadius,t.resize,parseFloat(t.minHeight)>=60,v.backgroundColor,v.color,c.backgroundColor,c.borderTopLeftRadius===v.borderTopLeftRadius&&c.height===v.height,l.color]})()`);
  assert.deepEqual(look, ["rgb(255, 255, 255)", "1px", "rgb(9, 105, 218)", "8px", "vertical", true, "rgb(9, 105, 218)", "rgb(255, 255, 255)", "rgb(255, 255, 255)", true, "rgb(89, 99, 110)"], "composer: page background, accent focus border, 8px radius, accent Save, quiet Cancel, muted label");
  await b("keyboard", "type", "Needs a source.");
  // 2.7.0: a Comment takes images like a Decision's answer: picked here, stored beside the Page, named in the event.
  const ONE_PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const commentShot = path.join(dir, "comment-shot.png"); await writeFile(commentShot, Buffer.from(ONE_PX, "base64"));
  await b("upload", "[atl-ui=composer] .atl-file", commentShot);
  await until("document.querySelectorAll('[atl-ui=composer] .atl-attached img').length===1");
  await click("[atl-ui=composer] [type=submit]");
  await until("document.querySelector('[atl-ui=composer]')===null");
  assert.match(readLog(page).find((e) => e.type === "comment")?.images?.[0] ?? "", /^page\.html\.images\/[0-9a-f]{16}\.png$/, "the Comment names its stored image");
  // The thread shows as a marker on its Key: a chip titled with the first words of its first message. Nothing is
  // added to the Page's flow.
  const chip = '[atl-ui=pin][data-key=plain] [data-atl=thread]';
  await until(`document.querySelector('${chip}')!==null`);
  assert.equal(await js(`document.querySelector('${chip}').textContent`), "Needs a source.", "the chip is the thread's short title");
  assert.equal(await js("document.body.querySelector('.atl-msg')"), null, "no thread card in the Page's flow");
  assert.equal((await box("#plain")).h, without, "the marker takes no layout space");
  const root = readLog(page).find((e) => e.type === "comment");
  host.agent(page, { type: "answer", target: root.seq, text: "Added the source." });
  await until(`document.querySelector('${chip}')?.classList.contains('atl-unread')`);
  assert.deepEqual(await js(`[document.querySelector('${chip}').textContent, document.querySelector('${chip}').getAttribute('aria-label')]`), ["Needs a source.1", `Thread #${root.seq}: Needs a source. · Open, 1 reply, 1 new`], "reply count and new replies on the marker");
  await b("mouse", "move", "1", "1"); await sleep(300);
  assert.equal(await js(`getComputedStyle(document.querySelector('${chip}')).opacity`), "1", "the marker stays without hover");
  assert.deepEqual(await buttons(), ["plain"]);
  // Clicking the marker opens the thread floating beside it; focus moves in and the Page does not scroll.
  const yThread = await js("scrollY"), chipBox = await box(chip);
  await click(chip);
  await until("document.activeElement?.closest('[atl-ui=thread]')!=null");
  await sleep(200);
  const msgs = "[...document.querySelectorAll('[atl-ui=thread] .atl-msg')].map(m=>[m.className,m.querySelector('b').textContent])";
  assert.deepEqual(await js(msgs), [["atl-msg atl-you", "You"], ["atl-msg atl-agent", "Agent"]], "whole thread in order, You and Agent distinct");
  assert.equal(await js("document.querySelectorAll('[atl-ui=thread] .atl-msg .atl-thumbs img').length"), 1, "the thread shows the Comment's image");
  // 2.7.0: the parts of a thread keep a 6px gap (2.6.0 stacked them at 0px), and the box is as even below as above.
  const gaps = await js("(()=>{const p=document.querySelector('[atl-ui=thread]'),r=p.getBoundingClientRect(),k=[...p.querySelectorAll('.atl-c>*')].map((n)=>n.getBoundingClientRect()).filter((b)=>b.height),t=p.querySelector('.atl-tbar').getBoundingClientRect();return {between:k.slice(1).map((b,i)=>Math.round(b.top-k[i].bottom)),top:Math.round(t.top-r.top),bottom:Math.round(r.bottom-k.at(-1).bottom)}})()");
  assert(gaps.between.length >= 2 && gaps.between.every((g) => g === 6) && Math.abs(gaps.top - gaps.bottom) <= 1, `thread parts 6px apart, even top and bottom: ${JSON.stringify(gaps)}`);
  const tp = await js("(()=>{const p=document.querySelector('[atl-ui=thread]'),r=p.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,outside:p.parentElement===document.documentElement,role:p.getAttribute('role'),vh:innerHeight,y:scrollY}})()");
  assert(tp.outside && tp.role === "dialog" && tp.y === yThread && tp.top >= 0 && tp.bottom <= tp.vh && (Math.abs(tp.top - chipBox.y - chipBox.h) <= 12 || Math.abs(chipBox.y - tp.bottom) <= 12) && tp.left <= chipBox.right && tp.right >= chipBox.x, `the thread floats beside its marker: ${JSON.stringify({ tp, chipBox, yThread })}`);
  // Esc closes it, focus returns to the marker, and the reply now counts as read.
  await b("press", "Escape");
  await until("document.querySelector('[atl-ui=thread]')===null");
  assert.equal(await js("document.activeElement.dataset.atl+':'+document.activeElement.closest('[atl-ui=pin]')?.dataset.key"), "thread:plain", "focus returns to the marker");
  assert.equal(await js(`document.querySelector('${chip}').classList.contains('atl-unread')`), false, "read once opened");
  // Reply inside the floating thread; then close the thread there: the marker shows it closed.
  await click(chip);
  await until("document.activeElement?.closest('[atl-ui=thread]')!=null");
  await click("[atl-ui=thread] [data-atl=reply]");
  await until("document.activeElement?.matches('[atl-ui=thread] [atl-ui=composer] textarea')");
  await b("keyboard", "type", "Thanks.");
  await click("[atl-ui=thread] [atl-ui=composer] [type=submit]");
  await until("document.querySelectorAll('[atl-ui=thread] .atl-msg').length===3");
  assert.equal(await js(`document.querySelector('${chip} .atl-cn').textContent`), "2");
  await click("[atl-ui=thread] [data-atl=close]");
  await until(`document.querySelector('${chip}')?.classList.contains('atl-closed')`);
  assert.equal(await js("document.querySelectorAll('[atl-ui=thread] .atl-msg').length"), 3, "a closed thread opened from its marker still shows its messages");
  await click("[atl-ui=thread] [data-atl=hidethread]");
  await until("document.querySelector('[atl-ui=thread]')===null");
  assert.equal(await js("scrollY"), yThread, "reading, replying and closing never scrolled");

  // Selection: a real drag shows the floating Comment button beside it.
  const intro = await box("#intro");
  await at(intro.x + 2, intro.y + intro.h / 2); await b("mouse", "down");
  await at(intro.x + 120, intro.y + intro.h / 2); await b("mouse", "up");
  await until("!document.querySelector('[atl-ui=sel]').hidden");
  await click("[atl-ui=sel]");
  await until("document.querySelector('[atl-ui=composer] .atl-label')?.textContent.startsWith('Comment on “Select')");
  await click("[atl-ui=composer] [data-atl=dismiss]");

  // Fix 6: a Comment on text inside a long Key opens beside the selection, not at the Key's end, and nothing scrolls.
  await js("document.getElementById('phrase').scrollIntoView({block:'center'}); true"); await sleep(300);
  const phrase = await box("#phrase"), y0 = await js("scrollY");
  await at(phrase.x + 2, phrase.y + phrase.h / 2); await b("mouse", "down");
  await at(phrase.x + 90, phrase.y + phrase.h / 2); await b("mouse", "up");
  await until("!document.querySelector('[atl-ui=sel]').hidden");
  await click("[atl-ui=sel]");
  await until("document.activeElement?.matches('[atl-ui=composer] textarea')");
  await sleep(300);
  const [pop, quoted, y1, vh] = await js("(()=>{const r=document.querySelector('[atl-ui=composer]').getBoundingClientRect(), h=CSS.highlights.get('atl-pending'), q=h&&[...h][0].getBoundingClientRect();return [{top:r.top,bottom:r.bottom}, q&&{bottom:q.bottom}, scrollY, innerHeight]})()");
  assert.equal(y1, y0, "the Page does not scroll");
  assert(quoted && pop.top >= quoted.bottom && pop.top - quoted.bottom <= 12 && pop.bottom <= vh, `the editor sits under the highlighted selection: ${JSON.stringify({ pop, quoted, vh })}`);
  assert.match(await js("document.querySelector('[atl-ui=composer] .atl-label').textContent"), /^Comment on “Pick this/);
  const popW = await js("[Math.round(document.querySelector('[atl-ui=composer]').getBoundingClientRect().width), Math.min(560, innerWidth - 8)]");
  assert.equal(popW[0], popW[1], `the selection editor is wide enough to write in ("the comment box is very narrow"): ${JSON.stringify(popW)}`);
  await b("keyboard", "type", "Here.");
  await click("[atl-ui=composer] [type=submit]");
  // A selection-anchored thread keeps its highlight and gets the same marker, at the end of the quote.
  const spot = "document.querySelector('#phrase [atl-ui=spot] [data-atl=thread]')";
  await until(`${spot}!==null`);
  assert.equal(await js("scrollY"), y0, "saving does not scroll either");
  const spotAt = () => js(`(()=>{const s=${spot}.getBoundingClientRect(),q=[...CSS.highlights.get('atl-quote')][0].getClientRects();const l=q[q.length-1];return Math.abs(s.left-l.right)<=12&&Math.abs(s.bottom-l.top)<=16})()`);
  assert.equal(await spotAt(), true, "the marker sits at the end of the highlighted quote");
  assert.equal(await js("document.body.querySelector('.atl-msg')"), null, "no thread card in the Page's flow");
  assert.equal(await js("CSS.highlights.has('atl-pending')"), false, "the pending highlight goes with the editor");
  await js("window.u6=0; document.addEventListener('atelier:update',()=>u6++); true");
  host.update(page); await until("u6===1");
  assert.equal(await spotAt(), true, "and stays there through an Update");
  await js("document.querySelector('[data-atl=undo]').click(); true");
  await until(`${spot}===null`);
  // Review 2 finding 1: an unsaved reply in a floating thread survives an Update that rewrites its quote.
  const onQuote = host.postHuman(page, { type: "comment", key: "long", quote: { exact: "Pick this phrase", prefix: "", suffix: "" }, text: "Quoted." }).json.entry;
  await until(`${spot}?.dataset.seq==="${onQuote.seq}"`);
  await js(`${spot}.click(); true`);
  await until("document.querySelector('[atl-ui=thread] [data-atl=reply]')!==null");
  await js("document.querySelector('[atl-ui=thread] [data-atl=reply]').click(); true");
  await until("document.activeElement?.matches('[atl-ui=thread] [atl-ui=composer] textarea')");
  await b("keyboard", "type", "Unsaved reply.");
  await write({ phrase: "Pick that phrase, rewritten." }); host.update(page); await until("u6===2");
  assert.deepEqual(await js("(()=>{const t=document.querySelector('[atl-ui=composer] textarea');return [t?.value??null, document.activeElement===t, !!t?.closest('[atl-ui=thread]')]})()"), ["Unsaved reply.", true, true], "the reply keeps its text and focus in its floating thread");
  await until(`document.querySelector('[atl-ui=pin][data-key=long] [data-atl=thread][data-seq="${onQuote.seq}"]')!==null`); // the quote is gone: its marker moves to the Key
  await js("document.querySelector('[atl-ui=composer] [data-atl=dismiss]').click(); true");
  await js("document.querySelector('[atl-ui=thread] [data-atl=hidethread]').click(); true");
  await write(); host.update(page); await until("u6===3");
  await js("scrollTo(0,0); true");

  // A Page-declared Decision: the first answer is delivered; a change inside the next undo window replaces the
  // unsent one, so the agent gets one "3 → 5" (156).
  const choose = async (v) => { await click(`[data-atl=decide][data-id="run/turn-1"][data-label="${v}"]`); await until(`document.querySelector('[data-id="run/turn-1"][data-label="${v}"]').classList.contains('atl-chosen')`); };
  await choose("3"); await sleep(3100); host.deliverDue(page);
  await choose("4"); await choose("5");
  assert.deepEqual(decides().map((e) => [e.decision, e.option, e.previous, e.options, e.ver]), [["run/turn-1", "3", undefined, "1|2|3|4|5", "v1"], ["run/turn-1", "4", "3", "1|2|3|4|5", "v1"], ["run/turn-1", "5", "3", "1|2|3|4|5", "v1"]]);
  assert.deepEqual(readLog(page).filter((e) => e.type === "undo" && decides().some((d) => d.seq === e.target)).map((e) => e.target), [decides()[1].seq], "the unsent 4 is undone");
  assert.equal(await js("document.querySelector('[atl-ui=decide] .atl-dstate .atl-receipt .atl-ans').textContent"), "Your answer: 5");
  assert.match(await js("document.querySelector('[atl-ui=decide] .atl-dstate .atl-receipt .atl-dim').textContent"), /^changed from 3 · /, "the answer box: answer, then its status line");
  assert.match(await js("document.querySelector('.atl-bar').textContent"), /2 to answer/);
  // k-state-hook: Pages read Kernel state through window.atelier and the atelier:state event, not Kernel markup.
  const turn1 = "(s)=>s.decisions.find((d)=>d.id==='run/turn-1')";
  assert.deepEqual(await js(`(${turn1})(atelier.state())`), { id: "run/turn-1", key: "run/turn-1", declared: true, options: ["1", "2", "3", "4", "5"], recommended: null, answer: "5", custom: false, previous: "3", note: null, images: [], status: "pending", stale: false, opened: false });
  assert.equal(await js(`states.at(-1).loaded && (${turn1})(states.at(-1)).answer`), "5", "the event carries the new state");
  assert.deepEqual(await js("[states[0].loaded, states.some((s)=>s.toAnswer.length===3), atelier.state().toAnswer]"), [false, true, ["run/turn-2", "row-a"]]);

  // atl-note: Redo needs a note; nothing posts without it, Enter posts it with the note.
  await click('[data-atl=decide][data-id="run/turn-2"][data-label="Redo"]');
  await sleep(300);
  assert.equal(decides().length, 3, "no event without the note");
  assert.equal(await js("document.activeElement.matches('[atl-ui=decide] .atl-note')"), true, "the note field opens and takes focus");
  await b("keyboard", "type", "blurry"); await b("press", "Enter");
  await until("document.querySelector('[data-id=\"run/turn-2\"][data-label=Redo]').classList.contains('atl-chosen')");
  assert.deepEqual(decides().at(-1), { ...decides().at(-1), option: "Redo", note: "blurry", rec: "Confirm" });
  const rows = await js("[...document.querySelectorAll('.atl-undo .atl-toast')].map((t)=>t.textContent.trim())");
  assert(rows.length === 1 && /^Chose Redo and \d+ more\s+Undo \(\d+ s\)Undo all \d+$/.test(rows[0]), `pending undos collapse into one row: ${JSON.stringify(rows)}`);

  // Keyboard: Tab reaches a Key's Comment button, which then shows at its corner.
  await b("mouse", "move", "1", "1");
  await js("document.querySelector('[aria-label=\"Decision on row-a\"] [data-atl=addnote]').focus(); true"); // after the options, its note-or-image button
  await b("press", "Tab"); await sleep(300);
  assert.equal(await js("document.activeElement.closest('[atl-ui=pin]')?.dataset.key"), "row-a");
  assert.equal(await opacity("row-a"), "1", "focus shows the button");
  const [row, rowPin] = [await box("#ra"), await box('[atl-ui=pin][data-key="row-a"] .atl-add')];
  assert(Math.abs(row.right - rowPin.right) <= 8 && Math.abs(row.y - rowPin.y) <= 8, "at the row's corner");
  // A thread's chip never covers the Page's own controls in that corner (here the row's Decision options).
  host.postHuman(page, { type: "comment", key: "row-a", text: "A thread on the row" });
  await until("document.querySelector('[atl-ui=pin][data-key=row-a] [data-atl=thread]')!==null"); await sleep(200);
  const covered = await js("(()=>{const c=document.querySelector('[atl-ui=pin][data-key=row-a] [data-atl=thread]').getBoundingClientRect();return [...document.querySelectorAll('#ra [data-atl=decide],#ra [data-atl=addnote]')].map((b)=>b.getBoundingClientRect()).filter((b)=>b.left<c.right&&b.right>c.left&&b.top<c.bottom&&b.bottom>c.top).length})()");
  assert.equal(covered, 0, "the chip sits clear of the row's Decision options");
  // Review 2 finding 4: a plain-text Key takes a tab stop, and Tab goes on to its Comment button.
  await js("document.getElementById('less-s').focus(); true");
  await b("press", "Tab"); await sleep(300);
  assert.equal(await js("document.activeElement.id"), "quiet", "Tab reaches a Key with nothing focusable");
  await b("press", "Tab"); await sleep(300);
  assert.deepEqual([await js("document.activeElement.closest('[atl-ui=pin]')?.dataset.key"), await opacity("quiet")], ["quiet", "1"], "then its Comment button");
  await b("press", "Enter");
  await until("document.querySelector('[atl-ui=composer] .atl-label')?.textContent==='Comment on quiet'");
  await js("document.querySelector('[atl-ui=composer] [data-atl=dismiss]').click(); true");
  assert.equal(await js("document.querySelector('#plain').getAttribute('tabindex')"), "0");

  await sleep(3200); host.deliverDue(page);
  assert.match(sent.join("\n"), /Decision run\/turn-1 \(version v1\): 3 → 5\n/, `delivery: ${sent.join("\n")}`);

  // Update (145): the morph replaces the body's children, never nests a second <body> (k-body).
  // The <details> the human opened or closed keep his state (k-script-rows).
  await js("window.updates=0; document.addEventListener('atelier:update',()=>updates++); true");
  await click("#more-s"); await click("#less-s");
  await until("document.querySelector('#more').open && !document.querySelector('#less').open");
  const plain = "A plain keyed paragraph, rewritten.", details = "[document.querySelector('#more').open, document.querySelector('#less').open]";
  await write({ plain });
  host.update(page);
  await until("updates===1");
  assert.deepEqual(await js("[document.querySelectorAll('body').length, document.querySelector('#plain').firstChild.textContent]"), [1, plain], "one <body> after an Update");
  assert.deepEqual(await js(details), [true, false], "an Update keeps the details the human opened or closed");
  // Review 2 finding 3: still after the source catches up with him and then changes back.
  await write({ plain, flip: true }); host.update(page); await until("updates===2");
  await write({ plain }); host.update(page); await until("updates===3");
  assert.deepEqual(await js(details), [true, false], "the human's details state outlasts later source defaults");
  assert.equal(await js("document.querySelector('#plain').getAttribute('tabindex')"), "0", "a Kernel tab stop survives Updates");

  // Undo all takes back every action still in its window.
  await click('[data-atl=decide][data-id="row-a"][data-label=Keep]');
  await click('[data-atl=decide][data-id="run/turn-2"][data-label=Confirm]');
  await until("document.querySelector('[data-atl=undoall]')"); // the host's window here is 3 s
  await click("[data-atl=undoall]");
  await until("atelier.state().decisions.find((d)=>d.id==='row-a').answer===null");
  assert.equal(await js("atelier.state().decisions.find((d)=>d.id==='run/turn-2').answer"), "Redo");
  // The idle dock is only as wide as its bar; a Page places it in its own layout with atl-dock.
  await until("!document.querySelector('[atl-ui=panel] [role=status],[atl-ui=panel] .atl-toast')"); // flashes and undo rows gone
  const idle = await js("[document.querySelector('[atl-ui=panel]').getBoundingClientRect().width, document.querySelector('[atl-ui=panel]').innerText]");
  assert(idle[0] < 340, `idle dock shrinks to its bar: ${JSON.stringify(idle)}`);
  // Review 2 finding 5: an Update applies the new <body> attributes too.
  await write({ plain, dock: `<div atl-dock id="dock"></div>`, body: ` class="v2" data-mode="review" style="background:rgb(250, 250, 250)"` });
  host.update(page);
  await until("updates===4");
  assert.deepEqual(await js("[document.querySelector('[atl-ui=panel]').parentElement.id, getComputedStyle(document.querySelector('[atl-ui=panel]')).position]"), ["dock", "static"], "docked in the Page's flow");
  assert.deepEqual(await js("[document.querySelectorAll('body').length, document.body.className, document.body.dataset.mode, getComputedStyle(document.body).backgroundColor]"), [1, "v2", "review", "rgb(250, 250, 250)"], "body attributes follow the source");
  await write({ plain, dock: `<div atl-dock id="dock"></div>` }); host.update(page); await until("updates===5");
  assert.deepEqual(await js("[document.body.getAttribute('class'), document.body.getAttribute('data-mode'), document.body.getAttribute('style')]"), [null, null, null], "and go when the source drops them");

  // Every Decision takes an optional note and images behind one quiet button (owner rule 2026-10-13): picked and pasted
  // images travel with the answer, are stored beside the Page, show as thumbnails and keep through a change in the window.
  await write({ plain, dock: `<div atl-dock id="dock"></div>`, more: `<div atl-key="shot" id="shot" atl-decide="Ship|Hold">Shot</div>` }); host.update(page); await until("updates===6");
  const shot = '[atl-ui=decide][aria-label="Decision on shot"]';
  assert.equal(await js(`document.querySelector('${shot} .atl-extra').hidden`), true, "no note field until asked for");
  await js(`document.querySelector('${shot}').scrollIntoView({block:'center'}); true`); // threads no longer push it into view
  await click(`${shot} [data-atl=addnote]`);
  await until(`document.activeElement===document.querySelector('${shot} .atl-note')`);
  await b("keyboard", "type", "see the shots");
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", GIF = "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  const picked = path.join(dir, "picked-by-human.png"); await writeFile(picked, Buffer.from(PNG, "base64"));
  await b("upload", `${shot} .atl-file`, picked);
  await until(`document.querySelectorAll('${shot} .atl-attached img').length===1`);
  await js(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob("${GIF}"),(c)=>c.charCodeAt(0))],"x.gif",{type:"image/gif"}));document.querySelector('${shot} .atl-note').dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));return true})()`);
  await until(`document.querySelectorAll('${shot} .atl-attached img').length===2`);
  await click(`[data-atl=decide][data-id=shot][data-label=Hold]`);
  await until(`document.querySelectorAll('${shot} .atl-dstate .atl-thumbs img').length===2`);
  const held = decides().at(-1);
  assert.deepEqual([held.option, held.note, held.images.map((x) => path.extname(x))], ["Hold", "see the shots", [".png", ".gif"]]);
  assert.equal(await js(`[...document.querySelectorAll('${shot} .atl-dstate img')].every((i)=>i.complete&&i.naturalWidth===1)`), true, "thumbnails load from the stored files");
  assert.equal(await js(`document.querySelector('${shot} .atl-extra').hidden && document.querySelectorAll('${shot} .atl-attached img').length===0`), true, "the field closes and empties once posted");
  await click(`[data-atl=decide][data-id=shot][data-label=Ship]`); // a change inside the undo window keeps the note and images
  await until("atelier.state().decisions.find((d)=>d.id==='shot').answer==='Ship'");
  assert.deepEqual(await js("(({answer,note,images})=>[answer,note,images])(atelier.state().decisions.find((d)=>d.id==='shot'))"), ["Ship", "see the shots", held.images]);
  await sleep(3200); host.deliverDue(page);
  assert.match(sent.at(-1), new RegExp(`Decision shot: Ship; note "see the shots"; images ${held.images.map((x) => JSON.stringify(path.join(dir, x)).replace(/[.\\/]/g, "\\$&")).join(", ")}`), sent.at(-1));
  // Review finding 3: images upload before anything posts. A change inside the undo window whose image the host
  // refuses (bytes that are no image, though the browser calls them PNG) leaves the answer it would replace intact.
  await click(`[data-atl=decide][data-id=shot][data-label=Hold]`);
  await until("atelier.state().decisions.find((d)=>d.id==='shot').answer==='Hold'");
  const hold = decides().at(-1); // one eval, so the change lands well inside the host's 3-second window
  await js(`(async()=>{const dt=new DataTransfer();dt.items.add(new File(["not an image"],"fake.png",{type:"image/png"}));document.querySelector('${shot} .atl-note').dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));while(!document.querySelector('${shot} .atl-attached img'))await new Promise((r)=>setTimeout(r,20));document.querySelector('[data-atl=decide][data-id=shot][data-label=Ship]').click();return true})()`);
  await until("[...document.querySelectorAll('.atl-toast')].some((t)=>/did not change/.test(t.textContent))");
  assert.deepEqual(readLog(page).filter((e) => e.seq > hold.seq && e.origin === "human"), [], "no undo and no decide after the refused upload");
  assert.deepEqual(await js("(({answer,previous})=>[answer,previous])(atelier.state().decisions.find((d)=>d.id==='shot'))"), ["Hold", "Ship"]);
  assert.equal(await js(`document.querySelectorAll('${shot} .atl-attached img').length`), 1, "the refused image stays attached to drop or replace");
  await click(`${shot} [data-atl=dropimg]`);
  // Re-review finding 1: an upload that fails on the network (any connection state) also posts nothing.
  await b("upload", `${shot} .atl-file`, picked);
  await until(`document.querySelectorAll('${shot} .atl-attached img').length===1`);
  await js(`(()=>{window.__fetch=window.fetch;window.fetch=(u,o)=>String(u).includes("/.atelier/image")?Promise.reject(new TypeError("offline")):window.__fetch(u,o);document.querySelector('[data-atl=decide][data-id=shot][data-label=Ship]').click();return true})()`);
  await until("[...document.querySelectorAll('.atl-toast')].filter((t)=>/did not change/.test(t.textContent)).length>=1");
  await sleep(300);
  assert.deepEqual(readLog(page).filter((e) => e.seq > hold.seq && e.origin === "human"), [], "no undo and no decide after a failed upload");
  await js(`(()=>{window.fetch=(u,o)=>String(u).includes("/.atelier/image")?Promise.resolve(new Response("{}",{status:404})):window.__fetch(u,o);document.querySelector('[data-atl=decide][data-id=shot][data-label=Ship]').click();return true})()`);
  await until("[...document.querySelectorAll('.atl-toast')].filter((t)=>/did not change/.test(t.textContent)).length>=1");
  await sleep(300);
  assert.deepEqual(readLog(page).filter((e) => e.seq > hold.seq && e.origin === "human"), [], "no undo and no decide after an image 404");
  // Re-review finding 3: a second click while the first upload is slow is ignored, so the slow one cannot overwrite it.
  await js(`(()=>{let release;window.__gate=new Promise((r)=>release=r);window.__release=release;window.fetch=async(u,o)=>{if(String(u).includes("/.atelier/image"))await window.__gate;return window.__fetch(u,o)};document.querySelector('[data-atl=decide][data-id=shot][data-label=Ship]').click();document.querySelector('[data-atl=decide][data-id=shot][data-label=Hold]').click();return true})()`);
  await sleep(200);
  await js("(()=>{window.__release();return true})()");
  await until("atelier.state().decisions.find((d)=>d.id==='shot').answer==='Ship'");
  await sleep(300);
  assert.deepEqual(readLog(page).filter((e) => e.seq > hold.seq && e.type === "decide").map((e) => e.option), ["Ship"], "only the first click posts");
  await js("(()=>{window.fetch=window.__fetch;return true})()");

  // A Decision the agent asks takes the same quiet note-or-image button instead of a permanent note field.
  host.agent(page, { type: "ask", decision: { id: "ask-1", key: "plain", question: "Keep it?", options: [{ label: "Yes", consequence: "kept" }, { label: "No", consequence: "dropped" }] } });
  const card = '[data-id="d:ask-1"]';
  await until(`document.querySelector('${card} .atl-extra')?.hidden===true`);
  await js(`document.querySelector('${card}').scrollIntoView({block:'center'}); true`);
  await click(`${card} [data-atl=addnote]`);
  await until(`document.activeElement===document.querySelector('${card} .atl-note')`);
  await b("keyboard", "type", "only the intro");
  await click(`${card} [data-atl=decide][data-label=No]`);
  await until("atelier.state().decisions.find((d)=>d.id==='ask-1').answer==='No'");
  assert.equal(decides().at(-1).note, "only the intro");

  // 2.7.0: every Decision offers "Other…", the human's own answer, by keyboard too; it posts with custom: true, shows in
  // the answer box below the options, and edits like any answer.
  await js(`document.querySelector('${card} [data-atl=other]').focus(); true`);
  await b("press", "Enter");
  await until(`document.activeElement===document.querySelector('${card} .atl-ownans')`);
  await b("keyboard", "type", "Only the second paragraph");
  await b("press", "Enter");
  await until("atelier.state().decisions.find((d)=>d.id==='ask-1').custom===true");
  assert.deepEqual((({ option, custom, previous, note }) => ({ option, custom, previous, note }))(decides().at(-1)), { option: "Only the second paragraph", custom: true, previous: undefined, note: "only the intro" }, "an own answer replacing the unsent No replaces it and keeps its note");
  assert.deepEqual(await js(`[document.querySelector('${card} .atl-receipt .atl-ans').textContent, document.querySelector('${card} .atl-receipt .atl-rnote').textContent, document.querySelector('${card} [data-atl=other]').classList.contains('atl-chosen')]`), ["Your own answer: Only the second paragraph", "only the intro", true]);
  const rowOther = '[aria-label="Decision on row-a"]';
  await js(`document.querySelector('${rowOther}').scrollIntoView({block:'center'}); true`);
  await click(`${rowOther} [data-atl=other]`);
  await until(`document.activeElement===document.querySelector('${rowOther} .atl-ownans')`);
  await b("keyboard", "type", "Merge with row B");
  await click(`${rowOther} [data-atl=decideown]`);
  await until("atelier.state().decisions.find((d)=>d.id==='row-a').answer==='Merge with row B'");
  assert.deepEqual((({ option, custom, options }) => ({ option, custom, options }))(decides().at(-1)), { option: "Merge with row B", custom: true, options: "Keep|Drop" });
  const below = await js(`(()=>{const o=[...document.querySelectorAll('${rowOther} .atl-dopts button')].map((b)=>b.getBoundingClientRect().bottom),r=document.querySelector('${rowOther} .atl-receipt').getBoundingClientRect(),s=getComputedStyle(document.querySelector('${rowOther} .atl-receipt'));return r.top>=Math.max(...o)&&s.borderTopStyle==='solid'})()`);
  assert.equal(below, true, "the answer box sits below the options");
  await sleep(3200); host.deliverDue(page);
  assert.match(sent.join("\n"), /Decision row-a: own answer: "Merge with row B"/, "delivered as the human's own answer");

  if (process.argv[2]) await b("screenshot", process.argv[2]);
  assert.deepEqual((await b("errors")).errors ?? [], [], "no browser errors");
  // Review 2 finding 2: a Page served by a test host (serve.mjs) says so in the Kernel bar.
  const copy = path.join(dir, "copy.html");
  await writeFile(copy, `<!doctype html><title>Copy</title><p atl-key="a">A</p><script type="module" src="atelier.js"></script>`);
  const testHost = createHost({ root: dir, test: true, send: (_m, done) => done(true) });
  try {
    await b("open", (await testHost.open(copy)).url);
    await until("document.querySelector('.atl-conn')?.textContent==='live'");
    assert.equal(await js("document.querySelector('.atl-test')?.textContent.trim()"), "Test host, no Pi session");
  } finally { testHost.stop(); }

  // "Still very narrow" (owner, after 2.3.1): a Comment or reply on a Key narrower than the box (a 191px storyboard
  // frame) opens at least min(560px, viewport - 16px) wide and fully on screen; a wide Key keeps it inside; typing
  // survives an Update.
  const narrow = path.join(dir, "narrow.html");
  const writeNarrow = (word = "Frame") => writeFile(narrow, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Narrow</title>
<style>body{margin:0;font:15px system-ui}.row{display:flex;flex-wrap:wrap;gap:12px;padding:16px}.frame{width:191px;flex:none;border:1px solid #ccc}#wide{max-width:900px;margin:16px;border:1px solid #ccc}</style>
<body><div class="row"><div class="frame" atl-key="f1" id="f1">${word} one<br><br><br>shot</div><div class="frame" atl-key="f2" id="f2">Frame two</div></div><p atl-key="wide" id="wide">A wide Key keeps its comment box inside.</p>
<script type="module" src="atelier.js"></script></body></html>`);
  await writeNarrow();
  const composerAt = () => js("(()=>{const f=document.querySelector('[atl-ui=composer]'),r=f.getBoundingClientRect(),t=f.querySelector('textarea').getBoundingClientRect(),vw=document.documentElement.clientWidth;return {w:Math.round(r.width),ta:Math.round(t.width),left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),inKey:!!f.closest('[atl-ui=key]'),need:Math.min(560,vw-16),vw,vh:innerHeight,overflow:document.documentElement.scrollWidth>vw,focused:document.activeElement===f.querySelector('textarea')}})()");
  const openOn = async (key) => { await b("hover", `#${key}`); await sleep(300); await click(`[atl-ui=pin][data-key="${key}"] .atl-add`); await until("document.activeElement?.matches('[atl-ui=composer] textarea')"); return composerAt(); };
  const fits = (c) => c.w >= c.need && c.left >= 0 && c.right <= c.vw && c.top >= 0 && c.bottom <= c.vh && !c.overflow && c.focused;
  const dismiss = () => click("[atl-ui=composer] [data-atl=dismiss]");
  for (const [w, h] of [["1440", "900"], ["390", "844"]]) {
    await b("set", "viewport", w, h);
    await b("open", (await host.open(narrow)).url);
    await until("document.querySelector('.atl-conn')?.textContent==='live'");
    const c = await openOn("f1");
    assert(fits(c), `${w}px: the box on a 191px Key is wide enough and on screen: ${JSON.stringify(c)}`);
    await dismiss();
    assert.equal(await js("document.querySelector('[atl-ui=composer]')"), null, "Cancel closes the popped box");
    const wide = await openOn("wide");
    assert(fits(wide) && !wide.inKey, `${w}px: a wide Key's box floats too, never in the Key's flow: ${JSON.stringify(wide)}`);
    await dismiss();
  }
  await js("window.un=0; document.addEventListener('atelier:update',()=>un++); true");
  await openOn("f1"); await b("keyboard", "type", "Unsaved on a frame.");
  await writeNarrow("Frame, rewritten,"); host.update(narrow); await until("un===1");
  assert.deepEqual(await js("(()=>{const t=document.querySelector('[atl-ui=composer] textarea');return [t?.value??null, document.activeElement===t]})()"), ["Unsaved on a frame.", true], "the popped box keeps its text and focus through an Update");
  assert(fits(await composerAt()), "and stays on screen");
  await click("[atl-ui=composer] [type=submit]");
  await until("document.querySelector('[atl-ui=pin][data-key=f1] [data-atl=thread]')!==null");
  await js("document.querySelector('[atl-ui=pin][data-key=f1] [data-atl=thread]').click(); true");
  await until("document.querySelector('[atl-ui=thread] [data-atl=reply]')!==null");
  await js("document.querySelector('[atl-ui=thread] [data-atl=reply]').click(); true");
  await until("document.activeElement?.matches('[atl-ui=composer] textarea')");
  const reply = await js("(()=>{const p=document.querySelector('[atl-ui=thread]').getBoundingClientRect(),vw=document.documentElement.clientWidth;return {w:Math.round(p.width),need:Math.min(560,vw-16),left:p.left,right:p.right,top:p.top,bottom:p.bottom,vw,vh:innerHeight}})()");
  assert(reply.w >= reply.need && reply.left >= 0 && reply.right <= reply.vw && reply.top >= 0 && reply.bottom <= reply.vh && /^Reply/.test(await js("document.querySelector('[atl-ui=composer] .atl-label').textContent")), `a reply in a narrow Key's thread is wide enough too: ${JSON.stringify(reply)}`);
  await dismiss();
  await b("press", "Escape");
  await until("document.querySelector('[atl-ui=thread]')===null");

  // "One word per line" (2.3.2, a real check row): a Key that is itself a grid or flex row made its Kernel UI one cell,
  // 280px of a 1374px row. Its UI (an asked Decision; threads are markers now) spans the Key's content width, in a
  // wrapping and a nowrap row too; an inline, a plain and a media Key keep their place.
  const rowPage = path.join(dir, "rows.html");
  await writeFile(rowPage, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Rows</title>
<style>body{margin:16px;font:15px system-ui}[atl-key]{border:1px solid #ccc;padding:6px;margin:8px 0}#grid{display:grid;grid-template-columns:11em 1fr auto;gap:8px}#wrap{display:flex;flex-wrap:wrap;gap:8px}#nowrap{display:flex;gap:8px}</style>
<body><div atl-key="grid" id="grid"><b>Check</b><span>Every frame keeps the caption inside the safe zone.</span><span>pass</span></div>
<div atl-key="wrap" id="wrap"><b>Check</b><span>A wrapping row.</span><span>pass</span></div>
<div atl-key="nowrap" id="nowrap"><b>Check</b><span>A nowrap row.</span><span>pass</span></div>
<p atl-key="plain" id="plain">A plain block Key.</p><p>Text with <span atl-key="inline" id="inline">an inline Key</span> inside.</p><canvas atl-key="media" id="media" width="120" height="60"></canvas>
<script type="module" src="atelier.js"></script></body></html>`);
  const spanOf = (key) => js(`(()=>{const k=document.getElementById("${key}"),u=document.querySelector('[atl-ui=key][data-key="${key}"]'),s=getComputedStyle(k),w=k.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);return {key:"${key}",keyW:Math.round(w),uiW:Math.round(u.getBoundingClientRect().width),inside:k.contains(u),after:!k.contains(u)&&k.parentElement===u.parentElement,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`);
  for (const [w, h] of [["1440", "900"], ["390", "844"]]) {
    await b("set", "viewport", w, h);
    await b("open", (await host.open(rowPage)).url);
    await until("document.querySelector('.atl-conn')?.textContent==='live'");
    const got = [];
    for (const key of ["grid", "wrap", "nowrap", "plain", "inline", "media"]) {
      await js(`document.getElementById("${key}").scrollIntoView({block:"center"}); true`);
      host.agent(rowPage, { type: "ask", decision: { id: `ask-${key}-${w}`, key, question: "A question that should read as a line, not one word per line?", options: [{ label: "Yes", consequence: "kept" }, { label: "No", consequence: "dropped" }] } });
      await until(`document.querySelector('[atl-ui=key][data-key="${key}"] .atl-card')!==null`);
      got.push(await spanOf(key));
    }
    console.log(`rows ${w}px ${JSON.stringify(got)}`);
    const [grid, wrap, nowrap, plain, inline, media] = got;
    for (const m of [grid, wrap, nowrap, plain]) assert(m.uiW >= 0.9 * m.keyW && !m.overflow, `${w}px: the thread spans the ${m.key} Key: ${JSON.stringify(m)}`);
    assert(grid.inside && wrap.inside && plain.inside && inline.inside && nowrap.after && media.after, `${w}px: each UI sits where expected: ${JSON.stringify(got)}`);
  }

  // atl-wip (2.4.0): a region under construction is dimmed and labelled, and its Decisions are locked with the label as
  // their title while the answer stays shown; Comments stay open; an Update that drops the mark restores all of it.
  for (const [w, h] of [["1440", "900"], ["390", "844"]]) {
    const wipPage = path.join(dir, `wip-${w}.html`);
    const writeWip = (on) => writeFile(wipPage, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Wip</title>
<style>body{margin:16px;font:15px system-ui}[atl-key]{border:1px solid #ccc;padding:6px;margin:24px 0}</style>
<body><section id="sec"${on ? ' atl-wip="Reworking scene 3"' : ""}><div atl-key="s1" id="s1" atl-decide="Keep|Redo">Scene 3, inside a marked section.</div></section>
<div atl-key="s2" id="s2" atl-decide="1|2|3"${on ? ' atl-wip=""' : ""}>A marked Key without a reason.</div><p atl-key="free" id="free" atl-decide="Yes|No">Not marked.</p>
<script type="module" src="atelier.js"></script></body></html>`);
    const wipNow = () => js(`(()=>{const opts=(k)=>[...document.querySelectorAll('#'+k+' [data-atl=decide]')].map(b=>[b.dataset.label,b.disabled,b.title,b.getAttribute('aria-pressed')]),labels=[...document.querySelectorAll('.atl-wip')].map(l=>{const r=l.getBoundingClientRect();return {text:l.textContent,shown:!l.hidden&&r.width>0,x:Math.round(r.left),y:Math.round(r.top+r.height/2),w:Math.round(r.width)}}),at=(id)=>{const r=document.getElementById(id).getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top)}};return {s1:opts('s1'),s2:opts('s2'),free:opts('free'),labels,sec:at('sec'),s2at:at('s2'),dim:getComputedStyle(document.getElementById('sec')).opacity,outline:getComputedStyle(document.getElementById('s2')).outlineStyle,wip:atelier.state().wip,s1answer:atelier.state().decisions.find(d=>d.id==='s1').answer,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`);
    await writeWip(false);
    await b("set", "viewport", w, h);
    await b("open", (await host.open(wipPage)).url);
    await until("document.querySelector('.atl-conn')?.textContent==='live'");
    await click('#s1 [data-atl=decide][data-label="Keep"]');
    await until("atelier.state().decisions.find(d=>d.id==='s1').answer==='Keep'");
    await writeWip(true); host.update(wipPage);
    await until("atelier.state().wip.length===2");
    const on = await wipNow();
    console.log(`wip ${w}px on ${JSON.stringify(on)}`);
    assert.deepEqual(on.wip, [{ key: null, text: "Reworking scene 3" }, { key: "s2", text: "Work in progress" }], "state().wip lists both marked regions");
    assert.deepEqual(on.s1, [["Keep", true, "Reworking scene 3", "true"], ["Redo", true, "Reworking scene 3", "false"]], `${w}px: a Decision inside the marked section is locked, its answer still shown`);
    assert(on.s2.every(([, off, title]) => off && title === "Work in progress") && on.free.every(([, off]) => !off), `${w}px: a marked Key locks, an unmarked one does not: ${JSON.stringify(on)}`);
    assert(on.dim === "0.55" && on.outline === "dashed" && !on.overflow, `${w}px: the region is dimmed and outlined`);
    const [l1, l2] = on.labels;
    assert(on.labels.length === 2 && l1.shown && l2.shown && l1.text === "Reworking scene 3" && Math.abs(l1.x - on.sec.x) <= 1 && Math.abs(l1.y - on.sec.y) <= 1 && Math.abs(l2.x - on.s2at.x) <= 1 && Math.abs(l2.y - on.s2at.y) <= 1, `${w}px: each region's label sits on its top-left corner: ${JSON.stringify(on.labels)}`);
    const before = readLog(wipPage).filter((e) => e.type === "decide").length;
    await click('#s1 [data-atl=decide][data-label="Redo"]'); await sleep(500);
    assert.deepEqual([readLog(wipPage).filter((e) => e.type === "decide").length, await js("atelier.state().decisions.find(d=>d.id==='s1').answer")], [before, "Keep"], "a click on a locked option answers nothing");
    assert((await openOn("s1")).focused, "Comments stay open inside a marked region");
    await dismiss();
    await writeWip(false); host.update(wipPage);
    await until("atelier.state().wip.length===0");
    const off = await wipNow();
    console.log(`wip ${w}px off ${JSON.stringify({ s1: off.s1, labels: off.labels, dim: off.dim, outline: off.outline })}`);
    assert(off.labels.length === 0 && off.dim === "1" && [...off.s1, ...off.s2].every(([, d, title]) => !d && title !== "Reworking scene 3"), `${w}px: removing the mark in an Update restores the region: ${JSON.stringify(off)}`);
    await click('#s1 [data-atl=decide][data-label="Redo"]');
    await until("atelier.state().decisions.find(d=>d.id==='s1').answer==='Redo'");
  }

  // Change marks stay until seen (2.5.0, owner 2026-10-19: clearing after 5 s in view was too fast). A mark outlives
  // 10 s in view and another Update; its "Seen" clears it, opening and closing its changes clears it, "Mark all seen"
  // clears the rest. Its "Seen" sits on screen at 1440 and 390 px. atl-changes="off" draws none.
  for (const [w, h] of [["1440", "900"], ["390", "844"]]) {
    const chPage = path.join(dir, `changes-${w}.html`);
    const writeCh = (words, off = false) => writeFile(chPage, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Changes</title>
<style>body{margin:16px;font:15px system-ui}[atl-key]{border:1px solid #ccc;padding:6px;margin:24px 0}</style>
<body${off ? ' atl-changes="off"' : ""}>${words.map((x, i) => `<p atl-key="c${i + 1}" id="c${i + 1}">${x}</p>`).join("")}
<script type="module" src="atelier.js"></script></body></html>`);
    const base = ["First words.", "Second words.", "Third words."];
    const count = () => js("document.querySelectorAll('[atl-ui=rail] [data-atl=chrail]').length");
    const marksNow = () => js("JSON.stringify({rail:document.querySelectorAll('[atl-ui=rail] [data-atl=chrail]').length,bars:document.querySelectorAll('[atl-ui=mark] [data-atl=chmark]').length})");
    let n = 0;
    const updateCh = async (words, off) => { await writeCh(words, off); host.update(chPage); n += 1; await until(`updates===${n}`); };
    await writeCh(base);
    await b("set", "viewport", w, h);
    await b("open", (await host.open(chPage)).url);
    await until("document.querySelector('.atl-conn')?.textContent==='live'");
    await js("window.updates=0; document.addEventListener('atelier:update',()=>updates++); true"); await sleep(500); // every Key seen once
    await updateCh(["First words, changed.", "Second words, changed.", "Third words, changed."]);
    const seenAt = await js("[...document.querySelectorAll('[atl-ui=mark] .atl-seen')].map((s)=>{const r=s.getBoundingClientRect();return [Math.round(r.left),Math.round(r.right),Math.round(r.top)]})");
    console.log(`changes ${w}px after Update ${await marksNow()}, Seen chips ${JSON.stringify(seenAt)}`);
    assert.equal(await count(), 3, `${w}px: three reworded Keys marked`);
    assert(seenAt.length === 3 && seenAt.every(([l, r]) => l >= 0 && r <= +w), `${w}px: every Seen is on screen: ${JSON.stringify(seenAt)}`);
    await b("mouse", "move", "5", "5"); await sleep(10_500);
    console.log(`changes ${w}px after 10.5 s in view ${await marksNow()}`);
    assert.equal(await count(), 3, `${w}px: no mark clears with time`);
    await updateCh(["First words, changed again.", "Second words, changed.", "Third words, changed."]);
    assert.equal(await count(), 3, `${w}px: marks outlast another Update`);
    await click('[atl-ui=mark] .atl-seen[data-addr="c1"]');
    await until("!document.querySelector('[data-addr=\"c1\"]')");
    console.log(`changes ${w}px after Seen on c1 ${await marksNow()}`);
    assert.equal(await count(), 2, `${w}px: Seen clears one mark`);
    await click('[atl-ui=mark] [data-atl=chmark][data-addr="c2"]');
    await until("document.querySelector('[atl-ui=diff]')");
    assert.equal(await count(), 2, `${w}px: opening the changes keeps the mark`);
    await click("[atl-ui=diff] button");
    await until("!document.querySelector('[data-addr=\"c2\"]')");
    console.log(`changes ${w}px after open and close on c2 ${await marksNow()}`);
    assert.equal(await count(), 1, `${w}px: opening and closing clears that mark`);
    await updateCh(["First words, changed a third time.", "Second words, changed.", "Third words, changed."]);
    assert.equal(await count(), 2, `${w}px: a new change marks again`);
    await click("[atl-ui=rail] .atl-allseen");
    await until("!document.querySelector('[data-atl=chrail]') && document.querySelector('[atl-ui=rail]').hidden");
    console.log(`changes ${w}px after Mark all seen ${await marksNow()}`);
    await updateCh(["First words, changed a third time.", "Second words, changed.", "Third words, changed."], true); // the Page turns marks off
    await updateCh(["Off: first.", "Off: second.", "Off: third."], true); await sleep(300);
    assert.equal(await count(), 0, `${w}px: atl-changes="off" draws no marks`);
  }

  // A Page that moves the panel into a sticky column (the iterate trial, owner 2026-10-13): the panel takes the column's
  // width up to 760px and, held to 300px by the Page, scrolls inside so every control stays reachable; also after an
  // Update and under a transformed ancestor (review findings 4 and 5: no pinning machinery to break there).
  const sticky = path.join(dir, "sticky.html");
  const writeSticky = (col = "") => writeFile(sticky, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sticky</title>
<style>body{margin:0;font:15px system-ui}main{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;padding:16px}#col{position:sticky;top:8px;align-self:start;${col}}#app{height:110vh;background:#eee}#queue{height:400vh}body [atl-ui=panel]{position:relative;left:auto;right:auto;bottom:auto;width:100%;max-height:300px;margin:12px 0}</style>
<body><main><section id="col"><div id="app" atl-key="app">Live app</div><div id="spot"></div></section><div id="queue"><p atl-key="q">Queue</p></div></main>
<script>addEventListener("load",()=>{const move=()=>{const p=document.querySelector("[atl-ui=panel]");if(p&&p.parentElement.id!=="spot")document.getElementById("spot").append(p)};move();document.addEventListener("atelier:update",move)})</script>
<script type="module" src="atelier.js"></script></body></html>`);
  await writeSticky();
  await b("set", "viewport", "1400", "800");
  await b("open", (await host.open(sticky)).url);
  await until("document.querySelector('.atl-conn')?.textContent==='live' && document.querySelector('[atl-ui=panel]').parentElement.id==='spot'");
  for (let i = 1; i <= 5; i += 1) host.postHuman(sticky, { type: "comment", quote: { exact: "Live app", prefix: "", suffix: "" }, text: `In the panel, number ${i}, long enough to wrap in a narrow column.` });
  await until("document.querySelectorAll('[atl-ui=panel] [data-atl=jump]').length===5");
  // Each visible control, brought into view by scrolling the panel alone, is the element at its centre.
  const panelAt = () => js("(()=>{const p=document.querySelector('[atl-ui=panel]'),y=scrollY,r=p.getBoundingClientRect(),reach=[...p.querySelectorAll('[data-atl]')].filter((x)=>x.getClientRects().length).map((x)=>{p.scrollTop+=x.getBoundingClientRect().top-p.getBoundingClientRect().top-8;const c=x.getBoundingClientRect();return document.elementFromPoint(c.x+c.width/2,c.y+c.height/2)?.closest('[data-atl]')===x&&c.bottom<=p.getBoundingClientRect().bottom});return {inSpot:p.parentElement.id==='spot',scrolls:p.scrollHeight>p.clientHeight,top:r.top,bottom:r.bottom,width:Math.round(r.width),spot:Math.round(document.getElementById('spot').getBoundingClientRect().width),vh:innerHeight,windowMoved:scrollY!==y,controls:reach.length,reach}})()");
  const checkSticky = async (when) => {
    await js("scrollTo(0,document.documentElement.scrollHeight); true"); await sleep(300);
    const at = await panelAt();
    assert(at.inSpot && at.scrolls && at.top >= 0 && at.bottom <= at.vh && at.width === Math.min(760, at.spot) && !at.windowMoved && at.controls >= 10 && at.reach.every(Boolean), `${when}: column-wide, scrolling inside, every control reachable: ${JSON.stringify(at)}`);
  };
  await checkSticky("first load");
  await js("window.updates=0; document.addEventListener('atelier:update',()=>updates++); true");
  host.update(sticky); await until("updates===1 && document.querySelector('[atl-ui=panel]').parentElement.id==='spot' && document.querySelectorAll('[atl-ui=panel] [data-atl=jump]').length===5");
  await checkSticky("after an Update");
  await writeSticky("transform:translateZ(0)"); host.update(sticky);
  await until("updates===2 && getComputedStyle(document.getElementById('col')).transform!=='none' && document.querySelector('[atl-ui=panel]').parentElement.id==='spot'");
  await checkSticky("under a transformed ancestor");

  // An Event Log written by Kernel 2.3 renders unchanged: a closed Key thread with replies, a quote on a Key, a quote
  // and a selector without one, and an Unanchored Comment. Every thread gets its marker; the panel still lists them.
  const legacy = path.join(dir, "legacy.html"), t0 = Date.now() - 86_400_000;
  await writeFile(legacy, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Legacy</title><body>
<p id="free">Free text on the Page.</p><div id="box"><span>Box</span></div><section atl-key="s" atl-ver="v1" id="s"><p id="sp">Keyed words to quote.</p><button id="pc" atl-comment>Comment</button></section>
<script type="module" src="atelier.js"></script></body></html>`);
  const old = [
    { seq: 1, type: "comment", key: "s", ver: "v1", text: "First remark on the section", origin: "human", delivery: "immediate" },
    { seq: 2, type: "answer", target: 1, text: "Done.", origin: "agent" },
    { seq: 3, type: "comment", thread: 1, key: "s", ver: "v1", text: "Good.", origin: "human", delivery: "immediate" },
    { seq: 4, type: "close", target: 1, ver: "v1", origin: "human", delivery: "record" },
    { seq: 5, type: "comment", key: "s", ver: "v1", quote: { exact: "words to quote", prefix: "Keyed ", suffix: "." }, text: "On the words", origin: "human", delivery: "immediate" },
    { seq: 6, type: "comment", quote: { exact: "Free text", prefix: "", suffix: " on" }, text: "On free text", origin: "human", delivery: "immediate" },
    { seq: 7, type: "comment", selector: { sel: "#box", snap: "Box" }, text: "On the box", origin: "human", delivery: "immediate" },
    { seq: 8, type: "comment", key: "gone", text: "Its Key was removed", origin: "human", delivery: "immediate" },
    { seq: 9, type: "delivered", of: [1, 3, 5, 6, 7, 8], origin: "kernel" },
    { seq: 10, type: "received", of: [1, 3, 5, 6, 7, 8], origin: "kernel" },
  ].map((e, i) => JSON.stringify({ ...e, at: t0 + i }));
  await writeFile(`${legacy}.events.jsonl`, `${old.join("\n")}\n`);
  await b("open", (await host.open(legacy)).url);
  await until("document.querySelector('.atl-conn')?.textContent==='live' && atelier.state().loaded");
  await until("document.querySelectorAll('[data-atl=thread]').length===4");
  const marks = await js("[...document.querySelectorAll('[data-atl=thread]')].map((m)=>[m.dataset.seq,m.closest('[atl-ui]').getAttribute('atl-ui'),m.closest('[atl-ui]').parentElement.id,m.classList.contains('atl-closed'),m.querySelector('.atl-cn')?.textContent??''])");
  assert.deepEqual(marks.sort(), [["1", "pin", "s", true, "2"], ["5", "spot", "sp", false, ""], ["6", "spot", "free", false, ""], ["7", "spot", "box", false, ""]], `old threads get markers: ${JSON.stringify(marks)}`);
  assert.match(await js("document.querySelector('[atl-ui=panel] .atl-list').textContent"), /On the text[\s\S]*On free text[\s\S]*On the box[\s\S]*Unanchored \(1\)[\s\S]*Its Key was removed/, "the panel still lists threads on the text and Unanchored ones");
  await js("document.querySelector('[data-atl=thread][data-seq=\"1\"]').click(); true");
  await until("document.querySelectorAll('[atl-ui=thread] .atl-msg').length===3");
  assert.deepEqual(await js("[...document.querySelectorAll('[atl-ui=thread] .atl-msg>div:last-child')].map((d)=>d.textContent)"), ["First remark on the section", "Done.", "Good."]);
  await js("document.querySelector('[atl-ui=thread]') && document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true");
  await js("document.getElementById('pc').click(); true");
  await until("document.querySelector('[atl-ui=composer]')?.isConnected");
  const pcAt = await js("(()=>{const c=document.querySelector('[atl-ui=composer]').getBoundingClientRect(),p=document.getElementById('pc').getBoundingClientRect();return {label:document.querySelector('[atl-ui=composer] .atl-label').textContent,gap:Math.round(Math.min(Math.abs(c.top-p.bottom),Math.abs(p.top-c.bottom)))}})()");
  assert.ok(pcAt.label === "Comment on s" && pcAt.gap <= 12, `an atl-comment button opens its Key's Comment beside it: ${JSON.stringify(pcAt)}`);
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true");
  assert.deepEqual((await b("errors")).errors ?? [], [], "no browser errors");

  // 2.7.0 review blockers (Sol, PR #10): Other… after an abandoned required note posts the own answer on Enter; an image
  // still being read when an option or Save is clicked goes along; a Comment box is locked while it saves, so what posts
  // is what it shows.
  const races = path.join(dir, "races.html");
  await writeFile(races, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Races</title>
<style>body{margin:16px;font:15px system-ui}[atl-key]{border:1px solid #ccc;padding:6px;margin:24px 0}</style>
<body><div atl-key="redo" id="redo" atl-decide="Keep|Redo" atl-note="Redo">Redo needs a note.</div><div atl-key="pic" id="pic" atl-decide="Ship|Hold">A picture.</div><div atl-key="lock" id="lock" atl-decide="Ship|Hold">Locked while saving.</div><p atl-key="c" id="c">Comment here.</p>
<script type="module" src="atelier.js"></script></body></html>`);
  await b("set", "viewport", "1440", "900");
  await b("open", (await host.open(races)).url);
  await until("document.querySelector('.atl-conn')?.textContent==='live'");
  const rlog = (type) => readLog(races).filter((e) => e.type === type);
  const racePng = path.join(dir, "race.png"); await writeFile(racePng, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  { // blocker1-other-after-required-note
    const redo = '[atl-ui=decide][aria-label="Decision on redo"]';
    await click("[data-atl=decide][data-id=redo][data-label=Redo]");
    await until(`document.activeElement===document.querySelector('${redo} .atl-note')`);
    await click(`${redo} [data-atl=other]`);
    await until(`document.activeElement===document.querySelector('${redo} .atl-ownans')`);
    await b("keyboard", "type", "Split it");
    await click(`${redo} .atl-note`);
    await b("keyboard", "type", "two scenes"); await b("press", "Enter");
    await until("atelier.state().decisions.find((d)=>d.id==='redo').answer!==null");
    assert.deepEqual((({ option, custom, note }) => ({ option, custom, note }))(rlog("decide").at(-1)), { option: "Split it", custom: true, note: "two scenes" }, "Enter in the note after Other… posts the own answer, not the abandoned Redo");
  }
  await js("(()=>{const read=FileReader.prototype.readAsDataURL;window.__read=read;FileReader.prototype.readAsDataURL=function(f){setTimeout(()=>read.call(this,f),800)};return true})()");
  { // blocker3-decision-waits-for-image-read
    await b("upload", '[atl-ui=decide][aria-label="Decision on pic"] .atl-file', racePng);
    await click("[data-atl=decide][data-id=pic][data-label=Ship]");
    await until("atelier.state().decisions.find((d)=>d.id==='pic').answer==='Ship'");
    await sleep(1200);
    assert.equal(rlog("decide").at(-1).images?.length, 1, "an image still being read when the option is clicked goes with the answer");
  }
  { // blocker3-comment-waits-for-image-read
    await b("hover", "#c"); await sleep(300);
    await click('[atl-ui=pin][data-key="c"] .atl-add');
    await until("document.activeElement?.matches('[atl-ui=composer] textarea')");
    await b("keyboard", "type", "With a picture");
    await b("upload", "[atl-ui=composer] .atl-file", racePng);
    await click("[atl-ui=composer] [type=submit]");
    await until("document.querySelector('[atl-ui=composer]')===null");
    await sleep(1200);
    assert.equal(rlog("comment").at(-1)?.images?.length, 1, "an image still being read when Save is clicked goes with the Comment");
  }
  await js("(()=>{FileReader.prototype.readAsDataURL=window.__read;return true})()");
  { // blocker2-comment-locked-while-saving
    await b("hover", "#c"); await sleep(300);
    await click('[atl-ui=pin][data-key="c"] .atl-add');
    await until("document.activeElement?.matches('[atl-ui=composer] textarea')");
    await b("keyboard", "type", "Old text");
    await b("upload", "[atl-ui=composer] .atl-file", racePng);
    await until("document.querySelectorAll('[atl-ui=composer] .atl-attached img').length===1");
    await js("(()=>{let release;window.__gate=new Promise((r)=>release=r);window.__release=release;window.__fetch=window.fetch;window.fetch=async(u,o)=>{if(String(u).includes('/.atelier/image'))await window.__gate;return window.__fetch(u,o)};return true})()");
    const before = rlog("comment").length;
    await click("[atl-ui=composer] [type=submit]"); await sleep(200);
    await click("[atl-ui=composer] textarea"); await b("keyboard", "type", " edited");
    await click("[atl-ui=composer] [data-atl=dropimg]"); await sleep(200);
    const shown = await js("({text:document.querySelector('[atl-ui=composer] textarea').value.trim(),images:document.querySelectorAll('[atl-ui=composer] .atl-attached img').length,cancel:!document.querySelector('[atl-ui=composer] [data-atl=dismiss]').disabled})");
    await js("(()=>{window.__release();return true})()");
    await until("document.querySelector('[atl-ui=composer]')===null");
    await sleep(300);
    await js("(()=>{window.fetch=window.__fetch;return true})()");
    const posted = rlog("comment").slice(before).at(-1);
    assert.deepEqual({ text: posted?.text, images: posted?.images?.length ?? 0, cancel: true }, shown, "what posts is what the box showed while it saved");
  }
  // Second review round (Sol, PR #10): a Decision is locked while its images upload; a failed image read posts nothing.
  const lk = '[atl-ui=decide][aria-label="Decision on lock"]';
  { // review2-blocker1-decision-locked-while-uploading
    await click(`${lk} [data-atl=addnote]`);
    await b("upload", `${lk} .atl-file`, racePng);
    await until(`document.querySelectorAll('${lk} .atl-attached img').length===1`);
    await click(`${lk} .atl-note`); await b("keyboard", "type", "Before");
    await js("(()=>{let release;window.__gate=new Promise((r)=>release=r);window.__release=release;window.__fetch=window.fetch;window.fetch=async(u,o)=>{if(String(u).includes('/.atelier/image'))await window.__gate;return window.__fetch(u,o)};return true})()");
    const before = rlog("decide").length;
    await click("[data-atl=decide][data-id=lock][data-label=Ship]"); await sleep(200);
    await click(`${lk} .atl-note`); await b("keyboard", "type", " after"); await sleep(200);
    const shown = await js(`document.querySelector('${lk} .atl-note').value.trim()`);
    await js("(()=>{window.__release();return true})()");
    await until("atelier.state().decisions.find((d)=>d.id==='lock').answer==='Ship'");
    await sleep(300);
    await js("(()=>{window.fetch=window.__fetch;return true})()");
    const posted = rlog("decide").slice(before).at(-1);
    assert.deepEqual({ note: posted?.note, images: posted?.images?.length }, { note: shown, images: 1 }, "a Decision's note is locked while its image uploads: what posts is what it showed");
  }
  // A read that fails (the file was deleted after it was picked) posts nothing, says so, and keeps the draft.
  const failReads = () => js("(()=>{let release;window.__rgate=new Promise((r)=>release=r);window.__rrelease=release;FileReader.prototype.readAsDataURL=function(){window.__rgate.then(()=>this.onerror?.(new ProgressEvent('error')))};return true})()");
  const toldUnread = "[...document.querySelectorAll('.atl-toast')].some((t)=>/could not be read/.test(t.textContent))";
  { // review2-blocker2-comment-failed-read-posts-nothing
    await failReads();
    await b("hover", "#c"); await sleep(300);
    await click('[atl-ui=pin][data-key="c"] .atl-add');
    await until("document.activeElement?.matches('[atl-ui=composer] textarea')");
    await b("keyboard", "type", "Lost picture");
    await b("upload", "[atl-ui=composer] .atl-file", racePng);
    const before = rlog("comment").length;
    await click("[atl-ui=composer] [type=submit]"); await sleep(200);
    await js("(()=>{window.__rrelease();return true})()"); await sleep(500);
    const after = await js(`({text:document.querySelector('[atl-ui=composer] textarea')?.value,told:${toldUnread},focus:document.activeElement?.matches('[atl-ui=composer] textarea')??false})`);
    assert.deepEqual({ posted: rlog("comment").length - before, text: after.text, told: after.told, focus: after.focus }, { posted: 0, text: "Lost picture", told: true, focus: true }, "a failed image read posts no Comment, says so, keeps the draft and its focus");
    await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true");
  }
  { // review2-blocker2-decision-failed-read-posts-nothing
    await failReads();
    await b("upload", `${lk} .atl-file`, racePng);
    const before = rlog("decide").length;
    await click("[data-atl=decide][data-id=lock][data-label=Hold]"); await sleep(200);
    await js("(()=>{window.__rrelease();return true})()"); await sleep(500);
    assert.deepEqual({ posted: rlog("decide").length - before, answer: await js("atelier.state().decisions.find((d)=>d.id==='lock').answer"), told: await js(toldUnread) }, { posted: 0, answer: "Ship", told: true }, "a failed image read posts no answer and says so");
  }
  await js("(()=>{FileReader.prototype.readAsDataURL=window.__read;return true})()");
  assert.deepEqual((await b("errors")).errors ?? [], [], "no browser errors after the race checks");

  // 2.7.1 (Copilot review triage): each check runs on its own, so one run names every fix that is missing.
  const fails = [];
  const fixCheck = async (name, fn) => { try { await fn(); console.log(`ok ${name}`); } catch (e) { fails.push(name); console.log(`FAIL ${name}: ${e.message}`); } };
  const fixes = path.join(dir, "fixes.html");
  const writeFixes = (pageWip = false) => writeFile(fixes, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fixes</title>
<style>body{margin:16px;font:15px system-ui}[atl-key]{border:1px solid #ccc;padding:6px;margin:24px 0}#box{height:200px;overflow:auto;border:1px solid #999}#edge{position:absolute;right:8px;top:8px;width:40px;margin:0}</style>
<body${pageWip ? ' atl-wip="Rebuilding the whole Page"' : ""}><div id="box"><div style="height:300px"></div><div atl-key="inner" id="inner" atl-wip="Inner rework">Inside a scroller.</div><div style="height:400px"></div></div>
<span atl-key="edge" id="edge" atl-wip="A long label that cannot fit beside the right edge of the Page">Edge</span>
<div atl-key="ime" id="ime" atl-decide="Keep|Redo" atl-note="Redo">Typed with an input method.</div>
<script type="module" src="atelier.js"></script></body></html>`);
  await writeFixes();
  await b("set", "viewport", "1440", "900");
  await b("open", (await host.open(fixes)).url);
  await until("document.querySelector('.atl-conn')?.textContent==='live' && document.querySelectorAll('.atl-wip').length===2");
  const labelOf = (id) => `[...document.querySelectorAll('.atl-wip')].find((l)=>l.textContent===document.getElementById('${id}').getAttribute('atl-wip'))`;
  await fixCheck("2.7.1-fix1-wip-label-follows-inner-scroll", async () => {
    await js("document.getElementById('box').scrollTop=120; true");
    await js("new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))");
    const at = await js(`(()=>{const l=${labelOf("inner")}.getBoundingClientRect(),r=document.getElementById('inner').getBoundingClientRect();return {label:Math.round(l.top+l.height/2),region:Math.round(r.top)}})()`);
    assert(Math.abs(at.label - at.region) <= 1, `the label moves with its region inside a scroll container: ${JSON.stringify(at)}`);
  });
  await fixCheck("2.7.1-fix4-wip-label-clamped-at-right-edge", async () => {
    const at = await js(`(()=>{const l=${labelOf("edge")}.getBoundingClientRect(),vw=document.documentElement.clientWidth;return {right:Math.round(l.right),vw,scrollW:document.documentElement.scrollWidth}})()`);
    assert(at.right <= at.vw && at.scrollW <= at.vw, `a long label at the right edge stays on screen and the Page does not scroll sideways: ${JSON.stringify(at)}`);
  });
  await fixCheck("2.7.1-fix5-enter-while-composing-posts-nothing", async () => {
    const ime = '[atl-ui=decide][aria-label="Decision on ime"]', n = () => readLog(fixes).filter((e) => e.type === "decide").length;
    const enter = (sel, composing) => js(`document.querySelector('${sel}').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:${composing},bubbles:true,cancelable:true})); true`);
    await click(`${ime} [data-atl=other]`);
    await until(`document.activeElement===document.querySelector('${ime} .atl-ownans')`);
    await b("keyboard", "type", "Halb");
    await enter(`${ime} .atl-ownans`, true); await sleep(500);
    assert.equal(n(), 0, "Enter while composing in the own answer posts nothing");
    await enter(`${ime} .atl-ownans`, false);
    await until("atelier.state().decisions.find((d)=>d.id==='ime').answer==='Halb'"); // the same event without composing posts
    await click("[data-atl=decide][data-id=ime][data-label=Redo]");
    await until(`document.activeElement===document.querySelector('${ime} .atl-note')`);
    await b("keyboard", "type", "hal");
    await enter(`${ime} .atl-note`, true); await sleep(500);
    assert.equal(n(), 1, "Enter while composing in a required note posts nothing");
  });
  await fixCheck("2.7.1-fix3-page-wide-wip-locks-decisions-without-key", async () => {
    await js("window.uf=0; document.addEventListener('atelier:update',()=>uf++); true");
    await writeFixes(true); host.update(fixes); await until("uf===1");
    host.agent(fixes, { type: "ask", decision: { id: "orphan", key: "nowhere", question: "Keep the draft?", options: [{ label: "Yes", consequence: "kept" }, { label: "No", consequence: "dropped" }] } });
    await until("document.querySelectorAll('[atl-ui=orphans] [data-atl=decide]').length===2");
    const opts = await js("[...document.querySelectorAll('[atl-ui=orphans] [data-atl=decide],[atl-ui=orphans] [data-atl=other]')].map((b)=>[b.disabled,b.title])");
    assert(opts.length === 3 && opts.every(([off, title]) => off && title === "Rebuilding the whole Page"), `a Decision without a Key is locked by a Page-wide atl-wip: ${JSON.stringify(opts)}`);
  });
  await fixCheck("2.7.1-fix2-mark-all-seen-renders-once", async () => {
    const many = path.join(dir, "many.html");
    const writeMany = (v) => writeFile(many, `<!doctype html><html lang="de"><meta charset="utf-8"><title>Many</title>
<style>body{margin:16px;font:11px system-ui;display:grid;grid-template-columns:repeat(8,1fr);gap:4px}[atl-key]{margin:0}</style>
<body>${Array.from({ length: 64 }, (_, i) => `<p atl-key="m${i}" id="m${i}">${v ? "Die überarbeitete Fassung von Satz" : "Die erste Fassung von Satz"} ${i}, mit ein paar Wörtern mehr.</p>`).join("")}
<script type="module" src="atelier.js"></script></body></html>`);
    await writeMany(false);
    await b("open", (await host.open(many)).url);
    await until("document.querySelector('.atl-conn')?.textContent==='live'");
    await js("window.um=0; document.addEventListener('atelier:update',()=>um++); true"); await sleep(500); // every Key seen once
    await writeMany(true); host.update(many); await until("um===1");
    await until("document.querySelectorAll('[atl-ui=rail] [data-atl=chrail]').length===64");
    // Every render of the marks sets each rail button's title once, so title writes count renders.
    const got = await js(`new Promise((done)=>{const rail=document.querySelector('[atl-ui=rail]');let total=0;const o=new MutationObserver((l)=>{total+=l.filter((m)=>m.attributeName==='title').length});o.observe(rail,{subtree:true,attributes:true,attributeFilter:['title']});const t0=performance.now();rail.querySelector('.atl-allseen').click();const ms=Math.round(performance.now()-t0),sync=o.takeRecords().filter((m)=>m.attributeName==='title').length;total+=sync;setTimeout(()=>{total+=o.takeRecords().length;o.disconnect();done({sync,total,ms,left:rail.querySelectorAll('[data-atl=chrail]').length})},900)})`);
    console.log(`2.7.1 Mark all seen on 64 marks ${JSON.stringify(got)}`);
    assert(got.sync <= 64 && got.total <= 128 && got.left === 0, `Mark all seen renders the marks once, not once per mark: ${JSON.stringify(got)}`);
  });
  // 2.8.0 (owner 2026-10-21): an answered asked Decision folds to one line, question and answer, so it stops filling the
  // beat it sits under; the line opens and closes the full Decision by keyboard too. An open Decision is unchanged.
  await fixCheck("2.8.0-answered-decision-folds-to-one-line", async () => {
    const fold = path.join(dir, "fold.html");
    await writeFile(fold, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fold</title><style>body{margin:16px;font:15px system-ui;max-width:700px}</style>
<body><div atl-key="beat" id="beat">A storyboard beat.</div><div atl-key="todo" id="todo">A beat still to decide.</div><script type="module" src="atelier.js"></script></body></html>`);
    const opts = [{ label: "Keep the gift shot", consequence: "the beat stays as cut" }, { label: "Cut it", consequence: "the beat loses two seconds" }];
    const q = "Should the gift shot stay in this beat, given that the hook already shows the gift once?";
    appendLog(fold, { origin: "agent", type: "ask", decision: { id: "gift", key: "beat", question: q, options: opts } }, Date.now() - 120_000);
    appendLog(fold, { origin: "human", type: "decide", decision: "gift", option: "Keep the gift shot", key: "beat", delivery: "immediate" }, Date.now() - 60_000);
    appendLog(fold, { origin: "agent", type: "ask", decision: { id: "todo", key: "todo", question: "Which ending?", options: opts } });
    await b("open", (await host.open(fold)).url);
    await until("document.querySelector('.atl-conn')?.textContent==='live' && document.querySelector('[data-id=\"d:todo\"] [data-atl=decide]')");
    const look = (id) => js(`(()=>{const c=document.querySelector('[data-id="d:${id}"]'),f=c.querySelector('[data-atl=fold]');return {folded:c.classList.contains('atl-folded'),h:Math.round(c.getBoundingClientRect().height),line:f?.textContent??null,expanded:f?.getAttribute('aria-expanded')??null,options:c.querySelectorAll('[data-atl=decide]').length,chosen:c.querySelector('.atl-chosen')?.dataset.label??null,consequences:c.querySelectorAll('.atl-opt .atl-dim').length,extra:!!c.querySelector('.atl-dextra')?.offsetParent,focus:document.activeElement===f}})()`);
    const shut = await look("gift");
    assert(shut.folded && shut.line?.includes("answered") && shut.line.includes("Should the gift shot stay") && shut.line.endsWith("Keep the gift shot") && shut.expanded === "false" && shut.options === 0 && !shut.extra && shut.h <= 36, `an answered Decision is one line with its question and answer: ${JSON.stringify(shut)}`);
    const todo = await look("todo");
    assert(!todo.folded && todo.line === null && todo.options === 2 && todo.extra, `an open Decision is unchanged: ${JSON.stringify(todo)}`);
    await js("document.querySelector('[data-id=\"d:gift\"] [data-atl=fold]').focus(); true");
    await b("press", "Enter");
    const open = await look("gift");
    assert(!open.folded && open.expanded === "true" && open.options === 2 && open.consequences === 2 && open.chosen === "Keep the gift shot" && open.extra && open.focus && open.h > shut.h, `activating the line opens the full Decision, focus kept: ${JSON.stringify(open)}`);
    await b("press", "Enter");
    const again = await look("gift");
    assert(again.folded && again.expanded === "false" && again.options === 0 && again.focus, `a second activation folds it again: ${JSON.stringify(again)}`);
    // A fresh answer stays open through its undo window, so it can still be changed or undone there, then folds.
    await click('[data-id="d:todo"] [data-atl=decide][data-label="Cut it"]');
    await until("atelier.state().decisions.find((d)=>d.id==='todo').answer==='Cut it'");
    const fresh = await look("todo");
    assert(!fresh.folded && fresh.options === 2 && fresh.chosen === "Cut it", `inside its undo window an answer stays open: ${JSON.stringify(fresh)}`);
    // A note being typed is never folded away under the human; folding by the line closes the note box.
    await click('[data-id="d:todo"] [data-atl=addnote]');
    await until("document.activeElement===document.querySelector('[data-id=\"d:todo\"] .atl-note')");
    await b("keyboard", "type", "half typed");
    await sleep(11_000);
    const typing = await look("todo");
    assert(!typing.folded && typing.expanded === "true" && typing.extra && await js("document.activeElement===document.querySelector('[data-id=\"d:todo\"] .atl-note')"), `an open note box keeps its Decision open after the undo window: ${JSON.stringify(typing)}`);
    await click('[data-id="d:todo"] [data-atl=fold]');
    const shutTodo = await look("todo");
    assert(shutTodo.folded && shutTodo.expanded === "false" && await js("document.querySelector('[data-id=\"d:todo\"] .atl-note').value") === "half typed", `the line folds it and keeps the typed note: ${JSON.stringify(shutTodo)}`);
  });
  assert.deepEqual(fails, [], "every 2.7.1 and 2.8.0 fix holds");

  console.log("PASS Kernel browser check: palette, a Key Comment floating beside its button without scrolling, an atl-comment Page button opening its Key's Comment beside it, thread markers that open the thread floating (read, reply, close, Esc, focus back), an Event Log from Kernel 2.3, hover button, composer, selection, keyboard, Decision replaced inside its undo window, required note, one undo row, dock, public state, Update keeps one body, its attributes and the human's details, a reply in a floating thread whose quote is rewritten, Tab to a plain-text Key, test-host mark, selection Comment at the selection, a Decision's note and picked and pasted images, an own answer through Other… on an asked and a declared Decision, the answer box below the options, a Comment's image, thread parts 6px apart, a refused image leaves the answer, a wide comment box on a narrow Key at 1440 and 390 px, Key UI that spans a grid or flex-row Key, a region under construction locks its Decisions until an Update unmarks it, change marks stay until Seen, opened and closed, or Mark all seen, the panel in a sticky column scrolls inside after Updates and under a transform, Other… after an abandoned required note, images still being read wait for Save and an answer, a saving Comment box is locked, a Decision is locked while its images upload, a failed image read posts nothing; 2.7.1: an atl-wip label follows an inner scroll and stays inside the right edge, a Page-wide atl-wip locks Decisions without a Key, Enter while composing posts nothing, Mark all seen renders once; 2.8.0: an answered Decision folds to one line that opens and closes it.");
} finally {
  await b("close").catch(() => {}); host.stop(); await rm(dir, { recursive: true, force: true });
}
