# Skill × Working Mode review

Draft decisions for automatic skill discovery in Pi Workbench. The surface does not change the
Working Mode extension, skill frontmatter, repository guidance, or user settings.

- Surface: `tools/skill-mode-atelier.html`.
- Kernel: unmodified Atelier kit copied for this review; the older shared kit in `tools/` is untouched.
- Decisions and comments: ignored `.review/skill-mode-mapping.json`.
- Inventory: review snapshot of user-index, Workbench, and session-exposed package skills, not a
  complete package-installation audit. The HTML carries source descriptions and proposed rules.

Start from the repository root, using an owned process watcher for the server and exactly one poller:

```sh
env PORT=4753 ROOT=. UI=tools/skill-mode-atelier.html STORE=skill-mode-mapping node tools/skill-mode-review/server.mjs
env BASE_URL=http://127.0.0.1:4753 bash "$PWD/tools/skill-mode-review/poll.sh" --stream
```

For a new empty store, seed one Proposal per skill from the HTML's `skills-data` array. Use each
skill's `name` for `region: skills/<name>`, and its `options[].label` in the existing order. Never
replace an open Proposal or reorder options behind an existing decision. Custom answers need agent
interpretation before they can be represented in the mode preview.

Before the human opens the surface, run `node tools/skill-mode-review/check.mjs <url>` and the
Atelier skill's `scripts/preflight.mjs` with this poller's absolute path. The check opens and closes
one headless browser without submitting decisions. Close agent browsers before human handoff;
Atelier permits only one active browser per surface. Use Ready for changes during the review.
