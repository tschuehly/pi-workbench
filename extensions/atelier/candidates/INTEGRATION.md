# Integration limits / issue ledger

These are **pending integration work**, not implemented guarantees or new authority decisions.
Inspected boundary: sibling `kernel/atelier.js` Page contract and implementation. This catalogue
changes neither that file nor `index.ts`. Standalone Components intentionally load no Kernel.
No Contribution or Registry admission is implied (107/111/114).

| ID / status | Affected candidates | Finding and smallest follow-up | Authority / evidence |
|---|---|---|---|
| K1 · pending | section-switcher, flow-map, item-pager | Kernel jump opens native details, but cannot reveal a hidden tab/map level. A Page reveal callback before jump is needed; section-switcher only demonstrates hash navigation. Do not promise hidden-Key navigation yet. | 118/124; PL §3 gap 2 |
| K2 · pending | grade-axes, claim-card | Kernel Verdict click sends scale/value, no note input. ME requires a note for overrides, WC Redo has a note. Add the smallest Kernel note/prefill mechanism without turning a displayed judge value into a human event. Highlighted judge reference is not the required prefilled human control. | 131; ME §2 T4 / B §7; WC §2 T2 |
| K3 · pending | stage-nav, progress-groups, review-filter, item-pager | Samples show synthetic projections. Real counts, saved-state auto-advance, confirmed-collapse and statistics need one read-only projection of current-version Kernel state, including undo. No public state-change hook was found beyond atelier:update. Do not drive progression from a click. | 125/127–131; ME §2 T3/T4/T7; FL page-local collapse request |
| K4 · pending | video-stage, frame-strip, media-review | Current Kernel records a media time on a keyed container, but lacks captured frame storage and a time-seeking Comment jump. Samples do not persist JPEGs or reimplement a composer. Settle asset storage before adding capture; use project-owned source media meanwhile. | 118/125; VR §3 gaps 2/4; PL §3 gap 3 |
| K5 · pending | all scripted/live candidates | Re-run integration tests with actual Updates: focused note/value, disclosure, selected tab, listener bindings and unchanged video node/time survive; changed media gets its new version. Standalone tests cannot prove this. | 123/125/127/130; ME T3; VR §2 T4/T5 |
| K6 · pending | run-request, action-dialog, edit-set, manual-turn | Project handler validates typed jobs, ID/glob selection, source version and queue capacity. Browser constraints do not replace validation. Heavy-job queue and progress are domain-owned; chat-started jobs need a supported way to appear as Requests if required. | 108/122/130; ME §3 gap 5; WC §3 gap 3 |
| K7 · pending | media-review, claim-review | Map old acknowledged/in_progress/implemented/accepted/rejected states onto Comment + Request + human acceptance, not a second lifecycle engine. Keep Redo and old version visible through rework. Verify current Kernel acceptance/rework semantics on a real workflow. | 117/124/127; VR §2 T3; LAU row 11 |
| K8 · pending | video-stage | No sample media is bundled. Verify actual playback, HTTP Range/206, captions, hash-busted latest-master selection and media node preservation against project media. | VR §2 T1/T5; 119/123/127 |
| K9 · pending | Kernel-rendered controls | Candidate content is German; the inspected Kernel renders English controls. Owner requested natural German. Consider label localization in the Kernel, not a new content-style rule. | 117/126; VV A/T1 and B/T2; PL Phase 0 failure |

## What is deliberately not a gap to reopen

- **Versions, Record/Send/Immediate, 10-second undo, read-only domain files, Verdict:** settled by
  127–131, superseding the older analyses' open questions and old 30-second/invalidate-score behavior.
- **Phone access/layout:** opt-in only when requested (132); no tunnel or token candidate was built.
- **Bridge origin/source checks:** Component-local message validation, not a new Page authentication
  scheme. D115 does not make arbitrary cross-document messages trustworthy.
- **No free-standing Comment queue/chat:** 124. Review item filters are domain navigation, not a
  duplicate Kernel Comment queue.

## Conditions before real-use promotion

Use the relevant Pattern on the real task; bind source identities/versions and typed handlers;
exercise the pending rows it depends on; have the owner judge it. VR additionally needs the
read-only real-batch comparison under 119. Only then consider Registry admission under 107.
