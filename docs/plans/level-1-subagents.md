# Level 1 Child Pi Execution Plan

Status: approved implementation plan.

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

Each parent tool invocation launches one child with three semantic inputs:

```ts
{
  task: string;
  profile: "scout" | "planner" | "reviewer" | "implementer";
  cognitiveRole: CognitiveRole;
  background?: boolean;
}
```

- `task` is a self-contained assignment that names relevant repository paths, constraints, and expected output.
- `profile` selects Workbench-owned child behavior and requested Pi tools. These lowercase Level 1 child profiles are neither managed Execution Profiles nor authority shapes; in particular, `scout` does not grant managed Scout authority. `implementer` avoids overloading the canonical Worker term.
- `cognitiveRole` selects the required kind of thinking. It never names a provider or model.

The extension supplies the validated current working directory and host capability ceiling. The parent cannot provide a model, provider, Model Effort, executable, environment, session directory, arbitrary tools, or sandbox policy.

One invocation maps to one execution request. When `background` is true the tool returns a handle immediately instead of blocking; the lead reconciles it within the same session through the companion `subagent_collect`, `subagent_status`, and `subagent_cancel` tools. This in-session non-blocking launch lets a lead keep several children in flight, but the extension still performs no batches, chains, retries, review loops, or result synthesis, and no child outlives the attended session. The attended lead remains accountable for deciding what to delegate and for reconciling each result.

## Profiles and routing

V1 loads only the four bundled child profiles. Project and user profile discovery is disabled until a trust and validation model exists. Each profile declares allowed Cognitive Roles; an unknown profile, unknown Cognitive Role, or invalid pair fails preflight.

The extension invokes the package-relative `skills/model-orchestration/scripts/resolve-runtime-binding.mjs` for every child launch and validates its JSON response. The resolved binding contains a Cognitive Role, provider-qualified model, Model Effort, and fresh quota evidence. Routing, quota, and catalog failures stop in the extension before it calls Pi Execution.

The execution adapter accepts only the resulting `ResolvedExecutionSpec`. It rejects malformed or stale binding evidence and fails closed when authentication, launch-time model availability, or runtime binding verification fails. It never selects a fallback. A parent may request a new resolution and start another execution after a typed failure. After Pi starts, the adapter verifies that the reported provider, model, and effort match the resolved binding before prompting the child.

Static `model` fields are removed from bundled profiles.

## Context and sessions

Every child starts with fresh Model Context. The extension does not fork or copy the parent transcript. The lead must create a self-contained task and identify relevant files explicitly. This preserves narrow context, reproducibility, and Independence without preventing the child from inspecting the repository through its allowed tools.

Each child uses Pi's standard machine-local persistent session storage. The adapter captures the Pi session identifier in result metadata so a failed execution can be inspected. It does not copy session state into the repository, create a second ledger, reopen a failed session automatically, or claim that the child is recoverable.

Persisting a child session is evidence and a future continuity primitive, not Worker continuity. Durable Workers remain deferred. When implemented, each Worker action will still be a bounded execution request carrying validated Logical Actor and continuity references; an idle subprocess will not define Worker identity.

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

Each execution also has a configurable timeout. Timeout follows the same termination sequence as user cancellation; the initial default is an implementation constant rather than a new product-level budget policy.

## Observations, results, and cancellation

The adapter normalizes Pi RPC activity into bounded observations for:

- launch and binding verification;
- assistant progress without raw thinking content;
- tool start, progress, and completion;
- usage;
- diagnostics;
- cancellation and timeout; and
- terminal outcome.

Detailed observations drive the tool UI but do not enter parent Model Context. The parent receives only terminal status, final text, child profile, Cognitive Role, resolved provider/model/effort, and Pi session identifier. V1 does not expose arbitrary JSON Schema or automatic correction turns. Usage is observed, but custom token and cost enforcement remains deferred.

The stable Level 1 outcome categories are:

- `preflight_failed`
- `launch_failed`
- `execution_failed`
- `cancelled`
- `timed_out`
- `outcome_unknown`
- success

Detailed provider, quota, authentication, process, and tool errors remain diagnostic causes rather than an unbounded public taxonomy.

Cancellation is successful only after termination is confirmed. The adapter first sends Pi RPC `abort`, then escalates through bounded process termination. If process state cannot be reconciled, it reports `outcome_unknown`; sending a signal alone is not success. No child remains running after its attended parent tool or session ends.

## Acceptance evidence

Replace the temporary official-example implementation only after tests prove:

1. one tool invocation creates exactly one Pi RPC child execution;
2. only bundled profiles and allowed profile/Cognitive Role pairs pass preflight;
3. every launch uses a fresh provider-qualified binding and explicit Model Effort;
4. stale quota, missing authentication, unavailable models, and invalid pairs fail closed without fallback;
5. the runtime-reported binding must match the resolved binding;
6. the effective Pi tool set cannot exceed the profile request and host ceiling;
7. progress streams through normalized observations without raw thinking content entering the public contract;
8. terminal parent context is compact and includes the Pi session identifier;
9. child sessions persist in Pi's standard machine-local store but are never reopened automatically;
10. cancellation, timeout, forced termination, and unknown outcomes are distinguishable;
11. concurrent invocations launch independently and remain cancellable;
12. a background launch returns a handle immediately, and `status`, `list`, and `collect` reconcile the child within the session without ever letting it outlive the attended parent;
13. parent termination cleans up every active child; and
14. existing Level 1 Workstream launch, checkpoint, restart, resume, and closure behavior remains intact.

Use a fake RPC process for deterministic lifecycle and failure tests. Keep one real Pi RPC smoke test for launch, binding, session persistence, streaming, and cancellation.

## Deferred expansion

Do not implement these features as part of this plan:

- durable Worker continuity or Logical Actor recovery;
- durable or unattended background execution that survives the attended parent lifetime (in-session non-blocking launch is supported; a child still dies with the session);
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
