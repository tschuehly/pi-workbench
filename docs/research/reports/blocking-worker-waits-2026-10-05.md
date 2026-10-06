# Long blocking waits in attended child workers (2026-10-05)

Analysis only. Nothing in this note is implemented; every change below is labelled **proposed**.
Provenance: observed during one attended Embabel lead session on 2026-10-05 (local lead session
`01a10ad8-3c49-77af-b15f-2ab67764ca3b`). Timings are summarized; no transcript content is quoted.

## Recommendation

Wait on completion events, keep independent work moving, and bound every wait with a safety
deadline. Today a child Pi cannot do all three, because it has no background tool and its dispatch
ends when its turn ends. So:

1. **Today:** native foreground `bash` already waits for its command to exit, returns its exit
   status, streams output, and can terminate the process tree at an explicit timeout. Use it directly
   for a test the Worker owns; never replace that with a fixed `sleep`. A child cannot make the lead
   do other work while the child remains in a foreground dispatch. When the lead has independent
   work, use a lead-owned background `bash` job with an explicit per-job timeout; its completion
   message starts a lead turn that can re-dispatch the Worker.
2. **Proposed, conditional:** first improve assignment guidance and use existing `bash` behavior.
   Consider a child wait tool (candidate B) only if observed cases need structured waiting on an
   external process, marker, or pattern and return that native `bash` does not already provide.
   Consider visibility (candidate E) if measured lead decisions need it. Child background execution
   (candidate C) needs an adapter settlement change and should wait for evidence that B and E are
   insufficient.

## Observed waits

| Worker | What it was blocked on | Kind |
| --- | --- | --- |
| A | One foreground `bash` running a test suite, tool timeout 7,200 s | Real test wait |
| B | Foreground `bash` loop: up to 110 × `sleep 30`, checking a gate log for an `EXIT` marker; tool timeout 3,600 s | Completion poll, 30 s granularity |
| C | Foreground `bash`: `sleep 1500`, then print the output file of a test run started earlier | Fixed delay, needless late discovery |

The evidence distinguished live tool activity and live underlying work (Maven for C), but did not
establish continuous output-log growth for each Worker. For Worker B, the gate log was at a compilation
marker and its observed modification time was about six minutes stale. A process-liveness check is
not evidence of log growth; these were point-in-time snapshots, not continuous observations. None of
the three was a provider outage. A separate reviewer child had one transient provider error and
recovered on its own.

## Three kinds of waiting

- **Real test wait.** The awaited process does work and the wait ends when it exits. Worker A is
  this. Its cost is that the Worker slot is occupied and the lead sees only "running bash" until the
  timeout or exit; it is still the correct shape when the Worker has nothing else to do.
- **Needless delayed discovery.** The wait ends at a chosen time, not at the event. Worker C is
  this: if the run finishes after five minutes, the result is found twenty minutes late; if it has
  not finished after 25 minutes, the Worker must guess again. Worker B is the bounded variant: it
  discovers completion within 30 s, but only completion; a failure printed early is not noticed
  unless the loop also checks for it.
- **Provider stall.** No tool is running and no assistant output arrives, or the session log shows
  provider errors and retries. This is unrelated to tests and is not fixed by any wait primitive.

A generic way to tell them apart from outside the child:

```sh
pgrep -fl '<test runner>'                     # awaited process alive?
stat -f '%m %z' <output.log>                  # log modified recently and growing? (macOS stat)
tail -n 3 <child session .jsonl>              # last entry a running bash, an assistant message, or a provider error?
```

## Why "running" and heartbeats are not enough

- The **Active** pill and the foreground rolling log show that a `bash` call is running and for how
  long (`summarizeToolAction` in `packages/pi-execution-adapter/src/index.js` reduces it to
  `running <command name>`). They do not say what condition ends the wait or whether it is already
  satisfied.
- `report_status` is the child's only self-report, and a child blocked inside a foreground `bash`
  cannot call it. The last report is stale for the whole wait.
- The adapter sends a child exactly one RPC `prompt` (the task); its other commands are session
  setup, state probes, and `abort`. The lead has no way to ask a running child a question or
  redirect it; its only control is cancellation.
- A heartbeat proves the Pi process is alive. It does not prove the awaited work progresses, and it
  cannot distinguish worker A (correct), C (wasting minutes), or a hung process.

## Verified current capabilities

| Capability | Lead session | Subagent or Worker child |
| --- | --- | --- |
| `bash` | Workbench extension backgrounds it by default; a `foreground` call that runs longer than 30 s continues as a background job; each job's timeout is explicit if supplied, otherwise its runner lifetime applies (`extensions/background-bash/README.md`, `jobs.mjs`) | Native Pi `bash`, foreground only. It waits for shell exit, streams output, returns exit status, and accepts an optional timeout. `extensions/background-bash/index.ts` returns early when `PI_WORKBENCH_EXECUTION_KIND` is set |
| `bash` timeout | Explicit per job; if omitted, the job runner uses its configured 12-hour lifetime. Explicit timeouts can be longer (up to the supported timer limit). | Optional per call, no default; timeout terminates the process tree (Pi 0.99.0 native tool) |
| pi-process-monitor (`monitor*`) | Through `tools_enable({ group: "monitor" })` | Not available: not in `CHILD_TOOLS` (`extensions/subagent/index.ts`), and tool groups never register in children (`extensions/tool-groups/README.md`) |
| Background Subagent with completion signal | Yes (Decisions 98–99, `docs/plans/level-1-subagents.md`) | No: inside a Worker, `background: true` fails preflight; leaf profiles have no delegation tools |
| End turn and be woken later | Yes | No: the adapter finishes the dispatch when the RPC run settles (`agent_settled`), or when its post-final-message idle probe finds no pending work. A `turn_end` alone is not the settlement condition. |
| Lead → running child message | — | No: Pi RPC offers `steer` and `follow_up`, but the adapter does not send them |

So the only event-driven way for the lead to remain available while a long command runs is in the
lead: a background `bash` job, or a background Worker dispatch whose completion signal starts the
next lead turn (`docs/plans/level-1-durable-workers.md`, "Tool surface"). This is distinct from
Decision 99's **guidance** that leads prefer background Subagent/Worker dispatch: that policy does
not grant child processes a background bash tool or turn-wait capability.

## Support gap for child-native tools

A child can only wait by blocking in a foreground tool call. That is deliberate: "Subagents and
Workers retain native foreground bash so they cannot exit before a command finishes"
(`extensions/background-bash/README.md`). The gap is not process-exit waiting. Native child bash already waits for an invoked command, streams its output, returns its exit
status, and enforces an optional timeout. The remaining gap is
structured waiting on an **external** condition (such as another process, marker file, or failure
pattern) with a report of which condition fired; shell loops approximate that. Advising a child to
use `background: true` or `monitor` is wrong: neither exists in its tool set.

## What the next assignments can do today

No runtime change is needed for these.

1. **Let the command end the wait.** Run the test directly in the foreground with a `timeout`
   sized to the expected run plus margin. It returns at exit, not at a guess.
2. **When the process already runs**, poll its completion marker at 10–30 s with a failure check and
   a deadline below the tool timeout:

   ```sh
   deadline=$((SECONDS + 3000))
   until grep -q '^EXIT=' run.log; do
     grep -qE 'BUILD FAILURE|FAILED' run.log && break    # fail fast
     [ "$SECONDS" -ge "$deadline" ] && { echo 'DEADLINE'; break; }
     sleep 15
   done; tail -n 40 run.log
   ```

   Start such runs as `cmd > run.log 2>&1; rc=$?; echo "EXIT=$rc" >> run.log` so the marker
   contains the exit status. **A failure-pattern or deadline break only stops this watcher; it does
   not establish that the producer exited.** Do not report completion or infer an exit status until
   the `EXIT` marker (or an observed process exit plus its status) is available. macOS `tail` has
   no `--pid`; use `while kill -0 <pid>` for a process the child did not start.
3. **Move the wait to the lead when the lead has other work.** The Worker prepares the run and
   returns the exact command and output path. The lead starts that command as a background `bash`
   job with a timeout, continues, and re-dispatches the same Worker with the completion output; the
   Worker's session continuity keeps its context.
4. **Name the stop condition in the assignment**: what event ends the wait, the deadline, and what
   to report if the deadline fires.

## Implementation candidates (proposed, not implemented)

- **A. Guidance only.** Add the rules above to the child assignment wrapper (`STATUS_INSTRUCTION`
  in `extensions/subagent/index.ts`), which is prepended to every child task. Adds tokens to every
  dispatch; keep it to a few lines.
- **B. Child wait tool (only if observed need remains).** A foreground structured wait for an
  externally owned process, marker, or log pattern, with a mandatory deadline and explicit result
  naming the condition that fired. It must not duplicate native `bash`'s existing foreground
  process wait, output streaming, exit status, or timeout. Keeps the "child cannot exit early"
  invariant.
- **C. Child background execution.** Allow background `bash` in children, and change the adapter
  so a dispatch does not settle while a child-owned job runs; completion steers the child. Largest
  change: it touches run settlement, cancellation, and the guarantee that no child process outlives
  its dispatch.
- **D. Lead → child steer.** Expose Pi RPC `steer` so the lead can redirect a running child.
  Pi delivers a steer after the current tool calls finish and before the next model call, so it
  does not interrupt a blocked `bash`; cancellation stays the hard stop.
- **E. Wait visibility.** Show the child's current wait condition, elapsed time, and awaited log
  growth in the Active pill and `subagent_status`/`worker_status`, so the lead can tell kinds of
  waiting apart without reading logs.

## Acceptance tests for later

- B (only if built): a scripted child waiting on an external marker returns within 2 s of the marker
  appearing; a failure-pattern result explicitly says the producer may still be running; a deadline
  returns `deadline` without claiming completion. No child call can omit the deadline. Native bash
  process waits continue to return their actual exit status and timeout outcome.
- E: while a child waits, lead status shows the declared condition; only claim output growth when
  repeated observations demonstrate it, not from process liveness or one snapshot.
- C: a child that starts a background job and ends its turn does not settle; job completion starts
  one child turn; cancelling the dispatch kills the job; nothing survives session shutdown.
- D: a steer sent during a running child tool is delivered after that tool ends and before the next
  model response.
- Replay of today's pattern: with A or B in place, no child tool call in a sample of attended
  sessions contains a bare `sleep` of 300 s or more.

## Limits

- Three Workers in one session; no measurement of how often the pattern occurs elsewhere.
- Process and log liveness was checked at one point in time, not over the full wait.
- Candidate costs and context-size changes are unmeasured.
