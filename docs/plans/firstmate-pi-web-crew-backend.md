# Investigate PI WEB as a Firstmate crew backend

**Status: isolated feasibility work in progress; no backend is deployed or safe for crew dispatch.** Determine whether Firstmate workers can run as PI WEB-hosted Pi sessions and appear in Workbench Chat without tmux or another crew app. The separate [primary-in-Workbench-Chat trial](firstmate-workbench-chat-trial.md) tests a faster external-backend route; its live crew trial is **not** a prerequisite for this audit. Product adoption would require a separate owner decision to revisit [Decision 103](../foundation/decisions.md) and the [current UI scope](workbench-ui.md).

## Ownership and the hard question

Firstmate would still own its task records, session lock, watcher, decisions, worktree cleanup, and delivery gates. PI WEB would own hosted Pi sessions and their lifecycle. Workbench Chat would present those sessions, not turn Firstmate tasks into Workstream Human Tasks or managed Workbench Runs. Do not create a second authoritative task ledger or move the Run Controller into PI WEB.

Firstmate's [`fm-backend.sh` at `1e0e773`](https://github.com/kunchenguid/firstmate/blob/1e0e773/bin/fm-backend.sh) expects create/launch, exact endpoint lookup, send, inspect/capture, busy and agent liveness, event watching, stop, and safe removal. PI WEB exposes session routes, but their existence does not prove idempotent creation, replayable events, or a trustworthy task-to-session identity. Its `pi-sessions` plugin capability covers initial session creation/run, not later turns; `pi-session-events` is fire-and-forget without replay or acknowledgement (sibling `../pi-web/src/server-plugin-api.ts`, relative to this repository's root). These gaps must be checked against the live runtime rather than papered over by transcript or terminal parsing.

## Phase A — Read-only capability audit

1. Pin Firstmate, PI WEB fork, and Pi runtime revisions. Map every operation above to an existing documented and authenticated PI WEB operation, including exact machine/project/workspace/worktree/session identity, scope, timeout, authorization, error, reconnect, and shutdown behavior. Identify what requires a new typed host capability rather than a shell command against a private daemon socket.
2. Trace three failure cases through both systems: create succeeds but its response is lost; an existing crew Pi session stops while its task record remains; a late event belongs to a replaced task generation. Require a lookup that can reconcile one exact task/worktree/session before retrying. Unreachable or ambiguous state must remain `unknown`, never be presented as idle, done, or cleanup-safe.
3. Verify primary-host compatibility for the intended Workbench Chat experience. A failed [primary trial](firstmate-workbench-chat-trial.md) blocks claiming an integrated Workbench experience, though this read-only backend audit may still finish. Determine how the owner would open and identify a crew Chat without replacing the existing one-Chat-per-window composition.

**Go/no-go:** if creation cannot be reconciled safely, task/worktree/session identity cannot be bound, or liveness cannot fail closed, stop. Report the unsupported operation and a falsifiable path to a host capability; do not implement a fleet panel that hides the gap.

## Phase B — One-Scout backend spike, only after owner acceptance of Phase A

- Prototype a `pi-web` backend on an isolated Firstmate fork branch. Keep Firstmate's existing task ledger, watcher, and Treehouse worktree flow unless the audit proves a narrower safe reuse path. Do not change `pi-workbench` or the hosting session daemon. Any sibling PI WEB edit requires fetching `upstream` and `origin` first, a fork branch, and isolated test/deployment arrangements; no restart of the daemon hosting attended work without explicit authorization.
- Start **one Scout against an isolated disposable Git project** on an isolated PI WEB test instance with its own data directory, session-daemon socket, and web port. This is the smallest place to inject lost responses, stops, and cleanup refusals without risking the real Workbench checkout or its live daemon. Bind the hosted Pi session to one exact task generation and worktree; a failed or uncertain creation must preserve inspectable records and refuse blind redispatch.
- Prove launch, current-state observation, report, authenticated steering, actionable wake delivery, reconnect, and verified endpoint close in that order. Use deterministic fake-host tests for failure paths and one real isolated-session smoke. Do not add Ship, PR, merge, or Workbench fleet controls in this spike.

**Pass:** after stopping/restarting only the pilot primary Pi session and disrupting the isolated crew connection, exactly one crew session remains attributable to its task; open decisions survive; and unlanded or unknown work is not cleaned. **Stop:** missing discovery, scoped authorization, event reconciliation, or liveness evidence. Record setup, host APIs used, state transitions, test outputs, and residual risks.

## Phase C — Optional real-project validation and presentation

Only after Phase B passes and the owner approves a useful bounded task, run a read-only Scout against `pi-workbench` in an isolated worktree. A guarded `local-only` Ship is a separate owner-approved step with explicit landing authority. If the experience merits a Workbench view, consume Firstmate's observational [`fm-fleet-snapshot.sh --json`](https://github.com/kunchenguid/firstmate/blob/1e0e773/bin/fm-fleet-snapshot.sh) and label the fleet **externally managed**; all control actions must pass through Firstmate's guarded path and return receipts. A successful view is not proof of supervision or authority.

At the end, recommend one of: keep Firstmate external, build the PI WEB backend under its own authority, translate one mechanism into Workbench's future managed modules, or stop. This experiment grants no unattended Workbench Run guarantees.

## Capability finding — 2026-09-23

The isolated PI WEB pilot at `f17b8aeb` installs Pi SDK `0.85.1`. Its `pi-sessions` plugin capability can create a hosted session, but returns a randomly generated ID only after startup. `POST /sessions` also lacks an operation key. If the create succeeds and its response is lost, retrying can create a second session; neither existing path is a safe Firstmate crew backend. Firstmate's current `fm-backend.sh` has no `pi-web` adapter.

The separate Pi SDK branch `experiment/firstmate-empty-session-persist-20260923` at `5a961639b` adds `SessionManager.materialize()` on SDK `0.87.1`: exclusive creation and sync before the first assistant turn. This alone does not supply host idempotency, and it does not match the pilot's locked SDK version. A safe isolated host spike still needs a durable operation-to-session reservation, caller-preidentified ID, workspace and file-header validation on recovery, and failure-window tests before any Firstmate adapter or Scout. The primary Chat trial also failed to establish Firstmate's per-session lock; even a working crew host would not yet prove an integrated Workbench experience.
