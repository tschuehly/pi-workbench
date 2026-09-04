# Matt Shumer Manager Loop Evidence Ledger

## Verdict

Experiment with a flattened phase loop through Pi Workbench's existing attended coordinator Worker.
Do not describe that trial as the source's architecture: Shumer uses a separate, persistent
implementer that can launch its own sub-agents, while a Workbench coordinator Worker can launch only
foreground leaf Subagents that cannot delegate further.

The source gives a useful operating pattern for preserving direction across long work, but its
outcome evidence is an author report rather than a reproducible comparison. Pi Workbench's child and
Worker mechanics are implemented; its managed lifecycle, Semantic Execution Graph, and unattended
recovery remain unbuilt.

## Scope and sources

Reviewed on 2026-09-04 against:

- Matt Shumer's [Manager Loop thread root](https://x.com/mattshumer_/status/2095723177389232540),
  published 2026-09-04 at 03:58:36 UTC;
- the [thread reply](https://x.com/mattshumer_/status/2095724719408386326), published 2026-09-04 at
  04:04:44 UTC;
- [How I got Astra past the plateau](https://somethingbig.ai/manager-loop-experiments), published
  2026-09-03; and
- [My GPT-6 Astra Review](https://somethingbig.ai/astra-review), published 2026-09-03.

The supplied thread capture preserves the complete long-form posts. X's public syndication response
corroborated the post identities, author, timestamps, reply relationship, opening text, and quoted
Manhattan post, but truncated the long-form note text. The two Manager Loop posts quote a separate
Manhattan demonstration posted on 2026-09-03.

No video or image was inspected. The reported week-long Manhattan outcome, checklist dashboard, and
96-sub-agent configuration therefore remain Shumer's first-person evidence rather than independently
verified results.

## What the source reports

### Separate direction from implementation

One coordinator interviews the owner, agrees on the goal, decomposes it into phases, and retains
responsibility for moving the whole project forward. A separate Codex implementer works on one phase,
checks the result, and reports completion evidence. The implementer may delegate narrower work to its
own sub-agents.

The implementer is explicitly not the coordinator's sub-agent. The two sessions have separate jobs
and the implementer retains its context across phases. The coordinator is model judgment, not
lifecycle authority; its checklist is working state rather than evidence of an authoritative
controller.

### Give the implementer one finish line at a time

Shumer says long undivided runs continued working but became absorbed in details. He first countered
this manually by assigning one phase in goal mode and saying "Keep going" after completion. The
Manager Loop automated that routine steering through a second model session.

The supplied capture uses literal `/goal` syntax; the public articles corroborate goal mode but not
that exact command. The narrower supported observation is that persistence and project direction
are separate problems. The source does not isolate whether the reported benefit came from phase
size, role separation, goal mode, model choice, added tokens, or the coordinator's judgments.

### Make progress visible

Shumer reports generating a web page containing the checklist, a graph of completed items over time,
and a visualization of sub-agent activity. The supplied capture additionally calls the semantic
value of the checkbox graph a hunch and suggests moving on when no box has been checked for a stated
period.

This is a self-steering heuristic. Checkbox count does not measure work size, outcome quality, or
acceptance coverage, and the source gives no comparison showing that the page caused better results.

### Increase delegation capacity

Shumer reports raising Codex's concurrent-sub-agent setting from four to sixteen on one machine and
to 96 on the machines running the civilization and New York projects. He also says 96 was
"obscene overkill," extremely expensive, and not always used. The source makes two distinct points:
a higher limit does not ensure utilization, so he sometimes prompted for more delegation; and more
agents do not automatically improve a project.

### Treat prompt wording as anecdotal

The supplied capture reports that "extremely well" worked better than "perfectly," which appeared to
send the model back into minutiae. Neither article repeats this wording comparison, and no controlled
prompt comparison is provided.

### Proposed next steps are untested

The thread reply explicitly labels two ideas as untested:

1. replace the growing implementer context with a fresh implementer per phase and a written handoff
   or prior traces; and
2. let the implementer propose plan changes for coordinator judgment, or reverse that relationship.

These are hypotheses, not demonstrated Manager Loop behavior.

## What Shumer's experiments ruled out

The experiment article is a first-person ablation narrative rather than a controlled evaluation. It
still supplies useful negative evidence:

- **Long runs:** persistence alone did not preserve direction; repeated improvement and gauntlet
  loops still became absorbed in local details.
- **Roles and lanes:** clearer responsibilities helped, but coordination and approval became
  bottlenecks.
- **Periodic model supervision:** a supervisor checking evidence every 30 minutes produced little
  improvement. This weighs against model-backed periodic check-ins, not against a deterministic
  Watcher that reports typed observations without making routine model calls.
- **Adaptive organization:** allowing a coordinator to rearrange roles did not resolve the plateau.
- **Human-led phases:** one phase at a time worked well enough that Shumer automated his own routine
  "Keep going" intervention.

These observations argue for bounded semantic work and sparse judgment, not for more hierarchy,
more approvals, or a periodically polling manager.

## Evidence strength

The source demonstrates that Shumer used a concrete two-session workflow and considered it useful on
large projects. It describes several attempted baselines and their reported outcomes, but provides
no public traces, fixed task corpus, acceptance records, token totals, defect counts, or independent
reproduction.

The causal explanation—phase steering broke Astra's performance plateau—is therefore plausible but
unproven. Shumer's own stated next step is to make the setup reproducible and test where it breaks.

## Pi Workbench comparison

### Implemented attended reality

At repository revision `8fda081bc81517fa2e25a2d67c5da1182aeddf84`, Pi Workbench implements:

- fresh bounded Subagents with explicit model binding, observation, cancellation, and compact return;
- durable attended Workers that resume one persisted Pi session within one semantic scope;
- one-dispatch-at-a-time Worker locking and typed failure outcomes;
- coalesced completion attention and explicit result reconciliation; and
- a Worker-only `coordinator` profile with leaf delegation tools but no `edit`, `write`, or Worker
  lifecycle tools; unrestricted `bash` still makes it mutation-capable inside the attended trust
  boundary.

The extension mechanically bounds the hierarchy to lead → Worker → leaf and rejects background leaf
delegation from inside a Worker. The coordinator instruction—not deterministic code—asks the Worker
to launch one fresh leaf per phase, collect each once, retain compact evidence, and run at most one
writing leaf at a time.

Relevant implementation and contracts:

- `extensions/subagent/index.ts`
- `packages/pi-execution-adapter/`
- `packages/worker-registry/`
- `docs/plans/level-1-subagents.md`
- `docs/plans/level-1-durable-workers.md`
- `docs/plans/subagent-worker-iterative-improvement.md`
- `docs/contracts/execution.md`

A focused verification on 2026-09-04 passed 77 checks: 25 Pi execution-adapter tests, 17 Worker
registry tests, 13 completion-wakeup tests, and 22 subagent-extension tests:

```sh
npm test --prefix packages/pi-execution-adapter
npm test --prefix packages/worker-registry
node --test extensions/subagent/completion-wakeup.test.mjs
node --test extensions/subagent/index.test.mjs
```

These checks establish process, continuity, hierarchy, locking, and reconciliation mechanics. They
do not show that coordinator-led phases improve long-horizon outcomes.

### Structural mismatch

The source's implementer is a separate persistent session that can launch its own sub-agents.
Workbench cannot represent that peer-like topology inside its supported tools. A coordinator Worker
can launch foreground leaf Subagents, but those leaves cannot delegate and do not retain one
implementer context across phases.

The proposed Workbench trial therefore tests a flattened variant: the coordinator Worker retains
direction while fresh leaf implementers perform phases. It does not test implementer-owned
second-level fan-out, independent implementer lifetime, or open-ended coordinator-to-implementer
messaging.

### Important maturity mismatch

Shumer reports an implemented and exercised workflow, although its comparative benefit is not
independently demonstrated. Pi Workbench's attended child and Worker mechanics are implemented and
tested, but the coordinator's phase discipline is prompt-guided and has not been validated as a
long-horizon method.

The Run Controller, Workflow Contract enforcement, Semantic Execution Graph, managed Dispatches,
typed Episodes, workspace leases, durable unattended execution, and controller-mediated recovery
are specified but unimplemented. Ordinary Pi Goal can sustain a session objective, but it does not
supply those guarantees and a current child execution is not automatically a Goal-backed managed
Run.

### Which system is better where

The source is better as an immediately understandable operating recipe and reports use on work far
longer than Workbench has demonstrated. Workbench is better at tested process lifecycle, explicit
failure handling, bounded hierarchy, result reconciliation, and avoiding false authority claims.
Workbench's intended managed design is stronger on durable state and revision ownership, but it is
inferior wherever actual managed or unattended execution is required today because that design does
not run.

### Architectural placement

| Source mechanism | Narrowest Workbench destination |
| --- | --- |
| Owner interview and agreed goal | Prompt-guided Alignment |
| Separate project direction from phase work | Coordinator and attended child behavior |
| Meaningful phases and dependencies | Semantic Execution Graph, when managed execution exists |
| Fresh implementer context | Fresh Subagent now; future Context Curator and Continuation Artifact |
| Plan-change proposal | Revisioned graph proposal validated by the Run Controller |
| Completion report | Current compact child result; future typed Episode |
| Checklist and progress graph | Derived status or Review Surface, never authoritative state |
| Concurrency limit and admission | Future controller scheduling and repository policy |

## Decisions for Pi Workbench

### Experiment: run a flattened phase loop on one real task

**Concrete change:** run one medium, meaningful attended task as three to five evidence-bearing
phases. Use the existing `coordinator` Worker profile and one fresh implementer Subagent per phase.
Require each phase to return changed paths, checks, remaining uncertainty, and any proposed revision.
Finish with a fresh independent challenge when the task consequence requires it.

**Owner:** existing `extensions/subagent/` behavior, evaluated through `skills/compound/` and the
Subagent/Worker evaluation questions in `docs/plans/subagent-worker-iterative-improvement.md`. No
implementation change is required for the first trial.

**Why:** this tests the source's strongest transferable mechanism—separating project direction from
bounded implementation—without adding another orchestrator or claiming to reproduce the source's
deeper topology.

**Proof or falsifier:** record completed phases, owner interventions, elapsed time, token usage,
context growth, rework, shared-file conflicts, final-review findings, and whether every child result
was reconciled. Reject the pattern if it does not reduce stalls or Human Attention, or if it increases
cost and rework without improving acceptance coverage.

**Keep unchanged:** attended lifetime, one supported nesting level, lead accountability, explicit
cancellation, no peer mailbox, no automatic retry, and no workspace-safety or managed-Run claim.

### Adapt: use Alignment for the owner interview

**Concrete change:** before the trial crosses its commitment boundary, use the existing prompt-guided
Alignment behavior. `Plan` confirms the whole-task outcome, approach, boundaries, and evidence;
`Spec` is reserved for work that needs accepted behavior and constraints. Do not persist a second
checklist merely to represent that agreement.

**Owner:** `docs/foundation/working-mode.md` behavior in the attended lead session. No Working Mode
extension or selector is implied.

**Why:** this preserves the source's high-leverage owner interview while keeping Human Attention at a
material direction choice instead of every phase transition.

**Proof:** the accepted direction is sufficient to brief each phase; the owner is asked again only
when evidence changes outcome, scope, architecture, quality, or risk materially.

**Keep unchanged:** Working Mode configures behavior rather than permission, creates no durable plan
file, and grants no mutation or Run authority.

### Adapt: revise work only at synchronization points

**Concrete change:** a leaf reports evidence that invalidates a phase or plan; it does not silently
redefine the assignment. The coordinator proposes the next phase revision. The attended lead accepts
revisions inside the understood direction, while a Material Question returns to the owner. A material
correction to running work uses cancellation and a fresh assignment.

**Owner:** attended Subagent and Worker behavior now; the Semantic Execution Graph and Run Controller
if managed execution is later implemented.

**Why:** this preserves the source's useful adaptive-plan idea without letting a model-authored
checklist become lifecycle authority.

**Proof:** every changed phase has its triggering evidence and accepted replacement visible; no child
continues against a stale objective; unresolved Material Questions reach Human Attention.

**Keep unchanged:** models propose semantic changes, deterministic modules own managed transitions,
and Acceptance remains distinct from model verification.

### Experiment: fresh context per phase

**Concrete change:** the flattened trial uses a fresh leaf Subagent for each phase and keeps only
compact evidence in the coordinator Worker. Do not pass full prior traces by default. If a fresh leaf
cannot reconstruct necessary state from its self-contained assignment and Primary Evidence, record
that failure rather than silently expanding every later context.

**Owner:** current coordinator Worker instruction and child assignment behavior. A future managed form
would use a Context Curator to prepare a source-backed Continuation Artifact.

**Why:** this tests the source's untested context-growth remedy using a capability Workbench already
has, without retaining one increasingly polluted implementer session.

**Proof or falsifier:** compare phase re-briefing, context growth, duplicated work, missed decisions,
and final outcome quality. Reject fresh-per-phase use when continuity materially improves the work
more than fresh context reduces drift.

**Keep unchanged:** Continuation Artifacts remain unimplemented; current assignments stay
self-contained and compact child results do not become authoritative state.

### Reject: transfer the checklist dashboard or numeric fan-out

Do not add the HTML checklist, checkbox-velocity rule, universal "extremely well" wording, or a
96-child default. The dashboard duplicates existing status surfaces without proving semantic
progress. A rule to move on after no checkbox activity can conceal incomplete work. The wording
claim is anecdotal. The 96-child setting is explicitly described as overkill, has no controlled
quality evidence, and conflicts with current shared-workspace mutation risk and the principle that
worker count is not a product goal.

If repeated trials expose a real no-progress problem, derive bounded mechanical observations from
execution events and stop or replan at an evidence boundary. Do not create a second ledger or infer
quality from activity counts.

### Reject: Goal integration in every child

Do not modify Pi Execution to start every phase as a child Goal now. First establish whether current
bounded child runs actually stop prematurely. If that failure repeats, evaluate the smallest
Goal-backed phase experiment with explicit limits and terminal reconciliation. Pi Goal must remain
session objective machinery rather than controller authority.

## Recommended next action

Run the existing coordinator Worker on one medium attended task and evaluate the flattened result.
Add no orchestration code until that trial identifies a specific missing mechanism.

## Confidence

**Source:** confidence is high in the source identity, dates, reported mechanism, caveats, and
explicitly untested proposals; medium that phase-scoped role separation reduces loss of direction;
and low that the dashboard, wording choice, or 96-child capacity independently improves outcomes.

**Pi Workbench:** confidence is high that current child and Worker mechanics are implemented and
tested, and low that current phase coordination improves long-horizon outcomes. That is the proposed
experiment, not an established capability.
