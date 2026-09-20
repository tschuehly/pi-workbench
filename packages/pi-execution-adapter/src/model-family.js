export const knownModelFamilies = Object.freeze([
  "anthropic",
  "openai",
  "google",
  "xai",
  "moonshot",
  "microsoft",
]);

const directProviders = {
  anthropic: "anthropic",
  openai: "openai",
  "openai-codex": "openai",
  google: "google",
  xai: "xai",
  moonshot: "moonshot",
  microsoft: "microsoft",
};

const copilotPrefixes = {
  "claude-": "anthropic",
  "gpt-": "openai",
  "gemini-": "google",
  "grok-": "xai",
  "kimi-": "moonshot",
  "mai-": "microsoft",
};

export function modelFamily(provider, model) {
  if (provider !== "github-copilot") return Object.hasOwn(directProviders, provider) ? directProviders[provider] : undefined;
  if (typeof model !== "string") return undefined;
  return Object.entries(copilotPrefixes).find(([prefix]) => model.startsWith(prefix))?.[1];
}
