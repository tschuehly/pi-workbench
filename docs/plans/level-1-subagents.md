# Level 1 Child Pi Execution Plan

Status: implemented V1; real and deterministic evidence is maintained in `packages/pi-execution-adapter/`.

## Outcome

Add one small, attended `subagent` tool to Level 1. One invocation launches one fresh child Pi process for one bounded assignment, streams its progress, permits cancellation, and returns a compact result to the interactive lead. It may also launch in the background and return a handle immediately, so the lead can run several children within the attended session and reconcile each later. Backgrounding is in-session only; a child still terminates when the attended session ends and gains no durable identity or recovery.

The implementation separates reusable Pi process mechanics from the interactive tool:

```text
extensions/subagent/
    thin Pi tool and progress presentation
            ↓
packages/pi-execution-adapter/
    resolved launch, observe, cancel, and process cleanup
            ↓
Pi RPC subprocess
```

This is unmanaged Level 1 execution. The method may be named `dispatch`, but its input is a `ResolvedExecutionSpec`, not a controller-authorized Dispatch, and its result is not an Episode. A child session receives no Run authority, durable Logical Actor identity, workspace lease, Acceptance authority, or managed recovery guarantee.

## Level 1 behavior

Each parent tool invocation launches one child with these semantic inputs:

```ts
{
  task: string;
  profile: "scout" | "planner" | "reviewer" | "implementer";
  cognitiveRole: CognitiveRole;
  independentOfProvider?: string;
  independentOfModel?: string;
  excludeFamilies?: string[];
  background?: boolean;
}
```

- `task` is a self-contained assignment that names relevant repository paths, constraints, and expected output.

Approved candidate amendment, not yet implemented: cap `task` at 20,000 characters and reject larger input before routing or child launch. The subagent-details implementation must land the schema/preflight check, tests, this plan's current-behavior wording, and extension README together.
- `profile` selects Workbench-owned child behavior and requested Pi tools. These lowercase Level 1 child profiles are neither managed Execution Profiles nor authority shapes; in particular, `scout` does not grant managed Scout authority. `implementer` avoids overloading the canonical Worker term.
- `cognitiveRole` selects the required kind of thinking. It never names a provider or model.
- `independentOfProvider` identifies a single-family author provider. Gateway providers require an exact author model.
- `independentOfModel` quotes the exact provider/model from the author's completion receipt. Default routing classifies its underlying family; a single-provider overlay uses the exact model for distinct-model Independence. Without an explicit author, the tool uses the active parent model.
- `excludeFamilies` excludes already-selected reviewer families when the lead assembles a distinct-family panel. It is valid only for independent roles outside a distinct-model overlay.

The extension supplies the validated current working directory and host capability ceiling. For an ephemeral Subagent, the parent may identify the author and exclude reviewer families as Independence constraints but cannot choose the target provider, model, Model Effort, executable, environment, session directory, arbitrary tools, or sandbox policy. A durable attended Worker has the narrow owner-requested per-dispatch model override defined in the [Worker plan](level-1-durable-workers.md); it does not change this Subagent interface.

One invocation maps to one execution request. Decision 99 makes `background: true` the system-prompt preference for most delegated work; foreground blocking is only for a result that is the lead's immediate next input when nothing useful can happen first. After a background launch, the lead finishes any genuinely independent work and ends the turn. The completion signal starts the next turn; the lead never calls collect to wait. In interactive Pi, `⌘B` (or `Ctrl+Alt+B`) moves the newest foreground Subagent or Worker into that same background lifecycle without cancelling it; `⌘B` requires a terminal that forwards the Command/Super modifier. When `background` is true the tool returns a handle immediately. The lead reconciles it within the same session through `subagent_collect`, `subagent_status`, and `subagent_cancel`. Terminal background outcomes coalesce into one session-local generic `steer` signal with `triggerTurn: true`, which reaches a busy lead at the next safe model boundary. The signal names no execution and retains every result behind `subagent_collect`: it asks the lead to collect and reconcile each terminal-uncollected child exactly once, and `subagent_collect` without an `executionId` reconciles that whole set in one bounded aggregate. With one `executionId`, collect returns an immediate bounded snapshot if the child is running without marking it collected, or the compact result if it is terminal. Sleeping, polling, and collect-to-wait are unsupported. Completions that arrive while a signal is outstanding send nothing; delivery of that exact message or a settled agent re-arms attention so a later completion can signal again. A terminal collection suppresses a not-yet-sent wakeup, re-arms it if collection detaches before delivering the result, and permanently handles it after reconciliation. Worker completion wakeup occurs only after its durable receipt settles and dispatch lock releases. A background receipt failure produces separately deduplicated bounded `outcome_unknown` attention without claiming release; a foreground failure returns an `outcome_unknown` tool result with the child result marked inspection-only. Explicit cancellation and session shutdown suppress late wakeups while cancelling live children. This in-session non-blocking launch lets a lead keep several children in flight, but the extension still performs no batches, chains, retries, review loops, or result synthesis, and no child outlives the attended session. The attended lead remains accountable for deciding what to delegate and for reconciling each result; the synthetic completion turn grants no additional authority.

## Profiles and routing

V1 loads only the four bundled child profiles. Project and user profile discovery is disabled until a trust and validation model exists. Profiles and Cognitive Roles are validated independently: a profile selects child behavior and requested tools, while a Cognitive Role selects the required kind of thinking and its runtime binding. Any known Cognitive Role may be paired with any bundled profile; an unknown profile or unknown Cognitive Role fails preflight.

The extension invokes the package-relative `skills/model-orchestration/scripts/resolve-runtime-binding.mjs` for every child launch and validates its JSON response. Independent roles pass the author identity and optional reviewer-family exclusions so the resolver selects a policy candidate outside those underlying families, or a different allowed model under a single-provider overlay. Missing, unknown, contradictory, or unsatisfiable independence fails preflight. The resolved binding contains a Cognitive Role, provider-qualified model, Model Effort, optional Independence metadata, quota admission, and quota telemetry. Quota telemetry is shared through a ten-minute machine-local cache, so repeated and concurrent child launches do not repeatedly query provider endpoints. Fresh confirmed exhaustion, an unknown role, and an unavailable catalog model stop before Pi Execution. Stale, unavailable, or unreadable quota telemetry is admitted explicitly as `degraded-quota-telemetry`; it is visible in observations and does not prevent a verified launch.

The execution adapter accepts only the resulting `ResolvedExecutionSpec`. It rejects malformed or internally inconsistent bindings and fresh confirmed exhaustion, while a fresh binding that ages before dispatch becomes visible degraded telemetry rather than a blocker. It fails closed when launch-time model availability or runtime binding verification fails. Quota-collector authentication is telemetry health, not proof that Pi's provider authentication is unusable; the Pi launch is authoritative. The adapter never selects a fallback. A parent may request a new resolution and start another execution after a typed failure. After Pi starts, the adapter verifies that the reported provider, model, and effort match the resolved binding before prompting the child.

Static `model` fields are removed from bundled profiles. A Worker override is explicit per dispatch and never becomes profile or Worker identity.

## Context and sessions

Every child starts with fresh Model Context. The extension does not fork or copy the parent transcript. The lead must create a self-contained task and identify relevant files explicitly. This preserves narrow context, reproducibility, and Independence without preventing the child from inspecting the repository through its allowed tools.

Each child uses Pi's standard machine-local persistent session storage. The adapter captures the Pi session identifier in result metadata so a failed execution can be inspected. It does not copy session state into the repository, create a second ledger, reopen a failed session automatically, or claim that the child is recoverable.

Persisting a child session is evidence and the continuity primitive reused by the [Level 1 durable worker plan](level-1-durable-workers.md). Each attended worker action is still a bounded execution request carrying a validated identity and continuation reference; an idle subprocess never defines Worker identity, and managed Worker authority remains deferred.

## Capabilities and mutation

Level 1 children share the attended parent's local machine trust boundary. The adapter applies explicit Pi tool allowlists, but V1 has no filesystem, process, or network sandbox and makes no confinement claim.

Analysis-oriented profiles request analysis tools and are instructed not to mutate. Because unrestricted shell access can write, that non-mutation behavior is not presented as a security guarantee. The `implementer` profile additionally requests Pi editing and writing tools. The effective tool set is the intersection of profile requests and the host ceiling; it can narrow but never expand at runtime.

A later sandbox adapter must fail preflight whenever a requested filesystem, process, or network restriction cannot be enforced. V1 does not add that policy prematurely or represent prompt instructions as authority enforcement.

The child runs in the current Level 1 working directory. The adapter does not create a worktree, lease a workspace, commit, land, publish, or accept changes. Those responsibilities remain outside the adapter.

## Lifecycle interface

`packages/pi-execution-adapter/` exposes one low-level interface:

```ts
interface PiExecutionAdapter {
  dispatch(spec: ResolvedExecutionSpec): Promise<ExecutionReceipt>;
  observe(executionId: string): AsyncIterable<ExecutionObservation>;
  result(executionId: string): Promise<ExecutionResult>;
  status(executionId: string): ExecutionStatus;
  list(): ExecutionSummary[];
  cancel(executionId: string, reason: string): Promise<CancellationReceipt>;
  cancelAll(reason: string): Promise<CancellationReceipt[]>;
}
```

`status` and `list` are non-blocking reads of live process state that let the attended tool present backgrounded children without awaiting their terminal result. They expose only bounded live state and confer no durable authority.

The first runner is a Pi RPC subprocess. Do not introduce a generic runner framework or Pi SDK implementation until measured startup latency or another real requirement justifies a second runner.

The module keeps only bounded live process state: execution identifier, process identifier, RPC connection, Pi session identifier, latest usage, cancellation state, and latest observation. The parent Pi session retains the compact tool result and visible progress. The module owns no durable authoritative state.

Level 1 imposes no local child concurrency cap and provides no scheduler. Each invocation still represents one bounded child execution; future managed admission and scheduling remain controller-owned.

Each execution has a startup timeout. Pi RPC must answer the initial state handshake within 15 seconds; a stall terminates before prompting as `launch_failed` with explicit startup evidence. After launch, a task runs until the child finishes, the lead cancels it, or the attended session shuts down.

## Observations, results, and cancellation

The adapter normalizes Pi RPC activity into bounded observations for:

- launch and binding verification;
- assistant progress without raw thinking content;
- tool start, progress, and completion;
- usage;
- diagnostics and RPC startup timeout;
- cancellation; and
- terminal outcome.

Detailed observations drive the rolling tool UI and, in interactive Pi, one width-aware, single-line pill on the shared **Active** surface above the editor for every active Subagent or Worker dispatch. Pills pack horizontally and wrap as units; each leads with mechanically normalized current activity, protects model and Model Effort metadata, adds compact identity and Cognitive Role when width permits, and omits the launch objective. Terminal executions are removed. These presentation updates do not enter parent Model Context. The parent receives only terminal status, final text, child profile, Cognitive Role, resolved provider/model/effort, independence receipt, effective quota admission and telemetry status, and Pi session identifier. V1 does not expose arbitrary JSON Schema or automatic correction turns. Usage is observed, but custom token and cost enforcement remains deferred.

The stable Level 1 outcome categories are:

- `preflight_failed`
- `launch_failed`
- `execution_failed`
- `cancelled`
- `outcome_unknown`
- success

Detailed provider, quota, authentication, process, and tool errors remain diagnostic causes rather than an unbounded public taxonomy.

Cancellation is successful only after termination is confirmed. The adapter first sends Pi RPC `abort`, then escalates through bounded process termination. If process state cannot be reconciled, it reports `outcome_unknown`; sending a signal alone is not success. No child remains running after its attended parent tool or session ends.

## Acceptance evidence

Replace the temporary official-example implementation only after tests prove:

1. one tool invocation creates exactly one Pi RPC child execution;
2. only bundled profiles and known Cognitive Roles pass preflight, with profile and role validated independently;
3. every launch uses a fresh provider-qualified binding and explicit Model Effort;
4. stale, unavailable, and unreadable quota telemetry launches with visible degraded admission, while fresh confirmed exhaustion, unavailable models, and unknown profiles or Cognitive Roles fail closed without fallback;
5. the runtime-reported binding must match the resolved binding;
6. the effective Pi tool set cannot exceed the profile request and host ceiling;
7. progress streams through normalized observations without raw thinking content entering the public contract;
8. terminal parent context is compact and includes the Pi session identifier;
9. child sessions persist in Pi's standard machine-local store but are never reopened automatically;
10. pre-prompt startup timeout, cancellation, forced termination, and unknown outcomes are distinguishable;
11. concurrent invocations launch independently and remain cancellable;
12. a background launch returns a handle immediately; collect-by-ID on a running child returns a bounded snapshot without waiting or marking it collected; terminal outcomes coalesce into one bounded signal that triggers status and collection without duplicate or post-collection notifications; and `status`, `list`, and `collect` reconcile the child within the session without ever letting it outlive the attended parent;
13. parent termination cleans up every active child; and
14. existing Level 1 Workstream launch, checkpoint, restart, resume, and closure behavior remains intact.

Use a fake RPC process for deterministic lifecycle and failure tests. Keep one real Pi RPC smoke test for launch, binding, session persistence, streaming, and cancellation.

## Deferred expansion

Do not implement these features as part of this plan:

- managed Worker continuity or Logical Actor recovery beyond the attended durable workers in the [Level 1 durable worker plan](level-1-durable-workers.md);
- durable or unattended background execution that survives the attended parent lifetime (in-session non-blocking launch is supported; a child still dies with the session, and a durable worker persists only identity and a session reference);
- parent-transcript forks;
- project or user-authored child profiles;
- structured result schemas and correction turns;
- token, cost, or Run budget enforcement;
- filesystem, process, or network sandboxing;
- Pi SDK runner optimization;
- parallel batches, chains, retries, or workflow orchestration;
- controller persistence, Dispatches, Episodes, workspace leases, Acceptance, or Publication.

A future expansion may reuse the adapter's Pi launch, observation, and cancellation mechanics. Level 4 must still provide controller-validated specifications, controller-owned durable observations and reconciliation, Repository Workspace leases, Artifact Store references, and Episode validation. Reuse of mechanism does not grant managed authority.

## Evidence basis

The mechanism choices and rejected ownership are supported by [Pi Subagent Implementation Evidence](../research/sources/subagent-implementations.md), the broader [Pi Package Catalog Evaluation](../research/sources/pi-package-evaluation.md), and the authoritative [Pi Execution Specification](../contracts/execution.md).
