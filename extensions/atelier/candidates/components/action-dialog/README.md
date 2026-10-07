# Secondary action dialog

Candidate Component · Observed · ME VR. Not a Registry admission (decision 107).

Move rare or risky actions out of the main review path while preserving keyboard access and context.

## Choose
- **Use:** ME stack maintenance; VR rate/reject/cancel
- **Skip:** hiding a blocking Decision or its alternatives

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Buttons/forms use Request; score-scale uses Verdict; Kernel retains undo. Closing the native dialog is presentation, not human acceptance.
- **Adapt:** Use domain-specific named jobs. A stop Request must name its scope and preserve history; it is not a shell-command input.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio), `#reviewActionsDialog` and Werkzeuge (no licence found).
- **Owner for / against:** VR §1 T5 says persistent rating buttons hid problems; ME §2 T8 warns a stop recipe deleted chat history.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
