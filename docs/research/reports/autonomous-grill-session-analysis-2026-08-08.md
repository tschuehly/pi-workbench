# Autonomous grill live-session analysis — unstable network, 2026-08-08

**Status:** evidence report from watching a live `/autonomous-grill` run over an unstable network
connection. Captured while the grill was still executing (through ~20:48Z, round 2 dispatched); the
grill's own outcome is recorded in its Workstream, not here. Session references use session ids and
line indices in the recorded JSONL; code references use repository paths.

## Subject

- Lead session `019fe2f9-4217-7025-86f5-c301cee4a7c5` (anthropic/claude-fable-5, thinking max),
  associated with Workstream `ws-workbench-guiding-principles-20260807`.
- Grill target: `docs/research/reports/working-mode-challenge-dossier.md` plus
  `docs/foundation/principles.md`.
- Children: scout Subagent `019fe303-ae3c…` (fact sheet), durable advisor worker
  `working-mode-grill-advisor` (`5522227e…`, planner/design, openai-codex/gpt-5.6-sol at xhigh,
  session `019fe306-d549…`).

## Timeline (UTC)

| Time | Event |
| --- | --- |
| 20:03–20:09 | Workstream association: 7 tool calls including one schema-rejected record write |
| 20:05 | First `/autonomous-grill` invocation carried a garbled target (pasted terminal scrollback); human aborted and re-ran |
| 20:09 | Real target injected |
| 20:09–20:16 | Lead read ~10 documents inline, designed the decision tree, launched background scout, created advisor worker, wrote the tree to a machine-local `.scratch/` file |
| 20:10–20:11 | Network stall 1: 3 empty lead turns; human typed `continue` |
| 20:16–20:18 | Scout fact sheet collected; round-1 dispatch written (16 frontier decisions) |
| 20:18–20:27 | Worker read ~17 documents, then its stream died after 23 output tokens; dispatch returned success with placeholder "Child completed without a text result." |
| 20:27–20:31 | Network stall 2: 9 empty lead turns; human typed `continue`; lead diagnosed the empty round via `worker_status` usage and re-dispatched a ~2KB resume brief |
| 20:35 | Worker generated the round-1 deliverable (15.6KB), followed by two dropped empty turns |
| 20:41 | Child Pi's own retry regenerated the deliverable (20.8KB); dispatch returned it intact |
| 20:43–20:46 | Lead reconciled round 1 and dispatched round 2 |

Cost through 20:46Z: lead $7.61, scout $0.26, worker $1.47 — total ≈ $9.34. Human attention
consumed: one target entry, one re-run after the paste accident, two `continue` nudges. No verdict
work yet; the walk phase had not started at capture.

## Findings

### F1 — The stack self-heals from dropped turns more than it appears to

Empty assistant messages in the session record are dropped or retried network attempts, and both
lead and child recovered without human help in the observed cases where recovery was possible:

- Lead: empty turns at lines 71–73 (20:30:17–20:30:50) resolved into the successful re-dispatch
  turn at line 74 (20:31:22) with no human input.
- Worker: empty turns at lines 78–79 (20:35:54–20:36:09), directly after the 15.6KB deliverable,
  resolved when Pi's turn retry regenerated a fuller 20.8KB deliverable at line 80 (20:41:12),
  unprompted.

Both human `continue` nudges landed during backoff windows and were plausibly unnecessary. The
sessions were retrying silently; nothing in the UI distinguished backoff from death.

### F2 — The one genuine loss was a truncated turn settled as success

Round-1 attempt 1: the worker's stream died after 23 output tokens (a thinking-only partial turn,
worker session line 72), the child run loop settled instead of retrying, and the dispatch reported
`outcome: success` with the placeholder text. The entire 9-minute, ~17-document read phase produced
zero returned challenge. Recovery required the lead to notice the placeholder semantically and
improvise a resume re-dispatch.

### F3 — `finalText` is last-message-wins and a trailing dropped turn can erase a deliverable

`packages/pi-execution-adapter/src/index.js:152-153` overwrites `state.finalText` on every
assistant `message_end`, including empty ones. The observed worker pattern
text → empty → empty (lines 77–79) erases a real deliverable whenever settlement follows a
trailing dropped turn; attempt 2 survived only because the child's retry made the last
`message_end` the full text. Attempt 1 is exactly the failure shape.

### F4 — Empty-text success is indistinguishable from real success at the tool boundary

`extensions/subagent/index.ts:450` returns the placeholder as a successful result. The skill text
covers `outcome_unknown` but not "success with no deliverable", so recovery depended on lead
judgment rather than a mechanical rule.

### F5 — Worker continuity paid for itself in the failure path

The resume re-dispatch was ~2KB because the worker session retained the full assignment and its 17
document reads. The regenerated deliverable was larger than the lost one (20.8KB vs 15.6KB). Total
network tax for the whole session: roughly 10 minutes of backoff delay, one duplicated generation,
two unnecessary nudges, zero work permanently lost. Everything with durable state (scratch tree,
worker session, registry, Workstream association) degraded gracefully; the only fragile spot was
the transient `finalText`.

### F6 — The corpus was read three times

Lead (~10 documents inline), scout (overlapping set for the fact sheet), and worker (~17 documents
per its self-contained brief) each loaded substantially the same evidence base. The advisor is
explicitly non-independent, so its full re-read buys diligence, not Independence — while tripling
latency and extending the window in which a dropped stream costs a whole read phase (F2).

### F7 — Setup friction preceded any grill work

Six minutes of Workstream association (including one INVALID_REQUEST schema retry) and one garbled
target injection (9KB of skill text wrapped around pasted scrollback containing "ctrl+o to expand"
and timing artifacts) preceded the real run. The lead noticed the garbled target in thinking; the
human had to abort and re-run.

### F8 — Value produced by the autonomous phase (through round 1)

- A 20-decision, 6-cluster decision tree with per-decision proposals, cited evidence, explicit
  assumptions, and preserved dissent, persisted outside the session.
- An 11.5KB exact-quote fact sheet with file:line references.
- A received 20.8KB round-1 challenge with material findings (for example: floors-versus-ceilings
  misclassification, a requested→recommended→required→granted→observed provenance chain, a
  strictly stronger no-Publication invariant, effect-keyed governance floors).
- A warmed advisor worker making subsequent rounds and failure recovery cheap.

## Recommendations

| # | Change | Owner |
| --- | --- | --- |
| R1 | Keep the last non-empty assistant text: only overwrite `finalText` when `assistantText(message)` is non-empty | `packages/pi-execution-adapter` |
| R2 | Treat empty-text success as a diagnosable non-success (or `isError`) so retry decisions can be mechanical | `packages/pi-execution-adapter`, `extensions/subagent` |
| R3 | Codify the observed recovery in the skill: on an empty or placeholder round result, inspect the worker, send one compact resume re-dispatch pointing at the prior in-session assignment, then reset the worker on repeat | `skills/autonomous-grill` |
| R4 | Surface retry/backoff state in child progress and the TUI so silence is distinguishable from death; this removes the incentive for human nudges during backoff | Pi harness / `extensions/subagent` progress log |
| R5 | Stop the triple read: hand the advisor the scout fact sheet and evidence anchors, instructing spot-checks only for doubted quotes | `skills/autonomous-grill` |
| R6 | Guard the target input: preview the target on confirm and warn on scrollback-like content (length plus log-marker heuristics) | `extensions/autonomous-grill/command.mjs` |
| R7 | Mandate the scratch decision-tree file with a round log updated at every reconcile, including failed dispatch outcomes, as the restart anchor | `skills/autonomous-grill` |
| R8 | Add optional budget and round bounds to the command (the human's first target attempt began "max effort" with nowhere to put intensity) | `extensions/autonomous-grill` |
| R9 | Add a scope-growth guard: beyond roughly a dozen decisions, propose splitting clusters into separate grills or offer cluster-level verdicts in the walk | `skills/autonomous-grill` |
| R10 | Record walk verdicts into the associated Workstream as part of the finish criteria | `skills/autonomous-grill` |

## Method

Analysis performed by a second attended session reading the recorded session JSONL files during the
run, cross-referencing adapter and extension source, and tallying per-message usage. The analyzed
grill was still running at capture; findings F1–F5 are grounded in the recorded message sequence
and code paths cited above, not in the grill's eventual outcome.
