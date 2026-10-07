// Run from any directory. --browser uses the already-installed agent-browser CLI, no npm install.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url)), run = promisify(execFile);
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) out.push(...(e.isDirectory() ? await walk(join(dir, e.name)) : [join(dir, e.name)]));
  return out;
}
const files = await walk(root), index = await readFile(join(root, 'INDEX.md'), 'utf8');
const components = (await readdir(join(root, 'components'))).sort();
const patterns = (await readdir(join(root, 'patterns'))).sort();
assert.equal(components.length, 40); assert.equal(patterns.length, 11);
for (const name of components) {
  assert.equal(index.split(`](components/${name}/README.md)`).length - 1, 1, `Index Component ${name}`);
  const dir = join(root, 'components', name), list = await walk(dir);
  const readme = await readFile(join(dir, 'README.md'), 'utf8');
  assert.match(readme, /Kernel \/ Keys/); assert.match(readme, /Evidence and provenance/);
  await stat(join(dir, 'example.html'));
  const lines = (await Promise.all(list.map(async f => (await readFile(f, 'utf8')).trimEnd().split('\n').length))).reduce((a, b) => a + b, 0);
  assert(lines <= (name === 'review-bridge' ? 160 : 120), `${name}: ${lines} lines`);
}
for (const name of patterns) assert.equal(index.split(`](patterns/${name})`).length - 1, 1, `Index Pattern ${name}`);
let scripts = 0, links = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (extname(file) === '.md') for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(m[1])) continue;
    const [path, hash] = m[1].split('#'), target = path ? resolve(dirname(file), path) : file;
    await stat(target); links++;
    if (hash && extname(target) === '.md') {
      const doc = await readFile(target, 'utf8');
      const anchors = [...doc.matchAll(/^#+ (.+)$/gm)].map(m => m[1].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-'));
      assert(anchors.includes(hash) || doc.includes(`id="${hash}"`), `${relative(root, file)}: missing #${hash}`);
    }
  }
  if (extname(file) === '.html') {
    assert.match(text, /<html lang="de"/); assert.match(text, /<title>/);
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const src = /src="([^"]+)"/.exec(m[1]);
      if (src) { assert(!/^(https?:)?\/\//.test(src[1]), 'No external scripts'); await stat(resolve(dirname(file), src[1])); }
      else { new Script(m[2], { filename: relative(root, file) }); scripts++; }
    }
  }
  if (extname(file) === '.js') { new Script(text, { filename: relative(root, file) }); scripts++; }
}
console.log(`PASS: 40 Components, 11 Patterns, ${links} local Markdown links, ${scripts} parsed scripts; size ceiling 120 lines (bridge exception ≤160).`);
if (!process.argv.includes('--browser')) process.exit(0);

// A test-only loopback static server; production Pages use their own copied Kernel/server.
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = resolve(root, `.${pathname}`);
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (!file.startsWith(`${root}/`) || !['.html', '.js'].includes(extname(file))) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const session = `atelier-candidates-${process.pid}`, url = `http://127.0.0.1:${server.address().port}`;
async function browser(...args) {
  const { stdout } = await run('agent-browser', ['--session', session, '--json', ...args], { maxBuffer: 5_000_000, timeout: 60_000 });
  const result = JSON.parse(stdout); assert(result.success, JSON.stringify(result)); return result.data;
}
const interactions = {
  'collapsible-outline': `q('[popovertarget]').click(); ok(q('nav').matches(':popover-open'),'opens'); q('a').click(); ok(!q('nav').matches(':popover-open'),'closes');`,
  'section-switcher': `q('[data-panel="switch-run"]').click(); q('input').value='draft'; q('[data-panel="switch-audit"]').click(); ok(q('#switch-run').hidden,'switch'); location.hash='switch-draft'; await wait(60); ok(!q('#switch-run').hidden && q('input').value==='draft','reveal keeps draft');`,
  'variant-picker': `q('select').value='b'; q('select').dispatchEvent(new Event('change')); ok(!q('[data-variant=b]').hidden && new URL(location.href).searchParams.get('v')==='b','deep link');`,
  'review-filter': `ok(q('output').textContent.startsWith('1 /'),'pending'); q('select').value='all'; q('select').dispatchEvent(new Event('change',{bubbles:true})); ok(q('output').textContent.startsWith('3 /'),'all'); q('input').value='absent'; q('input').dispatchEvent(new Event('input',{bubbles:true})); ok(!q('.empty').hidden,'empty'); q('input').value=''; q('select').value='pending'; const row=q('[atl-key=video-c]'); row.dataset.processing='false'; row.dataset.openDecision='true'; q('select').dispatchEvent(new Event('change',{bubbles:true})); ok(q('output').textContent.startsWith('2 /'),'open Decision pending');`,
  'item-pager': `q('[data-delta="1"]').click(); ok(document.activeElement===q('article'),'next focuses'); q('input').focus(); q('input').dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true})); ok(document.activeElement===q('input'),'typing not hijacked'); q('article').focus(); q('article').dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true})); ok(document.activeElement===qa('article')[1],'keyboard navigation');`,
  'manual-turn': `q('[data-copy]').click(); await wait(100); ok(q('output').textContent.trim().length>0,'copy or selection fallback'); ok(!q('form').checkValidity(),'reply required');`,
  'edit-set': `ok(!q('form').checkValidity(),'note required'); q('textarea').value='reason'; ok(q('form').checkValidity(),'valid edit');`,
  'run-request': `ok(q('form').checkValidity(),'valid example'); q('[name=selection]').value=''; ok(!q('form').checkValidity(),'empty selection blocked');`,
  'action-dialog': `q('[data-open]').click(); ok(q('dialog').open,'modal opens'); q('form button').click(); ok(!q('dialog').open,'modal closes');`,
  'sparkline': `ok(qa('circle').length===3 && qa('line').length===1,'missing point not connected');`,
  'flow-map': `q('[data-view=stage]').click(); ok(!q('#map-stage').hidden,'stage'); q('[data-view=gate]').click(); ok(!q('#map-gate').hidden,'gate'); q('[data-view=overview]').click(); ok(q('#map-stage').hidden && !q('#map-overview').hidden,'overview');`,
  'named-flow': `q('select').value='retry'; q('select').dispatchEvent(new Event('change')); ok(qa('ol li').length===2 && qa('path.active').length===1,'scenario path and ordered text');`,
  'video-stage': `q('button').click(); ok(q('figure').classList.contains('small'),'small video'); q('button').click(); ok(!q('figure').classList.contains('small'),'large video');`,
  'safe-zone': `q('input').click(); ok(q('.zone').hidden,'overlay toggles'); ok(getComputedStyle(q('.zone')).pointerEvents==='none','overlay passes clicks');`,
  'frame-strip': `q('button').click(); ok(q('output').textContent.includes('laden'),'missing media handled');`,
  'viewport-frame': `q('select').value='390'; q('select').dispatchEvent(new Event('change')); await wait(100); ok(q('iframe').style.width==='390px','real CSS viewport'); ok(q('.stage').clientHeight>0,'scaled stage height');`,
  'state-stepper': `q('input').value='2'; q('input').dispatchEvent(new Event('input')); ok(!q('[data-state="2"]').hidden && q('[data-state="0"]').hidden,'state changed');`,
  'theme-switch': `q('button').click(); ok(root.classList.contains('dark'),'dark toggle'); ok(getComputedStyle(q('.media-swatch')).filter==='none','media untouched');`,
  'review-bridge': `
    for(let n=0;n<30 && q('[data-pick]').disabled;n++) await wait(50);
    ok(!q('[data-pick]').disabled,'bridge ready'); await wait(80);
    const frame=q('iframe'), w=frame.contentWindow, doc=frame.contentDocument, before=q('.state').textContent;
    ok(doc.querySelectorAll('[data-review-pins] button').length===1,'visible selector pin');
    dispatchEvent(new MessageEvent('message',{source:w,origin:'https://invalid.example',data:{type:'review-select',id:'send-failure'}}));
    dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'review-select',id:'send-failure'}}));
    ok(q('.state').textContent===before,'parent rejects wrong origin/source');
    w.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://invalid.example',data:{type:'review-items',items:[]}}));
    w.dispatchEvent(new MessageEvent('message',{source:w,origin:location.origin,data:{type:'review-items',items:[]}}));
    await wait(80); ok(doc.querySelectorAll('[data-review-pins] button').length===1,'target rejects wrong origin/source');
    const old=doc.querySelector('#target-send'); old.replaceWith(old.cloneNode(true)); await wait(80);
    ok(doc.querySelectorAll('[data-review-pins] button').length===1,'pin survives node replacement');
    doc.querySelector('[data-review-pins] button').click(); await wait(80); ok(q('.state').textContent.includes('gewählt'),'pin selects claim');
    q('[data-pick]').click(); await wait(80); doc.querySelector('#target-send').click(); await wait(80);
    ok(!q('section').hidden && JSON.parse(q('[name=locator]').value).cssPath==='#target-send','pick returns precise locator');
    const saved=q('[name=locator]').value; dispatchEvent(new MessageEvent('message',{source:w,origin:location.origin,data:{type:'review-picked',locator:{cssPath:17}}}));
    ok(q('[name=locator]').value===saved,'bad locator rejected');
    const cyclic={...JSON.parse(saved)}; cyclic.extra=cyclic;
    dispatchEvent(new MessageEvent('message',{source:w,origin:location.origin,data:{type:'review-picked',locator:cyclic}}));
    ok(!('extra' in JSON.parse(q('[name=locator]').value)),'only allowlisted locator fields copied');
    q('[data-pick]').click(); await wait(50); q('[data-cancel]').click(); await wait(50); ok(doc.body.style.cursor==='','picker cancels');`,
};
let opened = 0, exercised = 0;
try {
  for (const file of files.filter(f => f.endsWith('.html')).sort()) {
    await browser('open', `${url}/${relative(root, file)}`);
    const name = relative(root, file).split('/')[1];
    const code = file.endsWith('/example.html') ? interactions[name] ?? '' : '';
    await browser('eval', `(async()=>{
      const root=document.querySelector('main')||document.body,q=s=>root.querySelector(s),qa=s=>[...root.querySelectorAll(s)];
      const ok=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
      const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);ok(ids.length===new Set(ids).size,'unique HTML IDs');
      const keys=qa('[atl-key]').map(e=>{const a=[];for(let n=e;n;n=n.parentElement?.closest('[atl-key]'))a.unshift(n.getAttribute('atl-key'));return a.join('/')});ok(keys.length===new Set(keys).size,'unique nested Keys');
      qa('a[href^="#"]').forEach(a=>ok(document.getElementById(a.hash.slice(1)),'anchor target'));
      qa('button').forEach(b=>ok(b.textContent.trim()||b.getAttribute('aria-label'),'named button'));
      ${code}
      return {checked:true};
    })()`);
    const errors = await browser('errors');
    assert.deepEqual(errors.errors ?? [], [], `${name}: page errors`);
    opened++; if (code) exercised++;
    console.log(`PASS browser: ${relative(root, file)}${code ? ' + interactions' : ''}`);
  }
  console.log(`PASS: ${opened} HTML opens, ${exercised} interaction checks, no uncaught page errors.`);
} finally {
  await browser('close').catch(() => {});
  server.closeAllConnections(); await new Promise(ok => server.close(ok));
}
