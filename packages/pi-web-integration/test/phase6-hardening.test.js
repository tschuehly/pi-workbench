import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectWorkstreamBrief } from "../workstream-brief-projection.js";
import {
  NARROW_VIEWPORT_MAX_WIDTH,
  NARROW_VIEWPORT_MEDIA_QUERY,
  narrowViewportMatches,
  sessionNavigationCompatibility,
} from "../unified-navigation-view-model.js";

const pluginSource = await readFile(new URL("../pi-web-plugin.js", import.meta.url), "utf8");
const fixture = JSON.parse(await readFile(new URL("../fixtures/unified-navigation.json", import.meta.url), "utf8"));

function matchWidth(width) {
  return (query) => ({
    matches: query === NARROW_VIEWPORT_MEDIA_QUERY && width <= NARROW_VIEWPORT_MAX_WIDTH,
  });
}

test("the single runtime and CSS narrow transition includes 760, 390, and 320 pixels", () => {
  assert.equal(NARROW_VIEWPORT_MAX_WIDTH, 760);
  assert.equal(NARROW_VIEWPORT_MEDIA_QUERY, "(max-width: 760px)");
  for (const width of [760, 390, 320]) assert.equal(narrowViewportMatches(matchWidth(width)), true);
  assert.equal(narrowViewportMatches(matchWidth(761)), false);
  assert.equal(narrowViewportMatches(undefined), false);
  assert.doesNotMatch(pluginSource, /720px/);
  assert.equal(pluginSource.match(/@media \(max-width: 760px\)/g)?.length, 1);
  assert.match(pluginSource, /syncUnifiedChatOverlay\(view, narrowViewportMatches\(\)\)/);
  assert.match(pluginSource, /setOverlayBackgroundInert\(view\.backgroundElements, open\)/);
  assert.match(pluginSource, /setOverlayBackgroundInert\(view\.backgroundElements, narrowNavigatorOpen\)/);
  assert.match(pluginSource, /view\.scrim\.setAttribute\("aria-hidden", String\(!open\)\)/);
  assert.match(pluginSource, /retainModalFocus\(view\.sessionsPane, view\.sessionsClose, narrowNavigatorOpen\)/);
});

test("narrow and crowded CSS bounds overflow, long titles, many sessions, and motion", () => {
  assert.match(pluginSource, /:host \{[^}]*overflow-x: hidden/);
  assert.match(pluginSource, /\.workstream-identity \.shell-title, \.workstream-identity p \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/);
  assert.match(pluginSource, /\.unified-navigation-row > span:first-child > strong \{[^}]*overflow-wrap: anywhere/);
  assert.match(pluginSource, /\.session-tabs \{[^}]*overflow-x: auto/);
  assert.match(pluginSource, /\.session-tabs button \{[^}]*max-width: 260px;[^}]*text-overflow: ellipsis/);
  assert.match(pluginSource, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none !important;[\s\S]*?transition: none !important;/);
});

test("an absent navigation host has an explicit Workstreams-only update fallback", () => {
  const legacy = sessionNavigationCompatibility(undefined);
  assert.equal(legacy.supported, false);
  assert.match(legacy.message, /^Update PI WEB/);
  assert.match(legacy.message, /Workstreams-only mode/);
  assert.deepEqual(sessionNavigationCompatibility({ snapshot() {} }), { supported: true, message: undefined });
  assert.match(pluginSource, /Chat inventory is temporarily unavailable/);
  assert.doesNotMatch(pluginSource, /context\?\.state|context\.state|privateRoute|privateApi/);
});

test("button navigation uses valid current and expanded semantics without partial tabs", () => {
  assert.doesNotMatch(pluginSource, /setAttribute\("role", "tablist"\)/);
  assert.doesNotMatch(pluginSource, /setAttribute\("role", "tab"\)/);
  assert.doesNotMatch(pluginSource, /setAttribute\("aria-selected"/);
  assert.match(pluginSource, /setAttribute\("aria-current", "page"\)/);
  assert.match(pluginSource, /control\.setAttribute\("aria-controls", "workstream-sessions-pane"\)/);
  assert.match(pluginSource, /document\.createElement\("nav"\)/);
});

test("fixed status and alert regions use explicit severity without nested alerts", () => {
  assert.match(pluginSource, /status\.setAttribute\("role", "status"\)/);
  assert.match(pluginSource, /alert\.setAttribute\("role", "alert"\)/);
  assert.match(pluginSource, /announcement\?\.severity === "alert"/);
  assert.match(pluginSource, /announcement\?\.severity === "status"/);
  assert.doesNotMatch(pluginSource, /className\.includes\("checkpoint-error"\)/);
  assert.doesNotMatch(pluginSource, /title\.includes\("could not"\)/);
  assert.match(pluginSource, /if \(main\.dataset\.renderKey === rootRenderKey\) return/);
});

test("matchMedia changes are bound and released with the element lifecycle", () => {
  assert.match(pluginSource, /matchMedia\?\.\(NARROW_VIEWPORT_MEDIA_QUERY\)/);
  assert.match(pluginSource, /addEventListener\?\.\("change", this\.#narrowViewportChange\)/);
  assert.match(pluginSource, /removeEventListener\?\.\("change", this\.#narrowViewportChange\)/);
  assert.match(pluginSource, /if \(event\.matches !== true\) this\.#mobilePane = "workspace"/);
});

test("all coarse-pointer controls honor the token and separators reserve hit columns", () => {
  assert.match(pluginSource, /:host button, \.dedicated-session, \.attention-navigation-action, \.context-actions button, \.task-answer-actions button, \.terminal-drawer > button \{ min-height: max\(44px, var\(--pi-control-min-size, 44px\)\)/);
  assert.match(pluginSource, /grid-template-columns:[^;]*max\(44px, var\(--pi-control-min-size, 44px\)\)[^;]*;/);
  assert.doesNotMatch(pluginSource, /\.unified-navigation-separator::before, \.pane-edge::before/);
});

test("desktop Chat and Workstream layouts clamp navigation through 980 pixels", () => {
  assert.match(pluginSource, /@media \(max-width: 980px\) \{\s*\.unified-destination-body:not\(\.collapsed\) \{ grid-template-columns: min\(var\(--navigator-width, 320px\), 42vw\)/);
  assert.match(pluginSource, /\.workstream-body \{ grid-template-columns: min\(var\(--navigator-width, 320px\), 42vw\)/);
});

test("the existing fixture keeps current, stale, failed, missing, reconnect, and closed truth", () => {
  const workstream = fixture.workstreams.snapshots.find((candidate) => candidate.id === "ws-unified");
  const brief = projectWorkstreamBrief(workstream);
  assert.deepEqual(brief.sessions.map((session) => [session.id, session.checkpointStatus]), [
    ["session-a", "current"],
    ["session-b", "stale"],
    ["session-c", "failed"],
    ["pending:launch", "missing"],
    ["pending:failed", "missing"],
  ]);
  assert.equal(fixture.workstreams.snapshots.find((candidate) => candidate.id === "ws-closed").closed, true);
  assert.equal(fixture.states.nativeReconnect.reconnecting, true);
  assert.equal(fixture.states.hostUnavailable.available, false);
});
