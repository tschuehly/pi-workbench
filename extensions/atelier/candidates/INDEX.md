# Atelier candidate catalogue

**40 Components · 11 Patterns. Candidates, not Registry entries (107).**
Every arrangement and content example below is **offered**, never a content rule (117).
Choose the useful part; no new dependency, router, global page skeleton or prescribed prose length.
Standalone examples are synthetic presentation previews; actual human actions use the copied Kernel.

**Use cases:** PL pipeline audit / live run; ME eval studio; WC Worlds Console review; VR video review.
**Evidence:** Observed = source use, Owner-spec = explicit request/briefing, Mechanism = inspected code.
These labels do not claim owner validation of the new candidate. See [sources/licences](SOURCES.md),
[all 39 + 15 evaluations](EVALUATION.md), [§2 coverage](COVERAGE.md), [integration limits](INTEGRATION.md).

## Candidates

| Candidate | Kind | Purpose | Use cases | Evidence |
|---|---|---|---|---|
| [collapsible-outline](components/collapsible-outline/README.md) | Component | Keep section navigation available without permanently taking width from the judged content. | PL ME WC VR | Owner-spec |
| [section-switcher](components/section-switcher/README.md) | Component | Show independent parts one at a time while leaving their DOM and inputs intact. | PL ME WC VR | Owner-spec |
| [variant-picker](components/variant-picker/README.md) | Component | Switch structural alternatives with a shareable query value, without pretending they are a comparison. | WC PL | Owner-spec |
| [stage-nav](components/stage-nav/README.md) | Component | Locate open Decisions by pipeline stage, retaining the ordered path rather than only filtering cards. | PL WC | Owner-spec |
| [review-filter](components/review-filter/README.md) | Component | Search judged items and hide those already rated or still being produced. | PL ME WC VR | Observed |
| [item-pager](components/item-pager/README.md) | Component | Move between existing judged items using ordinary scroll and optional j/k shortcuts. | VR ME WC | Observed |
| [inline-findings](components/inline-findings/README.md) | Component | Distinguish liked, disliked, factual and missing evidence on the same line as the finding. | PL ME WC VR | Owner-spec |
| [evidence-disclosure](components/evidence-disclosure/README.md) | Component | Keep a focused excerpt near its claim, with explicit omissions and raw material one expansion away. | ME WC PL | Mechanism |
| [source-reference](components/source-reference/README.md) | Component | Keep the exact path, revision and evidence role beside a claim instead of linking mutable HEAD. | WC ME PL | Owner-spec |
| [observation-stamp](components/observation-stamp/README.md) | Component | Separate a timestamped observation from a claim of current liveness or freshness. | PL ME WC | Owner-spec |
| [status-distribution](components/status-distribution/README.md) | Component | Show PASS, FAIL, ERROR, UNMEASURED and n.a. without laundering unknown evidence into green. | PL ME | Owner-spec |
| [gate-detail](components/gate-detail/README.md) | Component | Explain what one check proves, where it came from, and what its broken and clean cases demonstrate. | PL | Owner-spec |
| [criteria-list](components/criteria-list/README.md) | Component | Put the criteria and their evidence directly before a stage Decision. | PL WC ME | Owner-spec |
| [decision-context](components/decision-context/README.md) | Component | Frame a Kernel Decision with its evidence, priority and per-option consequences in the reading path. | PL ME WC VR | Observed |
| [claim-card](components/claim-card/README.md) | Component | Turn one change into Before/Now, a concrete verification walk and a small Confirm/Redo Verdict. | WC ME | Observed |
| [grade-axes](components/grade-axes/README.md) | Component | Keep judge grades and human corrections distinct across Correct, Complete and Taste. | ME | Owner-spec |
| [score-scale](components/score-scale/README.md) | Component | Offer one declared 1–5 Verdict instead of a heavyweight quality rubric. | VR | Observed |
| [manual-turn](components/manual-turn/README.md) | Component | Give the owner a copyable question and expected outcomes before collecting the actual reply. | ME | Owner-spec |
| [edit-set](components/edit-set/README.md) | Component | Collect modify/remove/skip/insert-after suggestions without losing which source item each edit concerns. | ME WC | Mechanism |
| [run-request](components/run-request/README.md) | Component | Collect the test selection and measured execution configuration before asking an agent to start a run. | ME | Owner-spec |
| [action-dialog](components/action-dialog/README.md) | Component | Move rare or risky actions out of the main review path while preserving keyboard access and context. | ME VR | Observed |
| [progress-groups](components/progress-groups/README.md) | Component | Separate running work, material ready to judge and open Decisions in a compact rollup. | ME WC VR | Owner-spec |
| [run-now](components/run-now/README.md) | Component | Give one live run its current stage, attempt, measured process identity and next responsible action. | PL ME WC | Owner-spec |
| [cost-ledger](components/cost-ledger/README.md) | Component | Report measured compute, human wait, tokens, cache and cost by stage without an automatic cost stop. | PL ME WC | Owner-spec |
| [truth-change](components/truth-change/README.md) | Component | Show exactly which referenced fact changed between pinned snapshots before asking how to update its test. | ME | Owner-spec |
| [run-matrix](components/run-matrix/README.md) | Component | Align Correct/Complete results across runs while keeping build, model and effort visible. | ME | Owner-spec |
| [sparkline](components/sparkline/README.md) | Component | Show one comparable rate over time with a shared scale, dates and the raw values available. | ME | Mechanism |
| [flow-map](components/flow-map/README.md) | Component | Pair a horizontally scrollable pipeline map with a half-width explanation and real pipeline/stage/gate drill-down. | PL WC | Owner-spec |
| [named-flow](components/named-flow/README.md) | Component | Light up one named scenario in a diagram and show its ordered handoffs beside it. | PL WC | Mechanism |
| [attempt-timeline](components/attempt-timeline/README.md) | Component | Keep every production step and rejected attempt visible with source hashes, evidence and attributed judgments. | PL VR WC | Observed |
| [video-stage](components/video-stage/README.md) | Component | Keep one video large, with a small/large toggle, native transport and theme-independent pixels. | PL VR | Observed |
| [safe-zone](components/safe-zone/README.md) | Component | Overlay a calibrated platform exclusion area without recoloring or intercepting the underlying media. | VR PL | Observed |
| [frame-strip](components/frame-strip/README.md) | Component | Show the frame, timestamp, version and attributed judgment together, with a seek link back to the media. | PL VR | Observed |
| [viewport-frame](components/viewport-frame/README.md) | Component | Inspect one live app at its actual CSS width while fitting the preview into the available review space. | WC | Observed |
| [scenario-readiness](components/scenario-readiness/README.md) | Component | Distinguish target located, scenario available and check observed before inviting a human Verdict. | WC ME | Observed |
| [diff-excerpt](components/diff-excerpt/README.md) | Component | Show exact changed lines with before/after numbers, signs and an explicit omission boundary. | WC ME | Mechanism |
| [state-stepper](components/state-stepper/README.md) | Component | Expose real intermediate states one step at a time, with the visible output beside the transition. | WC PL | Mechanism |
| [revision-summary](components/revision-summary/README.md) | Component | Explain what changed since the prior inspection without implying earlier feedback has been resolved. | PL ME WC VR | Observed |
| [theme-switch](components/theme-switch/README.md) | Component | Offer an explicit light/dark presentation choice while leaving media colors untouched. | VR ME WC PL | Observed |
| [review-bridge](components/review-bridge/README.md) | Component | Locate and mark spots in a dev-only embedded app; turn them into versioned Page material. | WC | Observed |
| [pipeline-audit](patterns/pipeline-audit.md) | Pattern | Explain the pipeline, audit its gates and answer policy questions using historical evidence | PL | Owner-spec |
| [live-run](patterns/live-run.md) | Pattern | Follow one current run without mixing in unrelated git activity or old policy Decisions | PL ME WC | Owner-spec |
| [eval-run](patterns/eval-run.md) | Pattern | Choose an automated eval, follow its progress and keep human corrections distinct from judge output | ME | Owner-spec |
| [manual-evaluation](patterns/manual-evaluation.md) | Pattern | Let the owner ask questions in the product console while the Page keeps expectations and results organized | ME | Owner-spec |
| [eval-history](patterns/eval-history.md) | Pattern | Compare runs while preserving what changed in build, model, effort, criteria and truth | ME | Owner-spec |
| [evidence-ladder](patterns/evidence-ladder.md) | Pattern | Help a returning owner find the conclusion and inspect progressively deeper evidence without losing source identity | WC ME PL | Mechanism |
| [claim-review](patterns/claim-review.md) | Pattern | Judge a specific Before/Now change in an exercisable app scenario, and turn new marks into work | WC | Observed |
| [decision-on-claim](patterns/decision-on-claim.md) | Pattern | Keep a consequential question, its decisive evidence and every option together in the reading path | PL ME WC VR | Observed |
| [media-review](patterns/media-review.md) | Pattern | Watch one current master, comment at a moment and judge its result without burying the video in controls | VR PL | Observed |
| [trial-comparison](patterns/trial-comparison.md) | Pattern | Compare genuine alternative apps without losing which revision each observed outcome belongs to | WC | Owner-spec |
| [reviewed-edit-set](patterns/reviewed-edit-set.md) | Pattern | Collect ID-bound edits to a list while keeping the adoption decision on the affected item | ME WC | Mechanism |

## Offered content examples — not rules

- **PL:** P4 stage/Decision structure + P1 half-map/detail + P3 every-attempt timeline, per [owner verdicts](SOURCES.md#owner). Neither fixed stage count nor evidence fields become universal Page rules.
- **ME:** RESULT headline → false claims/cause → other findings; turn × run C/K matrix and a reply → Calls → raw ladder ([ME §2](SOURCES.md#use-cases)). Keep another order if it answers the task better.
- **WC:** Before/Now → how to verify → expected result beside the actual app ([WC §2 / LAU](SOURCES.md#use-cases)); anonymous trials are optional, not owner-settled.
- **VR:** one large video → local Decision → rare score/actions in dialog ([VR §2](SOURCES.md#use-cases)); a real comparison may use two videos.
- **Findings:** inline liked/disliked/fact/gap labels when those voices are present ([VV D/T1](SOURCES.md#owner)); not a compulsory four-section report.
- **Explanation:** map → summary → explanation → evidence → raw from [ndrstnd](SOURCES.md#ndrstnd); simple tables, hand SVG or native disclosures often suffice.
- **Copying:** shadcn's source/version ownership informs these copyable files ([source](SOURCES.md#shadcn)); it does not admit them to the Registry before real use.

## Rejected or deliberately not extracted

- **P2 ledger as pipeline explanation:** owner says flow is absent; use map/detail + timeline ([VV](SOURCES.md#owner)).
- **Permanent Comment side panel, side chat, Comment tabs, gesture lanes:** owner width/scroll complaints and D124; use inline Kernel Comments and count/jump ([VR/VV](SOURCES.md#use-cases)).
- **Quick tags and six-axis video rubric:** zero tag use; one score replaced the rubric ([VR §1](SOURCES.md#use-cases)). ME's three axes remain a different task.
- **Visibility timers as agreement:** html-plan's 900 ms heuristic loses explicit intent; D113 requires action ([html-plan](SOURCES.md#html-plan)).
- **Clipboard as primary transport, detached pollers, custom stores or lifecycle engines:** D109/121/125/128 own these; copy fallback remains Kernel behavior ([reports](EVALUATION.md)).
- **Mandatory STE, word budgets, one-exhibit rules or routing by page type:** D117; old Atelier lost 44% of content under prescriptive guidance ([atelier-history report](SOURCES.md#design-reports)).
- **Fake zoom, frozen ledgers, unlabeled green samples, live-from-in_progress, automatic cost stops:** PL's recorded failures; use measured observation and explicit domain behavior ([PL §2](SOURCES.md#use-cases)).
- **A selector hit as verification; exhaustive screenshot programs; Reset as a Verdict:** live app access and actual scenarios matter; Confirm/Redo was enough ([LAU](SOURCES.md#owner)).
- **Default mobile/tunnels or multi-user auth:** D132 keeps Mac-only until requested. Embedded 390px app testing is not mobile Atelier support.
- **Framework/CDN imports, graph DSL/Docker exporters, homemade Mermaid/layout/diff engines:** copied small native examples cover current candidates; deeper libraries remain project choices ([evaluation](EVALUATION.md)).
- **Learn preferences by word overlap or turn every app into fixed typed pages:** AgentClick mechanism useful, product policy rejected ([source](SOURCES.md#agentclick)).

## Run the checks

`node extensions/atelier/candidates/check.mjs` validates completeness, local links, size and JS syntax.
Add `--browser` for isolated headless opens, DOM checks and interaction/security assertions.
[CHECKS.md](CHECKS.md) records the actual run and what it does **not** establish.
