# AFK Goal session retrospective — 2026-08-12

**Status:** accepted evidence and direction from the 2026-08-12 owner review.

## Decision

Continuous unattended production defaults to an ordinary Pi Goal. Safety belongs in the project controller:
resumable state, idempotency, concurrency guards, bounded retries, exact artifact validation, and terminal
settlement. Goal orchestration supplies the outcome, authority bounds, deadlines, and final audit without
repeating those mechanisms.

`execute-plan-afk-goal` remains experimental. Its next design is a thin plan-to-Goal launcher, not a second
controller. Per-phase checkpoints, forced compaction, review orchestration, timed reviewer polling, immutable
non-success outcomes, and a second finalization turn are outside the minimal design.

## Evidence set

The machine-local PhotoQuest session archive contained 18 Goal sessions and two production-scale sessions
owned by `execute-plan-afk-goal`:

| Posture | Session | Relevant window | Outcome evidence |
| --- | --- | ---: | --- |
| Plain Goal | `019feb4a-fd05-7293-ace2-3bed4cd4a25c` | 7.63 unattended hours | six accepted videos, three blocked videos, one four-concept refill; two compactions, no `goal_wait` |
| Strict AFK wrapper | `019fef76-0bdb-7472-b54b-5ed8a2207048` | 13.15 hours | stabilization commits completed; mandatory dual-judge outage ended in `goal_blocked`; five checkpoints, 43 lead-launched reviewer children |
| Risk-based AFK wrapper | `019ff29f-b1d3-7812-a4df-09ad6693897a` | 7.13 active AFK hours | zero accepted videos, three blocked videos, one four-concept refill; eight compactions, nine checkpoint calls, 27 waits |

The plain comparator had prior attended tuning and earlier acceptance gates, while the strict wrapper run was
primarily stabilization. These confounds prevent attributing every output difference to the wrapper. They do
not explain the orchestration measurements: the wrapped runs spent most long gaps waiting on lead-level
children, while the plain run spent most long gaps inside foreground controller work.

Short disposable AFK wrapper trials proved start, checkpoint, compaction, and terminal mechanics. They did not
prove that those mechanics improve a multi-hour production loop.

## Findings

### Controller safety outperformed Goal ceremony

PhotoQuest's durable controller successfully prevented duplicate runs, preserved exact artifact and receipt
identity, bounded creative corrections, settled blocked work honestly, and advanced the queue. Forced Goal
checkpoints and reviews duplicated lifecycle concerns without strengthening those controller invariants.

The risk-based wrapped session called `afk_phase_checkpoint` nine times and compacted eight times. One phase
checkpoint was attempted three times around stale completion wakes. Natural compaction in the plain comparator
occurred twice.

### Lead-level review serialized production

Artifact review moved into the lead turn loop. The lead repeatedly declared that no mutation could overlap a
review, then waited for paired children. This made reviewer availability a global throughput dependency.
Product acceptance review belongs in the product controller. Reviewer unavailability may prevent acceptance
of the current artifact, but reversible queue work should continue after the current run reaches an honest
terminal or review-pending state.

Independent phase review remains appropriate for an irreversible external effect, security boundary, or
materially judgment-only decision. One reviewer is the default; a second is justified by disagreement,
critical impact, or an explicit owner requirement.

### Non-success must remain recoverable

The wrapped run's immutable `attention` receipt paused the Goal even though the failure was a recoverable child
startup outage and authorized time remained. A non-success report should preserve evidence and pause when
human authority is required, but infrastructure recovery must be able to resume the same Goal or continue a
safe branch. Immutability is useful for accepted success evidence, not for every transient non-success state.

### AFK objectives should be short

The successful plain production objective was approximately one page and centered the continuous loop. The
risk-based wrapped plan combined a root plan, five phase plans, hardening, production, concept generation,
review recovery, and final classification. Stable policy belongs in controller code, tests, and a project
operating skill. An AFK objective should name only the desired outcome, evidence, authority boundary,
continuous loop, stop-new-work time, and final audit time.

### The final reviewer failure was a Pi RPC startup failure

At `2026-08-12T03:39:33Z`, both final concept-40 reviewer processes were accepted and routed to Anthropic.
Each process failed before prompt submission:

> `startup_timeout: Pi RPC did not answer get_state within 15000 ms; process terminated before prompt.`

Each permitted retry failed identically. Minimal health probes failed at 03:41–03:42Z and again after a wait
at 04:02–04:03Z. The resolver also reported degraded quota telemetry with `Claude sign-in required`, but the
execution adapter explicitly permits degraded telemetry and later Anthropic children launched successfully.
The evidence therefore proves a startup-handshake timeout, not an authentication root cause.

The adapter's timeout diagnostic replaced captured stderr, so the exact process-level cause is unavailable.
Before changing the 15-second limit, preserve bounded stderr and record spawn, first-output, request, and
response timing. Measure real startup latency, then choose a threshold or backoff from evidence.

### Historical audit correction

The 2026-08-12 final audit graded concept 38 as passed because it settled terminally. Its own evidence says
motion failed and exact frame review was not reached. The canary requirement was partial. The immutable AFK
receipt remains historical evidence and is not rewritten; this retrospective records the corrected judgment.

### Blocked concepts are recreated, not promoted for review

The owner declined a separate local review surface for concepts 38–40. Their blocked state remains historical
evidence; neither the existing MP4 bytes nor a missing final artifact become Review Studio candidates. Future
concept generation may revisit the underlying marketing ideas only as new concept IDs and fresh locked briefs
that pass the full current pipeline. It must not reopen, relabel, or retroactively accept the blocked runs.

## Minimal AFK objective

An unattended objective contains only:

1. the observable outcome and binary evidence;
2. repository and owned scope;
3. authority and forbidden external effects;
4. the continuous work loop and terminal-item continuation rule;
5. stop-new-work and final-audit deadlines; and
6. the Material Question or human-only condition that pauses work.

Use an ordinary `/goal` unless the owner explicitly chooses the AFK wrapper experiment. Compact at actual
context pressure or a meaningful discontinuity, not after every phase. Do not make a reviewer a global queue
lock. Do not add a preparation skill until a failed launch demonstrates that the concise `define-goal` branch
and project preflight are insufficient.

## Proposed implementation changes

1. Make `execute-plan-afk-goal` a thin plan-to-Goal launcher or retire it in favor of ordinary `/goal`.
2. Remove mandatory `afk_phase_checkpoint` use and automatic phase compaction.
3. Remove Goal-level phase-review and reviewer-recovery orchestration.
4. Remove immutable `attention`/`failed` receipts and the required later completion turn; retain direct,
   clean-commit evidence for successful completion if it remains useful.
5. Keep product acceptance review inside project controllers; represent unavailable review without granting
   acceptance and continue independent reversible work.
6. Extend the existing `define-goal` skill with the minimal AFK objective rather than implementing the
   proposed `prepare-afk-run` skill.
7. Preserve bounded child stderr and startup-stage timing in `pi-execution-adapter`; evaluate the 15-second
   handshake limit from measured latency.
8. Replace timed polling with existing terminal child wakeups wherever a child is the only dependency.

These are proposed implementation changes, not claims about current behavior. They require a bounded extension
and adapter plan with tests before code changes.
