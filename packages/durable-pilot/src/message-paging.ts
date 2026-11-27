export interface MessagePageRequest {
  before?: number;
  limit?: number;
}

export interface MessagePageResult<T> {
  messages: T[];
  start: number;
  total: number;
}

export function pageMessagesAtSafeBoundary<T>(messages: T[], page?: MessagePageRequest): MessagePageResult<T> {
  const total = messages.length;
  if (page === undefined) return { messages, start: 0, total };
  const before = clampInteger(page.before ?? total, 0, total);
  const requested = Math.max(0, before - clampInteger(page.limit ?? 20, 1, page.before === undefined ? total : 500));
  // A cut is safe only while no earlier call still needs a result. Prefer a shorter page; grow it only if no cut fits.
  const pending = new Map<string | undefined, number>();
  let start = 0;
  let nextNonNotice = 0;
  for (let i = 0; i < before; i++) {
    const message = messages[i];
    const role = getString(message, "role");
    // A call is pending only until a later prompt or finished reply: past that its result can never arrive.
    if (role === "user" || (role === "assistant" && isFinishedReply(message))) pending.clear();
    // Old transcripts can omit tool IDs. Keep their leading results (including intervening notices) with the call.
    nextNonNotice = Math.max(i, nextNonNotice);
    while (nextNonNotice < before && getString(messages[nextNonNotice], "role") === "custom") nextNonNotice++;
    if (pending.size === 0 && (nextNonNotice === before || getString(messages[nextNonNotice], "role") !== "toolResult")) {
      start = i;
      if (i >= requested) break;
    }
    if (role === "toolResult") {
      const id = getString(message, "toolCallId");
      const count = pending.get(id);
      if (count !== undefined) {
        if (count === 1) pending.delete(id);
        else pending.set(id, count - 1);
      }
    } else if (role === "assistant") {
      const reason = getString(message, "stopReason");
      if (reason === "aborted" || reason === "error") continue;
      const content = getProperty(message, "content");
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (getString(part, "type") !== "toolCall") continue;
        const id = getString(part, "id");
        pending.set(id, (pending.get(id) ?? 0) + 1);
      }
    }
  }
  return { messages: messages.slice(start, before), start, total };
}

function isFinishedReply(message: unknown): boolean {
  const reason = getString(message, "stopReason");
  if (reason === "aborted" || reason === "error") return false;
  const content = getProperty(message, "content");
  return !Array.isArray(content) || !content.some((part) => getString(part, "type") === "toolCall");
}

function getProperty(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
