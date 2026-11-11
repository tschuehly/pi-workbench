# Workstream Store lock recovery experiment

**Status: NEGATIVE experiment; BLOCKED at Phase 2 (2026-10-21). Do not merge or promote.** The original package acceptance run passed 88/89: P2-BOUND measured **165.725 ms > the unchanged 120 ms acquisition limit**. Later 89/89 runs do not erase that failure. Its historical cause remains unestablished. Candidate code is retained only as an experimental draft, not production-ready; the complete successful outcome cannot be claimed. Phases 3–5 were not implemented or run.

Phase 0 evidence and independently approved Phase 1 remediation remain useful but do not establish Phase 2 acceptance. Final independent review approves only a negative-experiment draft, not successful acceptance. Independent review rejected the earlier replaceable active-lock design because a delayed stale-owner rename can displace a live successor. The retained candidate instead uses an OS-released SQLite transaction lock.

## Final negative judgment and criteria

| Criterion | Status | Evidence and limit |
| --- | --- | --- |
| Baseline orphan defect remains red | **PROVEN negative control** | Frozen legacy owner killed; actual exit observed; successor returns `STORE_BUSY`, callback excluded, orphan directory remains. Passing test proves the defect, not repair. |
| Rejected stale-rename takeover is unsafe | **PROVEN negative control** | Barrier-controlled displacement produces **2 simultaneous owners**; never candidate behavior. |
| Actual SQLite lock recovery after process death | **PROVEN, representative cases** | Real child `SIGKILL`/exit followed by fresh acquisition without deleting marker/DB paths. This is not genuine interrupted hot-journal recovery. |
| Marker validation and mixed-version exclusion | **PARTIAL / full criterion UNVERIFIED** | Focused permanent-marker, legacy refusal, initialization and supervisor assertions pass. Attended migration CLI, interrupted migration and complete mixed-version matrix are unrun. |
| Bounded contention after dequeue | **FAILED — P2-BOUND** | Original package **165.725 > 120 ms**. Fake-clock/focused passes and later package 89/89 are counterevidence only. Historical attribution is unestablished. |
| JSON behavior and representative failure preservation | **PARTIAL / full criterion UNVERIFIED** | Existing contract/cache tests and Phase 2 representative old/new JSON, callback isolation, cleanup precedence and exact-retry assertions pass. Full crash/compatibility matrix is unrun. |
| Attended migration CLI | **NOT RUN / UNVERIFIED** | Phase 3 not implemented. Internal in-place completion is not a delivered migration command. |
| Full real-child crash/contention matrix and genuine hot journal | **NOT RUN / UNVERIFIED** | Phase 4 and five repeated matrix runs not performed; representative owner-death cases do not substitute. |
| Service/CLI compatibility and error propagation matrix | **NOT RUN / UNVERIFIED** | Phase 5 not performed; adapter-level injections alone do not establish caller integration. |
| Root aggregate and dual-runtime acceptance | **NOT RUN / UNVERIFIED** | No root `npm test` acceptance or complete floor/PATH-runtime matrix. |
| Performance: >=1,000 samples/variant/operation, <=2 ms added median | **NOT RUN / UNVERIFIED** | No benchmark or three-run stability evidence; no performance claim. |
| Final independent diff judgment | **APPROVE — scoped NEGATIVE-EXPERIMENT DRAFT ONLY** | Independent Opus xhigh receipt `execution824dc85a-ab09-48c2-a55f-90a716ae8028`; no blocker/high. This is not Phase 2 acceptance or permission to merge, promote, install or use a live Store. |

**Recommendation:** deliver a precise negative-result draft, retain candidate source/tests and reusable evidence, and do not merge, promote, install or use it on a live Store. Continuation requires a **new approved timing design** addressing algorithmic acquisition budget versus externally delayed wall-clock completion; do not raise thresholds, move the deadline later, serialize the harness or accept a flake. No design decision is needed to finish this negative report. **Compatibility consequence:** the first candidate operation on an unmarked legacy Store permanently installs the marker, blocking installed legacy PI WEB/CLI with `STORE_BUSY`. The Phase 3 attended migration/rollback tool is absent; a crash during initialization may leave an unrepaired Store. Do not try this candidate on a live Store.

### Final independent review and residual findings

- **Plan judge: APPROVE**, independent `anthropic/claude-opus-5-5:xhigh`, receipt `executionafe19651-e5bd-4b7d-bd31-34b0dca57bdf`. Approved plan SHA256: `43483ab1455fccf93c878bfb35f33d631bdfb233f5116f3cb263298ab403f062`; external sprint artifact `plans/pi-workbench-store-lock-recovery.md` (full path in the external PR body).
- **Final diff judge: APPROVE — scoped NEGATIVE-EXPERIMENT DRAFT ONLY**, independent `anthropic/claude-opus-5-5:xhigh` reviewing the Sol-authored candidate, receipt `execution824dc85a-ab09-48c2-a55f-90a716ae8028`. No blocker/high; never merge, promote, install or use on a live Store. Both receipts are coordinator-supplied execution evidence, not assumed receipt files.
- Reviewed **20-file** SHA256: `cd5726c486e5429bf4d84276c1cd85c255759a28905de14d59a955b4a2bd177f`. Reviewed **19-file** SHA256 excluding this findings document: `fec068727b18ec5f4d1bf5d40261ffa72369dd6489f605cd08cb212257c8022c`. Each hashes sorted repository path + NUL + exact file bytes + NUL. The 20-file identity precedes these final documentation-only notes; the 19-file candidate identity is preserved.
- **MEDIUM 1 — residual error-contract regression:** `readTrustedDatabase` / `readDatabase` in `packages/workstream-store/src/adapters.js` now preserve raw non-`ENOENT` IO errors (`EACCES`, `EIO`, `ELOOP`) rather than baseline typed `CORRUPT_STORE`. The service may throw instead of returning a typed envelope; CLI reports `CLI_ERROR`. This fails closed with no callback or JSON mutation, but caller compatibility is unverified. Record the risk; do not fix code on this failed branch.
- **MEDIUM 2 — irreversible compatibility transition without delivered repair tooling:** the first candidate operation on an unmarked legacy Store permanently installs the marker and blocks installed legacy PI WEB/CLI with `STORE_BUSY`. Phase 3 migration/rollback tooling is absent; interrupted initialization may leave an unrepaired Store. This is a reason to retain a draft only, not a request to run migration.
- **LOW 3 — review receipt completion:** final-review placeholders are replaced by this qualified verdict and full reviewed identities. Only the coordinator's single scope-only checkpoint and external fixture revision anchor remain; no self-referential commit ID belongs here.

### Verification summary and retained artifacts

- Original Phase 2 floor-runtime checks: per-file **31 + 10 + 4 + 3 + 12 + 12 + 17 = 89** tests all passed separately; focused **41/41**. First package acceptance **88/89**, exit 1, one failure, zero cancelled/skipped/todo. All timing criteria remain unchanged.
- Coordinator independently reran package once: **89/89**, zero failures/skips/todos; package busy **100.874 ms**, timer **24.653 ms**, post-death recovery **1.372 ms**. Its separate transaction run was **17/17**, busy **101.085 ms**, timer **25.915 ms**, recovery **1.325 ms**. Neither replaces the original failure.
- Predeclared leaf diagnosis on official **Node v24.13.0, Darwin arm64**: D1 diagnostic **2/2**, D2 instrumented/default-parallel package **89/89**, D3 diagnostic **1/1**. D3 deliberately detects **245.200 > 120 ms**, callback 0; requested 80 ms stall actually **152.377 ms**. This supports a wall-clock limitation, not historical causation or candidate acceptance.
- Coordinator additionally reports an independent controlled scheduler diagnostic on **v24.13.0**: diagnostic **1/1**, actual acquisition **171.829 > 120 ms**, timer **25.000 ms**, controlled stall **81.021 ms**, callback **0**, safe successor. This is attributed coordinator evidence, not a report-finalizer execution. It independently supports the limitation; it does not establish the historical cause.
- Retain frozen `packages/workstream-store/test/fixtures/legacy-adapters.js`, reusable `test/fixtures/lock-owner-child.mjs`, test-only construction supervisor, lock suites and opt-in diagnosis/timing fixtures (test paths package-relative). Preserve the experimental candidate unchanged.
- Retain external `p2-bound-diagnosis/` receipts: original failure logs, coordinator counterevidence, D1/D2/D3 logs, summary, exit/cleanup inventories and diagnostic identity. The draft PR body locates external receipts; no Store data/runtime downloads belong in Git. Detailed historical receipts follow below.
- Exact reusable-fixture revision is **pending the coordinator's final scope-only checkpoint**. Record that final commit plus `packages/workstream-store/test/fixtures/lock-owner-child.mjs` in the external PR body after committing; do not add a self-referential commit ID here or make a second commit just for that ID. This report finalization makes no commit or publication.

The remaining protocol/delivery sections are the original success requirements and historical evidence, **not authorization to resume Phases 3–5 or a claim those requirements were met**.

## Outcome

Harden the user-local `FileWorkstreamAdapter` so a crashed writer cannot orphan the Store and concurrent PI WEB/terminal access remains bounded. Keep Workstream state in atomically replaced `workstreams.json`; SQLite is only a local process-lock coordinator and stores no Workstream records.

The experiment passes only if deterministic child-process tests prove mutual exclusion, process-death recovery, mixed-version exclusion, bounded contention, and unchanged JSON projections. Otherwise it ends with a precise failure result rather than weakening fail-closed behavior.

## Scope and workspace

Change only:

- `packages/workstream-store/` implementation, declarations, tests, and package documentation;
- `docs/plans/workstream-store-lock-recovery-experiment.md` for verified findings.

Execution is attended in a dedicated experiment worktree (for example `exp/workstream-store-lock-recovery`); no execution may use `main`, a normal Store, or another run's workspace. Commit `packages/workstream-store/test/fixtures/lock-owner-child.mjs` for continuation probes to consume by exact commit.

## Baseline failure and rejected approach

The frozen baseline adapter creates `.workstreams.lock` as an anonymous directory and removes it in `finally`. Process death leaves the directory forever. Naive stale takeover is unsafe: observation and `rename`/`unlink` are separate operations, so a delayed contender can remove a successor.

Do not implement metadata takeover of a replaceable active path. A discriminating Node `DatabaseSync` probe must first show that zero-timeout `BEGIN IMMEDIATE` returns SQLite code 5 immediately, an async retry keeps the event loop responsive, and killing the owner releases the lock.

## Protocol

### Permanent mixed-version marker

Reserve `.workstreams.lock` permanently as a marker **directory** containing atomically written `protocol.json`:

```json
{"formatVersion":1,"protocol":"sqlite-transaction-lock"}
```

Initialization or attended migration first wins the legacy protocol's own atomic `mkdir('.workstreams.lock')`, then writes the marker inside that same directory and never executes the legacy `finally`. There is no remove/recreate window. A live legacy transaction wins `mkdir` first and blocks migration; after marker completion every old adapter's `mkdir` fails, so it cannot enter the `finally` that recursively removes the marker. The new adapter never auto-converts an existing empty directory, because emptiness is only a shape fact and proves no liveness.

A crash after marker-directory creation but before `protocol.json` leaves fail-closed incomplete state; `initializing.json` may be absent or partial, not necessarily complete. Empty/partial state cannot authorize automatic recovery. Automatic reconciliation of complete matching metadata is construction-scoped: only the deterministic run supervisor that created a fresh owned root, supplied that exact operation token, retained the child handle, and observed that child exit may finish it. A foreign token, pre-existing/user Store, missing exit observation, or ambiguity fails closed to attended migration; PID or age is never proof. A symlink, malformed marker, or IO ambiguity fails closed.

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

#### Phase 0 verified findings — 2026-10-21

Only test code and this findings section changed. The passing assertions preserve **red evidence of the current defect**, not a repaired adapter. No production code, declarations, engines, migration command, marker, or coordinator integration changed; no commit or publication was made.

Evidence paths:

- `packages/workstream-store/test/fixtures/lock-owner-child.mjs`: reusable IPC fixture, `legacy` and `sqlite` modes. Reports acquisition from inside the critical section, waits for parent release, or is killed through its retained child handle. A child watchdog exits after 8 seconds; the parent kills after 5 seconds; each test has a 10-second deadline. These are plain Node fixture processes, not Pi executions or delegated workers; no child Pi process was started.
- `packages/workstream-store/test/lock-recovery.test.js`: three executable evidence tests. Requires an explicitly isolated root strictly below `PI_TMP`, with `TMPDIR` equal to that root. Each case creates its own `mkdtemp` directory, awaits child teardown before deleting it, inventories artifacts, and verifies byte-identical, parseable `workstreams.json`.

Verified on the official **Node v24.13.0**, Darwin arm64 archive, checked against its published `SHASUMS256.txt`. The actual `process.version` was `v24.13.0` in parent and children; `process.execPath` was `$PI_TMP/store-lock-phase0-runtime-IWNOtU/node-v24.13.0-darwin-arm64/bin/node` (environment-relative notation, not a persistent runtime dependency). Node's explicit experimental-SQLite warning was emitted and accepted.

Representative package-suite receipt:

| Exit criterion | Measured result |
| --- | --- |
| Current orphaning remains red | Kill the confirmed legacy owner with `SIGKILL`, observe its exit, then attempt an adapter transaction with `lockTimeoutMs: 80`. Result: `STORE_BUSY` after **88.614 ms**, callback never entered; `.workstreams.lock` remained. |
| Rejected rename is unsafe | Barrier-controlled stale observation → another contender's cleanup → confirmed live successor → delayed rename. The renamed inode matched the live successor's inode; a third child entered while the successor was still inside its callback: **2 simultaneous owners**. This is deliberately rejected test-only code, never a candidate production implementation. |
| SQLite releases on death | `PRAGMA busy_timeout = 0`; **14** contended `BEGIN IMMEDIATE` attempts all returned `ERR_SQLITE_ERROR`, numeric `errcode: 5`. Whole-attempt timings (open, PRAGMA verification, failure, excluding close), ms: **0.884, 1.066, 0.579, 0.395, 0.212, 0.430, 0.640, 0.342, 0.203, 0.274, 0.438, 0.276, 0.290, 0.401**. Contention loop: **182.031 ms**; requested 25 ms timer fired at **31.743 ms**. After confirmed `SIGKILL` exit, a fresh handle acquired and committed in **1.036 ms**, without deleting/renaming any SQLite file. |

After the SQLite probe, only `.workstreams-lock.sqlite` and the original `workstreams.json` remained. Orphan and rename cases retained exactly their expected lock/displacement evidence until fixture cleanup. All three cases preserved JSON bytes. Five focused runs (3/3 each) and three package-suite runs (44/44 each) passed, including executing the rerun block below verbatim. Across those eight runs: 9–17 busy attempts, maximum whole synchronous attempt **41.706 ms** (including open/PRAGMA and scheduler delay), timer **25.049–54.438 ms**, post-death acquisition **0.669–9.594 ms**. These are local observations, not latency guarantees; checks require attempts/recovery below 100 ms, the 25 ms timer below 125 ms, and the contention loop below 500 ms. Both new files passed `node --check`; `git diff --check` passed. All experiment directories, downloaded runtime files, and child processes were cleaned after verification.

Independent rerun from this development worktree (macOS arm64; a fresh owned root also holds the downloaded runtime):

```sh
set -eu
ROOT=$(mktemp -d "${PI_TMP:?PI_TMP is required}/store-lock-phase0-XXXXXX")
export PI_WORKBENCH_WORKSTREAM_DIR="$ROOT" TMPDIR="$ROOT" HOME="$ROOT/home"
mkdir -m 700 "$HOME"
trap 'rm -rf "$ROOT"' EXIT
[ "$(uname -sm)" = 'Darwin arm64' ] # Otherwise select the matching official archive first.
ARCHIVE=node-v24.13.0-darwin-arm64.tar.gz
curl --fail --silent --show-error --max-time 90 \
  "https://nodejs.org/dist/v24.13.0/$ARCHIVE" -o "$ROOT/$ARCHIVE"
curl --fail --silent --show-error --max-time 30 \
  https://nodejs.org/dist/v24.13.0/SHASUMS256.txt -o "$ROOT/SHASUMS256.txt"
(cd "$ROOT" && grep " $ARCHIVE\$" SHASUMS256.txt > selected.sha256 \
  && test "$(wc -l < selected.sha256 | tr -d ' ')" = 1 \
  && shasum -a 256 -c selected.sha256 && tar -xzf "$ARCHIVE")
NODE="$ROOT/node-v24.13.0-darwin-arm64/bin/node"
"$NODE" --version # Must print v24.13.0: the exact floor runtime, not PATH's Node.
"$NODE" --input-type=module -e 'import {isolatedRoot} from "./packages/workstream-store/test/fixtures/lock-owner-child.mjs"; await isolatedRoot();'
# Require expected tests/pass counts and skipped=0, todo=0; exit zero alone is insufficient.
"$NODE" --test packages/workstream-store/test/lock-isolation.test.js # 4/4
"$NODE" --test packages/workstream-store/test/lock-recovery.test.js # 3/3
PATH="$(dirname "$NODE"):$PATH" npm run test:workstream-store # 48/48
"$NODE" --check packages/workstream-store/test/fixtures/lock-owner-child.mjs
"$NODE" --check packages/workstream-store/test/lock-recovery.test.js
git diff --check
```

The diagnostic receipt prints actual runtime path/version, every attempt and its timing, timer responsiveness, observed death, post-death acquisition, and inventory on each run. No normal Store, installed checkout, or other worktree is used. Direct fixtures always refuse missing/invalid isolation. Discovery may skip only absent isolation variables; present-invalid values fail. A skipped discovery run is never acceptance evidence; do not point these tests at a user Store.

Limits: this establishes the three Phase 0 exit criteria only. It is not evidence for marker initialization/migration, mixed-version exclusion, production timeout/error mapping, crash-matrix coverage, unsupported filesystems, or performance/promotion gates. Root aggregate `npm test` was not run in this bounded phase. No fixture commit exists because this assignment forbids commits; continuation can consume the worktree fixture until a later authorized commit.

#### Phase 0 continuation verified — immutable baseline and isolation

Approved continuation only; production and manifests remain byte-unchanged at baseline `a3dfbb9bb791ae9895ce33938c8d9d988808802b`. No later phase, commit, publication, delegation, or aggregate run occurred. The earlier measurements above remain historical evidence, not candidate verification.

- `test/fixtures/legacy-adapters.js` (all test paths relative to `packages/workstream-store/`) freezes the complete baseline adapter, with only a provenance header and the two model/error import paths adjusted. The runnable snapshot assertion compares normalized bytes with `git show` at the full baseline revision, and checks SHA256 **`16bf7047380914f209db890f5984b02de1dff5833a48f64b8a54b84eb40d1027`**. Actual fixture-file SHA256 including header/adjusted imports: **`ffca05471ebf83c5f53900d64f19db29c2eba1b92853803ecbae6371d2e96536`**.
- Both legacy negative controls, including initial JSON seeding, now use that frozen adapter; the child explicitly separates `legacy`, `candidate`, and raw `sqlite` modes. Each acquisition barrier checks mode and runtime, and retained child exits are awaited before fixture cleanup. The rejected rename remains isolated negative-control code.
- The shared guard requires nonempty `PI_TMP`, `PI_WORKBENCH_WORKSTREAM_DIR`, `TMPDIR`, and `HOME`, canonical ROOT strictly beneath PI_TMP, canonical TMPDIR equal to ROOT, and canonical `homedir()` strictly beneath ROOT. `test/lock-isolation.test.js` covers absent/empty values, root/TMPDIR/HOME canonical and symlink escapes, absent-only discovery skips versus empty-value runner failures, and snapshot fidelity. No missing-SQLite skip exists.

Test/fixture diff identity: SHA256 **`30970409f58034d6390110bc26283cbcb1f86b62bd3832433ee67a864c22be04`**, hashing the four changed/new test/fixture repository paths in sorted order, each as UTF-8 path + NUL + exact file bytes + NUL (findings excluded to avoid a self-referential hash). Baseline revision is recorded above.

Expected counts were enumerated from test declarations before acceptance, not adjusted to a passing run. Each file ran separately, followed by the package script; every command exited 0:

| File / command | Expected tests/pass | Observed tests/pass | Skipped / todo / failed / cancelled |
| --- | --- | --- | --- |
| `test/contract.test.js` | 31/31 | 31/31 | 0/0/0/0 |
| `test/file-cache.test.js` | 10/10 | 10/10 | 0/0/0/0 |
| `test/lock-isolation.test.js` | 4/4 | 4/4 | 0/0/0/0 |
| `test/lock-recovery.test.js` | 3/3 | 3/3 | 0/0/0/0 |
| `npm run test:workstream-store` | 48/48 | 48/48 | 0/0/0/0 |

The isolation test intentionally launches discovery subprocesses with absent variables (3 skips each) and invalid empty values (exit 1, zero skips each). These are asserted negative controls, not skipped acceptance suites. Its first development run was 3/4: the nested runner inherited `NODE_TEST_CONTEXT`, so no standalone TAP was emitted. Removing that internal runner context from the independent subprocess fixed the harness. A subsequent receipt parser initially expected TAP for npm's spec output; it now validates either reporter's exact totals. Neither failure was a Store/runtime gate failure, and neither acceptance criterion was weakened.

Runtime: official **Node v24.13.0**, Darwin arm64, downloaded once and checked against the single matching published SHASUMS256 entry; archive SHA256 **`d595961e563fcae057d4a0fb992f175a54d97fcc4a14dc2d474d92ddeea3b9f8`**. Bootstrap/launch runtime observed separately: v26.7.0; it was not substituted for the floor. Experimental SQLite warning remained visible.

| Measurement | Focused 3/3 | Package 48/48 |
| --- | --- | --- |
| Frozen legacy orphan, timeout 80 ms | STORE_BUSY **92.890 ms**, callback false | STORE_BUSY **104.096 ms**, callback false |
| Rejected rename, live successor barrier | **2 simultaneous owners** | **2 simultaneous owners** |
| Numeric code-5 busy attempts / max synchronous attempt | **11 / 0.806 ms** | **14 / 12.633 ms** |
| Contention loop / 25 ms timer | **188.678 / 28.824 ms** | **190.203 / 24.755 ms** |
| Fresh SQLite acquisition after observed SIGKILL | **0.735 ms** | **0.804 ms** |

All cases preserved byte-identical valid JSON. Inventories before cleanup were exactly: orphan `.workstreams.lock` + `workstreams.json`; rejected rename those plus `rejected-takeover`; SQLite `.workstreams-lock.sqlite` + `workstreams.json`. No SQLite path was removed to recover. The four changed/new JS/MJS test/fixture files passed syntax checks; `git diff --check` passed; production/manifests diff against HEAD was empty.

The one retained reusable runtime is `$PI_TMP/store-lock-phase0-Ik9eHA/node-v24.13.0-darwin-arm64/bin/node`; bootstrap/rerun receipt is `$PI_TMP/store-lock-phase0-Ik9eHA/rerun-phase0.sh`. From this development worktree run `bash "$PI_TMP/store-lock-phase0-Ik9eHA/rerun-phase0.sh"` with the same session PI_TMP. It re-exports guarded disposable HOME/TMPDIR/Store root, runs all four per-file checks and the package command, asserts exact counts with zero skips/todos/failures, and runs syntax/diff checks. Recreate on a new session using the official-download block above, not an old runtime path. The archive was removed after verification; the extracted official distribution, checksum receipt, non-secret logs, rerun script and empty disposable HOME remain. All owned Store directories and child processes were cleaned; the coordinator owns removal of this single retained runtime root after its independent rerun. No live Store or installed/other checkout was used.

Remaining gates are unchanged: coordinator independent rerun, later production phases, full aggregate isolation/config audit (configure `PI_CODING_AGENT_MODULE` per the package README where required, never relax zero skips), candidate latency/exclusion/crash/journal and performance evidence. This continuation proves no production repair.

#### Phase 1 implementation evidence — review before integration

The internal seam passes its focused and package checks on official **Node v24.13.0, Darwin arm64**. This is not a repaired production adapter: `src/adapters.js` and `src/index.js` remain byte-identical to baseline `a3dfbb9bb791ae9895ce33938c8d9d988808802b`. The frozen Phase 0 fixtures and prior findings are preserved. No migration CLI, commit, push, publication, delegation, installed change, or aggregate run occurred.

Changed paths (package-relative unless explicitly rooted):

- `src/lock-protocol.js`: exact schema validation, no-follow authoritative metadata reads, permanent mkdir-winning marker, exclusive 0600 synced temporary files and in-place completion. Completed valid protocol wins over leftovers; unknown/unsafe incomplete entries refuse without edits. Empty/legacy markers stay busy. Matching-token completion is an internal disk-state primitive, **not proof of supervisor authority**.
- `src/lock-coordinator.js`: lazy version/import capability preflight **before marker mutation**, metadata-only DB-family checks, verified zero busy timeout on each handle, numeric SQLite primary-code mapping, monotonic capped async retries, and a single-use lease with cleanup precedence. Injected imports/clocks/sleeps/hooks use symbol-keyed internal options only.
- `test/fixtures/construction-supervisor.mjs`: test-only fresh-root supervisor. It records canonical path/dev/ino, sends its token over IPC only after installing the retained child's exit listener, and checks actual exit, unchanged root, and complete matching disk metadata before calling completion. No production recovery registry/capability or process manager was added.
- `test/lock-protocol.test.js`, `test/lock-coordinator.test.js`: 8 and 12 tests respectively; `src/errors.js` and `src/index.d.ts`: sanitized unavailable diagnostics and declaration. Root `package.json` and package `package.json` change only `engines.node` to `>=24.13.0`. Adapter/factory retry forwarding and its public option declarations remain Phase 2 work.

**Tests first:** the two new suites initially failed all **20/20** intended assertions because their implementation modules/fixture were absent (exit 1, zero skips/todos). A subsequent targeted PRAGMA assertion exposed numeric code 5 incorrectly becoming `STORE_BUSY`; it failed with expected `LOCK_COORDINATOR_UNAVAILABLE` versus actual `STORE_BUSY`. The coordinator now treats inability to set/read zero timeout as unavailable, while proven malformed SQLite remains corrupt. That regression passes without relaxing the assertion.

Expected counts were recorded before acceptance. Each file ran separately, then focused and package commands; every row matched, exit 0, with **failed/cancelled/skipped/todo all 0**:

| Test file / command | Expected tests/pass | Actual tests/pass |
| --- | --- | --- |
| `test/contract.test.js` | 31/31 | 31/31 |
| `test/file-cache.test.js` | 10/10 | 10/10 |
| `test/lock-isolation.test.js` | 4/4 | 4/4 |
| `test/lock-recovery.test.js` | 3/3 | 3/3 |
| `test/lock-protocol.test.js` | 8/8 | 8/8 |
| `test/lock-coordinator.test.js` | 12/12 | 12/12 |
| Focused protocol + coordinator | 20/20 | 20/20 |
| `npm run test:workstream-store` | 68/68 | 68/68 |

Safety assertions show legacy callback exclusion both during initialization and after completion with marker inode continuity; malformed/unsupported/symlink state fails closed; completed protocol ignores leftover paths without traversal. Fake-clock contention makes exactly three attempts and capped sleeps totaling 45 ms, with every handle closed before sleep and no post-expiry attempt; zero budget makes one attempt. Real coordinator leases exclude another coordinator in-process and a retained raw-SQLite child owner, yield a timer, and reacquire after observed child exit without marker replacement. The lock DB has zero application tables. DB byte/schema checks occur only after leases close; no raw DB descriptor validation is used.

Supervisor assertions cover live/missing exit, raw caller proof/direct-import requests, lost/restarted supervisor, pre-existing root, foreign/missing/partial metadata, mkdir-only death, multiple assignment and changed-root refusal; matching complete metadata after observed SIGKILL permits in-place completion. Internal matching-token completion is deliberately directly callable: these tests establish trusted harness control flow, not an unforgeable import boundary. Fake cleanup failures preserve primitive/frozen primary identity and exercise typed sole failures; they do not certify native release after real IO failure.

All package JS/MJS source/test/fixture syntax checks, manifest/declaration assertions and `git diff --check` pass. The approved plan checksum was verified unchanged. Phase 1 nine-file identity, excluding findings: **`f089d7cc99e5e267f067ecb0008085e36ff024ccbaa8cf38aed4674314651dfa`**, using sorted repository path + NUL + exact bytes + NUL.

One official checksum-verified runtime remains at `$PI_TMP/store-lock-phase1-siWxvV/node-v24.13.0-darwin-arm64/bin/node`; archive SHA256 is the Phase 0 official value above. In this worker's session PI_TMP, `bash "$PI_TMP/store-lock-phase1-siWxvV/rerun-phase1.sh"` reproduces exact-count checks with disposable HOME, TMPDIR and Store root. The script, red/acceptance logs and `phase1-receipt.json` remain in that root; the coordinator receives its exact absolute path separately. Owned Store directories and children were cleaned/awaited; the coordinator owns removal of this one retained runtime root after rerun.

**Remaining gate:** independent adversarial review of this seam before Phase 2 integration. Public transaction/callback behavior, real acquisition-latency bounds, crash/hot-journal matrix, attended migration, service/CLI propagation, aggregate suites and performance are not established by this Phase 1 receipt. Owner-controlled local paths remain a prerequisite, not protection against hostile same-user path replacement or proof of unsupported-filesystem locking.

#### Phase 1 independent-review HIGH remediation — verified, rereview pending

Authoritative review: `execution1afe70f6-6fa6-464c-8590-4a6990cb1321`, Opus xhigh, **REVISE**. The supplied compact receipt is the source; no result-file existence is assumed. Only `packages/workstream-store/src/lock-protocol.js`, `packages/workstream-store/test/lock-protocol.test.js`, and this findings document changed in this bounded remediation. Earlier Phase 0/1 edits remain intact; no Phase 2 integration, commit, publication, delegation or aggregate run occurred.

| Issue | Diagnosis / disposition | Regression evidence |
| --- | --- | --- |
| HIGH: incomplete scan races | **Corrected; pending independent rereview.** Protocol publication between absent read and listing now restarts authoritative validation. A recognized temp disappearing between listing and stat restarts the scan; it never grants completion authority. Other malformed/unknown/nonregular/symlink incomplete entries still refuse. | Builtin `readdir` barriers with `syncBuiltinESMExports` deterministically reproduce publication and initializing-temp rename. Before the fix these fail with `CORRUPT_STORE` and `ENOENT` respectively; concurrent public `ensureMarker` calls also expose typed unavailable errors. Both barriers now pass. |
| HIGH: benign ancestor aliases rejected | **Corrected; pending independent rereview.** Canonicalize the parent through `realpath`, resolving missing descendants from the nearest existing parent. Validate the Store itself without following its symlink; a symlink Store returns typed `LOCK_COORDINATOR_UNAVAILABLE` with canonical-path guidance, not marker corruption. | An alias pointing strictly inside the owned fixture root now permits initialization of its nested Store. Passing that alias as the Store itself refuses without changing target contents. Marker, protocol, initializing metadata and all four SQLite-family symlink refusals remain green. No OS `/tmp` or `/var` fixture is used. |

Tests preceded production edits. On official **Node v24.13.0, Darwin arm64**, the red protocol suite was **8 pass / 4 fail / 12 tests**, exit 1, skipped=0/todo=0: two deterministic scan failures, ancestor-alias refusal, and concurrent fresh-root failure. The concurrent test measured **58 spurious errors / 3,200 calls** (reviewer's separate v26.7.0 measurement was 25/3,200, not this worker's result). The first green was **12/12**, exit 0, skipped=0/todo=0.

The acceptance rerun records expected counts before execution and asserts all totals, including failed/cancelled/skipped/todo=0. Every row below exited 0:

| File / command | Expected and observed tests/pass |
| --- | --- |
| `node --test --test-reporter=tap packages/workstream-store/test/contract.test.js` | 31/31 |
| Same command, `test/file-cache.test.js` | 10/10 |
| Same command, `test/lock-isolation.test.js` | 4/4 |
| Same command, `test/lock-recovery.test.js` | 3/3 |
| Same command, `test/lock-protocol.test.js` | 12/12 |
| Same command, `test/lock-coordinator.test.js` | 12/12 |
| Focused protocol + coordinator | 24/24 |
| `npm run test:workstream-store` | 72/72 |
| Five further full protocol reruns | 12/12 each |

Each protocol execution asserts **100 fresh Stores × 32 concurrent calls = 3,200 successes, 0 errors**. Across the eight acceptance executions (per-file, focused, package, five repeats), **25,600/25,600** succeeded. All prior 68 package tests remain green; four new top-level regressions account for 72. Every package source/test/fixture JS/MJS syntax check and `git diff --check` passed. Two-file source/test identity (sorted repository path + NUL + exact bytes + NUL, findings excluded): SHA256 **`66004d01a6dce2aa1dc45860928d0eb899811b6eec2d45c4c9593a4aef154740`**.

Evidence and rerun script are retained under this worker's `$PI_TMP/store-lock-review-Sy4fc1/`: `red.log`, `first-green.log`, `acceptance.log`, per-file/focused/package logs, `stress-1.log` through `stress-5.log`, and `rerun-review.sh`. Run `bash "$PI_TMP/store-lock-review-Sy4fc1/rerun-review.sh"` from the same worker session; absolute paths are supplied to the coordinator separately. The script reuses the original coordinator-owned Phase 1 official floor executable **read-only**, does not download a second runtime, and explicitly places Store root, TMPDIR, HOME and compile cache beneath this worker's guarded PI_TMP. It checks actual runtime/version and exact counts. All per-case Store directories and owned children were cleaned/awaited; only diagnostics, disposable HOME and compile cache remain. The coordinator owns final removal of this new evidence root and the untouched original runtime root after rereview/reruns.

Remaining risks/gates: this is a local owner-controlled filesystem result, not hostile path-mutation protection or a hard real-time guarantee. Independent rereview remains required before integration. The three supplied nonblockers remain deliberately deferred to Phase 2: post-rename unavailable-message committed/exact-idempotency guidance; legacy release midwait does not retry mkdir or auto-convert an existing empty directory; remaining-budget sleep semantics are deliberate. All earlier Phase 2–5 gates remain unclaimed.

#### Phase 1 rereview disposition and identity clarification

The coordinator supplied independent **APPROVE**, `execution421e0e93-4325-44c1-9ea5-a8b958aaec1c`, Opus xhigh, before Phase 2. Reviewed Phase 1 source SHA256 prefixes were `src/lock-protocol.js`: **`7f9bb22459941ced`**, and `src/lock-coordinator.js`: **`ef964225715fdc78`**. The earlier **`66004d01a6dce2aa1dc45860928d0eb899811b6eec2d45c4c9593a4aef154740`** identity names the remediation **protocol source + protocol test pair only**, not the coordinator or complete Phase 1 candidate; reconstructing the pre-integration protocol bytes confirms that pair identity and the reviewed source prefix. The coordinator independently reports package **72/72**, focused **24/24**, protocol stress **5 × 12/12**, all failure/cancellation/skip/todo counts zero. These are attributed coordinator results, not Phase 2 worker executions. This disposition supersedes the historical rereview-pending statements above; it does not approve the subsequent integration diff.

#### Phase 2 shared transaction integration — implemented, bounded-timing gate FAILED

**Stopped at the approved real acquisition-bound gate; Phase 2 is not done.** No threshold increase, concurrency reduction, retry-until-green, migration command, full matrix, performance/aggregate run, commit, publication, delegation, or installed/other-tree mutation occurred. The first failed package receipt remains retained; no later passing package run supersedes it.

Phase 2 changed exactly these package-relative paths, plus this findings document:

- `src/adapters.js`: preserve the promise queue; acquire a SQLite lease before every public/trusted read and write; keep JSON exclusive temporary creation, file sync, close and atomic rename; invalidate cached generation on failure; preserve original callback/read/write errors through secondary cleanup, including primitive/frozen throws; remove only the transaction's own exact temporary file, never a directory. Relative paths are anchored at construction, then the canonical lease directory supplies all JSON paths. Read descriptors use no-follow/type/identity checks.
- `src/lock-protocol.js`, `src/lock-coordinator.js`: return/share the canonical marker directory with the lease; retain parent aliases and refuse a symlink Store. Add the internal release hook and reuse best-effort sanitized cleanup annotation. No production environment switches, global registry, DB descriptor inspection, hostile-path-mutation guarantee, or Store model/projection change.
- `src/errors.js`, `src/index.js`, `src/index.d.ts`: committed cleanup errors explicitly require confirmed release and the exact same idempotency-key/request retry; retain typed sole cleanup diagnostics `{operation,jsonCommitted}` and nonenumerable raw cause; validate/forward/type `lockRetryIntervalMs`.
- `test/lock-transaction.test.js`: 17 top-level tests, including real read/write exclusion and observed owner death, warm cache, FIFO/dequeue budgets, fake-clock capped retries, option/default/declaration assertions, canonical aliases/chdir, JSON symlink refusal, callback/read/write/rename/temporary cleanup error identity, typed sole commit/close/release errors, post-rename exact retry without duplicate events, and symbol-injected phase barriers.
- `test/file-cache.test.js`: replace the obsolete mkdir/remove lock test with an actual coordinator lease; never delete the permanent marker.
- `test/fixtures/lock-owner-child.mjs`: candidate read/write modes and symbol-injected acquired/read/temp-sync/rename phase barriers. Frozen `legacy-adapters.js` remains unchanged, SHA256 **`ffca05471ebf83c5f53900d64f19db29c2eba1b92853803ecbae6371d2e96536`**.

**Tests first:** initial transaction suite, before production integration: **13 tests, 2 pass, 11 intended failures**, exit 1; failed/cancelled/skipped/todo = **11/0/0/0**. The first integration execution passed 13/13; four additional regression tests bring the final expected transaction count to 17. All assertions retain their original acquisition/timer bounds.

Official **Node v24.13.0, Darwin arm64** reused read-only from the coordinator's checksum-verified distribution. Every behavioral execution used this worker's PI_TMP, disposable HOME, explicit per-case Stores and TMPDIR guards. Expected counts were fixed before acceptance:

| File / command | Expected tests/pass | Observed tests/pass | Failed / cancelled / skipped / todo | Exit |
| --- | --- | --- | --- | --- |
| `test/contract.test.js` | 31/31 | 31/31 | 0/0/0/0 | 0 |
| `test/file-cache.test.js` | 10/10 | 10/10 | 0/0/0/0 | 0 |
| `test/lock-isolation.test.js` | 4/4 | 4/4 | 0/0/0/0 | 0 |
| `test/lock-recovery.test.js` | 3/3 | 3/3 | 0/0/0/0 | 0 |
| `test/lock-protocol.test.js` | 12/12 | 12/12 | 0/0/0/0 | 0 |
| `test/lock-coordinator.test.js` | 12/12 | 12/12 | 0/0/0/0 | 0 |
| `test/lock-transaction.test.js` | 17/17 | 17/17 | 0/0/0/0 | 0 |
| Focused protocol + coordinator + transaction | 41/41 | 41/41 | 0/0/0/0 | 0 |
| `npm run test:workstream-store` | 89/89 | **89/88** | **1/0/0/0** | **1** |

| Timing evidence | Per-file transaction run | Focused run | Failed package run |
| --- | --- | --- | --- |
| Busy acquisition, timeout 100 + interval 20 ms | 101.345 ms | 101.344 ms | **165.725 ms — FAIL, bound 120 ms** |
| Requested 25 ms timer, bound <125 ms | 24.609 ms | 25.047 ms | Not recorded: busy-bound assertion failed first |
| Zero-budget queued transaction, queue/callback elapsed | 80.502 ms, then one immediate free acquisition | 83.356 ms | 107.955 ms |
| Separate 100 ms queued wait; acquisition timeout 80 + interval 20 ms | 80.709 ms | 81.642 ms | 81.520 ms |
| Successor after observed SIGKILL, no marker/DB deletion | 1.163 ms | 1.348 ms | 1.139 ms |

The fake-clock adapter regression makes exactly three busy attempts, closes each handle before sleeping, totals 45 ms with capped sleeps, and never calls back after rejection. Error tests prove old complete JSON before rename, definitely committed complete JSON after rename, primitive/frozen/error identity despite secondary rollback/close/release/temporary errors, nonserialized causes, and exact create retry with one event after independently reacquiring/releasing the real lease. Native cleanup-failure injections close the underlying real handle before reporting simulated close failure; they do not establish release after genuine native close failure.

**Issue ledger — P2-BOUND (blocking; bounded diagnosis complete, historical cause not established):** the unchanged busy-bound assertion at `test/lock-transaction.test.js` failed in the first package acceptance run with **165.724542 ms > 120 ms**; callback was never supplied an opportunity to enter while the external lease was held. Per-file/focused passes do not waive this result. The package concurrently runs the existing 3,200-call protocol stress test, but scheduler/filesystem/native-attempt attribution was not measured and is **not a proven root cause**. No simultaneous owner, marker deletion, partial JSON or primary-error masking was observed. Do not describe the measured latency as a passing bounded acquisition or silently serialize the package command. The approved plan requires preserving the failed receipt and stopping this gate rather than raising its bound; coordinator disposition is required before further behavioral work.

After the failed package gate, all package source/test/fixture JS/MJS syntax checks and `git diff --check` passed. Phase 2 nine-file identity, excluding findings (sorted repository path + NUL + exact bytes + NUL): SHA256 **`adaa3ed44fbbbf487d14a48671fec671043d76624b92a985ede237c1d0ba4104`**, based on HEAD `a3dfbb9bb791ae9895ce33938c8d9d988808802b`. Frozen legacy SHA and scoped status were checked; no root/package manifest changes were made by this phase. All retained child exits were awaited and per-case Stores cleaned, including the failed case. Only diagnostics/scripts, disposable HOME and compile cache remain in `$PI_TMP/store-lock-phase2-gjt7Yi/`; `red.log`, `acceptance-failed.log`, `package-failed.log`, per-file and focused logs preserve the evidence. `rerun-phase2.sh` uses the same exact-count commands/bounds and writes each explicit coordinator rerun into a fresh child log directory, preserving the original failure. Absolute worker PI_TMP, script and cleanup-root paths are supplied separately, not committed here.

Remaining gates: resolve P2-BOUND without weakening acceptance; coordinator independent rerun/review; Phase 3 CLI and Phases 4–5 crash/journal/compatibility/performance/aggregate work. Parent aliases are supported only in an owner-controlled local filesystem, not against hostile same-user path mutation. Queue/callback time remains deliberately unbounded, distinct from acquisition time. The previously noted incomplete-marker scan deadline follow-up remains deferred, not reclassified as the cause of this failure.

#### P2-BOUND bounded diagnosis — predeclared protocol (2026-10-21)

This diagnosis does not reopen acceptance or erase the first 165.724542 ms failure. Coordinator counterevidence: one exact independent rerun passed 89/89, zero skipped/todo/fail, acquisition 101.085 ms (120 ms limit), timer 25.915 ms, death recovery 1.325 ms. Original logs remain in the Phase 2 evidence root as `package-failed.log` and `acceptance-failed.log`; the coordinator rerun is its `rerun-SxaKBI/` child. No repeated acceptance-until-green, new threshold, serialized harness, production change, commit, publication, delegation or Phase 3 work is authorized here.

Ranked falsifiable hypotheses, declared before running:

- Scheduler delay: elapsed async sleep exceeds requested remaining budget, or a long event-loop heartbeat gap explains the excess. A controlled 80 ms stall near deadline must defeat the 120 ms wall-clock bound even with zero native busy timeout.
- Marker/metadata work: filesystem/marker stages consume the excess before the first SQLite open or between retry attempts. Their async durations include threadpool/OS scheduling and cannot alone attribute disk service time.
- Native SQLite work: a synchronous open/PRAGMA/BEGIN/close stage consumes the excess. A child-held lease versus same-process lease discriminates OS contention from same-process contention.
- Deadline placement: the first monotonic clock is later than the observed delay, or uncapped sleeps/attempts after expiry account for it. Stage/clock/sleep traces should expose either. Queue time remains outside acquisition by design.

Exactly three predeclared diagnostic invocations, official Node v24.13.0, separate owned roots strictly below this worker's PI_TMP, disposable HOME/TMPDIR/env Store, no default Store operation:

- D1: `P2_DIAG_CASE=waits node --test packages/workstream-store/test/lock-bound-diagnosis.mjs` — two sequential diagnostic cases, same-process and retained actual-child lease. Expected 2/2 with no skip/todo; report bound violations, never reclassify them as acceptance passes.
- D2: from the package, `node --import ./test/fixtures/lock-bound-timing.mjs --test test/*.test.js` — one instrumented package run, unchanged default file parallelism and original assertions. Expected 89 tests, zero skips/todos. Diagnostic preload selects only real adapters configured with timeout 100/retry 20 and no existing seam; all fake-clock and other cases retain their original behavior.
- D3: `P2_DIAG_CASE=stall node --test packages/workstream-store/test/lock-bound-diagnosis.mjs` — one explicitly negative scheduler control, 80 ms blocking interval scheduled at 90 ms during real contention. Expected diagnostic 1/1 asserts the unchanged 120 ms acceptance ceiling is exceeded and callback stays excluded; this is not passing acceptance.

Reusable opt-in timing code is test-only: `test/fixtures/lock-bound-timing.mjs`; standalone checks are outside the package test glob in `test/lock-bound-diagnosis.mjs`. Traces include acquisition entry, deadline-clock calls, lazy preflight, marker/filesystem stages, individual SQLite native calls, requested/actual sleeps, 2 ms heartbeat maximum gap and per-acquisition event-loop utilization. No new DB descriptor opens/reads or path/token payloads are logged. All children are retained, terminated and awaited; inventories use marker metadata only while leases exist. Results and limitations follow after the fixed invocations.

#### P2-BOUND diagnosis receipt — negative recommendation, unchanged gate

**Conclusion:** no deterministic in-scope defect causing the historical 165.724542 ms observation was established. No production fix is justified. Keep Phase 2 blocked and recommend a negative experiment conclusion under the unchanged wall-clock criterion. An unconditional `timeout + retry interval` wall-clock promise on Node/OS scheduling is unachievable: D3 directly demonstrates that a correctly capped async wait cannot execute its deadline check while the event loop is blocked. This establishes a design ceiling, **not** the cause of the uninstrumented historical failure. No acceptance relaxation or design change is made here.

Evidence retained outside disposable test roots in the external sprint artifact `p2-bound-diagnosis/` (location recorded in the draft PR body): `D1.log`, `D2.log`, `D3.log`, `summary.json`, `exits.txt`, `roots.txt`, `cleanup-inventory.txt`, and `diagnostic-identity.json`. Original failures are preserved unchanged in `original/{package-failed.log,acceptance-failed.log}`; passing coordinator logs are preserved in `coordinator-counterevidence/{package.log,lock-transaction.log}`. This durable copy supplements, never replaces/deletes, original Phase 2 logs. Official floor executable was reused read-only; no download or other runtime/tree mutation. Runtime v24.13.0, darwin-arm64, baseline `a3dfbb9bb791ae9895ce33938c8d9d988808802b`; diagnostic pair identity (sorted repo path + NUL + bytes + NUL) SHA256 `243bf49765880304454c476cc8213477c407d13fb6ce044522f87e89d2f5498c`.

| Predeclared run | Result, unchanged gate | Stage / scheduler evidence |
| --- | --- | --- |
| D1, isolated waits | Exit 0; diagnostic 2/2, fail/skip/todo 0. Same-process measured transaction 101.995 ms; child-held 101.556 ms; callbacks 0. Timers 25.306/26.106 ms. | Acquisition-only 100.876/101.354 ms; first clock 0.418/0.028 ms after acquisition entry, first SQLite open 5.350/0.998 ms. Five/six busy attempts. Maximum synchronous SQLite call 0.133/0.116 ms; maximum filesystem stage 0.831/0.680 ms; total filesystem stages 3.977/3.062 ms. Maximum 2 ms heartbeat gap 5.094/3.066 ms. Child exit was observed before successor/cleanup. |
| D2, one full parallel package run | Exit 0; original 89/89, fail/skip/todo 0. Original busy assertion 100.959 ms <=120, timer 25.557 ms, death recovery 1.039 ms. This is counterevidence, not recovered acceptance. | Selected busy acquisition 100.825 ms, first clock 0.012 ms, first SQLite open 1.164 ms, six attempts; maximum SQLite call 1.430 ms; maximum filesystem stage 0.506 ms, filesystem total 2.628 ms; heartbeat gap 3.135 ms. All sleeps capped by remaining time; largest positive sleep overshoot 0.746 ms. The 3,200-call protocol stress test remained enabled/default-parallel and passed. No reproduction of the original latency spike. |
| D3, controlled scheduler stall | Exit 0; diagnostic 1/1, fail/skip/todo 0. **Deliberate acceptance-bound violation:** 245.200 ms >120; callback 0; timer25 25.916 ms still passes its independent <125 gate. | Requested 80 ms blocking interval began at 90.943 ms and actually lasted 152.377 ms. Final sleep requested only 14.528 ms but lasted 158.897 ms; heartbeat gap 154.994 ms. Acquisition-only 244.589 ms; maximum SQLite call 0.108 ms; maximum filesystem stage 0.093 ms. Next clock check rejected busy without a subsequent attempt/callback. |

Coordinator evidence clarification after reading retained logs: the supplied 101.085/25.915/1.325 ms values belong to `lock-transaction.log` (17/17), not its package timing row. Its `package.log` independently shows 89/89, fail/skip/todo 0, busy 100.874 ms, timer 24.653 ms, death recovery 1.372 ms. Both support variability/counterevidence; neither erases the original package 88/89 failure. Focused initial 41/41 remains historical evidence, not a substitute for the failed package gate.

**Causal limits and code inspection:** every Store operation routes through the adapter queue and shared coordinator. Deadline is initialized inside acquisition after dequeue, before lazy capability preflight, `ensureMarker` and DB-family metadata checks. Thus marker validation, import and SQLite work count against the budget; moving the clock later would exclude real acquisition work and weaken the agreement. Positive budgets, like zero, currently allow the first SQLite attempt after marker validation; subsequent retry deadline checks occur before async DB-path checks, not before every native instruction. Those stages and native calls can themselves overrun a deadline. No observed D1/D2 stage establishes either as the historical root cause, and adding another guard cannot bound an operation already blocked in the scheduler/native filesystem. Same-process and real-child held leases both returned numeric busy promptly in D1: no evidence for a native SQLite busy wait. D2 did not isolate causation by package parallelism: it preserved package stress and passed; file scheduling/OS load and instrumentation overhead remain confounders. No claim that the protocol stress caused the original failure is supported.

Instrumentation uses the existing symbol seam, wrappers around allowed marker/filesystem operations and SQLite's own API, and a 2 ms heartbeat. It adds overhead and may change scheduling; async stage latency includes filesystem service, threadpool delay and scheduler delay. D3 is a deliberately adverse synthetic control, not a replay or attribution of the historical failure. Its requested 80 ms wait itself overshot, retained as measured rather than normalized away. Passing D3 means the diagnostic correctly detected a negative guarantee example; it is emphatically **not** candidate acceptance. No acceptance rerun beyond the single predeclared D2 occurred; the three-run budget is exhausted.

**Checks/cleanup:** both new MJS files pass official-floor `--check`; `git diff --check` passes. D1 and D3 additionally assert callback exclusion, permanent marker inode continuity, continued busy ownership and a fresh successor after owner release/actual child exit. No raw SQLite-family read/open/hash was added; marker inventories are metadata-only while leases exist. All three owned fixture HOME/Store/TMPDIR roots were inventoried and removed after retained child exits; only non-secret receipts remain. Changes in this diagnosis: this findings document, `test/lock-bound-diagnosis.mjs`, `test/fixtures/lock-bound-timing.mjs`. All pre-existing candidate edits preserved; no production edits, commits, publication, delegation, live Store, installed/integration changes or Phase 3 work.

**Recommendation / owner boundary:** conclude this experiment negatively with P2-BOUND unresolved under its original criterion; no lead input is required to finish this diagnosis. If the owner later wants continued implementation, a separately approved design must explicitly address the distinction between an algorithmic acquisition budget and externally delayed wall-clock completion (or choose an execution environment with an enforceable scheduling bound). That is a new design decision, not permission to accept a flake, increase the timeout, defer deadline placement, serialize the package harness or resume this assignment. No production remediation is proposed without evidence of a genuine deterministic in-scope bug.

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

## Required safety properties — not all established

These remain the unchanged positive acceptance requirements. P2-BOUND failed; the criterion table above distinguishes representative proof from unverified full-matrix claims.

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

A **successful** experiment would require the reusable fixture and candidate to be committed, focused and aggregate tests to pass, measured overhead within the absolute budget, a clean worktree, and independent cross-family review with no blocker/high finding. Those conditions do not hold. The present delivery is a **negative experimental report**, with final diff judgment limited to APPROVE for a NEGATIVE-EXPERIMENT DRAFT ONLY and the coordinator checkpoint still pending; it must not be represented as a completed successful experiment.
