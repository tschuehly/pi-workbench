# FirstMate: one coordinator for all sessions

**Status: owner-approved design (2026-10-06), nothing implemented.** [Decision 127](../foundation/decisions.md)
replaces Decision 103 and authorizes this plan. It supersedes the rejected
[coordination-mate plan](firstmate-coordination-mate.md); the [Chat trial](firstmate-workbench-chat-trial.md) and
[PI WEB crew-backend audit](firstmate-pi-web-crew-backend.md) of the external tool remain evidence.

## Problem and outcome

Thomas runs many concurrent Pi sessions and keeps switching between them. He loses time finding which session
needs him, rebuilding context before answering, starting and steering work, and has no overview.

**Done when:** Thomas runs his concurrent sessions through FirstMate day to day without hunting for which session
needs him.

## Shape

- **Unit:** Workstreams, with their live sessions underneath.
- **Watcher:** deterministic code reads PI WEB session events and keeps one fleet snapshot. Routine activity
  updates the snapshot silently; only actionable wakes reach a model.
- **Two conversations:** the **lead** FirstMate Chat Thomas talks to, and a hidden **routine** conversation on the
  light tier for routine wakes.
- **Own window:** FirstMate has a separate window (macOS window or PI WEB route) holding its home view and the lead
  Chat, on PI WEB's runtime and plugin API. The lead runs on Thomas's lead model. The home view's layout is decided
  during use, borrowing from Atelier.
- **Decisions are general Workbench:** `decision_post` works in every session with or without FirstMate; FirstMate
  is one consumer. Field names match Atelier's Decision (question, options, recommendation, opened); no shared code.

## Authority

- **FirstMate may, without asking:** message, steer, stop, start and compact sessions; write checkpoints; answer a
  decision under the rule below.
- **FirstMate cannot:** edit project files, merge, promote, restart the session daemon, close a Workstream, or remove
  a worktree. Its runtime profile has no `edit`, `write` or `bash`; its tools do not offer these actions. This binds
  FirstMate only; other sessions keep their own attended authority.
- **Threat boundary:** guards protect against a confused agent, not a hostile same-user process, as in
  kunchen's FirstMate. Identity still never comes from a tool argument or request field: the role comes from the
  runtime that hosts the calling session (see slice 1).
- **Answering for Thomas:** FirstMate answers a decision only when the answer is unambiguous toward Thomas's accepted
  intent. The decision carries an intent reference (the brief's Intent section, the Workstream overview revision, or
  owner messages). If that reference is missing or a newer owner message in that session postdates it, FirstMate
  holds. Scope expansion, product or architecture calls, security, destructive or recurring themes always go to
  Thomas. A session never answers its own decision. Each answer FirstMate gives is labelled and overridable.
- **Control lease:** one lead FirstMate holds a fenced lease; a second window or session is read-only. Overlapping
  actions on one target session are serialized.
- **Owner precedence:** Thomas typing in a session always wins. A newer owner message in a session cancels a pending
  FirstMate steer for it and blocks FirstMate from answering that session's open decisions.

## Decisions

- **Tool:** `decision_post` (question, options, recommendation, impact, links, intent reference) ends the
  session's turn mechanically. The answer, word for word with who answered, arrives as the session's next message.
- **Store:** `packages/firstmate-store` (name open), file-based, owner-only. Record: id, source session, Workstream,
  question, options, recommendation, impact, intent reference, opened, held-until, revision, answer verbatim,
  answeredBy, delivery receipt.
- **One record, two views:** a card in the asking Chat and FirstMate's queue. Answering is a revision-checked
  compare-and-set: the first answer wins, a stale answer is rejected and shown. An override is a new revision
  delivered as a correction.
- **Delivery:** the answer and a keyed outbox entry are written atomically. The asking session's own extension
  delivers it and records a receipt, keyed by decision id and revision, so a retry is harmless. Undelivered answers
  stay pending and visible. Ordinary steering never closes a decision ([FirstMate#4372](https://github.com/kunchenguid/firstmate/issues/4372)).
- **Workstreams:** the store holds live decisions; Workstream Human Tasks stay for real-world obligations
  ([Decision 91](../foundation/decisions.md) keeps them separate). The Workstream view reads open decisions by
  Workstream id; nothing is copied.
- **`ask_user`** stays during the trial for quick in-Chat questions and is retired for owner decisions afterwards.

## Wakes and state

- **Wakes:** decision posted; turn ended with `waitingOn: owner`; error or usage limit; session waiting on the agent
  and idle longer than N minutes; dead session; uncollected child stuck.
- **Durable:** each wake is written to an append-only log keyed by actionable item before detection advances, and
  acknowledged only after it is handled. Startup and reconnect rebuild the snapshot from current state.
- **Honest state:** uncertain or unreadable is `unknown`, never idle. Inspection must not reopen a cold session to
  read its status (the crew-backend audit found `GET status` does).
- **No overload ([FirstMate#4824](https://github.com/kunchenguid/firstmate/issues/4824)):** one actionable item per
  session (a posted decision absorbs that session's `waitingOn: owner`), each problem reported once, non-urgent owner
  requests batched, no reply on no-ops.
- **Turn-end guard:** the lead cannot end a turn with unacknowledged wakes while the watcher is unhealthy.

## Away mode

Follows the Attention setting. Away never changes what FirstMate may do, only how and when Thomas hears.

- **Phone:** decisions batched to Telegram (`ask_human`), updates via `notify_human`.
- **AFK:** no contact. FirstMate decides only what the answer rule and the AFK advisor rule allow; the rest holds
  for Thomas's return with a return brief.
- Thomas's away words are stored verbatim and read with judgment; doubt holds.

## Briefs

`session_start` takes a brief with **Intent** (Thomas's words, verbatim) separate from **Spec** (FirstMate's
elaboration), because merging them widened scope in kunchen's FirstMate.

## Slices

Each slice is used day to day before the next starts.

1. **Decisions.** `decision_post`, the store, the card in Chat, answer compare-and-set, in-session delivery with
   receipts, mechanical turn yield. Done when Thomas answers decisions from normal Chats for a week with no lost or
   duplicated answer, including across a session reload.
2. **Fleet snapshot and watcher.** Non-reopening inspection, durable wake log, acknowledgement, reconciliation.
   Needs a PI WEB host contract (below).
3. **Lead FirstMate and its window.** Coordination-only profile, control lease, session tools, answer rule, home view.
4. **Routine conversation.** Moves routine wakes off the lead. Decide then whether it may nudge sessions (scoped to
   sessions waiting on the agent) or only prepare work for the lead. Filing standalone Chats into Workstreams stays
   an owner decision until [Decision 94](../foundation/decisions.md)'s linking contract lands.
5. **Away mode.**

## Tools

- Every session: `decision_post`.
- Lead only: `decisions` (list, show), `decision_answer`, `session_send`, `session_start`, `session_stop`, compact.
- Both conversations: `fleet`, `checkpoint`.

## Host contract needed from PI WEB

From the [crew-backend Phase A verdict](firstmate-pi-web-crew-backend.md):

- Prompt admission with an operation key, so a lost response never resends a steer blindly.
- Read-only session inspection that does not reopen a cold session or invent liveness.
- A durable event cursor or reconciled snapshot, because `SessionEventHub` is in memory.
- Caller identity from the hosting runtime, not from request fields. Kunchen's lock already failed in PI WEB because
  every session shares the `sessiond` process ([Chat trial](firstmate-workbench-chat-trial.md)).
- Session creation with an operation key (the 2026-09-23 spike proved this for empty sessions).

## pi-durable

[`@earendil-works/pi-durable`](https://github.com/earendil-works/pi/tree/main/packages/durable) 1.0.4 (2026-10-05)
offers durable tasks, checkpoints, deduplicated reporters and stable request IDs: the right shape for durable
wakes and answer delivery. It is experimental, not in installed PI WEB, and needs a new session backend
([seamless-promotion analysis](seamless-promotion.md)). Do not depend on it; reuse its keyed-request and reporter
patterns. Revisit if PI WEB adopts Durable-backed sessions.

## Evidence

- The grill design, the independent review (GPT-6.1 Sol: proceed with changes, now folded into this plan) and a
  study of kunchenguid/firstmate at `e06a46f` are linked from Workstream `ws-firstmate-20261006`.
- [FirstMate evidence ledger](../research/sources/firstmate.md).
