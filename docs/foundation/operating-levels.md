# Pi Workbench Operating Levels

Status: conceptual specification.

This document defines the distinct human-attention, delegation, and authority postures that Pi
Workbench may support. It does not prescribe implementation, sequencing, packages, model bindings,
or delivery dates. A higher number is a different operating posture, not a universal measure of
quality or maturity.

Only Level 1 is in the approved [Level 1 implementation plan](../plans/level-1.md). Levels 2–4 are concepts,
not roadmap commitments. Moving beyond Level 1 requires a separate decision and plan based on
observed use.

## Level 1 — Pair

A human works directly with one interactive Pi.

- Human Attention is continuous while Pi performs semantic work.
- Pi may inspect, edit, and verify within the attended session.
- The human directs the work and observes consequential actions.
- No child actor, delegated semantic work, or unattended model activity occurs.
- Workstreams preserve attention and confirmed continuation state across sessions.

Level 1 is the V1 posture.

## Level 2 — Delegate

An interactive lead Pi may delegate bounded work while the human remains engaged with the lead.

- Each child actor receives an explicit, limited assignment.
- The lead reconciles child results and remains accountable for the shared outcome.
- Delegation does not itself grant managed authority, enforced workspace isolation, or durable Run
  recovery.
- The interface must distinguish advisory coordination from mechanically enforced guarantees.

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
level. They do not grant execution authority. A managed Run is a separate durable authority and
execution boundary specific to Level 4 and may be linked to a Workstream without sharing ledger
ownership.

An interface may eventually offer an Entry Preset for a supported level, but selecting a preset
cannot grant permissions or create guarantees that the underlying services do not enforce.
