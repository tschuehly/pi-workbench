// Real smoke for continueFrom: the extension with a real adapter and two real Luna children.
// Run: node extensions/subagent/continue-smoke.mjs  (spends two short routine-tier requests)
import assert from "node:assert/strict";
import subagentExtension from "./index.ts";

const entries = [];
const tools = new Map();
const handlers = new Map();
subagentExtension({
  events: { emit: () => {} },
  on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  registerTool: (tool) => tools.set(tool.name, tool),
  registerShortcut: () => {},
  sendMessage: () => {},
  appendEntry: (customType, data) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
});
const ctx = { cwd: process.cwd(), model: { provider: "anthropic", id: "claude-opus-5-5" }, modelRegistry: undefined, sessionManager: { getSessionId: () => "continue-smoke-lead", getBranch: () => entries } };
for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
const run = (params) => tools.get("subagent").execute("call", { profile: "plain", cognitiveRole: "routine", modelOverride: "openai/gpt-6-luna", ...params }, undefined, undefined, ctx);

const word = `orchid-${Math.floor(Math.random() * 1e6)}`;
const first = await run({ name: "Smoke remember", task: `Remember the code word ${word}. Use no tools. Reply with exactly: OK` });
console.log("first:", first.content[0].text.split("\n")[0]);
const firstId = first.details.executionId;
assert.equal(first.details.outcome, "success");
const second = await run({ name: "Smoke recall", continueFrom: firstId, task: "Which code word did I give you earlier? Use no tools. Reply with only the word." });
console.log("second:", second.content[0].text.split("\n")[0]);
assert.equal(second.details.outcome, "success");
assert.match(second.content[0].text, new RegExp(word));
console.log("PASS: continued child recalled", word);
process.exit(0);
