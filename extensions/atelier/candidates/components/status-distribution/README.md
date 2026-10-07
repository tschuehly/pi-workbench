# Status distribution

Candidate Component · Owner-spec · PL ME. Not a Registry admission (decision 107).

Show PASS, FAIL, ERROR, UNMEASURED and n.a. without laundering unknown evidence into green.

## Choose
- **Use:** PL gate summaries or ME result tallies
- **Skip:** combining unlike samples or treating not-run as PASS

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on the gate Key; domain test results are not human Verdicts.
- **Adapt:** Use separate labels even if a chart merges ERROR/UNMEASURED visually. Carry not-run reason and the master hash.

## Evidence and provenance
- **Best source:** [P1](../../SOURCES.md#prototypes), `p1/build.mjs:bar,nums,gatePanel` (no licence found); PL §2 T7.
- **Owner for / against:** Owner challenged wrong-master PASS receipts (PL T7). P1 green bars lacked sample type; this example names denominator and sample.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
