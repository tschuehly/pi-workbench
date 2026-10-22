# Durable Chat parity acceptance

These criteria are the source of truth for **“parity reached”**: a Durable Chat preserves the
in-scope legacy UI/API behavior and the recovery guarantees below. They are intended acceptance,
not a claim that the port or tests already pass. Later phases rerun this suite; “done” in the
original inventory never exempts a row from testing.

## Run and evidence

Use the real Workbench UI in WebKit through PI WEB's isolated `e2e/isolatedPiWeb.ts` harness.
Create a Durable Chat and a neighboring legacy Chat; drive controls in the browser, using API
assertions and fixture receipts for state not directly rendered. Keep legacy regression checks.
Implement the `Spec:` placeholders under PI WEB `e2e/durable/<fleet-area>/`, include the AC ID in
each test, and run `npm run test:e2e -- e2e/durable/<fleet-area>/` from that checkout. After area
runs, run the whole `npm run test:e2e` suite twice consecutively. Specs/harness wiring are separate
work; a TBD is not passing evidence.

Use scripted **mock Claude and OpenAI endpoints**, fake auth, and isolated `models.json` from
`e2e/mockModels/`. Cover Anthropic Messages SSE/text/thinking/tool use and subscription payload
shape, plus OpenAI Responses/Chat Completions/codex. Record requests and operation/effect counts.
Block non-fixture network traffic: **no live requests**, real credentials, browser-cookie reads,
phone messages or live OAuth. MCP, search/fetch, phone and quota/Keychain operations use local
fixtures/stubs. Use disposable test workspaces under persistent scratch or `$PI_TMP`, never `/tmp`.

For every Survival step, kill only the isolated Chat host at an explicit barrier, reopen with
intact storage and compatible pinned code, and assert UI/API state plus effect counts. Repeat
before/after commit and acknowledgement where named; do not substitute browser reconnect for
host death. “No duplicate effects” does not prohibit the documented retry of an ordinary model
request or a safe tool: distinguish attempts from logical admissions and unsafe side effects.
Read-only status/history must not resume paused or uncertain work. Promotion, launchd/reboot,
history import, retained PTYs, default-runtime cutover and legacy removal remain later-phase work.

Each negative-control hint names a deliberate fixture fault: the corresponding assertion must
fail when the feature is disabled/broken. The fleet must demonstrate at least one such failing
control per area, restore the feature, and rerun green. Fixture validation failures alone do not
prove an acceptance test detects a broken implementation. Record exact counts and unresolved
failures; a visible unsupported error is not parity for an in-scope working feature.

## Scope and source anchors

Inventory: `parity-matrix.md`, 141 rows, dated 2026-10-22, retained in Workstream
`ws-pi-durable-rebuild-20261022`. Scope follows that Workstream's
`phase-b-slice-3-plan.md`, **E2E acceptance fleet** and **Decisions accepted 2026-10-22**.
Recovery and extension semantics follow the repository's
[parent plan](../plans/pi-durable-rebuild.md#what-survives) and
[Extension migration table](../plans/pi-durable-rebuild.md#extension-migration).
These criteria retain the accepted decisions so later runs do not need the scratch plan.

Source shorthand below is repository/package-relative, not a runtime path:
`PWs` = PI WEB `src/server/sessions`; `PWc` = PI WEB `src/client/src`;
`PW` = PI WEB `src`; `PSS` = `PWs/piSessionService.ts`;
`SCS` = `PWs/sessionCommandService.ts`; `WB` = Workbench root;
`WBe` = Workbench `extensions`; `NM` = installed npm package source;
`GIT` = installed Git package source. Line anchors refer to the inventory's inspected legacy
baseline, not guaranteed line numbers after later edits. Pi built-ins/resources refer to the
installed coding-agent `dist/core/tools/` and `dist/core/resource-loader.js` behavior.
For P005 the inventory's removed `piSessionEvents.ts` name is historical: use
`PSS:6603–6656` (`toClientEvent`) and `src/server/realtime/sessionEventHub.ts`. P022's `ConversationMeter` is message position;
usage/context assertions target the composer tooltip and status, not that position meter.

P137 is now in scope: the accepted OpenAI provider decision activates its original conditional
requirement. P118 excludes only `/google-account`; P102 excludes only pi-goal gating.
P128/P129 retain non-overlay BTW command/context behavior; their overlay-only surfaces are
excluded below. This narrow reading does not silently retire working inline commands.

## Criteria

All Given clauses below assume an isolated Durable Chat and the mock-only harness above.
Compound rows deliberately remain one AC, with all named variants required.

### AC-P001 — Create a Chat (opt-in 'New Durable Chat' button, capability-gated)

- **Area:** Chat core
- **Fleet area:** attention-catalog
- **Given:** a workspace with Durable capability enabled.
- **When:** choose New Durable Chat, then create an ordinary Chat beside it.
- **Then:** the catalog shows distinct Durable and legacy Chats in that workspace; disabling Durable capability removes or disables its creation control with a reason.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionRoutes.ts:77; PSS:1707`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Disable the Durable creation route.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P002 — List / recent / locate Chats

- **Area:** Chat core
- **Fleet area:** attention-catalog
- **Given:** two Durable Chats and a legacy Chat in different workspaces.
- **When:** open the catalog, recent list and an exact Chat link.
- **Then:** each Chat appears once, recent order follows modification time, and the link locates the correct workspace without starting a model turn.
- **Legacy equivalence:** Preserve the behavior in `PSS:1590,1603,4205`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Omit Durable records from catalog aggregation.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P003 — Send prompt (idle) with stable operation ID, admitted after commit

- **Area:** Composer
- **Fleet area:** composer-queue
- **Given:** an idle Durable Chat and a held commit barrier.
- **When:** send a prompt with operation ID A, retry A after losing the response, then reuse A with different text.
- **Then:** no success is acknowledged before commit; one user entry and one admitted operation result; changed text under A is rejected.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionRoutes.ts:414; PSS:3227`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Hold input at admission; kill before commit and after commit before acknowledgement, reopen and retry its original operation ID. Only committed input is restored with the same IDs/kinds/order; changed payload under a reused ID fails. After a failed turn, waiting input remains waiting (afterFailedRun=keep), not silently drained.
- **Negative control:** Acknowledge before commit or disable receipt deduplication.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P004 — Steer / follow-up while streaming

- **Area:** Composer
- **Fleet area:** composer-queue
- **Given:** a streaming Durable Chat held at a tool boundary.
- **When:** submit one steer and two follow-ups.
- **Then:** the queue labels their kinds; steering reaches the next eligible boundary and follow-ups retain order after the current work.
- **Legacy equivalence:** Preserve the behavior in `PSS:3227; PWc/components/PromptEditor.ts:92,104`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Hold input at admission; kill before commit and after commit before acknowledgement, reopen and retry its original operation ID. Only committed input is restored with the same IDs/kinds/order; changed payload under a reused ID fails. After a failed turn, waiting input remains waiting (afterFailedRun=keep), not silently drained.
- **Negative control:** Treat every input as an immediate new turn.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P005 — Live streaming: assistant + thinking deltas, tool start/update/end

- **Area:** Transcript
- **Fleet area:** composer-queue
- **Given:** a mock scenario emitting text, thinking and a streaming tool result.
- **When:** watch the transcript during generation and reconnect the browser.
- **Then:** text/thinking grow before completion, tool start/update/end converge to one result, and the snapshot does not duplicate deltas or expose thinking signatures; nested tool execution stays inside its parent result rather than creating transient standalone rows.
- **Legacy equivalence:** Preserve `PSS:6603–6656` event projection (the inventory's `piSessionEvents.ts` path no longer exists); Durable additionally records interrupted generation.
- **Survival:** Kill after a partial commits, then reopen. The committed partial is visibly aborted; an ordinary provider request may be resent and is counted as a recovery attempt, not a second admitted prompt. Finished tool results are not executed again.
- **Negative control:** Suppress streaming updates and leave only the final response.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P006 — Transcript paging / transcript + stream snapshot

- **Area:** Transcript
- **Fleet area:** composer-queue
- **Given:** a long Durable transcript with a tool call/result pair across a page boundary.
- **When:** load older messages and reconnect during a new partial response.
- **Then:** pages contain no missing or duplicate entries or orphaned tool pairs; the current partial and sequence watermark converge with live updates.
- **Legacy equivalence:** Preserve the behavior in `PSS:2843,2866,2934`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Return the same page for every before cursor.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P007 — Queued messages list in status

- **Area:** Queue
- **Fleet area:** composer-queue
- **Given:** committed steer and follow-up messages held behind active work.
- **When:** inspect the queue and status API.
- **Then:** each pending item has the correct text, kind, order and attachment count; client-pending input is distinguishable from host-admitted input.
- **Legacy equivalence:** Preserve the behavior in `PWc/components/chat/QueuedMessages.ts; PSS:2918`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Hold input at admission; kill before commit and after commit before acknowledgement, reopen and retry its original operation ID. Only committed input is restored with the same IDs/kinds/order; changed payload under a reused ID fails. After a failed turn, waiting input remains waiting (afterFailedRun=keep), not silently drained.
- **Negative control:** Drop one pending item from status.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P008 — Clear queue

- **Area:** Queue
- **Fleet area:** composer-queue
- **Given:** active generation with queued inputs.
- **When:** choose Clear queue.
- **Then:** pending items disappear from UI/status while generation continues; cleared text is never submitted later.
- **Legacy equivalence:** Preserve the behavior in `PSS:4107`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the queue mutation commits but before its response; reopen and retry the same operation. The UI shows the edited/removed/promoted queue in committed order, never the pre-mutation queue or a duplicate delivery.
- **Negative control:** Clear only the browser projection.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P009 — Edit / remove a queued message

- **Area:** Queue
- **Fleet area:** composer-queue
- **Given:** a queue containing A, B and C.
- **When:** remove B; separately recall B for editing and toggle an item's kind.
- **Then:** remove preserves A/C; recall restores B's text and clears later queued items; toggle moves the item to the other kind's tail; a stale expected queue is rejected instead of editing a different item.
- **Legacy equivalence:** Preserve the behavior in `PSS:4008; PWs/queuedMessageMutation.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the queue mutation commits but before its response; reopen and retry the same operation. The UI shows the edited/removed/promoted queue in committed order, never the pre-mutation queue or a duplicate delivery.
- **Negative control:** Ignore expectedQueue revision/content checks.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P010 — Promote queued message / promote all

- **Area:** Queue
- **Fleet area:** composer-queue
- **Given:** two follow-ups and existing steering input.
- **When:** choose Send now on one follow-up, then Send all now.
- **Then:** chosen items become steering in stable execution order, preserving attachments; promotion waits while compacting.
- **Legacy equivalence:** Preserve the behavior in `PSS:3981,3998`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the queue mutation commits but before its response; reopen and retry the same operation. The UI shows the edited/removed/promoted queue in committed order, never the pre-mutation queue or a duplicate delivery.
- **Negative control:** Change the label but leave delivery kind unchanged.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P011 — Stop: abort run, withdraw queue, queued text back to composer

- **Area:** Stop
- **Fleet area:** composer-queue
- **Given:** streaming work and queued text.
- **When:** press Stop.
- **Then:** generation aborts, admitted queue is withdrawn, queued text returns to the composer without automatic resubmission, and stop failure is visible rather than reported as success.
- **Legacy equivalence:** Preserve the behavior in `PSS:4124-4149`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after Stop commits, reopen and inspect without sending. Cancellation and queue withdrawal remain effective; saved recalled text is only a client draft. No cancelled input or effect restarts.
- **Negative control:** Abort generation without withdrawing the queue.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P012 — Stop Chat runtime (close host)

- **Area:** Stop
- **Fleet area:** composer-queue
- **Given:** an idle Durable Chat with saved transcript.
- **When:** call the stop-runtime API and reopen its history.
- **Then:** the host closes, history remains readable, and opening status/history alone starts no model turn; closing runtime is not deleting the Chat.
- **Legacy equivalence:** Preserve the behavior in `PSS:4151`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Delete the catalog entry on host close.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P013 — Inline image attachments in a prompt

- **Area:** Attachments
- **Fleet area:** composer-queue
- **Given:** an image-capable mock model and two named image attachments.
- **When:** attach images, reference them in a prompt and send.
- **Then:** chips/previews match the named references, the mock receives both image blocks in order, and the transcript contains one prompt with matching media references; invalid image input is rejected visibly.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionRoutes.ts:414; PWc/components/PromptEditor.ts:150`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Strip attachment blocks before provider submission.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P014 — Save attachments to workspace folder

- **Area:** Attachments
- **Fleet area:** composer-queue
- **Given:** a workspace with a configured attachment folder and colliding filenames.
- **When:** choose Save to folder and submit the files.
- **Then:** returned workspace-relative links point to the advertised folder and original bytes; collisions do not overwrite files; traversal or symlink escape is rejected.
- **Legacy equivalence:** Preserve the behavior in `PSS:3395; PWs/attachmentService.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore the explicit folder sent by the composer.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P015 — Serve transcript/tool images (media route, gallery)

- **Area:** Media
- **Fleet area:** composer-queue
- **Given:** a committed prompt image and tool-produced image.
- **When:** open their previews and gallery, then request a media ID under a different Chat/workspace.
- **Then:** the correct images and gallery navigation work; foreign-scope lookup fails without leaking bytes.
- **Legacy equivalence:** Preserve the behavior in `PSS:2872; PWs/sessionMediaIndex.ts; PWc/components/ImageGalleryDialog.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after evidence/usage/media commit, reopen and inspect UI/API plus the fixture export. Committed history, usage and media references remain; export receipts prevent duplicate accounting. Recovery attempts are distinct; uncommitted samples need not survive.
- **Negative control:** Resolve media IDs without Chat/workspace ownership checks.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P016 — Model picker: list and switch

- **Area:** Models
- **Fleet area:** context-tools-mcp
- **Given:** mock Claude subscription and OpenAI codex models with fake login state.
- **When:** open the model picker, switch providers through the existing login surface and send a prompt on each.
- **Then:** the selected provider/model appears in status and each mock receives the matching request; unavailable/revoked auth blocks visibly without switching billing.
- **Legacy equivalence:** Preserve the behavior in `PSS:2990,3057; PWc/components/ModelPicker.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the model/effort choice commits, reopen and send a prompt. The recorded binding is restored before scheduling and reaches the correct mock; missing definitions/auth park work visibly rather than silently choosing a substitute.
- **Negative control:** Keep sending to Claude after selecting OpenAI.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P017 — Enabled-model catalog / model scope

- **Area:** Models
- **Fleet area:** context-tools-mcp
- **Given:** a global enabled-model scope and a workspace override fixture.
- **When:** toggle catalog membership and select all/current scope, then repeat under the override.
- **Then:** picker and catalog API agree; the current model cannot be disabled; workspace-controlled scope is read-only with an explanation.
- **Legacy equivalence:** Preserve the behavior in `PSS:3007,3033`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Always return every model as enabled.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P018 — Cycle model

- **Area:** Models
- **Fleet area:** context-tools-mcp
- **Given:** two enabled mock models.
- **When:** cycle forward and backward through the model API.
- **Then:** status and the next request follow the cycle and return to the starting model; a one-model scope reports that no cycle is possible.
- **Legacy equivalence:** Preserve the behavior in `PSS:3072`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Return unchanged status for a valid cycle.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P019 — Thinking level list / set

- **Area:** Thinking
- **Fleet area:** context-tools-mcp
- **Given:** a model with a known set of thinking levels.
- **When:** open the effort picker, select a supported level and try an unsupported level via API.
- **Then:** supported choices match the model; the selected level appears in status and provider payload; invalid input fails without changing the selection.
- **Legacy equivalence:** Preserve the behavior in `PSS:3086,3091; PWc/components/ModelEffortPicker.ts:2`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the model/effort choice commits, reopen and send a prompt. The recorded binding is restored before scheduling and reaches the correct mock; missing definitions/auth park work visibly rather than silently choosing a substitute.
- **Negative control:** Accept invalid levels or discard the selected effort.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P020 — Cycle thinking level

- **Area:** Thinking
- **Fleet area:** context-tools-mcp
- **Given:** a thinking-capable model and a non-thinking model.
- **When:** cycle effort through the API on each.
- **Then:** supported effort advances and wraps; the non-thinking model reports that cycling is unsupported.
- **Legacy equivalence:** Preserve the behavior in `PSS:3106`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Cycle a hardcoded list independent of model capability.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P021 — Session defaults get/set

- **Area:** Chat core
- **Fleet area:** context-tools-mcp
- **Given:** isolated global defaults and a workspace override.
- **When:** pin model/effort defaults, read them back and create a new Durable Chat.
- **Then:** global defaults persist and influence new Chats without relabeling workspace overrides as global pins; unavailable or disabled model pins fail visibly.
- **Legacy equivalence:** Preserve the behavior in `PSS:2949,2958`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Write only the active Chat's selection instead of defaults.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P022 — Tokens / cost / context meter

- **Area:** Usage
- **Fleet area:** context-tools-mcp
- **Given:** mock responses with known input/output/cache usage, price and context-window values.
- **When:** finish two turns and inspect the composer usage/context tooltip and status API.
- **Then:** token totals, cost and context utilization match recorded usage rather than message-position percentage; child/nested usage is not counted twice.
- **Legacy equivalence:** Preserve the behavior in `PWc/components/ConversationMeter.ts:2; PSS:2918`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after evidence/usage/media commit, reopen and inspect UI/API plus the fixture export. Committed history, usage and media references remain; export receipts prevent duplicate accounting. Recovery attempts are distinct; uncommitted samples need not survive.
- **Negative control:** Double-add the same completion usage.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P023 — Cache-miss notices

- **Area:** Usage
- **Fleet area:** context-tools-mcp
- **Given:** cache-miss notices enabled and a paid mock turn missing at least 20,000 cached tokens or $0.10.
- **When:** finish the turn, inspect its notice, then reload.
- **Then:** the notice names tokens re-billed and model-switch/idle cause when applicable; below-threshold and aborted/error turns produce no notice.
- **Legacy equivalence:** Preserve the behavior in `PWs/cacheMissNotices.ts:12-32`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Disable cache-miss detection while retaining ordinary usage.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P024 — Session warnings + dismiss

- **Area:** Warnings
- **Fleet area:** attention-catalog
- **Given:** one dismissible warning and one non-dismissible recovery warning.
- **When:** open warnings and dismiss the dismissible one.
- **Then:** source/message/path and severity are readable; only that warning is removed; hiding warnings does not resolve interrupted work.
- **Legacy equivalence:** Preserve the behavior in `PSS:4117; PWc/components/chat/SessionWarnings.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Clear every warning on any dismiss ID.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P025 — Archive / archive tree / restore

- **Area:** Archive
- **Fleet area:** attention-catalog
- **Given:** a quiescent Durable parent/child tree plus an active Chat.
- **When:** archive one Chat, archive the tree and restore an archived Chat.
- **Then:** catalog counts and archived views reflect the chosen targets, restored history is intact, and active work blocks archive with a reason.
- **Legacy equivalence:** Preserve the behavior in `PSS:3734,3837,3870`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Allow archive while work is active.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P026 — Bulk archive, delete archived, cleanup preview/run

- **Area:** Archive
- **Fleet area:** attention-catalog
- **Given:** eligible old Chats, already archived Chats and one busy family.
- **When:** preview cleanup, execute it and perform bulk archive/delete.
- **Then:** preview mutates nothing; results identify affected, skipped and failed IDs; busy/live-owned stores cannot be deleted or copied as loose SQLite files.
- **Legacy equivalence:** Preserve the behavior in `PSS:1491,1495,3749,3878`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Let deletion bypass the host ownership claim.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P027 — Unread catalog + acknowledge

- **Area:** Unread
- **Fleet area:** attention-catalog
- **Given:** an unseen completed Durable turn.
- **When:** read the unread catalog, acknowledge its observed epoch/order, then acknowledge an older completion after a newer one arrives.
- **Then:** the badge clears only for the observed completion; stale acknowledgement cannot clear newer unread work.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionUnreadStore.ts:66; PSS:1444-1449`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Acknowledge by Chat ID alone.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P028 — Per-Chat notification inbox, dismiss / dismiss-all

- **Area:** Notifications
- **Fleet area:** attention-catalog
- **Given:** two retained per-Chat extension notifications and one arriving after an inbox snapshot.
- **When:** dismiss one, then dismiss all through the observed watermark.
- **Then:** only the selected/observed notifications disappear; the later one remains; another Chat's inbox is unchanged.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionNotificationStore.ts:85; PSS:1458`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Clear all notifications without checking watermark or Chat identity.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P029 — Global attention notification for ask_user / request_attention

- **Area:** Notifications
- **Fleet area:** attention-catalog
- **Given:** a background Durable Chat posting a question and a separate attention request.
- **When:** observe global attention and reopen the requesting Chat.
- **Then:** each committed request produces one identifiable notification targeting that Chat; ordinary turn completion produces no attention notification.
- **Legacy equivalence:** Preserve the behavior in `PSS:2100-2106; PWc/components/SessionNotificationTray.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill with a committed request and again after exact-ID acknowledgement, then reopen. The latest unacknowledged request remains; an acknowledged one never re-notifies. A stale acknowledgement cannot clear a newer request.
- **Negative control:** Notify on every agent_end or ignore request-ID deduplication.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P030 — Activity indicator (running/idle, per-tool labels, compacting, bash running)

- **Area:** Activity
- **Fleet area:** attention-catalog
- **Given:** a scripted turn with model streaming, a named tool, compaction and shell activity.
- **When:** watch the activity indicator through each phase.
- **Then:** labels distinguish running, tool activity, compacting, bash-running, idle and errors; activity does not remain busy after terminal completion.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionActivityMarker.ts; PSS publishActivity`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Hardcode isCompacting/isBashRunning to false.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P031 — Auto title + /name

- **Area:** Naming
- **Fleet area:** attention-catalog
- **Given:** an unnamed Durable Chat and scripted title-generation output.
- **When:** send the first substantive prompt, then rename with /name and send more prompts.
- **Then:** a short generated title appears in the catalog; /name applies the explicit title and later automatic naming cannot overwrite it.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionNameGenerator.ts:40; SCS:111`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Overwrite a manual title with a late automatic result.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P032 — /workstream-checkpoint-title

- **Area:** Workstreams
- **Fleet area:** attention-catalog
- **Given:** a Workstream checkpoint carrying sessionTitle.
- **When:** deliver /workstream-checkpoint-title and refresh the Chat catalog.
- **Then:** the checkpoint title is applied with checkpoint provenance and is not replaced by ordinary auto-naming; manual-title precedence is retained.
- **Legacy equivalence:** Preserve the behavior in `PSS:3469-3473,6483`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Treat the internal command as an ordinary model prompt.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P033 — Workstream launch token / continuation into a Chat

- **Area:** Workstreams
- **Fleet area:** attention-catalog
- **Given:** a continuation targeting a persistent workspace and stable launch token.
- **When:** launch the Durable Chat and look up the token, including a repeated confirmation.
- **Then:** the same Chat/workspace is returned; an OS-temporary continuation is rejected before session.pending is recorded.
- **Legacy equivalence:** Preserve the behavior in `PSS:1720; PWs/workstreamLaunchStore.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after pending launch/confirmation boundaries, reopen and retry with the original token. The separate Workstream Store keeps one binding/home and existing checkpoints; recovery creates no extra Chat, checkpoint or Human Task.
- **Negative control:** Record pending state before workspace validation.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P034 — Runtime identity env for tools/CLI (PI_SESSION_ID, PI_TMP)

- **Area:** Workstreams
- **Fleet area:** extensions-packages
- **Given:** a Durable lead and two child tool environments.
- **When:** run a fixture command that reports only PI_SESSION_ID and PI_TMP.
- **Then:** each result identifies its own Chat/conversation-scoped environment and scratch directory, not another child's values; no fake coding-agent JSONL path is advertised.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/index.ts:15,61; PW/server/sessiond/agentProcessEnvironment.ts:10`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Share a mutable process-global child environment.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P035 — Reload runtime resources (route + /reload)

- **Area:** Reload
- **Fleet area:** attention-catalog
- **Given:** an idle Durable Chat and a changed trusted skill/template fixture.
- **When:** invoke /reload and the reload API, then use the changed resource.
- **Then:** new resource content is used while the host executable remains revision-pinned; active work rejects reload; failures preserve readable history and show a reason.
- **Legacy equivalence:** Preserve the behavior in `PSS:3930; SCS:113`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Restart onto an arbitrary latest build instead of resending resources.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P036 — Detach parent (subsession child)

- **Area:** Delegation
- **Fleet area:** subagents-workers
- **Given:** a persisted tracked child Chat.
- **When:** use the detach-parent API and refresh both catalogs.
- **Then:** the child remains independently openable with its transcript, no longer appears as tracked under its old parent, and does not deliver future tracked completions there.
- **Legacy equivalence:** Preserve the behavior in `PSS:3966`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Remove only the visual parent label.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P037 — ask_user tool + AskUserCard submit/cancel

- **Area:** Questions
- **Fleet area:** attention-catalog
- **Given:** a mock calling ask_user with two questions.
- **When:** open chips, submit one answer leaving the other unanswered; repeat with cancel, revise and withdraw.
- **Then:** posting returns immediately; revised chips retain the ask ID; submit/cancel closes the set and delivers one system-authored follow-up naming unanswered items; withdrawal removes it without an answer delivery; stale revisions are rejected.
- **Legacy equivalence:** Preserve the behavior in `PWs/askUserTool.ts:137; PSS:2081-2155`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill before/after question commit, after answer commit before delivery, and after delivery before receipt. Reopen: one open revision or one closed outcome returns; an undelivered answer is submitted once and a stale answer cannot close a newer revision.
- **Negative control:** Restore a stale form over a revised question.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P038 — request_attention tool + acknowledge

- **Area:** Questions
- **Fleet area:** attention-catalog
- **Given:** a mock posting attention reason A then reason B.
- **When:** acknowledge A after B exists, then acknowledge B.
- **Then:** the tool returns immediately without a question card; B remains after the stale acknowledgement and clears only when B is acknowledged.
- **Legacy equivalence:** Preserve the behavior in `PWs/requestAttentionTool.ts:25; PSS:2100-2106`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill with a committed request and again after exact-ID acknowledgement, then reopen. The latest unacknowledged request remains; an acknowledged one never re-notifies. A stale acknowledgement cannot clear a newer request.
- **Negative control:** Clear the latest request regardless of requested ID.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P039 — Open-questions reminder riding each user prompt

- **Area:** Questions
- **Fleet area:** attention-catalog
- **Given:** two open question sets.
- **When:** send successive unrelated user prompts, then close the sets and send again.
- **Then:** each mock request gets one reminder line per still-open set without an extra visible user message; no reminder is added when none remain.
- **Legacy equivalence:** Preserve the behavior in `PSS:3270-3277`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after prompt admission before reminder delivery, then reopen. Restored open questions yield one reminder per set in that prompt context, never a duplicate admitted prompt or a newly fabricated question.
- **Negative control:** Add reminders only when answering a question.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P040 — Question chips + 'may be stale' turn counting

- **Area:** Questions
- **Fleet area:** attention-catalog
- **Given:** open questions from two sets.
- **When:** advance turns, open a chip, revise/confirm a set and close it.
- **Then:** chips are oldest-set-first, counts reflect individual questions, the drawer shows context/options, the sixth agent turn without an update yields the may-be-stale indication (not the fifth) and confirmation resets age; closed sets disappear.
- **Legacy equivalence:** Preserve the behavior in `PWc/components/WorkbenchQuestionChips.ts:2`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Never advance the question turn counter.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P041 — Extension statuses in status bar

- **Area:** Extensions UI
- **Fleet area:** extensions-packages
- **Given:** a supported extension publishing and then clearing a status.
- **When:** inspect the status API and status bar.
- **Then:** the extension's current value appears once, updates replace it, and clearing removes it without disturbing Working Mode or other extensions.
- **Legacy equivalence:** Preserve the behavior in `PSS (extensionStatuses); PWc/components/StatusBar.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Project only the working-mode status key.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P042 — Extension dialogs (confirm/select/input/editor) answer/cancel

- **Area:** Extensions UI
- **Fleet area:** bash-atelier-tree
- **Given:** supported workflows opening confirm, select, input and editor dialogs.
- **When:** answer and cancel each through its card, including an invalid selection and stale answer.
- **Then:** kind-appropriate values resume only that workflow once, cancellation is visible, invalid/stale answers do not resume it, and no ask_user follow-up is fabricated; expired auth callbacks offer Retry rather than a restored live Promise.
- **Legacy equivalence:** Preserve the behavior in `PSS:2206,2220; PWs/pendingExtensionDialogStore.ts; PWc/components/ExtensionDialogCard.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill with an open dialog and after an answer commits, then reopen. Supported workflow phases reattach by recorded dialog/answer ID and consume the answer once; live external auth callbacks instead expire visibly with Retry. No Promise is claimed restored and no answered action repeats.
- **Negative control:** Accept a response for a closed dialog.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P043 — Command select responses (e.g. /fork picker)

- **Area:** Commands
- **Fleet area:** bash-atelier-tree
- **Given:** a quiescent Chat whose /fork command returns a selection request.
- **When:** choose an entry through the command picker and replay or cross-submit its request ID.
- **Then:** one fork is opened at the chosen entry; expired or foreign-Chat selections return an explicit expired/unsupported result.
- **Legacy equivalence:** Preserve the behavior in `SCS:121-126`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Reuse one command selection for multiple forks.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P044 — Session tree navigator / navigate (/tree)

- **Area:** History
- **Fleet area:** bash-atelier-tree
- **Given:** a retained multi-branch history with branch-specific questions.
- **When:** open /tree and navigate to a prior branch using its expected leaf.
- **Then:** the active path and transcript change without erasing later history, branch-appropriate questions return, and stale revisions or active children/queued work block navigation.
- **Legacy equivalence:** Preserve the behavior in `PSS:3483; SCS:116; PWc/components/SessionTreeNavigator.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore expectedLeafId.
- **Spec:** e2e/durable/bash-atelier-tree/tree-navigation.spec.ts (host rows: packages/durable-pilot/test/tree.test.ts)

### AC-P045 — Fork from tree, 'Clone session from this message', /fork, /clone

- **Area:** History
- **Fleet area:** bash-atelier-tree
- **Given:** a quiescent source Chat with history, mode state and source-owned Workers/questions.
- **When:** fork from /tree, Clone session from this message, /fork and /clone in separate cases.
- **Then:** each creates a new public Chat at the intended cutoff; a user-entry fork returns its text as a draft; source history remains; mode is as-of the cutoff and no live questions or Worker control are inherited.
- **Legacy equivalence:** Preserve the behavior in `PSS:3605; SCS:114-115; PWc/plugins/core/messageActions.ts:13`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Copy source ownership/question documents into the fork.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P046 — 'Go back to this message' action

- **Area:** History
- **Fleet area:** bash-atelier-tree
- **Given:** a quiescent Chat with a selectable earlier user message.
- **When:** choose Go back to this message.
- **Then:** the same public Chat selects the prior history position and returns the editable prompt as appropriate; later history is retained and busy/archive states disable the action.
- **Legacy equivalence:** Preserve the behavior in `PWc/plugins/core/messageActions.ts:21`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Erase later history rather than selecting a retained branch.
- **Spec:** e2e/durable/bash-atelier-tree/tree-navigation.spec.ts (host rows: packages/durable-pilot/test/tree.test.ts)

### AC-P047 — Copy message, reply-to-selection quotes

- **Area:** Transcript
- **Fleet area:** composer-queue
- **Given:** a visible assistant message with selectable text.
- **When:** copy the message and reply to a selected passage.
- **Then:** clipboard text matches the message and the composer receives the selected quote with its source association, without changing the transcript.
- **Legacy equivalence:** Preserve the behavior in `PWc/plugins/core/messageActions.ts:27; PWc/components/ChatView.ts:229`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Copy rendered markup instead of message text.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P048 — Draft persistence

- **Area:** Composer
- **Fleet area:** composer-queue
- **Given:** two Durable Chats with distinct unsent composer text.
- **When:** switch Chats and reload the browser.
- **Then:** each saved draft returns only to its own Chat and no provider request is made until Send.
- **Legacy equivalence:** Preserve the behavior in `PWc/components/PromptEditor.ts:94`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Wait for client draft persistence, kill the host and reload/reopen the same Chat. Only the client-saved draft returns; unsaved browser memory is not promised. No draft is admitted or sent automatically.
- **Negative control:** Key drafts only by workspace instead of Chat.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P049 — Edit tool diff preview

- **Area:** Tools UI
- **Fleet area:** context-tools-mcp
- **Given:** a mock edit replacing a unique line in a fixture file.
- **When:** expand the edit tool while execution is held after preview.
- **Then:** the old/new diff is visible before the final result and corresponds to the eventual file change; failure does not show a successful edit.
- **Legacy equivalence:** Preserve the behavior in `PSS:1124-1143`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Remove preview details from tool updates.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P050 — Unsupported controls blocked visibly (capability negotiation per control)

- **Area:** Chat core
- **Fleet area:** attention-catalog
- **Given:** capability responses disabling queue mutation, history or another control.
- **When:** open the Durable Chat and attempt the corresponding direct API operation.
- **Then:** unsupported controls are hidden or disabled with an explanation; direct requests fail explicitly and cause no mutation; supported controls remain usable.
- **Legacy equivalence:** Parent plan capability negotiation strengthens the legacy error path: hidden/disabled controls, never silent success.
- **Negative control:** Render enabled controls while silently dropping requests.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P051 — Interrupted unsafe tool resolution (Durable-only, no legacy equivalent)

- **Area:** Chat core
- **Fleet area:** attention-catalog
- **Given:** an unsafe fixture effect completed externally but killed before its result commits.
- **When:** reopen the Chat and inspect Unresolved Effects, then resolve as done, not done or explicitly retry in separate cases.
- **Then:** output/uncertainty remain visible; status/history reads do not schedule mutations; both replay and a fresh model-proposed duplicate stay blocked until reconciliation; only explicit retry can perform another attempt.
- **Legacy equivalence:** Durable-only safety requirement; no legacy equivalent. Parent plan unsafe-effect reconciliation governs this row.
- **Survival:** Kill after the external effect but before result commit and reopen twice. The unresolved intent remains visible and blocks replay/new duplicate mutation until resolution; after recording done/not-done, reopening does not repeat the effect. Count any explicitly authorized retry separately.
- **Negative control:** Allow a fresh call to bypass an unresolved intent.
- **Spec:** TBD (e2e/durable/attention-catalog/...)

### AC-P052 — /session (stats)

- **Area:** Commands
- **Fleet area:** context-tools-mcp
- **Given:** a Durable Chat with known message/token/cost counts.
- **When:** run /session.
- **Then:** command output shows that Chat's stats matching its status/history, without submitting the slash text as an ordinary model prompt.
- **Legacy equivalence:** Preserve the behavior in `SCS:110`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Return a static stats string.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P053 — /compact [instructions]

- **Area:** Commands
- **Fleet area:** context-tools-mcp
- **Given:** a long Durable Chat and mock summarizer.
- **When:** run /compact with focus instructions, then send another prompt; separately cancel/fail compaction.
- **Then:** one canonical summary is visible and reaches subsequent context with the focus applied; progress clears; cancellation/failure is visible without a false successful summary.
- **Legacy equivalence:** Preserve the behavior in `SCS:112; PWs/piSessionService.compaction.test.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill before summary placement, after placement before continuation, and after continuation admission before receipt; reopen at each barrier. One placed summary and at most one authorized continuation appear, held human/child input retains order, and explicit cancellation/failure cannot become successful compaction. Working Mode is reattached once for the restored context.
- **Negative control:** Report compaction success before summary placement.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P055 — Command list / autocomplete

- **Area:** Commands
- **Fleet area:** composer-queue
- **Given:** supported built-ins, extension commands, prompt templates and skills installed in the isolated profile.
- **When:** type slash prefixes and choose an autocomplete item.
- **Then:** the sorted catalog exposes names, descriptions, sources and argument hints; selection invokes/expands the matching resource; unsupported commands are not presented as working.
- **Legacy equivalence:** Preserve the behavior in `PSS:3117-3138; PWc/components/AutocompleteMenu.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Populate autocomplete from a stale static list.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P056 — /skill:name + inline skill mentions

- **Area:** Commands
- **Fleet area:** composer-queue
- **Given:** a known skill fixture with a relative reference and an unknown skill name.
- **When:** send a leading /skill:name and repeated inline mentions.
- **Then:** the mock sees the skill body and base-directory guidance once per skill; the transcript reconciles to one expanded prompt; unknown or unreadable mentions remain literal.
- **Legacy equivalence:** Preserve the behavior in `PSS:3135-3137; PWs/inlineSkills.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Expand every repeated inline mention.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P057 — Global prompt templates /execute-plan-afk, /execute-plan-attended (global prompts)

- **Area:** Prompt templates
- **Fleet area:** composer-queue
- **Given:** global execute-plan-afk and execute-plan-attended template fixtures.
- **When:** invoke each with arguments from the composer.
- **Then:** autocomplete identifies them as prompts and the mock receives expanded template content with the arguments, not just the slash command.
- **Legacy equivalence:** Preserve the behavior in `PSS:3124-3131`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Keep noPromptTemplates enabled.
- **Spec:** TBD (e2e/durable/composer-queue/...)

### AC-P058 — ! / !! shell commands

- **Area:** Shell
- **Fleet area:** bash-atelier-tree
- **Given:** a workspace command printing a marker and an idle Chat.
- **When:** send !command and !!command in separate cases, then an ordinary prompt.
- **Then:** both show streamed shell output and exit status; only the single-bang execution enters model context; empty commands and concurrent shell execution fail visibly.
- **Legacy equivalence:** Preserve the behavior in `PSS:3422; PWc/controllers/sessionController.ts:583-586`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Include double-bang output in provider context.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P059 — /mcp status/login/logout + MCP auth flow routes

- **Area:** MCP
- **Fleet area:** context-tools-mcp
- **Given:** a trusted workspace and local MCP OAuth fixture.
- **When:** inspect /mcp status, complete and cancel login, then logout through the existing auth UI.
- **Then:** eligible servers and flow state are visible; fake login/logout changes auth state; untrusted or stale-session requests fail; cancelled/expired callbacks cannot revive a flow and show Retry.
- **Legacy equivalence:** Preserve the behavior in `PWs/builtinExtensionFactories.ts:11; PSS:3187-3225; PWs/mcpAuthRoutes.ts:19`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Skip the project-trust check.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P060 — MCP server tools

- **Area:** MCP
- **Fleet area:** context-tools-mcp
- **Given:** a local MCP server with a schema-validated read tool and an unsafe counter tool.
- **When:** call both through a scripted model and disable the server.
- **Then:** tool names/results appear in the transcript, invalid arguments fail, and disabled tools become unreachable including through nested calls; transport loss is not proof an unsafe effect failed.
- **Legacy equivalence:** Preserve the behavior in `pi-coding-agent dist/extensions/mcp/index.js:283-353`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the MCP counter effect but before its result, then reopen. The unsafe call is interrupted/unknown with retained output and is not rerun; the fixture counter stays one. A completed result is reused; a read retries only when both recorded and current policy permit it.
- **Negative control:** Mark every MCP operation replay-safe.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P064 — spawn_session

- **Area:** Delegation
- **Fleet area:** subagents-workers
- **Given:** an untracked Durable Chat with an explicit request for a separate session.
- **When:** invoke spawn_session with an allowed workspace and model.
- **Then:** one independent Chat appears with its own prompt/model receipt; the parent gets its ID/cwd but no automatic result access; out-of-project or disallowed delegation fails.
- **Legacy equivalence:** Preserve the behavior in `PWs/spawnSessionTool.ts:66; PSS:839`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Permit a tracked child to spawn unrestricted independent sessions.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P065 — spawn_subsession, list_subsessions, check_subsession, read_subsession, yield_to_subsessions

- **Area:** Delegation
- **Fleet area:** subagents-workers
- **Given:** a Durable parent with a tracked child assignment.
- **When:** spawn_subsession, list/check/read while working, then yield and collect after completion.
- **Then:** the child stays in the parent's workspace; working output is withheld; list/check/read do not yield; yield returns unread results or ends the turn until one arrives; only reading the complete latest final result marks it read.
- **Legacy equivalence:** Preserve the behavior in `PWs/spawnSubsessionTool.ts:214,241,258,279,300`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Mark a filtered historical read as complete collection.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P066 — Subsession completion delivery / inbox

- **Area:** Delegation
- **Fleet area:** subagents-workers
- **Given:** a tracked child finishing while its parent works or has yielded.
- **When:** allow the parent to settle and inspect completion delivery.
- **Then:** one unread completion reaches the parent at the actionable boundary and can wake a yielded parent; explicitly stopped/failed parent work is not silently resumed.
- **Legacy equivalence:** Preserve the behavior in `PWs/subsessionCompletionDelivery.ts; PSS:1080`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Continue the parent on every terminal outcome.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P067 — Extension → PI WEB session dispatch channel

- **Area:** Delegation
- **Fleet area:** subagents-workers
- **Given:** a supported extension using the session-dispatch channel.
- **When:** dispatch a valid request and malformed/disabled requests.
- **Then:** the extension receives an admission/result or visible failure; the valid request creates one openable independent Chat with supplied name/model; invalid fields or disabled delegation create none.
- **Legacy equivalence:** Preserve the behavior in `PWs/extensionSessionDispatch.ts:3-20`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Discard rejected dispatch promises.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P068 — read

- **Area:** Tools
- **Fleet area:** context-tools-mcp
- **Given:** a workspace text file, large file and image fixture.
- **When:** ask the mock to call read with path, offset and limit.
- **Then:** the tool card shows the requested lines/image, bounded truncation guidance and useful missing-file errors.
- **Legacy equivalence:** Preserve the behavior in `Pi built-in`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after read intent and after result commit in separate cases, then reopen. A committed result is reused; an interrupted read reruns only when recorded and current policies both mark it safe. UI identifies the recovered attempt rather than a second user request.
- **Negative control:** Ignore offset/limit.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P069 — write

- **Area:** Tools
- **Fleet area:** context-tools-mcp
- **Given:** a missing nested file and an existing fixture file.
- **When:** call write to create and then overwrite them.
- **Then:** tool results report success only after the requested bytes exist at the cwd-relative path; parent directories are created and write errors are visible.
- **Legacy equivalence:** Preserve the behavior in `Pi built-in`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after a fixture mutation or shell side effect but before result commit, then reopen. Retained output and interrupted/unknown state are shown; unsafe work is not rerun and its external counter remains one. Finished results are reused; only stored-and-current safe policy permits automatic replay.
- **Negative control:** Return success before filesystem failure is known.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P070 — edit

- **Area:** Tools
- **Fleet area:** context-tools-mcp
- **Given:** a file with unique, ambiguous and overlapping match fixtures.
- **When:** call edit with disjoint replacements, then invalid matches.
- **Then:** one successful result reflects all replacements against the original file; ambiguous/overlapping edits fail without partially changing the file.
- **Legacy equivalence:** Preserve the behavior in `Pi built-in + PSS:1124`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after a fixture mutation or shell side effect but before result commit, then reopen. Retained output and interrupted/unknown state are shown; unsafe work is not rerun and its external counter remains one. Finished results are reused; only stored-and-current safe policy permits automatic replay.
- **Negative control:** Apply each replacement against the already-edited buffer.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P071 — bash (foreground)

- **Area:** Tools
- **Fleet area:** bash-atelier-tree
- **Given:** a short foreground shell fixture and a cancellable long-running fixture.
- **When:** call foreground bash and stop the long-running call.
- **Then:** stdout/stderr, non-zero exit and truncation are shown truthfully; cancellation is not success; a lead foreground wait exceeding 30 seconds hands off one background job rather than relaunching.
- **Legacy equivalence:** Preserve the behavior in `Pi built-in; overridden by background-bash WBe/background-bash/index.ts:39`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after a fixture mutation or shell side effect but before result commit, then reopen. Retained output and interrupted/unknown state are shown; unsafe work is not rerun and its external counter remains one. Finished results are reused; only stored-and-current safe policy permits automatic replay.
- **Negative control:** Treat any exited shell as successful.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P073 — Tool activity status/widget

- **Area:** Ext: activity
- **Fleet area:** extensions-packages
- **Given:** a Durable Chat running a shell and delegated work with self-reported status.
- **When:** watch Activity through start, update and completion.
- **Then:** live task/tool activity updates and disappears when finished; inferred activity and the delegate's own reported status remain distinguishable; no TUI widget is required.
- **Legacy equivalence:** Preserve the behavior in `WBe/activity/index.ts:8-23; WBe/activity/activity.mjs:32,39`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Keep only agent-start/end activity.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P075 — atelier tool (open/takeover/update/ask/answer/status/check)

- **Area:** Ext: atelier
- **Fleet area:** bash-atelier-tree
- **Given:** a valid Atelier Page fixture and two candidate receivers.
- **When:** use open, update, ask, answer, status, check and generation-checked takeover.
- **Then:** the Chat links a working Page; revision, decisions, comment answers, request state and check results are observable; stale takeover is rejected and only the current receiver owns delivery.
- **Legacy equivalence:** Preserve the behavior in `WBe/atelier/index.ts:70-80`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at Event Log append, admission and acknowledgement boundaries, then reopen the host and Page. The Page/Event Log remain authoritative; the server safely reclaims a generation-checked receiver with unchanged access scope. Only unacknowledged, non-undone events past their undo deadlines deliver once; stale receivers and late answers cannot duplicate effects.
- **Negative control:** Allow takeover with an old generation.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P076 — Atelier delivery hooks (human input → sendMessage)

- **Area:** Ext: atelier
- **Fleet area:** bash-atelier-tree
- **Given:** an open Atelier Page with an undoable human event.
- **When:** submit, undo one event before its deadline, and submit another while the Chat is busy.
- **Then:** only the committed non-undone event reaches the Chat as one follow-up after its undo deadline; a busy turn is not split and takeover does not send to the old receiver.
- **Legacy equivalence:** Preserve the behavior in `WBe/atelier/index.ts:47,61-68,103`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at Event Log append, admission and acknowledgement boundaries, then reopen the host and Page. The Page/Event Log remain authoritative; the server safely reclaims a generation-checked receiver with unchanged access scope. Only unacknowledged, non-undone events past their undo deadlines deliver once; stale receivers and late answers cannot duplicate effects.
- **Negative control:** Acknowledge an event before durable admission.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P077 — /autonomous-grill command

- **Area:** Ext: autonomous-grill
- **Fleet area:** extensions-packages
- **Given:** the autonomous-grill skill and a mock delegation scenario.
- **When:** invoke /autonomous-grill with a target and separately with an empty/cancelled editor.
- **Then:** the generated request includes the target and same skill brief, starts one turn and reports started; an empty/cancelled target starts nothing and shows usage.
- **Legacy equivalence:** Preserve the behavior in `WBe/autonomous-grill/command.mjs:5-34`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Submit an empty target or duplicate the generated input.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P078 — bash (background by default, job ID)

- **Area:** Ext: background-bash
- **Fleet area:** bash-atelier-tree
- **Given:** an attended Durable Chat and a shell fixture recording launch count.
- **When:** call bash without foreground, then with foreground and a long-running command.
- **Then:** a job ID/log link returns promptly by default; foreground waits at most 30 seconds before returning the same job ID; timeout/12-hour ceiling is enforced and a job ID is not reported as success.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/index.ts:39-88`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after launch intent, spawn and completion admission in separate cases, then reopen. Reattach a still-live runner only by verified process identity; retain job ID/log/cancellation and one completion receipt. A missing/dead runner shows interrupted or unknown exit, never an automatic arbitrary-command relaunch; the launch counter stays one.
- **Negative control:** Spawn twice when the foreground wait times out.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P079 — bash_status

- **Area:** Ext: background-bash
- **Fleet area:** bash-atelier-tree
- **Given:** two owned background jobs and a foreign Chat's job.
- **When:** call bash_status with no ID and with one ID.
- **Then:** the tool reports only matching session-owned job state, elapsed time, byte count and log path without waiting for completion.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/index.ts:89`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after launch intent, spawn and completion admission in separate cases, then reopen. Reattach a still-live runner only by verified process identity; retain job ID/log/cancellation and one completion receipt. A missing/dead runner shows interrupted or unknown exit, never an automatic arbitrary-command relaunch; the launch counter stays one.
- **Negative control:** Return every machine job regardless of owner.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P080 — bash_cancel

- **Area:** Ext: background-bash
- **Fleet area:** bash-atelier-tree
- **Given:** one owned background job and an unrelated process.
- **When:** call bash_cancel for the job and for an unknown/foreign ID.
- **Then:** only the owned job receives cancellation; result/status distinguish requested, cancelled and unknown; the unrelated process remains alive.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/index.ts:98`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after launch intent, spawn and completion admission in separate cases, then reopen. Reattach a still-live runner only by verified process identity; retain job ID/log/cancellation and one completion receipt. A missing/dead runner shows interrupted or unknown exit, never an automatic arbitrary-command relaunch; the launch counter stays one.
- **Negative control:** Cancel by an unverified PID alone.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P081 — Completion message, status, bash log button

- **Area:** Ext: background-bash
- **Fleet area:** bash-atelier-tree
- **Given:** a background job emitting more than the inline limit.
- **When:** let it finish and open the bash log button.
- **Then:** one completion shows actual exit/state and bounded output with truncation disclosed; the log opens for inspection and copy; cancelled completion does not wake a new turn.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/jobs.mjs:100; index.ts:31,108-112; PWc/components/BashLogButton.ts:2`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after launch intent, spawn and completion admission in separate cases, then reopen. Reattach a still-live runner only by verified process identity; retain job ID/log/cancellation and one completion receipt. A missing/dead runner shows interrupted or unknown exit, never an automatic arbitrary-command relaunch; the launch counter stays one.
- **Negative control:** Mark completion delivered before admission or omit the truncation note.
- **Spec:** TBD (e2e/durable/bash-atelier-tree/...)

### AC-P082 — compact_and_continue tool

- **Area:** Ext: context-checkpoint
- **Fleet area:** context-tools-mcp
- **Given:** a completed phase and a mock compaction barrier.
- **When:** call compact_and_continue alone with summaryFocus and nextPhase, then test a sibling-tool batch.
- **Then:** one next-phase prompt is delivered only after the summary is placed; a sibling batch or oversized/empty directive is rejected, and cancellation/failure never starts the next phase.
- **Legacy equivalence:** Preserve the behavior in `WBe/context-checkpoint/index.ts:57-130`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill before summary placement, after placement before continuation, and after continuation admission before receipt; reopen at each barrier. One placed summary and at most one authorized continuation appear, held human/child input retains order, and explicit cancellation/failure cannot become successful compaction. Working Mode is reattached once for the restored context.
- **Negative control:** Trigger continuation on compaction-start rather than placed-summary receipt.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P083 — Auto compaction + 'compacting' UI

- **Area:** Compaction
- **Fleet area:** context-tools-mcp
- **Given:** auto-compaction enabled and context near the configured threshold.
- **When:** cross the threshold with mock usage, queue human input while compacting and release the summary.
- **Then:** the UI shows compacting, one summary reduces model context, held input resumes in order and Working Mode reattaches; failed/aborted compaction is visible.
- **Legacy equivalence:** Preserve the behavior in `PSS compaction; PWc/components/PromptEditor.ts:105`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill before summary placement, after placement before continuation, and after continuation admission before receipt; reopen at each barrier. One placed summary and at most one authorized continuation appear, held human/child input retains order, and explicit cancellation/failure cannot become successful compaction. Working Mode is reattached once for the restored context.
- **Negative control:** Disable automatic policy while leaving manual /compact working.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P084 — Fallback model after final failure

- **Area:** Ext: lead-fallback
- **Fleet area:** extensions-packages
- **Given:** a lead exhausting native retries and an available configured fallback.
- **When:** return a final provider failure, then repeat with user cancellation and missing fallback auth.
- **Then:** one visible fallback decision switches provider/effort and continues at most once; cancellation remains stopped and unavailable fallback reports stopped without silent billing substitution or unsafe replay.
- **Legacy equivalence:** Preserve the behavior in `WBe/lead-fallback/index.ts:7-38`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Retry fallback indefinitely or fallback after Stop.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P085 — PI_TMP env, tool_call path guard, result warning, sweep

- **Area:** Ext: pi-tmp
- **Fleet area:** extensions-packages
- **Given:** separate lead/child scratch fixtures.
- **When:** attempt write/edit to forbidden temporary paths, run a shell mentioning them, and start with expired scratch entries.
- **Then:** write/edit is blocked with guidance, shell output gets the warning, per-conversation PI_TMP stays distinct and the bounded sweep leaves live scratch intact; TMPDIR is not replaced by PI_TMP.
- **Legacy equivalence:** Preserve the behavior in `WBe/pi-tmp/index.ts:5-24`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Disable the path guard.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P086 — Startup quota check + /quota-check

- **Area:** Ext: quota-startup
- **Fleet area:** extensions-packages
- **Given:** stub quota telemetry for fresh, missing and repairable states.
- **When:** start a Chat and invoke /quota-check, declining then accepting a repair dialog.
- **Then:** quota notices reflect evidence, missing telemetry is not permission to repair, and fake sign-in/Keychain repair runs only after attended confirmation; recovery never opens an automatic repair prompt.
- **Legacy equivalence:** Preserve the behavior in `WBe/quota-startup/index.ts:12-57`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Invoke repair before confirm.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P087 — Redact tool results, assistant text, context

- **Area:** Ext: secret-redaction
- **Fleet area:** context-tools-mcp
- **Given:** synthetic secrets in assistant deltas, tool outputs/details and model-bound context.
- **When:** stream split secret chunks through core tools and each new attachment/shell/MCP/summary/child/bash-log/Atelier commit path.
- **Then:** UI, persisted output and exported diagnostics contain redaction markers rather than the synthetic secret; sanitizer failure blocks admission/output, not just rendering; user input, tool arguments and signed thinking retain their explicitly sensitive verbatim policy.
- **Legacy equivalence:** Preserve the behavior in `WBe/secret-redaction/index.ts:6-30`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill with split streaming output and reopen its persisted partial/results. Synthetic secrets remain absent from all protected committed/output/export paths; a sanitizer failure parks affected work and cannot expose plaintext or trigger duplicate tool effects.
- **Negative control:** Disable the pre-commit sanitizer in a disposable fixture and require the leak assertion to fail.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P088 — Low-disk notice before agent start

- **Area:** Ext: storage-guard
- **Fleet area:** extensions-packages
- **Given:** a lead with simulated 49 GB free and a child with the same reading.
- **When:** send turns, reduce free space by less than then exactly 5 GB.
- **Then:** the lead receives one low-disk notice and another only after the repeat drop; the child receives none and no forced cleanup turn or scratch deletion occurs.
- **Legacy equivalence:** Preserve the behavior in `WBe/storage-guard/index.ts:10-30`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Emit a low-disk notice on every turn.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P089 — subagent

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a bounded assignment, explicit profile and independent-review routing request.
- **When:** launch foreground and background Subagents in separate cases.
- **Then:** each receipt names execution ID, cwd, actual provider/model/effort and profile; child context excludes the parent transcript; independent routing uses an eligible fresh model family; leaf/coordinator tool restrictions and one-level nesting hold.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:232`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Reuse the parent transcript or bypass profile allowlists.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P090 — subagent_collect

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** running and terminal-uncollected children, including a long result and a failed receipt.
- **When:** call subagent_collect for one ID and without an ID.
- **Then:** running inspection returns immediately; terminal results are bounded with truncation/remainder disclosed and only returned results become collected; receipt failure is outcome_unknown, not success.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:377`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Mark all results collected before returning the bounded subset.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P091 — subagent_status

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** running, terminal-uncollected and collected children.
- **When:** call subagent_status by ID, default and all:true.
- **Then:** default lists running/uncollected direct children, all includes retained collected entries, and each row has truthful state, task preview, model/effort and latest observation; reading does not collect or schedule work.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:444`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Mark status reads as collection.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P092 — report_status

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a child already represented in the delegate roster.
- **When:** call report_status twice with different text.
- **Then:** the second one-line report replaces the first for that child and is visible to lead and owner without creating a second roster item.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:493`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Append each report as a new delegate.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P093 — subagent_cancel

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a running child and a Worker with leaves.
- **When:** cancel the child, then cancel the Worker in a separate fixture.
- **Then:** termination/cancellation receipt is visible; Worker cancellation reaches its leaves; cancelling one leaf does not cancel its Worker; uncertain termination is outcome_unknown.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:504`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Return cancellation success before confirming termination.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P094 — subagent_steer

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a running child with a held turn.
- **When:** steer it, then steer with requestUpdate and let it call report_status.
- **Then:** the child receives the specified steer/follow-up once, the receipt names its sequence/mode, and the requested next report wakes the lead once without granting new authority.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:525`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Wake the lead from an old status report.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P095 — worker_create

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a persisted lead Chat and a stable repository scope.
- **When:** call worker_create, then inspect the result.
- **Then:** one Worker identity is bound to owner, profile, scope and repository, with no child generation/process started; nested Worker creation fails visibly.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:553`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Start a dispatch during create.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P096 — worker_dispatch

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** an owned Worker with one active dispatch.
- **When:** dispatch another assignment while busy; after settlement dispatch a new bounded assignment.
- **Then:** busy dispatch fails preflight rather than queueing; subsequent dispatch retains scoped continuity with a fresh execution binding and one terminal receipt; independent-review roles require a fresh Subagent; settlement waits for leaves and their collection.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:585`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Release the active-dispatch lock before leaves settle.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P097 — worker_status

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** owned, foreign, retired and outcome-unknown Workers.
- **When:** call worker_status by ID, default and all:true.
- **Then:** default is owner-scoped; all:true provides diagnostics without control rights; receipts, lineage, active lock and requires-inspection reason remain truthful; unknown outcomes require inspection acknowledgement before redispatch.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:774`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Treat all:true diagnostics as ownership transfer.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P098 — worker_retire

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** an idle owned Worker and a busy/foreign Worker.
- **When:** retire the idle one with a reason and attempt another dispatch.
- **Then:** retirement remains visible with its reason and rejects future dispatch; busy/foreign retirement cannot silently seize or end work.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:827`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Allow dispatch against a retired Worker.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P099 — Completion wake-up + Delegate roster

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** two background children completing together and one receipt failure.
- **When:** watch Delegate roster and completion attention, then collect.
- **Then:** completion wake-ups coalesce without losing result identities; terminal-uncollected entries remain until collection, receipt failures are distinct, and a dropped wake is redelivered without duplicate collection.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/completion-wakeup.mjs:32-127; WBe/subagent/index.ts:208-219; PWc/components/DelegateRoster.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Mark results collected when only the wake marker was delivered.
- **Spec:** TBD (e2e/durable/subagents-workers/...)

### AC-P101 — Telemetry events + usage

- **Area:** Ext: telemetry
- **Fleet area:** extensions-packages
- **Given:** a lead and child performing model, tool, turn, compaction, tree and thinking changes.
- **When:** inspect usage in UI/status and the fixture telemetry export.
- **Then:** events correlate Chat/conversation/execution/Worker IDs and actual usage; nested calls are not double-counted, cancellation differs from restart, and diagnostic content is redacted.
- **Legacy equivalence:** Preserve the behavior in `WBe/telemetry/index.ts:19-128`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after evidence/usage/media commit, reopen and inspect UI/API plus the fixture export. Committed history, usage and media references remain; export receipts prevent duplicate accounting. Recovery attempts are distinct; uncommitted samples need not survive.
- **Negative control:** Export the same committed event twice.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P102 — tools_enable + hidden groups (workers/monitor/atelier) + goal tool gating

- **Area:** Ext: tool-groups
- **Fleet area:** context-tools-mcp
- **Given:** worker, monitor and Atelier groups registered but initially hidden.
- **When:** call tools_enable for each and inspect the next mock request; test a restricted child/nested caller.
- **Then:** only enabled eligible tools and aliases are exposed; Workers orchestration exposes the worker group; enabling cannot widen a child allowlist; invalid/unregistered groups fail.
- **Legacy equivalence:** Preserve the behavior in `WBe/tool-groups/index.ts:43-73; WBe/tool-groups/groups.mjs:3-11`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after group enablement commits, reopen and compact/fork at retained branch points. Exposure restores as-of the branch before scheduling, aliases obey it, and child/nested allowlists never widen; enabling causes no tool execution.
- **Negative control:** Enable all registered tools irrespective of profile.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P103 — Working Mode block delivery, status, compaction reattach

- **Area:** Ext: working-mode
- **Fleet area:** context-tools-mcp
- **Given:** a Chat with non-default selections on all four Working Mode axes.
- **When:** change selection, send a prompt, compact and send again.
- **Then:** status distinguishes selected/applied state; tagged recorded guidance reaches the mock on application and after compaction without becoming a changing system section or permission grant.
- **Legacy equivalence:** Preserve the behavior in `WBe/working-mode/index.ts:74-125`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after selected/applied/aligned state and guidance admission, then reopen. Recorded choices restore before scheduling, pending guidance delivers once, and alignment/reset state follows the retained branch; compaction reattaches guidance without granting authority or duplicating a turn.
- **Negative control:** Change status without recording/delivering guidance.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P104 — /mode (args form; no-arg ui.select picker)

- **Area:** Ext: working-mode
- **Fleet area:** context-tools-mcp
- **Given:** a Durable Chat with Working Mode controls.
- **When:** use /mode axis value, /mode send and no-argument /mode.
- **Then:** valid args update selection; send applies pending guidance immediately or steers at the next boundary; unchanged sends do not duplicate it; no-arg web use shows usage rather than requiring a TUI picker; invalid values leave state intact.
- **Legacy equivalence:** Preserve the behavior in `WBe/working-mode/index.ts:88-121`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after selected/applied/aligned state and guidance admission, then reopen. Recorded choices restore before scheduling, pending guidance delivers once, and alignment/reset state follows the retained branch; compaction reattaches guidance without granting authority or duplicating a turn.
- **Negative control:** Start a new turn for an unchanged /mode send.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P105 — alignment_reached

- **Area:** Ext: working-mode
- **Fleet area:** context-tools-mcp
- **Given:** Attention AFK with non-default Alignment still pending.
- **When:** have the scripted model call alignment_reached with an agreed outcome.
- **Then:** status becomes aligned and subsequent guidance uses AFK rules; tool output records the agreement without creating new authority.
- **Legacy equivalence:** Preserve the behavior in `WBe/working-mode/rules.mts:54; index.ts:132`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after selected/applied/aligned state and guidance admission, then reopen. Recorded choices restore before scheduling, pending guidance delivers once, and alignment/reset state follows the retained branch; compaction reattaches guidance without granting authority or duplicating a turn.
- **Negative control:** Leave the aligned flag false after success.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P106 — alignment_reset

- **Area:** Ext: working-mode
- **Fleet area:** context-tools-mcp
- **Given:** an aligned AFK Chat.
- **When:** call alignment_reset with a reason.
- **Then:** status returns to unaligned and the next guidance restores preparation-before-AFK behavior with the reason recorded.
- **Legacy equivalence:** Preserve the behavior in `WBe/working-mode/rules.mts:55; index.ts:146`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after selected/applied/aligned state and guidance admission, then reopen. Recorded choices restore before scheduling, pending guidance delivers once, and alignment/reset state follows the retained branch; compaction reattaches guidance without granting authority or duplicating a turn.
- **Negative control:** Retain aligned state after reset.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P107 — AGENTS.md (global + project) and APPEND_SYSTEM.md in system prompt

- **Area:** Resources
- **Fleet area:** context-tools-mcp
- **Given:** global/project AGENTS.md markers and global/project APPEND_SYSTEM.md fixtures.
- **When:** start a trusted Durable Chat and inspect the first mock payload.
- **Then:** global and applicable ancestor/project instructions appear in the intended order without duplicate worktree context; trusted project APPEND_SYSTEM takes precedence over global, with global fallback when absent/untrusted.
- **Legacy equivalence:** Preserve the behavior in `Pi DefaultResourceLoader (legacy session)`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Load only project instructions or concatenate both append overrides.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P108 — Skill catalog: 8 Workbench skills, global skills (gh-stack), package skills

- **Area:** Resources
- **Fleet area:** extensions-packages
- **Given:** the eight bundled Workbench skills (`atelier`, `autonomous-grill`, `define-goal`, `model-orchestration`, `orient`, `workstreams`, `analyze-source-for-workbench`, `customize-pi-web-presentation`), global `gh-stack` and installed package skill fixtures.
- **When:** open the skill command catalog and invoke a representative skill from each origin.
- **Then:** names/descriptions and resource paths are discoverable even with legacy extension execution disabled; content and relative-reference roots are correct; manual-only presentation guidance stays manual-only.
- **Legacy equivalence:** Preserve the behavior in `WB/skills/*; Pi loader`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Drop package skills whenever noExtensions is set.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P109 — Project trust precedence

- **Area:** Resources
- **Fleet area:** context-tools-mcp
- **Given:** saved trust decisions conflicting with defaultProjectTrust and a project resource fixture.
- **When:** create Chats under trusted, denied and undecided profiles.
- **Then:** saved trust wins; absent decisions use the default with ask treated as untrusted; untrusted project extensions/resources do not become executable or override global providers.
- **Legacy equivalence:** Preserve the behavior in `PWs/piSessionService.projectTrust.acceptance.test.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Let a project provider override global configuration before trust.
- **Spec:** TBD (e2e/durable/context-tools-mcp/...)

### AC-P110 — Extension-contributed resources

- **Area:** Resources
- **Fleet area:** extensions-packages
- **Given:** a supported port contributing a skill or prompt resource.
- **When:** load its declared resource, invoke it, then remove it and reload.
- **Then:** the command/catalog and mock payload reflect the contribution and its origin; removed resources disappear; unsupported contributors fail visibly rather than silently losing content.
- **Legacy equivalence:** Preserve the behavior in `Pi extension resource hooks`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore extension-contributed resource paths.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P111 — Claude subscription payload/alias adapter

- **Area:** Pkg: pi-claude-code-use
- **Fleet area:** extensions-packages
- **Given:** fake Claude subscription auth and a scripted tool-use/thinking response.
- **When:** send a prompt, complete a tool turn and compact through the mock Anthropic Messages endpoint.
- **Then:** captured payload matches the subscription adapter's system/tool aliases and cache conventions; UI displays canonical tool names and valid thinking; no paid-key or live-endpoint fallback occurs.
- **Legacy equivalence:** Preserve the behavior in `NM/@benvargas/pi-claude-code-use/extensions/index.ts:1216-1258`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Bypass the subscription payload transform.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P112 — mcp__ alias tools for extension/MCP tools

- **Area:** Pkg: pi-claude-code-use
- **Fleet area:** extensions-packages
- **Given:** two extension/MCP tools with colliding short names and one disabled tool.
- **When:** request them through Claude aliases and switch to OpenAI.
- **Then:** aliases route by provenance to the correct canonical tool exactly once; UI/persistence use canonical names; disabled tools stay unavailable and OpenAI does not inherit Claude-only aliases.
- **Legacy equivalence:** Preserve the behavior in `NM/@benvargas/pi-claude-code-use/extensions/index.ts:1074`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Route aliases using only a lowercase suffix.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P113 — web_enable (loader)

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** configured search/fetch capabilities with one explicitly disabled capability.
- **When:** call web_enable.
- **Then:** the result lists enabled configured tools and the next mock request exposes them; the call itself makes no search/fetch request and disabled capabilities remain absent.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22423,22473`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Activate every web tool regardless of configuration.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P114 — web_search

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** a local search-provider fixture returning distinct sources for two queries.
- **When:** call web_search with bounded results and provider selection.
- **Then:** the tool card returns source-linked results, provider identity and a responseId for full retrieval; filters/limits reach the fixture and partial/provider failures are explicit.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22946`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Return a canned answer without source IDs.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P115 — fetch_content

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** local page, image, PDF and repository fixtures and supported fetch modes.
- **When:** call fetch_content for single/multiple URLs, including readable/raw/answer cases.
- **Then:** content or images and bounded metadata are visible; answer mode uses only the page and mocked model; disabled modes and failed fetches are explicit, not invented content.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22948`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore requested fetch mode.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P116 — get_search_content

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** stored search and fetch results longer than the inline cap.
- **When:** call get_search_content using responseId, offsets/limits and findText.
- **Then:** bounded pages, continuation metadata and matching passages refer to the selected result/query/URL; unknown IDs fail and retrieval makes no new external fetch.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22949`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Return the first page regardless of offset.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P117 — source_check

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** a claim and local source fixtures containing exact passages.
- **When:** call source_check.
- **Then:** a bounded structured research artifact includes source links and exact passage citations for manual review, not an unsupported truth verdict.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22947`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Invent a citation absent from fetched content.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P118 — /websearch, /curator, /search, /google-account

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** local search fixtures and stored results, with browser-cookie access disabled.
- **When:** run /websearch, /curator on/off/auto-summary and /search.
- **Then:** curator opens with scripted results; configuration changes are visible; stored-result selection permits viewing/deleting only the chosen result and empty storage reports none; /google-account is excluded.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:25780,26028,26062,26101`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore curator configuration or delete all stored results.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P119 — Session hooks (before_agent_start, session_tree, tool_call, agent_settled) + widget

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** a search with pending content and curator auto-approval scoped to one turn.
- **When:** settle the turn or navigate history, then search again.
- **Then:** pending activity is observable, stale work is cleaned up, approval does not leak into the new turn/branch, and nested search completion returns its required content rather than orphaning a background fetch.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22412-22416,25047-25058`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Retain auto-approval across session_tree.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P124 — ask_human

- **Area:** Pkg: ping-a-human-pi
- **Fleet area:** extensions-packages
- **Given:** a local phone stub with delayed answer and no real Telegram access.
- **When:** call ask_human, then supply a fake reply; separately time out/cancel.
- **Then:** the tool waits for and shows the reply or truthful timeout/cancellation, while the stub records one send; the call is unsafe on replay.
- **Legacy equivalence:** Preserve the behavior in `NM/ping-a-human-pi/extension/index.ts:81,288`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the stub records a phone send but before its result commits, then reopen. Show interrupted/unknown delivery, retain any committed result and require reconciliation before another send. Stub send count remains one; no automatic phone replay.
- **Negative control:** Classify the phone send as replay-safe.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P125 — notify_human

- **Area:** Pkg: ping-a-human-pi
- **Fleet area:** extensions-packages
- **Given:** a local phone notification stub.
- **When:** call notify_human with a message and simulate transport failure separately.
- **Then:** one stub send and its success/error result are visible; failure is not reported as delivered.
- **Legacy equivalence:** Preserve the behavior in `NM/ping-a-human-pi/extension/index.ts:80,288`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the stub records a phone send but before its result commits, then reopen. Show interrupted/unknown delivery, retain any committed result and require reconciliation before another send. Stub send count remains one; no automatic phone replay.
- **Negative control:** Return success for a rejected stub response.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P126 — /ping

- **Area:** Pkg: ping-a-human-pi
- **Fleet area:** extensions-packages
- **Given:** a local phone stub and an idle Durable Chat.
- **When:** invoke /ping with and without text.
- **Then:** the stub receives the explicit message or default cwd-bearing ping; UI reports delivery/failure without using real credentials.
- **Legacy equivalence:** Preserve the behavior in `NM/ping-a-human-pi/extension/index.ts:357`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the stub records a phone send but before its result commits, then reopen. Show interrupted/unknown delivery, retain any committed result and require reconciliation before another send. Stub send count remains one; no automatic phone replay.
- **Negative control:** Bypass the stub and permit outbound phone traffic.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P128 — /btw, /side, /btw:tangent, /btw:ask, /btw:new, /btw:clear, /btw:inject, /btw:summarize, /btw:model, /btw:thinking

- **Area:** Pkg: pi-btw
- **Fleet area:** extensions-packages
- **Given:** a Durable Chat using the non-overlay BTW command path and mock side-model responses.
- **When:** invoke /btw and /side with inline questions, tangent/read-only/new/clear, inject/summarize and side model/thinking overrides.
- **Then:** side replies appear as visible saved notes without stopping main work; tangent has no main context, ask exposes only read-only tools, new/clear reset the side thread, overrides affect only the side model, and inject/summarize explicitly transfer content to the lead; empty overlay-opening commands show inline-question guidance.
- **Legacy equivalence:** Preserve the behavior in `GIT/dbachelder/pi-btw/extensions/btw.ts:2916-2979`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Give the read-only side thread write tools or apply its model override to the lead.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P129 — Overlay, shortcuts, message renderer, context hook

- **Area:** Pkg: pi-btw
- **Fleet area:** extensions-packages
- **Given:** a non-overlay BTW note and separate main/side context fixtures.
- **When:** send a main prompt, then navigate history and inspect restored BTW state.
- **Then:** the note stays readable in the Chat but is filtered from main model context unless explicitly injected; side state follows the selected branch and stale lifecycle completions cannot publish into a new branch; overlay and shortcuts are excluded.
- **Legacy equivalence:** Preserve the behavior in `GIT/dbachelder/pi-btw/extensions/btw.ts:2832-2906`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Include every visible BTW note in main provider context.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P130 — btw skill

- **Area:** Pkg: pi-btw
- **Fleet area:** extensions-packages
- **Given:** the pi-btw package skill installed while its overlay is deferred.
- **When:** invoke /skill:btw.
- **Then:** the skill body and relative-reference guidance reach the mock and appear in the catalog; loading the skill does not falsely enable deferred overlay commands.
- **Legacy equivalence:** Preserve the behavior in `GIT/dbachelder/pi-btw/skills/btw`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Couple skill discovery to loading the deferred extension.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P131 — Skills ponytail-audit/-debt/-gain/-help/-review (ponytail excluded)

- **Area:** Pkg: ponytail
- **Fleet area:** extensions-packages
- **Given:** the five selected ponytail skills and excluded ponytail skill fixture.
- **When:** inspect catalog and invoke audit/debt/gain/help/review separately.
- **Then:** all five resolve to their own content while the excluded skill and disabled extension hooks remain absent; synced AGENTS.md mode text is independent of extension execution.
- **Legacy equivalence:** Preserve the behavior in `package skill selection; GIT/DietrichGebert/ponytail/skills`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore the package skill include/exclude list.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P133 — monitor, monitor_status, monitor_inspect, monitor_kill, monitor_kill_all, monitor_recover, monitor_gc

- **Area:** Pkg: pi-process-monitor
- **Fleet area:** extensions-packages
- **Given:** local owned-process, observer and quarantined watcher fixtures.
- **When:** use monitor, monitor_status, monitor_inspect, monitor_kill, monitor_kill_all, monitor_recover and monitor_gc.
- **Then:** logical identity, owner, recovery policy and output are visible; reuse does not duplicate work; poll mutations quarantine; recovery needs explicit approval; kill affects only verified owned processes and kill-all requires confirm=true; GC defaults to dry-run.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-process-monitor/extensions/monitor/tools.ts:36-115`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Reuse an identity by spawning a second workload.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P134 — /monitor, /monitors, /monitor-kill, /monitor-recover, /monitor-gc

- **Area:** Pkg: pi-process-monitor
- **Fleet area:** extensions-packages
- **Given:** a local watcher fixture.
- **When:** invoke /monitor, /monitors, /monitor-kill, /monitor-recover and /monitor-gc.
- **Then:** command notices expose the same watcher identity/state; invalid or empty input shows usage; explicit recover approve/reject is honored and GC without --apply changes nothing.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-process-monitor/extensions/monitor/commands.ts:29-97`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Make /monitor-gc destructive by default.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P135 — Message renderer + session hooks (sendMessage pings)

- **Area:** Pkg: pi-process-monitor
- **Fleet area:** extensions-packages
- **Given:** a watcher configured to ping on a fixture event.
- **When:** trigger its event, then close/reopen the Chat transport.
- **Then:** a readable watcher-tagged message identifies the event and owner, pings obey the condition, and another Chat receives none; session hook errors report recovery failed closed.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-process-monitor/extensions/monitor/index.ts:12-25`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Deliver every watcher tick as a new prompt.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P136 — monitor skill + /watch prompt

- **Area:** Pkg: pi-process-monitor
- **Fleet area:** extensions-packages
- **Given:** the monitor package skill and watch template installed.
- **When:** invoke /skill:monitor and /watch with a local source.
- **Then:** catalog discovery and mock payload include the skill and expanded source, status-before-create/reuse guidance and explicit source.type; expansion alone starts no process.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-process-monitor/skills/monitor; prompts/watch.md`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Omit package prompts while keeping package skills.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P137 — /fast, --fast flag, service_tier hook, status

- **Area:** Pkg: pi-openai-fast-mode
- **Fleet area:** extensions-packages
- **Given:** mock OpenAI and Claude models with fast mode initially off.
- **When:** run /fast on, off and toggle and test the supported startup fast flag.
- **Then:** status reflects enabled/applicable state; only supported OpenAI requests get the configured service_tier, Claude payloads stay unchanged, and invalid args show an error.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-openai-fast-mode/src/index.ts:94-145`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime. Original n-a condition ended with the accepted OpenAI scope decision; the CLI flag is tested only at the supported host startup boundary, not as a new browser control.
- **Negative control:** Add service_tier to every provider payload.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P138 — /relay, /relay-worktree prompt templates

- **Area:** Pkg: relays
- **Fleet area:** extensions-packages
- **Given:** installed relay and relay-worktree prompt templates.
- **When:** invoke both with a task in separate mock scenarios.
- **Then:** expanded prompts preserve arguments and explicit post-review human approval before spawn_session; relay-worktree proposes fresh-worktree mode; empty tasks ask for an objective and do not dispatch.
- **Legacy equivalence:** Preserve the behavior in `relays package/prompts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Strip the approval gate from template expansion.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

### AC-P139 — relay, relay-runner skills

- **Area:** Pkg: relays
- **Fleet area:** extensions-packages
- **Given:** installed relay and relay-runner package skills.
- **When:** inspect catalog and invoke both skill commands.
- **Then:** both bodies and relative-reference roots reach the mock independently of legacy extension loading, without starting a Relay merely by discovery.
- **Legacy equivalence:** Preserve the behavior in `relays/skills`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Omit package-distributed skills.
- **Spec:** TBD (e2e/durable/extensions-packages/...)

## Deferred and out of scope

Only the named surface is excluded for partial rows; each retained portion still has one AC.
All decisions below were accepted on **2026-10-22**; they are not implementation failures waived
by the fleet.

| Row | Excluded scope | Reason | Decision date |
| --- | --- | --- | --- |
| P061 | Whole row | tool_search is default-inactive; explicitly deferred. | 2026-10-22 |
| P062 | Whole row | codemode is default-inactive; explicitly deferred. | 2026-10-22 |
| P074 | Whole row | agent-audit is opt-in TUI capture; explicitly deferred. | 2026-10-22 |
| P100 | Whole row | Subagent background keyboard shortcut is TUI-only; explicitly deferred. | 2026-10-22 |
| P120 | Whole row | Web-access curate/activity shortcuts are TUI-only; explicitly deferred. | 2026-10-22 |
| P121 | Whole row | pi-goal is out of scope; owner no longer uses it. | 2026-10-22 |
| P122 | Whole row | pi-goal completion/block/wait tools are out of scope. | 2026-10-22 |
| P123 | Whole row | pi-goal autonomous loop and status chip are out of scope. | 2026-10-22 |
| P102 | pi-goal tool gating only | pi-goal is out of scope; worker/monitor/Atelier groups remain required. | 2026-10-22 |
| P118 | /google-account only | Browser-cookie account inspection explicitly deferred; other web commands remain required. | 2026-10-22 |
| P128 | Overlay-opening/no-inline-question UI only | pi-btw overlay deferred; inline commands have a legacy non-TUI path and remain covered pending the Open scope clarification. | 2026-10-22 |
| P129 | Overlay and focus/width shortcuts only | pi-btw overlay deferred; visible saved notes, branch restoration and context filtering remain covered pending the Open scope clarification. | 2026-10-22 |
| P141 | Terminal/PTY owner | Later Phase C retained owner; also recorded as n-a in the inventory. | 2026-10-22 |

## Not applicable

| Row | Reason |
| --- | --- |
| P054 | These slash commands are not implemented in legacy web either; app model/login controls remain covered separately. |
| P063 | TUI-side PI WEB administration command; not an installed Chat feature. |
| P072 | grep/find/ls are not in the inventoried active built-in set; no parity port required here. |
| P127 | Automatic phone notify/approval hooks are disabled in the inventoried profile. |
| P132 | Ponytail extension is disabled; selected skills and synced instruction text remain covered. |
| P140 | Workspace-file browser plugin is runtime-independent. |
| P141 | Terminal/PTY belongs to the retained terminal owner in later Phase C; not Durable Chat execution. |

P137 was n-a in the inventory but is counted as an AC, not in this table, because OpenAI is now
accepted scope. P141's original survival flag belongs to the deferred terminal owner, not this fleet.

## Open

- **P128, P129 — deferral boundary:** the accepted wording says “pi-btw overlay,” while the
  earlier candidate question grouped the command family with that overlay. Source inspection
  (`btw.ts:2242–2387,2633–2725,2876–2894`) shows a non-TUI inline command path, automatic visible
  notes without an overlay, and context/branch hooks. The ACs conservatively retain those working
  behaviors. Lead/owner should confirm whether the deferral was intended to retire the entire
  BTW runtime instead. Until clarified, neither row may be dropped or counted as an unconditional
  full-row deferral; no observable criterion is otherwise blocked.

## Coverage

Counts are criteria, not test cases or passing results. Survival counts include all 54 in-scope
matrix-flagged rows plus P042 recorded-dialog recovery and P124–P126 unsafe phone-send recovery
required by the parent migration rules/accepted phone decision. The original 55th survival row,
P141, belongs to later Phase C. Compound criteria may require several WebKit specs.

Reconciliation: **126 AC rows + 8 wholly deferred/out-of-scope rows + 7 n-a rows = 141**.
The four partially excluded AC rows (P102, P118, P128, P129) are counted once each, not subtracted
again; P141 appears in both explanatory exclusion tables but counts once as n-a.
Open scope clarifications: **2 rows (P128, P129)**. No AC has a runnable spec assigned yet.

| Fleet area | AC count | Survival count |
| --- | ---: | ---: |
| composer-queue | 18 | 10 |
| context-tools-mcp | 26 | 16 |
| attention-catalog | 19 | 6 |
| subagents-workers | 16 | 14 |
| bash-atelier-tree | 13 | 8 |
| extensions-packages | 34 | 4 |
| **Total** | **126** | **58** |
