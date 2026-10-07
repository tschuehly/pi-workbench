# Focused diff excerpt

Candidate Component · Mechanism · WC ME. Not a Registry admission (decision 107).

Show exact changed lines with before/after numbers, signs and an explicit omission boundary.

## Choose
- **Use:** WC proposed changes or ME criteria edits
- **Skip:** a whole-old/whole-new display mislabeled as a line diff

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on file/hunk/line Keys with commit-pair atl-ver; source data is escaped before insertion. Kernel handles selected-text feedback.
- **Adapt:** Generate rows from a trusted diff or authored excerpt; preserve indentation. For huge diffs use an external renderer, not a custom parser in this Component.

## Evidence and provenance
- **Best source:** [ndrstnd](../../SOURCES.md#ndrstnd), `dist/web/page.js:renderEvidenceLine,renderOmission` (Apache-2.0); [AgentClick](../../SOURCES.md#agentclick), `CodeReviewPage.tsx` (MIT).
- **Owner for / against:** WC T5 compares Today/Proposed/Evidence. No direct owner trial of a diff renderer; pi-visual non-diff is rejected in evaluation.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
