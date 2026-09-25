# Working Mode target context: content brief

**Status:** Proposed instruction text for review, not an implemented four-axis runtime. This brief specifies information, not its presentation. The confirmed behavior comes from [Working Mode](../../foundation/working-mode.md), [Decision 69](../../foundation/decisions.md), and [Thomas's answer record](working-mode-owner-grill-2026-09-21.md). Exact candidate strings come from [`working-mode-candidate.ts`](../../../extensions/agent-audit/working-mode-candidate.ts) at `a10e66497d72b8925af1cb9ebed123037d30cb04`.

## The question to answer

For a selected Working Mode value, what instruction would be added to the agent's existing context, what behavior is it asking for, and what evidence would let Thomas judge the wording? The four contributions compose independently. They are proposed replacements for the older two-axis Working Mode guidance, **not** additional instructions to append on top of it. Working Mode configures behavior, not permission, tool access, or model routing.

## The existing context to distinguish from the target

Pi constructs a request from base instructions, context files, active conversation history, and tool definitions. It advertises skill names and descriptions; full skill bodies enter the conversation only when read or explicitly invoked. Extensions may add request-time guidance or transform a request. Workstream records, repository documents, and expected artifact paths do not enter a request merely because they exist.

The current `extensions/working-mode/index.ts` still implements Alignment `Vibe | Align | Plan | Spec` and Checking `unset | light | tests | adversarial`; it appends guidance in terminal and RPC sessions and filters the generated skill catalog only in its hosting checkout's terminal sessions. Its selections are unsaved. The target changes those meanings and adds Attention and Orchestration; it has not been activated.

The saved four-axis preview uses a **2026-09-09 Pi 0.84.3 base**, reconstructed from an older unsent preview: two context-file snapshots, 41 skill descriptions/explicit commands, four tool definitions, and 144 composed candidate prompts. There are zero provider-request records. The separate stock-Pi layer audit (`docs/research/reports/stock-pi-layer-audit-2026-09-23.md` at `507801a930376faca1ea01bf65d244e65ef950d1` on `main`) observed a different 2026-09-23 Pi 0.87.1 lead with 39 pre-filter skill entries and 32 tool definitions; its counts are not a sent-request measurement and cannot be combined with the older base as one request.

## Proposed additions by value

These are the candidate contribution bodies, not accepted final wording. Each saved string also prefixes its body with `Axis — Value:`; the source module holds the exact bytes. Alignment `Default` adds **no Alignment-specific text**.

| Axis | Value | Proposed instruction body |
| --- | --- | --- |
| Alignment | Align | Establish shared understanding through a lightweight grill: expose consequential assumptions, resolve important ambiguities, and confirm the intended outcome, scope, and success criteria. Reuse established understanding and record lasting decisions in existing documentation. |
| Alignment | Plan | Before implementation, persist a plan covering the outcome, approach, boundaries, and evidence, and obtain Thomas's acceptance. Reuse an accepted plan; keep implementation details adaptive. |
| Alignment | Spec | Before implementation, persist a specification with user stories, required behavior, constraints, and acceptance criteria, and obtain Thomas's acceptance. Reuse an accepted specification; implementation strategy may adapt. |
| Attention | Focused | Ask Thomas readily when a quick clarification improves direction; Thomas is following the session. |
| Attention | Switching | Batch questions and make each one self-contained so Thomas can answer without rereading the transcript. |
| Attention | Phone | Ask only real blockers, using concise, self-contained questions through the existing phone tools. |
| Attention | AFK | Consult advisors for material judgment instead of interrupting routinely. May adapt the implementation approach and record the reason while preserving the accepted outcome, behavior, scope, and acceptance criteria. If advice is unavailable or inconclusive, record the choice, uncertainty, and how to undo a low-cost reversible local fallback. Pause affected work when Thomas's preference is required. |
| Checking | Exercise | Inspect or exercise the changed result directly and report the evidence. |
| Checking | Test | Produce automated proof of the changed behavior, adding a relevant test when needed, and report the exact result. |
| Checking | Challenge | Produce automated proof, adding a relevant test when needed, then obtain fresh independent scrutiny. Report unresolved findings and evidence gaps. |
| Orchestration | Main | Perform the primary work in the main session. Required advisors and independent checks remain available. |
| Orchestration | Subagents | Delegate useful bounded tasks to fresh subagents and reconcile their results; do not create a team for trivial work. |
| Orchestration | Workers | When useful, coordinate scope-owning workers that retain context and delegate execution to leaf subagents; keep the supported main → worker → leaf-subagent hierarchy and do not create a team for trivial work. |

The shared candidate guidance is composed once, regardless of selection: “Persist every unresolved question requiring Thomas as a Workstream Human Task and use the existing form or phone tools as Attention directs. Record the question, recommendation, affected work, and any provisional action. Advisor advice or provisional action must not silently answer or close an owner question; reconcile live and durable answers explicitly.” The actual candidate string starts with `Questions:`. The preview also adds a candidate/unsent heading for evidence provenance; that heading is not itself accepted runtime guidance.

## Expected results are not additional prompt bodies

The preview records expected work products separately: Align may record lasting decisions; Plan and Spec require accepted persisted agreements; every Attention value preserves unresolved owner questions as Human Tasks, with Switching batching, Phone using a blocker question, and AFK recording advice or a reversible fallback when used. Exercise needs direct exercise evidence; Test needs automated proof; Challenge adds independent scrutiny and unresolved findings. Subagents and Workers need bounded delegation/scope packets carrying accepted boundaries and Checking requirements. These descriptions are expectations, not proof that a file, answer, test, or delegation exists or was loaded into context.

## Decisions and evidence still missing

- Alignment starts at neutral `Default`. Thomas has not chosen Attention, Checking, or Orchestration defaults, including whether neutral values are needed for Attention/Checking. The first value in a saved combination is not a default.
- The replacement skill-discovery mapping is unchosen. The candidate set preserves the inherited advertised catalog and active tools solely to isolate guidance. The current terminal-only filter remains implemented; neither ordinary Pi discovery nor a new mapping was accepted.
- We have not captured an outgoing request for the target, established extension ordering in a real send, proved which skill bodies were loaded, or observed agent behavior under any target setting. The older frozen base is not today's exact context. A real request capture would require separate consent and repaired instrument checks.

**Review to complete before an interface or runtime slice:** settle whether these exact additions express the confirmed behavior, identify any missing or conflicting instruction, and keep the defaults and discovery decision explicit rather than inventing them. The content brief makes no layout, interaction, or visual choice.
