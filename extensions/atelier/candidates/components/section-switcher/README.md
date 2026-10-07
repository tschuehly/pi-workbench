# Section switcher

Candidate Component · Owner-spec · PL ME WC VR. Not a Registry admission (decision 107).

Show independent parts one at a time while leaving their DOM and inputs intact.

## Choose
- **Use:** audit versus run, or one video at a time
- **Skip:** hiding steps that must be compared simultaneously

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Each panel has a stable Key; Comment navigation must reveal a hidden panel before scrolling (D118/124).
- **Adapt:** Buttons use aria-pressed rather than incomplete ARIA tabs. Supply your Page reveal hook; the example reveals hash targets inside panels.

## Evidence and provenance
- **Best source:** [Owner variants](../../SOURCES.md#owner), B/T1; [P3](../../SOURCES.md#prototypes), `p3/surface.mjs` (no licence found; reimplemented).
- **Owner for / against:** VV explicitly prefers tabs over one long text. P3 had a reveal resolver; silent hidden targets are not acceptable (PL §3 gap 2).
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
