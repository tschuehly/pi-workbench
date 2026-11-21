// PI WEB mode of context-usage.mjs: one Durable Chat turn through the PI WEB HTTP API, usage read from its session.sqlite.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const text = (content) => (typeof content === "string" ? content : (content ?? []).map((c) => c.text ?? "").join(""));

/** First reply's usage in the lead conversation, the system entry it was sent with, and the messages before it. */
export function startupEntries(records) {
  const lead = records.find((r) => r.kind === "pi.system")?.conversationId;
  const at = records.findIndex((r) => r.conversationId === lead && r.model?.[0]?.role === "assistant" && r.model[0].usage);
  if (at < 0) throw new Error("no assistant usage in the Chat");
  const u = records[at].model[0].usage;
  const before = records.slice(0, at).filter((r) => r.conversationId === lead);
  return {
    total: (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0),
    system: before.findLast((r) => r.kind === "pi.system").model[0],
    messages: before.filter((r) => r.kind !== "pi.system").map((r) => ({ kind: r.kind, chars: r.model.map((m) => text(m.content)).join("").length })),
  };
}

/** Estimate: each part's share of characters, scaled to the measured token total. */
export function breakdown(system, messages, total) {
  const parts = { tools: JSON.stringify(system.toolsAdded ?? []).length };
  for (const [name, body] of Object.entries(system.sections ?? {})) parts[`section:${name}`] = body.length;
  parts.messages = messages.reduce((n, m) => n + m.chars, 0);
  const chars = Object.values(parts).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(parts).map(([k, c]) => [k, Math.round((total * c) / chars)]));
}

export function readEntries(file) {
  // A live Chat holds the database lock: read a copy with its WAL.
  const dir = mkdtempSync(path.join(tmpdir(), "ctx-usage-web-"));
  try {
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(file + suffix)) copyFileSync(file + suffix, path.join(dir, "session.sqlite" + suffix));
    const db = new DatabaseSync(path.join(dir, "session.sqlite"));
    try { return db.prepare("select record from entries order by id").all().map((r) => JSON.parse(r.record)); } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function measurePiWeb({ cwd, model, url = "http://127.0.0.1:8506", dataDir = path.join(homedir(), ".pi-web-durable") }) {
  const api = `${url}/api/machines/local/sessions`;
  const call = async (p, body) => {
    const res = await fetch(api + p, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(`${p}: ${res.status} ${json.error ?? ""}`);
    return json;
  };
  const chat = await call("", { cwd, runtime: "durable" });
  const ref = { cwd };
  let result, cleanup;
  try {
    const [provider, ...id] = model.split("/");
    await call(`/${chat.id}/model`, { ...ref, provider, modelId: id.join("/") });
    await call(`/${chat.id}/thinking-level`, { ...ref, level: "low" });
    await call(`/${chat.id}/prompt`, { ...ref, text: "Reply with the single word ok." });
    for (let i = 0; ; i++) {
      const s = await call(`/${chat.id}/status?cwd=${encodeURIComponent(cwd)}`);
      if (!s.isStreaming && s.tokens?.total > 0) break;
      if (i > 90) throw new Error("no reply within 180 s");
      await new Promise((r) => setTimeout(r, 2000));
    }
    const { total, system, messages } = startupEntries(readEntries(path.join(dataDir, "durable", chat.id, "session.sqlite")));
    result = { chatId: chat.id, total, includedMessages: messages, breakdownEstimate: breakdown(system, messages, total) };
  } finally {
    // shortcut: Durable Chats cannot be archived or deleted through PI WEB yet; this succeeds once PI WEB supports it.
    cleanup = await call(`/${chat.id}/archive`, ref)
      .then(() => call("/bulk/delete-archived", { sessions: [{ id: chat.id, cwd }] }))
      .then((d) => (d.deletedSessionIds?.includes(chat.id) ? "deleted" : `not deleted: ${d.failures?.[0]?.error}`), (e) => `not deleted: ${e.message}`);
  }
  return { ...result, cleanup };
}
