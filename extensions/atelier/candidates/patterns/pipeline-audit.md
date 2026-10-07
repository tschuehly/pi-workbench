# Pipeline audit

Candidate Pattern · PL · Owner-spec. An offered arrangement, not a Registry admission or
content rule (107/117). Choose and change it for the task; no prescribed word count or page schema.

## When it helps
Explain the pipeline, audit its gates and answer policy questions using historical evidence.

## Components and hierarchy
1. [stage-nav](../components/stage-nav/README.md) finds open questions by stage; [section-switcher](../components/section-switcher/README.md) separates audit from a live run.
2. [flow-map](../components/flow-map/README.md) uses half map / half explanation; [named-flow](../components/named-flow/README.md) distinguishes ordered and parallel paths.
3. [gate-detail](../components/gate-detail/README.md) and [status-distribution](../components/status-distribution/README.md) explain the selected check and its sample.
4. [decision-context](../components/decision-context/README.md) follows its evidence, with [criteria-list](../components/criteria-list/README.md) when criteria matter.
5. [attempt-timeline](../components/attempt-timeline/README.md) joins every video attempt to [frame-strip](../components/frame-strip/README.md) and [video-stage](../components/video-stage/README.md).
6. [source-reference](../components/source-reference/README.md) pins supporting code and receipts.

## Kernel / Keys
Domain Keys such as pipeline/s5/audio; attempt versions are master hashes. Decisions, opening receipts, Comments and undo stay in the Kernel. One timeline implementation also serves live-run.

## Evidence for and against
[VV/JV](../SOURCES.md#owner): P4 structure + P1 map + P3 timeline. [PL §2](../SOURCES.md#use-cases) supplies every gate/attempt field. P2 lacked flow; P3 was valuable despite an agent ranking it last.

## Boundaries
Historical evidence is not current production state. No mandatory telemetry or Requests here. Pipeline contract version is a project decision; do not invent an S0–S7 mapping for a newer eight-step contract.
