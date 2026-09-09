import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions, streamSimple as streamCodex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import {
  AUDIT_FORMAT, AUDIT_SCHEMA_VERSION, createAuditStore, createTransportObserver, findExactSkillEvidence,
  isInside, listCaptures, listPreviewSets, providerCoverage, readCaptureSet, readPreviewSet, removeCapture, removePreviewSet, snapshotSources,
} from "./audit.mjs";
import agentAuditExtension, { loadPiBasePrompt, registerAgentAudit, runtimePackages } from "./index.ts";
import { alignmentGuidance, checkingGuidance, renderWorkingModePrompt } from "../working-mode/index.ts";

const repo = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const temp = (prefix) => realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const close = (server) => new Promise((resolve) => server.close(resolve));
async function waitFor(fn) { for (let i=0;i<100;i++){ const value=await fn(); if(value) return value; await delay(5); } throw new Error("timed out"); }
function pending(url) { return { coverage:{ status:"supported", httpUrl:new URL(url).toString(), webSocketUrl:new URL(url.replace(/^http/,"ws")).toString() }, transportIds:[] }; }

function observerHarness(logical) {
  const captures=[]; const outcomes=[]; const errors=[];
  const observer=createTransportObserver({ current:()=>logical.value, capture:(value)=>captures.push(value), outcome:(value)=>outcomes.push(value), error:(value)=>errors.push(value) });
  return { observer,captures,outcomes,errors };
}

test("all 16 previews use the same exported Working Mode renderer as actual prompts", () => {
  assert.equal(JSON.parse(readFileSync(join(repo,"node_modules/@earendil-works/pi-coding-agent/package.json"))).version,"0.84.3");
  assert.equal(JSON.parse(readFileSync(join(repo,"node_modules/@earendil-works/pi-ai/package.json"))).version,"0.84.3");
  const skill={name:"unknown-skill",description:"unknown",filePath:"/skills/unknown/SKILL.md",baseDir:"/skills/unknown",sourceInfo:{path:"/skills/unknown/SKILL.md",source:"test",scope:"temporary",origin:"top-level"},disableModelInvocation:false};
  const options={ cwd:repo, skills:[skill], selectedTools:["read"] };
  const base=`base prompt${formatSkillsForPrompt([skill])}`;
  const previews=[];
  for (const alignment of Object.keys(alignmentGuidance)) for (const checking of Object.keys(checkingGuidance)) {
    const prompt=renderWorkingModePrompt(base, options, {alignment,checking});
    previews.push(prompt);
    assert.match(prompt, new RegExp(`Alignment: ${alignment}\\.`));
    assert.match(prompt, new RegExp(`Checking: ${checking}\\.`));
  }
  assert.equal(previews.length,16);
  assert.equal(new Set(previews).size,16);
});

test("HTTP observer preserves exact large and zstd request bytes received by a local fake provider", async () => {
  const received=[];
  const {server,url}=await listen((req,res)=>{ const chunks=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>{ received.push(Buffer.concat(chunks)); res.writeHead(200,{"content-type":"text/event-stream"}); res.end("data: [DONE]\\n\\n"); }); });
  const endpoint=`${url}/v1/messages`; const logical={value:pending(endpoint)}; const h=observerHarness(logical);
  assert.deepEqual(h.observer.install(),{ok:true,webSocket:typeof globalThis.WebSocket==="function"?"prototype-wrapped":"unavailable"});
  try {
    const large=JSON.stringify({text:"x".repeat(350_000)});
    await fetch(new Request(endpoint,{method:"POST",body:large,headers:{"content-type":"application/json"}}));
    const compressed=zstdCompressSync(Buffer.from(large));
    await fetch(endpoint,{method:"POST",body:compressed,headers:{"content-type":"application/json","content-encoding":"zstd"}});
    await waitFor(()=>h.captures.length===2);
    assert.equal("headers" in h.captures[0].metadata,false,"authentication headers are never evidence");
    assert.equal(h.captures[0].body.byteLength,Buffer.byteLength(large));
    assert.equal(Buffer.from(h.captures[0].body.base64,"base64").compare(received[0]),0);
    assert.equal(Buffer.from(h.captures[1].body.base64,"base64").compare(received[1]),0);
    assert.equal(h.captures[1].body.interpretation.text,large);
    assert.equal(h.captures[0].body.interpretation.text.length,large.length,"no silent truncation");
  } finally { h.observer.restore(); await close(server); }
});

test("installed Anthropic 0.84.3 HTTP/SSE path sends the exact captured body to a local fake provider", async () => {
  let received;
  const {server,url}=await listen((req,res)=>{ const chunks=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>{
    received=Buffer.concat(chunks);
    res.writeHead(200,{"content-type":"text/event-stream"});
    const events=[
      ["message_start",{type:"message_start",message:{id:"msg-1",type:"message",role:"assistant",model:"claude-test",content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:2,output_tokens:0}}}],
      ["content_block_start",{type:"content_block_start",index:0,content_block:{type:"text",text:""}}],
      ["content_block_delta",{type:"content_block_delta",index:0,delta:{type:"text_delta",text:"hello"}}],
      ["content_block_stop",{type:"content_block_stop",index:0}],
      ["message_delta",{type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:1}}],
      ["message_stop",{type:"message_stop"}],
    ];
    res.end(events.map(([name,data])=>`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(""));
  }); });
  const endpoint=`${url}/v1/messages`; const logical={value:pending(endpoint)}; const h=observerHarness(logical); h.observer.install();
  const model={id:"claude-test",name:"fake anthropic",api:"anthropic-messages",provider:"anthropic",baseUrl:url,reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:1000};
  try {
    const eventsSeen=[]; let answer; for await (const event of streamAnthropic(model,{systemPrompt:"system exact",messages:[{role:"user",content:[{type:"text",text:"request exact"}],timestamp:Date.now()}],tools:[]},{apiKey:"test-key"})) { eventsSeen.push(event.type); if (event.type === "done") answer = event.message; }
    await waitFor(()=>received && h.captures.length===1);
    assert.equal(Buffer.from(h.captures[0].body.base64,"base64").compare(received),0);
    assert.equal(JSON.parse(received).system[0].text,"system exact");
    assert.equal(eventsSeen.at(-1),"done");
    assert.equal(answer.stopReason,"stop");
    assert.equal(answer.content[0].text,"hello");
  } finally { h.observer.restore(); await close(server); }
});

test("installed Codex 0.84.3 HTTP/SSE retry path preserves each compressed send", async () => {
  const received=[]; let attempts=0;
  const {server,url}=await listen((req,res)=>{ const chunks=[]; req.on("data",chunk=>chunks.push(chunk)); req.on("end",()=>{
    const bytes=Buffer.concat(chunks); received.push(bytes); attempts++;
    if(attempts===1){ res.writeHead(500,{"content-type":"text/plain"}); res.end("retry"); return; }
    const responseId="sse-response"; const item={type:"message",id:"sse-message",role:"assistant",status:"completed",content:[{type:"output_text",text:"sse-ok",annotations:[]}]};
    const events=[{type:"response.created",response:{id:responseId,status:"in_progress"}},{type:"response.output_item.added",output_index:0,item:{...item,content:[]}},{type:"response.output_item.done",output_index:0,item},{type:"response.completed",response:{id:responseId,status:"completed",output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}];
    res.writeHead(200,{"content-type":"text/event-stream"}); res.end(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(""));
  }); });
  const endpoint=`${url}/codex/responses`; const logical={value:pending(endpoint)}; const h=observerHarness(logical); h.observer.install();
  const model={id:"gpt-5.3-codex",name:"fake codex",api:"openai-codex-responses",provider:"openai-codex",baseUrl:url,reasoning:true,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:1000};
  const token=`x.${Buffer.from(JSON.stringify({"https://api.openai.com/auth":{chatgpt_account_id:"account"}})).toString("base64url")}.x`;
  try {
    let answer; for await(const event of streamCodex(model,{systemPrompt:"sse-system",messages:[{role:"user",content:[{type:"text",text:"sse-request"}],timestamp:Date.now()}],tools:[]},{apiKey:token,transport:"sse",maxRetries:1,maxRetryDelayMs:10})) if(event.type==="done")answer=event.message;
    await h.observer.drain();
    assert.equal(received.length,2); assert.equal(h.captures.length,2);
    for(let i=0;i<2;i++) assert.equal(Buffer.from(h.captures[i].body.base64,"base64").compare(received[i]),0);
    assert.equal(JSON.parse(zstdDecompressSync(received[1])).instructions,"sse-system");
    assert.equal(answer.content[0].text,"sse-ok"); assert.equal(answer.stopReason,"stop");
  } finally { h.observer.restore(); await h.observer.drain(); await close(server); }
});

test("HTTP failures and aborts are observed without changing fetch rejection", async () => {
  const slow=await listen((_req,_res)=>{}); const endpoint=`${slow.url}/v1/messages`;
  const logical={value:pending(endpoint)}; const h=observerHarness(logical); h.observer.install();
  try {
    const controller=new AbortController(); const promise=fetch(endpoint,{method:"POST",body:"abort-me",signal:controller.signal}); controller.abort();
    await assert.rejects(promise, error=>error.name==="AbortError");
    await waitFor(()=>h.outcomes.some(item=>item.status==="failed"));
    assert.equal(h.outcomes.at(-1).aborted,true);
  } finally { h.observer.restore(); await close(slow.server); }

  const free=await listen((_req,res)=>res.end()); const dead=`${free.url}/v1/messages`; await close(free.server);
  const second={value:pending(dead)}; const failed=observerHarness(second); failed.observer.install();
  try { await assert.rejects(fetch(dead,{method:"POST",body:"retry-body"})); await waitFor(()=>failed.outcomes.length); assert.equal(failed.outcomes[0].status,"failed"); }
  finally { failed.observer.restore(); }
});

test("off and unrelated traffic stay untouched; retained composed fetch wrappers remain functional and inert after restore", async () => {
  const {server,url}=await listen((_req,res)=>res.end("ok"));
  const logical={value:null}; const h=observerHarness(logical); const original=globalThis.fetch; const originalClone=Request.prototype.clone; let clones=0;
  Request.prototype.clone=function(){ clones++; return Reflect.apply(originalClone,this,[]); };
  h.observer.install();
  try {
    await fetch(new Request(url,{method:"POST",body:"unrelated"}));
    logical.value=pending(`${url}/v1/messages`); await fetch(`${url}/other`);
    assert.equal(clones,0,"coverage is checked before unrelated Request bodies are cloned");
    assert.equal(h.captures.length,0);
    const auditWrapper=globalThis.fetch; const later=(...args)=>Reflect.apply(auditWrapper,globalThis,args); globalThis.fetch=later;
    assert.deepEqual(h.observer.restore(),["fetch wrapper changed after audit installation; retained audit delegate is inert"]);
    assert.equal(await (await fetch(url)).text(),"ok","later wrapper still delegates through the inert audit wrapper");
    logical.value=pending(url); await fetch(url,{method:"POST",body:"after-stop"}); await h.observer.drain();
    assert.equal(h.captures.length,0,"stopped retained wrapper never resumes capture");
    h.observer.install(); await fetch(url,{method:"POST",body:"restart"}); await h.observer.drain();
    assert.equal(h.captures.length,1,"restart does not double-capture through retained wrappers");
    h.observer.restore();
  } finally { Request.prototype.clone=originalClone; globalThis.fetch=original; await close(server); }
});

test("retained composed WebSocket send wrappers stay functional, inert, and restart without duplicate capture", async () => {
  const OriginalWebSocket=globalThis.WebSocket;
  class FakeWebSocket { constructor(url){this.url=url;this.sent=[];} send(data){this.sent.push(data);return "sent";} }
  globalThis.WebSocket=FakeWebSocket;
  const socket=new FakeWebSocket("ws://example.test/codex/responses"); const logical={value:pending("http://example.test/codex/responses")}; const h=observerHarness(logical);
  const originalSend=FakeWebSocket.prototype.send;
  try {
    h.observer.install(); const auditSend=FakeWebSocket.prototype.send;
    FakeWebSocket.prototype.send=function(data){return Reflect.apply(auditSend,this,[data]);};
    assert.deepEqual(h.observer.restore(),["WebSocket.prototype.send changed after audit installation; retained audit delegate is inert"]);
    assert.equal(socket.send("after-stop"),"sent"); await h.observer.drain(); assert.equal(h.captures.length,0);
    h.observer.install(); assert.equal(socket.send("after-restart"),"sent"); await h.observer.drain();
    assert.equal(h.captures.length,1); assert.deepEqual(socket.sent,["after-stop","after-restart"]);
  } finally { h.observer.restore(); await h.observer.drain(); FakeWebSocket.prototype.send=originalSend; globalThis.WebSocket=OriginalWebSocket; }
});

test("observer callback failures never change provider traffic and drain deterministically", async () => {
  const {server,url}=await listen((_req,res)=>res.end("provider-ok"));
  const logical={value:pending(url)}; const reported=[]; const originalError=console.error; console.error=()=>{};
  const observer=createTransportObserver({ current:()=>logical.value, capture:async()=>{ throw new Error("capture failed"); }, outcome:()=>{ throw new Error("outcome failed"); }, error:(problem)=>{ reported.push(problem); throw new Error("report failed"); } });
  observer.install();
  try {
    assert.equal(await (await fetch(url,{method:"POST",body:new Blob(["async-body"])})).text(),"provider-ok");
    observer.restore(); await observer.drain();
    assert.equal(reported.length,2);
    await fetch(url,{method:"POST",body:"inert"}); await observer.drain();
    assert.equal(reported.length,2);
  } finally { observer.restore(); console.error=originalError; await close(server); }
});

test("stop drains an in-flight asynchronous body into its original logical capture only", async () => {
  const {server,url}=await listen((req,res)=>{req.resume();req.on("end",()=>res.end("ok"));});
  class SlowBlob extends Blob { async arrayBuffer(){ await delay(30); return super.arrayBuffer(); } }
  const first={...pending(url),session:{sessionId:"first"}}; const logical={value:first}; const h=observerHarness(logical); h.observer.install();
  try {
    const traffic=fetch(url,{method:"POST",body:new SlowBlob(["slow exact"])});
    h.observer.restore(); logical.value={...pending(url),session:{sessionId:"later"}};
    await traffic; assert.equal(h.captures.length,0,"capture is still draining after traffic completed");
    await h.observer.drain(); assert.equal(h.captures.length,1); assert.equal(h.captures[0].logical.session.sessionId,"first");
    await fetch(url,{method:"POST",body:"after stop"}); await h.observer.drain(); assert.equal(h.captures.length,1);
  } finally { h.observer.restore(); await h.observer.drain(); await close(server); }
});

test("observer snapshots mutable bytes before a synchronously throwing delegate", async () => {
  const original=globalThis.fetch, logical={value:pending("http://example.test/v1/messages")};
  const captures=[], marker=new Error("provider delegate threw");
  globalThis.fetch=(_input,init)=>{ init.body[0]=90; throw marker; };
  const observer=createTransportObserver({current:()=>logical.value,capture:value=>captures.push(value),outcome:()=>{},error:assert.fail});
  observer.install();
  try {
    const body=new Uint8Array([65,66,67]);
    assert.throws(()=>fetch("http://example.test/v1/messages",{method:"POST",body}),error=>error===marker);
    await observer.drain();
    assert.equal(Buffer.from(captures[0].body.base64,"base64").toString(),"ABC");
    assert.equal(captures[0].sendOutcome,"threw"); assert.ok(captures[0].sentAt);
  } finally { observer.restore(); globalThis.fetch=original; }
});

test("observer drain detaches pending outcomes after a bounded wait", async () => {
  const original=globalThis.fetch, logical={value:pending("http://example.test/v1/messages")};
  let settle; globalThis.fetch=()=>new Promise(resolve=>{settle=resolve;});
  const captures=[], outcomes=[];
  const observer=createTransportObserver({current:()=>logical.value,capture:value=>captures.push(value),outcome:value=>outcomes.push(value),error:assert.fail,drainTimeoutMs:20});
  observer.install();
  try {
    const request=fetch("http://example.test/v1/messages",{method:"POST",body:"exact"}); observer.restore();
    const result=await observer.drain();
    assert.equal(result.complete,false); assert.equal(result.abandoned,1); assert.equal(captures.length,1);
    logical.value={...pending("http://example.test/v1/messages"),session:{sessionId:"new"}};
    settle(new Response("ok")); await request; await delay(0);
    assert.equal(outcomes.length,0,"late outcome is detached rather than attributed after restart");
  } finally { observer.restore(); globalThis.fetch=original; }
});

test("WebSocket observer records the exact frame accepted by a local fake provider", { skip:typeof globalThis.WebSocket!=="function" }, async () => {
  let received;
  const server=http.createServer();
  server.on("upgrade",(req,socket)=>{
    const accept=createHash("sha1").update(req.headers["sec-websocket-key"]+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.once("data",data=>{ received=decodeClientFrame(data); socket.end(); });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url=`ws://127.0.0.1:${server.address().port}/codex/responses`; const logical={value:pending(url.replace(/^ws/,"http"))}; logical.value.coverage.webSocketUrl=url;
  const h=observerHarness(logical); h.observer.install();
  try {
    const message=JSON.stringify({type:"response.create",previous_response_id:"response-1",input:[{type:"message",content:"delta"}]});
    const socket=new WebSocket(url); await new Promise((resolve,reject)=>{ socket.addEventListener("open",resolve,{once:true}); socket.addEventListener("error",reject,{once:true}); });
    socket.send(message);
    await waitFor(()=>received && h.captures.length===1);
    assert.equal(received.toString(),message);
    assert.equal(Buffer.from(h.captures[0].body.base64,"base64").toString(),message);
    assert.equal(h.captures[0].body.interpretation.text,message);
  } finally { h.observer.restore(); await close(server); }
});

function decodeClientFrame(data) {
  let length=data[1]&0x7f, offset=2;
  if(length===126){ length=data.readUInt16BE(2); offset=4; }
  else if(length===127){ length=Number(data.readBigUInt64BE(2)); offset=10; }
  const masked=Boolean(data[1]&0x80), mask=masked?data.subarray(offset,offset+4):null; if(masked) offset+=4;
  const body=Buffer.from(data.subarray(offset,offset+length)); if(mask) for(let i=0;i<body.length;i++) body[i]^=mask[i%4]; return body;
}

test("installed Codex 0.84.3 cached WebSocket transport sends and captures the real previous_response_id delta", { skip:typeof globalThis.WebSocket!=="function" }, async () => {
  const received=[]; let sequence=0, connections=0; const sockets=new Set();
  const server=http.createServer();
  server.on("upgrade",(req,socket)=>{
    connections++;
    sockets.add(socket); socket.on("close",()=>sockets.delete(socket));
    const accept=createHash("sha1").update(req.headers["sec-websocket-key"]+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffered=Buffer.alloc(0);
    socket.on("data",data=>{
      buffered=Buffer.concat([buffered,data]);
      for (;;) {
        const frame=takeClientFrame(buffered); if(!frame) break; buffered=buffered.subarray(frame.consumed);
        const request=JSON.parse(frame.body.toString()); received.push(request); const responseId=`response-${++sequence}`;
        const item={type:"message",id:`message-${sequence}`,role:"assistant",status:"completed",content:[{type:"output_text",text:`reply-${sequence}`,annotations:[]}]};
        for (const event of [
          {type:"response.created",response:{id:responseId,status:"in_progress"}},
          {type:"response.output_item.added",output_index:0,item:{...item,content:[]}},
          {type:"response.output_item.done",output_index:0,item},
          {type:"response.completed",response:{id:responseId,status:"completed",output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}},
        ]) socket.write(encodeServerFrame(JSON.stringify(event)));
      }
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const baseUrl=`http://127.0.0.1:${server.address().port}`; const endpoint=`${baseUrl}/codex/responses`;
  const logical={value:pending(endpoint)}; logical.value.coverage.webSocketUrl=endpoint.replace(/^http/,"ws");
  const h=observerHarness(logical); const sessionId=`audit-${randomUUID()}`;
  const model={id:"gpt-5.3-codex",name:"fake codex",api:"openai-codex-responses",provider:"openai-codex",baseUrl,reasoning:true,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:1000};
  const token=`x.${Buffer.from(JSON.stringify({"https://api.openai.com/auth":{chatgpt_account_id:"account"}})).toString("base64url")}.x`;
  const user=(text)=>({role:"user",content:[{type:"text",text}],timestamp:Date.now()});
  const run=async(messages)=>{ let answer; for await (const event of streamCodex(model,{systemPrompt:"system",messages,tools:[]},{apiKey:token,transport:"websocket-cached",sessionId,cacheRetention:"short"})) if(event.type==="done") answer=event.message; return answer; };
  try {
    const first=await run([user("first")]);
    h.observer.install();
    const second=await run([user("first"),first,user("second")]);
    await h.observer.drain();
    assert.equal(connections,1,"installed Codex reused the socket opened before audit start");
    assert.equal(h.captures.length,1,"prototype send patch observes the reused socket");
    assert.equal(received[1].previous_response_id,"response-1");
    assert.deepEqual(JSON.parse(h.captures[0].body.interpretation.text),received[1]);

    h.observer.restore(); await h.observer.drain();
    const third=await run([user("first"),first,user("second"),second,user("third")]);
    assert.equal(h.captures.length,1,"stop leaves the reused socket functional and inert");
    h.observer.install();
    const fourth=await run([user("first"),first,user("second"),second,user("third"),third,user("fourth")]);
    await h.observer.drain();
    assert.equal(connections,1,"stop/restart keeps using the original cached socket");
    assert.equal(h.captures.length,2,"restart captures once through the same socket");
    assert.equal(JSON.parse(h.captures[1].body.interpretation.text).previous_response_id,"response-3");
    assert.equal(fourth.content[0].text,"reply-4");
  } finally { closeOpenAICodexWebSocketSessions(sessionId); h.observer.restore(); await h.observer.drain(); for(const socket of sockets)socket.destroy(); await close(server); }
});

function takeClientFrame(data) {
  if(data.length<2) return null; let length=data[1]&0x7f, offset=2;
  if(length===126){ if(data.length<4)return null; length=data.readUInt16BE(2); offset=4; }
  else if(length===127){ if(data.length<10)return null; length=Number(data.readBigUInt64BE(2)); offset=10; }
  const masked=Boolean(data[1]&0x80); if(masked && data.length<offset+4)return null; const mask=masked?data.subarray(offset,offset+4):null; if(masked)offset+=4;
  if(data.length<offset+length)return null; const body=Buffer.from(data.subarray(offset,offset+length)); if(mask)for(let i=0;i<body.length;i++)body[i]^=mask[i%4]; return {body,consumed:offset+length};
}
function encodeServerFrame(text) {
  const body=Buffer.from(text); let header;
  if(body.length<126) header=Buffer.from([0x81,body.length]);
  else if(body.length<65536){ header=Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(body.length,2); }
  else { header=Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(body.length),2); }
  return Buffer.concat([header,body]);
}

test("source snapshots remain immutable after disk drift and skill evidence requires Pi's exact wrapper", () => {
  const dir=temp("agent-audit-source-"); const path=join(dir,"SKILL.md");
  writeFileSync(path,"old disk");
  try {
    const sources=snapshotSources({contextFiles:[{path,content:"loaded content"}],skills:[{name:"known",filePath:path,baseDir:dir}]},[]);
    writeFileSync(path,"new disk");
    assert.equal(sources.contextFiles[0].loadedSourceContent.content,"loaded content");
    assert.equal(sources.contextFiles[0].diskAtCapture.content,"old disk");
    const skills=[{name:"known",filePath:path,baseDir:dir}];
    const visible=[{name:"known",description:"Known",filePath:path,baseDir:dir,sourceInfo:{path,source:"test",scope:"temporary",origin:"top-level"},disableModelInvocation:false}];
    const catalog=formatSkillsForPrompt(visible);
    const duplicate=findExactSkillEvidence({instructions:`${catalog}${catalog}`},skills,visible,formatSkillsForPrompt,{api:"openai-codex-responses"});
    assert.equal(duplicate.advertisedCatalog.status,"unknown"); assert.equal(duplicate.advertisedCatalog.matches,2);
    const wrapper=`<skill name="known" location="${path}">\nReferences are relative to ${dir}.\n\nbody loaded then retained\n</skill>`;
    const contextMessages=[
      {role:"assistant",content:[{type:"toolCall",id:"read-1",name:"read",arguments:{path}}]},
      {role:"toolResult",toolCallId:"read-1",toolName:"read",content:[{type:"text",text:"exact returned skill text\n[File content truncated]"}]},
    ];
    const evidence=findExactSkillEvidence({instructions:catalog,input:[wrapper,{call_id:"read-1",output:"exact returned skill text\n[File content truncated]"},{text:`history fake ${catalog}`}]},skills,visible,formatSkillsForPrompt,{api:"openai-codex-responses",contextMessages,cwd:dir});
    assert.equal(evidence.advertisedCatalog.status,"observed","catalog-like history text is not instruction evidence");
    assert.equal(evidence.loadedSkillEvidence.status,"partial");
    assert.equal(evidence.loadedSkillEvidence.explicitSkillWrappers[0].returnedText,"body loaded then retained");
    assert.equal(evidence.loadedSkillEvidence.readToolResults[0].toolCallId,"read-1");
    assert.equal(evidence.loadedSkillEvidence.readToolResults[0].returnedText,"exact returned skill text\n[File content truncated]");
    assert.equal(evidence.loadedSkillEvidence.readToolResults[0].truncationMarkerPresent,true);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("audit storage rejects ancestor and replacement symlinks without outside mutation", () => {
  const dir=temp("agent-audit-storage-"); const outside=temp("agent-audit-storage-outside-");
  const beforeMode=statSync(outside).mode&0o777;
  try {
    mkdirSync(join(outside,"agent-audit")); symlinkSync(outside,join(dir,".review"),"dir");
    assert.throws(()=>createAuditStore(join(dir,".review","agent-audit")),/unsafe audit path component/);
    assert.deepEqual(readdirSync(join(outside,"agent-audit")),[]); assert.equal(statSync(outside).mode&0o777,beforeMode);

    const safeRoot=join(dir,"safe"), displaced=join(dir,"safe-original"), store=createAuditStore(safeRoot), id=randomUUID();
    renameSync(safeRoot,displaced); symlinkSync(outside,safeRoot,"dir");
    assert.throws(()=>store.writeCapture({schemaVersion:AUDIT_SCHEMA_VERSION,format:AUDIT_FORMAT,id}),/unsafe audit path component/);
    assert.deepEqual(readdirSync(outside),["agent-audit"],"write never follows a replaced storage root");
    rmSync(safeRoot); renameSync(displaced,safeRoot);

    rmSync(join(safeRoot,"captures"),{recursive:true}); symlinkSync(outside,join(safeRoot,"captures"),"dir");
    assert.throws(()=>listCaptures(safeRoot),/unsafe audit directory/); rmSync(join(safeRoot,"captures")); mkdirSync(join(safeRoot,"captures"));
  } finally { rmSync(dir,{recursive:true,force:true}); rmSync(outside,{recursive:true,force:true}); }
});

test("healthy and unreadable records coexist and named cleanup remains safe", () => {
  const dir=temp("agent-audit-records-"), store=createAuditStore(dir), healthy=randomUUID(), wrong=randomUUID(), corrupt=randomUUID(), invalidPreview=randomUUID(), preview=randomUUID(), badPreview=randomUUID();
  const capture=id=>({schemaVersion:AUDIT_SCHEMA_VERSION,format:AUDIT_FORMAT,id,timestamp:new Date().toISOString(),previewSetId:null,session:{sessionId:"s",sessionFile:null},transport:{kind:"missing"}});
  try {
    store.writeCapture(capture(healthy));
    writeFileSync(join(dir,"captures",`${wrong}.json`),JSON.stringify({schemaVersion:99,format:"other",id:wrong}));
    writeFileSync(join(dir,"captures",`${corrupt}.json`),"{");
    const listed=listCaptures(dir); assert.equal(listed.find(item=>item.id===healthy).status,"readable");
    assert.match(listed.find(item=>item.id===wrong).reason,/unsupported format\/schema/); assert.match(listed.find(item=>item.id===corrupt).reason,/corrupt or unreadable/);
    assert.equal(readCaptureSet(dir,healthy).capture.id,healthy); assert.throws(()=>readCaptureSet(dir,wrong),/unsupported format\/schema/);
    removeCapture(dir,wrong); assert.equal(lstatSafe(join(dir,"captures",`${wrong}.json`)),null); assert.ok(lstatSafe(join(dir,"captures",`${healthy}.json`)));
    removeCapture(dir,healthy); assert.equal(lstatSafe(join(dir,"captures",`${healthy}.json`)),null); assert.ok(lstatSafe(join(dir,"captures",`${corrupt}.json`)));

    store.writePreview({schemaVersion:AUDIT_SCHEMA_VERSION,format:`${AUDIT_FORMAT}.previews`,id:preview,timestamp:new Date().toISOString(),previews:[]});
    writeFileSync(join(dir,"previews",`${badPreview}.json`),"{");
    assert.equal(listPreviewSets(dir).find(item=>item.id===preview).status,"readable"); assert.equal(listPreviewSets(dir).find(item=>item.id===badPreview).status,"unreadable");
    removePreviewSet(dir,preview); assert.ok(lstatSafe(join(dir,"previews",`${badPreview}.json`)));

    store.writeCapture({...capture(invalidPreview),previewSetId:"../../outside"});
    assert.throws(()=>removeCapture(dir,invalidPreview),/invalid previewSetId/); assert.ok(lstatSafe(join(dir,"captures",`${invalidPreview}.json`)));
    removeCapture(dir,"all"); assert.equal(lstatSafe(dir),null);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("targeted cleanup removes orphan events without touching other identities", () => {
  const dir=temp("agent-audit-orphan-events-"), store=createAuditStore(dir), orphan=randomUUID(), other=randomUUID();
  try {
    store.writeEvent({schemaVersion:AUDIT_SCHEMA_VERSION,format:AUDIT_FORMAT,captureId:orphan,type:"transport-outcome"});
    store.writeCapture({schemaVersion:AUDIT_SCHEMA_VERSION,format:AUDIT_FORMAT,id:other,timestamp:new Date().toISOString(),previewSetId:null,session:{sessionId:"s",sessionFile:null},transport:{kind:"missing"}});
    store.writeEvent({schemaVersion:AUDIT_SCHEMA_VERSION,format:AUDIT_FORMAT,captureId:other,type:"transport-outcome"});
    removeCapture(dir,orphan);
    const events=readdirSync(join(dir,"events"));
    assert.equal(events.some(name=>name.startsWith(`${orphan}.`)),false); assert.equal(events.some(name=>name.startsWith(`${other}.`)),true);
    assert.ok(lstatSafe(join(dir,"captures",`${other}.json`)));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("native output export uses persisted entry ids and reports shared attempt ambiguity", () => {
  const dir=temp("agent-audit-store-"); const store=createAuditStore(dir); const id=randomUUID(); const sessionFile=join(dir,"session.jsonl");
  writeFileSync(sessionFile,[
    JSON.stringify({type:"session",version:3,id:"session-1",cwd:repo}),
    JSON.stringify({type:"message",id:"assistant-1",parentId:"user-1",timestamp:new Date().toISOString(),message:{role:"assistant",content:[{type:"text",text:"native reply"}],stopReason:"stop"}}),
  ].join("\n")+"\n");
  const saved={schemaVersion:AUDIT_SCHEMA_VERSION,format:AUDIT_FORMAT,id,timestamp:new Date().toISOString(),session:{sessionId:"session-1",sessionFile},transport:{kind:"http-fetch"}};
  store.writeCapture(saved);
  assert.throws(()=>store.writeCapture({...saved,timestamp:"rewritten"}),/EEXIST/);
  store.writeEvent({schemaVersion:AUDIT_SCHEMA_VERSION,format:AUDIT_FORMAT,captureId:id,type:"native-output-link",groupId:"group",entryIds:["assistant-1"],sharedByCaptureIds:[id,randomUUID()]});
  const exported=readCaptureSet(dir,id,{materializeOutputs:true});
  assert.equal(exported.nativeOutputs.status,"ambiguous-shared-attempt-group");
  assert.equal(exported.nativeOutputs.entries[0].message.content[0].text,"native reply");
  writeFileSync(sessionFile,JSON.stringify({type:"session",version:3,id:"other"})+"\n");
  assert.equal(readCaptureSet(dir,id,{materializeOutputs:true}).nativeOutputs.status,"missing");
  rmSync(dir,{recursive:true,force:true});
});

test("extension snapshots applied mode and native outputs through real lifecycle callbacks", async () => {
  const dir=temp("agent-audit-lifecycle-"); const sessionFile=join(dir,"session.jsonl"); const originalFetch=globalThis.fetch;
  const {server,url}=await listen((req,res)=>{ req.resume(); req.on("end",()=>res.end("ok")); });
  const handlers=new Map(), commands=new Map(), busListeners=new Map(), entries=[];
  const options={cwd:repo,customPrompt:"STRUCTURED BASE",selectedTools:[],skills:[],contextFiles:[]};
  const sessionManager={getSessionId:()=>"session-lifecycle",getSessionFile:()=>sessionFile,getLeafId:()=>entries.at(-1)?.id??null,getEntries:()=>entries};
  const ctx={mode:"tui",cwd:repo,hasUI:true,model:{id:"claude-fake",provider:"anthropic",api:"anthropic-messages",baseUrl:url},sessionManager,ui:{setStatus:()=>{},notify:()=>{},confirm:async()=>true},getSystemPrompt:()=>"STALE Alignment: Vibe. prior effective prompt",getSystemPromptOptions:()=>options};
  const pi={on:(name,handler)=>handlers.set(name,handler),events:{on:(name,handler)=>busListeners.set(name,handler),emit:(name,value)=>busListeners.get(name)?.(value)},registerCommand:(name,value)=>commands.set(name,value),getCommands:()=>[],getActiveTools:()=>[],getAllTools:()=>[]};
  registerAgentAudit(pi,{auditRoot:join(dir,"audit"),buildSystemPrompt:(value)=>value.customPrompt});
  const modeEvent=(phase,selected,applied)=>busListeners.get("pi-workbench:working-mode")?.({phase,selected,applied});
  try {
    await handlers.get("session_start")({reason:"startup"},ctx);
    modeEvent("selected",{alignment:"Plan",checking:"tests"},null);
    await commands.get("agent-audit").handler("start",ctx);
    const preview=readPreviewSet(join(dir,"audit"),readdirSync(join(dir,"audit","previews"))[0].replace(/\.json$/, ""));
    assert.equal(preview.basePrompt,"STRUCTURED BASE"); assert.equal(preview.basePromptEvidence.source,"injected-test-harness"); assert.doesNotMatch(preview.basePrompt,/STALE|Alignment: Vibe/);
    assert.deepEqual(Object.keys(preview.dialDefinitions),["alignment","checking"]);
    for(const item of preview.previews) { assert.equal((item.systemPrompt.match(/# Working Mode/g)||[]).length,1); assert.deepEqual(item.dials,{alignment:item.alignment,checking:item.checking}); }

    await handlers.get("before_agent_start")({prompt:"task",systemPrompt:"base at audit hook",systemPromptOptions:options},ctx);
    modeEvent("applied",{alignment:"Plan",checking:"tests"},{alignment:"Plan",checking:"tests"});
    handlers.get("turn_start")({turnIndex:0,timestamp:Date.now()},ctx);
    await handlers.get("context")({messages:[{role:"user",content:"task"}]},ctx);
    modeEvent("selected",{alignment:"Spec",checking:"adversarial"},{alignment:"Plan",checking:"tests"});
    await handlers.get("before_provider_request")({payload:{system:"logical"}},ctx);
    await fetch(`${url}/v1/messages`,{method:"POST",body:JSON.stringify({system:"actual"}),headers:{"content-type":"application/json"}});
    entries.push({type:"message",id:"assistant-life",parentId:null,timestamp:new Date().toISOString(),message:{role:"assistant",content:[{type:"text",text:"native"}],stopReason:"stop"}});
    writeFileSync(sessionFile,`${JSON.stringify({type:"session",version:3,id:"session-lifecycle",cwd:repo})}\n${JSON.stringify(entries[0])}\n`);
    await handlers.get("turn_end")({turnIndex:0,message:entries[0].message,toolResults:[]},ctx);
    await commands.get("agent-audit").handler("stop",ctx);
    const [summary]=listCaptures(join(dir,"audit")); const exported=readCaptureSet(join(dir,"audit"),summary.id,{materializeOutputs:true});
    assert.deepEqual(exported.capture.workingMode.appliedToPrompt,{alignment:"Plan",checking:"tests"});
    assert.deepEqual(exported.capture.workingMode.selectedNextTurnAtTransport,{alignment:"Spec",checking:"adversarial"});
    assert.equal(exported.capture.producerSources.length,3); assert.ok(exported.capture.producerSources.every(source=>source.status==="observed"&&source.sha256));
    assert.equal(exported.capture.runtime.piCodingAgent.version,"0.84.3"); assert.equal(exported.capture.runtime.piCodingAgent.extensionResolved.resolution,"extension module resolver");
    assert.equal(exported.nativeOutputs.status,"observed"); assert.equal(exported.nativeOutputs.entries[0].id,"assistant-life");
  } finally { globalThis.fetch=originalFetch; await close(server); rmSync(dir,{recursive:true,force:true}); }
});

test("Working Mode metadata stays unobserved when no Working Mode event arrives", async () => {
  const dir=temp("agent-audit-unobserved-mode-"), originalFetch=globalThis.fetch; const {server,url}=await listen((req,res)=>{req.resume();req.on("end",()=>res.end("ok"));});
  const handlers=new Map(), commands=new Map(), entries=[];
  const ctx={mode:"tui",cwd:repo,model:{id:"fake",provider:"anthropic",api:"anthropic-messages",baseUrl:url},sessionManager:{getSessionId:()=>"unobserved",getSessionFile:()=>null,getLeafId:()=>null,getEntries:()=>entries},ui:{setStatus:()=>{},notify:()=>{},confirm:async()=>true},getSystemPromptOptions:()=>({cwd:repo,skills:[],contextFiles:[],selectedTools:[]})};
  const pi={on:(name,handler)=>handlers.set(name,handler),events:{on:()=>{}},registerCommand:(name,value)=>commands.set(name,value),getCommands:()=>[],getActiveTools:()=>[],getAllTools:()=>[]};
  registerAgentAudit(pi,{auditRoot:join(dir,"audit"),buildSystemPrompt:()=>"base"});
  try {
    await handlers.get("session_start")({},ctx); await commands.get("agent-audit").handler("start",ctx);
    handlers.get("before_agent_start")({prompt:"task",systemPrompt:"base",systemPromptOptions:ctx.getSystemPromptOptions()},ctx); handlers.get("turn_start")({turnIndex:0},ctx); handlers.get("context")({messages:[]},ctx);
    handlers.get("before_provider_request")({payload:{}},ctx); await fetch(`${url}/v1/messages`,{method:"POST",body:"{}"}); await handlers.get("turn_end")({},ctx); await commands.get("agent-audit").handler("stop",ctx);
    const record=readCaptureSet(join(dir,"audit"),listCaptures(join(dir,"audit"))[0].id).capture;
    assert.equal(record.workingMode.appliedToPrompt,null); assert.equal(record.workingMode.selectedNextTurnAtTransport,null);
  } finally { globalThis.fetch=originalFetch; await close(server); rmSync(dir,{recursive:true,force:true}); }
});

test("actual installed Pi resource is distinct from injected preview harness evidence", async (t) => {
  let pi; try { pi=realpathSync(execFileSync("which",["pi"],{encoding:"utf8"}).trim()); } catch { return t.skip("pi executable unavailable"); }
  const packages=runtimePackages(pi); assert.equal(packages.piCodingAgent.runningProcess.status,"observed");
  assert.equal(packages.piCodingAgent.runningProcess.resolution,"process.argv[1] nearest matching package");
  const built=await loadPiBasePrompt({cwd:repo,skills:[],contextFiles:[],selectedTools:[]},pi);
  assert.equal(built.evidence.source,"running-process-pi-installation"); assert.equal(built.evidence.version,packages.piCodingAgent.runningProcess.version);
  assert.equal(typeof built.prompt,"string"); assert.ok(built.prompt.length>100);
});

test("failed observer installation leaves capture off and saves no preview", async () => {
  const dir=temp("agent-audit-install-failure-"), original=globalThis.fetch, handlers=new Map(), commands=new Map(), notices=[];
  const ctx={mode:"tui",cwd:repo,sessionManager:{getSessionId:()=>"failed",getSessionFile:()=>null,getLeafId:()=>null,getEntries:()=>[]},ui:{setStatus:()=>{},notify:(message)=>notices.push(message),confirm:async()=>true},getSystemPromptOptions:()=>({cwd:repo,skills:[],contextFiles:[],selectedTools:[]})};
  const pi={on:(name,handler)=>handlers.set(name,handler),events:{on:()=>{}},registerCommand:(name,value)=>commands.set(name,value),getCommands:()=>[],getActiveTools:()=>[],getAllTools:()=>[]};
  registerAgentAudit(pi,{auditRoot:join(dir,"audit"),buildSystemPrompt:()=>"base"});
  try { globalThis.fetch=undefined; await handlers.get("session_start")({},ctx); await commands.get("agent-audit").handler("start",ctx); assert.deepEqual(listPreviewSets(join(dir,"audit")),[]); assert.match(notices.at(-1),/remains OFF.*No preview was saved/); }
  finally { globalThis.fetch=original; rmSync(dir,{recursive:true,force:true}); }
});

test("extension stays off in RPC/outside scope and restores wrappers on reload shutdown", async () => {
  function extensionHarness(mode,cwd,confirmed) {
    const handlers=new Map(), commands=new Map(), statuses=new Map(), notices=[];
    const sessionManager={getSessionId:()=>"session-test",getSessionFile:()=>null,getLeafId:()=>null,getEntries:()=>[]};
    const ctx={mode,cwd,hasUI:mode==="tui"||mode==="rpc",sessionManager,ui:{setStatus:(key,value)=>statuses.set(key,value),notify:(message,type)=>notices.push({message,type}),confirm:async()=>confirmed},getSystemPrompt:()=>"base",getSystemPromptOptions:()=>({cwd,selectedTools:[],skills:[],contextFiles:[]})};
    const pi={on:(name,handler)=>handlers.set(name,handler),events:{on:()=>{},emit:()=>{}},registerCommand:(name,value)=>commands.set(name,value),getCommands:()=>[],getActiveTools:()=>[],getAllTools:()=>[]};
    agentAuditExtension(pi); handlers.get("session_start")({reason:"startup"},ctx);
    return {handlers,commands,statuses,notices,ctx};
  }
  const originalFetch=globalThis.fetch, originalWebSocket=globalThis.WebSocket;
  const outside=temp("agent-audit-command-outside-");
  try {
    for(const [mode,cwd] of [["rpc",repo],["tui",outside]]) {
      const h=extensionHarness(mode,cwd,true); await h.commands.get("agent-audit").handler("start",h.ctx);
      assert.equal(globalThis.fetch,originalFetch); assert.match(h.notices.at(-1).message,/only in a Pi terminal inside/);
    }
    const h=extensionHarness("tui",repo,true); await h.commands.get("agent-audit").handler("start",h.ctx);
    assert.notEqual(globalThis.fetch,originalFetch); const previewId=h.statuses.get("agent-audit").split("· ").at(-1);
    await h.handlers.get("session_shutdown")({reason:"reload"},h.ctx);
    assert.equal(globalThis.fetch,originalFetch); assert.equal(globalThis.WebSocket,originalWebSocket); assert.equal(h.statuses.get("agent-audit"),undefined);
    const previewDir=join(repo,".review","agent-audit","previews");
    const created=readFileSync(join(previewDir,`${[...requirePreviewNames(previewDir)].find(name=>name.startsWith(previewId))}`),"utf8");
    const fullId=JSON.parse(created).id; unlinkSync(join(previewDir,`${fullId}.json`));
  } finally { globalThis.fetch=originalFetch; globalThis.WebSocket=originalWebSocket; rmSync(outside,{recursive:true,force:true}); }
});
function requirePreviewNames(dir){ return process.getBuiltinModule("node:fs").readdirSync(dir); }

test("coverage and scope are conservative", () => {
  assert.equal(providerCoverage({api:"anthropic-messages",provider:"anthropic",baseUrl:"https://api.anthropic.com"}).httpUrl,"https://api.anthropic.com/v1/messages");
  const codex=providerCoverage({api:"openai-codex-responses",provider:"openai-codex",baseUrl:"https://chatgpt.com/backend-api"});
  assert.equal(codex.webSocketUrl,"wss://chatgpt.com/backend-api/codex/responses");
  assert.equal(providerCoverage({api:"google-generative-ai",provider:"google"}).status,"unsupported");
  assert.equal(providerCoverage({api:"anthropic-messages",provider:"custom",baseUrl:"https://token@example.com?key=secret"}).status,"unsupported");
  const external=temp("agent-audit-outside-"); const escape=join(repo,"extensions","agent-audit",`.escape-${process.pid}`); symlinkSync(external,escape,"dir");
  try { assert.equal(isInside(repo,repo),true); assert.equal(isInside(repo,external),false); assert.equal(isInside(repo,escape),false); }
  finally { rmSync(escape,{force:true}); rmSync(external,{recursive:true,force:true}); }
});

test("JSON CLI lists, exports, and cleans healthy records beside corruption", () => {
  const root=join(repo,".review","agent-audit"); const store=createAuditStore(root); const id=randomUUID(), corrupt=randomUUID();
  store.writeCapture({schemaVersion:AUDIT_SCHEMA_VERSION,format:AUDIT_FORMAT,id,timestamp:"2026-01-01T00:00:00.000Z",previewSetId:null,session:{sessionId:"cli-test",sessionFile:null},provider:{provider:"fake",model:"fake"},transport:{kind:"missing"}});
  writeFileSync(join(root,"captures",`${corrupt}.json`),"{");
  try {
    const cli=join(repo,"extensions/agent-audit/cli.mjs");
    const listed=JSON.parse(execFileSync(process.execPath,[cli,"list"],{encoding:"utf8"})); assert.equal(listed.captures.find(item=>item.id===id).status,"readable"); assert.equal(listed.captures.find(item=>item.id===corrupt).status,"unreadable");
    const inspected=JSON.parse(execFileSync(process.execPath,[cli,"inspect",id],{encoding:"utf8"})); assert.equal(inspected.capture.id,id);
    assert.equal(JSON.parse(execFileSync(process.execPath,[cli,"export",id],{encoding:"utf8"})).capture.id,id);
    execFileSync(process.execPath,[cli,"cleanup",corrupt]); assert.ok(lstatSafe(join(root,"captures",`${id}.json`)));
    assert.throws(()=>execFileSync(process.execPath,[cli,"inspect","../../session.jsonl"],{stdio:"pipe"}));
  } finally { rmSync(join(root,"captures",`${id}.json`),{force:true}); rmSync(join(root,"captures",`${corrupt}.json`),{force:true}); }
});

test("preview-only CLI prepares and predictably reopens frozen Atelier evidence without a provider request", () => {
  const root=join(repo,".review","agent-audit"); const store=createAuditStore(root); const id=randomUUID(); const cli=join(repo,"extensions/agent-audit/cli.mjs");
  const previews=[]; for(const alignment of Object.keys(alignmentGuidance))for(const checking of Object.keys(checkingGuidance))previews.push({id:`${alignment}-${checking}`,alignment,checking,label:"UNSENT",systemPrompt:`${alignment}/${checking}`,advertisedSkills:[]});
  store.writePreview({schemaVersion:AUDIT_SCHEMA_VERSION,format:`${AUDIT_FORMAT}.previews`,id,timestamp:new Date().toISOString(),basePrompt:"base",previews,installedExplicitlyCallable:[],activeTools:[],sourceSnapshots:{}});
  try {
    const first=JSON.parse(execFileSync(process.execPath,[cli,"atelier-preview",id],{encoding:"utf8"})); assert.equal(first.reused,false);
    const evidence=JSON.parse(readFileSync(first.audit,"utf8")); assert.deepEqual(evidence.requests,[]); assert.equal(evidence.previewSets[0].previews.length,16);
    assert.equal(first.token,undefined); assert.ok(first.humanUrl.includes("?token=")); assert.match(first.preflightCommand,/tools\/agent-audit\/preflight\.mjs/);
    const tokenPath=join(root,"exports",".access",`preview-${id}.token`); assert.equal(statSync(tokenPath).mode&0o077,0); assert.equal(tokenPath.startsWith(`${first.root}/`),false);
    const second=JSON.parse(execFileSync(process.execPath,[cli,"atelier-preview",id],{encoding:"utf8"})); assert.equal(second.reused,true); assert.equal(second.audit,first.audit);
    mkdirSync(join(first.root,".review")); writeFileSync(join(first.root,".review","atelier.json"),"comment-state"); const frozen=readFileSync(first.audit,"utf8"), stale=join(first.root,"explorer.mjs.new"); writeFileSync(stale,"stale prior temp"); rmSync(join(first.root,"surface.css")); writeFileSync(join(first.root,"explorer.mjs"),"old viewer");
    const repaired=JSON.parse(execFileSync(process.execPath,[cli,"atelier-preview",id],{encoding:"utf8"})); assert.deepEqual(repaired.repaired,["surface.css","explorer.mjs"]); assert.equal(readFileSync(stale,"utf8"),"stale prior temp"); assert.equal(readFileSync(join(first.root,".review","atelier.json"),"utf8"),"comment-state"); assert.equal(readFileSync(first.audit,"utf8"),frozen);
    assert.equal(JSON.parse(execFileSync(process.execPath,[cli,"previews",id],{encoding:"utf8"})).id,id);
    execFileSync(process.execPath,[cli,"cleanup-preview",id]); assert.equal(lstatSafe(first.root),null); assert.equal(lstatSafe(tokenPath),null);
  } finally { rmSync(join(root,"previews",`${id}.json`),{force:true}); rmSync(join(root,"exports",`preview-${id}`),{recursive:true,force:true}); }
});
function lstatSafe(path){ try{return lstatSync(path);}catch(error){if(error.code==="ENOENT")return null;throw error;} }

test("Atelier Surface is informational first with the complete explorer collapsed", () => {
  const html=readFileSync(join(repo,"tools/agent-audit/surface.html"),"utf8"), css=readFileSync(join(repo,"tools/agent-audit/surface.css"),"utf8"), explorer=readFileSync(join(repo,"tools/agent-audit/explorer.mjs"),"utf8");
  assert.doesNotMatch(`${html}${explorer}`,/https?:\/\//); assert.doesNotMatch(`${html}${explorer}`,/innerHTML/); assert.match(explorer,/textContent/);
  assert.match(html,/<title>How Pi uses instructions<\/title>/); assert.match(html,/Pi builds context, then runs a model-and-tool loop/); assert.match(html,/Conversation, instructions, rules, tools, skill catalog/); assert.match(html,/does not change permissions, remove project rules/);
  for(const value of ["Vibe","Align","Plan","Spec","unset","light","tests","adversarial"]) assert.match(html,new RegExp(`<dt>${value}</dt>`));
  assert.match(html,/A catalog entry is not a loaded skill body/); assert.match(html,/ILLUSTRATION · NOT THE LIVE SELECTION/);
  const advanced=html.indexOf('<details id="advanced" class="advanced-shell">'); assert.ok(advanced>0); assert.ok(html.indexOf('<select id="baseline-source"')>advanced); assert.ok(html.indexOf('Download exact JSON evidence')>advanced); assert.doesNotMatch(html.slice(advanced,html.indexOf('>',advanced)+1),/\sopen(?:\s|>)/);
  const mainWords=html.slice(0,advanced).replace(/<[^>]+>/g,' ').match(/[A-Za-z]+/g)?.length??0; assert.ok(mainWords>=200&&mainWords<=380,`main explainer is ${mainWords} words`);
  assert.match(html,/key="reading"[^>]+comments="sheet"/); assert.match(html,/key="differences"[^>]+comments="sheet"/); assert.match(html,/key="evidence"/);
  assert.match(explorer,/Jump to saved combination/); assert.match(explorer,/setRevealResolver/); assert.match(explorer,/advanced\.open = true/); assert.match(explorer,/record-category/); assert.match(explorer,/Exact complete saved JSON/);
  assert.match(readFileSync(join(repo,"tools/agent-audit/preflight.mjs"),"utf8"),/Authorization.*Bearer/);
  assert.equal((html.match(/<atelier-cockpit/g)||[]).length,2); assert.match(html,/class="mobile-attention"/);
  assert.match(css,/\.flow \{/); assert.match(css,/\.alignment-panel/); assert.match(css,/\.checking-panel/); assert.match(css,/@media \(max-width:800px\)/); assert.match(css,/\.mobile-attention \{ position:sticky; top:0;/); assert.match(css,/\.desktop-attention \{ display:none; \}/);
});

test("Atelier server requires its private token and still rejects hostile routes", async () => {
  const dir=temp("agent-audit-server-"); const outside=temp("agent-audit-secret-"), token="a".repeat(43), tokenFile=join(outside,"access.token");
  writeFileSync(join(dir,"index.html"),"ok"); writeFileSync(join(dir,"audit.json"),"{}"); writeFileSync(join(outside,"secret"),"secret"); writeFileSync(tokenFile,token,{mode:0o600}); chmodSync(tokenFile,0o600); symlinkSync(join(outside,"secret"),join(dir,"leak"));
  const reservation=await listen((_req,res)=>res.end()); const port=reservation.server.address().port; await close(reservation.server); const host={Host:`127.0.0.1:${port}`}, auth={...host,Authorization:`Bearer ${token}`};
  const child=spawn(process.execPath,[join(repo,"tools/agent-audit/server.mjs")],{cwd:repo,env:{...process.env,PORT:String(port),ROOT:dir,UI:join(dir,"index.html"),ACCESS_TOKEN_FILE:tokenFile},stdio:["ignore","pipe","pipe"]});
  try {
    await waitFor(async()=>{ try { return (await rawRequest(port,"/api/state",auth)).status===200; } catch { return false; } });
    assert.equal((await rawRequest(port,"/audit.json",host)).status,401); assert.equal((await rawRequest(port,"/api/state",auth)).status,200);
    const bootstrap=await rawRequest(port,`/?token=${token}`,host); assert.equal(bootstrap.status,303); assert.doesNotMatch(bootstrap.headers.location,/token/);
    assert.equal((await rawRequest(port,"/audit.json",{...host,Cookie:bootstrap.headers["set-cookie"][0].split(";")[0]})).status,200);
    const fakePreflight=join(outside,"preflight.mjs"); writeFileSync(fakePreflight,"const r=await fetch(new URL('/api/state',process.argv[process.argv.indexOf('--url')+1]));if(!r.ok)throw new Error(String(r.status));console.log('authorized');\n");
    assert.match(execFileSync(process.execPath,[join(repo,"tools/agent-audit/preflight.mjs"),fakePreflight,"--url",`http://127.0.0.1:${port}/?token=${token}`],{encoding:"utf8",env:{...process.env,ACCESS_TOKEN_FILE:tokenFile}}),/authorized/);
    assert.equal((await rawRequest(port,"/api/state",{Host:"evil.example",Authorization:`Bearer ${token}`})).status,421);
    assert.equal((await rawRequest(port,"/api/state",{...auth,Origin:"https://evil.example"},"POST","{}")).status,403);
    assert.equal((await rawRequest(port,"/leak",auth)).status,403);
  } finally { child.kill("SIGTERM"); await new Promise(resolve=>child.once("exit",resolve)); rmSync(dir,{recursive:true,force:true}); rmSync(outside,{recursive:true,force:true}); }
});

function rawRequest(port,path,headers,method="GET",body) { return new Promise((resolve,reject)=>{ const req=http.request({host:"127.0.0.1",port,path,headers,method},res=>{const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));}); req.on("error",reject); if(body) req.end(body); else req.end(); }); }
