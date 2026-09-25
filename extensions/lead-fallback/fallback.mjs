export const FALLBACK = { provider: "openai-codex", id: "gpt-6-sol", thinking: "high" };

const LIMIT_ERROR = /rate.?limit|usage.?limit|quota|429/i;

// True when a lead's final (post-retry) Claude turn failed on an account limit.
export function shouldFallBack({ env, model, message }) {
  if (env.PI_TELEMETRY_PARENT_SESSION_ID) return false; // child Pi: routing owns its fallback
  if (model?.provider !== "anthropic") return false;
  return message?.role === "assistant" && message.stopReason === "error" && LIMIT_ERROR.test(message.errorMessage ?? "");
}
