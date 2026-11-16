# bb: what Pi Workbench can learn

## Scope and method

Reviewed on 2026-11-08: [`get-bb/bb`](https://github.com/get-bb/bb) at commit
[`55135d1`](https://github.com/get-bb/bb/tree/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00),
dated 2026-11-07. That commit matches npm `bb-app` 0.49.0. bb is MIT-licensed.

Evidence comes from four kinds of source:

- **Source code and tests.** A clone was read at that commit. Paths below are relative to the bb
  repository; `bb:` links point at the reviewed commit.
- **Issues.** Selected issues from the bb tracker.
- **Live probe.** bb 0.49.0 was installed in isolation (its own data directory and ports, with
  telemetry off) and drove the installed Pi 1.5.0 through seven tests. The tests used six
  low-effort model turns on `gpt-6-luna`.
- **Workbench baseline.** The PI WEB fork (`pi-workbench` branch at `fb674477`), the Durable
  branches, this repository, and 30 days of session logs, which show what is used day to day.

The question was whether bb is a better architectural foundation than PI WEB, and if it is
not, what Workbench should learn from it. Claims not confirmed in code are listed under
[Unverified](#unverified).

[bb-base]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00

## Verdict

bb is a well-engineered architecture for a multi-provider IDE. It is the wrong foundation for
Pi Workbench, for two reasons:

- It puts workflow authority in a server that also owns the GUI.
- It turns Pi into one provider behind a translation layer that is harness-neutral and therefore
  lossy.

Workbench wants the opposite on both counts: Pi as the only runtime, the place where durability
lives, and the primary extension surface. PI WEB is a thin host that renders Pi without owning
authority ([Decision 162](../../foundation/decisions.md)).

Six bb mechanisms are worth learning from: the extension seam, explicit contracts, lifecycles
expressed as data, typed worker results, deterministic orchestration replay, and conformance
tests against a fake runtime. Its Pi bridge is also a useful catalogue of what a Pi host must
not do.

## What bb is

The server stores all state in SQLite and owns product policy. A host daemon on each machine
provisions workspaces and runs provider processes. The web app, desktop app, mobile app and the
`bb` CLI are all clients of one SDK.
Sources: [`docs/system-overview.md`][bb-overview],
[`docs/repository-overview.md`][bb-repo-overview].

Two contract packages carry the boundaries:

- `@bb/server-contract` sits between the clients and the server.
- `@bb/host-daemon-contract` sits between the server and the daemons.

Implementation packages may not import across these boundaries. The daemon wire carries a
protocol version that every wire change must increment. At the reviewed commit,
`HOST_DAEMON_PROTOCOL_VERSION` is `264`.
Sources: [`AGENTS.md:20-22`][bb-agents], [`packages/host-daemon-contract/src/protocol.ts:1`][bb-proto].

A **thread** is the unit of work. Providers are plugins: Codex, Claude Code, Pi and ACP agents.
Each provider is translated into one event model through a provider-bridge protocol.
Sources: [`docs/provider-bridge-protocol.md`][bb-bridge-doc], `packages/agent-runtime`.

Project activity: 931 PRs merged in the 30 days before review, mostly from three humans and
several bots, and 5,074 stars. The PI WEB upstream ([`jmfederico/pi-web`][piweb-upstream]) is
effectively maintained by one person: 1,848 of its 1,943 commits.

[bb-overview]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/docs/system-overview.md
[bb-repo-overview]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/docs/repository-overview.md
[bb-agents]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/AGENTS.md
[bb-proto]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/packages/host-daemon-contract/src/protocol.ts#L1
[bb-bridge-doc]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/docs/provider-bridge-protocol.md
[piweb-upstream]: https://github.com/jmfederico/pi-web

## Architectural comparison

| Concern | bb | PI WEB with Durable |
| --- | --- | --- |
| Unit of work | bb's own thread; the provider session sits behind it | the Pi session itself |
| Authoritative state | bb's server SQLite (threads, events, transition tables) | the Pi session file; under Durable, a SQLite store owned by the Pi runtime |
| Agent runtime | Pi child process in RPC mode, normalised by the bridge | Pi SDK running in-process in the session daemon |
| How it is extended | bb plugins (UI slots, server hooks, CLI) | Pi extensions, plus a PI WEB fork for UI |
| Durability | wrapped around a disposable agent: kill, then re-prompt | inside the runtime: the session survives |
| Role of the server | owns product policy and state | hosts and renders sessions; no workflow authority |

Workbench's invariants decide this comparison:

- The Run Controller stays independent of PI WEB runtime and every client.
- Clients never own Run or Workstream state.
- Pi is the only model-worker runtime.

Sources: [`AGENTS.md`](../../../AGENTS.md), [system overview](../../foundation/system-overview.md).

Built on bb, Workbench could only do one of two things. bb's server would become the controller,
coupling authority to a third-party IDE. Or bb would become a second authoritative ledger beside
our own. Workbench logic would also move out of Pi extensions, which run in terminal Pi, PI WEB
and Durable alike, into bb plugins, which run only in bb.

Two consequences of bb's shape show up in its own code and issues:

- **Two state machines meet at a seam.** bb's thread lifecycle sits outside Pi's agent loop and
  is reconciled from Pi events. The defects cluster at that seam. The bridge settles turns on
  `agent_end` (`plugins/provider-pi/src/bridge/rpc-session.ts:697`). As a result, an extension
  command that starts no agent run leaves the thread busy until a 120-second timeout or a manual
  stop ([bb#3792][bb-3792], open since 2026-09-16, still reproduced on Pi 1.4.0). The live probe
  reproduced it on Pi 1.5.0.
- **Two sources of truth.** bb renders from its own `events` table but resumes from the Pi
  session file. Resume replays nothing from the file (`bridge.ts:832-850`, per the code read).

[bb-3792]: https://github.com/get-bb/bb/issues/3792

## Lessons

Each lesson gives what bb does, what Workbench does today, and what to take. Classifications
follow the `analyze-source-for-workbench` skill's vocabulary: adopt, adapt,
experiment, reject.

### 1. Extend through a seam, not a fork (adapt)

**What bb does.** Plugins extend bb through a documented SDK with about 130 extension points:

- sidebar and thread rows;
- timeline entries;
- rich message embeds;
- composer, banners and mentions;
- side-panel tabs;
- file viewers;
- agent providers;
- `message.dispatch` hooks.

The surfaces are catalogued in
[`plugins/plugin-api-docs/src/surfaces.ts`][bb-surfaces].

Three rules in [`AGENTS.md:26-33`][bb-agents] keep the seam honest:

- **Core uses the plugin path.** A plugin API that performs a core action must be the path core
  itself uses. Parallel plugin-only paths are forbidden: "If core cannot use the API, it is not
  ready to ship."
- **New API is visibly unstable.** New public API members carry an `experimental_` prefix and an
  entry in [`docs/api_to_audit.md`][bb-audit]. The entry states behaviour, criteria for
  stabilising, and the core callers. At the reviewed commit, 754 SDK symbols still carry the
  prefix.
- **First-party plumbing is marked separately.** It uses an `internal_DO_NOT_USE_` prefix that
  names its only callers.

Many bb features are themselves plugins: workflows, tasks, side-chat, memory, concurrency
limits, provider retry and every provider.

**What Workbench does today.** Workbench UI lives in a fork of PI WEB:

- 433 commits ahead of `upstream/main`: 326 regular and 107 merges.
- 421 files changed, +41.2k/−5.4k lines.
- Since the last merge base, upstream changed 1,191 files, and 156 of them overlap the fork.
- The previous sync, the "upstream-Chat merge" `a40183ba` on 2026-10-21, needed a trial branch
  and five follow-up re-merges.

Upstream now ships seams that overlap fork features:

- extensible transcript renderers ([`0ec82b5e`][pw-renderers]);
- custom tool renderers ([pi-web#390][pw-390]);
- generic human intervention state ([`5b0f00b3`][pw-intervention]);
- host-owned session lifecycle for plugins ([`ec645526`][pw-lifecycle]).

**Lesson.** The fork is Workbench's main structural weakness, and bb shows the alternative.
Express Workbench UI as plugins on PI WEB's own seams, and apply bb's rule to them: a seam
counts only if PI WEB core uses it too.

Candidate surfaces, taken from the fork inventory:

- transcript renderers for subagent completion, background-bash and Atelier notices;
- status chips for Activity, Working Mode and Goal;
- composer chips for `ask_user`;
- the Workstream chooser and the Files pane.

**Destination.** The PI WEB fork, upstream PI WEB contributions, and the
[Workbench UI plan](../../plans/workbench-ui.md).

**Evidence that would show improvement:**

- the number of fork files that overlap upstream falls;
- the next upstream sync lands without re-merges.

**Keep unchanged:**

- PI WEB stays non-authoritative.
- Pi extensions remain where Workbench behaviour lives.

[bb-surfaces]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/plugin-api-docs/src/surfaces.ts
[bb-audit]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/docs/api_to_audit.md
[pw-renderers]: https://github.com/jmfederico/pi-web/commit/0ec82b5e
[pw-390]: https://github.com/jmfederico/pi-web/pull/390
[pw-intervention]: https://github.com/jmfederico/pi-web/commit/5b0f00b3
[pw-lifecycle]: https://github.com/jmfederico/pi-web/commit/ec645526

### 2. Make implicit contracts explicit and versioned (adapt)

**What bb does.** Every process boundary has a contract package, and the daemon wire has a
version number that must be bumped for any change to fields, requiredness, defaults or meaning.
Shared TypeScript builds "do not verify compatibility with enrolled machines; the version bump
triggers their update" ([`AGENTS.md:22`][bb-agents]). The number has reached 264, which is
evidence that the rule is actually followed.

**What Workbench does today.** Workbench extensions and the PI WEB UI share contracts that exist
only as matching strings on both sides:

- `setStatus` JSON keys, for example `pi-workbench:activity`, `pi-workbench:background-bash`,
  `working-mode` and `goal`;
- custom message types, for example `pi-workbench:child-completion`, `background-bash`,
  `atelier:*`, `pi-web.ask.answers` and `pi-web.daemon-restart`;
- the Workstream plugin API (`server-plugin.js`).

All of these are in daily use. Thirty days of logs show 2,759 child-completion messages, 1,041
background-bash messages, 793 Atelier wake messages and 43k Workstream `watch` calls in 14 days.

None of these contracts has a schema, a version or a test shared by both sides. If one side
renames a key, the UI silently stops rendering it.

**Lesson.** Collect the extension↔UI contracts into one typed, versioned module that both
extensions and the PI WEB fork import. Include a contract test that runs against both
producers and consumers.

**Destination.** A small shared contract module in this repository, used by
`extensions/*` and by the PI WEB fork.

**Evidence that would show improvement:** a deliberate rename in one side fails a test instead
of silently dropping UI.

**Keep unchanged:**

- Contracts describe presentation only and grant no authority.

### 3. Express lifecycles as data with a single guarded writer (adopt for the Run Controller)

**What bb does.**

- **Transition tables.** `THREAD_LIFECYCLE` and `ENVIRONMENT_LIFECYCLE` are declarative tables
  mapping status and event to the next status, with predicates such as `notArchived`
  ([`packages/domain/src/thread-lifecycle.ts:18-111`][bb-lifecycle]).
- **One writer.** It loads the row inside an immediate transaction, evaluates the table and
  updates `WHERE status = <loaded>`. An illegal event is a logged no-op (`illegal-transition`).
  A lost race returns `cas-conflict`
  ([`packages/db/src/data/threads.ts:2314-2388`][bb-threads-writer]), tested at
  [`thread-lifecycle.test.ts:136`][bb-cas-test].
- **Generated diagrams.** A snapshot test renders Mermaid diagrams from the tables into
  [`docs/lifecycle-diagrams.md`][bb-diagrams]
  ([`lifecycle-diagram.test.ts:112`][bb-diagram-test]), so the documentation cannot drift.

The workflows plugin applies the same discipline: every run and call transition is a guarded
`UPDATE … WHERE status IN (…)` ([`plugins/workflows/src/data.ts`][bb-wf-data]).

**What Workbench does today.** The Run Controller is unbuilt (`packages/controller` is empty).
Its lifecycle exists only as prose in the
[controller contract](../../contracts/controller.md).

**Lesson.** When the controller is built:

- define its lifecycle as a table;
- route every status write through one guarded writer;
- generate the contract's diagram from that table with a snapshot test.

The same pattern fits any smaller lifecycle that gains durable state first, such as Durable
host Chats or Worker registry entries.

**Destination.** [Controller contract](../../contracts/controller.md) and `packages/controller`.

**Evidence that would show improvement:**

- a race test produces exactly one winner;
- a changed transition fails the diagram snapshot until the documentation is regenerated.

**Keep unchanged:**

- The fixed controller lifecycle and its meaning.

[bb-lifecycle]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/packages/domain/src/thread-lifecycle.ts#L18-L111
[bb-threads-writer]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/packages/db/src/data/threads.ts#L2314-L2388
[bb-cas-test]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/packages/db/test/data/thread-lifecycle.test.ts#L136
[bb-diagrams]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/docs/lifecycle-diagrams.md
[bb-diagram-test]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/packages/domain/test/lifecycle-diagram.test.ts#L112
[bb-wf-data]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/data.ts

### 4. Typed child results with bounded repair (adapt)

**What bb does.** A workflow worker that is given an output schema receives exactly one extra
tool, `bb_workflow_result`.

- **Restricted schemas.** Only a bounded JSON Schema subset is accepted: types, properties,
  required fields, items, scalar enums, size bounds. Regex, `$ref` and combinators are rejected,
  with limits of 64 KiB, 4,096 nodes and a depth cap.
- **First result wins.** The store accepts only the first result through a compare-and-set
  where `result_json IS NULL`. An identical repeat is accepted as idempotent; a different value
  is a conflict ([`data.ts:696-722`][bb-store-result]).
- **Bounded repair.** An invalid value earns at most `MAX_REPAIR_ATTEMPTS = 2` correction turns
  ([`service.ts:92`][bb-repair]). A worker that goes idle without calling the tool has its final
  text parsed as JSON before it is corrected.
- **Tests.** `data.test.ts`, `service-policy.test.ts` and `server-harness.test.ts` cover this.

**What Workbench does today.** Subagents and Workers return free text. The lead keeps up to
`RETAINED_TEXT_MAX = 8_000` characters ([`extensions/subagent/index.ts:86`](../../../extensions/subagent/index.ts#L86)),
and a truncated result "cannot satisfy verification".

In this review, three of the four scout reports came back truncated and had to be re-read from
files. The lead also received one summary that misdescribed the code: it claimed that mismatched
replays fail as nondeterministic, which the code does not do. Checking against source caught it.

**Lesson.** Add an optional output schema to the `subagent` tool, mirroring bb's mechanism:

- one result tool;
- a restricted schema subset;
- first result wins;
- two repair turns.

The lead then receives validated structured fields instead of prose that may be truncated.

**Destination.** [`extensions/subagent/`](../../../extensions/subagent/) and
[`packages/pi-execution-adapter/`](../../../packages/pi-execution-adapter/).

**Evidence that would show improvement:** in a `scripts/pi-eval.mjs` run, schema-bound scouts
produce no truncated or unparseable results, and tokens do not increase.

**Keep unchanged:**

- Free text stays the default.
- Nothing new loads before the first message unless a schema is passed.
- Measure context with `node scripts/context-usage.mjs`.

[bb-store-result]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/data.ts#L696-L722
[bb-repair]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/service.ts#L92

### 5. Deterministic orchestration with prefix replay (experiment, for the Run Controller)

**What bb does.** The workflows plugin runs JavaScript orchestration in QuickJS.

**Sandbox.** The script has no filesystem, shell, network, imports, clock or randomness. `Date`
is removed and `Math.random` throws ([`runtime.ts:486-487`][bb-runtime-det]). Memory, stack and
per-slice time limits apply. Nested workflows stop at one level.

**Orchestration API.** The script calls `agent()`, `parallel()`, `pipeline()` and `phase()`.
Each `agent()` call spawns a hidden child thread owned by the origin thread.

**Durability.**

- Runs and calls live in plugin SQLite tables.
- On startup, `recoverInterruptedRuns` marks calls that already hold results as succeeded,
  cancels the other in-flight calls, re-queues their runs and stops their child threads
  ([`data.ts:463-495`][bb-recover]; called at [`service.ts:1645`][bb-recover-call]).
- The script then re-runs from the start.

**Replay.**

- Each call's key is a SHA-256 over:
  - the previous call's key;
  - the prompt;
  - the resolved provider, model, reasoning level and permission mode;
  - the output schema;
  - protocol version constants.

  See [`cache.ts:170-202`][bb-cachekey].
- Because each key includes the previous one, a restart, or an explicit `resumeRunId` after an
  edit, reuses the longest unchanged prefix of successful results. The first mismatch switches
  to live calls ([`service.ts:843-945`][bb-replay]).
- Replay decisions are serialised in the order calls were invoked.
- Runs written by older versions never replay.

**Coordination with retries.** Workflows answers the `provider-retry.v1.consent` RPC with
"decline" for its own workers. That keeps two retry layers from both re-running the same turn
([`server.ts:109`][bb-consent]).

**What Workbench does today.** Fan-outs are attended:

- the lead runs `subagent` calls;
- Relay legs and `compact_and_continue` run phase by phase;
- no child survives the end of the session
  ([Decision 101](../../foundation/decisions.md)).

The managed Run model leaves graph execution and recovery to an unbuilt controller.

**Lesson.**

- Chained call keys give cheap, correct resume for deterministic fan-outs. This is a concrete
  design candidate for how the Run Controller resumes Semantic Execution Graph dispatches.
- The consent handshake is a small, transferable pattern: any two retry layers must agree on
  who owns a retry. Today Pi's native retry and `lead-fallback` are ordered by Pi's settle
  boundary rather than by an explicit agreement
  ([`extensions/lead-fallback/README.md`](../../../extensions/lead-fallback/README.md)).

**Destination.** Run Controller design ([controller contract](../../contracts/controller.md)).

**What would falsify it.** If the controller already records every Dispatch outcome as an
immutable Episode, replay by key adds nothing over reading those records, so drop it.

**Keep unchanged:**

- The coordinator proposes graph changes; it never runs a script that owns side effects.
- Workflow scripts are not Workflow Contracts.

[bb-runtime-det]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/runtime.ts#L486-L487
[bb-recover]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/data.ts#L463-L495
[bb-recover-call]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/service.ts#L1645
[bb-cachekey]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/cache.ts#L170-L202
[bb-replay]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/service.ts#L843-L945
[bb-consent]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/workflows/src/server.ts#L109

### 6. Conformance tests against a fake runtime, aimed at the settlement seam (adopt)

**What bb does.** The Pi bridge is tested against a scripted fake Pi
([`plugins/provider-pi/src/bridge/fake-pi-rpc.mjs`][bb-fake-pi]) through a conformance suite
(`bridge.conformance.test.ts`). It also has focused suites for:

- settlement (`rpc-session.settlement.test.ts`, `run-settlement.test.ts`);
- interruption recovery;
- manual compaction queues;
- checkpoint forks.

bb#3792 shows exactly where such suites must be aimed:

- Pi distinguishes `agent_end` from `agent_settled`.
- Pi 1.4 adds a `"handled"` disposition to the reply for prompts that start no run.
- A host that settles on the wrong event leaves turns hanging.

**What Workbench does today.**

- The PI WEB fork settles on `agent_settled` (`src/server/sessions/piSessionService.ts:3424`,
  `:5225` at `fb674477`).
- The Durable acceptance spec `docs/acceptance/durable-chat-parity.md`, on branch
  `feat/durable-host-slice1-20261022`, has strong coverage. Examples: compaction killed at each
  barrier (AC-P053), completion wake-ups (AC-P099), Atelier delivery hooks (AC-P076),
  extension statuses (AC-P041).
- That spec has no case for an extension command that completes without starting a run.

**Lesson.** Add the settlement-seam cases bb got wrong to the Durable parity suite as explicit
acceptance criteria:

- an extension command that starts no run settles at once and leaves the Chat usable;
- an extension `triggerTurn` wake while idle starts exactly one turn;
- compaction started by an extension and then continued places exactly one summary and one
  continuation.

**Destination.** The Durable parity acceptance spec and its fleet tests.

**Evidence that would show improvement:** each case has a negative control that fails when
settlement is keyed to `agent_end`.

**Keep unchanged:**

- Durable's ownership of sessions.

[bb-fake-pi]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/provider-pi/src/bridge/fake-pi-rpc.mjs

### 7. What a Pi host must not do (adopt as invariants)

bb's Pi bridge is a useful negative example. Each item was observed in the live probe or read
in code. Each conflicts with a Workbench capability in daily use.

| bb behaviour | Evidence | Workbench capability it would break |
| --- | --- | --- |
| Drops `notify`, `setStatus` and `setWidget` | [`bridge/extension-ui.ts:14-17`][bb-ext-ui]; probe recorded 0 events | Activity roster, Working Mode and Goal chips, background-bash cards, storage and checkpoint notices |
| Runs no custom tool or message renderers; custom messages become plain text, and user-role extension messages are hidden | `delta-translation.ts:340-355`, `visibility.ts:144,327` | Child-completion and Atelier notice folding |
| Stops idle Pi processes after 30 minutes by default; "never" cannot be chosen | [`app-settings.ts:79`][bb-idle] | Subagent and Atelier wakes that arrive after a long wait |
| Passes its own `--append-system-prompt`, which replaces `~/.pi/agent/APPEND_SYSTEM.md` | [`rpc-session.ts:585`][bb-append]; probe compared prompts | The Ponytail addendum and any user addendum |
| Project extensions load only with `--approve`, because RPC mode cannot ask about trust | probe: skipped without the flag | Project-local extensions |
| Advertises no command list, and commands that start no run hang | [`bridge.ts:524`][bb-cmds]; bb#3792; probe T5 | `/mode` and other extension commands |
| Keeps a private session directory and cannot import Pi sessions | [`session-paths.ts:22`][bb-sessions]; probe T7 | Continuity with terminal Pi and existing Chats |
| Kills a turn in flight when the daemon restarts; resuming means re-prompting, behind an experiment flag that is off by default | [`experiments.ts:35`][bb-exp]; probe T6 | Durable's crash survival |
| Accepts any Pi at or above 0.84.0, with no protocol handshake | [bb#6572][bb-6572] | Safe Pi upgrades |

**Lesson.** Write these as host invariants for PI WEB and Durable:

- forward every UI method to the client;
- never replace user prompt addenda;
- never end a session while it can still be woken;
- settle on `agent_settled` or a `"handled"` disposition;
- check the Pi version against a supported range.

Several already hold in the fork. Recording them prevents regressions during the Durable port,
where `ctx.ui` dialogs already need a deliberate port.

**Destination.** The Durable parity acceptance spec and the
[execution contract](../../contracts/execution.md).

[bb-ext-ui]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/provider-pi/src/bridge/extension-ui.ts#L14-L17
[bb-idle]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/packages/domain/src/app-settings.ts#L79
[bb-append]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/provider-pi/src/bridge/rpc-session.ts#L585
[bb-cmds]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/provider-pi/src/bridge/bridge.ts#L524
[bb-sessions]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/plugins/provider-pi/src/bridge/session-paths.ts#L22
[bb-exp]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/packages/domain/src/experiments.ts#L35
[bb-6572]: https://github.com/get-bb/bb/issues/6572

### 8. Agents as first-class operators (adapt, per feature)

**What bb does.** "Every end-user feature must also be usable through the SDK and `bb` CLI"
([`AGENTS.md:26`][bb-agents]). The CLI is built on the same SDK plugins use, and plugin CLIs are
proxied through `bb`. The rule is policy, not an automated check: no test walks
routes → SDK → CLI.

**What Workbench does today.** Workstreams have typed operations and a terminal skill. Several
PI WEB-only features have no agent path: window and Tab layout, notification acknowledgement
and presentation settings.

**Lesson.** When a Workbench UI feature changes state that agents need to read or set, give it a
typed agent path at the same time. Apply this per feature, not as a universal rule. Most layout
state is legitimately UI-only.

**Destination.** The [Workbench UI plan](../../plans/workbench-ui.md) story checklist.

### 9. Smaller mechanisms

- **Item sweeps (reject for V1).** A generic periodic runner keeps a per-item failure table,
  backs off from 1 minute to 1 hour, detaches an item that hangs past 60 seconds, and yields to
  the event loop ([`apps/server/src/services/system/item-sweep.ts`][bb-sweep]). It is sound,
  but V1 has no daemon of its own. Revisit for Durable host maintenance.
- **Subscription-window retry (reject for now).** `provider-retry` waits for a known
  subscription-limit reset plus jitter, up to 6 hours. `lead-fallback` instead switches to the
  other family immediately, which suits attended work. Revisit only if unattended execution
  returns.
- **Concurrency limit (reject for V1).** A `message.dispatch` hook caps running threads
  globally and per host. It is useful only once a host schedules work. The base review page
  already lists "a limit on running agents" as missing, so treat that as a separate question.
- **Side-chat, ask-user-question, tasks, memory (reject).**
  - Side-chat and ask-user-question are covered by `/btw` and `ask_user`.
  - In the tasks plugin, the agent moves its own task to `in_review`, which is a transition
    authored by the model.
  - Memory injects a catalogue of model-written notes into every prompt; Workbench promotes
    knowledge through Learning Candidates instead.

[bb-sweep]: https://github.com/get-bb/bb/blob/55135d1e5045d6c5d3c24f5a4d5556ed3e11cb00/apps/server/src/services/system/item-sweep.ts

## Where bb is better and where Workbench is better

**bb is better at:**

- extension without forking (lesson 1);
- explicit, versioned process contracts (lesson 2);
- lifecycle discipline (lesson 3);
- typed worker results (lesson 4);
- implemented durable orchestration (lesson 5);
- breadth of maintenance, with several maintainers and high merge velocity;
- a native phone app and execution across several hosts.

**PI WEB with Durable is better at:**

- full fidelity to Pi's extension API, with one state machine;
- durability inside the agent runtime;
- a non-authoritative host that leaves the Run Controller independent;
- Workbench behaviour that stays portable across terminal Pi, PI WEB and Durable.

**Insufficient evidence:**

- how either system performs under the same real workload;
- how stable bb's plugin API will be (754 symbols still carry `experimental_`).

## Unverified

- The bb test suites were read but not run.
- bb's handling of an extension calling `newSession`, `switchSession` or `fork` was not
  exercised.
- Whether children spawned by extensions outlive Pi's shutdown under bb was not exercised.
- The live probe's T5 used a command that starts no run. A command that calls
  `sendUserMessage` may behave differently.
- Fork statistics and usage counts come from commit-subject grouping and 14–30 days of local
  logs.
- Whether the Durable fleet tests currently pass was not re-run.
