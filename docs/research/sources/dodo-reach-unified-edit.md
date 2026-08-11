# `mitsuhiko/agent-stuff` Unified Edit Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

**Research only. No recommendation in this ledger is accepted, and no decision is recorded by it.**
Every candidate below is explicitly labelled unaccepted. Adopting, adapting, experimenting with, or
rejecting any of them requires a separate owner decision recorded in
[`docs/foundation/decisions.md`](../../foundation/decisions.md).

This ledger expands one source referenced by the
[DODOREACH Pi tool-shaping ledger](dodo-reach-pi-tool-shaping.md), which remains the parent analysis
of the surrounding thread.

## Verdict

`unified-edit.ts` is a genuine ergonomics result: it collapses Pi's edit surface into one string
parameter, accepts two edit languages, batches several files per call, and previews a combined diff
before mutation. That reduces tool-schema weight and turn count in an attended session.

It is not yet a safe mutation interface for Pi Workbench. It replaces Pi's built-in `edit` tool
outright, applies planned file changes sequentially with no rollback and no partial-outcome envelope,
resolves absolute paths without workspace containment, and ships with no automated tests in its
repository. For a Workbench Ship-shaped mutation the weakest property is attributable mutation
evidence, and this implementation weakens exactly that property in return for convenience.

## Source identity

| Field | Value |
| --- | --- |
| Source | [`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff) (npm-style Pi package `mitsupi`) |
| Package version | `1.6.0` |
| Repository revision inspected | [`13bc8f8`](https://github.com/mitsuhiko/agent-stuff/tree/13bc8f87970bec8830aab0f1c0487d35aa7c0917) (`fix(files): remove Ctrl+Shift+F shortcut`, 2026-08-10) |
| Mechanism revision | `extensions/unified-edit.ts` last changed at [`c77d497`](https://github.com/mitsuhiko/agent-stuff/blob/c77d49797ad3fb78888e5b002ae606a93777c6b1/extensions/unified-edit.ts) (`fix(edit): improve unified edit previews and matching`, 2026-07-04) |
| Author | Armin Ronacher (mitsuhiko) |
| License | Apache-2.0 (`LICENSE` at repository root) |
| Pi dependency | `peerDependencies: { "@earendil-works/pi-coding-agent": "*" }` — unpinned |

The published revision pinned by the parent ledger and the revision inspected here are identical, so
the findings below describe the same code the thread pointed at.

## Scope and method

Inspected: `extensions/unified-edit.ts` in full (1,612 lines), `package.json`, `README.md`,
`CHANGELOG.md`, `analyze-edits.py`, and the repository's commit history for the mechanism file.
Searched the whole repository for test files (`find . -name "*test*"` outside `node_modules`) and
found none. No code was executed; the extension requires a live Pi host and its behavioural claims
are read from the implementation, not from a run.

Not inspected in depth: the other seventeen extensions in the same package, its skills, commands, and
themes. They matter only for the packaging observation below.

## Mechanisms

### M1 — One-parameter multi-language edit tool

**Problem.** Pi's built-in `edit` exposes structured parameters. Every additional field costs schema
tokens in every request, and one edit per call costs a turn per file.

**Inputs.** A single `text` string. `prepareArguments` also accepts a bare string or an object whose
`text`, `patch`, `input`, or `content` key holds the payload, so several model-side spellings converge
on the same tool call.

**State.** None persisted. `buildPlan` dispatches on payload shape: a Codex/`apply_patch`-style patch
goes to `buildPatchPlan`, anything else to the row-script parser `buildRowPlan`. Both read current
file contents through a snapshot store keyed by resolved absolute path, so several operations against
one file compose within a call.

**Actions.** The row language supports `@REPLACE`, `@INS.PRE N`, `@INS.POST N`, `@INS.BEFORE`,
`@INS.AFTER`, `@APPEND`, and `@DEL N-M`, grouped under `[path]` file headers, with `+`/`-`/space row
markers and `@@` hunk separators. The patch language supports `add`, `delete`, and chunked `update`.

**Outputs.** A `PlannedFileChange[]` of kind `update | write | add | delete`, a combined diff, a
per-file unified patch, and a summary string naming each file and its kind.

**Failure behavior.** A parse or anchor-resolution failure aborts the whole call before any write.

**Authority.** The tool registers under the name `edit`, so it *replaces* Pi's built-in edit tool
rather than adding a sibling. Any host that loads the extension changes its mutation interface
globally for that session.

**Assumptions and costs.** The model must be conditioned to emit a marked row script; the ten
`promptGuidelines` entries are the conditioning, and they are themselves standing Model Context.
Because the payload is one opaque string, the schema cannot validate structure — every malformed edit
surfaces as a runtime parse error rather than a rejected argument.

### M2 — Preflight, then sequential apply

**Problem.** A multi-file edit that fails halfway leaves the tree in an unknown state.

**Inputs.** The parsed plan.

**Actions.** `preflightPlan` walks every change: for `add` it checks that the nearest existing ancestor
directory is writable; for `update` it re-runs the fuzzy matcher against the snapshot text to prove the
anchor resolves; for everything else it checks `R_OK | W_OK`. Only after preflight succeeds does
`applyPlan` iterate the same list and mutate, one file at a time, each inside Pi's exported
`withFileMutationQueue`. `write` and `delete` additionally re-read the file and compare against the
preflight snapshot, failing with `file changed since preflight`.

**Outputs.** A combined `UnifiedEditDetails` with per-file diffs and patches.

**Failure behavior — the material gap.** `applyPlan` is a plain `for` loop with no journal, no
rollback, and no partial-result envelope. If file 1 of 3 is written and file 2 fails its
changed-since-preflight check, or the abort signal fires between files, the tool throws. The thrown
error carries the failure message; it does not carry the list of files already mutated. The model and
the attending human learn that the call failed, not that the tree is now half-edited.

**Authority.** Filesystem writes with the host process's full rights.

**Assumptions and costs.** Preflight narrows but cannot close the window: it proves anchors resolve at
plan time, while the per-file checks at apply time are exactly what can fail after earlier files were
already written.

### M3 — Vendored fuzzy matcher

**Problem.** Pi's anchor-matching normalization is not part of its public API.

**Actions.** The file inlines Pi's edit-diff matcher core — Unicode NFKC normalization, smart-quote
and dash folding, non-breaking-space folding, trailing-whitespace trimming, line-ending detection and
restoration, BOM handling, uniqueness and overlap checks — and adds whole-line matching on top. The
header comment states this provenance explicitly.

**Failure behavior.** Divergence is silent. If Pi changes its matcher, this copy keeps its old
behavior and the same anchor can resolve differently under `edit` than under any other Pi path.

**Assumptions and costs.** A permanent maintenance obligation tied to an unpinned `"*"` peer
dependency on Pi.

### M4 — Path resolution without workspace containment

`resolveToCwd(cwd, path)` returns `resolvePath(normalized)` when the path is absolute and
`resolvePath(cwd, normalized)` otherwise. There is no check that the result stays inside `cwd`, and no
allowlist or denylist. A payload naming `/etc/...` or a `../...` escape is planned,
previewed, and applied like any other file. Containment is therefore delegated entirely to the host's
tool-approval behavior.

### M5 — Rich in-TUI preview

`renderCall` builds an incremental preview from streaming arguments, tolerating incomplete payloads
via `buildPreviewPlan`, and `renderResult` replaces the preview with the realized diff. This is the
part of the mechanism that most directly serves Human Attention: the attending human sees the combined
multi-file diff before approving the call. It depends on `@earendil-works/pi-tui` internals and on
Pi's exported `generateDiffString`, `generateUnifiedPatch`, and `renderDiff`.

## Implementation and test evidence

- **Implementation is real and complete.** All seven row operations, both edit languages, preflight,
  apply, diff generation, and both render paths exist in the inspected file. The claims in
  `README.md` line 53 match the code.
- **Automated test evidence is absent.** The repository contains no test file for this or any other
  extension. Every property above is read from source, not demonstrated by a passing check.
- **The author does hold measurement evidence of usage, not of correctness.** `analyze-edits.py` is a
  `uv`-runnable script that parses Pi session JSONL files and reports how often `edit` was invoked as
  `single`, `multi(N)`, `single+multi(N)`, or `patch`, broken down by file extension. That is evidence
  about which edit modes a model actually reaches for — useful, and a good example of measuring an
  interaction before changing it — but it says nothing about mutation correctness or partial-failure
  behavior.
- **The `CHANGELOG.md` records the design history**: an experimental edit tool (`274fe04`), a
  `multi-edit` extension replacing `edit` with batched edits and Codex-style patches, preflight
  validation added for both modes, then sequential same-file ordering and redundant-edit skipping. The
  progression shows convergence on ergonomics; no entry mentions transactionality or rollback.

## Pi Workbench baseline

**Implemented and exercised.** Pi Workbench uses Pi's built-in `edit` tool unchanged. Its own
extensions register only Workbench-specific tools: `extensions/context-checkpoint/` registers
`compact_and_continue`, and `extensions/subagent/` registers the attended child-Pi and durable-Worker
tools. `grep -rn "registerTool" extensions/` returns exactly those two files. The repository has no
edit-tool override, no vendored Pi matcher, and no multi-file mutation interface of its own. The
repository suite (`npm test`) passed during this review across eight `node --test` groups (189 tests,
0 failures) plus the model-routing resolver check; `node --test extensions/context-checkpoint/coordinator.test.mjs`
passed 6/6 separately, and is not part of `npm test`.

**Specified but unimplemented.** Everything that would give a multi-file edit its authority context is
specification, not code: the Run Controller and its `start`/`submit`/`inspect`/`watch` interface
([controller contract](../../contracts/controller.md)), Ship authority with attributable mutation
evidence (Decisions 52, 53, 66), the Repository Workspace lease and `land` operation, and typed
Episodes as the universal execution return interface (Decision 47). V1 has no Dispatch and no Ship
execution at all ([system overview](../../foundation/system-overview.md), V1 boundary).

**Maturity mismatch, stated plainly.** The source has a working, daily-used edit tool with no tests.
Pi Workbench has no edit tool of its own and a well-specified but unimplemented authority model around
mutation. Comparing them is comparing a running convenience against an unbuilt guarantee.

## Honest comparison

| Dimension | `unified-edit.ts` | Pi Workbench today |
| --- | --- | --- |
| Model Context cost of the edit surface | Better: one string parameter, though ten prompt guidelines partly repay the saving | Pi's default structured schema |
| Turn cost for multi-file changes | Better: several files per call | One built-in `edit` call per edit |
| Human Attention during approval | Better: combined multi-file diff preview before mutation | Pi's per-edit preview |
| Mutation attribution on failure | Worse: no rollback, no partial-outcome envelope, no list of already-written files | Pi's built-in single-file semantics; failure scope is one file |
| Path containment | Worse: absolute and parent-escaping paths resolve without workspace checks | Pi's built-in single-file mutation semantics; PI WEB additionally streams a per-file preview before execution |
| Compatibility with Pi | Worse: vendored private matcher, unpinned `"*"` peer dependency, replaces the `edit` name | Uses Pi's own implementation, so it cannot drift from it |
| Demonstrated correctness | Worse: no tests | Not applicable — Workbench ships no edit tool |
| Fit with specified Ship evidence obligations | Worse: incompatible with attributable mutation evidence as written | Consistent, because nothing has been built yet |

Where the source is genuinely better: the *interaction*. Fewer parameters, fewer turns, one reviewable
diff. Where Pi Workbench is better: it has not traded away mutation attribution, and its specified
Ship contract still demands it.

Where there is insufficient evidence: whether the ergonomic gain measurably improves outcome quality
or reduces Human Attention in real attended sessions. `analyze-edits.py` could produce that evidence;
no published run of it exists.

Testing my own biases: **novelty bias** — a concrete, in-daily-use implementation is persuasive, but
"it works for one user who watches every call" is not the same as "its failure semantics are
acceptable for delegated work." **Architecture bias** — Workbench's Ship/Episode specification is
elegant and unbuilt; it must not be used to dismiss a mechanism that demonstrably reduces turn cost
today.

## Unaccepted candidates

None of the following is accepted. Each is a proposal for a future owner decision.

### Unaccepted — experiment only after hardening: transactional multi-file edit

**Change.** Do not port `unified-edit.ts`. If multi-file edit ergonomics are wanted, specify the
mutation semantics first: either all-or-none application (write to temporaries, then commit, or
snapshot-and-restore on failure) or an explicit typed partial-outcome result naming every file
written, every file skipped, and the failure cause. Only then implement.

**Owner.** A new Workbench extension under `extensions/`, with the harness contract
([`docs/contracts/harness.md`](../../contracts/harness.md)) governing distribution. It must not live in
`packages/` unless it becomes a module with its own interface.

**Why it could improve the setup.** Fewer turns and one combined diff reduce both Model Context and
the number of separate approvals an attending human must give.

**Proving evidence.** Focused tests for the row parser, the patch parser, the matcher, path policy,
partial-failure reporting, and behavioral equivalence against Pi's built-in `edit` on a corpus of real
edits. Plus a measured before/after on turn count and edit-retry rate using an `analyze-edits.py`-style
session-JSONL analysis.

**Falsifier.** If measured turn count and retry rate do not improve materially, or if any partial
failure is observed without a complete written-file list, drop it.

**Must remain unchanged.** Pi remains the only model-worker harness (Decision 25). Ship-shaped
mutation must still be able to return attributable mutation evidence (Decisions 52, 53, 66). Nothing
here may pre-empt the Run Controller's ownership of landing.

### Unaccepted — reject: replacing Pi's `edit` tool by name

Registering a tool named `edit` silently changes the mutation interface for every tool call in the
session, including any future delegated Dispatch. A Workbench edit experiment should register a
distinctly named tool so both interfaces remain observable and comparable, and so an Episode can
record which one produced a mutation.

### Unaccepted — reject: installing the `mitsupi` package globally

`package.json` declares `pi.extensions: ["./extensions/*.ts"]`. Installing the package activates all
eighteen extensions, not the one mechanism under evaluation. That contradicts per-Dispatch capability
resolution (Decisions 51, 71) and the harness rule that availability does not place a capability in
every Model Context.

### Unaccepted — reject: vendoring Pi's private matcher

An unpinned `"*"` peer dependency plus a copied private matcher guarantees eventual silent divergence.
If a Workbench edit experiment needs the matcher, it should pin the Pi version it was verified
against and contract-test against Pi's own behavior, or press for a public API upstream — consistent
with the upstream-first posture in Decision 76.

### Unaccepted — adapt: workspace path containment as a policy, not a tool detail

Whatever mutation tool Workbench uses, managed path containment belongs to the future Repository
Workspace module (`lease`, `inspect`, `land`, `release`), not parser convenience code. V1 has no
workspace lease, so any Level 1 experiment must enforce its permitted path scope at the tool or host
boundary rather than defer safety to an unimplemented module.

### Unaccepted — adapt: measure edit interaction before changing it

`analyze-edits.py` is the cheapest transferable idea in this source: read the session JSONL that Pi
already writes and count which edit shapes the model actually produces. A Workbench equivalent would
turn edit-tool speculation into Primary Evidence, and would feed `skills/compound/` as a Learning
Candidate rather than as an assumption.

## Open questions

1. What partial-outcome envelope would let a Workbench Episode remain truthful after a multi-file edit
   fails halfway — a list of written paths with content hashes, or a refusal to report success at all?
2. Is all-or-none application achievable without a workspace-level snapshot, given that Pi's file
   mutation queue is per-file?
3. Does the measured turn-count and retry-rate saving justify a second mutation interface, or is the
   real saving in the combined *preview* rather than in the combined *write*?
4. Should a Workbench edit tool ever accept an absolute path, or should containment be mechanical at
   the tool boundary in V1 given that no Repository Workspace lease exists yet?
5. If Pi's built-in `edit` later gains multi-file support upstream, does any Workbench-local edit tool
   remain justified at all?

## Confidence and limitations

High confidence in the implementation findings: the mechanism file was read in full at a pinned
revision, and the absence of tests was checked by repository-wide search. High confidence that
`applyPlan` has no rollback and no partial-outcome envelope, and that `resolveToCwd` does not contain
paths — both are short, unambiguous functions.

Low confidence in any claim about real-world outcome quality. Nothing here was executed, no session
data was analyzed, and the author's own usage frequency, failure rate, and satisfaction are unknown.
The comparison against Pi Workbench compares a running tool against a specification; the Workbench
side of every mutation-authority row is unimplemented and must not be credited as a working
alternative.
