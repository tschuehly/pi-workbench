# Prime Agent Recursive-Context Evidence Ledger

## Scope

Dan's claim that coding-agent context should resemble a call stack or flame graph rather than a
linear chat, and the Prime Agent implementation cited as realizing that direction.

Reviewed on 2026-08-10 against:

- [Dan's original post, 2025-12-22](https://x.com/irl_danB/status/2003223600195625356)
- [Dan's Prime Agent follow-up, 2026-08-10](https://x.com/irl_danB/status/2086798648306704886)
- Prime Agent package version `0.7.1`, `beta` tag, commit
  [`d1b072686d6b7b1b7d2ad773541e33aba1f578d9`](https://github.com/PrimeIntellect-ai/prime-agent/tree/d1b072686d6b7b1b7d2ad773541e33aba1f578d9)
- [Prime Agent launch article](https://www.primeintellect.ai/blog/prime-agent), published 2026-08-05

The supplied flame-graph image reports one failed run with 432 sessions, maximum physical depth 9,
15.71 million total tokens, 15.49 million input-side tokens, 218.6 thousand output tokens, $27.71
cost, and 2,056.5x payload amplification. The image says it was generated from session JSONL and
RLM-subagent registries, but the named evaluation script and run data were not found in the public
repository. The image is therefore primary evidence for what was displayed, not a reproducible
benchmark result.

## Source Claim

The posts separate into four claim types:

1. **Observation:** software work often branches into bounded subproblems, while common coding-agent
   histories remain linear.
2. **Proposed explanation:** carrying completed tactical work in one growing context wastes Model
   Context and makes compaction more frequent and lossy.
3. **Advice:** organize agent contexts more like call-stack frames and visualize them like a flame
   graph.
4. **Speculation:** this organization would eliminate compaction in many cases and improve it in the
   remainder.

The posts provide no controlled comparison proving the final claim. The statement about quadratic
attention is a broad architectural explanation rather than evidence supplied by the posts.

## Implemented Prime Agent Mechanisms

### Separate recursive session contexts

`rlm(...)` admits a child `AgentSession` with an independent conversation, kernel, session directory,
and optional descendants. The default maximum depth is one; deeper recursion must be configured.
Each child otherwise inherits the parent model, provider configuration, skills, tools, retry policy,
and resource loader unless another configured model is requested.

Sources:

- [RLM programming model](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1b7d2ad773541e33aba1f578d9/packages/coding-agent/docs/rlm.md)
- [RLM runtime architecture](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1b7d2ad773541e33aba1f578d9/packages/coding-agent/docs/rlm-runtime.md)
- [Recursion tests](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1b7d2ad773541e33aba1f578d9/packages/coding-agent/test/agent-session-recursion.test.ts)

### Asynchronous messaging rather than stack return

The `rlm(...)` call returns immediately after admission with a child handle. It never waits for or
returns the child's answer. Results arrive later through explicit agent messages or files. Retained
daemon-backed children can receive follow-up messages after the initial task.

This is useful asynchronous orchestration, but it is not a conventional call-stack contract that
returns one validated value and deterministically pops a frame. A Pi Workbench Episode is closer to
that return shape, although managed Episodes remain an unimplemented Level 4 contract.

Source: [delegation flow and child execution](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1b7d2ad773541e33aba1f578d9/packages/coding-agent/docs/rlm-runtime.md#delegation-flow)

### Persistent child topology and recovery

The parent-scoped child registry survives compaction, kernel restart, and parent restoration.
Daemon-backed sessions can continue after the terminal client detaches. Session artifacts retain
child histories, kernel state, schedules, and harness state; completed children may be rehydrated.

Sources:

- [Parent-scoped registry](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1d2ad773541e33aba1f578d9/packages/coding-agent/docs/rlm-runtime.md#parent-scoped-sub-agent-registry)
- [Long-running and background agents](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1d2ad773541e33aba1f578d9/packages/coding-agent/docs/long-running-agents.md)

### Context-tree accounting and presentation

Prime Agent derives a context tree from live sessions and persisted `sub-*` directories. Each node
reports its own usage, attributed aggregate usage, current context utilization, status, model, and
children. Child-usage attribution is subtracted when calculating a parent's own usage so summing
nodes does not double-count descendants. Abandoned session branches are excluded from current-branch
usage.

This is a read-only accounting and presentation projection. It does not itself assemble model
context or own execution authority.

Sources:

- [`context-tree.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1d2ad773541e33aba1f578d9/packages/coding-agent/src/core/context-tree.ts)
- [Context-tree tests](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1d2ad773541e33aba1f578d9/packages/coding-agent/test/context-tree.test.ts)
- [`ChildUsageAttributionEntry`](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1d2ad773541e33aba1f578d9/packages/coding-agent/docs/session-format.md#childusageattributionentry)

### Per-session linear context and compaction remain

Entries in each session form a persistent tree for branching, but the model-facing context is one
root-to-leaf path. Prime Agent still uses default automatic compaction for growing sessions,
summarizing older messages while retaining recent messages. Tool output is truncated during summary
serialization, and repeated compaction uses the previous summary as input. Kernel variables survive
compaction, but semantic conversation history is still compressed lossily.

Prime Agent therefore reduces parent-context pressure by delegating tactical work, but does not
eliminate linear session histories or compaction.

Sources:

- [Session context building](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1d2ad773541e33aba1f578d9/packages/coding-agent/docs/session-format.md#context-building)
- [Compaction mechanism](https://github.com/PrimeIntellect-ai/prime-agent/blob/d1b072686d6b7b1d2ad773541e33aba1f578d9/packages/coding-agent/docs/compaction.md)

## Demonstrated Benefits and Limits

### Benefits

- Prime Agent operationalizes recursive, persistent, independently inspectable session contexts.
- Tool-heavy child work can remain outside the parent's Model Context until a child sends a bounded
  message or writes a referenced artifact.
- Programmatic spawning, later messaging, restoration, and context-tree accounting are implemented,
  not merely specified.
- The launch article reports competitive results on several long-context benchmarks and lower main-
  model context use in tasks where submodels process verbose data.

Source: [Prime Agent evaluation](https://www.primeintellect.ai/blog/prime-agent#evaluating-prime-agent)

### Limits

- The published evaluation compares complete harness/model combinations, not recursive depth against
  depth-one breadth, and not Prime Agent against Pi Workbench.
- Prime Agent's own RLM experiments report regressions on some tasks, greater elapsed time, and
  sensitivity to task-specific orchestration hints.
- The supplied depth-nine flame graph ends in `FAIL`; it proves that a deep topology was created and
  measured, not that depth improved the outcome.
- A public `0.7.1` report describes four active RLM children generating 553 usage-attribution entries
  in twenty minutes, saturating one worker at 97–99% CPU and 3.1 GB RSS until it was killed. Recovery
  preserved the sessions, which is positive evidence for durability, but the incident demonstrates
  the operational amplification risk of child bookkeeping. This is one user report, not a controlled
  general benchmark.

Sources:

- [Recursive Language Models experiments](https://www.primeintellect.ai/blog/rlm)
- [Prime Agent issue 1054](https://github.com/PrimeIntellect-ai/prime-agent/issues/1054)

## Pi Workbench Comparison

### Implemented reality

Pi Workbench Level 1 already implements the narrow context-offloading mechanism without recursive
children:

- a fresh Subagent receives a self-contained assignment and fresh Model Context;
- detailed child activity stays out of parent Model Context;
- the lead receives a compact terminal result and must reconcile it;
- a durable attended Worker preserves one semantic scope across bounded dispatches; and
- `compact_and_continue` performs a deliberate same-session, phase-boundary compaction.

Focused verification run during this review passed 37 tests: 2 subagent-extension tests, 14 Pi
execution-adapter tests, 15 worker-registry tests, and 6 context-checkpoint coordinator tests:

```sh
npm run test:subagent-extension
npm run test:pi-execution-adapter
npm run test:worker-registry
node --test extensions/context-checkpoint/coordinator.test.mjs
```

These checks demonstrate current mechanics and failure handling, not comparative outcome quality.

Relevant implementation and contracts:

- `extensions/subagent/`
- `packages/pi-execution-adapter/`
- `packages/worker-registry/`
- `extensions/context-checkpoint/`
- `docs/plans/level-1-subagents.md`
- `docs/plans/level-1-durable-workers.md`

Prime Agent remains operationally ahead in durable background execution, recursive child recovery,
mid-flight child messaging, and context-tree cost projection. Workbench Level 1 intentionally lacks
those capabilities and must not claim their guarantees.

### Intended but unimplemented boundary

The Workbench Level 4 design uses a Semantic Execution Graph for meaningful work and dependencies,
controller-mediated Dispatches for bounded execution, and Episodes for compact provenance-bearing
returns. This is better suited than a tree to software work that branches, joins, revises, and
invalidates earlier conclusions. The deterministic Run Controller would retain authority while
context topology remained disposable execution structure.

That design is an evolving specification, not implemented evidence. Prime Agent's simpler system is
superior wherever its implemented durability and orchestration are required today.

Relevant specifications:

- `docs/contracts/execution.md`
- `docs/contracts/controller.md`
- `docs/foundation/system-overview.md`

## Decisions for Pi Workbench

### Adopt: reconciled context and usage projection

Add normalized per-execution usage to `packages/pi-execution-adapter/`, preserve bounded Worker usage
receipts in `packages/worker-registry/`, and expose an own-versus-aggregate delegation projection
through `extensions/subagent/` and eventually PI WEB.

Validation should prove:

1. summing each execution's own usage equals the displayed aggregate without double-counting;
2. retries, cancellation, restoration, and unknown outcomes remain distinguishable;
3. frequent observations are coalesced or bounded and cannot starve control operations; and
4. detailed child traces do not enter parent Model Context.

Keep unchanged: Level 1's attended lifetime, explicit reconciliation, Pi-only runtime, lack of
managed authority, and absence of recursive child execution.

### Experiment: depth-one scoped context offloading

Compare matched tasks performed inline and through existing depth-one Subagent or Worker dispatches.
Measure parent input growth, total input growth, compaction count, evidence quality, re-briefing,
human reconciliation effort, and task outcome. Use an approved source-backed session-evaluation
protocol so repeated observations remain comparable.

Falsify the hypothesis when delegation increases total context or weakens outcome quality without a
material reduction in parent context pressure or Human Attention.

Keep unchanged: self-contained assignments, fresh Independence where required, lead reconciliation,
no peer messaging, and no nested delegation.

### Reject: tree authority and unrestricted recursion

Do not replace the Semantic Execution Graph with a call tree, create a second authoritative context
ledger, add Prime Agent as another model-worker harness, or infer that deeper recursion is desirable
from the failed depth-nine run. A flame graph is a useful derived execution projection, not a Run
model.

Mid-flight child and peer messaging remains an independent empirical question. Prime Agent proves
that it is feasible, but does not establish that its coordination traffic improves Workbench
outcomes or fits current authority boundaries.

## Recommended Next Action

Instrument bounded, reconciled execution usage and then run the depth-one comparison. This tests the
source's useful claim—scoped delegation can reduce parent context pressure—without first importing
deep recursion, peer communication, another harness, or a second authoritative topology.

## Confidence

- Confidence is high that Prime Agent implements the session, delegation, persistence, compaction,
  and accounting mechanics described above because official documentation, source, and tests agree.
- Confidence is low that deep recursion improves coding outcomes: the supplied run failed, its data
  is unavailable, and no controlled depth comparison was found.
- Confidence is medium that depth-one offloading will reduce parent Model Context in Workbench; the
  mechanism is implemented, but outcome and total-cost effects still require matched session
  evidence.
