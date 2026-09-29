# Harness and Skills Specification

The harness packages everything needed for attended human–Pi work while keeping credentials, sessions, and machine-specific state local. This contract defines harness distribution, repository adaptation, skill capabilities, generated surfaces, and the V1 operating posture.

This document is authoritative for this contract. [The system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries.

## V1 Operating Posture

V1 supports attended human–Pi pairing. One human pairs with one interactive lead Pi under continuous Human Attention. The session may remain a standalone Chat or have exactly one home Workstream.

The lead may launch bounded ephemeral child Pi processes as attended tool activity and remains accountable for their assignments and results. A child may run non-blocking only inside the attended lead session and is cancelled when the session shuts down. The harness launches no unattended execution that survives the session and no managed Runs.

A Workstream preserves cross-session attention but grants no workspace lease, enforced path scope, durable Run identity, managed authority, or recovery guarantee. Attended-session hosts coordinate Workstream association through the shared host-neutral session-coordination module rather than embedding lifecycle logic in a skill or interface adapter.

Model selection may resolve concrete providers, models, and Model Effort for the interactive lead and child processes. Those bindings do not change the attended posture.

The [Working Mode](../foundation/working-mode.md) control provides `/mode` in the terminal and RPC, a terminal footer indicator, and four axes that start at their neutral values (Orchestration at Main). A change reaches the model as one tagged conversation message with the next prompt; the system prompt is unchanged. The session records each change and resume restores it. The control must:

- start a new context at the starting values without a setup gate;
- keep the four axes independent;
- present an active owner choice truthfully without implying mechanical enforcement; and
- leave authority, durability, and workspace protection outside Working Mode.

Forcing an initial read-only phase, filtering tools or skills, and applying a blanket mutation gate are outside the current design. Further enforcement requires observed need and explicit owner approval.

The packaged agent-input audit is an explicitly enabled, current-terminal diagnostic. It observes supported provider sends without changing them, stores sensitive evidence only under ignored local review storage, and stops on reload, session replacement, or shutdown. Its saved request evidence and unsent Working Mode previews are inspectable as versioned JSON or through a local Atelier Surface. Native session JSONL remains the output authority; the audit stores entry references and export-time evidence snapshots rather than a second transcript. Supported transports and evidence limits are documented with the extension and must not be generalized to provider receipt, raw response bytes, hidden server instructions, or unsupported providers.

## Harness Distribution Repository

The harness is one cloneable Git repository. It contains the shared Pi package, orchestration capabilities, curated skills and bundled resources, prompts, adapters, configuration, provenance, and environment checks. Shared skills must work without a separate personal dotfiles setup.

The Pi package, prompts, skills, adapters, and configuration are versioned resources. Provider credentials, quota state, active sessions, and local PI WEB configuration are not.

External executables and services are represented as versioned capabilities with supported installation and health checks. Credentials, subscription state, and machine-specific configuration remain local. Target repositories provide overlays for project-specific knowledge, commands, safety policy, and verification.

The local `pi-update` command resolves to `scripts/update-pi-local`. It updates Pi and managed packages, probes bundled and unbundled runtimes for [Pi issue #8773](https://github.com/earendil-works/pi/issues/8773), and applies the local workaround only while released Pi still needs it. On failure it restores the updated artifacts and reports any rollback failure.

Runtime routing and the interactive startup check share a machine-local quota snapshot for ten minutes, including unavailable telemetry. Repeated child launches do not query provider endpoints again within that window. The startup check may inspect local Claude quota telemetry and offer attended sign-in or macOS Keychain repair when needed. It never:

- stores credentials;
- prompts in non-interactive modes; or
- treats telemetry failure as provider authority or a reason to block a child launch.

## Installed and Development Checkouts

The owner uses Pi Workbench and PI WEB for daily work while they are developed. Running code and edited code therefore live in separate checkouts:

- **Installed checkouts** — `~/IdeaProjects/pi-workbench.installed` and `pi-web.installed` link to immutable detached worktrees under `~/.pi-workbench/installed/`, one per promoted revision. Pi package settings, the PI WEB plugin link, and the launchd services load only these, and PI WEB runs its production services (`pi-web install`) on port 8505 rather than autoreloading dev servers. No session edits them.
- **Integration branches** — pi-workbench `main` and PI WEB `pi-workbench` receive work only as merged commits. Keep their checkouts clean; no session edits them in place.
- **Development worktrees** — each editing session owns one linked worktree on its own branch. One session per worktree.

A change goes live by promotion: merge into the integration branch, trial it in a second PI WEB instance with its own `PI_WEB_DATA_DIR`, socket, and port (or `pi -e <worktree>` for terminal checks), then run `scripts/promote-installed switch <workbench-rev> <pi-web-rev>`. Promotion builds both revisions in new worktrees (`prepare` does only this, safely at any time), then a detached launchd job repoints both links together and reinstalls both PI WEB services, because the session daemon keeps the code it loaded at start. The job restores the previous services if PI WEB does not become healthy; its log is under `~/.pi-workbench/installed/jobs/`. Restarting interrupts every open session and kills everything sessions started under the session daemon (subagents, workers, foreground commands, and servers they started), so promotion requires the owner's explicit go-ahead and time, and `switch` refuses while any such process runs, listing each one (`--force` overrides). Background `bash` jobs are the bounded exception: each runs under a detached runner in its own process group, owned by one session, stopped at its timeout or a 12-hour maximum lifetime, cancellable after the session reattaches it, and swept a week after finishing (`extensions/background-bash/README.md`). They survive the restart and do not block `switch`. Roll back by promoting the previous revisions.

A pi-workbench change that leaves the PI WEB server plugin untouched can go live without that
restart: `scripts/promote-installed switch-workbench <workbench-rev>` builds the revision and
atomically repoints only `pi-workbench.installed`. Open sessions keep the code they loaded; new
sessions and `/reload` load the new revision, so reload a session before relying on changed tools
or roles in it. It prints the command that switches back.

A PI WEB change that leaves the session daemon's code and dependencies untouched (browser client or
web/API server only) goes live with `scripts/promote-installed switch-web <pi-web-rev>`. It restarts
only the web service, so sessions and everything they started keep running while browsers
reconnect. It refuses when any file the session daemon imports, or `package-lock.json`, differs
from the daemon's running build (`sessiond-unchanged` runs that check alone); use `switch` then. It
restores the previous web service if the new one does not become healthy and prints the command
that switches back. `switch` waits 10 seconds by default before restarting, enough for the calling
session to finish its reply.

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

Working Mode does not filter skill discovery; every value advertises the same catalog.

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
