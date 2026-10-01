---
name: workstreams
description: Interact directly with Pi Workbench Workstreams while their PI WEB interface is unavailable or incomplete. Use when the user asks to create, select, inspect, summarize, report the state or history of, update, checkpoint, or close a Workstream through the agent instead of the UI.
---

# Workstreams

Use the `workstreams` command on PATH. It reads and writes the authoritative user-local Workstream Store (`PI_WORKBENCH_WORKSTREAM_DIR`, default `~/.pi-workbench/workstreams`). Run `workstreams` alone for this session's Workstream and the most recent open ones, and `workstreams <command> --help` for flags, limits, and examples. The CLI fills in the session, revision, and idempotency key; it prints `help:` lines on errors, and repeating a write is a no-op. Never edit the store file.

A Workstream is a sparse attention ledger, not a transcript, plan, workspace, or managed Run. Record only meaningful attention changes.

## 1. Find, create, associate

- `workstreams list` (add `--all`, `--closed`, `--fields`) and `workstreams show <id>` (add `--full` for complete text). Use `--closed` only when the user asks about history.
- If none fits, `workstreams create <id> --title "…" --group "…"`; groups are `Embabel`, `PhotoQuest`, `Pi Workbench`, `Personal`, or one the user names. Then write its overview.
- `workstreams associate <id>` makes this session active there. A session has exactly one home Workstream; if the CLI names another one, stop and report the conflict.

## 2. Report status (read-only)

When the user asks what exists, where work stands, or what happened, read and do not write:

1. List, select the requested topic, and state the inclusion rule when the match is not obvious. `show --full` every selected id.
2. Take the goal from the overview; if it is missing, reconstruct it from the earliest evidence and label it an inference.
3. Pick three to six consequential events (shipped results, decisions, pivots, failed approaches, preserved evidence) from checkpoints, Human Tasks, and links. Each session checkpoint is that session's view; expose disagreements instead of choosing one.
4. Derive directories only from concrete checkpoint or link references, check each one exists, and label its role or absence.
5. Call it the last recorded state, with its date, unless you verified it live.

```markdown
### <title>
**ID:** `<id>`
**Original goal:** <plain-language outcome>
**Created:** <date> · **Last recorded update:** <date>
**Directories:** <path, role, exists or missing>

**Description:** <why this exists, its scope and boundaries>

**What happened**
- <consequential event and why it mattered>

**Last recorded state:** <complete, usable, active, blocked, superseded, or proposed, with evidence>
**Waiting on:** <named actor and exact gate, or none>
**Next:** <one concrete continuation>
**Open decisions:** <from the newest checkpoint and pending Human Tasks, or none>
```

End a multi-Workstream review with a compact disposition table when it helps Thomas allocate attention. If an overview is missing or stale, say so and offer to write it.

## 3. Checkpoint automatically

Write `workstreams checkpoint <id>` when meaningful attention changes, without asking Thomas to confirm each field:

- `--what`: what now exists or works, two to four short sentences, one fact each, with anchors (commit, PR, path, count) in the sentence they belong to.
- `--remains`: what is blocked or still owed, one sentence per item, Thomas's decisions first.
- `--next`: one plain sentence starting with the actor.
- `--waiting`: `owner` when Thomas must act, `agent` when an agent can continue, `external` for a third party, CI, or reviewer.
- `--title`: this session's goal as a 2–6 word Chat title; never status or progress.
- `--ref`: the current working directory first while it is a live continuation target, then only what is needed to resume. Use repository plus full commit ID for lasting Git evidence.

In the same step, rewrite the overview if it no longer matches (`workstreams overview <id> --expect <rev> …`), and `workstreams resolve-task <id> <taskId>` for every Human Task Thomas answered or deferred. Do not create Human Tasks for questions: ask through the current Attention channel and record the open decision as `--next` with `--waiting owner`. Real-world obligations with a deadline outside Pi may still be Human Tasks (`workstreams append --help`).

Then tell Thomas what the checkpoint says so he can correct it. A later checkpoint supersedes it.

**Complete when:** the session's latest checkpoint carries `waitingOn`, and the overview and open Human Tasks match it.

## 4. Write for Thomas

The overview answers *what is this for and how did it get here*; checkpoints answer *what changed last*. Write the overview at creation, and rewrite it whole on a pivot, a shipped result, or a new blocker, not for routine checkpoints. Write for an owner returning after a weekend: concrete nouns, the actor on every open item (Thomas decides or checks, Pia implements, a named reviewer reviews), what a pull request does and not only its number, and plain words for jargon. Keep numbers, dates, conditions, and uncertainty.

Use `--owner` only for a change Thomas explicitly chose, such as an owner-supplied title. Link files, repositories, plans, Runs, and artifacts with `workstreams link`. Keep raw conversation, routine tool activity, and artifact contents out of the ledger.

## 5. Close deliberately

Close only on Thomas's explicit instruction. Before closing, `show` and report unresolved Human Tasks and scratch-file links, then `workstreams close <id> --expect <rev>`. Closure preserves unresolved items and deletes no files. `overview` and `close` require the revision you reviewed; if it moved, the CLI shows what changed, so reconcile before retrying.

### Retire a linked worktree

Before owner-approved removal, check the worktree is clean, its unique changes are landed or deliberately retained, and Pi has no stored sessions under its exact directory. Move any open Workstream's live continuation reference to a valid workspace first, and keep repository identity plus a reachable full commit ID (or retained artifact) as evidence. A closed Workstream is immutable; report its missing old path as historical rather than rewriting the ledger. `git worktree remove` never migrates a Pi session.

**Complete when:** no Pi session or open Workstream needs the worktree as a live target, and the retained evidence still resolves.
