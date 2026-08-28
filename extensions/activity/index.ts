import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ACTIVITY_CHANNEL, createActivitySurface, removeActivity, upsertActivity } from "./activity.mjs";

export default function activityExtension(pi: ExtensionAPI) {
  const surface = createActivitySurface();
  pi.events.on(ACTIVITY_CHANNEL, (event) => surface.update(event));

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") surface.attach(ctx.ui);
  });

  pi.on("input", (event) => {
    if (event.source === "interactive") surface.clearCompleted();
  });

  pi.on("tool_execution_start", (event) => {
    if (event.toolName !== "bash" && event.toolName !== "powershell") return;
    const command = typeof event.args?.command === "string" ? event.args.command : event.toolName;
    upsertActivity(pi, { id: `shell:${event.toolCallId}`, kind: "shell", objective: command, activity: "running" });
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName === "bash" || event.toolName === "powershell") removeActivity(pi, `shell:${event.toolCallId}`);
  });

  pi.on("session_shutdown", () => surface.dispose());
}
