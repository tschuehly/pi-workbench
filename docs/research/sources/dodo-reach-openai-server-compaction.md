# `pi-openai-server-compaction` Provider-Native Compaction Evidence Ledger

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

This extension does something no other source here attempts: it measures a context-management policy
against a control, publishes the numbers, and then argues carefully against over-reading them. On
dense synthetic state-preservation tasks its provider-native compaction recalled 78.0% of exact old
state where Pi 0.80.9's default recalled 48.0%, with a full-context control at 100%. The benchmark's
remote/native arm spent 4.58× the compaction output tokens, 2.52× the compaction cost, and left 29%
more billed downstream context. Those figures omit the installed extension's concurrent local-summary
call, so total dual-path cost is higher but unmeasured. Per-fixture results were bimodal, with five large artifacts scoring perfectly and
three small ones scoring 39, 26, and 28 out of 75.

The mechanism worth studying is not "provider compaction is better." It is the attempted **dual
representation**: at a compaction boundary the extension runs a readable Pi summary and an opaque
provider artifact concurrently, then falls back when either path fails. When local summarization
fails but remote compaction succeeds, the readable field is only a status placeholder, not a
source-backed portable summary. This is useful evidence for a provider-cache seam under same-session
compaction, not a direct Continuation Artifact shape: a Continuation Artifact reconstructs a Logical
Actor in a fresh session from canonical state, material Episodes, and Primary Evidence.

The direct-adoption path is closed today: the package pins `>=0.80.9 <0.81.0` and the Workbench
harness runs Pi 0.84.1. That gap is a fact about compatibility, not a judgment about the idea.

## Source identity

| Field | Value |
| --- | --- |
| Source | [`algal/pi-openai-server-compaction`](https://github.com/algal/pi-openai-server-compaction) |
| Version | `0.1.0` (`"private": true`) |
| Revision inspected | [`8a3de2f`](https://github.com/algal/pi-openai-server-compaction/tree/8a3de2f3b0c178fdd6f73f2f94172dfc3943e466) (`Add product-defaults compaction benchmark`, 2026-07-23) |
| License | MIT |
| Pi surface | `pi.extensions: ["./src/index.ts"]` |
| Pi compatibility | `peerDependencies` pin `@earendil-works/pi-coding-agent`, `-ai`, and `-agent-core` to `>=0.80.9 <0.81.0` |
| Engine | `node >=22` |
| Primary benchmark | [`benchmarks/product-defaults/REPORT.md`](https://github.com/algal/pi-openai-server-compaction/blob/8a3de2f3b0c178fdd6f73f2f94172dfc3943e466/benchmarks/product-defaults/REPORT.md) |

Repository HEAD equals the revision pinned by the parent ledger.

## Scope and method

Read in full: `src/index.ts` (383 lines), `src/state.ts`, `src/config.ts`, `package.json`, and
`benchmarks/product-defaults/REPORT.md`. Read the relevant sections of `src/openai.ts`,
`src/remote-compaction.ts` (1,077 lines), and `src/openai-ws-stream.ts`. Read `VALIDATION.md` and the
structure of `TESTPLAN.md`.

Not executed. `npm test` is `typecheck` plus a 373-line smoke script that resolves an installed Pi
0.80.x from `node_modules`, the npm global root, or a Volta image; `test:live` requires OpenAI
credentials and spends real money. Neither was run. The benchmark numbers below are the author's
retained results.

## Mechanisms

### M1 — Dual representation at every compaction boundary

**Problem.** A provider's server-side compaction artifact is opaque and non-portable: it cannot be
read by a human, replayed to another model, or carried across a provider change. Pi's own summary is
portable but lossy.

**Inputs.** The `session_before_compact` event: `event.branchEntries`, `event.preparation`
(carrying `firstKeptEntryId` and `tokensBefore`), `event.customInstructions`, `event.signal`.

**State.** Three in-memory per-session maps in `src/state.ts` — continuation state (`responseId`,
`modelKey`, `contextLength`), reconstructed remote-compaction state, and observed request shape. The
module comment is explicit that this is deliberately ephemeral: "Persisted remote compaction artifacts
live in Pi session entries; this module only caches the currently active continuation and
reconstructed replay state for the running process."

**Actions.** Both representations are produced **concurrently and independently** via
`Promise.allSettled([generateBestEffortLocalSummary(...), callRemoteCompactionEndpoint(...)])`.
`generateBestEffortLocalSummary` first calls `generatePortableSummary` over the full branch; if that
throws, it calls Pi's built-in `compact` as a second billed local attempt. Only if both local attempts
fail does the outer result become rejected. The remote call sends the full branch as Responses items
with a trailing `{"type": "compaction_trigger"}`.

**Outputs.** When local summarization succeeds, one compaction result whose `summary`,
`firstKeptEntryId`, and `tokensBefore` come from the readable summary, with the opaque artifact under
`details.remoteCompaction`. If local summarization fails while remote compaction succeeds, the
`summary` field becomes `buildCompactionSummaryText()` — a status sentence, not a source-backed
portable account.

**Failure behavior — the well-designed part.** Three ordered fallbacks. If the remote call fails but
the local summary succeeded, return the local summary alone. If both failed, notify the human
(`"OpenAI remote compaction failed; falling back to default compaction"`, suppressed when aborted or
UI-less) and return `undefined`, which hands control back to Pi's default compaction. If only the
local summary failed, synthesize a placeholder summary text and still attach the remote artifact. At
no point does a remote failure lose the session.

**Authority.** It replaces the compaction *representation*, not any transition. Pi still decides when
to compact and which entries to keep.

**Assumptions and costs.** The opaque artifact is retained in Pi session entries — durable, unreadable
state. `applyPayloadPatch` sets `store: true` whenever the model supports it, meaning provider-side
retention of conversation state. Both are disclosure obligations, not implementation details.

### M2 — Compatibility gating and continuity clearing

**Problem.** An opaque artifact is only replayable on a compatible model in a compatible session. A
stale continuation pointer replayed after a fork or a model switch is a correctness hazard.

**Inputs.** Session lifecycle events; the active model.

**Actions.** `clearSessionRuntimeState` (continuation + remote compaction + request shape) fires on
`session_before_switch`, `session_before_fork`, and `session_before_tree`. `model_select` clears only
live continuation; remote state remains cached but model-key gating prevents mismatched replay, and
observed request-shape state is not cleared. `syncRemoteState` re-derives state from the branch after
`session_tree` and `session_compact`;
`session_shutdown` calls `clearAllContinuationState()` and releases every websocket session.
`getMatchingRemoteState` refuses state whose `modelKey` does not match the active model.
`supportsRemoteCompactionModel` admits only direct OpenAI Responses models and OpenAI-Codex Responses
models; `supportsStore` respects a per-model compatibility flag; Azure is opt-in via `includeAzure`.

**Failure behavior.** Unmatched state is omitted for the currently selected model. This is not full
invalidation: an A→B→A round trip can reuse A's cached artifact while deliberately excluding the
intervening B-model turn. `VALIDATION.md` confirms that exclusion. The behavior avoids replaying an
artifact into an incompatible model, but can omit material branch content after returning to the
original model.

**Assumptions and costs.** Correctness depends on the completeness of Pi's session-lifecycle event
set. A future Pi event that changes conversational identity without firing one of these five would
silently break the invariant.

### M3 — Request patching and continuation

`before_provider_request` patches the outgoing Responses payload: `store: true` when supported;
`context_management: [{ type: "compaction", compact_threshold }]` when not already set, where the
threshold defaults to `contextWindow * 0.7` (config `thresholdRatio`, default `0.7`, floor 1000,
fallback 80000); and `previous_response_id` continuation when `usePreviousResponseId` is on (default
true) and the recorded response id matches the active model. `message_end` records the assistant
response id and the branch message count.

Configuration resolves as env override → project `./.pi/openai-server-compaction.json` → global
`~/.pi/agent/openai-server-compaction.json` → built-in default, for `enabled`, `includeAzure`,
`compactThreshold`, `thresholdRatio`, `notify`, `usePreviousResponseId`.

### M4 — The benchmark as a mechanism in its own right

The most reusable artifact in this repository may be its experimental method rather than its code.

**Design.** Three arms — Pi 0.80.9's pinned `prepareCompaction`/`compact` at its real defaults
(`reserveTokens: 16384`, `keepRecentTokens: 20000`, thinking `medium`), the extension's real native
policy, and a full-context control. Difficulty was raised by *density*, not length: filler was
replaced with authoritative state at a fixed ~50,220-token history. Ten chronological epochs per
fixture across five state kinds; 75 deterministically selected questions per fixture; exact scoring
from strict JSON with **no LLM judge**. Calibration on seed 111 fixed densities 180 and 200 *before*
running fresh held-out seeds 301–304. Compaction and evaluation order rotated from fixture
identifiers. Compactors never saw the later questions.

**Headline results.**

| Arm | Correct | Exact accuracy |
| --- | --: | --: |
| Full-context control | 600/600 | 100.0% |
| Pi default compaction | 288/600 | 48.0% |
| Extension-native compaction | 468/600 | 78.0% |

Paired: 262 both correct, 206 native-only, 26 Pi-only, 106 both wrong. Native led in all four held-out
seed aggregates.

**Remote/native-arm resource cost, measured.** The benchmark invokes the remote endpoint arm, not the
installed extension's concurrent `generateBestEffortLocalSummary` path. The table therefore measures
the provider-native arm and is a lower bound on total dual-path extension cost.

| Mean per fixture | Pi default | Native endpoint arm | Ratio |
| --- | --: | --: | --: |
| Compaction input tokens | 39,047 | 67,519 | 1.73× |
| Compaction output tokens | 3,103 | 14,212 | 4.58× |
| Compaction cost | $0.3371 | $0.8483 | 2.52× |
| Evaluation input tokens | 32,969 | 42,691 | 1.29× |

**Where the difference actually appeared.** Oldest epochs 0–4: Pi 0/280 (0.0%), native 182/280
(65.0%). Boundary epoch 5: 48/80 vs 54/80. Newest epochs 6–9: Pi 240/240 (100.0%), native 232/240
(96.7%). Pi's product policy is doing exactly what it says — perfect recent tail, total loss of the
summarized prefix. Native's advantage is deep-history preservation, and it is very slightly *worse* on
the recent tail.

**The variance finding, which the author foregrounds rather than buries.** Five native artifacts above
10K output tokens scored 375/375 (100%). Three below 5K scored 93/225 (41.3%) — *worse* than their
paired Pi results (110/225). Native output size and score correlate at Pearson 0.95 (n=8). So the
aggregate 78% describes a high-variance allocation policy, not a uniformly better compaction.

**The author's own claim map.** The report includes a table separating what was directly tested, what
is inference, and what is not established. Explicitly *not* established: better accuracy at an equal
budget; better information efficiency per token or dollar; that every native compaction beats its Pi
counterpart; that the artifact uses a non-textual representation; that the result generalizes to
ordinary coding sessions, other models, or future endpoint behavior. It also notes that the Codex CLI
itself was never run — the native arm is this extension's reconstruction of Codex-style behavior.

**Self-correction.** The report supersedes an earlier benchmark of the author's own, which had capped
each text summary's `max_output_tokens` after observing the paired native request's realized output —
a post-treatment cap that invalidated its same-budget interpretation. An initial six-fixture run with
reasoning off was discarded after a fidelity audit found Pi's real default is `medium`; the discarded
bundle is deliberately unpublished and excluded from all totals. Total live spend is disclosed:
$24.8606 for the primary design, $27.5039 for the discarded exploration, $52.3645 overall.

## Implementation and test evidence

**Implementation.** 3,399 lines across nine `src` modules, plus `ARCHITECTURE.md` (239 lines).
Complete and coherent; the lifecycle wiring in `index.ts` matches the documented design.

**Automated test evidence is thin, and this is the sharpest asymmetry in the source.** There is no
unit-test suite. `npm test` = `tsc --noEmit` + a 373-line smoke script using `node:assert/strict`
(44 lines referencing `assert`) that resolves an installed Pi and exercises the extension's wiring.
`tests/live/openai-compaction-rpc-live.ts` is a credentialed live test. `TESTPLAN.md` is mostly
*suggested manual tests*. So a 1,077-line remote-compaction module with retention, replay, and
fallback semantics has no focused automated coverage of those semantics.

**Live validation is real but manual.** `VALIDATION.md` reports the live Pi RPC suite passing against
both `openai/gpt-5.6-luna` (direct Responses) and `openai-codex/gpt-5.6-sol` (ChatGPT Codex
subscription backend), covering same-process recall, fork safety, resume/reload, and model-switch
round trips. Its A→B→A case deliberately excludes the B-model turn when the cached A artifact is
reused; this demonstrates model compatibility gating, not complete conversational continuity. One
other result is worth flagging in both directions: a reduced-plaintext replay test
"recovered a generated secret absent from all visible retained history and from the portable Pi
summary." That is impressive continuity evidence — and it is also a precise statement that the opaque
artifact carries content the human-readable summary does not, which is a retention and disclosure
consideration, not only a capability.

**Net.** Benchmark evidence: unusually strong and unusually honest. Implementation-correctness
evidence: weak, manual, and credential-dependent.

## Pi Workbench baseline

**Implemented and exercised.** `extensions/context-checkpoint/` registers the model-facing
`compact_and_continue` tool. Per its README: the model calls it as the final action at a coherent
phase boundary with a summarizer focus directive (≤1,200 characters) and one concrete next phase
(≤800 characters); it must be the only tool call in its batch and returns a terminating result rather
than compacting mid-execution; once settled the extension invokes Pi's compaction API; success injects
a continuation message and starts the next turn; **failure also resumes the model with the diagnostic**
so it can report the failure and decide whether the remaining context suffices; shutdown, replacement,
or reload cancels in-memory requests and suppresses stale callbacks. Its README states plainly that
this is "a same-session, lossy context checkpoint" and "does not create a durable cross-session
handoff, authoritative Workstream state, or a substitute for saving and verifying repository work
before compaction."

Its tests pass: `node --test extensions/context-checkpoint/coordinator.test.mjs` → 6/6. Note that this
target is **not** included in the repository's `npm test` script. The main suite passed separately —
eight `node --test` groups, 189 tests, 0 failures, plus the model-routing resolver check.

Cross-session continuity is a different, implemented mechanism: attended owner-confirmed Workstream
checkpoints in `packages/workstream-store/` with `whatChanged`, `remains`, `next`, and a paste-ready
`nextSessionPrompt` (≤2,000 characters), all owner-correctable before persistence
([Workstream contract](../../contracts/workstreams.md), Decision 85).

The harness runs **Pi 0.84.1** (`pi --version`), and the root `package.json` declares
`@earendil-works/pi-coding-agent: "*"`.

**Specified but unimplemented.** The Continuation Artifact — "a bounded, source-backed projection…
used to reconstruct a Logical Actor in a fresh model session… references rather than replaces the
ledger and Primary Evidence" ([vocabulary](../../foundation/vocabulary.md)) — plus the Context Curator
role, Decision 72 (context rotation at semantic synchronization points), Decision 73 (watching and
curation as separate responsibilities), and Deferred Design Decision 14, which explicitly leaves open
"the exact Continuation Artifact schema, size budgets, pressure thresholds, protected fields, and
reconciliation checks." Nothing of this exists in code.

**Maturity mismatch.** The source has a working, benchmarked compaction policy for one provider on an
old Pi with no unit tests. Workbench has a small, tested, explicitly-lossy same-session compaction tool
with **no comparative retention evidence whatsoever**, and a well-specified but unbuilt curation model.

## Honest comparison

| Dimension | `pi-openai-server-compaction` | Pi Workbench today |
| --- | --- | --- |
| Old-state retention | **Better, measured**: 78.0% vs 48.0% on dense synthetic state; 65.0% vs 0.0% on the oldest epochs | `compact_and_continue` has no retention measurement at all |
| Evidence quality | **Much better**: densities locked before holdout, held-out seeds, full-context control, exact scoring, published claim map, self-correction, disclosed spend | None comparable |
| Cost and predictability | **Remote arm measured and worse**: 4.58× output, 2.52× cost, 1.29× downstream context, bimodal allocation (Pearson 0.95 size↔score, n=8); concurrent local-summary cost omitted, so total extension cost is unmeasured and higher | Unmeasured; only tool-input lengths are bounded |
| Portability | Mixed: local summary is normally produced, but local failure can leave only a status placeholder and the *advantage* lives in the opaque artifact | The same-session summary is human-readable and provider-neutral; its retention quality is unmeasured |
| Human inspectability | **Worse**: the winning representation cannot be read, corrected, or audited | Better: the model's focus directive and Pi's summary are both inspectable |
| Provider coupling | **Worse**: OpenAI Responses only; `store: true`; provider-side retention | Better: none |
| Pi compatibility | **Worse**: pinned `>=0.80.9 <0.81.0`; harness runs 0.84.1 | Current |
| Implementation-correctness evidence | Worse: typecheck + smoke + manual/live only, for 3,399 lines | Better proportionally: 6/6 focused coordinator tests for a much smaller mechanism |
| Fit with Decision 8 (Run state outside model context) | Neutral | Neutral |
| Cross-session handoff | Not addressed | Better: owner-confirmed Workstream checkpoints with `nextSessionPrompt` |

Where the source is plainly better: it *knows* what its policy retains, and Workbench does not. The
78%/48%/100% triple is the kind of evidence Decision 70 ("outcome evidence governs planning") asks for,
and no equivalent exists for `compact_and_continue`.

Where Pi Workbench is better: human inspectability and provider neutrality, and — importantly — it
never claims a retention guarantee it has not measured. Its cost and output predictability are also
unmeasured, so they cannot be credited as advantages. Its README says
"lossy" outright.

Where evidence is insufficient, on both sides: whether any of this changes real coding outcomes. The
benchmark tests exact recall of synthetic state, not whether a session produced better software. The
author says so explicitly. Workbench has measured neither.

Bias check. **Novelty bias:** a rigorous benchmark with a 30-point gap is very persuasive, and the
temptation is to read "78% vs 48%" as "better compaction" rather than "a remote arm that spends 2.5×
more in the benchmark, plus an uncounted local path, and sometimes produces a bad artifact." **Architecture bias:** the Continuation Artifact is elegant,
specified, and unbuilt; using it to dismiss the only measured compaction result available would be
exactly the failure mode this ledger is supposed to avoid.

## Unaccepted candidates

None of the following is accepted. Each is a proposal for a future owner decision.

### Unaccepted — experiment: measure Workbench's own compaction before changing it

**Change.** Before any provider-native work, apply this source's *method* to the mechanism Workbench
already ships. Build a dense state-preservation fixture set, run `compact_and_continue` against a
full-context control, and score exact recall deterministically.

**Owner.** `extensions/context-checkpoint/`, with results as Learning Candidates via
`skills/compound/`.

**Why it could improve the setup.** Workbench currently has a lossy mechanism with an unknown loss
rate. Knowing whether it retains 48% or 90% of old state changes whether provider-native compaction is
worth pursuing at all — and it is far cheaper than porting anything.

**Proving evidence.** Old-state recall by history region, recent-tail recall, cost, and downstream
context, against a full-context control.

**Falsifier.** If `compact_and_continue` already retains most decision-relevant old state on realistic
sessions, the entire provider-native line of inquiry is unnecessary.

**Must remain unchanged.** `compact_and_continue` remains the same-session phase seam; attended
Workstream checkpoints remain the cross-session mechanism; Primary Evidence remains evidence
(Decision 8).

### Unaccepted — experiment: provider-native compaction, project-local and disclosed

**Change.** Only if the measurement above shows a material gap: port or wrap the mechanism for
Pi 0.84.1 and enable it project-locally for selected OpenAI sessions, after explicit retention and
cost disclosure to the owner.

**Owner.** A Workbench extension under `extensions/`; the [harness contract](../../contracts/harness.md)
governs distribution and capability declaration.

**Why it could improve the setup.** Deep-history preservation is exactly what a long attended session
loses today.

**Proving evidence.** Old-state recall, final outcome quality, cost, downstream context, allocation
variability, fallback correctness, fork/resume safety, and portability — the same axes the source
measured, plus the outcome axis it did not.

**Falsifier.** If allocation variance persists (three of eight fixtures produced artifacts *worse* than
Pi's), a dual-path policy with worse aggregate cost and sometimes much worse retention is not a default.

**Must remain unchanged.** A Workbench port would have to require a source-backed readable summary or
fail back to ordinary Pi compaction; the source's status placeholder is insufficient as a portable
account. Provider-side retention (`store: true`) must be disclosed, never silent. No opaque artifact may become authoritative
Run or Workstream state (Decisions 8, 54, 84).

### Unaccepted — adapt: dual representation at the provider-cache seam

The transferable invariant is narrower: a provider-native cache may accelerate same-session
continuity only while a source-backed readable representation remains available and authoritative
state stays elsewhere. Whether such a cache contributes any input to a future Continuation Artifact
requires a separate design for curation, protected fields, Primary Evidence, and fresh-session
reconstruction; this source does not provide that shape.

### Unaccepted — adapt: lifecycle-boundary state clearing

Full clearing on session switch, fork, and tree is a transferable lifecycle boundary. The source's
model-select behavior is not: it clears live continuation but retains model-keyed remote state, so an
A→B→A round trip can reuse A's artifact without the intervening B turn. A Workbench experiment would
need to invalidate or source-reconcile cached state whenever intervening branch content exists rather
than treating model-key compatibility as conversational completeness.

### Unaccepted — reject: adopting the package as-is

It pins `>=0.80.9 <0.81.0` while the harness runs 0.84.1; it is `"private": true` and unpublished; it
depends on OpenAI Responses internals including a `compaction_trigger` item and websocket streaming;
and 3,399 lines of retention/replay logic carry no focused automated tests. Any Workbench use would be
a rewrite against a pinned current Pi, not an install.

### Unaccepted — reject: opaque artifacts as authoritative state

The live validation recovered a secret "absent from all visible retained history and from the portable
Pi summary." Read as a capability that is impressive; read as governance it is a warning. Content that
influences model behavior while being invisible to the owner cannot be Run state, Workstream state, or
Primary Evidence. It is at most a cache in front of the readable representation.

### Unaccepted — adopt: the benchmark method

Difficulty levels declared and locked before the holdout, held-out seeds, a full-context control, deterministic exact scoring
without an LLM judge, a published claim map separating tested from inferred from unestablished, and
disclosed cost. This is the method Decisions 27 and 70 want. It transfers to any Workbench context or
routing change, and it costs nothing to copy.

## Open questions

1. What does `compact_and_continue` actually retain? Without that number, every comparison in this
   ledger is one-sided.
2. Can provider-native compaction be implemented against Pi 0.84.1 without depending on unstable Pi
   or provider internals — and what breaks at the next version of either?
3. Is the measured advantage attributable to the opaque representation, or merely to the remote arm spending 4.58×
   the output tokens? The source states plainly that this is not isolated, and the Pearson 0.95
   size↔score correlation makes allocation the leading explanation.
4. Would a cheaper Workbench-side change — a larger `keepRecentTokens`, a longer summary budget, or a
   deliberately expensive readable summary at phase boundaries — capture most of the benefit while
   keeping portability and inspectability?
5. How should provider-side retention (`store: true`) and opaque durable artifacts be disclosed to the
   owner, and does any repository policy forbid them outright?
6. Does exact recall of old state predict better coding outcomes at all? Neither the source nor
   Workbench has evidence, and this is the question that decides whether any of it matters.
7. Where does the Continuation Artifact boundary sit relative to same-session compaction — is
   compaction a degenerate Continuation Artifact, or a different mechanism that should never be
   conflated with cross-session reconstruction?

## Confidence and limitations

High confidence in the implementation description: the extension entry point, state module, config
module, and lifecycle wiring were read in full at a pinned revision, and the compatibility pin is a
literal `package.json` field.

High confidence in the reported benchmark numbers as *retained evidence*, and unusually high
confidence in the author's framing of them, because the report argues against its own headline more
carefully than most such reports argue for theirs. But the benchmark was not reproduced here: four
held-out seeds, two nested densities, one model (`openai/gpt-5.6-sol`), one run date, dense synthetic
exact-state tasks rather than real coding work, and the Codex CLI never actually invoked.

Low confidence in implementation correctness beyond what typecheck, a smoke script, and manual live
runs establish. A 1,077-line module owning retention, replay, and fallback semantics without focused
automated tests is a real risk, and it is not mitigated by the quality of the benchmark.

The Pi Workbench side of the comparison mixes implemented behavior (`compact_and_continue`, 6/6
passing; Workstream checkpoints; 189 passing tests in the main suite) with specified behavior
(Continuation Artifact, Context Curator, Decisions 72–73, Deferred Design Decision 14). Only the
former is a real alternative today, and its retention properties are unmeasured.
