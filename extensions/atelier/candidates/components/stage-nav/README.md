# Stage navigation with counts

Candidate Component · Owner-spec · PL WC. Not a Registry admission (decision 107).

Locate open Decisions by pipeline stage, retaining the ordered path rather than only filtering cards.

## Choose
- **Use:** PL stage audit or WC stage review
- **Skip:** a second list of Comments duplicating the Kernel

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Links target stage Keys; open counts are read-only projections of current Kernel Decisions, never hard-coded live truth.
- **Adapt:** Replace illustrative counts on Kernel state change. Keep a zero count explicit when it helps distinguish no questions from missing data.

## Evidence and provenance
- **Best source:** [P4](../../SOURCES.md#prototypes), `p4/app.mjs:48–60,110` (no licence found); [owner](../../SOURCES.md#owner), P4/1.
- **Owner for / against:** P4 open counts praised; PL §2 warns the stage bar alone was merely a filter, not an explanation of flow.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
