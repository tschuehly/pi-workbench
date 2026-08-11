# `/btw` Side-Chat Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

## Status of this ledger

Research only. Nothing here is accepted. No recommendation, decision, experiment, or roadmap item
follows from this file, and no owner approval is claimed or implied. The candidate classifications
below are unaccepted options recorded for later deliberation. Settled decisions belong only in
`docs/foundation/decisions.md`, after the owner settles them.

## Verdict

The public `/btw` extension solves a real attention problem: a tangential question can be answered
with full main-conversation context without polluting the main Model Context, and its answer enters
the main conversation only if the owner chooses to inject a summary. That promotion gate is the
valuable mechanism.

Its authority boundary, however, is the opposite of what the DODOREACH thread describes. The public
implementation grants the side session `read`, `bash`, `edit`, and `write`. The extension itself
imposes no read-only or path policy, while effective host permission prompts were not exercised. This
is an attended overlay with mutation-capable tools, not the private read-only mechanism the thread
claims. It has no Workbench routing, bounded child receipt, or mutation attribution. The isolation is
contextual, not an authority boundary.

## Exact source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/mitsuhiko/agent-stuff` (package name `mitsupi`, version 1.6.0) |
| Repository revision at review | `13bc8f87970bec8830aab0f1c0487d35aa7c0917` (branch `main`, 2026-08-10 15:53:35 UTC) |
| File inspected | `extensions/btw.ts` |
| File's last change | `a3f8ab1108a48fec9e175f6cd5d9aaa4694ce29d`, 2026-05-07 15:57:51 UTC, "chore(pi): migrate to earendil packages" |
| Prior change | `2b70e8d`, 2026-04-14, "Restructured stuff for my sanity" |
| License | Apache-2.0 |
| Package manifest | Ships `./extensions/*.ts`, `./skills`, `./themes`, `./commands` as one Pi package |
| README line | "`btw.ts` — `/btw` side-chat popover for quick tangential questions, with thread restore/reset behavior." |
| Changelog line | "Added a redesigned `btw` extension with side chat markdown rendering, tool visibility, deferred session creation, and main-context improvements." |

## Mechanisms

### M1 — Side AgentSession seeded from the main conversation

- **Inputs:** the active model (`ctx.model`), the current thinking level (`pi.getThinkingLevel()`),
  the main session's entries via `buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId())`,
  and the accumulated side thread.
- **State:** an in-memory session (`SessionManager.inMemory()`), held in module-scope
  `activeSideSession` alongside a `modelKey` string.
- **Actions:** `createAgentSession({ tools: ["read", "bash", "edit", "write"], resourceLoader: createBtwResourceLoader(ctx) })`.
  The resource loader reuses the main system prompt with its dynamic date/cwd footer stripped, appends
  a four-sentence `BTW_SYSTEM_PROMPT`, and supplies **no** extensions, skills, prompts, themes, or
  AGENTS files. Seed messages are the main context messages followed by each prior side
  question/answer pair.
- **Outputs:** a live session whose messages are replaced wholesale
  (`session.agent.state.messages = seedMessages`).
- **Failures:** `buildSessionContext` failures are swallowed by a bare `catch` and the side thread
  simply starts empty — a silent context loss. A model change (`modelKey` mismatch) disposes and
  recreates the session, re-seeding from scratch.
- **Authority:** the side session receives mutation-capable `bash`, `edit`, and `write` tools. Whether
  calls require confirmation depends on the created `AgentSession`'s host defaults and was not
  exercised. The extension itself grants no authority, but it also imposes no read-only or path
  policy and provides no mutation attribution.

### M2 — Persistent side thread as custom session entries

- **Inputs:** each completed question/answer pair.
- **State:** `BtwDetails` records — `question`, `answer`, `timestamp`, `provider`, `model`,
  `thinkingLevel`, `usage` — appended as custom entries of type `btw-thread-entry`; resets appended as
  `btw-thread-reset`.
- **Actions:** `pi.appendEntry(...)` after a successful turn; `restoreThread` on `session_start` and
  `session_tree` scans `ctx.sessionManager.getBranch()`, finds the **last** reset index, and replays
  every `btw-thread-entry` after it.
- **Outputs:** a side thread that survives restart and follows session-tree branching.
- **Failures:** entries missing `question` or `answer` are skipped; failed turns are never persisted,
  so an error leaves no record in the session file.
- **Authority:** the side thread is stored in the main session file but is excluded from the main
  model's conversation, so it is durable-but-invisible state.

### M3 — Explicit promotion by summary injection

- **Inputs:** the accumulated thread, formatted as `User: … / Assistant: …` blocks joined by `---`.
- **State:** a second, throwaway in-memory session created with `tools: []`, `thinkingLevel: "off"`,
  and the appended `BTW_SUMMARY_PROMPT` ("Summarize this side conversation for handoff into the main
  conversation. Keep key decisions, findings, risks, and next actions. Output only the summary.").
- **Actions:** on overlay close with a non-empty thread, `ctx.ui.select("Close BTW:", ["Keep side
  thread", "Inject summary into main chat"])`. On injection, the summary is sent with
  `pi.sendUserMessage(...)` (as a follow-up when the main session is not idle), prefixed
  "Summary of my BTW side conversation:", and the thread is reset.
- **Outputs:** one user-role message in the main conversation.
- **Failures:** an empty thread warns and does nothing; abort/error stop reasons raise and are shown
  as notifications; the summary session is always aborted and disposed in a `finally`.
- **Authority:** an attended owner action chooses whether the model-generated summary enters the main
  Model Context. The injection is sent as a user-role message, so its provenance is then lost. The
  discard-by-default interaction is the mechanism worth studying; it is not an authority grant.

### M4 — Overlay with live streaming and tool visibility

- **Inputs:** TUI, theme, keybindings; streamed `AgentSessionEvent`s.
- **State:** `pendingQuestion`, `pendingAnswer`, `pendingError`, `pendingToolCalls`, `sideBusy`,
  `overlayStatus`, `overlayDraft`, plus a 16 ms throttled refresh timer.
- **Actions:** a custom `Container` renders the last six exchanges as Markdown, plus running tool
  calls with `⚙ / ✓ / ✗` status and truncated arguments; Enter submits, Esc closes.
- **Outputs:** an 80%-width top-anchored overlay; draft text is preserved across close/reopen.
- **Failures:** render errors are caught and displayed inline; Markdown failures fall back to
  fixed-width wrapping; a second submit while `sideBusy` warns instead of queueing.
- **Authority:** presentation only.

## Implementation and test evidence

- **No tests exist anywhere in the repository.** A repository-wide search for `*.test.*`, `*_test*`,
  and `test/` directories returned nothing. The evidence for `/btw` is the implementation and the
  author's own daily use, nothing more.
- The extension is 958 lines of TypeScript with substantial UI state; the streaming subscription
  casts events through `as { toolName?: string }`-style shapes, i.e. it depends on event fields not
  guaranteed by the imported types.
- Cost behavior is visible but unmeasured: every recreated side session re-seeds Pi's current branch
  context produced by `buildSessionContext`, plus the retained side thread. That context is
  compaction-aware but has no narrower evidence budget. `/btw` explicitly disposes the session when
  continuing a previous thread so it is "recreated with fresh main context on next submit". No caching strategy is declared, and no usage
  numbers are recorded beyond per-answer `usage` stored in the thread entries.
- Failure paths are handled defensively (aborts, missing responses, error stop reasons, cleanup in
  `finally`), which is real engineering evidence even without tests.
- Workbench's adjacent child-execution mechanism has focused completion-wakeup and progress-log tests
  plus retained smoke evidence. That does not supply a cheap side-question surface, but it makes the
  evidence mismatch explicit: the governed heavier mechanism is exercised; this lighter public
  analogue is not.

## DODOREACH private claim versus public analogue

- The DODOREACH thread describes a **read-only** side chat. That implementation is **private and
  unverified**: no repository, no code, no tests, no usage data were available for inspection.
- `mitsuhiko/agent-stuff`'s `/btw` is a **public analogue only**. It demonstrates the shape of the
  interaction (side session, seeded context, explicit promotion) and is direct evidence of *that*
  code — it is **not** evidence for DODOREACH's private variant.
- The two differ on the single most important axis. The public reference grants `read`, `bash`,
  `edit`, and `write`; the private claim is read-only. Any statement that "the side chat is safe
  because it only reads" describes the unverified private version, not the inspectable one.
- Nothing in this ledger should be cited as evidence about DODOREACH's implementation quality,
  frequency of use, or outcomes.

## Pi Workbench baseline: implemented versus specified

| Workbench capability | Status at this review |
| --- | --- |
| Attended child Pi execution with bounded assignment and collected outcome | **Implemented and exercised:** `extensions/subagent/` plus `packages/pi-execution-adapter/`. This is unmanaged Level 1 tool activity, not a managed Dispatch or Episode. |
| Durable Worker identity | **Implemented:** `packages/worker-registry/`. |
| Stateless Model Call (tool-free bounded completion with role, effort, quota admission, receipt) | **Specified, not implemented** (Decision 97, explicitly not active behavior). |
| Cross-session Workstreams and attended checkpoints | **Implemented:** `packages/workstream-store/`, `packages/workstream-session-coordination/`, `skills/workstreams/`. |
| A tangential-question surface that does not consume the lead's Model Context | **Absent.** Workbench has no `/btw` analogue; a side question today either costs main context or becomes a full Subagent dispatch. |
| Explicit discard-by-default promotion of side output into the lead's Model Context | **Absent.** Episodes and Continuation Artifacts address managed result provenance and reconstruction, not this attended side-output interaction. |

The genuine gap is the *cheap* end: Workbench can spawn a bounded attended child for real work, but has no
low-cost path for "answer this one question from what we already know, and stay out of my context
unless I say so."

## Honest comparison

**Where `/btw` is better than the current Workbench setup**

- It is the cheapest possible answer to "I have a tangent". No Dispatch, no Work Packet, no Episode,
  no worktree — an overlay and a keystroke.
- The promotion gate is explicit and human-owned, and the default is *not* to promote. Workbench's
  spirit agrees; Workbench's tooling does not offer this choice at this granularity.
- Side-thread persistence as custom session entries is well chosen: durable, branch-aware, and
  invisible to the main model. Reset-marker semantics (replay only after the last reset) are simple
  and correct.
- Tool-call visibility inside the overlay is honest UI: the owner can see the side actor acting.

**Where Pi Workbench is better**

- **Current Level 1 attribution.** Workbench child execution uses a bounded assignment, explicit
  routing, visible attended tool activity, and a compact collected result. It still has no managed
  Dispatch, Episode, Logical Actor authority, workspace lease, or sandbox claim. `/btw` provides less
  attribution because mutations are not connected even to a bounded child receipt.
- **Future managed attribution.** Dispatches, Work Packets, Episodes, and Scout/Ship authority are
  specified Level 4 boundaries, not implemented advantages.
- **Context discipline.** Re-seeding the current branch context per side session is an unmeasured
  Model Context cost; the future Work Packet model would bound inputs but cannot be credited today.
- **Injection integrity.** The summary enters the main conversation as a *user* message, so the lead
  cannot distinguish owner intent from a model-generated summary. Workbench treats provenance as
  first-class.

**Where evidence is insufficient**

- Whether a context-seeded side chat answers better than a tool-free completion over already gathered
  evidence. No comparison exists on either side.
- The real cost of re-seeding, and whether it dominates the benefit for short questions.
- Whether owners promote summaries appropriately, or mostly discard side threads.

## Unaccepted candidates

None of the following is accepted, scheduled, or approved.

- **Adapt (candidate):** the *tool-free* side question. A question answerable from already gathered
  evidence would run through the future Stateless Model Call utility (`mechanics` role, explicit
  Model Effort, quota admission, bounded input/output, abort deadline, no tools, receipt). Workbench
  provenance and discard/promotion semantics belong in its adapter; any generic graphical side
  surface belongs upstream in PI WEB. Falsifier: side answers need tools so often that the tool-free
  form is useless.
- **Adapt (candidate):** the *explicit promotion gate* as a general pattern — side output is discarded
  by default, promoted only by owner action, and marked as model-generated when promoted rather than
  injected as a user message.
- **Reject (candidate):** granting a side conversation `bash`, `edit`, and `write`. Under current
  Level 1, tool work belongs in an explicit attended Subagent or Worker invocation with a bounded
  assignment and collected result. A future managed equivalent would use a controller-mediated
  Dispatch and Episode; neither exists today.
- **Reject (candidate):** installing the whole `mitsupi` package to obtain `/btw`. It ships
  extensions, skills, themes, and prompts as one unit; adopting it wholesale would import unreviewed
  global behavior into the Workbench harness.
- **Experiment (candidate):** measure the seeding question directly — same side questions answered
  (a) with full main-context seeding and (b) with a bounded evidence-only prompt — comparing answer
  usefulness and token cost. Cheap, and it decides the design.

## Open questions

1. Which side questions genuinely require main-conversation context, and which are answerable from a
   bounded evidence set the lead already holds?
2. If a side answer is promoted, what provenance must it carry so the lead and later evaluation can
   distinguish it from owner intent?
3. Where does a side thread's durable record belong — the Pi session file (as `/btw` does), the
   Workstream ledger, or nowhere at all?
4. Does a read-only side chat remain useful, or does the first "check the file" request immediately
   push it into Subagent territory? (The private DODOREACH variant claims yes; no evidence supports
   or refutes it.)
5. How would such a surface exist in PI WEB, which is a protocol client and has no TUI overlay?

## Confidence and limitations

- **High confidence:** revision, license, granted tool list, system prompts, entry types, restore and
  reset semantics, promotion flow, failure handling, and the absence of tests. All read directly from
  `extensions/btw.ts` at the pinned revision.
- **Medium confidence:** the assessment that context re-seeding is the dominant cost. Reasoned from
  code, not measured.
- **Unverified:** the side session's effective permission prompts, which depend on the host Pi
  version's `AgentSession` defaults and were not exercised; DODOREACH's private read-only variant in
  every respect; and any claim about how well `/btw` works in practice.
