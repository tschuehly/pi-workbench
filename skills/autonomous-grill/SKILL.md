---
name: autonomous-grill
description: Autonomous cross-model grilling with a concise decision report for human review.
disable-model-invocation: true
---

# Autonomous Grill

Stress-test consequential decisions autonomously, then return every proposal to the human for judgment. Use `/model-orchestration` and the Level 1 `subagent` tools for cross-family challenge. Apply `/domain-modeling` only to outcomes the human accepts.

## Establish the decision tree

Distill the target, Primary Evidence, constraints, assumptions, and unresolved decisions. Build an opening decision tree: each consequential decision branches into the decisions that depend on it. Resolve discoverable facts from repository files, supplied documents, and tools rather than asking the human.

Draft a recommendation for every currently reachable branch. The lead owns synthesis and remains accountable for the final report.

**Complete when:** every known consequential branch is represented, and every recommendation distinguishes evidence from assumption.

## Run the grill

Use one advisor role across the grill. Because Level 1 children are fresh bounded Subagents, realize that role as a new child per round and carry its continuity in a compact advisor ledger containing prior challenges, lead responses, unresolved dissent, and evidence changes.

Work one consequential decision at a time in dependency order. For each round on that decision:

1. Launch a `reviewer` Subagent with Cognitive Role `challenge`, independent of the lead's provider. Give it the target, current decision, its prerequisites and dependents, current proposal, evidence anchors, constraints, and advisor ledger. Ask it to challenge assumptions, alternatives, evidence, contradictions, dependencies, and missing branches; require prioritized, numbered findings.
2. Reconcile the result. Revise the proposal, investigate factual gaps, and record unresolved dissent. Update the advisor ledger with deltas rather than a transcript.
3. Launch another round only when the challenge or new evidence materially changes the proposal. Stop after three rounds unless new Primary Evidence changes the decision tree.

If cross-family routing or any required child launch fails, disclose the failed independent challenge and stop instead of substituting the lead's own review.

**Complete when:** no returned material challenge remains unanswered, revised, or explicitly recorded as dissent.

## Audit completeness

Launch a final fresh `reviewer` Subagent with Cognitive Role `challenge`, independent of the lead's provider. Give it the settled proposals, complete decision tree, evidence anchors, and advisor ledger. Ask only for omitted consequential branches, unsupported conclusions, dependency errors, and dissent lost during synthesis.

Send every material gap back through the grill, subject to the same three-round bound unless new Primary Evidence warrants another round.

**Complete when:** the closing audit finds no material gap and every consequential branch is a supported proposal or unresolved dissent.

## Return proposals for human judgment

Report each proposal as `D1`, `D2`, and so on with:

- decision;
- rationale;
- strongest alternative;
- Primary Evidence or explicit assumption;
- risk;
- dependencies; and
- unresolved dissent, if any.

Keep every proposal pending. Ask the human to reply with `accept D…`, `reject D…: reason`, or `revise D…: constraint`. When verdicts arrive, ratify accepted IDs; reopen rejected or revised IDs and every dependent proposal. Use `/domain-modeling` to record accepted domain language or qualifying architectural decisions. Implementation requires a separate request.

**Finish when:** the audit is complete and the human has a concise, fully numbered decision report to judge.
