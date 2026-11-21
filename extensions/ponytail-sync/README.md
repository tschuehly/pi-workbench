# Ponytail sync

`~/.pi/agent/APPEND_SYSTEM.md` carries the Ponytail rules as a static block between the `ponytail-sync:begin` and `ponytail-sync:end` markers, generated from the installed `DietrichGebert/ponytail` package. Static text keeps the system prompt byte-stable for the provider cache.

At every lead session start the extension runs `sync.mjs` in the background. It rewrites the block only when the package text changed and leaves the rest of the file untouched, so however the package was updated the next session gets the new rules. The running session keeps the prompt it already read. Children skip it. The script refuses to write when the package's `SKILL.md` is unreadable or the markers are unbalanced. Run it by hand with `node extensions/ponytail-sync/sync.mjs`; `PI_CODING_AGENT_DIR` moves the agent folder (tests do).
