# Recent Repository Workflow Evidence Ledger

## Scope and interpretation

Read-only inspection of recently active repositories under `/Users/tschuehly/IdeaProjects` on 2026-07-15. PhotoQuest, `claude-code-for-spring-developers`, and `skill-incubator` are covered separately and were excluded from this sample.

This is an evidence ledger, not a supported-workflow specification. The labels below distinguish:

- **Observed practice**: behavior supported by repository artifacts or Git history.
- **Intended contract**: behavior stated by current repository documentation or executable workflow definitions.
- **Historical perspective**: retained handoffs, session exports, or intermediate artifacts. These explain how decisions emerged but are not authoritative current state.
- **Inference**: a design implication drawn across repositories.

## Repository sample and recency

| Repository | Latest inspected commit | Workflow signal |
|---|---|---|
| `CLIProxyAPI` | `5fea485d`, 2026-07-15 | Focused upstream contribution with a compact repository contract |
| `ai-engineer` | `3b502c4`, 2026-07-12 | Repeated, resumable knowledge-base iterations |
| `jvm-skills` | `6b7a078`, 2026-07-10 | Deterministic candidate pipeline, generated review surface, and PR promotion |
| `lavish-axi` | `1150388`, 2026-07-07 | Agent-generated browser review surfaces with durable annotations |
| `DataRecovery` | `c292e7c3`, 2026-07-03 | Conventional application repository with GitHub PR collaboration |
| `blog` | `9890d46`, 2026-06-27 | Multi-agent visual review with retained screenshot evidence |
| `jvm-skills-article-drafts` | `2fa7df3`, 2026-06-18 | Session-derived evidence for exploratory agent-product development |

Commit dates establish recency, not authorship or workflow quality.

## Repository observations

### CLIProxyAPI: focused upstream contribution

**Observed practice.** The inspected branch was clean and two commits ahead of upstream. The work was a narrow template/context fix with tests, rather than a durable orchestration run. The repository delegates most operating rules to a concise [AGENTS.md](/Users/tschuehly/IdeaProjects/CLIProxyAPI/AGENTS.md:1).

**Intended contract.** Follow repository-scoped instructions, keep the change focused, and use the existing test and PR path.

**Inference.** A mandatory run ledger would add ceremony without useful recovery value here. The workbench should offer a thin contribution profile: branch, diff, tests, review, and PR status.

### ai-engineer: append-only AFK research

**Observed practice.** Commits 347 through 358 on 2026-07-11 and 2026-07-12 each processed one video. The [knowledge-base prompt](/Users/tschuehly/IdeaProjects/ai-engineer/prompts/gnhf-build-knowledge-base.md:40) defines one source as the iteration boundary, while the [append-only log](/Users/tschuehly/IdeaProjects/ai-engineer/data/ai_engineer_youtube/wiki/log.md:2674) records completed iterations.

**Intended contract.** Process exactly one source per iteration, persist the result, and leave a resumable checkpoint before the next fresh agent invocation.

**Lifecycle evidence.** The ignored `.gnhf/runs` directory contained 364 files totaling about 433 MB. No visible retention contract bounded those run artifacts. One source note was modified in the working tree, so a clean checkpoint could not be inferred solely from the commit sequence.

**Inference.** Batch research needs a deterministic queue, small authoritative progress records, isolated run artifacts, and explicit resume and retention policy. Conversation history is insufficient as progress state.

### jvm-skills: deterministic pipeline plus human promotion

**Observed practice.** The skill-scout pipeline persists candidates and results in CSV state, including 95 recorded runs through 2026-07-03. It generates a browser review artifact and later promotes accepted candidates through ordinary GitHub PR commits. The operating contract is described in the [skill-scout README](/Users/tschuehly/IdeaProjects/jvm-skills/skill-scout/README.md:45), while the [database README](/Users/tschuehly/IdeaProjects/jvm-skills/skill-scout/db/README.md:9) identifies the repository-local records. The [overnight workflow](/Users/tschuehly/IdeaProjects/jvm-skills/skill-scout/harness/overnight.workflow.js:22), [review HTML generator](/Users/tschuehly/IdeaProjects/jvm-skills/skill-scout/harness/gen_review_html.py:1), and [run reset utility](/Users/tschuehly/IdeaProjects/jvm-skills/skill-scout/harness/reset_run.py:1) expose queue, review, and recovery operations.

**Intended contract.** Deterministic candidate selection, resumable caches, self-validating apply operations, human review before promotion, and opt-in commits.

**Observed guardrails.** Repository settings and hooks add local safety controls: [Claude settings](/Users/tschuehly/IdeaProjects/jvm-skills/.claude/settings.json:1) and [Git guardrails](/Users/tschuehly/IdeaProjects/jvm-skills/.claude/hooks/git-guardrails.sh:1). Browser decisions persist separately in [`.lavish/decisions.json`](/Users/tschuehly/IdeaProjects/jvm-skills/.lavish/decisions.json:1).

**Historical perspective and stale state.** Retained handoffs described next actions that later became false:

- [2026-06-26 handoff](/Users/tschuehly/IdeaProjects/jvm-skills/.scratch/skill-scout/06-26_01_run-more-examples.md:65) said candidates were stale, nothing was committed, and AFK execution should not run.
- [2026-06-27 handoff](/Users/tschuehly/IdeaProjects/jvm-skills/.scratch/skill-scout/06-27_01_batch1-complete-fixes.md:70) still listed 51 configurations and rechecks, while the durable run table later reached 95 rows.
- [2026-07-03 handoff](/Users/tschuehly/IdeaProjects/jvm-skills/.scratch/skill-scout/07-03_01_action-candidate-review.md:23) described untracked documentation and a future review; promotion commits landed on 2026-07-07.

The ignored harness cache contained 1,994 files totaling about 23 MB. `.scratch` retained 27 files, including an older duplicate harness and superseded handoffs. `.lavish` retained generated review pages and already-sent decisions.

**Inference.** Handoffs should be generated projections of authoritative state and events, then marked consumed or regenerated. Review surfaces and caches need explicit close and garbage-collection operations.

### lavish-axi: dynamic agent-generated review surface

**Observed practice.** The SDK creates sandboxed HTML artifacts, persists annotations, and long-polls for reviewer input. Relevant boundaries appear in the [artifact SDK](/Users/tschuehly/IdeaProjects/lavish-axi/src/artifact-sdk.js:550), [session creation](/Users/tschuehly/IdeaProjects/lavish-axi/src/session-store.js:87), [session mutation](/Users/tschuehly/IdeaProjects/lavish-axi/src/session-store.js:210), and [CLI](/Users/tschuehly/IdeaProjects/lavish-axi/src/cli.js:216). Recent commits hardened state updates against races.

**Intended contract.** Let an agent generate the task-specific visual artifact while the host owns safe rendering, annotation capture, and durable review state.

**Lifecycle caveat.** Session state lives in a global `~/.lavish-axi/state.json`. Idle behavior stops a process but does not delete or prune session data. Static sharing omits the live SDK interaction path.

**Inference.** This is a strong precedent for extensible workbench surfaces, but not yet a complete repository workflow substrate. Surface state needs repository/run identity, schema versioning, permissions, and retention semantics.

### blog: multi-agent visual quality run

**Observed practice.** The Impeccable run used one orchestrator and page-specific agents, stored findings in a single-writer ledger, and retained rendered evidence. The [run README](/Users/tschuehly/IdeaProjects/blog/docs/impeccable/README.md:25) and [current conventions](/Users/tschuehly/IdeaProjects/blog/docs/impeccable/CONVENTIONS.md:49) define the active artifact set.

**Intended contract.** Coordinate page-level work through one shared ledger and validate visual changes against rendered pages.

**Evidence retention.** `docs/impeccable` contained 118 tracked files, including 105 PNGs totaling about 75 MB. These are intentional review evidence, not automatically garbage. Their value and cost differ from resumable caches.

**Historical perspective.** The [page-width handoff](/Users/tschuehly/IdeaProjects/blog/.scratch/handoffs/06-25_01_page-width-unification.md:1) and two outline handoffs—[first](/Users/tschuehly/IdeaProjects/blog/.scratch/outline-from-session/06-26_01_refine-outline-from-session-skill.md:1), [second](/Users/tschuehly/IdeaProjects/blog/.scratch/outline-from-session/06-26_02_multi-session-validated.md:1)—remain after the later artifact superseded earlier next steps.

**Inference.** Evidence bundles must be intentionally sealable and retainable, with owner and retention metadata. They should not be treated like ephemeral execution caches.

### jvm-skills-article-drafts: exploratory agent-system evidence

**Historical perspective.** This repository preserves a staged product history rather than an executable current workflow. The Embabel material moves through a [product interview](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/drafts/creating-embabel-agent-builder-skill/notes/source-chatgpt-ux-interview.md:9), [first-use analysis](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/drafts/creating-embabel-agent-builder-skill/notes/source-codex-agent-builder-first-use.md:16), [implementation](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/drafts/creating-embabel-agent-builder-skill/notes/source-codex-agent-implementation.md:10), [runtime invocation failure](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/drafts/creating-embabel-agent-builder-skill/notes/source-codex-chat-invocation-bug.md:10), [structured-output hardening](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/drafts/creating-embabel-agent-builder-skill/notes/source-codex-structured-output-hardening.md:10), and [live acceptance check](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/drafts/creating-embabel-agent-builder-skill/notes/source-codex-live-acceptance-check.md:38). The draft [README](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/drafts/creating-embabel-agent-builder-skill/README.md:70) records remaining caveats.

**Observed value.** The sequence separates architecture judgment, implementation success, runtime semantic quality, and residual product uncertainty. A green build did not constitute product acceptance.

**Repository-health caveat.** The initial evidence import added 54,510 lines. Fourteen raw session or shell files totaled about 9.8 MB. The working tree deleted a copied 685-line skill snapshot while its README still listed it. The [root README](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/README.md:7) and [draft index](/Users/tschuehly/IdeaProjects/jvm-skills-article-drafts/drafts/README.md:1) disagreed about the available drafts, and additional draft directories were untracked.

**Inference.** Exploratory agent work needs a hypothesis-and-evidence profile: interviews, specifications, code, runtime observations, critique, and acceptance judgments. It should not inherit production browser gates by default, but its unresolved risks must remain visible.

### DataRecovery: team-facing GitHub collaboration

**Observed practice.** Recent changes were integrated through GitHub PRs, with Claude co-author trailers and a Copilot review reference. The repository's local agent surface is small: [CLAUDE.md](/Users/tschuehly/IdeaProjects/DataRecovery/CLAUDE.md:1) and [launch configuration](/Users/tschuehly/IdeaProjects/DataRecovery/.claude/launch.json:1).

**Caveat.** The recent commits were authored by Tobias. They demonstrate repository practice, not that Thomas personally performed those runs.

**Repository-health evidence.** Six tracked `.DS_Store` files were deleted in the working tree, a tracked `.claude/settings.local.json` was modified, and ignored runtime data remained. These are signs that machine-local state and shared project state are not cleanly separated.

**Inference.** GitHub or Linear should remain authoritative for team-visible collaboration records. Local working state should hold the agent's richer interpretation and execution details, with explicit synchronization identifiers rather than using the external tracker as the workflow state machine.

## Cross-repository workflow profiles

The evidence argues against one mandatory quality loop. A shared state and event protocol should support distinct repository or task profiles:

| Profile | Primary work unit | Required proof and review | Representative evidence |
|---|---|---|---|
| Exploratory agent system | Hypothesis or capability slice | Specification, implementation, runtime behavior, critique, residual uncertainty | Embabel session evidence |
| AFK batch research | One deterministic source or candidate | Queue position, checkpoint, model/run metadata, independent sampling or review | `ai-engineer`, `jvm-skills` |
| Focused upstream contribution | One bounded diff | Repository tests, diff review, PR checks | `CLIProxyAPI` |
| Content or visual quality | Page or rendered artifact | Rendered comparison, annotations, accepted visual evidence | `blog`, `lavish-axi` |
| Production-critical live application | Risk-bounded change | Browser or E2E evidence, operational checks, rollback and release gates | User-stated requirement; not established from this repository sample |
| Team collaboration | Issue, decision, or PR | Shared status and durable external references | `DataRecovery`; user-stated GitHub/Linear context |

Repository defaults should be overridable by task risk. A low-risk documentation change in a production repository and a high-risk runtime change in an exploratory repository should not receive identical gates.

## State and artifact lifecycle implications

**Inference from the sample:** terminal and GUI clients should project the same repository-scoped run model rather than implement separate workflows.

| Artifact class | Authority | Lifecycle |
|---|---|---|
| Task intent | Repository-local, immutable or revisioned | Created, approved, superseded |
| Active run state | Small, schema-versioned repository state | Created, advanced by events, completed or aborted |
| Resume cache | Regenerable and normally ignored | Run-scoped, size/age bounded, deleted on close or expiry |
| Review surface | Derived from run and artifacts | Regenerated freely, closed after decisions are applied |
| Evidence bundle | Immutable, intentionally retained | Sealed with owner, purpose, status, and retention policy |
| Handoff view | Generated projection, never sole authority | Produced on demand, consumed or regenerated |
| External collaboration record | GitHub, Linear, or another team system | Synced through stable external identifiers; not used as the local execution state machine |

The host should expose lifecycle operations—resume, seal, archive, prune, regenerate, and sync—as first-class actions. Otherwise, the repeated accumulation visible in `.gnhf/runs`, `.scratch`, generated review pages, and raw session archives will become the default behavior of the workbench.

## Caveats

- This was a local, point-in-time inspection. Ignored files and dirty working trees may be intentional experiments.
- Commit recency does not prove personal usage, team adoption, or that a documented workflow was followed for every commit.
- Retained screenshots and session histories can be valuable evidence. Size alone does not make them garbage; absent ownership and retention semantics make their status ambiguous.
- `jvm-skills-article-drafts` is evidence about prior reasoning and analyzed sessions, not a current product specification.
- The production-critical profile incorporates the user's stated requirement. PhotoQuest supplies the stronger implementation evidence in its separate ledger.
