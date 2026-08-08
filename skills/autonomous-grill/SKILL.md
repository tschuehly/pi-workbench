---
name: autonomous-grill
description: Autonomous cross-model grilling with a concise decision report for human review.
disable-model-invocation: true
---

# Autonomous Grill

Stress-test consequential decisions autonomously, then return every proposal to the human for judgment. Use a Level 1 durable attended worker for recurring advice and a fresh `subagent` for the cross-family closing audit. Apply `/domain-modeling` only to outcomes the human accepts.

## Establish the decision tree

Distill the target, Primary Evidence, constraints, assumptions, and unresolved decisions. Build an opening decision tree: each consequential decision branches into the decisions that depend on it. Resolve discoverable facts from repository files, supplied documents, and tools rather than asking the human.

Draft a recommendation for every currently reachable branch. The lead owns synthesis and remains accountable for the final report.

**Complete when:** every known consequential branch is represented, and every recommendation distinguishes evidence from assumption.

## Run the grill

Use `worker_status` to find an active worker already bound to the current repository root and exact grill scope after a session restart. Resume that worker when present; otherwise use `worker_create` to create one named for the grill, with the exact target as its semantic scope and the `planner` profile. Use Cognitive Role `design` for every advisor dispatch: it is the consequential-design role available to workers, while the Independence roles (`challenge`, `independent-judgment`, and `independent-review`) correctly fail worker preflight because resumed context is anchored by prior rounds.

This trades Independence for continuity. The worker retains the decision tree, challenge style, prior responses, and dissent in its persisted Pi session, but its advice is neither fresh-context judgment nor guaranteed cross-family review. Never describe worker output as independent. The fresh closing audit restores Independence from the lead's provider.

Work one consequential decision at a time in dependency order:

1. Use `worker_status` to confirm the advisor is idle, resumable, and still useful. A worker runs one dispatch at a time. Reconcile any active dispatch; after `outcome_unknown`, inspect the worker and set `acknowledgeInspection: true` only on the next justified dispatch.
2. Use `worker_dispatch` with Cognitive Role `design`. Keep the assignment self-contained: give the current decision, prerequisites and dependents, proposal, evidence anchors, constraints, and expected prioritized findings. Ask the worker to challenge assumptions, alternatives, evidence, contradictions, dependencies, and missing branches.
3. Reconcile the result. Revise the proposal, investigate factual gaps, and preserve unresolved dissent in the proposals. Dispatch another round only when the challenge or new evidence materially changes the proposal. Stop after three rounds unless new Primary Evidence changes the decision tree.

Do not maintain a round-to-round advisor ledger; the worker session supplies that continuity. If the usage proxy reported by `worker_status` leads you to judge the context degraded, retire that worker, create a replacement in the same scope, and disclose the continuity reset; the replacement still receives a self-contained current assignment. After `outcome_unknown`, allow one justified dispatch with `acknowledgeInspection: true` after inspection; stop on a repeated unknown outcome or any other creation, dispatch, or continuation failure. Disclose the continuity failure rather than presenting the lead's own review as worker advice.

**Complete when:** no returned material challenge remains unanswered, revised, or explicitly recorded as dissent.

## Audit completeness

Prepare one compact **closing-audit dissent summary** containing unresolved dissent, strongest rejected alternatives, material proposal revisions, and evidence changes. This is a bounded handoff refreshed only for a new fresh auditor, not a worker-continuation ledger or authoritative state.

Launch a fresh `reviewer` Subagent with Cognitive Role `challenge`, independent of the lead's provider. Give it the settled proposals, complete decision tree, evidence anchors, and closing-audit dissent summary. Ask only for omitted consequential branches, unsupported conclusions, dependency errors, and dissent lost during synthesis. This restores fresh-context, cross-family Independence from the lead. With an Anthropic lead, current policy binds both the `design` worker and closing auditor to `openai-codex/gpt-5.6-sol` at `xhigh`; the audit is then context-fresh and independent from the lead, but not model-independent from the worker.

Send every material gap back to the current advisor worker through a self-contained `design` dispatch, refresh the closing-audit dissent summary, and launch another fresh auditor. Count that dispatch against the affected decision's three-round bound; when the bound is exhausted, preserve the gap as dissent unless new Primary Evidence warrants another round. Stop after three closing audits unless new Primary Evidence warrants another.

If cross-family routing or a closing-audit Subagent fails to launch or complete, disclose the failed independent audit and stop instead of substituting the lead's own review or reporting the grill as audited.

When the audit finds no material gap—or the grill must stop—reconcile any active dispatch, inspect each advisor worker, and call `worker_retire` with the terminal or replacement reason. Retirement is immutable; do it only after that worker's final dispatch has ended.

**Complete when:** the closing audit finds no material gap, every consequential branch is a supported proposal or unresolved dissent, and every advisor worker created for the grill is retired.

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
