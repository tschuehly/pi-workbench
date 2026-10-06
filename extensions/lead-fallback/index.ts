import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FALLBACK, shouldFallBack } from "./fallback.mjs";

// Pi owns bounded retries; this final boundary handles lead-only recovery after them.
export default function leadFallbackExtension(pi: ExtensionAPI) {
  let lastAssistant: any;
  pi.on("message_end", (event) => {
    if ((event.message as any).role === "assistant") lastAssistant = event.message;
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    const message = lastAssistant;
    lastAssistant = undefined;
    if (ctx.signal?.aborted || event.outcome !== "error" || !shouldFallBack({ env: process.env, model: ctx.model, message })) return;
    // Pi omits a failure from context once it schedules a native retry; if it is still omitted at
    // settlement, the user cancelled that retry (Escape / abort_retry), so stay stopped.
    if (!event.context?.contextMessages?.some((m: any) => m.role === "assistant" && m.timestamp === message.timestamp)) return;
    const target = ctx.modelRegistry.find(FALLBACK.provider, FALLBACK.id);
    let switched = false;
    try {
      switched = !!target && await pi.setModel(target);
    } catch {
      // Auth resolution can throw as well as return false; leave the failed run stopped.
    }
    if (ctx.signal?.aborted) return;
    if (switched) pi.setThinkingLevel(FALLBACK.thinking as any);
    const recovery = switched
      ? "Continuing the interrupted work in this session. Before repeating any side-effecting action, check its recorded results and actual outcome; do not repeat completed actions or blindly retry actions with unknown outcomes."
      : "Fallback unavailable; stopped without automatic continuation. Restore fallback access or choose a model before resuming.";
    return {
      continue: switched,
      entries: [{
        type: "custom_message",
        customType: "lead-fallback",
        display: true,
        content: `Claude request failed (${message.errorMessage}). ${switched ? "Switched the lead to" : "Could not switch the lead to"} ${FALLBACK.provider}/${FALLBACK.id} (${FALLBACK.thinking}). ${recovery}`,
      }],
    };
  });
}
