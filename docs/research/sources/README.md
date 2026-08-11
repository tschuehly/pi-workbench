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
| Matt Pocock — AI Hero skills and workflow | [`aihero.md`](aihero.md), [`ai-engineer-wiki.md`](ai-engineer-wiki.md) | [AI Hero skills changelog](https://www.aihero.dev/skills) and posts | 2026-08-07 |
| kunchenguid — FirstMate | [`firstmate.md`](firstmate.md), [`afk-supervision-packages.md`](afk-supervision-packages.md) | [Repository commits and docs](https://github.com/kunchenguid/firstmate) | 2026-07-18 |
| DODOREACH — personal Pi tool shaping | [`dodo-reach-pi-tool-shaping.md`](dodo-reach-pi-tool-shaping.md) and the mechanism ledgers below | [Pi setup threads](https://x.com/DODOREACH) and [public remixes](https://github.com/dodo-reach) | 2026-08-11 |

### DODOREACH mechanism ledgers

- [`unified-edit`](dodo-reach-unified-edit.md)
- [Ponytail](dodo-reach-ponytail.md)
- [`rpiv-ask-user-question`](dodo-reach-ask-user-question.md)
- [OpenAI server compaction](dodo-reach-openai-server-compaction.md)
- [`pi-clarify`](dodo-reach-pi-clarify.md)
- [`/btw` side chat](dodo-reach-btw-side-chat.md)
- [web tools and `supi-web`](dodo-reach-web-tools.md)
- [Papercuts](dodo-reach-papercuts.md)
- [sandbox and destructive-command guard](dodo-reach-sandbox-guard.md)
- [status widgets](dodo-reach-status-widgets.md)
- [Tailscale file transfer](dodo-reach-tailscale-file-transfer.md)
- [mobile Pi web UI](dodo-reach-pi-mobile-web-ui.md)

When a re-analysis lands, update the ledger and the `Last reviewed` date in the same change. Add a
source to this table only after its first full ledger exists.
