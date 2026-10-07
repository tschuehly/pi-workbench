# Pinned source reference

Candidate Component · Owner-spec · WC ME PL. Not a Registry admission (decision 107).

Keep the exact path, revision and evidence role beside a claim instead of linking mutable HEAD.

## Choose
- **Use:** WC rebases, ME criteria snapshots, PL gate reports
- **Skip:** treating a pinned path as proof the source is correct

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on a source Key; set the judged parent atl-ver to the actual source/criteria fingerprint (D127).
- **Adapt:** Replace sample identity with an immutable local artifact or commit-pinned URL, including line range and whether execution was observed.

## Evidence and provenance
- **Best source:** [ndrstnd](../../SOURCES.md#ndrstnd), `dist/web/page.js` merge-base header (Apache-2.0); [explain-diff-html](../../SOURCES.md#landscape), tool note `explain-diff-html.md` (MIT reported, no source copied).
- **Owner for / against:** WC §1 T3 found branch HEAD silently changes report numbers; ME T9 binds criteria to snapshots.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
