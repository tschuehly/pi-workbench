# Scaled app viewport

Candidate Component · Observed · WC. Not a Registry admission (decision 107).

Inspect one live app at its actual CSS width while fitting the preview into the available review space.

## Choose
- **Use:** WC 1440/1024/390 app testing; html-plan mock previews
- **Skip:** calling a 390px embedded app a phone-ready Atelier Page

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Comment on trial Key; embedded locators need review-bridge to become precise Page evidence. Decision material should identify the app/build.
- **Adapt:** Replace srcdoc with the isolated trial URL and keep an open-full-size link. The demo sandbox is inert: grant only the app's required capabilities, preferably on a separate origin. Cross-origin script access is not implied; use review-bridge when needed.

## Evidence and provenance
- **Best source:** [World-console](../../SOURCES.md#world-console), `.review/atelier/build-surface.mjs:fitFrame`; [html-plan](../../SOURCES.md#html-plan), `doc-mock` (licence conflict, no copy).
- **Owner for / against:** WC §2 T2 requests viewport buttons. LAU row 17 found 1440 overflow; scaling must not imply the app passed its own overflow checks.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
