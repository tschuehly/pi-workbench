# Level 1 real Pi RPC smoke evidence

Date: 2026-08-03

The adapter launched one real persistent Pi RPC child from this repository using a fresh resolver-produced `implementation` binding (`openai-codex/gpt-5.6-sol`, effort `medium`). The child returned the requested sentinel `LEVEL1_RPC_SMOKE_OK`, emitted a terminal `success` observation, and reported a non-empty Pi session identifier. The machine-local identifier and session file are intentionally not recorded in the repository.

A second real child started a long-running Bash tool. Cancellation was requested after the normalized `tool_start` observation; the adapter confirmed process termination and both the cancellation receipt and terminal result reported `cancelled`.

These smokes cover resolved launch, runtime binding verification, prompt/result streaming, standard Pi session persistence, and attended cancellation. Deterministic fake-RPC tests additionally cover stale binding rejection, capability ceilings, runtime mismatch, and concurrent execution cancellation.

On 2026-08-11, after adding the 15-second startup handshake deadline, the source adapter launched fresh resolver-bound Anthropic and OpenAI children sequentially. Both verified their binding, returned `HEALTHY`, and reported a session identifier. Fake-RPC regressions prove a missing initial state response fails before prompt submission, a late response cannot race the startup timeout into a prompt, launched tasks run until completion or cancellation, and unconfirmed termination remains `outcome_unknown`.

On 2026-09-20, fresh `challenge` bindings for an OpenAI author selected `anthropic/claude-fable-5-1` and `github-copilot/grok-4.6`, both at `high` effort. The second binding excluded `anthropic`. Both real RPC children returned `ROUTING_SMOKE_OK`, verified provider/model/effort before prompting and at completion, and retained the author, selected family, and applicable exclusions in their terminal receipts. This proves distinct-family launch and receipt propagation, not review quality or automatic panel assembly. Full `npm test` passed, including resolver regressions and adapter/tool boundary tests.
