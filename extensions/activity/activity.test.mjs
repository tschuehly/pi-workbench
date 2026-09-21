import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ACTIVITY_CHANNEL, ACTIVITY_MAX_ITEMS, createActivitySurface, renderActivityLines, shortModel } from "./activity.mjs";

const items = [
  { id: "sub-1", kind: "subagent", role: "independent-review", model: "anthropic/claude-opus-5", effort: "high", objective: "Review PR embabel/me#993", activity: "reading monitor/runtime.ts" },
  { id: "work-1", kind: "worker", name: "Catalog", role: "implementation", model: "openai-codex/gpt-5.6-terra", effort: "medium", objective: "Run focused tests", activity: "running npm test" },
  { id: "monitor-1", kind: "monitor", name: "build", objective: "waiting for CI", activity: "watching" },
  { id: "shell-1", kind: "shell", objective: "npm test", activity: "running" },
];

test("packs action-first activity pills into responsive rows", () => {
  assert.equal(shortModel("anthropic/claude-opus-5"), "Opus 5");
  assert.equal(shortModel("openai-codex/gpt-5.6-terra"), "Terra 5.6");
  assert.equal(shortModel("anthropic/claude-haiku-4-5-20251001"), "Haiku 4.5");

  const wide = renderActivityLines(items, 120);
  assert.equal(wide.length, 3, "two pills fit on each wide row");
  assert.match(wide[1], /🤖 reading monitor\/runtime\.ts\s+⟨review · Opus 5 · high⟩/);
  assert.match(wide[1], /🧰 running npm test\s+⟨Catalog · build · Terra 5\.6 · medium⟩/);
  assert.equal(wide.join("\n").includes("embabel/me#993"), false);
  assert.equal(wide.every((line) => visibleWidth(line) <= 120), true);

  const narrow = renderActivityLines(items, 70);
  assert.equal(narrow.length, 5, "narrow terminals use one pill per row");
  assert.equal(narrow.every((line) => visibleWidth(line) <= 70), true);
  const halfPane = renderActivityLines(items.slice(0, 2), 86);
  assert.equal(halfPane.length, 3, "packing does not squeeze metadata into undersized columns");
  assert.match(halfPane[2], /⟨Catalog · build · Terra 5\.6 · medium⟩$/);
});

test("keeps metadata visible by truncating a long action first", () => {
  const line = renderActivityLines([{ ...items[0], activity: "reading a very long nested path that cannot possibly fit in one compact pill.ts" }], 48)[1];
  assert.match(stripTerminalSequences(line), /…\s+⟨review · Opus 5 · high⟩$/);
  assert.equal(visibleWidth(line) <= 48, true);

  const roomy = renderActivityLines([{ ...items[0], activity: "x".repeat(200) }], 120)[1];
  assert.ok(visibleWidth(roomy) > 58, "a lone pill uses the available action width");

  const narrowWorker = stripTerminalSequences(renderActivityLines([items[1]], 40)[1]);
  assert.match(narrowWorker, /^🧰 .+⟨Terra 5\.6 · medium⟩$/);
});

test("strips terminal controls and caps the widget at ten lines", () => {
  const many = Array.from({ length: 24 }, (_, index) => ({ ...items[0], id: String(index), activity: `reading file-${index}\u001b[2J.ts` }));
  const lines = renderActivityLines(many, 70);
  assert.equal(lines.length, 10);
  assert.match(lines.at(-1), /… 16 more/);
  assert.equal(lines.join("").includes("\u001b[2J"), false);
});

test("updates one persistent width-aware widget", () => {
  const calls = [];
  let component;
  let renders = 0;
  const surface = createActivitySurface();
  surface.attach({ setWidget: (id, value) => {
    calls.push([id, value]);
    if (typeof value === "function") component = value({ requestRender: () => { renders += 1; } });
  } });

  surface.update({ type: "upsert", item: items[0] });
  assert.equal(renders, 1);
  assert.match(component.render(80)[1], /Opus 5 · high/);
  surface.update({ type: "remove", id: "sub-1" });
  assert.deepEqual(component.render(80), []);
  surface.dispose();
  assert.deepEqual(calls.at(-1), [ACTIVITY_CHANNEL, undefined]);
});

test("publishes bounded normalized RPC snapshots as activity changes", () => {
  const statuses = [];
  const surface = createActivitySurface();
  surface.attachRpc({ setStatus: (...args) => statuses.push(args) });
  assert.deepEqual(JSON.parse(statuses.at(-1)[1]), { schemaVersion: 1, items: [] });

  const longObjective = `Review\u001b[2J ${"x".repeat(300)}`;
  surface.update({ type: "upsert", item: { ...items[0], objective: longObjective, activity: "reading first.ts" } });
  surface.update({ type: "upsert", item: { ...items[0], objective: longObjective, activity: "running focused tests" } });
  const changed = JSON.parse(statuses.at(-1)[1]);
  assert.equal(changed.items[0].activity, "running focused tests");
  assert.equal(changed.items[0].objective.includes("\u001b[2J"), false);
  assert.equal(changed.items[0].objective.length, 240);

  surface.update({ type: "upsert", item: { id: "shell-secret", kind: "shell", objective: "deploy --token secret", activity: "running" } });
  for (let index = 0; index < ACTIVITY_MAX_ITEMS + 5; index += 1) {
    surface.update({ type: "upsert", item: { id: `worker-${index}`, kind: "worker", name: "x".repeat(100), activity: "working" } });
  }
  const bounded = JSON.parse(statuses.at(-1)[1]);
  assert.equal(bounded.items.length, ACTIVITY_MAX_ITEMS);
  assert.equal(bounded.items.at(-1).name.length, 48);
  assert.equal(bounded.items.some((item) => item.kind === "shell"), false, "tool arguments stay out of the delegate roster");

  surface.dispose();
  assert.deepEqual(statuses.at(-1), [ACTIVITY_CHANNEL, undefined]);
});

test("normalizes a child's self-reported status like its siblings", () => {
  const statuses = [];
  const surface = createActivitySurface();
  surface.attachRpc({ setStatus: (...args) => statuses.push(args) });

  surface.update({ type: "upsert", item: { ...items[0], reportedStatus: `Wiring the schema\u001b[2J field ${"x".repeat(200)}` } });
  const reported = JSON.parse(statuses.at(-1)[1]).items[0].reportedStatus;
  assert.equal(reported.includes("\u001b[2J"), false);
  assert.equal(reported.length, 120);

  surface.update({ type: "upsert", item: { ...items[0], reportedStatus: "   " } });
  assert.equal(JSON.parse(statuses.at(-1)[1]).items[0].reportedStatus, undefined, "blank reports are dropped, not published");

  surface.update({ type: "upsert", item: { ...items[0], reportedStatus: undefined } });
  assert.equal(JSON.parse(statuses.at(-1)[1]).items[0].reportedStatus, undefined, "an inferred-only update still normalizes without a self-report");

  surface.dispose();
});
