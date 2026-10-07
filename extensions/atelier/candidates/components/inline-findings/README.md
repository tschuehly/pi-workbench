# Inline findings

Candidate Component · Owner-spec · PL ME WC VR. Not a Registry admission (decision 107).

Distinguish liked, disliked, factual and missing evidence on the same line as the finding.

## Choose
- **Use:** consolidated owner feedback or a concise re-entry summary
- **Skip:** a mandatory four-part rubric or unlabeled agent opinions

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on each finding Key; a Gap is content, not a Verdict or Decision.
- **Adapt:** Use only the categories present. Quote owner preferences separately from measured facts and agent inference.

## Evidence and provenance
- **Best source:** [Owner variants](../../SOURCES.md#owner), D/T1/1 and `variant-verdict-20261006.md`.
- **Owner for / against:** Owner liked the four voices but asked for inline labels; C was rejected for too much text.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
