# Start here (work computer)

My own Atelier plugin for Claude Code: review Pages with my rules (Needs you / Done tags, folding what's done,
the question tree on the left, the "‹ 3 / 11 ›" bar, comments grouped per question).

## 1. Check the computer

In a terminal:

```
claude --version   # needs 2.1.105 or newer
node --version     # needs 22.18 or newer
```

If Node is missing or older, install the LTS version from https://nodejs.org first.

## 2. Install my plugin (once)

Open Claude Code in any project folder and type these one at a time:

```
/plugin marketplace add tschuehly/pi-workbench#atelier-mine
/plugin install atelier@atelier-mine
/reload-plugins
```

If GitHub is blocked at work: download https://github.com/tschuehly/pi-workbench/archive/refs/heads/atelier-mine.zip,
unzip it (for example to Documents), and use `/plugin marketplace add <the unzipped folder>` instead of the first line.

## 3. First Page

Paste the start prompt below into Claude Code. It builds a Page, opens it in the browser, and waits for my answers
and comments there.

```
Use the atelier skill and follow "My Page rules" in it exactly. Build me an Atelier Page to help me decide:
<what I want to decide, e.g. "which team offsite venue to book for March">. Start with what I asked for, ask me
each open choice as a question on the Page, and add follow-up questions only when my answer calls for one.
Then open the Page in my browser and wait for my answers and comments there.
```

To see what a finished Page looks like, ask: `Open the example atelier/skills/atelier/examples/trip-with-my-rules.html
from my atelier plugin as an Atelier Page.`

## Later

- Thomas changed the plugin? `/plugin marketplace update atelier-mine`, then `/reload-plugins`.
- Something looks wrong on a Page: comment on it right there; Claude reads the comment and fixes it.
