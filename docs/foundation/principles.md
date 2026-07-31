# Pi Workbench principles

These principles govern system-wide design choices. Detailed behavior belongs to the owning document under [`../contracts/`](../contracts/); settled trade-offs and exceptions belong in the [decision record](decisions.md).

## Principles

1. Repository and task context shape Attention Allocation and the semantic work graph.
2. Working state, collaboration state, and durable project knowledge are distinct.
3. Model Context is disposable; Run state is resumable.
4. External side effects are explicit and idempotent.
5. The GUI adds interaction bandwidth without owning workflow semantics.
6. Terminal clients always have a structured fallback.
7. Human Attention is spent according to judgment leverage, operational impact, and recovery cost rather than routine workflow activity.
8. Generated state has an expiry or promotion path.
9. Trust-sensitive controls remain outside agent-generated surfaces.
10. Parallelism is bounded by dependencies, isolation, and review capacity.
11. Every run analyzes its outcome and execution, then compounds validated lessons without promoting raw agent output as knowledge.
12. Model capability, Model Effort, Continuity, and Independence are assigned by Cognitive Role and measured rather than assumed.
13. The controller owns the fixed lifecycle; the model chooses and revises the semantic work graph inside it.
14. Judgment is preserved as source-backed artifacts; implementation is evaluated against those artifacts.
15. Deliberation is represented by durable, evidence-linked episodes and one accountable synthesis.
16. The coordinator reasons about project work but never mutates a project directly.
17. Immutable events record facts; only the deterministic controller reducer defines current run state.
18. Routine execution activity remains observable without consuming model attention.
19. Every dispatch has a self-contained input contract and every result has a mechanically validated typed episode contract.
20. Fixed lifecycle gates exist only in the controller state machine rather than being duplicated as execution-graph nodes.
21. Each Pi actor receives only the context justified by its bounded work; durable references carry forward results instead of full conversation histories.
22. Human Attention brackets autonomous work and enters it conditionally when an In-Run Judgment can materially improve the outcome.
23. Acceptance is supported by a task-shaped Review Surface that joins intent, realized behavior, Primary Evidence, deviations, risks, feedback, and available actions.
24. The shortest path to decision-changing evidence takes priority over unbounded issue discovery or review activity.
25. A loop or graph is an execution shape selected for the outcome, not a workflow or maturity level in itself.
26. Human-facing state assumes interruption and context switching: it externalizes memory, distinguishes activity from action, preserves place, and explains what changed since the last judgment.
27. Attention requests pause only affected work when dependencies and authority allow independent work to continue.
28. Logical Actor identity and accountability outlive replaceable model sessions; no model context is authoritative Run state.
29. Watchers classify and reconcile routine execution mechanically; models enter only when interpretation or judgment is actionable.
30. A graphical attention surface is part of the V1 vertical slice because attention allocation, visual evidence, and concurrent work cannot be validated through terminal mechanics alone.
31. Graphical interaction is action-first and interruption-resilient by default: required judgment leads, routine activity is perceptually and structurally separate, completed outcomes are concrete, and deeper evidence remains available on demand.
