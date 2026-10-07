# Truth snapshot change

Candidate Component · Owner-spec · ME. Not a Registry admission (decision 107).

Show exactly which referenced fact changed between pinned snapshots before asking how to update its test.

## Choose
- **Use:** ME truth refresh and criteria changes
- **Skip:** silently replacing facts and carrying old grades forward

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Fact Key with new snapshot/criteria atl-ver; truth-refresh is a Request; update/keep/drop is a Kernel Decision with material on the fact.
- **Adapt:** Render only changed referenced facts, with both snapshot IDs; after the Decision update domain files via the agent, not via browser write.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio), hash-bound approval mechanism; [html-plan](../../SOURCES.md#html-plan), decision-on-claim; ME §2 T9.
- **Owner for / against:** ME briefing requires review of changed referenced values and criteria-bound grades; D127 keeps earlier-version judgments visible rather than clearing them.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
