# Variant picker

Candidate Component · Owner-spec · WC PL. Not a Registry admission (decision 107).

Switch structural alternatives with a shareable query value, without pretending they are a comparison.

## Choose
- **Use:** WC trial apps or two page directions
- **Skip:** parallel videos unless a specific comparison is being made

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** One Key per variant; a Decision can name the selected app link as material (D113), but selection alone is not approval.
- **Adapt:** Replace the two panels with actual app links or a viewport-frame; keep the deep-link values stable.

## Evidence and provenance
- **Best source:** [Effective HTML](../../SOURCES.md#effective-html), `examples/release-readiness/wireframe.html`, `nav.proto-picker` (MIT).
- **Owner for / against:** WC §2 T2 requests a ?v= picker; VV D/T2 rejects unnecessary side-by-side videos. Blind labels are optional, not owner-approved defaults.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
