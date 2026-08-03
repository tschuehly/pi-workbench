# PI WEB Shell Strategy

Status: selected shell contract.

## Decision

PI WEB is the only user-facing Pi Workbench shell. Pi Workbench does not maintain a separate
terminal client or a second graphical adapter. PI WEB owns the interaction experience while the
Workbench Store retains V1 Workstream state.

The V1 boundary is:

```text
PI WEB -> Workstream protocol -> attended Pi session
```

A future Level 4 boundary may add a Run Controller protocol and Pi Execution, but those concepts do
not expand V1.

A PI WEB session is not a Workstream or Run. Every Workstream or Run mutation crosses its typed protocol and returns a revision-checked receipt. PI WEB renders canonical projections rather than inferring current state from conversations, tool output, or visual state.

PI WEB uses canonical Workstream revisions for cross-session re-entry. The owner chooses what to
resume directly from the Workstream projection; V1 does not launch FirstMate.

## Integration rule

Use a browser plugin or the narrowest stable PI WEB extension seam to add V1 Workstreams,
attended session launch, confirmed checkpoints, human tasks, links, closure, and typed controls.

Reuse PI WEB through the `tschuehly/pi-web` fork with a thin Workbench-owned adapter. Do not copy its source into this repository. Product and interaction choices may be developed on the fork while they are being proven through use; evaluate generic changes for upstream contribution later rather than treating contribution as a prerequisite.

Before work in the sibling `../pi-web` checkout, fetch both `upstream` and the `origin` fork. Develop and push only through a fork branch; the `upstream` remote is fetch-only.

PI WEB must not:

- own Workstream or Run state;
- reinterpret a Run as a native session or thread;
- launch another coding-agent harness;
- infer lifecycle, authority, or completion from chat or terminal text;
- bypass controller authority through private routes;
- hide authentication, recovery, permission, or connection controls.

## Required fixture

The V1 adapter is driven by a deterministic Workstream client and recorded fixtures. The fixture
covers:

- Workstream creation, attended session launch, independent confirmed checkpoints, human tasks,
  links, and closure;
- current and closed Workstreams across repositories and concurrent human-initiated sessions;
- valid, duplicate, stale, and rejected typed mutations;
- ordered watch delivery, reconnect, and snapshot reconciliation;
- focus restoration and visible missing, failed, or stale checkpoint state.

The client boundary also requires browser-safe runtime-validated messages, stable identities, bounded previews, explicit connection state, safe Markdown, keyboard and mobile support, and deterministic fakes that do not spend model tokens.

## Delivery strategy

1. Use the documented PI WEB plugin API for read-oriented projections.
2. Contribute generic navigation and primary-view seams for Workstreams.
3. Add typed mutations only through Workbench clients.
4. Add observation, focus-restoration, and hosting seams only when a proven interaction needs them.
5. Keep Workbench semantics in the adapter rather than PI WEB core.
6. Keep fork changes bounded and reviewable so generic improvements can be proposed upstream later without coupling them to Workbench semantics.

PI WEB remains privately deployed in V1. The application server stays behind trusted local or private-network ingress; the Workbench adapter does not add public sharing.

## Evidence

- [PI WEB interface evaluation](evaluation.md)
- [Pi ecosystem evidence ledger](../../research/sources/pi-ecosystem.md)
