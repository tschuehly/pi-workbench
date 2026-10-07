# Frame evidence strip

Candidate Component · Observed · PL VR. Not a Registry admission (decision 107).

Show the frame, timestamp, version and attributed judgment together, with a seek link back to the media.

## Choose
- **Use:** PL attempt evidence or VR revisiting a timestamp Comment
- **Skip:** claiming a synthetic thumbnail is a captured frame

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Frame Keys nested under media version; Comment anchoring/capture persists through Kernel, not this strip. A seek is navigation, not approval.
- **Adapt:** Replace the explicit placeholder with a captured image and useful alt text. Point seeks at the corresponding version; earlier versions must stay labeled.

## Evidence and provenance
- **Best source:** [P3](../../SOURCES.md#prototypes), `p3/surface.css:.card-comment`; [Review Studio](../../SOURCES.md#review-studio), `bubbleHtml,captureShot` (no licence found).
- **Owner for / against:** 278/318 VR Comments were timestamped; owner asked for jump icons on replies too. PL P3 screenshots plus judge remarks were praised.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
