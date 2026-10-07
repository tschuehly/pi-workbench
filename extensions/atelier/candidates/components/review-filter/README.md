# review-filter

**Pick:** a list contains items that are ready, processing, judged or waiting on a Decision.
**Lesson:** pending = !currentHumanJudgment && !processing && (ready || openDecision).
Thomas asked to hide judged and in-progress videos, not just to show everything without a score
([VR T6](../../SOURCES.md)); an answer on a stale version does not judge the current result.

**Use:** copy [example.html](example.html)'s markup and module. Supply domain readiness/processing attributes;
`derive` from the copied Kernel handles answered Decisions, undo and version. Keys include ancestors.
The example treats any current answer as judged: multi-axis tasks need their own explicit done predicate.

**Update:** view/search come from namespaced URL parameters; render runs on `atelier:update`, then reads
the Event Log again. “Urteile neu lesen” refreshes between Updates. A failed read suspends status filtering
and says so; it never invents unjudged counts. There is no auto-advance or extra poller.
**Skip:** offline/local unsaved-event filtering or strict live queueing. Kernel has no public state hook.
Before global Kernel jump, clear filters: it cannot reveal a hidden row. Pair with any item Component.
