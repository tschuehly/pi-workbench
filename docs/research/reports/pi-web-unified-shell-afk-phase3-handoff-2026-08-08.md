# Archived AFK continuation handoff — unified PI WEB shell, Phase 3 (2026-08-08)

Non-authoritative evidence. This is the verbatim continuation handoff written by the failed
unattended run `ushell-afk-20260808T070241Z-3114d1eb` before its `/private/tmp` worktrees and
uncommitted Phase 3 candidate were lost. Its Phase 1 and Phase 2 candidates were later adopted
attended; see the execution record in
[`../../plans/pi-web-unified-shell-prototype-fidelity.md`](../../plans/pi-web-unified-shell-prototype-fidelity.md).
The worktree paths, evidence roots, and receipts it references no longer exist. Its value is the
Phase 3 scope description and the independent-review findings (one blocker, four highs), which serve
as the starting defect list for the attended Phase 3 retry.

---

# Phase 3 handoff — unified PI WEB shell experiment

## Status

Continue run `ushell-afk-20260808T070241Z-3114d1eb` at **Phase 3**. Phase 1 and Phase 2 are committed candidates; Phase 3 is substantially implemented but **uncommitted and not yet review-clean**.

The latest checkpoint/compaction attempt failed with `Compaction cancelled.` Earlier phase checkpoint attempts also failed because no extension-owned active AFK Goal run was available; receipts record those failures. Do not claim a successful checkpoint.

The current request is Phase 3 persistent composition. Do not roll these changes back to the earlier Phase-2-only scope: Phase 2 is already committed at the bases below, and this uncommitted work is the intended next phase.

## Authoritative references

Read rather than restating:

- Workbench plan and exact Phase 3 exit: `docs/plans/pi-web-unified-shell-prototype-fidelity.md`
- Integration contract/evidence: `packages/pi-web-integration/unified-ui-acceptance-evidence.md`
- PI WEB plugin API guidance: sibling `docs/plugins.md`
- Repository routers: each worktree’s `AGENTS.md`, plus Workbench `packages/pi-web-integration/AGENTS.md`
- Model routing: Workbench `skills/model-orchestration/SKILL.md`
- Prior receipts: `/private/tmp/ushell-afk-20260808T070241Z-3114d1eb/evidence/phase1-receipt.json` and `phase2-receipt.json`

## Owned state

- Evidence root: `/private/tmp/ushell-afk-20260808T070241Z-3114d1eb/evidence`
- PI WEB worktree: `/private/tmp/ushell-afk-20260808T070241Z-3114d1eb/worktrees/pi-web`
  - Branch: `afk/ushell-afk-20260808T070241Z-3114d1eb/pi-web`
  - Phase 2 base: `32269d9e7536101aa2f31b59171a50f44f40cbc9`
- Workbench worktree: `/private/tmp/ushell-afk-20260808T070241Z-3114d1eb/worktrees/pi-workbench`
  - Branch: `afk/ushell-afk-20260808T070241Z-3114d1eb/workbench`
  - Phase 2 base: `c298a0e492ca8497ee3a69ea5943b62f17d65cd6`
- Run-owned environment/cache/temp roots already exist beneath the evidence root. Continue with isolated `HOME`, `XDG_CONFIG_HOME`, `npm_config_cache`, and short `TMPDIR` paths.
- Last inventory found no owned residual service/listener/runtime root. Recheck before starting anything.
- Normal repositories, installed apps, live services, `.scratch/afk-validation...`, and other processes are foreign. Do not inspect deeply, edit, kill, clean, or consume them.

Both owned worktrees currently have uncommitted Phase 3 changes. Use `git status` and diffs from the Phase 2 bases for the exact file list; do not duplicate or transplant from normal checkouts.

## What the current candidate does

The diff introduces a generic PI WEB shell-navigator descriptor API and PI WEB-owned `AppShellNavigator`, then migrates Workbench to one persistent composition:

- One host-owned navigator and protected toolbar.
- One retained middle destination for native Chat, Workstream brief, or Workstream session.
- Native Files/Git/Terminal surface selection.
- Adapter-owned landing page, root navigation tree, duplicate Chat/Workstream trees, responsive navigator logic, and substantial old CSS removed.
- Stable complete-inventory destination restore helper added.
- Controlled acceptance runner now selects the Workbench profile through Settings → Appearance, asserts one navigator/toolbar and no adapter `<nav>`/landing tree, and checks retained plugin/native host identity across destination transitions.

Consult the current diff for implementation details. No Phase 3 commit exists yet.

## Verification already obtained before the newest fixes

Evidence files:

- `phase3-piweb-verify-1.txt`: PI WEB verify passed, 2,598 tests passed and 3 skipped.
- `phase3-piweb-build-1.txt`: PI WEB build passed (existing chunk-size advisory only).
- `phase3-workbench-check-5.txt`: Workbench integration check passed, 89 tests.
- `phase3-runtime-5.txt` / `.exit`: every acceptance check passed, cleanup passed, and aggregate remained `partial` only because of the two truthful later-phase fixture blockers:
  - `LIVE_ASK_UNREACHABLE`
  - `CONTEXT_USAGE_UNREACHABLE`

The runtime proved `persistent-composition-one-navigator`, native route restoration, transcript paging, Files/Git/Terminal scope, paired classification, responsive smoke, profile reset, and clean process/root cleanup.

**Important:** newer edits described below postdate those green runs and are not verified yet.

## Independent review and repairs in progress

A fresh Anthropic independent-review binding was resolved successfully after the above evidence. The reviewer found one blocker and four highs. Treat these as unresolved until repaired and re-reviewed.

### Blocker: protected Projects/checkouts became unreachable

Composed mode suppresses the legacy navigation panel while Pi menu/action-palette callbacks still call `focusNavigationSection()`, which previously focused the absent panel. This violates Phase 3’s protected Projects/checkouts invariant and blocks fresh-location recovery.

A repair has just been applied in PI WEB but is untested:

- `PiWebApp.ts` now has `protectedNavigationOverlayOpen`.
- In a composed profile, `focusNavigationSection()` opens a host-owned modal overlay containing the standard `AppNavigationPanel` rather than silently doing nothing.
- The main destination and shell navigator become inert while the overlay is open.
- Scrim, Close, and Escape close it.
- CSS and a shell-profile test were added.

Audit this carefully for focus management, narrow layout, Project/add/relocate/session behavior, recovery affordances, and use of valid design tokens. The current test fixture profile was changed to include a shell navigator; ensure this does not unintentionally invalidate existing tests.

### High: narrow overlay stays open after widening

Not yet repaired. `AppShellNavigator` uses a CSS 900px breakpoint but no `matchMedia` listener. Opening its narrow overlay and then widening hides its controls while `PiWebApp` leaves `<main inert>`.

Implement a PI WEB-owned media-query listener that closes the overlay and emits `onOverlayChanged(false)` when the query stops matching; release the listener on disconnect. Add a behavioral test crossing narrow → wide. An earlier exact edit attempt failed and made no change.

A separate disconnect repair **is** present: `AppShellNavigator.disconnectedCallback()` emits `false` if removed while open, with a new test. It is also unverified.

### High: stale/vanished destination can remain at root with “Opening destination…” forever

Not yet repaired. In Workbench `#restoreDestinationPreference()`, a nonempty stored Chat/Workstream-session that no longer resolves returns without the stable fallback. Later inventory reconciliation can also demote a vanished live destination to root without applying the complete-inventory order.

Repair with pure tested logic:

- If persisted destination is not currently valid, treat it as “none exists” and apply the documented stable complete-inventory order.
- If reconciliation demotes a previously non-root destination to root, apply that same order.
- Do not automatically retry a cold selection failure: it must remain recoverable retained failure, not hidden polling.
- The true complete-empty state must remain the only steady root/no-destination state.

### High: shell item IDs exceed PI WEB’s 120-character bound

Not yet repaired. Chat item IDs currently include the complete machine/session/project/workspace key. UUID machine/project IDs can exceed the host’s 120-character limit even though the local fixture does not.

Use Workbench’s existing exported `boundedStableValueKey()` to make short opaque presentation IDs for Chat, Workstream, and session rows. Preserve real identity only in callbacks/state. Add a UUID-length test proving every descriptor ID remains bounded and unique enough for the fixture. Keep PI WEB core types generic.

Also ensure navigator descriptor errors preserve a truthful composed fallback/last-known descriptor and produce a visible error rather than silently reverting shell composition.

### High: required module extraction / module-global coupling

Not yet repaired. `pi-web-plugin.js` remains a large custom-element monolith and new shell descriptors currently reach through module-global `connectedWorkstreamsElement`.

Phase 3 explicitly requires extracting at least shell source, Workstream actions, brief/Context presentation, and installation-independent service boundaries. A reasonable repair:

- Add a small lifecycle-owned shell-source module created inside plugin activation (not a mutable module global), bound/unbound to the mounted primary-view provider.
- Move pure navigator/surface descriptor construction there.
- Extract Workstream mutation input/action builders into a Workstream-actions module and use them from the element.
- Extract brief/Context destination presentation/view-model logic into a focused module.
- Keep existing installation-independent client/service/coordinator modules as the service boundary; document their interface rather than creating wrappers.
- Add direct tests for the extracted seams.

Do not add Workstream vocabulary to PI WEB public types/core.

## Additional review findings to triage

Address now when they threaten Phase 3 truth; otherwise record explicitly for the owning later phase:

- Shared Chat destination banner does not visibly render Workstream mutation errors/notices.
- Transient Store read errors can detach the selected Workstream destination instead of retaining the last truthful view.
- `run.panel` remains declared in the profile while composed mode suppresses the workspace panel; `run.open-status` may be a no-op. Reconcile against the Phase 2 contract and later authorized-destination phase rather than hiding it.
- Descriptor rebuilding is expensive and all rows become disabled during one pending selection; likely Phase 4 scaling/fidelity work, but do not regress keyboard focus.
- Collapsed navigator hides section identity and is unbounded; Phase 4 candidate unless Phase 3 accessibility requires repair now.
- Delete dead portfolio/root reducer and renderer paths after extraction so the landing page cannot return accidentally.
- The acceptance responsive test currently changes viewport widths but does not open the overlay and cross narrow→wide; add that runtime/component proof.
- Scope “no automatic mutation” evidence specifically to restore; periodic session-confirmed reconciliation predates this phase.

## Acceptance runner notes

`packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs` was repaired during runtime work:

- The PI menu trigger is not present in default desktop layout; the runner now opens **Actions**, chooses **Open Settings**, previews/applies the Workbench profile, and later resets it.
- It now waits for navigator descriptor inventories before selecting rows.
- Paired classification reads the host navigator descriptor rather than deleted plugin-owned DOM.

The latest controlled runtime root `/private/tmp/u3114d1-p3r5` was removed successfully. Use a fresh short root for every rerun.

## Suggested continuation order

1. Re-read the exact Phase 3 exit and re-inventory owned/foreign state.
2. Inspect the full uncommitted diffs from the Phase 2 bases.
3. Complete and test the protected Projects/checkouts overlay repair.
4. Implement the narrow→wide overlay reconciliation and behavior tests.
5. Repair stale/vanished destination fallback and add reducer/view-model tests.
6. Bound opaque descriptor IDs and test remote UUID identities.
7. Perform the required module extraction and remove the mutable connected-element global.
8. Resolve blocker-relevant medium findings (error retention/visibility and `run.panel`) against the plan.
9. Run focused tests, Workbench integration check, full PI WEB `npm run verify`, PI WEB build, and a fresh controlled browser acceptance with isolated roots.
10. Inspect both full diffs, ensure both worktrees are otherwise clean, then obtain a fresh independent cross-family blocker/high review and reconcile it.
11. Commit one coherent Phase 3 candidate in each owned repository, create `phase3-receipt.json`, and attempt `afk_phase_checkpoint` as the final phase action. If unavailable, record the exact failure without claiming success.
12. Only then continue to Phase 4. Do not publish, release, merge, install, use credentials, or claim owner Acceptance.

## Suggested skills

- `model-orchestration` — resolve author/reviewer bindings and preserve cross-family independence.
- `codebase-design` — shape the required shell-source/actions/brief modules as deep, testable seams.
- `tdd` — use for stale-destination, bounded-ID, resize, and protected-control regressions.
- `code-review` — final standards/spec review from the Phase 2 bases, in addition to the independent cross-family review.
- `agent-browser` — only if the controlled CDP acceptance runner cannot prove a required interaction; keep browser/profile/runtime ownership isolated.

## Non-negotiable final status

This run can end only as an **experimental candidate ready for owner Acceptance**. It is not released, published, installed, promoted, or accepted.