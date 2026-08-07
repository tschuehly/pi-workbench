# Source evidence ledgers

Each file here is a source-faithful evidence ledger for one external source, produced with the
`analyze-source-for-workbench` skill. Ledgers separate author claims from advice, cite primary
material, and carry a `Reviewed on` date marking the state of the source at analysis time.

## Watched sources

Pi Workbench deliberately learns from a small set of high-signal practitioners. An update from a
watched source is a strong signal to re-run `analyze-source-for-workbench` against what changed
since the ledger's review date. It is never a signal to adopt by default: every lesson still ends
in `adopt`, `adapt`, `experiment`, or `reject` on its own evidence.

| Source | Ledger | Watch for updates | Last reviewed |
| --- | --- | --- | --- |
| Matt Pocock — AI Hero skills and workflow | [`aihero.md`](aihero.md), [`ai-engineer-wiki.md`](ai-engineer-wiki.md) | [AI Hero skills changelog](https://www.aihero.dev/skills) and posts | 2026-07-15 |
| kunchenguid — FirstMate | [`firstmate.md`](firstmate.md), [`afk-supervision-packages.md`](afk-supervision-packages.md) | [Repository commits and docs](https://github.com/kunchenguid/firstmate) | 2026-07-18 |

When a re-analysis lands, update the ledger and the `Last reviewed` date in the same change. Add a
source to this table only after its first full ledger exists.
