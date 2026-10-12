# Atelier candidates

Optional building blocks, not Registry entries or page-type rules. The lessons are here;
builders need their task and the Kernel, not the research analyses. Examples use synthetic data.

## Pick and compose

1. Pick a Pattern by the question the human must answer, or skip Patterns and pick Components directly.
2. Read only the selected entries; copy their useful markup/styles/scripts into your Page. Load the
   Kernel once via `atelier.js`. `atelier open` copies it beside the Page; plain file previews are insufficient.
3. Bind domain IDs to stable Keys and content hashes to versions. Scope repeated Component IDs,
   selectors and URL parameters per instance. Nest Components under the judged item, not under controls.
4. Read [TIPS](TIPS.md) for optional content examples and rejected approaches. Verify your assembled
   Page with a real Update while interacting (without the tool: `node extensions/atelier/serve.mjs <page>`);
   candidates being tested does not prove the composition.

## Patterns — choose a hierarchy, not a template

- [audit-process](patterns/audit-process.md) — explain a multi-step process: flow → check limits → attempts → policy choice.
- [follow-work](patterns/follow-work.md) — supervise ongoing work: measured now → next owner action → history, distinct from historical audit.
- [compare-variants](patterns/compare-variants.md) — compare alternatives on the same tasks and evidence versions, not by attractive screenshots.
- [grade-results](patterns/grade-results.md) — review outputs: result → independent grading axes → human disagreement → evidence depth.
- [verify-change](patterns/verify-change.md) — exercise a claimed improvement before judging it; optionally locate spots in a live app.
- [review-media](patterns/review-media.md) — inspect media items one by one, with local questions and time/version-bound evidence.
- [re-enter-work](patterns/re-enter-work.md) — return after an absence: conclusion → changes → needed input → supporting history.

## Components — each solves a different mistake

- [observation-stamp](components/observation-stamp/README.md) — distinguish measured history from liveness, missing data and unrelated work; pairs with any result.
- [flow-map](components/flow-map/README.md) — distinguish real sequence/parallelism and what a check does NOT prove; pairs with attempt-timeline.
- [attempt-timeline](components/attempt-timeline/README.md) — retain rejected attempts, every step and attributed evidence; pairs with flow-map or video-stage.
- [claim-card](components/claim-card/README.md) — separate locating a target, exercising its scenario and observing a result; pairs with review-bridge or grade-axes.
- [grade-axes](components/grade-axes/README.md) — separate correctness, completeness and taste, then judge output from human Decision; pairs with run-matrix.
- [run-matrix](components/run-matrix/README.md) — align comparable cases across pinned runs and name incomparable cells; pairs with grade-axes or claim-card.
- [review-filter](components/review-filter/README.md) — pending excludes processing and current human judgments; script restores URL filters and replays the Event Log on Update.
- [video-stage](components/video-stage/README.md) — one versioned media container for time-anchored Comments; script restores size without replacing the video.
- [review-bridge](components/review-bridge/README.md) — dev-only cross-document locator plus scaled viewport; script validates both ends and restores the draft outside clipped UI.

## Kernel limits / issue ledger

- **B1 fixed, regression checked:** all remaining scripted Components restore on `atelier:update`;
  `check.mjs --browser` calls the real host's `update` → SSE → Kernel `morph`, not a copied morph.
- **B2 fixed, regression checked:** bridge Keys wrap the clipping stage, never sit inside it;
  browser checks hit-test the Kernel Comment button and a saved thread before/after Update.
- **K1 pending:** Kernel jump opens `<details>`, not hidden tabs/filter rows. Examples keep decision-bearing
  flow content visible; clear review filters before using global jump. A universal reveal hook needs Kernel work.
- **K2 fixed (decision 155):** a Page-declared Decision's `atl-note` options post only with a note, so an
  override carries its reason in the same event. Prefill is still not implemented.
- **K3 fixed, regression checked (k-state-hook):** all five bite builders scraped Kernel markup (`.atl-open-item`,
  `.atl-chosen`, `aria-pressed`) to learn which Decisions were answered. The Kernel now exposes read-only
  `atelier.state()` and the document event `atelier:state` (`atelier.test.mjs` `publicState`, `kernel-check.mjs`).
  review-filter still reads `derive` on load/Update/refresh and skips unsaved/offline local events; moving it to
  `atelier:state` is open.
- **K4/K8 pending real media:** Kernel records a container's media time, but does not capture frames or
  seek from a Comment. Supply project-owned frames/captions; check actual playback/Range and changed bytes.
- **K6/K7 domain work:** typed job validation, safe queueing, production approval and legacy lifecycle mapping
  belong to the project. A score is not acceptance; only the human accepts completed work.
- **K9 pending:** example prose is German; Kernel controls remain English.
- **K10 fixed, regression checked (k-body):** an Update nested a second `<body>` (trial C, 1 → 2 bodies). The
  Kernel morphs the new body's children; `kernel-check.mjs` asserts one `<body>` after a real Update.
- **K11 fixed, regression checked (k-script-rows):** an Update closed `<details>` the human opened and emptied
  rows a page script built. `<details>` the human toggled keep his state (`kernel-check.mjs`); script-built
  rows are the Page's to re-render on `atelier:update`, as the atelier skill now says (static keyed HTML preferred).
- **K12 fixed, regression checked (k-stamp):** `open` reported a byte-identical, hand-copied (unstamped) Kernel as
  "changed locally". A copy whose content equals the Kernel is current (`atelier.test.mjs`); the skill says let `open` copy.
- **K13 fixed, regression checked (k-test-host):** builders without the tool could not test persistence, Delivery or
  Updates, and wrote stand-in hosts. `extensions/atelier/serve.mjs` runs the real host (`host.ts`, shared with the
  tool) for one Page without a Pi session; `fixes.test.mjs` drives it. The skill points builders to it.
- **K14 fixed, regression checked (k-buttons):** the dock and its undo rows covered Page content (27 stacked undo rows
  after a batch) and every Key carried a Comment button (109–589 per Page). Pending undos share one row with
  "Undo all n"; the idle dock shrinks to its bar; `atl-dock` places it in the Page's layout; only the hovered or
  focused Key (and Keys with threads) has a Comment button (`kernel-check.mjs`). A keyboard user reaches a Key's
  button only from focus inside that Key.
- **K15 fixed, regression checked (selection Comments, from Thomas):** commenting on selected text inside a Key opened
  the editor at the Key's end and scrolled the Page away. The editor now opens as a popover under the highlighted
  selection without scrolling, and the saved thread sits under the paragraph, list item or cell that holds the
  quote, through Updates (`kernel-check.mjs`). A quote in a Key's own direct text stays at the Key's end.

## Check before reuse

`node extensions/atelier/candidates/check.mjs --browser` checks links, Pattern references, real Kernel
loading, scripted state across repeated Updates, bridge trust checks and clipping. Requires the installed
`agent-browser` and `PI_TMP` for cleaned-up fixtures. Without `--browser`, only static checks run.
No candidate is owner-validated yet; real app integration and visual judgment remain pending.
[Source IDs and evidence limits](SOURCES.md) are provenance, not required builder reading.
