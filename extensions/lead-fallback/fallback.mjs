export const FALLBACK = { provider: "openai-codex", id: "gpt-6.1-sol", thinking: "high" };

const RECOVERABLE_ERROR = /rate.?limit|usage.?limit|quota|^(?:HTTP )?(?:429|5\d{2})\b|overload|currently experiencing high demand|service.?unavailable|server.?error|internal.?error|timed? out|timeout|ETIMEDOUT/i;
// Status numbers count only as the SDK's leading status; other 4xx responses are never transient.
const EXCLUDED_ERROR = /^(?:HTTP )?4(?!29)\d{2}\b|\b(?:abort(?:ed)?|cancel(?:l?ed)?)\b|refusal|refused|content.?filter|content.?policy|safety|policy.?violation/i;

// Called only at final settlement, after Pi's configured native retry policy.
export function shouldFallBack({ env, model, message }) {
  if (env.PI_TELEMETRY_PARENT_SESSION_ID || env.PI_TELEMETRY_EXECUTION_ID || env.PI_WORKBENCH_EXECUTION_KIND) return false; // child Pi: routing owns its fallback
  if (model?.provider !== "anthropic") return false;
  const error = message?.errorMessage ?? "";
  return message?.role === "assistant" && message.stopReason === "error" && !EXCLUDED_ERROR.test(error) && RECOVERABLE_ERROR.test(error);
}
