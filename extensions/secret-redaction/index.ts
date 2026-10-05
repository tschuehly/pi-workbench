import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { redactDeep } from "./redact.mjs";

export default function secretRedactionExtension(pi: ExtensionAPI) {
  // Before the tool result is persisted or sent to the model. One redactDeep call: one auth/env snapshot.
  pi.on("tool_result", (event) => {
    const fields = [event.content, event.details, event.structuredContent];
    const redacted = redactDeep(fields);
    if (redacted === fields) return;
    const [content, details, structuredContent] = redacted;
    return { content, details, structuredContent };
  });

  // Assistant text only: tool-call arguments are the command that runs, and thinking blocks are provider-signed.
  pi.on("message_end", (event) => {
    const message = event.message as { role?: string; content?: unknown };
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    const blocks = message.content as { type?: string; text?: unknown }[];
    const texts = blocks.map((block) => block.type === "text" && typeof block.text === "string" ? block.text : undefined);
    const redacted = redactDeep(texts) as (string | undefined)[];
    if (redacted === texts) return;
    const content = blocks.map((block, i) => redacted[i] === texts[i] ? block : { ...block, text: redacted[i] });
    return { message: { ...event.message, content } as typeof event.message };
  });

  // Backstop for the model-bound copy, including `!` bashExecution and custom messages. Does not change the log.
  pi.on("context", (event) => {
    const messages = redactDeep(event.messages);
    if (messages !== event.messages) return { messages };
  });
}
