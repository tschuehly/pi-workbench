# DODOREACH Pi mobile web UI: evidence ledger

**Reviewed:** 2026-08-11

**Workbench baseline first inspected:** `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

**Research only.** This ledger contains no accepted recommendation, approved plan, or settled decision. Every classification is a candidate for a separate later decision.

## Bottom line

The [July 21, 2026 post](https://x.com/DODOREACH/status/2079645642532462850) demonstrates a well-shaped one-shot prompt and shows a photographed surface. It does not demonstrate implementation correctness: the code is private, and the photograph shows only that something apparently rendered.

The prompt is useful as an acceptance checklist. It keeps Pi authoritative, rejects a second transcript store, and names its own test obligations. It is not a build proposal for Workbench.

At the time of this review, Workbench rejected a second shell because the PI WEB application shell was the settled client. The 2026-08-28 UI reset later superseded that product decision: the current plan keeps PI WEB runtime but replaces its shell with a focused Workbench client. The finding that still holds is narrower—do not create another session runtime or transcript store. The acceptance cases below remain useful evidence for the layer that owns each guarantee.

## Source and method

An anonymous direct fetch recovered the complete post and prompt. The author declined to release the private UI; instead, the author shared a one-shot prompt to help users learn how to shape their own tools. This analysis re-verified the full prompt against that primary source. [`dodo-reach-pi-tool-shaping.md`](dodo-reach-pi-tool-shaping.md) contains a condensed requirements summary with the same framing.

The comparison used these locally checked-out revisions and artifacts:

| Artifact | Identity | Evidence used |
| --- | --- | --- |
| PI WEB shell | Sibling `../pi-web` at `8644d99`; `README.md`, `docs/config.md`, `docs/plugins.md`, and `docker/README.md` | Device support, loopback bind, allowed hosts, WebSocket transport, Progressive Web App (PWA) prefix behavior, and mobile tabs |
| Workbench decisions at the time of review | Then-current `docs/foundation/decisions.md` items 4, 24, 33, 65, 76, 87–89, and 96 | PI WEB was the client; the Workstream Store, execution adapter, and session coordinator retained their ownership; extensibility was upstream-first. The 2026-08-28 reset later superseded the shell decision. |
| Historical Workbench PI WEB work | `packages/pi-web-integration/test/`, `docs/archive/pi-web-ui/plans/pi-web-workbench-ui.md`, and pre-reset `docs/foundation/requirements.md` item 12 | Historical tests and mobile requirements; the 2026-08-28 macOS-first reset no longer makes mobile a current-slice gate |

## What the source does—and does not—prove

The prompt requires all of the following, restated without embellishment:

- Pi remains the runtime and owner of native sessions.
- The browser receives opaque workspace and session identifiers.
- No second transcript database is created.
- The software development kit (SDK) is pinned to the installed Pi version.
- A fake adapter supports testing.
- Server-Sent Events (SSE) are reconciled.
- The server binds to loopback.
- Tests cover cross-site request forgery (CSRF), host handling, workspace roots, secret handling, restart, mobile behavior, and Tailscale.

The public evidence supports only these conclusions:

| Claim | Evidence status |
| --- | --- |
| The author wrote these requirements | **Demonstrated** by the post |
| A surface existed and rendered on a phone | **Suggested** by a photograph; not inspectable |
| The requirements were implemented correctly | **Not demonstrated**; the code is private |
| Reconnects were reconciled, CSRF was resisted, or workspace roots were confined | **Not demonstrated**; no tests, logs, or code are public |
| The approach outperforms an existing shell | **Not demonstrated**; no comparison exists |

The photograph and prompt omit exactly the properties that are hardest to implement correctly, even though the prompt names those properties. Treating the prompt's ambition as its outcome would be novelty bias.

## Comparison with implemented behavior at the time of review

PI WEB demonstrably covers some environmental requirements. Other security and compatibility claims still need evidence from the layer that owns them.

| Prompt requirement | Owning layer | Current status and evidence |
| --- | --- | --- |
| Pi remains runtime and native-session owner | PI WEB session daemon / Pi | **Demonstrated.** PI WEB hosts native Pi sessions and binds extensions in `rpc` mode; it does not reimplement the agent (`README.md`, `docs/plugins.md`). |
| Browser receives opaque workspace and session identifiers | PI WEB browser protocol | **Unverified as stated.** Session identity handling exists, but this review did not establish opacity for the specified workspace and session identifiers. |
| No second transcript database | PI WEB / Workbench adapter ownership | **Demonstrated for the Workbench adapter.** Native Pi sessions remain the conversation source. The adapter projects Workstream associations and does not persist a second transcript (`docs/foundation/decisions.md` items 4 and 24). |
| SDK pinned to installed Pi version | PI WEB packaging and launch | **Unverified exact-match guarantee.** No equivalent integration test was located. |
| Fake adapter for deterministic tests | PI WEB / Pi integration-adapter layer | **Partial analogue only.** Workbench has a `DeterministicFakeWorkstreamClient` and recorded fixtures, not the prompt's fake Pi adapter (`packages/pi-web-integration/test/`). |
| Reconciled SSE | PI WEB live transport | **Equivalent behavior through a different transport.** PI WEB uses HTTP plus WebSockets, with reconnect cases in Workbench tests; SSE itself is not required. |
| Loopback bind | PI WEB server configuration | **Demonstrated default.** `127.0.0.1:8504` is documented. Loopback alone is not tailnet-reachable (`docs/config.md`). |
| CSRF rejection | PI WEB HTTP server | **Unverified here.** No equivalent Workbench integration evidence was located. |
| Host-header policy | PI WEB server / trusted proxy | **Unverified for production.** `PI_WEB_ALLOWED_HOSTS` is documented for the development server, not as a general production guarantee. |
| Workspace-root confinement | PI WEB workspace API / filesystem boundary | **API demonstrated; confinement unverified.** Workspace file operations exist, but no equivalent root-escape test was located. |
| Secret handling | PI WEB deployment / configuration | **Unverified against the prompt's cases.** |
| Restart recovery | PI WEB transport plus Workstream session coordination | **Partly demonstrated.** Reconnect, host-unavailable, pending-association, and anchorless-session cases are tested; the prompt's exact restart matrix was not reproduced. |
| Mobile behavior | PI WEB client / Workbench adapter | **Substantive evidence; Acceptance pending.** Responsive tabs, coarse-pointer floors, narrow-layout fixtures, and Phase 6 checks exist (`docs/config.md`, `docs/plugins.md`, integration tests). |
| Tailscale Serve reachability | Deployment / owner-operated network | **Not demonstrated end to end.** PI WEB documents a trusted private bind or explicit tunnel/proxy; DODOREACH's prompt specifically names Serve. See [`dodo-reach-tailscale-file-transfer.md`](dodo-reach-tailscale-file-transfer.md). |

### Ownership conclusion at the time of review

The then-current decisions made PI WEB the user-facing client, scoped V1 as a PI WEB Workstream vertical slice, and preferred an upstream contribution over a fork or replacement. The 2026-08-28 reset superseded those shell and scope choices. The [current reuse boundary](../../integrations/pi-web/reuse-boundary.md) keeps PI WEB runtime and useful leaf components while replacing the application shell.

`packages/pi-web-integration/` still contains useful evidence: tests for projection, anchorless sessions, shell profiles, plugin packaging, unified navigation, an isolated stack fixture, and Phase 6 hardening. The Workstream contract still requires a pending association under an idempotency key before host launch, followed by reconnect reconciliation rather than session recreation. Those mechanisms remain stronger than a dashboard-local session map.

### Evidence still missing

A direct test inventory found substantive reconnect and narrow-layout coverage. It did not find `packages/pi-web-integration` tests that explicitly cover:

- CSRF;
- workspace-root confinement;
- loopback binding; or
- SDK-version matching.

Device-responsive access, native Pi sessions, reconnecting transport, default loopback, and workspace file APIs are demonstrated. The following remain unestablished in this review: same-origin CSRF, cross-site `Origin` rejection, forwarded-header handling for Tailscale Serve, exact SDK matching, and equivalent deterministic security tests.

Some obligations may belong upstream rather than in the Workbench adapter. Their absence from this package must not be reported as absence from PI WEB. The prompt's useful contribution is to make ownership and evidence mapping testable.

### Mobile scope

Earlier Workstream UI requirements and the archived unified-shell candidate included mobile, narrow-layout, and coarse-pointer gates. The 2026-08-28 reset made the first replacement slice macOS-only, so mobile is no longer a current release gate.

The archived responsive tests remain evidence for a future mobile slice. They create no current implementation scope.

## Candidate lessons—none accepted

### Reject as a candidate: a second web shell

**Original 2026-08-11 conclusion:** Building the prompt's server would duplicate session interpretation against then-settled Decisions 4, 24, and 76 and compete with an implemented, tested adapter. It was recorded as explicitly unaccepted, not as an open option awaiting resources.

**Superseded 2026-08-28:** Replacing PI WEB's presentation is now approved. The remaining rejection is narrower: do not create another session owner, runtime, or transcript store.

### Experiment: test unresolved cases in the existing integration

Reconnect and narrow-layout behavior already have substantive adapter tests. The unresolved mapping includes opaque browser identifiers, SDK-version matching, CSRF, host policy, workspace-root confinement, secret handling, restart boundaries, and tailnet reachability.

For each case, first identify whether PI WEB, the Workbench adapter, or another module owns the guarantee. Then locate or add evidence only in that layer. **Falsifier:** if the owning module already provides equivalent evidence, drop the case instead of duplicating it in the adapter.

### Experiment: close any remaining mobile gap in the settled client

**Original 2026-08-11 conclusion:** Then-current Requirement 12 required narrow and mobile Workstream states, and the unified-shell candidate included responsive tests. The prompt corroborated that obligation but did not prove a gap; remaining work belonged to PI WEB integration.

**Superseded 2026-08-28:** Mobile is no longer a current release gate. If a mobile slice is selected later, start with the archived responsive evidence and verify only the remaining gaps in the owning client and runtime layers.

### Insufficient evidence: the private implementation

No verdict on its quality, reliability, or suitability is possible or offered.

## Open questions

1. Which prompt requirements—CSRF, workspace root, loopback, secret handling, and SDK version—are genuine gaps, and which belong to PI WEB or another owning module rather than `packages/pi-web-integration/`?
2. Does the SSE-versus-WebSocket difference create a reconciliation case that Workbench does not already test, or is it only a transport preference?
3. If a mobile slice is selected later, do the archived narrow-layout tests cover its smallest credible Workstream surface, including coarse-pointer access to protected controls?
4. Does “opaque browser identifiers” require anything beyond PI WEB's existing session identity handling?

## Confidence and limits

Confidence is high in the post framing and prompt body: both were recovered from the primary post and re-verified during this analysis. Confidence is also high in the cited PI WEB behavior at `8644d99` and in the Workbench decisions and contracts as they stood when this ledger was written. Current product direction must come from the present decision record and UI plan.

Reconnect and narrow-layout coverage were inspected directly. The other acceptance cases require ownership-aware verification across PI WEB and Workbench; filenames alone are not evidence. This ledger makes no assessment of the private implementation's quality.
