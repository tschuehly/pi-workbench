# Item navigation

Candidate Component · Observed · VR ME WC. Not a Registry admission (decision 107).

Move between existing judged items using ordinary scroll and optional j/k shortcuts.

## Choose
- **Use:** a long WC claim list or VR/ME item list
- **Skip:** swipe lanes, replacing Comment navigation or shortcuts inside editable inputs

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Navigation addresses item Keys only; auto-advance after a Verdict belongs in a Kernel-state subscriber, not an optimistic click handler.
- **Adapt:** Attach to Page items, not Kernel Comment DOM. If auto-advancing, wait for the saved Verdict and keep undo reachable.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio), `scrollComment`; [agent-html-skills](../../SOURCES.md#agent-html-skills), `html-testing-checklist/SKILL.md` (MIT).
- **Owner for / against:** VR §1 T2 records seven navigation revisions ending in scroll plus buttons; feedback-ledger asks for reopenable confirmed entries, independent verification pending.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
