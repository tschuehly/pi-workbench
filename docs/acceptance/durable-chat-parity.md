# Durable Chat parity acceptance

These criteria are the source of truth for **“parity reached”**: a Durable Chat preserves the
in-scope legacy UI/API behavior and the recovery guarantees below. They are intended acceptance,
not a claim that the port or tests already pass. Later phases rerun this suite; “done” in the
original inventory never exempts a row from testing.

## Run and evidence

Use the real Workbench UI in WebKit through PI WEB's isolated `e2e/isolatedPiWeb.ts` harness.
Create a Durable Chat and a neighboring legacy Chat; drive controls in the browser, using API
assertions and fixture receipts for state not directly rendered. Keep legacy regression checks.
Each `Spec:` names the PI WEB tests under `e2e/durable/<fleet-area>/` (titles carry the AC ID)
and, where they exist, the durable-pilot host tests; see **How to run**. After area runs, run
the whole `npm run test:e2e` suite twice consecutively. A listed spec is not passing evidence by
itself; the run results are.

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

## How to run

`e2e/...` paths are in the PI WEB checkout (slice branch `feat/durable-chat-slice1-20261022`);
`packages/...` paths are in this repository. Set `WORKBENCH` to this checkout and run PI WEB
commands from the PI WEB checkout. No command sends live model requests: the harness points
both providers at the scripted mock.

```bash
export PI_WEB_E2E_DURABLE_HOST="$WORKBENCH/packages/durable-pilot/src/chat-host-main.ts"
export PI_TMP=<persistent scratch dir>      # never /tmp

# Host suites (this repository)
npm --prefix packages/durable-pilot run setup
npm --prefix packages/durable-pilot test    # typecheck, matrix, spikes, chat, extensions, packages, bash-atelier
npm --prefix packages/durable-pilot run test:chat   # or test:extensions, test:packages, test:bash-atelier

# Full PI WEB e2e (skips e2e/durable/<area>/), with and without the installed packages
npm run test:e2e
PI_WEB_E2E_PI_PACKAGES=~/.pi/agent/npm/node_modules npm run test:e2e

# Fleet areas (each run separately)
bash e2e/durable/bash-atelier-tree/run.sh
PI_WEB_E2E_FLEET=1 PI_WEB_E2E_PI_PACKAGES=~/.pi/agent/npm/node_modules npx playwright test e2e/durable/composer-attention/
PI_WEB_E2E_FLEET=1 PI_WEB_E2E_PI_PACKAGES=~/.pi/agent/npm/node_modules npx playwright test e2e/durable/context-tools/
PI_WEB_E2E_PI_PACKAGES=~/.pi/agent/npm/node_modules npx playwright test -c e2e/durable/extensions-packages/fleet.config.ts
TMPDIR="$PI_TMP" npx playwright test -c e2e/durable/subagents-workers/playwright.config.ts
```

Add `--grep '<AC-ID>'` to run one criterion and `--repeat-each=2` for the repeat the fleet
requires. Fleet areas keep failing criteria as ordinary failures, so a red area is a finding,
not a harness fault.

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
requirement. Round 2 applies **Scope by usage**: the features it defers, the untraced commands
and the pi-goal and pi-btw packages move to the deferred table below, which supersedes the
earlier narrow BTW reading. P075, P102 and P108 keep their remaining scope. Zero-use P012 and
P014 stay as core composer controls that are built and pass; P038 stays by decision.

## Criteria

All Given clauses below assume an isolated Durable Chat and the mock-only harness above.
Compound rows deliberately remain one AC, with all named variants required.

### AC-P001 — Create a Chat (opt-in 'New Durable Chat' button, capability-gated)

- **Area:** Chat core
- **Fleet area:** composer-attention
- **Given:** a workspace with Durable capability enabled.
- **When:** choose New Durable Chat, then create an ordinary Chat beside it.
- **Then:** the catalog shows distinct Durable and legacy Chats in that workspace; disabling Durable capability removes or disables its creation control with a reason.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionRoutes.ts:77; PSS:1707`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Disable the Durable creation route.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P001: create Durable and legacy neighbors; capability removal hides creation"

### AC-P002 — List / recent / locate Chats

- **Area:** Chat core
- **Fleet area:** composer-attention
- **Given:** two Durable Chats and a legacy Chat in different workspaces.
- **When:** open the catalog, recent list and an exact Chat link.
- **Then:** each Chat appears once, recent order follows modification time, and the link locates the correct workspace without starting a model turn.
- **Legacy equivalence:** Preserve the behavior in `PSS:1590,1603,4205`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Omit Durable records from catalog aggregation.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P002: catalogs contain each Chat once; recent sorted; exact link locates without a turn"

### AC-P003 — Send prompt (idle) with stable operation ID, admitted after commit

- **Area:** Composer
- **Fleet area:** composer-attention
- **Given:** an idle Durable Chat and a held commit barrier.
- **When:** send a prompt with operation ID A, retry A after losing the response, then reuse A with different text.
- **Then:** no success is acknowledged before commit; one user entry and one admitted operation result; changed text under A is rejected.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionRoutes.ts:414; PSS:3227`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Hold input at admission; kill before commit and after commit before acknowledgement, reopen and retry its original operation ID. Only committed input is restored with the same IDs/kinds/order; changed payload under a reused ID fails. After a failed turn, waiting input remains waiting (afterFailedRun=keep), not silently drained.
- **Negative control:** Acknowledge before commit or disable receipt deduplication.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P003: operation ID retries after host kill admit once and changed payload rejects"; `e2e/durable/composer-attention/queue-boundaries.spec.ts` › "AC-P003: host kill before admission keeps one prompt under its original operation ID"; `e2e/durable/composer-attention/queue-boundaries.spec.ts` › "AC-P003: host kill after commit before browser acknowledgement keeps one prompt under its original operation ID"; `e2e/durable/composer-attention/queue-boundaries.spec.ts` › "AC-P003 P004 P007: failed turn retains waiting input through SIGKILL, without silently draining"; host: `packages/durable-pilot/test/chat-host.test.ts` › "crash row queued input: an acknowledged follow-up survives a kill once, a retry is deduplicated, a changed payload is rejected"

### AC-P004 — Steer / follow-up while streaming

- **Area:** Composer
- **Fleet area:** composer-attention
- **Given:** a streaming Durable Chat held at a tool boundary.
- **When:** submit one steer and two follow-ups.
- **Then:** the queue labels their kinds; steering reaches the next eligible boundary and follow-ups retain order after the current work.
- **Legacy equivalence:** Preserve the behavior in `PSS:3227; PWc/components/PromptEditor.ts:92,104`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Hold input at admission; kill before commit and after commit before acknowledgement, reopen and retry its original operation ID. Only committed input is restored with the same IDs/kinds/order; changed payload under a reused ID fails. After a failed turn, waiting input remains waiting (afterFailedRun=keep), not silently drained.
- **Negative control:** Treat every input as an immediate new turn.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P004 P007 P011 durable: steer and follow-ups queue; Stop recalls without sending"; `e2e/durable/composer-attention/composer.spec.ts` › "AC-P004 P007: queued kinds and order survive a real host kill; read-only reopen stays paused"; `e2e/durable/composer-attention/queue-boundaries.spec.ts` › "AC-P004: steer reaches the tool boundary and follow-ups run in admission order"; `e2e/durable/composer-attention/queue-boundaries.spec.ts` › "AC-P003 P004 P007: failed turn retains waiting input through SIGKILL, without silently draining"; `e2e/durable/composer-attention/composer.spec.ts` › "AC-P004 P007 P011 legacy: steer and follow-ups queue; Stop recalls without sending"

### AC-P005 — Live streaming: assistant + thinking deltas, tool start/update/end

- **Area:** Transcript
- **Fleet area:** composer-attention
- **Given:** a mock scenario emitting text, thinking and a streaming tool result.
- **When:** watch the transcript during generation and reconnect the browser.
- **Then:** text/thinking grow before completion, tool start/update/end converge to one result, and the snapshot does not duplicate deltas or expose thinking signatures; nested tool execution stays inside its parent result rather than creating transient standalone rows.
- **Legacy equivalence:** Preserve `PSS:6603–6656` event projection (the inventory's `piSessionEvents.ts` path no longer exists); Durable additionally records interrupted generation.
- **Survival:** Kill after a partial commits, then reopen. The committed partial is visibly aborted; an ordinary provider request may be resent and is counted as a recovery attempt, not a second admitted prompt. Finished tool results are not executed again.
- **Negative control:** Suppress streaming updates and leave only the final response.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P005: thinking and text stream before completion; host kill retains aborted partial"; `e2e/durable/composer-attention/queue-boundaries.spec.ts` › "AC-P005: completed shell effect is not replayed when the following generation is killed"; host: `packages/durable-pilot/test/chat-host.test.ts` › "a turn reaches PI WEB as session events and a transcript with entry IDs"; `packages/durable-pilot/test/chat-host.test.ts` › "crash row generation: a committed partial survives a kill, restore stays paused, then the request is sent again"

### AC-P006 — Transcript paging / transcript + stream snapshot

- **Area:** Transcript
- **Fleet area:** composer-attention
- **Given:** a long Durable transcript with a tool call/result pair across a page boundary.
- **When:** load older messages and reconnect during a new partial response.
- **Then:** pages contain no missing or duplicate entries or orphaned tool pairs; the current partial and sequence watermark converge with live updates.
- **Legacy equivalence:** Preserve the behavior in `PSS:2843,2866,2934`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Return the same page for every before cursor.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P006: paging preserves tool pairs and reconnect snapshot converges"

### AC-P007 — Queued messages list in status

- **Area:** Queue
- **Fleet area:** composer-attention
- **Given:** committed steer and follow-up messages held behind active work.
- **When:** inspect the queue and status API.
- **Then:** each pending item has the correct text, kind, order and attachment count; client-pending input is distinguishable from host-admitted input.
- **Legacy equivalence:** Preserve the behavior in `PWc/components/chat/QueuedMessages.ts; PSS:2918`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Hold input at admission; kill before commit and after commit before acknowledgement, reopen and retry its original operation ID. Only committed input is restored with the same IDs/kinds/order; changed payload under a reused ID fails. After a failed turn, waiting input remains waiting (afterFailedRun=keep), not silently drained.
- **Negative control:** Drop one pending item from status.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P004 P007 P011 durable: steer and follow-ups queue; Stop recalls without sending"; `e2e/durable/composer-attention/composer.spec.ts` › "AC-P004 P007: queued kinds and order survive a real host kill; read-only reopen stays paused"; `e2e/durable/composer-attention/queue-boundaries.spec.ts` › "AC-P003 P004 P007: failed turn retains waiting input through SIGKILL, without silently draining"; `e2e/durable/composer-attention/composer.spec.ts` › "AC-P004 P007 P011 legacy: steer and follow-ups queue; Stop recalls without sending"

### AC-P008 — Clear queue

- **Area:** Queue
- **Fleet area:** composer-attention
- **Given:** active generation with queued inputs.
- **When:** choose Clear queue.
- **Then:** pending items disappear from UI/status while generation continues; cleared text is never submitted later.
- **Legacy equivalence:** Preserve the behavior in `PSS:4107`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the queue mutation commits but before its response; reopen and retry the same operation. The UI shows the edited/removed/promoted queue in committed order, never the pre-mutation queue or a duplicate delivery.
- **Negative control:** Clear only the browser projection.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P008: Clear queue keeps current generation and stays cleared after host kill"

### AC-P009 — Edit / remove a queued message

- **Area:** Queue
- **Fleet area:** composer-attention
- **Given:** a queue containing A, B and C.
- **When:** remove B; separately recall B for editing and toggle an item's kind.
- **Then:** remove preserves A/C; recall restores B's text and clears later queued items; toggle moves the item to the other kind's tail; a stale expected queue is rejected instead of editing a different item.
- **Legacy equivalence:** Preserve the behavior in `PSS:4008; PWs/queuedMessageMutation.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the queue mutation commits but before its response; reopen and retry the same operation. The UI shows the edited/removed/promoted queue in committed order, never the pre-mutation queue or a duplicate delivery.
- **Negative control:** Ignore expectedQueue revision/content checks.
- **Scope:** built, not required — zero use 2026-10-08..22 (Scope by usage), but the queue edit/promote port exists and its specs pass, so it stays a regression criterion.
- **Spec:** `e2e/durableComposer.spec.ts` › "queued messages: send now and remove; after a host restart the queue is still there to recall, and Stop returns the rest to the composer"; host: `packages/durable-pilot/test/composer.test.ts` › "queued edit: toggle, promote, remove, recall and promote-all change the Durable queue as legacy does; a stale snapshot is refused"; `packages/durable-pilot/test/composer.test.ts` › "crash row queue edit: queued messages survive a kill, stay editable while paused, and only the kept ones are sent"

### AC-P010 — Promote queued message / promote all

- **Area:** Queue
- **Fleet area:** composer-attention
- **Given:** two follow-ups and existing steering input.
- **When:** choose Send now on one follow-up, then Send all now.
- **Then:** chosen items become steering in stable execution order, preserving attachments; promotion waits while compacting.
- **Legacy equivalence:** Preserve the behavior in `PSS:3981,3998`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the queue mutation commits but before its response; reopen and retry the same operation. The UI shows the edited/removed/promoted queue in committed order, never the pre-mutation queue or a duplicate delivery.
- **Negative control:** Change the label but leave delivery kind unchanged.
- **Scope:** built, not required — zero use 2026-10-08..22 (Scope by usage), but the queue edit/promote port exists and its specs pass, so it stays a regression criterion.
- **Spec:** `e2e/durableComposer.spec.ts` › "queued messages: send now and remove; after a host restart the queue is still there to recall, and Stop returns the rest to the composer"; host: `packages/durable-pilot/test/composer.test.ts` › "queued edit: toggle, promote, remove, recall and promote-all change the Durable queue as legacy does; a stale snapshot is refused"; `packages/durable-pilot/test/composer.test.ts` › "crash row queue edit: queued messages survive a kill, stay editable while paused, and only the kept ones are sent"

### AC-P011 — Stop: abort run, withdraw queue, queued text back to composer

- **Area:** Stop
- **Fleet area:** composer-attention
- **Given:** streaming work and queued text.
- **When:** press Stop.
- **Then:** generation aborts, admitted queue is withdrawn, queued text returns to the composer without automatic resubmission, and stop failure is visible rather than reported as success.
- **Legacy equivalence:** Preserve the behavior in `PSS:4124-4149`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after Stop commits, reopen and inspect without sending. Cancellation and queue withdrawal remain effective; saved recalled text is only a client draft. No cancelled input or effect restarts.
- **Negative control:** Abort generation without withdrawing the queue.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P004 P007 P011 durable: steer and follow-ups queue; Stop recalls without sending"; `e2e/durable/composer-attention/queue-boundaries.spec.ts` › "AC-P011: Stop failure is visible and does not claim generation stopped"; `e2e/durable/composer-attention/composer.spec.ts` › "AC-P004 P007 P011 legacy: steer and follow-ups queue; Stop recalls without sending"; host: `packages/durable-pilot/test/chat-host.test.ts` › "Stop withdraws the queued follow-up and ends the running bash call"

### AC-P012 — Stop Chat runtime (close host)

- **Area:** Stop
- **Fleet area:** composer-attention
- **Given:** an idle Durable Chat with saved transcript.
- **When:** call the stop-runtime API and reopen its history.
- **Then:** the host closes, history remains readable, and opening status/history alone starts no model turn; closing runtime is not deleting the Chat.
- **Legacy equivalence:** Preserve the behavior in `PSS:4151`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Delete the catalog entry on host close.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P012: stop-runtime retains catalog and history without another model request"

### AC-P013 — Inline image attachments in a prompt

- **Area:** Attachments
- **Fleet area:** composer-attention
- **Given:** an image-capable mock model and two named image attachments.
- **When:** attach images, reference them in a prompt and send.
- **Then:** chips/previews match the named references, the mock receives both image blocks in order, and the transcript contains one prompt with matching media references; invalid image input is rejected visibly.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionRoutes.ts:414; PWc/components/PromptEditor.ts:150`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Strip attachment blocks before provider submission.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P013 durable: two inline images reach the mock in order; invalid input rejects"; `e2e/durable/composer-attention/composer.spec.ts` › "AC-P013 legacy: two inline images reach the mock in order; invalid input rejects"; host: `packages/durable-pilot/test/composer.test.ts` › "attachments: an image reaches the model, survives a kill and a restart, queued ones show their count; attachment metadata is redacted before commit"

### AC-P014 — Save attachments to workspace folder

- **Area:** Attachments
- **Fleet area:** composer-attention
- **Given:** a workspace with a configured attachment folder and colliding filenames.
- **When:** choose Save to folder and submit the files.
- **Then:** returned workspace-relative links point to the advertised folder and original bytes; collisions do not overwrite files; traversal or symlink escape is rejected.
- **Legacy equivalence:** Preserve the behavior in `PSS:3395; PWs/attachmentService.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore the explicit folder sent by the composer.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P014: folder delivery preserves bytes and collisions; traversal and symlink escape reject"

### AC-P015 — Serve transcript/tool images (media route, gallery)

- **Area:** Media
- **Fleet area:** composer-attention
- **Given:** a committed prompt image and tool-produced image.
- **When:** open their previews and gallery, then request a media ID under a different Chat/workspace.
- **Then:** the correct images and gallery navigation work; foreign-scope lookup fails without leaking bytes.
- **Legacy equivalence:** Preserve the behavior in `PSS:2872; PWs/sessionMediaIndex.ts; PWc/components/ImageGalleryDialog.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after evidence/usage/media commit, reopen and inspect UI/API plus the fixture export. Committed history, usage and media references remain; export receipts prevent duplicate accounting. Recovery attempts are distinct; uncommitted samples need not survive.
- **Negative control:** Resolve media IDs without Chat/workspace ownership checks.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P015: media is scoped and survives host kill; gallery opens"

### AC-P016 — Model picker: list and switch

- **Area:** Models
- **Fleet area:** context-tools
- **Given:** mock Claude subscription and OpenAI codex models with fake login state.
- **When:** open the model picker, switch providers through the existing login surface and send a prompt on each.
- **Then:** the selected provider/model appears in status and each mock receives the matching request; unavailable/revoked auth blocks visibly without switching billing.
- **Legacy equivalence:** Preserve the behavior in `PSS:2990,3057; PWc/components/ModelPicker.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the model/effort choice commits, reopen and send a prompt. The recorded binding is restored before scheduling and reaches the correct mock; missing definitions/auth park work visibly rather than silently choosing a substitute.
- **Negative control:** Keep sending to Claude after selecting OpenAI.
- **Spec:** `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P016 AC-P019 models and thinking route to matching mock (Durable)"; `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P016 revoked fixture auth parks the recorded model without billing fallback"; `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P016 AC-P019 models and thinking route to matching mock (legacy)"; `e2e/durable/composer-attention/daily-controls.spec.ts` › "AC-P016 P019: model and effort selections survive SIGKILL and route the next prompt to Codex"; host: `packages/durable-pilot/test/chat-host.test.ts` › "model switching is per Chat, persisted, and applies to the next request"; `packages/durable-pilot/test/providers.test.ts` › "P016 models: the legacy provider set from Pi's auth.json"

### AC-P019 — Thinking level list / set

- **Area:** Thinking
- **Fleet area:** context-tools
- **Given:** a model with a known set of thinking levels.
- **When:** open the effort picker, select a supported level and try an unsupported level via API.
- **Then:** supported choices match the model; the selected level appears in status and provider payload; invalid input fails without changing the selection.
- **Legacy equivalence:** Preserve the behavior in `PSS:3086,3091; PWc/components/ModelEffortPicker.ts:2`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the model/effort choice commits, reopen and send a prompt. The recorded binding is restored before scheduling and reaches the correct mock; missing definitions/auth park work visibly rather than silently choosing a substitute.
- **Negative control:** Accept invalid levels or discard the selected effort.
- **Spec:** `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P016 AC-P019 models and thinking route to matching mock (Durable)"; `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P016 AC-P019 models and thinking route to matching mock (legacy)"; `e2e/durable/composer-attention/daily-controls.spec.ts` › "AC-P016 P019: model and effort selections survive SIGKILL and route the next prompt to Codex"; host: `packages/durable-pilot/test/composer.test.ts` › "thinking level: per Chat, validated, persisted, and restored before the first request after a kill"

### AC-P020 — Cycle thinking level

- **Area:** Thinking
- **Fleet area:** context-tools
- **Given:** a thinking-capable model and a non-thinking model.
- **When:** cycle effort through the API on each.
- **Then:** supported effort advances and wraps; the non-thinking model reports that cycling is unsupported.
- **Legacy equivalence:** Preserve the behavior in `PSS:3106`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Cycle a hardcoded list independent of model capability.
- **Spec:** `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P020 cycles supported thinking levels and wraps"

### AC-P022 — Tokens / cost / context meter

- **Area:** Usage
- **Fleet area:** context-tools
- **Given:** mock responses with known input/output/cache usage, price and context-window values.
- **When:** finish two turns and inspect the composer usage/context tooltip and status API.
- **Then:** token totals, cost and context utilization match recorded usage rather than message-position percentage; child/nested usage is not counted twice.
- **Legacy equivalence:** Preserve the behavior in `PWc/components/ConversationMeter.ts:2; PSS:2918`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after evidence/usage/media commit, reopen and inspect UI/API plus the fixture export. Committed history, usage and media references remain; export receipts prevent duplicate accounting. Recovery attempts are distinct; uncommitted samples need not survive.
- **Negative control:** Double-add the same completion usage.
- **Spec:** `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P022 exact usage totals and composer context (Durable)"; `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P022 exact usage totals and composer context (legacy)"; `e2e/durable/composer-attention/daily-controls.spec.ts` › "AC-P022: two known Codex usage completions are counted once and retained after host kill"; host: `packages/durable-pilot/test/chat-host.test.ts` › "status reports context usage from the last answer and the Chat's model window, as a legacy Chat shows it"

### AC-P023 — Cache-miss notices

- **Area:** Usage
- **Fleet area:** context-tools
- **Given:** cache-miss notices enabled and a paid mock turn missing at least 20,000 cached tokens or $0.10.
- **When:** finish the turn, inspect its notice, then reload.
- **Then:** the notice names tokens re-billed and model-switch/idle cause when applicable; below-threshold and aborted/error turns produce no notice.
- **Legacy equivalence:** Preserve the behavior in `PWs/cacheMissNotices.ts:12-32`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Disable cache-miss detection while retaining ordinary usage.
- **Spec:** `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P023 paid cache miss is visible and survives reload"

### AC-P027 — Unread catalog + acknowledge

- **Area:** Unread
- **Fleet area:** composer-attention
- **Given:** an unseen completed Durable turn.
- **When:** read the unread catalog, acknowledge its observed epoch/order, then acknowledge an older completion after a newer one arrives.
- **Then:** the badge clears only for the observed completion; stale acknowledgement cannot clear newer unread work.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionUnreadStore.ts:66; PSS:1444-1449`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Acknowledge by Chat ID alone.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P027 durable: stale unread acknowledgement cannot erase a newer completion"; `e2e/durable/composer-attention/attention.spec.ts` › "AC-P027 legacy: stale unread acknowledgement cannot erase a newer completion"

### AC-P028 — Per-Chat notification inbox, dismiss / dismiss-all

- **Area:** Notifications
- **Fleet area:** composer-attention
- **Given:** two retained per-Chat extension notifications and one arriving after an inbox snapshot.
- **When:** dismiss one, then dismiss all through the observed watermark.
- **Then:** only the selected/observed notifications disappear; the later one remains; another Chat's inbox is unchanged.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionNotificationStore.ts:85; PSS:1458`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Clear all notifications without checking watermark or Chat identity.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P028 durable: retain extension warnings; dismiss through observed watermark only"; `e2e/durable/composer-attention/attention.spec.ts` › "AC-P028 legacy: retain extension warnings; dismiss through observed watermark only"; host: `packages/durable-pilot/test/packages.test.ts` › "P028: a package's own warnings and errors reach PI WEB as retained notifications (redacted); its info notices do not"

### AC-P029 — Global attention notification for ask_user / request_attention

- **Area:** Notifications
- **Fleet area:** composer-attention
- **Given:** a background Durable Chat posting a question and a separate attention request.
- **When:** observe global attention and reopen the requesting Chat.
- **Then:** each committed request produces one identifiable notification targeting that Chat; ordinary turn completion produces no attention notification.
- **Legacy equivalence:** Preserve the behavior in `PSS:2100-2106; PWc/components/SessionNotificationTray.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill with a committed request and again after exact-ID acknowledgement, then reopen. The latest unacknowledged request remains; an acknowledged one never re-notifies. A stale acknowledgement cannot clear a newer request.
- **Negative control:** Notify on every agent_end or ignore request-ID deduplication.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P029 P038: background attention has exact IDs; stale ack and host kills preserve latest request"

### AC-P030 — Activity indicator (running/idle, per-tool labels, compacting, bash running)

- **Area:** Activity
- **Fleet area:** composer-attention
- **Given:** a scripted turn with model streaming, a named tool, compaction and shell activity.
- **When:** watch the activity indicator through each phase.
- **Then:** labels distinguish running, tool activity, compacting, bash-running, idle and errors; activity does not remain busy after terminal completion.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionActivityMarker.ts; PSS publishActivity`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Hardcode isCompacting/isBashRunning to false.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P030: activity distinguishes streaming, tool and idle"

### AC-P031 — Auto title + /name

- **Area:** Naming
- **Fleet area:** composer-attention
- **Given:** an unnamed Durable Chat and scripted title-generation output.
- **When:** send the first substantive prompt, then rename with /name and send more prompts.
- **Then:** a short generated title appears in the catalog; /name applies the explicit title and later automatic naming cannot overwrite it.
- **Legacy equivalence:** Preserve the behavior in `PWs/sessionNameGenerator.ts:40; SCS:111`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Overwrite a manual title with a late automatic result.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P031: first prompt gets generated title; /name remains authoritative"; `e2e/durable/composer-attention/attention.spec.ts` › "AC-P031: manual /name survives later prompts and host kill"; host: `packages/durable-pilot/test/chat-host.test.ts` › "P031 complete: PI WEB's Chat title request goes to the Chat's model outside the conversation; nothing is committed or scheduled"

### AC-P032 — /workstream-checkpoint-title

- **Area:** Workstreams
- **Fleet area:** composer-attention
- **Given:** a Workstream checkpoint carrying sessionTitle.
- **When:** deliver /workstream-checkpoint-title and refresh the Chat catalog.
- **Then:** the checkpoint title is applied with checkpoint provenance and is not replaced by ordinary auto-naming; manual-title precedence is retained.
- **Legacy equivalence:** Preserve the behavior in `PSS:3469-3473,6483`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Treat the internal command as an ordinary model prompt.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P032: checkpoint title command is recognized without model admission"

### AC-P033 — Workstream launch token / continuation into a Chat

- **Area:** Workstreams
- **Fleet area:** composer-attention
- **Given:** a continuation targeting a persistent workspace and stable launch token.
- **When:** launch the Durable Chat and look up the token, including a repeated confirmation.
- **Then:** the same Chat/workspace is returned; an OS-temporary continuation is rejected before session.pending is recorded.
- **Legacy equivalence:** Preserve the behavior in `PSS:1720; PWs/workstreamLaunchStore.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after pending launch/confirmation boundaries, reopen and retry with the original token. The separate Workstream Store keeps one binding/home and existing checkpoints; recovery creates no extra Chat, checkpoint or Human Task.
- **Negative control:** Record pending state before workspace validation.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P033: Durable launch token resolves the same Chat without a duplicate"

### AC-P034 — Runtime identity env for tools/CLI (PI_SESSION_ID, PI_TMP)

- **Area:** Workstreams
- **Fleet area:** extensions-packages
- **Given:** a Durable lead and two child tool environments.
- **When:** run a fixture command that reports only PI_SESSION_ID and PI_TMP.
- **Then:** each result identifies its own Chat/conversation-scoped environment and scratch directory, not another child's values; no fake coding-agent JSONL path is advertised.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/index.ts:15,61; PW/server/sessiond/agentProcessEnvironment.ts:10`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Share a mutable process-global child environment.
- **Spec:** `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P034 lead tools and fixture Workstreams CLI identify the Durable Chat"; `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P034 AC-P085 child environments are distinct and never borrow the lead identity"; host: `packages/durable-pilot/test/extensions-host.test.ts` › "P034 tools see the Chat's runtime identity, and the Workstreams CLI on PATH resolves this Durable Chat"; `packages/durable-pilot/test/extensions-host.test.ts` › "P034/P085 a child conversation gets its own identity and PI_TMP; the host process environment is untouched"

### AC-P037 — ask_user tool + AskUserCard submit/cancel

- **Area:** Questions
- **Fleet area:** composer-attention
- **Given:** a mock calling ask_user with two questions.
- **When:** open chips, submit one answer leaving the other unanswered; repeat with cancel, revise and withdraw.
- **Then:** posting returns immediately; revised chips retain the ask ID; submit/cancel closes the set and delivers one system-authored follow-up naming unanswered items; withdrawal removes it without an answer delivery; stale revisions are rejected.
- **Legacy equivalence:** Preserve the behavior in `PWs/askUserTool.ts:137; PSS:2081-2155`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill before/after question commit, after answer commit before delivery, and after delivery before receipt. Reopen: one open revision or one closed outcome returns; an undelivered answer is submitted once and a stale answer cannot close a newer revision.
- **Negative control:** Restore a stale form over a revised question.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P037 durable: questions return immediately; partial answer closes once and names unanswered items"; `e2e/durable/composer-attention/attention.spec.ts` › "AC-P037: revision rejects stale answers; cancel delivers once; withdraw delivers none"; `e2e/durable/composer-attention/attention.spec.ts` › "AC-P037 legacy: questions return immediately; partial answer closes once and names unanswered items"; host: `packages/durable-pilot/test/chat-host.test.ts` › "crash row question: an open set survives a kill, a stale answer is refused, one answer is delivered once, a retried answer returns the same outcome"

### AC-P038 — request_attention tool + acknowledge

- **Area:** Questions
- **Fleet area:** composer-attention
- **Given:** a mock posting attention reason A then reason B.
- **When:** acknowledge A after B exists, then acknowledge B.
- **Then:** the tool returns immediately without a question card; B remains after the stale acknowledgement and clears only when B is acknowledged.
- **Legacy equivalence:** Preserve the behavior in `PWs/requestAttentionTool.ts:25; PSS:2100-2106`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill with a committed request and again after exact-ID acknowledgement, then reopen. The latest unacknowledged request remains; an acknowledged one never re-notifies. A stale acknowledgement cannot clear a newer request.
- **Negative control:** Clear the latest request regardless of requested ID.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P029 P038: background attention has exact IDs; stale ack and host kills preserve latest request"; host: `packages/durable-pilot/test/chat-host.test.ts` › "request_attention persists across a kill, notifies once, and clears only by its exact ID or a new message"

### AC-P039 — Open-questions reminder riding each user prompt

- **Area:** Questions
- **Fleet area:** composer-attention
- **Given:** two open question sets.
- **When:** send successive unrelated user prompts, then close the sets and send again.
- **Then:** each mock request gets one reminder line per still-open set without an extra visible user message; no reminder is added when none remain.
- **Legacy equivalence:** Preserve the behavior in `PSS:3270-3277`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after prompt admission before reminder delivery, then reopen. Restored open questions yield one reminder per set in that prompt context, never a duplicate admitted prompt or a newly fabricated question.
- **Negative control:** Add reminders only when answering a question.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P039: each prompt gets one reminder per open set, none after closure, including host reopen"; host: `packages/durable-pilot/test/chat-host.test.ts` › "open-questions reminder: a plain prompt carries PI WEB's reminder of the persisted open sets once, hidden from the transcript, across a kill"

### AC-P040 — Question chips + 'may be stale' turn counting

- **Area:** Questions
- **Fleet area:** composer-attention
- **Given:** open questions from two sets.
- **When:** advance turns, open a chip, revise/confirm a set and close it.
- **Then:** chips are oldest-set-first, counts reflect individual questions, the drawer shows context/options, the sixth agent turn without an update yields the may-be-stale indication (not the fifth) and confirmation resets age; closed sets disappear.
- **Legacy equivalence:** Preserve the behavior in `PWc/components/WorkbenchQuestionChips.ts:2`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Never advance the question turn counter.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P040: chips count individual questions, stale begins at six turns, confirmation resets age"

### AC-P041 — Extension statuses in status bar

- **Area:** Extensions UI
- **Fleet area:** extensions-packages
- **Given:** a supported extension publishing and then clearing a status.
- **When:** inspect the status API (`extensionStatuses` projection).
- **Then:** the status projection carries the extension's current value once, updates replace it, and clearing removes it without disturbing Working Mode or other extensions. Neither runtime renders arbitrary extension statuses in a generic status UI, so none is required.
- **Correction (2026-10-22):** parity is the status projection only; a generic status UI would be a new feature for both runtimes.
- **Legacy equivalence:** Preserve the behavior in `PSS (extensionStatuses); PWc/components/StatusBar.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Project only the working-mode status key.
- **Spec:** `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P041 extension status appears, updates and clears without losing Working Mode"; host: `packages/durable-pilot/test/packages.test.ts` › "P041: a package's ctx.ui.setStatus shows in the Chat status, updates and clears; Working Mode's own status stays the host's"

### AC-P044 — Session tree navigator / navigate (/tree)

- **Area:** History
- **Fleet area:** bash-atelier-tree
- **Given:** a retained multi-branch history with branch-specific questions.
- **When:** open /tree and navigate to a prior branch using its expected leaf.
- **Then:** the active path and transcript change without erasing later history, branch-appropriate questions return, and stale revisions or active children/queued work block navigation.
- **Legacy equivalence:** Preserve the behavior in `PSS:3483; SCS:116; PWc/components/SessionTreeNavigator.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore expectedLeafId.
- **Spec:** `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 AC-P046 Durable: /tree and Edit & resend continue without erasing branches"; `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 stale expectedLeafId refuses navigation without changing the active branch [negative-control]"; `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 questions and Working Mode restore as-of branch and survive SIGKILL"; `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 running bash and open Atelier Page carry to the new branch; pending completion blocks navigation"; `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 AC-P046 active generation disables Edit & resend and refuses queued navigation"; `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 navigation refuses an active child and its pending delivery"; +1 more tagged P044 in `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts`; host: `packages/durable-pilot/test/tree.test.ts` › "tree: going back keeps later history, forks once, reselects a retained branch, and the branch map survives a kill"; `packages/durable-pilot/test/tree.test.ts` › "tree: navigation is refused visibly while a turn, queued input or interrupted work is pending"

### AC-P046 — 'Go back to this message' action

- **Area:** History
- **Fleet area:** bash-atelier-tree
- **Given:** a quiescent Chat with a selectable earlier user message.
- **When:** choose Go back to this message.
- **Then:** the same public Chat selects the prior history position and returns the editable prompt as appropriate; later history is retained and busy/archive states disable the action.
- **Legacy equivalence:** Preserve the behavior in `PWc/plugins/core/messageActions.ts:21`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Erase later history rather than selecting a retained branch.
- **Spec:** `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 AC-P046 Durable: /tree and Edit & resend continue without erasing branches"; `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 AC-P046 active generation disables Edit & resend and refuses queued navigation"; `e2e/durable/bash-atelier-tree/tree-navigation.spec.ts` › "AC-P044 AC-P046 legacy: /tree and Edit & resend continue without erasing branches"; host: `packages/durable-pilot/test/tree.test.ts` › "tree: going back keeps later history, forks once, reselects a retained branch, and the branch map survives a kill"

### AC-P047 — Copy message, reply-to-selection quotes

- **Area:** Transcript
- **Fleet area:** composer-attention
- **Given:** a visible assistant message with selectable text.
- **When:** copy the message and reply to a selected passage.
- **Then:** clipboard text matches the message and the composer receives the selected quote with its source association, without changing the transcript.
- **Legacy equivalence:** Preserve the behavior in `PWc/plugins/core/messageActions.ts:27; PWc/components/ChatView.ts:229`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Copy rendered markup instead of message text.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P047: copy uses plain text and selection quote populates composer only"

### AC-P048 — Draft persistence

- **Area:** Composer
- **Fleet area:** composer-attention
- **Given:** two Durable Chats with distinct unsent composer text.
- **When:** switch Chats and reload the browser.
- **Then:** each saved draft returns only to its own Chat and no provider request is made until Send.
- **Legacy equivalence:** Preserve the behavior in `PWc/components/PromptEditor.ts:94`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Wait for client draft persistence, kill the host and reload/reopen the same Chat. Only the client-saved draft returns; unsaved browser memory is not promised. No draft is admitted or sent automatically.
- **Negative control:** Key drafts only by workspace instead of Chat.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P048: per-Chat drafts persist across switch, browser reload and host kill without admission"

### AC-P049 — Edit tool diff preview

- **Area:** Tools UI
- **Fleet area:** context-tools
- **Given:** a mock edit replacing a unique line in a fixture file.
- **When:** expand the edit tool while execution is held after preview.
- **Then:** the old/new diff is visible before the final result and corresponds to the eventual file change; failure does not show a successful edit.
- **Legacy equivalence:** Preserve the behavior in `PSS:1124-1143`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Remove preview details from tool updates.
- **Spec:** `e2e/durable/context-tools/core-tools.spec.ts` › "AC-P049 edit exposes old/new preview while the model continues"; host: `packages/durable-pilot/test/context-tools.test.ts` › "edit shows its old/new preview (PI WEB's details.preview) before the result, as the legacy edit tool does"

### AC-P050 — Unsupported controls blocked visibly (capability negotiation per control)

- **Area:** Chat core
- **Fleet area:** composer-attention
- **Given:** capability responses disabling queue mutation, history or another control.
- **When:** open the Durable Chat and attempt the corresponding direct API operation.
- **Then:** unsupported controls are hidden or disabled with an explanation; direct requests fail explicitly and cause no mutation; supported controls remain usable.
- **Legacy equivalence:** Parent plan capability negotiation strengthens the legacy error path: hidden/disabled controls, never silent success.
- **Negative control:** Render enabled controls while silently dropping requests.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P050: unsupported fork/archive hidden and API rejects without mutation"

### AC-P051 — Interrupted unsafe tool resolution (Durable-only, no legacy equivalent)

- **Area:** Chat core
- **Fleet area:** composer-attention
- **Given:** an unsafe fixture effect completed externally but killed before its result commits.
- **When:** reopen the Chat and inspect Unresolved Effects, then resolve as done, not done or explicitly retry in separate cases.
- **Then:** output/uncertainty remain visible; status/history reads do not schedule mutations; both replay and a fresh model-proposed duplicate stay blocked until reconciliation; only explicit retry can perform another attempt.
- **Legacy equivalence:** Durable-only safety requirement; no legacy equivalent. Parent plan unsafe-effect reconciliation governs this row.
- **Survival:** Kill after the external effect but before result commit and reopen twice. The unresolved intent remains visible and blocks replay/new duplicate mutation until resolution; after recording done/not-done, reopening does not repeat the effect. Count any explicitly authorized retry separately.
- **Negative control:** Allow a fresh call to bypass an unresolved intent.
- **Spec:** `e2e/durable/composer-attention/attention.spec.ts` › "AC-P051: interrupted write remains unresolved after two reopens until done"; `e2e/durable/composer-attention/attention.spec.ts` › "AC-P051: interrupted write remains unresolved after two reopens until not-done"; `e2e/durable/composer-attention/attention.spec.ts` › "AC-P051: interrupted write remains unresolved after two reopens until retry"; `e2e/durable/context-tools/recovery.spec.ts` › "AC-P051 interrupted external write resolved Done without implicit replay"; `e2e/durable/context-tools/recovery.spec.ts` › "AC-P051 interrupted external write resolved Not done without implicit replay"; `e2e/durable/context-tools/recovery.spec.ts` › "AC-P051 interrupted external write resolved Retry without implicit replay"; +1 more tagged P051 in `e2e/durableChat.spec.ts`; host: `packages/durable-pilot/test/chat-host.test.ts` › "crash row tools: an interrupted unsafe write never reruns and blocks a new write; safe read still runs"; `packages/durable-pilot/test/chat-host.test.ts` › "resolve: the owner marks an interrupted write retry; it is recorded, the model is told once, and write runs again"

### AC-P053 — /compact [instructions]

- **Area:** Commands
- **Fleet area:** context-tools
- **Given:** a long Durable Chat and mock summarizer.
- **When:** run /compact with focus instructions, then send another prompt; separately cancel/fail compaction.
- **Then:** one canonical summary is visible and reaches subsequent context with the focus applied; progress clears; cancellation/failure is visible without a false successful summary.
- **Legacy equivalence:** Preserve the behavior in `SCS:112; PWs/piSessionService.compaction.test.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill before summary placement, after placement before continuation, and after continuation admission before receipt; reopen at each barrier. One placed summary and at most one authorized continuation appear, held human/child input retains order, and explicit cancellation/failure cannot become successful compaction. Working Mode is reattached once for the restored context.
- **Negative control:** Report compaction success before summary placement.
- **Spec:** `e2e/durable/context-tools/compaction.spec.ts` › "AC-P053 focus summary reaches next context (Durable)"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P053 compaction cancel clears progress without a success summary"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P053 compaction fail clears progress without a success summary"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P053 manual summary killed before placement resumes once without read-triggered work"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P053 focus summary reaches next context (legacy)"; host: `packages/durable-pilot/test/context-tools.test.ts` › "/compact with instructions: one summary placed, full history kept around it, the Working Mode block re-attached on the next prompt"

### AC-P055 — Command list / autocomplete

- **Area:** Commands
- **Fleet area:** composer-attention
- **Given:** supported built-ins, extension commands, prompt templates and skills installed in the isolated profile.
- **When:** type slash prefixes and choose an autocomplete item.
- **Then:** the sorted catalog exposes names, descriptions, sources and argument hints; selection invokes/expands the matching resource; unsupported commands are not presented as working.
- **Legacy equivalence:** Preserve the behavior in `PSS:3117-3138; PWc/components/AutocompleteMenu.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Populate autocomplete from a stale static list.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P055 P057: command catalog and autocomplete expose installed templates; both expand arguments"

### AC-P056 — /skill:name + inline skill mentions

- **Area:** Commands
- **Fleet area:** composer-attention
- **Given:** a known skill fixture with a relative reference and an unknown skill name.
- **When:** send a leading /skill:name and repeated inline mentions.
- **Then:** the mock sees the skill body and base-directory guidance once per skill; the transcript reconciles to one expanded prompt; unknown or unreadable mentions remain literal.
- **Legacy equivalence:** Preserve the behavior in `PSS:3135-3137; PWs/inlineSkills.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Expand every repeated inline mention.
- **Spec:** `e2e/durable/composer-attention/composer.spec.ts` › "AC-P056 durable: leading and repeated inline skills expand once; unknown remains literal"; `e2e/durable/composer-attention/composer.spec.ts` › "AC-P056 legacy: leading and repeated inline skills expand once; unknown remains literal"; `e2e/durable/context-tools/resources.spec.ts` › "AC-P108 P056 skill catalog and leading/inline expansion (Durable)"; `e2e/durable/context-tools/resources.spec.ts` › "AC-P108 P056 skill catalog and leading/inline expansion (legacy)"

### AC-P058 — ! / !! shell commands

- **Area:** Shell
- **Fleet area:** bash-atelier-tree
- **Given:** a workspace command printing a marker and an idle Chat.
- **When:** send !command and !!command in separate cases, then an ordinary prompt.
- **Then:** both show streamed shell output and exit status; only the single-bang execution enters model context; empty commands and concurrent shell execution fail visibly.
- **Legacy equivalence:** Preserve the behavior in `PSS:3422; PWc/controllers/sessionController.ts:583-586`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Include double-bang output in provider context.
- **Spec:** `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P058 Durable: ! enters context, !! stays out, invalid and concurrent shell rejected"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P058 legacy: ! enters context, !! stays out, invalid and concurrent shell rejected"; `e2e/durable/composer-attention/daily-controls.spec.ts` › "AC-P058: ! is included in next model context; !! is excluded; host reopen never re-executes shell"; host: `packages/durable-pilot/test/composer.test.ts` › "shell: !cmd runs in the workspace, streams, is recorded redacted and reaches the model; !!cmd is recorded but excluded"; `packages/durable-pilot/test/composer.test.ts` › "shell: one command at a time, Stop cancels it, and a command during a run is recorded after the run"

### AC-P068 — read

- **Area:** Tools
- **Fleet area:** context-tools
- **Given:** a workspace text file, large file and image fixture.
- **When:** ask the mock to call read with path, offset and limit.
- **Then:** the tool card shows the requested lines/image, bounded truncation guidance and useful missing-file errors.
- **Legacy equivalence:** Preserve the behavior in `Pi built-in`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after read intent and after result commit in separate cases, then reopen. A committed result is reused; an interrupted read reruns only when recorded and current policies both mark it safe. UI identifies the recovered attempt rather than a second user request.
- **Negative control:** Ignore offset/limit.
- **Spec:** `e2e/durable/context-tools/core-tools.spec.ts` › "AC-P068 read lines, truncation, image and missing-file errors (Durable)"; `e2e/durable/context-tools/core-tools.spec.ts` › "AC-P068 read lines, truncation, image and missing-file errors (legacy)"

### AC-P069 — write

- **Area:** Tools
- **Fleet area:** context-tools
- **Given:** a missing nested file and an existing fixture file.
- **When:** call write to create and then overwrite them.
- **Then:** tool results report success only after the requested bytes exist at the cwd-relative path; parent directories are created and write errors are visible.
- **Legacy equivalence:** Preserve the behavior in `Pi built-in`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after a fixture mutation or shell side effect but before result commit, then reopen. Retained output and interrupted/unknown state are shown; unsafe work is not rerun and its external counter remains one. Finished results are reused; only stored-and-current safe policy permits automatic replay.
- **Negative control:** Return success before filesystem failure is known.
- **Spec:** `e2e/durable/context-tools/core-tools.spec.ts` › "AC-P069 AC-P070 AC-P071 write/edit/bash effects and errors (Durable)"; `e2e/durable/context-tools/core-tools.spec.ts` › "AC-P069 AC-P070 AC-P071 write/edit/bash effects and errors (legacy)"

### AC-P070 — edit

- **Area:** Tools
- **Fleet area:** context-tools
- **Given:** a file with unique, ambiguous and overlapping match fixtures.
- **When:** call edit with disjoint replacements, then invalid matches.
- **Then:** one successful result reflects all replacements against the original file; ambiguous/overlapping edits fail without partially changing the file.
- **Legacy equivalence:** Preserve the behavior in `Pi built-in + PSS:1124`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after a fixture mutation or shell side effect but before result commit, then reopen. Retained output and interrupted/unknown state are shown; unsafe work is not rerun and its external counter remains one. Finished results are reused; only stored-and-current safe policy permits automatic replay.
- **Negative control:** Apply each replacement against the already-edited buffer.
- **Spec:** `e2e/durable/context-tools/core-tools.spec.ts` › "AC-P069 AC-P070 AC-P071 write/edit/bash effects and errors (Durable)"; `e2e/durable/context-tools/core-tools.spec.ts` › "AC-P069 AC-P070 AC-P071 write/edit/bash effects and errors (legacy)"

### AC-P071 — bash (foreground)

- **Area:** Tools
- **Fleet area:** bash-atelier-tree
- **Given:** a short foreground shell fixture and a cancellable long-running fixture.
- **When:** call foreground bash and stop the long-running call.
- **Then:** stdout/stderr, non-zero exit and truncation are shown truthfully; cancellation is not success; a lead foreground wait exceeding 30 seconds hands off one background job rather than relaunching.
- **Legacy equivalence:** Preserve the behavior in `Pi built-in; overridden by background-bash WBe/background-bash/index.ts:39`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after a fixture mutation or shell side effect but before result commit, then reopen. Retained output and interrupted/unknown state are shown; unsafe work is not rerun and its external counter remains one. Finished results are reused; only stored-and-current safe policy permits automatic replay.
- **Negative control:** Treat any exited shell as successful.
- **Spec:** `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 Durable foreground stdout/stderr and nonzero exit remain an error, not a completion"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 Durable foreground waits 30 seconds then hands off the same job once"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.intent: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.spawned: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.admitted: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 Stop cancels a foreground wait; host SIGKILL leaves the runner alive"; +4 more tagged P071 in `e2e/durable/bash-atelier-tree/bash.spec.ts`, `e2e/durable/context-tools/core-tools.spec.ts`; host: `packages/durable-pilot/test/background-bash.test.ts` › "P071 foreground waits for the output inline; a failing exit is an error result; no completion follows"; `packages/durable-pilot/test/background-bash.test.ts` › "P071/P078 a foreground wait over 30 seconds hands off the same job, launched once; its completion follows once"

### AC-P073 — Tool activity status/widget

- **Area:** Ext: activity
- **Fleet area:** extensions-packages
- **Given:** a Durable Chat running a shell and delegated work with self-reported status.
- **When:** watch Activity through start, update and completion.
- **Then:** live task/tool activity updates and disappears when finished; inferred activity and the delegate's own reported status remain distinguishable; no TUI widget is required.
- **Legacy equivalence:** Preserve the behavior in `WBe/activity/index.ts:8-23; WBe/activity/activity.mjs:32,39`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Keep only agent-start/end activity.
- **Spec:** `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P073 shell activity updates then clears at the actual tool boundary"; `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P073 delegate self-report remains distinct from inferred tool activity"; host: `packages/durable-pilot/test/background-bash.test.ts` › "P073 one foreground bash is one Activity shell: its job names the running call, so PI WEB shows it once; nothing once it ends"; `packages/durable-pilot/test/extensions-host.test.ts` › "P073 activity: a running bash call shows in the Chat's shell activity and leaves it when it ends"

### AC-P075 — atelier tool (open/takeover/update/ask/answer/status/check)

- **Area:** Ext: atelier
- **Fleet area:** bash-atelier-tree
- **Given:** a valid Atelier Page fixture and two candidate receivers.
- **When:** use open, update, ask, answer, status, check and generation-checked takeover.
- **Then:** the Chat links a working Page; revision, decisions, comment answers, request state and check results are observable; stale takeover is rejected and only the current receiver owns delivery.
- **Legacy equivalence:** Preserve the behavior in `WBe/atelier/index.ts:70-80`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at Event Log append, admission and acknowledgement boundaries, then reopen the host and Page. The Page/Event Log remain authoritative; the server safely reclaims a generation-checked receiver with unchanged access scope. Only unacknowledged, non-undone events past their undo deadlines deliver once; stale receivers and late answers cannot duplicate effects.
- **Negative control:** Allow takeover with an old generation.
- **Spec:** `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 Durable Comment and Decision reach Chat once; answer, ask, update and request status reach the Page"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 check measures the valid Page rather than reporting unchecked"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 SIGKILL at append: same Page port and one delivery after reopen"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 SIGKILL at atelier.admitted: same Page port and one delivery after reopen"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 SIGKILL at atelier.received: same Page port and one delivery after reopen"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 legacy Comment and Decision reach Chat once; answer, ask, update and request status reach the Page"; host: `packages/durable-pilot/test/atelier.test.ts` › "P075/P076 open links a served Page; a human Comment reaches the Chat once after its undo window; ask, answer, status, update and check act on the Event Log"; `packages/durable-pilot/test/atelier.test.ts` › "P075 check measures the Page in a real browser: the Chat's PI_TMP holds its report, and a session-scoped TMPDIR leaves the browser socket working"

### AC-P076 — Atelier delivery hooks (human input → sendMessage)

- **Area:** Ext: atelier
- **Fleet area:** bash-atelier-tree
- **Given:** an open Atelier Page with an undoable human event.
- **When:** submit, undo one event before its deadline, and submit another while the Chat is busy.
- **Then:** only the committed non-undone event reaches the Chat as one follow-up after its undo deadline; a busy turn is not split and takeover does not send to the old receiver.
- **Legacy equivalence:** Preserve the behavior in `WBe/atelier/index.ts:47,61-68,103`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at Event Log append, admission and acknowledgement boundaries, then reopen the host and Page. The Page/Event Log remain authoritative; the server safely reclaims a generation-checked receiver with unchanged access scope. Only unacknowledged, non-undone events past their undo deadlines deliver once; stale receivers and late answers cannot duplicate effects.
- **Negative control:** Acknowledge an event before durable admission.
- **Spec:** `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 Durable Comment and Decision reach Chat once; answer, ask, update and request status reach the Page"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P076 Durable Undo suppresses delivery; busy Chat receives exactly one follow-up after its turn"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 SIGKILL at append: same Page port and one delivery after reopen"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 SIGKILL at atelier.admitted: same Page port and one delivery after reopen"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 SIGKILL at atelier.received: same Page port and one delivery after reopen"; `e2e/durable/bash-atelier-tree/atelier.spec.ts` › "AC-P075 AC-P076 legacy Comment and Decision reach Chat once; answer, ask, update and request status reach the Page"; +1 more tagged P076 in `e2e/durable/bash-atelier-tree/atelier.spec.ts`; host: `packages/durable-pilot/test/atelier.test.ts` › "P075/P076 open links a served Page; a human Comment reaches the Chat once after its undo window; ask, answer, status, update and check act on the Event Log"; `packages/durable-pilot/test/atelier.test.ts` › "P076 a Comment arriving while the Chat is busy is one follow-up after the run, never inside it"; `packages/durable-pilot/test/atelier.test.ts` › "P076 human input is redacted before it is committed; the Event Log keeps what the human wrote"

### AC-P078 — bash (background by default, job ID)

- **Area:** Ext: background-bash
- **Fleet area:** bash-atelier-tree
- **Given:** an attended Durable Chat and a shell fixture recording launch count.
- **When:** call bash without foreground, then with foreground and a long-running command.
- **Then:** a job ID/log link returns promptly by default; foreground waits at most 30 seconds before returning the same job ID; timeout/12-hour ceiling is enforced and a job ID is not reported as success.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/index.ts:39-88`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after launch intent, spawn and completion admission in separate cases, then reopen. Reattach a still-live runner only by verified process identity; retain job ID/log/cancellation and one completion receipt. A missing/dead runner shows interrupted or unknown exit, never an automatic arbitrary-command relaunch; the launch counter stays one.
- **Negative control:** Spawn twice when the foreground wait times out.
- **Spec:** `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P078 AC-P081 Durable default background returns before completion; one bounded card opens its full log"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 Durable foreground waits 30 seconds then hands off the same job once"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P078 Durable timeout reports failure rather than success"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.intent: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.spawned: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.admitted: one effect and one completion after reopen"; +5 more tagged P078 in `e2e/durable/bash-atelier-tree/bash.spec.ts`; host: `packages/durable-pilot/test/background-bash.test.ts` › "P078/P081 bash runs in the background by default: a job ID returns at once, one completion with the exit and output wakes the Chat"; `packages/durable-pilot/test/background-bash.test.ts` › "P071/P078 a foreground wait over 30 seconds hands off the same job, launched once; its completion follows once"; `packages/durable-pilot/test/background-bash.test.ts` › "P078 a timeout stops the job and its completion reports it; output over the inline limit discloses truncation"

### AC-P079 — bash_status

- **Area:** Ext: background-bash
- **Fleet area:** bash-atelier-tree
- **Given:** two owned background jobs and a foreign Chat's job.
- **When:** call bash_status with no ID and with one ID.
- **Then:** the tool reports only matching session-owned job state, elapsed time, byte count and log path without waiting for completion.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/index.ts:89`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after launch intent, spawn and completion admission in separate cases, then reopen. Reattach a still-live runner only by verified process identity; retain job ID/log/cancellation and one completion receipt. A missing/dead runner shows interrupted or unknown exit, never an automatic arbitrary-command relaunch; the launch counter stays one.
- **Negative control:** Return every machine job regardless of owner.
- **Spec:** `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P079 AC-P080 AC-P081 Durable status and cancel respect ownership; cancelled completion never wakes a turn"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.intent: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.spawned: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.admitted: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P078 AC-P079 AC-P081 lost runner reports unknown exit and never relaunches"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P079 AC-P080 AC-P081 legacy status and cancel respect ownership; cancelled completion never wakes a turn"; host: `packages/durable-pilot/test/background-bash.test.ts` › "P079/P080 bash_status lists only this Chat's jobs; bash_cancel stops only an owned job, which does not wake the Chat"

### AC-P080 — bash_cancel

- **Area:** Ext: background-bash
- **Fleet area:** bash-atelier-tree
- **Given:** one owned background job and an unrelated process.
- **When:** call bash_cancel for the job and for an unknown/foreign ID.
- **Then:** only the owned job receives cancellation; result/status distinguish requested, cancelled and unknown; the unrelated process remains alive.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/index.ts:98`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after launch intent, spawn and completion admission in separate cases, then reopen. Reattach a still-live runner only by verified process identity; retain job ID/log/cancellation and one completion receipt. A missing/dead runner shows interrupted or unknown exit, never an automatic arbitrary-command relaunch; the launch counter stays one.
- **Negative control:** Cancel by an unverified PID alone.
- **Spec:** `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P079 AC-P080 AC-P081 Durable status and cancel respect ownership; cancelled completion never wakes a turn"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.intent: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.spawned: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.admitted: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P079 AC-P080 AC-P081 legacy status and cancel respect ownership; cancelled completion never wakes a turn"; host: `packages/durable-pilot/test/background-bash.test.ts` › "P079/P080 bash_status lists only this Chat's jobs; bash_cancel stops only an owned job, which does not wake the Chat"

### AC-P081 — Completion message, status, bash log button

- **Area:** Ext: background-bash
- **Fleet area:** bash-atelier-tree
- **Given:** a background job emitting more than the inline limit.
- **When:** let it finish and open the bash log button.
- **Then:** one completion shows actual exit/state and bounded output with truncation disclosed; the log opens for inspection and copy; cancelled completion does not wake a new turn.
- **Legacy equivalence:** Preserve the behavior in `WBe/background-bash/jobs.mjs:100; index.ts:31,108-112; PWc/components/BashLogButton.ts:2`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after launch intent, spawn and completion admission in separate cases, then reopen. Reattach a still-live runner only by verified process identity; retain job ID/log/cancellation and one completion receipt. A missing/dead runner shows interrupted or unknown exit, never an automatic arbitrary-command relaunch; the launch counter stays one.
- **Negative control:** Mark completion delivered before admission or omit the truncation note.
- **Spec:** `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P078 AC-P081 Durable default background returns before completion; one bounded card opens its full log"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P079 AC-P080 AC-P081 Durable status and cancel respect ownership; cancelled completion never wakes a turn"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.intent: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.spawned: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P071 AC-P078 AC-P079 AC-P080 AC-P081 SIGKILL at bash.admitted: one effect and one completion after reopen"; `e2e/durable/bash-atelier-tree/bash.spec.ts` › "AC-P078 AC-P079 AC-P081 lost runner reports unknown exit and never relaunches"; +2 more tagged P081 in `e2e/durable/bash-atelier-tree/bash.spec.ts`; host: `packages/durable-pilot/test/background-bash.test.ts` › "P078/P081 bash runs in the background by default: a job ID returns at once, one completion with the exit and output wakes the Chat"; `packages/durable-pilot/test/background-bash.test.ts` › "P081 output is redacted in the tool result, the completion and the store; the log keeps the raw output"; `packages/durable-pilot/test/background-bash.test.ts` › "P081 a running job's Activity preview never publishes the start of a credential; a secret across the retained-tail cut leaves no suffix"

### AC-P082 — compact_and_continue tool

- **Area:** Ext: context-checkpoint
- **Fleet area:** context-tools
- **Given:** a completed phase and a mock compaction barrier.
- **When:** call compact_and_continue alone with summaryFocus and nextPhase, then test a sibling-tool batch.
- **Then:** one next-phase prompt is delivered only after the summary is placed; a sibling batch or oversized/empty directive is rejected; a failed summary starts exactly one continuation carrying the failure diagnostic, as legacy does; cancellation never starts the next phase.
- **Correction (2026-10-22):** legacy compact_and_continue continues once with a diagnostic after a failed summary; parity follows legacy. Cancellation still means no continuation.
- **Legacy equivalence:** Preserve the behavior in `WBe/context-checkpoint/index.ts:57-130`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill before summary placement, after placement before continuation, and after continuation admission before receipt; reopen at each barrier. One placed summary and at most one authorized continuation appear, held human/child input retains order, explicit cancellation admits no continuation, and a failed summary yields exactly one continuation with its diagnostic, never a successful-compaction claim. Working Mode is reattached once for the restored context.
- **Negative control:** Trigger continuation on compaction-start rather than placed-summary receipt.
- **Spec:** `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 AC-P103 exactly one continuation and mode reattach; kill none"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 AC-P103 exactly one continuation and mode reattach; kill summarizing"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 AC-P103 exactly one continuation and mode reattach; kill continuation"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 cancelling checkpoint summary admits no continuation even after host kill"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 rejects batch checkpoint directives without continuation"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 rejects empty checkpoint directives without continuation"; +2 more tagged P082 in `e2e/durable/context-tools/compaction.spec.ts`; host: `packages/durable-pilot/test/context-tools.test.ts` › "compact_and_continue: the run ends, the summary is placed, then exactly one continuation starts the next phase with the Working Mode block"; `packages/durable-pilot/test/context-tools.test.ts` › "compact_and_continue refuses a sibling tool batch and schedules nothing"; `packages/durable-pilot/test/context-tools.test.ts` › "compact_and_continue: a failed compaction still continues once, with the diagnostic"; `packages/durable-pilot/test/context-tools.test.ts` › "compact_and_continue: Esc during the compaction cancels it visibly and starts no next phase"

### AC-P083 — Auto compaction + 'compacting' UI

- **Area:** Compaction
- **Fleet area:** context-tools
- **Given:** auto-compaction enabled and context near the configured threshold.
- **When:** cross the threshold with mock usage, queue human input while compacting and release the summary.
- **Then:** the UI shows compacting, one summary reduces model context, held input resumes in order and Working Mode reattaches; failed/aborted compaction is visible.
- **Legacy equivalence:** Preserve the behavior in `PSS compaction; PWc/components/PromptEditor.ts:105`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill before summary placement, after placement before continuation, and after continuation admission before receipt; reopen at each barrier. One placed summary and at most one authorized continuation appear, held human/child input retains order, and explicit cancellation/failure cannot become successful compaction. Working Mode is reattached once for the restored context.
- **Negative control:** Disable automatic policy while leaving manual /compact working.
- **Spec:** `e2e/durable/context-tools/compaction.spec.ts` › "AC-P083 usage crosses threshold, queues input, and compacts before continuing; kill false"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P083 usage crosses threshold, queues input, and compacts before continuing; kill true"; host: `packages/durable-pilot/test/context-tools.test.ts` › "automatic compaction: above Pi's threshold the next request waits for one summary, then goes ahead"; `packages/durable-pilot/test/context-tools.test.ts` › "crash row compaction: a kill while summarizing restores paused; sending reruns the summary once and places one summary"

### AC-P085 — PI_TMP env, tool_call path guard, result warning, sweep

- **Area:** Ext: pi-tmp
- **Fleet area:** extensions-packages
- **Given:** separate lead/child scratch fixtures.
- **When:** attempt write/edit to forbidden temporary paths, run a shell mentioning them, and start with expired scratch entries.
- **Then:** write/edit is blocked with guidance, shell output gets the warning, per-conversation PI_TMP stays distinct and the bounded sweep leaves live scratch intact; TMPDIR is not replaced by PI_TMP.
- **Legacy equivalence:** Preserve the behavior in `WBe/pi-tmp/index.ts:5-24`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Disable the path guard.
- **Spec:** `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P085 temporary path guard, shell warning, bounded scratch sweep"; `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P034 AC-P085 child environments are distinct and never borrow the lead identity"; host: `packages/durable-pilot/test/extensions-host.test.ts` › "P034/P085 a child conversation gets its own identity and PI_TMP; the host process environment is untouched"; `packages/durable-pilot/test/extensions-host.test.ts` › "P085 pi-tmp: writes into an OS temp folder are blocked, bash /tmp use is warned, the sweeper runs at open"

### AC-P087 — Redact tool results, assistant text, context

- **Area:** Ext: secret-redaction
- **Fleet area:** context-tools
- **Given:** synthetic secrets in assistant deltas, tool outputs/details and model-bound context.
- **When:** stream split secret chunks through core tools and each new attachment/shell/MCP/summary/child/bash-log/Atelier commit path.
- **Then:** UI, persisted output and exported diagnostics contain redaction markers rather than the synthetic secret; sanitizer failure blocks admission/output, not just rendering; user input, tool arguments and signed thinking retain their explicitly sensitive verbatim policy.
- **Legacy equivalence:** Preserve the behavior in `WBe/secret-redaction/index.ts:6-30`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill with split streaming output and reopen its persisted partial/results. Synthetic secrets remain absent from all protected committed/output/export paths; a sanitizer failure parks affected work and cannot expose plaintext or trigger duplicate tool effects.
- **Negative control:** Disable the pre-commit sanitizer in a disposable fixture and require the leak assertion to fail.
- **Spec:** `e2e/durable/context-tools/groups-redaction.spec.ts` › "AC-P087 completed assistant text blocks do not retain synthetic secret fragments"; `e2e/durable/context-tools/groups-redaction.spec.ts` › "AC-P087 env secret is redacted in core output, split model text, summary and store after kill"; host: `packages/durable-pilot/test/context-tools.test.ts` › "a compaction summary and its /compact instructions are redacted before they are committed"

### AC-P088 — Low-disk notice before agent start

- **Area:** Ext: storage-guard
- **Fleet area:** extensions-packages
- **Given:** a lead with simulated 49 GB free and a child with the same reading.
- **When:** send turns, reduce free space by less than then exactly 5 GB.
- **Then:** the lead receives one low-disk notice and another only after the repeat drop; the child receives none and no forced cleanup turn or scratch deletion occurs.
- **Legacy equivalence:** Preserve the behavior in `WBe/storage-guard/index.ts:10-30`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Emit a low-disk notice on every turn.
- **Spec:** `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P088 low disk notice occurs once per threshold across host kills"; host: `packages/durable-pilot/test/extensions-host.test.ts` › "P088 storage-guard: one low-disk notice before the lead's run, persisted across a kill, again only 5 GB lower"

### AC-P089 — subagent

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a bounded assignment, explicit profile and independent-review routing request.
- **When:** launch foreground and background Subagents in separate cases.
- **Then:** each receipt names execution ID, cwd, actual provider/model/effort and profile; child context excludes the parent transcript; independent routing uses an eligible fresh model family; leaf/coordinator tool restrictions and one-level nesting hold.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:232`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Reuse the parent transcript or bypass profile allowlists.
- **Spec:** `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P089 Durable foreground children have fresh context, native tools, separate identity and model receipts"; `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P089 review routes away from author family and refuses a same-family override"; `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P089 launch receipt includes execution identity, cwd and binding"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-admission: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-result: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-delivery: one assignment, wake and collection"; +8 more tagged P089 in `e2e/durable/subagents-workers/roster.spec.ts`, `e2e/durable/subagents-workers/survival.spec.ts`; host: `packages/durable-pilot/test/delegation.test.ts` › "P089 background Subagent: routed fresh child with its allowlist and own identity; one wake; collect returns the answer with a receipt naming the model"; `packages/durable-pilot/test/delegation.test.ts` › "P089 foreground Subagent: the tool returns the result and receipt itself, collected, with no wake"; `packages/durable-pilot/test/delegation.test.ts` › "P089 independent review: routed to another model family, the receipt names it; exclusions and misuse fail preflight"

### AC-P090 — subagent_collect

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** running and terminal-uncollected children, including a long result and a failed receipt.
- **When:** call subagent_collect for one ID and without an ID.
- **Then:** running inspection returns immediately; terminal results are bounded with truncation/remainder disclosed and only returned results become collected; receipt failure is outcome_unknown, not success.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:377`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Mark all results collected before returning the bounded subset.
- **Spec:** `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P090 AC-P091 AC-P099 coalesced results stay uncollected on status, truncate honestly and collect once"; `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P090 bounded bulk collection leaves the unreturned remainder unread for collect by ID"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-admission: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-result: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-delivery: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-delivery: one assignment, wake and collection"; +8 more tagged P090 in `e2e/durable/subagents-workers/survival.spec.ts`, `e2e/durable/subagents-workers/workers.spec.ts`; host: `packages/durable-pilot/test/delegation.test.ts` › "P090/P091 collect and status: running inspection returns at once; a long result is bounded and says so; a failed child is an error; status lists by default only what needs reconciling"

### AC-P091 — subagent_status

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** running, terminal-uncollected and collected children.
- **When:** call subagent_status by ID, default and all:true.
- **Then:** default lists running/uncollected direct children, all includes retained collected entries, and each row has truthful state, task preview, model/effort and latest observation; reading does not collect or schedule work.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:444`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Mark status reads as collection.
- **Spec:** `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P090 AC-P091 AC-P099 coalesced results stay uncollected on status, truncate honestly and collect once"; host: `packages/durable-pilot/test/delegation.test.ts` › "P090/P091 collect and status: running inspection returns at once; a long result is bounded and says so; a failed child is an error; status lists by default only what needs reconciling"; `packages/durable-pilot/test/delegation.test.ts` › "P091 status reads never collect: a terminal child read by status stays uncollected until subagent_collect"

### AC-P092 — report_status

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a child already represented in the delegate roster.
- **When:** call report_status twice with different text.
- **Then:** the second one-line report replaces the first for that child and is visible to lead and owner without creating a second roster item.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:493`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Append each report as a new delegate.
- **Spec:** `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P092 AC-P099 a Durable Chat's Subagent shows in Activity with its status line, model, elapsed and quiet time, and leaves it once collected"; host: `packages/durable-pilot/test/delegation.test.ts` › "P092 report_status: a second report replaces the first in the one roster row, which names the model and start; the row goes once collected"

### AC-P093 — subagent_cancel

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a running child and a Worker with leaves.
- **When:** cancel the child, then cancel the Worker in a separate fixture.
- **Then:** termination/cancellation receipt is visible; Worker cancellation reaches its leaves; cancelling one leaf does not cancel its Worker; uncertain termination is outcome_unknown.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:504`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Return cancellation success before confirming termination.
- **Spec:** `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P093 cancelling a running Subagent survives SIGKILL without late result or wake"; `e2e/durable/subagents-workers/workers.spec.ts` › "AC-P093 leaf cancellation keeps Worker alive"; `e2e/durable/subagents-workers/workers.spec.ts` › "AC-P093 worker cancellation reaches all leaves"; host: `packages/durable-pilot/test/delegation.test.ts` › "P093 cancel: the receipt confirms termination; no wake or result follows; the child's work stops"; `packages/durable-pilot/test/delegation.test.ts` › "P093 Worker cancel reaches its leaves; cancelling one leaf leaves its Worker running"

### AC-P094 — subagent_steer

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a running child with a held turn.
- **When:** steer it, then steer with requestUpdate and let it call report_status.
- **Then:** the child receives the specified steer/follow-up once, the receipt names its sequence/mode, and the requested next report wakes the lead once without granting new authority.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:525`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Wake the lead from an old status report.
- **Spec:** `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P094 Durable steer and follow-up deliver once; requested status wakes; running follow-up must remain cancellable"; `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P094 legacy steer and follow-up deliver once; requested status wakes; running follow-up must remain cancellable"; host: `packages/durable-pilot/test/delegation.test.ts` › "P094 steer: delivered once with its sequence; requestUpdate wakes the lead once on the next report, not on an earlier one"; `packages/durable-pilot/test/delegation.test.ts` › "P094 follow-up: the child stays running while an admitted follow-up runs after its assignment answered; no wake; cancel confirms"; `packages/durable-pilot/test/delegation.test.ts` › "P094 follow-up failure: a follow-up run that fails after the assignment answered makes the child execution_failed, not success"

### AC-P095 — worker_create

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** a persisted lead Chat and a stable repository scope.
- **When:** call worker_create, then inspect the result.
- **Then:** one Worker identity is bound to owner, profile, scope and repository, with no child generation/process started; nested Worker creation fails visibly.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:553`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Start a dispatch during create.
- **Spec:** `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-admission: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-result: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-delivery: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-delivery: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent collect:after-commit: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL worker child:before-admission: one assignment, wake and collection"; +5 more tagged P095 in `e2e/durable/subagents-workers/survival.spec.ts`, `e2e/durable/subagents-workers/workers.spec.ts`; host: `packages/durable-pilot/test/delegation.test.ts` › "P095–P098 Workers: create starts nothing; busy dispatch fails preflight; a coordinator settles only after its leaf is collected; the next dispatch continues its scope with a fresh binding; retire blocks dispatch"

### AC-P096 — worker_dispatch

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** an owned Worker with one active dispatch.
- **When:** dispatch another assignment while busy; after settlement dispatch a new bounded assignment.
- **Then:** busy dispatch fails preflight rather than queueing; subsequent dispatch retains scoped continuity with a fresh execution binding and one terminal receipt; independent-review roles require a fresh Subagent; settlement waits for leaves and their collection.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:585`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Release the active-dispatch lock before leaves settle.
- **Spec:** `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-admission: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-result: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-delivery: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-delivery: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent collect:after-commit: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL worker child:before-admission: one assignment, wake and collection"; +5 more tagged P096 in `e2e/durable/subagents-workers/survival.spec.ts`, `e2e/durable/subagents-workers/workers.spec.ts`; host: `packages/durable-pilot/test/delegation.test.ts` › "P095–P098 Workers: create starts nothing; busy dispatch fails preflight; a coordinator settles only after its leaf is collected; the next dispatch continues its scope with a fresh binding; retire blocks dispatch"

### AC-P097 — worker_status

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** owned, foreign, retired and outcome-unknown Workers.
- **When:** call worker_status by ID, default and all:true.
- **Then:** default is owner-scoped; all:true provides diagnostics without control rights; receipts, lineage, active lock and requires-inspection reason remain truthful; unknown outcomes require inspection acknowledgement before redispatch.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:774`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Treat all:true diagnostics as ownership transfer.
- **Spec:** `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-admission: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-result: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-delivery: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-delivery: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent collect:after-commit: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL worker child:before-admission: one assignment, wake and collection"; +7 more tagged P097 in `e2e/durable/subagents-workers/survival.spec.ts`, `e2e/durable/subagents-workers/workers.spec.ts`; host: `packages/durable-pilot/test/delegation.test.ts` › "P095–P098 Workers: create starts nothing; busy dispatch fails preflight; a coordinator settles only after its leaf is collected; the next dispatch continues its scope with a fresh binding; retire blocks dispatch"

### AC-P098 — worker_retire

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** an idle owned Worker and a busy/foreign Worker.
- **When:** retire the idle one with a reason and attempt another dispatch.
- **Then:** retirement remains visible with its reason and rejects future dispatch; busy/foreign retirement cannot silently seize or end work.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/index.ts:827`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Allow dispatch against a retired Worker.
- **Spec:** `e2e/durable/subagents-workers/workers.spec.ts` › "AC-P095 AC-P096 AC-P097 AC-P098 Worker lifecycle: busy lock, leaf settlement, fresh binding with continuity, retirement survives kill"; `e2e/durable/subagents-workers/workers.spec.ts` › "AC-P090 AC-P097 AC-P098 AC-P099 receipt failure is unknown, collect is an error and redispatch requires inspection"; `e2e/durable/subagents-workers/workers.spec.ts` › "AC-P090 AC-P097 AC-P098 AC-P099 foreign diagnostic Worker grants no control"; host: `packages/durable-pilot/test/delegation.test.ts` › "P095–P098 Workers: create starts nothing; busy dispatch fails preflight; a coordinator settles only after its leaf is collected; the next dispatch continues its scope with a fresh binding; retire blocks dispatch"

### AC-P099 — Completion wake-up + Delegate roster

- **Area:** Ext: subagent
- **Fleet area:** subagents-workers
- **Given:** two background children completing together and one receipt failure.
- **When:** watch Delegate roster and completion attention, then collect.
- **Then:** completion wake-ups coalesce without losing result identities; terminal-uncollected entries remain until collection, receipt failures are distinct, and a dropped wake is redelivered without duplicate collection.
- **Legacy equivalence:** Preserve the behavior in `WBe/subagent/completion-wakeup.mjs:32-127; WBe/subagent/index.ts:208-219; PWc/components/DelegateRoster.ts:3`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill at child/Worker admission, terminal receipt, delivery and collection barriers, then reopen. Keep the same logical child/Worker/dispatch/report IDs and committed status/steering/retirement/collection state. Exactly one terminal receipt settles each dispatch; uncollected results remain available. Cancellation stays cancelled, late reporters cannot revive it, and status reads launch nothing; no duplicate assignment, external effect or collection receipt.
- **Negative control:** Mark results collected when only the wake marker was delivered.
- **Spec:** `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P092 AC-P099 a Durable Chat's Subagent shows in Activity with its status line, model, elapsed and quiet time, and leaves it once collected"; `e2e/durable/subagents-workers/roster.spec.ts` › "AC-P090 AC-P091 AC-P099 coalesced results stay uncollected on status, truncate honestly and collect once"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-admission: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-result: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:before-delivery: one assignment, wake and collection"; `e2e/durable/subagents-workers/survival.spec.ts` › "AC-P089 AC-P090 AC-P095 AC-P096 AC-P097 AC-P099 SIGKILL subagent child:after-delivery: one assignment, wake and collection"; +8 more tagged P099 in `e2e/durable/subagents-workers/survival.spec.ts`, `e2e/durable/subagents-workers/workers.spec.ts`; host: `packages/durable-pilot/test/delegation.test.ts` › "P099 two children finishing together wake the lead once; one collect reads both"

### AC-P101 — Telemetry events + usage

- **Area:** Ext: telemetry
- **Fleet area:** extensions-packages
- **Given:** a lead and child performing model, tool, turn, compaction, tree and thinking changes.
- **When:** inspect usage in UI/status and the fixture telemetry export.
- **Then:** events correlate Chat/conversation/execution/Worker IDs and actual usage; nested calls are not double-counted, cancellation differs from restart, and diagnostic content is redacted.
- **Legacy equivalence:** Preserve the behavior in `WBe/telemetry/index.ts:19-128`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after evidence/usage/media commit, reopen and inspect UI/API plus the fixture export. Committed history, usage and media references remain; export receipts prevent duplicate accounting. Recovery attempts are distinct; uncommitted samples need not survive.
- **Negative control:** Export the same committed event twice.
- **Spec:** `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P101 telemetry survives reopen without duplicate usage and includes child lineage"; host: `packages/durable-pilot/test/chat-host.test.ts` › "resources and telemetry: PI WEB's AGENTS.md/skill sections reach the model; the Workbench telemetry events are written"; `packages/durable-pilot/test/delegation.test.ts` › "P101 telemetry lineage: a child conversation starts its own telemetry session naming the lead, so the lead's report includes its usage"

### AC-P102 — tools_enable + hidden groups (workers/monitor/atelier) + goal tool gating

- **Area:** Ext: tool-groups
- **Fleet area:** context-tools
- **Given:** worker, monitor and Atelier groups registered but initially hidden.
- **When:** call tools_enable for each and inspect the next mock request; test a restricted child/nested caller.
- **Then:** only enabled eligible tools and aliases are exposed; Workers orchestration exposes the worker group; enabling cannot widen a child allowlist; invalid/unregistered groups fail.
- **Legacy equivalence:** Preserve the behavior in `WBe/tool-groups/index.ts:43-73; WBe/tool-groups/groups.mjs:3-11`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after group enablement commits, reopen and compact/fork at retained branch points. Exposure restores as-of the branch before scheduling, aliases obey it, and child/nested allowlists never widen; enabling causes no tool execution.
- **Negative control:** Enable all registered tools irrespective of profile.
- **Spec:** `e2e/durable/context-tools/groups-redaction.spec.ts` › "AC-P102 workers exposure survives reload, host kill and compaction"; `e2e/durable/context-tools/groups-redaction.spec.ts` › "AC-P102 atelier exposure survives reload, host kill and compaction"; `e2e/durable/context-tools/groups-redaction.spec.ts` › "AC-P102 monitor exposure survives reload, host kill and compaction"; `e2e/durable/context-tools/groups-redaction.spec.ts` › "AC-P102 invalid group is rejected and Workers mode exposes only the worker group"; `e2e/durable/context-tools/groups-redaction.spec.ts` › "P072 AC-P102 child grep/find/ls work and tools_enable cannot widen its allowlist"; host: `packages/durable-pilot/test/context-tools.test.ts` › "tools_enable: group tools stay deferred until enabled; the exposure survives a restart and a compaction"; `packages/durable-pilot/test/context-tools.test.ts` › "tool groups never widen an allowlist: nested calls need the group enabled, a child without the tools cannot load or call them"; `packages/durable-pilot/test/context-tools.test.ts` › "Orchestration Workers shows the workers group, and leaving it hides the group again unless it was enabled"

### AC-P103 — Working Mode block delivery, status, compaction reattach

- **Area:** Ext: working-mode
- **Fleet area:** context-tools
- **Given:** a Chat with non-default selections on all four Working Mode axes.
- **When:** change selection, send a prompt, compact and send again.
- **Then:** status distinguishes selected/applied state; tagged recorded guidance reaches the mock on application and after compaction without becoming a changing system section or permission grant.
- **Legacy equivalence:** Preserve the behavior in `WBe/working-mode/index.ts:74-125`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after selected/applied/aligned state and guidance admission, then reopen. Recorded choices restore before scheduling, pending guidance delivers once, and alignment/reset state follows the retained branch; compaction reattaches guidance without granting authority or duplicating a turn.
- **Negative control:** Change status without recording/delivering guidance.
- **Spec:** `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 AC-P103 exactly one continuation and mode reattach; kill none"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 AC-P103 exactly one continuation and mode reattach; kill summarizing"; `e2e/durable/context-tools/compaction.spec.ts` › "AC-P082 AC-P103 exactly one continuation and mode reattach; kill continuation"; `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P103 AC-P104 selected/applied four-axis mode and idempotent /mode send survive host kill"; `e2e/durable/composer-attention/daily-controls.spec.ts` › "AC-P103 P104: /mode changes guidance, survives host kill and rides exactly once with next prompt"; `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P103 AC-P104 selected Working Mode delivers once and survives restart"; host: `packages/durable-pilot/test/chat-host.test.ts` › "Working Mode: a selection survives a restart, rides with the next prompt once, /mode send delivers it now, alignment is recorded"

### AC-P104 — /mode (args form; no-arg ui.select picker)

- **Area:** Ext: working-mode
- **Fleet area:** context-tools
- **Given:** a Durable Chat with Working Mode controls.
- **When:** use /mode axis value, /mode send and no-argument /mode.
- **Then:** valid args update selection; send applies pending guidance immediately or steers at the next boundary; unchanged sends do not duplicate it; no-arg web use shows usage rather than requiring a TUI picker; invalid values leave state intact.
- **Legacy equivalence:** Preserve the behavior in `WBe/working-mode/index.ts:88-121`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after selected/applied/aligned state and guidance admission, then reopen. Recorded choices restore before scheduling, pending guidance delivers once, and alignment/reset state follows the retained branch; compaction reattaches guidance without granting authority or duplicating a turn.
- **Negative control:** Start a new turn for an unchanged /mode send.
- **Spec:** `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P103 AC-P104 selected/applied four-axis mode and idempotent /mode send survive host kill"; `e2e/durable/composer-attention/daily-controls.spec.ts` › "AC-P103 P104: /mode changes guidance, survives host kill and rides exactly once with next prompt"; `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P103 AC-P104 selected Working Mode delivers once and survives restart"; host: `packages/durable-pilot/test/chat-host.test.ts` › "Working Mode: a selection survives a restart, rides with the next prompt once, /mode send delivers it now, alignment is recorded"

### AC-P105 — alignment_reached

- **Area:** Ext: working-mode
- **Fleet area:** context-tools
- **Given:** Attention AFK with non-default Alignment still pending.
- **When:** have the scripted model call alignment_reached with an agreed outcome.
- **Then:** status becomes aligned and subsequent guidance uses AFK rules; tool output records the agreement without creating new authority.
- **Legacy equivalence:** Preserve the behavior in `WBe/working-mode/rules.mts:54; index.ts:132`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after selected/applied/aligned state and guidance admission, then reopen. Recorded choices restore before scheduling, pending guidance delivers once, and alignment/reset state follows the retained branch; compaction reattaches guidance without granting authority or duplicating a turn.
- **Negative control:** Leave the aligned flag false after success.
- **Spec:** `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P105 AC-P106 alignment reached and reset restore across host death"; `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P105 alignment reached is durable"; host: `packages/durable-pilot/test/chat-host.test.ts` › "Working Mode: a selection survives a restart, rides with the next prompt once, /mode send delivers it now, alignment is recorded"

### AC-P106 — alignment_reset

- **Area:** Ext: working-mode
- **Fleet area:** context-tools
- **Given:** an aligned AFK Chat.
- **When:** call alignment_reset with a reason.
- **Then:** status returns to unaligned and the next guidance restores preparation-before-AFK behavior with the reason recorded.
- **Legacy equivalence:** Preserve the behavior in `WBe/working-mode/rules.mts:55; index.ts:146`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after selected/applied/aligned state and guidance admission, then reopen. Recorded choices restore before scheduling, pending guidance delivers once, and alignment/reset state follows the retained branch; compaction reattaches guidance without granting authority or duplicating a turn.
- **Negative control:** Retain aligned state after reset.
- **Spec:** `e2e/durable/context-tools/models-mode.spec.ts` › "AC-P105 AC-P106 alignment reached and reset restore across host death"; `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P106 alignment reset is durable"; host: `packages/durable-pilot/test/chat-host.test.ts` › "Working Mode: a selection survives a restart, rides with the next prompt once, /mode send delivers it now, alignment is recorded"

### AC-P107 — AGENTS.md (global + project) and APPEND_SYSTEM.md in system prompt

- **Area:** Resources
- **Fleet area:** context-tools
- **Given:** global/project AGENTS.md markers and global/project APPEND_SYSTEM.md fixtures.
- **When:** start a trusted Durable Chat and inspect the first mock payload.
- **Then:** global and applicable ancestor/project instructions appear in the intended order without duplicate worktree context; trusted project APPEND_SYSTEM takes precedence over global, with global fallback when absent/untrusted.
- **Legacy equivalence:** Preserve the behavior in `Pi DefaultResourceLoader (legacy session)`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Load only project instructions or concatenate both append overrides.
- **Spec:** `e2e/durable/context-tools/resources.spec.ts` › "AC-P107 global/ancestor/project context and append precedence (Durable)"; `e2e/durable/context-tools/resources.spec.ts` › "AC-P107 global/ancestor/project context and append precedence (legacy)"; host: `packages/durable-pilot/test/chat-host.test.ts` › "resources and telemetry: PI WEB's AGENTS.md/skill sections reach the model; the Workbench telemetry events are written"

### AC-P108 — Skill catalog: 8 Workbench skills, global skills (gh-stack), package skills

- **Area:** Resources
- **Fleet area:** extensions-packages
- **Given:** the eight bundled Workbench skills (`atelier`, `autonomous-grill`, `define-goal`, `model-orchestration`, `orient`, `workstreams`, `analyze-source-for-workbench`, `customize-pi-web-presentation`), global `gh-stack` and installed package skill fixtures.
- **When:** open the skill command catalog and invoke a representative skill from each origin.
- **Then:** names/descriptions and resource paths are discoverable even with legacy extension execution disabled; content and relative-reference roots are correct; manual-only presentation guidance stays manual-only.
- **Legacy equivalence:** Preserve the behavior in `WB/skills/*; Pi loader`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Drop package skills whenever noExtensions is set.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P108 skill catalog exposes workstreams independently of extension execution"; `e2e/durable/context-tools/resources.spec.ts` › "AC-P108 installed Workbench, global gh-stack and package skill catalogs load"; `e2e/durable/context-tools/resources.spec.ts` › "AC-P108 P056 skill catalog and leading/inline expansion (Durable)"; `e2e/durable/context-tools/resources.spec.ts` › "AC-P108 P056 skill catalog and leading/inline expansion (legacy)"

### AC-P109 — Project trust precedence

- **Area:** Resources
- **Fleet area:** context-tools
- **Given:** saved trust decisions conflicting with defaultProjectTrust and a project resource fixture.
- **When:** create Chats under trusted, denied and undecided profiles.
- **Then:** saved trust wins; absent decisions use the default with ask treated as untrusted; untrusted project extensions/resources do not become executable or override global providers.
- **Legacy equivalence:** Preserve the behavior in `PWs/piSessionService.projectTrust.acceptance.test.ts`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Let a project provider override global configuration before trust.
- **Spec:** `e2e/durable/context-tools/resources.spec.ts` › "AC-P109 saved denial wins; project append cannot bypass trust"; `e2e/durable/context-tools/resources.spec.ts` › "AC-P109 saved trust wins; project append cannot bypass trust"; `e2e/durable/context-tools/resources.spec.ts` › "AC-P109 ask is untrusted; project append cannot bypass trust"

### AC-P110 — Extension-contributed resources

- **Area:** Resources
- **Fleet area:** extensions-packages
- **Given:** a supported port contributing a skill or prompt resource.
- **When:** load its declared resource, invoke it, then remove it and reload.
- **Then:** the command/catalog and mock payload reflect the contribution and its origin; removed resources disappear; unsupported contributors fail visibly rather than silently losing content.
- **Legacy equivalence:** Preserve the behavior in `Pi extension resource hooks`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore extension-contributed resource paths.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P110 extension-contributed skill is discovered or explicitly rejected"; host: `packages/durable-pilot/test/packages.test.ts` › "P110: resources a package contributes through resources_discover are named in the ready message for PI WEB's resource loader, with their extension"

### AC-P111 — Claude subscription payload/alias adapter

- **Area:** Pkg: pi-claude-code-use
- **Fleet area:** extensions-packages
- **Given:** fake Claude subscription auth and a scripted tool-use/thinking response.
- **When:** send a prompt, complete a tool turn and compact through the mock Anthropic Messages endpoint.
- **Then:** captured payload matches the subscription adapter's system/tool aliases and cache conventions; UI displays canonical tool names and valid thinking; no paid-key or live-endpoint fallback occurs.
- **Legacy equivalence:** Preserve the behavior in `NM/@benvargas/pi-claude-code-use/extensions/index.ts:1216-1258`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Bypass the subscription payload transform.
- **Spec:** `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P111 durable subscription shape, thinking, canonical tool round trip"; `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P111 legacy subscription shape, thinking, canonical tool round trip"

### AC-P112 — mcp__ alias tools for extension/MCP tools

- **Area:** Pkg: pi-claude-code-use
- **Fleet area:** extensions-packages
- **Given:** two extension/MCP tools with colliding short names and one disabled tool.
- **When:** request them through Claude aliases and switch to OpenAI.
- **Then:** aliases route by provenance to the correct canonical tool exactly once; UI/persistence use canonical names; disabled tools stay unavailable and OpenAI does not inherit Claude-only aliases.
- **Legacy equivalence:** Preserve the behavior in `NM/@benvargas/pi-claude-code-use/extensions/index.ts:1074`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Route aliases using only a lowercase suffix.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P112 Claude package aliases round-trip canonically and do not leak to OpenAI"; host: `packages/durable-pilot/test/packages.test.ts` › "P113 P114 P115 P116 P117 P119 P112: in a Claude Chat web tools stay deferred until web_enable; search, fetch and stored content work and survive a restart; stored pages are redacted"

### AC-P113 — web_enable (loader)

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** configured search/fetch capabilities with one explicitly disabled capability.
- **When:** call web_enable.
- **Then:** the result lists enabled configured tools and the next mock request exposes them; the call itself makes no search/fetch request and disabled capabilities remain absent.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22423,22473`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Activate every web tool regardless of configuration.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P113 web_enable gates configured tools and makes no network request"; host: `packages/durable-pilot/test/packages.test.ts` › "P113 P114 P115 P116 P117 P119 P112: in a Claude Chat web tools stay deferred until web_enable; search, fetch and stored content work and survive a restart; stored pages are redacted"; `packages/durable-pilot/test/packages.test.ts` › "P113 with a ChatGPT model: current-model OpenAI hosted search sees the real Codex model, uses only the stored subscription login and reaches the (mocked) ChatGPT endpoint"

### AC-P114 — web_search

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** a local search-provider fixture returning distinct sources for two queries.
- **When:** call web_search with bounded results and provider selection.
- **Then:** the tool card returns source-linked results, provider identity and a responseId for full retrieval; filters/limits reach the fixture and partial/provider failures are explicit.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22946`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Return a canned answer without source IDs.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P114 web_search returns query-specific linked sources and bounded limits"; host: `packages/durable-pilot/test/packages.test.ts` › "P113 P114 P115 P116 P117 P119 P112: in a Claude Chat web tools stay deferred until web_enable; search, fetch and stored content work and survive a restart; stored pages are redacted"

### AC-P115 — fetch_content

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** local page, image, PDF and repository fixtures and supported fetch modes.
- **When:** call fetch_content for single/multiple URLs, including readable/raw/answer cases.
- **Then:** content or images and bounded metadata are visible; answer mode uses only the page and mocked model; disabled modes and failed fetches are explicit, not invented content.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22948`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Ignore requested fetch mode.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P115 fetch_content readable and raw modes use only the local page"; host: `packages/durable-pilot/test/packages.test.ts` › "P113 P114 P115 P116 P117 P119 P112: in a Claude Chat web tools stay deferred until web_enable; search, fetch and stored content work and survive a restart; stored pages are redacted"

### AC-P116 — get_search_content

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** stored search and fetch results longer than the inline cap.
- **When:** call get_search_content using responseId, offsets/limits and findText.
- **Then:** bounded pages, continuation metadata and matching passages refer to the selected result/query/URL; unknown IDs fail and retrieval makes no new external fetch.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22949`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Return the first page regardless of offset.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P116 stored content honors offsets/findText and survives restart without refetch"; host: `packages/durable-pilot/test/packages.test.ts` › "P113 P114 P115 P116 P117 P119 P112: in a Claude Chat web tools stay deferred until web_enable; search, fetch and stored content work and survive a restart; stored pages are redacted"

### AC-P117 — source_check

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** a claim and local source fixtures containing exact passages.
- **When:** call source_check.
- **Then:** a bounded structured research artifact includes source links and exact passage citations for manual review, not an unsupported truth verdict.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22947`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Invent a citation absent from fetched content.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P117 source_check when configured emits sourced passages, not a truth verdict"; host: `packages/durable-pilot/test/packages.test.ts` › "P113 P114 P115 P116 P117 P119 P112: in a Claude Chat web tools stay deferred until web_enable; search, fetch and stored content work and survive a restart; stored pages are redacted"

### AC-P119 — Session hooks (before_agent_start, session_tree, tool_call, agent_settled) + widget

- **Area:** Pkg: pi-web-access
- **Fleet area:** extensions-packages
- **Given:** a search with pending content and curator auto-approval scoped to one turn.
- **When:** settle the turn or navigate history, then search again.
- **Then:** pending activity is observable, stale work is cleaned up, approval does not leak into the new turn/branch, and nested search completion returns its required content rather than orphaning a background fetch.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-web-access/dist/index.js:22412-22416,25047-25058`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Retain auto-approval across session_tree.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P119 package lifecycle retains branch-local tools and clears pending search activity"; host: `packages/durable-pilot/test/packages.test.ts` › "P113 P114 P115 P116 P117 P119 P112: in a Claude Chat web tools stay deferred until web_enable; search, fetch and stored content work and survive a restart; stored pages are redacted"

### AC-P124 — ask_human

- **Area:** Pkg: ping-a-human-pi
- **Fleet area:** extensions-packages
- **Given:** a local phone stub with delayed answer and no real Telegram access.
- **When:** call ask_human, then supply a fake reply; separately time out/cancel.
- **Then:** the tool waits for and shows the reply or truthful timeout/cancellation, while the stub records one send; the call is unsafe on replay.
- **Legacy equivalence:** Preserve the behavior in `NM/ping-a-human-pi/extension/index.ts:81,288`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the stub records a phone send but before its result commits, then reopen. Show interrupted/unknown delivery, retain any committed result and require reconciliation before another send. Stub send count remains one; no automatic phone replay.
- **Negative control:** Classify the phone send as replay-safe.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P124 ask_human stub success/error and kill-after-send never resends"; `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P124 delayed phone reply and cancellation are truthful"; host: `packages/durable-pilot/test/packages.test.ts` › "P124 P125 P126: ask_human, notify_human and /ping go only to the stub transport; an ask killed after it was sent is never sent again"

### AC-P125 — notify_human

- **Area:** Pkg: ping-a-human-pi
- **Fleet area:** extensions-packages
- **Given:** a local phone notification stub.
- **When:** call notify_human with a message and simulate transport failure separately.
- **Then:** one stub send and its success/error result are visible; failure is not reported as delivered.
- **Legacy equivalence:** Preserve the behavior in `NM/ping-a-human-pi/extension/index.ts:80,288`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Survival:** Kill after the stub records a phone send but before its result commits, then reopen. Show interrupted/unknown delivery, retain any committed result and require reconciliation before another send. Stub send count remains one; no automatic phone replay.
- **Negative control:** Return success for a rejected stub response.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P125 notify_human stub success/error and kill-after-send never resends"; host: `packages/durable-pilot/test/packages.test.ts` › "P124 P125 P126: ask_human, notify_human and /ping go only to the stub transport; an ask killed after it was sent is never sent again"

### AC-P133 — monitor, monitor_status, monitor_inspect, monitor_kill, monitor_kill_all, monitor_recover, monitor_gc

- **Area:** Pkg: pi-process-monitor
- **Fleet area:** extensions-packages
- **Given:** local owned-process, observer and quarantined watcher fixtures.
- **When:** use monitor, monitor_status, monitor_inspect, monitor_kill, monitor_kill_all, monitor_recover and monitor_gc.
- **Then:** logical identity, owner, recovery policy and output are visible; reuse does not duplicate work; poll mutations quarantine; recovery needs explicit approval; kill affects only verified owned processes and kill-all requires confirm=true; GC defaults to dry-run.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-process-monitor/extensions/monitor/tools.ts:36-115`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Reuse an identity by spawning a second workload.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P133 monitor tools preserve identity, quarantine and explicit destructive approval"; host: `packages/durable-pilot/test/packages.test.ts` › "P133 P135: a tail watcher pings the Chat, survives a kill and resumes; pings are redacted; /monitors lists it"

### AC-P134 — /monitor, /monitors, /monitor-kill, /monitor-recover, /monitor-gc

- **Area:** Pkg: pi-process-monitor
- **Fleet area:** extensions-packages
- **Given:** a local watcher fixture.
- **When:** invoke /monitor, /monitors, /monitor-kill, /monitor-recover and /monitor-gc.
- **Then:** command notices expose the same watcher identity/state; invalid or empty input shows usage; explicit recover approve/reject is honored and GC without --apply changes nothing.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-process-monitor/extensions/monitor/commands.ts:29-97`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Make /monitor-gc destructive by default.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P134 monitor commands list, show usage and keep GC dry-run"; host: `packages/durable-pilot/test/packages.test.ts` › "P118 P134: package commands run in the host, notices are command output; /google-account is refused with its reason; dialogs are refused visibly"

### AC-P135 — Message renderer + session hooks (sendMessage pings)

- **Area:** Pkg: pi-process-monitor
- **Fleet area:** extensions-packages
- **Given:** a watcher configured to ping on a fixture event.
- **When:** trigger its event, then close/reopen the Chat transport.
- **Then:** a readable watcher-tagged message identifies the event and owner, pings obey the condition, and another Chat receives none; session hook errors report recovery failed closed.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-process-monitor/extensions/monitor/index.ts:12-25`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime.
- **Negative control:** Deliver every watcher tick as a new prompt.
- **Spec:** `e2e/durable/extensions-packages/packages.spec.ts` › "AC-P135 monitor ping survives host restart and stays in its owning Chat"; host: `packages/durable-pilot/test/packages.test.ts` › "P133 P135: a tail watcher pings the Chat, survives a kill and resumes; pings are redacted; /monitors lists it"

### AC-P137 — /fast, --fast flag, service_tier hook, status

- **Area:** Pkg: pi-openai-fast-mode
- **Fleet area:** extensions-packages
- **Given:** mock OpenAI and Claude models with fast mode initially off.
- **When:** run /fast on, off and toggle and test the supported startup fast flag.
- **Then:** status reflects enabled/applicable state; only supported OpenAI requests get the configured service_tier, Claude payloads stay unchanged, and invalid args show an error.
- **Legacy equivalence:** Preserve the behavior in `NM/pi-openai-fast-mode/src/index.ts:94-145`; the Survival step, when present, adds Durable recovery rather than copying legacy process lifetime. Original n-a condition ended with the accepted OpenAI scope decision; the CLI flag is tested only at the supported host startup boundary, not as a new browser control.
- **Negative control:** Add service_tier to every provider payload.
- **Spec:** `e2e/durable/extensions-packages/runtime.spec.ts` › "AC-P137 fast on/off/toggle affects only OpenAI service_tier"; host: `packages/durable-pilot/test/chat-host.test.ts` › "OpenAI models: offered from the stored ChatGPT and Copilot logins; the choice survives a hard kill; /fast over IPC"; `packages/durable-pilot/test/providers.test.ts` › "P137 pi-openai-fast-mode"

## Deferred and out of scope

Only the named surface is excluded for partial rows; each retained portion still has one AC.
Sources: Workstream plan `phase-b-slice-3-plan.md` sections **Decisions accepted 2026-10-22**,
**Scope by usage** (its deferred features move here; pi-goal and pi-btw are out) and
**Lead decisions while AFK**, plus the fleet brief's untraced-command list. These are scope
decisions, not implementation failures waived by the fleet. Fleet specs may still carry skip
markers or tests for these rows; their results do not count toward parity.

| Row | Excluded scope | Reason | Decision date |
| --- | --- | --- | --- |
| P017 | Whole row | Scope by usage (zero use 2026-10-08..22): model scope commands deferred. `context-tools/deferred.spec.ts` keeps a skip marker. | 2026-10-22 |
| P018 | Whole row | Scope by usage (zero use 2026-10-08..22): model cycle commands deferred. `context-tools/deferred.spec.ts` keeps a skip marker. | 2026-10-22 |
| P021 | Whole row | Scope by usage (zero use 2026-10-08..22): session defaults deferred. `context-tools/deferred.spec.ts` keeps a skip marker. | 2026-10-22 |
| P024 | Whole row | Scope by usage (zero use 2026-10-08..22): zero dismiss requests; session warnings deferred (lead, round 2). | 2026-10-22 |
| P025 | Whole row | Scope by usage (zero use 2026-10-08..22): archive deferred; Durable Chats refuse archiving visibly (AC-P050). | 2026-10-22 |
| P026 | Whole row | Scope by usage (zero use 2026-10-08..22): bulk archive/cleanup deferred with archive. | 2026-10-22 |
| P035 | Whole row | Scope by usage (zero use 2026-10-08..22): reload deferred. | 2026-10-22 |
| P036 | Whole row | Scope by usage (zero use 2026-10-08..22): detach-parent deferred with the subsession family. | 2026-10-22 |
| P042 | Whole row | Scope by usage (zero use 2026-10-08..22): extension dialogs deferred; unsupported dialogs must still be refused visibly (AC-P050). | 2026-10-22 |
| P043 | Whole row | Scope by usage (zero use 2026-10-08..22): command select responses serve the deferred /fork picker. | 2026-10-22 |
| P045 | Whole row | Scope by usage (zero use 2026-10-08..22): fork/clone deferred; unsupported fork stays hidden (AC-P050). | 2026-10-22 |
| P052 | Whole row | /session is untraced in the usage window; deferred with the other untraced commands (fleet brief). `context-tools/deferred.spec.ts` keeps a skip marker. | 2026-10-22 |
| P057 | Whole row | Scope by usage (zero use 2026-10-08..22): prompt templates without use deferred. `composer-attention/composer.spec.ts` still exercises template expansion under AC-P055. | 2026-10-22 |
| P059 | Whole row | Scope by usage (zero use 2026-10-08..22): MCP deferred (no configured servers). `context-tools/deferred.spec.ts` keeps a skip marker. | 2026-10-22 |
| P060 | Whole row | Scope by usage (zero use 2026-10-08..22): MCP tools deferred (no configured servers). `context-tools/deferred.spec.ts` keeps a skip marker. | 2026-10-22 |
| P061 | Whole row | tool_search is default-inactive; explicitly deferred. | 2026-10-22 |
| P062 | Whole row | codemode is default-inactive; explicitly deferred. | 2026-10-22 |
| P064 | Whole row | spawn_session deferred with the spawn_subsession family despite one use (fleet brief). | 2026-10-22 |
| P065 | Whole row | Scope by usage (zero use 2026-10-08..22): spawn_subsession family deferred. | 2026-10-22 |
| P066 | Whole row | Scope by usage (zero use 2026-10-08..22): subsession completion delivery deferred with the family. | 2026-10-22 |
| P067 | Whole row | Scope by usage (zero use 2026-10-08..22): session dispatch channel only serves the deferred subsession family. | 2026-10-22 |
| P074 | Whole row | agent-audit is opt-in TUI capture; explicitly deferred. | 2026-10-22 |
| P077 | Whole row | Scope by usage (zero use 2026-10-08..22): /autonomous-grill deferred; the command is refused visibly (`extensions-packages/packages.spec.ts` deferred-command case). | 2026-10-22 |
| P084 | Whole row | Scope by usage (zero use 2026-10-08..22): lead-fallback deferred. | 2026-10-22 |
| P086 | Whole row | /quota-check and the startup check are untraced; deferred with the other untraced commands (fleet brief). Host test `extensions-host.test.ts` P086 is kept. | 2026-10-22 |
| P100 | Whole row | Subagent background keyboard shortcut is TUI-only; explicitly deferred. | 2026-10-22 |
| P118 | Whole row | /google-account deferred (decision 2026-10-22); /websearch untraced; /search and /curator selection need the deferred extension dialogs (P042). Whole row deferred (lead, round 2). | 2026-10-22 |
| P120 | Whole row | Web-access curate/activity shortcuts are TUI-only; explicitly deferred. | 2026-10-22 |
| P121 | Whole row | pi-goal is out of scope; owner no longer uses it. | 2026-10-22 |
| P122 | Whole row | pi-goal completion/block/wait tools are out of scope. | 2026-10-22 |
| P123 | Whole row | pi-goal autonomous loop and status chip are out of scope. | 2026-10-22 |
| P126 | Whole row | /ping is untraced; deferred with the other untraced commands (fleet brief). ask_human/notify_human stay required (AC-P124, AC-P125). | 2026-10-22 |
| P128 | Whole row | pi-btw is out (Scope by usage: "Out: pi-btw"); supersedes the earlier AFK reading that kept non-overlay commands. | 2026-10-22 |
| P129 | Whole row | pi-btw is out, including its context hook and renderer. | 2026-10-22 |
| P130 | Whole row | pi-btw is out, including its skill. | 2026-10-22 |
| P131 | Whole row | Scope by usage (zero use 2026-10-08..22): ponytail skills deferred. | 2026-10-22 |
| P136 | Whole row | Scope by usage (zero use 2026-10-08..22): monitor skill and /watch deferred; monitor tools/commands stay required. | 2026-10-22 |
| P138 | Whole row | Scope by usage (zero use 2026-10-08..22): relays deferred. | 2026-10-22 |
| P139 | Whole row | Scope by usage (zero use 2026-10-08..22): relays deferred. | 2026-10-22 |
| P075 | Atelier takeover between two Durable Chats | Lead decision 4B: zero uses; the kernel refuses it visibly. Open/update/ask/answer/status/check and stale-generation refusal remain required. | 2026-10-22 |
| P102 | pi-goal tool gating only | pi-goal is out of scope; worker/monitor/Atelier groups remain required. | 2026-10-22 |
| P108 | Skills of deferred or out packages (pi-btw, relays, ponytail, monitor) | Their packages are deferred or out; Workbench, global and remaining package skills remain required. | 2026-10-22 |
| P141 | Terminal/PTY owner | Later Phase C retained owner; also recorded as n-a in the inventory. | 2026-10-22 |

Built, not required: **P009, P010** (queued edit/promote) were unused in the window but were
built and pass; they stay as ACs and regression criteria.

## Not applicable

| Row | Reason |
| --- | --- |
| P054 | These slash commands are not implemented in legacy web either; app model/login controls remain covered separately. |
| P063 | TUI-side PI WEB administration command; not an installed Chat feature. |
| P072 | grep/find/ls are not in the inventoried active built-in set; no parity port required here. |
| P127 | Automatic phone notify/approval hooks are disabled in the inventoried profile. |
| P132 | Ponytail extension is disabled; its selected skills (P131) are deferred. |
| P140 | Workspace-file browser plugin is runtime-independent. |
| P141 | Terminal/PTY belongs to the retained terminal owner in later Phase C; not Durable Chat execution. |

P137 was n-a in the inventory but is counted as an AC, not in this table, because OpenAI is now
accepted scope. P141's original survival flag belongs to the deferred terminal owner, not this fleet.

## Coverage

Counts are criteria, not test cases or passing results. Fleet areas are the PI WEB directories
`e2e/durable/<area>/`; an AC sits in the area of its first listed spec. The earlier six-area plan
merged composer/queue with attention/catalog (`composer-attention`) and dropped MCP from
`context-tools`.

Reconciliation: **95 AC rows + 39 wholly deferred/out-of-scope rows + 7 n-a rows = 141**.
Partially excluded AC rows (P075, P102, P108) count once as ACs. P141 appears in
both exclusion tables but counts once as n-a. Every AC names at least one runnable spec.

| Fleet area | AC count | Survival count |
| --- | ---: | ---: |
| composer-attention | 32 | 16 |
| context-tools | 20 | 15 |
| subagents-workers | 11 | 11 |
| bash-atelier-tree | 10 | 7 |
| extensions-packages | 22 | 3 |
| **Total** | **95** | **52** |
