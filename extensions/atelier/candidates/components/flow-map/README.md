# Levelled flow map

Candidate Component · Owner-spec · PL WC. Not a Registry admission (decision 107).

Pair a horizontally scrollable pipeline map with a half-width explanation and real pipeline/stage/gate drill-down.

## Choose
- **Use:** PL audit or WC stage explanation
- **Skip:** a giant fixed graph, fake zoom controls, or conflating sequential and parallel checks

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Nested pipeline/s5/audio Keys identify content once; navigation buttons refer to those Keys. Comment and Decision material remain on content, not duplicate map labels.
- **Adapt:** Use one domain model for all levels; this tiny fixed example has real drill-down, not geometric zoom. Replace order/parallel labels from code evidence.

## Evidence and provenance
- **Best source:** [P1](../../SOURCES.md#prototypes), `p1/build.mjs`; [Effective HTML](../../SOURCES.md#effective-html), `workspaces-architecture.html` (MIT); C4 model/views is corroboration in [landscape](../../SOURCES.md#landscape).
- **Owner for / against:** VV P1 explicitly requests half map/half explanation, scrolling and C4-like levels. PL §2 traces stop/fail-fast versus Promise.all to project code.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
