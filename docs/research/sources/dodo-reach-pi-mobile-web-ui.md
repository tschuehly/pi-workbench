# DODOREACH Pi Mobile Web UI Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

Research only. Nothing in this ledger is an accepted recommendation, an approved plan, or a settled
decision. Every classification below is a candidate for a later separate decision.

## Verdict

The July 21 post is evidence of a well-shaped one-shot prompt and of a photographed surface. It is
not evidence of implementation correctness: the resulting code is private, and a photograph only
suggests that something rendered. The prompt itself is genuinely good — it keeps Pi authoritative, refuses a second
transcript store, and names its own test obligations — which makes it useful as an acceptance
checklist and useless as a build proposal.

Building the proposed shell is rejected as a candidate, not because the prompt is weak, but because
PI WEB is the settled Workbench client and already implements the mobile, loopback, and reconnect
posture the prompt asks a new server to achieve. A second shell would create a second session
interpretation layer against a settled decision. The residual value is a short list of acceptance
cases that may or may not already be covered by `packages/pi-web-integration/`.

## Scope and method

The named source is [the July 21, 2026 post](https://x.com/DODOREACH/status/2079645642532462850).
A direct anonymous fetch recovered the complete post and prompt. The author declined to release the
private UI and instead presented a one-shot prompt as a way for users to learn to shape their own
tools. The full prompt was re-verified against that primary source during this analysis; the synthesis
in [`dodo-reach-pi-tool-shaping.md`](dodo-reach-pi-tool-shaping.md) records a condensed requirement
summary and the same framing.

Demonstrable comparison material, at the revisions checked out locally:

| Artifact | Identity | Evidence used |
| --- | --- | --- |
| PI WEB shell | sibling `../pi-web` at `8644d99`, `README.md`, `docs/config.md`, `docs/plugins.md`, `docker/README.md` | Device support, loopback bind, allowed hosts, WebSocket transport, PWA prefix behavior, mobile tabs |
| Workbench decisions | `docs/foundation/decisions.md` items 4, 24, 33, 65, 76, 87–89, 96 | PI WEB is the client; the Workstream Store, execution adapter, and session coordinator retain their existing ownership; extensibility is upstream-first |
| Historical Workbench PI WEB work | `packages/pi-web-integration/test/`, `docs/archive/pi-web-ui/plans/pi-web-workbench-ui.md`, pre-reset `docs/foundation/requirements.md` item 12 | Historical tests and mobile requirements; the 2026-08-28 macOS-first reset no longer makes mobile a current slice gate |

## Prompt evidence versus implementation evidence

The recorded prompt requirements, restated without embellishment: Pi remains the runtime and owner of
native sessions; the browser receives opaque workspace and session identifiers; no second transcript database is created;
the SDK is pinned to the installed Pi version; a fake adapter exists; Server-Sent Events are
reconciled; the server binds to loopback; and tests are specified for CSRF, host, workspace root,
secret handling, restart, mobile, and Tailscale.

What that establishes and what it does not:

| Layer | Status |
| --- | --- |
| The author wrote these requirements | Demonstrated by the post |
| A surface existed and rendered on a phone | Suggested by a photograph; not inspectable |
| The requirements were implemented correctly | Not demonstrated; code is private |
| The result reconciled reconnects, resisted CSRF, or confined workspace roots | Not demonstrated; no tests, logs, or code are public |
| The approach outperforms an existing shell | Not demonstrated; no comparison exists |

A photograph and a prompt are separated from a working client by exactly the properties that are
hardest to get right, and those are the properties the prompt names. Treating the prompt's ambition
as its outcome is the novelty bias this analysis is required to test.

## Comparison with implemented Workbench reality

PI WEB demonstrably covers part of the prompt's environmental requirements; the remaining security
and compatibility claims require evidence from their owning layers:

| Prompt requirement | Owning layer | Current status and evidence |
| --- | --- | --- |
| Pi remains runtime and native-session owner | PI WEB session daemon / Pi | **Demonstrated.** PI WEB hosts native Pi sessions and binds extensions in `rpc` mode; it does not reimplement the agent (`README.md`, `docs/plugins.md`). |
| Browser receives opaque workspace and session identifiers | PI WEB browser protocol | **Unverified as stated.** Session identity handling exists, but this review did not establish opacity for those specified workspace and session identifiers. |
| No second transcript database | PI WEB / Workbench adapter ownership | **Demonstrated for the Workbench adapter.** Native Pi sessions remain the conversation source; the adapter projects Workstream associations and does not persist a second transcript (`docs/foundation/decisions.md` items 4 and 24). |
| SDK pinned to installed Pi version | PI WEB packaging and launch | **Unverified exact-match guarantee.** No equivalent integration test was located. |
| Fake adapter for deterministic tests | PI WEB/Pi integration-adapter layer | **Partial analogue only.** Workbench has a `DeterministicFakeWorkstreamClient` and recorded fixtures, not the prompt's fake Pi adapter (`packages/pi-web-integration/test/`). |
| Reconciled Server-Sent Events | PI WEB live transport | **Equivalent behavior via a different transport.** PI WEB uses HTTP plus WebSockets, with reconnect cases in Workbench tests; SSE itself is not required. |
| Loopback bind | PI WEB server configuration | **Demonstrated default.** `127.0.0.1:8504` is documented. Loopback alone is not tailnet-reachable (`docs/config.md`). |
| CSRF rejection | PI WEB HTTP server | **Unverified here.** No equivalent Workbench integration evidence was located. |
| Host-header policy | PI WEB server / trusted proxy | **Unverified for production.** `PI_WEB_ALLOWED_HOSTS` is documented for the dev server, not as a general production guarantee. |
| Workspace-root confinement | PI WEB workspace API / filesystem boundary | **API demonstrated; confinement unverified.** Workspace file operations exist, but no equivalent root-escape test was located. |
| Secret handling | PI WEB deployment / configuration | **Unverified against the prompt's cases.** |
| Restart recovery | PI WEB transport plus Workstream session coordination | **Partly demonstrated.** Reconnect, host-unavailable, pending-association, and anchorless-session cases are tested; the prompt's exact restart matrix was not reproduced. |
| Mobile behavior | PI WEB client / Workbench adapter | **Substantive evidence, Acceptance pending.** Responsive tabs, coarse-pointer floors, narrow-layout fixtures, and Phase 6 checks exist (`docs/config.md`, `docs/plugins.md`, integration tests). |
| Tailscale Serve reachability | Deployment / owner-operated network | **Not demonstrated end to end.** PI WEB documents a trusted private bind or explicit tunnel/proxy; DODOREACH's prompt specifically names Serve. See [`dodo-reach-tailscale-file-transfer.md`](dodo-reach-tailscale-file-transfer.md). |

Workbench's own settled position is explicit: decision 4 makes PI WEB the user-facing client that
does not own workflow state; decision 24 scopes V1 as a PI WEB Workstream vertical slice; decision 76
requires proving a missing UI capability in a bounded adapter and contributing upstream rather than
forking or replacing. `packages/pi-web-integration/` already carries an implemented adapter with
tests covering projection, anchorless sessions, shell profiles, plugin packaging, unified navigation,
an isolated stack fixture, and phase-6 hardening. The Workstream contract further requires a pending
association under an idempotency key before host launch and reconnect reconciliation rather than
session recreation; this is a stronger ownership and recovery contract than a second dashboard-local
session map.

A direct test inventory found substantive reconnect and narrow-layout coverage. It did not locate
`packages/pi-web-integration` tests explicitly covering CSRF, workspace-root confinement, loopback
binding, or SDK-version matching. Device-responsive access, native Pi sessions, reconnecting
transport, default loopback, and workspace file APIs are demonstrated. Same-origin CSRF, cross-site
Origin rejection, forwarded-header handling for Tailscale Serve, exact SDK matching, and equivalent
deterministic security tests remain unestablished here. Some obligations may belong upstream rather
than in the Workbench adapter; absence from this package must not be misreported as absence from PI
WEB. The source prompt is useful because it makes ownership and evidence mapping testable.

Workbench's earlier Workstream UI plan was desktop-first, while requirement 12 and the
[Graphical Attention Contract](../../contracts/graphical-attention.md) require narrow, mobile, and
coarse-pointer behavior. The newer unified-shell candidate and Phase 6 tests now carry responsive and
accessibility gates, but release Acceptance remains pending. Any remaining gap belongs to the settled
client and its upstream seams, not to a different client.

## Candidate lessons (none accepted)

- **Reject as a candidate — a second web shell.** Building the prompt's server would duplicate
  session interpretation against settled decisions 4, 24, and 76, and would compete with an
  implemented, tested adapter. Recorded here as an explicitly unaccepted candidate; it is not an open
  option awaiting resources.
- **Experiment — import only unresolved acceptance cases as challenges to the existing integration.**
  Reconnect and narrow-layout behavior already have substantive adapter tests. The unresolved mapping
  includes opaque browser identifiers, SDK-version matching, CSRF, host policy, workspace-root
  confinement, secret handling, restart boundaries, and tailnet reachability. For each, first name
  whether PI WEB, the Workbench adapter, or another module owns the guarantee; then locate or add
  evidence only at that layer. Falsifier: if the owning module already provides equivalent evidence,
  drop the case rather than duplicating it in the adapter.
- **Experiment — verify and close any remaining mobile gap in the settled client.** Requirement 12
  already obliges narrow and mobile Workstream states, and the newer unified-shell candidate includes
  responsive tests. The prompt's mobile emphasis corroborates an existing obligation; it does not
  prove a current gap. Any remaining work belongs to PI WEB integration.
- **Insufficient evidence — the private implementation.** No verdict on its quality, reliability, or
  suitability is possible, and none is offered.

## Open questions

1. For the prompt's CSRF, workspace-root, loopback, secret, and SDK-version requirements, which are
   genuine gaps and which belong to PI WEB or another owning module rather than
   `packages/pi-web-integration/`?
2. Does the SSE-versus-WebSocket difference imply any reconciliation case Workbench does not already
   test, or is it purely a transport preference?
3. Do the unified-shell candidate's current narrow-layout tests cover the smallest credible mobile
   Workstream slice, including coarse-pointer access to protected controls?
4. Does "opaque browser identifiers" mean anything Workbench does not already obtain from PI WEB's
   session identity handling?

## Confidence and limitations

High confidence in the post framing and prompt body, which were recovered from the primary post and
re-verified during this analysis. High confidence in the
PI WEB behavior cited, which is a direct read of the named files at `8644d99`, and in the Workbench
decisions and contracts. Reconnect and narrow-layout test coverage were inspected directly; the
remaining acceptance cases require ownership-aware verification across PI WEB and Workbench rather
than inference from filenames. No assessment of the private implementation's quality is offered.
