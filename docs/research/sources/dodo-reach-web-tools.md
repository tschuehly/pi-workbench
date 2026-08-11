# Web Tools Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

## Status of this ledger

Research only. Nothing here is accepted. No recommendation, decision, experiment, or roadmap item
follows from this file, and no owner approval is claimed or implied. The candidate classifications
below are unaccepted options recorded for later deliberation. Settled decisions belong only in
`docs/foundation/decisions.md`, after the owner settles them.

## Verdict

`supi-web` is a well-built, well-tested Markdown-first page fetcher with disciplined output bounds. It
proves that clean readable extraction plus explicit truncation-with-full-copy is a solid tool contract.

It does **not** prove the capability the DODOREACH thread describes. **The linked `supi-web` package
contains no web-search tool and no batch-fetch tool.** Its only "search" is Context7 *library
documentation* lookup. Web search and batch fetch are private DODOREACH additions that were not
available for inspection.

The interesting Workbench finding is not a missing idea. The attended environment already runs a
richer capability — web search, source checking, multi-URL parallel fetch, and bounded stored-content
retrieval — via `pi-web-access` installed in machine-local user settings. The gap is
**reproducibility and declaration**, not implementation.

## Exact sources

### Public analogue inspected

| Field | Value |
| --- | --- |
| Repository | `https://github.com/mrclrchtr/supi` (monorepo, `packages/supi-web`) |
| Publication-time revision | [`65ded65`](https://github.com/mrclrchtr/supi/tree/65ded65c8bd01ffada826ded7cf24d026fe218ba/packages/supi-web), 2026-08-10 23:42:59 UTC |
| Package | `@mrclrchtr/supi-web` **4.8.0** |
| Later comparison | 4.9.0 at `52b9d34` changes only `packages/supi-web/package.json`; `src/` is byte-identical to 4.8.0 |
| License | MIT |
| Runtime dependencies | `jsdom` ^30, `@mozilla/readability` ^0.6, `turndown` ^7.2, `turndown-plugin-gfm` ^1.0.2 |
| Source size | 12 files, ~1.7k lines under `src/`; 6 unit test files, ~1.05k lines |

### Workbench-side baseline capability (machine-local, for comparison)

| Field | Value |
| --- | --- |
| Package | `pi-web-access` **0.20.0** (author Nico Bailon, MIT), npm `gitHead` `00b2271d0f1603ac780df3f324aed0fc92f3e849`, integrity `sha512-jMHiNe6hGQYmblSJsYBA2HdGuEe2sOM1GSVvVRMESwJoPvdfClaln6NlRD0/SOfBo1PiLCD1OUQhSrW4gMF3vQ==` |
| Declared in | `~/.pi/agent/settings.json` as unversioned `npm:pi-web-access` — **user-global, not repository-declared or pinned** |
| Registered tools | web search, source check, fetch content (single `url` **or** batch `urls` in parallel), get search content (bounded slices / `findText` over a prior response) |
| Notable module | `ssrf-protection.ts` with `DEFAULT_MAX_REDIRECTS = 5` and DNS-resolution checks |

## Mechanisms in `supi-web`

### M1 — Content negotiation to Markdown (`web_fetch_md`)

- **Inputs:** `url` (validated as `http:`/`https:` only), optional `output_mode`
  (`auto` | `inline` | `file`, default `auto`), `abs_links` (default `true`), `timeout_ms`
  (default 30 000, max 4 294 967 295).
- **State:** none persisted beyond temporary files.
- **Actions:** `fetchWithNegotiation` prefers server-returned Markdown, then sniffs Markdown or plain
  text, then probes common `.md`, `.markdown`, `index.md`, `README.md` siblings, then falls back to
  Readability extraction converted to GitHub-flavored Markdown via Turndown. Plain text is wrapped in
  a fenced block with a guessed language.
- **Outputs:** Markdown inline, or a temp-file path with char/line counts.
- **Failures:** non-`http(s)` URLs throw `URL must be http(s)`; non-OK responses throw a `FetchError`
  carrying the status; a `readPartialText` byte cap bounds sniffing reads; the abort `signal` is
  threaded through.
- **Authority:** read-only network egress plus temp-file writes. No repository mutation.

### M2 — Output bounding with full-result preservation

- **Inputs:** the produced Markdown.
- **State:** temp files written by `writeTempFile`.
- **Actions:** `auto` inlines up to `WEB_FETCH_INLINE_MAX_CHARS = 15_000` chars and otherwise writes a
  file; separately, `limitModelVisibleOutput` truncates to Pi's `DEFAULT_MAX_LINES` /
  `DEFAULT_MAX_BYTES` (documented as 2 000 lines / 50 KB) and, when truncated, writes the complete
  output to a temp file and appends `[Output truncated: …/… lines, …/… . Full: <path>]`.
- **Outputs:** bounded model-visible text plus `truncation` and `fullOutputPath` details.
- **Failures:** truncation is never silent; the notice always names the full-output path.
- **Authority:** none; presentation and Model Context protection.

### M3 — Context7 documentation lookup (`web_docs_search`, `web_docs_fetch`)

- **Inputs:** `library_name` + `query` for search; `library_id` + `query` + optional `raw` for fetch.
- **State:** `CONTEXT7_API_KEY` read from the environment.
- **Actions:** call `https://context7.com/api/v2/libs/search` and the context endpoint; return compact
  Markdown, or JSON snippets when `raw` is set.
- **Outputs:** library IDs with versions, trust scores, benchmark scores, snippet counts; or focused
  documentation.
- **Failures:** "No libraries found for …" guidance on empty results; auth-header handling is unit
  tested.
- **Authority:** read-only third-party API access; the key is an explicit external dependency.

### M4 — Prompt surface and trust framing

- Each tool ships a `promptSnippet` and `promptGuidelines` (for example "Use `web_fetch_md` only for
  public http(s); ask if login/private", "Use `web_docs_search` before `web_docs_fetch` if ID
  unknown"), so tool-selection guidance is part of the package rather than the user's prompt.
- The README states plainly that fetched pages are "external, untrusted content… source material, not
  repository instructions", and that no browser or page JavaScript runs.

## What `supi-web` explicitly does *not* provide

Verified by reading `src/tool/tool-specs.ts` and grepping the package source:

- **No web search.** `WEB_TOOL_NAMES` is exactly `["web_fetch_md", "web_docs_search",
  "web_docs_fetch"]`. `web_docs_search` searches **Context7 library IDs**, not the web. The only
  `search` symbols in the package are `searchLibrary` and Context7 URL parameters.
- **No batch fetch.** `WebFetchMdParameters` accepts a single `url: Type.String()`. There is no
  `urls` array, no concurrency, and no multi-URL path anywhere in `src/`.
- **No local-network or SSRF policy.** `isValidHttpUrl` checks only the protocol. A grep for
  `localhost`, loopback literals, `169.254`, `hostname`, allowlist/blocklist terms found nothing in
  `src/`. `http://127.0.0.1:…` and `http://[::1]:…` are accepted URLs.
- **No redirect cap of its own.** Every fetch passes `redirect: "follow"` and relies on the platform
  `fetch` default; there is no explicit maximum and no re-validation of the redirect target, so a
  public URL may redirect to a private address.

## Implementation and test evidence

- Six unit test files under `__tests__/unit/`: `fetch.test.ts` (~55 cases), `context7-client.test.ts`
  (15), `docs.test.ts` (12), `convert.test.ts` (7), `web.test.ts` (5), `guidance.test.ts` (3) —
  roughly 97 `it(...)` cases covering `isValidHttpUrl`, `isHtml`, `looksLikeMarkdown`,
  `fetchWithNegotiation`, content-type detection, language guessing, HTML→Markdown conversion, code
  fencing, both Context7 tools, auth headers, tool registration, and prompt guidance.
- **Not executed here.** The package is a pnpm workspace member with `vitest` and workspace
  dev-dependencies; running it would require a full workspace install. Counts above are static
  (`grep`/`wc`) over the checkout, so they are an upper bound on distinct assertions and were not
  observed passing.
- Behavior *not* covered by tests: real-network redirect chains, private-address targets, hostile or
  enormous pages, temp-file lifecycle and cleanup, and Context7 rate limiting.

## DODOREACH private claim versus public analogue

- The DODOREACH thread describes a **private** package providing web search and batch fetch. It was
  not available for inspection: no repository, no code, no tests, no measurements.
- `supi-web` is the **linked public analogue** and demonstrates only Markdown-first single-URL
  fetching plus Context7 documentation lookup. **The linked `supi-web` lacks web search and batch
  fetch** — stated here explicitly because the thread's framing can easily be read as if the linked
  package demonstrated them.
- Therefore no `supi-web` evidence may be transferred to the private search/batch claims, and the
  private package's quality, bounds, concurrency behavior, and safety posture remain entirely
  unverified.

## Pi Workbench baseline: implemented versus specified

| Capability | Status at this review |
| --- | --- |
| Web search available to the attended lead | **Operational but undeclared.** Provided by `pi-web-access` 0.20.0 through the machine-local `~/.pi/agent/settings.json` `packages` list. |
| Batch/multi-URL fetch | **Operational but undeclared.** `pi-web-access` fetch-content accepts `urls` fetched in parallel. |
| Bounded output with retrievable full content | **Operational but undeclared.** `pi-web-access` stores full content and exposes bounded slices and `findText` by `responseId`. |
| SSRF/redirect policy for agent fetches | **Present in the installed tool** (`ssrf-protection.ts`, `DEFAULT_MAX_REDIRECTS = 5`, DNS checks); **absent from any Workbench contract or test.** |
| Repository-declared harness web capability | **Absent.** `config/pi-agent-settings.example.json` declares only `retry`; `config/README.md` explicitly says live copies stay machine-local and personal `packages` entries are preserved by hand. |
| Contract tests over web-tool behavior in Workbench | **Absent.** No package under `packages/` covers web access; `docs/contracts/harness.md` does not mention fetch or search. |

Concretely: the capability is real in the attended environment, but a fresh Workbench checkout on
another machine reproduces none of it, and no Workbench test asserts anything about its bounds or
safety. This is a reproducibility gap: availability depends on machine-local Pi configuration rather
than a repository-guaranteed capability.

## Honest comparison

**Where `supi-web` is better than the current Workbench setup**

- It is *declared and tested*. Its bounds are constants in source (`15_000` chars,
  `DEFAULT_MAX_LINES`/`DEFAULT_MAX_BYTES`) with ~97 unit cases around the fetch and conversion logic.
  Workbench has zero tests and zero declarations for its web capability.
- Its negotiation ladder (server Markdown → sniffed Markdown/plain text → `.md` siblings → Readability)
  is a genuinely better default than blind HTML extraction, and it is small enough to audit.
- Its trust framing — fetched pages are untrusted source material, not instructions — is stated in the
  package rather than left to each user's prompt.

**Where the current Workbench environment is better**

- Capability breadth: search across many providers, claim-oriented source checking with passage
  citations, parallel multi-URL fetch, and stored-content retrieval. `supi-web` offers none of these.
- Egress safety: `pi-web-access` ships explicit SSRF protection with DNS resolution checks and a
  five-redirect cap; `supi-web` has neither.

**Where Workbench is worse than both**

- Nothing about this capability is owned by the repository. It is not pinned, not contract-tested, not
  documented in `docs/contracts/harness.md`, and not present in `config/`. Another machine, another
  operator, or a fresh child Pi may have a different or absent web surface, and no Workbench check
  would notice.

**Where evidence is insufficient**

- Whether Markdown-first negotiation actually yields better model outcomes than the installed tool's
  extraction. No comparison exists.
- Whether the installed tool's bounds hold under hostile or very large pages; untested in Workbench.

## Unaccepted candidates

None of the following is accepted, scheduled, or approved.

- **Adapt (candidate):** declare the *existing* web capability in the Workbench harness — pin
  `pi-web-access` and its configuration expectations in `config/` and `docs/contracts/harness.md`, and
  contract-test output bounds, complete-result retrieval, redirect limits, local-network refusal, and
  hostile-content handling. Distribution, versioning, and health checks belong to the harness. Any
  future managed capability grant belongs to repository capability resolution, the Workflow Contract,
  Work Packet, and execution/controller boundary; V1 has no managed Dispatch. Falsifier: pinning proves
  impossible without committing machine-local or credentialed state.
- **Reject (candidate):** replacing the operational capability with `supi-web`. It would remove web
  search, batch fetch, source checking, and SSRF protection.
- **Reject (candidate):** citing `supi-web` as evidence for the private search/batch package.
- **Experiment (candidate):** borrow only the *negotiation ladder* idea — prefer server-provided
  Markdown and `.md` siblings before HTML extraction — and measure extraction quality on a fixed URL
  set against the installed fetcher. Falsifier: no measurable difference in usable content.
- **Experiment (candidate):** an egress-policy contract test suite (loopback, link-local, redirect to
  private address, oversized body, non-UTF-8) run against whatever fetcher the harness declares.

## Open questions

1. Can the web capability be pinned reproducibly without committing credentials, provider keys, or
   machine-local paths — and what is the minimum a fresh checkout must declare?
2. Which Dispatches should have web access at all? Should a Worker inherit it by default, or should it
   be an explicitly granted capability per Work Packet?
3. What egress policy does Workbench actually require (loopback refusal, redirect target
   re-validation, size caps), and where is it enforced — tool, harness, or sandbox?
4. Should fetched external content be recorded as Primary Evidence with its URL, retrieval time, and
   hash, so later evaluation can distinguish a page's claim from a model's paraphrase?
5. Is a general web search even the right primitive for Workbench research, versus a source-checking
   tool that returns passage-level citations?

## Confidence and limitations

- **High confidence:** `supi-web`'s tool inventory, parameter schemas, bounds constants, negotiation
  ladder, absence of search/batch/SSRF/redirect policy, license, dependencies, and revision. All read
  directly from the pinned repository source.
- **High confidence:** the installed `pi-web-access` 0.20.0 tool inventory and its declaration only in
  `~/.pi/agent/settings.json`, and the absence of any web capability in `config/` or
  `docs/contracts/harness.md`.
- **Medium confidence:** the test-case counts, which are static grep counts rather than an observed
  test run.
- **Unverified:** the private DODOREACH search/batch package in every respect; the real-world quality
  difference between the two fetchers; and `pi-web-access`'s behavior under adversarial input, which
  was read but not exercised.
- The exact publication-time 4.8.0 revision was compared with 4.9.0; the package source is
  byte-identical and only the package version changed, closing the earlier revision-drift caveat.
