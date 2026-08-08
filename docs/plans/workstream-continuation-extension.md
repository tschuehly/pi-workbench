# Workstream continuation extension and shared session coordination plan

Status: owner-approved implementation direction for the isolated unified-shell candidate. The Store records, shared coordinator, and PI WEB compatibility adapter for existing blank launches are implemented; the server journal, explicit-location host contribution, PI WEB continuation action, terminal adapter, and terminal command remain prerequisites.

## Outcome

Let an owner continue an explicit confirmed Workstream checkpoint into a fresh attended Pi session from either PI WEB or Pi's terminal interface. Both clients use one host-neutral session-coordination module, so checkpoint eligibility, prompt construction, pending-session reconciliation, revision retries, and failure classification cannot drift.

The delivered terminal interaction is:

```text
/workstream-continue [workstream-id]
→ choose one source session and checkpoint when necessary
→ review any staleness warning
→ create a fresh attended session in the checkpoint's recorded location
→ confirm its one-home Workstream association
→ submit the owner-confirmed nextSessionPrompt
```

PI WEB exposes the same operation as **Continue in new session** beside an eligible per-session checkpoint. Existing **Resume** continues to open that same session; it must not be relabeled or implemented as checkpoint continuation. Creating the continuation does not retire the source session: both remain active until later explicit lifecycle support says otherwise.

This remains Level 1. The command is attended and owner-initiated. It creates no managed Run, background model turn, durable child, workspace lease, publication authority, or recovery guarantee beyond the existing Workstream pending-association reconciliation.

## Why one module, not a larger skill

The current behavior is split across three places:

- `packages/pi-web-integration/workstream-session-coordinator.js` owns the PI WEB pending → launch → confirmed/failed handshake and reconnect reconciliation.
- `skills/workstreams/` lets an agent manipulate the Workstream Store directly when the graphical interface is unavailable.
- Pi's extension runtime owns terminal commands and fresh-session replacement through `ctx.newSession()`.

Copying the launch handshake into the skill or a new extension would create a second lifecycle dialect. Instead, extract the reusable mechanics into a deep module. PI WEB and the Pi extension become adapters at its attended-session seam. The Workstream Store remains authoritative state; neither client writes storage directly.

Keep the skill, but narrow its role. It remains the agent-operated fallback for inspection, sparse ledger changes, and attended checkpoint drafting when richer interfaces are unavailable. Normal human continuation moves to the extension and PI WEB. The skill retains direct Store operations for unusual ledger changes, outages, and associating a pre-existing terminal session; its association request must carry a complete machine, project, and workspace location.

## Product distinctions

The implementation must preserve these meanings:

- **Resume session** opens one already-confirmed session. It creates no new association and submits no checkpoint prompt.
- **Continue checkpoint** creates a fresh attended session from one explicitly selected source session's latest confirmed checkpoint.
- A Workstream has no implicit global “latest checkpoint.” Several sessions can each have a latest confirmed checkpoint; the owner selects one unless exactly one eligible candidate exists.
- `nextSessionPrompt` is owner-confirmed continuation input. The implementation preserves it verbatim inside a bounded Workbench bootstrap envelope; it never substitutes `next`, summarizes Chat, or asks a model to reconstruct missing continuation state.
- An explicit `checkpoint.stale` record remains meaningful. Continuation may proceed only after the owner sees and accepts that exact stale checkpoint. Acceptance does not clear staleness.
- A legacy projected checkpoint whose `nextSessionPrompt` is `null` cannot be continued automatically.
- A failed or abandoned newer checkpoint attempt does not invalidate the previous confirmed checkpoint unless an explicit stale record says so.
- Closed Workstreams cannot continue. Later work starts in a new Workstream and may link the closed one.
- **Pending** is not **failed**. Any launch with an unknown runtime outcome or a created session whose confirmation cannot be recorded remains pending for reconciliation.

The first cut includes the session-derivation protocol already required by `pi-web-message-tree.md`: add `session.cancelled` and optional `derivationKind` on `session.pending`. Checkpoint continuation uses `"checkpoint"`, message-tree fork uses `"fork"`, and blank launch may omit it. The approved Phase 6 amendment later adds coordination `operationKind: "promotion"` without misclassifying promotion as session derivation. The source checkpoint remains in the same Workstream ledger, and the fresh session's initial transcript records its identifier and prompt. Add durable `continuedFromCheckpoint` provenance only after a concrete projection or audit requirement justifies it.

## Shared module seam

Create `packages/workstream-session-coordination/`. Move the reusable launch and reconciliation implementation out of `packages/pi-web-integration/workstream-session-coordinator.js`; do not layer a second coordinator around the old one.

The external interface should stay small:

```ts
interface WorkstreamSessionCoordination {
  inspectContinuation(workstreamId: string): Promise<ContinuationView>;
  launch(request: LaunchRequest): Promise<LaunchOutcome>;
  reconcile(workstreamId: string): Promise<ReconcileOutcome[]>;
}
```

`LaunchRequest` is one of:

```ts
{ kind: "blank"; workstreamId; operationId; location }

{ kind: "checkpoint"; workstreamId; operationId; selection; acceptStaleCheckpointId? }
```

`inspectContinuation` returns per-session candidates. Every ready candidate carries an opaque selection guard covering the Workstream revision, source session, checkpoint identity, prompt, staleness state, and complete location. Blocked candidates carry a stable cause such as:

- `WORKSTREAM_CLOSED`
- `SOURCE_SESSION_NOT_ACTIVE`
- `SOURCE_LOCATION_INCOMPLETE`
- `CHECKPOINT_MISSING`
- `CHECKPOINT_STALE`
- `NEXT_SESSION_PROMPT_MISSING`
Host checks can additionally return launch-time blocked causes before pending state exists:

- `HOST_LOCATION_UNAVAILABLE`
- `HOST_LOCATION_MISMATCH`

`launch` treats the guard as untrusted input, re-inspects canonical state, and validates its covered fields before appending anything. The recorded revision is display provenance; an unrelated Workstream record does not block continuation because the append uses the fresh revision. A changed checkpoint, staleness state, source location, or Workstream closure returns a typed blocked outcome rather than launching from stale UI state.

The module hides:

1. candidate classification and exact source selection;
2. fixed Workstream and Level 1 prompt framing;
3. preservation of the selected `nextSessionPrompt` verbatim;
4. one durable correlation vocabulary: caller-local `operationId`, cross-system `operationToken`, and Store `associationKey` equal to that token;
5. bounded `STALE_REVISION` retries;
6. `session.pending` before session creation;
7. `session.confirmed` only after receiving a complete runtime identity;
8. `session.cancelled` after explicit runtime cancellation proves no session was created, and `session.failed` only after server-authoritative proof of non-creation: a checked rejection or an `absent` journal result after reconnect completion;
9. idempotent confirmation by canonical inspection: an already-active association with the same operation token and session ID is success, including after response loss;
10. startup-token lookup without relaunch;
11. one-home conflict propagation from the Workstream Store;
12. producer attribution (`pi-web` or `pi-extension`) and exact per-record `sourceSessionId` semantics;
13. `STORE_BUSY` and other Store-transport errors as non-terminal causes that preserve pending state.

Keep existing-session navigation and session-anchor repair in a PI WEB-specific module for now. They do not vary across two production adapters and are not needed to execute a checkpoint prompt. Revisit extraction only when a second client needs those operations.

## Adapter seam

The shared module accepts two dependencies rather than constructing them. Its construction requires a bounded producer identity. PI WEB uses `pi-web`; the terminal extension uses `pi-extension`.

Record origin is deterministic. For terminal-owned launch-time `session.pending`, `session.cancelled`, and `session.failed`, record-level `sourceSessionId` carries the launching session ID when known; PI WEB omits it because no Pi session originated the browser action. Their payload `sessionId` is omitted. Every `session.confirmed` record carries the newly created session ID as both payload `sessionId` and record-level `sourceSessionId`, matching current PI WEB behavior. These two launch producers are additive to existing `owner` and `session` producer values.

### Workstream adapter

The module requires a reopenable `withWorkstreamClient(fn)` dependency whose callback receives only `inspect` and `append` from the typed Workstream interface. Every durable step reacquires a client, including confirmation after Pi session replacement.

- PI WEB's adapter supplies its existing plugin-service client.
- The Pi extension adapter captures only the user-local Store directory and opens `createUserLocalWorkstreamStore()` for each callback.
- deterministic tests supply an in-memory Workstream Store.

No Store handle created before `ctx.newSession()` crosses into `withSession`.

### Attended-session adapter

Use a callback-shaped adapter so the shared module can confirm a created session at the correct point in both runtimes:

```ts
interface AttendedSessionAdapter {
  checkLocation(request: {
    location: CompleteLocation;
  }): Promise<
    | { type: "ready" }
    | { type: "blocked"; cause: "HOST_LOCATION_UNAVAILABLE" | "HOST_LOCATION_MISMATCH"; reason: string }
  >;

  launch(
    request: {
      associationKey: string;
      location: CompleteLocation;
      initialPrompt: string;
      operationMarker: string;
    },
    hooks: {
      created(session: CreatedSession): Promise<void>;
    },
  ): Promise<
    | { type: "completed" }
    | { type: "cancelled"; reason: string }
    | { type: "failed"; reason: string }
    | { type: "unknown"; reason: string }
  >;

  lookup(request: {
    associationKey: string;
    location: CompleteLocation;
  }): Promise<
    | { type: "found"; session: CreatedSession }
    | { type: "cancelled"; reason: string }
    | { type: "failed"; reason: string }
    | { type: "unknown" }
  >;
}
```

The module calls `checkLocation` and returns its blocked cause before appending `session.pending`. `cancelled` requires explicit runtime cancellation with proven non-creation. `failed` requires server-authoritative proof of non-creation: a checked rejection or an `absent` journal result only after reconnect completion. Transport failure, `STORE_BUSY`, incomplete lookup, or uncertainty is `unknown` and leaves the durable association pending.

Operation tokens stored as association keys are host-namespaced (`pi-web:` and `pi-extension:`). New adapters return `unknown` for a foreign namespace. The terminal adapter also returns `unknown` when the requested location is not exactly its trusted current location. For migration, PI WEB owns legacy unprefixed `launch-*` keys; the terminal adapter reports those as foreign. Pending reconciliation runs only through the owning adapter and never lets one host declare another host's launch absent.

Prompt persistence is adapter-owned and precedes confirmation. PI WEB may preserve its existing behavior of putting the initial prompt into the session during `sessions.start`. The Pi extension uses `newSession.setup` to append the exact kickoff as the replacement session's initial user message plus a non-context operation marker before `withSession` runs. After confirmation, `withSession` sends a hidden Workstream trigger message to start the turn without duplicating the owner prompt. Recovery inspects session entries: it triggers only when the kickoff exists and no assistant turn follows it. A created but unconfirmed terminal session therefore already contains its prompt and enough local evidence to reconcile, rather than becoming an untraceable empty session.

The completed PI WEB adapter must use the server-owned operation-token journal and lookup specified by `pi-web-message-tree.md` as the single reconciliation source for new starts and forks. The current compatibility adapter still uses the legacy startup-token lookup and therefore does not satisfy this target for new continuation or fork surfaces. Journal mapping is exact: `created → found`, `cancelled → cancelled`, `failed → failed`, and `absent` after reconnect completion `→ failed`; `prepared`, pre-reconnect `absent`, and journal/header disagreement remain `unknown`. Its `checkLocation` implementation verifies explicit target-location launch support and returns a typed blocked result before any pending append when support is absent. `findByStartupToken` remains only as a migration adapter for legacy unprefixed blank-launch keys. The Pi extension adapter wraps `ctx.newSession()`. Inside `withSession`, it uses only the fresh `ReplacedSessionContext`, obtains the replacement session identity, lets the module reacquire a user-local Store through `withWorkstreamClient`, invokes `hooks.created`, and then triggers the persisted kickoff. It never reuses the old `pi`, command context, `SessionManager`, or Store handle after replacement.

## Terminal extension

Create `extensions/workstreams/` with a small command-focused interface:

- `/workstreams` — list open Workstreams and select one for inspection;
- `/workstream-continue [workstream-id]` — select and continue a confirmed checkpoint;
- `/workstream-status [workstream-id]` — inspect the mechanical projection without a model turn;
- `/workstream-recover` — after explicit confirmation, start the current replacement session's persisted but not-yet-run kickoff.

`/workstreams` and ordinary `/workstream-status` inspection perform no ledger writes and start no model turn. Pending reconciliation may append only the deterministic confirmation or failure record and still starts no model turn.

Workstream creation remains in PI WEB and the skill until the terminal extension can immediately associate or start work in the created Workstream.

Do not expose raw mutation commands for arbitrary semantic records in the first cut. The existing skill remains the deliberate fallback for less common agent-operated changes.

The continuation command must:

1. wait for the current agent to become idle;
2. inspect the requested Workstream;
3. auto-select only when exactly one candidate is ready and no warning needs a decision;
4. otherwise show a TUI selector with source-session and checkpoint summaries;
5. require confirmation for the exact stale checkpoint;
6. verify that the trusted current terminal location exactly matches the selected source location; otherwise block with guidance to run the command from that location;
7. append pending before session replacement;
8. call `ctx.newSession()` and append `session.cancelled` only when explicit cancellation proves no replacement was created; otherwise leave the association pending as `unknown`;
9. confirm the replacement session using only `ReplacedSessionContext` data and a newly opened Store;
10. during the original attended command, trigger the already-persisted kickoff after confirmation without appending the owner prompt again;
11. refuse to launch another continuation when the current session is itself an unconfirmed continuation target and direct the owner to `/workstream-recover`;
12. return immediately after replacement without touching stale extension state.

After crash recovery, deterministic reconciliation may confirm the association without a model turn. `/workstream-recover` is the separate attended surface that verifies the current session's marker and absence of a following assistant turn, asks the owner, and only then triggers the persisted kickoff.

The extension factory must not open stores, watchers, or session resources. Commands may open a local Store, but they capture only plain Store configuration across replacement and reopen it inside `withSession`. Perform no ledger mutation during `session_shutdown`. A deterministic `session_start` reconciliation pass and `/workstream-status` inspect host-namespaced pending markers without starting a model turn. Pi replacement order is `newSession.setup` → `session_start(reason: "new")` → `withSession`, so the new extension instance can see the marker before the original command confirms it. The reconciliation handler must skip `reason: "new"`; `withSession` owns immediate confirmation. It also skips `reason: "fork"`, because a branched session can copy a marker whose operation belongs to a different session identity. Later `startup`, `resume`, or `reload` events may reconcile only a marker whose recorded session identity exactly matches the current session, and canonical inspection treats an exact prior confirmation as idempotent success. Recovered kickoff execution is a separate attended action and never runs automatically from `session_start`.

## PI WEB reuse

Refactor `packages/pi-web-integration/workstream-session-coordinator.js` so its blank launch and reconciliation delegate to the shared module. Preserve a compatibility export only until every PI WEB integration caller imports the shared module or the remaining PI WEB-specific navigation/repair module and the migrated tests pass; then remove it.

Add **Continue in new session** beside each eligible checkpoint. This requires a generic PI WEB `sessions.start` contribution that accepts the durable operation token, writes it into the created session header through the shared derivation journal, and accepts and reports an explicit machine/project/workspace target. Develop that contribution in the sibling `../pi-web` fork branch `pi-workbench` after fetching both `upstream` and `origin`; never push to upstream. The action:

- uses that session and checkpoint as an explicit selection;
- shows a stale warning before launch;
- starts in the source session's complete recorded machine/project/workspace location;
- blocks and asks the owner to select that location first if the installed host cannot launch explicitly; it never launches elsewhere and records the source anchor;
- routes an incomplete source anchor to the existing typed repair flow before continuation;
- distinguishes blocked, pending, failed, and confirmed outcomes;
- selects the fresh session after confirmation;
- keeps **Resume** as the action for opening the existing session.

Place **Continue in new session** in the per-session checkpoint actions of the current Workbench composition. Preserve that action while the approved
[`pi-web-unified-shell-prototype-fidelity.md`](pi-web-unified-shell-prototype-fidelity.md) migrates the composition; do not create a parallel Workstream surface.

PI WEB must continue to use typed plugin transport. The shared module must contain no DOM, Lit, PI WEB route, TUI, Node filesystem, or machine-local path assumptions.

## Relationship to message-tree derivation

`pi-web-message-tree.md` remains authoritative for fork-from-entry semantics, the server-owned derivation journal, and truthful cancellation outcomes. This plan owns the shared module placement. Fork, blank launch, checkpoint continuation, and promotion must not ship separate coordinators. The first three are launch kinds; promotion is a no-launch operation kind over the existing native session. All use one operation-token journal and shared pending/confirmed/cancelled/known-failed/unknown reconciliation vocabulary.

The common outcome table is:

| Runtime evidence | Workstream transition |
| --- | --- |
| Created session with complete identity | `session.pending` → `session.confirmed` |
| Explicit cancellation proves non-creation | `session.pending` → `session.cancelled` |
| Checked rejection, or authoritative `absent` after reconnect completion, proves non-creation | `session.pending` → `session.failed` |
| Response loss, Store contention, transport failure, or unknown runtime outcome | remain `session.pending` |

The server-owned journal will be the reconciliation source for new PI WEB derivations. `findByStartupToken` is retained only for legacy blank-launch pendings. A future terminal adapter must use its durable session marker and exact location instead of claiming access to the PI WEB journal.

## Delivery sequence

### 0. Prove both host paths

Before designing around assumptions, record bounded probes for:

1. whether PI WEB can start a session at an explicit source checkpoint location rather than only its currently selected location;
2. the exact replacement session ID and persisted file availability inside Pi `newSession({ setup, withSession })`;
3. whether `SessionManager.appendMessage()` and `appendCustomEntry()` in `newSession.setup` flush the kickoff and marker before `withSession`, given current persistence may defer disk creation until an assistant message; whether they survive a crash at each replacement point; and whether a generic Pi session-initialization flush is required;
4. how the terminal adapter obtains a trusted `machineId`, `projectId`, and `workspaceId` instead of inferring them from `cwd`, and how it blocks same-machine workspace mismatch;
5. cancellation before and after replacement creation;
6. whether PI WEB can open a terminal-created confirmed session at the recorded location;
7. whether host-namespaced operation markers support deterministic reconciliation after each crash point;
8. `FileWorkstreamAdapter` behavior when a terminal process dies while holding `.workstreams.lock`;
9. PI WEB `watch` polling and terminal append contention within the configured lock timeout.

If the terminal cannot flush the initialized replacement session before `withSession`, obtain a trusted complete location, match the current location, open the resulting session from PI WEB, or reconcile a replacement operation token, ship the shared module and PI WEB continuation first. A failed persistence probe requires a generic Pi session-initialization flush contribution and tests before the terminal adapter; do not fake recovery by triggering a model turn or weakening anchor requirements.

### 1. Align authority, protocol, and the shared module

1. Reconcile this plan with `pi-web-message-tree.md`: make `packages/workstream-session-coordination/` own blank launch, checkpoint continuation, fork derivation, and the approved promotion handshake; use `operationId` only for caller-local duplicate suppression, one durable `operationToken` as the Store association key and server/session correlation token, and one server-owned PI WEB derivation journal for new operations. Update both plans together when this shared interface changes.
2. Add `session.cancelled` and optional `session.pending.derivationKind` (`checkpoint` or `fork`) to Store declarations, validation, reducer, fixtures, fake client, and conformance tests. Reserve promotion's distinct no-launch operation kind for the Phase 6 atomic-create amendment.
3. Update `docs/contracts/workstreams.md` to define owner-initiated fresh-session continuation without clearing staleness; make launch and reconciliation host-neutral; define operation-token ownership and legacy-key migration; add `pi-web` and `pi-extension` to—not instead of—`owner` and `session` producers; and specify exact record-level source-session rules while launch-time payload `sessionId` remains absent.
4. Update `docs/contracts/interfaces.md` to add continuation, its blocked causes, stale-checkpoint confirmation, and placement in the existing Workstream surface and PI WEB controls.
5. Record the shared host-neutral session-derivation decision and its relationship to PI WEB in `docs/foundation/decisions.md`.
6. Update `docs/contracts/harness.md` and `AGENTS.md` while preserving PI WEB as the complete supported graphical surface. In the harness contract, define the terminal extension as an additional attended interface. Route Workstream work through `packages/workstream-store/`, `packages/workstream-session-coordination/`, `extensions/workstreams/`, and `skills/workstreams/`.
7. Consume the reviewed `workstream-store-lock-recovery-experiment.md` commit before adding a second writer: use its permanent legacy-exclusion marker plus non-blocking OS-released transaction coordinator; do not add PID/age takeover or a second lock protocol.
8. Add package metadata, declarations, typed errors/outcomes, and in-memory tests.
9. Implement candidate inspection and guarded checkpoint selection.
10. Implement blank and checkpoint prompt construction.
11. Port pending, confirmation, cancellation, known failure, revision retry, Store-contention handling, and host-owned reconciliation from the PI WEB coordinator and message-tree design.
12. Add producer attribution and exact source-session rules.
13. Preserve Store transport errors and unknown runtime outcomes as pending.
14. Test entirely through the module interface.

### 2. Migrate PI WEB coordination

This phase depends on the generic derivation journal and coordinator contribution from message-tree phases 1–2, including journal-enabled `sessions.start`, landing in the sibling PI WEB fork first.

1. Add PI WEB Workstream and attended-session adapters over the shared operation-token journal and lookup.
2. Route current blank launch and reconnect reconciliation through the shared module.
3. Preserve supported behavior except the current untruthful failure classification: split `packages/pi-web-integration/test/projection.test.js` launch failure coverage into a checked rejection that records `session.failed` and an unproven transport exception that remains `session.pending`.
4. Keep the migrated suite passing before adding continuation UI, then delete replaced launch/reconciliation implementation and tests that reach behind the new seam.

### 3. Add PI WEB checkpoint continuation

1. Add candidate projection and **Continue in new session**.
2. Handle multiple candidates, staleness confirmation, missing prompt, incomplete anchor, and closed state.
3. Start at the explicit source location and select the confirmed fresh session.
4. Verify browser restart and confirmation-response-loss reconciliation without duplicate sessions.

### 4. Add the Pi terminal extension

Proceed only after phase 0 proves complete identity and reconciliation.

1. Implement the local Store and `ctx.newSession()` adapters.
2. Add the four commands and compact TUI selection/status rendering, including the dedicated attended recovery command.
3. Persist the kickoff as the initial user message and a bounded non-context operation marker through `SessionManager.appendCustomEntry()` for reconciliation and duplicate-safe turn triggering.
4. Reconcile terminal-owned pending launches on deterministic `session_start` and status paths without triggering the model; expose an attended confirmation to trigger an undelivered recovered kickoff.
5. Verify old-context and old-Store invalidation plus post-replacement prompt submission.
6. Verify PI WEB can open the resulting confirmed session.
7. Add dedicated test scripts for the extension and shared module to the root `npm test` aggregate, and document installation/reload behavior.

### 5. Narrow the skill

1. Remove any implication that the skill is the preferred human continuation interface.
2. Direct normal create, inspect, and continue actions to extension commands when they are available.
3. Keep the direct CLI workflow for PI WEB/extension outages, unusual semantic ledger changes, associating a pre-existing terminal session, and attended checkpoint drafting.
4. Preserve association-conflict checks and require complete location fields in the association recipe; never teach the skill to launch a new session by manually appending around the shared module.

### 6. Verify the complete workflow

Run the Store, shared-module, extension, and PI WEB suites, then record real attended evidence:

```text
checkpoint in session A
→ continue from A in PI WEB
→ fresh session B confirmed in the same Workstream
→ checkpoint in B
→ continue from B in Pi TUI
→ fresh session C confirmed
→ restart clients
→ no duplicate or orphaned associations
```

## Verification matrix

Automated coverage must include:

- one eligible checkpoint and several eligible checkpoints;
- missing checkpoint, legacy null prompt, explicit staleness, failed checkpoint attempt, closed Workstream, inactive source, and incomplete source location;
- changed checkpoint or source location after candidate inspection;
- pending accepted before adapter launch;
- complete created identity confirmed exactly once;
- explicit runtime cancellation before creation producing `session.cancelled`;
- checked precondition rejection producing `session.failed`;
- unknown launch outcome;
- process or client loss after creation but before confirmation;
- confirmation accepted with response loss;
- bounded stale-revision retries;
- concurrent PI WEB watch and terminal append contention;
- `STORE_BUSY` during confirmation preserving pending state;
- abandoned-lock detection, safe takeover, and successor-lock ownership;
- one-home conflict;
- duplicate clicks and exact retries;
- reconciliation that never relaunches;
- prompt envelope preserving a maximum-length `nextSessionPrompt` byte-for-byte;
- no continuation-side checkpoint record and no clearing of checkpoint staleness;
- recorded fresh-session location exactly matching its runtime and selected source location;
- new host-namespaced and legacy unprefixed PI WEB pending keys, including foreign-host `unknown` behavior;
- reconciliation by both owning clients without a model turn and attended triggering of recovered kickoff;
- `session_start(reason: "new")` seeing the marker but skipping reconciliation, followed by one successful `withSession` confirmation;
- `session_start(reason: "fork")` ignoring a copied marker with a different session identity;
- later `startup`, `resume`, or `reload` reconciliation plus canonical idempotent confirmation producing exactly one confirmed association and no error;
- no same-process re-entrant Store acquisition during replacement;
- exact producer and per-record `sourceSessionId` values, with launch-time payload `sessionId` omitted;
- terminal lookup at a foreign location returning `unknown`;
- Pi old-context and old-Store invalidation after `ctx.newSession()`;
- PI WEB explicit source-location launch and opening a terminal-created session;
- typed blocked presentation when the installed PI WEB host lacks explicit-location start support.

## Explicit deferrals

- automatic continuation without an owner action;
- choosing among several checkpoints with a model turn;
- synthesizing a prompt for legacy checkpoints;
- clearing checkpoint staleness as a side effect of continuation;
- durable `continuedFromCheckpoint` schema fields beyond the shared `derivationKind` without a proven projection need;
- cross-location terminal continuation without a trusted host adapter;
- background or unattended sessions;
- managed Run continuation, authority, retries, or recovery;
- replacing PI WEB's graphical Workstream surface with TUI extension UI;
- removing the Workstream skill entirely.

## Completion criteria

The work is complete when PI WEB and Pi TUI both invoke the same shared continuation module; an owner can select one confirmed checkpoint and enter a fresh attended session with its exact prompt; every created session has one confirmed Workstream home or a truthfully pending reconciliation state; existing blank launch, resume, anchor repair, checkpoint, and closure behavior remains intact; and the skill contains no competing session-launch implementation.
