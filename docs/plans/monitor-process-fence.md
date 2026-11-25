# Fence Monitor at process launch

The pinned fork of `pi-process-monitor` (based on 2.0.13) asks the host for a launch policy on session start and reload. Each workload and shell probe awaits that policy before spawning, including timer ticks and recovery. No policy, a refusal, or cancellation during preparation means no launch. Tail and file watchers still observe files directly. The original command, not the prepared arguments or environment, identifies the watcher.

Both Workbench hosts register the policy before Monitor restores watchers. `confine` uses the session's directory and temp grant, not the watcher's `options.cwd`. Monitor keeps that working directory for execution. No host-operations socket is supplied. In Durable, the confirmed lead's `/full-access` switch is read on each launch. Child callers, restored timers without a verified caller, and CLI sessions do not get that exception. Turning the switch off does not retroactively fence an already running process.

Replace just the npm Monitor entry with the git source from `config/pi-agent-settings.example.json`. Restart hosts; do not hot-reload an old unfenced timer. Durable skips pre-hook Monitor packages before loading their code. Pi CLI must load the fork **instead of**, not alongside, the old npm package.

## Verify

With the fork checked out at `~/IdeaProjects/pi-process-monitor`, from `packages/durable-pilot` run:

```sh
node --test --test-name-pattern='Monitor fence:' test/packages.test.ts
```

Run in an unfenced macOS terminal to verify the outside write and disposable socket are denied, allowed with confirmed full access, and denied again after `off`. The test skips only that case inside another fence or off macOS. The other tests exercise actual Monitor output and rejection of incompatible packages. Fork unit tests cover policy refusal, pending-launch cancellation, timer re-evaluation and restored watchers.
