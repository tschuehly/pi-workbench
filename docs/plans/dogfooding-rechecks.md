# Dogfooding rechecks

Decisions shipped on a guess, to re-evaluate against real sessions. At the start of each dogfooding
Workstream, check every open entry against the evidence named, then keep it, change the decision,
or close it with a dated verdict.

## Open

### Context-ceiling reminder wording and cadence (decision 161, 2026-11-15)

- **Shipped:** first reminder at 200k tokens says to carry on and compact once the phase is done
  and children are back; "Plan to compact when this phase ends" every further 50k until compaction.
- **History:** the reason-only wording ("Older detail starts to crowd the current work…") was
  compacted on at once in 5 of 5 firings in session 01a1daec, twice right after launching a child.
- **Check:** in sessions that crossed 200k (`python3 tools/session-logs/cli.py`, search
  `context-ceiling`), did the agent compact at a sensible boundary, after its running children
  returned, without writing progress files just for the compaction? Did any session ignore the
  reminders until Pi's automatic compaction?
- **Change if:** agents compact mid-phase (wording too pushy), never compact (too soft), or the
  200k/50k numbers fire too early or too often.

## Closed
