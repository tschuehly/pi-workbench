# AFK / Overnight Supervision Packages Evidence Ledger

## Scope

Primary-source survey of Pi coding-agent extensions/packages and one adjacent non-Pi harness for durable
AFK/overnight supervision of one or more Pi sessions — status watching, periodic wake/poll, nudging, and
deciding interventions. Checked against npm registry metadata, package/repository READMEs, and source on
2026-08-07. Framed against the already-approved [FirstMate coordination-mate
plan](../plans/firstmate-coordination-mate.md) and the deep evidence already collected in
[`firstmate.md`](firstmate.md) and [`subagent-implementations.md`](subagent-implementations.md).

## Method

Searched npm registry full-text (`registry.npmjs.org/-/v1/search`) for scheduler/watchdog/supervisor/
heartbeat/notify/tmux/cron/afk terms scoped to Pi, then read registry metadata (`repository`, `homepage`,
embedded `readme`) and, where a public repository existed, its README directly. No package was installed;
this is a read-only catalog and source review.

## Candidate classes and findings

### 1. Attended subagents (not overnight supervision)

1. The official Pi subagent example and the `pi-subagents`/`pi-spawn`/Davis-setup family launch and observe
   child Pi processes for the lifetime of one attended parent turn. None persists a wake/poll loop or
   watches sessions across parent-process exit. This class is evidence for execution mechanics, not
   supervision, and is already fully covered in [`subagent-implementations.md`](subagent-implementations.md).
   - Source: prior evidence ledger, re-confirmed by absence of any daemon/cron/schedule surface in that
     family's READMEs.

### 2. tmux helpers

2. `pi-tmux-task` 0.2.1 maps one Pi conversation to a tmux session/window, polls tmux task state, and
   notifies the *active* conversation on exit, bell, input-wait, or disappearance. It requires the owning
   Pi conversation to still be running; it does not wake a session that has ended or survive daemon
   restart.
   - Source: [README](https://github.com/ttttmr/pi-tmux-task) (fetched via npm registry readme field).
3. `pi-tmux-fork` 0.2.3 forks a live tmux-attached session into a sibling pane with shared prompt-cache
   and worktree isolation. It is a session-spawning convenience, not a watcher; it has no polling,
   scheduling, or intervention logic.
   - Source: [README](https://github.com/geeyu/tmux-fork).

### 3. Notification-only

4. `pi-notify` 1.4.0 (ferologics), `@diegopetrucci/pi-notify` 0.1.15, and `@async23/pi-notify` fire a
   single OS/terminal notification on Pi's `agent_end`/`agent_settled` lifecycle event (OSC 777/99/9,
   `osascript`, `notify-send`, PowerShell toast, `terminal-notifier`). None polls, classifies, or decides
   an intervention; they are a fire-and-forget side effect of an event the running session already emits.
   - Sources: [pi-notify README](https://github.com/ferologics/pi-notify), [`@diegopetrucci/pi-notify`
     README](https://github.com/diegopetrucci/pi-extensions/tree/main/extensions/notify),
     [`@async23/pi-notify` README](https://www.npmjs.com/package/@async23/pi-notify).
5. `@yishan-io/pi-notify` 0.3.1 forwards raw lifecycle events (`agent_start`, `tool_execution_end`,
   `agent_settled`, `session_shutdown`) to an external "Yishan daemon" for usage tracking. It is a
   transport, not a policy: all classification and any wake/intervention logic live outside the reviewed
   package, in an unpublished daemon.
   - Source: [README](https://www.npmjs.com/package/@yishan-io/pi-notify).
6. Every notification-only package requires the emitting session's process to still be alive to fire the
   event; none independently detects a hung, silently-stalled, or crashed session.

### 4. Loop / autopilot (in-session scheduling)

7. `pi-scheduler` 0.3.2 (manojlds) and `@jl1990/pi-scheduler` 0.2.4 add `/loop`, `/remind`, and a
   `schedule_prompt`/`schedule_task` tool so the *current* session can re-prompt itself on an interval or
   cron expression, including capturing shell stdout/stderr and waking "only on failure." `@jl1990/pi-
   scheduler` persists tasks to `~/.pi/agent/state/scheduler/tasks.json` and supports `once`/`interval`/
   `cron` scopes bound to a session, cwd, or globally.
   - Sources: [pi-scheduler README](https://github.com/manojlds/pi-scheduler), [`@jl1990/pi-scheduler`
     README](https://github.com/jl1990/pi-scheduler).
8. `@e9n/pi-cron` 0.2.1 runs scheduled prompts as isolated `pi -p` subprocesses from a plain-text
   `pi-cron.tab`, guarded by a lock file so only one scheduler runs at a time, and is off by default.
   `@e9n/pi-heartbeat` 0.1.1 runs an isolated `pi --no-session` health-check subprocess on an interval,
   reads a per-project `HEARTBEAT.md` checklist, suppresses `HEARTBEAT_OK` responses, and escalates only
   non-OK results through a separate `pi-channels` alert route, bounded by `activeHours`.
   - Sources: [`@e9n/pi-cron` README](https://github.com/espennilsen/pi/tree/main/extensions/pi-cron),
     [`@e9n/pi-heartbeat` README](https://github.com/espennilsen/pi/tree/main/extensions/pi-heartbeat).
9. `pi-autopilot` 1.3.1 (ismailsaleekh) is a much larger loop/authority system: a shipped Rust
   `autopilot-core` binary owns task-pack parsing, planning, role/roster selection, terminal-outcome
   validation, and a bounded self-repair pass, invoked from a thin TypeScript Pi host. It targets one
   attended run to completion of a four-file task pack, not durable overnight polling across many
   sessions; it also concentrates plan/run authority in a package-owned binary outside Workbench's
   controller boundary.
   - Source: [README](https://github.com/ismailsaleekh/pi-autopilot).
10. All members of this class re-prompt the *same* session/process; none maintains a durable external
    supervisor process, a multi-session fleet view, or a reconciliation step that distinguishes a dead
    process from an idle one.

### 5. RPC / SDK supervisors (in-process judgment)

11. `pi-supervisor` 0.5.0 (tintinweb) runs a second, separate in-memory Pi session that watches the
    primary conversation "from outside," analyzing it after every run and, at `medium`/`high` sensitivity,
    mid-run between tool calls. It injects steering messages into the primary agent when it judges the
    goal is drifting and signals completion — the closest reviewed package to "watch, decide, and
    intervene," but scoped to one conversation, in-process, and without any durable state, restart
    recovery, or multi-session fleet view.
    - Source: [README](https://www.npmjs.com/package/pi-supervisor) (repository README 404 at inspection
      time; registry-embedded readme used instead).
12. `pi-watchdog-supervisor` 0.1.1 adds deterministic, non-LLM stuck detection: every session (main and
    child) normalizes and hashes its own message/tool-call bodies into a process-shared store and
    self-checks for repeated no-progress patterns on every LLM round-trip, escalating an alert to the
    parent rather than guessing with a model call. This is the only reviewed package other than FirstMate
    that classifies "stuck" deterministically before spending a model turn, but it is scoped to sibling
    subagents inside one process tree via `@gotgenes/pi-subagents` events, not a durable
    cross-process/cross-restart watcher.
    - Source: [README](https://registry.npmjs.org/pi-watchdog-supervisor) (no public repository field at
      inspection time; registry-embedded readme used).
13. The current [`@monotykamary/pi-supervisor` 0.5.13](https://github.com/monotykamary/pi-supervisor)
    is the closest ready-made experiment for the user's exact single-session request. It runs a separate
    in-memory Pi model session, analyzes the watched conversation at `agent_settled` and selected mid-run
    signals, returns `continue | steer | done`, injects steering as a follow-up, escalates ineffective
    steering through four reframe tiers, and persists its goal/intervention state as custom entries in the
    watched Pi session. Its repository contains focused tests and is MIT-licensed.
    - Sources: [README](https://github.com/monotykamary/pi-supervisor/blob/master/README.md),
      [event wiring](https://github.com/monotykamary/pi-supervisor/blob/master/src/index.ts),
      [state persistence](https://github.com/monotykamary/pi-supervisor/blob/master/src/state/manager.ts).
14. That package is not yet an overnight-safe Firstmate. Source inspection found no time/token/cost or
    intervention cap, and its built-in policy instructs the supervisor to answer necessary clarification
    questions with a "sensible default" except credentials/secrets rather than applying a typed
    reversibility/materiality envelope. More importantly, `onSessionLoad` clears active supervision when
    the host is idle, so session-entry persistence does not provide unattended restart resumption despite
    the README's broad persistence wording. Analysis failure at an idle checkpoint degrades to a generic
    `Please continue working toward the goal` steer. Treat it as an early-release interaction prototype,
    not a durable authority boundary.
    - Sources: [session-load and steering implementation](https://github.com/monotykamary/pi-supervisor/blob/master/src/index.ts),
      [analysis fallback](https://github.com/monotykamary/pi-supervisor/blob/master/src/core/analyzer.ts),
      [default policy in README](https://github.com/monotykamary/pi-supervisor/blob/master/README.md).
15. Three narrower packages fill individual mechanics but not the whole policy: [`@phillipleblanc/pi-wake`](https://github.com/phillipleblanc/pi-wake)
    schedules session-scoped future messages and restores pending timers from session entries while the Pi
    process is alive; [`@latent-variable/pi-auto-continue`](https://github.com/latent-variable/pi-auto-continue)
    blindly re-prompts on `agent_end` with a bounded counter but explicitly continues after errors and loses
    state on restart; [`@yusukeshib/pi-babysit`](https://github.com/yusukeshib/pi-babysit) supplies supervised
    PTYs, captured logs, background processes, RPC subagents, steering, waiting, and killing, but deliberately
    leaves judgment to its caller. They are useful mechanism references, not a safe package composition:
    installing all three still leaves contradictory ownership and no canonical intervention policy.

### 6. Durable schedulers (survive session/process end)

16. `@av-pi-studio/server` 0.0.71 ("Pi-Studio daemon") is the only reviewed Pi-adjacent package that is
    structurally a long-lived daemon: one process supervises multiple Pi agent sessions, PTY terminals,
    projects, and git worktrees behind a provider-neutral `AgentClient`/`AgentSession` interface, and
    exposes cron/interval **schedules** that fire agent prompts plus iterative **worker+verifier loops**
    as first-class orchestration primitives alongside chat rooms. All state (agent records, `loops.json`,
    per-schedule JSON, project/workspace registries) persists under `$PI_STUDIO_HOME` through an
    atomic write-to-temp-then-rename store, with a PID lock preventing a second daemon from owning the
    same home directory, so wake/poll state survives client disconnect and daemon restart.
    - Source: [package README embedded at
      npm](https://registry.npmjs.org/@av-pi-studio/server) (no public source repository field; the
      README is the only available primary artifact at inspection time).
17. The daemon's schedules and loops are model re-prompt primitives, not a stuck/hung classifier: nothing
    in the reviewed README computes a deterministic "is this session actually making progress" signal, and
    there is no reversibility- or confidence-gated auto-continue policy comparable to the FirstMate
    ask-user-authority mechanism. Its multi-session registry and durable persistence are still the
    strongest reviewed evidence for a fleet-supervision data shape.
18. `flowflic/Pi-Studio` (a different, MIT-licensed, unrelated project despite the similar name) is an
    Electron desktop client that runs "scheduled automations" against the shared Pi agent directory, but
    its README describes UI and packaging only; it does not document a watcher, wake-classification, or
    intervention policy and was not investigated further.
    - Source: [README](https://github.com/flowflic/Pi-Studio).
19. `kunchenguid/firstmate` (a Pi-compatible but non-package agent distro with substantial shell tooling,
    previously reviewed in [`firstmate.md`](firstmate.md))
    remains the only source in this survey that combines: a zero-token deterministic watcher classifying
    worker signals without a model turn; append-only wake events reconciled against live-process evidence
    into a canonical `unknown`-safe current-state snapshot; a turn-end guard that blocks a coordinating
    session from silently settling while work is in flight without a healthy watcher; and named `ship`/
    `scout` authority shapes with fail-closed cleanup. It is not a Pi package — it drives arbitrary
    terminal-based coding-agent harnesses through shell scripts — and was already excluded as a runtime
    dependency for that reason.
    - Sources: as cited in [`firstmate.md`](firstmate.md), plus its tracked
      [Pi watcher extension](https://github.com/kunchenguid/firstmate/blob/main/.pi/extensions/fm-primary-pi-watch.ts)
      and [`/afk` skill](https://github.com/kunchenguid/firstmate/blob/main/.agents/skills/afk/SKILL.md).

### 7. Adjacent non-Pi harness (out of scope for adoption)

20. `agent-afk` 5.97.6 is a complete, separately-branded, Apache-2.0 coding-agent harness (its own `afk`
    CLI, REPL, daemon, trace format, Telegram bridge, and subagent orchestrators) that talks to models
    directly rather than running on top of Pi. Its `afk daemon` plus `send_telegram` pairing is the
    closest reviewed product-level match to "run long tasks while away and get pinged," but adopting it
    would introduce a second coding-agent runtime, which Decision 25 and the pi-package-evaluation ledger
    already reject for Workbench.
    - Source: [README](https://github.com/griffinwork40/agent-afk).

## Candidate comparison

| Candidate | Class | Durable across process/restart | Multi-session fleet view | Deterministic (non-LLM) classification | Decides interventions | Pi-native |
| --- | --- | --- | --- | --- | --- | --- |
| `pi-tmux-task` | tmux helper | No (tmux session, not daemon-persisted) | No | No (state polling only) | No (notify only) | Yes |
| `pi-notify` family | Notification-only | No | No | No | No | Yes |
| `@yishan-io/pi-notify` | Notification-only | No (forwards to external daemon) | Unknown (daemon out of scope) | No | No | Yes |
| `pi-scheduler` / `@jl1990/pi-scheduler` | Loop/autopilot | Partial (task file persists; requires a session to re-wake) | No (single session/cwd scope) | No | No (re-prompts model) | Yes |
| `@e9n/pi-cron` / `@e9n/pi-heartbeat` | Loop/autopilot | Partial (tab file / interval persists; no cross-restart fleet state) | No | Partial (`HEARTBEAT_OK` suppression is deterministic string matching) | Alert-only | Yes |
| `pi-autopilot` | Loop/autopilot (broad) | No (one attended run to completion) | No | Some (terminal-profile/schema validation) | Yes, within one run's authority | Yes |
| `@monotykamary/pi-supervisor` | RPC/SDK supervisor | Partial state persistence; active supervision clears on idle session load | No (one conversation) | No (LLM judgment every check) | Yes (steers/ends) | Yes |
| `@phillipleblanc/pi-wake` | In-session timer | Pending jobs restore from session entries, but only a live Pi process can fire | No | No | No (sends configured message) | Yes |
| `@yusukeshib/pi-babysit` | PTY/RPC process substrate | PTY/log state survives caller context; not a decision supervisor | Multiple child jobs, not arbitrary Pi fleet | Lifecycle detection only | No (caller sends/steers/kills) | Yes |
| `pi-watchdog-supervisor` | RPC/SDK supervisor | No | Partial (sibling subagents in one process tree) | Yes (hash-based repeat detection) | Alert-only | Yes |
| `@av-pi-studio/server` | Durable scheduler | Yes (atomic JSON store + PID lock) | Yes (agent/loop/schedule registries) | No | No (schedules/loops re-prompt; no stuck classifier) | Yes (wraps Pi as a provider) |
| `kunchenguid/firstmate` | Durable scheduler | Yes (state on disk, reconciled on restart) | Yes (fleet snapshot) | Yes (shell watcher) | Yes (escalate vs. absorb, turn-end guard) | No (shell/multi-harness) |
| `agent-afk` | Adjacent harness | Yes (own daemon) | Partial (own session manager) | Unknown (not reviewed at source level) | Yes (own gates) | No (separate harness) |

## Gaps against what V1 Firstmate needs

No reviewed Pi package combines all of the capabilities [`firstmate-coordination-mate.md`](../plans/firstmate-coordination-mate.md)
requires for C1–C4:

- **Decision-point pause/resume with a reply channel** (C1/C2): no reviewed package exposes a structured
  `{question, options, proposedAnswer, confidence, reversibility, materiality, blastRadius}` observation or
  a `send(executionId, answer)` back-channel. `pi-supervisor` steers by injecting messages into the
  *watched* session's own context, which conflicts with Workbench's "mate never writes the ledger or
  touches session context directly" invariant.
- **Reversibility/materiality-gated auto-continue policy** (C3): none of the reviewed loop, autopilot, or
  supervisor packages gates automatic continuation on a reversibility or blast-radius axis independent of
  confidence; only FirstMate's ask-user-authority (non-Pi) demonstrates this pattern.
- **Durable, restart-safe, multi-session attention surface** (C4): only `@av-pi-studio/server` (Pi-native,
  durable, multi-session) and `kunchenguid/firstmate` (non-Pi, fleet snapshot + reconciliation) satisfy
  this; the daemon has the persistence shape but not the classification, and FirstMate has the
  classification but not a Pi-native runtime.
- **Zero-token deterministic wake classification** (efficiency prerequisite for AFK use at scale):
  `pi-watchdog-supervisor`'s hash-based repeat detection and `@e9n/pi-heartbeat`'s `HEARTBEAT_OK`
  suppression are the only Pi-native examples of classifying "nothing actionable happened" without a model
  call; both are narrower and less general than FirstMate's watcher/current-state split.
- **Away-mode digesting and turn-end guard** (C5, Level 4-gated): not demonstrated by any reviewed Pi
  package; only FirstMate's `/afk` digest and turn-end guard address it, and that plan phase is explicitly
  deferred pending the Run Controller.

## Recommendation for V1 Firstmate

**There is now a clear answer at two levels:** for a disposable one-session experiment,
`@monotykamary/pi-supervisor` already demonstrates the desired watch → judge → nudge loop. For the
Workbench V1 contract—multiple sessions, explicit authority, safe AFK policy, restart reconciliation, and
an inspectable attention surface—no package is a sufficient foundation.

1. Run `@monotykamary/pi-supervisor` only as a short, isolated mechanism trial if the immediate goal is to
   feel the interaction before building it. Pin the reviewed version, use a cheap separate supervisor
   model, constrain the watched session through its existing tools/sandbox, and manually stop it; do not
   call it overnight-safe until restart, budget, error-loop, and irreversible-decision tests pass.
2. Do not adopt any reviewed package as the coordination-mate's authority. Every durable or judgment-
   bearing candidate (`@av-pi-studio/server`'s daemon authority over agent lifecycle, `pi-supervisor`'s
   direct context injection, `pi-autopilot`'s package-owned plan/run authority, `agent-afk`'s separate
   harness) would create a second lifecycle or authority system in the sense already rejected in
   [`pi-package-evaluation.md`](pi-package-evaluation.md).
3. Build Phase 1 (C1 decision-point observation + C2 reply channel) directly on
   [`packages/pi-execution-adapter/`](../../packages/pi-execution-adapter/) as the existing plan specifies;
   no reviewed package offers this contract to adapt.
4. Adapt narrow mechanisms, with attribution, rather than installing their packages:
   - `@monotykamary/pi-supervisor`'s separate judging session and stale-user-input race guard as the
     smallest single-session interaction reference, replacing direct free-text steering with typed
     observations and controller-mediated answers.
   - `pi-watchdog-supervisor`'s deterministic hash-based no-progress detector as a candidate zero-token
     "no actionable change" classifier feeding the C4 attention surface, scoped to Workbench's own event
     stream instead of `@gotgenes/pi-subagents` events.
   - `@av-pi-studio/server`'s atomic-store (write-temp-then-rename) durable JSON persistence and
     single-owner PID-lock pattern as implementation reference for persisting the Workstream `watch`
     projection's decision-point and unattended-progress state across restarts, once C4/C5 need real
     durability.
5. Continue treating `kunchenguid/firstmate` (already captured in [`firstmate.md`](firstmate.md)) as the
   primary architectural reference for the deterministic watcher, current-state reconciliation, and
   turn-end guard that no Pi-native package yet replicates; this survey found nothing that supersedes it
   for those three mechanisms.
6. Reject `pi-scheduler`/`@jl1990/pi-scheduler`/`@e9n/pi-cron`/`pi-autopilot`/`agent-afk` as building
   blocks for the mate itself. They remain useful *user-installed* conveniences inside an individual
   session (self-rescheduling, CI polling, personal AFK harness) but do not fit the Workbench invariant
   that the mate grants no authority and never writes a repo or session context.

## Confidence and limits

- npm registry metadata and embedded READMEs are treated as primary source for packages without a public
  git repository (`@av-pi-studio/server`, `pi-watchdog-supervisor`, `pi-supervisor`'s current head); their
  implementation source was not independently inspected, so internal correctness claims (e.g., the
  daemon's exact reconciliation behavior on crash) are unverified beyond what the README states.
- Coverage is a keyword-driven npm search plus targeted GitHub lookups, not an exhaustive crawl of the
  5,398-package pi.dev catalog already indexed in
  [`pi-package-evaluation.md`](pi-package-evaluation.md); a package using unrelated terminology could exist
  unseen.
- Version/commit references are the latest published versions as of 2026-08-07 and may have moved since.
