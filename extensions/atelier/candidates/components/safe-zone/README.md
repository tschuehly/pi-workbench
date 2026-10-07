# Media safe-zone overlay

Candidate Component · Observed · VR PL. Not a Registry admission (decision 107).

Overlay a calibrated platform exclusion area without recoloring or intercepting the underlying media.

## Choose
- **Use:** VR checking copy against platform chrome
- **Skip:** treating old platform constants as permanently valid

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on the video Key/version; overlay is content only, not a gate result or Verdict.
- **Adapt:** Calibrate percentages against current platform captures and preserve the calibration date. Example geometry is illustrative, not current TikTok/Reels policy.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio), `ZONES,SAFE_BOX,FEEDCROP_BOX` (no licence found).
- **Owner for / against:** VR §1 T1: safe zones were the largest first-batch complaint cluster. No new mobile Page requirement follows (D132).
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
