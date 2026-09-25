import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FALLBACK, shouldFallBack } from "./fallback.mjs";

// When the lead's Claude account hits its limit (after Pi's own retries), switch the lead to
// GPT-6 Sol high and continue the same run.
export default function leadFallbackExtension(pi: ExtensionAPI) {
  let lastAssistant: any;
  pi.on("message_end", (event) => {
    if ((event.message as any).role === "assistant") lastAssistant = event.message;
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    const message = lastAssistant;
    lastAssistant = undefined;
    if (event.outcome !== "error" || !shouldFallBack({ env: process.env, model: ctx.model, message })) return;
    const target = ctx.modelRegistry.find(FALLBACK.provider, FALLBACK.id);
    if (!target || !(await pi.setModel(target))) {
      ctx.ui.notify(`Claude limit reached; fallback ${FALLBACK.provider}/${FALLBACK.id} is unavailable.`, "error");
      return;
    }
    pi.setThinkingLevel(FALLBACK.thinking as any);
    return {
      continue: true,
      entries: [{
        type: "custom_message",
        customType: "lead-fallback",
        display: true,
        content: `Claude usage limit reached (${message.errorMessage}). Switched the lead to ${FALLBACK.id} (${FALLBACK.thinking}); continue the interrupted work.`,
      }],
    };
  });
}
