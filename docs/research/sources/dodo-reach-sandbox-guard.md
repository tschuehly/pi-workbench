# DODOREACH Sandbox and Destructive-Command Guard Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

Research only. Nothing in this ledger is an accepted recommendation, an approved plan, or a settled
decision. Every classification below is a candidate for a later separate decision.

## Verdict

The Pi sandbox example is real, inspectable evidence for exactly one mechanism: kernel-level
confinement of the `bash` tool's filesystem and network access on macOS and Linux. It is not evidence
for DODOREACH's private destructive-command guard, which remains an unlinked claim with no described
implementation. The two mechanisms answer different questions — "what can this process touch at all"
versus "should this particular command run" — and neither substitutes for the other. The example's
default write policy permits destroying the working directory, and a command-pattern guard permits
anything it fails to match.

Pi Workbench's current baseline is the honest absence of both: no sandbox extension is distributed,
and Level 1 documents state plainly that filesystem, process, and network confinement does not
exist. That baseline is truthful but offers no containment. Importantly, the example initializes
fail-open, which directly contradicts the Workbench requirement that a later sandbox adapter must
fail preflight when a requested restriction cannot be enforced.

## Scope and method

The analysis inspected the sandbox example shipped with Pi 0.84.1 and cross-checked the same
implementation in upstream source. The example's `package.json` declares
`@anthropic-ai/sandbox-runtime` `0.0.26`. The inspected copies differed only in branding and
configuration paths; enforcement logic, activation logic, and defaults were identical. Findings
below describe the Pi 0.84.1 implementation linked by the thread.

DODOREACH's destructive-command guard is private and unlinked. The only recorded source statement is
the one already captured in [`dodo-reach-pi-tool-shaping.md`](dodo-reach-pi-tool-shaping.md): the
guard exists among their personal Pi remixes. Its trigger set, enforcement point, failure behavior,
and outcomes are unknown, and no public package is attributed to it here. Public Pi examples are
cited only as the observable *class* of in-process guards, never as DODOREACH's implementation.

## What the sandbox example demonstrates

### Enforcement point: the `bash` tool, and only the `bash` tool

The extension registers a replacement tool labelled `bash (sandboxed)` over Pi's built-in `bash`, and
hooks `user_bash` so owner-typed shell commands use the same operations. Confinement is applied by
`SandboxManager.wrapWithSandbox(command)` and then `spawn("bash", ["-c", wrapped], { detached: true })`,
with group `SIGKILL` on timeout or abort.

Consequences that follow directly from that placement:

- Pi's `read`, `write`, and `edit` tools are untouched. The extension's header states the intent is to
  restrict bash; nothing in the file mediates the file tools.
- Extension code itself, including this extension, runs in the Pi process outside the wrapper.
- Processes not started through the `bash` tool are outside the confinement. This matters concretely
  for Workbench: `packages/pi-execution-adapter/src/index.js:110` spawns child Pi processes with
  `shell: false`, so an OS bash sandbox in the lead session would not confine attended child Pi
  execution.

### Policy: merged config with permissive defaults

`DEFAULT_CONFIG` allows npm, PyPI, and GitHub domains; denies reads of `~/.ssh`, `~/.aws`, `~/.gnupg`;
allows writes to `.` and `/tmp`; and denies writes to `.env`, `.env.*`, `*.pem`, `*.key`. Global
`~/.pi/agent/extensions/sandbox.json` is merged, then project `<cwd>/.pi/sandbox.json` wins. An
unparseable config file produces a `console.error` warning and is skipped, so a typo silently widens
policy back toward the defaults rather than stopping the session.

The default write allowance is the whole working directory. Under this policy `rm -rf .` inside the
project is *permitted confinement behavior*. OS confinement bounds blast radius; it does not express
intent about destruction inside the allowed radius.

### Activation: explicit opt-outs plus fail-open enforcement failures

`session_start` disables the sandbox and continues the session when:

- `--no-sandbox` is passed (`ctx.ui.notify(..., "warning")`);
- config sets `enabled: false` (`info` notice);
- the platform is neither `darwin` nor `linux` (`warning`);
- `SandboxManager.initialize(...)` throws — the handler sets `sandboxEnabled = false`, emits an
  `error` notification, and the session proceeds with unconfined bash.

The registered flag `--no-sandbox` is a plain boolean with no confirmation, and the tool's `execute`
falls back to unsandboxed `localBash` whenever `sandboxEnabled` or `sandboxInitialized` is false. So
the same session can present a sandbox-labelled tool while executing unconfined commands, with the
only difference being a transient notification the model never sees. `session_shutdown` calls
`SandboxManager.reset()` and swallows errors.

### Visibility: TUI-shaped

On success the extension calls `ctx.ui.setStatus("sandbox", "🔒 Sandbox: N domains, M write paths")`
and registers a `/sandbox` command that prints the resolved policy through `ctx.ui.notify`. Under an
RPC host such as PI WEB, `setStatus` reaches Pi's no-op UI context and disappears; notifications
survive. The confinement claim would therefore be least visible exactly where a Workbench owner
works. See [`dodo-reach-status-widgets.md`](dodo-reach-status-widgets.md) for that evidence.

## What a destructive-command guard is, and is not

DODOREACH's guard is private; the following describes the observable public class of the mechanism,
not their code. Pi's own examples show it plainly: `examples/extensions/permission-gate.ts` matches
`bash` input against regexes (`rm -rf`, `sudo`, `chmod/chown 777`), asks through `ctx.ui.select`, and
returns `{ block: true, reason }` — blocking by default when no UI is available.
`examples/extensions/protected-paths.ts` applies the same `tool_call` interception to `write` and
`edit` for `.env`, `.git/`, and `node_modules/`.

| Property | OS confinement (sandbox example) | Destructive-command guard (class) |
| --- | --- | --- |
| Authority | Kernel policy via `sandbox-exec` / Bubblewrap | In-process `tool_call` interception |
| Decides on | Reachable files, paths, and domains | The command string or tool input |
| Ignorance mode | Cannot be argued out of an unreachable path | Silent on any phrasing it does not match |
| Blast radius inside policy | Unlimited (`.` is writable by default) | Can refuse specific destructive intents |
| Adversarial strength | Meaningful, if initialization succeeded | Cooperative regex/string matching; useful against accidents but bypassable by indirection |
| Human cost | One-time policy authoring | Recurring interruption per matched command |

The honest conclusion is that they are complementary and neither is a confinement claim on its own.
A guard that reports "blocked" while a fail-open sandbox is silently inactive is the worst of both:
the owner believes containment exists where only string matching did.

## Comparison with implemented Workbench reality

Workbench distributes four extensions (`autonomous-grill`, `context-checkpoint`, `quota-startup`,
`subagent`). None is a sandbox or a command guard, and `config/pi-agent-settings.example.json`
declares no sandbox configuration. The `packages/controller/` and `packages/artifact-store/`
directories are empty, so no managed authority boundary exists to fall back on.

The documented baseline is explicit rather than accidental:

- [`docs/foundation/decisions.md`](../../foundation/decisions.md) item 89: children share the attended
  parent's local trust boundary; "Pi tool allowlists are enforced, while filesystem, process, and
  network sandboxing remain explicitly absent."
- [`docs/plans/level-1-subagents.md`](../../plans/level-1-subagents.md) lines 68–72: V1 makes no
  confinement claim, and "a later sandbox adapter must fail preflight whenever a requested filesystem,
  process, or network restriction cannot be enforced."
- [`docs/plans/credential-broker.md`](../../plans/credential-broker.md) lines 30 and 41: the broker is
  explicitly not an adversarial isolation boundary precisely because Level 1 has no sandbox.

So Workbench is better on truthfulness — it does not label anything sandboxed — and strictly weaker
on containment, since unrestricted local bash is the current reality. The example is better at real
containment when it initializes, and worse on truthfulness, because its fail-open activation and
`--no-sandbox` flag can leave a sandbox-labelled tool running unconfined commands. Installing the
example unchanged would import the exact failure mode that the Level 1 plan already forbids.

Prior Workbench research already reaches a more specific, still-unaccepted candidate:
[`pi-package-evaluation.md`](pi-package-evaluation.md) prefers the maintained Apache-2.0
`@carderne/sandbox-runtime` fork over this example's older `@anthropic-ai/sandbox-runtime`, places the
adapter under Pi Execution rather than session UI, derives policy only from the validated Execution
Profile, Work Packet, workspace lease, and domain allowlist, and fails closed. Any later experiment
must reconcile that package and ownership choice rather than treating this example as the only option.

## Candidate lessons (none accepted)

- **Experiment — reconcile and test the existing Pi Execution sandbox candidate.** Compare
  `@carderne/sandbox-runtime` with the older Anthropic runtime used by this example, then exercise one
  fail-closed policy through the narrow Pi Execution seam. An unavailable or failed sandbox must stop
  the restricted launch rather than silently continue. Falsifier: a forced initialization failure
  still launches an unrestricted process or presents a sandboxed posture. This does not decide
  whether an earlier Level 1 extension-only experiment is justified.
- **Experiment — measure the real scope gap first.** Before any adoption, confirm how much Workbench
  activity actually flows through the `bash` tool versus `read`/`write`/`edit` and directly spawned
  child Pi processes. If most mutation avoids bash, bash-only confinement buys little and risks a
  false sense of containment.
- **Reject — presenting a destructive-command guard as confinement.** Level 1 documents already
  forbid representing prompt or policy guidance as authority enforcement. A pattern guard may be
  useful against accidents; it must never appear in a posture statement as isolation.
- **Insufficient evidence — DODOREACH's guard as a design source.** With no linked implementation,
  trigger set, or outcome data, there is nothing to adopt, adapt, or fairly reject.

## Open questions

1. What fraction of attended and child Pi mutation actually passes through the `bash` tool in
   Workbench sessions, and would bash-only confinement measurably reduce risk?
2. Does the previously evaluated `@carderne/sandbox-runtime` remain the stronger current library,
   and should confinement wait for its Pi Execution ownership seam or receive a smaller Level 1
   experiment first?
3. Should confinement state be part of the truthful Level 1 posture shown in PI WEB, given that
   `setStatus` does not reach the browser?
4. How would child Pi processes spawned with `shell: false` be confined, and does that require the
   execution adapter rather than an extension?
5. Which destructive actions are worth an interruption at all, measured against the interruption cost
   to Human Attention and the guard's demonstrable evasion by rephrasing?

## Confidence and limitations

High confidence in every statement about the sandbox example's code paths, defaults, activation, and
scope: they are direct reads of the inspected files, corroborated across two copies. High confidence
in the Workbench baseline statements, which are direct reads of repository files and empty package
directories. No confidence — and no claim — regarding DODOREACH's private guard beyond its existence
as reported in the prior ledger. The runtime confinement strength of
`@anthropic-ai/sandbox-runtime` `0.0.26` itself was not tested; this review inspected the extension,
not the sandbox runtime's kernel policy generation.
