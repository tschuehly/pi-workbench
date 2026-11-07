# Page mode

Status: specified 2026-11-07; implemented on branch `page-mode` (Atelier decision 157), not promoted. Owner Workstream: `ws-workbench-future-source-learning-20261008`. Exists only on branch `page-mode`; nothing is promoted to the installed Workbench until Thomas decides. Terms are defined in the Page mode section of [vocabulary](../foundation/vocabulary.md) and in the Atelier glossary.

## Problem Statement

When Thomas works with a lead agent, everything reaches him as Chat text. He can't see at a glance what needs him and what is only information. Answers and decisions are lost in the scroll. The Chat remains the centre of the Workbench, and agents write more prose than he needs. The plainest case: a set of questions the agent asked in prose scrolled out of his view while the agent kept working, so he had to scroll back to find them.

## Solution

In **Page mode** the lead agent never writes text to Thomas. Each session keeps one **Session Page**, a live Atelier Page that opens in a browser tab. The agent edits the Page's **Working copy**, checks it if needed, and sends an Atelier **Update** when the Page is ready. Thomas sees nothing before that Update, and every Update is stored as one revision. Status content is replaced in place. Decisions and Verdicts keep their history. Open Decisions, Requests and questions stay where they belong on the Page, and the existing Atelier marks (the dots on tabs and in the navigation, plus the open-question marks) show that they are open. When the agent needs Thomas, it calls **attend** on one Key. That marks the Key and alerts Thomas through his Attention setting. Results Thomas didn't ask for attach to the Key they concern; if nothing on the Page concerns them, they stay in the **Log**, the hidden transcript. Thomas answers through Comments on Keys, through Decisions, or with free text in the Page's composer.

Page mode is the `Page` value of a new Working Mode axis, **Surface** (`Chat` by default), chosen per lead session. Subagents and Workers are unaffected: a child's final text remains its result. It runs on Atelier Kernel 3.0, which exists only on this branch; Kernel 2.x and existing Pages stay untouched. Enforcement is soft at first: a prompt rule plus one re-prompt. Telemetry counts **slips**, and whether enforcement gets stricter depends on how often slips happen.

## User Stories

1. As Thomas, I want to switch a lead session to Page mode with one Working Mode command, so that I can try working without the Chat on a session of my choice.
2. As Thomas, I want Surface to start at `Chat`, so that sessions I don't switch behave as today.
3. As Thomas, I want to switch a session back to `Chat` at any time, so that I can recover when Page mode gets in the way.
4. As Thomas, I want the Surface value to survive resume and compaction like the other Working Mode axes, so that a resumed session stays in the mode I chose.
5. As Thomas, I want a Session Page to exist as soon as a Page-mode session starts, so that I always know where the session talks to me.
6. As Thomas, I want every Session Page to start from the same empty layout, with a header, a composer and a link to the Log, so that sessions look alike and none is missing.
7. As Thomas, I want the Session Page to open in a browser tab, so that I can use Page mode before PI WEB integrates it.
8. As Thomas, I want Session Page files kept in the Workstream's scratch folder, so that a session's Page and its history outlive the session without polluting the repository.
9. As Thomas, I want the agent's edits to the Working copy to stay invisible until it sends an Update, so that I'm not shown half-finished states.
10. As Thomas, I want each Update stored as a numbered revision, so that I can look back at what the Page said at any point.
11. As Thomas, I want to compare or restore an earlier revision, so that I can see what changed or recover content the agent overwrote.
12. As Thomas, I want few, meaningful Updates rather than a stream of small ones, so that each change is worth my attention.
13. As Thomas, I want the agent to run the Page check before an Update when the layout changed, so that I don't receive a broken Page.
14. As Thomas, I want an Update to keep my open input intact, as Atelier Updates do today, so that typing a Comment is never destroyed by the agent's work.
15. As Thomas, I want each Update to carry its one-line note and the existing change marks, so that I can see what changed since I last looked.
16. As Thomas, I want status content replaced in place, so that the Page shows the current state, not a feed.
17. As Thomas, I want Decisions and Verdicts to keep their history, so that what I decided stays traceable.
18. As Thomas, I want open Decisions, Requests and questions to stay where they belong on the Page, so that they keep their context.
19. As Thomas, I want the existing Atelier dots on tabs and navigation to mark every open Decision and open question, so that I can find what waits for me on a long Page.
20. As Thomas, I want the agent to call attend on a specific Key when it needs me, so that I'm pointed at the exact thing, not just the session.
21. As Thomas, I want attend to alert me through my Attention setting, so that I'm reached the same way as for any other contact (marks at the Mac, the phone in Phone mode, never in AFK).
22. As Thomas, I want attend to be the only way an agent in Page mode asks for my attention, so that there is one channel to watch.
23. As Thomas, I want a background result (for example a finished test run) to update the Key it concerns, so that information lands where it matters.
24. As Thomas, I want a result that concerns nothing on the Page to stay in the Log, so that irrelevant news doesn't take up my view.
25. As Thomas, I want results that need me to be attended, not just written down, so that I'm told when something requires action.
26. As Thomas, I want to comment on any Key, so that I can give feedback in context.
27. As Thomas, I want to type free text into the Page composer, so that I can ask new questions or give new instructions without a Chat.
28. As Thomas, I want the answer to my free-text question to appear on the Page next to it, so that question and answer stay together.
29. As Thomas, I want to answer Decisions on the Page, as in Atelier today, so that choices stay structured.
30. As Thomas, I want the session transcript available as a Log, out of normal view, so that I can audit or debug a misbehaving agent.
31. As Thomas, I want the Log to keep any stray text the agent wrote, so that nothing is silently lost even when it isn't shown.
32. As Thomas, I want the agent to be re-prompted once when a turn ends with text written for me and no Update, so that a slip usually corrects itself.
33. As Thomas, I want the re-prompt to happen at most once per turn, so that a confused agent cannot loop.
34. As Thomas, I want every slip recorded in telemetry, so that I can judge whether the soft rule is enough.
35. As Thomas, I want turns that end silently (for example while waiting on a child) not to count as slips, so that the count only shows real violations.
36. As Thomas, I want to see slip counts per session and over time, so that I can decide between keeping the soft rule, forcing tool use, or dropping Page mode.
37. As the lead agent in Page mode, I want the prompt to state the rule (no text to Thomas; work through the Working copy, Updates and attend), so that I know how to communicate.
38. As the lead agent, I want to call tools directly or through codemode, so that I can batch tool calls and still end the turn with an Update.
39. As the lead agent, I want Thomas's Comments, Decisions, Requests and composer text delivered to me as messages, as Atelier does today, so that I receive his input without a Chat.
40. As the lead agent, I want attend to fail clearly when the Key doesn't exist on the published Page, so that I don't point Thomas at nothing.
41. As the lead agent, I want an Update to fail clearly when the Working copy is missing or the Page is not open, so that I can repair it.
42. As a subagent or Worker, I want to keep returning my result as final text, so that delegation keeps working in Page mode.
43. As Thomas, I want Kernel 3.0 confined to Session Pages on this branch, so that my existing 2.x Pages and the native-Atelier work are unaffected.
44. As Thomas, I want a 2.x Page to refuse the 3.0-only actions, so that an agent can't half-apply Page mode to an old Page.
45. As Thomas, I want Page mode switched on in my daily sessions only after stored Updates and attend exist, so that daily use doesn't start with missing pieces.

## Implementation Decisions

- **Built as an extension plus PI WEB rendering, no Pi fork.** Pi also uses assistant text for child results, session titles, compaction summaries and print/RPC output, and upstream changes too often for a fork to be maintainable (Astra investigation, 7 Nov).
- **Working Mode** gains an enum axis, Surface, with the values `Chat` (default) and `Page`. It follows the existing axis declaration, persistence, `/mode` parsing and prompt injection. Guidance for `Page` carries the prompt rule. Surface applies to the lead session only.
- **Atelier Kernel 3.0** is a new major version of the existing Kernel and extension on this branch, not a separate extension.
  - Kernel 2.x behaviour, the copied-Kernel version check and existing Pages are unchanged.
  - The tool refuses 3.0-only behaviour on Pages whose Kernel is older.
- **Stored Updates.** In 3.0 the host serves the last Update's revision, not the file on disk.
  - The agent edits the Working copy (the Page file) freely.
  - The existing `update` action snapshots the Working copy as the next numbered revision, beside the Page and its Event Log, and then pushes it live as today (idiomorph, open input preserved, note plus change marks).
  - An `update` Event Log entry records the revision number.
  - Reading or restoring a revision is exposed through the tool, so that Thomas can ask for it from the Page.
- **Attend** is a new atelier action that takes a Key and a one-line reason.
  - It appends an agent event to the Event Log and marks the Key on the Page.
  - It alerts Thomas through the channel his Attention setting selects: marks only by default; `request_attention` when Attention is Switching; the phone tools when it is Phone; no contact when it is AFK.
  - It fails if the Key isn't on the current revision.
- **Open items reuse Kernel 2.13 mechanics**: the open-ask and unread-reply marks and the dots on Page links and navigation. No pinning and no new strip.
- **Session Page creation.**
  - At session start with Surface=Page, the extension creates a Page from a fixed template (header, composer, Log link) in the session's Workstream scratch folder and opens it, making the session its Receiver.
  - If the session has no Workstream, the Page goes into the session's own scratch location.
- **Composer.** The Session Page template includes a free-text composer whose input reaches the agent through the existing Delivery (a human `send` event).
- **Log.** The transcript stays in Pi's session file. The Session Page links to a read-only view of it. Nothing is deleted.
- **Slip handling** is a Page-mode hook in the extension.
  - At the end of an agent turn it checks whether the turn produced assistant text and no `update` call.
  - If so, it records a `slip` telemetry event (session, turn), adds one correction to the context and continues once, then records a `slip.correction` event (whether the correction succeeded, and the run outcome if it errored or was aborted).
  - A turn without text is not a slip. At most one correction per turn.
- **Telemetry** gains a `slip` event type. Slips are reported per session and per day from the existing recorder. Turn classification lives in the Page-mode hook, not in telemetry.
- **Codemode**: no special support; the atelier actions are ordinary tools, so codemode scripts can call them.
- **Relevance of unsolicited results**: by prompt rule. The agent places a result on the Key it concerns and uses attend only if Thomas must act; otherwise the result stays in the Log. No routing code.

## Testing Decisions

- Thomas decided (revised 2026-11-07): **test-first at one seam**, a real Pi session with the scripted faux provider (as in the Working Mode tests) running Working Mode, Atelier and an injected telemetry recorder, with the Atelier host serving the Session Page over HTTP. `extensions/atelier/page-mode.test.mjs` drives one behaviour per test: `/mode surface page` creates the Session Page and revision 1; editing the Working copy leaves the served Page unchanged; `update` stores the next revision and the Page serves it (and `restore` copies one back); `attend` marks an existing Key and is refused on an unknown Key or an older Kernel; a run ending with text and no Update gets one correction and records a slip, a silent ending none. No host-internal unit tests and no mocks of internal collaborators. The seam does not see the Kernel's browser rendering (the attend mark itself) or the real browser launch.
- Verification is daily use. Thomas runs his Workbench sessions with Surface=Page, and the slip count and his judgement decide whether to keep the soft rule, force tool use, or drop Page mode.
- Before daily use starts, the implementing agent exercises the flow once by hand in a scratch session:
  - set Surface=Page;
  - edit the Working copy and confirm the served Page is unchanged;
  - send an Update and confirm a revision appears;
  - attend a Key and confirm the mark and alert;
  - end a turn with text and confirm one re-prompt and a recorded slip.
- It reports what it saw. The existing Atelier and Working Mode suites must keep passing, since Kernel 2.x behaviour must not change.

## Out of Scope

- PI WEB integration: showing the Session Page inside the app, hiding the Chat, a Log tab. Later, as its own step.
- A FirstMate-style root Page or Workstream Page across sessions.
- Forcing tool use at the provider (`tool_choice`), unless slip counts call for it.
- Element-level Page operations or a declarative UI format (A2UI, json-render); Thomas chose the current Kernel.
- Changing subagents, Workers, compaction, titles or print/RPC output.
- Promoting Kernel 3.0 to the installed Workbench or to the native-Atelier Workstream.
- Removing assistant text from Pi or from the session file.

## Further Notes

- Evidence: the 7 Nov grilling record and research in the Workstream scratch folder (PAGE-MODE.md, and the fork, inventory and format studies summarised there).
- The Atelier code is shared with `ws-atelier-native-20261006`. Check that Workstream for open Kernel work before changing the Atelier extension, and rebase the branch when 2.x moves.
- Atelier decisions 145 and 147 (the agent writes Page files, the Kernel owns the Event Log) still hold. Kernel 3.0 only changes what the host serves: the last Update's revision instead of the file on disk. Record this as a decision when 3.0 lands.
