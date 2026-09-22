# Pi Goal web compatibility

**Proposed outcome:** `/goal resume` produces one current Goal status and one compact lifecycle card in PI WEB. The full Goal contract remains available to the model, while internal prompts and hidden custom messages never appear as user or SYSTEM transcript content.

This is presentation compatibility for an attended Pi Chat. It does not make PI WEB authoritative for Goal state.

## Observed `/goal resume` behavior

Thomas's observed resume screen combines five independent sources. Treating it as one duplicated message would fix the wrong layer.

1. **Internal user message.** pi-goal 0.54.7 calls `sendUserMessage` with its resume prompt. Pi persists that extension-generated prompt as a normal user message, so PI WEB renders a large user wall. In the observed session `01a0c928-25d2-75f5-9f3a-c386f73adaa4`, this is entry `ea9f4bd1`.
2. **Hidden Goal contract.** pi-goal separately inserts a `goal-contract` custom message with `display:false`. It should be model-visible and UI-hidden. PI WEB filters it on transcript reload, but the observed live path can forward it and the client maps an unrecognized custom role to SYSTEM. The observed contract entry is `516`.
3. **Notification.** After resume, pi-goal sends the objective and counter explanation through `ctx.ui.notify`. Unlimited automatic work changes this successful resume notification to `warning`, which puts non-actionable success content in PI WEB's notification inbox.
4. **Budget wrap-up instruction.** pi-goal 0.54.7 defines and sends `goal-budget-wrap-up` from `runtime.ts` with `display:true` and `deliverAs:"steer"`. Because PI WEB has no presentation contract for that custom type, it falls through as generic SYSTEM content even though it is an internal model instruction, not a lifecycle event.
5. **Assistant output.** Text such as `Goal 7634074f… active…` is ordinary assistant output. PI WEB and pi-goal must not suppress or reinterpret it as extension status.

The extension behavior is visible in [`resumeGoal`](https://github.com/narumiruna/pi-extensions/blob/70a034c1be212dd142969f9f17f8dfc894fbdf2f/packages/pi-goal/src/commands.ts#L203-L282) and [`runtime.ts`](https://github.com/narumiruna/pi-extensions/blob/70a034c1be212dd142969f9f17f8dfc894fbdf2f/packages/pi-goal/src/runtime.ts). The hidden contract and its independent version are defined in [`goal-contract.ts`](https://github.com/narumiruna/pi-extensions/blob/70a034c1be212dd142969f9f17f8dfc894fbdf2f/packages/pi-goal/src/goal-contract.ts#L4-L45). PI WEB's reload filter is in [`transcriptMessages.ts`](https://github.com/tschuehly/pi-web/blob/1c6a85c56de9efa66e36880c64cba9c7ad2e0a91/src/server/sessions/transcriptMessages.ts#L4-L18), while unknown roles become SYSTEM in [`chatMessages.ts`](https://github.com/tschuehly/pi-web/blob/1c6a85c56de9efa66e36880c64cba9c7ad2e0a91/src/client/src/chatMessages.ts#L52-L71).

## Minimal architecture

Use Pi's existing generic extension seams. Do not add a Goal endpoint or a PI WEB-to-extension command protocol.

```text
pi-goal authoritative session state
  ├─ setStatus("goal", versioned JSON) ──> current status surface
  ├─ visible pi-goal.lifecycle message ──> transcript card
  ├─ notify(error or action required) ───> notification inbox
  ├─ hidden pi-goal.trigger message ─────> internal model instruction
  └─ hidden goal-contract v2 ────────────> authoritative model context

PI WEB validates and projects those generic channels; it does not own Goal transitions.
```

The generic bridge already maps `notify` and `setStatus` into PI WEB session state in [`piSessionService.ts`](https://github.com/tschuehly/pi-web/blob/1c6a85c56de9efa66e36880c64cba9c7ad2e0a91/src/server/sessions/piSessionService.ts#L3887-L3940). Visible custom messages already persist in Pi's transcript. These seams are sufficient.

### Upstream pi-goal owns semantics and emission

- **Repository:** [`narumiruna/pi-extensions`](https://github.com/narumiruna/pi-extensions)
- **Target branch:** `main`
- **Package:** `packages/pi-goal`

pi-goal remains authoritative for the objective, Goal identifier, lifecycle state, safety epoch, usage, persistence, and whether a transition succeeded. It emits a presentation snapshot only after the corresponding state transition is durable. If prompt delivery fails and resume rolls back, pi-goal restores the prior status and emits no successful Resume card.

Replace the long extension-generated user message with `pi.sendMessage({ customType: "pi-goal.trigger", display: false, ... }, { triggerTurn: true, deliverAs: "followUp" })`. The trigger retains the current internal resume instructions and pending-prompt markers but is not owner-authored transcript content. Pi custom messages participate in model context; `before_agent_start` must continue reconciling the authoritative Goal contract.

Migrate `goal-budget-wrap-up` to the same hidden structured trigger channel: use `customType:"pi-goal.trigger"`, `display:false`, and `details.kind:"budget-wrap-up"`, while preserving its instruction content and `deliverAs:"steer"` behavior. It remains model-visible, but it is not a lifecycle transition and must not produce a card.

Keep the existing `goal-contract` behavior unchanged:

- `customType: "goal-contract"`;
- `display:false`;
- `details.version: 2`;
- latest contract supersedes earlier contracts and remains model-visible across reload and compaction.

`goal-contract` version 2 is a **model-contract schema version**. It does not version either UI payload below, and PI WEB must not inspect it.

### PI WEB owns validation and presentation

- **Repository:** [`tschuehly/pi-web`](https://github.com/tschuehly/pi-web)
- **Local target checkout:** sibling `pi-web`
- **Target branch:** `pi-workbench`; never push to `jmfederico/pi-web` upstream

PI WEB owns transport visibility, bounded parsing, deduplication, and rendering. It never reconstructs Goal semantics from prose and never writes Goal state.

Apply one visibility rule to both live events and reload: a custom message crosses the browser boundary only when `display === true`. A recognized lifecycle message renders exactly one Goal card; it must not also pass through the generic custom-message-to-SYSTEM fallback. On reconnect or reload, deduplicate the same lifecycle event by `eventId` while retaining normal transcript order.

## Presentation contracts

Both contracts use existing generic Pi channels. Their schema versions are independent of each other and of `goal-contract` version 2, even though both begin at `1`.

### Current status snapshot

Publish JSON as the value of `setStatus("goal", ...)`:

```json
{
  "schemaVersion": 1,
  "goalId": "7634074f-…",
  "objective": "The current objective",
  "state": "active"
}
```

Required fields are only `schemaVersion`, `goalId`, `objective`, and `state`. `state` is one of `active`, `waiting`, `paused`, `blocked`, `usage_limited`, or `budget_limited`. Waiting is a presentation state derived by pi-goal from its active goal plus waiting metadata. Completion emits the durable `completed` lifecycle card and then clears the `goal` status key; the transient runtime status `complete` is deliberately not published in the strict status enum. Clear the status key for every other transition that leaves no current Goal. Do not add timestamps: the session-status transport already identifies the current snapshot, and transcript entries own history.

PI WEB accepts only status schema version 1 with non-empty bounded strings and a known state. Unknown additive fields may be ignored. An unsupported or malformed JSON version is not partially interpreted.

### Lifecycle custom message

Publish each durable transition as a visible custom message:

```json
{
  "role": "custom",
  "customType": "pi-goal.lifecycle",
  "content": "Goal resumed",
  "display": true,
  "details": {
    "schemaVersion": 1,
    "eventId": "5da9…",
    "kind": "resumed",
    "goalId": "7634074f-…",
    "objective": "The current objective",
    "reason": "optional concise detail"
  }
}
```

`details` requires `schemaVersion`, `eventId`, `kind`, `goalId`, and `objective`. `reason` is optional and bounded. `kind` is one of `started`, `replaced`, `updated`, `paused`, `waiting`, `blocked`, `resumed`, `completed`, or `cleared`.

The objective is repeated because a historical card must remain understandable after a later Goal replaces or clears the current status. No timestamp or nested Goal object is needed: the durable transcript entry supplies ordering and time, while `kind` names the transition. `eventId` is generated once per semantic transition and reused across delivery retries so live/reload reconciliation cannot create duplicate cards.

`content` is a short generic fallback, not a second payload. A client that validates lifecycle schema version 1 renders the structured card instead of `content`; an older client may render the bounded fallback.

## Three separate user surfaces

1. **Status** shows current state, a one-line objective, and a short Goal ID near the composer. Expansion may show the full objective and full ID. It is replaced in place and is not history.
2. **Transcript cards** show ordered, durable lifecycle transitions. Cards are collapsed by default and expose structured details on demand. Successful start, pause, resume, and completion belong here.
3. **Notification inbox** contains only command rejection, errors, and warnings that require attention. A successful resume is not a warning. An actionable interruption may also have a transcript card, but its inbox text stays concise and does not copy the full objective or Goal contract.

Ordinary assistant messages remain ordinary assistant messages. Internal `pi-goal.trigger` messages—including the budget wrap-up steer—and `goal-contract` messages remain model-visible and UI-hidden. Internal instructions never become lifecycle cards. This separation removes both duplicate presentation and accidental SYSTEM content without suppressing generic notifications by matching their text.

## Compatibility with old pi-goal

pi-goal 0.54.7 emits free text under `extensionStatuses.goal`. If the value is not valid supported JSON, PI WEB may show that bounded string as **opaque legacy status**. It must not parse an objective, identifier, state, counters, or lifecycle from the text.

Old versions emit no `pi-goal.lifecycle` messages, so PI WEB invents no cards. Existing generic notifications continue unchanged; PI WEB must not match private strings such as `Goal resumed:` to suppress them. The generic live `display:false` filter still prevents hidden contracts from leaking as SYSTEM content. Because 0.54.7 marks `goal-budget-wrap-up` visible, it continues to fall through as generic SYSTEM content until pi-goal migrates it; PI WEB does not special-case that private custom type. If the `goal` key is absent, PI WEB shows no Goal status.

## Implementation targets

### `narumiruna/pi-extensions` on `main`

- `packages/pi-goal/src/runtime.ts`: publish the status snapshot; send resume and budget-wrap-up instructions as hidden structured triggers while preserving their respective delivery behavior; never publish transient `complete` status; retain pending-prompt, ownership, and rollback behavior.
- `packages/pi-goal/src/commands.ts`: emit cards only after successful start, replace, edit, pause, resume, and clear transitions; keep rejection and error notifications.
- `packages/pi-goal/src/tools.ts`: emit waiting and blocked transitions; on completion emit the `completed` card and clear status.
- `packages/pi-goal/src/lifecycle.ts`: restore the status snapshot without adding a duplicate lifecycle card; retain interruption warnings.
- `packages/pi-goal/src/goal-contract.ts`: preserve the hidden version-2 model contract; change only tests if production behavior needs no edit.
- Add a focused runtime smoke test covering both presentation schemas, hidden resume and budget-wrap-up triggers, the hidden contract, model visibility, one event per transition, completion status clearing, safety reset, failed-delivery rollback, reload, and compaction. `packages/pi-goal/test/goal-runtime-smoke.mjs` is a proposed location; no upstream checkout or network verification has confirmed that test path, so implementation must first place it in the package's existing test layout.

The current free-text status originates in [`GoalRuntime.updateStatus`](https://github.com/narumiruna/pi-extensions/blob/70a034c1be212dd142969f9f17f8dfc894fbdf2f/packages/pi-goal/src/runtime.ts#L567-L570).

### `tschuehly/pi-web` on `pi-workbench`

- `src/server/sessions/piSessionService.ts`: enforce `display === true` before publishing live custom messages; preserve `customType` and `details` for visible messages.
- `src/server/sessions/piSessionService.messages.test.ts`: prove hidden custom messages are absent live and visible structured messages cross once.
- `src/server/sessions/transcriptMessages.test.ts`: prove the same visibility and details after reload.
- `src/client/src/extensionStatusSnapshots.ts` and `extensionStatusSnapshots.test.ts`: parse bounded Goal status schema version 1 and apply opaque legacy fallback without prose parsing.
- `src/client/src/chatMessages.ts`, `chatMessages.test.ts`, and `components/shared.ts`: parse only valid `pi-goal.lifecycle` schema version 1 into a Goal card part; do not also emit generic SYSTEM text.
- `src/client/src/components/PromptEditor.ts` and `PromptEditor.workingMode.test.ts`: add the compact current-status surface beside existing composer controls.
- `src/client/src/components/ChatView.ts` and `ChatView.transcript.test.ts`: render one collapsed, keyboard-accessible lifecycle card with an accessible name and expandable details.

No Workbench production file changes are part of implementation; this repository records the cross-repository design and later runs its existing Chat acceptance fixture.

## Smallest first vertical slice

Fix generic PI WEB custom-message visibility before changing pi-goal.

Change only `src/server/sessions/piSessionService.ts`, `piSessionService.messages.test.ts`, and `transcriptMessages.test.ts` so `display:false` custom messages never cross the browser boundary live or after reload, while `display:true` messages retain `customType` and `details` exactly once.

This slice immediately removes the hidden-contract SYSTEM leak, is extension-generic, and does not depend on upstream pi-goal acceptance. It also makes the later hidden `pi-goal.trigger` safe for PI WEB before pi-goal starts emitting it.

## Acceptance checks

- A real blocked → `/goal resume` flow shows one current Goal status and one compact Resume card.
- Successful resume creates no warning notification and no full-objective notification.
- The full objective, rules, safety markers, and budget wrap-up instruction remain in model input through the hidden Goal contract and triggers, but none renders as a user wall, generic SYSTEM block, or lifecycle card.
- Live view, reconnect, and reload show the same visible messages; one `eventId` produces one card.
- Hidden custom messages are absent live and after reload; visible custom-message details survive both paths.
- Start, replace, edit, wait, block, pause, resume, clear, failed prompt delivery, compaction, and runtime restore produce deterministic status and cards without restore duplicates; completion emits one `completed` card and clears status without publishing transient `complete`.
- Malformed or unsupported presentation payloads do not crash the client or become partially trusted Goal data.
- Old pi-goal remains usable through bounded opaque status and existing generic notifications, with no private-text parsing.
- Upstream checks include the focused runtime smoke test at the package's verified test location, type checking, and the package's normal check command. PI WEB checks include the named focused tests and type checking. The integrated result passes `packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs`, followed by Thomas's attended blocked → resume → reload check.

## Exclusions

- No emulation of pi-goal's terminal UI, renderer, menus, or footer.
- No use or expansion of pi-goal's managed-run RPC/event bus; it is an in-process extension channel, not the PI WEB transport.
- No Workbench Controller, managed Run, Workstream, dispatch, authority, or recovery semantics.
- No new Goal REST/WebSocket endpoint and no browser-issued Goal commands.
- No parsing or suppression based on notification, prompt, assistant, or legacy status prose.

## Risks and assumptions

- **Prompt-trigger regression is the main risk.** Replacing `sendUserMessage` with a hidden `sendMessage(..., { triggerTurn: true })` must preserve follow-up ordering, workflow ownership, safety-epoch reset, failed-delivery rollback, continuation, and compaction behavior. Hiding the budget wrap-up trigger must likewise preserve its current steer delivery and model visibility.
- The package metadata and inspected source identify `narumiruna/pi-extensions/packages/pi-goal` as the upstream home; implementation assumes that repository will accept the presentation contract. Otherwise a maintained package fork would be required.
- Full objectives in `extensionStatuses` and visible lifecycle details are assumed acceptable inside the selected session's existing PI WEB trust boundary. If that assumption fails, the status/card design needs an explicit redaction policy before implementation.
- Presentation payloads are projections, not authoritative state. Consumers must tolerate missing, stale, malformed, and newer versions.
- Evidence links pin pi-goal commit `70a034c1be212dd142969f9f17f8dfc894fbdf2f` and PI WEB commit `1c6a85c56de9efa66e36880c64cba9c7ad2e0a91`; target branches may move, so implementation must revalidate the cited seams before editing.

## Primary sources

- [`resumeGoal`, including prompt delivery, rollback, and notification](https://github.com/narumiruna/pi-extensions/blob/70a034c1be212dd142969f9f17f8dfc894fbdf2f/packages/pi-goal/src/commands.ts#L203-L282)
- [Hidden Goal contract version 2](https://github.com/narumiruna/pi-extensions/blob/70a034c1be212dd142969f9f17f8dfc894fbdf2f/packages/pi-goal/src/goal-contract.ts#L4-L45)
- [`runtime.ts`, including current Goal status and budget wrap-up emission](https://github.com/narumiruna/pi-extensions/blob/70a034c1be212dd142969f9f17f8dfc894fbdf2f/packages/pi-goal/src/runtime.ts)
- [PI WEB generic notification and extension-status bridge](https://github.com/tschuehly/pi-web/blob/1c6a85c56de9efa66e36880c64cba9c7ad2e0a91/src/server/sessions/piSessionService.ts#L3887-L3940)
- [PI WEB reload visibility filter](https://github.com/tschuehly/pi-web/blob/1c6a85c56de9efa66e36880c64cba9c7ad2e0a91/src/server/sessions/transcriptMessages.ts#L4-L18)
- [PI WEB live message forwarding seams](https://github.com/tschuehly/pi-web/blob/1c6a85c56de9efa66e36880c64cba9c7ad2e0a91/src/server/sessions/piSessionService.ts#L4104-L4133) and [browser publication](https://github.com/tschuehly/pi-web/blob/1c6a85c56de9efa66e36880c64cba9c7ad2e0a91/src/server/sessions/piSessionService.ts#L5181-L5219)
- [PI WEB custom-role fallback](https://github.com/tschuehly/pi-web/blob/1c6a85c56de9efa66e36880c64cba9c7ad2e0a91/src/client/src/chatMessages.ts#L52-L71)
