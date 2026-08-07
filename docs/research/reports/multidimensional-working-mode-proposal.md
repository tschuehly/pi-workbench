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
