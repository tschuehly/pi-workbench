# My Atelier

My own copy of the Atelier plugin for Claude Code (from tschuehly/pi-workbench at 63fbf36), with my Page rules:
status pills, folding what's done, a "‹ 3 / 11 ›" bar through everything that needs me, question trees and
comments grouped per question. The rules are in
`atelier/skills/atelier/SKILL.md` under "My Page rules".

## Install on a computer

Needs Claude Code 2.1.105 or newer and Node.js 22.18 or newer. See `START.md`. In Claude Code:

```
/plugin marketplace add tschuehly/pi-workbench#atelier-mine
/plugin install atelier@atelier-mine
/reload-plugins
```

If Thomas's version is installed too, remove it first: `/plugin uninstall atelier@pi-workbench`.

After changing a file here, update the installed copy: `/plugin marketplace update atelier-mine`, then `/reload-plugins`.
