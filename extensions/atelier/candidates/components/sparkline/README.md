# Small-multiple sparkline

Candidate Component · Mechanism · ME. Not a Registry admission (decision 107).

Show one comparable rate over time with a shared scale, dates and the raw values available.

## Choose
- **Use:** ME per-question or per-model histories
- **Skip:** many interactive series, tiny unlabeled trends or connecting missing observations

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on series/point Keys; charts read domain data (D108/130), never own Verdicts.
- **Adapt:** Replace data in place; common 0–100 scale across rates, show denominator and gaps. Chart.js remains optional outside this dependency-free candidate.

## Evidence and provenance
- **Best source:** [Visual Explainer](../../SOURCES.md#visual-explainer), `SKILL.md` content/figure table and `templates/page.html` small multiples (MIT).
- **Owner for / against:** ME §2 T7 requests hand SVG for small series; no owner trial of this chart is recorded. Raw values keep the sketch auditable.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
