# Agent input audit Atelier

Prepare a reusable local Surface without running a model:

```sh
node extensions/agent-audit/cli.mjs atelier <capture-id>
node extensions/agent-audit/cli.mjs atelier-preview <preview-set-id>
```

The command prints the exact token-gated server command, poller command, bootstrap `humanUrl`, and authorized preflight command. It resolves the installed Atelier preflight from `ATELIER_PREFLIGHT` or the normal shared-skill path; replace `<atelier-preflight.mjs>` only when neither is available. Start only the server and poller with owned process watchers; then run the printed preflight command against the same `humanUrl`. Do not start a server or browser for evidence that nobody is actively reviewing.

The prepared ignored directory contains frozen `audit.json` plus refreshable `index.html`, `surface.css`, and `explorer.mjs`; its random owner-only access token is a sibling outside that served root. Repeating preparation updates only changed viewer assets. It never rewrites frozen evidence or the comment store, and stable request/preview Region keys keep existing comments attached. Use the CLI's explicit `cleanup-export` action before replacing corrupt frozen evidence.

The Surface is progressive: readable instruction and named skill changes first, collapsed record categories second, exact instruction diff and complete JSON last. Positively recognized saved skill-catalog markup is omitted only from the readable instruction summary and remains in the exact diff. Unknown or unavailable request instructions/catalogs stay explicitly unknown or unavailable rather than becoming empty evidence.

Baseline and target may be requests or preview sets. Preview controls derive from `dialDefinitions` and each preview's string-valued `dials` map; legacy `alignment`/`checking` fields remain supported. Values and combinations come only from saved previews. Each side also lists every saved combination directly, so sparse future dial sets remain reachable without silently changing another dial. A future dial needs data like `{ dialDefinitions:{tone:{label:"Tone",values:["plain","warm"]}}, previews:[{dials:{alignment:"Vibe",checking:"light",tone:"plain"}}] }`, not viewer code. Oversized instruction comparisons report measured sizes and defer to unchanged exact text rather than returning a partial diff.

`server.mjs` binds only to `127.0.0.1`, requires the prepared export as its static root, and requires the per-export token for every API and static response. The bootstrap URL exchanges its query token for an HttpOnly same-site cookie and redirects to a token-free path; the poller and preflight wrapper read the private token file and send a bearer header. Host, Origin, content-policy, and escaping-symlink checks remain in force. This blocks unauthenticated local HTTP reads, but does not protect against another process running as the same user that can read the owner-only token file. The server never serves the repository, capture store, token, or Pi sessions directory wholesale.
