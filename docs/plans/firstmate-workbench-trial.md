# Firstmate in Workbench Chat: two-stage trial

**Status: proposed experiment, not approval to install tools, change PI WEB or Firstmate, or add a Workbench capability.** This plan tests (1) Firstmate's primary Pi session in Workbench Chat with an external non-tmux crew backend, then (3) the feasibility of using PI WEB sessions as Firstmate crew endpoints. The owner decides after each gate whether to proceed. Neither stage reactivates the rejected Workbench coordination-mate plan or changes [Decision 103](../foundation/decisions.md).

## Question and existing evidence

Can Workbench Chat be a useful front end for Firstmate's supervision without making Workbench a second authority for its tasks? If a separate crew app is undesirable, can PI WEB safely supply the crew sessions as a Firstmate backend?

- [Firstmate at `1e0e773`](https://github.com/kunchenguid/firstmate/tree/1e0e773) is an agent distro, not a fleet UI. Its primary Pi extensions own watcher continuity and turn-end behavior; `bin/fm-backend.sh` dispatches endpoint operations to tmux, Herdr, Zellij, Orca, or cmux. `bin/fm-fleet-snapshot.sh --json` supplies an observational fleet projection. Its shell scripts and tests demonstrate intended mechanics; compatibility with our PI WEB host has **not** been exercised.
- Workbench Chat uses PI WEB's server, session daemon, and Pi runtime. Closing a Chat window is not the same as stopping its Pi session. Workbench Subagents and Workers are attended and do not survive shutdown of their lead session; the managed Run Controller and workspace isolation are unbuilt. See the [system overview](../foundation/system-overview.md), [execution contract](../contracts/execution.md), and [reuse boundary](../integrations/pi-web/reuse-boundary.md).
- Firstmate's existing [Workbench evidence ledger](../research/sources/firstmate.md) records lessons already reflected in the design. This experiment tests operational value, not whether to copy its prompt, task ledger, or scripts into Workbench.

## Shared constraints

- No tmux, production project, real PR, automatic merge, `+yolo`, secondmate, public Relay, or restart of the PI WEB session daemon hosting attended work. The external backend for stage 1 requires an **owner choice**; Herdr is the best-documented non-tmux reference, but is an additional app with its own license and setup. Orca and cmux are alternatives with experimental Firstmate backends. If no separate crew app is acceptable, skip stage 1's live dispatch rather than silently using tmux.
- Use a persistent isolated Firstmate checkout/home and a disposable local Git project, not the `pi-workbench` checkout or an operating-system temporary directory. Pin Firstmate's commit and record the PI WEB fork/runtime versions and dependency versions. No credentials or generated fleet data enter Git.
- Firstmate alone owns its task metadata, session lock, wake queue, and task decisions. PI WEB owns hosted Pi session creation and lifecycle. Workbench Chat is a client; Workstreams may link an experiment but must not mirror Firstmate task state or claim managed Run authority.
- Audit the exact missing toolchain and request permission before installing anything. On this machine, `treehouse`, `tasks-axi`, `no-mistakes`, `gh-axi`, and `chrome-devtools-axi` were absent at the initial check; recheck rather than assuming the list remains current.
- This is an experiment, not a standing default. Do not modify the sibling PI WEB checkout without first fetching `upstream` and `origin`, working on a fork branch, and following its repository rules. Any planned host change must use an isolated test instance or an explicitly authorized deployment; do not restart the live session daemon.

## Stage 1 — Firstmate primary in Workbench Chat, crew elsewhere

**Smallest question:** can a hosted Pi primary supervise a real Firstmate task and recover its attention correctly while the owner uses Workbench Chat? This stage needs no new Workbench UI or backend code.

1. **Readiness, before launch.** Confirm how PI WEB discovers and trusts the checkout's four `.pi/extensions` and how it reports their load/failure in a session. Audit Firstmate's bootstrap, required executables, credentials, and chosen backend. Choose the non-tmux backend with the owner; record licensing and any app/socket permissions. Stop if the necessary dependencies or permissions are unacceptable.
2. **Isolated primary.** Open a new Workbench Chat located at the isolated Firstmate checkout, with its private home and no registered real projects. Check that the primary Pi session loads the watcher and turn-end extensions and that `bin/fm-session-start.sh` obtains exactly one home lock. If host startup, extension dialogs, watcher ownership, or wake delivery differs from terminal Pi, stop and record the exact mismatch rather than patching the live daemon.
3. **Scout and recovery.** Register only the disposable Git project. Dispatch one Scout investigation. While it is live, close/reopen the Workbench window and verify the same hosted primary and task state. Separately stop only the *pilot primary Pi session*; verify the external crew endpoint and task records remain, then start a fresh primary against the same home and reconcile without duplicate dispatch or a lost decision. Never stop the hosting PI WEB daemon to simulate this. Collect the Scout report and confirm its worktree identity and cleanup gate.
4. **Guarded local change.** Only after the Scout outcome is understood, dispatch one small `local-only` Ship without autonomous landing. Confirm visible current state, one actionable wake, decision delivery if triggered, attributable change evidence, and refusal to clean dirty/unlanded work. Do not publish externally.
5. **Decision.** Compare setup burden, owner interventions, duplicate/missed wakes, recovery clarity, and whether a separate crew app is tolerable against doing the same bounded work with Workbench's attended Subagents/Workers. Preserve the report and pinned versions; leave the disposable home intact until its task and worktree cleanup is verified.

**Pass:** the primary works in Workbench Chat; a Scout and a guarded local Ship finish with attributable evidence; the window reconnection and primary-process restart produce no duplicate task, false completion, or lost actionable decision. **Fail/stop:** required Pi extension behavior or backend liveness cannot be demonstrated, or the separate app defeats the intended experience. A successful stage 1 does not prove PI WEB can host crew endpoints.

## Stage 3 — PI WEB sessions as a Firstmate crew backend

**Prerequisite:** an owner decision that Workbench-only crew presentation is worth a backend experiment. Stage 1's live dispatch need not pass if the owner rejects every external app, but its primary-host compatibility and the following host-capability audit must pass. Do not treat this as a shortcut to Workbench's unbuilt managed Run Controller.

### 3A. Prove the interface can be supported

Make a source-backed matrix for every Firstmate operation in [`bin/fm-backend.sh`](https://github.com/kunchenguid/firstmate/blob/1e0e773/bin/fm-backend.sh): create/launch in an exact worktree, stable task-to-session identity, lookup after restart, send and submit, current busy/idle/blocked and agent liveness, event/wake delivery, capture for inspection, stop, and safe endpoint removal. Map each to a documented, scoped PI WEB operation with its authorization, error, timeout, replay, and reconnect behavior. Test actual PI WEB behavior; a route name alone is not proof of the contract.

The existing PI WEB plugin `pi-sessions` capability creates or runs an **initial** hosted conversation; its returned completion does not cover later turns. Its `pi-session-events` capability is fire-and-forget with **no replay or acknowledgement** (sibling `../pi-web/src/server-plugin-api.ts`, relative to the Workbench repository root). Neither alone satisfies Firstmate's send, observation, and recovery contract. Prefer an existing authenticated host operation if it meets the full semantics; otherwise specify the smallest typed host capability needed. Do not reach through private daemon sockets or parse transcript text as authoritative liveness.

**Go/no-go:** can an uncertain creation result be reconciled to one exact project/worktree/task/session identity before retry, and can a stale or inaccessible endpoint return `unknown` without fabricating idle, done, or permission to clean up? If either answer is no, stop the backend experiment here.

### 3B. Implement one bounded backend spike, only after 3A passes

- Prototype a `pi-web` backend in an isolated Firstmate fork/branch, preserving Firstmate's task ledger, lock, watcher, and cleanup gates. Keep PI WEB as session host, not task authority. Do not add a second Workbench task database or a new Workbench UI shell. Use Firstmate's normal Treehouse worktree path unless 3A demonstrates a narrower safe existing path.
- Begin with **one Scout on a disposable project**. Bind its hosted Pi session to the exact worktree and task generation, make launch idempotent or explicitly `outcome_unknown`, and prove read-only observation and a report. Add authenticated steering, actionable wake delivery, and verified close only after the identity and recovery tests pass. No Ship, merge, or PR path in this first spike.
- Test loss of create response, host reconnect, primary restart, crew session stop, competing task IDs, delayed events, missing status, and cleanup refusal. Use a fake host for deterministic failure tests plus one real isolated PI WEB session-daemon smoke. A host failure must leave inspectable records and worktrees rather than retry blindly or silently discard them.

### 3C. Only if the backend proves its contract

Add one guarded `local-only` Ship exercise and verify worktree mutation inventory, landing authority, and fail-closed cleanup. A later Workbench view may consume Firstmate's observational fleet snapshot, labelled **externally managed**; any controls must submit through Firstmate's guarded path with receipts. No view turns a Firstmate task into a Workstream Human Task or a managed Workbench Run by inference.

**Pass:** after killing and restarting only the pilot primary/session and recovering PI WEB connectivity, exactly one crew session remains attributable to its task, outstanding decisions remain actionable, and no unlanded work is cleaned or merged. **Stop:** the host lacks safe discovery, replay/reconciliation, scoped authorization, or liveness evidence; implementing a UI before those pass would conceal the risk. Product adoption requires a separate owner decision to revisit Decision 103 and the current Workbench UI scope.

## Outcome to report

For each stage, report the pinned versions, backend, installed dependencies, observed session/worktree identities, tests and failure injections, owner attention spent, actual UI experience, cleanup status, and unresolved risks. End with one recommendation: use Firstmate externally, continue the PI WEB backend, adopt one Workbench-native mechanism later, or stop. Do not call a fleet snapshot, model claim, or successful Scout report proof of managed recovery.
