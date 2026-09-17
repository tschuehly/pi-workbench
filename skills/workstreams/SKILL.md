---
name: workstreams
description: Interact directly with Pi Workbench Workstreams while their PI WEB interface is unavailable or incomplete. Use when the user asks to create, select, inspect, summarize, report the state or history of, update, checkpoint, or close a Workstream through the agent instead of the UI.
---

# Workstreams

Use the bundled CLI as the temporary interface to the authoritative user-local Workstream Store. Set `SKILL_DIR` to this skill's directory. The CLI reads `PI_WORKBENCH_WORKSTREAM_DIR` when set; otherwise it uses `~/.pi-workbench/workstreams`, matching the Workbench service default.

```bash
node "$SKILL_DIR/scripts/workstreams.mjs" --help
```

Treat a Workstream as a sparse attention ledger, not a transcript, plan, workspace, or managed Run. Record only meaningful attention changes.

## 1. Find or create the Workstream

List active Workstreams first:

```bash
node "$SKILL_DIR/scripts/workstreams.mjs" list '{}'
```

This returns every open Workstream as a summary. When the user asks to check all current Workstreams in full, inspect every returned id:

```bash
node "$SKILL_DIR/scripts/workstreams.mjs" inspect '{"workstreamId":"ws-example"}'
```

Use `{"includeClosed":true}` only when the user asks about history. Before changing one Workstream, inspect its full snapshot. If none fits, ask for or derive a short stable id and title, then create it with a unique idempotency key:

```json
{"workstreamId":"ws-example","idempotencyKey":"create-ws-example","title":"Example","producer":"owner"}
```

Pass JSON inline, as `@file`, or as stdin. Keep temporary request files outside the repository.

**Complete when:** every Workstream the user asked to check has been inspected, or one open Workstream is selected and its current snapshot and revision are known.

### Report Workstream status

When the user asks what Workstreams exist, where work stands, or what happened, make the review read-only:

1. List open Workstreams, select the requested topic or project, and state the inclusion rule when the match is not obvious. Inspect every selected id in full.
2. Reconstruct the original goal from the title and earliest durable evidence available in the snapshot. If the title is insufficient, label the reconstructed goal as an inference.
3. Explain why the Workstream exists, what it covers, and its important boundaries in a short description. Write for an owner who no longer remembers the work.
4. Synthesize three to six consequential events from the projected session checkpoints, Human Tasks, and links: shipped results, decisions, pivots, failed approaches, and preserved evidence. Keep them in logical order and omit routine session activity. A session checkpoint is that session's projection, not a global latest checkpoint; expose unresolved conflicts instead of silently choosing one.
5. State what is now complete, usable, active, blocked, superseded, or merely proposed, and name the evidence supporting that state. Name the actor and exact gate under `Waiting on`.
6. Derive directories only from concrete checkpoint or link references. For local absolute paths, verify whether each directory currently exists and label its role or absence. Never infer a path from a title or repository name.
7. Separate current evidence from recorded history. Report `updatedAt`; when current state has not been live-verified, call it the last recorded state rather than presenting it as current fact.

Report each Workstream in this shape:

```markdown
### <title>
**ID:** `<id>`
**Original goal:** <plain-language outcome>
**Created:** <date> · **Last recorded update:** <date>
**Directories:** <primary path and any evidence/worktree paths, each with role and existence>

**Description:** <why this exists, its scope, and its important boundaries>

**What happened**
- <consequential event and why it mattered>

**Last recorded state:** <what is complete, usable, active, blocked, superseded, or only proposed, with evidence>
**Waiting on:** <named actor and exact gate, or none>
**Next:** <one concrete continuation>
**Open decisions:** <pending Human Tasks or none>
```

End a multi-Workstream review with a compact disposition table when it helps the owner allocate attention. Keep facts traceable to the inspected snapshot, distinguish recommendation from stored state, and omit empty narrative detail.

**Complete when:** every selected Workstream has an explained goal, description, consequential history, evidenced state, directories, next action, and freshness boundary.

## 2. Associate this session when needed

Check `PI_SESSION_ID`, then inspect the selected Workstream. If this session is already active there, preserve that association. If it appears in another Workstream, stop and report the conflict. A session has exactly one home Workstream.

When trusted host context exposes complete `machineId`, `projectId`, and `workspaceId` values, append `session.pending` and `session.confirmed` together using one association key and the actual identifiers:

```json
{
  "workstreamId":"ws-example",
  "expectedRevision":1,
  "idempotencyKey":"associate-SESSION_ID",
  "records":[
    {"type":"session.pending","producer":"session","sourceSessionId":"SESSION_ID","payload":{"sessionId":"SESSION_ID","associationKey":"manual-SESSION_ID","machineId":"MACHINE_ID","projectId":"PROJECT_ID","workspaceId":"WORKSPACE_ID"}},
    {"type":"session.confirmed","producer":"session","sourceSessionId":"SESSION_ID","payload":{"sessionId":"SESSION_ID","associationKey":"manual-SESSION_ID","machineId":"MACHINE_ID","projectId":"PROJECT_ID","workspaceId":"WORKSPACE_ID"}}
  ]
}
```

Replace every uppercase placeholder with the exact trusted value. Use the actual session id throughout.

When complete host context is unavailable, use the supported agent-only association instead:

```bash
node "$SKILL_DIR/scripts/workstreams.mjs" associate '{"workstreamId":"ws-example","expectedRevision":1,"idempotencyKey":"associate-SESSION_ID"}'
```

`associate` reads `PI_SESSION_ID` and records an active session with all three location fields absent. This permits checkpointing immediately; PI WEB can later resolve the exact catalog location and append `session.anchor.repaired`, which is required before PI WEB can continue that checkpoint in a new session. Never infer or copy identifiers from `cwd`, repository names, branch names, or other Workstreams. If `PI_SESSION_ID` is unavailable, stop without appending.

**Complete when:** the inspected projection shows this session as active in exactly one Workstream. A missing anchor does not block completion or checkpointing.

## 3. Append one meaningful change

Inspect immediately before every mutation and use its `revision` as `expectedRevision`. Invoke `append` with one or more related semantic records. Give every request a unique idempotency key; repeat the exact request and key only when retrying an uncertain result.

Supported records and payloads are defined in `packages/workstream-store/src/index.d.ts`. Common records are:

- `link.upsert` / `link.removed` for relevant file, repository, plan, Run, or artifact references;
- `human-task.upsert` for a durable question that needs an answer;
- `human-task.answered` and then, separately, `human-task.resolved`;
- `checkpoint.replaced` for a checkpoint, written automatically at a meaningful attention change;
- `checkpoint.failed` or `checkpoint.stale` only when that explicit state occurred.

Set `producer` to `session` for agent-proposed records and `owner` for a mutation the user explicitly chose. Include `sourceSessionId` for records originating here. Keep raw conversation, routine tool activity, repeated summaries, and large artifact contents out of the ledger.

On `STALE_REVISION`, inspect again, reconcile the intervening change, and submit a new request with a new idempotency key. On any other error, report the stable error code instead of editing the store file.

**Complete when:** the new snapshot contains the intended semantic change and unrelated state is unchanged.

## 4. Checkpoint automatically

Write a checkpoint when meaningful attention changes, without waiting for the user to confirm each
field. Persist five values:

- `whatChanged`: what now exists or works, naming concrete artifacts;
- `remains`: what is blocked or still owed;
- `next`: one obvious owner-facing action;
- `nextSessionPrompt`: the exact prompt to paste into a fresh attended Pi session;
- `references`: only the concrete paths or identifiers needed to resume.

Lead with the point and make the checkpoint sufficient to resume without rereading chat. Keep `nextSessionPrompt` under 2,000 characters and include only the context, constraints, starting action, and references needed to continue safely; do not turn it into a transcript or execution plan.

Append `checkpoint.replaced` for the current active session with a unique checkpoint id, then tell the user what you wrote so they can correct it. A checkpoint is a correctable projection, not an authority transition: a later checkpoint supersedes an earlier one, and a failed write leaves the previous checkpoint unchanged. Closing the Workstream still requires the user's explicit instruction.

**Complete when:** the new checkpoint is the session's latest and the user has been told what it says.

## 5. Close deliberately

Before closing, inspect and report unresolved Human Tasks and scratch-file links. Close only on the user's explicit instruction, using the latest revision and a unique idempotency key. Closure preserves unresolved items and deletes no files.

```json
{"workstreamId":"ws-example","expectedRevision":4,"idempotencyKey":"close-ws-example","producer":"owner","sourceSessionId":"SESSION_ID"}
```

**Complete when:** the inspected Workstream is closed and any proposed cleanup remains subject to separate human confirmation.
