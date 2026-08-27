# GitHub Copilot fallback routing

Reviewed on: 2026-08-27

## Question

Which GitHub Copilot models should Pi Workbench use as fallbacks for the current Cognitive Role
bindings, and can `quota-axi` provide safe admission evidence for that fallback?

## Recommendation

Adopt **same-model, separate-quota fallback** first. When a direct Codex or Anthropic binding is
exhausted, prefer the same underlying model through `github-copilot`. This minimizes model-behavior
change while adding Copilot's separate AI-credit pool, but the gateway still changes hosting,
content filtering, data terms, and sometimes context/output limits.

Do not route unique Copilot models by default yet. Treat Gemini, Grok, Kimi, and MAI as calibration
candidates and promote them only from comparable Workbench run evidence, as required by
[`routing-rationale.md`](../../../skills/model-orchestration/references/routing-rationale.md).

Automatic fallback still needs implementation. The current policy has one binding per role, the
resolver does not select ordered candidates, and its generic quota-window logic is not sound for
Copilot's unresolved window semantics.

## Recommended fallback bindings

| Cognitive Role | Current primary | Copilot fallback | Pi effort | Known route delta |
| --- | --- | --- | --- | --- |
| `implementation` | `openai-codex/gpt-5.6-sol` | `github-copilot/gpt-5.6-sol` | `medium` | Pi advertises 1.05M context instead of 272K; long-context pricing applies above 272K. |
| `problem-solving` | `openai-codex/gpt-5.6-sol` | `github-copilot/gpt-5.6-sol` | `high` | Same as implementation. |
| `design` | `openai-codex/gpt-5.6-sol` | `github-copilot/gpt-5.6-sol` | `xhigh` | Same as implementation. |
| `escalation` | `openai-codex/gpt-5.6-sol` | `github-copilot/gpt-5.6-sol` | `max` | Same as implementation. |
| `investigation` | `anthropic/claude-sonnet-5` | `github-copilot/claude-sonnet-5` | `medium` | Pi advertises 1M context and 128K output, but GitHub documents 1M extended context only for VS Code/Copilot CLI; test Pi before relying on more than the 200K default. |
| `synthesis` | `anthropic/claude-opus-5` | `github-copilot/claude-opus-5` | `high` | Same >200K route-test requirement; Copilot also advertises 64K output instead of direct Anthropic's 128K. |
| `mechanics` | `anthropic/claude-haiku-4-5-20251001` | `github-copilot/claude-haiku-4.5` | `low` | Copilot exposes an undated alias, not the pinned direct snapshot. |

For Independence roles, retain the underlying-family choice and Pi effort while changing the quota
route:

| Role | Independent of author family | Current model / effort | Copilot fallback |
| --- | --- | --- | --- |
| `independent-judgment` | OpenAI | Fable 5 / `low` | No automatic fallback initially; Copilot Fable requires explicit attended opt-in because its data terms differ. |
| `challenge` | OpenAI | Fable 5 / `high` | No automatic fallback initially; same reason. |
| `independent-review` | OpenAI | Opus 5 / `high` | `github-copilot/claude-opus-5` |
| all three Independence roles | Anthropic | Sol / role's existing effort | `github-copilot/gpt-5.6-sol` |

A Copilot-hosted OpenAI model is still OpenAI-family; a Copilot-hosted Claude model is still
Anthropic-family. `github-copilot` is a gateway, not a model family. Fable's Copilot route must not
be an automatic substitution because GitHub documents different Anthropic retention for it; its
advertised 1M context has the same >200K third-party-client caveat as Sonnet and Opus.

## Why same-model fallback first

The current bindings are provisional but calibrated by role. Replacing Sol, Sonnet, Opus, or
Haiku with an uncalibrated model when quota is already constrained introduces two variables at
once: provider route and model behavior. Keeping the underlying model reduces that change; it does
not eliminate route differences. Copilot applies GitHub content filters and hosting terms, and Pi's
catalog shows a lower Opus 5 output ceiling on the Copilot route. Fable also has route-specific data
terms, so it is excluded from automatic fallback.

The authenticated live Pi catalog exposed every proposed fallback during this investigation; the
resolver must still check the live catalog for each dispatch because an unauthenticated catalog is
not proof of account entitlement. Copilot Sol is advertised by Pi with roughly 1.05M context while
direct Codex Sol is 272K. GitHub documents extended 1M context only for VS Code and Copilot CLI, so
Pi should not rely on that extended ceiling without a route test; the same restriction applies to
the advertised 1M Claude fallbacks above their 200K default. GitHub also applies long-context
pricing above 272K for Sol, so fallback sessions should retain the normal short-context posture
unless large context is explicitly required. Pi's cached Sol price sits between GitHub's temporary
promotional and derived standard rates, so Pi's displayed cost is not authoritative for billing.

Sources:

- Current bindings: [`routing-policy.json`](../../../skills/model-orchestration/references/routing-policy.json)
- Policy calibration rule: [`routing-rationale.md`](../../../skills/model-orchestration/references/routing-rationale.md)
- Pi model catalog and model overrides: [Pi custom-model documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- Copilot context and reasoning cost warning: [Supported AI models in GitHub Copilot](https://docs.github.com/en/copilot/reference/ai-models/supported-models)

## Copilot-only calibration candidates

The live Pi catalog also exposes model families unavailable through the direct Codex and Anthropic
subscriptions:

| Candidate | Suggested experiment | Why not default yet |
| --- | --- | --- |
| `github-copilot/mai-code-1.1-flash` | `mechanics` | Very low published price and GitHub describes it as lightweight with instruction following and tool use, but Workbench has no run evidence. |
| `github-copilot/gemini-3.7-flash` | `mechanics` or bounded `investigation` | Low promotional price and 1M context; GitHub recommends Flash models primarily for fast, lightweight work. |
| `github-copilot/gemini-3.1-pro-preview` | `problem-solving`, `design`, or cross-family challenge | GitHub highlights edit-test loops and tool precision, but the model is preview and long-context pricing rises above 200K. |
| `github-copilot/grok-4.6` | cross-family judgment/challenge | GA, broad reasoning controls, and cheaper published output than frontier Claude/OpenAI routes; no Workbench calibration yet. |
| `github-copilot/kimi-k3` | long-context `investigation` or synthesis experiment | GitHub describes long-context, multi-step agent work, but also documents a distinct safety caveat. |
| `github-copilot/kimi-k2.7-code` | routine implementation experiment | Coding-focused and relatively inexpensive; open-weight models may require explicit enablement. |

GitHub's own task guide recommends Sol for complex long-running agentic work, Sonnet for general
coding, Opus for deep reasoning, Haiku/Luna/MAI for smaller tasks, Gemini Pro for tool-precise
edit-test loops, and Kimi K3 for long-context agent work. These are vendor recommendations, not
comparative Workbench evidence.

Sources:

- [GitHub Copilot AI model comparison](https://docs.github.com/en/copilot/reference/ai-models/model-comparison)
- [Supported models and policy caveats](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [Model pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)

## Billing and quota meaning

Current Copilot individual plans use **GitHub AI Credits**, where one credit is USD $0.01 and each
interaction is charged from model-specific input, cached-input, cache-write, and output tokens.
Legacy request multipliers apply only to eligible existing annual Pro/Pro+ plans. New-model routing
must therefore optimize token cost, not a flat number of requests.

Selected current rates per million tokens (input / cached input / cache write / output):

| Model | USD per 1M tokens |
| --- | --- |
| GPT-5.6 Sol, promotional default tier through 2026-09-03 | $2.00 / $0.20 / $2.50 / $10.00 |
| GPT-5.6 Sol, derived standard default tier after promotion | $4.00 / $0.40 / $5.00 / $20.00 |
| Claude Sonnet 5 | $2.00 / $0.20 / $2.50 / $10.00 |
| Claude Opus 5 | $5.00 / $0.50 / $6.25 / $25.00 |
| Claude Fable 5 | $10.00 / $1.00 / $12.50 / $50.00 |
| Claude Haiku 4.5 | $1.00 / $0.10 / $1.25 / $5.00 |
| Gemini 3.7 Flash, promotional through 2026-12-31 | $0.75 / $0.075 / none / $3.75 |
| MAI-Code-1.1-Flash | $0.20 / $0.02 / none / $1.20 |
| Grok 4.6, default tier | $2.00 / $0.50 / none / $6.00 |
| Kimi K3 | $3.00 / $0.30 / none / $15.00 |

Sources:

- [Models and pricing for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
- [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)
- [Legacy annual-plan multipliers](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans)

## What `quota-axi` can authenticate

`quota-axi` does not perform a Copilot login. In both installed `0.1.17` and current upstream
`0.1.32`, its Copilot adapter reads an `oauth_token` from:

1. `$GITHUB_COPILOT_APPS_JSON`, or
2. `$XDG_CONFIG_HOME/github-copilot/apps.json` (normally
   `~/.config/github-copilot/apps.json`).

It then calls GitHub's first-party `https://api.github.com/copilot_internal/user` endpoint. A
current standalone Copilot CLI login is not guaranteed to create this file because that client can
store credentials in the OS credential store or its own config. The supported test is therefore
`quota-axi auth --json`, not the fact that another Copilot client says it is logged in.

Pi's `/login` stores two Copilot values: a long-lived GitHub OAuth value used to mint a short-lived
Copilot API value, and the derived API value used for model calls. `quota-axi` does not currently
read Pi's auth file for Copilot. A secret-safe temporary probe during this investigation established
that Pi's GitHub OAuth value is accepted by the endpoint used by `quota-axi`; the derived model API
value is not. No credential was written to the repository. Like every successful `quota-axi`
probe, it created a nonsecret quota snapshot in quota-axi's machine-local cache; that probe entry
was removed after review.

Therefore there are two viable paths:

1. **Immediate:** let the user create/authenticate the `apps.json` source they offered, then verify
   both credential discovery and a non-cached fresh API result:

   ```bash
   quota-axi auth --provider copilot --json \
     | jq -e '.auth[0].sources[] | select(.source == "apps-json" and .status == "available")'
   quota-axi --provider copilot --json \
     | jq -e '.providers[0] | select(.source == "api" and .state.status == "fresh" and (.state.stale | not))'
   ```

   A plain quota command can return a stale cached snapshot after auth failure, so window rows
   alone do not prove that authentication worked.

2. **No duplicated credential:** add a Pi-Copilot credential reader upstream in `quota-axi`,
   analogous to its existing Pi Kimi and Pi xAI readers, which reads only the GitHub OAuth value
   and never logs or caches it.

Updating `quota-axi` from 0.1.17 to 0.1.32 is independently sensible, but current upstream still
uses only `apps.json` for Copilot, so updating alone does not solve this auth-source mismatch.

Sources:

- [`quota-axi` Copilot adapter](https://github.com/kunchenguid/quota-axi/blob/main/src/providers/copilot.ts)
- [`quota-axi` credential-source documentation](https://github.com/kunchenguid/quota-axi#security-posture)
- [Pi GitHub Copilot OAuth implementation](https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/auth/oauth/github-copilot.ts)

## Why authenticated `quota-axi` is not yet sufficient

`quota-axi` documents Copilot windows named `chat`, `completions`, and `premium_interactions`; it
explicitly marks their relationship as `unknown`, publishes no effective availability, and may
receive no numeric windows at all when GitHub returns entitlement without quota figures. The local
probe returned those three windows with unusable epoch reset values. This is weaker than the known
account/model semantics available for Claude and Codex.

The current Workbench resolver:

- treats every non-model window as relevant;
- blocks if any relevant window reaches zero, even if that window is unrelated to Pi chat/model
  calls;
- labels fresh telemetry with no measurable windows as `fresh-quota`;
- admits unavailable Copilot telemetry as `degraded-quota-telemetry` rather than blocking; and
- supports one binding per role, not an ordered primary plus fallback.

Consequently, merely adding `provider: "github-copilot"` and `quotaProvider: "copilot"` to the
policy would not implement fallback and could make incorrect admission decisions.

Minimum safe implementation:

1. Extend each role binding with an explicit ordered fallback candidate and its exact route-specific
   model ID.
2. Record `modelFamily` on each binding because one Copilot provider serves many families. Fail
   closed when either selected or author family is unknown. Today a Copilot binding has no entry in
   `providerFamilies`, so `selectedFamily` becomes `undefined`; the inequality check then wrongly
   admits a Copilot-hosted Claude model as independent of Anthropic. Conversely,
   `--independent-of github-copilot` blocks with a misleading missing-binding reason.
3. Select the primary unless its applicable quota is exhausted; then evaluate the Copilot
   candidate without silently changing Cognitive Role or effort.
4. Require measurable, applicable Copilot quota evidence for automatic fallback. Treat fresh but
   empty or semantically unresolved windows as degraded telemetry, not `fresh-quota`.
5. Keep degraded Copilot routing available only as an explicit attended/manual choice until live
   data establishes which window bounds Pi model requests. The current resolver otherwise passes
   degraded Copilot telemetry by default.
6. Require explicit attended opt-in for Copilot Fable because its data terms differ; do not make it
   an automatic fallback.
7. Add resolver tests for primary pass, primary exhausted/fallback pass, both exhausted, missing
   model, empty fresh windows, unresolved Copilot windows, unknown selected/author family, and
   route-specific model-family Independence.

The official GitHub billing API can report personal AI-credit usage by model, but using it for
remaining-headroom admission would require a billing-authorized credential and a trustworthy
allowance calculation. Pi's Copilot login requests only ordinary user access, so this is a separate
future integration rather than a free replacement for the current endpoint.

Sources:

- [GitHub REST billing usage](https://docs.github.com/en/rest/billing/usage)
- [Monitoring GitHub AI Credits](https://docs.github.com/en/copilot/how-tos/manage-and-track-spending/monitor-ai-usage)
- [`quota-axi` Copilot adapter](https://github.com/kunchenguid/quota-axi/blob/main/src/providers/copilot.ts)
- [`quota-axi` provider-window semantics](https://github.com/kunchenguid/quota-axi#provider-windows)
- Current resolver: [`resolve-runtime-binding.mjs`](../../../skills/model-orchestration/scripts/resolve-runtime-binding.mjs)

## Risk notes

- Claude Fable 5 through Copilot has a distinct data-retention disclosure: Anthropic retains
  prompts and outputs to operate safety classifiers. Do not silently substitute this route.
- GitHub documents additional safeguards and an elevated pre-release safety concern for Kimi K3.
- Copilot model availability changes with plan, policy, and rollout. Resolve against Pi's live
  catalog on every dispatch, as the current resolver already does.
- Changing only the route adds quota capacity but does not change model family. Independence is
  determined by the underlying model family relative to the author family.
