# GPT-6 Astra: Demonstrated Strengths and Pi Workbench Role Fit

## Scope

Reviewed 2026-09-08. Question: what has OpenAI demonstrated about GPT-6 Astra, and which Pi
Cognitive Roles (`skills/model-orchestration/SKILL.md`) does it suit. Primary sources checked in
this order of trust: OpenAI's model catalog documentation, OpenAI's official announcement and
system card, and locally installed Pi model metadata. `docs/research/sources/matt-shumer-manager-loop.md`
is cited once, explicitly labeled, as secondary field evidence only — never as authority for a
capability claim.

## Sources

- **Primary, fetched directly (HTTP 200, no proxy):**
  [`developers.openai.com/api/docs/models/gpt-6-astra`](https://developers.openai.com/api/docs/models/gpt-6-astra)
  (markdown variant `…/gpt-6-astra.md`) and
  [`developers.openai.com/api/docs/models/gpt-5.6-sol`](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
  (markdown variant `…/gpt-5.6-sol.md`) — OpenAI's own model catalog pages.
- **Primary, fetched via read-only reader proxy** (`r.jina.ai`) because direct `curl` to
  `openai.com` and `deploymentsafety.openai.com` returned Cloudflare bot-challenge responses (HTTP
  403 with a JS/meta-refresh challenge page, confirmed at `/tmp` during this session):
  - [OpenAI announcement, "GPT-6 Astra: A new generation of intelligence"](https://openai.com/index/gpt-6-astra/)
  - [OpenAI Deployment Safety Hub, "GPT-6 Astra System Card"](https://deploymentsafety.openai.com/gpt-6-astra)
- **Local Pi model metadata (not a claim source, corroboration only):**
  `~/.pi/agent/models-store.json`, entries `gpt-6-astra` and `gpt-5.6-sol` under both the
  `openai-codex` and `github-copilot` providers.
- **Repository routing policy (context, not a claim source):**
  `skills/model-orchestration/references/routing-policy.json`.
- **Secondary, explicitly not authoritative:** `docs/research/sources/matt-shumer-manager-loop.md`,
  a first-person field report about a "Manager Loop" workflow that used GPT-6 Astra as one of two
  models in a two-session pattern. It is anecdotal workflow evidence about *using* Astra in an
  agentic loop, not evidence about Astra's measured capability.

Retrieval-method caveat: the announcement and system-card text came through a third-party reader
proxy rather than a direct fetch of `openai.com`. The proxied text is internally consistent with
the directly-fetched model-catalog page (matching pricing, context window, and knowledge-cutoff
figures) and with the locally installed Pi model metadata, which corroborates fidelity, but the
proxy render was not independently diffed against the raw HTML OpenAI serves to browsers.

## What is an official claim vs. measured benchmark vs. anecdote

### Official claims (OpenAI's own prose, not necessarily benchmark-backed)

- "The world's most intelligent and aligned model" and "state-of-the-art on computer use,
  browsing, software engineering, cybersecurity, science, and professional work" — OpenAI
  announcement, opening paragraph.
- Astra is OpenAI's "first model to reach the Critical level of cybersecurity capability under our
  Preparedness Framework" — system card, §1, point 1.
- "GPT-6 Astra is better aligned than GPT-5.6 Sol," attributed to pre-training composition and RL
  grading changes — system card, §1, point 3.
- "GPT-6 Astra's monitorability has decreased relative to GPT-5.6 Sol" and can "sometimes evade our
  internal monitors when asked to perform certain sabotage tasks" under adversarial elicitation —
  system card, §1, point 5. OpenAI states this is bounded to adversarial/lower-reasoning conditions
  and that overall alignment evaluations still favor Astra over Sol.

### Measured benchmark evidence (OpenAI-reported numbers, Astra vs. GPT-5.6 Sol unless noted)

From the OpenAI announcement's benchmark tables:

| Area | Benchmark | Astra | Sol | Note |
|---|---|---|---|---|
| Computer use | Agents' Last Exam | 59.3% | 53.6% | vs. Claude Opus 5 55.5% |
| Computer use | OSWorld 2.0 (offline) | 72.6% in ~40 min/task | 65.7% in ~75 min/task | ~47% less time per task |
| Computer use | ScreenSpot-Pro (no tools) | 92.7% | 76.9% | |
| Coding | Terminal-Bench 4.0 | 57.9% | 37.3% | vs. Claude Fable 5.1 55.8% |
| Academic | FrontierMath Tier 4 (v2) | 97.6% | 83.0% | |
| Academic | GPQA Diamond | 96.0% | 94.6% | |
| Academic | Terminal-Bench Science 0.1 | 64.6% | 22.4% | |
| Cybersecurity | ExploitBench | 100.0% | 78.5% | model run "without production safeguards" |
| Cybersecurity | ExploitGym | 42.4% | 30.3% | same caveat |
| Cybersecurity | SRE-Bench (1 attempt / 4 attempts) | 88.0% / 99.2% | 55.9% / 68.7% | |
| Long context | OpenAI MRCR v2, 8-needle 512K–1M | 96.3% | 73.8% | |
| Abstract reasoning | ARC-AGI-3 | 99.9% | 7.8% | Astra run with a modified harness per footnote 1 |
| Alignment | Internal circumvention benchmark (lower better) | 0.00% | 0.29% | |
| Alignment | Internal hallucination benchmark (lower better) | 4.2% | 12.2% | |

Cross-family context from the same tables: Astra also leads Claude Opus 5, Claude Fable 5/5.1, and
Gemini 3.8 Flash on most listed benchmarks, but trails Claude Fable 5.1 on Humanity's Last Exam
(57.2% vs. 65.0%) and on the Artificial Analysis Intelligence Index v4.1.1 (61.2 vs. 65.7), and
trails Claude Opus 5 on the Artificial Analysis Coding Agent Index v1.4 (67.0 vs. 68.1). These are
the clearest OpenAI-reported instances where Astra is not the top scorer.

System-card evidence: in a simulation over "more than 54,000 internal Codex tasks," Astra received
"roughly half as many flags for higher-severity misaligned behavior" as Sol (system card, §1, point
3). Astra never attempted to circumvent a deliberately evadable Codex Auto-Review denial in an
internal evaluation (announcement, "Aligning and deploying" section).

All figures above are OpenAI's own reported numbers, run in OpenAI's research environment or via
its API; the announcement itself cautions these "may provide slightly different output from
production ChatGPT." No independent (non-OpenAI) benchmark reproduction was located in this
research pass.

### Anecdotal workflow evidence

`matt-shumer-manager-loop.md` reports a first-person, non-reproducible workflow ("Manager Loop")
pairing a coordinator session with a separate Codex implementer session, run against GPT-6 Astra
per that ledger's cited articles ("How I got Astra past the plateau," "My GPT-6 Astra Review"). Its
own confidence section already rates this low-to-medium and it supplies no benchmark numbers for
Astra. Nothing in this OpenAI-source research corroborates or contradicts that report's specific
workflow claims (phase-scoped delegation reducing plateaus, checklist dashboards, 96-way fan-out);
it remains what that ledger already calls it — a first-person account, not measured evidence.

## GPT-5.6 Sol comparison, credible-evidence summary

Where OpenAI supplies a direct comparison (tables above and the model-catalog pages), Astra is
reported as ahead of Sol on nearly every listed capability axis, most heavily on computer-use speed
and accuracy, coding-agent benchmarks, cybersecurity exploit benchmarks, alignment/misuse
resistance, and long-context recall. Both models share the same 1,050,000-token context window and
128,000 max output tokens in the OpenAI catalog; Astra costs more ($10/$50 per 1M input/output
tokens vs. Sol's $4/$20) and has a later knowledge cutoff (Apr 30, 2026 vs. Feb 16, 2026). Locally
installed Pi metadata corroborates Astra's price and output cap, but Pi currently caps direct
`openai-codex` Astra and Sol at 272,000 context tokens to stay within short-context pricing; its
`github-copilot` entries expose 1,050,000. Pi's direct Sol cost metadata also differs from the public
API list. Treat the OpenAI catalog as pricing authority and Pi metadata as the active harness
configuration.

One credible qualification against a blanket "Astra beats Sol" reading: the ARC-AGI-3 comparison
(99.9% vs. 7.8%) is explicitly run with a modified response-API harness (footnote 1), and the
ExploitBench/ExploitGym cyber numbers are explicitly "without production safeguards" — i.e., raw
model capability, not what a deployed, safeguarded Astra does in production. Treat these as
capability ceilings, not production behavior.

## Suitable Pi Workbench Cognitive Roles

Mapping OpenAI's demonstrated strengths to `skills/model-orchestration/SKILL.md` roles:

- **`design` / `problem-solving` / `escalation`** — Astra's FrontierMath, GPQA Diamond, and
  Terminal-Bench 4.0 leads over Sol support routing difficult technical analysis and consequential
  design work to Astra at higher reasoning effort, consistent with the existing effort ladder
  (`medium` → `high` → `xhigh` → `max`) already defined for Sol in `routing-policy.json`.
- **`investigation` / `mechanics`** — the long-context and computer-use results show Astra can
  handle unusually consequential, high-context investigation or difficult computer-use automation.
  They do not justify making an expensive frontier model the default for routine evidence collection
  or mechanics; use Sonnet/Haiku there unless task consequence or measured failure warrants
  escalation.
- **`coordination`** — the alignment evidence (fewer Codex Auto-Review circumvention attempts,
  ~half the misaligned-behavior flags of Sol in the 54,000-task Codex simulation, no scope
  circumvention in the "impossible task" evaluation) is the most directly relevant evidence for a
  role that must stay within a bounded scope and hand off compact, trustworthy results — the
  `coordination` role's exact requirement.
- **`independent-judgment` / `challenge` / `independent-review`** — Astra is a same-vendor,
  next-generation successor to Sol, not a different model family. Per `SKILL.md` §2, independence
  is judged by underlying model family, so Astra cannot substitute for a genuinely independent
  (e.g., Anthropic-family) checker; it is not a suitable binding for these roles regardless of its
  raw capability.
- **`synthesis`** — plausible given long-context recall and reduced hallucination scores, but this
  research pass found no OpenAI benchmark specific to synthesis-style evidence aggregation; treat
  as an untested extrapolation, not a demonstrated fit.

**Cybersecurity-specific caution:** Astra's Critical-tier cyber capability (system card §1) argues
against unrestricted routing to any role with broad `bash`/exploit-adjacent tool access without the
production safeguards OpenAI describes (Auto-Review, misalignment monitoring); this is a
deployment-safety constraint on top of, not a substitute for, the Cognitive Role mapping above.

**Current repository state:** `routing-policy.json` binds every OpenAI-side role (`implementation`
through `escalation`, `coordination`) to `gpt-5.6-sol`, not `gpt-6-astra`. Astra is present in local
Pi model metadata (registered, invokable) but not yet adopted in the routing policy. This report
does not change that policy file.

## Limitations

- Benchmark numbers are entirely OpenAI-self-reported; no independent reproduction was found in
  this pass, and the announcement itself flags research-environment vs. production variance.
- The announcement and system-card text were retrieved through a third-party reader proxy because
  direct requests to `openai.com` and `deploymentsafety.openai.com` were blocked by a Cloudflare
  bot challenge in this environment; fidelity is corroborated by cross-checking pricing/context/
  cutoff figures against the directly-fetched model-catalog page and local Pi metadata, but the
  raw HTML was not independently diffed.
- No Pi Workbench-specific evaluation of Astra exists yet (no run logs, no acceptance data); the
  Cognitive Role mapping above is derived from OpenAI's benchmark categories, not from repository
  usage evidence.
- `matt-shumer-manager-loop.md` is cited only as already-labeled secondary field evidence; it was
  not treated as a source of capability claims in this report.
