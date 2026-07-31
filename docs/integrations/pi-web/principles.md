# PI WEB integration principles

Status: working principles for interactive development.

The staged upstream contribution and Workbench adapter work is defined in the
[PI WEB customization plan](customization-plan.md).

## Develop through use

- Improve PI WEB while using it for real work rather than implementing a speculative product plan.
- Let the next capability emerge from observed friction, missing information, or a repeated manual step.
- Prefer a small change that can be experienced immediately over a broad architecture that cannot yet be exercised.
- Treat every interaction as product evidence: what was hard to notice, understand, control, resume, or review?

## Build capability from the bottom up

- Start with concrete capabilities such as clearer session identity, model visibility, bounded delegation, progress presentation, cancellation, and result review.
- Compose proven capabilities into orchestration and durable Runs only after their individual behavior is useful.
- Do not introduce general workflow machinery, broad fan-out, or new abstractions ahead of demonstrated need.
- Keep each capability independently understandable and testable through a small interface.

## Keep the conversation central

- Preserve PI WEB's active conversation as the primary working surface.
- Add orchestration context around the conversation without turning the interface into a control-room dashboard.
- Show the minimum information needed to understand who is working, on what, with which model, and with what result.
- Keep supporting detail progressively discoverable rather than permanently occupying attention.

## Separate activity from required attention

- Make autonomous activity observable without presenting every event as important.
- Clearly distinguish running work, completed outcomes, failures, and requests for human judgment.
- Lead with the action or judgment required from the user; place logs and implementation detail behind it.
- Preserve the user's place and explain what changed after an interruption.

## Make multi-model work legible

- Route work by Cognitive Role, task shape, required independence, and available capability rather than by a permanent model hierarchy.
- Display the model, role, effort, scope, and lifecycle actually used for each bounded piece of work.
- Keep one accountable coordinator or lead responsible for synthesis and the human-facing result.
- Give collaborators bounded, non-overlapping responsibilities and return compact results with evidence rather than entire transcripts.
- Prefer fresh context for independent judgment and continuity only where accumulated context has demonstrated value.
- Fail explicitly when a required model or capability is unavailable; never silently weaken the requested role.

## Treat Pi as the execution runtime

- Run every model-backed role through Pi.
- Use Pi's model runtime, sessions, tools, event stream, cancellation, and usage reporting as the execution primitives.
- Do not make PI WEB launch Claude Code, Codex CLI, Claudex, or another coding-agent harness for Workbench orchestration.
- Treat provider and model details as resolved execution data, not workflow semantics embedded throughout the UI.

## Keep PI WEB a client

- PI WEB presents sessions, orchestration, evidence, and controls; it does not become authoritative Run state.
- Do not infer lifecycle, authority, or completion from chat messages, terminal output, or visual state.
- Submit mutations through typed Workbench operations when those operations exist.
- Keep terminal operation available as the recovery and fallback path.
- Preserve the separation between PI WEB's long-lived session owner and its restartable browser/API processes.

## Contribute generic shell improvements upstream

- Build generic PI WEB improvements—density, navigation, session legibility, responsive behavior, accessibility, and stable plugin seams—in the PI WEB repository.
- Keep Workbench-specific Run, attention, evidence, and authority semantics in the Workbench adapter.
- Prefer documented plugin interfaces and narrow upstream additions over private routes or copied PI WEB source.
- Fork only when an experienced, concrete interaction cannot be expressed through a maintainable upstream seam.

## Keep interfaces deep and narrow

- Introduce a module seam only when behavior genuinely varies or complexity would otherwise spread across callers.
- Hide model resolution, event reconciliation, reconnect handling, and result normalization behind small interfaces.
- Let clients and tests exercise the same interface.
- Use deterministic fakes and recorded event fixtures for UI development so ordinary interface work does not require model calls.

## Design for interruption and concurrency

- Assume multiple sessions or workers can progress while the user focuses elsewhere.
- Use stable identities for sessions, workers, events, artifacts, and revisions.
- Make reconnect and repeated delivery idempotent from the user's perspective.
- Preserve focus, scroll position, drafts, and selected evidence where possible.
- Never let routine background activity compete visually with work that needs judgment.

## Prefer evidence over agent narration

- Present concrete outputs: changed behavior, diffs, tests, screenshots, artifacts, and bounded conclusions.
- Treat agent summaries as claims that should link to inspectable evidence.
- Keep large outputs out of the main conversation and expose them through referenced artifacts.
- Show uncertainty, failure, cancellation, and unavailable capability honestly.

## Maintain interaction quality

- Increase useful information density primarily by reducing unnecessary spacing and chrome, not by shrinking readable text.
- Keep keyboard navigation, visible focus, responsive layouts, reduced-motion behavior, and touch-safe controls intact.
- Use consistent visual treatment for role, model, state, evidence, and required action.
- Verify important UI changes at desktop, tiled-window, and narrow widths.
- Favor calm, concrete status language over alarmist alerts, gamification, or decorative metrics.

## Learn without promoting accidents into policy

- Record which model and execution shape actually helped, including failures, retries, corrections, time, and evidence quality.
- Treat one successful interaction as a learning candidate, not a universal rule.
- Promote UI patterns or orchestration policy only after repeated real use demonstrates their value.
- Preserve the distinction between the experimental `skill-incubator` and stable Workbench capabilities.

## Boundaries that remain fixed

- The deterministic Run Controller owns authoritative lifecycle and state transitions.
- PI WEB never owns project mutation authority or workspace leases.
- Models propose semantic work; deterministic modules own transitions and side effects.
- Credentials, authentication state, sessions, and machine-local configuration are never committed.
- Graphical improvements must not remove the structured terminal fallback.
