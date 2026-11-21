# Atelier for Claude Code

Claude writes an HTML review Page. You comment, decide and request work on it in your browser, and each of your
events reaches Claude by itself, even while the session is idle.

## Requirements

- Claude Code 2.1.105 or later, in an interactive session. Monitors do not start with `claude -p`. On Bedrock, Vertex or
  Foundry, or with `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set, you need 2.1.310 or later.
- Node.js 22.18 or later on `PATH`. It runs the TypeScript host without a build step.
- Windows: Git for Windows (Git Bash), so Claude Code runs the plugin's background command in Bash.
- Optional: [`agent-browser`](https://github.com/vercel-labs/agent-browser) for the Page check. Without it, the
  check reports "unchecked".

## Install

In Claude Code:

```
/plugin marketplace add tschuehly/pi-workbench
/plugin install atelier@pi-workbench
```

Then restart the session or run `/reload-plugins`.

## First use

1. Start Claude Code in your project.
2. Ask: "Use the atelier skill: put the three options for X on a Page and ask me which one to take."
   Claude loads the skill (a line `Monitor event: [atelier] Ready for session …` appears), writes the Page, opens it and gives you a `http://127.0.0.1:…` link.
3. Open the link, pick an option or leave a Comment. A few seconds later Claude gets it and carries on.

Your input is kept in `<page>.html.events.jsonl` beside the Page. Commit or ignore it as you like. It survives
restarts, and input that has not reached Claude yet arrives when the Page is opened again.
