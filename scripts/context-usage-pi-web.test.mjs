import assert from "node:assert/strict";
import test from "node:test";
import { breakdown, startupEntries } from "./context-usage-pi-web.mjs";

const system = { role: "system", content: "", sections: { preamble: "a".repeat(100), skills: "b".repeat(300) }, toolsAdded: [{ name: "x" }] };
const rows = [
  { kind: "workbench.storage-guard", conversationId: 1, model: [{ role: "user", content: [{ type: "text", text: "Disk low" }] }] },
  { kind: "pi.user", conversationId: 1, model: [{ role: "user", content: "Reply with the single word ok." }] },
  { kind: "pi.system", conversationId: 1, model: [system] },
  { kind: "pi.assistant", conversationId: 2, model: [{ role: "assistant", usage: { input: 1, cacheRead: 1, cacheWrite: 1 } }] },
  { kind: "pi.assistant", conversationId: 1, model: [{ role: "assistant", usage: { input: 4, cacheRead: 900, cacheWrite: 96 } }] },
  { kind: "pi.assistant", conversationId: 1, model: [{ role: "assistant", usage: { input: 9, cacheRead: 9, cacheWrite: 9 } }] },
];

test("startupEntries takes the first lead-conversation reply and what preceded it", () => {
  const r = startupEntries(rows);
  assert.equal(r.total, 1000);
  assert.equal(r.system, system);
  assert.deepEqual(r.messages, [{ kind: "workbench.storage-guard", chars: 8 }, { kind: "pi.user", chars: 30 }]);
});

test("startupEntries fails without a reply", () => {
  assert.throws(() => startupEntries(rows.slice(0, 3)), /no assistant usage/);
});

test("breakdown scales each part's character share to the measured total", () => {
  const { total, system: s, messages } = startupEntries(rows);
  const b = breakdown(s, messages, total);
  const tools = JSON.stringify(system.toolsAdded).length;
  const chars = tools + 100 + 300 + 38;
  assert.equal(b["section:preamble"], Math.round((1000 * 100) / chars));
  assert.equal(b["section:skills"], Math.round((1000 * 300) / chars));
  assert.equal(b.tools, Math.round((1000 * tools) / chars));
  assert.equal(b.messages, Math.round((1000 * 38) / chars));
});
