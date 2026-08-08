# Level 1 Durable Worker Plan

Status: implemented V1; deterministic evidence is maintained in `packages/worker-registry/` and
`packages/pi-execution-adapter/`, with real resume evidence in
`packages/worker-registry/real-smoke-evidence.md`. Extends the implemented
[Level 1 child Pi execution plan](level-1-subagents.md) with durable attended workers; it does not
change the managed Level 4 contracts in [`docs/contracts/execution.md`](../contracts/execution.md).

## Outcome

Add durable, attended workers alongside the existing ephemeral `subagent` tool. A worker is a
durable machine-local identity bound to one semantic scope and one persisted Pi session lineage.
Creating a worker writes a record and starts no process. Each worker action is one bounded,
attended dispatch that resumes the worker's persisted Pi session, streams progress, permits
cancellation, and returns a compact result — the same lifecycle as an ephemeral child, plus
continuity within the worker's scope.

Worker identity survives the attended session; execution never does. No child process outlives its
attended parent, and no unattended activity occurs between dispatches. An idle worker is a record
plus a persisted Pi session file, never a waiting subprocess.

This realizes the canonical Worker meaning — "a Pi actor that retains useful continuity across
bounded actions within one semantic scope" — in the Level 1 posture. It is not a managed Level 4
Worker: a Level 1 worker receives no Run authority, controller Dispatches, Episodes, workspace
lease, Acceptance authority, or managed recovery guarantee.

```text
extensions/subagent/
    worker tools + existing subagent tools
            ↓
packages/worker-registry/            (new: durable identity, scope, session lineage, dispatch lock)
            ↓
packages/pi-execution-adapter/       (extended: session continuation in ResolvedExecutionSpec)
            ↓
Pi RPC subprocess resuming a persisted session
```

## Worker identity

`packages/worker-registry/` owns durable worker records in a user-local directory
(default `~/.pi-workbench/workers`, following the Workstream Store pattern). A record contains:

- worker identifier and human-readable name;
- one semantic scope statement (for example "PhotoQuest importer redesign");
- bound repository root;
- bundled child profile;
- session lineage: the ordered Pi session identifiers used by its dispatches;
- per-dispatch receipts: outcome category, resolved binding, timestamps;
- dispatch lock state; and
- retirement state with reason.

The registry is mechanics, not authority. It is never committed to the repository, never becomes
authoritative Run state, and never stores a second narrative ledger: continuity lives in the Pi
session file itself, and the registry stores only references and bounded receipts. Registry writes
are atomic; corrupt or unreadable records fail dispatch preflight closed instead of silently
recreating identity.

## Tool surface

The subagent extension gains four worker tools beside the existing `subagent` family:

```ts
worker_create   { name: string; scope: string; profile: Profile }        // record only, no process
worker_dispatch { workerId: string; task: string;
                  cognitiveRole: CognitiveRole; background?: boolean }   // one bounded execution
worker_status   { workerId?: string }                                    // registry + live state
worker_retire   { workerId: string; reason: string }                     // immutable retirement
```

`worker_dispatch` behaves exactly like `subagent`: blocking by default with streamed progress, or
`background: true` returning a handle reconciled through the existing `subagent_status`,
`subagent_collect`, and `subagent_cancel` tools. The extension performs no batches, chains,
retries, or synthesis; the attended lead remains accountable for what it delegates to a worker and
for reconciling every result.

Ephemeral subagents remain the default delegation form. A worker is justified only when repeated
bounded actions in one semantic scope benefit from preserved context; the tool descriptions state
this so leads do not accumulate workers by habit.

## Cognitive Roles and routing

The three Independence roles — `independent-judgment`, `challenge`, and `independent-review` —
fail worker preflight. Independence requires fresh context; those roles remain subagent-only.
Every other known Cognitive Role may be dispatched to a worker.

Every worker dispatch resolves a fresh binding through the same
`skills/model-orchestration/scripts/resolve-runtime-binding.mjs` path used by subagents, with
identical quota admission and degraded-telemetry semantics. Continuity of context never pins a
model: the adapter sets the resolved provider, model, and Model Effort explicitly on the resumed
session and verifies the runtime-reported binding before prompting, exactly as for fresh children.
A worker's model may therefore differ across dispatches.

## Continuation mechanics

`ResolvedExecutionSpec` gains an optional continuation field:

```ts
continuation?: { sessionId: string }
```

When present, the adapter launches the Pi RPC subprocess against the recorded persisted session
(`--session <id>`) instead of a fresh one, keeping the existing tool allowlist, binding flags, and
verification. Preflight fails closed when the session file is missing, unreadable, or does not
match the worker's recorded lineage and repository root. The adapter still keeps only bounded live
process state and gains no durable ownership; lineage recording remains the registry's job.

Tasks stay self-contained. Continuity supplements explicit tasking; a dispatch must still name its
objective, relevant paths, constraints, and expected output rather than assuming the worker
remembers everything relevant.

Context growth is bounded pragmatically in V1: `worker_status` surfaces the latest observed usage
(a context-size proxy) so the lead can judge staleness, Pi's own compaction applies inside the child
session, and the supported remedy for a degraded worker is retirement plus a fresh worker or
subagent. Continuation Artifacts, Context Curator rotation, and automatic staleness thresholds
remain deferred (deferred design decision 14).

## Concurrency and locking

One dispatch at a time per worker. `worker_dispatch` acquires the worker's dispatch lock (owner
process identifier, acquisition time, heartbeat) before preflight and releases it on every terminal
outcome, including cancellation, timeout, and forced termination. A concurrent dispatch to a locked
worker fails preflight with a typed busy diagnostic instead of queueing. Distinct workers dispatch
concurrently exactly like independent subagents.

A dead lock owner is reclaimed only after liveness verification, following the findings of the
[workstream store lock recovery experiment](workstream-store-lock-recovery-experiment.md). An
unverifiable owner leaves the worker visibly locked and requires explicit human action rather than
silent takeover.

## Capabilities and mutation

Unchanged from Level 1 subagents: workers share the attended parent's local machine trust boundary,
the effective tool set is the intersection of profile request and host ceiling, and V1 makes no
sandbox or confinement claim. The worker runs in its bound repository root; dispatching from a
different working directory fails preflight. The adapter still creates no worktree, lease, commit,
landing, or acceptance.

## Failure semantics

The stable outcome categories from the subagent plan are reused unchanged. Worker-specific
failures — busy lock, invalid or foreign continuation session, corrupt registry record, retired
worker — are diagnostic causes under `preflight_failed`, not new public categories. A cancelled or
failed dispatch leaves the worker resumable with its terminal outcome recorded; `outcome_unknown`
additionally marks the worker as requiring inspection before the next dispatch.

## Sequence

1. **Adapter continuation.** Add and test `continuation` support in
   `packages/pi-execution-adapter/` with fake-RPC lifecycle tests and one real resume smoke test.
2. **Worker registry.** Build `packages/worker-registry/` with atomic user-local persistence,
   lineage and receipt recording, dispatch locking, and dead-owner recovery.
3. **Extension tools.** Add the four worker tools to `extensions/subagent/`, wire routing,
   Independence rejection, and reconciliation through the existing companion tools.
4. **Documentation repair.** Update [`level-1-subagents.md`](level-1-subagents.md) (narrow its
   "durable Worker continuity" deferral to unattended execution), the V1 paragraph of
   [`contracts/execution.md`](../contracts/execution.md), the extension and package READMEs,
   `docs/README.md`, the `AGENTS.md` router, and record the settled decision in
   [`foundation/decisions.md`](../foundation/decisions.md).

## Acceptance evidence

Accept the implementation only after tests prove:

1. `worker_create` writes exactly one durable record and starts no process;
2. one `worker_dispatch` creates exactly one child execution resuming the recorded session;
3. continuity is real: a fact introduced in dispatch N is observable in dispatch N+1 without
   restatement, across a simulated parent-session restart;
4. worker identity survives parent termination while no child process does;
5. Independence roles fail worker preflight and remain accepted for subagents;
6. every dispatch uses a fresh verified binding, including a changed model on a resumed session;
7. a concurrent dispatch to a busy worker fails with a typed diagnostic; distinct workers run
   concurrently and remain independently cancellable;
8. the dispatch lock releases on success, failure, cancellation, timeout, and forced termination,
   and dead-owner reclaim requires verified liveness failure;
9. a missing, foreign, or corrupt continuation session fails preflight closed;
10. retirement is immutable and blocks further dispatch;
11. registry data stays outside the repository and results claim no managed authority; and
12. the existing subagent acceptance evidence (items 1–14 of the Level 1 child plan) remains green.

Use the fake RPC process for deterministic lifecycle, lock, and failure tests. Keep one real Pi RPC
smoke test covering create → dispatch → parent restart → continuity dispatch → retire.

## Deferred expansion

Do not implement as part of this plan:

- unattended or background execution that survives the attended parent session;
- managed Level 4 Workers, controller Dispatches, Episodes, workspace leases, Acceptance, or
  Publication;
- Continuation Artifacts, Context Curator rotation, or automatic context-staleness policy;
- cross-machine, shared, or repository-committed worker registries;
- peer worker communication, mailboxes, or worker-to-worker delegation;
- project or user-authored worker profiles;
- token, cost, or budget enforcement; and
- filesystem, process, or network sandboxing.

A future managed expansion may reuse the registry's identity and lineage mechanics and the
adapter's continuation mechanics, but Level 4 Worker identity, Dispatch validation, and recovery
remain controller-owned. Reuse of mechanism does not grant managed authority.

## Evidence basis

- [`foundation/vocabulary.md`](../foundation/vocabulary.md) — canonical Worker, Subagent, and
  Logical Actor meanings.
- [`contracts/execution.md`](../contracts/execution.md) and decision 78 in
  [`foundation/decisions.md`](../foundation/decisions.md) — resumable Worker continuity beside
  ephemeral delegation, with each action a bounded execution request.
- [`plans/level-1-subagents.md`](level-1-subagents.md) — the deferral this plan lifts and the
  adapter mechanics it reuses.
- [Pi Subagent Implementation Evidence](../research/sources/subagent-implementations.md) — prior
  art for child execution mechanics.
- Pi session persistence and `--session <path|id>` resume support in the Pi CLI documentation.
