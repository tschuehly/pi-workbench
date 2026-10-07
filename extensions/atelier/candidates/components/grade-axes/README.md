# Grade axes

Candidate Component · Owner-spec · ME. Not a Registry admission (decision 107).

Keep judge grades and human corrections distinct across Correct, Complete and Taste.

## Choose
- **Use:** ME per-turn evaluation
- **Skip:** a multi-axis video rubric, which the owner replaced with one score

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Nested run-example/turn-example/correct, complete, taste Keys; Correct/Complete use Verdict scales, Taste uses Comment. Criteria hash is atl-ver.
- **Adapt:** Highlight the judge value as the initial reference, not a saved human Verdict. The current Kernel lacks an override-note input: required notes and prefilled Verdict controls remain integration gaps, not a Comment-based substitute.

## Evidence and provenance
- **Best source:** [World-console](../../SOURCES.md#world-console) claim-card; [agent-html-skills](../../SOURCES.md#agent-html-skills) segmented states (MIT); ME §2 T4 and B §7.
- **Owner for / against:** ME owner explicitly split correct from taste; grades and overrides were previously mixed in chat. VR §1 T5 rejects six-axis scoring for videos.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
