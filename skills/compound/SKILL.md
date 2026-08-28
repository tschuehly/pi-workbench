---
name: workbench-compound
description: Evaluate one meaningful Pi session against explicit improvement questions and accumulate source-backed learning proposals.
disable-model-invocation: true
---

# Compound

Evaluate one attended Pi session so repeated use improves the harness from evidence rather than prompt speculation. This is a manual Level 1 analogue of the Run Analysis and Compounding behavior in `docs/contracts/workflow.md`; it creates no Run authority, typed Learning Candidate, or automatic promotion.

Set `SKILL_DIR` to this skill's directory and `WORKBENCH_ROOT` to `../..` from it. Resolve every Workbench reference under that root so `/skill:workbench-compound` works while the attended lead is operating in another repository.

## 1. Resolve the evaluation

Use the session named by the owner. When the owner says “this session,” require the exact `PI_SESSION_ID` and `PI_SESSION_FILE`; do not select a session by recency. Read Evaluation Questions from a path named by the owner, defaulting to `$WORKBENCH_ROOT/docs/plans/subagent-worker-iterative-improvement.md#pilot-evaluation-questions`.

Prior evaluations are user-local working evidence under:

```text
~/.pi-workbench/compound/sessions/<session-id>/
```

They are individual reports, not an append-only store, Run ledger, Workstream ledger, project knowledge store, or authority source. Search bounded report headers across `~/.pi-workbench/compound/sessions/`, then read only prior reports relevant to the selected question IDs. Never put raw transcripts, machine-local paths, or authentication material in the repository.

Set one evaluation ID as `<UTC-basic-timestamp>-<session-id-prefix>` and reuse it for every local artifact from this evaluation.

**Complete when:** the target session, evaluation ID, question IDs and source revision, prior relevant evaluations, and available Primary Evidence are explicit.

## 2. Prepare bounded evidence

Never load a complete session file blindly. Inspect its byte size and JSONL structure first. Use `jq`, `rg`, and bounded line or byte slices to prepare a question-shaped evidence manifest containing the relevant user decisions, assistant claims, tool calls and results, terminal child outcomes, and exact source offsets. Write it under `~/.pi-workbench/compound/sessions/<session-id>/<evaluation-id>-evidence.md`, and pass its absolute path to the evaluator. Keep extracted transcript material below 300 KB in total. If the active questions cannot be judged inside that budget, narrow the question set or mark the affected questions `inconclusive`.

Inspect child or Worker session files only when an active question requires them. Prefer repository Primary Evidence—commits, diffs, tests, and observed behavior—over transcript claims about outcomes.

**Complete when:** the evidence manifest is bounded, provenance-bearing, and sufficient for the selected questions, or its insufficiency is explicit.

## 3. Commission a fresh strong evaluation

Derive the target lead's author provider and model from its session-file model metadata and assistant entries. If they are missing or contradictory, stop rather than guessing. Launch one fresh `subagent` in the background with:

- `profile: "reviewer"`;
- `cognitiveRole: "independent-review"`;
- `independentOfProvider` explicitly set to the derived target lead provider—never omitted or defaulted; and
- a self-contained assignment naming the evidence manifest, selected question IDs, prior relevant reports, target-repository evidence, and the exact Workbench documents below.

The evaluator must read `$WORKBENCH_ROOT/docs/foundation/principles.md`, `$WORKBENCH_ROOT/docs/foundation/vocabulary.md`, applicable settled decisions, and `$WORKBENCH_ROOT/docs/contracts/workflow.md#run-analysis-and-compounding`. Collect the result with `subagent_collect`. If the fresh evaluator fails, disclose the failure and write no evaluation report.

For every selected Evaluation Question, require:

- **observation:** what happened;
- **assessment:** `supports`, `contradicts`, or `inconclusive`;
- **evidence:** exact session entries, tool calls, files, commits, or checks;
- **confidence and limits:** why the evidence warrants no stronger claim;
- **cumulative effect:** whether prior synthesis changes; and
- **next observation:** the smallest useful future case.

`supports` and `contradicts` classify this session's evidence, not the system as a whole. One useful steering message may support “steering can prevent rework” with low confidence while remaining insufficient to recommend always-on steering.

**Complete when:** the independent evaluation accounts for every selected question and distinguishes observed behavior, inferred explanation, and recommendation.

## 4. Preserve one local report

The attending lead writes the returned evaluation—not the reviewer, which is instructed not to mutate files—to:

```text
~/.pi-workbench/compound/sessions/<session-id>/<evaluation-id>.md
```

Record the target session ID, evaluation time, exact question IDs, SHA-256 of the question source, target lead provider/model, evaluator provider/model/effort, evidence references, per-question assessments, cumulative synthesis, and candidate-shaped proposals. Do not maintain a second global register; discover prior reports from the session directories.

**Complete when:** exactly one report exists at the named path and repository state is unchanged unless the owner separately approved promotion.

## 5. Present learning without promoting it

Give the owner:

1. the material observations;
2. what changed in the cumulative synthesis;
3. unresolved or contradictory evidence;
4. candidate-shaped proposals for project knowledge or workflow improvement; and
5. one recommended next observation.

Each proposal declares its destination and scope, provenance, supporting evidence, applicability, validation method, invalidation trigger, and relationship to existing knowledge. It remains a Level 1 evaluation finding: producing a typed Learning Candidate and promoting or rejecting it remain governed by `docs/contracts/workflow.md` and the still-deferred compounding-authority decision. Changes to persistent instructions, skills, principles, decisions, or implementation require separate owner judgment and the owning document's normal workflow.

**Complete when:** the owner can inspect the local report and decide whether to observe again, discard the proposal, or authorize a separate promotion change.
