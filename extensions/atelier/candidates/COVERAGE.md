# Coverage of the four use-case analyses, §2

Sources and immutable byte identities: [PL/ME/WC/VR](SOURCES.md#use-cases).
**C** = executable presentation Component; **P** = offered arrangement; **K** = Kernel responsibility;
**D** = project data/handler. Mapping an element is not claiming its real integration is implemented.
Every C/P named below has one row in [INDEX](INDEX.md). Pending mechanics are in [INTEGRATION](INTEGRATION.md).

## PL — pipeline audit and live run

| §2 element | Disposition |
|---|---|
| T1 stage bar, per-stage open count, Offen/Entschieden, filter and jump | C stage-nav + review-filter; K count/jump; real state projection K3. Stage navigation retains flow, rather than only filtering cards. |
| T2 typed hard/receipt gate, step, human Decision; ✓/✗/? | C flow-map + gate-detail + status-distribution; labels distinguish domain type and observation, not color alone. Page data supplies actual node types. |
| T2 half-map/detail, horizontal lane, nested pipeline→stage→gate | C flow-map, with real drill-down and nested Keys, not fake geometric zoom. |
| T2 named flows, ordered steps, separate model/views; sequential fail-fast vs diagnostic parallel | C named-flow + flow-map; paths are data, views are HTML/SVG. P pipeline-audit; D derives actual ordering from source. No DSL or Docker exporter. |
| T3 measures, stage, blocking, final-check membership, origin defect, effect, limit, broken/clean expected vs measured, ID, test file, runtime | C gate-detail carries these fields, selected from flow-map; source-reference pins implementation. P pipeline-audit. |
| T3 steps separate from checks; list/detail; evidence before question; sample type | C flow-map/gate-detail + decision-context + status-distribution. Steps and checks remain domain records, not a universal schema. |
| T4 / R-history rounds, every step, time, master/in/out hashes, change, judge/lead/owner, full quotes, screenshot at second, cost/result, rejected attempts | C attempt-timeline + frame-strip + cost-ledger; P pipeline-audit/live-run; D current JOURNAL/receipts. No frozen PIPELINE-RUN-LEDGER import. |
| T4 stage strip, large/small video | C stage-nav + video-stage; unchanged-media preservation K5/K8. No eight-KPI decorative row. |
| T5 / R3 ordinal/kind/priority inline, metric, why, visible recommendation/consequence and both alternatives | C decision-context supplies content/material; K renders actual options, recommendation and receipt. A metric belongs only when measured/relevant, not mandatory. |
| T5 / R3 Comment toggle, criteria fulfilled/open with sources, stage accept/change/stop | C criteria-list before decision-context; K inline Comments/Decision. No copied Thread engine or hard-coded post-Decision next action. |
| T6 Key/quote/selector and video time plus captured frame | K anchoring; C video-stage/frame-strip supply versioned media/material. K4 capture/storage/seek still pending; no per-node Region chrome. |
| T7 / R1–R2 PASS/FAIL/ERROR/UNMEASURED/n.a., historical ≠ current, source hashes, live PID, real-start elapsed | C status-distribution + observation-stamp + run-now + source-reference. D measures, never fabricates. No stale timer or Unknown wall. |
| R4–R5 stage runtime/wait/tokens/cache/cost totals, preparation corrections, domain IDs, history | C cost-ledger + criteria-list + run-now + attempt-timeline; P live-run; one Key per correction, not p1–p7. No poller or automatic cost stop. |
| §2.1 audit vs run questions, time/data/Decisions/layout; shared explanations/history | P pipeline-audit and live-run; optional C section-switcher combines them. One shared attempt-timeline/gate-detail, not duplicate implementations. |

## ME — eval studio

| §2 element | Disposition |
|---|---|
| T1 typed set/IDs/globs/build/model/effort/surface/judge; unknown/empty selection rejected | C run-request; D validates actual selection before queueing (K6). Not an executable job launcher. |
| T1 rare/dangerous dialog; measured SHA/config/truth age before queueing | C action-dialog + observation-stamp; P eval-run. Domain observation adds actual truth snapshot age. |
| T2 copyable question, Expected bullets, paste console export, advance on reply | C manual-turn + item-pager; P manual-evaluation; D parser/watcher receives actual reply; saved-state advance K3. Manual scope remains offered, not owner-settled. |
| T3 result Updates, keyed morph, focused input/node identity, N/M, running/needs grading/Decisions, measured status | C progress-groups + observation-stamp; K Update; focus and listener checks K5. |
| T4 Correct PASS/FAIL, Complete PASS/PARTIAL/FAIL, Taste, judge prefill, override note | C grade-axes highlights initial judge value separately; K Verdict. Note/prefill integration pending K2, not silently replaced with a Comment. |
| T4 next ungraded, confirmed collapse, Ausstehend, done/total, inline disagreement | C item-pager/review-filter/progress-groups/inline-findings; P eval-run; current saved-state adapter K3. FL collapse is local and reopenable. |
| T5 Comment→Decision on turn, rewrite/keep-as-trap/both, recommended option with context, N to answer | C decision-context; K Comment/Decision/count. P decision-on-claim. |
| T5 bulk modify/remove/skip/insert-after by ID + note | C edit-set; P reviewed-edit-set. AgentClick schema is evidence, not its polling/product policy. |
| T6 grade→reply→Calls/API/[chat-timing]→omitted log→raw; follow-up issue/diagnose | C evidence-disclosure + source-reference; P evidence-ladder; typed Request from the turn via action-dialog, project job IDs in K6. |
| T7 existing C/K turn×run matrix; headline/false claims+cause/other findings | C run-matrix + inline-findings/revision-summary; P eval-history. Offered RESULT order, not content rules. |
| T7 small multiples/hand SVG, optional Chart.js for many series; sticky filters/hide-resolved; dimensions | C sparkline + review-filter; P eval-history; D provides dimensions. No dependency for tiny charts; libraries remain a project choice. |
| T8 timestamped health/SHA/model/credential presence; start/stop/arm in dialog; preserve chat | C observation-stamp + action-dialog; D validates safe scoped operations, never an arbitrary shell textbox. |
| T9 snapshot pin/refresh, changed referenced facts, update/keep/drop Decision, stale refusal, criteria hash grades | C truth-change + decision-context + source-reference; D refresh, stale check before applying; K versions (127). Old judgments remain historical, not deleted as in old Review Studio. |
| Re-entry after unattended run | C revision-summary; K per-Comment catch-up; P eval-run/eval-history. No duplicate side chat. |

## WC — Worlds Console review

| §2 element | Disposition |
|---|---|
| T1 Map→Summary→Explanation→Evidence→Raw, rational reconstruction not commit chronology | P evidence-ladder; C flow-map/revision-summary/evidence-disclosure/source-reference. Optional, never mandated. |
| T2(a) dev-only ?review=1 bridge; selector pins, first visible target; CSS/text/rect/viewport/route picker | C review-bridge, including both documents and explicit origin/source/shape validation. D maps Request into permanent domain claim Key. |
| T2(b) scaled iframe at 1440/1024/390 | C viewport-frame; app viewport testing, not mobile Atelier support. |
| T2(c) Before/Now, numbered verification + Expected, Confirm/Redo + note, advance, flagged spots | C claim-card + scenario-readiness + item-pager; K Verdict; note and saved-state advance K2/K3. |
| T2(d) four-app picker with ?v= link | C variant-picker; P trial-comparison. Example has two synthetic alternatives; populate actual four app URLs. |
| T3 named SVG flows, selected node/detail, FLOWS/DETAIL data, half-map/detail, source pinned to commit | C named-flow + flow-map + source-reference; P trial-comparison. Actual stage agents/commands/I/O/results go in run-now/attempt-timeline, not inferred from branch HEAD. |
| T4 revision/rework loop, result cleared, revision rises, Redo remains visible through acknowledged/in_progress/reworked | K Request lifecycle and revision, not a Component engine; C revision-summary + action-dialog; K7 human acceptance integration. |
| T5 per-row adopt/don't/adapt, rejected fixes, closed-parent N Decisions, page N to answer, changed/kept/not-opened | C decision-context; P decision-on-claim/reviewed-edit-set; K badges/count/receipt. No clipboard round trip. |
| T6 question/options/consequences/recommended/detail, reading path, open count, apps as opened material | C decision-context/stage-nav; K ask/receipt/note. App link is material; no visibility timer. P trial-comparison offers but does not mandate anonymous-first judging. |
| T7 Pi custom message, queued until receipt, Cockpit state groups, only measured liveness | K Delivery/receipt; C progress-groups/observation-stamp; D current job measurements. No custom transport or inferred liveness. |

## VR — video Review Studio

| §2 element | Disposition |
|---|---|
| T1 native video/frame, seek/chrome + add Comment, filter:none, large/small, HTTP Range/206 | C video-stage + safe-zone; native transport, K Comment affordance (not a second video composer). Actual media/206 pending K8; chrome-local add is a Kernel presentation follow-up. |
| T1 historical 390×844/412×915, dark switch | C theme-switch preserves media; mobile fit/reach deferred by newer D132, not silently claimed. |
| T2 time/variant/frame JPEG, stateless drafts, one batch boundary, nothing-to-send no turn | K anchoring/assets/Send/Delivery; C frame-strip + video-stage atl-group; frame persistence/seek K4. No separate flush store. |
| T2 plain scroll and arrows, including replies | C item-pager for domain items; Kernel Comment navigation owns reply jumps. No gestures or paging modes. |
| T3 six-state lifecycle, implemented accept/reject, only human accepted | K Comment+Request+human acceptance; C revision-summary prevents hidden stale media; K7 maps old states without introducing a second engine. |
| T4 question/options/consequence/recommendation/detail, card-local/orphan renderer capped 50vh, optional note, focus-safe reconcile | C decision-context; K renderer/receipt/reconcile; Update integration K5. The capped orphan block already exists in inspected Kernel, not copied here. |
| T5 one score, dialog for rare actions, invalidate on new bytes, approved-master binding | C score-scale + action-dialog; D production approval checks hash. K versions retain earlier scores rather than delete (127 supersedes old invalidation). |
| T6 !humanJudged && !isProcessing && (pendingReview or openDecision) | C review-filter implements this predicate with synthetic attributes; current-version projection K3. |
| T7 Pi follow-up, human-origin filter, reload-surviving unread cue | K Delivery/receipt/catch-up, not a new Component or phone chat. D129 waits before work; no false claim that queued means received. |
| T8 reach | No candidate: D132 Mac-only by default. Optional phone access needs an owner request and separate implementation. |
