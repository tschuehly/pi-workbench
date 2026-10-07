# Gate detail

Candidate Component · Owner-spec · PL. Not a Registry admission (decision 107).

Explain what one check proves, where it came from, and what its broken and clean cases demonstrate.

## Choose
- **Use:** PL audit or current-run gate inspection
- **Skip:** duplicating the whole gate register as a scrolling wall

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Nested pipeline/stage/gate Keys; Comment on test cases separately; Decision material points to this gate version.
- **Adapt:** Fill from the actual check source and defect register; link test file, defect, runtime and input/output fingerprints. Use list/detail with flow-map.

## Evidence and provenance
- **Best source:** [P1](../../SOURCES.md#prototypes), `p1/build.mjs:gatePanel`; [Review Studio](../../SOURCES.md#review-studio), gate register; PL §2 T3 / content briefing §9–10.
- **Owner for / against:** Owner asked to explain what each gate always does; the old word budget removed it. PL §2 requires evidence before the question.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
