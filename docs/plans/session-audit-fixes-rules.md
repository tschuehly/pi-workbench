# Rules for the 2026-10-01 session-audit fix branches

Shared by the parallel children implementing the session-audit fixes
(`docs/research/reports/session-audit-2026-10-01.md`).

- Work only in your own linked worktree: `git -C ~/IdeaProjects/pi-workbench worktree add ../pi-workbench.<slug> -b fix/<slug> main`. Never touch `~/IdeaProjects/pi-workbench` (main checkout), any `*.installed` checkout, or another fix worktree.
- Read `AGENTS.md` in the repo first and follow its routing for your area.
- Keep the change minimal and test it. Run the touched area's `npm run test:<area>` script (see `package.json`), and add a regression test for the failure you fix.
- If you change anything Pi loads before the first message (skills, tool descriptions, extensions, prompts), run `node scripts/context-usage.mjs` before and after, and report the lead and child token change.
- Commit on your branch with a plain message. Do not merge, push, or promote.
- Use `$PI_TMP` for scratch, never `/tmp`.
- Report: branch, commit SHA(s), what changed, test command and its result, context-usage delta if applicable, and anything left open.
