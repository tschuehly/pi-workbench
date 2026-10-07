# Revision summary

Candidate Component · Observed · PL ME WC VR. Not a Registry admission (decision 107).

Explain what changed since the prior inspection without implying earlier feedback has been resolved.

## Choose
- **Use:** ME overnight return, WC rework or VR rerender
- **Skip:** a duplicate Comment history or deleting old Redo notes when work finishes

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment catch-up remains Kernel-owned (D124); this is a Page-level domain summary. Old Verdicts stay bound to old atl-ver (D127).
- **Adapt:** Reference both versions and the remaining question. Populate from evidence, not from the age of the Page or a generic Changed flag.

## Evidence and provenance
- **Best source:** [ndrstnd](../../SOURCES.md#ndrstnd) Before/After; [Live annotation use](../../SOURCES.md#owner), row 11; ME §2 re-entry.
- **Owner for / against:** VR owner rejected fixes against outdated media; LAU rework erased Redo. A summary must identify the changed artifact and what still needs checking.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
