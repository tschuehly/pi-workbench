# Harness and Skills Specification

Defines the supported distribution, repository-adaptation, skill-capability, and generated-surface contracts.

This document is authoritative for this contract. [The system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries.

## Harness Distribution Repository

The harness is one cloneable Git repository containing the shared Pi package, orchestration capabilities, curated skills and bundled resources, prompts, adapters, configuration, provenance, and environment checks. Shared skills are usable without depending on a separate personal dotfiles setup.

External executables and services are represented as versioned capabilities with supported installation and health checks. Credentials, subscription state, and machine-specific configuration remain local. Target repositories contribute overlays for project-specific knowledge, commands, safety policy, and verification.

The V1 harness supports Level 1 human–Pi pairing. Its Pi package, prompts, skills, adapters, and
configuration are versioned resources; provider credentials, quota state, active sessions, and
local PI WEB configuration are not.

## Skill Capability and Interface Layer

Skills remain self-contained agent capabilities with concise instructions and bundled scripts, references, and assets. The harness gives them common ways to expose progress, decisions, artifacts, inputs, outputs, and relevant actions without requiring each skill to build a separate application.

The resolved skill set is declared per dispatch and loaded only into that Pi execution context. Capability resolution proceeds from the harness catalog through repository-approved capabilities, the Run's Working Mode, a named Execution Profile, and the Dispatch-specific Work Packet. Availability in the harness or repository does not place a skill in every model context. A subordinate Dispatch does not automatically inherit its parent's skills, permissions, or evidence.

Each resulting episode records the exact skill and adaptation versions that influenced it. Skill instructions leave active context when the episode ends unless a later dispatch resolves them again.

In V1, the one interactive Pi loads only the resources selected for the attended task. Tool output
and model claims remain ordinary session material and do not become authoritative Workstream state.

Every supported V1 skill remains executable by Pi, and every supported human interaction is available through PI WEB. Skills with meaningful human interaction may contribute focused interface definitions or sandboxed views. Those views project the same durable run state and cannot control identity, permissions, recovery, or workflow transitions independently.

Skills improve through evidence from real runs: observed friction, failed handoffs, weak judgment artifacts, missing tools, and repeated manual steps become evaluated skill or interface candidates rather than automatic standing context.

## Repository-Adapted Skills

When a skill is added, the agent separates its portable purpose and reasoning from assumptions about a particular language, framework, toolchain, or repository. It resolves the skill for the target repository using detected project evidence such as its stack, available commands, conventions, safety policy, and verification practices. A TypeScript-oriented skill can therefore retain its useful workflow while gaining JVM, Spring, Kotlin, browser, or project-specific behavior where appropriate.

The vendored source retains its provenance. Reusable stack adaptations can be shared by several repositories, repository knowledge remains with the project, and temporary refinements can remain local to a run. Real repository tasks provide the evidence for promoting an adaptation to a broader scope.

## Agent-Generated Skill Surfaces

When a skill is added or improved, a Pi worker can derive a focused interface from the skill's purpose, workflow, decisions, artifacts, progress, inputs, outputs, and human actions. A dedicated Surface Builder translates that semantic brief into a native harness experience while the coordinating agent retains task reasoning.

The generated surface is integrated into the harness UI and remains flexible during execution. The coordinating agent sends semantic changes to the Surface Builder as new artifacts, decisions, and interaction needs emerge. The surface remains a projection over the skill and durable run state and can be evaluated and promoted with the skill after real usage.

## V1 Operating Posture

Every interactive session starts in exactly one Workstream. V1 implements Level 1 from the
[Operating Levels specification](../foundation/operating-levels.md): one human pairs with one
interactive lead Pi under continuous Human Attention. The lead may launch bounded ephemeral child
Pi processes as attended tool activity and remains accountable for their assignments and results.
The harness does not launch background model turns or managed Runs.

The Workstream preserves cross-session attention but grants no workspace lease, enforced path
scope, durable Run identity, managed authority, or recovery guarantee. Model selection may resolve
the interactive lead and child processes' concrete providers, models, and Model Effort, but those
bindings do not change the Level 1 posture. Level 1 does not require an agreed execution plan before
implementation begins. Levels 2–4 have no V1 package or preset resources.

## Repository Package

The repository package is versioned with the project and declares:

- The adaptive workflow contract and quality envelope.
- Required capabilities and safety gates.
- Skills, tools, hooks, validation commands, and model roles.
- A finite set of named execution profiles resolving model requirements, effort, continuity, permissions, workspace kind, skills, independence, and episode schema.
- Rules for resolving a Run Working Mode from outcome, uncertainty, scope, risk, reversibility, available Human Attention, and repository capabilities.
- Work-packet requirements, attempt ladders, attention thresholds, and allowed non-material graph mutations.
- Alignment participants, interaction cadence, direct-experience surfaces, review responsibilities, and result-packaging requirements.
- Permission and AFK autonomy limits.
- External adapters and publication mappings.
- Supported PI WEB project surfaces.
- Artifact classes, retention periods, promotion gates, and cleanup rules.

PhotoQuest and embabel-me use the same controller lifecycle and record schemas. Their packages vary finite policy fields such as judgment depth, required challenge and independent-review profiles, evidence classes, verification commands, risk and impact ceilings, execution profiles, fallback equivalences, retry bounds, and retention rules. A repository package cannot remove invariant authority, independent verification, acceptance, publication, analysis, promotion review, or cleanup obligations.
