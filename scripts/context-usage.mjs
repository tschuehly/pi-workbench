#!/usr/bin/env node
// Measure the context a Pi session loads before the first user message, as reported by the provider.
// Runs one tiny `pi -p` turn per shape (lead, and a child with the scout profile's tool allowlist)
// and reads the first assistant message's usage: input + cacheRead + cacheWrite.
// The child run sets PI_WORKBENCH_EXECUTION_KIND like the adapter, so child-only extension behavior applies.
// ponytail: child = lead minus tools not on the scout allowlist; the per-task profile text (~100 tokens) is not included.
//
// --pi-web measures a fresh PI WEB Durable Chat instead (live instance, --pi-web-url, default :8506); --json adds an
// estimated per-part breakdown. The total includes the prompt and any nudge PI WEB injected before it (listed, ~tens of tokens).
//
// Usage: node scripts/context-usage.mjs [--cwd DIR] [--model provider/id] [--json] [--pi-web [--pi-web-url URL]] [-- extra pi args, e.g. -e ext.ts]
import { spawnSync } from "node:child_process";
import { CHILD_TOOLS as childTools } from "../extensions/subagent/core.mjs";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const cwd = path.resolve(arg("--cwd", process.cwd()));
const model = arg("--model", "anthropic/claude-opus-5-5");
const extra = process.argv.includes("--") ? process.argv.slice(process.argv.indexOf("--") + 1) : [];

function measure(extraArgs, env = process.env) {
  const dir = mkdtempSync(path.join(tmpdir(), "ctx-usage-"));
  try {
    const r = spawnSync("pi", ["-p", "--session-dir", dir, "--model", model, "--thinking", "low", ...extra, ...extraArgs, "Reply with the single word ok."], { cwd, env, encoding: "utf8", timeout: 180_000 });
    const file = readdirSync(dir).find((f) => f.endsWith(".jsonl"));
    if (!file) throw new Error(`pi wrote no session (exit ${r.status}): ${(r.stderr || r.stdout).slice(0, 300)}`);
    for (const line of readFileSync(path.join(dir, file), "utf8").split("\n")) {
      if (!line) continue;
      const e = JSON.parse(line);
      const u = e.type === "message" && e.message.role === "assistant" ? e.message.usage : null;
      if (u) return (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
    }
    throw new Error("no assistant usage in session");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv.includes("--pi-web")) {
  const { measurePiWeb } = await import("./context-usage-pi-web.mjs");
  const r = { cwd, model, measuredAt: new Date().toISOString(), ...(await measurePiWeb({ cwd, model, url: arg("--pi-web-url") })) };
  console.log(process.argv.includes("--json") ? JSON.stringify(r) : `PI WEB startup context (${model}, ${cwd})\n  lead: ${r.total} tokens (includes ${r.includedMessages.map((m) => `${m.kind} ${m.chars} chars`).join(", ")})\n  chat ${r.chatId}: ${r.cleanup}`);
  if (r.cleanup !== "deleted") process.exitCode = 2;
  process.exit();
}

const result = { cwd, model, measuredAt: new Date().toISOString(), lead: measure([]), child: measure(["--tools", childTools.join(",")], { ...process.env, PI_WORKBENCH_EXECUTION_KIND: "subagent" }) };
console.log(process.argv.includes("--json") ? JSON.stringify(result) : `startup context (${model}, ${cwd})\n  lead:  ${result.lead} tokens\n  child: ${result.child} tokens`);
