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
Update whenever the Page file changes. Drive it in a real browser; stopping it deletes the copy and its log.

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
- Decisions with consequences per option go through `ask`. Recommend one option when you have a
  basis; none for ratings or gates without evidence. The human may change any answer later; a
  change arrives as "X → Y".
- `atl-request="job"` on a button or form lets the human ask for a typed job; form fields become
  its input. Move it with `status`.
- Comments go out when saved. `atl-delivery="send"` on a keyed element batches the Comments inside
  it until the human sends them; `atl-group` gives such a batch its own "Send (n)".
- Prefer static keyed HTML: write rows and cards into the Page file. An Update makes the body match
  the new file, so anything a page script built is gone until the script renders it again; render
  from one function on load and on the `atelier:update` document event, which fires after every
  Update, and `<html>` and `<body>` take the new file's attributes. `<details>` the human opened or closed
  keep his state through every later Update; other view state (tabs, filters) the script restores itself.
- A page script that needs to know what the human answered (progress, "next open", resume) reads
  `atelier.state()`, never Kernel markup: plain data with `decisions` (`id`, `options`, `recommended`,
  `answer`, `previous`, `note`, `status`, `stale`), `threads`, `requests`, `toAnswer` (ids), `open`,
  `conn`, and `loaded` (true once the Event Log is read). The document event `atelier:state` carries the
  same object in `detail` whenever it changes, including unsent answers; register it before the Kernel loads
  to get the first one.
- Read changing data with `fetch` (read-only): project files, or for a Page outside the project only
  files in its own directory. Re-read it on `atelier:update`.
- Never write `<page>.events.jsonl` and never keep human state in the HTML. After rewriting the
  Page, call `update` with `text`: one line on what changed. The Kernel marks every changed Key until
  the human has seen it. For marks on tabs, give each hidden panel an `id` and its tab
  `aria-controls`; in-page links (`href="#id"`) get a dot for changes in their section.
  `atl-changes="off"` turns the marks off.
- Kernel controls take the Page's colours: light by default, dark only when the Page declares
  `color-scheme` dark. Override `--atl-bg`, `--atl-fg`, `--atl-muted`, `--atl-line`, `--atl-accent`,
  `--atl-warn` to match a Page.
- The Kernel panel floats at the bottom right. Where it would cover content, put an empty
  `<div atl-dock></div>` where it should sit in the Page's layout (a sidebar, a header row), or move it
  with `--atl-dock-right` and `--atl-dock-bottom`. Every Key gets its Comment button on hover or focus;
  a Key with threads keeps a count. A Key with nothing focusable gets `tabindex="0"` so the keyboard
  reaches it; an authored `tabindex` stays.
- For icons in Page content use Lucide (ISC), inlined as SVG like the Kernel's; no emoji as icons.

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
| Kernel 2.2.0 | Kernel | `extensions/atelier/kernel/` (`atelier.js`, `idiomorph.js` 0.8.0) |

No Components or Patterns yet; they enter only after real use proves them. A change to a copied
Kernel is a Contribution: raise it as a pull request against pi-workbench.
Example Page: `extensions/atelier/examples/demo.html`.
