# Pi Workbench Working Mode

Status: Thomas confirmed the behavioral model on 2026-09-21, chose starting values on
2026-09-24, and settled the channel, AFK, question, delivery, and skill-discovery points on
2026-09-25. `extensions/working-mode/` implements it. [Decision 69](decisions.md) records the
accepted direction.

Working Mode configures how Pia establishes Shared Understanding, uses Thomas's attention,
checks a result, and distributes primary execution. It provides guidance, not permission or a
mechanical mutation gate.

## Alignment

The confirmed values are `Default | Align | Plan | Spec`.

| Value | Shared-understanding behavior |
| --- | --- |
| `Default` | Add no Alignment-specific behavior. Ordinary Pi interpretation and the existing session instructions remain. |
| `Align` | Before the first edit, delegation, or long-running job on nontrivial work, state outcome, scope, assumptions, and success check in at most five bullets and wait for Thomas's confirmation; then deliver one bounded slice with evidence at a time. |
| `Plan` | Persist a plan covering the outcome, approach, boundaries, and evidence; obtain Thomas's acceptance before implementation. |
| `Spec` | Persist a specification with user stories, required behavior, constraints, and acceptance criteria; obtain Thomas's acceptance before implementation. |

Align is active clarification, not merely permission to proceed. For nontrivial work, Pia should
check that Thomas and Pia mean the same thing rather than silently interpreting the request.
Reuse understanding already established. Record lasting decisions in existing docs without
requiring a full plan or specification for every Align task.

Plan and Spec are persisted agreements, not only conversational context or Pia's private working
notes. Reuse an existing accepted document rather than recreating it. Pia may maintain progress
and implementation details without repeated approval. Attention determines how new questions are
handled; it does not turn advisor judgment into Thomas's acceptance of a different outcome.

Default adds no new draft-first or ask-first rule. The commitment-boundary and bounded-slice rules
live in Align, not in global instructions, so Default no longer stops to confirm. It does not
remove repository or conversational instructions. A clean Pi profile is not part of this design.

## Attention

Attention controls consultation and how Pia reaches Thomas. The confirmed presets are
`Focused | Switching | Phone | AFK`, plus a neutral `Default` that adds no Attention guidance.
They are explicit selections, not device or presence detection: Pia cannot tell whether Thomas is
in the conversation, so the selected value alone chooses the channel.

| Value | Interaction behavior |
| --- | --- |
| `Default` | Add no Attention-specific behavior; existing instructions apply. |
| `Focused` | Thomas is watching: work in short, reported steps and ask one question at a time as soon as it arises. |
| `Switching` | Thomas reads occasionally: keep working on unblocked parts, write only when blocked or finished, then send one status line and a numbered list of decisions with recommended defaults. |
| `Phone` | Ask only real blockers, using concise, self-contained questions through the existing phone tools and never in the conversation, even if Thomas also replies there. Send one update when a milestone finishes or work stops to wait. |
| `AFK` | Never contact Thomas. Consult advisors for material judgment; use the adaptation and fallback rules below. |

Only Phone uses `ask_human` and `notify_human`. Focused and Switching ask in the session
conversation. Thomas switches to Focused when he returns to the conversation.

### AFK adaptation and fallback

Pia may consult an advisor, change an accepted plan's implementation approach, record the reason
in the persisted plan, and continue while preserving the agreed outcome, behavior, scope, and
acceptance criteria. Advice is useful where judgment matters, not a requirement for every tactical
choice.

With advisor backing, Pia may decide product, architecture, scope, or quality questions that the
accepted outcome leaves open, recording the decision, the advice, and how to undo it. In AFK this
replaces the global rule to seek Thomas's direction at such a commitment boundary. It never
changes an outcome Thomas already accepted.

If consultation is unavailable or inconclusive, Pia may choose a low-cost, reversible local path
within the accepted outcome. Record the choice, uncertainty, and how to undo it. If no such path
exists, pause the affected work and list the question for Thomas's return. Independent work
continues.

These rules describe behavior within the existing session and task. They introduce neither a
separate Autonomy dial nor managed execution or recovery. Existing authority requirements remain
separate from the mode guidance.

### AFK starts after alignment

When Alignment is Align, Plan, or Spec, AFK does not start until alignment is reached. Until then
Pia stays interactive in the conversation and prepares: she presents the agreement the Alignment
value asks for (five Align bullets, or a persisted plan or specification) with the checklist she
will follow and a numbered list of every question she can foresee, then waits. After Thomas
confirms, Pia calls `alignment_reached` and the AFK rules apply. Changing the Alignment value asks
for a new agreement. With Alignment Default, AFK starts immediately.

### Questions follow the Attention channel

Open questions for Thomas go through the channel the Attention value selects: the conversation
for Default, Focused, and Switching, the phone tools for Phone. AFK lists them for Thomas's return
in the final message or Workstream checkpoint. Working Mode does not persist questions as Workstream
Human Tasks. Include the question, recommendation, affected work, and any provisional action
needed to understand the choice.

A delegated tactical decision is recorded as a decision. A provisional action or advisor verdict
must not silently close a question that still requires Thomas's answer.

## Checking

The confirmed values are `Exercise | Test | Challenge`.

| Value | Minimum completion evidence |
| --- | --- |
| `Default` | Add no Checking-specific requirement; existing required checks still apply. |
| `Exercise` | Inspect or exercise the changed result directly and report the evidence. This selection alone does not require automated tests. |
| `Test` | Produce automated proof of the changed behavior, adding a relevant test when needed, and report the exact result. |
| `Challenge` | Meet Test, then obtain fresh independent scrutiny of the result. Report unresolved findings and evidence gaps. |

Checking specifies the evidence needed before claiming completion. Attention or Alignment must
not silently lower it. Owner direction, repository policy, or task consequences may require
stronger evidence. If the selected evidence cannot be produced, report the gap rather than claim
it was satisfied. Independent scrutiny does not replace automated proof.

Use [model-orchestration](../../skills/model-orchestration/SKILL.md) for independent routing.
Existing consequence-based checking requirements remain in effect; this redesign does not replace
them with a universal one-review limit.

## Orchestration

Orchestration selects the preferred structure for primary execution. Thomas confirmed the fourth
axis after the grill: `Main | Subagents | Workers`.

| Value | Execution behavior |
| --- | --- |
| `Main` | Pia performs the primary work in the main session. |
| `Subagents` | Pia parallelizes by default: splits each task into independent parts, launches them as parallel background subagents, delegates mechanical volume, and keeps the main session for steering and integration. |
| `Workers` | Pia names the scopes that receive repeated tasks, creates one worker per scope, routes every task in that scope to it, and runs independent workers in parallel. |

This is guidance, not mandatory team creation for trivial work. Workers are useful when repeated
bounded actions in one scope benefit from retained context. The existing supported hierarchy is
main session → worker → leaf subagent; this selection does not add another nesting level or change
child lifetimes.

Main does not prohibit advisors required by Attention or independent checks required by Checking.
Worker continuity is not independent review: independent scrutiny still uses a fresh subagent.
The Orchestration dial selects execution structure; existing model routing selects the bindings.
It starts at `Main`.

## Defaults and delivery boundary

Alignment, Attention, and Checking start at their neutral `Default`; Orchestration starts at
`Main`. Neutral values add no dial-specific guidance and do not cancel existing global or
repository checks or required advisors.

Persisted Plan/Spec documents do not imply persisted dial selections. The first delivery uses
existing question tools rather than a new inbox or store. Repository configuration, a
clean-profile feature, and managed execution are not included.

## Delivery in the session

The redesigned runtime delivers Working Mode as conversation messages, not as a system-prompt
suffix, so a change never invalidates the provider's prompt cache:

- When the selection changed since the last prompt, attach one tagged block to the next prompt.
  It states the complete current selection and the guidance for each non-neutral value, not a diff.
  Returning everything to neutral posts a block that says so.
- Number each block and end it with "This block replaces every earlier `<working-mode>` block."
  Do not use "ignore previous instructions" wording, and never rewrite or remove earlier blocks:
  either would break the cache.
- The blocks are saved in the session, so the transcript records every change. On resume, restore
  the selection from the latest block. After compaction, attach the current block again.
- Message guidance carries less weight than the system prompt; global and repository instructions
  win a conflict. Automated tests prove delivery; whether the model follows the latest block in a
  long session still needs observed use.

## Using `/mode`

`/mode <axis> <value>` sets one axis in the terminal, RPC, or PI WEB; values are case-insensitive.
Argument-free `/mode` opens axis and value pickers in the terminal. The terminal footer shows all
four values. A change applies with the next prompt; `/mode send` delivers it now, starting a turn
when idle or steering a running agent loop, and asks the agent to acknowledge it. Every value is
guidance; no tool, permission, or skill catalog changes. See the
[extension README](../../extensions/working-mode/README.md).

## Skill discovery

Mode-based skill filtering is deferred. Every value advertises the same catalog. The earlier
two-axis trial's checkout-scoped filter was retired with that trial.

## Continuity and evaluation

A Workstream checkpoint remains the fresh-session or next-day re-entry source; persisted task
agreements complement it rather than replace it. The separate `Reconcile and End` trial would
provide a session-local summary and remains unimplemented.

Evaluate the revised guidance through observed use: shared understanding before wrong-direction
work, interruptions appropriate to the Attention selection, discoverable owner questions,
traceable AFK decisions, and evidence that satisfies the selected Checking requirement. See the
[implementation plan](../plans/working-mode.md) for the remaining delivery gate and verification.
