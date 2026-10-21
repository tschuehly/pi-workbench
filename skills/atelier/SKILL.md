---
name: atelier
description: "Page contract and Registry index for the atelier tool. Use before writing an Atelier Page: an HTML file through which the human comments, decides, rates and asks for work."
---

# Atelier

A Page is one HTML file, in the project or at any absolute path. Write it, then call `atelier` with `open` and link the
returned URL in the Chat; if the tool is missing, call `tools_enable` with group `atelier` first. Terms: `extensions/atelier/GLOSSARY.md` in pi-workbench.

Building without the `atelier` tool, e.g. as a subagent? Prove the Page on the real host before handing it
over: from the project directory run `node ../../extensions/atelier/serve.mjs <page.html>` (path relative to
this skill) in the background. It serves a test copy beside the Page (`<name>.atelier-test.html`) with its own
empty Event Log, so the human's waiting input in the Page's real log is never touched; the Kernel bar says
"Test host, no Pi session". It prints each Delivery to stdout as the agent would receive it, and sends an
Update whenever the Page file changes. Drive it in a real browser before reporting; stopping it deletes the copy and its log.

## Page contract

- Load the Kernel: `<script type="module" src="atelier.js"></script>`. `open` copies `atelier.js`
  and `idiomorph.js` beside the Page; let it, rather than copying them by hand.
- `atl-key="name"` on every element the human judges. Nested Keys form an address such as
  `run-12/turn-3`; use domain ids, and keep them stable across Updates.
- `atl-ver="…"` on content that changes, such as a build SHA or a content hash. Events record it,
  and older events show as "on an earlier version".
- `atl-decide="1|2|3|4|5"` or `"Confirm|Redo"` on a keyed element declares a Decision; its id is the
  Key address. Optional: `atl-rec="Confirm"` (recommended option), `atl-note="Redo"` (options that
  need a note), `atl-delivery="record|send|immediate"` (default immediate), `atl-material="key"`.
  Options render in a descendant `atl-slot` (e.g. one table cell), else at the end of the element.
  Every Decision lets the human add a note and up to four images (PNG, JPEG, WebP, GIF, 10 MB each);
  the Delivery names each image's absolute path, so read it. Every Decision also offers "Other…": the human's
  own answer, delivered as `own answer: "…"`. It answers the Decision like an option; act on its text.
- Decisions with consequences per option go through `ask`. Recommend one option when you have a
  basis; none for ratings or gates without evidence. Once a Page is open, ask every question there, not in the
  Chat: a reply that offers choices, or free text you need settled, becomes an `ask` at its Key ("Other…" covers
  answers that fit no option), never numbered options in a reply. The human may change any answer later; a
  change arrives as "X → Y". Once its undo window closes, an answered `ask` folds to one line (question and
  answer) that opens the full Decision, so answered questions take little room under their Key.
- `atl-wip="Reworking scene 3"` on a Key or any element containing Keys marks it under construction
  while you rework it: the Kernel dims it, labels it with the text and locks its Decisions (answers stay
  shown; Comments stay open). Remove it in the Update that delivers the rework; `atelier.state().wip`
  lists the marked regions as `{key, text}`.
- `atl-request="job"` on a button or form lets the human ask for a typed job; form fields become
  its input. Move it with `status`.
- Close the loop on every thread you answered or acted on: the `answer` says what you did and where, so he
  can close it at a glance (only the human closes a thread).
- Comments go out when saved and, like replies, may carry up to four images; the Delivery names their paths. `atl-delivery="send"` on a keyed element batches the Comments inside
  it until the human sends them; `atl-group` gives such a batch its own "Send (n)".
- Prefer static keyed HTML: write rows and cards into the Page file. An Update makes the body match
  the new file, so anything a page script built is gone until the script renders it again; render
  from one function on load and on the `atelier:update` document event, which fires after every
  Update, and `<html>` and `<body>` take the new file's attributes. `<details>` the human opened or closed
  keep his state through every later Update; other view state (tabs, filters) the script restores itself.
- A page script that needs to know what the human answered (progress, "next open", resume) reads
  `atelier.state()`, never Kernel markup: plain data with `decisions` (`id`, `options`, `recommended`,
  `answer`, `custom` (an own answer), `previous`, `note`, `status`, `stale`), `threads`, `requests`, `toAnswer` (ids), `open`,
  `wip`, `conn`, and `loaded` (true once the Event Log is read). The document event `atelier:state` carries the
  same object in `detail` whenever it changes, including unsent answers; register it before the Kernel loads
  to get the first one.
- Read changing data with `fetch` (read-only): project files, or for a Page outside the project only
  files in its own directory. Re-read it on `atelier:update`.
- Never write `<page>.events.jsonl` and never keep human state in the HTML. After rewriting the
  Page, call `update` with `text`: one line on what changed. The Kernel marks every changed Key until
  the human marks it seen (opens and closes its changes, its "Seen", or "Mark all seen" on the rail);
  marks outlast further Updates but not a reload. For marks on tabs, give each hidden panel an `id` and its tab
  `aria-controls`; in-page links (`href="#id"`) get a dot for changes in their section.
  `atl-changes="off"` turns the marks off.
- Kernel controls take the Page's colours: light by default, dark only when the Page declares
  `color-scheme` dark. Override `--atl-bg`, `--atl-fg`, `--atl-muted`, `--atl-line`, `--atl-accent`,
  `--atl-warn` to match a Page.
- The Kernel panel floats at the bottom right. Where it would cover content, put an empty
  `<div atl-dock></div>` where it should sit in the Page's layout (a sidebar, a header row), or move it
  with `--atl-dock-right` and `--atl-dock-bottom`. Placed anywhere but directly in `<body>`, the panel
  takes its container's width (up to 760px) and scrolls inside when the Page limits its height.
  Every Key gets its Comment button on hover or focus; the Comment box floats beside the button and
  never scrolls the Page. Each thread shows as a chip on its Key (its first words, reply count, a dot
  for new replies), or at the end of its quote for a Comment on selected text; the chip opens the
  thread floating beside it. Threads take no space in the Page's layout and never cover its text, media or
  controls: a Key's chips take the first free spot near its top, shrink to icon and count, or, with no free
  spot, show only while the Key is hovered or focused. A Page button with `atl-comment`
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
- **Use the full desktop width.** No narrow centred column with empty margins; use several columns, compact
  padding, and one-line headers. Navigation collapses so content can take the screen.
- **Detail opens where it is clicked.** A box or stage that acts as navigation opens its content in place (tab
  panel or expand), never by jumping far down the Page. Navigation shows progress and what needs him, not a wall of links.
- **The choice sits at its evidence.** Put the Decision on each version or stage where he sees it (under its
  screenshot), not in a row at the end; one Decision per grain where versions differ (e.g. per viewport).
  For a long section, keep the Decision in view (sticky top or bottom bar).
- **One comparison per view.** Show Before once; put 1–2 versions side by side, not many stacked.
- **Pictures carry claims.** Every compared claim has its screenshot. Screenshots open in a zoom modal with
  pinch-to-zoom, not a new tab. Portrait shots fit one row of cards; wide shots get at most two per row;
  for a small change, crop to the changed region and keep the full shot behind the modal. Highlights come
  from the changed element's measured bounds, or are left out; a wrong mark is worse than none.
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
| Kernel 2.9.0 | Kernel | `extensions/atelier/kernel/` (`atelier.js`, `idiomorph.js` 0.8.0) |

No Components or Patterns yet; they enter only after real use proves them. A change to a copied
Kernel is a Contribution: raise it as a pull request against pi-workbench. Verify a Kernel change on a copy of
Thomas's actual Page with its Event Log, at his viewport, not only on the example Page.
Example Page: `extensions/atelier/examples/demo.html`.
