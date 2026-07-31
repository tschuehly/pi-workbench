# PI WEB Customization Plan

Status: approved implementation plan. PI WEB remains a provisional graphical-shell candidate; this
plan improves its generic extension model without selecting it as the permanent Workbench shell.
The approved [Pi and PI WEB Level Adoption Plan](../../plans/level-adoption.md) supplies the first
primary-view forcing function and governs the sequencing of that vertical slice.

## Outcome

Make PI WEB substantially customizable through stable upstream interfaces while preserving a
maintainable shell and a thin Pi Workbench adapter. Compact presentation is the first vertical slice
and forcing function for the wider customization model.

Customization means composing registered presentation, navigation, primary-view, workspace,
context, status, settings, and action contributions. Users may also maintain declarative,
agent-authorable presentation profiles over every published semantic presentation token. It does
not mean replacing arbitrary internal components, exposing undocumented variables, or injecting
global CSS.

## Ownership

### PI WEB upstream owns

- Presentation preferences, including density, typography, spacing, chrome, and motion.
- Semantic styling tokens inherited by core UI and plugin-owned custom elements.
- The shell layout, responsive behavior, accessibility, navigation, and protected controls.
- Stable contribution locations and lifecycle-aware plugin host interfaces.
- Validation, preview, user selection, persistence, provenance, and recovery for built-in,
  user-authored, agent-authored, and plugin-contributed presentation profiles.
- Compatibility behavior for existing PI WEB plugins.

### Pi Workbench owns

- The PI WEB adapter under `packages/pi-web-integration/`.
- Run, Attention Item, Judgment Dossier, Primary Evidence, Review Surface, authority, revision, and
  receipt semantics.
- A Workbench shell profile assembled only from stable PI WEB contribution interfaces.
- The framework-neutral Run client and deterministic recorded fixtures used by graphical clients.
- Terminal-equivalent outcomes for every Workbench mutation.

### Fixed seams

- The Run Controller remains authoritative; a PI WEB profile or plugin cannot own Run state.
- PI WEB sessions are not Workbench Runs.
- Authentication, permissions, connection recovery, and shell recovery remain visible and
  PI WEB-owned.
- Installed PI WEB plugins remain trusted browser code. Repository- or agent-generated project
  surfaces require the separate constrained or sandboxed hosting model.
- The macOS wrapper launches PI WEB; it does not inject CSS or patch application internals.

## Target customization model

### 1. Presentation profiles

Generalize the current color-theme mechanism into a presentation layer with two independent
choices:

- **Theme:** semantic color tokens and light/dark pairing.
- **Presentation profile:** density and other non-color presentation defaults.

The built-in profiles are `comfortable` and `compact`. PI WEB applies the selected profile at the
application root and resolves a bounded set of semantic CSS variables, such as:

```css
--pi-control-min-size
--pi-control-padding-block
--pi-control-padding-inline
--pi-list-row-padding-block
--pi-list-row-padding-inline
--pi-panel-padding
--pi-toolbar-gap
--pi-message-padding
--pi-message-gap
--pi-content-max-width
```

Names and the final set must be validated against real component migrations before becoming public.
Tokens describe semantic roles rather than exposing every internal spacing value. They inherit
through shadow roots so plugin custom elements can adopt them without PI WEB exposing selectors.

Users may define additional presentation profiles in PI WEB's existing global user configuration,
not in project or selected-machine configuration. A profile extends a built-in profile and may
override every documented semantic presentation token. Overrides use an allowlisted, typed schema;
undocumented custom properties, selectors, arbitrary declarations, markup, and executable code are
rejected. Token validators enforce finite values and role-specific safety bounds rather than
passing arbitrary CSS strings through to the application. The intended configuration shape is:

```json
{
  "presentationProfiles": {
    "agent-compact": {
      "version": 1,
      "title": "Agent compact",
      "description": "Dense review layout with a wider evidence column.",
      "extends": "compact",
      "tokens": {
        "--pi-panel-padding": "6px",
        "--pi-message-gap": "5px",
        "--pi-content-max-width": "1100px"
      }
    }
  }
}
```

The configuration is deliberately agent-authorable. An agent acting with the user's filesystem
authority may propose or edit a named profile, but cannot silently activate it, weaken protected
controls, or bypass validation. PI WEB shows profile title, description, origin, last modification,
base profile, and validation state. New profiles and changes to the active profile enter preview
until the user explicitly applies them. Apply is transactional; cancel restores the previous
resolved profile, and reset always returns to a built-in profile.

The active presentation-profile choice remains browser-local so different browsers and devices can
choose independently. The profile definitions belong to the gateway user's PI WEB config and are
not inferred from a repository. Missing, invalid, or changed profiles fall back visibly to the
previous valid resolution or `comfortable`; they never leave the shell partially styled.

Compact mode must reduce whitespace and chrome rather than body-text readability. Coarse-pointer
layouts retain touch-safe interactive targets even when compact presentation is selected. Custom
profiles cannot override accessibility floors for interactive targets, visible focus, readable
body text, reduced motion, responsive overflow, or protected shell regions.

### 2. Stable contribution locations

Extend the existing action, workspace-panel, workspace-label, and theme registry with bounded
contribution types for:

- Navigation sections.
- Primary views hosted in the main content region.
- Context-bar items.
- Status items.
- Settings panels.

Each location defines ordering, visibility, lifecycle, overflow, responsive, focus, and accessible
label behavior. Plugins register content at a location; they do not receive internal Lit elements
or arbitrary replacement hooks.

Primary views are the critical capability for Workbench attention and Review Surfaces. PI WEB keeps
its shell chrome and protected controls around the hosted view. Conversation remains a registered
core primary view rather than an unreplaceable assumption or a plugin-reimplemented surface.

### 3. Shell profiles

A shell profile composes qualified contribution identifiers and presentation defaults without
containing arbitrary markup. Its eventual interface should express:

- Default primary view.
- Ordered navigation sections and workspace tools.
- Initial panel visibility and bounded size defaults.
- Presentation-profile recommendation.
- Profile title, description, and provenance.

PI WEB ships its current composition as the default profile. Plugins may contribute additional
profiles, but the user chooses the active profile. A profile cannot remove access to settings,
connection state, command palette, authentication, or recovery.

The Workbench profile can make pending Human Attention the default entry while retaining
conversation, evidence, files, Git, and terminal surfaces as explicit destinations.

### 4. Stable plugin host

Stop deepening the current exposure of broad internal `AppState`. New contribution types should use
a browser-safe host interface centered on:

```text
inspect -> canonical shell snapshot
watch   -> ordered shell changes and disposal
execute -> typed shell command and result
render  -> request host reevaluation
```

The snapshot covers stable shell concepts such as selected machine, project, workspace, session,
connectivity, current view, and active profile. It does not expose controller objects, private
routes, Lit elements, or internal stores.

A plugin-settings interface should provide namespaced preference persistence and change
notification. Do not add a generic cache or networking framework until at least two real plugins
need the same behavior.

## Delivery sequence

Every phase must be independently releasable. Later interfaces normally begin only after the
previous interface has been exercised in PI WEB itself or a bounded plugin. The Level 1 Entry
Preset is the approved exception that pulls the smallest generic navigation and primary-view slice
forward; it must still prove those interfaces through the Workbench adapter before broader shell
composition is added.

### Phase 0 — Upstream customization contract

1. Turn the compact-mode shaping material in the PI WEB checkout into an upstream RFC or accepted
   product-shaping change.
2. Inventory hard-coded spacing, control dimensions, and shadow-root inheritance across the shell,
   navigation, conversation, prompt, workspace tools, dialogs, and plugin hosts.
3. Define the protected shell regions and contribution-location rules.
4. Record compatibility rules for current `apiVersion: 1` plugins.

**Exit:** maintainers agree on the compact vertical slice, semantic-token approach, protected
controls, and compatibility strategy.

### Phase 1 — Compact presentation vertical slice

1. Add a pure density-preference module with `comfortable` and `compact` values, safe local-storage
   parsing, fallback, and persistence.
2. Apply density state at the application root without reload.
3. Introduce only the semantic tokens needed by representative navigation, conversation, prompt,
   toolbar, and dialog surfaces.
4. Migrate those surfaces from hard-coded dimensions to the tokens.
5. Add the density selection to browser-local appearance settings; do not put the active choice in
   machine or project configuration.
6. Document the supported density tokens for plugin custom elements.

**Exit:** compact mode shows at least 25% more representative navigation rows in the same desktop
viewport, reduces message chrome without changing body font size, survives browser restart, and
preserves all controls at desktop, tiled, narrow, and coarse-pointer layouts.

### Phase 2 — Agent-authorable custom presentation profiles

Begin after the compact migration has validated the first public semantic-token set.

1. Add a versioned presentation-profile schema under PI WEB's existing global user configuration.
2. Allow a named profile to extend `comfortable` or `compact` and override every published
   semantic presentation token through typed, role-specific validators and safety bounds.
3. Reject unknown tokens, arbitrary declarations, selectors, markup, executable values, invalid
   units, non-finite values, and attempts to weaken protected accessibility floors.
4. Add profile discovery, provenance, validation errors, preview, explicit apply, cancel, reset,
   browser-local selection, and visible fallback behavior to Appearance settings.
5. Treat edits to the active profile as a pending revision: keep the last valid resolution active
   until the user previews and applies the changed revision transactionally.
6. Document an agent-editable configuration example and instruct agents to create or edit profiles
   without activating them or changing project configuration.
7. Prove built-in fallback, invalid-profile recovery, coarse-pointer floors, browser independence,
   and compatibility with plugin custom elements.

**Exit:** a user can ask an agent to author every published presentation-token override in a named
profile, inspect its provenance and preview, explicitly apply it, and always recover to a valid
built-in presentation without exposing PI WEB internals or weakening shell safeguards.

### Phase 3 — Bounded Workbench customization probe

Use the documented v1 plugin interface before proposing additional shell interfaces.

1. Create the initial package in `packages/pi-web-integration/`.
2. Render a workspace label, action, and read-oriented workspace panel from a deterministic recorded
   projection or generated workspace file.
3. Exercise compact presentation, pending Human Attention, Run status, evidence links, reconnect,
   and narrow layouts inside the existing contribution locations.
4. Record each interaction that cannot be expressed without broad `AppState`, private routes,
   polling, unstable runtime objects, or unsuitable panel placement.
5. Keep all Workbench semantics inside the adapter; do not add them to PI WEB examples.

**Exit:** concrete adapter evidence identifies which deeper interfaces are necessary and which parts
already work through v1.

### Phase 4 — Stable host observation

Begin only when the bounded probe demonstrates that current context callbacks or broad `AppState`
prevent stable observation.

1. Define a minimal immutable shell snapshot and ordered change vocabulary.
2. Implement `inspect` and disposable `watch` behavior behind one host module.
3. Adapt the Workbench probe and one existing bundled plugin to use the host for real behavior.
4. Keep existing v1 contexts operational through a compatibility adapter.
5. Decide whether the additive interface can remain v1; introduce `apiVersion: 2` only if callers
   must change existing assumptions.

**Exit:** the probe and a bundled plugin react to machine, workspace, and view changes without
private routes, internal stores, polling, or leaked listeners.

### Phase 5 — Small shell contributions

Add only locations demonstrated necessary by the probe, considering them in this order:

1. Status items.
2. Context-bar items.
3. Settings panels with namespaced plugin preferences.
4. Navigation sections beyond the minimal primary-view entry contributed by the approved Level 1 slice.

Each addition includes registry qualification, deterministic ordering, error isolation, responsive
overflow, focus behavior, cleanup, public declarations, documentation, and both generic and probe
usage.

**Exit:** the probe can add compact global context and configuration without taking over a
workspace panel or touching PI WEB internals.

### Phase 6 — Navigation and primary-view vertical slice

The accepted Level selector requires a first-class setup experience rather than prompt insertion or
a narrow workspace panel. Implement this smallest generic slice after the v1 probe; it may proceed
before unrelated Phase 4 and 5 interfaces.

1. Define qualified navigation-entry and primary-view registration with visibility, badges,
   empty/loading/error behavior, and host lifecycle.
2. Route view selection through qualified contribution identifiers without exposing internal Lit
   elements or stores.
3. Preserve selected view across compatible reload and reconnect scenarios.
4. Specify focus restoration, mobile navigation, command-palette access, and failure isolation.
5. Prove the interface with the Level 1 Workbench selector and a generic bundled example.
6. Keep authentication, connectivity, settings, recovery, workspace selection, and access to the
   default conversation view protected and visible.

**Exit:** the Workbench adapter can host and navigate to the Level selector as a main-region
experience while PI WEB retains connection, settings, recovery, and responsive control. This proof
justifies the hosting seam, not arbitrary navigation replacement or broader shell composition.

### Phase 7 — Shell profiles

Begin only after primary views and at least two genuinely different shell compositions are useful.

1. Represent the current PI WEB composition as the immutable default profile.
2. Add profile registration and validation over qualified contribution identifiers.
3. Add explicit user selection, preview, reset, persistence, and missing-plugin fallback.
4. Prevent profiles from suppressing protected shell controls.
5. Make profile activation transactional so an invalid profile cannot strand the user.
6. Express the proven Workbench composition entirely through registered contributions.

**Exit:** users can switch between default and Workbench compositions and always recover to the PI
WEB default.

### Phase 8 — Typed Pi Workbench adapter

Complete the adapter after the framework-neutral Run client and recorded selection fixture can
execute and replay `start -> submit -> inspect -> watch`.

1. Replace the probe projection source with the Run client while retaining its deterministic fake.
2. Project canonical Run and pending-attention state through the proven contributions.
3. Reuse the primary-view interface proven by the Level selector for managed attention and Review
   Surfaces; add a Workbench shell profile only after Phase 7 passes its separate evidence gate.
4. Add typed mutations only through the Run client, with control-lease and revision checks.
5. Add progressive Review Surfaces and evidence navigation through the smallest proven host.
6. Propose further upstream interfaces only when this adapter demonstrates another generic missing
   capability.

**Exit:** the shared graphical-shell fixture passes without private PI WEB routes, source patches,
session-to-Run inference, or terminal-text mutation transport.

## Upstream change structure

Prefer a sequence of reviewable contributions rather than one customization rewrite:

1. RFC and component/token inventory.
2. Density preference and semantic tokens.
3. Compact migration and plugin token documentation.
4. Versioned custom-profile schema, validation, preview, recovery, and agent-authoring guidance.
5. Bounded Workbench plugin probe using existing v1 contributions.
6. Stable host snapshot and watch lifecycle, if the probe proves the need.
7. Minimal qualified navigation and primary-view contributions proven by the Level 1 selector.
8. Status, context, settings, and further navigation contributions, one proven location at a time.
9. Shell profiles, after two useful compositions exist.

Each source change includes a PI WEB changeset and updates the canonical plugin or configuration
documentation. Workbench-specific names and schemas do not appear in upstream interfaces or bundled
examples.

## Verification

Use the smallest test layer that proves each behavior, followed by PI WEB's broad verification for
cross-cutting changes.

- Pure tests: preference parsing, typed token validation, profile inheritance, revision hashing,
  ordering, fallback, and change reduction.
- Component tests: settings interaction, custom-profile provenance, preview/apply/cancel/reset,
  contribution rendering, focus, disabled/error states, and profile recovery.
- Registry tests: qualified identifiers, duplicate handling, plugin failure isolation, and v1
  compatibility.
- Browser checks: desktop, tiled window, 760 px transition, 320 px, coarse pointer, keyboard-only,
  reduced motion, reconnect, and browser restart.
- Visual fixtures: fixed navigation and conversation data comparing comfortable and compact modes.
- Accessibility checks: visible focus, logical order, labels, touch targets, zoom, and no clipped
  controls.
- Workbench contract tests: deterministic fake Run client, ordered watch, reconnect, stale events,
  duplicate receipts, read-only lease behavior, and terminal-equivalent typed outcomes.

For every non-trivial upstream phase, run the narrow changed tests, `npm run typecheck`, relevant
lint, and finally `npm run verify` before proposing the change.

## Compatibility and release policy

- Existing plugin contributions continue to work unchanged while additive interfaces ship.
- Published semantic CSS variables are versioned public interface; internal selectors and element
  structure are not.
- Unknown or unavailable profile contributions fall back to the default profile with a visible,
  recoverable explanation.
- Invalid custom profiles are isolated by profile id; they cannot prevent PI WEB from loading other
  settings or a previously valid presentation resolution.
- Changes to an active custom profile do not apply until the user previews and accepts the new
  validated revision.
- Plugin exceptions are isolated to the owning contribution and cannot prevent shell recovery.
- Removed or changed stable interfaces require a documented migration window; private and unstable
  interfaces receive no compatibility promise.
- A bounded fork is considered only if an accepted Workbench interaction cannot be represented by
  these interfaces and the shared shell-selection fixture shows that maintaining the fork costs
  less than another adapter.

## Explicit non-goals

- Arbitrary global CSS injection.
- A selector-level styling interface for PI WEB internals.
- Overrides for undocumented variables or untyped arbitrary CSS values.
- Agent-authored profiles that activate or revise the active presentation without explicit user
  preview and application.
- Replacing arbitrary shell components.
- Independent density controls for every panel.
- A general page builder or unconstrained plugin layout tree.
- Plugin ownership of authentication, permissions, recovery, machine connection, or Run state.
- Workbench-specific protocol concepts in PI WEB upstream.
- Selecting PI WEB permanently before it passes the shared graphical-shell fixture.
