# Review filter

Candidate Component · Observed · PL ME WC VR. Not a Registry admission (decision 107).

Search judged items and hide those already rated or still being produced.

## Choose
- **Use:** VR pending videos; ME turns; WC claims
- **Skip:** equating no Verdict with ready to inspect

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Filters consume a read-only domain/Kernel projection; Verdict, Decision and Request state stay in the Event Log.
- **Adapt:** Data attributes here are synthetic projection values. Recompute after Kernel replay; open Decision can make an otherwise-ready item pending.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio), `tools/review-studio.html:isPending,humanJudged` (no licence found).
- **Owner for / against:** VR §1 T6: hide judged and processing videos. ME §2 T4/T7 wants sticky filters. A stale Verdict must not hide a new version (D127).
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
