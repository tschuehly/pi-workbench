---
name: workstreams
description: Interact directly with Pi Workbench Workstreams while their PI WEB interface is unavailable or incomplete. Use when the user asks to create, select, inspect, update, checkpoint, or close a Workstream through the agent instead of the UI.
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

## 2. Associate this session when needed

Check `PI_SESSION_ID`, then inspect the selected Workstream. If this session is already active there, preserve that association. If it appears in another Workstream, stop and report the conflict. Otherwise append `session.pending` and `session.confirmed` together using one association key:

```json
{
  "workstreamId":"ws-example",
  "expectedRevision":1,
  "idempotencyKey":"associate-SESSION_ID",
  "records":[
    {"type":"session.pending","producer":"session","sourceSessionId":"SESSION_ID","payload":{"sessionId":"SESSION_ID","associationKey":"manual-SESSION_ID"}},
    {"type":"session.confirmed","producer":"session","sourceSessionId":"SESSION_ID","payload":{"sessionId":"SESSION_ID","associationKey":"manual-SESSION_ID"}}
  ]
}
```

Use the actual session id throughout. A session has exactly one home Workstream.

**Complete when:** the inspected projection shows this session as active in exactly one Workstream.

## 3. Append one meaningful change

Inspect immediately before every mutation and use its `revision` as `expectedRevision`. Invoke `append` with one or more related semantic records. Give every request a unique idempotency key; repeat the exact request and key only when retrying an uncertain result.

Supported records and payloads are defined in `packages/workstream-store/src/index.d.ts`. Common records are:

- `link.upsert` / `link.removed` for relevant file, repository, plan, Run, or artifact references;
- `human-task.upsert` for a durable question that needs an answer;
- `human-task.answered` and then, separately, `human-task.resolved`;
- `checkpoint.replaced` for a user-confirmed attended checkpoint;
- `checkpoint.failed` or `checkpoint.stale` only when that explicit state occurred.

Set `producer` to `session` for agent-proposed records and `owner` for a mutation the user explicitly chose. Include `sourceSessionId` for records originating here. Keep raw conversation, routine tool activity, repeated summaries, and large artifact contents out of the ledger.

On `STALE_REVISION`, inspect again, reconcile the intervening change, and submit a new request with a new idempotency key. On any other error, report the stable error code instead of editing the store file.

**Complete when:** the new snapshot contains the intended semantic change and unrelated state is unchanged.

## 4. Checkpoint only after attended confirmation

When the user asks to checkpoint, first propose—not persist—five values:

- `whatChanged`: what now exists or works, naming concrete artifacts;
- `remains`: what is blocked or still owed;
- `next`: one obvious owner-facing action;
- `nextSessionPrompt`: the exact prompt to paste into a fresh attended Pi session;
- `references`: only the concrete paths or identifiers needed to resume.

Lead with the point and make the checkpoint sufficient to resume without rereading chat. Keep `nextSessionPrompt` under 2,000 characters and include only the context, constraints, starting action, and references needed to continue safely; do not turn it into a transcript or execution plan. Ask the user to confirm or correct all five values. After explicit confirmation, append `checkpoint.replaced` for the current active session with a unique checkpoint id. A failed, rejected, or abandoned proposal leaves the latest confirmed checkpoint unchanged.

**Complete when:** the user-approved text appears as the session's latest checkpoint, or the proposal remains unpersisted.

## 5. Close deliberately

Before closing, inspect and report unresolved Human Tasks and scratch-file links. Close only on the user's explicit instruction, using the latest revision and a unique idempotency key. Closure preserves unresolved items and deletes no files.

```json
{"workstreamId":"ws-example","expectedRevision":4,"idempotencyKey":"close-ws-example","producer":"owner","sourceSessionId":"SESSION_ID"}
```

**Complete when:** the inspected Workstream is closed and any proposed cleanup remains subject to separate human confirmation.
