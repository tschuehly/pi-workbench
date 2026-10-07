# Manual turn

Candidate Component · Owner-spec · ME. Not a Registry admission (decision 107).

Give the owner a copyable question and expected outcomes before collecting the actual reply.

## Choose
- **Use:** ME manual console runs
- **Skip:** claiming the agent is watching without an actual watcher

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Test definition Key separate from result Key; Comments on reply and Taste; a pasted reply can be a typed Request, not an unlogged local edit.
- **Adapt:** Copy operates on question text only with selection fallback. Advance only once a stored reply/result arrives, not on Copy.

## Evidence and provenance
- **Best source:** [World-console](../../SOURCES.md#world-console) verification card; ME §2 T2 cites owner O L2711/2849.
- **Owner for / against:** Owner repeatedly asked for questions as quotes with expected state below. Manual mode remains a Page-builder scope choice (ME §5), not a catalogue mandate.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
