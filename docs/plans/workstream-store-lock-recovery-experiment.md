# Workstream Store lock recovery experiment

Status: approved revised experiment plan; implementation not started. Independent review rejected the earlier replaceable active-lock design because POSIX path operations provide no compare-and-swap: a delayed stale-owner rename can displace a live successor. This plan uses an OS-released SQLite transaction lock instead.

## Outcome

Harden the user-local `FileWorkstreamAdapter` so a crashed writer cannot orphan the Store and concurrent PI WEB/terminal access remains bounded. Keep Workstream state in atomically replaced `workstreams.json`; SQLite is only a local process-lock coordinator and stores no Workstream records.

The experiment passes only if deterministic child-process tests prove mutual exclusion, process-death recovery, mixed-version exclusion, bounded contention, and unchanged JSON projections. Otherwise it ends with a precise failure result rather than weakening fail-closed behavior.

## Scope and workspace

Change only:

- `packages/workstream-store/` implementation, declarations, tests, and package documentation;
- `docs/plans/workstream-store-lock-recovery-experiment.md` for verified findings.

Execution is attended in a dedicated experiment worktree (for example `exp/workstream-store-lock-recovery`); no execution may use `main`, a normal Store, or another run's workspace. Commit `packages/workstream-store/test/fixtures/lock-owner-child.mjs` for continuation probes to consume by exact commit.

## Current failure and rejected approach

The current adapter creates `.workstreams.lock` as an anonymous directory and removes it in `finally`. Process death leaves the directory forever. Naive stale takeover is unsafe: observation and `rename`/`unlink` are separate operations, so a delayed contender can remove a successor.

Do not implement metadata takeover of a replaceable active path. A discriminating Node `DatabaseSync` probe must first show that zero-timeout `BEGIN IMMEDIATE` returns SQLite code 5 immediately, an async retry keeps the event loop responsive, and killing the owner releases the lock.

## Protocol

### Permanent mixed-version marker

Reserve `.workstreams.lock` permanently as a marker **directory** containing atomically written `protocol.json`:

```json
{"formatVersion":1,"protocol":"sqlite-transaction-lock"}
```

Initialization or attended migration first wins the legacy protocol's own atomic `mkdir('.workstreams.lock')`, then writes the marker inside that same directory and never executes the legacy `finally`. There is no remove/recreate window. A live legacy transaction wins `mkdir` first and blocks migration; after marker completion every old adapter's `mkdir` fails, so it cannot enter the `finally` that recursively removes the marker. The new adapter never auto-converts an existing empty directory, because emptiness is only a shape fact and proves no liveness.

A crash after marker-directory creation but before `protocol.json` leaves fail-closed `initializing.json`. Automatic reconciliation is construction-scoped: only the deterministic run supervisor that created a fresh owned root, supplied that exact operation token, retained the child handle, and observed that child exit may finish it. A foreign token, pre-existing/user Store, missing exit observation, or ambiguity fails closed to attended migration; PID or age is never proof. A symlink, malformed marker, or IO ambiguity fails closed.

### OS-released transaction lock

Use Node's `node:sqlite` `DatabaseSync` against `.workstreams-lock.sqlite`:

1. verify/install the permanent marker;
2. open the lock database with SQLite busy timeout zero;
3. attempt `BEGIN IMMEDIATE`; on SQLite code 5, close that handle, yield through the adapter's async retry/sleep seam, and retry until `lockTimeoutMs`;
4. perform the current atomic JSON read/projection/write behavior only after acquisition;
5. `COMMIT` on success or `ROLLBACK` on failure, then close in `finally`.

SQLite's OS lock, not PID, age, descriptor inspection, or model judgment, owns liveness. Process exit releases it. Code 5 maps to `STORE_BUSY`; each synchronous attempt must return immediately, and the async loop keeps timers/HTTP/WebSockets responsive. Require Node >=24.13.0 in root and package `engines`, probe that floor (accepting its explicit experimental-SQLite warning), and add `LOCK_COORDINATOR_UNAVAILABLE` for missing `node:sqlite`/unsupported locking rather than calling intact JSON corrupt. Malformed marker/database content retains the Store corruption boundary. Never fall back to the anonymous-directory protocol.

Preserve cross-process exclusion for reads and writes. Do not move Workstream content into SQLite, add a daemon, inspect/signal unrelated processes, or infer safety from elapsed age.

### Legacy attended repair

An unmarked legacy directory returns `STORE_BUSY` with attended-migration guidance. The package-local command requires explicit confirmation that PI WEB and terminal writers are stopped, verifies directory shape (not liveness), writes `initializing.json`, then atomically installs `protocol.json` inside the same directory. It does not rename or remove the directory. An idle old writer cannot be disproved mechanically; authority comes from attended stop confirmation. The experiment exercises this only in temporary fixtures.

## Delivery sequence

### Phase 0 — Red evidence and SQLite probe

1. Add a child fixture that exits while owning the current directory lock and prove a successor reaches `STORE_BUSY`.
2. Add a deterministic race test demonstrating successor displacement in the rejected rename-takeover design.
3. Probe `DatabaseSync` contention and owner death in a temporary directory using a real Node 24.13.x binary; the receipt records actual `process.version`, attempts, elapsed time, timer responsiveness, and post-death acquisition.

Exit: current orphaning is red, unsafe rename takeover is reproduced, and the replacement primitive recovers after process death.

### Phase 1 — Marker and coordinator seam

1. Add pure marker validation and temporary-root tests.
2. Add fresh-root marker initialization and attended in-place migration with crash reconciliation.
3. Add an injected lock-coordinator interface; production uses `DatabaseSync`, tests may use deterministic fakes.
4. Add optional `lockTimeoutMs`, async retry interval, Node >=24.13.0 engines, capability preflight, and typed unavailable error; update declarations.

Exit: old and new acquisition cannot both enter, and malformed/unsupported storage fails closed.

### Phase 2 — Transaction integration

1. Acquire `BEGIN IMMEDIATE` before every adapter transaction, including reads.
2. Map SQLite code 5 through zero-timeout attempts and async sleeps to `STORE_BUSY` within `lockTimeoutMs` plus one retry-interval tolerance. Assert a 25 ms timer fires during a contended wait.
3. Preserve the original transaction error if rollback/close also fails; attach cleanup diagnostics without masking outcome.
4. Keep JSON temporary-file sync and atomic rename unchanged.

Exit: one contender enters, losers return within bounds, and process death requires no stale-file mutation.

### Phase 3 — Legacy repair

Implement and test the attended in-place migration command. The empty-directory check is a shape guard only. It never removes or renames the lock directory, valid markers, SQLite files, unknown paths, or active user state.

Exit: migration holds the legacy exclusion path continuously and old/new protocols cannot enter together.

### Phase 4 — Crash and contention matrix

Use bounded child processes for:

1. crash after marker-directory `mkdir`, during marker write, and after marker completion;
2. malformed marker, symlink, unmarked legacy directory, unavailable SQLite, and unsupported locking;
3. live owner exceeding contender timeout;
4. owner exit during JSON read;
5. owner exit before and after JSON rename;
6. immediate successor acquisition after owner death;
7. two and ten simultaneous contenders;
8. legacy holder blocks migration; after in-place migration an old adapter cannot acquire and therefore cannot reach its `finally`;
9. concurrent PI WEB-style watch and terminal-style append loops;
10. two adapters in one process while a timer/HTTP-style callback remains responsive;
11. read/write exclusion and complete-old-or-complete-new JSON observations;
12. interrupted SQLite journal recovery;
13. same-run token plus observed child-exit initialization recovery, and refusal of foreign token/PID/age-only recovery;
14. attended migration confirmation and refusal cases;
15. Node-floor capability and `LOCK_COORDINATOR_UNAVAILABLE` mapping.

After every case validate `workstreams.json`, prove at most one callback entered the critical section, and inventory marker initialization, database/journal, legacy evidence, and JSON temporaries.

### Phase 5 — Compatibility and promotion judgment

1. Run package and root aggregate suites.
2. Verify constructor/factory declarations, defaults, root/package Node >=24.13.0 engines, and startup capability diagnostics.
3. Verify marker/SQLite files contain no credentials, Workstream content, machine paths, or generated Run state.
4. Measure at least 1,000 uncontended temporary-directory transactions. Block promotion if median added overhead exceeds 2 ms; record the legacy ratio as evidence, not a second gate.
5. Record exact commit and reusable fixture path for continuation probes.

Exit: independent review finds no simultaneous owner, indefinite new-format orphan, unsafe legacy transition, unbounded timeout, or database-corruption path.

## Verification

```sh
npm run test:workstream-store
npm test
git diff --check
```

Tests use `mkdtemp()`, bounded deadlines, and retained paths only on failure. No test targets `~/.pi-workbench`.

## Safety properties

- process death releases the transaction lock without deleting a path;
- a live owner is never displaced;
- every contender acquires or receives `STORE_BUSY` within bounds;
- in-place marker migration continuously excludes old adapters, and old/new protocols cannot enter together;
- reads and writes retain cross-process exclusion;
- JSON replacement remains atomic across crashes;
- malformed, unsupported, foreign, or ambiguous state fails closed;
- initialization reconciliation and legacy migration mutate only proven temporary/confirmed paths.

## Worker assignment and supervision

One bounded implementation worker may own this package in the run worktree. Require red tests before production changes. The lead inspects the primitive probe, marker transition, error mapping, crash matrix, performance evidence, and final diff. Pause on any live-owner displacement, operation outside the temporary root, or fallback to age/PID-based takeover.

The experiment is complete when the reusable fixture and candidate are committed, focused and aggregate tests pass, measured overhead is within the absolute budget, the worktree is clean, and independent cross-family review reports no blocker/high finding.
