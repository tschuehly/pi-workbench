# Eval history and statistics

Candidate Pattern · ME · Owner-spec. An offered arrangement, not a Registry admission or
content rule (107/117). Choose and change it for the task; no prescribed word count or page schema.

## When it helps
Compare runs while preserving what changed in build, model, effort, criteria and truth.

## Components and hierarchy
1. [revision-summary](../components/revision-summary/README.md) or [inline-findings](../components/inline-findings/README.md) offers the RESULT-style headline, false claims/cause and other findings.
2. [review-filter](../components/review-filter/README.md) selects set/question/model/effort/build/date/infra tags from domain data.
3. [run-matrix](../components/run-matrix/README.md) aligns turns against runs; [sparkline](../components/sparkline/README.md) uses small multiples for comparable pass rates.
4. [cost-ledger](../components/cost-ledger/README.md) adds latency/token/tool-call measures only when relevant.
5. [truth-change](../components/truth-change/README.md) and [decision-context](../components/decision-context/README.md) review referenced fact changes; [source-reference](../components/source-reference/README.md) pins snapshot and criteria.

## Kernel / Keys
Runs append, never overwrite their identities. Read files on load/Update (130), apply current-version human Verdicts (127/131), retain old ones as history. Truth refresh is a Request, changed-fact adoption a Decision.

## Evidence for and against
[ME §2 T7/T9](../SOURCES.md#use-cases), existing RESULT tables; [Visual Explainer](../SOURCES.md#visual-explainer) figure-selection mechanism. No surveyed tool is an eval analytics application.

## Boundaries
The filter sample demonstrates search/state only; extra dimensions are domain fields, not a new generic filter framework. Missing values stay missing. Event Log projection into statistics is not implemented by this Pattern.
