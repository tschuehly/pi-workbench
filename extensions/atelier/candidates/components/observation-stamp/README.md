# Observation stamp

Candidate Component · Owner-spec · PL ME WC. Not a Registry admission (decision 107).

Separate a timestamped observation from a claim of current liveness or freshness.

## Choose
- **Use:** build identity, credential presence, truth age, app readiness
- **Skip:** Unknown walls or timers started from record creation instead of a real start

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on the observation Key; Update replaces measured facts; Request may ask for a fresh probe. Never invent Request status.
- **Adapt:** Print source, observation time, and scope. A credential field reports presence only. A process is live only after a current PID probe.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio); [PL/ME analyses](../../SOURCES.md#use-cases), PL §2 T7/R1–R2 and ME §2 T1/T8.
- **Owner for / against:** PL Phase 0 failed with Unknown fields and stale elapsed time; ME owner had to ask which build/model actually ran.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
