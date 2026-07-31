#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const resolver = path.join(here, "resolve-runtime-binding.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-routing-test-"));
const quotaPath = path.join(temp, "quota.json");
const catalogPath = path.join(temp, "catalog.txt");

const quota = {
  generatedAt: "2026-07-30T00:00:00Z",
  providers: [
    {
      provider: "claude",
      windows: [
        { id: "five_hour", kind: "session", percentRemaining: 70, resetsAt: "later" },
        { id: "model:fable", kind: "model", percentRemaining: 80, resetsAt: "later" },
      ],
      state: { status: "fresh", stale: false, refreshedAt: "now" },
    },
    {
      provider: "codex",
      windows: [{ id: "seven_day", kind: "weekly", percentRemaining: 90, resetsAt: "later" }],
      state: { status: "fresh", stale: false, refreshedAt: "now" },
    },
  ],
};
const catalog = [
  "anthropic claude-fable-5 1M 128K yes yes",
  "anthropic claude-opus-4-8 1M 128K yes yes",
  "openai-codex gpt-5.6-sol 272K 128K yes yes",
].join("\n");

try {
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  fs.writeFileSync(catalogPath, catalog);

  const pass = JSON.parse(execFileSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(pass.status, "pass");
  assert.equal(pass.modelBinding.provider, "anthropic");
  assert.equal(pass.modelBinding.quotaSnapshot.relevantWindows.length, 2);

  quota.providers[0].state.stale = true;
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const stale = spawnSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(stale.status, 3);
  assert.match(stale.stderr, /not fresh/);

  quota.providers[0].state.stale = false;
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  fs.writeFileSync(catalogPath, "openai-codex gpt-5.6-sol");
  const absent = spawnSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(absent.status, 3);
  assert.match(absent.stderr, /Pi model .* unavailable/);

  console.log("resolve-runtime-binding: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
