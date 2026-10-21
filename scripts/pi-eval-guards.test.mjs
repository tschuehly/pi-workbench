import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync, readdirSync, symlinkSync, utimesSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, commandTimeout, requireDisk, createGradleGuard, removeGradleGuard, copyToolGuard, sandboxProfile, runProcess, hash } from './pi-eval/safety.mjs';
import { judgePasses, JUDGES, JUDGE_SYSTEM } from './pi-eval/quality.mjs';
import { scanSessions, validateCommandPolicy, run, runPi, prepareWorkspace, check } from './pi-eval.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = process.env.PI_TMP;
assert.ok(tmp, 'PI_TMP is required (never use /tmp)');
mkdirSync(tmp, { recursive: true });
if(process.env.PI_EVAL_TEST_EVIDENCE) mkdirSync(process.env.PI_EVAL_TEST_EVIDENCE,{recursive:true});
const area = mkdtempSync(path.join(tmp, 'eval-guards-'));
const q = JSON.stringify;
const pause = (ms) => new Promise(r => setTimeout(r, ms));
function fakeProvider(commands = []) {
  return `import {writeFileSync} from 'node:fs';
import {createAssistantMessageEventStream,getCurrentSystemPrompt,getCurrentTools} from '@earendil-works/pi-ai';
export default function(pi) {
 let n=0; const inputs=[]; const commands=${JSON.stringify(commands)};
 pi.on('tool_call', e=>{inputs.push({...e.input});writeFileSync('probe.json',JSON.stringify(inputs));});
 pi.registerProvider('eval-fake',{api:'eval-local',apiKey:'not-a-credential',baseUrl:'http://invalid',models:[{id:'local',name:'Local fake',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:1024}],
 streamSimple(model,context) {
  writeFileSync('assembled.json',JSON.stringify({cwd:process.cwd(),roundToken:process.env.PI_EVAL_ROUND_TOKEN??null,tmpRoot:process.env.PI_TMP_ROOT,tmp:process.env.PI_TMP,executionKind:process.env.PI_WORKBENCH_EXECUTION_KIND??null,system:getCurrentSystemPrompt(context.messages),tools:getCurrentTools(context.messages),messages:context.messages.filter(m=>m.role==='user')}));
  const stream=createAssistantMessageEventStream(); const args=commands[n++];
  const m={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content:[],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'pending'};
  queueMicrotask(()=>{
   stream.push({type:'start',partial:m});
   if(args){const c={type:'toolCall',id:'fake-'+n,name:'bash',arguments:args};m.content=[c];stream.push({type:'toolcall_start',contentIndex:0,partial:m});stream.push({type:'toolcall_end',contentIndex:0,toolCall:c,partial:m});m.stopReason='toolUse';}
   else {m.content=[{type:'text',text:'done'}];stream.push({type:'text_start',contentIndex:0,partial:m});stream.push({type:'text_end',contentIndex:0,content:'done',partial:m});m.stopReason='stop';}
   stream.push({type:'done',reason:m.stopReason,message:m});stream.end();
  });return stream;
 }});
}`;
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
const groupAlive = pgid => alive(-pgid);
test.after(() => rmSync(area, { recursive: true, force: true }));

test('own trial scanner exempts only canonical literal absolute tokens', () => {
  const trial=path.join(area,'scanner'); mkdirSync(path.join(trial,'session-0'),{recursive:true});
  const pattern='/eval-guards-';
  const scan=command=>{writeFileSync(path.join(trial,'session-0','s.jsonl'),JSON.stringify({message:{content:[{type:'toolCall',arguments:{command}}]}}));return scanSessions(trial,[pattern,'/.pi-workbench/evals','NONPATH']);};
  assert.equal(scan(`head ${trial}/ws/new`).length,0);
  assert.equal(scan(`head '${trial}/ws/new'`).length,0);
  assert.ok(scan(`head $HOME\x22${trial}/ws/new\x22`).length);
  for(const p of [`${trial}-sibling/a`,`${trial}/../../outside/eval-guards-escape`, `~/.pi-workbench/evals/x`, '$HOME/.pi-workbench/evals/x', '${HOME}/.pi-workbench/evals/x', '`pwd`/.pi-workbench/evals/x', '$(pwd)/.pi-workbench/evals/x', 'NONPATH']) assert.ok(scan(p).length,p);
  assert.ok(scan(`${trial}/ws/new ~/.pi-workbench/evals/x`).length);
  symlinkSync(path.dirname(trial),path.join(trial,'escape'));
  assert.ok(scan(`${trial}/escape/eval-guards-outside`).length);
  assert.equal(scan(`${trial}/ws/new NONPATH`).length,1);
  assert.equal(scan(`${trial}/ws/NONPATH`).length,1);
});

test('all three frozen Node cases require exact per-entry waivers before dry/live subprocesses', async () => {
  const e=path.join(homedir(),'.pi-workbench/evals');
  for(const id of ['edge-http-cancellation-v2','edge-websocket-frames-v3','edge-rpc-broken-pipe-v2']) {
    const file=path.join(e,'cases',id,'case.json'), c=JSON.parse(readFileSync(file));
    assert.throws(()=>validateCommandPolicy({},c,file),/waiver/i);
    const waiver={reason:'Existing 15-minute command cap plus focused trusted checks',caseHash:hash(readFileSync(file))};
    assert.equal(validateCommandPolicy({commandPolicyWaiver:waiver},c,file).caseHash,waiver.caseHash);
    for(const w of [{...waiver,reason:''},{...waiver,caseHash:'0'.repeat(64)}]) assert.throws(()=>validateCommandPolicy({commandPolicyWaiver:w},c,file),/waiver/i);
  }
});

test('dry/live waiver failures precede all subprocesses and dry-run validates all three shapes without launches', async () => {
  const dir=path.join(area,'admission'), campaign=path.join(dir,'campaigns','next-round-900.json'); mkdirSync(path.dirname(campaign),{recursive:true});
  symlinkSync(path.join(homedir(),'.pi-workbench/evals/cases'),path.join(dir,'cases'));
  for(const id of ['edge-http-cancellation-v2','edge-websocket-frames-v3','edge-rpc-broken-pipe-v2']) {
    const data={id:'next-round-900',admitAs:'implementation',repetitions:1,arms:{a:{model:'anthropic/claude-sonnet-5-5',effort:'medium'}},cases:[{case:id,arms:['a']}]};
    writeFileSync(campaign,JSON.stringify(data));
    for(const dryRun of [true,false]) await assert.rejects(run(campaign,{dryRun}),/waiver/i);
    data.cases[0].commandPolicyWaiver={reason:'Existing 15-minute command cap plus focused trusted checks',caseHash:hash(readFileSync(path.join(dir,'cases',id,'case.json')))};
    writeFileSync(campaign,JSON.stringify(data));
    await run(campaign,{dryRun:true});
  }
  assert.equal(existsSync(path.join(dir,'results')),false);
  const catalog=path.join(dir,'catalog.txt'), quota=path.join(dir,'quota.json'), metadata=path.join(dir,'models.json');
  writeFileSync(catalog,'anthropic claude-sonnet-5-5 1M 128K yes yes\nopenai-codex gpt-6-luna 272K 128K yes yes\n');
  writeFileSync(quota,JSON.stringify({providers:['claude','codex'].map(provider=>({provider,state:{status:'fresh',stale:false},windows:[{id:'weekly',kind:'weekly',percentRemaining:90}]}))}));
  writeFileSync(metadata,JSON.stringify({anthropic:{models:[{id:'claude-sonnet-5-5',reasoning:true}]},'openai-codex':{models:[{id:'gpt-6-luna',reasoning:true,thinkingLevelMap:{max:'max'}}]}}));
  for(const [model,effort] of [['anthropic/claude-sonnet-5-5','medium'],['openai-codex/gpt-6-luna','max']]) {
    const args=['--model',model,'--effort',effort,'--catalog',catalog,'--quota',quota,'--model-metadata',metadata];
    const resolver=path.join(root,'skills/model-orchestration/scripts/resolve-runtime-binding.mjs');
    const negative=await runProcess(process.execPath,[resolver,'frontier',...args]);
    // max meets the floor: Sonnet medium is the deliberately below-frontier negative.
    if(effort==='medium') {assert.notEqual(negative.status,0);assert.match(negative.stderr,/needs at least Model Effort 'xhigh'/);}
    const positive=await runProcess(process.execPath,[resolver,'implementation',...args]);
    assert.equal(positive.status,0,positive.stderr);const b=JSON.parse(positive.stdout).modelBinding;
    assert.equal(`${b.provider}/${b.model}`,model);assert.equal(b.effort,effort);
  }
});

test('absolute deadline shrinks after wait and crossing wait launches nothing', async () => {
  const marker=path.join(area,'deadline-marker');
  const r=await runProcess('sleep',['10'],{timeoutMs:5000,deadlineAt:Date.now()+500,wait:()=>pause(300),beforeLaunch:()=>{}});
  assert.ok(r.timedOut); assert.ok(r.elapsedMs<400);
  await assert.rejects(runProcess('touch',[marker],{deadlineAt:Date.now()+50,wait:()=>pause(100),beforeLaunch:()=>{}}),/deadline/i);
  assert.equal(existsSync(marker),false);
  const smaller=await runProcess('sleep',['10'],{timeoutMs:50,deadlineAt:Date.now()+5000,beforeLaunch:()=>{}}); assert.ok(smaller.timedOut); assert.ok(smaller.elapsedMs<500);
  const invalid=await runProcess(process.execPath,['--input-type=module','-e',`await import(${q(path.join(root,'scripts/pi-eval/safety.mjs'))})`],{env:{...process.env,PI_EVAL_DEADLINE_AT:'invalid'},beforeLaunch:()=>{}});
  assert.notEqual(invalid.status,0); assert.match(invalid.stderr,/Invalid absolute/);
  const pidfile=path.join(area,'shell-cutoff.pid');
  assert.ok(shell(`trap '' TERM; sleep 20 & echo $! > ${q(pidfile)}; wait`,{deadlineAt:Date.now()+250,preflight:false}).timedOut);
  const pid=Number(readFileSync(pidfile)); try {for(let i=0;i<30&&alive(pid);i++) await pause(50);assert.equal(alive(pid),false);} finally {if(alive(pid)) process.kill(pid,'SIGKILL');}
  assert.throws(()=>shell('touch '+q(marker),{deadlineAt:Date.now()-1,preflight:false}),/deadline/i);
});

test('timeouts reject invalid values, clamp missing/large and honor small', () => {
  assert.equal(commandTimeout(), 900);
  assert.equal(commandTimeout(9000), 900);
  assert.equal(commandTimeout(.1), .1);
  for (const t of [0, -1, NaN, Infinity, '10', null, false]) assert.throws(() => commandTimeout(t), /timeout/i);
  assert.equal(shell('printf success').stdout, 'success');
  assert.equal(shell('exit 7').status, 7);
});

test('process capture preserves large UTF-8 and deterministically split multibyte output on both streams', async () => {
  const text = '—'.repeat(100000);
  const script = `import {writeSync} from 'node:fs';
    for (const fd of [1,2]) writeSync(fd, '—'.repeat(100000));
    for (const fd of [1,2]) writeSync(fd, Buffer.from([0xe2]));
    setTimeout(() => { for (const fd of [1,2]) writeSync(fd, Buffer.from([0x80,0x94])); }, 100);`;
  const r = await runProcess(process.execPath, ['--input-type=module', '-e', script]);
  assert.equal(r.status, 0);
  for (const stream of ['stdout', 'stderr']) {
    assert.equal(r[stream].includes('\ufffd'), false, `${stream}: corrupt UTF-8`);
    assert.equal(r[stream], text + '—', stream);
  }
});

test('completed trial record survives low-disk quotaAfter while the next launch is refused', async () => {
  const dir = path.join(area, 'quota-low-disk'), bin = path.join(dir, 'bin');
  const caseDir = path.join(dir, 'cases', 'local'), marker = path.join(dir, 'disk-low');
  mkdirSync(bin, {recursive:true}); mkdirSync(caseDir, {recursive:true});
  writeFileSync(path.join(caseDir, 'case.json'), JSON.stringify({id:'local',workspace:'empty',role:'implementation',check:{type:'script',script:'check.sh'}}));
  writeFileSync(path.join(caseDir, 'check.sh'), `touch ${q(marker)}; echo COMPLETED_CHECK`);
  const message = {role:'assistant',content:[{type:'text',text:'completed'}],stopReason:'stop',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,reasoning:0,cost:{total:.25}}};
  writeFileSync(path.join(bin, 'pi'), `#!/bin/bash\nif [[ "$1" == --list-models ]]; then echo local; else printf '%s\\n' '${JSON.stringify({type:'agent_end',messages:[message]})}'; fi\n`, {mode:0o700});
  writeFileSync(path.join(bin, 'quota-axi'), '#!/bin/bash\necho \'{"providers":[{"provider":"codex","state":{"status":"fresh"},"windows":[]}]}\'\n', {mode:0o700});
  const campaign = path.join(dir, 'campaigns', 'local.json'); mkdirSync(path.dirname(campaign));
  writeFileSync(campaign, JSON.stringify({id:'local-evidence',repetitions:2,arms:{local:{model:'eval-fake/local',effort:'off'}},cases:[{case:'local',arms:['local']}]}));
  const script = `import fs from 'node:fs'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
    const statfs=fs.statfsSync, spawnSync=cp.spawnSync, spawn=cp.spawn;
    // The fake executable must live inside the allowed trial, not inherited PI_TMP.
    cp.spawn=(cmd,args,opts)=>{
      if(cmd==='sandbox-exec') {
        const bin=opts.cwd+'/bin'; fs.cpSync(${q(bin)},bin,{recursive:true});
        opts={...opts,env:{...opts.env,PATH:bin+${q(path.delimiter)}+opts.env.PATH}};
      }
      return spawn(cmd,args,opts);
    };
    fs.statfsSync=(...args)=>fs.existsSync(${q(marker)})?{bavail:0,bsize:1}:statfs(...args);
    cp.spawnSync=(cmd,args,opts)=>args?.[0]===${q(path.join(root,'skills/model-orchestration/scripts/resolve-runtime-binding.mjs'))}?{status:0,stdout:JSON.stringify({modelBinding:{model:'local'}}),stderr:''}:spawnSync(cmd,args,opts);
    syncBuiltinESMExports();
    process.argv=[process.execPath,${q(path.join(root,'scripts/pi-eval.mjs'))},'run',${q(campaign)}];
    await import(${q(path.join(root,'scripts/pi-eval.mjs'))});`;
  const evalHome = path.join(dir, 'eval-home'), resultsRoot = path.join(evalHome, 'results');
  const r = await runProcess(process.execPath, ['--input-type=module','-e',script], {env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,PI_EVAL_HOME:evalHome,PI_TMP:evalHome}});
  assert.notEqual(r.status, 0); assert.match(r.stderr, /Disk preflight/);
  assert.equal(existsSync(marker), true, r.stdout+r.stderr);
  const trialRoot = path.join(resultsRoot, readdirSync(resultsRoot)[0]);
  const file = path.join(trialRoot, 'results.jsonl');
  assert.equal(existsSync(file), true, 'completed paid evidence must be appended before refusing the next launch');
  const rows = readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'done', JSON.stringify(rows[0])); assert.equal(rows[0].check.pass, true);
  assert.equal(rows[0].cost, .25); assert.equal(rows[0].runs[0].usage.output, 1);
  assert.equal(rows[0].quotaAfter[0].provider, 'codex'); assert.ok(rows[0].endedAt);
  assert.equal(existsSync(path.join(trialRoot, 't000/ws')), false);
  assert.equal(existsSync(path.join(trialRoot, 't001/ws')), false, 'no second workspace/launch below disk floor');
});

test('trusted shell actually kills TERM-ignoring process group, including ordinary child', async () => {
  for (const command of ['sleep 20', `trap '' TERM; sleep 20 & echo $! > ${q(path.join(area, 'pid'))}; wait`]) {
    const start = Date.now();
    const r = shell(command, { timeout: 250 });
    assert.ok(r.timedOut);
    assert.ok(Date.now() - start < 4000);
  }
  const pid = Number(readFileSync(path.join(area, 'pid'), 'utf8'));
  try { for (let i = 0; i < 30 && alive(pid); i++) await pause(50); assert.equal(alive(pid), false); }
  finally { if (alive(pid)) process.kill(pid, 'SIGKILL'); }
});

test('disk preflight fails closed; exact 20GB admitted; checked again after wait', async () => {
  for (const bytes of [0, 19_999_999_999, NaN, undefined]) assert.throws(() => requireDisk(() => bytes, () => {}), /disk/i);
  assert.equal(requireDisk(() => 20_000_000_000, () => {}), 20_000_000_000);
  let checks = 0;
  await assert.rejects(runProcess('true', [], { beforeLaunch: () => requireDisk(() => (++checks === 1 ? 30e9 : 0), () => {}), wait: async () => {} }), /disk/i);
  assert.equal(checks, 2);
});

test('low disk blocks new launches, not owned diff capture, cleanup or stopGradle', async () => {
  // Patch only this subprocess's filesystem probe, not a model-settable production bypass.
  const script=`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    fs.statfsSync=()=>({bavail:0,bsize:1}); syncBuiltinESMExports();
    const assert=(await import('node:assert/strict')).default;
    const {shell}=await import(${q(path.join(root,'scripts/pi-eval/safety.mjs'))});
    const {workspaceDiff,stopGradle}=await import(${q(path.join(root,'scripts/pi-eval.mjs'))});
    assert.throws(()=>shell('true'),/Disk preflight/);
    const dir=${q(path.join(area,'low-disk'))}; fs.mkdirSync(dir,{recursive:true});
    shell('git init -q && git -c user.name=eval -c user.email=eval@local commit -qm snapshot --allow-empty',{cwd:dir,preflight:false});
    fs.writeFileSync(dir+'/change.txt','retained diff'); assert.match(workspaceDiff(dir),/retained diff/);
    fs.mkdirSync(dir+'/gradle-agent'); fs.writeFileSync(dir+'/gradle-agent/daemon-'+process.pid+'.out.log',''); fs.writeFileSync(dir+'/gradlew','#!/bin/bash\\nprintf stopped > stopped\\n',{mode:0o700});
    assert.equal(await stopGradle(dir,[dir]),true); assert.equal(fs.readFileSync(dir+'/stopped','utf8'),'stopped');
    assert.equal(shell('printf cleanup',{preflight:false,timeout:1000}).stdout,'cleanup');
    assert.equal(shell('sleep 20',{preflight:false,timeout:100}).timedOut,true);`;
  const r=await runProcess(process.execPath,['--input-type=module','-e',script]);
  assert.equal(r.status,0,r.stdout+r.stderr);
});

test('sandbox individually denies private coordination stores while preserving auth and telemetry', async () => {
  const dirs=['results','scratch','reviews','handoffs','workers','workstreams','reports'];
  const files=dirs.map(d=>path.join(homedir(),'.pi-workbench',d,`eval-denial-${path.basename(area)}`));
  try {
    for(const file of files) { mkdirSync(path.dirname(file),{recursive:true}); writeFileSync(file,'private sentinel',{flag:'wx'}); }
    for(const file of files) {
      const r=await runProcess('sandbox-exec',['-p',sandboxProfile(area),'head','-c','1',file],{cwd:area});
      assert.notEqual(r.status,0,file); assert.match(r.stderr,/Operation not permitted/,file); assert.equal(r.stdout,'',file);
    }
    const auth=path.join(homedir(),'.pi/agent/auth.json');
    const telemetry=path.join(homedir(),'.pi/agent/telemetry',`eval-readable-${path.basename(area)}`);
    try {
      const r=await runProcess('sandbox-exec',['-p',sandboxProfile(area),process.execPath,'--input-type=module','-e',
        `import {readFileSync,writeFileSync} from 'node:fs'; readFileSync(${q(auth)}); writeFileSync(${q(telemetry)},'telemetry-ok'); if(readFileSync(${q(telemetry)},'utf8')!=='telemetry-ok') process.exit(1);`],{cwd:area});
      assert.equal(r.status,0,r.stderr);
    } finally { rmSync(telemetry,{force:true}); }
  } finally { for(const file of files) rmSync(file,{force:true}); }
});

test('retained hidden multipart and fixed pi-web copies are unreadable, including symlinks', async () => {
  const paths=[path.join(homedir(),'.pi-workbench/tmp/campaigns/01a11357-4e8a-70ac-a6b0-4a5b5660df07/case-fixed/tests/kotlin/de/tschuehly/photoquest/web/EvalMultipartTomcatIntegrationTest.kt'),path.join(homedir(),'.pi-workbench/tmp/gR7/repo/src/server/sessions/piSessionService.ts')];
  const proofs=[], profile=sandboxProfile(area);
  for(const [i,file] of paths.entries()) {
    assert.ok(existsSync(file),'retained original path required: '+file);
    const link=path.join(area,'retained-link-'+i); symlinkSync(file,link);
    for(const target of [file,link]) {
      const r=await runProcess('sandbox-exec',['-p',profile,'head','-c','1',target],{cwd:area});
      assert.notEqual(r.status,0); assert.equal(r.stdout,''); assert.match(r.stderr,/Operation not permitted/);
      proofs.push({path:target,canonical:realpathSync(target),sha256:hash(readFileSync(file)),status:r.status,emptyOutput:r.stdout===''});
    }
  }
  if(process.env.PI_EVAL_TEST_EVIDENCE) writeFileSync(path.join(process.env.PI_EVAL_TEST_EVIDENCE,'retained-denials.json'),JSON.stringify({trial:area,profile,profileHash:hash(profile),proofs},null,2));
});

test('production launcher refuses scratch symlink escapes before invoking Pi', async () => {
  for(const mode of ['root','session']) {
    const trial=path.join(area,'scratch-escape-'+mode), outside=path.join(area,'outside-'+mode); mkdirSync(trial);mkdirSync(outside);
    if(mode==='root') symlinkSync(outside,path.join(trial,'ownedroot'));
    else {mkdirSync(path.join(trial,'ownedroot'));symlinkSync(outside,path.join(trial,'ownedroot/session'));}
    await assert.rejects(runPi({model:'eval-fake/local',effort:'off',prompt:'Must not launch',cwd:trial,sessionDir:path.join(trial,'session-0'),timeoutMs:1000,wait:async()=>{}}),/scratch escapes/);
    assert.deepEqual(readdirSync(outside),[]);
  }
});

test('owned scratch survives installed startup resets in all launcher roles with nonvacuous inherited sweep fixture', {timeout:180000}, async () => {
  const saved={PI_TMP_ROOT:process.env.PI_TMP_ROOT,PI_TMP:process.env.PI_TMP,PI_WORKBENCH_EXECUTION_KIND:process.env.PI_WORKBENCH_EXECUTION_KIND,PATH:process.env.PATH};
  const executable=shell('command -v pi').stdout.trim();
  const proofs=[];
  try {
    for(const kind of [undefined,'subagent']) for(const role of ['candidate','member','combiner','neutral']) {
      const trial=path.join(area,`scratch-${kind??'unset'}-${role}`); mkdirSync(path.join(trial,'.pi/extensions'),{recursive:true});
      const inherited=path.join(trial,'inherited-root'), project=path.join(inherited,'stale-project');
      mkdirSync(path.join(project,'.days'),{recursive:true});
      for(let i=1;i<=8;i++) writeFileSync(path.join(project,'.days',`2026-10-${String(i).padStart(2,'0')}`),'');
      mkdirSync(path.join(project,'stale')); writeFileSync(path.join(project,'stale','sentinel'),'preserve'); utimesSync(path.join(project,'stale'),new Date('2020-01-01'),new Date('2020-01-01'));
      const sweepState=()=>JSON.stringify(readdirSync(inherited,{recursive:true}).map(f=>{const p=path.join(inherited,f),s=statSync(p);return [f,s.mtimeMs,s.isFile()?hash(readFileSync(p)):null];}));
      const before=sweepState();
      assert.ok(statSync(path.join(project,'stale')).mtime < new Date('2026-10-02'),'would be swept by inherited root');
      process.env.PI_TMP_ROOT=inherited; process.env.PI_TMP=path.join(project,'stale');
      if(kind===undefined) delete process.env.PI_WORKBENCH_EXECUTION_KIND; else process.env.PI_WORKBENCH_EXECUTION_KIND=kind;
      writeFileSync(path.join(trial,'.pi/extensions/fake.ts'),fakeProvider([{command:'printf "%s" "$PI_TMP" > effective.txt; mkdir -p "$PI_TMP"; printf own > "$PI_TMP/owned"; cat "$PI_TMP/owned"',description:'Verify effective owned scratch'}]));
      const bin=path.join(trial,'bin'); mkdirSync(bin); writeFileSync(path.join(bin,'pi'),`#!/bin/bash\nexec ${q(executable)} -e ${q(path.join(trial,'.pi/extensions/fake.ts'))} "$@"\n`,{mode:0o700});
      process.env.PATH=bin+path.delimiter+saved.PATH;
      const r=await runPi({model:'eval-fake/local',effort:'off',prompt:'Probe owned scratch.',cwd:trial,sessionDir:path.join(trial,'session-0'),timeoutMs:30000,trialDir:trial,candidate:role!=='neutral',neutral:role==='neutral',systemPrompt:JUDGE_SYSTEM,wait:async()=>{}});
      assert.equal(r.exitCode,0,JSON.stringify(r));
      const effective=readFileSync(path.join(trial,'effective.txt'),'utf8');
      assert.ok(realpathSync(effective).startsWith(realpathSync(path.join(trial,'ownedroot'))+path.sep),effective);
      assert.equal(readFileSync(path.join(effective,'owned'),'utf8'),'own');
      assert.equal(sweepState(),before);
      assert.equal(readFileSync(path.join(project,'stale','sentinel'),'utf8'),'preserve');
      proofs.push({kind:kind??'unset',role,effective,unchangedInheritedSweep:true});
    }
  } finally {for(const [k,v] of Object.entries(saved)) if(v===undefined) delete process.env[k]; else process.env[k]=v;}
  if(process.env.PI_EVAL_TEST_EVIDENCE) writeFileSync(path.join(process.env.PI_EVAL_TEST_EVIDENCE,'scratch-isolation.json'),JSON.stringify(proofs,null,2));
});

test('absolute inner Pi cutoff after gate stops its native detached bash child', {timeout:40000}, async () => {
  const trial=path.join(area,'inner-cutoff'); mkdirSync(path.join(trial,'.pi/extensions'),{recursive:true});
  writeFileSync(path.join(trial,'.pi/extensions/fake.ts'),fakeProvider([{command:"trap '' TERM; echo $$ > cutoff-bash.pid; sleep 60 & echo $! > cutoff-child.pid; wait",description:'Check inner deadline child cleanup'}]));
  const ledger=path.join(trial,'inner-ledger.jsonl'), previous=process.env.PI_EVAL_PROCESS_LEDGER;
  process.env.PI_EVAL_PROCESS_LEDGER=ledger;
  let r;
  try {r=await runPi({model:'eval-fake/local',effort:'off',prompt:'Probe cutoff.',cwd:trial,sessionDir:path.join(trial,'session-0'),trialDir:trial,timeoutMs:30000,neutral:true,systemPrompt:JUDGE_SYSTEM,deadlineAt:Date.now()+18000,wait:()=>pause(300)});}
  finally {if(previous===undefined) delete process.env.PI_EVAL_PROCESS_LEDGER;else process.env.PI_EVAL_PROCESS_LEDGER=previous;}
  assert.ok(r.timedOut,JSON.stringify(r));
  const pid=Number(readFileSync(path.join(trial,'cutoff-child.pid'))), bash=Number(readFileSync(path.join(trial,'cutoff-bash.pid'))), row=JSON.parse(readFileSync(ledger,'utf8').trim());
  try {
    for(let i=0;i<30&&(alive(pid)||groupAlive(bash)||groupAlive(row.pgid));i++) await pause(50);
    assert.equal(alive(pid),false);assert.equal(groupAlive(bash),false);assert.equal(groupAlive(row.pgid),false);
    if(process.env.PI_EVAL_TEST_EVIDENCE) writeFileSync(path.join(process.env.PI_EVAL_TEST_EVIDENCE,'inner-cutoff.json'),JSON.stringify({...row,nativeBashPgid:bash,nativeChildPid:pid,allGone:true,elapsedMs:r.elapsedMs},null,2));
  } finally {for(const pgid of [bash,row.pgid]) if(groupAlive(pgid)) process.kill(-pgid,'SIGKILL');}
});

test('interrupted outer leaves a known inner group; identity-checked recorded-owned cleanup stops it', async () => {
  const ledger=path.join(area,'interruption.jsonl'), marker=path.join(area,'interruption.pid');
  const code=`const {runProcess}=await import(${q(path.join(root,'scripts/pi-eval/safety.mjs'))}); await runProcess('bash',['-c',${q(`trap '' TERM; echo $$ > ${q(marker)}; sleep 30 & wait`)}],{timeoutMs:20000,beforeLaunch:()=>{}});`;
  const r=await runProcess(process.execPath,['--input-type=module','-e',code],{env:{...process.env,PI_EVAL_PROCESS_LEDGER:ledger},timeoutMs:700,beforeLaunch:()=>{}});
  assert.ok(r.timedOut);
  const row=JSON.parse(readFileSync(ledger,'utf8').trim()), pid=Number(readFileSync(marker));
  try {
    assert.equal(row.pid,pid); assert.equal(row.pgid,pid); assert.ok(alive(pid));
    const identity=spawnSync('ps',['-o','lstart=','-p',String(pid)],{encoding:'utf8',timeout:1000}).stdout.trim();
    assert.equal(identity,row.startIdentity); assert.ok(identity);
    process.kill(-row.pgid,'SIGKILL');
    for(let i=0;i<30&&groupAlive(row.pgid);i++) await pause(50); assert.equal(groupAlive(row.pgid),false);
    if(process.env.PI_EVAL_TEST_EVIDENCE) writeFileSync(path.join(process.env.PI_EVAL_TEST_EVIDENCE,'interrupted-owned-cleanup.json'),JSON.stringify({...row,identityVerified:true,groupGone:true},null,2));
  } finally {if(groupAlive(row.pgid)) process.kill(-row.pgid,'SIGKILL');}
});

test('exclusive Gradle creation and hash ownership cleanup preserve existing files', () => {
  const home = path.join(area, 'home'); mkdirSync(home);
  const g = createGradleGuard(area, { home, token: 'ownership' });
  assert.throws(() => createGradleGuard(area, { home, token: 'ownership' }), /EEXIST/);
  writeFileSync(g.file, 'changed');
  assert.equal(removeGradleGuard(g), false);
  assert.equal(readFileSync(g.file, 'utf8'), 'changed');
  rmSync(g.file);
  const fresh = createGradleGuard(area, { home, token: 'owned' });
  assert.equal(removeGradleGuard(fresh), true);
});

test('sandbox denies oracle/source reads and loads copied guard fail-closed in normal JSON discovery', { timeout: 120000 }, async () => {
  const trial = path.join(area, 'trial'); mkdirSync(trial);
  const guard = copyToolGuard(trial);
  // A local scripted provider, not a remote model: traverse real JSON tool validation/hooks/tool.
  const probe = path.join(trial, 'probe.ts');
  const commands=[{command:'printf guarded'}, {command:'printf clamped',timeout:9999},
    {command:'sleep 20',timeout:.15}, {command:"trap '' TERM; sleep 20 & echo $! > child.pid; wait",timeout:.2},
    {command:'exit 7',timeout:2}, {command:'true',timeout:0}].map(c=>({...c,description:'Run model free guard check'}));
  writeFileSync(probe, fakeProvider(commands));
  const env = { ...process.env, PI_OFFLINE: '1', PI_TMP_ROOT:path.join(trial,'ownedroot'), PI_TMP:path.join(trial,'ownedroot/session') };
  delete env.PI_WORKBENCH_EXECUTION_KIND; // exercise installed background-bash JSON forwarding too
  const args = ['-p', '--mode', 'json', '--offline', '--no-session', '--no-mcp', '--model', 'eval-fake/local', '-e', guard.file, '-e', probe, 'Run the scripted local guard probe.'];
  const r = await runProcess('sandbox-exec', ['-p', sandboxProfile(trial), 'pi', ...args], { cwd: trial, env, timeoutMs: 90000 });
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.split('\n').flatMap(l=>{try{const e=JSON.parse(l);return e.type==='tool_execution_end'?[e]:[];}catch{return [];}});
  assert.equal(rows.length,6,r.stdout+r.stderr);
  const inputs=JSON.parse(readFileSync(path.join(trial,'probe.json')));
  for(let i=0;i<rows.length;i++) rows[i].input=inputs[i];
  assert.equal(rows[0].input.timeout, 900);
  assert.equal(rows[1].input.timeout, 900);
  assert.match(JSON.stringify(rows[0]), /guarded/);
  assert.match(JSON.stringify(rows[2]), /timed out/);
  assert.match(JSON.stringify(rows[3]), /timed out/);
  const pid = Number(readFileSync(path.join(trial, 'child.pid')));
  try { for (let i=0;i<30 && alive(pid);i++) await pause(50); assert.equal(alive(pid),false); }
  finally { if(alive(pid)) process.kill(pid,'SIGKILL'); }
  assert.match(JSON.stringify(rows[4]), /7/);
  assert.match(JSON.stringify(rows[5]), /timeout/i);
  for (const file of [path.join(root, 'scripts/pi-eval.mjs'), path.join(homedir(), '.pi-workbench/evals/cases/frontier-pq-multipart/check.sh')]) {
    assert.ok(existsSync(file));
    const denied = await runProcess('sandbox-exec', ['-p', sandboxProfile(trial), 'head', '-c', '1', file], { cwd: trial });
    assert.notEqual(denied.status, 0, file);
    assert.match(denied.stderr, /Operation not permitted/, file);
  }
  writeFileSync(probe,fakeProvider([{command:"trap '' TERM; sleep 60 & echo $! > outer-child.pid; wait",description:'Check Pi termination cleanup'}]));
  const outer=await runProcess('sandbox-exec',['-p',sandboxProfile(trial),'pi',...args],{cwd:trial,env,timeoutMs:25000,termGraceMs:1000});
  assert.equal(outer.timedOut,true);
  const outerPid=Number(readFileSync(path.join(trial,'outer-child.pid')));
  try { for(let i=0;i<30 && alive(outerPid);i++) await pause(50); assert.equal(alive(outerPid),false); }
  finally { if(alive(outerPid)) process.kill(outerPid,'SIGKILL'); }
  writeFileSync(probe,fakeProvider([{command:'printf should-not-run',description:'Check case policy refusal'}]));
  const policy=await runProcess('sandbox-exec',['-p',sandboxProfile(trial),'pi',...args],{cwd:trial,env:{...env,PI_EVAL_COMMAND_POLICY:JSON.stringify(['printf allowed'])}});
  assert.equal(policy.status,0,policy.stderr);
  assert.match(policy.stdout,/Command refused by case policy/);
  writeFileSync(guard.file,'throw new Error("broken required guard");');
  rmSync(path.join(trial,'assembled.json'));
  const broken=await runProcess('sandbox-exec',['-p',sandboxProfile(trial),'pi',...args],{cwd:trial,env});
  assert.notEqual(broken.status,0,broken.stdout+broken.stderr);
  assert.equal(existsSync(path.join(trial,'assembled.json')),false,'no provider invocation on guard load failure');
  rmSync(guard.file);
  const missing = await runProcess('sandbox-exec', ['-p', sandboxProfile(trial), 'pi', ...args], { cwd: trial, env });
  // The launcher must not continue after explicit extension-load failure.
  assert.notEqual(missing.status, 0, missing.stdout + missing.stderr);
  assert.equal(existsSync(path.join(trial,'assembled.json')),false);
});

test('neutral production launcher: actual assembled system/user input, cwd and zero tools with local fake provider', {timeout:90000}, async () => {
  const cwd=path.join(area,'neutral'); mkdirSync(path.join(cwd,'.pi/extensions'),{recursive:true});
  writeFileSync(path.join(cwd,'.pi/extensions/fake.ts'),fakeProvider());
  const started=Date.now();
  const ledger=path.join(cwd,'cap-ledger.jsonl'), previousLedger=process.env.PI_EVAL_PROCESS_LEDGER;
  process.env.PI_EVAL_PROCESS_LEDGER=ledger;
  let r;
  try {
    assert.equal(shell('printf cap',{timeout:90000000,deadlineAt:Date.now()+90000000}).stdout,'cap');
    r=await runPi({model:'eval-fake/local',effort:'off',prompt:'Anonymous patch evidence only.',cwd,sessionDir:path.join(cwd,'session'),tools:null,neutral:true,systemPrompt:JUDGE_SYSTEM,timeoutMs:90000000,deadlineAt:Date.now()+90000000,wait:()=>pause(1500)});
  } finally {if(previousLedger===undefined) delete process.env.PI_EVAL_PROCESS_LEDGER;else process.env.PI_EVAL_PROCESS_LEDGER=previousLedger;}
  const bounds=readFileSync(ledger,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(bounds.length,2); for(const row of bounds) assert.equal(row.timeoutMs,900000);
  assert.equal(r.exitCode,0,JSON.stringify(r)); assert.equal(r.finalText,'done');
  assert.ok(Date.now()-started-r.elapsedMs >= 1400, 'reported elapsed excludes gate wait');
  const snapshot=JSON.parse(readFileSync(path.join(cwd,'assembled.json')));
  assert.equal(snapshot.cwd,cwd); assert.ok(snapshot.system.startsWith(JUDGE_SYSTEM)); assert.ok(snapshot.system.includes(cwd)); assert.equal(snapshot.tools.length,0);
  assert.match(JSON.stringify(snapshot.messages),/Anonymous patch evidence only/);
  assert.doesNotMatch(snapshot.system,/sol-source|smoke-r2|HIDDEN|PhotoQuest/);
  const settings=JSON.parse(readFileSync(path.join(cwd,'.pi/settings.json')));
  assert.equal(settings.retry.enabled,false); assert.equal(settings.compaction.enabled,false);
  if(process.env.PI_EVAL_TEST_EVIDENCE) writeFileSync(path.join(process.env.PI_EVAL_TEST_EVIDENCE,'neutral-assembled.json'),JSON.stringify(snapshot,null,2));
});

test('production launcher adds round token only to candidate/member/combiner commands', {timeout:90000}, async () => {
  const cwd=path.join(area,'candidate-env'); mkdirSync(path.join(cwd,'.pi/extensions'),{recursive:true});
  writeFileSync(path.join(cwd,'.pi/extensions/fake.ts'),fakeProvider([{command:'printf candidate',description:'Check candidate environment'}]));
  const g=createGradleGuard(cwd);
  const previous=process.env.PI_EVAL_ROUND_TOKEN; process.env.PI_EVAL_ROUND_TOKEN=g.token;
  try {
    for(const candidate of [true,false]) {
      const r=await runPi({model:'eval-fake/local',effort:'off',prompt:'Probe command environment.',cwd,sessionDir:path.join(cwd,`session-${candidate}`),timeoutMs:60000,trialDir:cwd,candidate,gradleGuard:g,neutral:true,systemPrompt:'Local command environment probe.',wait:async()=>{}});
      assert.equal(r.exitCode,0,JSON.stringify(r));
      const snapshot=JSON.parse(readFileSync(path.join(cwd,'assembled.json')));
      assert.equal(snapshot.roundToken,candidate?g.token:null);
    }
    assert.equal(shell('printf "${PI_EVAL_ROUND_TOKEN-unset}"').stdout,'unset');
  } finally {
    if(previous===undefined) delete process.env.PI_EVAL_ROUND_TOKEN; else process.env.PI_EVAL_ROUND_TOKEN=previous;
    assert.equal(removeGradleGuard(g),true);
  }
});

test('trusted workspace reconstruction runs case setup as well as archive; checks are bounded', async () => {
  const dir=path.join(area,'case-setup');mkdirSync(dir);
  writeFileSync(path.join(dir,'setup.sh'),'test -f scripts/pi-eval.mjs && printf setup > prepared.txt');
  writeFileSync(path.join(dir,'check.sh'),'test -f prepared.txt && echo PASS');
  const c={repo:path.basename(root),commit:shell('git rev-parse HEAD',{cwd:root}).stdout.trim(),paths:['scripts/pi-eval.mjs'],dir,setup:'setup.sh',check:{type:'script',script:'check.sh',timeoutMinutes:.1}};
  const trial=path.join(area,'setup-trial');const ws=path.join(trial,'ws');
  prepareWorkspace(c,ws); assert.equal(readFileSync(path.join(ws,'prepared.txt'),'utf8'),'setup');
  const r=await check(c,ws,'claims',trial); assert.equal(r.pass,true);
});

test('actual Gradle sandbox task graph, narrow positives, opt-out and configuration-cache reuse', { timeout: 300000 }, async () => {
  const { gradleRuntimeCheck } = await import('./pi-eval/gradle-check.mjs');
  await gradleRuntimeCheck(area);
});

function packetFixture() {
  const d = mkdtempSync(path.join(area, 'quality-'));
  const put = (name, value) => { const f=path.join(d,name); writeFileSync(f,typeof value==='string'?value:JSON.stringify(value)); return f; };
  const trial = path.join(d, 'sol-source'); mkdirSync(trial);
  writeFileSync(path.join(trial,'diff.patch'), 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n');
  writeFileSync(path.join(trial,'final.txt'), 'Sol: Fixed behavior. Resolve the solution. All tests pass.');
  writeFileSync(path.join(trial,'check.log'), 'OLD HIDDEN SECRET');
  const sourceResult=put('source.json', {trial:0, arm:'sol', runs:[{model:'openai-codex/gpt-6.1-sol'}], check:{pass:false}});
  const caseFile=put('case.json',{profile:'implementer',prompt:'Fix behavior.',check:{type:'script',script:'check.sh'}});
  const currentCheck=put('current.log','CURRENT HIDDEN EVIDENCE');
  const regradeResult=put('regrade.json',{check:{pass:true}, fixtureHash:'fixture-v2', approvedDiffHash:'approved-diff', patchHash:hash(readFileSync(path.join(trial,'diff.patch'))),checkHash:hash(readFileSync(currentCheck)),caseHash:hash(readFileSync(caseFile))});
  const parentContext=put('context.txt','Original function: old');
  return {d,put,trial,packet:{sourceResult,trialDir:trial,caseFile,currentCheck,regradeResult,parentContext}};
}
const score = {testQuality:8,scopeDiscipline:9,codeStyle:8,codebaseFit:8,mergeability:8,reason:'Focused change.'};

test('judge-only two-stage blind dataflow: repaired pass selection, dedup lineage, source preservation, no dryrun launches', async () => {
  const f=packetFixture();
  const before = readFileSync(f.packet.sourceResult);
  const manifest = {id:'next-round-01', packets:[f.packet,{...f.packet,lineage:'prose-regraded'}],outDir:path.join(f.d,'out')};
  const calls=[];
  const deps={admit:()=>({ok:true}),run:async request=>{calls.push(request); return {status:0,finalText:JSON.stringify(calls.length===1?score:{contradictedClaims:[],reason:'Consistent.'}),usage:{cost:0}};}};
  const dry=await judgePasses(manifest,{dryRun:true},deps);
  assert.equal(calls.length,0); assert.equal(dry.packets.length,1); assert.equal(dry.packets[0].lineage.length,2);
  const result=await judgePasses(manifest,{},deps);
  assert.equal(result.packets[0].status,'done'); assert.equal(calls.length,2);
  assert.equal(calls[0].model,JUDGES.anthropic.model); assert.equal(calls[0].effort,'high');
  assert.equal(calls[0].systemPrompt,JUDGE_SYSTEM);
  assert.equal(calls[0].tools,null);
  assert.equal(calls[0].cwd.startsWith(realpathSync(tmp)),true);
  assert.equal(calls[0].cwd.includes('sol-source'),false);
  assert.doesNotMatch(calls[0].prompt,/CURRENT HIDDEN|OLD HIDDEN|openai|sol-source|check\.pass/);
  assert.match(calls[0].prompt,/Resolve the solution/);
  assert.doesNotMatch(calls[0].prompt,/Sol:/);
  assert.match(calls[1].prompt,/CURRENT HIDDEN EVIDENCE/);
  assert.doesNotMatch(calls[1].prompt,/OLD HIDDEN/);
  assert.match(calls[1].prompt,/Frozen stage-1/);
  assert.deepEqual(readFileSync(f.packet.sourceResult),before);
  assert.equal(result.packets[0].stage1.mergeability,8);
  assert.equal(existsSync(path.join(f.trial,'ws')),false);
});

test('stage-2 failure preserves frozen stage-1; evidence mismatch and output collisions launch nothing', async () => {
  const f=packetFixture(); let calls=0;
  const manifest={id:'next-round-01',packets:[f.packet],outDir:path.join(f.d,'out')};
  const deps={admit:()=>({ok:true}),run:async()=>++calls===1?{status:0,finalText:JSON.stringify(score)}:{timedOut:true}};
  const r=await judgePasses(manifest,{},deps);
  assert.equal(r.packets[0].status,'inconclusive');assert.equal(r.packets[0].stage1.mergeability,8);assert.equal(calls,2);
  await assert.rejects(judgePasses(manifest,{},deps),/collision/i);assert.equal(calls,2);
  writeFileSync(f.packet.currentCheck,'MISMATCH');
  const d=await judgePasses(manifest,{dryRun:true});assert.match(d.packets[0].reason,/hash mismatch/i);
});

test('historical claimed passes keep authoritative outcomes and source/adapter/judging identities, including no claims', async () => {
  for(const [id,model] of [['p019','anthropic/claude-opus-5-5'],['p023','openai-codex/gpt-6.1-sol'],['p025','openai-codex/gpt-6-luna'],['p001','anthropic/claude-sonnet-5-5']]) {
    const f=packetFixture(), old='1'.repeat(40), adapter='2'.repeat(64), judging='3'.repeat(40);
    const source={harness:old,check:{pass:false},runs:[{model}]}; writeFileSync(f.packet.sourceResult,JSON.stringify(source));
    if(['p023','p025'].includes(id)) writeFileSync(path.join(f.trial,'final.txt'),'');
    const original=f.put('original.jsonl',JSON.stringify({trial:9})+'\n'+JSON.stringify(source)+'\n');
    const outcomes=f.put('outcomes.json',{packets:[{packetId:id,newVerdict:'inconclusive',rawVerdict:'fail',patchSha256:hash(readFileSync(path.join(f.trial,'diff.patch'))),fixtureSha256:'fixture-v2',sourceTrialPaths:[f.trial]}]});
    const inventory=f.put('inventory.json',{adapterSha256:adapter,packets:[{id,lineages:[{resultFile:original,resultLine:2,resultLineSha256:hash(JSON.stringify(source)),trialPath:f.trial,claimedPass:'historical claim'}]}]});
    const current={...JSON.parse(readFileSync(f.packet.regradeResult)),eligibility:'claimed-pass',packetId:id,newVerdict:'inconclusive',outcomesFile:outcomes,outcomesHash:hash(readFileSync(outcomes)),historicalHarnessSha:old,adapterSha:adapter,judgingHarness:judging,inventoryFile:inventory,sourceRowHash:hash(readFileSync(f.packet.sourceResult)),sourceHashes:{[original]:hash(readFileSync(original)),[inventory]:hash(readFileSync(inventory))},sourceSelection:{path:original,line:2,lineHash:hash(JSON.stringify(source))}};
    current.patchHash=hash(readFileSync(path.join(f.trial,'diff.patch')));
    writeFileSync(f.packet.regradeResult,JSON.stringify(current));
    const calls=[]; const report=await judgePasses({id:'next-round-01',kind:'prior',packets:[f.packet],outDir:path.join(f.d,'out')},{},{admit:()=>({ok:true}),run:async req=>{calls.push(req);return {status:0,finalText:JSON.stringify(calls.length===1?score:{contradictedClaims:[],reason:'Uncertain.'})};}});
    const record=report.packets[0]; assert.equal(record.status,'done',record.reason);
    assert.equal(record.provenance.newVerdict,'inconclusive'); assert.equal(record.provenance.historicalHarnessSha,old); assert.equal(record.provenance.adapterSha,adapter); assert.equal(record.provenance.judgingHarness,judging);
    assert.doesNotMatch(calls[0].prompt,/rawVerdict|CURRENT HIDDEN|inconclusive/); assert.match(calls[1].prompt,/Parent context/); assert.match(calls[1].prompt,/## Diff/);
    if(['p023','p025'].includes(id)) {assert.equal(record.claimsStatus,'no-claims');assert.equal(record.integrityCredit,'not-applicable');assert.deepEqual(record.stage2.contradictedClaims,[]);}
    const exact={...f.packet,sourceResult:original,resultLine:2,resultLineHash:hash(JSON.stringify(source))};
    current.sourceRowHash=hash(readFileSync(original));writeFileSync(f.packet.regradeResult,JSON.stringify(current));
    assert.equal((await judgePasses({id:'next-round-01',packets:[exact]},{dryRun:true})).packets[0].status,'planned');
    current.adapterSha='bad';writeFileSync(f.packet.regradeResult,JSON.stringify(current));
    assert.match((await judgePasses({id:'next-round-01',packets:[exact]},{dryRun:true})).packets[0].reason,/adapter identity/);
  }
  await assert.rejects(judgePasses({id:'next-round-01',kind:'prior',packets:Array(36).fill({})},{dryRun:true}),/limit/);
  await assert.rejects(judgePasses({id:'next-round-01',kind:'new',packets:Array(25).fill({})},{dryRun:true}),/limit/);
});

test('judge families, invalid/missing/admission/timeout results are inconclusive, excess calls refused', async () => {
  for (const failure of ['mixed','unknown','missing','admission','timeout','malformed','range']) {
    const f=packetFixture(); let launches=0;
    if(failure==='mixed'||failure==='unknown') writeFileSync(f.packet.sourceResult,JSON.stringify({runs:[{model:'openai-codex/gpt-6.1-sol'}, {model:failure==='mixed'?'anthropic/claude-opus-5-5':'unknown'}]}));
    if(failure==='missing') rmSync(path.join(f.trial,'diff.patch'));
    const r=await judgePasses({id:'next-round-01',packets:[f.packet],outDir:path.join(f.d,'out')},{},{admit:()=>({ok:failure!=='admission',reason:'blocked'}),run:async()=>{ launches++; return failure==='timeout'?{timedOut:true}:{status:0,finalText:failure==='malformed'?'bad':JSON.stringify({...score,mergeability:11})}; }});
    assert.equal(r.packets[0].status,'inconclusive',failure);
    assert.equal(r.packets[0].stage1,undefined);
    if(['mixed','unknown','missing','admission'].includes(failure)) assert.equal(launches,0);
  }
  const f=packetFixture(); writeFileSync(f.packet.sourceResult,JSON.stringify({runs:[{model:'anthropic/claude-sonnet-5-5'}]}));
  const d=await judgePasses({id:'next-round-01',packets:[f.packet]},{dryRun:true});
  assert.equal(d.packets[0].judge.model,'openai-codex/gpt-6.1-sol');
  const excess=Array.from({length:36},(_,i)=>{const regradeResult=f.put(`regrade-${i}.json`,{...JSON.parse(readFileSync(f.packet.regradeResult)),fixtureHash:`v${i}`});return {...f.packet,regradeResult};});
  await assert.rejects(judgePasses({id:'next-round-01',kind:'prior',packets:excess},{dryRun:true}),/limit/i);
});
