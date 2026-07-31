# Pi Workbench working instructions

Load only the authority needed for the documentation task:

- Start at `README.md` when the relevant authority is unclear.
- Read `foundation/vocabulary.md` when domain meaning or canonical language is relevant.
- Read `foundation/system-overview.md` for system-wide behavior, architecture, product boundaries, and routing to detailed contracts.
- Read only the relevant document under `contracts/` when detailed contract behavior affects the work.
- Read `foundation/decisions.md` when decision status or open questions are relevant.
- Consult `research/sources/` only when evidence lineage is relevant.

Begin from a faithful understanding of the existing concepts and principles. Do not critique,
challenge, replace, or redesign them unless the user explicitly requests a review, grill, or
alternative.

Use the canonical terms from `foundation/vocabulary.md`. Treat the specification suite rooted at
`foundation/system-overview.md` as authoritative for intended behavior and
`foundation/decisions.md` as authoritative for decision status. Each document under `contracts/`
owns the detailed contract named in its scope. Research sources explain the source and limits of
decisions without redefining the supported workflow.

Documentation describes only the supported current workflow and intended state. Keep exploratory
proposals, decision history, and source evidence outside the specification.
