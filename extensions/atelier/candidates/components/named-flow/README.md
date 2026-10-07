# Named flow path

Candidate Component · Mechanism · PL WC. Not a Registry admission (decision 107).

Light up one named scenario in a diagram and show its ordered handoffs beside it.

## Choose
- **Use:** WC stage/agent/command explanation or PL alternative execution paths
- **Skip:** decorative moving packets or source-free chronology

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Key per node for Comments; node detail stays content. Decision material may name a scenario; changing a view is not an answer.
- **Adapt:** Replace path data and descriptions, not only labels. Use textContent for source-derived text; keep all node labels readable in inactive paths.

## Evidence and provenance
- **Best source:** [Effective HTML](../../SOURCES.md#effective-html), `workspaces-architecture.html:FLOWS,DETAIL,setFlow` (MIT); architecture-diagram-skill [note](../../SOURCES.md#landscape) corroborates named steps.
- **Owner for / against:** WC §2 T3 chooses this source; VV P1 asks what runs in which order. Source implementation inspected, this adaptation is untested by owner.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
