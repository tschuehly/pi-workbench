# Fence Monitor at process launch

**Patch needed in `pi-process-monitor` (inspected: 2.0.13).** This branch specifies the patch and adds an acceptance test; it does not protect a running host.

## Why a tool wrapper is insufficient

`PiPackages.load` in `packages/durable-pilot/src/packages.ts` resolves enabled **user** packages from Pi settings and loads Monitor's extension with Pi's loader. Durable binds the package's tools, commands and session hooks. The CLI loads the same extension from `npm:pi-process-monitor@2`. `extensions/tool-groups/groups.mjs` matches the package by source and controls visibility, not execution. The `config/` settings fragment supplies no Monitor launcher.

Monitor's `spawn.ts` and `poll.ts` both call `process.ts:spawnOwned`, which starts bash directly. There is no hook for choosing its executable, arguments or environment. For example, an HTTP watcher has no shell command in the tool call: Monitor constructs it and runs it on each poll. Session restore and `/monitor-recover` can also start watchers without a new tool call. Prefixing or rejecting `source.command` would miss those launches; authorizing a poll once would outlive `/full-access off`. File and tail watchers use Node's filesystem directly and do not need a shell.

## Requested change

- Let a host bind an async **per-session launch policy** before Monitor starts or restores resources. In `spawnOwned`, immediately before each workload or probe starts, ask that policy for `{file, args, env}`. Spawn that executable directly; never pass it through an outer shell. Keep the original command for identity and receipts, and keep Monitor's process group, output caps, cancellation and cleanup. If preparation fails, report failure and do not spawn. Recheck cancellation after awaiting preparation.
- Bind the policy in Durable and the Workbench CLI to `confine` in `extensions/background-bash/sandbox.mjs`. Use the host's Chat/session identity, environment, and trusted Chat directory to compute grants, **not** the watcher's model-supplied `options.cwd`. Preserve the watcher's working directory for execution only. Use the lead's current, owner-confirmed full-access bit, never a tool argument or saved watcher setting. CLI has no such switch. Do not grant a background-bash host-operations socket.
- Require the binding for Workbench process watchers, including on reload and recovery. Refuse process launches if the policy is required but missing; do not load an older incompatible launcher in a fence-requiring host. Read the policy anew each poll tick. Keep native file observation available. Do not serialize prepared commands, environment, or access decisions into watcher history.

## Acceptance

Run the `Monitor fence:` tests in `packages/durable-pilot/test/packages.test.ts`. The normal-command test waits for actual Monitor output. The macOS test uses a disposable data directory and socket, never PI WEB. It expects both the outside write and the connection to fail, succeed after the fixture owner confirms full access, then fail again after `off`. It skips inside an existing fence: the outer fence cannot be lifted by the test host. **Expect the isolation test to fail on unpatched Monitor.**

For the upstream change, also exercise policy refusal, cancellation during preparation, a poll across `off`, a restored watcher after host restart, and the CLI with the package loaded. No active child is retroactively re-sandboxed when the owner turns full access off, just as with bash.
