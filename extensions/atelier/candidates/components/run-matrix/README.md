# Turn by run matrix

Candidate Component · Owner-spec · ME. Not a Registry admission (decision 107).

Align Correct/Complete results across runs while keeping build, model and effort visible.

## Choose
- **Use:** ME historical comparison
- **Skip:** aggregating incomparable questions or silently using judge grades over human overrides

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Run/turn Keys per cell; Comment on differences; human Verdicts are read from the Kernel, not reconstructed from colored cells.
- **Adapt:** Pin criteria/truth versions and show non-comparable cells. Pair with sparkline only for a genuinely comparable time series.

## Evidence and provenance
- **Best source:** [ME analysis](../../SOURCES.md#use-cases), §2 T7, `CDF/RESULT-stack-final2.md` Summary; [Lavish](../../SOURCES.md#lavish), table playbook (MIT).
- **Owner for / against:** Owner already compared C/K columns in hand-written reports; none of the 39 tools is an eval analytics product.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
