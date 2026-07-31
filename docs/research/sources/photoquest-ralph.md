# PhotoQuest Ralph Evidence Ledger

## Scope

Read-only inspection of PhotoQuest's Kotlin Ralph engine and the jOOQ knowledge-building loop on 2026-07-15.

## Observed Workflow Engine

1. The feature workspace contains product, technical, base, package, slice, review, handoff, and compound artifacts.
   - Source: [Ralph README](/Users/tschuehly/IdeaProjects/PhotoQuest/ralph/README.md)
2. `package-spec.md` is both human-readable package definition and mutable workflow status. It carries approvals, dependencies, modes, and package or slice status.
   - Source: [artifact models](/Users/tschuehly/IdeaProjects/PhotoQuest/ralph/engine/src/main/kotlin/ralph/engine/model/ArtifactModels.kt)
3. Planned slices persist a contract and a hash-bearing handoff receipt before execution.
4. Slice execution runs planner, executor, reviewer, bounded remediation, optional human-review extraction, and closure checks.
   - Source: [RunSliceRunner](/Users/tschuehly/IdeaProjects/PhotoQuest/ralph/engine/src/main/kotlin/ralph/engine/phases/RunSliceRunner.kt)
5. Package execution runs remaining slices, independent review stages, generated fix slices, and a compound stage.
   - Source: [RunPackageRunner](/Users/tschuehly/IdeaProjects/PhotoQuest/ralph/engine/src/main/kotlin/ralph/engine/phases/RunPackageRunner.kt)
6. Reviews persist findings, reviewed commit, full or delta mode, open identifiers, touched paths, changed tests, degraded phases, and remediation history.
   - Source: [ReviewLifecycle](/Users/tschuehly/IdeaProjects/PhotoQuest/ralph/engine/src/main/kotlin/ralph/engine/phases/ReviewLifecycle.kt)
7. Each phase attempt snapshots its prompt, log, and output beneath a history directory.
   - Source: [PhaseArtifacts](/Users/tschuehly/IdeaProjects/PhotoQuest/ralph/engine/src/main/kotlin/ralph/engine/phases/PhaseArtifacts.kt)
8. Resume points are selected explicitly from the CLI. The runner does not infer a safe resume point from a general event ledger.
9. Git commits are required checkpoints for completed execution and remediation.
10. The human-review artifact is heuristically extracted from agent trace phrases. It is useful as a convenience view but too lossy to be authoritative state.

## Interactive and AFK Reference

The jOOQ skill creator uses one article as its work unit. Its JSONL `processed` flag is the progress tracker. One script streams a watched iteration; another runs a capped unattended loop and commits each iteration.

- [jOOQ loop README](/Users/tschuehly/IdeaProjects/PhotoQuest/scripts/ralph/jooq-skill-creator/README.md)
- [interactive iteration](/Users/tschuehly/IdeaProjects/PhotoQuest/scripts/ralph/jooq-skill-creator/ralph-jooq-once.sh)
- [AFK loop](/Users/tschuehly/IdeaProjects/PhotoQuest/scripts/ralph/jooq-skill-creator/afk-ralph-jooq.sh)

## Knowledge Compounding Reference

PhotoQuest's compound skill reviews decisions, user corrections, discovered patterns, stale content, and new workflows. It routes each learning to the narrowest durable destination and requires a proposed change set before applying updates.

- [Compound skill](/Users/tschuehly/IdeaProjects/PhotoQuest/.claude/skills/compound/SKILL.md)

## Strengths to Preserve

- Repository-local, inspectable working state.
- Explicit approval and dependency gates.
- Fresh agent phases with durable artifacts between them.
- Typed review findings and bounded remediation.
- Git-backed checkpoints.
- Watched and AFK modes over the same work unit.

## Constraints and Risks

- Mutable execution status is mixed into specification artifacts.
- Attempt history grows without a retention policy.
- Resume safety partly depends on an operator selecting the correct phase.
- The repository has no active `docs/dev/packages/*/package-spec.md` workspaces; the tracked smoke workspace is the available example.
- The public README contains absolute references to an Orchestrator worktree, so those links are not portable project contracts.
- The jOOQ AFK script uses broad permissions and commits automatically; repository policy must bound this behavior.

## Implications

- Separate immutable task intent from mutable run state.
- Preserve typed review and remediation records as first-class events and artifacts.
- Infer or validate resume points from state and revisions.
- Make interactive and AFK clients projections of one run.
- Add promotion, sealing, and garbage collection to the run lifecycle.
- Analyze outcome and orchestration evidence before compounding, and keep extracted learnings as candidates until their destination, scope, and validation are accepted.
