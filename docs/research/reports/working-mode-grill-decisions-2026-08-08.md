# Working Mode grill — decisions for verdict, 2026-08-08

**Status:** historical grill output. The owner later supplied partial verdicts, then stopped the
verdict walk and requested a fresh reassessment because the design had become overbuilt. No proposal
here became a numbered decision. See the
[owner verdict and reset history](working-mode-owner-verdict-and-reset-history-2026-08-26.md).
Every cited contract, decision, and vocabulary entry remains in force.

This report is the persisted result of the autonomous grill over the
[Working Mode challenge dossier](working-mode-challenge-dossier.md), the
[default-context challenge dossier](default-context-challenge-dossier.md), and
[principles.md](../../foundation/principles.md). Four adversarial design rounds and two
independent closing audits produced 21 proposals. The second audit found no material gap.

**Historical use:** retain the proposals, examples, and dissent as design evidence. Do not resume
this verdict sequence unless the owner explicitly chooses it after the fresh reassessment.
Machine-local working tree: `.scratch/grill-working-mode/decision-tree.md`.

## Verdict sheet

| Id | Decision in one line | Recommendation |
| --- | --- | --- |
| P0 | Mid-grill observer commit `9a87d1f` — waive, record as violation, or extra audit? | waive |
| D1 | Describe work as nine fields with provenance, not a level number | accept |
| D2 | Field values travel requested → recommended → required → admitted → observed | accept |
| D3 | Constraints split: universal invariants / repo requirements / recommendations | accept |
| D4 | Commitment is per object (outcome, acceptance, strategy, route), not one altitude | accept |
| D5 | Presets are intent templates plus an honest disclosure card | accept |
| D6 | No V1 resolver; every attention-relaxing feature ships its own fail-closed gate | accept |
| D11 | FirstMate: unbundle the coordination mate, scoped to notify-and-focus v0 | accept |
| D12 | Batch answerable questions per round; frontier recomputes from answers | accept |
| D13 | Phase boundaries: five branch questions, not a ranked ladder | accept |
| D14 | Outcome-only attention floor; aggregate budget is a hard blocker | accept |
| D15 | Judgment cadence proportional to risk; Principle-14 floor invariant | accept |
| D16 | Run close blocks on disposition + analysis + extraction; the rest becomes tasks | accept |
| D17 | Standing context: restructure with per-item verdicts and dated grandfathers | accept |
| D18 | Admission rule for all future standing context | accept |
| D19 | Worker receipts as the (one-sided) delegation observable | accept |
| D20 | Record the two-altitude principles structure as a numbered decision | accept |
| D21 | Disconnect handling: truthful labels (lead) vs pause-on-control-loss (advisor) | accept lead version |

Round 2 after D1–D6: **D7** the adopt/revise/retain verdict itself (lean: revise), **D8** the
migration outline, **D9** the PI WEB posture card, **D10** principles edits.

---

## P0 — Process deviation

**Decide:** how to classify commit `9a87d1f`.

At 20:49, while the grill ran, your observer session committed
`autonomous-grill-session-analysis-2026-08-08.md`. The dossier said "no document edits during the
grilling itself." Facts: separate session, new research file only, no challenged document touched,
no grill participant read it.

**Recommend: waive as explicit exception.** Alternatives: record as a violation and add a
freeze rule for future grills, or order a third audit over that report's content.

## D1 — Nine fields with provenance, not a level number

**Decide:** whether a Run's posture is described by fields whose values carry provenance, with
per-field validity predicates, instead of one ladder rank.

**In practice** — the failed AFK run, written as a vector:

```yaml
attention:    outcome-only        (requested)
governance:   session-owned       (observed — no controller)
durability:   live-session-only   (observed — crash = total loss)
workspace:    shared checkout     (observed — no isolation)
bounds:       unlimited turns     (observed — pi-goal default)
verification: dual judgment       (requested, ran)
```

"Level 4-ish" hid exactly this mismatch; the production failure report's conclusion — "the
operating level did not match the use" — is this table. The pure ladder also already has a live
counterexample: durable workers put session-resumable durability and serialized delegation inside
Level 1 while Independence roles mechanically refuse continuity.

Validity is checked per field — `admits(required, granted)`, `conforms(admitted, observed)` — not
by ordering, because bounds order backwards and authority values are sets. Presentation stays
simple: you request attention, commitment, and bounds; the environment supplies governance,
durability, and workspace protection.

**Recommend: accept.**

## D2 — The provenance pipeline

**Decide:** whether every field value carries one of five stages: requested → recommended →
required → admitted → observed.

A value is **admitted** only when a mechanism grants it. Your approval is ratification — a
recorded event, never an admitted stage. In the AFK run, "the human approved the plan" was treated
like granted authority; that ambiguity let `escalate` route into more autonomous work.

**In practice** — a worker dispatch already walks the pipeline today: role requested → binding
recommended by routing policy → cross-family required for Independence → binding admitted only
after the adapter verifies the launched runtime (Decision 88, fail-closed) → receipt records what
observed.

Ratification semantics stay deferred (Deferred Design Decision 7); this proposal does not settle
them.

**Recommend: accept.**

## D3 — Three constraint classes, applied per effect class

**Decide:** whether constraints divide into universal invariants, binding repository
requirements, and ignorable-with-reason recommendations — evaluated per effect class.

One of each: *invariant* — the invoked plan never owns completion semantics (the missing clause
that let the PhotoQuest plan call `goal_complete` with Steps 4–8 unfinished); *repository
requirement* — PhotoQuest's browser-evidence rule; *recommendation* — "use two judges on this
refactor."

Effect classes matter: an overnight read-only scout needs budgets and an external completion
predicate but no worktree isolation; the same posture shipping video files needs both. One global
floor forced the wrong answer for one of them.

**Recommend: accept.**

## D4 — Commitment per object

**Decide:** whether direction commitment is four independently agreed, versioned objects —
outcome, acceptance criteria, strategy constraints, implementation route — rather than one
agreement altitude.

**In practice** — the AFK run under D4: outcome and acceptance agreed; strategy adaptive, not a
promise; route unagreed. The two recorded conflicts then resolve mechanically:

- Prompt said "don't pause," plan said "gate hard" (session-ledger F3). The gate is part of agreed
  acceptance, so it wins — not because plans beat prompts, but because that clause carries
  agreement and the prompt line does not.
- You type "2 videos is fine" mid-run: a human amendment within authority re-versions the outcome
  object. Document type is irrelevant.

**Recommend: accept.**

## D5 — Presets as intent templates with disclosure cards

**Decide:** whether named presets are starting templates whose launch surface shows what you get
and what you don't — with presentation enforcing only the disclosure, never a capability.

**In practice** — the Attended Pair card:

> **Attended Pair.** You get: continuous attention, bounded cancellable children, fail-closed
> model binding, Workstream checkpoints. You don't get: unattended execution, crash recovery of
> live work, workspace isolation, publication authority.

The rejected form is a `Level 2 ✓` badge implying a bundle nobody enforces. V1 ships exactly one
preset; AFK Experiment and Managed Run stay research examples until their decisions land.

**Dissent (preserved):** even use-case names may be mentally ranked by autonomy. Test with
readers of the cards.

**Recommend: accept.**

## D6 — No resolver at V1; local gates instead

**Decide:** whether V1 skips resolver/validator machinery and instead adopts one invariant: any
feature that lets model activity continue past a human boundary ships its own local fail-closed
mechanical gate.

The pattern already exists: the AFK extension rejects `goal_complete` unless
`afk_outcome_finalize` produced an evidence-bearing receipt. Local, mechanical, no controller.
What this blocks later: a "mate auto-continue" config flag with no equivalent gate — invalid
regardless of prompt quality. The rejected alternative was a V1 resolver service validating the
only legal posture — a one-row table maintained forever.

Human boundaries here are decision points: typed ask, explicit pause, always-escalate classes.
Control disconnect is deliberately not one — see D21.

**Recommend: accept.**

## D11 — FirstMate: unbundle, scoped to mate v0

**Decide:** `task-firstmate-gating-decision` — unbundle a level-agnostic coordination mate from
managed-authority machinery, at this scope:

**Mate v0, concretely:** three sessions run; one hits an ask; the mate surface shows "Session B
needs you (1 of 3)" with a focus action; you answer in the session yourself. The mate answers
nothing, writes nothing, and synthesizes only when you open the panel.

What stays blocked, and by what:

- **Answering for you (Phase 2):** blocked on the typed answer-delivery build plus its own
  superseding decision. This verdict alone cannot enable it. Its gate uses mechanically derived
  effect class; model attestations only narrow or escalate — never widen.
- **Steering a running child:** Decision 80 stands — cancel-and-relaunch. A child that pauses on
  a decision point times out to a terminal needs-decision state; you relaunch with the answer in
  the assignment.
- **Background model synthesis:** your observer session is the cautionary tale — 25.9M tokens,
  about $7, a model turn every few seconds, and it initially repeated the target's broken
  completion claim. Watching is deterministic events only.

**Dissent (residual):** calibration quality of model-attested fields — bounded, cannot widen
authority.

**Recommend: accept.**

## D12 — Frontier-batched questions

**Decide:** `task-frontier-attention` — adopt the eligibility rule: a question enters a round
only when its prerequisites are settled and it is currently material; the frontier recomputes
from answers.

**In practice:** this report is the mechanism in use — 17 decisions in one round, D7–D10 visibly
parked because their prerequisite is you. Rendered over your live Workstream: answerable now =
task-decision-93, watched-sources, branch-evidence, default-context; waiting = the Working Mode
task (on D1–D6). Answers stay individual revision-checked submissions (Decision 91); a mooted
sibling drops from the round.

Destination: V1 version in `graphical-attention.md`; managed-Run batching waits for a
managed-attention contract — `graphical-attention.md:15-16` excludes it today.

**Recommend: accept.**

## D13 — Phase boundaries as branch questions

**Decide:** `task-phase-boundary-tree` — fold five questions, not a ranked ladder, into the
`focus-handoff` skill: independence needed → subagent; context poisoned → clear; parallelizable
and bounded → subagent; durable transfer → handoff; otherwise continue. Compact at semantic
boundaries under context pressure.

Why not the source's ranking (continue > clear > handoff > subagent > compact): "review the code
I just wrote" needs a fresh subagent immediately — fourth place in the ranking, first correct
answer in practice. The source's "conversation is a primary source" rationale is rewritten to
"the live session is the cheapest current context, never authoritative state," which keeps
Principles 9–10 intact.

**Recommend: accept.**

## D14 — The outcome-only attention floor

**Decide:** the Q8 answer — outcome-only attention is admissible only above this floor, scored
here against the PhotoQuest overnight trial today:

| Floor item | Trial today |
| --- | --- |
| Aggregate reserve-and-stop budget across lead, children, judges, compaction, supervisors | fails — nothing aggregates nested spend; this alone makes it inadmissible |
| Deterministic event-driven supervision, no model polling | passes — matrix supervisor made zero model calls |
| Completion predicate outside the invoked plan | passes — AFK receipt gate exists |
| Restart classifies resume-or-stop | fails — untested |
| Human boundaries pause work, never reroute to diagnostics | fails — the failure run routed `escalate` into diagnostics |

Effect-conditional extras (attempt consumption, isolation) scale with mutation class. The trial
additionally needs, in order: Asset Scout hang diagnosed → disposable guarded successor test →
proven aggregate stop → a fresh explicit yes from you. Diagnosis never implicitly authorizes
attempt 04.

**Recommend: accept.**

## D15 — Judgment cadence

**Decide:** the Q7 answer — reject "dual cross-family judgment every phase" as default; make
cadence proportional, with one invariant floor.

The floor (Principle 14): every material claim is checked by an actor that did not produce it —
no policy, plan, or ratification waives it. Above the floor: independent review only where it
breaks a named failure correlation; dual cross-family only at material or irreversible boundaries
or weak evidence; deterministic checks always.

Real numbers behind the rejection: lead $13.44, observer $7.01, one five-arm smoke matrix
$15.16 — and quota fails closed, so mandatory dual judgment would stall runs at boundaries nobody
assessed as needing it. A quota-blocked judgment pauses as an attention state, never silently
skips. A plan's own "phase 3 is low-risk" can only increase review, never reduce it.

**Recommend: accept.**

## D16 — Stewardship at close

**Decide:** the Q9 answer — what blocks Run close versus what becomes a task.

Blocks close: recorded retain-or-clean disposition ("delete scratch worktree after 14 days"),
retire-superseded within the changed scope where authorized, outcome-plus-orchestration analysis,
and source-backed Learning Candidate extraction (Decision 27). Becomes tasks: promotion,
generalization, simplification (unless a recorded hazard), retirement outside the changed scope.
Workstream close keeps Decision 86 semantics — nothing forced. Compaction stays in-flight
hygiene.

**Recommend: accept.**

## D17 — Standing context: restructure

**Decide:** `task-challenge-default-context` — per-item verdicts over the ~750 standing
Workbench-owned words.

The two contested lines, verbatim, with verdicts:

> "Delegate proactively when it protects your context or the result…"
> (`extensions/subagent/index.ts:97`, commit `5c0f620`)

> "Worker identity is durable across sessions: check worker_status for an existing worker
> covering the scope and reuse or retire it before creating another."
> (`extensions/subagent/index.ts:217`, commit `0493eee`)

Both **grandfather**: owner = you, observable = D19, review 2026-09-15, auto-demote to a skill if
no evidence by then. The second line is currently the only guardrail — `registry.create()` mints
a UUID unconditionally, with no duplicate-scope check.

Keep: AGENTS.md router and invariants, tool schema facts, guidelines that document real
enforcement (Independence-roles preflight, dispatch lock), checkpoint lifecycle rules (the
compaction race was a real failure class), skills index. External blocks (goal, AFK gate,
web-access): authorship is upstream, admission is yours — the lever is enable/disable in harness
distribution; each block carries the same 2026-09-15 review. The clause-level sentence audit is
the first execution step of this verdict, not completed work.

**Recommend: accept.**

## D18 — Admission rule for standing context

**Decide:** future standing text is admitted only if it changes action at the margin, and is
backed by mechanical enforcement, observed failure, or a named catastrophic threat, and no
cheaper seam (skill, tool description, doc) serves, and it carries an owner plus an observable
and a review date. An observable alone never grants permanence.

Two candidates through the rule: "a worker runs one dispatch at a time; busy workers fail
preflight" — documents real enforcement, agent must know before dispatching — admitted. "Prefer
small, focused commits" — no enforcement, no observed failure, a doc serves — refused as standing
text.

**Recommend: accept.**

## D19 — The delegation observable

**Decide:** use worker-registry receipts as the over-eager-worker signal, honestly one-sided.

The 2026-09-15 review, concretely: a worker with one dispatch, retired same day → flag (a
subagent would have done); four dispatches over 3.5 hours → healthy; one dispatch then 37 idle
days → sprawl. Flags plus your classification are the renewal evidence D17's grandfathered lines
live or die on. Receipts cannot see under-delegation; no such claim is made.

**Recommend: accept.**

## D20 — Record the two-altitude principles structure

**Decide:** `task-decision-93` — record this decision text (number assigned at recording time):

> **9X. Principles use two altitudes with single primary homes.** `principles.md` carries guiding
> maxims and, beneath each, the detailed principles it refines; provenance notes are a third
> content type, not detailed principles. Every detailed principle has exactly one primary maxim
> home; cross-references are free. Chosen over replacing the 34 detailed commitments and over a
> separate philosophy file. A commitment fitting no maxim is a gap.

**Recommend: accept.**

## D21 — Disconnect handling (the one live disagreement)

**Decide:** what happens when you close the laptop at 22:03 with a 20-minute background child
running, and reopen at 22:20.

- **Lead version (recommended):** the child finishes its bounded work, labeled session-scoped
  (control lost) — never "attended" — and is killable the moment you return. Anything new that
  relaxes attention during the gap (auto-continue, another background child) is refused
  fail-closed. Where no control-presence signal exists (plain terminal), no dynamic claim is
  made; protection stays bounded-children-die-with-parent (Decision 89's explicit-absence
  pattern). The control-presence producer, where it exists, is PI WEB's session transport.
- **Advisor version (preserved dissent):** after a bounded grace period the child pauses or
  dies. "A live session with nobody at it isn't attended, and labels don't cancel processes."
  Cost: new pause/cancel machinery, and closing the lid kills every long-running read.

**Recommend: accept the lead version**, or `revise D21: mandate grace-period pause` to side with
the advisor.

---

## Round 2 preview — unlocked by D1–D6

- **D7 — the verdict** on open question 17: adopt / revise / retain-levels. Lean: revise —
  retire the ladder as primary model with the corrections above. The superseding decision must
  map Decisions 79–82 clause by clause (retained / renamed / superseded) and prove with a
  boundary-equivalence table that continuous attention, cancel-and-relaunch, fail-closed binding,
  no selector, no unattended execution, and truthful guarantees all survive.
- **D8 — migration outline:** one coherent change set over the 18 referencing documents,
  partitioned into normative text (rewrite), active plans (annotate, keep filenames), and history
  (untouched); Operating Level keeps a superseded legacy definition.
- **D9 — PI WEB presentation:** static disclosure card only; no dynamic capability report until a
  named producer exists; no editable vector dashboard.
- **D10 — principles impact:** link and terminology repair in the migration set; stewardship gap
  resolved either as a new detailed principle under Principle 12 or recorded as workflow policy.

## Dissent register (survives regardless of verdicts)

1. Preset names may still be mentally ranked (D5).
2. Retiring the categorical ladder may cost pedagogy and migration recognition (D7).
3. Model-attestation calibration inside an admitted envelope (D11) — measure false-escalation and
   missed-narrowing rates.
4. Advisor versus lead on disconnect gating (D21) — the human verdict settles behavior, the
   disagreement stays recorded.
5. Enforcement debt: prose-not-enforcement is accepted invariant; no general V1 resolver is a
   declared limitation; aggregate reserve-and-stop budgeting is a build prerequisite blocking
   outcome-only postures (D14).

## Method and independence

Lead: Anthropic (this session). Advisor: durable worker `working-mode-grill-advisor`
(`openai-codex/gpt-5.6-sol:xhigh`), four design rounds, retired after audit. Closing audits: two
fresh reviewer subagents, cognitive role challenge, routed away from the Anthropic lead — both
landed on `gpt-5.6-sol`, so they are context-fresh and lead-independent but not model-independent
from the advisor. Audit 1 returned six material gaps (all reconciled, one advisor absorption
round); audit 2 returned none and confirmed coverage of every dossier-required output. Evidence
trail: the dossiers, decisions.md, principles.md, operating-levels.md, vocabulary.md, both
2026-08-08 AFK reports, the FirstMate plan and prototype, `aihero` §frontier mechanism,
`compounding-error-control`, `model-orchestration`, `extensions/subagent/index.ts`,
`packages/worker-registry/src/registry.js`, `graphical-attention.md`, `workstreams.md:71-72`.
