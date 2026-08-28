---
name: autonomous-grill
description: Autonomous cross-model grilling in frontier rounds, then a human walk of the design tree for verdicts.
disable-model-invocation: true
---

# Autonomous Grill

Stress-test consequential decisions autonomously, then walk the human through the resulting design tree for verdicts. Frontload the cognitive work: models grill whole frontiers in batched rounds so human attention is spent only on judging settled, evidence-backed proposals. Use a session-owned durable attended worker for recurring advice and a fresh `subagent` for the cross-family closing audit. Apply `/domain-modeling` only to outcomes the human accepts.

## Establish the decision tree

Distill the target, Primary Evidence, constraints, assumptions, and unresolved decisions. Build an opening decision tree: each consequential decision branches into the decisions that depend on it. The **frontier** is every decision whose prerequisites are already settled — the decisions grillable now without guessing at answers still open. Resolve discoverable facts from repository files, supplied documents, and tools rather than asking the human.

Draft a recommendation for every currently reachable branch. The lead owns synthesis and remains accountable for the final report.

**Complete when:** every known consequential branch is represented, and every recommendation distinguishes evidence from assumption.

## Run the grill

Run the grill in one persisted lead Pi session. After a reload or process restart, resume that same lead session and use `worker_status` to find its active worker for the exact grill scope. A fork or new lead session cannot mutate the source session's worker; start a new advisor there instead. When no current-session worker exists, use `worker_create` to create one named for the grill, with the exact target as its semantic scope and the `planner` profile. Use Cognitive Role `design` for every advisor dispatch: it is the consequential-design role available to workers, while the Independence roles (`challenge`, `independent-judgment`, and `independent-review`) correctly fail worker preflight because resumed context is anchored by prior rounds.

This trades Independence for continuity. The worker retains the decision tree, challenge style, prior responses, and dissent in its persisted Pi session, but its advice is neither fresh-context judgment nor guaranteed cross-family review. Never describe worker output as independent. The fresh closing audit restores Independence from the lead's provider.

Work the tree in autonomous frontier rounds — one dispatch grills the whole current frontier:

1. Use `worker_status` to confirm the advisor is idle, resumable, and still useful. A worker runs one dispatch at a time. Reconcile any active dispatch; after `outcome_unknown`, inspect the worker and set `acknowledgeInspection: true` only on the next justified dispatch.
2. Use `worker_dispatch` with Cognitive Role `design`, written with `/writing-for-agents`. Keep the assignment self-contained: number every frontier decision and give each its proposal, prerequisites and dependents, evidence anchors, and constraints. Ask for prioritized findings per numbered decision challenging assumptions, alternatives, evidence, contradictions, dependencies, and missing branches.
3. Reconcile the round. Revise proposals, investigate factual gaps, and preserve unresolved dissent in the proposals. Settled decisions push the frontier outward and unblock their dependents; recompute the frontier and dispatch the next round. Return a decision to a later round only when the challenge or new evidence materially changes its proposal; a decision appears in at most three rounds unless new Primary Evidence changes the decision tree.

When a frontier decision needs a discoverable fact, resolve it with tools or a fresh `subagent` rather than the human. A running exploration is an unsettled prerequisite: only the decisions downstream of it wait — grill the rest of the frontier now.

Do not maintain a round-to-round advisor ledger; the worker session supplies that continuity. If the usage proxy reported by `worker_status` leads you to judge the context degraded, retire that worker, create a replacement in the same scope, and disclose the continuity reset; the replacement still receives a self-contained current assignment. After `outcome_unknown`, allow one justified dispatch with `acknowledgeInspection: true` after inspection; stop on a repeated unknown outcome or any other creation, dispatch, or continuation failure. Disclose the continuity failure rather than presenting the lead's own review as worker advice.

**Complete when:** no returned material challenge remains unanswered, revised, or explicitly recorded as dissent.

## Audit completeness

Prepare one compact **closing-audit dissent summary** containing unresolved dissent, strongest rejected alternatives, material proposal revisions, and evidence changes. This is a bounded handoff refreshed only for a new fresh auditor, not a worker-continuation ledger or authoritative state.

Launch a fresh `reviewer` Subagent with Cognitive Role `challenge`, independent of the lead's provider, with a brief written with `/writing-for-agents`. Give it the settled proposals, complete decision tree, evidence anchors, and closing-audit dissent summary. Ask only for omitted consequential branches, unsupported conclusions, dependency errors, and dissent lost during synthesis. This restores fresh-context, cross-family Independence from the lead. With an Anthropic lead, current policy binds both the `design` worker and closing auditor to `openai-codex/gpt-5.6-sol` at `xhigh`; the audit is then context-fresh and independent from the lead, but not model-independent from the worker.

Send the material gaps back to the current advisor worker as one self-contained `design` round over the affected decisions, refresh the closing-audit dissent summary, and launch another fresh auditor. Count that round against each affected decision's three-round bound; when a bound is exhausted, preserve that gap as dissent unless new Primary Evidence warrants another round. Stop after three closing audits unless new Primary Evidence warrants another.

If cross-family routing or a closing-audit Subagent fails to launch or complete, disclose the failed independent audit and stop instead of substituting the lead's own review or reporting the grill as audited.

When the audit finds no material gap—or the grill must stop—reconcile any active dispatch, inspect each advisor worker, and call `worker_retire` with the terminal or replacement reason. Retirement is immutable; do it only after that worker's final dispatch has ended.

**Complete when:** the closing audit finds no material gap, every consequential branch is a supported proposal or unresolved dissent, and every advisor worker created by the current lead session for the grill is retired.

## Walk the human through the design tree

Human attention starts here, after the audit. Write everything in this phase with `/write-for-humans`: the autonomous grill exists to make each verdict cheap, so lead every proposal with the decision and make confirmation the lowest-effort reply.

Walk the tree with the human in frontier rounds, mirroring the autonomous rounds: present the current frontier — every decision whose prerequisites the human has settled — then wait for verdicts before the next round. Present each frontier decision under a stable id — `D1`, `D2`, and so on, assigned once and kept across rounds — with:

- decision and recommendation;
- rationale grounded in the grill: strongest alternative and why it lost, Primary Evidence or explicit assumption, risk, dependencies; and
- unresolved dissent, if any.

Keep every proposal pending until its verdict arrives. Ask the human to reply per decision with `accept D…`, `reject D…: reason`, or `revise D…: constraint`. Verdicts reshape the tree exactly as settled decisions did autonomously: accepted decisions push the frontier outward and unblock their dependents; a rejected or revised decision reopens its dependents, and its next-round proposal draws on the grill's recorded alternatives and dissent. Recompute the frontier and present the next round. Use `/domain-modeling` to record accepted domain language or qualifying architectural decisions. Implementation requires a separate request.

**Finish when:** the audit is complete and the human-walked frontier is empty — every consequential decision carries a human verdict, nothing left silently assumed.
