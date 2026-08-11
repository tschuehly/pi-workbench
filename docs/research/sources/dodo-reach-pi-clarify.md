# pi-clarify Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

## Status of this ledger

Research only. Nothing here is accepted. No recommendation, decision, experiment, or roadmap item
follows from this file, and no owner approval is claimed or implied. The candidate classifications
below are unaccepted options recorded for later deliberation, not a plan. Recording a settled
decision remains the exclusive job of `docs/foundation/decisions.md` after the owner settles it.

## Verdict

`pi-clarify` is a small, honest, single-purpose extension: one model call rewrites a rough prompt
into precise terminology and writes the result into Pi's editor, where the owner remains the editor
and sender. The mechanism that matters is the *pre-send editable draft*, not the direct provider
call. The direct provider call is precisely the part that is incompatible with Pi Workbench, because
it selects a model and spends quota outside Cognitive Role routing, Model Effort declaration, quota
admission, and any receipt.

Evidence quality is thin above the marker parser: model behavior, scope preservation, cost, and
outcome value are untested and unmeasured in the source. This ledger therefore records a candidate
for translation, not for adoption.

## Exact source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/dodo-reach/pi-clarify` |
| Revision inspected | `4dd69f03e7e8ff77502aecc33e6798af93f6da0a` (branch `main`, HEAD at review) |
| Commit date | 2026-08-01 23:31:29 UTC (`2026-08-02 01:31:29 +0200`) |
| Package version | `pi-clarify` 1.0.1 |
| History | Four commits, all dated 2026-08-02 local (`61df60d`, `bf1bf93`, `6645513`, `4dd69f0`) |
| License | MIT, `Copyright (c) 2026 dodo-reach` |
| Author field | `dodo-reach` |
| Files | `extensions/clarify.ts`, `src/marker.ts`, `test/marker.test.mjs`, `package.json`, `README.md`, `LICENSE` |
| Peer dependencies | `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (all optional) |

The referenced thread facts, the surrounding source set, and the wider tool-shaping synthesis live in
[`dodo-reach-pi-tool-shaping.md`](dodo-reach-pi-tool-shaping.md); this ledger deepens only the
`pi-clarify` entry of that table and does not restate the thread.

## Mechanisms

### M1 — Marker and command intake

- **Inputs:** `/clarify <text>`; `/clarify` with the current editor text; or any normal message
  containing the whole-token marker `-clarify` (`CLARIFY_MARKER_RE = /(?:^|\s)-clarify(?=\s|$|[.,;:!?…])/gi`).
- **State:** none. `src/marker.ts` is deliberately free of Pi runtime imports.
- **Actions:** `hasClarifyMarker` detects the marker; `stripClarifyMarker` removes every occurrence,
  repairs spacing before punctuation, and collapses whitespace.
- **Outputs:** the remaining prompt text.
- **Failures:** empty result after stripping produces a usage notification and
  `{ action: "handled" }`, which suppresses the original message rather than sending it.
- **Authority:** the `input` hook intercepts the user's own message before dispatch. Messages with
  `event.source === "extension"` are passed through, so extension-generated input is not recursed on.

### M2 — Model resolution and pinning

- **Inputs:** optional `<agent-dir>/clarify.json` with `{ provider, model }`; otherwise the current
  session model (`ctx.model`).
- **State:** a JSON file under `getAgentDir()` (typically `~/.pi/agent/clarify.json`), written by
  `/clarify model <provider> <model>` and deleted by `/clarify model reset`.
- **Actions:** `resolveRewriteModel` prefers the pinned entry, validated through
  `ctx.modelRegistry.find`, then falls back to the session model.
- **Outputs:** a registry model record, or `null`.
- **Failures:** a pinned-but-missing model, or no model at all, produces an error notification and
  aborts the rewrite. Malformed or partial config JSON is silently treated as absent.
- **Authority:** the extension chooses the model and therefore the spend. Nothing above it declares a
  role, an effort level, or an admission decision.

### M3 — One stateless rewrite call

- **Inputs:** the stripped prompt text and a fixed 10-rule system prompt whose stated job is
  "terminology compression and clarity, not invention" (keep intent, prefer standard terms, preserve
  names/paths/numbers/error text/acceptance criteria, keep the user's language, output only the
  rewritten prompt).
- **State:** none is persisted. The call is a single `complete()` from
  `@earendil-works/pi-ai/compat` with exactly one user message and `cacheRetention: "none"`.
- **Actions:** obtain `apiKey`/`headers`/`env` via `ctx.modelRegistry.getApiKeyAndHeaders(model)`;
  call `complete()`; concatenate text parts; trim.
- **Outputs:** rewritten prompt text, or `null` when the call was aborted.
- **Failures:** missing API key and registry auth failures throw; empty text throws
  `"Clarify returned empty text"`; `stopReason === "aborted"` returns `null` and the caller notifies
  "Cancelled". In TUI mode a `BorderedLoader` supplies an abort signal, so Esc cancels a live call.
- **Authority:** none beyond spending the resolved model. No tools, no session, no file mutation.

### M4 — Editable pre-send result

- **Inputs:** the rewritten text.
- **State:** Pi's editor buffer.
- **Actions:** `ctx.ui.setEditorText(rewritten)` plus the notification "Rewrite ready. Edit if needed,
  then send."
- **Outputs:** editor content the owner must separately send; inspection is encouraged by the UI copy but not enforced, and the agent turn does not start.
- **Failures:** when `setEditorText` is unavailable (non-TUI hosts), the rewrite is only *notified*,
  so the result can be effectively lost in hosts without an editor surface.
- **Authority:** the owner controls whether and what to send. The rewrite is model-generated, but once sent it appears as an ordinary user message unless separate provenance is recorded.

## Implementation and test evidence

- Executed `node --test test/*.test.mjs` in the checkout: **4 tests, 4 pass, 0 fail** (~71 ms).
  All four cover `hasClarifyMarker`/`stripClarifyMarker`: start/middle/end detection, lookalike
  rejection (`pre-clarify`, `please clarify`), stripping with punctuation repair, and repeated
  markers.
- **Untested:** model behavior and scope preservation, the system prompt's ten rules, the
  editor-integration path, `model` subcommand config read/write, error and abort paths, non-TUI
  fallback, usage, latency, and cost. There is no fixture corpus of rough-versus-rewritten prompts
  and no measurement of whether rewrites improve downstream outcomes.
- **README-only claims** not demonstrated by code or tests: that the rewrite "preserves concrete
  details" and "does not invent scope". Those are properties of the system prompt's instructions, and
  the source provides no evaluation of compliance.
- The extension does not read repository files, but the *input it sends* is whatever the owner typed,
  which routinely includes repository paths, error text, and product detail.

## DODOREACH private claim versus public analogue

- `pi-clarify` is not an analogue of something private: it is DODOREACH's own **published** artifact,
  MIT-licensed, inspectable, and reproduced above from source.
- What remains **unverified** is everything around it: how often DODOREACH actually invokes it, which
  model is pinned in their environment, whether rewrites measurably improved their sessions, and the
  claimed cumulative benefit of their personal tool-shaping loop. Those are thread claims, not
  repository evidence.
- No private DODOREACH implementation is required to explain this package; nothing here should be
  used as evidence for the private read-only side chat, search/batch package, Papercut tool, guard,
  widgets, or web UI described elsewhere in the thread.

## Pi Workbench baseline: implemented versus specified

| Workbench capability | Status at this review |
| --- | --- |
| Stateless Model Call boundary (role, effort, quota admission, bounded input/output, abort deadline, receipt) | **Specified, not implemented.** Owner-approved candidate recorded as Decision 97 in `docs/foundation/decisions.md`, explicitly "not active behavior until the utility, routing gate, receipt, and tests in Experiment 1a land." |
| Cognitive Role and model routing policy | **Implemented** as harness routing guidance in `skills/model-orchestration/` and `scripts/pi-role`; consumed by the attended lead and `extensions/subagent/`. |
| Quota admission before scarce spend | **Implemented** for startup/dispatch guidance (`extensions/quota-startup/`, model-orchestration skill), not as a gate around arbitrary provider calls. |
| Prompt-shaping surface owned by Workbench | **Partially adjacent, not equivalent.** `skills/define-goal/` sharpens rough intent into a verifiable objective inside the attended lead, but no general pre-send terminology rewrite exists. PI WEB currently exposes no verified composer-write API equivalent to Pi TUI's `setEditorText`. |
| Repository-declared harness packages | **Absent for this class.** `config/pi-agent-settings.example.json` declares only `retry`; personal extensions live in the machine-local `~/.pi/agent/settings.json`. |

So the honest comparison is between a *working small extension* and a *specified but unbuilt*
Workbench utility. Workbench must not be credited with a routing-governed completion path it has not
yet built.

## Honest comparison

**Where `pi-clarify` is better than the current Workbench setup**

- It exists and runs as a general pre-send transformation. Workbench's `define-goal` skill sharpens
  goal-backed intent but does not provide the same lightweight terminology-compression interaction.
- Its authority boundary for the *result* is exactly right: the model proposes text, the human sends
  it. That matches Workbench's own "models propose, humans and deterministic modules decide" stance
  more cleanly than many richer mechanisms.
- Cost is bounded by construction: one call, one message, no tools, no session, `cacheRetention:
  "none"`, cancellable.
- The pure-helper/runtime split (`src/marker.ts` versus `extensions/clarify.ts`) makes the only
  interesting parsing logic trivially testable, and it is tested.

**Where Pi Workbench is better**

- Workbench's specified boundary would attach a Cognitive Role, Model Effort, quota admission, and a
  usage receipt to exactly this kind of call. `pi-clarify` binds a model directly and leaves no
  auditable trace of role, effort, admission, or spend.
- Workbench treats model output as non-authoritative by default; `pi-clarify` has no notion of
  provenance for the rewrite, so a rewritten prompt enters the session indistinguishable from
  something the owner wrote.
- Workbench has an explicit stance on where private session and repository content may travel;
  `pi-clarify` sends the raw prompt to whichever model is pinned, with no policy and no disclosure.

**Where evidence is insufficient for either side**

- Whether prompt rewriting improves outcomes at all. Neither source nor Workbench has data. The
  plausible failure mode — a rewrite that quietly narrows or widens intent while looking crisper — is
  neither measured nor guarded.
- Whether owners actually re-read rewrites before sending, or rubber-stamp them. The mechanism's
  entire safety argument rests on that behavior.

## Unaccepted candidates

None of the following is accepted, scheduled, or approved.

- **Adapt (candidate):** the *pre-send editable draft* interaction, expressed through the future
  Stateless Model Call utility with the `mechanics` Cognitive Role, explicit Model Effort, quota
  admission immediately before invocation, bounded input and output, an abort deadline, no tools, and
  a receipt exposed to the session. The utility and routing belong to the harness; Workbench-specific
  provenance belongs in its adapter; a reusable graphical composer-write seam belongs upstream in PI
  WEB if needed. Result never sends automatically. Falsifier: rewrites that alter scope, or owners
  sending unreviewed drafts.
- **Reject (candidate):** installing `pi-clarify` as-is into the Workbench harness. Its direct
  `complete()` on a self-selected or pinned model bypasses routing, admission, and receipts, and its
  `<agent-dir>/clarify.json` introduces a second, unrelated model-pinning store next to Workbench
  model routing.
- **Reject (candidate):** the `-clarify` in-message marker as a Workbench convention. Intercepting a
  user message and returning `{ action: "handled" }` silently swallows input; Workbench already has
  explicit commands and skills for intentional invocation.
- **Experiment (candidate):** before building anything, measure whether rewriting helps. A cheap
  falsifiable pilot is a small fixture set of real rough prompts, rewritten once, judged by the owner
  for intent preservation and usefulness. Cost: minutes. It could kill the whole idea early.

## Open questions

1. Is prompt clarification a *Stateless Model Call* at all, given its input is arbitrary owner text
   that may contain repository detail, or does it need an explicit disclosure step first?
2. What evidence would show that a rewrite preserved intent, rather than merely reading better? Is
   any automatic check possible, or is owner review the only viable gate?
3. Should a rewritten prompt be marked as model-shaped in the session record, so later evaluation can
   distinguish owner-authored from model-rewritten intent?
4. Does a rewrite belong before the message at all, or is the same value available more cheaply from
   an existing skill invoked after an ambiguous prompt?
5. PI WEB currently has no verified composer-write API equivalent to `setEditorText`. Which upstream
   client seam, if any, could preserve the source's editable-draft safety boundary?
6. Does `skills/define-goal/` already provide enough sharpening for goal-backed work, leaving a useful
   gap only for ordinary non-goal prompts?
7. Should the existing quota-startup pattern — check once, ask before scarce spend, avoid hard failure
   on telemetry degradation — inform any future clarification surface?

## Confidence and limitations

- **High confidence:** file inventory, revision, license, control flow, system prompt content, marker
  semantics, config location, and the executed test result (4/4 pass). All read from the pinned
  repository source.
- **Medium confidence:** the claim that the editable-draft boundary is the transferable mechanism.
  This is analysis, not measurement.
- **Low confidence / unverified:** any statement about rewrite quality, DODOREACH's actual usage,
  cost in practice, or downstream outcome effects. The source provides no such evidence.
