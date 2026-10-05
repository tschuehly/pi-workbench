import assert from "node:assert/strict";
import fs, { mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

// Synthetic secrets only: never point tests at the real ~/.pi/agent/auth.json.
const agentDir = mkdtempSync(join(process.env.PI_TMP ?? tmpdir(), "pi-secret-redaction-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { redact, redactDeep } = await import("./redact.mjs");
const extension = (await import("./index.ts")).default;

const COPILOT = "tid=synthetic0000;exp=1999999999;sku=x;proxy-ep=proxy.example;8kp=1:0123456789abcdef0123456789abcdef";
const OPAQUE = "Zq7VtXk2pR9mWbL4nH8sJcY1dFgE6uAo"; // no known prefix: only known-value redaction catches it
function writeAuth(entries, mtime) {
  const path = join(agentDir, "auth.json");
  writeFileSync(path, JSON.stringify(entries));
  utimesSync(path, mtime, mtime);
}
writeAuth({ "github-copilot": { type: "oauth", access: COPILOT, refresh: OPAQUE, expires: 1, availableModelIds: ["claude-sonnet-4.5-preview"] } }, 1000);

test("auth.json string leaves are redacted; type and model-ID lists survive", () => {
  assert.equal(redact(`token: ${OPAQUE}`), "token: [REDACTED:auth.json]");
  assert.equal(redact(COPILOT), "[REDACTED:auth.json]");
  assert.equal(redact("oauth claude-sonnet-4.5-preview"), "oauth claude-sonnet-4.5-preview");
});

test("a rotated auth.json is re-read on mtime change", () => {
  const rotated = "Rt5WqP0zLk3NvB7xYm2HcJ8sDfG4aUe1";
  assert.equal(redact(rotated), rotated);
  writeAuth({ anthropic: { type: "oauth", access: rotated }, "github-copilot": { access: COPILOT, refresh: OPAQUE } }, 2000);
  assert.equal(redact(rotated), "[REDACTED:auth.json]");
});

test("secret-named env values are redacted; short, path, boolean and author values are not", () => {
  process.env.EMBABEL_KEY_SECRET = "vK4pX9qL2mZ7wR3tYb8nC6dF";
  process.env.SOME_TOKEN_PATH = "/Users/example/.config/token-file";
  process.env.FEATURE_AUTH_ENABLED = "true";
  process.env.SHORT_KEY = "abc123";
  process.env.GIT_AUTHOR_NAME = "ExampleAuthorName";
  try {
    assert.equal(redact("export X=vK4pX9qL2mZ7wR3tYb8nC6dF"), "export X=[REDACTED:env:EMBABEL_KEY_SECRET]");
    for (const plain of ["/Users/example/.config/token-file", "true", "abc123", "ExampleAuthorName"]) assert.equal(redact(plain), plain);
  } finally {
    for (const name of ["EMBABEL_KEY_SECRET", "SOME_TOKEN_PATH", "FEATURE_AUTH_ENABLED", "SHORT_KEY", "GIT_AUTHOR_NAME"]) delete process.env[name];
  }
});

test("prefix patterns catch unknown secrets; git SHAs and ordinary words survive", () => {
  const cases = {
    ["ghp_" + "A".repeat(36)]: "github-token",
    ["github_pat_" + "B".repeat(30)]: "github-token",
    ["sk-ant-oat01-" + "C".repeat(40)]: "anthropic-key",
    ["sk-proj-" + "D".repeat(40)]: "api-key",
    ["eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlX3N5bnRo"]: "jwt",
    ["tid=abc;exp=123;proxy-ep=x;8kp=1:ff"]: "copilot-token",
    ["-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----"]: "private-key",
  };
  for (const [secret, source] of Object.entries(cases)) assert.equal(redact(`x ${secret} y`), `x [REDACTED:${source}] y`);
  const sha = "b76e27f0c3a1d9e8f7a6b5c4d3e2f1a0b9c8d7e6";
  const plain = `commit ${sha} blob 0123456789abcdef0123456789abcdef01234567 risk-assessment-for-the-long-branch-name task-sk-item`;
  assert.equal(redact(plain), plain);
});

test("redactDeep keeps references when clean and skips images and thinking", () => {
  const clean = { content: [{ type: "text", text: "ok" }] };
  assert.equal(redactDeep(clean), clean);
  const image = { type: "image", data: OPAQUE };
  const thinking = { type: "thinking", thinking: OPAQUE, thinkingSignature: "sig" };
  const out = redactDeep([image, thinking, { type: "text", text: OPAQUE }, { output: OPAQUE }]);
  assert.equal(out[0], image);
  assert.equal(out[1], thinking);
  assert.deepEqual(out.slice(2), [{ type: "text", text: "[REDACTED:auth.json]" }, { output: "[REDACTED:auth.json]" }]);
});

test("extension hooks redact tool results, assistant text (not tool calls), and model context", async () => {
  const handlers = {};
  extension({ on: (name, handler) => { handlers[name] = handler; } });
  const result = await handlers.tool_result({ content: [{ type: "text", text: `cat auth.json -> ${OPAQUE}` }], details: { stdout: OPAQUE } });
  assert.deepEqual(result.content, [{ type: "text", text: "cat auth.json -> [REDACTED:auth.json]" }]);
  assert.deepEqual(result.details, { stdout: "[REDACTED:auth.json]" });
  assert.equal(await handlers.tool_result({ content: [{ type: "text", text: "clean" }], details: undefined }), undefined);

  const call = { type: "toolCall", id: "1", name: "bash", arguments: { command: `echo ${OPAQUE}` } };
  const ended = await handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: `here: ${OPAQUE}` }, call] } });
  assert.equal(ended.message.content[0].text, "here: [REDACTED:auth.json]");
  assert.equal(ended.message.content[1], call);
  assert.equal(await handlers.message_end({ message: { role: "user", content: [{ type: "text", text: OPAQUE }] } }), undefined);

  const context = await handlers.context({ messages: [{ role: "bashExecution", command: "env", output: OPAQUE }] });
  assert.equal(context.messages[0].output, "[REDACTED:auth.json]");
});

// Counts auth.json stats, i.e. auth/env snapshots, taken while fn runs. `fail` makes every stat throw that error code.
function authStats(fn, fail) {
  const real = fs.statSync;
  const spy = mock.method(fs, "statSync", (path, options) => {
    if (fail) throw Object.assign(new Error(fail), { code: fail });
    return real(path, options);
  });
  syncBuiltinESMExports();
  try { fn(); return spy.mock.calls.filter((call) => String(call.arguments[0]).endsWith("auth.json")).length; }
  finally { spy.mock.restore(); syncBuiltinESMExports(); }
}

const A = "Ah3kLm9QwZx7Pv2RtYb5NcJ8dFgE6uSo";
const B = "Bq8sWe4RtYu1IoPa6SdFgH3jKlZx9CvN"; // same length as A, so the file size does not change
const C = "Cz5XcVb2NmQw8ErTy4UiOp7AsDf1GhJk";
const authFile = join(agentDir, "auth.json");
const authBody = (secret) => JSON.stringify({ anthropic: { type: "oauth", access: secret } });

test("one auth/env snapshot per public operation, batched hooks included, none without strings", () => {
  writeAuth({ anthropic: { access: A } }, 3000);
  const handlers = {};
  extension({ on: (name, handler) => { handlers[name] = handler; } });
  assert.equal(authStats(() => assert.equal(redact(A), "[REDACTED:auth.json]")), 1);
  assert.equal(authStats(() => redact("")), 0);
  assert.equal(authStats(() => redactDeep({ a: [A, "x", { b: `y ${A}` }], n: 1 })), 1);
  const plain = [1, true, false, null, undefined, "", { type: "image", data: A }];
  assert.equal(authStats(() => assert.equal(redactDeep(plain), plain)), 0);
  assert.equal(redactDeep(true), true);

  let result;
  const event = { content: [{ type: "text", text: A }, { type: "text", text: "ok" }], details: { stdout: A, stderr: "" }, structuredContent: { value: `v=${A}` } };
  const before = structuredClone(event);
  assert.equal(authStats(() => { result = handlers.tool_result(event); }), 1);
  assert.deepEqual(event, before, "the original event is not mutated");
  assert.deepEqual(result, {
    content: [{ type: "text", text: "[REDACTED:auth.json]" }, { type: "text", text: "ok" }],
    details: { stdout: "[REDACTED:auth.json]", stderr: "" },
    structuredContent: { value: "v=[REDACTED:auth.json]" },
  });
  assert.equal(result.content[1], event.content[1], "unchanged leaves keep their reference");

  const thinking = { type: "thinking", thinking: A, thinkingSignature: "sig" };
  const call = { type: "toolCall", id: "1", name: "bash", arguments: { command: A } };
  const message = { role: "assistant", content: [{ type: "text", text: `a ${A}` }, thinking, call, { type: "text", text: "line1\r\nline2\n" }, { type: "text", text: A }] };
  let ended;
  assert.equal(authStats(() => { ended = handlers.message_end({ message }); }), 1);
  assert.deepEqual(ended.message.content.map((block) => block.text), ["a [REDACTED:auth.json]", undefined, undefined, "line1\r\nline2\n", "[REDACTED:auth.json]"]);
  for (const i of [1, 2, 3]) assert.equal(ended.message.content[i], message.content[i]);
  assert.equal(message.content[0].text, `a ${A}`);

  const messages = Array.from({ length: 50 }, (_, i) => ({ role: "toolResult", content: [{ type: "text", text: i % 10 ? "clean" : A }] }));
  let context;
  assert.equal(authStats(() => { context = handlers.context({ messages }); }), 1);
  assert.equal(context.messages[0].content[0].text, "[REDACTED:auth.json]");
  assert.equal(context.messages[1], messages[1]);
  assert.equal(authStats(() => assert.equal(handlers.context({ messages: [] }), undefined)), 0);
});

test("same-size auth.json rotation with a restored mtime is seen by the next operation", () => {
  const handlers = {};
  extension({ on: (name, handler) => { handlers[name] = handler; } });
  writeFileSync(authFile, authBody(A));
  utimesSync(authFile, 4000, 4000);
  assert.equal(handlers.tool_result({ content: [{ type: "text", text: A }] }).content[0].text, "[REDACTED:auth.json]");

  writeFileSync(authFile, authBody(B)); // in place: same size, mtime restored below; ctime still moves
  utimesSync(authFile, 4000, 4000);
  assert.equal(handlers.tool_result({ content: [{ type: "text", text: B }] }).content[0].text, "[REDACTED:auth.json]");
  assert.equal(redact(A), A, "the rotated-out value is no longer a known value");

  const next = join(agentDir, "auth.json.next");
  writeFileSync(next, authBody(C)); // atomic rename: same size and mtime, new inode
  utimesSync(next, 4000, 4000);
  renameSync(next, authFile);
  assert.equal(redactDeep({ out: C }).out, "[REDACTED:auth.json]");
  assert.equal(redact(B), B);
});

test("failed stat or parse keeps the last known auth values; removal drops them on the next operation", () => {
  writeAuth({ anthropic: { access: A } }, 5000);
  assert.equal(redact(A), "[REDACTED:auth.json]");
  writeFileSync(authFile, authBody(B).slice(0, 20)); // mid-write
  assert.equal(redact(A), "[REDACTED:auth.json]");
  authStats(() => assert.equal(redactDeep([A])[0], "[REDACTED:auth.json]"), "EACCES");
  writeAuth({ anthropic: { access: B } }, 5000);
  assert.equal(redact(B), "[REDACTED:auth.json]");
  assert.equal(redact(A), A);
  rmSync(authFile);
  assert.equal(redact(B), B);
  writeAuth({ "github-copilot": { access: COPILOT, refresh: OPAQUE } }, 6000);
});

test("env rotation and removal are seen by the next operation", () => {
  process.env.SYNTHETIC_API_KEY = A;
  try {
    assert.equal(redactDeep({ v: A }).v, "[REDACTED:env:SYNTHETIC_API_KEY]");
    process.env.SYNTHETIC_API_KEY = B;
    assert.deepEqual(redactDeep([A, B]), [A, "[REDACTED:env:SYNTHETIC_API_KEY]"]);
    delete process.env.SYNTHETIC_API_KEY;
    assert.equal(redact(B), B);
  } finally { delete process.env.SYNTHETIC_API_KEY; }
});

test("redactDeep still overflows on cycles rather than silently skipping them", () => {
  const cycle = { text: "x" };
  cycle.self = cycle;
  assert.throws(() => redactDeep(cycle), RangeError);
});
