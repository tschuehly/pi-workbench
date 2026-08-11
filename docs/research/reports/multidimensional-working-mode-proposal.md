# Multidimensional Working Mode proposal

**Status:** proposed direction; challenge required before changing authoritative vocabulary, decisions, contracts, plans, or UI.

## Proposal

Retire the numbered Operating Level ladder as Pi Workbench's primary execution model. Resolve each Run or interactive session as a validated, multidimensional **Working Mode** instead. Named presets may remain as convenient starting points, but they are points in the model rather than ranks, authority grants, or bundled guarantees.

The current ladder couples prior plan agreement, Human Attention cadence, delegation, deterministic management, durability, isolation, and review. Real combinations do not follow that sequence. An AFK Experiment demonstrates the mismatch: it can use an agreed outcome, adaptive strategy, dual independent model judgment, and discontinuous Human Attention while still lacking controller governance, durable recovery, and workspace isolation. Calling that a higher level obscures the missing guarantees.

## Candidate dimensions

1. **Human Attention cadence:** continuous, phase-boundary, material-question, or outcome-only.
2. **Direction commitment:** emergent, agreed outcome, agreed strategy, or approved implementation and acceptance contract. Strategy remains evidence-adaptive.
3. **Execution governance:** session-owned, coordinator-guided, or controller-managed.
4. **Authority envelope:** Scout or Ship, permitted impact, reversibility, credentials, external effects, and Publication rights.
5. **Durability:** ephemeral, session-resumable, process-reconciled, or durable Run.
6. **Workspace protection:** shared checkout, isolated worktree, or sandboxed execution.
7. **Verification:** deterministic checks, independent review depth, model-family independence, and judgment cadence.
8. **Bounds:** token, time, cost, attempts, no-progress limits, and stopping conditions.
9. **Delegation shape:** single actor, bounded children, resumable workers, or adaptive semantic graph.

Dimensions are not unrestricted toggles. A deterministic resolver proposes a Working Mode from desired outcome, repository capabilities, uncertainty, impact, reversibility, and available Human Attention. A validator rejects combinations whose requested attention or authority exceeds their governance, durability, isolation, evidence, or bounds. Presentation must expose both the selected posture and any unsupported guarantee rather than compressing them into one number.

## Owner control hypothesis

The interface should make the multidimensional model easy to steer without presenting nine independent controls by default. Expose two prominent, independently adjustable controls:

1. **Working Mode preset:** `Sprint`, `Pair`, or `Thorough`.
2. **Human Attention cadence:** `Interactive`, `Phase boundaries`, `Material questions`, or `Outcome`.

The preset is a convenient starting point, not an authority grant or quality rank. It expands into a visible resolved posture whose dimensions may be inspected or adjusted. Human Attention cadence remains separate so the owner can begin in `Thorough + Outcome`, return during the same Run, and switch prospectively to `Sprint + Interactive` for a fast feedback loop.

A change applies to future semantic work and Dispatches. It does not silently alter an active child assignment, invalidate completed evidence, lower repository safety floors, expand authority, or claim governance and recovery that the runtime does not provide. The interface should state whether active work will finish under the previous posture and offer explicit cancellation when immediate change is necessary.

### Candidate preset behavior

| Behavior | Sprint | Pair | Thorough |
| --- | --- | --- | --- |
| Initial alignment | Infer and ask only Material Questions | Brief outcome and evidence confirmation | Explicit framing; autonomous grill when the decision is consequential |
| Delegation | Quick bounded background scouts and mechanics | Selective role-based delegation | Deliberate role separation across evidence, implementation, and review |
| Implementation | Lead or one bounded implementer | Task-dependent authoring | Evidence-first; separate author when Independence adds value |
| Independent review | Repository or risk triggered only | One bounded review for a meaningful completed change | Cross-family review at evidence-bearing phase boundaries |
| Correction | No routine review loop | At most one justified remediation pass | A finite review/remediation ladder, initially at most two passes |
| Human presentation | Concise outcome and Primary Evidence | Structured evidence summary | Deep task-shaped Review Surface |

`Evidence-first` is broader and more accurate than universally requiring tests first. Test-first development fits behavior with a stable test seam; browser evidence fits interface behavior; discriminating probes fit experiments; static checks or direct inspection may fit documentation and configuration. The preset selects a default evidence strategy, while repository policy and the task determine the valid proof.

### Delegation and review constraints

Fast work should reduce lead latency by launching non-overlapping, bounded children with cheaper Execution Profiles in the background. Read-only investigation, scouting, and mechanics may run concurrently. In a shared Level 1 checkout, only one mutating implementer should run at a time; parallel mutation requires isolated workspaces or controller-managed workspace leases.

Independent review should occur at evidence-bearing synchronization points rather than continuously after each edit. Every review declares the material claim or risk, required Primary Evidence, finding disposition, attempt bound, and stopping condition. `Sprint` omits habitual heavy review but cannot bypass repository safety floors. `Thorough` increases review depth and model-family Independence without creating an unbounded loop that continues until models stop finding improvements.

### Review Surface depth

A richer preset increases result-packaging depth, not the use of one universal format. The final medium remains task-shaped:

- interface work may use a live page, screenshots, contextual annotations, or an interactive HTML artifact;
- architecture work may use a decision tree and diagrams;
- backend work may use behavior examples, an evidence matrix, and the relevant diff; and
- experiments may use a comparison surface showing representative successes, failures, contradictions, and remaining uncertainty.

A detailed HTML Atelier is therefore a useful `Thorough` outcome when direct human experience or visual judgment benefits from it, not a mandatory artifact for every task.

### Resolution seam

The candidate deep module should keep presentation and orchestration policy separate:

```ts
resolveWorkingMode({
  ownerPreference,
  attentionCadence,
  desiredOutcome,
  repositoryCapabilities,
  uncertainty,
  impact,
  reversibility
}) -> ResolvedWorkingMode
```

The resolved result governs alignment depth, delegation shape, Execution Profiles and Model Effort, verification and Independence requirements, attempt bounds, stopping conditions, and Review Surface depth. PI WEB selects and displays owner preference and the effective posture; it does not own resolution, execution policy, or authoritative Run state. The model-routing target becomes `Cognitive Role + Entry Preset -> Execution Profile -> model binding`, while the current role-only resolver remains truthful as the pre-preset implementation.

## AFK Experiment example

An AFK Experiment is a budgeted, unattended pursuit of a hypothesis or measurable outcome. A Trial is one isolated change-and-evaluate iteration. The experiment orchestrator sequences Trials; a deterministic Watcher detects lifecycle and no-progress conditions; model judges assess evidence and direction; FirstMate routes Human Attention without gaining execution authority.

The current personal experiment has approximately this shape:

```yaml
attention: outcome-only
direction: agreed-outcome-and-acceptance, adaptive-strategy
governance: session-owned
authority: Scout-preferred
workspace: shared-checkout
durability: live-session-only
verification: deterministic-checks-plus-dual-model-phase-judgment
bounds: partial-main-session-token-budget, turn-limit, no-progress-limit
publication: prohibited
```

This vector makes the unsupported combination visible: Human Attention is discontinuous, but governance, durability, workspace protection, aggregate nested-agent accounting, and crash reconciliation are insufficient for overnight-safe execution.

## Evidence-adaptive phase loop

A large plan is an initial strategy, not authority to continue in a disproven direction. Each phase should:

1. run the cheapest useful probe that can falsify consequential assumptions;
2. produce a committed, directly verifiable outcome;
3. receive two fresh strong-model judgments over Primary Evidence—one direction/design judgment and one cross-family independent phase review;
4. continue only with dual support;
5. replan when either judgment or direct evidence invalidates the route;
6. use a discriminating probe when judgments materially disagree;
7. request Human Attention when a pivot changes outcome, acceptance, impact, authority, or material risk.

Model judgments are advisory. Deterministic modules must eventually own budgets, legal transitions, workspace effects, recovery, Acceptance, Publication, and cleanup.

## Cross-flow stewardship

The following are proposed invariant obligations across agent flows, not optional Working Mode dimensions:

- **Simplify:** reduce accidental structure after the outcome works.
- **Retire:** remove superseded code, prompts, plans, adapters, compatibility paths, and dead configuration when evidence and authority permit.
- **Compact:** rotate disposable Model Context at semantic boundaries without treating summaries as state.
- **Analyze:** evaluate both the realized outcome and orchestration behavior.
- **Compound:** extract source-backed Learning Candidates at the narrowest useful scope.
- **Retain or clean:** explicitly promote, expire, or delete artifacts and scratch state under authority and retention policy.

A flow is not complete merely because implementation and tests pass. It must account for obsolete paths, residual complexity, evidence, learning candidates, and cleanup eligibility. Deletion remains a governed side effect; compaction of Model Context is distinct from simplification of the realized system.

## Challenge agenda

Before adoption, challenge at least these questions:

1. Are all nine fields true dimensions, or are governance, durability, and workspace protection capabilities that constrain a smaller Working Mode vector?
2. Which values are owner choices, resolver outputs, repository safety floors, or mechanically observed facts?
3. Which compatibility constraints are invariant, and which belong to repository policy?
4. Can named presets reduce cognitive load without recreating a disguised ladder?
5. How should PI WEB show a multidimensional posture without becoming a configuration dashboard?
6. Does direction commitment belong in Working Mode when strategies must always remain falsifiable?
7. How are total cost and tokens bounded across the lead, nested reviewer children, compaction calls, and supervisor models?
8. What minimum governance and reconciliation are required before outcome-only attention is valid?
9. Which stewardship obligations must block closure, and which may create later Learning Candidates or cleanup tasks?
10. How should current Level 1 plans and "Level 4" managed contracts migrate without weakening their existing boundaries?

## Migration hypothesis

If the challenge supports this direction:

- replace Operating Level in canonical vocabulary with the validated Working Mode model;
- retain an **Attended Pair** preset for today's supported V1 behavior;
- describe controller-managed durable execution directly as a managed Run capability set rather than "Level 4";
- supersede decisions that make numbered levels the primary boundary while preserving every existing authority and safety invariant;
- update contracts, plans, router references, tool descriptions, tests, and PI WEB copy coherently rather than piecemeal.

No migration is authorized by this proposal. The existing contracts remain authoritative until the challenge is resolved and a decision is recorded.
