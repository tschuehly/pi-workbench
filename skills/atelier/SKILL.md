---
name: atelier
description: "Page contract and Registry index for the atelier tool. Use before writing an Atelier Page: an HTML file through which the human comments, decides, rates and asks for work."
---

# Atelier

A Page is one HTML file, in the project or at any absolute path. Write it, then call `atelier` with `open` and link the
returned URL in the Chat; if the tool is missing, call `tools_enable` with group `atelier` first. Terms: `extensions/atelier/GLOSSARY.md` in pi-workbench.

## Page contract

- Load the Kernel: `<script type="module" src="atelier.js"></script>`. `open` copies `atelier.js`
  and `idiomorph.js` beside the Page.
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
- Read changing data with `fetch` (read-only): project files, or for a Page outside the project only
  files in its own directory. Re-read it on the
  `atelier:update` document event, which fires after every Update.
- Never write `<page>.events.jsonl` and never keep human state in the HTML. After rewriting the
  Page, call `update` with `text`: one line on what changed. The Kernel marks every changed Key until
  the human has seen it. For marks on tabs, give each hidden panel an `id` and its tab
  `aria-controls`; in-page links (`href="#id"`) get a dot for changes in their section.
  `atl-changes="off"` turns the marks off.
- Kernel controls take the Page's colours: light by default, dark only when the Page declares
  `color-scheme` dark. Override `--atl-bg`, `--atl-fg`, `--atl-muted`, `--atl-line`, `--atl-accent`,
  `--atl-warn` to match a Page.
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
| Kernel 2.1.0 | Kernel | `extensions/atelier/kernel/` (`atelier.js`, `idiomorph.js` 0.8.0) |

No Components or Patterns yet; they enter only after real use proves them. A change to a copied
Kernel is a Contribution: raise it as a pull request against pi-workbench.
Example Page: `extensions/atelier/examples/demo.html`.
