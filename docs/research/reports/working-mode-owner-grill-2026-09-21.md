# 🤖 Working Mode: owner answers and reopened design

Status: completed ten-question grill. Thomas confirmed the behavioral model at Q10 and deferred
Attention/Checking default settings. This source record includes superseded proposals; the final
outcome below and [Decision 69](../../foundation/decisions.md) distinguish accepted behavior from
open choices. No runtime redesign was implemented or authorized.

## What Thomas actually answered

Source: the current session's original user messages and all three submitted question forms,
not the compaction summary or advisor conclusions. Entry identifiers below are source anchors;
no machine-local session paths or raw session files are committed.

| Source entry | Thomas's answer | What it settles |
| --- | --- | --- |
| `1a1aecb5` | The current Alignment and Checking dials do not do enough; investigate Attention/autonomy and what enters context. | Diagnose real behavior rather than only rename controls. |
| `f8e09d10`, `current_dials` | Selected “Redesign both dials now.” | Revisit semantics before adding a third dial; a real-request A/B capture is not a prerequisite Thomas chose. |
| `f8e09d10`, `third_axis_meaning` | “explain the options” | Not acceptance of the proposed Consultation-only model. |
| `654b7bc6` | Consultation and human attention go together; questions get buried because Thomas does not want to read the whole transcript. Availability includes following live, switching sessions, phone-only, and AFK. | Recoverable questions and availability-sensitive interaction are the problem to solve. |
| `f7f9ebb1`, `mode_model` | “if I'm just vibing or experimenting, it can just go without my attention”; after a signed-off plan, resolving a blocker depends on attention/autonomy; when Thomas is present, asking quickly is better than an advisor choosing the wrong direction. | Alignment and discretion interact; advisor consultation is not preferable to readily available owner judgment. |
| `f7f9ebb1`, `attention_shape` | Selected the four Focused / Switching / Phone / AFK presets. | Use one preset control rather than separate availability and channel fields. |
| `f7f9ebb1`, `alignment_autonomy` | “not sure ties in to question 1” | Stronger Alignment granting more discretion was not accepted. |
| `f7f9ebb1`, `attention_items` | Selected “Yes, always” for every unresolved question requiring Thomas becoming a first-class Attention Item. | This applies in Focused mode too, not only when away or for material blockers. |
| `4fcc4c96`, `interaction_rule` | “in switching or focused mode we can ask more ... in AFK ... it does advisor and in phone mode only real blockers. So it's kind of a scale.” | Switching is not equivalent to AFK; Phone is not an ask-owner-first mode for every uncertainty. |
| `4fcc4c96`, `interaction_rule` | “We don't want to do too much constraints, more guidance”; delete the proposed sixth disclaimer. | Keep mode guidance positive and concise rather than repeating a constraints list. |
| `4fcc4c96`, `autonomy_values` | “I don't like either of them.” | Proposed Owner / Advised / Delegated controls were rejected; no replacement was selected. |
| `4fcc4c96`, `vibe_boundary` | “I think any local ver word, but I don't like the word vibe” | The transcription points toward any local work and clearly rejects the name Vibe; the exact local-work commitment boundary still needs a concrete scenario. |
| `081637b6` | “We want to keep it simple but give the agent proper guidance.” | Astra/Fable advice supports owner judgment rather than replacing it. |

Thomas then requested persistence and compaction while AFK, returned for a catch-up, and reopened
this design for a bounded grill. No redesign was approved during the AFK interval.

## What the advisors proposed, not what Thomas approved

- Alignment: Direct / Plan / Spec; remove Vibe and Align.
- Attention: Focused / Switching / Phone / AFK, as Thomas already selected.
- Checking: Evidence / Challenge; remove unset and a separate tests tier.
- Use bounded advice for material AFK judgments rather than every tactical uncertainty.
- Disagreement: ship AFK guidance first versus wait for an inspectable attention surface.
- Question lifecycle still needs precision: an advisor's provisional choice must not silently
  count as Thomas answering a required owner question.

The previous catch-up narrowed the remaining decision too far. The AFK delivery choice is not the
only unresolved product choice: Direct's boundary, Plan versus Spec, Checking, and advisor
resolution still need confirmation. Advisor consensus is not owner acceptance.

## Existing documentation and tension

- [Working Mode](../../foundation/working-mode.md#alignment) defines Vibe as ordinary chat,
  Align as confirmation before semantic commitment, Plan as accepted task direction, and Spec as
  accepted behavior, constraints, and evidence. It still defines only two axes.
- [Vocabulary](../../foundation/vocabulary.md) already defines Human Attention, Attention Item,
  Alignment, Checking, and Working Mode. Reuse these entries rather than create another glossary.
- [Decisions](../../foundation/decisions.md), especially 69, 82, 91, and 104, record the prior
  accepted controls, terminal scope, durable Human Task answers, and skill-discovery trial.
- The active global instruction separately asks for direction before uncertain product,
  architecture, scope, or quality choices become durable or parallel work. Renaming Vibe to Direct
  alone cannot remove that conflicting expectation. This is a prompt-level conflict, not a
  mechanical mutation lock.
- [Workstream Store](../../../packages/workstream-store/README.md#records) already persists typed
  Human Tasks, answers, and receipts. [Interfaces](../../contracts/interfaces.md#workstream-surfaces)
  describes the later Workstream surface and explicitly separates Human Tasks from future managed
  Run `AttentionItem`s. “Wait for an Attention Item store” was therefore an imprecise framing:
  existing storage, question capture, owner-facing inspection, and managed-Run attention are not
  the same missing capability.

## Grill round 1: Thomas's answers

Source: submitted answers to Q1–Q3 (`grill_q1_direct`, `grill_q2_alignment`,
`grill_q3_checking`). These supersede the corresponding advisor recommendations above.

| Question | Thomas's answer | Accepted direction and remaining precision |
| --- | --- | --- |
| Q1: baseline local discretion | “I think baseline should not add any behavior, It should be stock pi” | Baseline is neutral, not a new draft-first or approval policy. Whether this means neutral Alignment alone or a completely neutral Working Mode default needs clarification. No global instruction removal is inferred. |
| Q2: Plan versus Spec | “I think plan is a persisted plan and spec is with user stories, behaviour etc” | Keep Plan and Spec distinct. Plan must persist, superseding the old no-plan-file design. Spec captures user stories and behavior. Acceptance and revision behavior remain open; no storage format was selected. |
| Q3: Checking levels | Selected Exercise / Test / Challenge | Keep three evidence requirements. The selected option defines Exercise as direct checking, Test as automated proof including adding a test when needed, and Challenge as independent scrutiny in addition to tests. Baseline/default selection is not yet settled. |

These are intended redesign decisions, not implemented behavior. The existing specification and
vocabulary still describe the previous implemented trial; Pia will reconcile them with the
completed owner-confirmed model rather than publish a partially contradictory control contract.

## Grill round 2: Thomas's answers

Source: submitted answers to Q4–Q5 (`grill_q4_stock_scope`, `grill_q5_document_agreement`).

- Q4, scope of stock Pi: “I think we need to figure that out.” Unresolved, not acceptance of
  neutral defaults for all axes or of a clean profile.
- Q5, document agreement: selected “Thomas accepts it before implementation.” Plan/Spec is a
  persisted agreement, not just Pia's working notes. Existing accepted documents can be reused;
  progress and implementation details do not require repeated approval. Material changes while
  Thomas is away remain to be resolved below.

### Baseline analysis, not an owner decision

The current `extensions/working-mode/index.ts` always appends `workingModeSuffix` when its
terminal hook runs. Within the checkout, `renderWorkingModePrompt` also filters the skill catalog
at Vibe/unset. Thus the existing baseline is not an identity transformation of the incoming
prompt. The extension does not remove global or repository instructions at any setting.

Pia recommends a neutral value per axis: when all are neutral, Working Mode leaves the incoming
prompt and skill catalog unchanged; choosing Plan alone adds Plan guidance, not an implicit
Checking or Attention policy. This is the existing configured Pi environment without Working
Mode additions, not a fresh installation with other extensions or instructions removed. Already
loaded instructions remain in conversation history; neutral does not erase them. This proposal
still needs Thomas's confirmation. Question capture and inspection are a separate capability,
not an implicit grant of autonomy from a dial.

## Grill round 3: Thomas's answers

Source: submitted answers to Q6–Q7 (`grill_q6_advisor_discretion`,
`grill_q7_advisor_fallback`).

- Q6: selected “Adapt the approach; preserve the agreed outcome.” While Thomas is AFK, Pia may
  consult an advisor, change an accepted plan's implementation approach, record the reason in the
  persisted plan, and continue. Changing agreed behavior, scope, or acceptance criteria still
  requires Thomas's answer; an advisor does not provide that answer.
- Q7: selected “Use a reversible fallback when available.” If consultation is unavailable or
  inconclusive, Pia may choose a low-cost, reversible local path within the accepted outcome and
  record the choice, uncertainty, and how to undo it. If no such path exists, or the missing answer
  is Thomas's preference, affected work waits while independent work continues.

These choices replace any earlier proposal to require an advisor verdict at every stop or to
freeze all work whenever a consultation fails. They do not answer a still-required owner question.

## Grill round 4: Thomas's answer

Source: submitted answer to Q8 (`grill_q8_question_surface`).

Thomas selected “Guidance and existing question tools first.” The first delivery will persist
owner questions as Human Tasks and ask through existing forms or phone tools. Thomas can ask Pia
for the pending list. A dedicated cross-session inbox is deferred; neither a new store nor an
inbox prototype is a prerequisite for this slice.

This resolves the earlier AFK delivery question in favor of guidance plus existing durable
question tools, not transcript-only guidance. The corresponding Workstream Human Task was
answered at revision 10 and is awaiting resolution after the design is reconciled.

## Q9 cancelled; Thomas restores Align

Q9 was closed without an answer. The full model and all-neutral defaults were not approved.
Thomas then explicitly retained Align: default Pi interprets the request, whereas Align should
actively establish shared understanding, like a very lightweight grill-with-docs, when complexity
makes that necessary. Removing Align because its current implementation is weak was a mistaken
inference, not Thomas's direction.

Align therefore remains distinct from both ordinary request interpretation and a persisted Plan.
The intent is to clarify meaning, not merely request permission to proceed. Pia proposes exposing
consequential assumptions, resolving the important ambiguities, and confirming a concise shared
understanding before implementation. Record lasting decisions in existing docs without requiring
an additional full plan/specification. That operational wording awaits the final question.

## Revised confirmation proposal (Q10)

Nine questions asked, eight answered; one question remains within the agreed limit. Q4's default
scope remains open. No runtime implementation is authorized by this discussion record.

| Axis | Proposed values | Meaning |
| --- | --- | --- |
| Alignment | Default / Align / Plan / Spec | Default adds nothing. Align actively establishes shared understanding through a lightweight grill. Plan requires an accepted persisted plan; Spec requires an accepted persisted specification with user stories, behavior, and acceptance criteria. |
| Attention | Default / Focused / Switching / Phone / AFK | Default adds nothing. Focused asks readily; Switching batches questions; Phone asks only concise real blockers; AFK consults advisors and uses the accepted reversible-fallback rule. |
| Checking | Default / Exercise / Test / Challenge | Default adds nothing. Exercise checks the result directly; Test requires automated proof, adding tests when needed; Challenge adds fresh independent scrutiny. |

Proposed neutral semantics: all Default leaves the incoming prompt and skill catalog unchanged
by Working Mode. Selecting one axis does not silently activate either other axis. Existing Pi
configuration and repository instructions remain; previous instructions in conversation history
are not erased. This is not a clean-profile feature.

The question-capture requirement is separate from the mode default: every still-required Thomas
question is a durable Human Task, answerable through the existing tools, not buried in prose.
A delegated tactical choice is a recorded decision, not an answered owner question. Advisors may
change approach within an accepted outcome, not silently change agreed behavior, scope, or
acceptance criteria. Missing preferences wait; independent work continues.

At this point in the discussion, final confirmation was still required. Neutral Attention/Checking
defaults remained a proposal, not a consequence of retaining Align. A dedicated inbox, saved dial
settings, and managed execution were not included in the proposed first slice.

## Final outcome: Q10 confirmed behavior, deferred defaults

Thomas selected `confirm_behavior_defer_defaults`: “Confirm behavior; leave default settings open.”
Nine questions were answered; Q9 was cancelled. The ten-question budget is exhausted and no
further questionnaire is needed to record this outcome.

Confirmed:

- **Alignment:** Default / Align / Plan / Spec. Default adds no Alignment behavior. Align actively
  clarifies assumptions and confirms outcome, scope, and success criteria for nontrivial work;
  reuse established understanding and record lasting decisions in existing docs without requiring
  a full plan/specification. Plan and Spec are persisted agreements accepted before implementation;
  Spec includes user stories, behavior, and acceptance criteria.
- **Attention:** Focused / Switching / Phone / AFK, with the consultation behavior and AFK
  adaptation/fallback accepted above. No separate Autonomy dial.
- **Checking:** Exercise / Test / Challenge. Test requires automated proof, adding a relevant
  test when needed; Challenge adds independent scrutiny to that proof.
- **Questions and delivery:** first-class owner questions use existing Human Tasks and form/phone
  tools. A new inbox or store is not a prerequisite. A provisional action does not silently
  answer or close a still-required Thomas question.

Still open: Attention and Checking default settings, including whether they expose neutral
Default values and what all-neutral behavior does to the skill catalog. The table in the Q10
proposal above must not be read as approval of those Default values. The replacement discovery
mapping is not selected. A clean Pi profile and changes to global instructions are not authorized.

Pia reconciled the accepted design in [Working Mode](../../foundation/working-mode.md),
[the vocabulary](../../foundation/vocabulary.md), [Decision 69](../../foundation/decisions.md), and
[the delivery plan](../../plans/working-mode.md). These distinguish the confirmed intended behavior
from the unchanged earlier terminal implementation. Runtime implementation awaits a separately
accepted bounded slice; this confirmation is documentation-only.

## Post-grill addition: Orchestration

After completing the grill, Thomas requested a dial for working in the main session, delegating
to subagents, or orchestrating workers that use subagents. Thomas accepted the proposed
`Main / Subagents / Workers` axis with “Yes this sounds good.” This was a separate addition, not
an eleventh grill question.

- Main keeps primary execution in Pia's main session.
- Subagents delegates bounded tasks to fresh subagents; Pia reconciles the results.
- Workers coordinates scope-owning workers that retain context and delegate execution to
  subagents.

Thomas accepted guidance rather than mandatory team creation for trivial work. Main does not
prohibit advisors or independent checks required by Attention or Checking. The existing supported
main → worker → leaf-subagent hierarchy and model-routing rules remain unchanged. Orchestration's
default was not selected. Canonical docs now include this fourth axis; runtime remains unchanged.

## Preview-pipeline approval and parallel contribution advice

Thomas then approved extending the existing preview/audit/explorer pipeline, requesting Sol
workers and Luna-high subagents. Thomas separately requested Fable and Astra workers to propose
what each axis adds. This permits candidate preview work, not activation of the redesigned runtime,
selection of the open defaults, or promotion of an A–G representation.

A Sol worker traced the existing pipeline without edits. Its reusable seam is a separate candidate
preview set written through the immutable audit store and shown by the existing data-driven
`tools/agent-audit/explorer.mjs`. The current runtime renderer and old frozen previews can stay
unchanged. The confirmed selections form 144 combinations (4 × 4 × 3 × 3); a comparison selection
must not be presented as a product default. The existing explorer must stop repeating the whole
preview set in every record before displaying that larger set. Existing explorer tests passed
9/9 during the read-only trace; that is not verification of any new candidate implementation.

Fable (`anthropic/claude-fable-5-1`) and Astra (`openai-codex/gpt-6-astra`) produced separate
proposals. Initial reports exceeded the result limit and were not sufficient evidence. Both
workers then supplied complete bounded summaries of their existing findings. They were parallel
advisors, not a completed independent review of an implementation.

### Common recommendations, not new owner decisions

- Each selected value contributes one concise guidance block; Alignment Default contributes
  no Alignment text. Keep shared question-handling and composition rules in one place.
- Relevant artifacts are references and expectations: accepted Plan/Spec, Human Task IDs,
  test/review evidence, and bounded delegation packets. Do not automatically inject whole
  documents or treat their paths as proof of loaded content.
- Pass accepted boundaries and Checking requirements explicitly in delegation packets;
  RPC children do not receive the current terminal extension's Working Mode suffix.
- Main still permits independent checks; AFK advice cannot supply missing owner acceptance.
  Resolve factual uncertainty locally; keep owner preferences open even when they are not
  urgent enough for a phone interruption.
- Display the open defaults, candidate skill policy, unsent status, and source provenance in
  the existing explorer. Keep runtime activation and representation selection separate.

### Skill-policy disagreement to preserve

Astra recommends ordinary Pi discovery with no per-value catalog changes: Test is not necessarily
TDD, Challenge is not necessarily the full code-review skill workflow, and Align is lighter than
the grilling skill. Fable proposes retaining the existing test/review discovery additions and
considering `to-spec` at Spec after inspecting that skill. Fable also regards removing existing
hiding as a legitimate simpler alternative. Neither proposal is accepted as runtime policy.

For a preview-only first slice, keeping the inherited base catalog and labeling the redesigned
mapping unresolved would isolate guidance without deciding the final skill policy. This is a
proposed preview treatment, not approval to remove current runtime filtering. Do not introduce
neutral Attention/Checking/Orchestration values just to make comparison fixtures convenient.

The proposals also suggested recording every owner question in global/repository instructions.
No such instruction edit is authorized by the preview slice. Provider-request capture can prove
payload inclusion; it cannot by itself prove the model followed the requested behavior.

### Requested execution models

Sol workers can be selected through the existing explicit worker model override. Luna exists in
the installed model catalog, but the current Subagent role policy does not select it and the lead
has no active run-scoped routing overlay. A machine-local overlay was prepared and resolver-tested
for Luna-high subagents and Sol workers, not installed into the lead. Its activation requires the
lead to start with that overlay in its environment. No substitute subagents were launched and no
persistent/global routing policy was edited. The same session also reports loaded-vs-disk harness
drift; do not rely on changed hierarchy rules without restarting the lead.
