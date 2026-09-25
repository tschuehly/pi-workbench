# Model orchestration redesign

Status: design implemented 2026-09-25 in
[`skills/model-orchestration/`](../../skills/model-orchestration/SKILL.md), the resolver, and the
Subagent tool. Thomas set the direction, tiers, roles, and defaults in an attended session. The
[evaluation](#evaluation) decides only the bindings marked "evaluated against".

## Problem

The current router maps eleven Cognitive Roles to models. Several roles differ only by the effort
they imply (`implementation` vs `problem-solving`), some bindings contradict the stated policy
(`escalation` on GPT-6 Luna at `max` while the rationale calls maximum effort exceptional), and the
router does not account for the four Working Mode dials. No binding has been compared against an
alternative on real work.

## User stories

1. As Thomas, I want the model for a task to follow how well the task is understood, so that
   unclear work gets premium intelligence and well-defined work runs cheaply.
2. As Thomas, I want my Working Mode selection to determine which model slots a task opens, so that
   choosing a dial value does not require choosing models.
3. As the lead, I want few roles with clear boundaries, so that I classify an assignment quickly and
   consistently.
4. As the lead, I want to ask several models the same question and combine their answers, so that
   advice, investigation, and data-based conclusions are not limited to one model's view.
5. As Thomas, I want bindings chosen from measured comparisons on PhotoQuest work, so that routing
   reflects our tasks rather than published benchmarks or anecdotes.

## Design

### Latitude selects the tier

**Latitude** is how much the model must decide for itself: how unclear the problem is and how little
the brief specifies. Tiers are named by model strength. Each tier has a default model and a partner
from the other family at the same strength.

| Tier | Default | Partner | Latitude |
| --- | --- | --- | --- |
| Strong | GPT-6 Astra | Claude Opus 5.5 | Wide: the problem, approach, and finish line are open; unclear, novel, or stuck work; a symptom-only bug; a thin brief |
| Standard | Claude Opus 5.5 | GPT-6 Sol | Normal: the approach is open against a clear objective and an ordinary brief; coordination; independent checks |
| Light | GPT-6 Luna | Claude Sonnet 5 | Narrow: a detailed brief, an accepted plan, mechanical edits, broad evidence collection |
| Reserve | Claude Fable 5.1 | — | Only by name: the second member of a frontier panel |

A detailed brief or an accepted Plan or Spec narrows latitude and moves the same work to a lighter
tier; a vague brief moves it to a stronger one.

Fable has far less quota than Astra and is only marginally stronger than Opus, so routing never
selects it. For the hardest problems, wide-latitude and consequential or already failed once, the
lead runs a **frontier panel**: the same frozen brief to Astra and to Fable, combined by the lead.

### Roles

| Role | Replaces | Tier | Default binding | Evaluated against |
| --- | --- | --- | --- | --- |
| `routine` | `mechanics`, `investigation` | Light | GPT-6 Luna `xhigh` | Luna `max`; Sonnet 5 `high` |
| `implementation` | `implementation`, `problem-solving` | Standard | Claude Opus 5.5 `high` | Sol `high`, to test whether Opus is worth its Claude quota; Luna `max` for AFK work with an accepted plan |
| `frontier` | `design`, `escalation` | Strong | GPT-6 Astra `xhigh` | Fable 5.1 `xhigh`; the Astra + Fable panel |
| `coordination` | `coordination` | Standard | Claude Opus 5.5 `high` | — |
| `review` | `independent-review`, `challenge`, `independent-judgment` | Standard or above | Opus 5.5 or Sol `xhigh`, whichever family differs from the author; for frontier work, the other family's strong model by name | Sol vs Opus on the same review |

The old role names are removed, not aliased.

Thomas set `implementation` to Opus 5.5 `high` on 2026-09-25; the evaluation checks it against Sol.

The lead session is Claude Opus 5.5 `high`; it is configured in Pi settings, not routed. The lead
also combines panel answers, replacing the `synthesis` role.

`review` carries its lens in the brief: judge a compact claim, challenge a
conclusion, or review a diff. Its independence rules are unchanged: the reviewer's underlying model
family differs from the author's, unknown families fail closed, and same-family review is never
labeled independent.

### Model Effort is a ceiling

Effort limits how much a model may think; it does not force thinking. A model at a high setting
still answers simple steps quickly. Choose effort by latency tolerance and remaining ambiguity:

- `high` or `xhigh` when the task is not fully defined or nobody waits on the result.
- `medium` only when someone waits on the result and the task is fully defined.
- Avoid `low`: well-defined tasks still meet ambiguous context.
- `max` may force thinking on every request. It is an evaluation arm, not a default.

`frontier` and `review` have an `xhigh` floor: an effort override may raise it, never lower it.

### Working Mode opens model slots

The dials decide which slots a task opens; the roles decide which model fills each slot.

| Dial | Value | Effect on routing |
| --- | --- | --- |
| Alignment | `Plan`, `Spec` | Planning without an accepted plan is `frontier` work; after acceptance, execution can move to `implementation` or `routine`. |
| Attention | `Focused` | The lead must respond quickly; keep lead effort at `high` or lower. |
| Attention | `AFK` | Latency is irrelevant: `routine` and plan-backed `implementation` may use Luna at `max`. Advisors are `review` children with a judgment lens. |
| Orchestration | `Main` | Only the lead runs, apart from checks and advisors the other dials require. |
| Orchestration | `Subagents` | Leaf children use `routine`, `implementation`, or `frontier`. |
| Orchestration | `Workers` | Workers use `coordination`; their leaves use the leaf roles. Worker continuity is never independent review. |
| Checking | `Exercise`, `Test` | No independent model slot. |
| Checking | `Challenge` | At least one cross-family `review`; consequence may require a panel. |

The resolver does not read the dials. The lead applies them when it chooses the role and any
`--effort` override.

### Tier-partner fallback

When the default model is unavailable, lacks the effort, or has fresh exhausted quota, the resolver
selects the tier partner at the same effort. Routing never moves to another tier. The receipt and
the launch message record the fallback and its reason. The author family is the model that actually
ran, so later independence checks route away from it. A `review` fallback skips candidates from the
author's family and ends at the third family (Grok through Copilot). An explicit model has no
fallback. Unknown roles and both tier models unavailable fail closed.

### Panels

A panel sends one frozen brief to several independent children, each on a different model, and
the lead combines their answers. Panels suit advice, investigation, debate, and conclusions from
data; they do not suit code changes, which cannot be merged meaningfully. Children do not see each
other's answers before the lead collects all of them. A panel is a lead pattern, not a role.

### Prompts

The brief and profile templates follow Anthropic's
[Opus 5.5 guidance](https://claude.dev/blog/getting-the-most-out-of-opus-5-5/) and are in effect now,
independent of the model evaluation. They live in `extensions/subagent/index.ts`.

- Every brief states the task, relevant paths and constraints, "Done means …" as a checkable
  finish line, "Stop and ask only if …", and the expected output.
- No brief or instruction asks a model to think carefully or to show its reasoning; Model Effort
  controls thinking.
- Every child keeps going while a step needs no input, and starts its final report with what it
  needs from the lead, then what it changed and found.
- Profile sentences add the role's output shape: investigation marks what it could not confirm and
  where it looked; planning names options and one recommendation; review lists only blocking
  problems with file, line, why, and how to show the failure; implementation continues until the
  done condition holds; coordination checks each leaf's evidence before accepting it.

The guidance targets Opus 5.5. The evaluation compares each new profile sentence against the
profile-free `plain` arm on every model, so its effect on Sol, Astra, and Luna is measured rather
than assumed.

### Checking panels and GitHub Copilot

For `high` and `critical` consequence, a checking panel needs two reviewers from distinct
non-author families. With Anthropic and OpenAI only one non-author family exists, so GitHub
Copilot `grok-4.7` supplies the second family when Copilot quota is fresh and not exhausted.
Otherwise the panel runs two lenses from the one non-author family and reports itself as
single-family. `critical` still requires the full panel and does not accept this degradation.

## Evaluation

Measured comparison decides every binding marked "evaluated against" above. This extends
[`model-role-evaluation.md`](model-role-evaluation.md) with a fixture runner, following the record
shapes in the [evaluation campaign proposal](../research/reports/model-evaluation-campaign-proposal.md).

### Runner

`node scripts/pi-eval.mjs run <campaign.json>` runs a campaign: every case × arm × repetition as
one trial, sequentially. `report <results.jsonl>` prints the comparison table.

1. Admit each arm's model and effort through the routing resolver; a blocked binding is recorded
   as a blocked trial, never substituted.
2. Extract a history-free snapshot of the case's repository at its frozen commit (optionally only
   named paths) into the trial directory, so a later fix cannot be found through Git. A case setup
   script may prepare it further, for example by committing a change under review. Cases name the
   repository and commit; the runner resolves a sibling checkout or `PI_EVAL_REPO_<NAME>`.
3. Run headless Pi: `pi -p --mode json --model <provider/model> --thinking <level>` limited to the
   built-in file and shell tools, with the case's profile sentence prepended to the brief. Normal
   extension discovery loads telemetry and subscription authentication.
3. For a panel arm, run each member independently, then give their answers to the combining model.
4. Run the case check outside every model.
5. Append one result: pass or score, elapsed time, turns, tokens, quota before and after, and the
   exact binding.

Results stay under `~/.pi-workbench/evals/results/` and never change routing policy.

Trials share the machine with other sessions' builds. Before each trial the runner waits while any
`gate.sh` is running. Each trial gets its own Gradle daemon registries (one for the model, one for
the check), and the daemons idle out after two minutes. When the trial ends, the runner stops them
with `--stop` and then kills any still alive. `PI_EVAL_MAX_FORKS` (default 2) caps
`Test.maxParallelForks` through the machine-local init script
`~/.gradle/init.d/pi-eval-max-forks.gradle`, which does nothing when the variable is unset. Manual
probes set the same variable and a private daemon registry.

PhotoQuest is private and this repository is public, so PhotoQuest cases and campaigns live outside
the repository under `~/.pi-workbench/evals/{cases,campaigns}/`. A case is `case.json` (role,
profile, repository, commit, brief, check) plus its setup and check scripts; judge references are
extracted from the private repository at run time rather than copied into the case.

### Cases

| Case type | Source | Check | Roles |
| --- | --- | --- | --- |
| Feature replay | Multi-file PhotoQuest features with Playwright coverage, e.g. `1f3f6ca68`, `bd93f69a0`, `e747790de`, `3f8c7d8ff`, `b426d8225`; the brief states behavior and only the labels and selectors a user-level test needs | E2E outcome check | `implementation` |
| Symptom-only bug | Production bugs whose root cause sits away from the symptom, e.g. `2fb53ef0a`, `aaf4760c2`, `009de008e`, `f4bfe5f6e`, `abca5da91`; the brief gives only the user-visible symptom | E2E outcome check | `frontier` |
| Seeded defects | A diff that reintroduces several fixed bugs, plus a clean control diff | Defects found out of those planted, by file and line; findings on the control count as false positives | `review` |
| Evidence retrieval | Facts in `docs/business` (ICPs, competitors, product knowledge) | Exact answer | `routine` |
| Data conclusion | Questions computable from `docs/business` CSV data | A script computes the answer | `routine`, panels |
| Decision replay | A recorded business decision, given only the facts known before it | Blinded judges from both families score each answer without seeing its model; disagreements go to Thomas | `frontier`, panels |

Code cases are proven by browser behavior, not by the fix's own unit tests. Each E2E check runs:

1. **Outcome test**: a Playwright test that drives the browser and asserts what the user sees. It
   fails on the fix's parent and passes on the fix. A commit test that calls endpoints directly or
   depends on how the fix was built is replaced by a user-level test written from the symptom,
   because it would fail other correct fixes.
2. **Flow smoke test**: one fast happy-path test of the affected flow, run only after the outcome
   test passes. Slow resilience tests run only when the symptom concerns resilience.

A case enters a campaign only after its check passes on the fix commit and fails on its parent.
Early smoke-run measurements: about 2.7 minutes to build and start, then the tests themselves.

### Arms

| Comparison | Arms |
| --- | --- |
| `implementation` | Sol `high` · Opus 5.5 `high` |
| `routine` | Luna `xhigh` · Luna `max` · Sonnet 5 `high` |
| `frontier` | Astra `xhigh` · Fable 5.1 `xhigh` |
| `review` | Sol `xhigh` · Opus 5.5 `xhigh` |
| Panel | Sol + Opus combined by Opus · each alone |
| Prompt | Each role's profile sentence · `plain` without it, on the same model |
| Review effort | Opus 5.5 `low` · Opus 5.5 `xhigh` |

### Sequence

1. **Smoke:** one case per type, one repetition (about 15 trials). Proves the runner and measures
   PhotoQuest trial duration.
2. **Screen:** five cases per role, three repetitions. Detects only gross differences: failures,
   timeouts, or a twofold gap in cost or time.
3. **Decide:** Thomas accepts or rejects each binding from the report. The existing promotion rule
   still applies.

## Acceptance criteria

- The spec's roles, bindings, and dial mapping are accepted by Thomas.
- The smoke campaign runs end to end without changing the PhotoQuest or Workbench checkouts, and
  its results record binding, check outcome, elapsed time, turns, tokens, and quota.
- Every accepted binding change cites evaluation results; the `implementation` default is chosen
  this way.
- When the default's quota is exhausted, the resolver selects the tier partner and records the
  fallback; tests cover the independence case where the partner shares the author's family.
- After migration, the resolver, subagent tool, execution adapter, activity labels, telemetry
  tests, and skill references use only the new roles, and their tests pass.
- Unknown roles, unknown author families, unavailable models or efforts, and fresh exhausted quota
  still fail closed.

## Out of scope

- Reading Working Mode dials inside the resolver.
- Multi-round debate between models; evaluate simple panels first.
- Managed or unattended campaigns, parallel trials, and PI WEB presentation of results.
- Muse Spark, DeepSeek, and other models Pi does not list.
