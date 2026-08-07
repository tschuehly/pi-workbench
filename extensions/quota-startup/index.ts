import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkClaudeQuota, isRepairableQuotaStatus, noticeForQuotaCheck, repairClaudeQuota } from "./check.mjs";

type QuotaStatus = "fresh" | "keychain-required" | "sign-in-required" | "rate-limited" | "unavailable";
type QuotaCheck = { status: QuotaStatus; diagnostic?: string };

export default function quotaStartupExtension(pi: ExtensionAPI) {
  const run = (command: string, args: string[]) => pi.exec(command, args, {
    timeout: command === "claude" ? 180_000 : 30_000,
  });

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup" || !ctx.hasUI) return;
    await inspectAndOfferRepair(ctx, run);
  });

  pi.registerCommand("quota-check", {
    description: "Check Claude quota telemetry and offer authentication repair",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      await inspectAndOfferRepair(ctx, run, true);
    },
  });
}

async function inspectAndOfferRepair(
  ctx: ExtensionContext,
  run: (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  reportHealthy = false,
) {
  const check = await checkClaudeQuota(run) as QuotaCheck;
  const notice = noticeForQuotaCheck(check, reportHealthy) as { level: "info" | "warning"; message: string } | undefined;
  if (notice !== undefined) {
    ctx.ui.notify(notice.message, notice.level);
    return;
  }
  if (!isRepairableQuotaStatus(check.status)) return;

  const signIn = check.status === "sign-in-required";
  const confirmed = await ctx.ui.confirm(
    signIn ? "Claude quota sign-in required" : "Claude quota needs Keychain access",
    signIn
      ? "Open Claude sign-in now, then request persistent macOS Keychain access?"
      : "Request persistent macOS Keychain access now? Choose “Always Allow” in the system prompt.",
  );
  if (!confirmed) {
    ctx.ui.notify("Claude quota repair skipped. Independent child launches can still proceed with degraded telemetry.", "warning");
    return;
  }

  ctx.ui.setStatus("quota-startup", ctx.ui.theme.fg("muted", "Repairing Claude quota access…"));
  const repaired = await repairClaudeQuota(run, check.status) as QuotaCheck;
  ctx.ui.setStatus("quota-startup", undefined);
  if (repaired.status === "fresh") {
    ctx.ui.notify("Claude quota telemetry is fresh and future startup checks will be non-interactive.", "info");
  } else {
    ctx.ui.notify(`Claude quota repair did not complete: ${repaired.diagnostic ?? "unknown error"}\nRun claude auth login, then /quota-check.`, "error");
  }
}
