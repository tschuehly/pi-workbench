# Papercuts Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

## Status of this ledger

Research only. Nothing here is accepted. No recommendation, decision, experiment, or roadmap item
follows from this file, and no owner approval is claimed or implied. The candidate classifications
below are unaccepted options recorded for later deliberation. Settled decisions belong only in
`docs/foundation/decisions.md`, after the owner settles them.

## Verdict

`papercuts` is the most carefully engineered source in this set relative to its size: a 2,551-line
Rust CLI with a machine-readable contract, append-only JSONL storage, advisory locking, atomic and
rollback-safe batch appends, content-addressed IDs, torn-line self-healing, and bounded, redacted
evidence — backed by ~53 integration tests plus its own dogfooding log.

Its transferable insight is narrow and real: **friction evaporates unless it is recorded at the moment
it happens, in one line, without leaving the task.** Its cost is equally real: it introduces a second
append-only record in the repository, and its deduplication is exact-record only, so recurring
friction accumulates as distinct entries rather than a weighted signal.

Two attributions are **unverified**: the README's claim that the idea comes from a tool Steve Ruiz
built, and the DODOREACH thread's claim of a private Papercut tool. Neither was inspectable.

## Exact source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/treygoff24/papercuts` |
| Revision inspected | `3f3776b04558d9c8342191938cb8bf7bedb3d745` (branch `main`, HEAD at review) |
| Commit date | 2026-07-16 17:36:59 UTC (`-0400`), "Resolve exa binary version-drift cut — installed 0.4.0" |
| Crate version | `papercuts` 0.2.0, Rust edition 2024 |
| Released | 0.1.0 on 2026-07-10; 0.2.0 on 2026-07-16 (`CHANGELOG.md`) |
| License | MIT, `Copyright (c) 2026 Trey Goff` |
| Dependencies | `clap` 4, `jiff` 0.2, `serde`/`serde_json` 1, `sha2` 0.10, `thiserror` 2, `libc` 0.2 |
| Dev-dependencies | `assert_cmd` 2, `tempfile` 3 |
| Source size | `src/` 2,551 Rust lines across 12 files; `tests/cli.rs` 2,339 lines; `tests/manifest_checker.rs` 198 lines |

## Mechanisms

### M1 — One-line capture at the moment of friction (`papercuts add`)

- **Inputs:** free text (argument or stdin via `add -`), `--tag`, `--severity`
  (`minor` default | `major` | `blocker`), and optional bounded evidence: `--cmd`, `--exit`,
  `--stderr-file`, `--evidence`.
- **State:** an append-only JSONL file — `.papercuts.jsonl` at the repo root by default,
  `PAPERCUTS_FILE` if set, otherwise `~/.papercuts/log.jsonl` outside a git repo.
- **Actions:** resolve the agent identity (flag → `PAPERCUTS_AGENT` → detection of `CLAUDECODE`,
  `CODEX_*`, `CURSOR_*` → `unknown`), sort tags, compute a content-addressed ID, then under an
  exclusive advisory lock re-read and fold the file, return the existing record if the ID is already
  present, else append.
- **Outputs:** one JSON envelope on stdout: `{"ok":true,"data":{"changed":…,"record":{…}},"meta":{…}}`
  with `contract`, `file`, `agent_source`, and warnings. Records carry `kind`, `id`, `ts`, `agent`,
  `text`, `tags`, `severity`, `cwd`, `repo`, and optional `evidence`.
- **Failures:** duplicate IDs return the existing record with `changed:false` and a
  `duplicate_cut` warning (explicitly noting later evidence was **not** stored); `--dry-run` warns and
  appends nothing; text starting with `RESOLUTION`/`RESOLVED` warns to use `resolve` instead;
  `--stderr-file` rejects non-regular files, non-UTF-8, and inputs over 1 MiB.
- **Authority:** none over the project. It appends to its own journal and nothing else.

### M2 — Content-addressed identity and its dedup limit

- `compute_id` SHA-256s length-prefixed `ts`, `agent`, `text`, `severity`, and sorted joined `tags`,
  then emits `pc_` + the first 6 bytes as hex (15 chars).
- Because `ts` is part of the hash, **dedup is exact-record replay only**: identical complaints filed
  at different times produce different IDs. This makes merge-union duplicates and retried writes safe
  (its actual design goal), but it does **not** collapse recurring friction into one weighted entry.

### M3 — Journal semantics, never rewritten

- `resolve <id...>` appends `resolve` events; the log is a journal, not a database. Unique ID prefixes
  are accepted, multiple IDs resolve atomically, already-resolved IDs produce warnings, and a failed
  batch append is rolled back so partial writes cannot corrupt the log.
- `fold_bytes` reconstructs current state: it detects a torn tail (no trailing newline), counts
  malformed lines, duplicate cuts, duplicate resolves, and unknown kinds, and validates timestamps —
  all as warnings rather than hard failures.

### M4 — Review surface (`papercuts list`, `doctor`, `schema`)

- `list` returns open items severity-first then newest, filterable by `--since` (RFC3339 or relative
  `7d`/`12h`) and truncated to `--limit`; `--format md` renders a human digest.
- `doctor` validates the file, recomputes content-addressed IDs, detects conflict markers, and reports
  a discovered journal as unhealthy when Git ignores it. `schema` emits the complete machine contract
  — commands and flags with read-only/appends annotations, env vars (`PAPERCUTS_FILE`,
  `PAPERCUTS_AGENT`, `PAPERCUTS_NOW`), record shapes, error codes, and exit codes (0 success · 1 doctor
  findings · 2 usage · 65 bad or ambiguous input · 66 not found · 70 internal · 74 I/O · 75 lock
  timeout, retryable · 77 permission denied · 78 config). Empty results are exit 0. The gitignore
  finding creates a real tension with the README's otherwise neutral presentation of private mode.
- stdout is data only; structured errors go to stderr with stable codes and a paste-ready
  `suggested_fix`.

### M5 — Bounded, redacted evidence

- Redaction is a multi-strategy scanner: it parses sensitive key assignments and CLI options,
  recognizes authorization schemes, finds high-entropy spans while suppressing path and URL false
  positives, strips URL userinfo, merges overlapping spans, and preserves UTF-8 boundaries. Stored
  stderr is truncated to 4 096 UTF-8 bytes after sanitization.
- The README and changelog both state redaction is **best-effort** and warn against feeding raw
  environment dumps — an honest limitation rather than a safety claim.

### M6 — Adoption instruction as prompt text

- The README supplies a paste-ready `CLAUDE.md`/`AGENTS.md` block instructing the agent to file
  friction *before moving on* and to *keep working*, with severity guidance and a pointer to
  `papercuts schema` for the full contract. The capture behavior is therefore standing prompt context,
  not a harness mechanism.

## Implementation and test evidence

- `tests/cli.rs` contains **53** `#[test]` functions (2 339 lines) plus 2 in
  `tests/manifest_checker.rs`; `src/` adds 9 unit tests (`cli.rs` 4, `error.rs` 2, `store.rs` 2,
  `commands/add.rs` 1), several of which are table-driven (for example `fold_matrix` and a batch-append
  rollback test that reconstructs a torn tail after a partial write failure).
- **Not executed here.** No Rust toolchain is available in this environment (`which cargo` fails), so
  counts are static and no test run was observed.
- **Dogfooding evidence in-repo:** `.papercuts.jsonl` holds 62 records — 55 cuts (47 minor, 8 major)
  and 7 resolves — filed by `codex` (29), `claude-code` (22), `probe` (2), `claude-opus` (1), and
  `codex-wave2` (1). The first record is a real workflow defect: delegate lanes failing on quota and
  an expired token, both surfacing as a generic `harness_error`, costing ~30 minutes of diagnosis.
  The repository also carries a design doc, remediation plans, wave acceptance reviews, a
  fresh-eyes consolidated review, and a model-performance journal.
- **Ratio worth noting:** 55 filed versus 7 resolved. The source demonstrates that capture is cheap
  and abundant; it does not demonstrate that resolution keeps pace.

## DODOREACH private claim versus public analogue, and the Steve Ruiz attribution

- The DODOREACH thread describes a **private** Papercut tool. It was not inspectable: no repository,
  no code, no tests, no usage data. Nothing in this ledger is evidence about it.
- `treygoff24/papercuts` is a **public reconstruction of the same idea** by a third party. It stands on
  its own evidence and is not a copy or proxy of the DODOREACH implementation.
- The README states: "The idea comes from [a tool Steve Ruiz built](https://x.com/steveruizok) for his
  own repos". **This attribution is unverified.** The link points to an X profile, not to a tool, a
  repository, or a post describing one; no primary artifact by Steve Ruiz was inspected. The
  accompanying claim — that once agents had a place to complain they immediately surfaced real
  workflow defects — is likewise an unverified secondhand report, not evidence from this repository.
- What *is* evidenced is narrower: this repository's journal contains 55 cuts and 7 resolve events,
  attributed to model-agent names. It does not establish who made the underlying resolution judgment.

## Pi Workbench baseline: implemented versus specified

| Workbench capability | Status at this review |
| --- | --- |
| In-the-moment friction capture | **Absent.** No `add`/`list`/`resolve` friction surface exists in `packages/`, `extensions/`, or `skills/`; "friction" appears in Workbench docs only as prose. |
| Session-level improvement evaluation | **Implemented as a manual skill:** `skills/compound/` evaluates one meaningful session against Evaluation Questions, commissions a fresh independent evaluator, and writes user-local reports under `~/.pi-workbench/compound/sessions/<session-id>/`. It explicitly creates "no Run authority, typed Learning Candidate, or automatic promotion." |
| Learning Candidate | **Specified only** (`docs/foundation/vocabulary.md`): a source-backed proposal to promote a lesson at the narrowest useful scope. No typed implementation. |
| Evaluation Question | **Specified** as a stable identified empirical question; used in practice by `skills/compound/` against `docs/plans/subagent-worker-iterative-improvement.md`. |
| Authoritative state | **Split by maturity:** `packages/workstream-store/` implements authoritative Workstream state. The Run Controller and authoritative Run state are specified Level 4 behavior; `packages/controller/` is not implemented. |
| User-local working evidence convention | **Implemented** by `skills/compound/`: reports and bounded evidence manifests live under `~/.pi-workbench/`. Raw transcripts, machine-local paths, and authentication material are forbidden from the repository, not categorically absent from user-local evidence. |

The gap is timing, not analysis. `skills/compound/` is a deliberate, after-the-fact, comparatively
expensive evaluation of a whole session. Nothing captures a five-second observation while the evidence
is still fresh, and by evaluation time the detail is usually gone.

## Honest comparison

**Where `papercuts` is better than the current Workbench setup**

- Latency to record. One shell line, no context switch, explicit "don't stop working" guidance.
  Workbench's cheapest equivalent is a full compound evaluation after the session.
- Agent-first contract discipline: data-only stdout, one envelope per command, stable error codes,
  documented exit codes, a `suggested_fix`, and a self-describing `schema` command. This is a better
  machine interface than most Workbench-adjacent tooling exposes.
- Concurrency and durability engineering: advisory locking, atomic appends, batch rollback,
  self-healing torn lines, deterministic IDs, and a reproducible-clock override for tests.
- Honest bounds: redaction is declared best-effort, stderr is size-capped, evidence is refused rather
  than silently truncated at the input boundary.

**Where Pi Workbench is better**

- Judgment quality. `skills/compound/` commissions a *fresh, provider-independent* evaluator against
  bounded evidence and requires observation, assessment, evidence, confidence, cumulative effect, and
  next observation per question. A papercut is one agent's unreviewed complaint with no adjudication.
- Promotion discipline. Workbench distinguishes an observation from a Learning Candidate and requires
  explicit promotion at the narrowest useful scope. `papercuts` has exactly two states, open and
  resolved, and no notion of scope, expiry, or supersession.
- State boundaries. Workbench keeps implemented Workstream state separate from user-local working
  evidence and specifies the same separation for future Run state. A committed `.papercuts.jsonl`
  would be a separate non-authoritative record with undefined ownership, retention, promotion, and
  relationship to both current Workstream state and future Run state.

**Where evidence is insufficient**

- Whether friction capture changes outcomes. The source shows 55 filed and 7 resolved; it does not
  show sessions improving, Human Attention saved, or defects prevented.
- Whether agents file *useful* friction rather than noise, and how duplicates behave over months given
  timestamp-inclusive IDs.
- Whether committed friction helps or hinders collaboration. The source offers both modes and no data.

## Unaccepted candidates

None of the following is accepted, scheduled, or approved.

- **Adapt (candidate):** a minimal user-local friction journal with `add`/`list`/`resolve`, consumed as
  *optional* evidence by `skills/compound/`. User-local first (`~/.pi-workbench/`), matching the
  existing compound convention; repository-local mode would need a separate decision about
  collaboration and noise. Owner: harness/skill layer. Falsifiers to watch: time to record, repeated
  friction rate, duplicate rate, actionable fixes, secret-redaction failures, Human Attention saved,
  accepted Learning Candidates.
- **Adapt (candidate), interface only:** the agent-first CLI contract — data-only stdout, one envelope,
  stable error and exit codes, `suggested_fix`, and a self-describing `schema` command — as a shape for
  any future Workbench CLI. This is an interface convention, not a new store.
- **Reject (candidate):** installing the `papercuts` binary and committing `.papercuts.jsonl` to
  Workbench. It adds a Rust toolchain dependency and a separate repository-visible working record
  whose ownership, retention, and relation to current Workstream and future Run state are undefined.
- **Reject (candidate):** the README's standing prompt block as-is. "File it and push through" is
  always-on instruction weight in every session; Workbench should decide deliberately whether that
  belongs in standing context or in a skill.
- **Experiment (candidate):** before building anything, log friction manually into one user-local file
  for five to ten attended sessions and see whether the entries would have changed any decision. If
  they would not, the mechanism dies cheaply.

## Open questions

1. What is the smallest user-local representation of friction that supports deduplication, evidence,
   resolution, expiry, and later evaluation *without* becoming a second authoritative ledger?
2. How should recurring friction be counted, given that timestamp-inclusive content addressing makes
   every recurrence a new record? Should recurrence weight be derived at review time instead?
3. Who resolves entries, and what prevents the 55-to-7 pattern — an accumulating backlog that becomes
   noise nobody reads?
4. Should friction ever be committed to the repository, or should collaboration receive only accepted
   Learning Candidates and the fixes themselves?
5. What redaction guarantee is required before an agent may attach command output as evidence, given
   that best-effort redaction is explicitly not a guarantee?
6. Does friction capture belong in the same loop as `skills/compound/`, or is it a separate sensor
   whose output is merely one input among Primary Evidence?

## Confidence and limitations

- **High confidence:** revision, license, dependencies, command surface, record and envelope shapes,
  ID construction, locking and fold semantics, evidence bounds and redaction posture, exit-code
  dictionary, static test counts, and the `.papercuts.jsonl` statistics (62 records: 55 cuts, 7
  resolves; severity and agent breakdown computed from the file).
- **Medium confidence:** the assessment that capture latency, not analysis quality, is the Workbench
  gap. Reasoned from `skills/compound/` and the absent friction surface, not measured.
- **Unverified:** the Steve Ruiz attribution and the accompanying "agents immediately surfaced real
  defects" claim; DODOREACH's private Papercut tool in every respect; and any claim that friction
  capture improves outcomes.
- **Not executed:** the Rust test suite. No toolchain was available, so all test counts are static and
  no passing run was observed.
