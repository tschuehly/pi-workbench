# Decision context

Candidate Component · Observed · PL ME WC VR. Not a Registry admission (decision 107).

Frame a Kernel Decision with its evidence, priority and per-option consequences in the reading path.

## Choose
- **Use:** policy choices, change adoption, stage approvals or decisions about a video
- **Skip:** implementing a second set of answer, undo or opened-state handlers

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Key policy-example; material Key policy-example/evidence; agent posts Decision with atelier ask. Kernel renders choices and records explicit opens (D108/113/129).
- **Adapt:** Use the JSON example below as content for atelier ask after checking its current tool schema. Exactly one recommendation; no local radio state.

## Evidence and provenance
- **Best source:** [P4](../../SOURCES.md#prototypes), `p4/app.mjs:card`; [Review Studio](../../SOURCES.md#review-studio), `decisionsHtml` (no licences found).
- **Owner for / against:** VV P4 praised card structure but demanded visible alternatives; D/T1/2 puts context inside each option. P4 collapsed evidence is deliberately not retained.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
