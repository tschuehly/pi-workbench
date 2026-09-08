# Workstream continuation runtime probes
> **ARCHIVED — OUTDATED HISTORICAL EVIDENCE (2026-08-28).** Retained for provenance only; this file does not describe current behavior or intended state. See [`../README.md`](../README.md) for its disposition and the current direction.

Status: approved experiment plan; implementation not started. These probes answer the Phase 0 host questions in `workstream-continuation-extension.md`; they do not independently alter continuation protocol meaning.

## Outcome

Produce executable, bounded evidence for the runtime assumptions behind owner-initiated checkpoint continuation into a fresh attended Pi session. The probes must determine what Pi and PI WEB can prove at every replacement and crash boundary before `packages/workstream-session-coordination/` is designed around those hosts.

The result is a pass/fail matrix and disposable probe code. A failed probe narrows the implementation sequence; it must not be worked around by weakening complete-location requirements, triggering an automatic model turn, or classifying an unknown outcome as failed.

## Experiment questions

The probes answer the continuation plan's nine Phase 0 checks through eight grouped questions; question 8 below combines abandoned-lock and concurrent-watch contention:

1. Can PI WEB start a session at an explicit machine/project/workspace location rather than only its current selection?
2. What replacement session identity and file are available in Pi `ctx.newSession({ setup, withSession })`?
3. Do `SessionManager.appendMessage()` and `appendCustomEntry()` persist the kickoff and operation marker before `withSession`, including at each forced crash point?
4. Can a terminal extension obtain and verify a trusted complete Workbench location without inferring it from `cwd`?
5. What evidence distinguishes cancellation before creation, cancellation after creation, checked failure, and unknown replacement outcome?
6. Can PI WEB open a terminal-created session at its recorded location?
7. Can host-namespaced operation markers reconcile deterministically after restart without launching a model turn?
8. How do file-store lock contention and process death behave when PI WEB watches while a terminal process appends?

## Boundaries

- Use disposable Pi sessions under an explicit `--session-dir`, temporary Pi configuration, temporary Store directories, temporary repositories, fake PI WEB adapters, and isolated PI WEB data. PI WEB capability questions require the real checkout running against isolated state; a fake may validate only adapter shape.
- Never append experiment records to the user's normal Workstream Store.
- Never start a continuation from a real checkpoint or submit a real continuation prompt to a model.
- Do not add `session.cancelled`, `derivationKind`, the shared coordination package, or production terminal commands in this worktree.
- Probe only documented Pi extension APIs, including command and event handlers, `ctx.waitForIdle()`, `ctx.newSession()`, and documented `SessionManager` inspection/appends; post-switch work uses only the fresh replacement context.
- Session files are evidence, not authoritative Workstream state. Do not commit machine-local paths or session identifiers.

## Isolated workspace

Execution is attended in an `exp/continuation-runtime-probes` worktree created after the plan commit; never work on `main` or consume another run's state. Put disposable probe implementations under a clearly experimental test directory, not `extensions/workstreams/`, so auto-discovery cannot mistake them for a supported interface.

PI WEB explicit-location start and terminal-created-session reopen require the owned sibling worktree. Base its host probe on the controlled-session fixture commit and consume `packages/pi-web-integration/scripts/lib/isolated-pi-web-stack.mjs`; do not create a second isolation guard or divergent fork branch. Fetch both remotes, keep `upstream` fetch-only, and publish only on explicit request. Fakes cannot pass PI WEB questions 1 or 6. Use the guard's exact environment contract: temporary `HOME`/`XDG_CONFIG_HOME` and all PI WEB/Pi roots, socket and ports are pinned; `PI_WEB_SESSIOND_URL`, `PI_WEB_SESSIOND_PORT`, proxies, providers and auth are absent; offline/version-check flags are set; and `os.homedir()` plus every resolved service path must stay under the root. Do not select the URL/port daemon mode in this experiment. PI WEB strips session-directory environment keys before agent spawn, so the runner must verify the gateway's explicit session-directory argument and require every spawned or nested Pi `get_state.sessionFile` to resolve under the experiment root before semantic writes.

## Probe harness

Create a small command-driven Pi extension loaded by a scripted RPC process:

```sh
env -i PATH="$PATH" HOME="$tmp/home" PI_OFFLINE=1 \
PI_CODING_AGENT_DIR="$tmp/pi-config" \
pi --mode rpc --session-dir "$tmp/pi-sessions" -e <probe>
```

Use an allowlisted child environment with a temporary `cwd`: do not inherit provider keys, authentication variables, proxy variables, or provider configuration. Before every probe, send `get_state` and require no selected model (`model` is `null`/unknown). `PI_OFFLINE` suppresses startup network work; credential absence, the unknown model, and extension-command-only dispatch are the provider-request controls. Use `--no-session` only when persistence is not under test. Drive extension commands through JSONL `prompt` requests, which execute immediately without a model turn. It may register experiment-only commands such as:

```text
/probe-new-session <crash-point>
/probe-replacement-state
/probe-recover-marker
```

The harness records a bounded JSON receipt outside the repository for each transition. Each receipt includes an experiment operation token, lifecycle point, old/new session identity presence, persistence observation, cancellation result, and sanitized error category. It must not contain transcript text, credentials, absolute user paths, or provider state.

Crash injection uses a child Pi RPC process and disposable session directory. Each named crash point terminates only that child from inside the labeled operation; no external timing race is accepted as evidence. Do not terminate the supervising Pi or the user's normal Pi process. The scripted driver repeats every classification three times.

## Delivery sequence

### Phase 0 — Build safe probe infrastructure

1. Create guards for every PI WEB/Pi variable named above, `--session-dir`, Workstream Store, repositories, sockets, ports, and child `cwd`. Spawn from an allowlisted environment without provider credentials, authentication state, proxies, or provider config; require `get_state.model` to be null/unknown and every `sessionFile` to be inside the experiment root. Refuse startup unless all write roots are owned.
2. Add a strict JSONL RPC driver, probe receipt schema, and sanitizer.
3. Add child-process launch and deterministic crash injection.
4. Add cleanup that preserves failed-case receipts but deletes generated sessions and repositories after evidence extraction.
5. Add a preflight that refuses any path under the normal Pi session or Workstream Store location.

Exit: a no-op probe starts and cleans up without touching normal user state.

### Phase 1 — Probe Pi session replacement

1. Start a disposable Pi RPC process with the probe extension, temporary config, explicit session directory, and offline startup.
2. In a command handler, wait for idle and capture only plain pre-replacement data.
3. Call `ctx.newSession()` with a parent reference, `setup`, and `withSession`.
4. In `setup`, append an exact bounded kickoff user message and a non-context custom operation marker.
5. In `withSession`, inspect only the replacement context: session ID, file, branch entries, persistence, and session-start ordering. Do not send the kickoff to a model.
6. Prove captured old `SessionManager`, command context, and extension instance state are invalid or stale after replacement; treat successful use as a product-risk finding.

Exit: evidence records exact replacement ordering and which identity/persistence facts are trustworthy.

### Phase 2 — Probe persistence and crash points

Run the same operation with forced termination at:

1. before `newSession`;
2. during `setup` before appends;
3. after kickoff append;
4. after marker append;
5. after new-session file visibility but before `withSession`;
6. at entry to `withSession`;
7. after deterministic confirmation simulation;
8. before the stubbed turn-trigger boundary; the probe never invokes a model.

After each restart, inspect the disposable session directory mechanically. Verify whether the session header, kickoff, marker, and complete session identity exist and whether they are on the active branch. Add one replacement-specific case in which a transaction begun before `ctx.newSession()` remains in flight while `withSession` uses a second `FileWorkstreamAdapter` instance to attempt a transaction. It must return bounded `STORE_BUSY` within `lockTimeoutMs`, not wait on the first instance's in-process queue; supported code starts Store work only after the old transaction settles. Do not infer success from a file name alone.

Exit: every crash point maps to absent, created-and-recoverable, or unknown evidence, and replacement-time Store re-entry is bounded. If append operations do not flush before `withSession`, record the requirement for a generic Pi session-initialization flush seam.

### Phase 3 — Probe cancellation semantics

1. Add a `session_before_switch` probe that cancels before replacement and verify `ctx.newSession()` returns `{ cancelled: true }` with no new session.
2. Force interruption after creation and verify the caller does not receive false pre-creation cancellation.
3. Separate checked API rejection from process or transport loss.
4. Confirm no available evidence justifies `session.failed` for unknown replacement outcomes.

Exit: the result table supports `cancelled`, checked `failed`, created, and `unknown` without conflation.

### Phase 4 — Probe trusted location and PI WEB interoperability

1. Inventory PI and PI WEB APIs that expose machine, project, and workspace identity.
2. Prove whether the terminal extension can receive a trusted complete location. Reject `cwd` parsing as proof.
3. In isolated PI WEB, start at an explicit temporary location and verify the returned session reports that exact location.
4. Create one disposable terminal session and verify PI WEB can resolve and open it through public location/session interfaces.
5. Test mismatch, incomplete location, unavailable machine, and foreign operation-token namespace.

Exit: explicit-location start and cross-client reopen either pass with public evidence or block terminal continuation honestly.

### Phase 5 — Consume Store lock evidence and run continuation-specific contention

This phase follows the independent lock experiment; do not create a second dead-owner fixture here. That experiment must commit `packages/workstream-store/test/fixtures/lock-owner-child.mjs` and its production change. Record its branch and commit; base this probe worktree on that commit or cherry-pick it without editing the lock worktree.

1. Consume the named lock commit and fixture from `workstream-store-lock-recovery-experiment.md`.
2. Run continuation-specific write/write contention plus a concurrent read-consistency assertion; both complete within configured bounds without corruption.
3. Repeat the second-adapter replacement case from Phase 2 against the candidate.
4. Record the exact consumed commit. If the lock experiment fails or remains unpromoted, classify continuation contention as a blocked dependency rather than duplicating or weakening it.

Exit: continuation-specific contention passes against one named lock candidate, or the decision matrix reports the lock prerequisite as blocked.

### Phase 6 — Publish the decision matrix

Summarize each question as:

- **pass** — direct executable evidence supports the planned seam;
- **fail** — the seam is unavailable and a named prerequisite is required;
- **unknown** — the probe cannot distinguish outcomes safely.

For each result, record command, Pi/PI WEB commit, fixture version, expected observation, actual observation, and sanitized receipt hash in `docs/research/reports/workstream-continuation-runtime-probe-results.md`. Commit only reusable scripts that contain no generated state or machine-local paths; otherwise preserve the exact reproduction command in the report. Update the continuation implementation sequence only in a later reviewed change.

## Verification

The probe suite must be repeatable without model or network access after dependencies are installed. It must prove:

- no normal session, Workstream, PI WEB data, socket, or repository path was opened for write;
- every replacement crash point yields the same classification on three runs;
- setup and `withSession` ordering matches documented lifecycle events;
- old session-bound objects are not used after replacement;
- no recovered kickoff runs automatically;
- session identity is checked from content/header evidence, not file naming;
- location mismatch fails closed;
- cleanup leaves only bounded sanitized receipts.

## Pi worker assignment and supervision

This experiment itself launches disposable Pi children, so its implementation worker must not also improvise process supervision. Give one attended Pi worker ownership of the experiment worktree and require scripts to name every spawned PID, session directory, and cleanup receipt.

The supervising lead inspects after:

1. path-safety preflight;
2. no-op child launch and cleanup;
3. first replacement evidence;
4. crash matrix;
5. cancellation matrix;
6. location/interoperability probe;
7. contention fixture and final report.

Pause immediately if the worker targets the normal Pi session directory, sends a model prompt, uses `cwd` as a complete Workbench location, mutates production Workstream records, or leaves an untracked child process after a probe.

## Completion criteria

The experiment is complete when all eight host questions have reproducible pass/fail/unknown results, every generated Pi and PI WEB resource is isolated and cleaned up, and the evidence determines whether implementation can proceed shared-module first, PI WEB first, or only after new host contributions. No production continuation UI or terminal command ships from this worktree.
