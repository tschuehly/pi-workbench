# Background bash

In an attended lead Pi session, this package overrides the model-callable `bash` tool. Commands run in the background by default, return a job ID immediately, show elapsed time and output bytes in Activity, and send the exit status plus recent output to the Chat when they finish. Every call carries a required short `description` (3–10 plain words) that Chat and Activity show instead of the raw command.

Set `foreground: true` when a following action needs the command's exit status or output before proceeding. A foreground call still runs as a job: it returns the output inline if the command finishes within 30 seconds, otherwise it returns the job ID and the completion arrives like any background job, so a slow command never holds the agent. Foreground output is not streamed while waiting. After a background launch, continue independent work or end the turn; completion arrives automatically. `bash_status` is a diagnostic snapshot, not a way to poll for completion; use `bash_cancel` to stop a job. At most eight jobs per session run concurrently. Background jobs are attended session work, not durable Run jobs.

Jobs survive session shutdown, `/reload`, and PI WEB session-daemon restarts, including promotion. Each job runs under a small detached runner (`runner.mjs`) that leads its own process group, so it no longer belongs to the Pi process or daemon that started it. The runner writes the output log and a one-shot exit record, and kills the job's process group at its `timeout` or, without one, after a 12-hour maximum lifetime. Processes the command deliberately moves into a new session (`setsid`) are outside that group, as with native bash.

The job registry lives at `~/.pi-workbench/background-bash/jobs/<id>/` (directories `0700`, files `0600`):

- `job.json`: ID, command, description, working directory, shell, owner Pi session ID and session file, runner PID and process group, start and expiry times;
- `output.log`: combined stdout and stderr;
- `exit`: exit code, error (timeout, maximum lifetime, vanished runner), or cancellation, written once;
- `delivered`: created once when Pi starts the completion message in the Chat. Sending only queues it, so the marker waits for that acknowledgement.

When a session starts or reloads, the extension reattaches that session's jobs by Pi session ID: running jobs return to Activity and `bash_status`/`bash_cancel`, and jobs that finished meanwhile deliver their normal completion message. A completion without `delivered` is resent on the next attach or when the agent settles, so a cleared queue or a daemon exit cannot lose it; once acknowledged it is never resent. A turn-triggering completion that arrives while a context checkpoint is pending or compacting waits for the session's checkpoint barrier and is sent after the checkpoint is delivered. Completions are delivered only while the owning session is open. Cancellation kills the job's process group after checking that the recorded process is still this job's runner. Records are pruned a week after the job finished.

Subagents and Workers retain native foreground bash so they cannot exit before a command finishes; one-shot print/JSON Pi also runs foreground. The `!` user-shell shortcut is unchanged. This extension cannot detach a bash call that was already running before it loaded. A new Pi session or extension reload is needed to activate changes; no PI WEB daemon restart is required.
