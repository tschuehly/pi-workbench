# AIHero Evidence Ledger

## Scope

Primary AIHero material about coding-agent harnesses, repository-specific workflows, local and external state, multi-agent execution, human review, resumability, context management, and artifact retention. Reviewed on 2026-07-15.

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

## Retention Claims

1. `progress.txt` is run-scoped working state. It carries completed tasks, decisions, blockers, and changed files between fresh Ralph iterations and is deleted when the sprint completes. Git history remains the durable implementation record.
   - Source: [11 Tips For AI Coding With Ralph](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum), 2026-01-08.
2. Feature research is cached locally to avoid repeated exploration, but normally lives only for the feature or sprint because stale research can send agents in the wrong direction.
   - Source: [My 7 Phases Of AI Development](https://www.aihero.dev/my-7-phases-of-ai-development), 2026-03-16.
3. Prototype code is disposable. Once it answers its question, the answer and question are promoted to a durable commit message, ADR, issue, or notes artifact, then the code is deleted or absorbed.
   - Source: [The `/prototype` Skill](https://www.aihero.dev/skills-prototype), RSS timestamp 2026-07-06.
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
