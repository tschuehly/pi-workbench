import assert from "node:assert/strict";
import test from "node:test";
import { registerAutonomousGrillCommand } from "./command.mjs";

test("registers a picker command that starts the authoritative skill", async () => {
  let command;
  let sent;
  const notifications = [];
  registerAutonomousGrillCommand({
    registerCommand(name, definition) {
      command = { name, definition };
    },
    sendMessage(message, options) {
      sent = { message, options };
    },
  }, new URL("../../skills/autonomous-grill/SKILL.md", import.meta.url));

  assert.equal(command.name, "autonomous-grill");
  assert.match(command.definition.description, /Cross-model grill/);

  await command.definition.handler("choose a cache", {
    hasUI: false,
    waitForIdle: async () => {},
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  });

  assert.equal(sent.options.triggerTurn, true);
  assert.equal(sent.message.display, false);
  assert.equal(sent.message.details.target, "choose a cache");
  assert.match(sent.message.content, /# Autonomous Grill/);
  assert.match(sent.message.content, /choose a cache$/);
  assert.deepEqual(notifications, [{ message: "Autonomous grill started", level: "info" }]);
});
