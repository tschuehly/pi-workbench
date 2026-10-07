// From any cwd: node check.mjs [--browser]. No installed checkout or real Page is modified.
import assert from 'node:assert/strict';
import { readFile, readdir, stat, cp, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { checks } from './browser-checks.mjs';

const root=dirname(fileURLToPath(import.meta.url)), run=promisify(execFile);
async function walk(dir) {
  const files=[];
  for(const e of await readdir(dir,{withFileTypes:true}))files.push(...(e.isDirectory()?await walk(join(dir,e.name)):[join(dir,e.name)]));
  return files;
}
const files=await walk(root), index=await readFile(join(root,'INDEX.md'),'utf8');
const components=(await readdir(join(root,'components'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
const patterns=(await readdir(join(root,'patterns'))).filter(n=>n.endsWith('.md')).sort();
const scripted=new Set();let links=0;
for(const name of components) {
  assert.equal(index.split(`](components/${name}/README.md)`).length-1,1,`Index Component ${name}`);
  await stat(join(root,'components',name,'README.md'));
  const html=await readFile(join(root,'components',name,'example.html'),'utf8');
  assert.match(html,/<script type="module" src="atelier.js"><\/script>/,`${name}: loads real copied Kernel`);
}
for(const name of patterns) {
  assert.equal(index.split(`](patterns/${name})`).length-1,1,`Index Pattern ${name}`);
  const text=await readFile(join(root,'patterns',name),'utf8');
  const refs=[...text.matchAll(/\]\(\.\.\/components\/([^/]+)\/README\.md\)/g)];
  assert(refs.length,`${name}: names Components`);
  for(const [,component] of refs)assert(components.includes(component),`${name}: missing Component ${component}`);
}
for(const file of files) {
  const text=await readFile(file,'utf8');
  if(extname(file)==='.md')for(const [,href] of text.matchAll(/\]\(([^)]+)\)/g)) {
    if(/^https?:/.test(href))continue;
    const [path,hash]=href.split('#'), target=path?resolve(dirname(file),path):file;
    await stat(target);links++;
    if(hash&&extname(target)==='.md') {
      const doc=await readFile(target,'utf8');
      const anchors=[...doc.matchAll(/^#+ (.+)$/gm)].map(m=>m[1].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/ /g,'-'));
      assert(anchors.includes(hash)||doc.includes(`id="${hash}"`),`${file}: missing #${hash}`);
    }
  }
  if(extname(file)==='.html')for(const [,attrs,body] of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src=/src="([^"]+)"/.exec(attrs)?.[1];
    if(src==='atelier.js')continue;
    scripted.add(relative(root,file).split('/')[1]);
    if(src) {assert(!/^(https?:)?\/\//.test(src),'no external dependency');await stat(resolve(dirname(file),src));}
    else {const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:body,encoding:'utf8'});assert.equal(result.status,0,`${file}: ${result.stderr}`);}
  }
  if(['.js','.mjs'].includes(extname(file)))assert.equal(spawnSync(process.execPath,['--check',file]).status,0,`syntax ${file}`);
}
assert.deepEqual([...scripted].sort(),Object.keys(checks).sort(),'Every scripted Component has an Update-survival scenario; no stale scenarios');
console.log(`PASS static: ${components.length} Components, ${patterns.length} Patterns, ${links} links, ${scripted.size} scripted Components covered.`);
if(!process.argv.includes('--browser'))process.exit(0);

// Use the same host.update called by the atelier tool: real SSE -> Kernel morph -> atelier:update.
const {createHost}=await import('../index.ts');
assert(process.env.PI_TMP,'Set PI_TMP to a disposable directory (fixtures are removed in finally).');
const tmp=await realpath(await mkdtemp(join(process.env.PI_TMP,'atelier-catalogue-')));
const host=createHost({root:tmp,send:()=>{}}), session=`atelier-catalogue-${process.pid}`;
async function browser(...args) {
  const {stdout}=await run('agent-browser',['--session',session,'--json',...args],{maxBuffer:5_000_000,timeout:60_000});
  const result=JSON.parse(stdout);assert(result.success,JSON.stringify(result));return result.data;
}
const evaluate=code=>browser('eval',code);
const phase=fn=>evaluate(`(${fn.toString().replace(/^async (\w+)\(/,'async function $1(')})()`);
function setup() {
  const q=s=>document.querySelector(s), ok=(v,m)=>{if(!v)throw Error(m);};
  window.C={q,ok,
    until:async f=>{for(let n=0;n<150;n++){if(f())return;await new Promise(r=>setTimeout(r,40));}throw Error(`Timed out: ${f}`);},
    input:(selector,value)=>{const el=q(selector);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},
    post:async body=>{const page=decodeURIComponent(location.pathname.slice(1));const r=await fetch(`/.atelier/events?page=${encodeURIComponent(page)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});ok(r.ok,'real host accepts event');return(await r.json()).entry;},
    hit:el=>{ok(el,'element exists');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);ok(r.width>0&&r.height>0&&(el===hit||el.contains(hit)),'Kernel control/thread is not clipped or covered');},
  };
  window.updates=0;document.addEventListener('atelier:update',()=>updates++);
  ok(globalThis.__atelierKernel&&q('[atl-ui=panel]'),'real Kernel booted');
  ok(parseFloat(getComputedStyle(q('main h1')).fontSize)>=1.25*parseFloat(getComputedStyle(q('main')).fontSize),'native heading hierarchy (static detector cannot infer UA sizes)');
  const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);ok(ids.length===new Set(ids).size,'unique IDs');
  const keys=[...document.querySelectorAll('[atl-key]')].map(el=>{const parts=[];for(let n=el;n;n=n.parentElement?.closest('[atl-key]'))parts.unshift(n.getAttribute('atl-key'));return parts.join('/');});
  ok(keys.length===new Set(keys).size,'unique nested Keys');
}
// A tiny silent WAV exercises real media time/Range without shipping assets or requiring ffmpeg.
function wav() {
  const samples=8000*3, b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);return b;
}
let morphs=0;
try {
  for(const name of components) {
    const dir=join(tmp,name);await cp(join(root,'components',name),dir,{recursive:true});
    const page=join(dir,'example.html');let html=await readFile(page,'utf8');
    if(name==='video-stage'){await writeFile(join(dir,'probe.wav'),wav());html=html.replace('<video id="review-video"','<video src="probe.wav" id="review-video"');}
    const authored=html.replace('</body>','<p id="check-revision">REVISION</p></body>');
    await writeFile(page,authored.replace('REVISION','0'));const {url}=await host.open(page);
    if(name==='review-filter') {
      host.postHuman(page,{type:'verdict',key:'queue/item-b',ver:'artifact-b1',scale:'Confirm|Redo',value:'Confirm'});
      for(const key of ['queue/item-c','queue/item-d'])host.agent(page,{type:'ask',decision:{id:key,key,question:'Example?',options:[{label:'Keep',consequence:'Keep it',recommended:true},{label:'Change',consequence:'Rework it'}]}});
    }
    if(name==='review-bridge')host.postHuman(page,{type:'comment',key:'trial-app',ver:'build-example-1',text:'Saved thread outside the clipping stage'});
    await browser('open',url);await browser('wait','--fn',"document.querySelector('.atl-conn')?.textContent==='live'");
    await phase(setup);
    if(name==='video-stage')assert.equal((await fetch(new URL('probe.wav',url),{headers:{Range:'bytes=0-31'}})).status,206,'real host Range support');
    const scenario=checks[name];
    if(scenario){await phase(scenario.prepare);await phase(scenario.verify);}
    async function update(revision,verify) {
      await writeFile(page,authored.replace('REVISION',String(revision)));
      assert(host.update(page)>0,`${name}: connected tab receives atelier update`);
      await browser('wait','--fn',`updates===${revision}&&document.getElementById('check-revision').textContent==='${revision}'`);
      if(verify)await phase(verify);morphs++;
    }
    await update(1,scenario?.verify);
    if(scenario){await update(2,scenario.verify);await phase(scenario.change);await phase(scenario.verifyChanged);await update(3,scenario.verifyChanged);}
    const errors=await browser('errors');assert.deepEqual(errors.errors??[],[],`${name}: no browser errors`);
    console.log(`PASS Kernel: ${name}${scenario?' · state survives repeated Updates and later interactions':' · loaded + morphed'}`);
  }
  console.log(`PASS browser: ${scripted.size} scripted Components survive real Kernel Updates; ${morphs} morphs; B2 hit tests and bridge validation pass.`);
} finally {
  await browser('close').catch(()=>{});host.stop();await rm(tmp,{recursive:true,force:true});
}
