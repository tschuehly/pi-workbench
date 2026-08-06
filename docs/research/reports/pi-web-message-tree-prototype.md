# PI WEB message-tree prototype

Status: interaction prototype and implementation investigation. This is not a supported behavioral contract and does not change the concurrent implementation plan.

## Artifact

Open [`pi-web-message-tree-prototype.html`](pi-web-message-tree-prototype.html) directly in a browser.

The prototype starts from the selected Workbench hierarchy and adds one session-scoped **History tree** inspector. Try both paths:

1. Enter **Redesign the overall PI WEB experience**.
2. Close the Workstream brief.
3. Open **History tree** in Chat.
4. Select a retained entry.
5. Either **Continue from here** or **Fork into new session**.

## What PI WEB already supports

The sibling `pi-web` checkout already contains the core tree-navigation path:

- `/tree` returns a strict `SessionTreeSnapshot` with parent-linked retained entries, an active leaf, and an explicit active path (`src/shared/apiTypes.ts`, `src/server/sessions/sessionCommandService.ts`).
- The current `SessionTreeNavigator` renders the complete retained tree, active-path and active-leaf markers, foldable branches, keyboard tree navigation, and a confirmation step (`src/client/src/components/SessionTreeNavigator.ts`).
- Continuing from an entry can add no summary, a default abandoned-branch summary, or a summary with custom focus. Selecting a user or custom message returns its text to the prompt editor.
- Navigation is rejected while session work is active. The request includes the leaf that was active when the tree opened, so stale navigation can fail instead of silently replacing newer context (`src/client/src/controllers/sessionController.ts`, `src/server/sessions/piSessionService.ts`).
- The confirmation explicitly says that tree navigation changes conversation context only. It does not undo filesystem changes, shell commands, tool calls, or other side effects.
- `/fork` currently creates a new session from a selected prior user message. `/clone` duplicates the current session at its current position (`src/server/sessions/sessionCommandService.ts`).

An upstream feature branch, `upstream/feat/session-tree-fork-from-entry`, extends this path with arbitrary retained-entry forking and adds **Fork into new session** beside **Continue from here** in the tree navigator. Relevant commits are `e002efe`, `a0582a6`, and `d7aa17b`. This work is not an ancestor of the checked-out `pi-workbench` branch at the time of this investigation.

## Prototype decision

Keep the two hierarchies visually and behaviorally distinct:

- The **left hierarchy** is Workbench-owned and lists independently resumable sessions in the selected Workstream.
- The **right history inspector** is PI WEB-owned and shows retained message branches inside exactly one selected session.
- **Continue from here** changes the active branch of the same session. It optionally summarizes the context being abandoned and may return selected user text to the composer.
- **Fork into new session** creates and selects a peer Workstream session. The prototype makes that result visible immediately in the left session hierarchy.
- Do not label the operation **Revert**. Users reasonably read “revert” as undoing repository or tool side effects, which the runtime does not do. Use **Continue from here** and retain the side-effects warning at confirmation.

The inspector sits beside Chat rather than replacing the whole Workbench. This preserves the selected session, checkout anchor, composer, and Workstream context while the user compares branches. At narrow width it becomes the sole visible pane for the duration of the operation.

## Production implications

1. Reuse the generic PI WEB tree projection and navigator behavior; do not put message-tree semantics into the Workbench adapter.
2. Add a generic host affordance for opening session history from a mounted Chat surface, or keep the affordance inside PI WEB-owned Chat chrome.
3. If the upstream fork-from-entry work lands, a successful fork must refresh session collections and let the Workbench adapter associate or display the resulting PI WEB session according to canonical Workstream rules. The UI must not infer Workstream membership from the fork itself.
4. Preserve active-work rejection, expected-leaf conflict checks, summary cancellation, focus restoration, prompt-draft replacement, and explicit side-effect warnings.
5. Keep `/clone` as a session-level action for the current leaf rather than adding it to every historical row. It has no historical selection to resolve.
6. The concise-current-exchange work in `docs/plans/pi-web-workbench-ui.md` should remain independent: collapsed chronological history and the retained branch tree are different projections with different jobs.
