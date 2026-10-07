# Attempt timeline

Candidate Component · Observed · PL VR WC. Not a Registry admission (decision 107).

Keep every production step and rejected attempt visible with source hashes, evidence and attributed judgments.

## Choose
- **Use:** PL per-video audit and live-run history
- **Skip:** a frozen aggregate ledger presented as current or a log wall without stages

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Nested video/attempt/stage Keys; each attempt has immutable atl-ver. Human Comments use the Kernel; historical quotations remain attributed evidence.
- **Adapt:** Populate from current JOURNAL, render/judge receipts and Comment evidence. Keep rejected attempts; provide links to frames at cited seconds and full quotes.

## Evidence and provenance
- **Best source:** [P3](../../SOURCES.md#prototypes), `p3/surface.css`, `p3/build-data.mjs`; PL §2 T4 and content briefing §8 (no licence found).
- **Owner for / against:** Owner calls timeline with screenshots/judges core; asks every step, full quotes and larger video. Agent ranking P3 last did not override owner judgment.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
