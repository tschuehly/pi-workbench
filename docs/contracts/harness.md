# Harness and Skills Specification

The harness packages everything needed for attended human–Pi work while keeping credentials, sessions, and machine-specific state local. This contract defines harness distribution, repository adaptation, skill capabilities, generated surfaces, and the V1 operating posture.

This document is authoritative for this contract. [The system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries.

## V1 Operating Posture

V1 supports attended human–Pi pairing. One human pairs with one interactive lead Pi under continuous Human Attention. The session may remain a standalone Chat or have exactly one home Workstream.

The lead may launch bounded ephemeral child Pi processes as attended tool activity and remains accountable for their assignments and results. A child may run non-blocking only inside the attended lead session and is cancelled when the session shuts down. The harness launches no unattended execution that survives the session and no managed Runs.

A Workstream preserves cross-session attention but grants no workspace lease, enforced path scope, durable Run identity, managed authority, or recovery guarantee. Attended-session hosts coordinate Workstream association through the shared host-neutral session-coordination module rather than embedding lifecycle logic in a skill or interface adapter.

Model selection may resolve concrete providers, models, and Model Effort for the interactive lead and child processes. Those bindings do not change the attended posture.

The intended [Working Mode](../foundation/working-mode.md) has no implemented selector, persistent presentation, or mutation gate. Current sessions may state its prompt-guided contracts in conversation. Any later harness control must:

- start a new context in Vibe without a setup gate;
- keep Alignment and Checking independent;
- present an active owner choice truthfully without implying mechanical enforcement; and
- leave Human Attention, delegation, authority, durability, and workspace protection outside Working Mode.

Restoring a prior choice, forcing an initial read-only phase, filtering tools, and applying a blanket mutation gate are outside the current design. A later control earns state or enforcement only from observed need and explicit owner approval.

## Harness Distribution Repository

The harness is one cloneable Git repository. It contains the shared Pi package, orchestration capabilities, curated skills and bundled resources, prompts, adapters, configuration, provenance, and environment checks. Shared skills must work without a separate personal dotfiles setup.

The Pi package, prompts, skills, adapters, and configuration are versioned resources. Provider credentials, quota state, active sessions, and local PI WEB configuration are not.

External executables and services are represented as versioned capabilities with supported installation and health checks. Credentials, subscription state, and machine-specific configuration remain local. Target repositories provide overlays for project-specific knowledge, commands, safety policy, and verification.

Runtime routing and the interactive startup check share a machine-local quota snapshot for ten minutes, including unavailable telemetry. Repeated child launches do not query provider endpoints again within that window. The startup check may inspect local Claude quota telemetry and offer attended sign-in or macOS Keychain repair when needed. It never:

- stores credentials;
- prompts in non-interactive modes; or
- treats telemetry failure as provider authority or a reason to block a child launch.

## Skill Capability and Interface Layer

Skills are self-contained agent capabilities with concise instructions and bundled scripts, references, and assets. The harness gives skills common ways to expose progress, decisions, artifacts, inputs, outputs, and relevant actions; each skill does not need a separate application.

The resolved skill set is declared per Dispatch and loaded only into that Pi execution context. Capability resolution proceeds through:

1. the harness catalog;
2. repository-approved capabilities;
3. the Run's Working Mode;
4. a named Execution Profile; and
5. the Dispatch-specific Work Packet.

Availability in the harness or repository does not put a skill in every Model Context. A subordinate Dispatch does not automatically inherit its parent's skills, permissions, or evidence.

Each resulting Episode records the exact versions of the skills and adaptations that influenced it. Skill instructions leave active context when the Episode ends unless a later Dispatch resolves them again.

In V1, the one interactive Pi loads only the resources selected for the attended task. Tool output and model claims remain ordinary session material; they do not become authoritative Workstream state.

Every supported V1 skill remains executable by Pi. Human interactions become available through delivered Workbench client slices. The terminal remains the fallback for capabilities that are not yet graphical.

Skills with meaningful human interaction may contribute focused interface definitions or sandboxed views. These views project the same durable Run state and cannot independently control identity, permissions, recovery, or workflow transitions.

Skills improve through evidence from real Runs. Observed friction, failed handoffs, weak judgment artifacts, missing tools, and repeated manual steps become evaluated candidates for skills or interfaces rather than automatic standing context.

## Repository-Adapted Skills

When adding a skill, the agent separates its portable purpose and reasoning from assumptions about a particular language, framework, toolchain, or repository. The agent resolves the skill for the target repository from detected project evidence, including its stack, available commands, conventions, safety policy, and verification practices.

For example, a TypeScript-oriented skill can retain its useful workflow while gaining JVM, Spring, Kotlin, browser, or project-specific behavior where appropriate.

The vendored source retains its provenance. Reusable stack adaptations may be shared across repositories, repository knowledge stays with the project, and temporary refinements may remain local to a Run. Evidence from real repository tasks determines whether an adaptation is promoted to a broader scope.

## Agent-Generated Skill Surfaces

When a skill is added or improved, a Pi Worker can derive a focused interface from the skill's purpose, workflow, decisions, artifacts, progress, inputs, outputs, and human actions. A dedicated Surface Builder translates that semantic brief into a native harness experience; the coordinating agent retains task reasoning.

The generated surface is integrated into the harness UI and remains flexible during execution. As artifacts, decisions, and interaction needs change, the coordinating agent sends semantic changes to the Surface Builder. The surface remains a projection over the skill and durable Run state. It can be evaluated and promoted with the skill after real usage.

## Repository Package

The repository package is versioned with the project and declares:

- The adaptive Workflow Contract and quality envelope.
- Required capabilities and safety gates.
- Skills, tools, hooks, validation commands, and model roles.
- A finite set of named Execution Profiles that resolve model requirements, effort, continuity, permissions, workspace kind, skills, Independence, and Episode schema.
- Constraints and recommendations for owner selection of Working Mode based on outcome, uncertainty, scope, risk, reversibility, available Human Attention, and repository capabilities.
- Work Packet requirements, attempt ladders, attention thresholds, and allowed non-material graph mutations.
- Shared Understanding participants, interaction cadence, direct-experience surfaces, review responsibilities, and result-packaging requirements.
- Permission and AFK autonomy limits.
- External adapters and publication mappings.
- Supported Workbench client project surfaces.
- Artifact classes, retention periods, promotion gates, and cleanup rules.

PhotoQuest and embabel-me use the same controller lifecycle and record schemas. Their packages may vary only finite policy fields such as judgment depth, required challenge and independent-review profiles, evidence classes, verification commands, risk and impact ceilings, Execution Profiles, fallback equivalences, retry bounds, and retention rules.

A repository package cannot remove invariant authority, independent Verification, Acceptance, Publication, analysis, promotion review, or cleanup obligations.
