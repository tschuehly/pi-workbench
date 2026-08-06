# Level 1 acceptance evidence

Date: 2026-08-03

A live PI WEB development client exercised the Level 1 workflow against the real user-local Workstream Store and the `pi-workbench` repository workspace:

1. Created a Workstream from the first-class Workstreams destination.
2. Verified PI WEB's ordinary new-session button was disabled by the Workstream-home guard.
3. Started one attended session from the Workstream. The ledger recorded `session.pending` before `session.confirmed`, with one runtime session id and its machine/project/workspace location.
4. Requested a checkpoint proposal in the associated conversation, returned to Workstreams, reviewed/corrected all three fields, and explicitly confirmed persistence.
5. Added an unresolved human task.
6. Closed the browser and opened a fresh browser process. The Workstream projection restored the confirmed checkpoint and unresolved task without using chat history.
7. Selected **Resume** and PI WEB reopened the exact recorded project, workspace, and session with its transcript.
8. Closed the Workstream while the human task remained unresolved. The checkpoint, task, ledger, session, and repository files remained present; no cleanup ran.

Deterministic integration tests additionally exercise launch failure, confirmation-response loss, pending confirmation failure, reconnect reconciliation, ordered replay/snapshot fallback, concurrent Workstreams, checkpoint-failure preservation, service-module replacement, and one-home session rejection. Real child-Pi launch and cancellation evidence is recorded in `packages/pi-execution-adapter/real-smoke-evidence.md`.

Machine-local Workstream and Pi session identifiers are intentionally omitted from this repository.
