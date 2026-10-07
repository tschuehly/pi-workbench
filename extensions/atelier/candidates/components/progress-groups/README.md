# Progress groups

Candidate Component · Owner-spec · ME WC VR. Not a Registry admission (decision 107).

Separate running work, material ready to judge and open Decisions in a compact rollup.

## Choose
- **Use:** ME long runs or WC concurrent jobs
- **Skip:** a duplicate Comment queue or unmeasured Agent working claims

## Copy and connect
Copy `example.html`'s `.candidate` subtree, its scoped CSS and script (if present).
Drop `data-demo` and the document shell when composing; keep the script directly after its subtree.
Rename HTML IDs per instance and replace example Keys/versions with stable domain identities.
The standalone preview uses synthetic data and loads no Kernel or external resource.
In a real Page, load the project's copied Kernel once; see [Kernel contract](../../SOURCES.md#kernel).
- **Kernel / Keys:** Links point to item Keys; counts derive from domain records and Kernel state; Request statuses remain Kernel-owned.
- **Adapt:** Replace sample counts from the same projection used by filters. Show completed/total turns separately from open Decisions.

## Evidence and provenance
- **Best source:** [Review Studio](../../SOURCES.md#review-studio), `renderSidebar`; [World-console](../../SOURCES.md#world-console), hero progress (no licences found).
- **Owner for / against:** ME §2 T3 and WC §2 T7 request Cockpit grouping; LAU rejects inert rows that cannot reveal their targets.
- **Implementation:** original minimal HTML/CSS/JS, not vendored source. Upstream licences describe
  inspected sources, not a grant to copy private artifacts. No production data is included.

## Check
Open `example.html`; run `node extensions/atelier/candidates/check.mjs --browser` from the repository.
Kernel Delivery, undo, replay and Update preservation are integration checks, not preview guarantees.
