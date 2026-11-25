# Provider usage panel

**Status:** proposal, not started (2026-11-25).

**Recommendation:** add a **Usage** side pane to the Workbench shell, next to Files. It shows the
subscription limits for Codex, Claude, Grok, GitHub Copilot and Gemini. A Workbench-owned snapshot
script fills it. The script reads Pi's own sign-ins from `~/.pi/agent/auth.json` and calls each
provider's usage endpoint. Port the endpoint code from MIT-licensed pi packages; do not install them.
Do not wrap CodexBar: its CLI returned no data for any of the five providers when Pi ran it.

## What the owner sees

- Chat menu → **Usage** opens a pane beside the Chat, the same way **Files** does.
- One row per provider: plan name, one bar for each limit window (e.g. Claude "5 h: 42 %, resets 14:10"
  and "7 d: 63 %, resets Fri"), and credits where the provider reports them.
- A provider without a Pi sign-in shows **Sign in needed** and the exact command, e.g.
  `/login github-copilot`. A failed fetch shows its error and when the last good value was read.
- A refresh button. Otherwise the pane reuses a cached snapshot that is at most 5 minutes old.

## Data source per provider

| Provider | Endpoint (unofficial) | Credential | Port from |
| --- | --- | --- | --- |
| Codex (ChatGPT plan) | `GET chatgpt.com/backend-api/wham/usage`: primary and secondary window, used %, reset time, credits | Pi `openai` OAuth (signed in now) | `@mtrojnar/pi-usage` 0.2.1, `@narumitw/pi-usage` |
| Claude (Max/Pro) | `GET api.anthropic.com/api/oauth/usage`: 5-hour, 7-day and 7-day-Opus utilization and reset time | Pi `anthropic` OAuth (signed in now) | `@mtrojnar/pi-usage`; the existing `quota-snapshot-cache.mjs` 10-minute cache exists because this endpoint rate-limits |
| Grok (SuperGrok) | `GET /v1/user`, then `GET /v1/billing?format=credits` (Grok Build billing surface) | Pi `xai-auth` or `xai` OAuth (not signed in) | `~/IdeaProjects/pi-xai-oauth/extensions/xai/usage.ts` (`/xai-usage`, already in Thomas's Pi packages) |
| GitHub Copilot | `GET api.github.com/copilot_internal/user`: `quota_snapshots.premium_interactions`, reset date | Pi `github-copilot` OAuth (not signed in); possible fallback: `gh auth token` | `pi-copilot-usage` 1.0.0, `@latentminds/pi-quotas` |
| Gemini (Gemini CLI plan) | `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` after `loadCodeAssist` finds the project: remaining fraction and reset per model | Pi `google-gemini-cli` OAuth (not signed in) | `@javargasm/pi-usage-bars` 0.2.1 |

Pi's `auth.json` currently holds only `anthropic` and `openai`. Copilot, Grok and Gemini start in
the **Sign in needed** state until Thomas signs in to them in Pi.

## Design

1. **Snapshot script.** `scripts/usage-snapshot.mjs` (Pi Workbench) fetches all five providers in
   parallel, each with a 15-second timeout. It writes a normalized JSON file to
   `~/.cache/pi-workbench/usage.json` (mode 0600). It uses the same lock-and-rename caching as
   `skills/model-orchestration/scripts/quota-snapshot-cache.mjs`. Each entry holds `provider`,
   `status` (`ok`, `sign-in-needed` or `error`), `plan`, `windows[]` (`label`, `usedPercent`,
   `resetsAt`), optional `credits`, `checkedAt` and `error`. Tokens never enter the snapshot.
   Expired tokens are refreshed through Pi's auth store and lock, as
   `packages/durable-pilot/src/providers.ts` already does, so the script never races Pi's own writes.
2. **Server route.** The PI WEB fork serves `GET /api/workbench/usage` (`?refresh=1` forces a
   fetch). The route runs the script from the installed Workbench checkout and returns its JSON.
   Credentials stay on the server.
3. **Pane.** In the PI WEB fork, `WorkbenchApp.sidePane` grows from `"files"` to
   `"files" | "usage"`. A new `workbench-usage-pane` renders the rows. It reuses the Files pane's
   width, open and close behaviour, and the Chat-menu entry pattern.
4. **One shared consumer.** Model orchestration reads the same snapshot. Today it reads two
   sources, and neither works from Pi:
   - `quota-axi`, which is not on `PATH`, so the Claude quota startup check
     (`extensions/quota-startup`) cannot read telemetry;
   - CodexBar's `widget-snapshot.json` (`references/checking.md`), which Pi's Node process cannot
     read: macOS refuses the Group Container with "Operation not permitted".

### Build order

1. Snapshot script with Codex and Claude, plus one fixture test per provider parser. Done when
   `node scripts/usage-snapshot.mjs --json` prints both live.
2. Add Grok, Copilot and Gemini parsers. Done when each shows `sign-in-needed` without a login,
   and `ok` after one.
3. PI WEB route and pane. Done when the check-layout script passes at phone and desktop width.
4. Point model orchestration at the snapshot, then retire the `quota-axi` dependency.

## Options considered

- **Wrap the CodexBar CLI, as `pi-codexbar` 1.0.6 does.** CodexBar 0.85.0 normalizes all five
  providers into one schema, so it would need no endpoint code. Run from Pi, every one of the five
  failed:
  - Codex: "app-server closed stdout";
  - Claude: "OAuth credentials not found" and "No Claude session key found in browser cookies";
  - Copilot and Grok: "No available fetch strategy";
  - Gemini: "Not logged in".

  The CodexBar app has its own logins, and macOS blocks Node from reading its data folders. To work,
  this option needs separate CodexBar CLI logins and a macOS permission grant, and the panel would
  then depend on a third-party menu-bar app.
- **Install existing pi packages as they are.** None of them covers all five providers.
  `@latentminds/pi-quotas` 0.5.0 covers four (no Gemini). `@javargasm/pi-usage-bars` covers Codex,
  Claude and Gemini. The packages draw a terminal footer or `/usage` text, so a Workbench panel
  cannot show their output. They also attach to Pi extension hooks, which reach Durable Chats only
  through the Durable host. Installing several would stack overlapping footers and fetch each
  endpoint several times.
- **Pi extension plus PI WEB plugin panel.** PI WEB has application panels for its plugin shell,
  but the Workbench shell does not compose plugin panels (`docs/integrations/pi-web/reuse-boundary.md`).
  That would bring back the plugin-composed layout the Workbench plan dropped.

## Risks

- All five endpoints are unofficial and can change without notice. Each parser fails on its own and
  shows its error; the other rows keep working.
- Claude's usage endpoint rate-limits. Keep the cache at 5 minutes or longer, and never poll while
  the pane is closed.
- Refreshing tokens writes `auth.json`. Use only Pi's auth store and its lock.

## Open questions

1. **Placement:** side pane from the Chat menu (proposed), or an always-visible strip in the tab bar.
2. **Copilot fallback:** whether to use the `gh` CLI token when Pi has no Copilot sign-in.
3. **Gemini plan:** Gemini CLI (Code Assist) quota only, or Antigravity as well.
