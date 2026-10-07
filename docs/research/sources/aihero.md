# AIHero Evidence Ledger

## Scope

Primary AIHero material about coding-agent harnesses, repository-specific workflows, local and external state, multi-agent execution, human review, resumability, context management, and artifact retention. Reviewed on 2026-07-15; Skills v1.2 delta reviewed on 2026-08-07; Skills v1.3 delta reviewed on 2026-10-06.

## Author Claims

1. The harness, rather than the model alone, defines agent behavior through tools, system prompts, context management, permissions, hooks, session history, and compaction.
   - Source: [Harness](https://www.aihero.dev/ai-coding-dictionary/harness), living dictionary entry accessed 2026-07-15.
2. A repository should enable only the tools, skills, and workflow capabilities that earn their context cost. Per-project settings are preferable to one maximal configuration.
   - Source: [How To Kill The Bloat In Claude Code's System Prompt](https://www.aihero.dev/how-to-kill-the-bloat-in-claude-codes-system-prompt), 2026-07-07.
3. The current engineering flow is `grilling -> spec -> tickets -> implement -> code-review`. Skills and repository artifacts carry the workflow across fresh agent sessions.
   - Source: [Skills v1.1](https://www.aihero.dev/skills/skills-changelog-v1-1-wayfinder-to-spec-to-tickets-grilling-improvements), 2026-07-08.
4. Ticket blocking edges define the execution frontier. Local tickets can be worked sequentially, while a tracker can expose independent frontier tickets to parallel agents.
   - Sources: [Skills v1.1](https://www.aihero.dev/skills/skills-changelog-v1-1-wayfinder-to-spec-to-tickets-grilling-improvements), 2026-07-08; [The `/to-tickets` Skill](https://www.aihero.dev/skills-to-tickets), current page accessed 2026-07-15.
5. Wayfinder uses GitHub issues as a shared decision map with blocking relationships because the map survives context changes and is collaborative across the team.
   - Source: [Skills v1.1, Wayfinder](https://www.aihero.dev/skills/skills-changelog-v1-1-wayfinder-to-spec-to-tickets-grilling-improvements), 2026-07-08.
6. Multi-agent work is most useful for independent tasks or orthogonal review questions. The current code-review skill runs standards and spec-correctness reviews in separate contexts and preserves both verdicts rather than blending them.
   - Source: [The `/code-review` Skill](https://www.aihero.dev/skills-code-review), current page accessed 2026-07-15.
7. Interactive and AFK operation are two modes over the same Ralph loop. The recommended progression is a watched single iteration, then capped unattended runs for work whose prompt and feedback loops are trusted, followed by commit review.
   - Source: [11 Tips For AI Coding With Ralph](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum), 2026-01-08.
8. Autonomous iterations benefit from fresh contexts that reload their scope, progress, repository state, and Git history. Repeating work inside one growing session retains irrelevant history and degrades the loop.
   - Source: [Why the Anthropic Ralph plugin sucks](https://www.aihero.dev/why-the-anthropic-ralph-plugin-sucks), 2026-01-22.
9. AFK visibility can be built as a projection of structured agent events. The demonstrated Ralph script consumes `stream-json`, renders selected text events in the terminal, and separately captures the completion result.
   - Source: [Stream Claude Code With AFK Ralph](https://www.aihero.dev/heres-how-to-stream-claude-code-with-afk-ralph), 2026-01-22.
10. Human interaction should match the decision. Logic prototypes use a terminal state explorer that exposes the full state after each action; UI prototypes present multiple rendered alternatives for the human to compare.
    - Source: [The `/prototype` Skill](https://www.aihero.dev/skills-prototype), RSS timestamp 2026-07-06.
11. Skills v1.2 enforces the user-invoked versus model-invoked split structurally per harness: `disable-model-invocation: true` in Claude Code and `policy.allow_implicit_invocation: false` in a Codex `agents/openai.yaml` sidecar keep user-invoked skills out of model context until typed.
    - Source: [Skills v1.2 changelog](https://www.aihero.dev/skills/skills-changelog-v12-wait-what-writing-for-agents-claude-code-plugin-and-more), 2026-08-05.
12. Grilling moved from one question per turn to dependency-frontier rounds. The interview is a design tree; each round asks every question whose prerequisites are settled, recomputes the frontier from the answers, and sends environment-answerable facts to subagents so research never blocks a round. The same 13 questions land in about 3 rounds.
    - Source: [Skills v1.2 changelog](https://www.aihero.dev/skills/skills-changelog-v12-wait-what-writing-for-agents-claude-code-plugin-and-more), 2026-08-05.
13. The router's phase-boundary choice is an ordered five-option decision tree — continue, clear, handoff, subagent, compact — where continue is preferred as the only option that keeps the conversation a primary source, handoff is narrowed to work that must travel, and compact is the last resort rather than the first reach.
    - Source: [Skills v1.2 changelog](https://www.aihero.dev/skills/skills-changelog-v12-wait-what-writing-for-agents-claude-code-plugin-and-more), 2026-08-05.
14. Human-only procedure steps are handled by `/wizard`, a generated deterministic bash script that opens URLs, captures pasted values, and writes secrets to `.env` and CI secret stores so no typed secret transits the agent. The agent invokes it when it reaches a step only a human can perform. Externally owned decisions are handled by `/to-questionnaire`, a portable questionnaire aimed at the one person who can answer, where the interview grills about the send rather than the subject.
    - Source: [Skills v1.2 changelog](https://www.aihero.dev/skills/skills-changelog-v12-wait-what-writing-for-agents-claude-code-plugin-and-more), 2026-08-05.
15. Writing-for-agents gains the pruning term "cache": a document restating what the environment already answers (scripts, config, directory layout, `--help`) is a cache of a cheap lookup and rarely earns its context load. Cache only what the agent cannot find by looking — unwritten conventions, reasons behind choices, edge cases no config confesses.
    - Source: [Skills v1.2 changelog](https://www.aihero.dev/skills/skills-changelog-v12-wait-what-writing-for-agents-claude-code-plugin-and-more), 2026-08-05.

## Retention Claims

1. `progress.txt` is run-scoped working state. It carries completed tasks, decisions, blockers, and changed files between fresh Ralph iterations and is deleted when the sprint completes. Git history remains the durable implementation record.
   - Source: [11 Tips For AI Coding With Ralph](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum), 2026-01-08.
2. Feature research is cached locally to avoid repeated exploration, but normally lives only for the feature or sprint because stale research can send agents in the wrong direction.
   - Source: [My 7 Phases Of AI Development](https://www.aihero.dev/my-7-phases-of-ai-development), 2026-03-16.
3. Prototype code is disposable. Once it answers its question, the answer and question are promoted to a durable commit message, ADR, issue, or notes artifact, then the code is deleted or absorbed.
   - Source: [The `/prototype` Skill](https://www.aihero.dev/skills-prototype), RSS timestamp 2026-07-06.
   - Revised in v1.2: throwaway no longer means deleted. The prototype is kept as runnable evidence on a `prototype/<name>` branch off main with a context pointer on the implementation issue; main keeps only the validated decision. Research findings are likewise captured on `research/<name>` branches, burned down in parallel by AFK `/research` subagents during charting.
   - Source: [Skills v1.2 changelog](https://www.aihero.dev/skills/skills-changelog-v12-wait-what-writing-for-agents-claude-code-plugin-and-more), 2026-08-05.
4. A handoff contains only the resumable live thread and references settled specs, ADRs, issues, commits, and diffs rather than copying them. It is stored in the operating system's temporary directory so it does not become another workspace artifact to maintain.
   - Source: [The `/handoff` Skill](https://www.aihero.dev/skills-handoff), RSS timestamp 2026-07-06.
5. Compaction is lossy. It is safest at a deliberate phase boundary after important decisions have been written to inspectable artifacts. Clearing is appropriate when settled state already lives somewhere better than the polluted session.
   - Sources: [Compaction](https://www.aihero.dev/ai-coding-dictionary/compaction), [Clearing](https://www.aihero.dev/ai-coding-dictionary/clearing), living dictionary entries accessed 2026-07-15.
6. Standing instructions should contain only stable, globally relevant facts. Auto-generated repository summaries and structural descriptions become stale, consume the instruction budget, and poison future context. Situational guidance belongs in progressively disclosed skills and references.
   - Sources: [A Complete Guide To AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md), 2026-01-18; [Never Run Claude `/init`](https://www.aihero.dev/never-run-claude-init), 2026-02-24.
7. Durable domain knowledge has a promotion bar. Canonical terms belong in a focused glossary, while only consequential, surprising, hard-to-reverse trade-offs belong in ADRs. The glossary is not a specification or scratch pad, and ADRs are not a work diary.
   - Source: [The `/domain-modeling` Skill](https://www.aihero.dev/skills-domain-modeling), RSS timestamp 2026-07-08.
8. Stable repository workflow choices can be retained as small configuration artifacts describing the tracker adapter, label-role mapping, and domain-document locations.
   - Source: [The `/setup-matt-pocock-skills` Skill](https://www.aihero.dev/skills-setup-matt-pocock-skills), RSS timestamp 2026-07-08.

## Tensions and Gaps

- Wayfinder makes GitHub issues the shared planning graph and workflow state. This is useful for collaboration but conflicts with the proposed workbench boundary in which local run state is authoritative and GitHub or Linear is an external collaboration projection.
- `to-tickets` presents local files and external trackers as alternative media for the same dependency artifact. The proposed workbench needs both at once: an authoritative local execution graph and a synchronized external view.
- AIHero's material supports structured terminal visibility and task-specific prototypes, but it does not provide direct evidence for a universal graphical workbench.
- No explicit cleanup policy was found for completed or stale specs and tickets. Current material explains how they carry multi-session intent but not when local copies should be removed or external records archived.
- Handoffs, summaries, and subagent reports are secondary sources. They are useful for context efficiency but should point back to code, tests, diffs, transcripts, and raw evidence when correctness matters.

## Implications for the Evolving Spec

These are architectural inferences from the evidence rather than claims made by AIHero.

- Pi should be the repository-configured workflow runtime. A small durable repository contract selects skills, tools, provider policies, external adapters, feedback gates, and available surfaces.
- Terminal and GUI clients should share a structured event and command protocol rather than identical presentation. The terminal can project logs and prompts; the GUI can project diffs, dependency maps, approvals, prototypes, and AFK supervision.
- Run state should be local, durable, resumable, and separate from Pi session history. Fresh Pi, Claude, or Codex contexts operate over the same run ledger.
- GitHub and Linear should remain collaboration systems and receive relevant projections. External edits enter the local run as explicit inbound events that can be reconciled, rather than silently becoming a second workflow engine.
- Multi-agent orchestration should favor isolated workers on dependency-frontier tasks and orthogonal review axes. Outputs should be anchored to primary artifacts rather than free-form agent-to-agent narratives.
- Interactive and AFK modes should apply different supervision, approval, notification, and retry policies to the same workflow definition and run state.
- Repository-specific retention policy should classify artifacts as ephemeral session state, run-scoped working state, refreshable research, durable decisions, or primary evidence.
- Cleanup should follow `working -> completed -> promotion review -> durable pointers written -> external projection updated -> scratch eligible for deletion`.
- Automatic deletion on completion is unsafe when useful decisions have not been promoted. Repositories should define which artifact classes require a human promotion or deletion gate.
- Research artifacts should record source and verification dates. Their expiry or mandatory revalidation window should reflect the repository's dependency volatility and risk.
- Accepted language and decisions should be promoted selectively into glossaries, ADRs, skills, or stable workflow configuration. Raw reasoning and transient execution detail should not accumulate in standing instructions.

## Confidence

- Dated primary AIHero articles and skill pages: high.
- Living dictionary entries: high for current author definitions, but they do not expose publication dates.
- Universal GUI implications: inferred; AIHero offers no direct validation of that product shape.
- Spec and ticket retention policy: open design decision due to missing direct guidance.

## Skills v1.3 Delta (reviewed 2026-10-06)

Source state: [`mattpocock/skills`](https://github.com/mattpocock/skills) at [`2b47ffc`](https://github.com/mattpocock/skills/commit/2b47ffcf2385995a536e43ddc9226e32cf9793d9) (2026-10-06), which contains tags `v1.3.0` (2026-09-29) and `v1.3.1` (2026-10-04). Links below are pinned to that commit. `M` abbreviates `https://github.com/mattpocock/skills/blob/2b47ffc`.

Maturity: `implement-spec`, `retro`, and `pr` graduated into the shipped Engineering bucket in v1.3.0. `chief-of-staff` is in `skills/in-progress/`: four commits on 2026-10-05 and 2026-10-06, with no docs page and no published evidence of runs. Neither upstream skill ships tests or run evidence, so every claim below is a prompt-level design claim, not demonstrated behavior.

### Author Claims

1. **`implement-spec`** builds a whole spec in one run. Tickets are a **task graph** whose blocking edges define a ready **frontier**. Background implementer subagents work frontier tickets, each in its own worktree and branch. Each implementer confirms its worktree is based on the integration branch, builds with `tdd`, and merges the integration tip into its own branch before reporting done, "so each merge is a fast-forward". A merger subagent lands the work on one **integration branch**, and new frontier tickets start as soon as earlier ones land. An optional exploration subagent saves notes outside the repo for all later implementers. Communication goes through context pointers (spec, tickets, notes, commits), not copied content. The goal is the integration branch; a draft PR opens only if the tracker closes work through PRs or the user asks. `code-review` runs on the integration branch at the end, and one implementer fixes its findings.
   - Sources: [`M/skills/engineering/implement-spec/SKILL.md`](https://github.com/mattpocock/skills/blob/2b47ffc/skills/engineering/implement-spec/SKILL.md); [CHANGELOG 1.3.0, #1120](https://github.com/mattpocock/skills/blob/2b47ffc/CHANGELOG.md).
2. **`chief-of-staff`** is one long session acting as the Directly Responsible Individual for a goal, "accruing tribal knowledge". All work runs in background subagents to protect the coordinator's context and keep it in dialogue with the user. Communication is sparse and uses context pointers. It thinks on two tracks: tactical (finish the immediate task) and strategic (change the environment so the next task goes better). It considers environment improvement "FIRST": constrained APIs, lint rules, `CODING_STANDARDS.md`, access to logs, databases, and the browser, and a "no workarounds" rule. Where the harness allows, it suggests recurring schedules.
   - Source: [`M/skills/in-progress/chief-of-staff/SKILL.md`](https://github.com/mattpocock/skills/blob/2b47ffc/skills/in-progress/chief-of-staff/SKILL.md).
3. The `CONTEXT.md`/`CONTEXT-MAP.md` domain-doc convention is renamed to `GLOSSARY.md`/`GLOSSARY-MAP.md` in every skill that reads or writes it. Existing files must be moved with `git mv`, because the skills look only for the new names.
   - Source: [CHANGELOG 1.3.0, `006a52b`](https://github.com/mattpocock/skills/blob/2b47ffc/CHANGELOG.md).
4. Cross-skill dependencies are written as `Call the Skill tool with "x"`, one skill per call, because naming a skill in prose (`/x`) "does not reliably cause it to load" (upstream issue #453). The convention applies only to model-invoked skills. For a user-invoked precondition, the skill tells the human to run it.
   - Sources: [`M/.agents/invocation.md`](https://github.com/mattpocock/skills/blob/2b47ffc/.agents/invocation.md); [CHANGELOG 1.3.0, #878 and #880](https://github.com/mattpocock/skills/blob/2b47ffc/CHANGELOG.md).
5. The phase-boundary tree (continue, clear, handoff, subagent, compact; first yes wins) is unchanged in substance since v1.2. Its only v1.3 diff is the em-dash sweep. Claim 13 above still describes it.
   - Source: [`M/skills/engineering/ask-matt/PHASE-BOUNDARIES.md`](https://github.com/mattpocock/skills/blob/2b47ffc/skills/engineering/ask-matt/PHASE-BOUNDARIES.md).
6. **`retro`** suggests changes to the agent's environment, not the code: navigation pointers, automated checks, coding standards, steering-file size, no-op instructions, tool economy, and information access. A mechanical violation gets a deterministic check, and `CODING_STANDARDS.md` is kept for judgement calls. **`pr`** shapes a PR body as the smallest clarifying visual, before/after evidence, and a "merge danger" call (one-way or two-way door, plus blast radius). `resolving-merge-conflicts` is removed with no replacement.
   - Sources: [`M/skills/engineering/retro/SKILL.md`](https://github.com/mattpocock/skills/blob/2b47ffc/skills/engineering/retro/SKILL.md); [CHANGELOG 1.3.0](https://github.com/mattpocock/skills/blob/2b47ffc/CHANGELOG.md).

### Comparison and Verdicts

Owner decision (Thomas, 2026-10-06): the two ideas worth borrowing are `implement-spec`'s parallel landing pattern and `chief-of-staff`'s goal-owner pattern. They belong in Pi Workbench as recorded notes, not as a build. Nothing below authorizes implementation.

**1. Parallel frontier implementation onto one integration branch: adapt (note only).**
- Problem it addresses: on 2026-10-05, in session `01a10ad8`, the owner asked "Can we parallelize?", then "stack them?", then "I want bigger PRs". The lead ran parallel implementer subagents, each preparing a separate local branch "to be combined later" by hand. `implement-spec` gives that sequence one shape: parallel work on the frontier, landed on one integration branch that becomes one larger PR.
- Mechanisms worth keeping: (a) dispatch from the ready frontier of a dependency graph; (b) one worktree and branch per implementer; (c) **the implementer merges the integration tip before reporting**, so the agent that holds the ticket's context resolves the conflicts and every land is a fast-forward; (d) exploration notes written once, outside the repo, and passed to implementers as pointers.
- Current Workbench reality: the `subagent` tool gives children no workspace isolation ([`extensions/subagent/README.md`](../../../extensions/subagent/README.md)). Worktrees are created by hand with `wt`. No integration-branch or fast-forward convention exists, and frontier dispatch is the intended Semantic Execution Graph, not implemented behavior. Upstream is ahead on this narrow mechanism. Workbench is ahead on model routing, independent review, and its stated stance on authority.
- Destination when built: Repository Workspace for the worktree, integration-branch, and fast-forward rule; Semantic Execution Graph for frontier dispatch; Work Packet for pointer-only context. Notes go under `$PI_TMP` or `~/.pi-workbench/scratch/<workstream-id>/`, never `/tmp` or a repo `.scratch/`.
- Evidence that would prove it: a multi-ticket change lands with no lead-side conflict resolution, every land is a fast-forward, and the owner gets one reviewable PR in less wall-clock time than serial implementation.
- Must stay unchanged: Pi as the only worker runtime; landing and publication remain owner-authorized; the merger is a delegated step, not a second authority.

**2. Single goal-owner session coordinating background work: adapt (note only), with a weaker fit than item 1.**
- Problem it addresses: overnight and AFK runs that stall. Owner-cited example: session `01a11007` on 2026-10-06. The useful parts are one owner per goal, all work delegated to background children, sparse pointer-based reports, and a standing strategic track that improves the environment while the tactical work proceeds.
- Comparison with current Workbench, stated honestly:
  - **Workstreams** already restore attention across sessions durably ([`docs/contracts/workstreams.md`](../../contracts/workstreams.md)). `chief-of-staff` keeps its "tribal knowledge" in one session's context, which compaction and session death destroy. Workbench is better on durability. It has no explicit goal-owner role; the attended lead plays that role informally.
  - **`define-goal`** gives a verifiable objective and success criteria ([`skills/define-goal/SKILL.md`](../../../skills/define-goal/SKILL.md)). `chief-of-staff` has no done condition or evidence bar. Workbench is better here.
  - **`model-orchestration`** routes children by Cognitive Role and requires independent review ([`skills/model-orchestration/SKILL.md`](../../../skills/model-orchestration/SKILL.md)). `chief-of-staff` says nothing about model choice or review. Workbench is better here.
  - On stalls, `chief-of-staff` assumes the long session stays alive. Workbench background children die on `session_shutdown`, and durable unattended execution is deferred to the controller ([`extensions/subagent/README.md`](../../../extensions/subagent/README.md)). The skill is a prompt and gives no stall detection or recovery, so it does not fix the observed failure by itself.
  - The strategic track overlaps `skills/compound`. "FIRST consider how the environment might be improved" can crowd out the tactical task unless it is bounded.
- What is worth noting: the two-track framing and the explicit goal-owner stance on top of `define-goal`, Workstreams, and background subagents. Upstream is converging on the Workbench design rather than ahead of it.
- Evidence that would prove it: a goal-owner AFK run whose stall rate and owner interventions are lower than the 2026-10-06 baseline, with at least one environment improvement landed per run that does not delay the tactical deliverable.
- Must stay unchanged: Workstreams grant no execution authority; FirstMate stays non-mutating; durable recovery remains a controller concern and does not move into a long session's context.

**3. `GLOSSARY.md` rename: no Pi Workbench change.** Workbench terminology lives in [`docs/foundation/vocabulary.md`](../../foundation/vocabulary.md), and this repository has no `CONTEXT.md`. The rename affects repositories that use the vendored `domain-modeling` family, and those must `git mv` their `CONTEXT.md`. That migration belongs to each repository and to the skill-incubator vendoring, not to Workbench.

**4. "Call the Skill tool" convention: adapt (wording only, unverified).** Pi has no `Skill` tool. Pi loads a skill when the agent reads the `SKILL.md` listed in its skill catalog. The transferable lesson is that an operative, explicit instruction beats a bare `/name` mention. For Workbench-authored skills, the equivalent wording is "Load the `x` skill" (read its `SKILL.md`). Vendored upstream skills keep the literal "Call the Skill tool" text, and nobody has yet checked whether Pi agents reliably follow it.

**5. `PHASE-BOUNDARIES.md` tree versus `compact_and_continue`: no new lesson.** [`extensions/context-checkpoint/`](../../../extensions/context-checkpoint/README.md) already limits compaction to a completed phase whose next phase is concrete and benefits from a smaller context. That covers the tree's "continue first, compact last" ordering for one mechanism. The tree's ordering of clear, handoff, and subagent is still not stated locally. The v1.2 recommendation to fold it into session-boundary guidance ([`../reports/aihero-skills-v1.2-analysis.md`](../reports/aihero-skills-v1.2-analysis.md), item 2) remains open, and v1.3 adds no new evidence.

**Not decided:** `retro`'s environment categories, especially "mechanical violation → deterministic check", are candidates for `skills/compound`'s evaluation questions. `pr`'s merge-danger call is a candidate for PR-body guidance. Both need an owner decision before anyone acts on them.
