# Criteria list

Candidate Component · Owner-spec · PL WC ME. Not a Registry admission (decision 107).

Put the criteria and their evidence directly before a stage Decision.

## Choose
- **Use:** PL G0–G6 approvals or a WC claim with several testable conditions
- **Skip:** a checklist whose checked boxes imply human acceptance

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment per criterion Key; criteria group is a Decision material Key with atl-ver. Results are observations, not human Verdicts.
- **Adapt:** Show expected and observed separately; a missing receipt stays open. Ask the Decision after this element via the Kernel.

## Evidence and provenance
- **Best source:** [PL analysis](../../SOURCES.md#use-cases), §2 T5/R3, Opus 4751 criteria; [agent-html-skills](../../SOURCES.md#agent-html-skills), checklist Action/Pass/Watch (MIT).
- **Owner for / against:** PL Phase 0 failed because its Decision had no context. Opus added fulfilled/open criteria with sources; no new universal checklist rule follows.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
