# Workbench UI plan

**Current state:** the Workbench client in the PI WEB fork (`origin/pi-workbench`) is Thomas's daily
Chat surface: several Chats per window in Tabs or Grid, a Workstream chooser, a Files pane and
in-composer questions. Further work follows the owner direction of 2026-11-07 below and friction
from real use.

This plan replaces the archived PI WEB shell, plugin-customization, unified-navigation, and
prototype-fidelity plans.

## What the client is

A native macOS window (`apps/pi-web-macos/`) hosts the Workbench web client, which owns a per-window
working set of Chats. Each Chat is one PI WEB session.

```text
Pi Workbench.app window
  -> Workbench client (Tabs or Grid of Chats, chooser, Files)
  -> PI WEB HTTP/WebSocket clients
  -> PI WEB server and session daemon
  -> Pi sessions
```

## What shipped

### Windows, tabs and Grid

- A window holds several Chats. With one Chat it shows a slim bar (status, title, Workstream, tools,
  Add); a second Chat turns it into a Grid. `⌃G` toggles Grid and Tabs.
- **Tabs** use one tinted row: the Chat tabs share it with the Chat menu, Add and Grid/Tabs. A
  Workstream row appears only when two or more Workstreams are open; Chats without a Workstream are
  top-level tabs. Crowded rows scroll the tabs only.
- **Grid** tiles are uniform, resizable by dragging dividers (kept per window), page when crowded,
  and carry a tinted Workstream edge and title. Focus never reshapes tiles; each Chat stays mounted
  with its transcript, draft, questions and scroll.
- Each Chat is owned by exactly one window; Chats move between windows by menu or drag. A new window
  starts empty. The macOS app restores windows, frames and working sets on relaunch. Native AppKit
  tabbing stays disabled; tabs belong to the web client.
- Files, session tree, session info, Workbench settings (scale, theme, density) and notifications
  live in one Chat menu.

### Chooser and Workstreams

- The chooser lists open Workstreams as re-entry cards: goal, next action and actor, open-question
  warnings, live-session dots, and a distinct colour per Workstream. Open Human Tasks are answerable
  from the card and recorded in the Workstream store.
- **Open session** resumes the session that wrote the newest checkpoint; a new Chat can start inside
  a Workstream. New Chats remain standalone PI WEB sessions unless started from a Workstream.

### Transcript and composer

- Every transcript kind lines up on one left rail: no bubbles, a 3px bar whose colour names the kind
  (you, assistant, technical step, failure, question, notice), and one fold chevron everywhere.
  Tool usage folds; thinking stays visible; a single routine step is its own row.
- Composer: PI WEB's Prompt Editor with Enter to steer, queue promotion, Stop returning queued text,
  Working Mode controls in reach, and per-message Revert to here / Edit and resend.

### Questions

- `ask_user` posts asynchronous question sets. They appear as chips above the composer with a short
  Markdown context drawer, and tabs show open-question counts. The chips replaced the earlier
  per-Chat Questions pane.
- `request_attention` marks a tab as needing Thomas until he views the Chat or sends it a message,
  and raises a "Needs you" desktop notification routed to the window that owns the Chat.

### Files

- A toggleable right-hand pane with a lazy file tree and search-backed filter (`⌘P`), and one
  CodeMirror live editor (Markdown Live/Raw, code with line numbers).
- While a file is open, agent edits appear inline as reviewable hunks. `⌘S` saves against the loaded
  version; a conflicting save or deleted file keeps Thomas's text. Switching files, Chats or machines
  never drops unsaved edits.
- Chat links with line ranges open the file at those lines. Images, PDFs and local videos (HTTP
  Range) preview in the pane; other binaries offer Show in Finder or Download.

### Activity and session lifetime

- The Activity roster starts collapsed and shows one line per delegate: state, model nickname and
  effort letter, its own `report_status` line, freshness, and elapsed time.
- A session daemon restart records sessions interrupted mid-turn and resumes each with a quiet
  restart notice. Sessions idle for two hours with no background work unload.
- Model-callable bash runs in the background with Activity status and compact completion cards.

## Owner direction (2026-11-07)

Intended state, decided by Thomas on 2026-11-07 ([Decision 162](../foundation/decisions.md)):

- **Base:** PI WEB plus Pi Durable stays the base; T3 is not adopted as a base. Borrow T3
  mechanisms where they help: GitHub credential and API patterns, HTML render and preview, and
  sidebar attention states. Keep T3's MIT notice with any copied code.
- **Phone access:** after the Durable rebuild, PI WEB on the phone over Tailscale. No separate
  pocket client.
- **GitHub:** deferred inside Workbench; agents keep using the `gh` CLI.
- **Teammate distribution (Embabel):** after the base settles.
- **Learning loop:** Thomas's manual export, run on request only. No API source and no schedule.

## Not built

- GitHub review or PR views inside Workbench (deferred, above)
- Phone client before the Durable rebuild
- Terminal and editor tabs
- Message trees or child-execution inspectors beyond the Activity roster
- Shell profiles, plugin-composed layout, dashboards, or portfolio views
- A native Swift Chat implementation
- A redesign of PI WEB authentication, persistence, server, or session daemon

Choose later work from friction observed in actual use, not from an archived backlog or prototype
matrix. Historical designs may provide evidence; they do not create scope.

## How each change ships

1. State the user-visible outcome and behavior that must remain unchanged.
2. Implement the smallest complete path through real PI WEB runtime seams.
3. Run the controlled no-model fixture and the PI WEB e2e specs for the touched area
   (`e2e/workbenchWindows.spec.ts`, `e2e/workbenchFiles.spec.ts`).
4. Thomas accepts it in installed use.

## Automated verification

Use `packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs` for the client. Keep
its isolated `HOME`, data, session, socket, port, and browser roots.

Run it from the Workbench repository:

```sh
root="$PI_TMP/workbench-chat-acceptance-$$"
test ! -e "$root"
node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs \
  --pi-web-root ../pi-web \
  --root "$root"
```

Acceptance requires a passing run and removal of the owned runtime root and processes. The fixture
proves:

- a fresh window shows the chooser, not the legacy PI WEB shell;
- new and existing sessions use the correct complete identity;
- two windows remain isolated;
- stale file saves are rejected; and
- closing, reloading, or replacing the client leaves other sessions and the session daemon running.

## Chat stories from attended use

One row per story in [requirements](../foundation/requirements.md) "Chat presentation and control".
When Thomas changes a story, rewrite the requirement in place and update this row; do not append a
second entry for the same want.

| Story | Status |
| --- | --- |
| 16 Conversation-shaped transcript | **shipped and accepted.** Bubbles and secondary thinking shipped in the PI WEB fork (`2e372184`); flat transcript with tool-only folding shipped earlier (`fe7fbbea`); Thomas accepted it in attended use on 2026-09-21 |
| 17 No hidden history | **shipped.** Earlier conversation stays expanded (`e70d71a8`), and the scroll-to-newest control shipped with the live tail in `208de9f4`, appearing only once the transcript is unpinned from the bottom; this row previously recorded it as not built |
| 18 Working Mode in reach | shipped in the PI WEB fork (`b1cc738b`), replacing the separate bar from `89c31764` |
| 19 Interface scale | shipped in the PI WEB fork: scale preference and Settings control (`44ee94b6`), Cmd +, Cmd -, and Cmd 0 in the Workbench shell, which also applies the presentation profile at startup for the first time (`5509fe33`); the Workbench shell now has its own settings panel carrying scale, theme, and density (`51349e14`) |
| 20 Return to an earlier message | shipped in the PI WEB fork: entry ids reach the client (`4aaf0d7a`) and each message carries Revert to here, with Edit and resend on the owner's own messages, alongside the session-tree navigator the Workbench shell never rendered (`63ebdfc8`) |
| 21 Truthful queue and steering | shipped and verified end to end after the daemon restart on 2026-09-21 (`32ed0ad4`, `208de9f4`): queue order preserved, Send now and Send all now return 200, Stop returns queued text to the composer, Enter steers while the secondary action queues |
| 22 Human sessions first | shipped in the PI WEB fork (`d09da87f`) |
| 23 Legible delegated work | Thomas rejected raw task previews and inferred "thinking" in installed use. The source now shows name, role/model, and the child's own `report_status` line (or an explicit missing-report state); every new child profile can call that tool and is instructed to report at work start and material phase changes. Installed acceptance pending |
| 24 Fast, durable session entry | **closed** on 2026-09-21. Routed reload recovery shipped (`76d859d3`). Session-open latency was measured and not reproduced: click-to-first-message was 113–155 ms for 37-, 249-, and 509-message sessions, a deep-link reload rendered the full transcript in ~240 ms, and the API answered `messages` in 8–20 ms, so no optimisation was made and Thomas closed the story. Reopen only with a concrete slow case |
| 25 Readable on every surface | the Workbench shell now applies the theme and follows `prefers-color-scheme` live (`ece7c4d1`); border-to-surface contrast raised from 1.4–1.8:1 to at least 3:1 in every theme, guarded by a WCAG test (`09a79b07`); `--pi-border-muted` now means hairline separators only, with 21 interactive boundaries moved to `--pi-border` (`828e182c`); the `index.html` inline fallback matches the default `github-dark` theme value for value, guarded by a test that parses the `:root` block (`04694c84`); the phone layout is verified and fixed (`83f249f3`): the workspace select no longer stretches the chooser card past the viewport and hides Settings, Working Mode's Checking options stay reachable, the shell honours safe-area insets, and nothing overflows at 320, 360, 390 or landscape |
| 26 Live work visible from the overview | shipped in the PI WEB fork (`947ab6bf`): the Workbench shell now passes the per-session status and activity it already receives into the Workstream chooser and All sessions, showing a live dot and what each session is doing; a collapsed row now carries the same indicator (`cfdd5b53`), which needed no Workstream-store or protocol change: the client inverts the lookup and resolves each live session's Workstream through the existing `listWorkstreams({ sessionId })` query, once per session rather than per render, forgetting an unmatched or failed lookup so a session that joins a Workstream later still lights up |
| 27 Workstream colour identity | shipped in the PI WEB fork: distinct colours in creation order with the Workstream title in Grid tile bars (`b98e8064`), tinted tab row and tiles (`617e64e9`, `a7752684`); installed acceptance not recorded |
| 28 Automatic Workstream re-entry | source wiring under review: only a newly confirmed linked Chat after a three-hour `user`-role interval invokes full orientation; existing Chats and saved continuation drafts remain untouched; installed acceptance pending |
| 29 Transcript role filter | owner revised the filter: Everything by default, filter-icon choices Human only, Assistant only, and Human + Assistant; the latter two exclude assistant thinking, tool calls and results. Source revision and installed acceptance pending |

| 30 Responsive shell work | shipped in Workbench: model-callable bash runs in the background with Activity status (`b4cda2e`), foreground calls continue in the background after 30 seconds (`d5cde77`) |

Decisions already taken: Resume opens the existing session; modes stay guidance only; the
Workstream-level overview replaces the earlier `goal.set` idea; the ten-variant launcher prototype
and the context-view prototypes are superseded by the shipped card and the `agent-audit` explorer.

## Ownership

- **macOS wrapper:** native windows, application menus, same-origin hosting, lifecycle status, and
  window creation. It does not own session state.
- **Workbench web client in the PI WEB fork:** window working sets, Tabs and Grid, the chooser,
  Chat, questions, and Files composition.
- **PI WEB runtime:** projects, workspaces, sessions, transport, reconnect, authentication, files,
  Git, terminals, remote machines, packaging, and lifecycle.
- **Pi Workbench protocols:** authoritative Workstream and future Run state. The client renders typed
  projections and receipts; Chat text and visual state never become authority.

## Supporting evidence

- [PI WEB reuse boundary](../integrations/pi-web/reuse-boundary.md)
- [Owner-observed UI failure and retained lessons](../research/reports/workbench-ui-reset-2026-08-28.md)
- [Archived UI plans and their disposition](../archive/pi-web-ui/README.md)
