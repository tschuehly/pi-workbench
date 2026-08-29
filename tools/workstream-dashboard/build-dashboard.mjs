import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const storePath = path.join(os.homedir(), ".pi-workbench/workstreams/workstreams.json");
const cli = path.resolve("skills/workstreams/scripts/workstreams.mjs");
const store = JSON.parse(fs.readFileSync(storePath, "utf8"));

const groups = {
  Embabel: new Set([
    "ws-worlds-console-impeccable-20260828",
    "ws-appliance-realm-authoring-photoquest-20260828",
    "ws-openapi-source-learning-20260828",
    "ws-domain-concepts-to-realms",
    "ws-evolving-user-ontology",
    "ws-first-ingest-user-learning",
    "ws-multi-agent-repo-guidance-20260825",
    "ws-embabel-worktree-reconciliation-20260828",
  ]),
  "Pi Workbench": new Set([
    "ws-atelier-principles-20260828",
    "ws-pi-custom-message-cache-fix-20260828",
    "ws-workbench-guiding-principles-20260807",
    "ws-level-2-and-post-settlement-20260826",
    "ws-subagent-communication",
    "ws-stateless-model-call",
    "ws-autonomous-grill",
    "pi-web-prototype-ux",
    "ws-dodo-reach-pi-tool-research",
    "ws-multidimensional-working-mode",
    "ws-firstmate-coordination-mate-20260807",
    "ws-d9692f8a-db7c-42d3-92e1-ea5211698c07",
    "ws-682532ba-4d43-475e-aa45-07c4c6fc476f",
    "ws-cbbf825a-cf69-4742-ba2b-1e007f30bb85",
  ]),
  PhotoQuest: new Set([
    "ws-realm-photoquest-20260806",
    "ws-photoquest-admin-operations-ux-hardening-20260806",
    "ws-photoquest-studio-gpt-led-reconciliation",
    "ws-photoquest-studio-pi-baseline-reset",
    "ws-photoquest-marketing-autopilot-v1-20260807",
    "ws-business-data-activation",
    "ws-photoquest-concept-33-runtime-probe-20260806",
    "ws-b7271636-1d5b-4f99-9cba-3ce0a013dd2f",
    "ws-40d5be8b-5f5b-434f-a9fb-37715c34e6d9",
    "ws-87946399-0dbd-4a62-b2d1-d52fac7573a8",
    "ws-photoquest-finish-video-kit-20260807",
  ]),
  Personal: new Set([
    "ws-mac-cleanup-reproducibility-20260807",
    "ws-steuererklaerung-2025-20260806",
  ]),
};

const audit = {
  "ws-embabel-worktree-reconciliation-20260828": ["current", "Reconciles Embabel repositories, worktrees, unpushed commits, and running work before cleanup.", "A fresh 31-repository audit is checkpointed; preservation and cleanup choices remain deliberately owner-directed."],
  "ws-worlds-console-impeccable-20260828": ["current", "Finishes the Worlds Console audit, polish, and navigation decision.", "Branch, interim commit, review artifacts, running tools, and two pending owner decisions match the checkpoint."],
  "ws-appliance-realm-authoring-photoquest-20260828": ["blocked", "Dogfoods fresh PhotoQuest realm authoring from its OpenAPI specification.", "Waiting for appliance PR #55 and default-world PR #4; both were still open and mergeable."],
  "ws-atelier-principles-20260828": ["stale", "Defines principles for simple, one-shot Atelier use.", "The named session stopped while newer reliability evidence appeared in later skill-incubator and Worlds Console sessions."],
  "ws-openapi-source-learning-20260828": ["current", "Improves generic authenticated OpenAPI learning and operation accounting.", "The checkpoint now reconciles merged PR #993; Slice 1 accurately points only to the remaining 11-operation map and review-page work."],
  "ws-pi-custom-message-cache-fix-20260828": ["blocked", "Prepares an upstream Pi lifecycle and cache-retention fix.", "The patch and regression test pass, but issue #8773 lacks maintainer approval."],
  "ws-domain-concepts-to-realms": ["blocked", "Decides how embedded domain concepts should split into owned realms.", "Artifacts remain current; implementation awaits the owner's boundary choice and a rebase."],
  "ws-workbench-guiding-principles-20260807": ["stale", "Distills Workbench principles and owner-facing operating choices.", "It mixes three lineages and still points to retired Operating Levels; valid owner tasks remain."],
  "ws-evolving-user-ontology": ["blocked", "Reassesses what an evolving user ontology should mean for Embabel Me.", "Only the owner can define the product failures, ontology boundary, and principle classifications."],
  "ws-realm-photoquest-20260806": ["stale", "Built and evaluated safe PhotoQuest API access as a realm.", "All tracked implementation is complete and the old bake-off is archived; explicit closure as superseded remains."],
  "ws-first-ingest-user-learning": ["current", "Designs the first learning loop during initial email ingestion.", "Issue #967 remains open and three product decisions remain unanswered."],
  "ws-level-2-and-post-settlement-20260826": ["superseded", "Planned Level 2 implementation and post-settlement cleanup.", "Operating Levels were retired in favor of independent Alignment and Checking axes; three unrelated cleanup tasks survive."],
  "ws-photoquest-admin-operations-ux-hardening-20260806": ["superseded", "Hardened PhotoQuest admin operations and customer-update flows.", "All substantive commits were replayed into master; no push or merge remains."],
  "ws-multi-agent-repo-guidance-20260825": ["current", "Decides where shared AGENTS.md guidance and cross-agent skills belong.", "The workspace-root file remains unowned and CLAUDE.md remains a regular file."],
  "ws-mac-cleanup-reproducibility-20260807": ["current", "Reclaims disk space and makes cleanup repeatable.", "The real tool run resolved critical disk pressure; one explicit safety-posture choice remains."],
  "ws-photoquest-studio-gpt-led-reconciliation": ["superseded", "Reconciled corrected Studio videos and forward pipeline policy.", "The repository formally closed this plan on 2026-08-18; the Workstream never recorded it."],
  "ws-photoquest-studio-pi-baseline-reset": ["superseded", "Tried rebuilding Studio from the last reliable Pi baseline.", "GPT-led reconciliation and later master work chose a different direction."],
  "ws-photoquest-marketing-autopilot-v1-20260807": ["superseded", "Developed the original autonomous PhotoQuest video pipeline.", "Its worktree and referenced artifacts are gone; current master uses Marketing Studio Autopilot."],
  "ws-subagent-communication": ["stale", "Planned improved child monitoring, continuation, and communication.", "Referenced plans were archived and much functionality shipped elsewhere; one cache decision remains."],
  "ws-stateless-model-call": ["current", "Evaluates bounded model calls without managed agent lifecycle.", "The feature remains deliberately specified but not implemented or activated."],
  "ws-autonomous-grill": ["current", "Evolves adversarial decision review into frontier rounds and a human tree walk.", "Implementation and tests still match; a live validation run remains."],
  "pi-web-prototype-ux": ["superseded", "Built the unified PI WEB shell and Workstream prototype.", "Commit 2254859 archived its plans and replaced them with docs/plans/workbench-ui.md."],
  "ws-business-data-activation": ["current", "Activates read-only PhotoQuest business-data providers and export tooling.", "A verified merge and Marketing Studio integration are now the explicit next checkpoint."],
  "ws-steuererklaerung-2025-20260806": ["blocked", "Tracks the documents and decisions needed to finish the 2025 tax return.", "Five tasks remain unanswered; the self-filing deadline appears passed unless adviser filing applies."],
  "ws-40d5be8b-5f5b-434f-a9fb-37715c34e6d9": ["stale", "Empty legacy PhotoQuest realm Workstream.", "It had no checkpoint, task, or link and was closed as an orphan."],
  "ws-b7271636-1d5b-4f99-9cba-3ce0a013dd2f": ["stale", "Tracked completion of an older Studio model benchmark.", "Its continuation task pointed to files that no longer exist."],
  "ws-dodo-reach-pi-tool-research": ["completed", "Captured audited research on DODOREACH's Pi tool-shaping ideas.", "The checkpoint explicitly says no analysis work remains."],
  "ws-photoquest-concept-33-runtime-probe-20260806": ["stale", "Tracked correction of a runtime-identity compatibility probe.", "Its checkpoint still waited for process 74061 after that process had ended."],
};

function groupFor(id) {
  for (const [group, ids] of Object.entries(groups)) if (ids.has(id)) return group;
  return "Pi Workbench";
}

function firstSentence(value = "") {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "No summary recorded.";
  const match = clean.match(/^(.{1,180}?[.!?])(?:\s|$)/);
  return match ? match[1] : clean.slice(0, 180) + (clean.length > 180 ? "…" : "");
}

const items = Object.entries(store.workstreams).map(([id, raw]) => {
  const ledger = raw.ledger || [];
  const created = ledger.find((record) => record.type === "workstream.created");
  const closed = [...ledger].reverse().find((record) => record.type === "workstream.closed");
  const staleByCheckpoint = new Map(
    ledger.filter((record) => record.type === "checkpoint.stale")
      .map((record) => [record.payload.checkpointId, record])
  );
  const checkpoints = ledger.filter((record) => record.type === "checkpoint.replaced").map((record) => {
    const checkpoint = record.payload.checkpoint;
    const stale = staleByCheckpoint.get(checkpoint.id);
    return {
      id: checkpoint.id,
      sessionId: record.payload.sessionId,
      recordedAt: record.recordedAt,
      producer: record.producer,
      revision: record.revision,
      label: firstSentence(checkpoint.whatChanged),
      whatChanged: checkpoint.whatChanged || "",
      remains: checkpoint.remains || "",
      next: checkpoint.next || "",
      nextSessionPrompt: checkpoint.nextSessionPrompt || "",
      references: checkpoint.references || [],
      stale: stale ? { reason: stale.payload.reason, recordedAt: stale.recordedAt } : null,
    };
  });
  const snapshot = JSON.parse(execFileSync("node", [cli, "inspect", JSON.stringify({ workstreamId: id, includeClosed: true })], { encoding: "utf8" }));
  const fallbackCheckpoint = checkpoints.at(-1);
  const [status, explainer, reason] = audit[id] || [
    snapshot.closed ? "closed" : "unreviewed",
    fallbackCheckpoint ? firstSentence(fallbackCheckpoint.whatChanged) : `Workstream: ${created?.title || id}.`,
    snapshot.closed ? "Closed before the current staleness audit; its timeline is preserved for reference." : "Created after the current staleness audit; no audit verdict has been assigned yet.",
  ];
  return {
    id,
    title: snapshot.title || created?.title || id,
    group: groupFor(id),
    status,
    explainer,
    reason,
    lifecycle: snapshot.closed ? "closed" : "open",
    createdAt: snapshot.createdAt || created?.recordedAt,
    updatedAt: snapshot.updatedAt || closed?.recordedAt || created?.recordedAt,
    closedAt: snapshot.closedAt,
    revision: snapshot.revision,
    sessions: snapshot.sessions.length,
    tasks: snapshot.humanTasks,
    links: snapshot.links,
    checkpoints,
  };
}).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

const data = {
  generatedAt: new Date().toISOString(),
  source: storePath,
  items,
};

fs.writeFileSync(path.join(root, "dashboard-data.json"), JSON.stringify(data, null, 2));
const safeData = JSON.stringify(data).replaceAll("<", "\\u003c");

const template = fs.readFileSync(path.join(root, "dashboard.template.html"), "utf8");
const html = template.replace("__WORKSTREAM_DATA__", safeData);

fs.writeFileSync(path.join(root, "index.html"), html);
console.log(`Wrote ${items.length} Workstreams and ${items.reduce((sum, item) => sum + item.checkpoints.length, 0)} checkpoints to ${path.join(root, "index.html")}`);
