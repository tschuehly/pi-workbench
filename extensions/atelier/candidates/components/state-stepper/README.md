# State stepper

Candidate Component · Mechanism · WC PL. Not a Registry admission (decision 107).

Expose real intermediate states one step at a time, with the visible output beside the transition.

## Choose
- **Use:** WC explaining a changed workflow or PL retry behavior
- **Skip:** animation as evidence of execution or recreating the Request state machine

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** State Keys anchor Comments; illustrative states are domain explanation, not Kernel Request status. A Decision may point at the state being discussed.
- **Adapt:** Use recorded states or label the model synthetic. Keep it understandable while stopped; no autoplay or invented elapsed times.

## Evidence and provenance
- **Best source:** [html-plan](../../SOURCES.md#html-plan), `doc-machine` (licence conflict; original implementation); [Visual Explainer](../../SOURCES.md#visual-explainer), `templates/page.html` stepper (MIT); Willison [note](../../SOURCES.md#landscape).
- **Owner for / against:** WC asks how the pipeline ran; Willison reports improved algorithm understanding, anecdotal only. No owner validation of this candidate.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
