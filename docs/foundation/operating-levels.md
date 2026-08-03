# Pi Workbench Operating Levels

Status: conceptual specification.

This document defines the distinct human-attention, planning, delegation, and authority postures
that Pi Workbench may support. It does not prescribe implementation, sequencing, packages, model
bindings, or delivery dates. A higher number is a different operating posture, not a universal
measure of quality or maturity.

Only Level 1 is in the approved [Level 1 implementation plan](../plans/level-1.md). Levels 2–4 are
concepts, not roadmap commitments. Moving beyond Level 1 requires a separate decision and plan
based on observed use.

## Level 1 — Pair

A human works directly with one interactive lead Pi.

- Human Attention is continuous while Pi performs semantic work.
- The lead may inspect, edit, verify, or delegate bounded work to ephemeral child Pi processes while
  the human remains engaged.
- The lead stays accountable for child assignments, progress, reconciliation, and the shared
  outcome; child output is ordinary attended session material.
- Plans may emerge and change during execution. Level 1 does not require an agreed execution plan
  before implementation begins.
- No unattended model activity, managed authority, enforced workspace isolation, or durable Run
  recovery is implied.

Level 1 is the V1 posture.

## Level 2 — Agree

A human and an interactive lead Pi first iterate on an execution plan and explicitly agree it before
implementation begins.

- Investigation and planning may use bounded child Pi processes while the human remains engaged.
- The agreed plan states the intended outcome, implementation sequence, important constraints, and
  how the result will be checked.
- The lead may execute directly or delegate bounded parts of the agreed plan and remains accountable
  for reconciliation and the shared outcome.
- Material deviations return to the human for plan revision and renewed agreement before affected
  implementation continues.
- Agreement does not itself grant managed authority, enforced workspace isolation, unattended
  execution, or durable Run recovery.

## Level 3 — Contract

Work proceeds against an explicitly approved implementation and acceptance contract.

- Semantic work may be divided across independent contexts.
- Review evaluates the realized result against the approved contract.
- Correction is bounded rather than open-ended.
- Material uncertainty returns to the human.
- The workflow remains human-governed rather than controller-managed.

## Level 4 — Manage

A deterministic Run Controller governs execution under an explicit authority and evidence contract.

- Models propose semantic work; deterministic modules own lifecycle transitions and side effects.
- Authority, workspace isolation, attempt bounds, evidence, recovery, Acceptance, Publication, and
  cleanup are mechanically governed.
- Human Attention may be discontinuous while authorized work proceeds.
- PI WEB remains a protocol client and never becomes authoritative Run state.

## Relationships

Workstreams restore and allocate Human Attention across interactive sessions at every applicable
level. They do not grant execution authority. Attended delegation is available at Levels 1–3; the
Level 1/Level 2 boundary is prior human agreement to the execution plan, not the existence of child
actors. A managed Run is a separate durable authority and execution boundary specific to Level 4
and may be linked to a Workstream without sharing ledger ownership.

An interface may eventually offer an Entry Preset for a supported level, but selecting a preset
cannot grant permissions or create guarantees that the underlying services do not enforce.
