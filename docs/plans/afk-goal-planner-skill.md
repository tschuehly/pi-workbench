# AFK Goal preparation skill proposal

**Status:** superseded on 2026-08-12

Do not implement the proposed `prepare-afk-run` skill.

Production evidence showed that AFK preparation was not the limiting factor. The two production-scale
`execute-plan-afk-goal` sessions were dominated by lead-level reviewer waits, forced checkpoints, and
compaction cadence. The concise plain Goal comparator produced more accepted output while the project
controller preserved duplicate prevention, exact evidence, bounded corrections, and honest settlement.

The accepted direction is documented in
[AFK Goal session retrospective — 2026-08-12](../research/reports/afk-goal-session-retrospective-2026-08-12.md):

- ordinary `/goal` is the default for continuous unattended production;
- the existing `define-goal` skill owns one concise AFK objective branch;
- project controllers own resumability, idempotency, queue guards, acceptance, and settlement;
- a future AFK wrapper is a thin plan-to-Goal launcher, not another controller;
- preflight remains a project command or compact checklist until failed launches prove a reusable skill is
  necessary.

The superseded proposal would have added historical analysis, schemas, fixtures, helper scripts, mandatory
preflight receipts, and extension integration before evidence showed a preparation-quality failure. That
ceremony is intentionally rejected. Preserve this file as the decision trail rather than reviving its former
implementation phases.
