# Prompt-Cache Economics: Compaction vs. Keepalive Pings

## Scope

Investigates how Pi Workbench should become more prompt-cache-aware, and whether it is cheaper
to compact context more often or to send cache-renewal ("keepalive") pings during idle gaps.
Extended on 2026-08-08 with the attended child-execution question: whether long subagent and
worker dispatches should block the lead in the foreground, run in the background under
monitoring, or report back periodically.
Checked against Anthropic, OpenAI, and Google Gemini first-party documentation (fetched
2026 vintage docs directly, not summaries) and against Pi's own source
(`@earendil-works/pi-coding-agent` installed at
`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`, version resolved via its
`node_modules/@earendil-works/pi-ai` dependency).

## Provider behavior, cited

### Anthropic (Claude Messages API)

- Prompt caching is opt-in per content block via `cache_control: {"type": "ephemeral", "ttl": "5m" | "1h"}`; default TTL when unspecified is 5 minutes.
  - Source: [Anthropic prompt caching docs](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)
- "By default, the cache has a 5-minute lifetime. The cache is refreshed for no additional cost each time the cached content is used." Lifetime is measured from **request start**, not response end; a 4-minute-long response leaves only ~1 minute before the cache expires for a follow-up. — same source.
- Explicit vendor guidance on keepalive pings: "Keep in mind that the cache TTL still applies. For the default 5-minute cache, send a new pre-warm request at least every 5 minutes to keep the cache warm. For longer gaps between user requests, use the 1-hour cache duration instead." This is a first-party endorsement that no-op/pre-warm pings are a supported, intended usage pattern. — same source.
- Pricing multipliers (per 1M tokens, relative to base input price): 5-minute cache **write** = 1.25× base input; 1-hour cache write = 2× base input; cache **read** = 0.10× base input (i.e., a 90% discount). — same source.
- Minimum cacheable prefix length is model-specific. Current examples include 1,024 tokens for Opus 4.8 and Sonnet 4.5/4.6/5, 2,048 for Opus 4.7, and 4,096 for Opus 4.5/4.6 and Haiku 4.5. Shorter prompts cannot be cached even if marked. — same source.
- Up to 4 cache breakpoints are allowed per request, and cache lookup follows the block hierarchy tools → system → messages. Combining automatic and explicit caching does not add a second identical marker when the last block already has the same TTL; ordinary cache reads remain billed at the cache-read rate. — same source.
- For **concurrent** requests: "a cache entry only becomes available after the first response begins. If you need cache hits for parallel requests, wait for the first response before sending subsequent requests." Fan-out workers issuing the same prefix in parallel will not benefit from each other's cache write; only the second wave onward benefits. — same source.
- No manual cache-clear API exists; entries just expire after TTL of inactivity. — same source.

### OpenAI (Chat Completions / Responses API)

- Caching is automatic (no explicit markers needed pre-GPT-5.6) for prompts ≥1,024 tokens; the prefix is hashed (first ~256 tokens) and routed to a machine that recently served it, optionally pinned further via `prompt_cache_key`.
  - Source: [OpenAI prompt caching guide](https://platform.openai.com/docs/guides/prompt-caching)
- Minimum cacheable prefix: 1,024 tokens is a strict minimum on GPT-5.6+; on GPT-5.5 and earlier it "can range from 1,024 to 2,048 tokens" and near-threshold prompts "may not be cached consistently." — same source.
- Retention/TTL: legacy in-memory policy holds cached prefixes "5 to 10 minutes of inactivity, up to a maximum of one hour" in volatile GPU memory. GPT-5.6+ models use `prompt_cache_options.ttl` (only supported value: `30m`, also the default) as a **minimum** lifetime guarantee — "OpenAI may retain it longer," not a hard eviction point. Extended/24h retention exists via `prompt_cache_retention` on pre-5.6 models, offloading KV tensors to GPU-local storage, "up to a maximum of 24 hours." — same source.
- Pricing: cache writes were **free** before the GPT-5.6 family; on GPT-5.6+ family, cache writes cost 1.25× the uncached input rate (matching Anthropic's 5-minute-write multiplier). Cache-read discount for `gpt-4o` verified directly from OpenAI's pricing table data: input $2.50/M, cached input $1.25/M — a 50% discount (not Anthropic's 90%).
  - Source: [OpenAI pricing page](https://platform.openai.com/docs/pricing) (`gpt-4o` row: input 2.5, cached 1.25, output 10, per 1M tokens).
- OpenAI's own optimization guidance: "Maintain a steady stream of requests with identical prompt prefixes to minimize cache evictions and maximize caching benefits." This is directionally the same advice as Anthropic's pre-warm recommendation, but **OpenAI's docs never use the words "ping," "pre-warm," "keepalive," "warm," "dummy," or "no-op,"** and never describe a minimal/empty request pattern — the guidance is about request cadence, not about issuing synthetic no-op calls. Treat "OpenAI explicitly endorses no-op pings" as **unsupported by primary source**; only "keep steady traffic on the same prefix" is documented.
- Cache routing is best-effort and per-machine; unlike Anthropic there is no user-visible TTL extension mechanism for the 30m/legacy policies beyond continuing to send matching-prefix traffic.

### Google Gemini

- **Implicit caching** (Gemini 2.5+ and 3.x models) is on by default, fully automatic, with savings passed through automatically; there is no user-controlled TTL, breakpoint, or renewal mechanism at all.
  - Source: [Gemini API implicit/explicit caching docs](https://ai.google.dev/gemini-api/docs/generate-content/caching)
- Implicit-cache minimum input token counts (model-specific table from the same doc): Gemini 3.5 Flash 4096, Gemini 3.1 Pro Preview 4096, Gemini 2.5 Flash 2048, Gemini 2.5 Pro 2048. To increase implicit hit odds, put large/common content at the start of the prompt. — same source. No published TTL for implicit caching was found (uncertain/unpublished).
- **Explicit caching** (`caches.create`) is a distinct, opt-in, billed resource: "If not set, the TTL defaults to 1 hour... There are no minimum or maximum bounds on the TTL," and billing has three components — cached-token rate (read), a **separate storage fee billed per hour of TTL** ("Storage duration: ... billed based on the TTL duration of cached token count"), and normal non-cached input/output. — same source.
- Concrete pricing sample (Gemini 2.5 Flash, paid tier, per 1M tokens): input $0.30, context-caching (read) $0.03 (text/image/video) — a 90% discount matching Anthropic's ratio — plus a **flat $1.00 per 1,000,000 tokens per hour storage fee**, charged regardless of whether the cache is read again.
  - Source: [Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing) (`gemini-2.5-flash` row).
- Structural implication: Gemini explicit-cache "keepalive" is not free like Anthropic's — extending or refreshing an explicit cache's TTL keeps accruing the hourly storage charge whether or not you send traffic against it, and Google's docs describe TTL as something you set once at creation/update time, not something refreshed by traffic the way Anthropic's is. This makes Gemini economically closer to "pay for wall-clock retention" than "pay to touch."

## Pi's current cache posture (source-verified)

- Pi's AI layer (`@earendil-works/pi-ai`, vendored under `pi-coding-agent/node_modules`) defaults `cacheRetention` to `"short"` and applies Anthropic-style `cache_control` markers automatically (`cacheControlFormat: "anthropic"`) to the system prompt, the last tool definition, and the last user/assistant/tool-result block, unless overridden.
  - Source: `dist/api/anthropic-messages.js` (`getCacheControl`, `convertTools`) and `dist/types.d.ts` (`CacheRetention`, `cacheRetention` option, `cacheControlFormat`).
- Pi supports `cacheRetention: "long"` which maps to Anthropic's 1-hour TTL only if the model's compat flags mark `supportsLongCacheRetention` (default true); an env var `PI_CACHE_RETENTION=long` is a documented backward-compatible override.
  - Source: `dist/api/anthropic-messages.js` (`resolveCacheRetention`).
- Pi's cost model already encodes the provider multipliers verified above: `cacheWrite` billed at the model's `cost.cacheWrite` rate (1.25× input for short writes) and, when `cacheWrite1h` is present, at `2×` base input for the long-TTL portion; `cacheRead` billed at `cost.cacheRead` (10% of input for Anthropic models in the shipped catalog, e.g. Claude Opus 4.5: input 5, cacheRead 0.5, cacheWrite 6.25 per MTok).
  - Source: `dist/models.js` (`calculateCost`), `dist/providers/data/anthropic.json`.
- Pi already instruments **cache waste** — a per-turn "cache miss" detector compares the current prompt's token volume against the previous turn's, and if tokens that should have been a cache read were instead billed as fresh input/write, it computes the excess cost at `(paid rate − read rate) × missed tokens`. Its built-in constant documents Anthropic's TTL: `CACHE_TTL_MS = 5 * 60 * 1000` ("Anthropic's default cache TTL is 5 minutes").
  - Source: `dist/core/cache-stats.js` (`detectMiss`, `CACHE_TTL_MS`, `NOISE_FLOOR_TOKENS = 1024`).
- This instrumentation is currently **surfaced only in the interactive TUI**: a transcript notice ("Cache miss after Nm idle" / "Cache miss after model switch") gated at ≥20,000 missed tokens or ≥$0.10, and a `/session` command summary ("Cache Re-billed: $X (N tokens, M misses)"). It is not exposed as a structured event, SDK field, or exported metric.
  - Source: `dist/modes/interactive/interactive-mode.js` (`maybeShowCacheMissNotice`, `addCacheMissNotice`, `handleSessionCommand`).
- Compaction and branch-summarization requests intentionally use fresh routing session IDs and disable prompt-cache writes where the provider allows it, "because these one-off prompts are unlikely to be reused" — i.e., Pi already treats compaction as cache-hostile by design, not cache-neutral.
  - Source: `docs/compaction.md` (Pi's own docs), corroborated by `dist/core/compaction/compaction.js` module boundary.
- No keepalive/pre-warm/no-op ping mechanism exists anywhere in the shipped code (`grep` for `keepalive`, `ping`, `pre-warm`, `warm` in `core/agent-session.js` and cache-stats found no such logic; only unrelated `isIdle`/`waitForIdle` primitives for run-completion signaling, not cache renewal).
  - Source: direct grep of `dist/core/agent-session.js`.

## Break-even formulas (derived)

Notation per turn: `P` = tokens in the reusable prefix (system + tools + accumulated history) that would otherwise be a cache **read**; `r_in` = base input price per token; `r_read` = cache-read price per token; `r_write` = cache-write price per token (short-TTL); `r_write1h` = long-TTL write price. `idle` = seconds since the last real request against this prefix; `TTL` = provider's cache lifetime for the active retention setting.

**1. Cost of a cache miss (re-paying the prefix as fresh input/write) vs. a cache hit:**

```
miss_cost(P) = P × (r_write − r_read)          // Pi's own cache-stats.js formula
             = P × r_in × (write_multiplier − read_fraction)
```
For Anthropic short-TTL: `write_multiplier = 1.25`, `read_fraction = 0.10` → `miss_cost(P) ≈ 1.15 × P × r_in`.
For OpenAI (gpt-5.6+): `write_multiplier = 1.25`, `read_fraction ≈ 0.50` (verified only for gpt-4o-era models; GPT-5.6+ read discount not found in fetched pages — **uncertain**, verify against live pricing page before relying on this number for 5.6+) → `miss_cost(P) ≈ 0.75 × P × r_in` if 50% holds.

**2. Cost of one keepalive ping (Anthropic/OpenAI style — no separate storage fee):**

A ping only needs to touch the cached prefix once before `TTL` elapses. Its cost is the **cache-read cost of the touched prefix**, because a ping that reuses the prefix and adds no new content is billed as `P × r_read` (a read), plus negligible new-token cost if any trailing content is added. There is no additional Anthropic/OpenAI charge for keeping content "alive" beyond the read itself, because renewal is a side effect of any read, not a metered duration.

```
ping_cost(P) ≈ P × r_read                       // Anthropic: 0.10 × P × r_in
```

**3. Break-even: ping vs. accept-the-miss, for one idle gap that would otherwise exceed TTL:**

Pinging is worth it whenever the ping is cheaper than the miss it prevents:

```
P × r_read  <  P × (r_write − r_read)
r_read      <  r_write − r_read
2 × r_read  <  r_write
```

This reduces to a **provider/model constant independent of `P`**: for Anthropic short-TTL (`r_read = 0.10 r_in`, `r_write = 1.25 r_in`), `0.20 r_in < 1.25 r_in`. **On Anthropic, a keepalive ping is cheaper than one later cache miss for any prefix size only when another request is sufficiently likely to arrive inside the renewed window** and ping output overhead is small. With future-use probability `p` and overhead `H`, pinging is worthwhile when `p > (P × r_read + H) / (P × (r_write − r_read))`; ignoring overhead, the threshold is about 8.7%. This matches Anthropic's recommendation to pre-warm when reuse is expected, not a reason to ping abandoned sessions.

For Gemini explicit caching, the calculus is different because storage is metered separately by wall-clock time (`r_storage` per token-hour), independent of whether a read/ping occurs:

```
keep_alive_window_cost(P, hours) = P × r_storage × hours     // accrues regardless of pings
```
A ping does **not** reduce this cost and does not need to be sent to preserve the cache (TTL is set at creation and refreshed only via explicit cache **update**, not by ordinary reads) — Gemini's own docs describe TTL as configured, not touch-renewed. Sending Anthropic/OpenAI-style keepalive pings against Gemini's explicit cache does nothing for TTL and only adds redundant read cost; against Gemini's *implicit* cache, no TTL or renewal control is exposed at all, so pings cannot be reasoned about with a formula — **uncertain**, no published TTL for implicit caching was found.

**4. Compaction vs. ping, framed as competing ways to avoid `miss_cost(P)`:**

Compaction changes `P` itself (shrinks the reusable prefix by summarizing history) at the fixed one-time cost of a summarization call, `C_compact` (dominated by output tokens for the summary plus the input tokens of everything being read to produce it — and per Pi's own design, compaction requests are cache-write-disabled, so `C_compact ≈ (messagesToSummarize tokens) × r_in + (summary tokens) × r_out`, no discount). Compacting more often trades a large one-time re-processing cost for a *smaller* future `P`, which lowers the ceiling of future `miss_cost(P)` and future `ping_cost(P)` alike, but does not address the idle-gap/TTL problem at all — a freshly compacted session still misses its (now smaller) cache if the next turn arrives after `TTL`.

Consequently, compaction and pings are **not substitutes**: compaction manages `P` (prefix size), while pings manage `idle` (whether TTL expiry causes a miss). Compaction can save money even with perfect cache hits because every later turn pays the cache-read rate for the retained prefix. If compaction reduces `P` to `S` and there are `N` later turns, a simplified break-even test is:

```
C_compact + cold_write(S) + (N − 1) × read(S)
  < N × read(P)
```

Adjust the right side for expected cache misses and account for stable system/tool prefixes that may remain independently cached. This makes compaction attractive when many turns remain and `P − S` is large, but not merely because a session will be idle. For TTL-driven misses, retention or a justified ping is the direct lever; compaction only reduces the size of the prompt that will be read or rewritten.

## Whether no-op pings are supported/safe (per provider)

| Provider | Documented support for pings | Safety notes |
|---|---|---|
| Anthropic | Explicitly recommended ("send a new pre-warm request at least every 5 minutes") | A ping is a normal Messages API call; it must still satisfy the API's minimum-content requirements (non-empty message) and will consume at least one full turn's read-priced tokens; if it also emits assistant output, that output is billed at full output price — keep max_tokens/output small to avoid eroding the savings. |
| OpenAI | Not explicitly documented; only "maintain a steady stream of requests with identical prefixes" is stated | No first-party guidance on synthetic/empty pings; behavior of an artificial no-op call against cache eviction timing is **unverified** — treat as an inference, not a documented guarantee. |
| Gemini (implicit) | Not documented at all; no TTL, no renewal knob | Pings cannot be reasoned about — **unknown/unsupported claim space**. |
| Gemini (explicit) | Not applicable — TTL is set/updated explicitly, not touch-renewed | Sending traffic does not extend TTL per the docs; only `caches.update()` changes it, and that continues to accrue the hourly storage fee for whatever TTL you set. |

## Child execution: foreground blocking vs. background monitoring (2026-08-08)

Motivating observation from attended use: a foreground subagent or worker dispatch can run 10+
minutes, after which the lead's next request re-bills its whole prefix. Verified against
`extensions/subagent/index.ts` in this repository.

### Verified mechanics

- While a foreground `subagent` or `worker_dispatch` tool call blocks, the parent model issues
  **no provider requests**. `streamToResult` renders child observations through the tool-call
  `onUpdate` channel on a 5-second heartbeat, which is TUI presentation only; nothing reaches the
  model until the call returns. Anthropic's TTL is measured from request start (cited above), so
  any foreground child that outlives the active TTL guarantees one idle-driven miss on return:
  `miss_cost(P) ≈ 1.15 × P × r_in` at short retention.
  - Source: `extensions/subagent/index.ts` (`streamToResult`, heartbeat `setInterval(renderUpdate, 5_000)`).
- Mid-call "recap" reporting **cannot** refresh the cache. Tool content enters the model
  conversation only when the call returns, so a recap cadence requires ending the call early
  every interval and forcing a full model turn on the interim result. That is polling by
  construction, with a narrative recap appended to the prefix each interval instead of a status
  one-liner.
- `subagent_status` is already the cheap poll primitive: one real request returning a compact
  state-plus-latest-observation line. Each poll costs ≈ `P × r_read` plus a small prefix append,
  and renews the TTL as a side effect.
  - Source: `extensions/subagent/index.ts` (`subagent_status` handler).
- Children cannot share the parent's cache regardless of strategy: caching is per-conversation
  prefix, and Level 1 children receive fresh self-contained assignments rather than transcript
  forks (Decision 88). A fresh subagent always pays its own first prefix write. Long retention
  does, however, protect a durable worker's own resumed session across dispatches spaced under
  the retention TTL.

### Strategies compared (Anthropic pricing, parent prefix `P`, child duration `D`)

| Strategy | Keep-warm cost over one child | Notes |
|---|---|---|
| Foreground, short retention (today's default) | `1.15 × P × r_in` miss per dispatch with `D` > 5m | The observed pain; guaranteed miss. |
| Background + `subagent_status` poll each <5m | `⌈D/4.5m⌉ × 0.10 × P × r_in` | Beats one miss while polls ≤ ~11 → `D` under roughly 50 minutes; appends a poll turn per interval; pure sleep-polling is agentic busy-waiting and gives the model repeated chances to meddle mid-child. |
| Foreground with forced periodic returns ("recaps") | Same request cadence as polling | Strictly dominated: identical TTL effect, larger appended content, added adapter complexity, same steering risk. Rejected. |
| Long retention (`cacheRetention: "long"` / `PI_CACHE_RETENTION=long`) | One-time write premium `+0.75 × r_in` per token written once | Children up to 1h block in the foreground and resume as a 0.10× read; no polls, no appended turns; consistent with the 8-renewal break-even above. Dominant for the common 10–60-minute case. |
| Dispatch after checkpoint/compaction | `C_compact` once; the eventual miss re-bills only the shrunken prefix `S` | The prefix-size lever; the right complement for children expected to exceed the active retention TTL. |
| Background + end the attended turn | Zero | When the parent is truly idle and a human is present, the human's return is the wake event; the inter-turn miss is already the interactive baseline that Pi's cache-miss notice tracks. |

Backgrounding is genuinely better than foreground blocking only when the parent has real parallel
work — then cache renewal is a side effect of useful requests rather than a cost. As a pure
cache workaround it is a worse-dressed ping scheduler.

## Implications for Pi Workbench

- Treat "cache-aware" as two separable levers, matching the break-even analysis: **(a) prefix-size management** (compaction, summarization cadence, what goes in the system prompt/tools) and **(b) idle-gap management** (pings/keepalives, model-switch avoidance). Conflating them in a single "compact more" or "ping more" answer is a category error the sources make clear providers themselves separate (Anthropic ties TTL to *time*, not to prompt size; compaction changes *size*, not time).
- Pi's own `computeCacheWaste`/`detectCacheMiss` already labels each miss with `idleMs` and `modelChanged`; that is the correct signal to decide, per session, whether a miss was idle-driven (candidate for a ping-based fix) or size/turn-driven (candidate for earlier compaction). This distinction is not currently exposed outside the TUI.
- Recommendation 1 — expose the existing cache-waste signal programmatically. `computeCacheWaste`/`detectCacheMiss` (in `core/cache-stats.js`) are pure functions over session entries; wrap them as an SDK-visible event or a `pi session cache-report` style output so a Workstream-level controller (not just an interactive human) can see idle-driven vs. turn-driven waste per Run.
- Recommendation 2 — for Anthropic-backed work expected to pause, prefer an explicit retention choice over blind pinging. A ping beats a later miss only above the future-use probability threshold derived above. Comparing retention strategies from a cold start, short retention plus `k` idle renewals costs approximately `(1.25 + 0.10k) × r_in × P`, while a 1-hour write costs `2 × r_in × P`; ignoring output overhead, long retention becomes cheaper at 8 renewals. Real user/model turns also renew the cache and reduce the required ping count. Pi already supports `cacheRetention: "long"`. Current Level 1 Workbench forbids background semantic model work, so it should not add an automatic ping scheduler; use provider-aware launch policy and observability now, and reconsider attended or managed pre-warming only if measured misses justify a lifecycle change.
- Recommendation 3 — do not apply the Anthropic ping/long-retention logic to Gemini explicit caches; Gemini's storage fee accrues by wall-clock TTL regardless of pings, so the actionable lever there is **shorter TTLs on `caches.create`/`update`**, not more frequent touches. If Workbench ever explicitly manages Gemini caches (not just implicit), track `caches.create`/`update` TTL choices as their own controlled parameter, separate from the Anthropic-style ping logic above.
- Recommendation 4 — do not treat OpenAI the same as Anthropic for pings: OpenAI has never published a no-op-ping endorsement, and its read discount for the currently-relevant model families beyond `gpt-4o` was not directly verified here (marked uncertain above). Before extending any Anthropic-style ping/retention scheduler to OpenAI-backed Workstreams, re-verify the GPT-5.6+ cache-read discount and TTL-refresh semantics directly against the live pricing page and caching guide, since `prompt_cache_options.ttl` is described as a minimum, not a hard boundary, and OpenAI may already be retaining longer than assumed.
- Recommendation 5 — add GPT-5.6+ explicit stable-prefix breakpoint support upstream in Pi. The current installed OpenAI Responses transport supplies a stable `prompt_cache_key`, but does not emit `prompt_cache_breakpoint` markers for tools/system or set explicit-only mode during normal cached operation. OpenAI now warns that its implicit latest-message breakpoint can repeatedly write a changing prefix; stable tool/system breakpoints are therefore likely a larger win than synthetic traffic.
- Recommendation 6 — compaction cadence should remain correctness-first and phase-aware, but cache-read economics should be measured too. Earlier compaction does not fix idle expiry; it pays only when its one-time summarization plus cold-start cost is lower than expected savings from a smaller prefix across later cache reads and writes. Evaluate that inequality from session usage rather than compacting on a fixed, more aggressive schedule.
- Recommendation 7 — child-execution launch policy, in preference order (adoption deferred; see
  Deferred Design Decision 19 in `docs/foundation/decisions.md`): (a) long cache retention as the
  lead-session posture whenever child dispatches or human pauses regularly exceed 5 minutes;
  (b) foreground blocking stays the default control flow for a single child — with long retention
  it resumes as a cache read for any child under an hour; (c) background dispatch is for fan-out
  or genuinely parallel lead work, not cache management; (d) children expected to outlast the
  active retention TTL are dispatched immediately after a phase checkpoint so the unavoidable
  miss hits a small prefix; (e) an idle attended lead backgrounds the child and ends its turn
  instead of keep-warming. Do not add mid-call recap returns or an automatic ping scheduler at
  Level 1 (Recommendation 2 stands). Subscription-metered sessions swap dollars for quota with
  the same ordering.

## Confidence

- Anthropic figures (TTL, multipliers, minimum prefix, breakpoints, pre-warm guidance, concurrency behavior): **high** — quoted directly from `docs.claude.com/en/docs/build-with-claude/prompt-caching`, fetched live.
- OpenAI figures (min prefix, TTL semantics, gpt-4o cache-read discount): **high** for what was quoted; **explicitly flagged uncertain** where noted (GPT-5.6+ read discount, whether OpenAI TTL truly never resets on reuse, no-op ping safety).
- Gemini figures (implicit min tokens, explicit TTL default/no-bounds, storage-fee structure, Gemini 2.5 Flash sample pricing): **high** — quoted directly from `ai.google.dev/gemini-api/docs/generate-content/caching` and `ai.google.dev/gemini-api/docs/pricing`; implicit-cache TTL is **explicitly unknown** (not published anywhere found).
- Pi source claims (default retention, cache_control application, cost formulas, cache-waste instrumentation, compaction cache-write disabling, absence of keepalive logic): **high** — read directly from the installed `@earendil-works/pi-coding-agent` distribution and its own docs; version-specific, so re-verify after any Pi upgrade since these are implementation details, not documented public API guarantees.
- Child-execution mechanics (blocking `streamToResult` issues no parent requests, `onUpdate` is
  presentation-only, `subagent_status` output shape): **high** — read directly from
  `extensions/subagent/index.ts` in this repository on 2026-08-08; re-verify if the extension's
  streaming or status contract changes. The strategy table's arithmetic derives from the cited
  provider numbers and has not been validated against live billing data.
- Break-even formulas in this document are **original derivations** from the cited provider numbers and Pi's own `cache-stats.js` miss-cost formula; they are algebraically straightforward but have not been empirically validated against live billing data. Include real output overhead, user-turn timing, and observed provider usage before making routing policy load-bearing.
