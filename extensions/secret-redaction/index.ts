import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { redact, redactDeep } from "./redact.mjs";

export default function secretRedactionExtension(pi: ExtensionAPI) {
  // Before the tool result is persisted or sent to the model.
  pi.on("tool_result", (event) => {
    const content = redactDeep(event.content);
    const details = redactDeep(event.details);
    const structuredContent = redactDeep(event.structuredContent);
    if (content === event.content && details === event.details && structuredContent === event.structuredContent) return;
    return { content, details, structuredContent };
  });

  // Assistant text only: tool-call arguments are the command that runs, and thinking blocks are provider-signed.
  pi.on("message_end", (event) => {
    const message = event.message as { role?: string; content?: unknown };
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    let changed = false;
    const content = message.content.map((block: { type?: string; text?: string }) => {
      if (block.type !== "text") return block;
      const text = redact(block.text);
      if (text === block.text) return block;
      changed = true;
      return { ...block, text };
    });
    if (changed) return { message: { ...event.message, content } as typeof event.message };
  });

  // Backstop for the model-bound copy, including `!` bashExecution and custom messages. Does not change the log.
  pi.on("context", (event) => {
    const messages = redactDeep(event.messages);
    if (messages !== event.messages) return { messages };
  });
}
