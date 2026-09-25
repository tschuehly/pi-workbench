# Model orchestration redesign

Status: specification, 2026-09-25. Thomas set the direction and settled the role names, tier
fallback, and judged cases in an attended session. Current routing in
[`skills/model-orchestration/`](../../skills/model-orchestration/SKILL.md) stays unchanged until the
[evaluation](#evaluation) reports and Thomas accepts the resulting bindings.

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

### Certainty selects the tier

How well the problem is understood chooses the model tier. Each tier pairs one Anthropic and one
OpenAI model, so a cross-family partner always exists at the same capability level.

| Certainty | Typical work | Anthropic | OpenAI |
| --- | --- | --- | --- |
| Low | Unclear, hard, novel, or stuck work; design without an accepted plan | Claude Fable 5.1 | GPT-6 Astra |
| Normal | Engineering against a clear objective; coordination; independent checks | Claude Opus 5.5 | GPT-6 Sol |
| High | Well-defined work: mechanical edits, broad evidence collection, executing an accepted plan | Claude Sonnet 5 | GPT-6 Luna |

An accepted Plan or Spec raises certainty and can move execution to a cheaper tier.

### Roles

| Role | Replaces | Tier | Default binding | Evaluated against |
| --- | --- | --- | --- | --- |
| `routine` | `mechanics`, `investigation` | High | GPT-6 Luna `xhigh` | Luna `max`; Sonnet 5 `high` |
| `implementation` | `implementation`, `problem-solving` | Normal | Set by evaluation: GPT-6 Sol `high` or Opus 5.5 `high` | Sol vs Opus; Luna `max` for AFK work with an accepted plan |
| `frontier` | `design`, `escalation` | Low | GPT-6 Astra `xhigh` | Fable 5.1 `xhigh` |
| `coordination` | `coordination` | Normal | Claude Opus 5.5 `high` | — |
| `independent-review` | `independent-review`, `challenge`, `independent-judgment` | Normal | Opus 5.5 or Sol `xhigh`, whichever family differs from the author | Sol vs Opus on the same review |

Until the evaluation reports, `implementation` keeps its current GPT-6 Sol binding at `high`.

The lead session is Claude Opus 5.5 `high`; it is configured in Pi settings, not routed. The lead
also combines panel answers, replacing the `synthesis` role.

`independent-review` carries its lens in the brief: judge a compact claim, challenge a
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

### Working Mode opens model slots

The dials decide which slots a task opens; the roles decide which model fills each slot.

| Dial | Value | Effect on routing |
| --- | --- | --- |
| Alignment | `Plan`, `Spec` | Planning without an accepted plan is `frontier` work; after acceptance, execution can move to `implementation` or `routine`. |
| Attention | `Focused` | The lead must respond quickly; keep lead effort at `high` or lower. |
| Attention | `AFK` | Latency is irrelevant: `routine` and plan-backed `implementation` may use Luna at `max`. Advisors are `independent-review` children with a judgment lens. |
| Orchestration | `Main` | Only the lead runs, apart from checks and advisors the other dials require. |
| Orchestration | `Subagents` | Leaf children use `routine`, `implementation`, or `frontier`. |
| Orchestration | `Workers` | Workers use `coordination`; their leaves use the leaf roles. Worker continuity is never independent review. |
| Checking | `Exercise`, `Test` | No independent model slot. |
| Checking | `Challenge` | At least one cross-family `independent-review`; consequence may require a panel. |

The resolver does not read the dials. The lead applies them when it chooses the role and any
`--effort` override.

### Tier-partner fallback

When fresh quota telemetry shows the default model's provider exhausted, the resolver selects the
other model in the same tier at the same effort. The receipt records the fallback and its reason.
The binding's author family is the model that actually ran, so later independence checks route away
from it. An `independent-review` fallback must still differ from the author's family; if the partner
shares it, routing blocks. Unknown roles, unavailable models or efforts, and exhausted quota for both
tier models still fail closed.

### Panels

A panel sends one frozen brief to several independent children, each on a different model, and
the lead combines their answers. Panels suit advice, investigation, debate, and conclusions from
data; they do not suit code changes, which cannot be merged meaningfully. Children do not see each
other's answers before the lead collects all of them. A panel is a lead pattern, not a role.

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

`scripts/pi-eval` runs a campaign: every case × arm × repetition as one trial, sequentially.

1. Create a disposable PhotoQuest worktree at the case's frozen commit under
   `~/.pi-workbench/evals/`. Cases name the repository and commit, never a local path.
2. Run headless Pi: `pi -p --mode json --model <provider/model> --thinking <level>` with the case
   prompt and a trial session directory. Normal extension discovery loads telemetry.
3. For a panel arm, run each member independently, then give their answers to the combining model.
4. Run the case check outside every model.
5. Append one result: pass or score, elapsed time, turns, tokens, quota before and after, and the
   exact binding.

Results stay under `~/.pi-workbench/evals/results/` and never change routing policy.

### Cases

| Case type | Source | Check | Roles |
| --- | --- | --- | --- |
| Commit replay | Recent PhotoQuest fixes with tests, e.g. `8f133a3bd`, `27caf4b98`, `ac311d9fb`, `2c113fd94` | The commit's tests pass | `implementation` |
| Symptom-only bug | Harder fixes given only the symptom, e.g. `2fb53ef0a`, `49c49534b` | The regression test passes | `frontier` |
| Seeded defect | A diff that reintroduces a fixed bug, e.g. `bb84c6651` | The review names file and line | `independent-review` |
| Evidence retrieval | Facts in `docs/business` (ICPs, competitors, product knowledge) | Exact answer | `routine` |
| Data conclusion | Questions computable from `docs/business` CSV data | A script computes the answer | `routine`, panels |
| Decision replay | A recorded business decision, given only the facts known before it | Blinded judges from both families score each answer without seeing its model; disagreements go to Thomas | `frontier`, panels |

### Arms

| Comparison | Arms |
| --- | --- |
| `implementation` | Sol `high` · Opus 5.5 `high` |
| `routine` | Luna `xhigh` · Luna `max` · Sonnet 5 `high` |
| `frontier` | Astra `xhigh` · Fable 5.1 `xhigh` |
| `independent-review` | Sol `xhigh` · Opus 5.5 `xhigh` |
| Panel | Sol + Opus combined by Opus · each alone |

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
