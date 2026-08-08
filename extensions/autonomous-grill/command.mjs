import { readFile } from "node:fs/promises";
import { buildAutonomousGrillPrompt } from "./prompt.mjs";

export function registerAutonomousGrillCommand(pi, skillPath) {
  pi.registerCommand("autonomous-grill", {
    description: "Cross-model grill a plan or decision, then return proposals for human judgment",
    handler: async (args, ctx) => {
      let target = args.trim();

      if (target.length === 0 && ctx.hasUI) {
        target = (await ctx.ui.editor("What should the models grill?", ""))?.trim() ?? "";
      }
      if (target.length === 0) {
        ctx.ui.notify("Usage: /autonomous-grill <plan, decision, or idea>", "warning");
        return;
      }

      try {
        const skill = await readFile(skillPath, "utf8");
        const prompt = buildAutonomousGrillPrompt(skill, target);
        await ctx.waitForIdle();
        pi.sendMessage({
          customType: "autonomous-grill-request",
          content: prompt,
          display: false,
          details: { target },
        }, { triggerTurn: true });
        ctx.ui.notify("Autonomous grill started", "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to start autonomous grill: ${message}`, "error");
      }
    },
  });
}
