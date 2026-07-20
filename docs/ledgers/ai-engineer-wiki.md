# AI Engineer Wiki Evidence Ledger

## Scope

Source-backed patterns from the AI Engineer Wiki relevant to the Pi Project Workbench specification. The review covers agent harnesses, repository-specific workflows, durable local state, external collaboration boundaries, interactive and AFK operation, role-specific model workers, bounded dynamic UI, context hygiene, artifact promotion, provenance, staleness, retention, and garbage collection.

The wiki concepts summarize conference talks and include source timestamps. Findings below are evidence from those concepts. Sections labeled **Synthesis** are architectural implications for [the current specification](../SPEC.md), not claims made directly by a source.

## Architecture Findings

### Harness and repository workflow

1. A practical agent product is a harness around the model. The harness owns tools, prompts, filesystem context, skills, subagents, compaction, hooks, and memory.
   - Concept: [Agent harnesses combine model, tools, prompts, filesystem, skills, hooks, and memory](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/agent-harnesses-combine-model-tools-prompts-filesystem-skills-hooks-and-memory.md)
   - Provenance: Thariq Shihipar, Anthropic, “Claude Agent SDK,” 03:08–05:52; Alex Bauer, Upside.tech, “Design Patterns for AI Trust,” 15:24–16:34.
2. Repository-local task files give an agent scoped, resumable work units with requirements, acceptance criteria, status, and implementation notes outside the live context window.
   - Concept: [Repo-local Markdown tasks give agents durable scoped work units](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/repo-local-markdown-tasks-give-agents-durable-scoped-work-units.md)
   - Provenance: Alex Gavrilescu, Funstage, “Backlog.md: Terminal Kanban Board for Managing Tasks with AI Agents,” 00:47–01:17, 03:14–04:22, 11:08–13:37.
3. Agent modes, repository rules, tools, permissions, workspace boundaries, and approval policies should evolve with observed workflow behavior.
   - Concept: [Configure agent modes, rules, and permissions as the workflow evolves](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/configure-agent-modes-rules-and-permissions-as-the-workflow-evolves.md)
   - Provenance: Brendan O’Leary, “Agentic Engineering: Working With AI, Not Just Using It,” 13:45–22:43.
4. Tool sets should be selected for the current workflow. Broad generic integration surfaces add irrelevant choices and context load.
   - Concept: [Task-tuned tool sets beat generic integration surfaces for core coding loops](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/task-tuned-tool-sets-beat-generic-integration-surfaces-for-core-coding-loops.md)
   - Provenance: Beyang Liu, “Amp Code: Next Generation AI Coding,” 03:58–05:58.

**Synthesis for the specification:** These findings support the `Repository Package`, `Workflow Policy`, and role-specific tool declarations. Pi should own the shared harness contract while repositories provide versioned policy and workflow capabilities.

### Durable state and external side effects

1. Production agent loops need persisted workflow state so crashes, rate limits, and downstream failures do not repeat expensive or side-effecting work.
   - Concept: [Use durable execution for production agent loops](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/use-durable-execution-for-production-agent-loops.md)
   - Provenance: Cornelia Davis, Temporal, “OpenAI + Temporal,” 07:46–11:35 and 50:05–51:44; Peter Wielander, Vercel, “Building Durable Agents,” 12:24–17:23; Samuel Colvin, Pydantic, “From Stateless Nightmares to Durable Agents,” 04:03–04:44 and 08:34–10:42; Preeti Somal, Temporal, “Scaling AI Agents,” 01:14–03:15.
2. Durable orchestration should be deterministic. LLM calls, tool calls, external APIs, and other side effects belong in explicit steps whose results can be recorded and retried safely.
   - Concept: [Keep workflow orchestration deterministic and put side effects in steps](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/keep-workflow-orchestration-deterministic-and-put-side-effects-in-steps.md)
   - Provenance: Peter Wielander, 12:24–13:17 and 16:10–16:26; Samuel Colvin, 04:47–05:36.
3. Agent handoffs are safer with immutable versioned snapshots, creator metadata, schema validation, and append-only lineage rather than shared mutable records.
   - Concept: [Use immutable versioned state for agent handoffs](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/use-immutable-versioned-state-for-agent-handoffs.md)
   - Provenance: Sandipan Bhaumik, “From Chaos to Choreography,” 11:24–16:24.
4. Local validation shortens feedback loops and should happen before remote CI or deployment when possible.
   - Concept: [Local-first platform workflows shorten agent feedback loops](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/local-first-platform-workflows-shorten-agent-feedback-loops.md)
   - Provenance: Juan Herreros Elorza, “Platforms for Humans and Machines,” 10:04–11:32.

**Synthesis for the specification:** These findings support the local `Durable Run Ledger`, explicit `External Adapters`, idempotent publication, versioned handoffs, validation records, and reconciliation before an external change affects execution. The wiki does not prescribe the specification’s exact snapshot-plus-bounded-tail representation; that representation is a workbench design decision.

### Interactive, AFK, and multiple clients

1. Resumable streams let the UI receive progress while the backend records inspectable workflow steps, inputs, outputs, and events.
   - Concept: [Use resumable streams as the UI boundary for durable agents](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/use-resumable-streams-as-the-ui-boundary-for-durable-agents.md)
   - Provenance: Peter Wielander, 04:34–04:50 and 16:35–18:03.
2. Human approvals and other long waits should be logical workflow state rather than a live process that must stay allocated.
   - Concept: [Treat long waits as logical workflow state](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/treat-long-waits-as-logical-workflow-state.md)
   - Provenance: Cornelia Davis, 58:24–62:19; Samuel Colvin, 18:08–18:15.
3. Background agents need an asynchronous route for step-up authorization after the original interaction has ended.
   - Concept: [Plan asynchronous authorization for background agents](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/plan-asynchronous-authorization-for-background-agents.md)
   - Provenance: Jared Hanson, “How to Secure Agents Using OAuth,” 17:13–17:39.
4. Long-running agents should be presented as asynchronous workers with visible progress, diffs, tests, artifacts, handoffs, and controls.
   - Concept: [Treat long-horizon agents as asynchronous workers with evolving interfaces](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/treat-long-horizon-agents-as-asynchronous-workers-with-evolving-interfaces.md)
   - Provenance: Jason Warner and Eiso Kant, Poolside, “AGI: The Path Forward,” 03:27–07:59, 08:20–08:35, and 10:30–10:47.
5. Agent-facing products need APIs, CLIs, and MCP surfaces in addition to dashboards.
   - Concept: [Agent experience prioritizes APIs, CLIs, and MCP over dashboards](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/agent-experience-prioritizes-apis-clis-and-mcp-over-dashboards.md)
   - Provenance: swyx, “Agents for Everything Else,” 12:48–13:38; Malte Ubl, Vercel, “The New Application Layer,” 13:00–13:38; Max Kanat-Alexander, “Developer Experience in the Age of AI Coding Agents,” 04:36–05:07 and 16:37–17:18; Ivan Burazin, Daytona, “AX Is the Only Experience That Matters,” 03:07–06:29 and 14:30–15:02.

**Synthesis for the specification:** These findings support one durable run shared by interactive and AFK modes, a structured event boundary, notification and pending-authority flows, and terminal and GUI projections with different rendering capabilities.

### Bounded dynamic UI and review surfaces

1. Complex agent work benefits from persistent, domain-specific artifacts rather than a linear chat as the primary collaboration surface.
   - Concept: [Collaborate with complex agents through high-bandwidth artifacts](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/collaborate-with-complex-agents-through-high-bandwidth-artifacts.md)
   - Provenance: Jacob Lauritzen, Legora, “Agents Need More Than a Chat,” 11:15–14:02.
2. Dynamic artifacts make plans, questions, diagrams, screenshots, recordings, walkthroughs, and comments reviewable and reusable.
   - Concept: [Dynamic artifacts make agent work reviewable and reusable](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/dynamic-artifacts-make-agent-work-reviewable-and-reusable.md)
   - Provenance: Kevin Hou, Google DeepMind, “Defying Gravity,” 12:48–19:20.
3. MCP applications let a server ship UI resources and tools with shared semantics across supporting hosts. The host renders the UI in a sandbox while the model uses the associated tools.
   - Concept: [MCP applications ship UI and tools together](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/mcp-applications-ship-ui-and-tools-together.md)
   - Provenance: David Soria Parra, Anthropic, “The Future of MCP,” 00:22–01:32 and 16:16–16:32; Frédéric Barthelet, Alpic, “Why MCP and ChatGPT Apps Use Double Iframes,” 01:43–13:39; Marlene Mhangami and Liam Hampton, GitHub, “Building Interactive UIs in VS Code with MCP Apps,” 05:15–15:10.
4. Model-generated or third-party UI is untrusted code and needs an origin and execution boundary.
   - Concept: [Render third-party generative UI through a double iframe](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/render-third-party-generative-ui-through-a-double-iframe.md)
   - Provenance: Frédéric Barthelet, 02:02–14:00; Ruben Casas, Postman, “Beyond Components,” 11:25–13:21.
5. Products should establish reusable primitives before adding isolated feature surfaces.
   - Concept: [Build product primitives before feature surfaces](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/build-product-primitives-before-feature-surfaces.md)
   - Provenance: Dax Raad, OpenCode, “AI Changes Nothing,” 10:45–15:07.

**Synthesis for the specification:** These findings support the `Stable Workbench Shell` and `Project Surfaces` trust boundary: a trusted declarative catalog for common interactions, sandboxed application views for complex repository experiences, and terminal fallbacks. They also support implementing a generic surface protocol before project-specific Pi GUI screens.

### Model roles and bounded parallelism

1. Subagents are most useful when task, model, reasoning budget, tools, and permissions are selected together. Review and security agents should generally be read-only.
   - Concept: [Customize subagents by task, model, tools, and permissions](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/customize-subagents-by-task-model-tools-and-permissions.md)
   - Provenance: Vaibhav Srivastav and Katia Gil Guzman, “OpenAI Codex Masterclass,” 32:39–35:24 and 41:40–43:58; Beyang Liu, 06:42–09:06.
2. Ralph loops work one scoped ticket at a time with fresh context, validation, and handoff. Large dependency graphs and early parallelism fail when agents cannot reliably determine completion, blocking, or contention.
   - Concept: [Ralph loops process one ticket at a time with fresh context](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/ralph-loops-process-one-ticket-at-a-time-with-fresh-context.md)
   - Provenance: Chris Parsons, Cherrypick, “Ralph Loops: Build Dumb AI Loops That Ship,” 09:20–10:28, 23:20–25:18, 28:34–30:26, and 49:22–50:20.
3. Parallel agent queues need focus-preserving review surfaces and should scale only after review and merge paths are reliable.
   - Concept: [Parallel coding-agent queues need focus-preserving review interfaces](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/parallel-coding-agent-queues-need-focus-preserving-review-interfaces.md)
   - Provenance: Louis Knight-Webb, “Software Engineering Is Becoming Plan and Review,” 07:26–15:28; Robert Brennan, OpenHands, 17:28–18:01; Beyang Liu, 02:48–03:18 and 11:21–12:35; Kevin Hou, 04:39–05:13 and 19:20–20:29.

**Synthesis for the specification:** These findings support `Model workers are role-specific` and the principle that review capacity, dependencies, and isolation bound concurrency. Multiple model subscriptions increase routing options; they do not justify maximizing worker count.

## State and Cleanup Findings

### Disposable context and resumable state

1. Long context is temporary working memory, not reliable durable knowledge.
   - Concept: [Do not treat long context as durable model memory](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/do-not-treat-long-context-as-durable-model-memory.md)
   - Provenance: Jack Morris, “Stuffing Context Is Not Memory,” 02:35–07:51.
2. Active context should be trimmed while durable information remains outside the window and is reloaded selectively.
   - Concept: [Keep agent context small, fresh, and task-specific](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/keep-agent-context-small-fresh-and-task-specific.md)
   - Provenance: Brendan O’Leary, 04:33–11:15; Dex Horthy, 04:38–05:43 and 12:14–14:10; Benjamin Verbeek, Lovable, 10:27–11:02.
3. Old tool outputs should be removed from the working window while reusable state is stored elsewhere.
   - Concept: [Context window editing clears stale tool results](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/context-window-editing-clears-stale-tool-results.md)
   - Provenance: Katelyn Lesse, Anthropic, “Evolving Claude APIs for Agents,” 03:50–07:17; Stephen Chin, Neo4j, 04:17–04:43.

**Synthesis for the specification:** These findings support the four state classes in `State and Knowledge Lifecycle`. Raw prompts, tool outputs, logs, and scratch files are execution data, not standing project knowledge.

### Promotion rather than accumulation

1. Raw session JSONL is useful evidence but long and full of junk. Session-end or PR-merge extraction should isolate high-value struggle patterns before periodic analysis.
   - Concept: [Mine agent conversation history to generate missing skills](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/mine-agent-conversation-history-to-generate-missing-skills.md)
   - Provenance: Zack Proser, WorkOS, “Your Attention Is the Bottleneck,” 13:22–15:31 and 20:07–21:30; Vincent Koc, OpenClaw, 13:20–14:21.
2. Reusable fixes should be generalized across similar failures, verified by an evaluator, injected only when relevant, measured with holdouts, and discarded when their value falls or their assumptions become stale.
   - Concept: [Mine stuck-then-solved sessions for injectable fixes](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/mine-stuck-then-solved-sessions-for-injectable-fixes.md)
   - Provenance: Benjamin Verbeek, Lovable, “How Lovable Self-Improves Every Hour,” 05:22–12:00.
3. Skills preserve reusable procedural knowledge but are not a general-purpose replacement for all memory.
   - Concept: [Skills turn procedural feedback into transferable agent memory](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/skills-turn-procedural-feedback-into-transferable-agent-memory.md)
   - Provenance: Barry Zhang and Mahesh Murag, Anthropic, “Don’t Build Agents, Build Skills Instead,” 12:02–14:29.
4. Context needs a generate, evaluate, distribute, observe, adapt, and regenerate lifecycle.
   - Concept: [Context development lifecycle treats context as an engineered artifact](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/context-development-lifecycle-treats-context-as-an-engineered-artifact.md)
   - Provenance: Patrick Debois, Tessl, “Context Is the New Code,” 01:41–06:03.

**Synthesis for the specification:** These findings support `ephemeral → candidate → active → retired → purged`. Promotion requires scope, provenance, validation, and an invalidation or revalidation trigger. Raw conversation history remains evidence for extraction and does not become canonical knowledge.

### Staleness, provenance, and retirement

1. Completed planning documents can mislead later agents after names, file structures, requirements, and implementation details change. Completed plans should leave default retrieval.
   - Concept: [Retire completed planning docs before they become agent doc rot](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/retire-completed-planning-docs-before-they-become-agent-doc-rot.md)
   - Provenance: Matt Pocock, “Full Walkthrough: Workflow for AI Coding,” 01:24:19–01:26:08.
2. Specs should be feature-scoped, amended when current work changes them, and pruned when future reuse is unlikely.
   - Concept: [Keep spec artifacts feature-scoped, mutable, and context-backed](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/keep-spec-artifacts-feature-scoped-mutable-and-context-backed.md)
   - Provenance: Al Harris, Amazon Kiro, “Spec-Driven Development,” 08:33–15:15, 48:49–55:24, and 01:01:34–01:03:05.
3. Generated context-engine answers become stale and can reinforce earlier mistakes. Current conclusions should be recomputed from source-backed structures rather than cached as truth.
   - Concept: [Do not cache context-engine answers as durable truth](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/do-not-cache-context-engine-answers-as-durable-truth.md)
   - Provenance: Peter Werry, Unblocked, “Mergeable by Default,” 19:10–19:41, 24:42–25:28, and 38:26–39:19.
4. Unresolved contradictions between code, documentation, tickets, and conversations should be surfaced with provenance rather than hidden behind a guessed resolution.
   - Concept: [Surface unresolved context conflicts to agents and users](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/surface-unresolved-context-conflicts-to-agents-and-users.md)
   - Provenance: Peter Werry, 11:23–11:56, 16:08–16:31, 24:04–24:39, and 37:37–37:55.

**Synthesis for the specification:** Staleness should be based on changed revisions, hashes, dependency versions, approvals, and validation scope rather than age alone. These findings support `Staleness and Reconciliation`, provenance metadata, `supersedes` relationships, and retirement from active retrieval.

### Retention and garbage collection

1. Workflow history is valuable for debugging, replay, observability, and compliance.
   - Concept: [Record workflow history for agent debugging and compliance](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/record-workflow-history-for-agent-debugging-and-compliance.md)
   - Provenance: Preeti Somal, Temporal, “Scaling AI Agents Without Breaking Reliability,” 02:57–03:15 and 10:42–12:05.
2. Always-on agents need maintenance jobs for indexing, backups, memory promotion, cleanup, and guardrails. Without hygiene, bad memory and brittle workflows compound.
   - Concept: [Ambient agents need self-maintenance and memory hygiene](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/ambient-agents-need-self-maintenance-and-memory-hygiene.md)
   - Provenance: Radek Sienkiewicz, “I Gave an AI Agent the Keys to My Life,” 08:59–17:20.
3. Deterministic rules should live in hooks, tests, linters, CI, and ADRs rather than relying on prompt memory across long sessions.
   - Concept: [Enforce agent rules in Git hooks and CI, not the prompt](https://github.com/tschuehly/ai-engineer/blob/main/data/ai_engineer_youtube/wiki/concepts/enforce-agent-rules-in-git-hooks-and-ci-not-the-prompt.md)
   - Provenance: Michal Cichra, Safe Intelligence, “Capturing Decisions for Humans and AI Alike,” 01:27–01:36, 02:47–03:26, and 07:44–11:44.

**Synthesis for the specification:** The wiki establishes the need to retain inspectable history and to perform active cleanup, but it does not define a garbage-collection algorithm or universal retention duration. The specification’s mark phase, artifact classes, repository-defined retention windows, protected pins, content-addressed blobs, promotion review, and orphan cleanup are workbench design choices derived from those requirements. Logical append-only lineage does not require infinite physical retention of every raw payload.

## Current Specification Connections

- `Product Principles` 2, 3, 4, 5, 6, 8, and 10 reflect the state, side-effect, client, lifecycle, and concurrency evidence.
- `Durable Run Ledger` applies durable execution and immutable handoff findings through resumable snapshots, a bounded event tail, and referenced artifacts.
- `Event and Stream Boundary` applies resumable-stream and long-running-worker findings.
- `Stable Workbench Shell` and `Project Surfaces` apply the high-bandwidth artifact and sandboxed MCP application findings.
- `Interactive and AFK Modes` applies durable waits and asynchronous authorization.
- `State and Knowledge Lifecycle` applies disposable context, candidate promotion, document retirement, and memory hygiene.
- `Staleness and Reconciliation` applies current-source recomputation, source-conflict surfacing, and planning-document drift.
- `Testing Decisions` makes deterministic transitions, recovery, invalidation, cleanup, and trust boundaries executable rather than prompt-dependent.

## Confidence and Limits

- Confidence is high that active model context should remain disposable, side effects should be explicit, project UI should be bounded, and reusable knowledge needs evaluation and retirement.
- Confidence is high that terminal and GUI clients should consume a shared machine-oriented workflow boundary while rendering different interaction surfaces.
- The exact ledger schema, snapshot cadence, retention periods, mark-and-sweep implementation, synchronization transport, promotion authority, and pi-gui contribution contract remain product design decisions rather than sourced prescriptions.
