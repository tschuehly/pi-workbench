// Real-browser check of the Kernel's human controls (decision 155). Needs agent-browser and PI_TMP:
//   node extensions/atelier/kernel-check.mjs [screenshot.png]
// Serves a light Page through the real host and drives it with real pointer and keyboard input.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createHost, readLog } from "./index.ts";

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

  // Comment through the hover button; the composer is styled from the palette.
  await b("hover", "#plain"); await sleep(300);
  await click('[atl-ui=pin][data-key="plain"] .atl-add');
  await until("document.querySelector('[atl-ui=composer] textarea')===document.activeElement");
  const look = await js(`(()=>{const s=(q)=>getComputedStyle(document.querySelector(q));const t=s('[atl-ui=composer] textarea'),v=s('[atl-ui=composer] [type=submit]'),c=s('[atl-ui=composer] [data-atl=dismiss]'),l=s('[atl-ui=composer] .atl-label');return [t.backgroundColor,t.borderTopWidth,t.borderTopColor,t.borderTopLeftRadius,t.resize,parseFloat(t.minHeight)>=60,v.backgroundColor,v.color,c.backgroundColor,c.borderTopLeftRadius===v.borderTopLeftRadius&&c.height===v.height,l.color]})()`);
  assert.deepEqual(look, ["rgb(255, 255, 255)", "1px", "rgb(9, 105, 218)", "8px", "vertical", true, "rgb(9, 105, 218)", "rgb(255, 255, 255)", "rgb(255, 255, 255)", true, "rgb(89, 99, 110)"], "composer: page background, accent focus border, 8px radius, accent Save, quiet Cancel, muted label");
  await b("keyboard", "type", "Needs a source.");
  await click("[atl-ui=composer] [type=submit]");
  await until("document.querySelector('[atl-ui=key][data-key=plain] .atl-msg')!==null");
  const root = readLog(page).find((e) => e.type === "comment");
  host.agent(page, { type: "answer", target: root.seq, text: "Added the source." });
  await until("document.querySelectorAll('[atl-ui=key][data-key=plain] .atl-msg').length===2");
  assert.deepEqual(await js("[...document.querySelectorAll('[atl-ui=key][data-key=plain] .atl-msg')].map(m=>[m.className,m.querySelector('b').textContent])"), [["atl-msg atl-you", "You"], ["atl-msg atl-agent", "Agent"]], "whole thread in order, You and Agent distinct");
  await b("mouse", "move", "1", "1"); await sleep(300);
  assert.equal(await opacity("plain"), "1", "a Key with threads keeps its count badge");
  assert.deepEqual(await buttons(), ["plain"]);
  assert.equal(await js("document.querySelector('[atl-ui=pin][data-key=plain] .atl-add').textContent"), "1");

  // Closing collapses the thread to one line; its messages open and collapse again on demand.
  const msgsIn = "document.querySelectorAll('[atl-ui=key][data-key=plain] .atl-msg').length";
  await js("document.querySelector('[atl-ui=key][data-key=plain] [data-atl=close]').click(); true");
  await until(`${msgsIn}===0`);
  assert.match(await js("document.querySelector('[atl-ui=key][data-key=plain] [data-atl=expand]').textContent"), /2 messages/);
  await js("document.querySelector('[atl-ui=key][data-key=plain] [data-atl=expand]').click(); true");
  await until(`${msgsIn}===2`);
  await js("document.querySelector('[atl-ui=key][data-key=plain] [data-atl=collapse]').click(); true");
  await until(`${msgsIn}===0`);

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
  await until("document.querySelector('[atl-ui=key][data-key=long] .atl-msg')!==null");
  assert.equal(await js("scrollY"), y0, "saving does not scroll either");
  assert.equal(await js("document.getElementById('phrase').nextElementSibling?.querySelector('.atl-msg>div:last-child')?.textContent"), "Here.", "the saved thread sits right under its paragraph, not at the Key's end");
  assert.equal(await js("CSS.highlights.has('atl-pending')"), false, "the pending highlight goes with the editor");
  await js("window.u6=0; document.addEventListener('atelier:update',()=>u6++); true");
  host.update(page); await until("u6===1");
  assert.equal(await js("document.getElementById('phrase').nextElementSibling?.querySelector('.atl-msg>div:last-child')?.textContent"), "Here.", "and stays there through an Update");
  await js("document.querySelector('[data-atl=undo]').click(); true");
  await until("document.querySelector('[atl-ui=key][data-key=long] .atl-msg')===null");
  // Review 2 finding 1: an unsaved reply under a quoted paragraph survives an Update that rewrites the quote.
  const onQuote = host.postHuman(page, { type: "comment", key: "long", quote: { exact: "Pick this phrase", prefix: "", suffix: "" }, text: "Quoted." }).json.entry;
  await until("document.getElementById('phrase').nextElementSibling?.matches('.atl-at-quote')");
  await js(`document.querySelector('.atl-at-quote [data-atl=reply][data-seq="${onQuote.seq}"]').click(); true`);
  await until("document.activeElement?.matches('.atl-at-quote [atl-ui=composer] textarea')");
  await b("keyboard", "type", "Unsaved reply.");
  await write({ phrase: "Pick that phrase, rewritten." }); host.update(page); await until("u6===2");
  assert.deepEqual(await js("(()=>{const t=document.querySelector('[atl-ui=composer] textarea');return [t?.value??null, document.activeElement===t, !!t?.closest('[atl-ui=key][data-key=long]')]})()"), ["Unsaved reply.", true, true], "the reply keeps its text and focus and moves to its Key");
  await js("document.querySelector('[atl-ui=composer] [data-atl=dismiss]').click(); true");
  await write(); host.update(page); await until("u6===3");
  await js("scrollTo(0,0); true");

  // A Page-declared Decision: the first answer is delivered; a change inside the next undo window replaces the
  // unsent one, so the agent gets one "3 → 5" (156).
  const choose = async (v) => { await click(`[data-atl=decide][data-id="run/turn-1"][data-label="${v}"]`); await until(`document.querySelector('[data-id="run/turn-1"][data-label="${v}"]').classList.contains('atl-chosen')`); };
  await choose("3"); await sleep(3100); host.deliverDue(page);
  await choose("4"); await choose("5");
  assert.deepEqual(decides().map((e) => [e.decision, e.option, e.previous, e.options, e.ver]), [["run/turn-1", "3", undefined, "1|2|3|4|5", "v1"], ["run/turn-1", "4", "3", "1|2|3|4|5", "v1"], ["run/turn-1", "5", "3", "1|2|3|4|5", "v1"]]);
  assert.deepEqual(readLog(page).filter((e) => e.type === "undo" && decides().some((d) => d.seq === e.target)).map((e) => e.target), [decides()[1].seq], "the unsent 4 is undone");
  assert.match(await js("document.querySelector('[atl-ui=decide] .atl-dstate').textContent"), /Your answer: 5 · changed from 3/);
  assert.match(await js("document.querySelector('.atl-bar').textContent"), /2 to answer/);
  // k-state-hook: Pages read Kernel state through window.atelier and the atelier:state event, not Kernel markup.
  const turn1 = "(s)=>s.decisions.find((d)=>d.id==='run/turn-1')";
  assert.deepEqual(await js(`(${turn1})(atelier.state())`), { id: "run/turn-1", key: "run/turn-1", declared: true, options: ["1", "2", "3", "4", "5"], recommended: null, answer: "5", previous: "3", note: null, images: [], status: "pending", stale: false, opened: false });
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
    assert(fits(wide) && wide.inKey === (w === "1440"), `${w}px: a wide Key keeps the box inside it where it fits: ${JSON.stringify(wide)}`);
    await dismiss();
  }
  await js("window.un=0; document.addEventListener('atelier:update',()=>un++); true");
  await openOn("f1"); await b("keyboard", "type", "Unsaved on a frame.");
  await writeNarrow("Frame, rewritten,"); host.update(narrow); await until("un===1");
  assert.deepEqual(await js("(()=>{const t=document.querySelector('[atl-ui=composer] textarea');return [t?.value??null, document.activeElement===t]})()"), ["Unsaved on a frame.", true], "the popped box keeps its text and focus through an Update");
  assert(fits(await composerAt()), "and stays on screen");
  await click("[atl-ui=composer] [type=submit]");
  await until("document.querySelector('[atl-ui=key][data-key=f1] [data-atl=reply]')!==null");
  await js("document.querySelector('[atl-ui=key][data-key=f1] [data-atl=reply]').click(); true");
  await until("document.activeElement?.matches('[atl-ui=composer] textarea')");
  const reply = await composerAt();
  assert(fits(reply) && /^Reply/.test(await js("document.querySelector('[atl-ui=composer] .atl-label').textContent")), `a reply in a narrow Key's thread is wide enough too: ${JSON.stringify(reply)}`);
  await dismiss();

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

  console.log("PASS Kernel browser check: palette, hover button, badge, composer, thread, selection, keyboard, Decision replaced inside its undo window, required note, one undo row, dock, public state, Update keeps one body, its attributes and the human's details, a reply under a rewritten quote, Tab to a plain-text Key, test-host mark, selection Comment at the selection, a Decision's note and picked and pasted images, a refused image leaves the answer, a wide comment box on a narrow Key at 1440 and 390 px, the panel in a sticky column scrolls inside after Updates and under a transform.");
} finally {
  await b("close").catch(() => {}); host.stop(); await rm(dir, { recursive: true, force: true });
}
