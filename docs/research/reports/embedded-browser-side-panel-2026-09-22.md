# Embedded browser side panel for Pi Workbench

**Date:** 2026-09-22

**Status:** Corrected research report; recommendation only

**Decision owner:** Thomas

## Executive judgment

A browser side panel is feasible, but it is **not a current Workbench capability or an approved UI slice**. The smallest credible implementation is a local-machine-only proof that pairs a Chat-bound `agent-browser` session with a Workbench-owned viewer and explicit lifecycle controls. The installed dashboard can test the stream; embedding it is not the product panel.

The important constraints are:

1. Workbench's current `WKWebView` uses the application's default WebKit data store; it does not inherit Safari or Chrome login state.
2. Panel host and browser transport are separate decisions. Native AppKit, the web `WorkbenchApp`, and a Pi TUI overlay can host different surfaces; streamed frames do not choose the host.
3. Pi's TUI overlays can be interactive, but they do not embed a DOM browser or provide Workbench's native panel.
4. `agent-browser` 0.35.0 exposes a localhost image stream and remote input. `ws://127.0.0.1` reaches the viewer's machine, not a remote machine selected by a Workbench Chat.
5. Local-only versus remote-machine support is an explicit Thomas decision. Remote support requires an owned daemon placement and authenticated proxy or tunnel; Chat machine identity alone supplies neither.
6. Security prose, action controls, domain restrictions, and operating practice have different force. None makes arbitrary authenticated browsing safe.
7. Rendering frames for Thomas and sending browser content to a model are separate operations. Neither the stream nor `get cdp-url` automatically sends images to a model.
8. The observed stream shape is documented for 0.35.0, but no stream protocol version or negotiation was found. An integration must pin and test compatibility.
9. Workbench ownership of daemon startup, recovery, teardown, stale-session cleanup, remote forwarding, and upgrade compatibility remains unresolved.

## Scope and evidence

This report compares the current Workbench and Pi boundaries with browser tools available on 2026-09-22. It does not authorize product work, change the approved UI sequence, or claim that a prototype is production-ready.

The Workbench findings use repository source at `0ced8277f26a08ab426f7319a22c772a97c20fd8` and sibling PI WEB source at `cd43f41f1af4d57e34f09529ea15f31901feafb4`. The sibling checkout contained unrelated untracked prototype files during inspection, so only committed files at that revision are evidence.

Pi evidence comes from the installed `@earendil-works/pi-coding-agent` 0.85.1 package and its absolute paths in [S5]. `bc52ac151a8fe659509410d35079d2bb5f8c11ea` is the enclosing `pi-web-upstream-port-20260921` checkout HEAD, **not** a Pi source revision. [npm metadata for the published Pi package](https://registry.npmjs.org/@earendil-works/pi-coding-agent/0.85.1) reports `gitHead` `d981de1229ef899957bbe968bc8dcda02a21f477`.

Other package findings use installed `agent-browser` 0.35.0 and inspected npm tarballs for `pi-browser-harness` 0.11.0, `pi-agent-browser-native` 0.7.0, and `pire-browser` 0.2.35. Where behavior matters, the report cites source or first-party package documentation rather than package summaries.

## Current capability versus proposal

| Area | What exists now | What would still have to be built or decided |
|---|---|---|
| Workbench shell | AppKit puts one PI WEB `WKWebView` directly in each window; the current `WorkbenchApp` renders the chooser or Chat shell inside it. [S1][S3] | A browser-panel surface, complete-identity binding, commands, state, and accessibility behavior. |
| Approved sequence | Checkpoint 1 shipped. The plan put Workstream re-entry and direct Working Mode controls before files; its current slice table records those intervening slices as shipped or implemented, while files remains later and uncommitted. [S2] | Thomas would have to place a browser panel relative to files and the remaining attended checks. |
| Current Workbench web host | `WorkbenchApp` directly composes Chat and uses `PluginRegistry` only for themes. It does not load external plugins or render registry workspace panels. [S3] | Add a narrow browser panel directly to the replacement shell, or explicitly approve a new reusable seam. Do not restore the excluded PI WEB plugin-composed shell by accident. |
| PI WEB plugin host | The separate legacy `PiWebApp` loads versioned local and remote plugin manifests; the registry can publish machine-scoped workspace panels with lifecycle gates. [S3] | This is reusable evidence, not the current Workbench composition. The reuse boundary explicitly replaces `PiWebApp` and its plugin-composed application shell. |
| Machine scope | Workbench identifies every Chat by machine, project, workspace, and session; PI WEB routes remote runtime calls by machine. [S2][S3] | Decide whether browser execution is local to the Mac or co-located with the selected remote machine, and own any forwarding boundary. |
| Pi TUI overlays | Extensions may show interactive overlays. The shipped DOOM example runs a timed render loop and handles key press/release. [S5] | A DOM/browser engine, webpage accessibility, native side-panel composition, Chat selection binding, and browser lifecycle. |
| Browser automation | `agent-browser` controls browser sessions and exposes a localhost viewport stream with mouse, keyboard, and touch input. [S6] | Workbench controls, reconnect, lifecycle ownership, remote transport if selected, user-visible trust boundaries, and compatibility handling. |
| Dashboard | `agent-browser` includes a dashboard that discovers sessions and proxies their stream. [S7] | A selected-Chat-bound, toggleable product panel. The current Workbench release explicitly excludes dashboards and plugin-composed layout. [S2] |

### Host choice is independent of renderer and control transport

| Host choice | Current boundary | Consequence |
|---|---|---|
| Native AppKit side panel | `BrowserWindowController` currently makes the Chat `WKWebView` the window's entire `contentView`. [S1] | AppKit would own split-view composition and a bridge for selected Chat identity. It could host a native stream renderer or a second `WKWebView`; neither option supplies session binding or remote forwarding automatically. |
| Panel inside `WorkbenchApp` | The replacement Lit shell already owns selected machine/workspace/session presentation and directly renders Chat. It deliberately omits the old workspace-panel/plugin shell. [S3] | This is the narrowest current-shell host for an image/canvas stream viewer. External plugin loading is not a shortcut unless Thomas separately changes the reuse boundary and release scope. |
| Pi TUI overlay | Pi extensions can own interactive terminal overlays. [S5] | This creates a terminal surface, not a side panel in Pi Workbench. A terminal image preview would still need transport, input mapping, and lifecycle work. |

The visible renderer is a separate choice: image frames over the `agent-browser` WebSocket, a native second `WKWebView`, or web content inside the existing web host have different identity and accessibility properties. Structured browser commands or CDP are a third concern: they control or inspect the browser but do not determine where Thomas sees it.

### Why the TUI evidence is narrower than it first appears

The DOOM extension proves that a Pi extension can own an interactive overlay, repaint it, and receive keyboard transitions. It does **not** prove any of the following:

- embedding WebKit, Chromium, or arbitrary HTML;
- forwarding a browser accessibility tree;
- sharing an authenticated browser profile;
- composing a native macOS side panel around PI WEB;
- binding a browser session to the selected Chat.

A TUI overlay could show a coarse image preview, but that would be a separate terminal feature and not the Workbench side panel considered here.

## Authentication and session-store reality

`apps/pi-web-macos/Sources/PIWebMac/main.swift` creates a new `WKWebViewConfiguration` for each controller and assigns `WKWebsiteDataStore.default()`. That means:

- the webview uses Workbench's persistent WebKit website-data store;
- it does not automatically inherit Safari or Chrome cookies, tabs, extensions, keychain decisions, or profile state;
- separate controller configurations do not establish per-window cookie isolation because they point at the default store;
- changing the data-store strategy would be a product and migration decision, not a side effect of adding a panel. [S1]

The practical authentication choices are:

| Approach | Reality | Recommendation |
|---|---|---|
| Dedicated `agent-browser --profile <dir>` | Persists cookies, IndexedDB, service workers, and cache in an explicit Chrome user-data directory. The user logs in there. [S8] | Best baseline for attended browsing because its authority and blast radius are visible. |
| Saved/restored auth state | `state save/load` or `--restore` serializes browser authentication state. The files contain session tokens and need secret-grade storage and deletion policy. [S8] | Useful only after Workbench defines storage, encryption, retention, revocation, and UI disclosure. |
| Attach to a deliberately launched Chrome debug endpoint | `--auto-connect`, `--cdp`, and similar approaches can control an existing debuggable Chrome. Remote debugging permits cookie reads and JavaScript execution. [S8] | Expert opt-in only; never describe localhost or an existing profile as inherently safe. |
| Reuse a normal user's main Chrome profile | Some tools can bind to an existing Chrome profile or debugging endpoint. Concurrent profile locks, ambient credentials, extension state, and full-profile authority make this high risk. [S8][S10] | Not a default. Require a dedicated profile or deliberately scoped debug browser. |
| Direct Workbench `WKWebView` navigation | Uses the Workbench app's WebKit store, not the user's Safari/Chrome session. | Suitable only if a separate in-app browser and login experience is explicitly desired. |

`pi-browser-harness` 0.11.0 can launch or bind Chrome profiles and exposes JavaScript/raw-CDP operations. That is capability evidence, not a safety guarantee for a user's main profile. [S10]

## Tool comparison

| Candidate | Useful evidence | Important limit | Fit for this proposal |
|---|---|---|---|
| `agent-browser` 0.35.0 | Installed, has named sessions, persistent profiles/state, dashboard, localhost live stream, input messages, domain restrictions, and raw browser control. [S6][S8][S9] | The viewer protocol is image-based; Workbench integration and lifecycle are absent. | Best basis for a bounded prototype. |
| `pi-agent-browser-native` 0.7.0 | Exposes `agent-browser` as Pi tools and adds wrapper-owned session selection, coordination, timeout, redaction, and result handling. It preserves upstream confirmation IDs and `confirm`/`deny` follow-ups. [S11] | Wrapper session policy is not browser action policy. `--confirm-actions` and pending-action controls belong to `agent-browser`; neither path governs direct human stream input, direct CDP, or another integration. | Useful for model/tool access, not the human panel itself. |
| `pi-browser-harness` 0.11.0 | Broad CDP and profile attachment, including an existing Chrome profile. [S10] | Greater raw authority and weaker default isolation make it a poor baseline for ambient authenticated browsing. | Research comparator or expert lane. |
| `pire-browser` 0.2.35 | Firefox extension/native-host route with browser integration. [S12] | Its manifest requests broad permissions, including all URLs, cookies, tabs/windows, native messaging, downloads, proxy, clipboard, and blocking web requests. | Too broad for the first Workbench slice. |
| Workbench `WKWebView` | Already present in the native app. [S1] | Separate browser identity from Safari/Chrome; no existing browser-panel contract. | Reuse as a host only after deciding whether the panel is a remote-frame viewer or an independent WebKit browser. |

## What `agent-browser` streaming actually provides

For installed 0.35.0, `stream enable` starts a server on an OS-assigned localhost port unless pinned; `stream status --json` reports its state and port; `stream disable` tears it down. Browser clients connect to `ws://127.0.0.1:<port>`. The documented server messages are:

- `frame`: base64 image bytes, a monotonic `seq`, and viewport/capture metadata;
- `status`, `tabs`, `url`, and `console`: ordered live events, but not an audit log.

Clients may send mouse, keyboard, touch, frame-rate configuration, pacing configuration, and acknowledgements. Ack pacing bounds frames in flight; rate limiting and image dimensions can reduce bandwidth. [S6]

The CLI's current default is also narrower than a Workbench lifecycle contract: an inactive daemon normally saves configured restore state, closes its headless browser, and exits after one hour. Headed browsers, local Safari and iOS WebDriver sessions, and user-attached browsers are exempt; provider-owned cloud browsers are not. Stream/dashboard mouse, keyboard, and touch input reset the idle timer, so an actively driven panel stays alive. Without a restore key, shutdown discards transient tabs and state. Workbench still has to decide supervision, restore policy, explicit close semantics, crash recovery, and cleanup. [S6][S8]

### Localhost does not represent a remote Chat

The browser runs wherever the `agent-browser` daemon runs, and its stream listens only on that host's loopback interface. A WebSocket opened as `ws://127.0.0.1:<port>` by the macOS Workbench client or its `WKWebView` therefore reaches the Mac. Selecting a remote PI WEB machine changes the Chat's API identity; it does not rewrite loopback or discover a browser daemon on that machine. [S2][S3][S6]

There are two coherent scopes:

- **Local-only:** Workbench owns an `agent-browser` daemon on the Mac. A remote Chat may still show that explicitly local browser, or the panel may be unavailable for remote Chats. It must never imply that the browser runs on the selected remote machine.
- **Remote-capable:** an agent-browser daemon runs on the selected machine. A trusted remote PI WEB component must own daemon start/status/close and connect to its loopback stream; the PI WEB gateway must expose an authenticated, authorized, same-origin WebSocket proxy or Workbench must own an equivalent per-session tunnel. The client must never expose or guess a raw remote stream port.

Remote forwarding expands the trust boundary. The proxy or tunnel needs transport encryption, complete machine/project/workspace/session authorization, per-session route isolation, input authorization, origin handling, reconnect limits, and teardown when the Chat, panel, remote runtime, or app closes. Localhost binding alone supplies none of those controls. Thomas must choose local-only or remote-capable scope before Pia implements the bounded Workbench proof.

This is a **release-specific observed contract**, not a proven stable protocol. The inspected docs and stream implementation do not expose a protocol version field or negotiation handshake. Therefore a Workbench integration should:

1. pin a supported `agent-browser` version;
2. validate message types and ignore unknown fields safely;
3. fail visibly on unsupported required fields;
4. include a compatibility smoke test in upgrades;
5. avoid presenting this shape as a durable Workbench protocol until Workbench owns or negotiates one.

The stream is for viewport rendering and remote input. `get cdp-url` exposes a browser-control endpoint; it does not transmit screenshot frames to a model. A model sees pixels only when a tool explicitly captures/returns an image or another component forwards one.

## Security: mechanism, guidance, and gaps

| Control or statement | What it really provides |
|---|---|
| Treat page content as untrusted | Operating guidance against indirect prompt injection. It does not enforce model behavior. [S9] |
| `--allowed-domains` | A documented enforcement mechanism for supported Chromium sessions and specified network channels, with launch-mode and browser limitations. It is not a universal network sandbox. [S9] |
| `agent-browser --confirm-actions` and pending `confirm`/`deny` controls | Upstream browser controls for configured action categories. `pi-agent-browser-native` forwards the controls and preserves confirmation-required/policy-blocked outcomes; its separate wrapper session management selects and coordinates browser sessions. Neither governs human stream input, direct CDP, or another integration. [S8][S11] |
| Localhost stream binding | Reduces network exposure. It is not authentication against other local processes. Browser-origin checks accept loopback/file origins, and clients without an `Origin` header are accepted by the inspected stream implementation. [S6][S7] |
| Dedicated profile | Reduces the credential blast radius relative to a daily browser profile. It still contains sensitive authenticated state. |
| Workbench permission or mode text | Unless a deterministic module mediates the side effect, it is behavior guidance rather than a guarantee. [S4] |

A production design needs explicit answers for profile location and permissions, token/state encryption, allowed destinations, download/upload behavior, clipboard access, external protocol launches, file pickers, certificate errors, popups, raw CDP/eval access, session deletion, and audit evidence. The first slice should omit capabilities that are not required.

## Human rendering is not model inspection

The panel can render frames for Thomas without adding those frames to model context. Conversely, a model can inspect browser DOM/text through an automation tool without seeing the rendered frame.

When pixel inspection is genuinely required, it must be an explicit operation with an explicit recipient. Under current operating policy, image-byte inspection is delegated to a background subagent rather than loaded into the lead session. The UI should therefore distinguish:

- **View for Thomas:** local rendering only;
- **Read/act through browser tools:** structured browser operations subject to their policy path;
- **Inspect pixels with a model:** a separately disclosed screenshot/frame capture and delegated inspection.

No implementation should imply that opening the panel, starting the stream, or obtaining a CDP URL authorizes model vision.

## Minimum credible panel slice

A stream viewer alone is only a transport smoke test. A real Workbench slice needs all of the following:

1. **Approved host and toggle** — Thomas chooses native AppKit or direct composition inside `WorkbenchApp`; a command/button opens and closes the panel without replacing Chat. The slice must not revive `PiWebApp` or the excluded plugin-composed shell. [S2][S3]
2. **Selected-Chat binding** — exactly one browser identity binds to the complete machine/project/workspace/session identity. Switching Chat rebinds the panel and cannot send input to the previous Chat's tab. Browser references remain non-authoritative client/session data. [S2][S4]
3. **Navigation and input** — address entry, back, forward, reload/stop, visible current origin, focus transfer, keyboard, pointer, scrolling, and recoverable error states. Remote input alone is insufficient.
4. **Renderer and control transport** — independently choose the visible renderer and the control/model path. For a stream renderer, preserve aspect ratio, transform coordinates, cap frame rate, use appropriate pacing, reject stale frames, and expose connection state. A second WebKit page has different identity and accessibility behavior; CDP or structured tools do not determine the host.
5. **Window/session isolation** — use a dedicated browser profile and a unique `agent-browser` session per selected Chat, or define a deliberately shared alternative. Workbench's default WebKit store is not evidence of such isolation.
6. **Machine scope** — the first proof is local-only unless Thomas chooses remote support. A local-only panel must label the browser as local and define behavior for remote Chats. A remote-capable panel needs an owned remote daemon and authenticated PI WEB proxy or equivalent tunnel; raw `127.0.0.1` cannot cross the machine boundary.
7. **Lifecycle** — define which local or remote component starts the daemon and browser, discovers the port, owns any proxy/tunnel, supervises reconnect/backoff, survives or rejects upgrades, and closes stale process/socket/profile/proxy state. Account for dashboard input extending daemon life.
8. **Trust disclosure** — show active machine, browser location, profile/session, current origin, model-access state, and destructive capabilities. Do not label guidance or wrapper session management as action enforcement.
9. **Boundary-respecting state** — the client may cache view state, but Workstream/Run authority remains in deterministic Workbench modules. Dashboard embedding or PI WEB's old plugin shell must not become the architecture by accident. [S2][S3][S4]

## Recommended proof sequence

### Proof 1: local transport smoke test

Use a dedicated test profile and pinned `agent-browser` 0.35.0 on the Mac. Start one session, enable streaming, discover the assigned loopback port, render frames in a disposable local viewer, send pointer/keyboard input, verify that input resets idle time, and test disconnect/reconnect and explicit close. The dashboard may confirm only that the underlying stream works.

Success proves local stream compatibility and coordinate/input viability. It proves neither a Workbench panel nor remote-machine transport.

### Proof 2: bounded local Workbench prototype

After Thomas chooses the host, add a development-flagged, toggleable panel bound to the selected Chat with only:

- dedicated profile and named session;
- address/back/forward/reload controls;
- stream render and basic input;
- visible origin, complete Chat identity, **Local browser** location, session, and connection state;
- a clear disabled or local-browser state when the Chat's selected machine is remote;
- deterministic teardown.

Do not add a remote proxy, model pixel forwarding, main-profile attachment, downloads, uploads, arbitrary CDP/eval, or persistence beyond the proof. If Thomas chooses remote support for the first slice, replace this proof with a separately bounded proxy/tunnel proof before panel work.

### Acceptance evidence before product commitment

- Switching Chats cannot send input to the wrong session.
- Two local Chats demonstrate the chosen isolation rule.
- Selecting a remote Chat cannot silently operate a local browser as though it were remote.
- If remote support is selected, the remote-daemon/proxy proof authenticates complete Chat identity and covers disconnect, app/remote-runtime restart, and teardown.
- App and daemon restarts have documented, tested outcomes.
- Closing the panel, Chat, and app each have explicit browser/daemon semantics, including an actively driven stream that reset idle time.
- Unsupported stream messages fail safely and visibly.
- The panel remains usable by keyboard and exposes useful accessibility labels even though page pixels do not provide a native accessibility tree.
- Security claims are mapped to an enforcing component or labeled as guidance.
- Thomas explicitly approves the host, machine scope, and any change to the planned UI sequence, then manually checks the interaction.

## Unresolved decisions and risks

1. **Product priority:** whether the browser panel follows, accompanies, or displaces files after the intervening Workstream/Working Mode slices and their attended checks.
2. **Panel host:** native AppKit composition or direct composition inside `WorkbenchApp`. Pi TUI is a separate terminal feature, not the Workbench panel.
3. **Renderer and control path:** image stream, native second `WKWebView`, web-hosted content, and structured/CDP control have different identity, accessibility, and authority; choosing one does not choose the others.
4. **Machine scope:** local-only first slice or remote-machine support. For local-only, decide whether remote Chats show a clearly local browser or no panel. For remote support, choose daemon and authenticated proxy/tunnel ownership.
5. **Session lifetime:** per Chat, per Workstream, or explicitly shared; and whether sessions survive app restart.
6. **Process ownership:** bundled or external `agent-browser`, local/remote daemon supervision, proxy lifecycle, crash recovery, upgrades, logs, and stale cleanup.
7. **Authentication custody:** dedicated profile only versus managed auth-state import; encryption and deletion requirements.
8. **Model authority:** which structured actions are available, through which enforcing adapter, and whether raw CDP/eval is excluded.
9. **Accessibility:** an image stream has no webpage accessibility tree. A production panel needs an alternate semantic path or an accepted limitation.
10. **Protocol ownership:** consume a pinned third-party stream or introduce a Workbench-owned adapter contract.

## Recommendation

Proceed only after Thomas chooses **panel host** and **local-only versus remote support**. The smallest proof remains local AppKit-hosted or `WorkbenchApp`-hosted streaming with a dedicated profile and no model image path. Treat the dashboard as diagnostic evidence, not product UI. After the transport proof, Thomas should decide product priority, renderer/control path, session lifetime, and authentication custody before Pia implements one bounded Workbench slice.

## Sources

Accessed 2026-09-22 unless noted.

- **[S1]** `apps/pi-web-macos/Sources/PIWebMac/main.swift` at Workbench revision `0ced8277f26a08ab426f7319a22c772a97c20fd8`.
- **[S2]** `docs/plans/workbench-ui.md` at the same revision, including the current sequence, accepted-slice table, ownership section, and explicit dashboard/plugin-composed-layout release exclusions.
- **[S3]** `docs/integrations/pi-web/reuse-boundary.md`; sibling PI WEB files `../pi-web/src/client/src/main.ts`, `../pi-web/src/client/src/components/WorkbenchApp.ts`, `../pi-web/src/client/src/components/PiWebApp.ts`, `../pi-web/src/client/src/plugins/registry.ts`, and `../pi-web/src/client/src/plugins/external.ts` at committed revision `cd43f41f1af4d57e34f09529ea15f31901feafb4`.
- **[S4]** `docs/contracts/interfaces.md` and `docs/contracts/graphical-attention.md`.
- **[S5]** Installed `@earendil-works/pi-coding-agent` 0.85.1 package metadata, docs, and example source: `/Users/tschuehly/IdeaProjects/pi-web-upstream-port-20260921/node_modules/@earendil-works/pi-coding-agent/package.json`, `/Users/tschuehly/IdeaProjects/pi-web-upstream-port-20260921/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`, `/Users/tschuehly/IdeaProjects/pi-web-upstream-port-20260921/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`, and `/Users/tschuehly/IdeaProjects/pi-web-upstream-port-20260921/node_modules/@earendil-works/pi-coding-agent/examples/extensions/doom-overlay/`. [Published npm metadata](https://registry.npmjs.org/@earendil-works/pi-coding-agent/0.85.1) reports `gitHead` `d981de1229ef899957bbe968bc8dcda02a21f477`; the enclosing checkout HEAD `bc52ac151a8fe659509410d35079d2bb5f8c11ea` is not Pi provenance.
- **[S6]** Installed `agent-browser` 0.35.0 streaming documentation: `/opt/homebrew/Cellar/agent-browser/0.35.0/libexec/lib/node_modules/agent-browser/skill-data/core/references/streaming.md`; release source: [stream module](https://github.com/vercel-labs/agent-browser/tree/v0.35.0/cli/src/native/stream).
- **[S7]** `agent-browser` 0.35.0 source: [dashboard proxy](https://github.com/vercel-labs/agent-browser/blob/v0.35.0/cli/src/native/stream/dashboard.rs), [stream origin handling](https://github.com/vercel-labs/agent-browser/blob/v0.35.0/cli/src/native/stream/mod.rs), and [WebSocket handling](https://github.com/vercel-labs/agent-browser/blob/v0.35.0/cli/src/native/stream/websocket.rs).
- **[S8]** Installed `agent-browser` 0.35.0 operating, command, and authentication documentation: `/opt/homebrew/Cellar/agent-browser/0.35.0/libexec/lib/node_modules/agent-browser/skill-data/core/SKILL.md`, `/opt/homebrew/Cellar/agent-browser/0.35.0/libexec/lib/node_modules/agent-browser/skill-data/core/references/commands.md`, `/opt/homebrew/Cellar/agent-browser/0.35.0/libexec/lib/node_modules/agent-browser/skill-data/core/references/authentication.md`, and `/opt/homebrew/Cellar/agent-browser/0.35.0/libexec/lib/node_modules/agent-browser/skill-data/core/references/session-management.md`.
- **[S9]** Installed `agent-browser` 0.35.0 trust-boundary documentation: `/opt/homebrew/Cellar/agent-browser/0.35.0/libexec/lib/node_modules/agent-browser/skill-data/core/references/trust-boundaries.md`.
- **[S10]** `pi-browser-harness` 0.11.0, source revision `f20fdf7fc4039ea71f3a8b56c7c508e46f1bbc51`: [README](https://github.com/amankumarsingh77/pi-browser-harness/blob/f20fdf7fc4039ea71f3a8b56c7c508e46f1bbc51/README.md), [profile binding](https://github.com/amankumarsingh77/pi-browser-harness/blob/f20fdf7fc4039ea71f3a8b56c7c508e46f1bbc51/src/profile/bind.ts), and [raw CDP domain](https://github.com/amankumarsingh77/pi-browser-harness/blob/f20fdf7fc4039ea71f3a8b56c7c508e46f1bbc51/src/domains/cdp-call.ts).
- **[S11]** `pi-agent-browser-native` 0.7.0 [npm tarball](https://registry.npmjs.org/pi-agent-browser-native/-/pi-agent-browser-native-0.7.0.tgz) (contract packaged as `docs/TOOL_CONTRACT.md`) and tagged source revision `40e1c2a502f2da2f833d3f8a1c9ae3d5ec2868b4`: [tagged tool contract](https://github.com/fitchmultz/pi-agent-browser-native/blob/40e1c2a502f2da2f833d3f8a1c9ae3d5ec2868b4/docs/TOOL_CONTRACT.md), and [README](https://github.com/fitchmultz/pi-agent-browser-native/blob/40e1c2a502f2da2f833d3f8a1c9ae3d5ec2868b4/README.md). The tool contract documents upstream `--confirm-actions`, exact `confirm`/`deny` follow-ups, confirmation/policy result categories, and separate wrapper-managed session behavior.
- **[S12]** `pire-browser` 0.2.35, source revision `c268bad38e9c68c9a6904912f17aa388145f8f25`: [README](https://github.com/ryenwang/pire-browser/blob/c268bad38e9c68c9a6904912f17aa388145f8f25/README.md) and [Firefox extension manifest](https://github.com/ryenwang/pire-browser/blob/c268bad38e9c68c9a6904912f17aa388145f8f25/extension/manifest.json).
