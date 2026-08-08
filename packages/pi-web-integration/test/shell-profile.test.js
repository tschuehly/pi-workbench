import test from "node:test";
import assert from "node:assert/strict";
import workbenchPlugin, { WORKBENCH_SHELL_PROFILE } from "../pi-web-plugin.js";

test("Workbench recommends a selectable shell profile over its existing primary view", () => {
  assert.deepEqual(WORKBENCH_SHELL_PROFILE, {
    id: "shell.workbench",
    title: "Pi Workbench",
    description: "Use the existing Workbench primary view as the starting composition while PI WEB keeps protected recovery available.",
    recommended: true,
    defaultPrimaryView: "workstreams.view",
    navigationEntries: ["workstreams.navigation"],
    surfaceContributions: ["core:workspace.files", "core:workspace.git", "core:workspace.terminal", "run.panel"],
    regions: {
      "context-bar": [],
      status: [],
      "surface-strip": [],
      "contextual-actions": [],
    },
    initialPanels: {
      navigation: { visible: false, size: 320 },
      workspace: { visible: false, size: 480 },
    },
    presentationProfile: "compact",
  });

  const previousHTMLElement = globalThis.HTMLElement;
  const previousCustomElements = globalThis.customElements;
  globalThis.HTMLElement = class {};
  globalThis.customElements = { get: () => undefined, define: () => undefined };
  const activated = workbenchPlugin.activate({
    apiVersion: 1,
    pluginId: "pi-workbench",
    html: () => undefined,
    svg: () => undefined,
  }).contributions;
  if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
  else globalThis.HTMLElement = previousHTMLElement;
  if (previousCustomElements === undefined) delete globalThis.customElements;
  else globalThis.customElements = previousCustomElements;
  const viewIds = new Set((activated.primaryViews ?? []).map((view) => view.id));
  const navigationIds = new Set((activated.navigationEntries ?? []).map((entry) => entry.id));
  const panelIds = new Set((activated.workspacePanels ?? []).map((panel) => panel.id));
  assert.ok(viewIds.has(WORKBENCH_SHELL_PROFILE.defaultPrimaryView));
  assert.ok(WORKBENCH_SHELL_PROFILE.navigationEntries.every((id) => id.includes(":") || navigationIds.has(id)));
  assert.ok(WORKBENCH_SHELL_PROFILE.surfaceContributions.every((id) => id.includes(":") || panelIds.has(id)));
});
