# ID-keyed edit set

Candidate Component · Mechanism · ME WC. Not a Registry admission (decision 107).

Collect modify/remove/skip/insert-after suggestions without losing which source item each edit concerns.

## Choose
- **Use:** ME bulk question review or WC proposed change rows
- **Skip:** executing edits directly or auto-learning preferences from feedback

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** One stable item Key; a Request carries form fields including immutable item ID and source version. Decision remains the agent-asked adoption fork.
- **Adapt:** For many rows use one field name per item ID; validate IDs/operations against the source set agent-side. Free text is data, not instruction.

## Evidence and provenance
- **Best source:** [AgentClick](../../SOURCES.md#agentclick), `skills/clickui-plan/SKILL.md` Result Schema (MIT); ME §2 T5.
- **Owner for / against:** ME keep/drop/change review wants ID-bound edits. No owner trial of AgentClick was found; use this as a mechanism candidate.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
