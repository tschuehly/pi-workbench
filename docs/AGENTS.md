# Pi Workbench working instructions

Load only the authority needed for the documentation task:

- Read `CONTEXT.md` when domain meaning or canonical language is relevant.
- Read `SPEC.md` for system-wide behavior, architecture, product boundaries, and routing to the detailed specifications in `specs/`.
- Read only the relevant document under `specs/` when detailed contract behavior affects the work.
- Read `LEDGER.md` when decision status or open questions are relevant.
- Consult `ledgers/` only when evidence lineage is relevant.

Begin from a faithful understanding of the existing concepts and principles. Do not critique,
challenge, replace, or redesign them unless the user explicitly requests a review, grill, or
alternative.

Use the canonical terms from `CONTEXT.md`. Treat the specification suite rooted at `SPEC.md` as
authoritative for intended behavior and `LEDGER.md` as authoritative for decision status. Each
document under `specs/` owns the detailed contract named in its scope. Evidence ledgers explain the
source and limits of decisions without redefining the supported workflow.

Documentation describes only the supported current workflow and intended state. Keep exploratory
proposals, decision history, and source evidence outside the specification.
