# Typed run request

Candidate Component · Owner-spec · ME. Not a Registry admission (decision 107).

Collect the test selection and measured execution configuration before asking an agent to start a run.

## Choose
- **Use:** ME automated eval selection
- **Skip:** a form that launches commands or accepts arbitrary job types

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** atl-request="run-eval" on a versioned set Key. Kernel logs/delivers Request; project handler validates selection and queue capacity before execution.
- **Adapt:** Populate from actual measured build and allowed models. Browser required fields are convenience; validate the resolved ID/glob set on receipt.

## Evidence and provenance
- **Best source:** [AgentClick](../../SOURCES.md#agentclick), typed payload in `skills/clickui-plan/SKILL.md` (MIT); ME §2 T1.
- **Owner for / against:** ME owner found stale builds and model mismatches. Briefing B §3 rejects empty/unknown selection; B §9 serializes heavy jobs.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
