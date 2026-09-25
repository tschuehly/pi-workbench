# Background bash

In an attended lead Pi session, this package overrides the model-callable `bash` tool. Commands run in the background by default, return a job ID immediately, show elapsed time and output bytes in Activity, and send the exit status plus recent output to the Chat when they finish. The full output is saved in a private temporary log until the Pi session ends.

Set `foreground: true` when a following action needs the command's exit status or output before proceeding. Use `bash_status` to inspect jobs and `bash_cancel` to stop one. At most eight jobs run concurrently; jobs are cancelled on session shutdown, replacement, or extension reload. Background jobs are attended session work, not durable Run jobs.

Subagents and Workers retain native foreground bash so they cannot exit before a command finishes; one-shot print/JSON Pi also runs foreground. The `!` user-shell shortcut is unchanged. This extension cannot detach a bash call that was already running before it loaded. A new Pi session or extension reload is needed to activate changes; no PI WEB daemon restart is required.
