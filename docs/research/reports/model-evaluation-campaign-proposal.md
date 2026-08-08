# Model evaluation campaign proposal

**Status:** proposed direction; non-authoritative. Challenge and approval are required before changing authoritative vocabulary, decisions, contracts, plans, routing policy, or UI. This report must not be treated as implemented harness behavior.

## Intent

Pi Workbench should be able to compare models and Model Effort systematically when a model is released, a skill changes, or the harness changes. The resulting evidence should help identify the least expensive binding that reliably meets the quality threshold for each Cognitive Role.

This capability should complement normal routed work rather than become a delivery Working Mode.

## Two execution paths

### Routed work

Normal delivery uses one attributable binding for each bounded assignment:

`Cognitive Role → model + Model Effort → result → verification`

This path optimizes for sufficient quality, latency, quota, and cost. Escalation and independent review remain targeted responses to the assignment's uncertainty and risk.

### Evaluation Campaign

A controlled campaign compares declared variants:

`Evaluation Case × model × Model Effort × harness or skill version × repetitions → Evaluation Results`

Campaigns are appropriate when:

- a model is added or updated;
- routing policy changes;
- a skill, prompt, tool, or harness capability changes; or
- evidence from real work suggests that a current binding may be underperforming.

An Evaluation Campaign is an experimental capability, not an authority grant, delivery workflow, global leaderboard, or replacement for the Run lifecycle.

## Why per-step best-of-N is insufficient

Running every work step through every model and selecting a winner can be useful as best-of-N execution, but it is not a valid model benchmark by itself:

- later comparisons depend on whichever output won an earlier step;
- single samples are vulnerable to stochastic variation;
- criteria invented after outputs are visible introduce selection bias;
- repeated fan-out consumes the quota needed for specialist challenge and review;
- merged outputs weaken authorship and independent-review provenance; and
- model preference is not Primary Evidence that the outcome works.

Comparable Evaluation Trials should instead receive the same frozen input, fresh Model Context, an isolated fixture, predeclared criteria, and repeated runs. Selection should happen only after complete Evaluation Trials have returned. Real project work can supply representative Evaluation Cases by capturing versioned inputs and fixture revisions without multiplying every tactical action.

## Proposed records

### Evaluation Case

A frozen, versioned unit of comparison containing:

- one bounded objective and Cognitive Role;
- the task or Work Packet-shaped input;
- a committed fixture or reproducible setup reference;
- permitted tools, skills, and output shape;
- acceptance criteria, deterministic checks, and any judgment rubric; and
- input, fixture, criteria, prompt, and capability hashes.

A case derived from real work becomes comparable only after these inputs are captured. A mutable checkout or transcript reference alone is not an Evaluation Case.

### Evaluation Campaign

An immutable comparison definition containing:

- the hypothesis or routing question;
- frozen Evaluation Case references;
- predeclared criteria and stopping conditions;
- the model and Model Effort candidate matrix;
- the Cognitive Role, resolved skills and tools, repetitions, ordering, timeout, and bounds; and
- the dimensions intentionally allowed to vary.

### Evaluation Trial

One case, candidate, and repetition pairing. Each Evaluation Trial starts with fresh Model Context and an isolated disposable fixture. A retry or redo by another model is a new, linked Evaluation Trial rather than a hidden continuation. This term is narrower than the experimental iteration proposed in the [multidimensional Working Mode report](multidimensional-working-mode-proposal.md) for an AFK Experiment.

### Evaluation Result

An immutable terminal record containing:

- the actual provider, model, and Model Effort;
- harness, skill, prompt, tool, runtime, and repository revisions;
- task, case, criteria, and input hashes;
- execution status, output, diff, and Pi session reference;
- quota admission, relevant quota windows, and degraded-telemetry status;
- deterministic verification and evaluator evidence;
- any model evaluator's binding and Independence relation to the candidate author;
- links to retries, corrections, and redos by another model;
- tokens, elapsed time, estimated cost when available, and tool failures; and
- any deviation that invalidates comparison.

### Policy-change path

An Evaluation Result is evidence, not a routing decision. When a managed Run links campaign evidence as experimental work, any proposed routing-policy change should enter the existing compounding path as a Learning Candidate with destination, scope, provenance, supporting evidence, applicability, validation method, invalidation trigger, and relationship to existing policy. An attended experiment outside a managed Run can produce a comparison report, but not a typed Learning Candidate or an automatic policy transition. One successful Evaluation Trial is never sufficient evidence for changing policy.

## How to judge “best”

Campaign reports should present a Pareto comparison rather than one universal score. Relevant dimensions include:

- acceptance or deterministic pass rate;
- judged quality for criteria that cannot be settled mechanically, with evaluator provenance;
- escaped findings and required correction;
- token use and estimated cost;
- elapsed time and time to useful evidence; and
- tool and execution reliability.

The practical routing objective is usually: **select the cheapest available binding that reliably meets the quality threshold for a particular Cognitive Role and task shape**. Different risk or latency constraints may therefore produce different preferred bindings from the same evidence.

Deterministic evidence should dominate when available. When model Judgment is required, the evaluator must not see candidate identity before scoring and must satisfy the declared Independence policy. If no one evaluator is independent of every candidate family, the Campaign must use candidate-specific independent evaluators, multiple reconciled evaluators, or Human Attention. Provider diversity supplies Independence, not correctness.

## Smallest useful implementation

A dedicated evaluation module should remain separate from the attended `subagent` extension:

```text
evals/
    cases/
    campaigns/
packages/evaluation/
    runCampaign(spec)
    inspectCampaign(id)
scripts/pi-eval
```

The runner can reuse the unmanaged Pi RPC process mechanics behind `packages/pi-execution-adapter/` while allowing an evaluation manifest to enumerate explicit model and effort candidates without changing the active routing policy. Reuse of mechanics grants no managed authority. Each Evaluation Trial should use a disposable workspace and leave the project checkout unchanged. Results should be stored outside authoritative Workstream state and should reference Primary Evidence rather than treating model judgments as truth.

### Operating posture

This capability is outside the implemented V1 contract until an approved plan adds it. The first experiment should be an explicitly human-started foreground CLI process, not an interactive-lead tool or a background model turn. The human remains present and can cancel it while the CLI sequences candidates one at a time. An Evaluation Campaign is not a Run, an Evaluation Trial is not a controller-authorized Dispatch, and an Evaluation Result is not an Episode. It has no workspace lease, publication rights, managed recovery, or authority over routing policy.

The first implementation should be local, support deterministic cases, and preserve complete provenance. Parallel batches, automatic routing-policy promotion, managed unattended campaigns, PI WEB presentation, and monetary budget enforcement can wait until evidence justifies them. If the proposed module or paths are approved, `AGENTS.md` must route maintainers to them in the same change.

## Initial acceptance evidence

A minimal runner should prove that:

1. every candidate receives identical declared inputs except for dimensions the Campaign permits to vary;
2. every Evaluation Trial starts fresh and records the actual runtime binding, quota admission, and relevant quota windows;
3. deterministic verification runs outside the candidate model;
4. model evaluators are blinded to candidate identity and satisfy the declared Independence policy;
5. mismatched case, criteria, harness, skill, prompt, tool, or fixture hashes invalidate undeclared comparisons;
6. retries, corrections, redos, cancellation, and failures remain visible rather than disappearing from aggregate results;
7. the active project checkout remains unchanged; and
8. a repeated two-candidate smoke campaign produces an inspectable comparison without modifying the active routing policy.

## Relationship to current policy

The existing routing rationale already requires comparable runs before a binding changes, including role, task shape, Model Effort, quota windows, outcome evidence, corrections, elapsed time, and any redo by another model. Evaluation Campaigns could produce controlled fixture evidence with those fields. That evidence should complement—not replace—evidence from representative Workbench Runs before routing policy changes. This preserves single-author attribution, targeted Independence, and the distinction between Judgment and authority.
