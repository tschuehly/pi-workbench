# Cost and time ledger

Candidate Component · Owner-spec · PL ME WC. Not a Registry admission (decision 107).

Report measured compute, human wait, tokens, cache and cost by stage without an automatic cost stop.

## Choose
- **Use:** PL run view or ME run history
- **Skip:** eight decorative KPI tiles or treating missing cost as zero

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment per stage/cost Key; Update refreshes domain observations. Any choice about spending is a Decision, not a browser threshold.
- **Adapt:** Keep currency and units explicit. Separate runtime from waiting for the human; partial totals say partial.

## Evidence and provenance
- **Best source:** [PL analysis](../../SOURCES.md#use-cases), §2 R4–R5 and content briefing §5; [Lavish](../../SOURCES.md#lavish), `src/playbooks.js:table` (MIT).
- **Owner for / against:** PL R4 explicitly reports cost without stopping; P3 eight-number tile row was rejected (PL §2 T4).
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
