# Pi and PI WEB Level Adoption Plan

Status: approved implementation plan.

## Outcome

Start with a fast, interactive Pi configuration and progressively add multi-model delegation,
deeper alignment, stronger review, and finally controller-managed unattended execution. PI WEB
presents the progression as four explicit numbered Entry Presets. The presets are adjustable
starting points, not quality rankings.

Levels 1–3 are unmanaged Pi workflows: they improve interaction and orchestration but do not claim
Run authority, enforced workspace boundaries, or controller-mediated safety. Level 4 is a managed
Workbench Run.

## Sequence

### 1. Stabilize the baseline

- Reconcile installed Pi `0.83.0` with PI WEB's current declared Pi peer range.
- Verify provider authentication, model availability, and fresh quota reporting.
- Create a versioned Workbench Pi package for presets, prompts, roles, and extensions.
- Keep credentials, subscription state, and machine-specific configuration user-local.

### 2. Deliver Level 1 in Pi

- Resolve models from Cognitive Role plus Entry Preset rather than fixed model names.
- Use a fast, low-effort lead for routine execution.
- Permit one editing lead with parallel read-only advisory subagents.
- Keep alignment conversational, Human Attention continuous, and verification lightweight.
- Fail visibly when an eligible independent model is unavailable.

### 3. Build the PI WEB vertical slice

- Add generic primary-view and navigation contribution interfaces upstream in PI WEB.
- Keep authentication, connection state, settings, recovery, and other protected shell controls
  visible and PI WEB-owned.
- Contribute a first-class Workbench Level selector through those interfaces without private APIs.
- Launch the Level 1 experience from the selected workspace and session.
- Verify desktop, narrow, reconnect, focus-restoration, and recovery behavior.

This Level 1 experience is the forcing function for PI WEB's constrained composition model. Add
further contribution locations only when a demonstrated workflow needs them.

### 4. Add Level 2

- Let the lead spawn parallel read and write subagents as needed.
- Give concurrent writers advisory, non-overlapping directory partitions in the shared workspace.
- Keep the human readily available for rapid feedback.
- Make the lead responsible for reconciliation and final whole-workspace verification.
- Present the advisory, unmanaged safety boundary clearly in Pi and PI WEB.

### 5. Add Level 3

- Require Grill with Docs and explicit approval of a concise implementation and acceptance contract.
- Derive small implementation slices and use a fresh subagent context for every slice.
- Permit dependency-independent slices to run in parallel with advisory directory boundaries.
- Review with one contract-focused reviewer and one independent cross-model-family reviewer.
- Allow at most two correction cycles; unresolved Material Questions or findings return to the human.
- Present the contract, realized changes, evidence, deviations, and residual risks for final review.

### 6. Add Level 4

- Graduate execution to a controller-managed Workbench Run.
- Enforce authority, workspace isolation, attempt bounds, durable state, evidence, and recovery.
- Concentrate Human Attention in deep initial Shared Understanding, Material Questions during work,
  and evidence-based Acceptance at the end.
- Support genuinely unattended execution without treating prompts or PI WEB sessions as authority.

## PI WEB composition boundary

PI WEB becomes extensively but constrainedly composable through typed contribution locations,
semantic presentation tokens, and user-selected shell profiles. Plugins may contribute navigation,
primary views, workspace panels, context and status items, settings, and actions. They cannot inject
arbitrary global CSS, replace undocumented internals, hide protected controls, or own Workbench Run
state.

## Completion evidence

Each step must provide one working end-to-end workflow before the next Level is added. Record model
bindings and limitations, elapsed interaction, subagent usage, verification results, human
corrections, UI recovery behavior, and failures. Use that evidence to adjust presets and routing
without silently changing their authority.
