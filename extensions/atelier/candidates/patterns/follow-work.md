# Follow ongoing work

**Pick when:** the human must supervise or resume a long operation, especially at costly checkpoints.

**Hierarchy:** measured current observation → one next action and its owner → checkpoint criteria and
local Kernel Decision → current outputs → prior attempts and cost detail. Group running / ready to judge /
Decisions open only from real observations. Historical receipts are not a live status feed.

**Compose:** [observation-stamp](../components/observation-stamp/README.md) first;
[attempt-timeline](../components/attempt-timeline/README.md) below for history; optionally
[claim-card](../components/claim-card/README.md) when a finished output needs hands-on verification.
Use Kernel Requests for typed jobs, not a second queue or workflow engine.

**Why:** a page claimed readiness after only HTTP 200, showed an “Unknown” wall, elapsed time from a frozen
ledger and other agents' git changes. Thomas ordered it deleted. He later asked for real-start elapsed,
PID-backed liveness and report-only costs ([PL §1, R1–R4](../SOURCES.md)). ME T3 records returning after
hours and asking status; the grading request was buried in chat.

**Does not fit:** historical process audit or long-term quality comparison. The page observes work;
project handlers still validate jobs, own concurrency and prevent destructive stop/restart behavior.
