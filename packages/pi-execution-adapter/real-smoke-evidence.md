# Level 1 real Pi RPC smoke evidence

Date: 2026-08-03

The adapter launched one real persistent Pi RPC child from this repository using a fresh resolver-produced `routine-execution` binding (`openai-codex/gpt-5.6-sol`, effort `medium`). The child returned the requested sentinel `LEVEL1_RPC_SMOKE_OK`, emitted a terminal `success` observation, and reported a non-empty Pi session identifier. The machine-local identifier and session file are intentionally not recorded in the repository.

A second real child started a long-running Bash tool. Cancellation was requested after the normalized `tool_start` observation; the adapter confirmed process termination and both the cancellation receipt and terminal result reported `cancelled`.

These smokes cover resolved launch, runtime binding verification, prompt/result streaming, standard Pi session persistence, and attended cancellation. Deterministic fake-RPC tests additionally cover stale binding rejection, capability ceilings, runtime mismatch, and the atomic concurrency cap.
