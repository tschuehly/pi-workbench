# Dogfooding rechecks

Decisions shipped on a guess, to re-evaluate against real sessions. At the start of each dogfooding
Workstream, check every open entry against the evidence named, then keep it, change the decision,
or close it with a dated verdict.

## Open

### Context-ceiling reminder wording and cadence (decision 161, 2026-11-15)

- **Shipped:** first reminder at 200k tokens explains why to compact at a phase boundary; a
  one-line follow-up every further 50k until compaction.
- **Check:** in sessions that crossed 200k (`python3 tools/session-logs/cli.py`, search
  `context-ceiling`), did the agent compact at a sensible boundary, after its running children
  returned, without writing progress files just for the compaction? Did any session ignore the
  reminders until Pi's automatic compaction?
- **Change if:** agents compact mid-phase (wording too pushy), never compact (too soft), or the
  200k/50k numbers fire too early or too often.

## Closed
