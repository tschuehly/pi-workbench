# Brigade Evidence Ledger

## Scope

Source-backed patterns from `jimador/brigade`, a Claude Code plugin for planning and
executing one ticket through parallel research, isolated implementation, independent
inspection, integration, human review, and retrospective analysis. Reviewed at commit
[`085781e`](https://github.com/jimador/brigade/tree/085781ea6f356368807da6cc1f89e151a7f89d35)
on 2026-07-18.

The repository's regression suite, `./test/regression.sh`, passed locally at that commit.

## Findings

### Fixed lifecycle with a work-item DAG

1. Brigade presents one fixed ticket-delivery lifecycle: intake, research, decomposition,
   execution, integration, human review, and retrospective analysis.
2. Variable implementation work is represented as a DAG of small work packets inside that
   lifecycle. Dependencies determine dispatch readiness; independent items may run in
   parallel.
3. Two workflow scripts own the mechanical control flow. One fans research questions out to
   scouts; the other handles dependency waiting, worktree creation, implementation attempts,
   inspection, escalation, serialized landing, cleanup, and circuit breaking.
4. The planner supplies judgment and decomposition, while program code owns retries,
   ordering, concurrency, and failure handling.

Sources: [README workflow](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/README.md#L49-L77),
[architecture](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/docs/architecture.md#L7-L33),
[execution workflow](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/workflows/src/brigade-execute.js).

### Small durable state and mechanical resumption

1. `PLAN.md` frontmatter carries item identifiers, statuses, dependency edges, file
   ownership, attempt history, and the delivery branch.
2. Scout briefs, cook reports, inspector verdicts, and analyst reports form a typed trail on
   disk.
3. A resumed session reads the plan and reconciles it with Git branches, worktrees, and
   reports instead of depending on conversation history.
4. `brigade-status` produces both compact text and structured JSON without a model turn.

Sources: [state and artifact layout](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/docs/architecture.md#L65-L98),
[`brigade-status`](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/bin/brigade-status).

### Typed artifact registry

1. Every model-produced document has a versioned type, a machine-readable YAML envelope,
   fixed human-readable sections, a length budget, and a producer and consumer.
2. Each artifact type defines acceptable authority. Code claims cite repository locations;
   external claims cite URLs; verification evidence is verbatim command output.
3. A claim without a source is opinion rather than verified fact.
4. `brigade-validate` checks envelopes, enum values, required sections, length budgets, DAG
   references, duplicate identifiers, and type-specific constraints without a model turn.
5. Malformed worker output is rejected or retried rather than interpreted leniently.

Sources: [artifact schemas](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/skills/brigade/SCHEMAS.md),
[`brigade-validate`](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/bin/brigade-validate).

### Reports do not carry execution authority

1. Scouts, cooks, inspectors, and analysts return bounded reports and stop.
2. A report may contain findings or recommendations, but it does not direct the next
   transition.
3. The planner interprets reports and chooses the next semantic action; the workflow script
   enforces the permitted mechanical sequence.
4. The inspector treats the cook report as a claim and independently checks the actual diff
   and verification commands.

Sources: [role contract](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/docs/architecture.md#L35-L59),
[verdict authority](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/skills/brigade/SCHEMAS.md#L190-L209).

### Self-contained work packets

1. Each implementation worker receives one bounded packet containing its goal, named files,
   source-backed contracts, current behavior anchors, steps, acceptance criteria,
   conventions, hazards, verification commands, and out-of-scope work.
2. Same-wave packets must not overlap files. Real overlap becomes a dependency edge.
3. Shared contracts own their required consumer changes and precede dependent packets.
4. Packet size and scope are constrained so a cheaper worker can execute without broad
   repository exploration.

Sources: [packet schema](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/skills/brigade/SCHEMAS.md#L101-L111),
[Brigade skill](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/skills/brigade/SKILL.md).

### Bounded failure and integration

1. Each item has a finite implementation and inspection ladder. A failed inspection feeds
   structured findings into the next attempt.
2. Repeated failures trip a circuit breaker and stop further work because the plan premises
   may be invalid.
3. Implementation happens in isolated worktrees. Successful items are rebased and
   fast-forwarded onto one delivery branch.
4. Landing is serialized because the delivery branch is one moving integration target.
5. Contamination, failed ancestry checks, and unresolved landing failures preserve the
   branch and worktree for investigation.

Sources: [execution ladder and circuit breaker](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/workflows/src/brigade-execute.js),
[Git model](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/docs/architecture.md#L100-L118).

### Human-attention and cost discipline

1. The normal delivery path asks the human to approve the decomposition and review the final
   pull request.
2. Ambiguous work becomes a decision-ready question instead of an invented value.
3. Model strength is routed by role and task difficulty. Mechanical state inspection,
   configuration resolution, and schema validation use ordinary programs rather than model
   turns.
4. Independent plan derivation is available before implementation to reduce anchoring on the
   planner's decomposition.

Sources: [operator responsibilities](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/README.md#L5-L45),
[service tiers](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/docs/tiers.md).

### Evidence-backed improvement

1. An analyst reads the artifacts produced by a completed dish and emits a scorecard plus a
   small number of evidence-backed proposals.
2. Repository-local lessons remain local. Generalizable heuristics require operator
   approval before entering broader knowledge.
3. Installed workflow instructions do not edit themselves. A separate reviewed source
   change is required to alter the shared workflow.

Sources: [analyst schema](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/skills/brigade/SCHEMAS.md#L225-L244),
[self-improvement workflow](https://github.com/jimador/brigade/blob/085781ea6f356368807da6cc1f89e151a7f89d35/skills/brigade/SKILL.md).

## Transferable Patterns

- Keep the invariant lifecycle in deterministic code and represent only variable semantic
  work as a DAG.
- Give each model dispatch a self-contained input contract and a typed output contract.
- Treat model output as evidence-bearing information, never transition authority.
- Define authority, provenance, evidence requirements, and size budgets per artifact type.
- Provide mechanical status, validation, and environment-health projections.
- Bound retries and convert repeated failure into one actionable pause.
- Isolate mutation, serialize integration, and retain unresolved workspaces fail-closed.
- Spend human attention on consequential judgment rather than routine progress.
- Promote learning from run evidence through an explicit review path.

## Limits for Pi Workbench

- Brigade is a Claude Code plugin; Pi Workbench uses Pi as its only model runtime.
- Brigade's mutable `PLAN.md` is sufficient for its session workflow but does not provide
  the controller-owned, append-only authority and correction semantics required by Pi
  Workbench.
- Brigade delegates exact Git operations to a model-backed steward. Pi Workbench requires
  deterministic controller-owned workspace mutation.
- Brigade plans once. Pi Workbench permits revisioned non-material graph changes as evidence
  arrives.
- Brigade's file-count, changed-line, and model-tier rules optimize cheap parallel coding;
  they are repository heuristics rather than universal quality requirements.
- Brigade's layered personal and repository configuration exceeds the initial Pi Workbench
  workflow scope, which uses a statically resolved repository package and finite named
  execution profiles.
- Brigade does not provide Pi Workbench's durable attention, explicit authority promotion,
  idempotent external publication, canonical controller reducer, or knowledge-retention
  lifecycle.

## Confidence

- Repository documentation, scripts, schemas, and regression behavior agree on the central
  workflow patterns; confidence is high.
- The local regression suite validates internal operational contracts but is not evidence of
  production use across different repositories or models.
- The transfer recommendations are Pi Workbench design judgments derived from Brigade's
  implementation, not claims made by Brigade.
