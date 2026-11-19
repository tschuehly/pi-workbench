# Spec: switch Pi Workbench to Pi Durable (cutover on 17 Nov 2026)

Status: accepted by Thomas 2026-11-16, with one change: Durable runs as a separate install and PI WEB instance beside the existing one. Parent plan: `docs/plans/pi-durable-rebuild.md`. Phase C proposal: `~/.pi-workbench/scratch/ws-pi-durable-rebuild-20261022/phase-c-promotion-survival-proposal.md`. Workstream: `ws-pi-durable-rebuild-20261022`.

## Outcome

On 17 Nov Thomas works in a second, separately installed PI WEB instance (the **Durable instance**) where every Chat is a Durable Chat, and a routine promotion of that instance leaves its Chats running. The existing instance on :8505 (the **legacy instance**) stays installed and untouched; its Chats and history stay there and are not imported.

## User stories

1. As Thomas, when I click New Chat in the Durable instance, I get a Durable Chat with every feature I used in the last weeks.
2. As Thomas, when an agent promotes PI WEB or Pi Workbench while my Chats stream, run subagents or Workers, run background bash, or wait on my question, they keep going. The browser reconnects by itself.
3. As Thomas, after a shutdown, my Durable Chats come back paused, and I resume each one myself (decided 22 Oct).
4. As Thomas, if Durable misbehaves, I go back to the legacy instance's tab; my Durable Chats stay readable in the Durable instance.
5. As Thomas, the Chats I already have open on the legacy instance keep working. Installing, promoting or stopping one instance never restarts or changes the other.

## Required behavior

**B1 Port (in progress).** Durable Chats get the 10 legacy features added since 23 Oct (`port-list-20261116.md` in the Workstream scratch folder). Grok/Gemini overrides stay deferred (Thomas, 16 Nov).

**B2 Usage recheck.** The scope from 22 Oct ("port what I used in the last 2 weeks") is rechecked against 23 Oct–16 Nov. The same script as `usage-2weeks.md` measures every deferred row. A deferred row becomes in scope when it was used in at least 3 lead sessions. Likely candidates: `spawn_session`, relays, MCP. Each such row is ported test-first. Rows used less stay deferred, and a Durable Chat refuses them visibly (AC-P050).

**B3 Host outside the daemon (C1).** Each Chat family's host runs as its own launchd job `com.pi-workbench.durable-host.<family>` (Thomas, 16 Nov). It starts from an absolute installed revision folder, never from `*.installed`. The daemon talks to it over an owner-only Unix socket. The handshake carries the protocol version, host revision, store ID and owner epoch. A restarted daemon reattaches through the runtime locator. A stale or foreign socket is refused.

**B4 Promotion script (C2).** `promote-installed` checks before switching that the new daemon speaks every running host's protocol. `stop_all` never stops host labels. Old revision folders are pruned only when no host uses them. A failed health check rolls back without touching any host.

**B5 Lifetime rules (C3).**
- Ending a Chat or a stop-all reaches its host and children; losing the transport does not.
- Idle hosts close in order after 2 h, the legacy idle window.
- A family moves to new host code when Thomas asks, or by itself (Thomas, 19 Nov) once only restart-safe work is left; an upgrade that changes the store format waits until the family is quiet (Atelier Pages allowed). Until then it stays on its old revision, which is shown.

**B6 Durable by default in the Durable instance.** A PI WEB switch, `PI_WEB_DURABLE_DEFAULT=1` read like `PI_WEB_DURABLE_HOST`, makes New Chat create a Durable Chat. The Durable instance sets it; the legacy instance does not, so its behavior is unchanged.

**B7 Separate install and instance.** The Durable instance has its own:
- installed checkouts (`~/IdeaProjects/pi-workbench.durable-installed`, `pi-web.durable-installed`) linking to its own revision folders under `~/.pi-workbench/installed-durable/`;
- `PI_WEB_DATA_DIR` (`~/.pi-web-durable`), session daemon socket and web port (proposed :8506);
- launchd labels (`com.pi-web-durable.web`, `com.pi-web-durable.sessiond`, `com.pi-workbench.durable-host.<family>`);
- promotion command (`promote-installed --instance durable …`) and prune, which never touch the legacy instance's links, labels, folders or `~/.pi/agent/settings.json`.

It shares Thomas's real `~/.pi/agent` (auth, packages, skills) read-only with `PI_WEB_PI_PACKAGE_AUTO_INSTALL=0`, as the harness contract requires for a second instance. Its install puts the Durable host and its dependencies into the revision folder and writes the launchd plists. No hand-made step.

**B8 Runbook.** `docs/plans/pi-durable-cutover-runbook.md` gives Thomas, for 17 Nov:
- how to open the Durable instance;
- how to promote it;
- the checks after a promotion;
- the rollback (previous revision, or back to the legacy tab);
- known limits, such as Workstream "continue in Chat" links that still open the legacy instance.

Each step names what it interrupts.

**B9 Durable upgrade (stretch).** Pi Durable and Pi packages go from 1.4.0 to 1.5.2 only after B1–B8 pass. It lands on its own commit with the full suites. If it is not green, it stays off the cutover branch and is reported.

## Constraints

- The legacy instance is never promoted, restarted or changed, and no merge goes into `main` or `pi-workbench`. The Durable instance installs from the pushed Durable branches.
- The Durable instance may be installed and started while Thomas is away, but only once AC1, AC3 and AC4 pass. Until then, every launchd test runs on a throwaway trial with its own labels (`com.pi-workbench.durable-trial.*`), ports, data folder and revision folders.
- `~/.pi/agent` is read-only. No `/tmp`, no broad `pkill`, and no secret values in logs.
- Live model requests: none except the trial smoke test in AC9.
- Paused restore after shutdown stays as decided. The 5 deferred-feature e2e specs stay red as reminders.
- Not in scope: removing legacy (Phase E, after two weeks of observation), history import, the reboot test (waits for a test machine), retained terminals/PTY (terminals stay unprotected), and Grok/Gemini overrides.

## Acceptance criteria

- **AC1 Suites.** Durable host, PI WEB verify, Workbench root and the e2e fleet each pass twice. The only failures allowed are the 5 deferred specs (P024, P118, P128/P129, /relay). Counts are compared with 7 Nov.
- **AC2 Port exercised.** Each B1/B2 feature has a test that was red before and green after. It was also used once on the trial server, with evidence: screenshot or transcript excerpt plus log line.
- **AC3 C1.** The daemon is killed while a lead streams. The host PID and the mock's request count stay the same, and the Chat converges after the daemon restarts. A stale and a foreign socket are refused.
- **AC4 Survival run (C4).** On the trial, run a streaming lead, a Worker with a leaf, a Subagent, background bash and an open question. Promote fully twice, then force one failed-health rollback. Required each time:
  - one terminal receipt per child;
  - no lost queue item or answer;
  - the same host PIDs and provider request IDs;
  - the client converges without a reload.

  Run twice, kept as an e2e spec plus a scripted promotion run.
- **AC5 C3.** Explicit end, idle close (injected clock) and a family upgrade each pass a separate test. A pinned family shows its revision.
- **AC6 Default switch.** With the switch on, New Chat creates a Durable Chat. With it off, New Chat creates a legacy Chat. This is an e2e spec.
- **AC7 Separate install and rollback.** The Durable instance installs from clean revision folders and Durable Chats run in it. Two promotions and one rollback of the Durable instance leave the legacy instance alone: the same daemon PID, the same `*.installed` links and plists, an unchanged `settings.json`, and a legacy Chat that keeps streaming throughout. A legacy promotion's prune keeps the Durable instance's folders.
- **AC8 Resources.** Host memory and CPU are measured at 10 and 20 open Durable Chats and compared with legacy at the same counts. Local reconnect after daemon health is measured too. The budget is at most 2× legacy idle memory and reconnect within 5 s. A miss is reported, with numbers, before the runbook says go.
- **AC9 Live smoke.** On the trial, with Thomas's real logins: one Claude subscription prompt, one OpenAI (ChatGPT sign-in) prompt and one Subagent child. Each completes, and redaction holds.
- **AC10 Review.** An independent reviewer from another model family reviews the whole delta since `4561da4`, plus the runbook. Blockers are fixed test-first and re-reviewed. Both branches are pushed to the tschuehly forks.
- **AC11 Ready report.** By morning, Thomas gets one message: ready or not ready, which ACs failed, and the runbook link.

## Checklist (AFK order)

1. Collect the three port implementers' work, merge their branches, and remove their worktrees (B1).
2. Run the usage recheck and port the newly used rows (B2).
3. Build C1, then C2 and C3, then C4: B3–B5, with AC3–AC5.
4. Build the default switch and the separate install, write the runbook, install the Durable instance and check it: B6–B8, with AC6 and AC7.
5. Run the suites twice, exercise the trial, measure resources and do the live smoke: AC1, AC2, AC8, AC9.
6. Get the independent review, fix, re-review and push (AC10).
7. Upgrade to 1.5.2 if time remains (B9).
8. Write a checkpoint per stage and send the morning ready report (AC11).

Implementers work in parallel where files do not overlap. The lead merges, verifies and owns the gates.
