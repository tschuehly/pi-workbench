# Long blocking waits in attended child workers (2026-10-05)

Analysis only. Nothing in this note is implemented; every change below is labelled **proposed**.
Provenance: observed during one attended Embabel lead session on 2026-10-05 (local lead session
`01a10ad8-3c49-77af-b15f-2ab67764ca3b`). Timings are summarized; no transcript content is quoted.

## Recommendation

Wait on completion events, keep independent work moving, and bound every wait with a safety
deadline. Today a child Pi cannot do all three, because it has no background tool and its dispatch
ends when its turn ends. So:

1. **Today:** the long command should end the wait the moment it exits (run it in the foreground,
   or poll a completion marker at a short interval with fail-fast checks and a deadline). Never wait
   on a fixed `sleep`. When the lead has other work, the long command belongs to the **lead** as a
   background `bash` job, whose completion message starts a lead turn that re-dispatches the Worker.
2. **Proposed:** give children a completion-triggered wait primitive (candidate B below) and make
   the waited-on condition visible to the lead (candidate E). Child background execution
   (candidate C) needs an adapter settlement change and should wait for evidence that B and E are
   not enough.

## Observed waits

| Worker | What it was blocked on | Kind |
| --- | --- | --- |
| A | One foreground `bash` running a test suite, tool timeout 7,200 s | Real test wait |
| B | Foreground `bash` loop: up to 110 × `sleep 30`, checking a gate log for an `EXIT` marker; tool timeout 3,600 s | Completion poll, 30 s granularity |
| C | Foreground `bash`: `sleep 1500`, then print the output file of a test run started earlier | Fixed delay, needless late discovery |

For each Worker the logs showed recent tool activity, a live underlying process (Maven for C), and
a growing output log. None of the three was a provider outage. A separate reviewer child had one
transient provider error and recovered on its own.

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
| `bash` | Background by default; completion message starts a turn (`extensions/background-bash/README.md`) | Native Pi `bash`, foreground only. `extensions/background-bash/index.ts` returns early when `PI_WORKBENCH_EXECUTION_KIND` is set |
| `bash` timeout | Per job, 12-hour maximum lifetime | Optional per call, no default (Pi 0.99.0 native tool) |
| pi-process-monitor (`monitor*`) | Through `tools_enable({ group: "monitor" })` | Not available: not in `CHILD_TOOLS` (`extensions/subagent/index.ts`), and tool groups never register in children (`extensions/tool-groups/README.md`) |
| Background Subagent with completion signal | Yes (Decisions 98–99, `docs/plans/level-1-subagents.md`) | No: inside a Worker, `background: true` fails preflight; leaf profiles have no delegation tools |
| End turn and be woken later | Yes | No: the adapter finishes the dispatch at `agent_settled`, or when an idle probe finds no pending work after a final assistant message |
| Lead → running child message | — | No: Pi RPC offers `steer` and `follow_up`, but the adapter does not send them |

So the only event-driven completion path that exists today for a long command is in the lead:
a background `bash` job, or a background Worker dispatch whose completion signal starts the next lead
turn (`docs/plans/level-1-durable-workers.md`, "Tool surface").

## Support gap for child-native tools

A child can only wait by blocking in a foreground tool call. That is deliberate: "Subagents and
Workers retain native foreground bash so they cannot exit before a command finishes"
(`extensions/background-bash/README.md`). The gap is that the child has no tool whose blocking ends
on a declared condition (process exit, marker file, failure pattern) and reports which condition
fired. Shell loops approximate it, with a granularity, deadline, and fail-fast check each assignment
must get right by hand. Advising a child to use `background: true` or `monitor` is wrong: neither
exists in its tool set.

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

   Start such runs as `cmd > run.log 2>&1; echo "EXIT=$?" >> run.log` so the marker exists.
   macOS `tail` has no `--pid`; use `while kill -0 <pid>` for a process the child did not start.
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
- **B. Child wait tool.** A foreground `await` tool for children: wait for process exit, a file or
  marker, or a log pattern; mandatory deadline; streams elapsed time, log size, and last line as
  tool progress; returns which condition fired. Keeps the "child cannot exit early" invariant.
- **C. Child background execution.** Allow background `bash` in children, and change the adapter
  so a dispatch does not settle while a child-owned job runs; completion steers the child. Largest
  change: it touches settlement, cancellation, and the guarantee that no child process outlives its
  dispatch.
- **D. Lead → child steer.** Expose Pi RPC `steer` so the lead can redirect a running child.
  Pi delivers a steer after the current tool calls finish and before the next model call, so it
  does not interrupt a blocked `bash`; cancellation stays the hard stop.
- **E. Wait visibility.** Show the child's current wait condition, elapsed time, and awaited log
  growth in the Active pill and `subagent_status`/`worker_status`, so the lead can tell kinds of
  waiting apart without reading logs.

## Acceptance tests for later

- B: a scripted child waiting on a marker returns within 2 s of the marker appearing; on a failure
  pattern, within 2 s of the line; on the deadline, at the deadline with a `deadline` result. No
  child call can omit the deadline.
- B/E: while a child waits, lead status shows the condition and an output size that grows with the
  log, with no child turn spent.
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
