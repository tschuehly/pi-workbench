# Single score

Candidate Component · Observed · VR. Not a Registry admission (decision 107).

Offer one declared 1–5 Verdict instead of a heavyweight quality rubric.

## Choose
- **Use:** VR overall video rating
- **Skip:** sign-off or permission to publish; those are different judgments

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Verdict scale 1|2|3|4|5 on a versioned video Key; Record delivery is the Kernel default. Earlier-version ratings remain historical (D127/131).
- **Adapt:** Embed this inside action-dialog if rating should stay secondary. Choose verbal endpoints appropriate to the task; keep score and production approval distinct.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio), `tools/review-studio.html` scoring controls (no licence found).
- **Owner for / against:** VR §1 T5 reports 43 scores across 27 videos, replacing six criteria; action controls were moved into a dialog.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
