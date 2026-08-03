# Pi Subagent Implementation Evidence

## Verdict

Pi Workbench should build one Workbench-owned Pi execution adapter and reuse only narrow execution mechanisms from existing implementations.

The strongest combination is:

- Pi's official subagent example for the supported process-launch, JSON streaming, cancellation, and terminal rendering baseline;
- [`pi-subagents`](https://github.com/nicobailon/pi-subagents/tree/abf07371d4470110ad21f701d896145e280a6faa) for resolved launch contracts, capability ceilings, preflight, structured results, budgets, and typed terminal outcomes;
- [`pi-headless-subagent` 1.2.0](https://www.npmjs.com/package/pi-headless-subagent/v/1.2.0) for the RPC subprocess lifecycle;
- [`pi-spawn`](https://github.com/agenticoding/pi-spawn/tree/08d02be193788bf11ae29716b54ddaad06c283aa) for a one-assignment execution interface; and
- [`davis7dotsh/my-pi-setup`](https://github.com/davis7dotsh/my-pi-setup/tree/4a37b7830bda00d4a7e861218f70e70097ddf2e8) for backend/session separation, normalized observations, snapshot reduction, cleanup, and result delivery.

No reviewed implementation should own Workbench orchestration, Run authority, workspace selection, durable managed state, Acceptance, or model fallback. Davis's implementation has no repository or package license in the inspected revision, so it is an architectural reference only: do not copy its code.

## Scope and method

The review compared published packages, repository implementations, design notes, and focused tests available on 2026-08-03. It evaluated fit against the Pi Execution and Level 1 boundaries rather than ranking products by feature count.

The inspected baseline was the official `subagent` example distributed with `@earendil-works/pi-coding-agent` 0.83.0. The broader sample included:

| Implementation | Inspected version or revision | Primary value |
| --- | --- | --- |
| Pi official subagent example | `@earendil-works/pi-coding-agent` 0.83.0 | Supported Pi subprocess and streaming baseline |
| `pi-subagents` | repository 0.40.0 at `abf07371` and npm snapshot 0.30.0 | Launch contract, preflight, capabilities, structured output |
| `@fosterg4/pi-subagent` | npm 1.0.7; repository `3689e78d` | Small package validation and agent discovery |
| `pi-headless-subagent` | npm 1.2.0 | RPC subprocess lifecycle |
| `pi-spawn` | repository `08d02be1` | Minimal one-assignment interface |
| `pi-faithless-subagents` | npm 0.1.9 | Explicitly skeptical review/delegation behavior |
| `pi-ultra-subagents` | repository `be9c55d1` | Rich orchestration and background execution reference |
| `@catdaemon/pi-subagents` | npm 0.1.3; repository `1a6c78b9` | Small extension and smoke-test reference |
| `@guygrigsby/pi-subagent-routing` | npm 0.1.1; repository `789c80ee` | Routing tests and prompt-driven routing reference |
| `@wkronmiller/pi-subagent-extension` | npm 0.1.0 | Minimal extension implementation |
| Davis subagents | repository `4a37b783` | Unified lifecycle and observation model |

The review did not treat package downloads as evidence of architectural fit. It inspected the mechanisms that would cross a Workbench seam and whether adopting the whole product would create another authority system. Implementations not discussed individually below added no stronger mechanism for the selected seam and were screened out as complete products.

## Findings

### The official Pi example is the compatibility baseline, not the architecture

The [official example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent) launches isolated Pi child processes, applies per-agent prompts, models, and tools, consumes JSON events, supports cancellation, and renders streaming progress. It also places single, parallel, and chain orchestration inside one extension tool and uses static profile model fields.

Workbench should preserve its supported Pi launch and rendering behavior while removing the architectural coupling. Parallelism is multiple execution requests, and chain semantics belong to the attended lead or future Semantic Execution Graph. Provider-qualified model and Model Effort must come from fresh Cognitive Role resolution rather than profile frontmatter.

### `pi-subagents` has the strongest launch boundary

The inspected 0.40.0 repository separates delegation input from a versioned launch contract, computes a launch-contract digest, intersects capability ceilings, performs preflight, supports structured output, and represents terminal outcomes explicitly. Its source includes focused modules for delegation, preflight, capability ceilings, Pi arguments, background work, and structured output.

These mechanisms address the most important correctness question: what exactly was authorized and launched? Workbench should adapt them behind its own resolved execution specification and tests.

The complete package remains a poor ownership fit. Its workflow, worktree, delegation, acceptance, and background concepts overlap Workbench modules. The inspected revision `abf07371` declares the MIT license; adapt any copied mechanisms with attribution and do not install the package as an authoritative orchestration layer.

### Davis has the strongest normalized lifecycle model

At revision `4a37b783`, Davis's subagent manager supports Pi SDK sessions, Claude Agent SDK sessions, and Codex app-server threads behind one backend/session abstraction. Each backend emits a shared event model for lifecycle, assistant activity, tool activity, usage, metadata, and diagnostics. A manager folds those events into immutable snapshots, while a separate read model drives terminal UI.

The implementation also demonstrates scoped cleanup, bounded termination, synchronous concurrency reservation, deferred result delivery, context-occupancy accounting, interruption, steering, session takeover, and partial transcript preservation. After installing its root and extension dependencies, its focused subagent suite passed 20 of 20 tests and its TypeScript check passed.

Workbench should adapt the event and lifecycle shape, not the backend set. Decision 25 requires Pi to remain the only model-worker harness; Claude and Codex are models selected inside Pi, not separate coding-agent runtimes. The Claude backend's permission bypass and the extension-owned background lifecycle are specifically unsuitable. Because the inspected repository declares no license, use its public design as evidence and reimplement the mechanism independently.

### RPC is the best first common runner

`pi-headless-subagent` demonstrates the practical RPC child lifecycle, while current Pi RPC documentation provides provider-qualified model selection, thinking-level selection, persistent session directories, abort, and session switching. A subprocess gives Level 1 explicit cancellation and gives future managed execution a process identity that can be confined and reconciled.

The Pi SDK remains a valid future optimization. Its lower startup cost does not justify a second runner in the first implementation. Add it only if measured attended-use latency demonstrates a material problem.

### A single assignment is the correct deep interface

`pi-spawn` is valuable because it keeps one invocation close to one bounded child assignment. Richer packages add parallel batches, chains, teams, routing, retries, worktrees, dashboards, and background jobs to the same surface. Those features can be useful products, but combining them creates a shallow module with overlapping ownership.

Pi Execution should expose `dispatch`, `observe`, and `cancel`. Interactive Level 1 uses one tool invocation for one child execution. Higher-level sequencing, parallel review, retry, and synthesis remain outside the adapter.

## Adopt, adapt, defer, reject

### Adopt now

- Pi RPC subprocesses as the first runner.
- One bounded assignment per core dispatch and per Level 1 tool invocation.
- Provider-qualified model and explicit Model Effort from the existing Cognitive Role resolver.
- Persistent Pi child sessions for inspection after failure, without automatic recovery.
- Streaming progress and attended cancellation.

### Adapt now

- Resolved launch specification and digest from `pi-subagents`.
- Preflight and truthful capability declarations.
- Normalized lifecycle, tool, usage, diagnostic, and terminal observations from Davis's design.
- Scoped cleanup, confirmed cancellation, and `outcome_unknown` when termination cannot be reconciled.
- A compact model-facing result separated from detailed UI observations.

### Defer until evidence requires it

- Pi SDK runner optimization.
- Parent transcript forking; Level 1 starts with fresh self-contained assignments.
- Structured-output schemas and automatic correction turns.
- Explicit token and cost enforcement beyond Pi/provider limits.
- Durable Worker continuity and managed process recovery.
- Filesystem, process, and network sandboxing. Until then, Level 1 children share the attended parent's local trust boundary and make no confinement claim.

### Reject

- Provider-specific worker harnesses such as Claude Agent SDK or Codex app-server.
- Silent model fallback or profile-authored model bindings.
- Extension-owned workflows, chains, retry ladders, worktrees, Acceptance, or durable Run ledgers.
- Background model work after an attended Level 1 parent ends.
- Prompt-only claims of enforced read-only filesystem or network access.
- Raw model thinking as a stable execution observation.

## Workbench implication

Create `packages/pi-execution-adapter/` as the reusable low-level module. It accepts an already resolved execution specification, launches and observes Pi, and returns an execution result candidate. It does not select workflow, create workspaces, accept results, or persist authoritative Run state.

Keep `extensions/subagent/` thin. It accepts one task, one bundled child profile, and one Cognitive Role; resolves the live binding; invokes the adapter; streams bounded progress; and returns a compact result. The Level 1 implementation is attended and unmanaged. A future Level 4 caller may reuse the execution mechanics only through controller validation and controller-owned persistence.
