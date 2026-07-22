---
name: analyze-source-for-workbench
description: Analyze an external library, repository, article, paper, talk, tweet, or social thread for lessons relevant to Pi Workbench. Use when the user asks what Pi Workbench can learn from a source, whether the source is better or worse than the current setup, which ideas to adopt or reject, or how to apply a source's mechanisms to the Workbench architecture or workflow.
---

# Analyze a source for Pi Workbench

Produce a source-faithful comparison that ends in concrete `adopt`, `adapt`, `experiment`, or `reject` recommendations. Optimize for useful changes, not admiration of the source or defense of Pi Workbench.

## Establish the baseline

1. Read `docs/CONTEXT.md` and `docs/SPEC.md` completely.
2. Read `docs/LEDGER.md` completely when decision status, provenance, or architectural fit matters.
3. Inspect the current repository implementation relevant to the comparison. Do not compare a working source only against Pi Workbench's intended architecture.
4. State the important maturity mismatch: implemented and exercised, specified but unimplemented, or merely claimed.

Use canonical Pi Workbench vocabulary. Keep the deterministic Run Controller distinct from clients, the Workflow Contract, the Semantic Execution Graph, and Pi actors. Treat PI WEB as a client and Pi as the only model-worker runtime.

## Inspect the source faithfully

1. Resolve the exact source, version, revision, and publication date when available.
2. Prefer primary material: source code, official documentation, the original article or post, tests, examples, and commit history.
3. For a library or repository, inspect the implementation paths that support its central claims. A README claim is not implementation evidence.
4. For an article, tweet, or thread, separate:
   - the author's observation;
   - the proposed explanation;
   - supporting evidence;
   - advice or speculation.
5. Follow linked material only when it materially supports the claim being evaluated.
6. Cite or link the evidence close to each important conclusion.

For Java or JVM API details, prefer the configured `javadoccentral` tools before web search. Browse whenever the source is external, current behavior may have changed, or the user supplied only a URL.

## Extract mechanisms, not slogans

Describe what the source actually does as a small set of mechanisms. For each mechanism identify:

- the problem it solves;
- its inputs, state, actions, outputs, and failure behavior;
- where authority resides;
- what evidence demonstrates that it works;
- the assumptions and costs it introduces.

Do not transfer branding or source-specific terminology when Pi Workbench already has precise domain language.

## Compare at the correct architectural layer

Place each mechanism at the narrowest suitable layer:

| Mechanism concerns | Pi Workbench destination |
| --- | --- |
| Lifecycle legality, authority, idempotency, reconciliation | Run Controller |
| Variable meaningful work and dependencies | Semantic Execution Graph |
| Model assignment, context, continuity, permissions | Execution Profile or Work Packet |
| Bounded implementation or analysis technique | Skill or Dispatch behavior |
| Git, worktree, landing, cleanup | Repository Workspace |
| Immutable evidence and retention | Artifact Store |
| Repository-specific rigor or commands | Repository package |
| Human presentation | Review Surface or client projection |

Do not turn a useful local tactic into a universal lifecycle invariant. Do not create a second authoritative ledger, let a skill own controller transitions, or add another coding-agent harness.

## Evaluate honestly

Compare the source and Pi Workbench across the dimensions that matter for the mechanism:

- outcome quality and human judgment leverage;
- executable clarity and demonstrated operation;
- authority and side-effect boundaries;
- deterministic state, durability, recovery, and reconciliation;
- evidence quality and invalidation;
- Model Context and Human Attention costs;
- adaptability across repositories and tasks;
- implementation and operational complexity.

Actively test both biases:

- **Novelty bias:** a concrete implementation can still encode a poor universal rule.
- **Architecture bias:** an elegant specification is inferior to a simpler system if it cannot execute the critical path reliably.

Say plainly when the source is better, when Pi Workbench is better, and when there is insufficient evidence. A source may be superior in one narrow mechanism while inferior as a complete Run model.

## Decide what to do

Classify every material lesson:

- **Adopt:** compatible, evidenced, and useful without changing its essential mechanism.
- **Adapt:** useful after translating it to Pi, controller authority, typed Episodes, repository policy, or another Workbench boundary.
- **Experiment:** promising but insufficiently evidenced; define a bounded pilot and falsifier.
- **Reject:** redundant, inferior, incompatible, or not worth its complexity.

For every `adopt`, `adapt`, or `experiment` item, specify:

1. the concrete change;
2. the owning module, skill, repository package, or document;
3. why it improves the current setup;
4. the evidence or test that would prove the improvement;
5. what must remain unchanged.

Prefer one or two high-leverage changes over a backlog of loosely related ideas.

## Present the result

Lead with a short verdict. Then present:

1. **What the source proves or demonstrates.** Distinguish observed behavior from claims.
2. **What it does better than the current Workbench setup.** Compare against implemented reality as well as intended behavior.
3. **What Pi Workbench should adopt, adapt, experiment with, or reject.** Include the destination and validation method.
4. **Recommended next action.** Name the smallest useful application step.

Use a table only when it materially reduces comparison effort. Avoid a feature-by-feature summary that does not change a decision.

## Apply changes only when authorized

Analysis is read-only unless the user explicitly asks to apply, implement, or document the recommendations.

When applying:

1. Make the smallest coherent change at the destination selected above.
2. Preserve source provenance for copied or adapted code and comply with its license.
3. Put external evidence and source-specific findings in `docs/ledgers/` when durable provenance is needed.
4. Put only supported intended behavior in `docs/SPEC.md`; do not add comparison history or old-versus-new framing.
5. Record a settled decision in `docs/LEDGER.md` only when the user or existing decision process has actually settled it.
6. Validate the change in proportion to its risk and report what remains unproven.
