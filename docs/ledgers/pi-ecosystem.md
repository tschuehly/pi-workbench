# Pi Ecosystem Evidence Ledger

## Scope

Current Pi, pi-gui, provider integration, multi-model orchestration, and dynamic UI evidence reviewed on 2026-07-15.

## Findings

1. Pi intentionally provides a small coding-agent core and expects extensions, skills, and packages to define higher-level behavior.
   - Source: [Pi coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
2. Pi supports extension UI primitives such as select, confirm, input, editor, notifications, status, and text widgets. Arbitrary custom UI is not supported through RPC.
   - Source: [Pi RPC documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
3. pi-gui provides an Electron/React shell with workspaces, sessions, timeline, worktrees, terminal, diff review, extension management, notifications, and child-thread orchestration.
   - Source: [pi-gui](https://github.com/minghinmatthewlam/pi-gui)
4. pi-gui's current extension host renders fixed dialogs and text widgets. It explicitly rejects terminal-only custom Pi UI.
   - Source: [unsupported host UI](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/unsupported-host-ui.ts)
5. The pi-gui author stated on 2026-07-15 that extension bundles should be able to change pi-gui's UI in the future.
   - Source: [@mattlam_ on X](https://x.com/mattlam_/status/2077378407772414206)
6. Davis's Pi setup demonstrates Pi as the main thread with Claude and Codex workers, dynamic workflows, background terminals, and task-specific custom terminal UI.
   - Sources: [my-pi-setup](https://github.com/davis7dotsh/my-pi-setup), [@davis7 on X](https://x.com/davis7/status/2077157941371949285)
7. Davis's custom UI depends on `ctx.ui.custom`, while pi-gui rejects that UI class. The setup is an orchestration reference, not a drop-in GUI package.
8. Davis invokes Claude through the official Claude Agent SDK and Codex through `codex app-server`; this demonstrates multi-harness orchestration but is not part of the intended worker runtime.
   - Sources: [Claude Agent SDK plan support](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [Codex app-server](https://learn.chatgpt.com/docs/app-server)
9. `pi-claude-code-use` rewrites identifying prompts and tool names to resemble Claude Code. Its behavior depends on undocumented provider classification and is not a suitable architectural foundation.
   - Source: [package README](https://github.com/ben-vargas/pi-packages/blob/main/packages/pi-claude-code-use/README.md)
10. Declarative, catalog-constrained UI and sandboxed MCP application views are relevant surface-host patterns.
    - Sources: [A2UI](https://github.com/google/A2UI), [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter)
11. Pi's SDK creates independent agent sessions with an explicit model, tool set, session manager, event subscription, steering, cancellation, and compaction controls.
    - Source: [Pi SDK documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
12. Pi's official subagent example spawns isolated Pi processes, binds model, tools, and system prompt per agent, streams JSON events, supports cancellation, and offers single, parallel, and chain execution.
    - Source: [Pi subagent extension](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent)
13. Pi session files can record parent-session relationships, while the runtime supports new-session, switch, fork, and clone operations. These primitives support resumable worker identities without making conversation history the workflow ledger.
    - Sources: [Pi session format](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md), [Pi SDK documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
14. Pi exposes provider-dependent cache-retention and session-affinity options together with cache-read and cache-write usage. Providers may ignore unsupported affinity options, so per-worker cache reuse must be observed rather than assumed.
    - Source: [Pi AI stream options](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/types.ts)
15. The current `skill-incubator` repository already separates native and vendored skills, records vendored provenance, and links skills into multiple runtimes. Its declared purpose is experimentation and publication, and its active launcher and agent formats are coupled to Claude, Codex, and `claudex`.
    - Source: [skill-incubator README](/Users/tschuehly/IdeaProjects/skill-incubator/README.md)

## Implications

- Contribute a generic durable-run and surface-host boundary to pi-gui before adding project-specific features.
- Use a short-lived proof fork only when necessary to validate the protocol.
- Keep workflow semantics in Pi and repository packages, not React components.
- Treat session history as conversation history rather than authoritative workflow state.
- Run all model-backed roles as Pi workers and select Claude, Codex, or another model through Pi.
- Treat resumable Pi workers and ephemeral Pi subagents as different lifecycle contracts even when both use the same underlying agent runtime.
- Build programmatic Quality Loop dispatch on the Pi SDK and structured Pi event stream rather than provider-specific coding-agent interfaces.
- Treat cache retention as a measurable routing input, not a durable-state or correctness primitive.
- Use one Pi package repository as the cloneable distribution unit for extensions, curated skills, prompts, adapters, and project-independent configuration; keep project overlays in target repositories.
- Preserve incubation and stable distribution as distinct trust levels so experimental skills do not silently enter every cloned harness.
- Expose enhanced skill interactions through a harness-owned semantic boundary with terminal fallback instead of coupling skills directly to pi-gui or terminal-only custom components.

## Confidence

- Repository and documentation findings: high.
- X author direction: medium-high and time-sensitive.
- Upstream acceptance of the proposed surface protocol: unknown.
