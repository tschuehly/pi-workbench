# Workstream Store read cache and compact writes — 2026-10-05

Baseline `6c8fdf81064be26759af3f470f2a082d9b2cb1e6` vs the candidate in this commit (WS-001 locked
trusted-read cache; whitespace-only part of WS-002). Raw numbers: [`store-results.json`](store-results.json).
Harness: [`store-bench.mjs`](store-bench.mjs).

## What changed

- `FileWorkstreamAdapter` keeps the last validated parsed file and lends it only to the Store's own
  `inspect`, `list`, and `watch` (package-internal `TRUSTED_READ` symbol option). Reuse happens under the
  existing lock and only while the open file keeps the same dev, inode, size, and nanosecond mtime and
  ctime, checked before and after the read. Change, deletion, corruption, read errors, and every write
  attempt drop it; a write never seeds it.
- Public `transaction(..., { readOnly: true })` and custom or in-memory adapters are unchanged: fresh,
  mutable, discarded input.
- Writes are compact `JSON.stringify(database)`; same `formatVersion: 1`, no migration or startup rewrite.
- Unchanged: lock directory protocol, read/write exclusion, temp-file sync then rename, idempotency
  fingerprints, event retention and replay, cloned outputs.

## Method

- A private copy of the real 9.4 MB store (65 Workstreams, 1,000 retained events) under `PI_TMP`. Every
  measurement re-copies it into a scratch directory; the live store and adapter were never called.
- Each round runs baseline and candidate in fresh Node processes, alternating which goes first.
- `single`: one cold list, then 30× warm list / inspect (largest open Workstream) / replay watch, and 5×
  snapshot watch; then 10× append plus inspect.
- `launch`: 8 fake-host blank launches through `WorkstreamSessionCoordination`. The first is cold.
- `contention8`: 8 processes start together. Each runs 25 iterations of list, inspect, and watch, and
  appends every fifth iteration. The default `lockTimeoutMs` is 5 s.
- `writes`: a separate append-only A/B with 12 rounds.
- Lock and parse times come from wrapping `acquireLock` and `readDatabase`.
- Hardware and load: Node v26.7.0 on darwin-arm64, on a shared host. The 1-minute load average was
  44→87 during the full run and 36→31 during the writes run.

```sh
B=$PI_TMP/bench; mkdir -p $B/baseline
cp ~/.pi-workbench/workstreams/workstreams.json $B/workstreams.json   # private copy only
git archive 6c8fdf81064be26759af3f470f2a082d9b2cb1e6 packages/workstream-store/src | tar -x -C $B/baseline
ARGS="--store $B/workstreams.json --work $B/runs --baseline-src $B/baseline/packages/workstream-store/src \
  --candidate-src packages/workstream-store/src --coordination packages/workstream-session-coordination/src/index.js"
node docs/research/performance/2026-10-05/store-bench.mjs $ARGS --rounds 6 --out $B/r6.json
node docs/research/performance/2026-10-05/store-bench.mjs $ARGS --suite writes --rounds 12 --out $B/writes12.json
```

## Results (ms, p50 / p95, baseline → candidate)

| Operation | Baseline | Candidate |
| --- | --- | --- |
| warm list (n=180) | 258 / 742 | 34 / 294 |
| warm inspect (n=180) | 234 / 649 | 5.9 / 202 |
| warm replay watch (n=180) | 231 / 688 | 1.9 / 120 |
| warm snapshot watch (n=30) | 233 / 1000 | 140 / 329 |
| whole-file reads after cold, per process | 95 | 0 |
| fake-host warm launch (n=42) | 2718 / 5820 | 2548 / 4823 |
| fake-host cold launch (n=6) | 3688 / 5558 | 3620 / 5465 |
| 8-proc list (n=863 / 1118) | 839 / 4580 | 115 / 3437 |
| 8-proc inspect (n=746 / 1044) | 412 / 3810 | 5.4 / 3298 |
| 8-proc watch (n=656 / 999) | 376 / 4010 | 1.7 / 1942 |
| 8-proc append (n=101 / 177) | 1007 / 4638 | 655 / 3666 |
| 8-proc lock wait (n=2930 / 3550) | 299 / 5017 | 0.22 / 5005 |
| 8-proc `STORE_BUSY` (6 rounds) | 564 | 212 |
| writes A/B: cold list (n=12) | 94 / 202 | 105 / 212 |
| writes A/B: append, no prior read (n=48) | 175 / 349 | 169 / 291 |
| writes A/B: append after trusted read (n=48) | 185 / 397 | 174 / 381 |
| written file bytes | 9,406,124 | 8,147,502 (−13%) |

Parity holds in every round:

- list, inspect-all, replay-watch, and snapshot-watch digests are identical;
- post-append state and exact-retry receipt digests are identical;
- each version reads the other's written file with the same digests and retry receipt.

## Review correction (not included in the timings above)

Independent review found that valid top-level JSON with a corrupt ledger stayed cached after projection failed. A new regression failed on that behavior; transactions now evict the generation on callback failure. Trusted Store readers also avoid a second output clone: their callbacks already clone the result, while public/write transactions retain their clone.

The parent reran Store, coordination and launch checks: **64 passed**, no failures or skips. The original timings above predate these corrections; final controlled comparisons remain pending.

## Limits

- Warm reads drop from a whole-file parse to an open plus `fstat`. Launch improves only about 6–17%,
  because appends dominate it: each append still parses, validates, stringifies, and fsyncs 8–9 MB.
  Warm reads alone do not make the whole launch 2× faster.
- In the full run (load average about 87), `single` append p50 went 680 → 1002 and cold list 482 → 1053,
  with p95 at 2115 → 1688 and 863 → 1335. The isolated 12-round writes A/B did not reproduce this
  (append is neutral to faster; cold list differs by 11 ms at n=12). Host load is a possible explanation,
  not proof that regressions are absent; final controlled cold/write comparisons must resolve this.
- Contention p95 still sits near the 5 s lock timeout in both variants, and `STORE_BUSY` still occurs.
  The candidate has fewer busy failures because readers hold the lock briefly. Lock recovery and
  lock-free reads are out of scope.
- The cache lives in each process and needs nanosecond timestamps. On coarse-timestamp filesystems, an
  in-place, same-inode, same-size rewrite that bypasses the lock could go unnoticed.
