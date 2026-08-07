# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pi Workbench serves an individual software developer allocating their attention across concurrent, agent-assisted development work. They move between repositories, worktrees, branches, and interactive Pi sessions and need to resume the right work after interruption without reconstructing state from chat history.

## Product Purpose

Pi Workbench makes attended human–Pi pair programming durable across sessions. Success means the owner can see what changed, what needs their attention, and the next useful continuation, then resume the correct anchored session with minimal context reconstruction.

## Positioning

A Workstream is a finite, cross-project attention container whose sparse, authoritative projection links independently anchored sessions, checkpoints, human tasks, and references. It is neither a chat folder nor an execution-authority boundary.

## Operating Context

The supported V1 experience runs in PI WEB. Workstreams are portfolio-wide and may span machines, projects, repositories, branches, worktrees, and several concurrent sessions. Each interactive session has exactly one home Workstream and one explicit machine/project/workspace anchor. The owner pairs with Pi while attending the session, explicitly reviews checkpoints, leaves or restarts PI WEB, and later resumes or closes the Workstream.

## Capabilities and Constraints

- Workstreams are a top-level, workspace-neutral PI WEB destination.
- The Workstreams home optimizes for resuming the right work rather than monitoring activity or administering containers.
- Starting a session always requires explicit anchor selection and confirmation; no hidden current-workspace inheritance is allowed.
- The Workstream Store remains authoritative. PI WEB consumes its typed protocol and must not infer Workstream state from chat, tool output, or visual state.
- Sessions retain their machine, project, and workspace anchor. Workstreams may contain several sessions with different anchors.
- Checkpointing is explicit and owner-confirmed. V1 has no automatic checkpointing, background semantic work, managed Run authority, or recovery guarantee.
- Browser and PI WEB web-process replacement must preserve Workstream state. Cross-machine portability and concurrent multi-user control are outside V1.

## Evidence on Hand

- Product semantics and lifecycle: `docs/contracts/workstreams.md`
- PI WEB behavior: `docs/contracts/interfaces.md`
- Implemented V1 workflow: `docs/plans/level-1.md`
- Existing Workstreams surface: `packages/pi-web-integration/pi-web-plugin.js`
- Live acceptance evidence: `packages/pi-web-integration/level-1-acceptance-evidence.md`

No customer claims, usage analytics, or validated scale distributions are currently recorded.

## Product Principles

- Restore Human Attention before exposing activity.
- Keep cross-project attention separate from session location and execution authority.
- Make consequential context explicit; never let hidden shell state choose a session anchor.
- Persist concise semantic state and reference evidence rather than duplicating transcripts.
- Preserve PI WEB as the client and Workbench protocols as the source of truth.

## Accessibility & Inclusion

The surface must preserve keyboard operation, visible focus, semantic status communication, coarse-pointer targets, narrow layouts, and PI WEB theme compatibility across loading, empty, failure, reconnect, current, and closed states.
