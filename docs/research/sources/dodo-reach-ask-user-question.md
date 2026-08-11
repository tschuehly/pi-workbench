# `rpiv-ask-user-question` Structured Questionnaire Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

**Research only. No recommendation in this ledger is accepted, and no decision is recorded by it.**
Every candidate below is explicitly labelled unaccepted. Adopting, adapting, experimenting with, or
rejecting any of them requires a separate owner decision recorded in
[`docs/foundation/decisions.md`](../../foundation/decisions.md).

This ledger expands one source referenced by the
[DODOREACH Pi tool-shaping ledger](dodo-reach-pi-tool-shaping.md), which remains the parent analysis
of the surrounding thread.

## Verdict

This is the most carefully engineered mid-session interruption mechanism in the source set. It turns
"the model would otherwise guess" into a bounded, typed, host-portable questionnaire: one to four
questions, two to four authored options each, trade-off descriptions, optional side-by-side previews,
multi-select, free text, per-answer notes, and explicit cancellation. Its lifecycle handling is
better than its UI: it removes itself from the model's tool list when there is no UI, degrades to
host-native dialogs under RPC/ACP, and distinguishes "the user declined" from "the user never saw the
questions" in every failure path — repeatedly and deliberately.

For Pi Workbench the mechanism is a good fit for one narrow purpose and a bad fit for another. It is a
strong shape for **live session attention** during attended Level 1 pairing: reaching a Material
Question without burning a turn on free-form back-and-forth. It is not a judgment-recording mechanism.
Its answer returns to Model Context as a formatted string and creates no revision-checked Workstream
record, no durable answerable Human Task, no Attention Item, and no controller command. Decision 91
and the [Workstream contract](../../contracts/workstreams.md) already draw exactly this line for
PI WEB's existing `ask_user`, and this source sits on the same side of it.

## Source identity

| Field | Value |
| --- | --- |
| Source | [`juicesharp/rpiv-mono`](https://github.com/juicesharp/rpiv-mono), package `packages/rpiv-ask-user-question` |
| Package | `@juicesharp/rpiv-ask-user-question` |
| Version | `2.4.0` |
| Package revision | [`226ec6e`](https://github.com/juicesharp/rpiv-mono/tree/226ec6e18f94dbed334a76ff907e1759d768b4bb/packages/rpiv-ask-user-question), 2026-08-03 — the most recent commit touching this package |
| Monorepo checkout | `main` at `6415990` (2026-08-11) |
| Author | juicesharp |
| License | MIT |
| Pi surface | `pi.extensions: ["./index.ts"]` |

Verified that the package directory is byte-identical between the pinned revision and the `main`
checkout: `git diff --stat 226ec6e HEAD -- packages/rpiv-ask-user-question` is empty. The monorepo has
moved on (its most recent commit concerns `rpiv-pi`/`rpiv-workflow` lane recap), but this mechanism
has not. The parent ledger's pin and this analysis therefore describe identical code.

Peer dependencies: `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` (both `*`),
`@juicesharp/rpiv-i18n` optional. Runtime dependency on `typebox ^1.1.24` and `@juicesharp/rpiv-config`.

## Scope and method

Read in full: `index.ts`, `ask-user-question.ts` (314 lines), `reconcile.ts`, `tool/types.ts`,
`tool/response-envelope.ts`, and `package.json`. Read the relevant sections of `rpc-fallback.ts` and
`config.ts`. Enumerated the test suite by file (`find . -name "*.test.ts"` → **32 files**), which
matches the count the parent ledger reported.

Not executed. The suite is `vitest run` inside a pnpm-style monorepo with cross-package workspace
dependencies; installing and running it was out of proportion to this ledger's scope. Test *coverage
breadth* below is therefore evidence from file names and inspected sources, not from a green run — an
important distinction, and the reason the confidence section separates the two.

## Mechanisms

### M1 — Typed questionnaire schema with hard bounds

**Problem.** A model that asks free-form clarifying questions produces unbounded, unstructured
interruptions, and the answers come back as prose the model must re-interpret.

**Inputs.** `QuestionParamsSchema` (typebox): `questions` array, `minItems: 1`, `maxItems: 4`. Each
question requires `question` (prose, should end in `?`), `header` (chip label, `maxLength: 16`),
`options` (`minItems: 2`, `maxItems: 4`), and optional `multiSelect`. Each option requires `label`
(`maxLength: 60`) and `description` ("what this option means… trade-offs or implications"), plus
optional `preview` markdown — documented and enforced as single-select only.

**State.** No separate questionnaire store. The result returns through the ordinary Pi tool-result path, so content and structured `details` may persist as session evidence when the host persists the Pi session. It is not authoritative Workstream or Run state.

**Actions.** `validateQuestionnaire` runs before anything is shown. Reserved labels `"Other"`,
`"Type something."`, and the `next` sentinel are rejected outright, so the runtime sentinel rows stay
the single source of truth rather than competing with model-authored lookalikes.

**Outputs.** An LLM-facing envelope built by `buildQuestionnaireResponse`:
`User has answered your questions: "<question>"="<answer>". selected preview: … user notes: … You can
now continue with the user's answers in mind.` — plus a structured `details` object carrying
`answers[]`, `cancelled`, and any `error`.

**Failure behavior.** Ten typed error codes: `no_ui`, `no_custom_ui`, `no_questions`, `empty_options`,
`too_many_questions`, `duplicate_question`, `duplicate_option_label`, `reserved_label`,
`session_load_failed`, `stale_module_cache`.

**Authority.** None. The answer enters the model's conversation. Nothing else changes.

**Assumptions and costs.** The model must author good options; a questionnaire with bad options is
worse than a free-form question because it constrains the human to a bad frame. The schema's
`description` fields are long and are standing tool-schema context.

### M2 — Lifecycle reconciliation: remove the tool rather than fail the call

**Problem.** In a non-interactive run, a model that can see an interactive tool will eventually call
it, waste a turn, and receive an error it must interpret.

**Inputs.** `ctx.hasUI` at `before_agent_start`.

**Actions.** `reconcileAskUserQuestionTool` reads `pi.getActiveTools()` and strips
`ask_user_question` from the active set when `!ctx.hasUI`, restoring it when UI returns. It is
idempotent: when the tool is already in the right state it leaves the active set — and sibling tools —
untouched. The in-handler `!ctx.hasUI` guard remains as a documented one-turn backstop in case a
future Pi change reorders the tool-list snapshot ahead of `before_agent_start`.

**Notable deliberate exclusion.** RPC hosts are **not** stripped, because since the dialog-walker
fallback landed the tool genuinely works there; the code comments name the earlier commit
(`872ef1c`) where RPC *was* stripped and explain why that is now wrong. This is a mechanism that
records its own history at the point of decision.

**Authority.** It mutates the active tool set, which is a real capability. Idempotency and the
read-then-diff pattern are what keep it from clobbering other extensions' tool registrations.

### M3 — Host-portable degradation

**Problem.** `ctx.ui.custom()` cannot render in RPC/ACP hosts (VSCode pendant, Zed, Paseo). It resolves
`undefined` without rendering anything.

**Actions.** Two paths. Hosts advertising `ctx.mode === "rpc"` with dialog primitives route to
`runRpcQuestionnaire` up front, skipping the ~560 ms TUI render-graph import entirely; that walker
drives `ui.select()` and `ui.input()` sequentially, question by question. Older RPC builds predating
`ctx.mode` fall through to a backstop: since a TUI questionnaire *always* resolves a
`QuestionnaireResult` (cancellation included), `undefined` uniquely means "host cannot render," never
"user declined."

**The distinction that matters.** `ERROR_NO_CUSTOM_UI` tells the model, in the tool result itself:
"The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat
text instead, without using this tool." The same instruction appears in `ERROR_SESSION_LOAD_FAILED`
and `ERROR_STALE_MODULE_CACHE`. Three separate failure modes, all carrying an explicit
anti-misinterpretation clause. This is the single most transferable idea in the package.

### M4 — Failure-mode engineering around a host bug

**Problem.** Pi's jiti loader (2.7.0) registers a module in its graph cache *before* evaluating it and
does not evict it when evaluation throws. One failed import — e.g. a package manager replacing the
store mid-session — leaves every later import of that specifier resolving to a namespace without the
class, unrecoverably in-process.

**Actions.** `loadQuestionnaireSession()` distinguishes the two shapes: an import throw becomes
`session_load_failed` with the cause appended; a resolved namespace missing the constructor becomes
`stale_module_cache` with the resolved keys listed. Both return a structured envelope naming the
restart requirement instead of leaking a bare `not a constructor` TypeError. A `setTimeout(…, 2000)`
with `.unref()` pre-warms the graph so later on-disk churn cannot poison it.

**Assumptions and costs.** This is Pi-version-specific defensive engineering. It works because the
author diagnosed a specific host bug (issue #107) and wrote the mitigation into the tool's failure
vocabulary.

### M5 — Attention ergonomics inside the questionnaire

Tabbed TUI across questions; a `Type something.` custom-answer row appended to every question
automatically (and widened to the full pane in preview mode); per-answer `notes`; Esc to abandon;
external-editor escape hatch for long input via `getExternalEditorCommand()`; a collapse/expand key
(`ctrl+]` by default, configurable, `"off"` to disable) registered as a raw terminal-input listener so
the toggle still works while the overlay is hidden — and which yields to any overlay stacked on top
rather than toggling from underneath it. Kitty-protocol press/repeat/release are distinguished so a
tap does not immediately reopen the overlay.

Events `ASK_USER_PROMPT_EVENT` and `ASK_USER_BLOCKED_EVENT` are emitted for external listeners (e.g.
notification plugins), carrying redacted question metadata (`hasPreview: boolean` rather than the
preview text) and a blocked/unblocked flag.

## Implementation and test evidence

**Implementation.** Complete and unusually well commented. Every non-obvious branch carries a comment
naming the issue or commit that motivated it (#78, #100, #107, #324, #377, #439/#440, `872ef1c`).

**Test breadth (from file enumeration, not execution).** 32 focused `.test.ts` files:

| Area | Files |
| --- | --- |
| Tool execution, guidance, listeners, session loading | `ask-user-question.{execute,guidance,listener,session-load}.test.ts`, `ask-user-question.test.ts` |
| Lifecycle reconciliation | `reconcile.test.ts` |
| RPC/ACP fallback | `rpc-fallback.test.ts` |
| Schema and envelope | `tool/types.test.ts` (293 lines) |
| State machine | `state/{state-reducer,questionnaire-session,questionnaire-state,row-intent,key-router,external-editor}.test.ts` |
| View components | 12 files under `view/` including overflow, dialog container, and preview layout |
| Packaging discipline | `ship-manifest.test.ts`, `banned-flags.test.ts`, `factory.test.ts`, `config.test.ts` |

Two of these deserve naming. `banned-flags.test.ts` exists to keep pre-1.0.3 boolean answer flags from
returning after they were collapsed into a `kind` discriminator — a test that guards a *design*
decision rather than a behavior. `ship-manifest.test.ts` guards the explicit `files` allowlist in
`package.json`, which enumerates every shipped path rather than shipping the directory.

**What is not evidenced.** Nothing here measures whether structured questions produce better outcomes
than free-form ones, whether models author good options, how often humans pick `Type something.` over
an authored option, or how much Human Attention the mechanism saves or costs. The engineering quality
is demonstrated; the interaction's value is asserted.

## Pi Workbench baseline

**Implemented and exercised.** Pi Workbench registers no additional Workbench-owned
`ask_user_question` extension or tool — that exact name appears only in the generated package index.
It does use PI WEB's existing structured mechanism:

- PI WEB's own structured `ask_user` live-session ask, which the Workbench adapter surfaces. It
  supports one form containing 1–20 questions, up to 12 options per question, option/question detail,
  multi-select, and Custom free text. Decision 92 covers the "immutable live session-attention
  projection [exposing] pending asks with an exact focus command," and
  `packages/pi-web-integration/` implements the projection and navigation state (91 tests passing).
- Durable answerable Human Tasks in `packages/workstream-store/` with declared answer kind
  (yes/no, finite-choice, free-text), options, source-session provenance, materiality, and
  revision-checked idempotent answer records.

The repository suite passed during this review: `npm test` ran eight `node --test` groups totalling
189 tests with 0 failures, plus the model-routing resolver check.

**Specified but unimplemented.** The whole managed-attention layer: Attention Items with category,
urgency, reconciled state, required action, evidence references, and deduplication key
([interface contract](../../contracts/interfaces.md)); In-Run Judgment for Material Questions; the Run
Controller; and Stateless Model Calls (Decision 97 — owner-approved candidate, explicitly "not active
behavior until the utility, routing gate, receipt, and tests in Experiment 1a land").

**The boundary is already drawn, and it is the key baseline fact.** Decision 91 and the
[Workstream contract](../../contracts/workstreams.md) state that a live PI WEB `ask_user` submission
"remains live session attention. It is not copied into a durable Human Task implicitly, and submitting
one does not make a Workstream answer atomic with it." `rpiv-ask-user-question` produces exactly that
kind of live submission. Whatever it offers, it offers on the live-attention side of a line Workbench
has already settled.

**Maturity mismatch.** The source is a mature, heavily tested, multi-host implementation of one
interaction. PI WEB already has a rich structured ask with broader question/option counts, while the
source adds previews, notes, explicit cancellation envelopes, lifecycle reconciliation, and TUI/RPC
fallback engineering. Workbench separately has revision-checked durable Human Task answers. Neither
live ask is itself authoritative Workstream judgment state.

## Honest comparison

| Dimension | `rpiv-ask-user-question` | Pi Workbench today |
| --- | --- | --- |
| Elicitation mechanics for a Material Question | Rich previews, authored trade-off descriptions, notes, free text, cancellation, and multi-host fallback | Already structured: 1–20 questions, up to 12 options, detail, multi-select, and Custom free text |
| Human Attention cost per question | Testable hypothesis: groups up to four questions and discourages back-to-back calls | Also groups a question set into one browser form; comparative cost is unmeasured |
| Persistence and authority | Tool-result content/details may persist in the Pi session, but no revision-checked Workstream judgment record is created | Live ask outcomes remain session evidence; separate Human Task answers are revision-checked, idempotent Workstream records |
| Authority | Equivalent — neither grants any | Equivalent |
| No-attached-browser lifecycle | Removes or reconciles the tool when its host cannot present UI | PI WEB's daemon-owned `ask_user` posts pending browser-form state, terminates the run, and accepts a later submission that wakes the session; it does not require a browser to remain attached |
| Host portability | **Better**: TUI, RPC, ACP, with a documented fallback ladder | PI WEB is the single supported client by Decision 4 |
| Failure honesty | Three distinct "the user never saw this" paths, each instructing the model not to read it as a decline | Invalid sets throw; successful posts return an ask ID and supersession detail. This review did not establish an equivalent three-way never-shown vocabulary |
| Materiality | Worse: every question looks the same; nothing distinguishes a Material Question from a preference | Better: Human Tasks declare materiality explicitly |
| Deduplication / reconciliation | Worse: none | Better in specification: Attention Items carry a deduplication key — but unimplemented |
| Model Context cost | Large schema plus four long prompt guidelines, standing whenever UI is present | Its own structured schema plus one prompt guideline is present in PI WEB sessions; comparative cost is unmeasured |

Where the source is plainly differentiated: previews, notes, cancellation and "the user never saw
this" failure vocabulary, plus portable TUI/RPC fallback. PI WEB already groups structured questions
in one browser form, so comparative Human Attention savings and elicitation quality remain hypotheses,
not demonstrated advantages. The lifecycle designs differ: the source removes or reconciles a tool that its current host cannot
present, while PI WEB deliberately persists daemon-owned pending ask state so the browser may answer
later without pinning an agent run. Neither is simply "no tool," and comparative failure cost is
unmeasured.

Where Pi Workbench is better: everything about what happens *after* the answer. Revision checking,
idempotency, provenance, materiality, receipts, and the explicit refusal to conflate a live ask with a
durable record.

Where evidence is insufficient: whether structured options actually improve decisions. It is equally
plausible that four model-authored options anchor the human onto a frame the model already preferred —
which is precisely the risk that `Independence` exists in the vocabulary to name. Nothing in the
source tests this.

Bias check. **Novelty bias:** 32 test files and meticulous failure engineering are genuinely
impressive and make the *interaction design* feel more validated than it is; none of those tests
measure whether the interaction helps. **Architecture bias:** Workbench's Attention Item model is
richer on paper and entirely unbuilt; that must not be used to wave away a working elicitation surface.

## Unaccepted candidates

None of the following is accepted. Each is a proposal for a future owner decision.

### Unaccepted — adapt: remaining questionnaire affordances, strictly on the live-attention side of Decision 91

**Change.** PI WEB already provides structured elicitation. If Workbench evidence supports a need for
Markdown previews, per-answer notes, richer cancellation/lifecycle states, or equivalent host
fallback semantics, it should extend the existing `ask_user` seam upstream (Decision 76,
upstream-first) rather than add a second question tool. The answer stays live session attention.
Promotion into a durable Human Task remains
a separate, explicit, revision-checked Workstream mutation — never implicit, per Decision 91.

**Owner.** `packages/pi-web-integration/` for the adapter side; PI WEB upstream for the shell
capability; `packages/workstream-store/` unchanged for durable answers.

**Why it could improve the setup.** Concrete previews, notes, and explicit failure states may improve
judgment efficiency or reduce misinterpretation, but PI WEB already batches structured questions and
no direct Human Attention saving has been measured.

**Proving evidence.** Count interruptions per attended session, decisions resolved per interruption,
rate of `Type something.` overrides (a high rate means the model's options were bad), and rework
caused by an answer the human later reversed. Compare against free-form asking on comparable tasks.

**Falsifier.** If the custom-answer override rate is high, the structured frame is not helping — it is
constraining the human to the model's guess.

**Must remain unchanged.** Decision 91's separation. The Workstream Store's six operations. PI WEB as
a client that never owns Workstream state (Decision 4).

### Unaccepted — adopt: the "the user never saw this" failure vocabulary

The strongest idea here is portable and cheap: whenever an attention mechanism cannot reach a human,
say so in the tool result *and* instruct the model not to treat it as a decline. Workbench's
`extensions/subagent/` and `extensions/context-checkpoint/` return typed outcomes; an unreachable-human
outcome deserves the same explicit anti-misinterpretation clause. This is the one candidate that
transfers without any architectural translation.

### Unaccepted — adapt: reconcile interactive tools out of the tool set when no human is reachable

`reconcileAskUserQuestionTool` is a small, idempotent, read-then-diff pattern on
`before_agent_start`. Any future Workbench tool that requires a human should disappear from the tool
list when no human can be reached, rather than failing when called. Note the real cost: mutating the
shared active tool set is a cross-extension side effect, and the source's idempotency discipline is
what makes it safe.

### Unaccepted — reject: adopting the package as a Workbench dependency

Three independent reasons. It brings `@juicesharp/rpiv-config`, optional `@juicesharp/rpiv-i18n`, and
a large `pi-tui` render graph. Its TUI-first design targets a client Workbench does not use — Decision
4 makes PI WEB the user-facing client, and a second elicitation surface would compete with it. And its
jiti/`0.80.x`-era defensive engineering is host-version-specific; the Workbench harness runs Pi 0.84.1.

### Unaccepted — reject: treating a questionnaire answer as judgment authority

An answer returned through ordinary session tooling is not an authoritative Workstream or Run
judgment record. Session evidence may persist, but it cannot gate a transition, satisfy a managed
In-Run Judgment obligation, or substitute for Acceptance (Decision 21). The mechanism *feels*
authoritative because it stops the agent and records a choice; that presentation must not be confused
with revision-checked authority.

### Unaccepted — experiment: does structured elicitation anchor the human?

Before adopting authored options anywhere, test whether they help or merely transfer the model's
frame to the human. Compare answer quality and later reversal rate between authored-option asks and
free-form asks on the same Material Questions. This is the question the source never asks about itself.

## Open questions

1. Which Workbench interruptions are genuinely Material Questions deserving structured options, and
   which are preferences that should not interrupt at all?
2. Does a model-authored option set anchor the human onto the model's preferred framing, and how would
   that be detected other than by the custom-answer override rate?
3. Should a structured live ask ever be promotable to a durable Human Task in one interaction, or does
   Decision 91's separation require two deliberate steps forever?
4. What does "the human is unreachable" mean in PI WEB — is there an equivalent of `ctx.hasUI` that a
   Workbench tool could reconcile against?
5. Is mutating the shared active tool set an acceptable Workbench pattern given that multiple
   extensions register tools, or does it need a Workbench-owned arbitration point?
6. Would a Stateless Model Call (Decision 97) be a better place to *draft* candidate options for a
   human-facing question than the attending lead's own turn — and if so, does the drafted option set
   still count as the lead's judgment?

## Confidence and limitations

High confidence in the mechanism description: the tool registration, reconciler, schema, envelope, and
fallback paths were read in full at a revision verified byte-identical to the pinned one.

Moderate confidence in the test evidence. 32 test files were enumerated and their subjects inferred
from names and from the sources they exercise; the suite was **not executed**, so "32 focused test
files" is a statement about breadth, not about a green run. Anyone acting on this ledger should run
`vitest run` in the package before relying on it.

No confidence — because no evidence exists — in any claim about interaction outcomes: whether
structured questions improve decisions, save Human Attention on balance, or produce better answers
than free-form asking. The engineering is demonstrated; the interaction hypothesis is untested by the
source and untested here.

The Pi Workbench side of the comparison mixes implemented behavior (Human Tasks, PI WEB projection,
189 passing tests) with specified behavior (Attention Items, In-Run Judgment, Run Controller,
Stateless Model Calls). Only the former is a real alternative today.
