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
- `atl-verdict="1|2|3|4|5"` or `"Confirm|Redo"` on a keyed element asks for a Verdict. Verdicts are
  only logged unless `atl-delivery="send"` or `"immediate"`.
- `atl-request="job"` on a button or form lets the human ask for a typed job; form fields become
  its input. Move it with `status`.
- `atl-group` on a keyed element gives its Comments their own "Send (n)".
- Read changing data with `fetch` (read-only): project files, or for a Page outside the project only
  files in its own directory. Re-read it on the
  `atelier:update` document event, which fires after every Update.
- Never write `<page>.events.jsonl` and never keep human state in the HTML. After rewriting the
  Page, call `update`.

## Registry

| Entry | Kind | Source |
| --- | --- | --- |
| Kernel 1.0.0 | Kernel | `extensions/atelier/kernel/` (`atelier.js`, `idiomorph.js` 0.8.0) |

No Components or Patterns yet; they enter only after real use proves them. A change to a copied
Kernel is a Contribution: raise it as a pull request against pi-workbench.
Example Page: `extensions/atelier/examples/demo.html`.
