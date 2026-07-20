# Pi Workbench vocabulary

Pi Workbench allocates human and model attention across durable project runs. Its language
separates judgment, authority, execution, evidence, and presentation so autonomous work can remain
adaptive without obscuring who decides what.

## Attention and judgment

**Attention Allocation:**
The deliberate placement of human judgment and model capability, effort, context, and independence
where they have the greatest value for the Run.
_Avoid_: Automation level, cost optimization

**Human Attention:**
A human participant's scarce cognitive capacity for establishing shared understanding, resolving
material uncertainty, and judging the realized outcome.
_Avoid_: Human in the loop, manual oversight

**Judgment:**
Evidence-based interpretation or choice where meaning, trade-offs, or consequences cannot be
settled mechanically. A model may produce judgment, but doing so does not grant authority.
_Avoid_: Decision, approval, reasoning

**Shared Understanding:**
The agreed problem model, desired outcome, constraints, language, assumptions, risks, and success
evidence from which the Run proceeds.
_Avoid_: Alignment, context dump, plan

**Human-Attention Contract:**
The Run's agreement about which human judgments are planned, which conditions trigger additional
attention, and which activity should remain autonomously observable.
_Avoid_: Approval flow, notification policy

**Principal Judgment:**
A planned, high-leverage human judgment that brackets autonomous work: approving the intended
direction and authority before mutation, or accepting the realized outcome afterward.
_Avoid_: Gate, checkpoint, sign-off

**In-Run Judgment:**
A conditional human judgment requested during autonomous work when a Material Question or direct
experience of the evolving outcome can materially improve its direction.
_Avoid_: Manual step, routine supervision, interruption

**Material Question:**
An unresolved question whose answer can change the desired outcome, approved impact, important
trade-offs, acceptance basis, or residual risk.
_Avoid_: Any question, clarification

**Attention Item:**
A reconciled, actionable request for human or coordinator judgment tied to the affected work and
its evidence.
_Avoid_: Notification, raw event, alert

## Run and authority

**Run:**
One durable pursuit of an owner-declared outcome under a resolved Workflow Contract.
_Avoid_: Chat, session, job

**Workflow Contract:**
The versioned quality, authority, safety, evidence, and retention envelope governing a Run.
_Avoid_: Prompt, workflow script, execution plan

**Autonomy Envelope:**
The authority granted for autonomous work, bounded by permissions, impact, budget, stopping
conditions, and publication rights.
_Avoid_: Autonomy level, blanket permission

**Controller Lifecycle:**
The invariant progression that governs when judgment, authority, execution, verification,
acceptance, publication, and closure are valid.
_Avoid_: Execution Graph, agent plan

**Acceptance:**
The owner's judgment that the realized outcome and its evidence satisfy the Run's intended result
with understood deviations and residual risks.
_Avoid_: Verification, approval, publication

**Publication:**
An explicitly authorized act that exposes a Run outcome to an external collaboration or delivery
system.
_Avoid_: Acceptance, completion, synchronization

## Adaptive execution

**Semantic Execution Graph:**
The revisioned organization of meaningful task work, dependencies, evidence obligations, and
worker bindings inside the Workflow Contract.
_Avoid_: Controller Lifecycle, command sequence, fixed pipeline

**Cognitive Role:**
The kind of thinking a bounded piece of work requires, such as investigation, synthesis,
challenge, implementation, or independent verification.
_Avoid_: Model name, agent type

**Execution Profile:**
A named policy for matching a Cognitive Role with model capability, effort, continuity,
independence, skills, permissions, and expected evidence.
_Avoid_: Cost tier, model preset

**Model Effort:**
The deliberative capacity allocated to a Dispatch independently of model identity and Model
Context size.
_Avoid_: Model strength, cost tier, context length

**Dispatch:**
One bounded assignment that reaches a synchronization point and returns an Episode.
_Avoid_: Iteration, entire agent session, graph node, prompt

**Work Packet:**
The self-contained objective, authority, source-backed context, constraints, risks, and evidence
obligations supplied to a Dispatch.
_Avoid_: Conversation history, task prompt

**Episode:**
The compact, provenance-bearing account of a Dispatch's outcome, claims, evidence, mutations,
authority needs, and justified continuation context.
_Avoid_: Truth, instruction, state transition, transcript summary

**Coordinator:**
The Pi actor accountable for interpreting owner intent, organizing semantic work, and synthesizing
evidence without mutating the project.
_Avoid_: Controller, implementer

**Worker:**
A Pi actor that retains useful continuity across bounded actions within one semantic scope.
_Avoid_: Coordinator, Subagent

**Subagent:**
A fresh Pi actor used for one bounded action where narrow context or independent judgment is
valuable.
_Avoid_: Worker, child conversation

**Scout:**
An authority shape for investigation, planning, audit, reproduction, or disposable prototyping
that may produce evidence but cannot deliver project changes.
_Avoid_: Read-only Worker, preliminary Ship

**Ship:**
An authority shape for attributable project mutation and delivery inside an approved Autonomy
Envelope.
_Avoid_: Worker, implementation recommendation

## Evidence and review

**Judgment Dossier:**
The authoritative reasoning artifact connecting the intended direction before implementation to
the realized system, evidence, deviations, consequences, and residual risks afterward.
_Avoid_: Plan, report, transcript

**Primary Evidence:**
Directly inspectable support for a claim, such as repository state, observed behavior, test output,
or an external source.
_Avoid_: Model confidence, unsupported summary

**Review Surface:**
A task-shaped presentation of the realized outcome, relevant context, evidence, and human actions
needed to make an efficient judgment.
_Avoid_: Dashboard, artifact viewer, chat transcript

**Review Feedback:**
Human judgment or correction attached to the precise outcome, claim, evidence, or behavior it
addresses.
_Avoid_: General chat, unanchored comment

**Learning Candidate:**
A source-backed proposal to promote a lesson from a Run into durable project knowledge or workflow
policy at the narrowest useful scope.
_Avoid_: Memory, automatic rule, retrospective note

## Context

**Model Context:**
The disposable working set assembled for one Pi actor from its Work Packet, resolved skills,
referenced Episodes, and relevant evidence.
_Avoid_: Run state, project knowledge, full history

**Continuity:**
Intentional preservation of a Pi actor's working context across related bounded actions in one
semantic scope.
_Avoid_: Durability, resumption

**Independence:**
Intentional separation from prior conclusions so a judgment or verification is not anchored by the
work it evaluates.
_Avoid_: Freshness, isolation
