# PI WEB evaluation

## Conclusion

PI WEB is the selected Workbench shell because it already owns the operational shell Pi Workbench needs: persistent Pi sessions, projects, workspaces and worktrees, terminals, files, remote machines, reconnect behavior, browser and mobile access, package management, and a plugin host.

That reuse is valuable only if Workbench remains a separate client domain. PI WEB sessions are not Runs, PI WEB state is not authoritative Run state, and Workbench mutations must cross the typed Run client rather than private routes or terminal text.

The shell boundary and acceptance fixture live in [shell-strategy.md](shell-strategy.md). The upstream contribution sequence lives in [customization-plan.md](customization-plan.md).

## Existing fit

PI WEB already provides:

- Long-lived Pi session ownership separated from restartable browser and web processes.
- Projects, repositories, workspaces, and Git worktrees.
- Multiple concurrent sessions, terminals, and file browsing.
- Local and remote machine operation.
- Browser access across desktop and mobile.
- Pi package management.
- A documented browser-plugin system with actions, workspace panels, labels, file helpers, terminal helpers, and semantic presentation tokens.

Reusing these capabilities avoids rebuilding session hosting, reconnect, navigation, responsive layout, remote-machine support, packaging, and operational tooling before Workbench can test its distinct value: controller-owned Runs, durable attention, evidence, authority, and Review Surfaces.

## Proven through the v1 probe

The Workbench adapter under `packages/pi-web-integration/` demonstrates that the documented plugin interface can:

- Open a qualified workspace panel from an action.
- Present Run status, pending Human Attention, autonomous activity, and Primary Evidence from a deterministic projection.
- Add compact workspace labels using an asynchronous file cache and host invalidation.
- Read and preview workspace-relative evidence.
- Inherit compact presentation tokens without selectors or global CSS.
- Remain read-oriented without inferring a Run from a PI WEB session.

The detailed observations and gaps are recorded in [`packages/pi-web-integration/v1-probe-evidence.md`](../../../packages/pi-web-integration/v1-probe-evidence.md).

The subsequent upstream vertical slice adds qualified navigation entries and primary views. The
Workbench adapter proves them with a read-only Workstreams destination over a deterministic fake
client, including route restoration, focus transfer, reconnect presentation, narrow and mobile
layouts, and visible access back to Conversation and protected shell controls.

## Missing stable interfaces

The current plugin interface does not yet provide stable support for:

- Ordered observation of an external managed Run event stream across disconnect and reconnect.
- Typed managed Run commands and receipts. Workstreams now use the narrower plugin-scoped JSON
  service transport.
- Run control leases, authority, or durable attention semantics.
- Namespaced plugin preference and focus-restoration state sufficient for richer Review Surfaces.
- Portfolio-wide attention independent of the selected workspace.
- Native file-viewer navigation to a referenced evidence path.

Plugins can reach private PI WEB routes and runtime objects, but those surfaces are explicitly unstable and are not part of the Workbench contract.

## Trust and security limits

PI WEB assumes trusted users, repositories, plugins, and server paths. It is not a sandbox, permission system, or multi-tenant authorization layer. Workbench must enforce its Autonomy Envelope, workspace leases, lifecycle transitions, revisions, and authority independently.

Installed PI WEB plugins are trusted browser code. Repository- or agent-generated project surfaces require the separate constrained or sandboxed hosting model. Authentication, connection state, settings, recovery, and protected shell controls remain PI WEB-owned and visible.

## Evaluation status

The v1 probe and Workstreams primary-view slice justify continued PI WEB adaptation. The generic
navigation and primary-view interfaces and typed Workstream transport are now proven. The adapter
does not yet prove attended session-launch orchestration, checkpoint confirmation, or the complete
V1 resume workflow.

A fork remains unnecessary while generic upstream seams can express accepted interactions. PI WEB must pass the shared fixture for typed Workstream and Run controls, ordered observation, durable attention, reconnect behavior, responsive review, and accessibility as those capabilities are added.
