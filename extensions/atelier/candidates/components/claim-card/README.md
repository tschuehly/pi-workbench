# Claim card

Candidate Component · Observed · WC ME. Not a Registry admission (decision 107).

Turn one change into Before/Now, a concrete verification walk and a small Confirm/Redo Verdict.

## Choose
- **Use:** WC change review; ME manual expected behavior
- **Skip:** confirming a selector merely because it resolves

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Key change-example with content version; atl-verdict="Confirm|Redo" delegates all rating mechanics. A Redo is Record by default; a Request starts rework.
- **Adapt:** Keep Redo note and earlier version visible via Kernel Comments; do not erase the Verdict on rework. Collapse only from saved state, keeping a reopenable summary.

## Evidence and provenance
- **Best source:** [World-console](../../SOURCES.md#world-console), `.review/atelier/build-surface.mjs:cardHtml` (no licence found).
- **Owner for / against:** LAU calls annotation the strongest tested composition; confirms were also recorded against a 404. Pair with scenario-readiness before making claims testable.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
