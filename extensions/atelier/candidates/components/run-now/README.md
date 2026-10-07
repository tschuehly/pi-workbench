# Run now

Candidate Component · Owner-spec · PL ME WC. Not a Registry admission (decision 107).

Give one live run its current stage, attempt, measured process identity and next responsible action.

## Choose
- **Use:** PL Plan 4 live view
- **Skip:** historical audit pages or live timers derived from stale ledgers

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Run/stage Keys for Comments and Updates; stage approval is a Decision; actor/PID data comes from domain measurements, not the Event Log.
- **Adapt:** Include actor, model, effort, PID, command, branch, input/output SHA and real start. Say not observed for each absent fact; omit irrelevant metadata.

## Evidence and provenance
- **Best source:** [PL analysis](../../SOURCES.md#use-cases), §2 T7/R1–R2, R4–R5; content briefing §1,3.
- **Owner for / against:** Owner rejected frozen elapsed time and unrelated git changes in the old run Page. Domain IDs beat p1–p7 Keys (PL §2).
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
