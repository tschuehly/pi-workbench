# DODOREACH Pi Tool-Shaping Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

Status: research only. No candidate recommendation or decision in this ledger is accepted.

## Verdict

DODOREACH reports using a personal Pi environment built by repeatedly noticing interaction friction,
finding the closest public mechanism, remixing it for one user, and returning the result to daily
use. Public repositories demonstrate several mechanisms; the private guard, widgets, side chat, web
tools, transfer, and UI correctness remain author claims. The strongest lesson for Pi Workbench is therefore not a particular extension. It is the
missing low-latency path from observed friction to a reversible user-local experiment and then to
evidence-backed discard or promotion.

The unaccepted candidate synthesis is to adapt that loop without adding another authoritative record,
another shell, global extension bundles, or model-authored authority. The two highest-value questions are an in-the-moment friction
capture experiment and a measured provider-native compaction experiment. Prompt clarification,
read-only side questions, minimality guidance, and multi-file editing remain narrower candidates.

## Scope and method

The source is the [August 11, 2026 thread](https://x.com/DODOREACH/status/2087134337456083229),
including two opening posts omitted from the supplied eight-post capture and the linked
[July 21 mobile UI prompt](https://x.com/DODOREACH/status/2079645642532462850). The analysis inspected
the linked implementation paths, tests, package metadata, commit history, and retained benchmark
artifacts. Repository revisions are pinned below to the latest relevant revision at the thread's
publication time.

DODOREACH's own read-only side chat, search and batch-fetch package, Papercut tool, destructive-command
guard, status widgets, Tailscale file transfer, and web UI implementation are private. Public
references for those mechanisms are evidence of inspirations or analogues, not evidence of the
private implementations.

## Tool-specific ledgers

Each mechanism received a separate fresh-subagent investigation before this synthesis was finalized:

- [`unified-edit`](dodo-reach-unified-edit.md)
- [`ponytail`](dodo-reach-ponytail.md)
- [`rpiv-ask-user-question`](dodo-reach-ask-user-question.md)
- [`pi-openai-server-compaction`](dodo-reach-openai-server-compaction.md)
- [`pi-clarify`](dodo-reach-pi-clarify.md)
- [`/btw` side chat](dodo-reach-btw-side-chat.md)
- [`supi-web` and the private web-tools approach](dodo-reach-web-tools.md)
- [`papercuts`](dodo-reach-papercuts.md)
- [Pi sandbox and the private destructive-command guard](dodo-reach-sandbox-guard.md)
- [private status commands and widgets](dodo-reach-status-widgets.md)
- [private Tailscale file transfer](dodo-reach-tailscale-file-transfer.md)
- [private mobile Pi web UI and one-shot prompt](dodo-reach-pi-mobile-web-ui.md)

All classifications in those ledgers remain unaccepted research candidates.

## Source snapshots

| Source | Publication-time revision | Demonstrated mechanism |
| --- | --- | --- |
| [`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff/tree/13bc8f87970bec8830aab0f1c0487d35aa7c0917) | `unified-edit.ts` last changed at [`c77d497`](https://github.com/mitsuhiko/agent-stuff/blob/c77d49797ad3fb78888e5b002ae606a93777c6b1/extensions/unified-edit.ts); `btw.ts` at [`a3f8ab1`](https://github.com/mitsuhiko/agent-stuff/blob/a3f8ab1108a48fec9e175f6cd5d9aaa4694ce29d/extensions/btw.ts) | Multi-file row or patch editing; a side AgentSession seeded from the main conversation |
| [`DietrichGebert/ponytail` 4.9.0](https://github.com/DietrichGebert/ponytail/tree/2ed6c52c9d7e5e56942508591085fd45dea277d3) | `2ed6c52`, published 2026-08-07 | Persistent minimum-solution ladder with retained safety obligations |
| [`rpiv-ask-user-question` 2.4.0](https://github.com/juicesharp/rpiv-mono/tree/226ec6e18f94dbed334a76ff907e1759d768b4bb/packages/rpiv-ask-user-question) | `226ec6e`, published 2026-08-03 | Structured live questionnaires across Pi TUI and RPC/ACP hosts |
| [`pi-openai-server-compaction` 0.1.0](https://github.com/algal/pi-openai-server-compaction/tree/8a3de2f3b0c178fdd6f73f2f94172dfc3943e466) | `8a3de2f`, published 2026-07-23 | Hybrid portable text and opaque provider-native compaction |
| [`pi-clarify` 1.0.1](https://github.com/dodo-reach/pi-clarify/tree/4dd69f03e7e8ff77502aecc33e6798af93f6da0a) | `4dd69f0`, published 2026-08-01 | One model call rewrites rough language into a user-reviewed prompt |
| [`supi-web` 4.8.0](https://github.com/mrclrchtr/supi/tree/65ded65c8bd01ffada826ded7cf24d026fe218ba/packages/supi-web) | `65ded65`, published 2026-08-10 | Markdown-first fetch, readable extraction, Context7 lookup, and bounded output |
| [Pi sandbox example](https://github.com/earendil-works/pi/tree/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/examples/extensions/sandbox) | Pi 0.84.1 release `53fa77c`, published 2026-08-07 | OS-level bash confinement through sandbox-exec or Bubblewrap |
| [`papercuts`](https://github.com/treygoff24/papercuts/tree/3f3776b04558d9c8342191938cb8bf7bedb3d745) | `3f3776b`, published 2026-07-16 | Public reconstruction of the private complaint-box idea; attribution to Steve Ruiz remains uncertain |

All inspected external code is MIT or Apache-2.0 at the repository source. Copying or adapting code
would still require preserving the source-specific license and provenance.

## What the sources demonstrate

### Control is improved by better-shaped interruptions

`rpiv-ask-user-question` accepts one to four questions with authored choices, trade-off descriptions,
previews, multiple selection, notes, free text, and cancellation. It uses a tabbed TUI and degrades to
host-native dialogs under RPC or ACP. In non-interactive execution it removes the tool rather than
letting the model call an unusable interaction. Thirty-two focused test files cover schema, execution,
reconciliation, session loading, fallback, state, and rendering.

This is strong evidence for live intake and non-material clarification. It is not an authoritative
judgment mechanism: its answer returns to Model Context and does not create a revision-checked
Workstream record, Attention Item, or controller command.

### Provider-native compaction can preserve more old state by spending more

The OpenAI compaction extension attempts two representations at each compaction boundary: a readable
Pi summary and an opaque OpenAI artifact for compatible future turns. The local path first attempts a
full-branch portable summary, then falls back to Pi's built-in compaction. If both local attempts fail
while remote compaction succeeds, the readable field is only a status placeholder. It clears or gates
continuation state across session transitions and gates replay by model. Its A→B→A model-switch case
can omit the intervening B turn when reusing A's artifact. When the remote call fails, the concurrent
custom portable summary is returned if available; that local path itself falls back from full-branch
portable summarization to Pi's built-in `compact`. Only when the remote and both local attempts fail
does Pi regain control and run its ordinary default compaction path.

Its corrected [product-default benchmark](https://github.com/algal/pi-openai-server-compaction/blob/8a3de2f3b0c178fdd6f73f2f94172dfc3943e466/benchmarks/product-defaults/REPORT.md)
scored 78.0% exact recall for native compaction and 48.0% for Pi 0.80.9 on dense synthetic state,
with full context at 100%. The benchmark's remote/native arm emitted 4.58 times as many output tokens,
cost 2.52 times as much at compaction, and left 29% more billed downstream context. Those figures
exclude the extension's concurrent local-summary call, so total dual-path cost is higher but unmeasured. Five large artifacts were perfect;
three small artifacts were poor. The result demonstrates a higher-spending, high-variance default
policy, not a more efficient representation or general coding-outcome advantage. The extension also
sets `store: true`, persists opaque provider artifacts, and supports Pi `>=0.80.9 <0.81.0`, while the
current Workbench harness runs Pi 0.84.1.

### Prompt clarification is useful precisely because the owner remains editor

`pi-clarify` sends a rough prompt through one provider call under a fixed instruction to compress
terminology without inventing requirements. It writes the result into Pi's editor and requires a
separate owner send; inspection is encouraged but not enforced, and model provenance is lost if the
rewrite is sent as an ordinary user message. Marker parsing has four passing unit tests. Model behavior, scope
preservation, UI integration, usage, and cost are not tested. The extension selects the current or a
pinned model directly and has no Workbench Cognitive Role, Model Effort, quota admission, or receipt.

The interaction is compatible with Workbench only after translation to the proposed Stateless Model
Call boundary. The useful mechanism is the editable pre-send result, not the direct provider call.

### Side conversation isolation requires a stricter authority boundary than the public reference

`agent-stuff`'s `/btw` starts an in-memory AgentSession using the active model and main-session context,
persists side questions and answers as custom session entries, and optionally summarizes the side
thread into the main conversation. Contrary to DODOREACH's private read-only remix, the public
reference grants `read`, `bash`, `edit`, and `write`. It can therefore mutate the project outside the
main conversational path and bypasses Workbench routing and evidence obligations.

One unaccepted Workbench candidate is a tool-free Stateless Model Call when the question needs only
already gathered evidence. Under current Level 1, work requiring tools or iteration remains an
explicit attended Subagent or Worker invocation with a bounded assignment and collected result; a
managed Scout Dispatch and Episode are future concepts. Nothing should enter the lead's Model Context unless the attending owner or lead
explicitly promotes the result.

### Markdown-first web ingestion is proven; the claimed search and batch layer is not

`supi-web` negotiates Markdown or plain text before falling back to Readability and Turndown, makes
relative references usable, bounds model-visible output, and saves complete oversized output for
later reads. It contains six unit-test suites. The linked package has no web-search or batch-fetch
tool; those are private DODOREACH additions. Its public-URL promise also needs stronger local-network
and redirect policy before use as a controlled Workbench capability.

The current attended Pi environment already exposes search, Markdown fetch, batch fetch, bounded
output, and stored content slices. That capability is operational but is not declared and pinned by
the Workbench repository, leaving a reproducibility gap rather than a missing implementation idea.

### Personal minimality guidance has promising but bounded evidence

Ponytail injects a persistent ladder that first asks whether work is needed, then prefers existing
code, standard libraries, native platform facilities, and installed dependencies before new code.
It explicitly retains trust-boundary validation, data-loss handling, security, accessibility, root-
cause diagnosis, and one runnable check for non-trivial logic.

Its [agentic benchmark](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/benchmarks/results/2026-06-18-agentic.md)
reports 54% fewer added lines, 20% lower cost, and 27% lower time over twelve feature tasks on one
repository and one model, with 100% success on twenty adversarial checks. The large savings cluster
around frontend tasks with native controls; irreducible backend tasks converge. The benchmark used
Claude Code, one repository, one model, and four samples per cell. It supports a Pi-only bounded
experiment, not a universal execution rule.

### Better edit ergonomics do not yet justify weaker mutation semantics

`unified-edit.ts` reduces tool schema and turn cost by accepting several files and two edit languages
in one call. It preflights all files and produces a combined diff. It also copies Pi's non-public
fuzzy matcher, has no focused tests, and applies files sequentially without rollback. A later failure
can therefore leave an unreported partial multi-file result. Direct adoption would trade convenience
for weaker mutation attribution and compatibility.

### The mobile UI prompt is a useful acceptance checklist, not a client candidate

The July 21 prompt keeps Pi as the runtime and native-session owner, gives the browser opaque workspace and session IDs,
avoids a second transcript database, pins the SDK to the installed Pi version, uses a fake PI WEB/Pi integration adapter,
reconciles Server-Sent Events, binds to loopback, and specifies CSRF, host, workspace-root, secret,
restart, mobile, and Tailscale tests. The implementation remains private; a photograph only suggests that a surface rendered.

Its strongest requirements can challenge PI WEB integration tests. Building its proposed shell
would violate the settled PI WEB client direction and create a second session interpretation layer.

## Comparison with implemented Workbench reality

Pi Workbench currently has implemented and exercised Workstream persistence, answerable Human Tasks,
attended checkpoints, child Pi execution, durable Worker identity, completion wakeups, model routing,
and a substantial PI WEB integration. Its same-session `compact_and_continue` extension is explicit,
lossy, and tested, but has no comparative retention evidence. The repository test suite passed during
this review.

Workbench is better today at implemented durable Human Tasks, attended checkpoints, idempotency,
model binding, and client ownership; managed Judgment Dossiers and Run judgment remain unimplemented.
The sources are better at low-cost personal adaptation, immediate friction capture, prompt ergonomics,
and compaction evidence. PI WEB already has structured live asks; the questionnaire source is
specifically richer in previews, notes, cancellation semantics, failure vocabulary, and host fallback. The Run Controller,
Continuation Artifact curation, managed sandbox, and Stateless Model Call utility remain specified
or candidate behavior; they must not be credited as implemented alternatives.

## Central lesson: shorten the personal tool-shaping loop

The source's cumulative advantage comes from one repeated loop:

1. friction appears during real attended work;
2. the user or agent records it while evidence is fresh;
3. the closest public mechanism is inspected;
4. a narrow user-local remix is activated reversibly;
5. subsequent sessions reveal whether it helps;
6. the experiment is discarded, retained locally, or proposed for promotion.

Workbench specifies Learning Candidates, skill incubation, runtime-flexible surfaces, and manual
session compounding, but it does not implement this loop end to end. Its current `compound` skill
starts after a meaningful session and requires deliberate evaluation. It has no cheap in-the-moment
friction sensor and no explicit user-local activation, observation, rollback, and promotion path.

The loop belongs in the Level 1 harness and repository-package boundary. It must not become a Run
lifecycle transition, a second authoritative ledger, automatic standing context, or a way for a Pi
session to expand its permissions.

## Unaccepted recommendation candidates

### Adapt: friction capture as working evidence

Add a minimal `add`, `list`, and `resolve` friction capability. Let `skills/compound/` consume selected
open entries as optional evidence. Start with an isolated user-local journal; repository-local mode
requires a separate decision about collaboration and noise.

Validate over five to ten attended sessions using time to record, repeated-friction rate, duplicate
rate, actionable fixes, secret-redaction failures, Human Attention saved, and accepted Learning
Candidates. Preserve current Workstream state, future Run-state ownership, explicit promotion, and expiry.

### Experiment: measure current compaction, then conditionally test provider-native compaction

First apply the source's benchmark method to `compact_and_continue` and a full-context control. Only
if that reveals a material decision-relevant retention gap should a later experiment port or wrap the
provider mechanism for the current Pi version, project-locally and with explicit retention and cost
disclosure. Compare old-state recall, final outcome quality, cost, downstream context, allocation
variability, fallback, tree/resume safety, and portability.

Preserve `compact_and_continue` as the phase seam, attended Workstream checkpoints as cross-session
attention state, Primary Evidence as evidence, and future Continuation Artifacts as curated model
reconstruction inputs.

### Adapt after its governing utility exists: clarify and read-only side questions

Place both interactions behind a Workbench-owned Stateless Model Call with the `mechanics` Cognitive
Role, current quota admission, explicit Model Effort, bounded input and output, abort deadline, usage
receipt, and no tools. Clarification returns an editable draft and never sends automatically. A side
answer remains outside the main Model Context until explicitly promoted.

### Experiment: task-scoped Ponytail guidance

Run paired Pi tasks in representative repositories. Measure acceptance checks, changed lines and
files, dependencies introduced, review findings, rework, tokens, and maintenance consequences.
Retain explicit requirements, accessibility, security, repository verification, and deep-module
design. Reject an always-on global rule unless the cross-repository evidence supports it.

### Experiment only after hardening: unified multi-file edit

Require transaction-like all-or-none mutation or a typed partial-outcome envelope, focused parser and
matcher tests, path-policy tests, and compatibility tests against the current Pi edit implementation.
Do not install the complete `mitsupi` bundle globally.

### Adapt: declare the existing web capability

Pin the operational web capability in the harness and contract-test output bounds, complete-result
retrieval, redirects, local-network access, and malicious content. Distribution and health belong to
the harness; any future managed capability grants belong to repository capability resolution and the
execution/controller boundary, not V1 Dispatch behavior. Do not
adopt `supi-web` as a replacement or attribute the private search and batch features to it.

### Reject: a second web shell

Retain PI WEB as the user-facing protocol client. Import only missing acceptance cases from the
one-shot prompt into the existing PI WEB integration and upstream contribution process.

## Open questions

1. What is the smallest user-local representation for friction that supports deduplication,
   evidence, resolution, expiry, and later evaluation without becoming another authoritative record?
2. Who may activate a personal capability experiment, which capabilities may it receive, how is its
   scope shown, and what mechanically guarantees rollback?
3. What observation window and evidence justify retaining an experiment locally or proposing stable
   harness promotion?
4. Should repository-local friction ever be committed, or should collaboration receive only accepted
   Learning Candidates and fixes?
5. Can provider-native compaction be made compatible with the current Pi version without relying on
   unstable provider or Pi internals, and does it improve real outcomes enough to justify retention,
   opacity, variability, and cost?
6. Which prompt transformations and side questions are admissible Stateless Model Calls, especially
   when their input contains real session or repository data?
7. Does multi-file edit convenience justify a new mutation interface once transaction and partial-
   outcome semantics are explicit?
8. Which acceptance cases from the private UI prompt remain genuinely missing from PI WEB rather than
   already implemented or owned upstream?

## Confidence and limitations

Implementation findings and pinned repository behavior are high confidence. The compaction benchmark
numbers are direct retained evidence with the source's stated limitations. Ponytail's direction is
promising but bounded by its model, repository, runtime, and sample size. Claims about DODOREACH's
private implementations, usage frequency, and outcome quality remain unverified. The central
personal-tool-shaping conclusion is an architectural synthesis that would require a separately
accepted Level 1 experiment to validate.
