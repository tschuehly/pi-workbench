---
name: atelier
description: "Page contract and Registry index for the atelier tool. Use before writing or linking an Atelier Page: an HTML file through which the human comments, decides, rates and asks for work."
---

# Atelier

A Page is one HTML file, in the project or at any absolute path. Write it, then call `atelier` with `open` and link the
returned URL in the Chat; if the tool is missing, call `tools_enable` with group `atelier` first. Terms: `extensions/atelier/GLOSSARY.md` in pi-workbench.

Only that URL works. A file path or Markdown file link opens the Page without its Kernel: no Decisions, no
Comments, nothing reaches Pi. When `open` refuses because another session receives the Page, ask the human
whether its input should come here; only on his yes call `takeover` with the generation `open` named. Between
sessions of one process (PI WEB) it waits for the other session to be idle; his tabs and link keep working and the
Kernel bar names the receiving session. From another Durable Chat it stops that Chat's host process and serves the
Page under a new link: link it again. When it refuses, tell him what it says (close or /reload the other session,
or try again).

Building without the `atelier` tool, e.g. as a subagent? Prove the Page on the real host before handing it
over: from the project directory run `node ../../extensions/atelier/serve.mjs <page.html>` (path relative to
this skill) in the background. It serves a test copy beside the Page (`<name>.atelier-test.html`) with its own
empty Event Log, so the human's waiting input in the Page's real log is never touched; the Kernel bar says
"Test host, no Pi session". It prints each Delivery to stdout as the agent would receive it, and sends an
Update whenever the Page file changes. Drive it in a real browser before reporting; stopping it deletes the copy and its log.

## Page contract

- `open` and `update` run the Page check and append its result; `update` shows the owner the new version first, so
  fix a FAIL with another `update`. `check` runs it alone; without the tool, run
  `node ../../extensions/atelier/check-page.mjs <page.html>` from the project directory (exit 1 only on a FAIL). On a
  test copy at 1512×900 it opens the view of each `aria-controls` control once, nested views by their click path,
  and measures each view again at 900×900.
  - FAIL is measured; fix every one: console or page errors and horizontal overflow in a view (errors also after a
    click that shows no view), a Kernel version other
    than the host's, Page state not loaded, Kernel elements moving Page content (lay out a wrapper, never `<body>`).
  - WARN is a heuristic and never fails the check: possible text overlap in a view, text no scrolling frees from
    under a fixed or sticky layer, Kernel controls overlapping each other, Page CSS or `onclick` reaching
    Kernel controls (scope selectors such as `aside button` or `nav button` to Page markup), unbalanced tags. Each
    names what it saw and the screenshots to look at; look at them and fix what is really broken.
  - "unchecked": the browser checks stopped (no agent-browser, cancel, deadline); the checks and views listed were
    measured, the rest were not. A view "not reached" was not measured; Coverage says what was not exercised.
  The full report and screenshots sit in `$PI_TMP`; have the screenshots inspected visually before handing the Page
  to the owner.
- Before reporting a Page (or any UI work) ready, run `node scripts/check-layout.mjs <url|file>` (path relative to
  this skill): it screenshots 390×844 and 1440×900 and lists clipped, truncated and overflowing elements (exit 1).
  Fix each real one and look at both screenshots.
- Load the Kernel: `<script type="module" src="atelier.js"></script>`. `open` copies `atelier.js`
  and `idiomorph.js` beside the Page; let it, rather than copying them by hand.
- `atl-key="name"` on every section, and on each table row, list item, chart or figure you expect comments on,
  so a comment lands on one row, not the whole table. Nested Keys form an
  address such as `tools/ask_user` or `run-12/turn-3`; use domain ids, and keep them stable across Updates.
  Write real structure inside Keys: `<table>` with `<tbody>` rows, `<ul>`/`<ol>`, `<p>`, `<figure>` with a
  `<figcaption>`, `<dl>`, `<pre>`, and an SVG `<g>` per chart bar with a direct `<title>` naming it. Alt+click
  (Option on a Mac) or a long press on a phone comments on such a part without its own Key: a row (a cell
  resolves to its row; a header to the Key), item, paragraph, figure, definition, code block or chart bar.
  The comment names it by kind and text (`on the row "read" in tools`: a row's first cell, an item's or
  paragraph's first 40 characters, a caption, a `<dt>`, a `<pre>`'s first line, a bar's `<title>`), so keep
  those stable across Updates; when the part is gone the thread shows on its Key and says so. A part with its
  own `atl-key` gets that Key's Comment instead: Keys win.
- `atl-ver="…"` on content that changes, such as a build SHA or a content hash. Events record it,
  and older events show as "on an earlier version". An answer to the Key's `atl-decide` (or to an `ask` that names
  `material`) holds for the version it was given on. On another version the Decision shows "Version 2" (3, …:
  versions numbered from the first answer, in the order the Event Log recorded them) with no option chosen and
  the answers on other versions beneath ("Version 1: Approve"), and is to answer again; back on the answered
  version, that answer holds again. A Key without `atl-ver` counts as one version too: adding `atl-ver` later asks
  again. Other answered `ask`s stay answered: a question is not a judgement of the Key it sits on.
- `atl-decide="1|2|3|4|5"` or `"Confirm|Redo"` on a keyed element declares a Decision; its id is the
  Key address. Optional: `atl-rec="Confirm"` (recommended option), `atl-note="Redo"` (options that
  need a note), `atl-delivery="record|send|immediate"` (default immediate), `atl-material="key"`.
  Options render in a descendant `atl-slot` (e.g. one table cell), else at the end of the element.
  Every Decision lets the human add a note and up to four images (PNG, JPEG, WebP, GIF, 10 MB each);
  the Delivery names each image's absolute path, so read it. Every Decision also offers "Other…": the human's
  own answer, delivered as `own answer: "…"`. It answers the Decision like an option; act on its text.
- `atl-task` on a keyed element marks a Task the human does himself (log in, click, test on the phone): its
  id is the Key address. He marks it Done, or Stuck with a note on what is in the way, and can reopen it; each
  change arrives as `Task done on <key>`, `Task stuck on <key>: "<note>"` or `Task reopened on <key>`. Open Tasks
  count in the top bar ("to do"). Use it for checklist steps, never `atl-decide="Done|Need help"`; help a stuck one.
- Decisions with consequences per option go through `ask`. Recommend one option when you have a
  basis; none for ratings or gates without evidence. Once a Page is open, ask every question there, not in the
  Chat: a reply that offers choices, or free text you need settled, becomes an `ask` at its Key ("Other…" covers
  answers that fit no option), never numbered options in a reply. The human may change any answer later; a
  change arrives as "X → Y"; one inside the undo window replaces the unsent answer, so only the last reaches you
  (the Event Log shows an `undo` then the new `decide`, written together; a refused change, or a failed write the host rolls back, keeps the earlier answer, which then reaches you. Known limit: if that rollback fails too, the earlier answer can be left undone with no replacement). Once its undo window closes, an answered `ask` folds to one line (question and
  answer) that opens the full Decision, so answered questions take little room under their Key.
  When an asked Decision no longer needs the human (someone else settled it, or the work moved on),
  `retract` it with its `id` and `text` saying why: its card leaves the Page and the Event Log keeps the reason.
  An answered Decision cannot be retracted: keep its answer and say in the Page prose why it is overtaken. An answer
  that crosses your retract still arrives, marked `no longer asked` with the question it answered, even after you
  ask the same `id` again; it never answers the new question. Acknowledge it.
- `atl-wip="Reworking scene 3"` on a Key or any element containing Keys marks it under construction
  while you rework it: the Kernel dims it, labels it with the text and locks its Decisions (answers stay
  shown; Comments stay open). Remove it in the Update that delivers the rework; `atelier.state().wip`
  lists the marked regions as `{key, text}`. Mark every rework this way; where the region holds a Decision he
  still owes (e.g. the whole Page), add `atl-wip-lock="off"`: dimmed and labelled, but still answerable.
- `atl-request="job"` on a button or form lets the human ask for a typed job; form fields become
  its input. Move it with `status`.
- A Comment or own answer that starts work taking more than a moment: show it at once with `atl-wip` on the
  region (and `update`), or `answer` "In progress: what, where". Then close the loop: the `answer` says what you
  did and where, so he can close it at a glance (only the human closes a thread).
- Explanation lives in the Page. When he asks for clarification or more explanation of Page content (a Comment, a
  Decision note, an own answer), rewrite that content at its Key and `update`; then `answer` in one line naming
  where the explanation now sits. Reserve `ask` for a real choice.
- Comments go out when saved and, like replies, may carry up to four images; the Delivery names their paths. `atl-delivery="send"` on a keyed element batches the Comments inside
  it until the human sends them; `atl-group` gives such a batch its own "Send (n)".
- Prefer static keyed HTML: write rows and cards into the Page file. An Update makes the body match
  the new file, so anything a page script built is gone until the script renders it again; render
  from one function on load and on the `atelier:update` document event, which fires after every
  Update, and `<html>` and `<body>` take the new file's attributes. `<details>` the human opened or closed
  keep his state through every later Update; other view state (tabs, filters) the script restores itself.
- A page script that needs to know what the human answered (progress, "next open", resume) reads
  `atelier.state()`, never Kernel markup: plain data with `decisions` (`id`, `key`, `options`, `recommended`,
  `answer`, `custom` (an own answer), `previous` (the answer this one replaced), `note`, `status`, `stale`,
  `state`: `"new"` unanswered, `"changed"` answered on an earlier version (`answer` is what he said), `"done"`;
  `round`: the number of the version shown; `history`: the last answer on each other version as
  `{round, ver, answer, custom, note}`),
  `keys` (per Key address, counting everything on it and under it: `{new, changed, done, threads}` with `threads`
  the open ones), `threads`, `requests`, `toAnswer` (ids of the Decisions not done), `open`, `wip`, `conn`, and
  `loaded` (true once the Event Log is read). The document event `atelier:state` carries the
  same object in `detail` whenever it changes, including unsent answers; register it before the Kernel loads
  to get the first one.
- Read changing data with `fetch` (read-only): project files, or for a Page outside the project only
  files in its own directory. Re-read it on `atelier:update`.
- Never write `<page>.events.jsonl` and never keep human state in the HTML. After rewriting the
  Page, call `update` with `text`: one line on what changed. The Kernel marks every changed Key until
  the human marks it seen (opens and closes its changes, its "Seen", or "Mark all seen" on the rail);
  change marks last until a reload; open questions and unread agent replies are also marked on load. For marks on tabs, give each hidden panel an `id` and its tab
  `aria-controls`; in-page links (`href="#id"`) get a dot for changes in their section. The same tabs let
  "next ↓" and the Kernel's other jumps reach items in hidden panels: the Kernel clicks each hidden panel's
  visible tab, outermost first, so the Page's own tab handler shows it (within a few frames). The document event `atelier:reveal`
  (`detail.key`) fires before the Kernel scrolls to the item, for navigation that is not a tab.
  `atl-changes="off"` turns the marks off.
- Kernel controls take the Page's colours: light by default, dark only when the Page declares
  `color-scheme` dark. Override `--atl-bg`, `--atl-fg`, `--atl-muted`, `--atl-line`, `--atl-accent`,
  `--atl-warn` to match a Page.
- `atl-nav="Label"` on a section makes it an item in the Kernel's top bar (empty: its first heading's text); a click
  reveals it like "next ↓" (tabs, `atelier:reveal`), and the item counts what needs the human under it and dots its
  changes. The bar, fixed at the top on every Page, also holds "next ↓", "to answer", Send, the receiver, a "?"
  Help card (how to comment, keys, what happens next), and a
  Requests menu (with the count not yet accepted or cancelled; accept or rework there); the Kernel
  reserves its height, `--atl-top`, as a top border on `:root` (the Page's own padding stays), so a Page's own sticky or
  fixed header uses `top: var(--atl-top, 0)`; a bar item lands its target below that header. A full-height app sizes
  `html, body` with `height: 100%` (not `100vh`), or uses `calc(100dvh - var(--atl-top, 0px))`. Long labels shorten
  with an ellipsis (full text in the tooltip); items that do not fit fold into a Sections menu.
- The Kernel panel floats at the bottom right with undo, notices, and threads on text or without a Key;
  with nothing to show it hides. Where it would cover content, put an empty `<div atl-dock></div>` where it
  should sit in the Page's layout (a sidebar, a header row), or move it with `--atl-dock-right` and `--atl-dock-bottom`. Placed anywhere but directly in `<body>`, the panel
  takes its container's width (up to 760px) and scrolls inside when the Page limits its height.
  Every Key gets its Comment button on hover or focus; the Comment box floats beside the button and
  never scrolls the Page. Each thread shows as a chip on its Key (its first words, reply count, a dot
  for new replies), or at the end of its quote for a Comment on selected text; the chip opens the
  thread floating beside it. Threads take no space in the Page's layout and never cover its text, media or
  controls: a Key's chips take the first free spot near its top, shrink to icon and count, or, with no free
  spot, show only while the Key is hovered or focused. Threads that need the human (open, or with new
  replies) never wait for hover: with no free spot a small badge (count, new-reply dot) stays at rest, at
  the Key's top-right corner if nowhere else, the one Kernel mark that may cover a little Page content;
  it opens the Key's chips. A Page button with `atl-comment`
  inside a Key opens that Key's Comment box beside the button (e.g. in a sticky decision bar). A Key with nothing
  focusable gets `tabindex="0"` so the keyboard reaches it; an authored `tabindex` stays.
- For icons in Page content use Lucide (ISC), inlined as SVG like the Kernel's; no emoji as icons.

## Page rules (from Thomas's walkthroughs, 2026-10-10 to 10-13)

Every trial Page failed on the same points. Before opening a Page, check it against each rule.

- **Little text.** A heading and at most two short sentences per item. Plain words for what he sees, one
  change per sentence. No jargon (state capsules, role IDs, pin, scope), no meta-text about how the Page
  is grouped, no disclaimers about what was not measured, no repeated instructions; options explain themselves.
- **Explain before asking.** Before any judgement, show how the thing works: one real item step by step, each
  step with its real content (the 5 ideas, not field names or codes), as a diagram. Concrete over abstract; an
  image over prose.
- **No provenance noise.** No Git SHAs, app ids, timestamps, viewport/pointer/scale lines or "evidence
  limit" boxes on the Page; keep them in `atl-ver` or data files.
- **Layout follows the content and how he works through it.** Decide first whether he compares items, scans
  them, or reads and decides them one after another. Compare or scan short, like items (screenshots, versions,
  numbers): columns side by side. Read and decide in turn (issues, questions with explanation, long options):
  one item per full-width row, its text at a readable line length (~75ch) with its evidence, Decision or
  question beside it. Never tall narrow cards of uneven height in a grid for reading.
- **Use the full desktop width.** No narrow centred column with empty margins; fill the width as the layout
  rule says, with compact padding and one-line headers. Declare navigation with `atl-nav`, so content takes the
  screen. Leave the Kernel panel room through `atl-dock`. Before handing a Page over, look at it at 860–1100px
  wide as well as at full width.
- **Detail opens where it is clicked.** A box or stage that acts as navigation opens its content in place (tab
  panel or expand), never by jumping far down the Page. Navigation shows progress and what needs him, not a wall of links.
- **The choice sits at its evidence.** Put the Decision on each version or stage where he sees it (under its
  screenshot), not in a row at the end; one Decision per grain where versions differ (e.g. per viewport).
  For a long section, keep the Decision in view (sticky top or bottom bar). A sticky bar never covers
  content: reserve its height, or let it stop sticking when the section is short or the window narrow.
- **Options name the result, not the action.** Each option says what he gets if he picks it. When a proposal
  becomes a shown version, change its options to judge that version (`atl-decide="Keep this|Change"`,
  `atl-note="Change"`); bumping only `atl-ver` re-asks the old question ("Fix|Leave") about the fix itself.
- **One comparison per view.** Show Before once; put 1–2 versions side by side, not many stacked.
- **Pictures carry claims.** Every compared claim has its screenshot. Screenshots open in a zoom modal with
  pinch-to-zoom, not a new tab. Portrait shots fit one row of cards; wide shots get at most two per row;
  for a small change, crop to the changed region and keep the full shot behind the modal. Highlights come
  from the changed element's measured bounds, or are left out; a wrong mark is worse than none.
- **Dark/light switch on every Page.** A button in the header toggles `data-theme="dark|light"` on `<html>`;
  dark by default unless `prefers-color-scheme: light`, the choice kept in `localStorage`, re-applied on
  `atelier:update`. Each theme sets `color-scheme` and the `--atl-*` colours, so Kernel controls follow.
- **A builder needs real content and direction.** A brief says what the Page is for, what Thomas must see or
  decide, and supplies the real content; a thin brief gets padded with text. It quotes Thomas, adds no design
  constraint he did not give, and lets the builder run `serve.mjs`.

## Principles (working theory, provisional — iterate with Thomas)

- The human can always change an answer until he closes it.
- Kernel controls are quiet: shown on hover or focus, taking no layout space, in the Page's colours.
- A choice comes with its evidence and, when there is a basis, one recommendation.
- Status shows only what was measured.
- The human's input survives every Update.
- A Page leads with the conclusion and what needs the human.

## Registry

| Entry | Kind | Source |
| --- | --- | --- |
| Kernel 2.17.0 | Kernel | `extensions/atelier/kernel/` (`atelier.js`, `idiomorph.js` 0.8.0) |

No Components or Patterns yet; they enter only after real use proves them. A change to a copied
Kernel is a Contribution: raise it as a pull request against pi-workbench. Verify a Kernel change on a copy of
Thomas's actual Page with its Event Log, at his viewport, not only on the example Page.
Example Page: `extensions/atelier/examples/demo.html`.
