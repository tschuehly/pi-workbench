# PI WEB v1 Workbench probe evidence

Status: bounded v1 probe, generic navigation/primary-view slice, and typed Workstream transport completed.

## Supported through documented v1 interfaces

| Interaction | v1 mechanism | Result |
| --- | --- | --- |
| Open Run status | Qualified action calls `selectWorkspaceTool` | Expressible without routes or internal elements. |
| Show compact Run context | Workspace label with async file cache and `host.requestRender` | Expressible; label remains workspace-scoped. |
| Present pending Human Attention and Run authority | Read-oriented workspace panel | Expressible for bounded context, including narrow layouts. |
| Separate required judgment from autonomous activity | Panel sections over a deterministic projection | Expressible without treating PI WEB sessions as Runs. |
| Inspect text Primary Evidence | `files.readFile` from an explicit workspace-relative path | Expressible as a bounded in-panel preview. |
| Apply compact presentation | Inherited public density tokens | Plugin content follows host density without selectors or CSS injection. |
| Missing generated projection | Module-relative recorded fixture | Deterministic fallback is visible and does not claim authority. |
| Open Workstreams | Qualified navigation entry targets a qualified primary view | Expressible without private routes or replacing shell internals. |
| Present recorded Workstream projection | Primary view over a deterministic fake client | Loading, empty, failure, reconnect, active, closed, checkpoint, task, and link states have explicit presentation. |
| Preserve view and focus | Qualified URL/per-machine view restoration and host focus surface | Reload restores Workstreams; explicit navigation transfers focus without rerenders stealing it. |
| Retain responsive shell access | Desktop navigation, mobile tabs, context bar, and action palette | Conversation, workspace context, settings, authentication, recovery, and actions remain PI WEB-owned and reachable. |
| Call the Workstream Store | Plugin-scoped `service.request(operation, input)` JSON transport | All six typed operations reach the Workbench-owned store without workspace files, terminals, or private routes. |
| Persist across web-process restart | User-local file adapter reconstructed by the plugin service module | A replacement service instance inspects and closes a Workstream created before replacement. |
| Reconnect ordered observation | Browser retains `nextSequence` and calls typed `watch` | Replay inspects only changed Workstreams; unavailable replay atomically replaces the projection from canonical snapshots. |

## Evidence gathered

- The upstream density selector applies without reload, persists through browser reload, and leaves
  application body text at 14 px.
- Comfortable project rows measured 46 px in the live shell; compact project rows measured 28 px
  with the same names and paths retained in one truncation-aware row. This exceeds the 25% row-count
  target in the representative desktop list.
- The Appearance surface and all density choices remained operable at 320 px.
- Coarse-pointer CSS restores 44 px control and list-row targets while retaining compact
  non-interactive spacing.
- The plugin parser accepts the recorded Run and Workstream projections and rejects unsupported or
  incomplete shapes without starting Pi or spending model tokens.
- The Workstreams destination was exercised at desktop, 390 px, and 320 px widths. Its qualified URL
  survived reload, explicit selection focused the hosted surface, the reconnect notice preserved the
  last projection, and the action palette retained settings and provider-authentication access.
- Contract tests exercised `create`, `append`, `list`, `inspect`, `watch`, and `close` through the
  browser client and web-process service. Re-importing the service against the same user-local
  directory preserved the ledger and projection. Focused tests also proved ordered replay,
  snapshot replacement, and semantic error-code preservation. After rebasing onto current PI WEB,
  upstream typecheck, lint, Knip, and all 269 test files passed: 2,347 tests passed and 3 were
  skipped. The rebase also corrected Node 26 local-storage test setup, macOS canonical temporary
  paths, session transcript-cache isolation, and the local `node-pty` helper permission.

## Step 4 completion evidence

- **Versions:** the live browser/restart probe used PI WEB `1.202607.1`; the implementation was
  rebased and fully verified on PI WEB `1.202607.3`. Pi runtime and peer line remained `0.83.0`;
  Workbench packages remained `0.1.0`.
- **Model binding:** implementation lead used `openai-codex/gpt-5.6-sol` at medium reasoning.
  The deterministic checks and browser flow launched no child models.
- **Elapsed work:** interaction/model-work telemetry was not instrumented for this slice; this is a
  retained evidence limitation rather than an estimated value.
- **Verification:** Workstream Store checks passed 7/7; PI WEB integration checks passed 7/7;
  focused upstream plugin/service/registry checks passed 53/53; final upstream typecheck, lint,
  Knip, and the complete 2,350-test suite passed (2,347 passed, 3 skipped). A live
  Chromium flow created a Workstream, appended a link, reloaded the browser, restarted the PI WEB
  web/API child process, reloaded the restored qualified view, observed revision 2/sequence 2, and
  closed the Workstream. The session daemon was not restarted.
- **Recovery:** the live projection survived browser and web-process replacement from the
  user-local file store. Contract fixtures separately exercised ordered replay and snapshot
  reconciliation while preserving semantic error codes.
- **Corrections and failures:** no human corrections occurred. The first browser probe targeted the
  API port (`8504`) rather than the Vite client port (`8505`) and rendered an empty shell; retargeting
  the client port resolved it. Stale “read-only recorded projection” copy discovered in the live
  flow was corrected before completion.
- **Next-slice effect:** Step 5 can reuse the six-operation client, receipts, revision checks, and
  reconnect projection. It still needs session-launch orchestration and checkpoint semantics; this
  slice grants neither session nor Run authority.

## Demonstrated gaps

| Needed interaction | Why v1 is insufficient | Constraint violated by workarounds | Earliest gated phase |
| --- | --- | --- | --- |
| React immediately to a generated projection changing outside the panel | v1 offers `requestRender` but no workspace-file watch or stable shell watch; the probe can only reload explicitly or poll. | Polling and leaked listeners are disallowed. | Phase 3 stable host observation, only if repeated use proves shell observation rather than a narrower file-watch helper is needed. |
| Reconcile ordered Run changes across disconnect and reconnect | A workspace file is a snapshot and PI WEB exposes no external ordered event subscription. | Private routes and unstable runtime objects are disallowed. | Phase 7 Run client; Phase 3 only for shell context, not Run events. |
| Restore a selected evidence target after reconnect | The panel lifecycle is available, but v1 has no namespaced plugin preference interface or contribution selection state contract. | Browser-global ad hoc storage would obscure shell ownership and machine/workspace scope. | Phase 4 settings/preferences or Phase 5 primary-view lifecycle if the accepted interaction requires it. |
| Link Primary Evidence into PI WEB's native file viewer | `files.readFile` can preview content, but v1 has no stable command to select Files and focus a workspace-relative path. | Constructing private routes is disallowed. | Smallest upstream action/command addition after repeated evidence; no new contribution location is required. |
| Present a portfolio-wide attention entry point | Workspace labels and panels are scoped to the selected workspace. | Broad `AppState`, global polling, and workspace-panel takeover are disallowed. | Navigation/status only after the probe has a framework-neutral cross-workspace Run projection. |
| Host a full action-first Review Surface in the main region | The workspace panel is constrained and competes with evidence width at narrow desktop layouts. | Replacing conversation or reaching into Lit internals is disallowed. | Reuse the primary-view interface proven by the Level selector; add Review Surface semantics only after a concrete managed interaction passes its fixture. |
| Submit typed Run judgments | v1 terminal helpers transport shell text, not typed Workbench commands and receipts. | Terminal-text mutation transport cannot become the graphical contract. | Typed adapter phase after `start -> submit -> inspect -> watch` exists. |

## Current conclusion

The documented v1 contribution surface remains sufficient for the read-oriented Run probe. The
additive generic navigation/primary-view interfaces and optional trusted plugin service are the
smallest hosting seams needed by Workstreams and the later Entry Preset experience. PI WEB owns
JSON transport and rendering only; Pi Workbench retains Workstream semantics and persistence. This
does not justify status items, plugin-owned context bars, broader shell composition, or PI WEB
ownership of Workstream state. Managed Run observation and mutation still depend on the separate
framework-neutral Run client and recorded selection fixture.
