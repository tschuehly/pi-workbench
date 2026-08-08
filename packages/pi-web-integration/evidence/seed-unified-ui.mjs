import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createUserLocalWorkstreamStore } from "../../workstream-store/src/index.js";

const directory = process.argv[2];
const mode = process.argv[3] ?? "seed";
if (directory === undefined || !["seed", "--append-checkpoint-failure"].includes(mode)) {
  throw new Error("Usage: node evidence/seed-unified-ui.mjs <workstream-directory> [--append-checkpoint-failure]");
}
const target = resolve(directory);
await mkdir(target, { recursive: true, mode: 0o700 });
const entries = await readdir(target);
const store = createUserLocalWorkstreamStore({ directory: target });

if (mode === "--append-checkpoint-failure") {
  if (!entries.includes("workstreams.json")) throw new Error("Checkpoint-failure mode requires a previously seeded evidence store.");
  const snapshot = await store.inspect("ws-unified-evidence");
  if (snapshot.title !== "Ship unified Workbench navigation") throw new Error("Refusing to mutate a store without the expected synthetic Workstream.");
  await store.append({
    workstreamId: snapshot.id,
    expectedRevision: snapshot.revision,
    idempotencyKey: "browser-checkpoint-failure",
    records: [{
      type: "checkpoint.failed",
      producer: "pi-web",
      sourceSessionId: "session-current",
      payload: { sessionId: "session-current", reason: "Deterministic browser fixture interrupted the replacement." },
    }],
  });
  console.log(`Appended deterministic checkpoint failure in ${target}`);
} else {
  if (entries.length !== 0) throw new Error("Seed mode requires an empty directory and will not modify existing Workstream data.");
  await store.create({ workstreamId: "ws-unified-evidence", idempotencyKey: "create-open", title: "Ship unified Workbench navigation", producer: "owner" });
  await store.append({
    workstreamId: "ws-unified-evidence",
    expectedRevision: 1,
    idempotencyKey: "seed-open",
    records: [
      { type: "session.pending", producer: "pi-web", payload: { sessionId: "session-current", associationKey: "launch-current", machineId: "local", projectId: "pi-workbench", workspaceId: "main" } },
      { type: "session.confirmed", producer: "pi-web", payload: { sessionId: "session-current", associationKey: "launch-current", machineId: "local", projectId: "pi-workbench", workspaceId: "main" } },
      { type: "checkpoint.replaced", producer: "owner", sourceSessionId: "session-current", payload: { sessionId: "session-current", checkpoint: { id: "cp-current", whatChanged: "Unified navigation and shared session canvas are implemented.", remains: "Complete browser acceptance evidence.", next: "Verify responsive and failure states.", nextSessionPrompt: "Verify the unified PI WEB interface with deterministic fixtures and record release evidence.", references: ["docs/plans/pi-web-unified-ui-production.md"] } } },
      { type: "human-task.upsert", producer: "session", sourceSessionId: "session-current", payload: { task: { id: "task-review", title: "Approve responsive unified navigation?", detail: "Check desktop, narrow, reconnect, and focus behavior.", answerKind: "yes-no", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "change", label: "Change" }], materiality: "material" } } },
      { type: "link.upsert", producer: "session", sourceSessionId: "session-current", payload: { link: { id: "link-plan", kind: "file", reference: "docs/plans/pi-web-unified-ui-production.md", label: "Production plan" } } },
      { type: "session.pending", producer: "pi-web", payload: { sessionId: "session-stale", associationKey: "launch-stale", machineId: "local", projectId: "pi-workbench", workspaceId: "feature/stale" } },
      { type: "session.confirmed", producer: "pi-web", payload: { sessionId: "session-stale", associationKey: "launch-stale", machineId: "local", projectId: "pi-workbench", workspaceId: "feature/stale" } },
      { type: "checkpoint.replaced", producer: "owner", sourceSessionId: "session-stale", payload: { sessionId: "session-stale", checkpoint: { id: "cp-stale", whatChanged: "Earlier responsive behavior was implemented.", remains: "Reconcile the accepted breakpoint.", next: "Replace this stale checkpoint.", nextSessionPrompt: "Reconcile the responsive breakpoint before continuing." } } },
      { type: "checkpoint.stale", producer: "owner", sourceSessionId: "session-stale", payload: { sessionId: "session-stale", checkpointId: "cp-stale", reason: "The accepted responsive contract changed." } },
      { type: "session.pending", producer: "pi-web", payload: { associationKey: "launch-failed", machineId: "local", projectId: "pi-workbench", workspaceId: "feature/failed" } },
      { type: "session.failed", producer: "pi-web", payload: { associationKey: "launch-failed", reason: "PI WEB could not create the attended session." } },
    ],
  });
  await store.create({ workstreamId: "ws-closed-evidence", idempotencyKey: "create-closed", title: "Retired interface probe", producer: "owner" });
  await store.close({ workstreamId: "ws-closed-evidence", expectedRevision: 1, idempotencyKey: "close-closed", producer: "owner" });
  console.log(`Seeded deterministic unified UI evidence in ${target}`);
}
