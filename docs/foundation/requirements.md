# Pi Workbench requirements and validation

This document preserves the product outcomes and system-level validation matrix. The [system overview](system-overview.md) explains the architecture; the documents under [`../contracts/`](../contracts/) define supported behavior.

## User outcomes

1. As a run owner, I want to start one explicit workflow, so that its behavior is understandable and reproducible.
2. As a terminal user, I want to operate the same run as GUI users, so that the workflow is not tied to one interface.
3. As a GUI user, I want a focused review surface, so that I can judge the workflow's output efficiently.
4. As a developer, I want local working state to survive agent context resets, so that the run remains resumable.
5. As a developer, I want external updates to be explicit, so that collaboration systems do not accidentally advance execution.
6. As an interactive operator, I want detailed progress and inline decisions, so that I can steer actively.
7. As an AFK operator, I want bounded autonomy and durable pauses, so that unattended work never invents missing authority.
8. As a reviewer, I want evidence assembled around the current decision, so that I can judge behavior rather than reconstruct the run.
9. As a workflow owner, I want role-specific models and permissions, so that workers receive only the capabilities they need.
10. As a developer, I want stale inputs detected before resumption, so that the agent does not continue from invalid assumptions.
11. As a developer, I want a portable handoff snapshot, so that another machine or teammate can resume the work deliberately.
12. As a repository owner, I want retention rules for workflow artifacts, so that useful evidence survives without keeping every trace.
13. As a repository owner, I want promotion gates for reusable knowledge, so that generated garbage does not become standing context.
14. As an auditor, I want provenance and hashes for retained artifacts, so that claims can be traced to their sources.
15. As a developer, I want cleanup previews and protected pins, so that automatic collection cannot remove required evidence.
16. As a workflow owner, I want each run analyzed from structured events and evidence, so that orchestration failures and wasted effort become visible.
17. As a repository owner, I want validated lessons proposed at the narrowest useful scope, so that the system improves without polluting standing context.
18. As a workflow owner, I want model routing evaluated by role-level quality and resource evidence, so that social heuristics do not become permanent policy without validation.
19. As a run owner, I want the model to construct and revise the work graph inside explicit quality and authority constraints, so that simple tasks remain simple and difficult tasks receive appropriate rigor.
20. As a decision maker, I want Shared Understanding of the problem, language, assumptions, options, disagreements, trade-offs, and success evidence before execution, so that autonomous work does not prematurely settle the direction.
21. As a reviewer, I want the realized system, evidence, deviations, and residual risks assembled in a task-shaped Review Surface with precise feedback actions, so that I can judge consequences rather than reconstruct the run or only inspect a diff.
22. As an agent coordinator, I want specialists to produce linked claim, challenge, and response episodes, so that synthesis benefits from genuine disagreement without relying on hidden transcripts or peer mailboxes.
23. As a developer, I want to clone one harness repository and obtain its supported Pi skills and tool capabilities, so that the workflow does not depend on reconstructing a personal setup.
24. As a skill author, I want a stable harness interface for progress, decisions, artifacts, and user input, so that a skill can provide a focused experience without becoming tied to one client.
25. As a terminal user, I want every enhanced skill to retain a complete headless path, so that richer interfaces never become a prerequisite for using the workflow.
26. As a skill user, I want the agent to generate a focused native interface when I add a skill, so that the skill becomes understandable and interactive without manual frontend development.
27. As a skill author, I want successful generated surfaces to graduate with the skill, so that other users receive the proven interaction model when they clone the harness.
28. As a developer, I want an imported skill adapted to my repository's stack, tools, conventions, and verification practices, so that its workflow is useful without carrying irrelevant assumptions from its source project.
29. As a skill maintainer, I want repository adaptations to preserve upstream provenance and reusable behavior, so that project customization does not create opaque, unmaintainable forks.
30. As a run owner, I want investigations to be unable to become implementations without separate authority, so that a recommendation never silently expands into project mutation.
31. As an AFK operator, I want routine progress classified without a model turn and actionable conditions durably queued, so that unattended supervision is efficient without losing decisions or failures.
32. As a client developer, I want one canonical current-state snapshot, so that terminal and graphical views cannot disagree by interpreting event history differently.
33. As a repository owner, I want project work to remain leased until its delivery, report, evidence, or explicit discard obligation is satisfied, so that cleanup cannot erase unresolved work.
34. As a worker, I want one self-contained work packet and typed episode contract, so that execution does not depend on hidden conversation context.
35. As an operator, I want mechanical status, validation, and environment checks, so that routine inspection consumes no model attention.
36. As a workflow maintainer, I want fixed lifecycle gates represented once, so that the controller state machine and semantic work graph cannot disagree about authority or closure.
37. As a run owner, I want repeated failure to become one durable attention item, so that autonomous execution stops instead of retrying a false premise indefinitely.
38. As a portfolio owner, I want one attention view across projects, so that I can allocate judgment without juggling agent chats and tabs.
39. As a project owner, I want several independent Runs to progress concurrently, so that one pending judgment does not stop unrelated authorized work.
40. As an interruptible reviewer, I want the Workbench to preserve my place and show what changed since my previous judgment, so that resumption does not depend on working memory.
41. As a decision maker, I want experimental results compared against predeclared criteria in a progressive Review Surface, so that I can judge the next direction without reading Worker reports or logs.
42. As a Broker, I want a typed protocol for proposals, guidance, control, attention, and prepared review, so that cooperation does not depend on prompt obedience or shared chat history.
43. As a long-lived Logical Actor, I want my model session to be replaceable from a source-backed Continuation Artifact, so that continuity does not require retaining an increasingly stale context window.
44. As a repository owner, I want installed capabilities resolved into only the Dispatches that need them, so that global skill availability does not pollute every Worker context or expand authority.
45. As a new Pi user, I want an explicit numbered Entry Preset, so that I can begin with fast interactive work and adopt deeper delegation gradually.
46. As an interactive operator, I want the shell to distinguish unmanaged Pi workflows from managed Runs, so that convenience orchestration is never mistaken for enforced authority or recovery.
47. As a PI WEB user, I want Level selection in a first-class primary view, so that the adoption posture is visible and understandable rather than hidden in prompts or a narrow side panel.

## Validation matrix

- Test the highest common seam: a workflow contract executed through terminal commands and projected as structured events.
- Replay terminal commands and emitted events and assert equivalent durable ledger transitions.
- Verify deterministic state transitions independently from model output.
- Exercise `start`, `submit`, `inspect`, and `watch` through terminal and graphical test adapters; assert identical Run Controller semantics.
- Run several independent Runs under one Project Broker; assert that their lifecycle, authority, evidence, and control leases remain separate while project attention and conflicts are reconciled.
- Submit stale, unauthorized, and duplicate Broker protocol operations; assert revision checks, idempotent receipts, and deterministic refusal without prompt interpretation.
- Rebuild a fresh coordinator solely from `snapshot.json`, `records.jsonl`, and referenced objects.
- Rotate Broker, Coordinator, and Worker sessions at synchronization points; assert reconstruction from validated Continuation Artifacts without transcript dependence or loss of required disagreement, authority, evidence, uncertainty, or attention.
- Validate valid and invalid commands, records, dispatches, episodes, attention items, dossier revisions, and receipts through the shared schema registry.
- Attempt to represent an invariant lifecycle gate as a semantic graph node; assert deterministic rejection.
- Feed stale, contradictory, missing, and prose-only observations into reconciliation; assert that the canonical snapshot reports `unknown` rather than reviving an old event or trusting a model claim.
- Project the same run through terminal, attention-inbox, AFK-digest, and graphical-view fixtures; assert identical current-state semantics.
- Resume the graphical client after unrelated and affected work changes; assert preserved focus, accurate change summaries, stale-feedback marking, and current evidence ordering.
- Open every fixture Attention Item from the portfolio surface; assert that required judgment, materiality, recommendation, consequences, deferral behavior, affected work, and available actions are discoverable without reading logs or chat.
- Project routine progress beside pending attention; assert that autonomous activity remains visible but cannot compete with or be mistaken for required owner action.
- Crash or replace the coordinator after an actionable source event is observed; assert that its persisted attention item survives and the source event is not acknowledged first.
- Emit routine progress, duplicate lifecycle events, and unchanged observations; assert that they remain observable without launching a coordinator turn.
- Attempt concurrent control-lease acquisition and mutation from a read-only client; assert a single mutation owner and deterministic refusal.
- Generate valid and invalid graph mutations and assert deterministic validation, recorded rejection reasons, and repair without corrupting accepted graph revisions.
- Property-test dependency cycles, missing evidence obligations, lease conflicts, authority escalation, budget overflow, and attempts at author self-approval.
- Test delayed, duplicated, stale-revision, and budget-exhausting dispatches and episode returns; assert deterministic acceptance and bounded termination.
- Attempt to base synthesis and graph transitions on raw tactical chatter; assert that the controller requires a durable episode or artifact reference.
- Resume a worker from referenced episodes without copying another worker's transcript; assert that claims, evidence status, skills, and continuation provenance survive.
- Seed deliberations with unsupported consensus, unresolved conflicts, and contradicted evidence; assert that synthesis exposes them rather than silently flattening them.
- Contract-test repository packages, event schemas, snapshots, handoffs, external adapters, and surface capability negotiation.
- Test idempotent publication and conflict reconciliation against external-system fakes.
- Test interactive-to-AFK mode switching on the same run identifier.
- Test coordinator-session replacement from the canonical snapshot, semantic records, and referenced objects while the controller host remains alive.
- Contract-test coordinator, resumable-worker, and ephemeral-subagent lifecycles with different Pi models.
- Attempt project mutation from the coordinator and delivery from a scout dispatch; assert that the coordinator cannot acquire a project-workspace write lease and the scout cannot publish or convert scratch changes without promotion.
- Promote a completed scout to ship; assert preserved evidence lineage, explicit authority, clean mutation scope, and no duplicate graph work item.
- Attempt to release dirty, unlanded, unreported, and evidence-incomplete workspaces; assert that leases remain held until delivery, authorized discard, or sealed scout completion.
- Exhaust each configured attempt ladder and review-failure threshold; assert one deduplicated attention item and no further affected dispatch.
- Attempt to submit a dispatch with missing source-backed inputs, invented capabilities, an unrecognized profile, or an incompatible episode schema; assert deterministic rejection.
- Mutate an allowed file after a green validation result; assert that the workspace fingerprint changes, the evidence becomes stale, and landing is rejected until the candidate is revalidated.
- Add, delete, rename, stage, and leave untracked paths outside a Ship Work Packet's declared scope; assert deterministic detection before review and before landing.
- Resume an in-flight Ship Dispatch with matching and mismatching lease, base revision, graph revision, packet hash, scope hash, and workspace fingerprint; assert continuation only for the fully reconciled case.
- Submit a Ship Episode without a complete mutation receipt or with an interface-contract claim unsupported by landed source; assert rejection or an unverified claim rather than silent promotion.
- Exhaust the PhotoQuest Ship profile's three-attempt correction ladder; assert one deduplicated Attention Item, preservation of the candidate diff and failure evidence, and no model takeover or landing.
- Prove that no workflow transition depends on Claude Code, Codex CLI or app-server, or CLI-proxy state.
- Test staleness detection by changing each revision or hash input independently.
- Test cleanup with mark-and-sweep fixtures, pinned evidence, policy holds, orphaned blobs, and promotion gates.
- Seed runs with known retries, ineffective reviews, stale guidance, and useful corrections; assert that analysis metrics and compounding candidates preserve provenance and scope.
- Prove that raw transcripts and model self-assessments cannot become active knowledge without a recorded promotion transition.
- Simulate provider cache support, cache misses, model unavailability, and quota pressure; assert that routing preserves role capabilities and records the reason for every fallback.
- Security-test sandbox isolation and prove project surfaces cannot alter shell-owned controls.
- Use repository-specific acceptance suites for policy examples, including browser-visible PhotoQuest behavior.
