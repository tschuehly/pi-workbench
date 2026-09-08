# Autonomous grill — decision tree (lead-owned scratch) — after round 2

> **ARCHIVED — OUTDATED HISTORICAL EVIDENCE.** Retained for provenance only; this file does not
> describe current behavior or intended state.

Target: working-mode-challenge-dossier.md + principles.md. Worker: 5522227e. Bound: 3 rounds/decision.
Round log: R1-R3 reconciled; closing audit #1 (fresh cross-family reviewer) returned 6 material
gaps, all reconciled below (R4 = advisor verification of absorption; then audit #2).
ID convention (audit fix): D1-D21 = grill proposals; "Decision NN" = docs/foundation/decisions.md.
PROCESS DEVIATION (R4 reclassification, human disposition required): commit 9a87d1f (22:49 local)
added an observer-authored grill-analysis report mid-grill. The dossier rule reads "no document
edits during the grilling" without an authorship carve-out, so this is recorded as a deviation
pending explicit human waiver — not as satisfied-in-substance. Facts for disposition: authored by
a separate observer session; adds new research only; edits no challenged/authoritative document;
this grilling session read nothing from it (zero evidence from it entered the tree); this session
edited only .scratch/. Human options: waive as exception / record as violation in the decision
text / require an additional audit pass over the report's content.

## Cluster A — model structure

### D1 [R3] Field set + validity predicates
Working Mode = field set (attention cadence, direction commitment, authority envelope,
verification, bounds, delegation shape, governance, durability, workspace protection); each value
carries provenance stage. Validity via per-field predicates — admits(required, granted) and
conforms(admitted, observed) — NOT ordinal ≤ (bounds reverse direction; authority/delegation are
sets; governance values incomparable). Presentation projection: "you REQUEST cadence, commitment,
bounds; the environment supplies governance, durability, workspace protection."

### D2 [R3] Provenance pipeline
requested → recommended → required → admitted → observed, provenance recorded. Owner requests;
mechanisms admit (P6). Ratification is a RECORDED EVENT that changes requested/required inputs —
not a pipeline stage; its exact semantics remain deferred (Deferred Design Decision 7) and this
proposal does NOT settle them (audit fix). Re-admission at every authority-sensitive transition
and on deterministic events (credential revocation, workspace contamination, quota exhaustion —
Decisions 54/59/64 alignment),
not only phase boundaries. V1 honesty (R3 wording fix): humans RE-EVALUATE and RATIFY; only a
mechanism ADMITS. At V1, admitted values exist only where a local mechanism grants them (model
binding verification, worker locks, tool allowlists); everything else stays at requested/ratified
stage — provenance records never mark judgment as "admitted". General mechanical re-admission
arrives with managed machinery.

### D3 [R3] Constraint classes
(i) universal invariants: structural authority (P6), fail-closed uncertainty (P7), Acceptance AND
Publication separately owner-approved (Decision 21 exact semantics), completion predicate external to the
invoked plan; (ii) repository requirements (binding once resolved into contract); (iii)
recommendations. Compatibility predicates per effect class: read-only Scout / isolated mutation /
production Ship.

### D4 [R3 — absorbed twice, stable] Direction commitment
Per-object commitments (outcome, acceptance criteria, strategy constraints, implementation route),
independently agreed+versioned; deviation above an agreed object triggers re-alignment. Conflicts
resolve by authority+scope+revision, with ratification semantics deferred (DD7 — audit fix: this
proposal does not define them), never by document type. Invoked plan never owns completion
semantics.

### D5 [R3] Presets
Intent templates. At launch: resolved posture + supported-boundary disclosure. Presentation
enforces ONLY the disclosure obligation — it grants and enforces no capability (P6). V1 ships
Attended Pair only; AFK Experiment/Managed Run stay research examples until decided.

### D6 [R3 — absorbed, stable] Validation timing
No general resolver/validator at V1. Invariant: any feature letting model activity continue past a
human boundary ships a local fail-closed mechanical gate, pre-controller. Human boundaries (R3
narrowing) = DECISION POINTS needing a human: typed ask, explicit pause, always-escalate classes.
Control disconnect is NOT a decision point — it is an attention-state fact (see D21) that blocks
NEW attention-relaxing admissions fail-closed but does not retroactively gate already-admitted
bounded work.

## Cluster B — verdicts

### D7 [R3] Verdict = REVISE
Adopt multidimensional direction with grill corrections; retire ladder as primary model. R2 tested:
revise survives strongest retain case (ladder = memorable guarantee bundle → survives as Attended
Pair preset + explicit managed-capability boundary) and strongest adopt case (exact adoption fails
on static classes, ordinal commitment, premature validation). Superseding decision must map D79-82
CLAUSE BY CLAUSE to retained / renamed / superseded, with a boundary-equivalence table proving:
continuous attention, cancel/relaunch child correction, explicit fail-closed binding, no selector,
no unattended execution, truthful guarantees all survive verbatim in the new model.

### D8 [R3] Migration outline
One coherent change set with a partitioned inventory: (a) normative current text (vocabulary,
operating-levels.md → working-mode doc, system-overview, requirements, contracts incl.
execution/interfaces/harness; clause-level treatment of D19/D33/D46/D56/D58/D60/D66 references);
(b) active plans (annotate legacy filenames, keep); (c) historical decisions/research (unchanged;
append-only). Operating Level keeps a superseded legacy definition (glossary) for historical
interpretability. Verification: link check + residual-term grep + boundary-equivalence matrix
(no planning/authority/recovery/isolation/Acceptance/Publication constraint lost).

### D9 [R3] PI WEB presentation
V1 shows FIXED supported-boundary facts (static truthful disclosure; producer = the contract, not
runtime attestation). No dynamic capability report until a named authoritative producer exists;
runtime-attested changes surface at the affected action/re-entry (future). No editable vector
dashboard. Noted risk: warning fatigue for the single supported preset — verify comprehension.
Audit alignment with D21: where a control-presence producer exists it is the hosting client's
session transport (PI WEB web process); D21's dynamic labeling/blocking applies only where that
producer exists.

### D10 [R3] Principles impact
Migration change-set includes principles link/terminology repair (P6 links operating-levels.md;
P4 "dimensions" wording checked against provenance-stage model). Stewardship: blocking at Run
close = source-backed Learning Candidate EXTRACTION + orchestration analysis (D27/P12); deferrable
= promotion/generalization/reuse. Candidate narrow detailed principle under P12: "classify
superseded state and cleanup eligibility before Run closure; deletion remains authority-bound" —
present to human as option A (add principle) vs option B (record as workflow policy only).

## Cluster C — attention mechanisms

### D11 [R3] FirstMate gating = YES-unbundle, mate v0 re-scoped
(a) C1 child decision-point observation: additive, read-only; a child pausing on a decision point
with no reply channel must TIMEOUT TO TERMINAL or be cancelled (no unanswerable waiting); child
correction stays cancel-and-relaunch (D80). (b) C2-child: deferred behind its own superseding
decision. C2-interactive v0 = focus/notify the native ask (owner answers personally; no automation,
no new protocol); typed answer-delivery = separate named build item. AUDIT FIX — Phase 2 has no
approved actuator today: auto-continue is blocked on BOTH the gating decision AND the typed
answer-delivery build with its superseding decision for whichever channel it actuates
(C2-child needs a Decision-80-superseding decision; C2-interactive needs the typed delivery
protocol). Phase 2 cannot be reached from this grill's verdicts alone. (c) Decision points/answers
persisted only by the deterministic service path as typed records (D91-style); mate model turn
never writes. (d) V1 mate synthesis only on owner-initiated turns; watcher triggers deterministic
notifications only (D80/D85); background synthesis needs a superseding decision. (e) Phase 2
auto-continue gate: deterministic policy over MECHANICALLY-DERIVED effect class + envelope
admission; model attestations may only NARROW authority or escalate — never widen; unknown never
widens; always-escalate classes regardless of confidence; receipts. (f) Event-driven watching, no
polling. Drills before Phase 1 accept: duplicate, stale, spoofed, reconnect, owner-absent,
failed-delivery, child-decision-while-control-unavailable.

### D12 [R3] Frontier-batched Material Questions = YES, two scopes
Eligibility predicate is the defining rule (audit fix): a question enters a round ONLY if its
prerequisites are settled and it is currently material; the frontier is recomputed from the
answers after each round. (i) V1: batch ELIGIBLE session asks + Workstream human tasks as one
PRESENTATION round in the attention view — sources remain visibly separate (asks vs tasks have
different authoritative stores/actions, Decisions 91/92); answers stay individual revision-checked
submissions; siblings re-projected (and eligibility recomputed) after each submit; urgent blockers
bypass. Lands in graphical-attention.md (V1 scope). (ii) Managed-Run Material Question batching →
future managed-attention contract, not graphical-attention.md (:15-16). Metrics: completion time,
deferrals, changed answers.

### D13 [R3 — absorbed, stable] Phase-boundary guidance
Branch criteria (independence → subagent; poisoned → clear; parallelizable/bounded → subagent;
durable transfer → handoff; else continue; compact at semantic boundaries under pressure), default
bias continue. Live session = cheapest current context, never authoritative state. Destination:
focus-handoff SKILL.md only.

## Cluster D — AFK / cost / stewardship

### D14 [R3] Outcome-only attention floor — aggregate budgets are a BLOCKER, not dissent
Universal unattended core: (1) mechanically ENFORCED aggregate budget across lead+children+
compaction+judges+supervisors — reservation and stop, not post-hoc observation; absent this,
outcome-only postures are INADMISSIBLE; (2) deterministic event-driven supervision; (3) completion
predicate external to invoked plan; (4) restart classification; (5) human boundaries pause work,
never reroute to autonomous diagnostics. Effect-conditional: attempt-consumption event where
attempts exist; workspace isolation scaled to mutation class; Publication per Decision 21.
PhotoQuest overnight trial preconditions (all four): Asset Scout hang diagnosed; disposable guarded
successor test passes; trial harness PROVES aggregate-stop behavior; fresh human authorization.
Diagnosis never implicitly authorizes.

### D15 [R3] Judgment cadence
Deterministic checks always. P14 FLOOR IS INVARIANT (audit fix): every MATERIAL claim is checked
by an actor that did not produce it, supported by Primary Evidence — no policy or ratification
waives this; cadence and depth vary only ABOVE that floor. "No independent review" applies only to
non-material routine phases with direct deterministic evidence. Independent review chosen to break
a NAMED failure correlation; dual cross-family reserved for material/irreversible boundaries or
weak evidence. Phase class must be repository-policy-required
or explicitly human-ratified; an unratified plan/self declaration can only INCREASE review, never
reduce it; unknown → stronger review or human. Quota admission ≠ cost enforcement; quota-blocked
judgment pauses as attention state. Unchanged retries consume budget without credibility.

### D16 [R3] Stewardship
Run close blocks on: recorded retain-or-clean disposition (D9; execution authority-bound),
retire-superseded within changed scope where authorized+safe (else disposition), outcome+
orchestration analysis AND source-backed Learning Candidate extraction (D27/P12). Deferrable:
promotion, generalization, simplify (except recorded hazardous-complexity), broader retirement.
Workstream close: D86 unchanged. Session end: checkpoint. Phase: compaction hygiene.

## Cluster E — default context

### D17 [R3] Item-by-item verdicts (table now explicit)
| Item | Verdict |
| --- | --- |
| AGENTS.md router table + load-by-task | KEEP (discovery necessity) |
| AGENTS.md invariants (9 bullets) | KEEP (threat-model/precaution clause: credentials, upstream-push, controller independence) |
| AGENTS.md self-governance section | KEEP |
| 8 subagent/worker tool descriptions (≈222 w) | KEEP (schema/contract facts) |
| Guidelines documenting mechanical behavior (independence-roles-preflight, one-dispatch-lock, acknowledgeInspection, background/collect mechanics) | KEEP (document enforcement) |
| Delegation decision policy (5c0f620) | GRANDFATHER, instantiated: owner=repository owner; observable=D19 receipts review; review=2026-09-15 (exact date — audit fix: no undefined review events); auto-demotes to skill absent renewal evidence |
| Reuse-before-create (0493eee) | GRANDFATHER, same instantiated terms (verified: registry.create has NO scope-overlap preflight — only steering) |
| "Prefer fresh subagents" (worker_dispatch) | KEEP; dedupe candidate with reuse-before-create at review |
| context-checkpoint 4 guidelines (≈93 w) | KEEP (lifecycle-specific, AFK-race-class protection); line-level dedupe check vs system prompt at review |
| Skills index | KEEP; admission authority = harness curation per skill (Decisions 34-35): repo-level skills admitted by distribution choice; user-level skills outside distribution are inventoried as accretion evidence |
| External: goal + AFK-gate blocks | Experiment-scoped; ADMISSION lever owned by Workbench even without authorship: distribute/enable or not; revisit at experiment end |
| External: web-access block | Authorship upstream, ADMISSION local (audit fix): levers = enable/disable in harness config; wrap unavailable upstream; recorded as accretion evidence; revisit if Pi adds per-extension budgets |
No blanket external exemption: each block carries a verdict + review trigger; external rows share
the 2026-09-15 review date, owner=repository owner.
R3 residual honestly scoped: the verdict the human decides is restructure + admission rule +
instantiated grandfather terms; the CLAUSE-LEVEL audit (per-sentence marginal-action and
cheaper-seam tests over AGENTS invariants and tool-description steering clauses) is the FIRST
EXECUTION STEP of that verdict and may demote further clauses — presented as such, not as a
completed audit.

### D18 [R3] Admission policy
Standing text admitted iff (i) changes action at the margin; (ii) documents mechanical enforcement
OR corrects observed failure OR names catastrophic/irreversible threat model; (iii) no cheaper seam
serves the trigger reliably; (iv) named owner + observable AND review/expiry date (review may renew
on evidence; observable alone never grants permanence). Periodic ablation review.

### D19 [R3 — absorbed, stable] Observable
One-sided screening: single-dispatch scopes older than an observation window + retirement state +
human classification; paired with periodic unbriefed-session observation (D77). No under-delegation
claim.

## Cluster F — principles

### D20 [R3 — absorbed, stable] Two-altitude decision
Record: three content types (maxims, detailed principles, provenance notes); every detailed
principle has one PRIMARY home, cross-references free; maxim-only entries acknowledged; number at
recording time.

### D21 [R3] Operational attendedness
R3 resolution + audit conditioning. Two states, truthfully labeled: CONTROL-ATTENDED (controlling
client can currently observe and cancel) vs SESSION-SCOPED (parent alive, control lost). Producer
named (audit fix): the hosting client's session transport (PI WEB web process connectivity) is the
control-presence producer; dynamic labeling and blocking apply ONLY where that producer exists —
in plain terminal sessions no producer exists, no dynamic claim is made, and the real V1
protections remain bounded children + parent-death coupling (Decision 89). Rules where the
producer exists: (1) in-flight bounded children admitted under live control CONTINUE during
transient control loss — admitted attended, finite bounds, die with the parent, cancellable on
reconnect; execution during that window is labeled session-scoped, never attended; (2) NEW
attention-relaxing admissions (auto-continue, new mate-driven continuation, new background
children) are prohibited fail-closed while control is lost; (3) the D7/D8 boundary-equivalence
table carries the clause:
"continuous attention is an owner obligation with explicitly documented enforcement absence" (D89
explicit-absence pattern). Candidate improvement (not V1, human may choose to mandate it):
bounded grace-period pause/cancel of children on control loss. Advisor's stronger position
preserved in dissent #4. Drills: browser disconnect, PI WEB restart, parent shutdown, reconnect,
failed cancellation, child decision while control unavailable.

## Dissent register (post-R2)
1. D5: use-case preset names may still be mentally ranked — irreducible usability hypothesis;
   settle with comprehension evidence.
2. D7: retiring the categorical ladder may weaken pedagogy/migration recognition of the managed
   bundle — preserved retain-levels concern.
3. D11 (reworded per R3): calibration affects escalation quality inside an already mechanically
   admitted envelope; it cannot widen authority. Measure false-escalation and missed-narrowing
   rates.
4. D21 (advisor position preserved): the advisor holds that continuation across disconnect should
   be mechanically gated NOW or called unsupported; the lead proposal instead labels it
   session-scoped truthfully, blocks new admissions fail-closed, and offers grace-period
   pause/cancel as a human-selectable mandate. Unresolved between advisor and lead — human decides
   at D21.
5. Enforcement debt, split per R3: prose-not-enforcement = accepted invariant; no general V1
   resolver = declared limitation; aggregate-budget reserve-and-stop = build prerequisite blocking
   outcome-only admission (D14).
