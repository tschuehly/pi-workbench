# Large video stage

Candidate Component · Observed · PL VR. Not a Registry admission (decision 107).

Keep one video large, with a small/large toggle, native transport and theme-independent pixels.

## Choose
- **Use:** VR watching or PL timeline drill-down
- **Skip:** unrequested side-by-side variants or building another video player

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Key video-example + atl-ver actual media hash; put atl-group on the card for batched Comments. Kernel handles timestamp Comments and explicit play receipts.
- **Adapt:** Set video src to a project-served immutable/hash-busted URL; test HTTP Range/206 in that project. Add a captions track for speech. Preserve node/time on unchanged-media Updates.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio), `.phone`, `videoSrc`, transport; [owner](../../SOURCES.md#owner), D/T2 and P3/3 (no licence found).
- **Owner for / against:** Owner repeatedly rejected tiny videos and unneeded comparison. VR phone evidence is real, but D132 makes this candidate Mac-first.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
