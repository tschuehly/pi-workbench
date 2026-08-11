# Plan: evidence-driven AFK run preparation skill

**Status:** Proposal for Thomas to review

## Decision

Create one new Pi Workbench skill named `prepare-afk-run` for designing and launching autonomous AFK work.
It supersedes `define-goal` only when the requested work will run through `execute-plan-afk-goal`.
`define-goal` remains the lightweight choice for ordinary attended Goals.

Do not split autonomous preparation into multiple user-facing stage skills. Use one skill with disclosed
references and deterministic helper scripts. The execution extension and project controllers remain the
authoritative runtime; the skill prepares evidence, decisions, a run plan, and an attended launch receipt.

## Problem

Today an AFK goal is assembled manually from conversation context. Quality depends on whether the author
remembers to inspect earlier runs, separate operational failure from quality judgment, preserve authority,
check reviewer capacity, plan recovery, and keep the generated Goal objective below Pi Goal's 4,000-character
limit.

This produced two different outcomes:

- The 2026-08-11 PhotoQuest overnight loop worked well: seven videos accepted, three honestly blocked, four
  new concepts generated, and repeated stage failures recovered on the same durable run.
- Later stabilization execution stalled at mandatory review when reviewer RPC startup failed. The work had no
  certified startup-failure recovery or timed wake policy, and the goal put too much orchestration policy in
  one run-specific document.

The preparation skill should learn from both classes before proposing the next run.

## Intended reader and use

The skill serves a human who wants to leave a repository unattended for hours and review the result later.
Trigger it for requests such as:

- "prepare an overnight goal";
- "make this plan run AFK";
- "analyze the previous runs and create a better autonomous run";
- "launch this through execute-plan-afk-goal".

Do not invoke it for ordinary attended `/goal` work, a one-step background child, or a request that already
contains a complete approved AFK goal and only needs execution.

## Interface

### Inputs

- target repository and intended outcome;
- desired stop-new-work and final-audit deadlines;
- optional source plan or issue;
- explicit authority boundaries and forbidden effects;
- optional historical evidence paths.

### Output

Return one bounded preparation result:

```json
{
  "status": "ready | decisions-required | blocked",
  "goalPath": "repo-relative Markdown path",
  "planPaths": ["source plans used"],
  "historyEvidence": ["goals, reports, receipts, commits"],
  "preflightReceiptPath": "repo-relative JSON path",
  "openDecisions": ["human decisions required before launch"],
  "launchCommand": "/execute-plan-afk-goal <goalPath>"
}
```

`ready` means the goal is understandable, the attended preflight passed, required decisions are explicit,
and the launch command is usable. It does not claim that future infrastructure will remain available.

## Ownership split

### The skill owns

- historical run analysis;
- outcome and acceptance design;
- identifying unfinished work;
- deadline and cutoff design;
- human authority and side-effect boundaries;
- choosing risk-based review gates;
- creating a concise run-specific plan;
- running attended capability preflight;
- presenting unresolved decisions before launch.

### `execute-plan-afk-goal` owns

- Goal creation and ownership;
- phase checkpoints and compaction;
- current Goal-id handling;
- risk-based review orchestration;
- timed `goal_wait` recovery;
- immutable AFK outcome finalization;
- later-turn Goal completion.

### Project controller code owns

- resumable state;
- idempotency and duplicate prevention;
- queue and concurrency guards;
- retry-safe stage transitions;
- exact artifact and receipt validation;
- settlement and terminal projection;
- date-derived ledgers and other durable records.

The skill must not promise controller behavior that current code and tests do not provide. Missing guarantees
become explicit pre-production work or a launch blocker.

## Skill structure

```text
skills/prepare-afk-run/
├── SKILL.md
├── references/
│   ├── history-analysis.md
│   ├── goal-template.md
│   ├── attended-preflight.md
│   └── evaluation-cases.md
└── scripts/
    ├── collect-afk-evidence.mjs
    └── preflight-afk-run.mjs
```

### `SKILL.md`

Keep the main procedure short:

1. Locate repository instructions and AFK execution contract.
2. Collect historical evidence.
3. Compare the best and worst prior runs.
4. Define outcome, acceptance, authority, deadlines, and recovery needs.
5. Draft the run plan with the template.
6. Run attended preflight.
7. Present only material human decisions.
8. Write the approved plan and show the exact launch command.

Each step ends with a checkable completion criterion. Branch-specific detail lives in references.

### `references/history-analysis.md`

Require evidence from:

- prior AFK goals and source plans;
- terminal reports and receipts;
- accepted, blocked, attention, and failed runs;
- commit history during each run;
- controller state and test changes caused by production evidence;
- subagent/provider failure metadata;
- unfinished queue or plan work.

Classify mechanisms rather than copying prompt wording:

- successful same-attempt recovery;
- deterministic repair;
- operational retry without quality-budget consumption;
- honest blocked continuation;
- concept/queue refill;
- unnecessary review overhead;
- indefinite waiting;
- unknown side effects;
- stale or missing durable records;
- human-only decisions.

### `references/goal-template.md`

The generated plan should contain, in this order:

1. one-sentence overnight outcome;
2. attended launch receipt;
3. measurable success conditions;
4. explicit decisions and authority boundaries;
5. current starting state and unfinished work;
6. smallest required pre-production fixes;
7. continuous work loop;
8. safe recovery and continuation rules by reference;
9. stop-new-work and final-audit deadlines;
10. `succeeded | attention | failed` classification.

Keep stable recovery policy out of the generated plan. Link to the execution contract and project operating
skill. Inline only run-specific exceptions and missing guarantees that must be implemented before production.

### `references/attended-preflight.md`

Run while the human is still present. Produce a JSON receipt bound to plan SHA-256 and repository HEAD.

Required checks:

- correct branch, clean owned worktree, and protected foreign worktrees;
- current Pi, extension, Node, render, browser, and media-tool capabilities;
- required Goal/AFK tools loaded after reload;
- fresh model binding and quota admission for every mandatory provider family;
- one cheap end-to-end child health probe per mandatory provider family;
- enough disk and required external paths readable;
- no active controller, model, render, enrichment, settlement, or concept-batch process;
- all existing runs and batches reconciled;
- authoritative queue and unfinished-work state;
- project-specific canonical tests;
- deadline is in the future and leaves time for safe closure;
- generated Goal objective remains within Pi Goal's 4,000-character limit;
- no unresolved human decision is disguised as autonomous authority.

A failed mandatory check returns `decisions-required` or `blocked`; it never launches and hopes Phase 0 can
recover a missing fundamental capability.

## Deterministic helpers

### `collect-afk-evidence.mjs`

Accept repository root and optional evidence globs. Return bounded JSON with:

- goal/report paths and hashes;
- starting and terminal commits;
- outcome counts;
- generated and accepted artifact counts;
- recurring failure classes;
- recovery commits and tests;
- unresolved work;
- evidence freshness warnings.

The script gathers facts; the skill judges what they mean. It must not infer success from prose alone.

### `preflight-afk-run.mjs`

Use adapters rather than project-specific conditionals:

```js
prepareAfkRun({
  repoRoot,
  planPath,
  deadlines,
  checks: [gitCheck, piCheck, modelCheck, processCheck, projectCheck]
})
```

Return structured check results with `pass | warn | fail`, command evidence, timestamps, and hashes. Support a
PhotoQuest adapter first, but keep the external interface repository-neutral.

The helper may inspect. It must not approve publication, repair controller state, kill unknown processes, or
make human decisions.

## Historical evaluation cases

Use checked-in, redacted fixtures or stable path-based integration tests for four cases:

1. **Golden production loop — 2026-08-11**
   - Detect seven accepted, three blocked, four generated concepts.
   - Preserve same-run recovery, deterministic repair, terminal commits, and refill.
   - Reject the unsafe literal rule "never wait"; replace it with bounded timed recovery.

2. **Controller-building run — 2026-08-10**
   - Identify the durable mechanisms that enabled the golden loop.
   - Put those mechanisms in controller requirements, not copied goal prose.

3. **Reviewer startup outage / stabilization stall**
   - Identify certified pre-prompt startup failure and missing timed wake policy.
   - Preserve mandatory review authority without turning infrastructure failure into a verdict.

4. **2026-08-12 rollover plan**
   - Require concept generation as well as video production.
   - Detect artifact-bearing blocked settlement, refill-resume ordering, batch/video mutual exclusion, and
     missing dated-ledger creation before launch.

## Tests and evaluations

### Unit tests

- parse deadlines and reject elapsed or contradictory cutoffs;
- bind the preflight receipt to exact HEAD and plan hash;
- fail on dirty owned paths while preserving declared foreign paths;
- distinguish warnings from blockers;
- detect missing provider families or required tools;
- keep generated Goal objectives at or below 4,000 characters;
- preserve human authority boundaries in the output schema;
- never classify `outcome_unknown` as retry-safe;
- avoid duplicate run or batch identifiers.

### Golden-file evaluations

For each historical case, assert the generated preparation result includes the correct:

- successful mechanisms to preserve;
- failures to prevent;
- unfinished work;
- required controller guarantees;
- acceptance threshold;
- launch blockers and human decisions.

Avoid exact prose snapshots. Assert structured decisions and evidence references so wording can improve.

### End-to-end evaluation

In a temporary repository:

1. create prior goal/report fixtures;
2. run evidence collection;
3. generate an AFK plan;
4. run preflight with fake capability adapters;
5. verify the plan and receipt hashes;
6. feed the plan to `buildGoalObjective()` from the AFK extension;
7. assert the objective fits and preserves the exact plan path, constraints, and recovery contract.

## Implementation phases

### Phase 1 — contracts and historical fixtures

- Define preparation-result and preflight-receipt schemas.
- Add redacted fixtures for the four historical cases.
- Write failing tests for the expected decisions.

**Complete when:** tests distinguish the golden loop from the reviewer-outage stall without reading live
mutable scratch state.

### Phase 2 — evidence collector and preflight core

- Implement bounded evidence collection.
- Implement adapter-based attended preflight.
- Add fake adapters for Git, Pi, model routing, processes, and project checks.

**Complete when:** all mandatory launch blockers are structured and reproducible in tests.

### Phase 3 — skill and progressive references

- Write `SKILL.md` and the four references.
- Keep the invocation description specific to AFK preparation.
- Add the PhotoQuest adapter and document how another repository provides its checks.

**Complete when:** a fresh agent can produce a correct preparation result from each historical fixture without
loading unrelated stage instructions.

### Phase 4 — extension integration

- Add an optional preflight-receipt input to `execute-plan-afk-goal`.
- Validate receipt plan hash, HEAD, freshness, and mandatory checks before Goal activation.
- Keep project adapters outside the extension core.
- Preserve manual launch for repositories that explicitly choose no adapter, but make the missing attended
  preflight visible.

**Complete when:** stale or mismatched receipts fail before Goal creation and a valid receipt launches the
existing AFK contract unchanged.

### Phase 5 — migration and documentation

- Update `define-goal` to point AFK/overnight preparation requests to `prepare-afk-run` rather than duplicating
  its procedure.
- Update Pi Workbench docs with the preparation → human review → reload/preflight → execute sequence.
- Run historical evaluations and one real attended smoke test without starting production.

**Complete when:** there is one source of truth for AFK preparation and existing ordinary Goal behavior is
unchanged.

## Risks

- **Prompt policy mistaken for enforcement:** every claimed runtime guarantee must cite controller code/test or
  be listed as required pre-production work.
- **History overfitting:** fixtures should encode mechanisms and outcomes, not PhotoQuest wording.
- **Preflight becoming slow:** run deterministic checks in parallel; make expensive provider probes bounded and
  explicit.
- **False readiness from quota telemetry:** require an actual cheap child probe for mandatory providers.
- **Goal bloat:** enforce a plan template and objective-length test; disclose stable references.
- **Skill overlap:** route only AFK preparation away from `define-goal`; do not replace generic goal definition.

## Decisions for Thomas

1. **Name:** accept `prepare-afk-run`, or prefer `design-afk-run`?
2. **Launch gate:** should a fresh preflight receipt be mandatory for every AFK run or only when a project
   adapter exists? Recommendation: mandatory when an adapter exists; visible warning otherwise.
3. **Receipt freshness:** recommendation: expire model/process checks after 15 minutes while Git/plan hashes
   remain valid only while unchanged.
4. **Output location:** recommendation: the skill writes plans in the target repository's chosen scratch/docs
   location, while schemas, fixtures, and generic references live in Pi Workbench.
5. **Migration:** recommendation: keep `define-goal` installed and add one explicit pointer for AFK requests;
   do not delete it.
