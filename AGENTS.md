# Pi Workbench repository instructions

1. Read `docs/CONTEXT.md` completely for canonical domain language.
2. Read `docs/SPEC.md` completely for supported product behavior.
3. Read `docs/LEDGER.md` when decision status or provenance matters.
4. Keep the deterministic Run Controller independent from terminal and graphical clients.
5. Treat PI WEB as a client of the Run protocol, not as authoritative Run state.
6. Do not commit credentials, authentication state, sessions, machine-local paths, or generated Run data.
