# Alternatives to ping-a-human-pi (2026-10-01)

## Recommendation

Build a small Workbench extension with the same tool names, `notify_human` and `ask_human`. `ask_human` sends the question to Telegram and returns immediately, so the turn can end. When Thomas uses Telegram's **Reply** on that message, the extension wakes the session with `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })`. No existing package offers hours-long waits, a wake-up when the reply arrives, a fit with many concurrent sessions, and no per-session pairing all together. Keeping the tool names means the Working Mode Phone prompt (`extensions/working-mode/index.ts:20`) needs at most a small wording change about how replies arrive.

## Problem with the current package

Evidence comes from the installed package `~/.pi/agent/npm/node_modules/ping-a-human-pi` (0.1.1) and from the MCP server it starts, `~/.npm/_npx/0a25be2f25f896d5/node_modules/ping-a-human` (0.1.6).

- **Hard cap.** `extension/index.ts:78` sets `REQUEST_TIMEOUT_MS = 600_000` for every JSON-RPC request. The server does honor `timeoutMs` (`dist/tools.js:17,25`; its default is 5 minutes), but the Pi-side client rejects at 10 minutes either way.
- **`choices` is dropped.** For `ask_human`, the Pi extension replaces the server's schema with `{question, timeoutMs}` only (`extension/index.ts`, `registerTool` parameters). Telegram buttons are therefore unreachable from Pi.
- **Cross-talk between sessions.** Every Pi process starts its own `npx ping-a-human`. Each one long-polls `getUpdates` on the same bot. Each accepts *any* text in the chat as the answer, without reply-to matching, and confirms the offset (`dist/channels/telegram.js` `awaitReply`). With two concurrent asks, one session either steals the other's answer or gets a 409 error, which `api()` throws as a tool error.
- **No async wake.** The tool blocks the turn. The session stays busy until the answer or the timeout.
- **Features Thomas does not use.** `~/.pi/agent/ping-a-human.json` has `notify.enabled=false` and `approval.enabled=false`. Only the tools and `/ping` are in use.
- **Upstream is inactive.** [startriseio/ping-a-human](https://github.com/startriseio/ping-a-human) has 2 stars. All commits landed on 2026-06-14 (last push 22:11Z). It has 0 issues and 0 PRs, so nothing is open about the cap. ping-a-human-pi was last published on 2026-06-14.

## Comparison

Sources: the npm registry (`npm view`, 2026-10-01), the Pi catalog snapshot `docs/research/generated/pi-packages-index.json` (fetched 2026-07-28, about 5,400 packages; downloads are monthly as of that date), tarballs unpacked under `$PI_TMP` (since deleted), and GitHub through `gh`.

| Name | Link | Maintenance | Long wait (hours) | Async wake on reply | Setup cost / fit |
| --- | --- | --- | --- | --- | --- |
| ping-a-human-pi (current) | [startriseio/ping-a-human](https://github.com/startriseio/ping-a-human) | Inactive since 2026-06-14; 58 dl/mo | **No**: hard 10-minute cap | No (blocking) | Installed. Cross-talk across sessions. |
| ping-a-human server through **pi-mcp-adapter** (already installed, 3.2.0) | `~/.pi/agent/npm/node_modules/pi-mcp-adapter/README.md` | Adapter active | **Yes**: `requestTimeoutMs` per server; the server honors `timeoutMs` | No (blocking) | Config only (`directTools`, `toolPrefix: "none"`). But `extensions/tool-groups` hides every pi-mcp-adapter tool until `tools_enable({group:"mcp"})`, so Phone mode needs a change. Cross-talk remains. |
| Patch or fork ping-a-human-pi | same | You own it | Yes: a one-line change to use per-call `timeoutMs` and drop the global cap | No | ~15 minutes to patch. A patch in node_modules is lost on update; a fork means maintaining an MCP-in-a-subprocess design. Cross-talk and the dropped `choices` remain. |
| @bytesbrains/pi-telegram-bridge 1.4.1 | [bytesbrains/pi-telegram-bridge](https://github.com/bytesbrains/pi-telegram-bridge) | Last publish 2026-07-08; 423 dl/mo | Yes: `telegram_ask` `timeoutMinutes` (default 30) | Partial: a background listener forwards every chat message through `sendUserMessage` with no `deliverAs`, which throws while streaming | Env vars only. About 2.3k LOC with issue/standup templates and commands. One poller per session, so several sessions conflict. |
| pi-afk 0.1.0 | [HamdiMaz/afk](https://github.com/HamdiMaz/afk) | One release, 2026-05-20; 42 dl/mo | Yes (blocking queue; no timeout found) | No | `/afk` per session. A bot-token lock means only one AFK session at a time. |
| @zylab/pirelay 0.10.0 | [zikolach/pirelay](https://github.com/zikolach/pirelay) | Active (2026-08-02); 204 dl/mo | Yes: the agent ends the turn with a question and the reply becomes the next prompt | **Yes**: idle reply → prompt; busy → `followUp`. Local broker for many sessions. | `/relay setup` and **`/relay connect` per session**. Plain replies go to the *selected* session (`/use`, `/to`), which risks misrouting across many sessions. A broad remote-control surface. |
| @llblab/pi-telegram 0.51.6 | [llblab/pi-telegram](https://github.com/llblab/pi-telegram) | Very active (2026-09-27); ~9.8k dl/mo | Yes (the conversation itself is the channel) | **Yes**: Telegram text is a normal turn. Threaded Mode gives one thread per Pi instance. | `/telegram-setup`, `/telegram-connect`, and BotFather Threaded Mode. About 95k TS LOC (7.5 MB) and bundled skills. Mirrors activity to Telegram. Deletes old threads after 26 bindings. Heavy for "notify and ask". |
| @jetmiky/pigram 0.2.14 | [jetmiky/pigram](https://github.com/jetmiky/pigram) | Active (2026-08-31); 1.6k dl/mo | Yes | Yes (chat → session) | A per-bot lock means **one session per bot**. Not multi-session. |
| @wienerberliner/pi-postbox 0.5.7 | [dasomji/pi-postbox](https://github.com/dasomji/pi-postbox) | Active (2026-09-10) | **Yes**: durable questions in SQLite | **Yes**: answer auto-wake on by default; `wait_for_postbox` | **No Telegram.** The phone surface is a web PWA or Android app over Tailscale; there is no app-level auth. Needs a local server (autostart). Large tool surface (`write_question`, `get_questions`, …). |
| alexchexes/ask-human (MCP, Python) | [alexchexes/ask-human](https://github.com/alexchexes/ask-human) | Last push 2026-08-29; 2 stars | Yes: `--timeout-seconds` (tested 24 h) | No (blocking) | Through pi-mcp-adapter. Its **local broker per bot plus Reply matching** fixes cross-talk. Needs `uvx`. Same tool-groups hiding issue as above. |
| sshkeda/pi-ask-agi (reference only) | [sshkeda/pi-ask-agi](https://github.com/sshkeda/pi-ask-agi) | Last push 2026-04-28; not on npm | Yes | **Yes**: returns at once, matches by Reply, wakes through `sendUserMessage` | Different purpose (frontier-model relay). About 22 KB of TypeScript (index plus telegram channel); a useful template for the own extension. |
| **Own Workbench extension** | (to build) | Owned | **Yes** | **Yes** | See the cost estimate below. |

Also scanned and rejected because they are notify-only or single-session remote control: `@wienerberliner/pi-telegram`, `avtc-pi-notification`, `@pi-unipi/notify`, `@brain0pia/pi-notify`, `pi-telebridge`, `pi-telegram-manager`, `pitgram`, `@gamalan/pi-gateway`, `pi-chaos-relay`, `@agentapprove/pi` (tool approval on iPhone only), `pi-bash-confirm`.

## How Pi supports async wake

- Pi 0.87.1 (`/Users/tschuehly/.pi-workbench/installed/pi-web-d82b92e8bec7/node_modules/@earendil-works/pi-coding-agent`) provides two ways: `pi.sendMessage(msg, { triggerTurn, deliverAs: "steer"|"followUp"|"nextTurn" })` and `pi.sendUserMessage(content, { deliverAs })` (`dist/core/extensions/types.d.ts:300-304`). The examples are `examples/extensions/file-trigger.ts`, which watches a file and calls `sendMessage` with `triggerTurn: true`, and `send-user-message.ts`.
- The installed `pi-process-monitor` already wakes sessions this way (`extensions/monitor/runtime.ts:66-68`, `triggerTurn: true, deliverAs: "steer"`).
- PI WEB runs extensions inside the `sessiond` daemon. A grep of `~/IdeaProjects/pi-web.installed/src/server/sessiond*` found no idle-session eviction, so a timer or poller in an idle session should survive a closed browser tab. **Not confirmed by a live test.**

## Cost of an own extension

The estimate is about 150–250 lines of TypeScript plus one test, roughly half a day to a day:
- `notify_human(message)`: one `sendMessage` call. Optionally keep `/ping`.
- `ask_human(question, choices?)`: send the message with `reply_markup` (a ForceReply or buttons), record `{message_id, sessionId}` with `pi.appendEntry`, and return "asked; the reply will arrive as a message".
- A poller in each session: run `getUpdates` with `timeout=0` every ~20 s, **without confirming the offset**. Keep only updates whose `reply_to_message.message_id` (or callback message id) matches this session's pending questions. On a match, call `pi.sendMessage({customType:"human-reply", content, display:true}, {triggerTurn:true, deliverAs:"followUp"})`, then mark the question answered.
  - Known ceiling to mark with a `ponytail:` comment: Telegram keeps unconfirmed updates for at most 24 h, and `getUpdates` returns at most 100. Upgrade to a single lock-file leader writing per-session inbox files if volume or 409s become a problem. Unverified: whether overlapping short polls still return 409.
- Restore pending questions on `session_start` from the session entries, so a restart does not lose the wait.
- Reuse the token and chat id from `~/.config/ping-a-human/config.json`, or move them into an env var.
- Repository rules apply: run `node scripts/context-usage.mjs` before and after (it is a new startup tool), develop in a dev worktree, and update the Phone wording in `extensions/working-mode/index.ts:20`, which currently requires a finite `timeoutMs`.

Patching instead costs about 15 minutes, but it fixes only the cap. The blocking design, cross-talk, and dropped `choices` remain, and an inactive upstream makes a merged fix unlikely.

## Not confirmed
- Whether pi-mcp-adapter's `lazy` idle disconnect can cut an in-flight call that waits for hours (README only).
- Whether children spawned by the Workbench subagent load ping-a-human-pi and add more `getUpdates` pollers (no reference to it found in `extensions/subagent`).
- PI WEB idle-session lifetime (code grep only, as noted above).

## Wider search 2026-10-01

### Updated recommendation

- Still no existing package meets every criterion: waits of hours, waking the right session, many concurrent sessions, and support in both Pi CLI and PI WEB. Keep the plan to build the own `ask_human`/`notify_human` extension.
- New finding: PI WEB already ships the async half. Its built-in `ask_user` (`~/IdeaProjects/pi-web.installed/src/server/sessions/askUserTool.ts`) ends the run, stores the ask in the daemon (`pendingAskStore.ts`), and wakes *that* session when the answers arrive. Two pieces are missing: a push to the phone (only an in-page `desktopNotificationController.ts` was found, with no service worker or web push) and access to PI WEB from the phone (PI WEB docs recommend Tailscale, NetBird, or WireGuard).
- If Phone mode in PI WEB can accept "the push links to PI WEB, and the answer is given there", the own build shrinks to a notify-only push. Telegram reply-matching would then be needed only for the CLI. Pinet is the strongest off-the-shelf option, but only if Slack is acceptable.

### Method

Sources: the catalog snapshot `docs/research/generated/pi-packages-index.json`, filtered by a channel/HITL regex; `npm search` for packages published after the snapshot (through 2026-10-01); `npm pack` tarballs read under `$PI_TMP` and since deleted; `gh api repos/...` for stars and last push; and web search for MCP servers and Claude/Codex/OpenCode tools. Wake behavior comes from grepping each tarball for `sendUserMessage`, `triggerTurn`, and `deliverAs`. Nothing was installed or run live.

### Comparison (new candidates only)

| Name | Link | Maintenance | Long wait / async wake | Multi-session without crossing | CLI + PI WEB | Setup / privacy | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **PI WEB built-in `ask_user`** | `pi-web.installed/src/server/sessions/askUserTool.ts` | Owned (sibling repo); last change 2026-07-30 | **Yes / yes**: the ask is daemon-owned; the tool returns `terminate: true`; answers come back as a follow-up that wakes the session | **Yes**: one pending ask per session | **PI WEB only** | Zero install. Self-hosted. The phone must reach PI WEB over a VPN. **No phone push.** | Best base for PI WEB. Add a push carrying a session link. |
| **@pinet/slack-bridge** 0.2.21 | [gugu91/pinet](https://github.com/gugu91/pinet) | Active (push 2026-09-30); 17★; 51 open issues; ~32k LOC | Yes / yes: per-agent inbox kept across restarts; `sendUserMessage`, with `steer` when busy | **Yes**: one broker holds the Slack socket; followers get messages routed by thread ownership | Both (extension; PI WEB not tested) | Slack app from a manifest, 2 tokens, `runtimeMode`/`autoFollow`. **~30 `slack_*` tools** (large context cost). Slack SaaS. | Closest off-the-shelf fit. Heavy, and requires Slack. |
| @arvoretech/pi-slack-bridge 1.5.2 (+ `@arvoretech/pi-ask-user-question`) | [arvore-pi-extensions](https://github.com/arvoreeducacao/arvore-pi-extensions) | Last publish 2026-07-20; repo pushed 2026-09-29; 12★ | Yes / yes: a thread reply becomes `sendUserMessage` (steer when busy); `ask_user_question` gets Slack buttons | **No**: each session opens its own Socket Mode connection (`dist/slack.js`), and Slack sends each payload to *any* open connection ([Slack docs](https://docs.slack.dev/apis/events-api/using-socket-mode)), so replies can reach the wrong process. Limit is 10 connections. | Both | Slack app plus 3 env vars. Mirrors every tool call into Slack. Slack SaaS. README in Portuguese. | Reject for many sessions. |
| pi-discord-remote 0.2.4 | [t2o2/pi-discord-remote](https://github.com/t2o2/pi-discord-remote) | Stale (2026-05-20); 2★ | Partial: channel text becomes `sendUserMessage` with no `deliverAs` (throws while streaming); `discord_ask_user_question` has a hard 5-minute cap (`dist/index.js:709`) | Yes in principle: one auto-created channel per session, filtered by `channelId` | Both | Manual `/pi-discord-remote start` in each session. Needs Manage Channels. Discord SaaS. | Reject: stale, 5-minute cap. |
| @comput/pi-telegram 0.6.1 | [comput-sh/pi-telegram](https://github.com/comput-sh/pi-telegram) | Active (2026-09-27); 0★ | Yes / yes (`followUp`/`steer`) | Only with **one BotFather bot per session** (README: "A bot belongs to one persistent Pi session") | Both | Pairing code per bot. Telegram. | Reject: one bot per session does not scale. |
| remote-pi 0.7.0 | [jacobaraujo7/remote_pi](https://github.com/jacobaraujo7/remote_pi) | Very active (2026-10-01); 418★; 57 issues; ~18k LOC | Remote control: the phone sends prompts; `triggerTurn`/`followUp`. No ask/notify tool. Push not confirmed. | Yes (local UDS broker, per-agent addressing) | Both (not tested) | iOS/Android app plus a relay. The default community relay sees plaintext; Docker self-host recommended. | Possible companion app; does not replace `ask_human`. |
| @self-deprecated/pi-agent-tick 1.4.0 | [npm](https://www.npmjs.com/package/@self-deprecated/pi-agent-tick) (GitHub repo returns 404) | Last publish 2026-06-22 | Long wait yes (`PI_AGENT_TICK_TIMEOUT_MS` default 0 = unlimited), but **blocking** | Yes (per-request ids) | Both (local prompt plus remote race) | `agent-tick login`. Hosted Agent Tick app; self-hosting **not confirmed**. | Reject: blocking, SaaS, no public repo. |
| @aalzubidy/pi-signal 1.1.1 | [aalzubidy/pi-signal](https://github.com/aalzubidy/pi-signal) | 2026-07-07 | Yes / yes: a Note-to-Self becomes a `followUp` prompt | **No**: `PI_SIGNAL_PRIMARY` marks a single handling instance | Both | signal-cli, Java 25+, systemd. Best privacy (Signal E2E, self-run). | Reject: single session. |
| pi-messenger-bridge 0.4.0 | [tintinweb/pi-messenger-bridge](https://github.com/tintinweb/pi-messenger-bridge) | Stale (2026-05-09) | Yes / yes (`followUp`) | **No**: PID lock `~/.pi/msg-bridge.lock` | Both | Telegram/WhatsApp/Slack/Discord/Matrix | Reject: single session. |
| pi-hail 0.7.0 | [schuettc/pi-extensions](https://github.com/schuettc/pi-extensions) | Active (2026-09-29) | Phone prompts and permission answers | Per pane | **CLI only**: needs an interactive TUI pane in tmux, the hail daemon, and a forked permission system | Hail phone app | Reject: no PI WEB. |
| ntfy notifiers: pi-ntfy 1.0.3, @xyzensun/pi-notify 3.0.0, @pi-unipi/notify 2.20.5 | [pi-ntfy](https://git.ipao.vip/rogee/pi-ntfy), [ryanchan720/pi-desktop-notify](https://github.com/ryanchan720/pi-desktop-notify), [Neuron-Mr-White/unipi](https://github.com/Neuron-Mr-White/unipi) | Active (2026-09) | **Notify only**: no reply path. unipi re-sends unanswered `ask_user_prompt` events. | n/a | Both | ntfy can be self-hosted; unipi also supports Gotify/Telegram | Candidate for the push half of the PI WEB `ask_user` route. Not tested whether unipi's `ask_user_prompt` fires for PI WEB's `ask_user`. |
| **nofax** 0.2.43 (CLI + stdio MCP) | [AKzar1el/nofax](https://github.com/AKzar1el/nofax) | Active (2026-09-24); 0★; MIT | Request ids are stored durably in `~/.nofax/requests`. `nofax_wait_for_response` is bounded to **240 s** (`src/mcp-tools.mjs:16`), so the model must keep polling. **No wake.** | **Yes**: one-time ntfy response topic per request | Both, through pi-mcp-adapter (tool-groups hiding applies) | ntfy (self-hostable), no account. Buttons limited to 3 choices. Free text needs an iOS Shortcut ("Nofax Refine"). | Best MCP option, but polling plus awkward free-text replies. |
| gotoHuman MCP | [gotohuman/gotohuman-mcp-server](https://github.com/gotohuman/gotohuman-mcp-server) | Active; 52★ | Returns `reviewId` at once; the result arrives **only by webhook**, and there is no get-result tool | Yes | MCP | SaaS (app.gotohuman.com); needs a public webhook receiver | Reject. |
| HumanLayer | [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) | README: "the code here is pretty much all deprecated"; rebuilt as hosted humanlayer.com / CodeLayer | n/a | n/a | n/a | SaaS | Reject. |
| ntfy MCP servers: ntfy-mcp-server 2.3.5, @ni-c/ntfy-mcp 0.3.0 | [cyanheads/ntfy-mcp-server](https://github.com/cyanheads/ntfy-mcp-server), [ni-c/ntfy-mcp](https://github.com/ni-c/ntfy-mcp) | Active (2026-09) | Send, plus reading cached messages (polling). No reply UX. | n/a | MCP | ntfy self-hostable | Notify-only via MCP. |
| yashok111/telegram-mcp (Claude Code) | [yashok111/telegram-mcp](https://github.com/yashok111/telegram-mcp) | 2026-09-01; 0★ | Inbound arrives as Claude Code *channel* notifications | **Yes**: one daemon owns the poller; one shim per session; routes by forum topic, then reply-to, then `@sN` mention | **Not usable**: Linux-only Go binary, and pi-mcp-adapter consumes no custom server notifications (README covers only `tools/list_changed`) | Self-hosted | **Reference design** for the "single poller plus per-session inbox" upgrade path noted above. |
| Claude Code Channels (official, research preview) | [docs](https://code.claude.com/docs/en/channels) | Anthropic | Push into a running session | One poller per bot token; open issues about messages not surfacing ([#38110](https://github.com/anthropics/claude-code/issues/38110)) | Claude Code only | Telegram/Discord plugins | Confirms the pattern. The Pi equivalent is `pi.sendMessage(..., {triggerTurn})`. |
| Happy | [slopus/happy](https://github.com/slopus/happy) | Very active; 24k★ | Push notifications, E2E encryption, self-hostable relay. `happy acp -- <cmd>` runs any ACP agent, so Pi through `pi-acp` is possible (**not confirmed**). | Yes | **No**: Happy must launch the session, so it cannot attach to PI WEB or existing CLI sessions | iOS/Android/web apps | Reject for Workbench sessions. |
| kokhp/claude-tg; OpenCode teleprompt-style plugins | [kokhp/claude-tg](https://github.com/kokhp/claude-tg), [bcanozgur/opencode-plugin-teleprompt](https://github.com/bcanozgur/opencode-plugin-teleprompt) | 2026-09 / various | Hook plus daemon; numbered sessions; swipe-reply routes to the right terminal (macOS) | Yes (`#N` labels / one channel per session) | Claude/OpenCode hooks only | Telegram | Pattern only: label each question with the session and match on reply. |

Also scanned and rejected because they drive their own Pi process instead of attaching to Workbench sessions: `pi-courier` (Matrix, `pi --mode rpc`) and `@hahahhh/pi-coordinator` (spawns pi in Telegram forum topics). Also rejected as local-only: `@howaboua/pi-ask`. Its `delivery: "steer"` returns at once and delivers the answer later, which is the same shape as the planned design.

### Effect on the build estimate

- **PI WEB route.** An extension listens for `ask_user` tool calls (or PI WEB's attention event) and sends one push through Telegram `sendMessage` or ntfy, with a PI WEB deep link. Roughly 30–60 lines. Answers use PI WEB's existing durable ask.
- **CLI route** (and answering inside Telegram): the earlier 150–250-line estimate stands. When volume grows, the upgrade from per-session short polls is the telegram-mcp design: one poller daemon plus per-session inbox files, routed by reply-to.

### Not confirmed (wider search)
- Whether PI WEB's `ask_user` is registered in Workbench sessions that also load ping-a-human-pi, and how the Phone prompt should choose between them.
- Whether PI WEB is reachable from Thomas's phone today.
- Pinet's behavior under PI WEB's `sessiond`, and its startup token cost (not measured with `scripts/context-usage.mjs`).
- Agent Tick's hosting model; Happy plus `pi-acp`.
