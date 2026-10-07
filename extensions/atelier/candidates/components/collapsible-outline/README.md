# Collapsible outline

Candidate Component · Owner-spec · PL ME WC VR. Not a Registry admission (decision 107).

Keep section navigation available without permanently taking width from the judged content.

## Choose
- **Use:** long Pages with independently addressable sections
- **Skip:** a short Page already visible in one screen

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on nested section Keys; native anchors are navigation, never Decision-open receipts.
- **Adapt:** Use the outline for content only. Keep Kernel Comments at their Key; native popover closes without reserving a column.

## Evidence and provenance
- **Best source:** [Owner variants](../../SOURCES.md#owner), A and A/T2; owner evidence rather than an upstream implementation.
- **Owner for / against:** VV keep A sidebar; A/T2 and C/T2 reject non-collapsible panels. D124 separately rules out a Comment side queue.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
