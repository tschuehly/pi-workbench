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
const write = ({ plain = "A plain keyed paragraph.", dock = "", phrase = "Pick this phrase to comment on it.", flip = false, body = "" } = {}) => writeFile(page, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Kernel check</title>
<style>body{font:15px/1.5 system-ui;max-width:700px;margin:24px auto;background:#fff;color:#111}section,div[atl-key],p[atl-key]{border:1px solid #ccc;padding:8px;margin:8px 0}</style>
<body${body}>${dock}<p id="intro">Select this sentence to comment on the text itself.</p>
<p atl-key="plain" id="plain">${plain}</p>
<section atl-key="run" atl-ver="v1" id="run"><h2>Run</h2>
<div atl-key="turn-1" id="t1" atl-decide="1|2|3|4|5">Turn one answer text.</div>
<div atl-key="turn-2" id="t2" atl-decide="Confirm|Redo" atl-rec="Confirm" atl-note="Redo">Turn two answer.</div></section>
<details id="more"${flip ? " open" : ""}><summary id="more-s">More</summary><p>Inside.</p></details><details id="less"${flip ? "" : " open"}><summary id="less-s">Less</summary><p>Open by the Page.</p></details>
<p atl-key="quiet" id="quiet">Plain text with nothing focusable.</p>
<table><tr atl-key="row-a" id="ra" atl-decide="Keep|Drop"><td>Row A</td><td atl-slot id="slot"></td></tr></table>
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
  assert.deepEqual(await js(`(${turn1})(atelier.state())`), { id: "run/turn-1", key: "run/turn-1", declared: true, options: ["1", "2", "3", "4", "5"], recommended: null, answer: "5", previous: "3", note: null, status: "pending", stale: false, opened: false });
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
  await js("document.querySelector('[data-id=\"row-a\"][data-label=Drop]').focus(); true");
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

  console.log("PASS Kernel browser check: palette, hover button, badge, composer, thread, selection, keyboard, Decision replaced inside its undo window, required note, one undo row, dock, public state, Update keeps one body, its attributes and the human's details, a reply under a rewritten quote, Tab to a plain-text Key, test-host mark, selection Comment at the selection.");
} finally {
  await b("close").catch(() => {}); host.stop(); await rm(dir, { recursive: true, force: true });
}
