# Pi Workbench — Compounding Error Control Report

Status: analytical report. The implications and recommendations in this report are not accepted
product decisions. [SPEC.md](SPEC.md) remains authoritative for intended behavior and
[LEDGER.md](LEDGER.md) remains authoritative for decision status.

Source: [Mario Zechner, X thread, 2026-07-19](https://x.com/badlogicgames/status/2078775725973201092)

## Executive Summary

Mario Zechner's thread argues that control-flow expressiveness is not the hard part of a stochastic
agent system. Finite-state machines, actor-oriented graphs, loops, and richer graph encodings can
organize work, but they do not prevent errors from propagating through a sequence of individually
fallible steps. Increasing control-flow complexity can add more failure opportunities while making
the resulting system harder to observe and correct.

This observation supports Pi Workbench's separation between the deterministic Controller Lifecycle
and the adaptive Semantic Execution Graph. It also exposes the main V1 risk: the specification is
more precise about control structure, records, and authority than about the problem-specific
feedback that detects semantic error before dependent work amplifies it.

Pi Workbench should therefore treat the Semantic Execution Graph as an organization and scheduling
model, not as an assurance mechanism. Assurance must come from Primary Evidence, explicit
invalidation, bounded authority, meaningful Independence, early feedback, finite attempts, and
durable escalation to Human Attention.

The V1 pilot should prove that the system can detect, contain, and surface deliberately seeded
semantic errors with bounded downstream work. Demonstrating graph construction and schema-valid
Episodes is insufficient.

## Source Claim and Limits

The source makes three connected claims:

1. A sequence of stochastic steps compounds the probability of failure when each required step has
   less than perfect reliability.
2. A more expressive control-flow encoding does not improve the correctness of the work flowing
   through it.
3. Reliable operation depends primarily on problem-specific guardrails that observe, contain, and
   correct errors.

The thread is an informal architectural warning rather than a complete reliability method. It does
not specify a probability model, distinguish independent from correlated failures, or prescribe a
particular control scheme. Its value for Pi Workbench is the design test it supplies: every claimed
reliability property should be traceable to feedback and containment behavior rather than to graph
shape alone.

In this report, **compounding error** means propagation and amplification of incorrect or uncertain
work across dependent stochastic Dispatches. It is distinct from Pi Workbench's **Run Analysis and
Compounding**, which concerns the controlled promotion of source-backed learning after a Run.

## Why Sequential Agent Work Is Fragile

For illustration, if every required step succeeds independently with probability `p`, the chance
that all `n` steps succeed is:

```text
P(end-to-end success) = p^n
```

Ten required steps at 90% individual reliability yield approximately 35% end-to-end reliability.
Twenty required steps at 95% individual reliability yield approximately 36%.

The independence assumption is usually optimistic for model work. Failures can be correlated
because several Pi actors may share:

- The same false premise or stale repository observation.
- The same Work Packet, Episode, or Judgment Dossier synthesis.
- Similar model behavior and training priors.
- The same incomplete acceptance criterion or verification command.
- The same author-proposed framing and happy-path test strategy.

A plausible upstream error can therefore become more credible as multiple downstream actors repeat
it. Additional actors and Episodes increase reliability only when they add new evidence or
meaningfully independent judgment.

## Control-System Interpretation

Pi Workbench already contains the main elements of a feedback-controlled system:

| Control function | Pi Workbench element | Required reliability property |
| --- | --- | --- |
| Desired outcome | Shared Understanding, acceptance criteria, Judgment Dossier | Specific enough to distinguish success from plausible activity |
| State estimation | Controller-owned `RunSnapshot` | Reports `unknown` for missing, stale, or contradictory evidence |
| Actuation | Controller-approved Ship Dispatch | Bounded scope, authority, impact, and recoverability |
| Observation | Primary Evidence, execution observations, verification receipts | Directly inspects the affected behavior or state |
| Feedback | Reconciliation, independent verification, Review Feedback | Arrives before unchecked error creates excessive dependent work |
| Safety interlocks | Autonomy Envelope, workspace lease, permissions, Publication authority | Limits blast radius independently of model judgment |
| Fault handling | Finite attempt ladder, cancellation, Attention Item, durable pause | Stops repeated or ambiguous failure without inventing success |

The deterministic controller can enforce the presence, identity, revision, provenance, and status of
these controls. It cannot mechanically determine whether a model's interpretation is true merely
because the interpretation satisfies an Episode schema.

## Existing Error-Containment Strengths

### Deterministic authority and side effects

The controller alone advances the Controller Lifecycle, dispatches Pi actors, owns workspaces, and
coordinates external actions. This prevents a model-generated recommendation from becoming an
authoritative state transition or project mutation without a validated authority path.

### Primary Evidence remains distinct from model output

Episodes record verified and unverified claims with evidence references but do not become
authoritative truth. The canonical snapshot produces `unknown` rather than guessing when evidence
is missing, contradictory, or stale. These are essential protections against confident narrative
being laundered into current state.

### Bounded mutation and recoverability

Ship Dispatches operate through isolated workspace leases and explicit impact limits. Dirty,
unlanded, unattributed, or evidence-incomplete workspaces remain leased. Publication is explicit and
idempotent. These controls limit the consequences of an incorrect Dispatch even when semantic
verification fails.

### Staleness and invalidation

Repository revisions, input hashes, task revisions, approval validity, and validation evidence are
checked before resumption or Dispatch. Changed inputs enter reconciliation instead of silently
preserving prior conclusions.

### Finite failure handling

Named Execution Profiles carry finite attempt ladders. Exhausted attempts, repeated review failure,
unknown outcomes, contamination, stale authority, and exhausted budget produce a deduplicated
Attention Item and pause affected work.

### Human Attention at high-leverage boundaries

Principal Judgment brackets autonomous mutation, while In-Run Judgment is available for Material
Questions and authority expansion. This gives the system a path for resolving uncertainty that
cannot be settled mechanically.

## Material Reliability Gaps

### 1. Schema validity does not establish semantic validity

A Work Packet or Episode can be complete, well-typed, provenance-bearing, and wrong. The schema
registry prevents malformed protocol state; it does not prove that a repository claim, test
interpretation, design conclusion, or risk judgment is correct.

Controller transitions that depend on model judgment must therefore require both:

- Mechanically enforceable facts, such as revisions, identities, leases, required fields, and
  evidence references.
- Explicit provenance-bearing judgment attestations whose uncertainty and challenge status remain
  visible.

The system must not present the second category as deterministic validation.

### 2. Independence can be nominal rather than substantive

`author != reviewer` is necessary but insufficient. A reviewer can reproduce the author's error
when it receives the same framing, relies on the same derived evidence, or uses the same verification
strategy.

Repository packages need to define meaningful Independence for each material risk. Depending on the
task, this can require:

- Direct access to Primary Evidence instead of only the author's Episode.
- A fresh problem framing or adversarial review lens.
- A verification method not selected solely by the author.
- Different model behavior or capability where correlated model error is material.
- Isolation from unsupported conclusions while retaining the intended outcome and constraints.

### 3. Feedback may arrive after excessive propagation

Final independent verification is necessary but can be late. An incorrect high-fan-out assumption
can influence design, implementation, tests, documentation, and synthesis before the verification
stage begins.

The Semantic Execution Graph should attach earlier evidence obligations to assumptions whose failure
would invalidate substantial dependent work. The controller need not judge the assumption itself;
it can prevent dependent Dispatches until the required evidence or explicit uncertainty disposition
exists.

### 4. Retry can repeat a failure mode

Another attempt with the same premise, evidence, method, model behavior, and scope is repetition, not
control. An attempt ladder should identify what changes between attempts. Valid changes include new
Primary Evidence, a narrower objective, corrected inputs, a different skill or tool, a different
verification method, increased Model Effort, meaningful Independence, or Human Attention.

An unchanged attempt should consume the finite budget but should not be treated as an increasingly
credible result.

### 5. Locally non-material revisions can create material cumulative drift

The coordinator may autonomously revise the Semantic Execution Graph inside the approved envelope.
Several individually non-material revisions can collectively change scope, risk, evidence coverage,
or the realized interpretation of the intended outcome.

Graph validation should compare accumulated effects with the ratified Judgment Dossier and Autonomy
Envelope. Crossing a cumulative limit should create an Attention Item even when no individual
revision crossed the materiality threshold.

### 6. Post-Run analysis does not control an active Run

Run Analysis already records retries, rework, review yield, context pressure, tool failures, and
evidence completeness. A useful subset of these signals should also feed live supervision. The
controller can detect rising uncertainty and propagation risk without asking a model to interpret
routine progress.

### 7. Graph sophistication can increase the error surface

Every extra node, Dispatch, synthesis, translation boundary, and optional path creates another place
for information loss, stale context, unsupported inference, or coordination failure. The coordinator
should choose the smallest semantic graph that satisfies the Workflow Contract's evidence and
Independence obligations.

Graph complexity should be justified by separable work, evidence needs, isolation, or meaningful
parallelism—not by the availability of a powerful graph representation.

## Recommended V1 Control Requirements

These recommendations fit within the current Workflow Contract, repository package, Dispatch,
Episode, Attention, and reducer concepts. They do not require a more general graph language.

### Evidence before fan-out

Each graph revision should identify claims and assumptions that can invalidate dependent nodes. A
high-fan-out or high-impact claim requires one of the following before dependent Ship work begins:

- Sufficient Primary Evidence under repository policy.
- An explicit unresolved status accepted inside the Autonomy Envelope.
- In-Run Judgment when the uncertainty is a Material Question.

### Explicit invalidation propagation

Evidence metadata already declares invalidation scope. The controller should use it to mark affected
claims, Episodes, graph nodes, dossier statements, approvals, and verification results stale when an
upstream revision or claim changes. Dependent work must not remain implicitly valid.

### Bounded unchecked depth

Repository policy should limit how much dependent stochastic work may proceed without fresh Primary
Evidence or a meaningful independent check. The appropriate limit is task- and risk-specific; it is
not a universal node count.

### Cumulative drift supervision

The canonical snapshot should project accumulated changes relative to the approved outcome, impact,
budget, risk, and evidence obligations. Thresholds should be defined by the repository package and
should create one reconciled Attention Item when exceeded.

### Attempt diversity

Every retry record should state the diagnosed failure mode and the material change from the prior
attempt. Execution Profiles should define allowed escalation steps and stop when no justified new
control action remains.

### Independence profiles tied to risk

Independent verification should declare which failure correlation it is intended to break: author
anchoring, shared context, shared model behavior, shared evidence, shared toolchain, or shared test
strategy. Merely starting a fresh Pi actor should not satisfy every Independence obligation.

### Direct acceptance evidence

Completion claims should map acceptance criteria and material risks to evidence that observes the
realized behavior. A passing command is relevant only when its output actually tests the affected
behavior and its inputs remain valid.

### Minimal sufficient graph

Graph proposals and revisions should include a concise justification for every semantic node and
dependency. The controller can enforce declared obligations and size or budget limits; the
coordinator remains accountable for why additional stochastic boundaries improve the Run.

## Pilot Fault-Injection Program

The PhotoQuest pilot and controlled drills should include semantic faults in addition to protocol,
lease, staleness, and idempotency failures.

### Poisoned Scout claim

Provide a schema-valid Scout Episode containing one plausible false repository assumption. Verify
that unsupported content does not become an authoritative premise and that affected Ship work cannot
claim completion without direct evidence.

### Correlated reviewer

Give the independent reviewer the author's framing and a passing but incomplete test strategy.
Verify that the configured Independence obligation requires direct behavior evidence or another
review lens rather than only a distinct actor identity.

### Passing but irrelevant verification

Return a successful verification command that does not exercise landing-page scroll-depth tracking.
Verify that success does not satisfy the mapped acceptance criterion.

### Repeated-premise retry

Fail a Dispatch and resubmit substantially unchanged inputs and strategy. Verify that the attempt is
recorded as repetition, consumes the bounded attempt budget, and does not increase claim confidence.

### Cumulative non-material drift

Apply several individually allowed graph revisions whose combined effect changes scope or evidence
coverage. Verify that supervision reconciles their cumulative effect and requests Human Attention.

### Upstream evidence invalidation

Change a repository revision or disprove a Scout claim after dependent work begins. Verify that
affected Episodes, validation results, approvals, and graph-node completion state become stale at
the declared invalidation scope.

### False consensus

Return several agreeing model judgments derived from the same unsupported source. Verify that
agreement count is not treated as independent evidence and that synthesis exposes the shared
lineage.

## Evaluation Measures

The pilot should collect measures that describe control quality rather than graph sophistication:

| Measure | Meaning |
| --- | --- |
| Detection latency | Time or semantic work between an originating error and its recognition |
| Propagation depth | Number of dependent Dispatch boundaries crossed before containment |
| Assumption fan-out | Number and impact of nodes depending on a claim or assumption |
| Evidence-before-fan-out coverage | High-impact dependencies supported before downstream mutation |
| Rework amplification | Downstream work invalidated relative to the originating error |
| Retry novelty | Attempts that materially change evidence, method, scope, or capability |
| Independent-review yield | Material findings produced by the required independent check |
| Evidence relevance | Acceptance criteria supported by evidence that observes affected behavior |
| Unknown preservation | Ambiguous outcomes retained as `unknown` rather than guessed success |
| Escaped error | Seeded or observed error reaching Acceptance or Publication undetected |

Model-level success percentages should not be treated as calibrated probabilities unless supported
by repeated comparable runs. The measures above are operational evidence about where errors arise,
how far they travel, and whether the Workflow Contract contains them.

## Implications for V1 Priorities

The V1 proof should prioritize the following outcomes:

1. A small Controller Lifecycle and coarse Semantic Execution Graph remain understandable under
   failure.
2. Schema-valid but semantically unsupported model output cannot silently advance authoritative
   state.
3. High-impact assumptions receive feedback before they create excessive dependent mutation.
4. Independence requirements demonstrably break relevant failure correlations.
5. Retries change the control conditions or terminate within a finite ladder.
6. Invalidated evidence propagates through the canonical projection.
7. Seeded semantic errors are contained before Acceptance and Publication.

Graph adaptability remains useful when it responds to evidence, isolates independent work, or
narrows uncertainty. It should not be a primary success criterion by itself.

## Decision Questions Raised

The report raises questions for explicit review rather than resolving them implicitly:

1. Which claims or assumptions must become first-class dependency and invalidation references in
   the V1 schema?
2. How does each repository package define meaningful Independence for its material risks?
3. Which live Run Analysis signals should create Attention before an attempt ladder is exhausted?
4. How should cumulative non-material graph drift be measured against the Judgment Dossier and
   Autonomy Envelope?
5. What evidence proves that a verification command is relevant to an acceptance criterion?
6. What material change is required for an attempt to count as a justified retry?

These questions affect error-control behavior and should be exercised through the pilot before more
graph expressiveness or orchestration surface area is added.

## Conclusion

Pi Workbench's fixed controller, durable ledger, bounded Dispatches, explicit authority, Primary
Evidence, independent verification, and durable Attention provide the right substrate for handling
stochastic work. None of those mechanisms is sufficient merely because it exists in the graph or
schema.

The system succeeds when its repository-specific controls detect false premises, preserve
uncertainty, invalidate dependent conclusions, bound mutation, diversify retries and review, and
surface Material Questions before errors compound. The Semantic Execution Graph should make those
control obligations visible and schedulable. It should never be mistaken for the mechanism that
makes the Run reliable.
