---
target: Workstreams wireframe
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 5
timestamp: 2026-08-04T09-37-39Z
slug: orkstreams-ui-workstreams-wireframe-prototype-html
---
# Workstreams Wireframe Design Critique

Method: four independent Claude reviews (holistic design, IntelliJ power-user UX, technical audit, product-truth hardening); detector evidence was isolated from the design reviews.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Connected/stale/selected states exist, but freshness, drift, failure, and action feedback do not. |
| 2 | Match system / real world | 3 | Strong Workstream language; Git scope and attribution labels overstate what the store knows. |
| 3 | User control and freedom | 3 | Pane and terminal controls are reversible; commit selection is a hidden mode and dialogs lack Escape. |
| 4 | Consistency and standards | 3 | Coherent shell, but session-scoped tabs contain a Workstream-scoped Git view. |
| 5 | Error prevention | 3 | Explicit anchors and adoption blocking are strong; revision conflict and checkout drift are absent. |
| 6 | Recognition rather than recall | 3 | Provenance and repo grouping help; selected Git scope and session/workspace binding are too implicit. |
| 7 | Flexibility and efficiency | 1 | No keyboard model, diff traversal, bulk task actions, or expert accelerators. |
| 8 | Aesthetic and minimalist design | 3 | Restrained and dense in a tool-appropriate way, but the default shell has too many equal-weight regions. |
| 9 | Error recovery | 2 | Blocked adoption is explained; missing remote, unreachable commit, reconnect, and failed mutation recovery. |
| 10 | Help and documentation | 2 | Useful inline explanation, but key terms and Git scope have no contextual help. |
| **Total** |  | **26/40** | **Acceptable; strong concept with consequential scope and state gaps.** |

## Design Specificity Verdict

The design is genuinely authored for Pi Workbench. The checkpoint drawer, source-session provenance, cross-repository Git grouping, Workstream baseline, and Human Task queue could not be dropped unchanged into a generic IDE. The strongest differentiated idea is the combination of Git evidence with session provenance and human attention.

The implementation detector returned zero findings. Manual audit still found important issues outside the detector's rules: unmanaged focus, sub-44px targets, narrow-window dead ends, hard-coded light-theme colors, and unsupported product claims.

## Overall Impression

The shell has the right bones and considerably more product specificity than a normal wireframe. Its largest problem is not visual polish: it blurs three scopes—selected session, participating checkout, and whole Workstream—especially inside Git. Until the scope is explicit, users cannot confidently interpret commits, working-tree changes, or the terminal.

## What's Working

1. **Attention-first continuity:** Human Tasks link back to source chats, and the checkpoint communicates what changed, what remains, and what to do next.
2. **Workstream-native Git structure:** repository-grouped changes plus one cross-repository chronological commit list is more useful for this product than blindly copying IntelliJ's per-repository log.
3. **Honest beginnings:** the baseline boundary and warning that current checkout changes may be unattributed are strong trust-building cues.

## Priority Issues

### [P1] The UI conflates selected-session and Workstream scope

**Why it matters:** Chat, Files, and Terminal follow one selected session checkout, while Git displays two repositories. The same tab strip makes them look like peers with identical scope.

**Fix:** name the scope visibly. Either promote Git to a Workstream-level surface or add an explicit `Selected checkout | All participating repositories` scope selector. Show the selected session title and machine in the workspace header.

**Suggested command:** `$impeccable clarify`

### [P1] Git selection is a hidden mode switch

**Why it matters:** selecting a commit silently replaces the working-tree changes and diff. The escape is a distant Current checkout button, so users can misread historical changes as current state.

**Fix:** use one explicit scope control: `Working tree | Since baseline | Commit 3f8c220`. Pin Working tree as a selectable row or let Escape return to it. Echo the SHA in the tree and diff headers.

**Suggested command:** `$impeccable distill`

### [P1] Commit and baseline claims exceed authoritative data

**Why it matters:** `Commits in this Workstream` implies attribution that the Workstream Store does not currently record. A single baseline row cannot represent repositories added at different times, rewritten histories, or missing SHAs.

**Fix:** label the evidence mechanically: `Commits since recorded baselines`. Store and show one baseline SHA and timestamp per repository. Mark commits `session-recorded` or `observed, unattributed`; add unreachable/rebased history states.

**Suggested command:** `$impeccable harden`

### [P1] Narrow layouts remove the product's primary attention surfaces

**Why it matters:** below 900px Sessions and Tasks disappear and are replaced by non-interactive text. The Human Task queue becomes unreachable.

**Fix:** use overlay drawers on compact widths, preserve counts in edge controls, and stack Git tree/diff/log instead of forcing the desktop grid.

**Suggested command:** `$impeccable adapt`

### [P1] Keyboard and focus behavior is not viable

**Why it matters:** every interaction replaces `innerHTML`, losing focus. Dialogs lack initial focus, trapping, Escape, and focus return. Task checkboxes have no accessible names. Git has no keyboard traversal.

**Fix:** define and prototype the keyboard contract; preserve focus across state changes; implement proper dialog lifecycle; label task controls; add file/hunk navigation and visible shortcut hints.

**Suggested command:** `$impeccable harden`

### [P2] Critical degraded states are absent

**Why it matters:** cross-machine sessions, missing checkouts, branch drift, detached HEAD, disconnected stores, optimistic revision conflicts, clean repositories, and rewritten commits are normal—not rare—states for this product.

**Fix:** add explicit verified/drifted/missing/remote/unreachable/reconnecting states and freshness timestamps. Gate mutation actions while disconnected.

**Suggested command:** `$impeccable harden`

### [P2] Git appears writable but has no commit workflow

**Why it matters:** staged/unstaged labels evoke IntelliJ's Commit tool, but there are no stage, unstage, rollback, or commit actions. Users may interpret the surface as incomplete rather than intentionally read-only.

**Fix:** decide scope. If review-only, say `Review changes` and provide `Ask Pi about this change`, `Open in Files`, and `Open terminal here`. If V1 includes Git mutation, add the complete safe flow rather than isolated staging controls.

**Suggested command:** `$impeccable clarify`

## Persona Red Flags

**Alex, power user:** no keyboard traversal between commits, files, or hunks; no shortcut to return to Working tree; no batch task handling. The terminal can open in pi-workbench while the selected Git commit belongs to pi-web.

**Sam, accessibility-dependent user:** task checkboxes are unnamed; modal focus is unmanaged; full re-renders lose focus; selected Git rows are conveyed visually without `aria-current`; many targets are 18–34px.

**Riley, stress tester:** the mock terminal says `working tree clean` while Git reports five changes; rewritten baselines, deleted worktrees, remote-machine sessions, and disconnected mutation failures have no representation.

## Minor Observations

- Make the stale checkpoint trigger visually stronger and explain why it is stale.
- Preserve the session's selected workspace tab or explicitly announce resets.
- Use per-repository diffstats and freshness timestamps.
- Add next/previous file and hunk controls plus Open in Files.
- Complete tablist semantics or use ordinary pressed buttons.
- Replace hard-coded light colors with PI WEB theme tokens before promotion.
- Increase edge controls, terminal handle, tabs, and checkboxes to coarse-pointer-safe targets.

## Questions to Consider

1. Is Git fundamentally a Workstream-level surface, while Chat/Files/Terminal remain session-level?
2. Should V1 Git be evidence-only, or should it own staging, rollback, and commit actions?
3. Is `Since baseline` the default review mode—the differentiated feature—or a secondary filter behind Working tree?
