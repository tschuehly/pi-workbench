# Agent input audit Atelier

Prepare a reusable local Surface without running a model:

```sh
node extensions/agent-audit/cli.mjs atelier <capture-id>
node extensions/agent-audit/cli.mjs atelier-preview <preview-set-id>
```

The command prints the exact token-gated server command, poller command, bootstrap `humanUrl`, and authorized preflight command. It resolves the installed Atelier preflight from `ATELIER_PREFLIGHT` or the normal shared-skill path; replace `<atelier-preflight.mjs>` only when neither is available. Start only the server and poller with owned process watchers; then run the printed preflight command against the same `humanUrl`. Do not start a server or browser for evidence that nobody is actively reviewing.

The prepared ignored directory contains `audit.json`, `index.html`, and `surface.css`; its random owner-only access token is a sibling outside that served root. A preview-only export visibly reports that it contains no actual request. A capture export selects requests from the same native session and compares them with each other or the 16 saved unsent Working Mode previews. Exact text stays behind disclosures, and the visible download links to the same JSON. Comments retain evidence-specific Region keys when selection changes. Repeating preparation reuses frozen evidence and comments and repairs only missing generated assets. Use the CLI's explicit `cleanup-export` action before replacing a corrupt export.

`server.mjs` binds only to `127.0.0.1`, requires the prepared export as its static root, and requires the per-export token for every API and static response. The bootstrap URL exchanges its query token for an HttpOnly same-site cookie and redirects to a token-free path; the poller and preflight wrapper read the private token file and send a bearer header. Host, Origin, content-policy, and escaping-symlink checks remain in force. This blocks unauthenticated local HTTP reads, but does not protect against another process running as the same user that can read the owner-only token file. The server never serves the repository, capture store, token, or Pi sessions directory wholesale.
