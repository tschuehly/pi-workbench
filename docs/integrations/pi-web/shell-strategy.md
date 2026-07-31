# PI WEB Shell Strategy

Status: selected shell contract.

## Decision

PI WEB is the only user-facing Pi Workbench shell. Pi Workbench does not maintain a separate terminal client or a second graphical adapter. PI WEB owns the interaction experience while typed Workbench services retain Workstream, Run, authority, evidence, dispatch, and workspace state.

The boundary is:

```text
PI WEB -> Workstream protocol
       -> Run Controller protocol -> Pi Execution -> Pi sessions and processes
```

A PI WEB session is not a Workstream or Run. Every Workstream or Run mutation crosses its typed protocol and returns a revision-checked receipt. PI WEB renders canonical projections rather than inferring current state from conversations, tool output, or visual state.

PI WEB implements the [Graphical Attention Contract](../../contracts/graphical-attention.md): FirstMate supports cross-session re-entry, required judgments remain distinct from ordinary human tasks, and interruption state comes from canonical revisions.

## Integration rule

Use a browser plugin or the narrowest stable upstream extension seam to add Workstreams, FirstMate, Run status, Attention Items, Judgment Dossiers, evidence links, typed controls, and task-shaped Review Surfaces.

Reuse PI WEB as an upstream product with a thin Workbench-owned adapter. Do not copy its source into this repository. Maintain a bounded fork only when an accepted Workbench interaction cannot be expressed through stable upstream seams and the shared fixture demonstrates that the maintenance cost is justified.

PI WEB must not:

- own Workstream or Run state;
- reinterpret a Run as a native session or thread;
- launch another coding-agent harness;
- infer lifecycle, authority, or completion from chat or terminal text;
- bypass controller authority through private routes;
- hide authentication, recovery, permission, or connection controls.

## Required fixture

The adapter is driven by deterministic Workstream and Run clients and recorded fixtures. The fixture covers:

- Workstream creation, session launch, independent latest checkpoints, human tasks, links, and closure;
- FirstMate re-entry across repositories and concurrent sessions;
- Run list, status, and pending Attention Items;
- action-first focused judgments and activity progressing without the owner;
- Judgment Dossier and Primary Evidence navigation;
- diff-centered review with target-anchored feedback;
- valid, duplicate, stale, and rejected typed mutations;
- ordered watch delivery, reconnect, and snapshot reconciliation;
- focus restoration and stale-feedback presentation;
- read-only behavior without the control lease.

The client boundary also requires browser-safe runtime-validated messages, stable identities, bounded previews, explicit connection state, safe Markdown, keyboard and mobile support, and deterministic fakes that do not spend model tokens.

## Delivery strategy

1. Use the documented PI WEB plugin API for read-oriented projections.
2. Contribute generic navigation and primary-view seams for Workstreams and Entry Presets.
3. Add typed mutations only through Workbench clients.
4. Add observation, focus-restoration, and hosting seams only when a proven interaction needs them.
5. Keep Workbench semantics in the adapter rather than PI WEB core.
6. Maintain a bounded fork only when stable upstream seams cannot support an accepted interaction.

PI WEB remains privately deployed in V1. The application server stays behind trusted local or private-network ingress; the Workbench adapter does not add public sharing.

## Evidence

- [PI WEB interface evaluation](evaluation.md)
- [Pi ecosystem evidence ledger](../../research/sources/pi-ecosystem.md)
