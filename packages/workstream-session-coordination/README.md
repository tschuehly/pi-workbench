# Workstream Session Coordination

Host-neutral coordination for creating attended Pi sessions with one authoritative Workstream home.
The module owns continuation candidate classification, guarded checkpoint selection, prompt framing,
pending-before-launch ordering, revision retries, confirmation, cancellation, known failure, and
owning-host reconciliation.

The external interface is intentionally small:

```js
const coordination = new WorkstreamSessionCoordination(options);
await coordination.inspectContinuation(workstreamId);
await coordination.launch(request);
await coordination.reconcile(workstreamId);
```

Construction injects two adapters:

- `withWorkstreamClient(fn)` reopens a client exposing only `inspect` and `append` for every durable
  step;
- `attendedSession` checks an exact location, creates a session, and looks up a durable operation
  token without relaunching.

PI WEB provides a compatibility adapter over its host runtime; a future Pi terminal extension must
provide a separate adapter. The module contains no DOM, TUI, filesystem, Store-construction, or
machine-location assumptions. Each caller supplies an `operationId` that is globally unique inside
its producer namespace and reuses it only for an exact retry. Runtime uncertainty preserves the pending association. If the host
reports a created session but confirmation cannot be proven, `launch` returns the session as
`unconfirmed`; durable one-home violations return `conflict`, and pre-launch Store failures return
`unavailable`. Exact retries inspect or look up the existing durable operation and never relaunch it.
