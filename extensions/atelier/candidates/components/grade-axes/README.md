# grade-axes

**Pick:** fact correctness, coverage and preference need distinct judgments.
**Lesson:** separate Correct / Complete / Taste and keep the judge's value beside, not inside, the
human's Verdict. Authored “not yet judged” labels would become false after the first human click.

**Why:** “differentiate between correct and taste” led to this split; chat did not preserve human
corrections separately ([ME T4, O L2827, B §7](../../SOURCES.md)). No eval studio was yet built.

**Use:** copy [example.html](example.html)'s nested run/turn/axis Keys. Version the result with the answer,
criteria and truth identities. Kernel renders human state; Page markup only supplies judge evidence.
Pair with claim-card for expectations or run-matrix for comparisons.
**Limit:** required-note overrides and human-control prefill are not implemented by the Kernel. A Comment
can record a reason but cannot enforce a note with each Verdict. No local pretend override store.
**Skip:** subjective media scoring, where one 1–5 score replaced a six-axis rubric (VR T5).
