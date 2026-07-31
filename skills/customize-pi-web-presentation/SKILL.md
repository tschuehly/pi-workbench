---
name: customize-pi-web-presentation
description: Customize PI WEB's spacing and layout through validated presentation profiles. Use when the user asks to change PI WEB density, control or row sizing, panel or message spacing, toolbar gaps, or content width, or to create or repair an agent-authored presentation profile.
---

# Customize PI WEB presentation

Author a declarative global profile and leave preview and activation to the user. Treat the built-in profile as the baseline and override only the semantic tokens needed for the requested effect.

Set `SKILL_DIR` to this skill's directory before using its bundled tool.

## 1. Confirm the target

Identify the PI WEB gateway the user intends to customize, especially when stable and development instances run together. Obtain the absolute global config path from **Settings → Appearance → Presentation profile configuration source** when the UI is available. Otherwise resolve it in this order:

1. the user's explicit path;
2. `$PI_WEB_CONFIG`;
3. `$XDG_CONFIG_HOME/pi-web/config.json`;
4. `~/.config/pi-web/config.json`.

Read the existing file before editing it. A repository's `.pi-web/config.json` and a selected remote machine are different configuration scopes.

**Complete when:** one gateway instance and one absolute global config path are confirmed.

## 2. Map the request to the catalog

Run:

```bash
node "$SKILL_DIR/scripts/profile-tool.mjs" describe
```

Choose `comfortable` when the request favors breathing room and `compact` when it favors information density. Use the smallest override set that expresses the request; inheritance supplies every omitted token. If the requested effect has no catalog token, report that boundary rather than approximating it with unrelated geometry.

**Complete when:** every requested supported effect maps to a catalog token within its reported bounds, and every unsupported effect is identified.

## 3. Author one profile

Edit only the `presentationProfiles` map in the confirmed global config. Preserve all other top-level settings, profile siblings, and unknown configuration owned by newer PI WEB versions.

A profile has exactly this shape:

```json
{
  "version": 1,
  "title": "Review compact",
  "description": "Dense review layout with a bounded reading column.",
  "extends": "compact",
  "tokens": {
    "--pi-panel-padding": "6px",
    "--pi-content-max-width": "1100px"
  }
}
```

Use a lowercase id matching `^[a-z][a-z0-9.-]*$`; `comfortable` and `compact` are reserved. Update a named profile only when the user selected it. Otherwise choose a descriptive unused id. Keep the title non-empty and at most 80 characters, and the description non-empty and at most 240 characters.

Write only catalog tokens and values. The profile definition is the agent-owned proposal; browser-local selection and Apply remain the user's gate.

**Complete when:** the intended named profile is present, unrelated config is unchanged, and browser-local state has not been edited.

## 4. Validate before handoff

Run the validator against the edited file and profile id:

```bash
node "$SKILL_DIR/scripts/profile-tool.mjs" validate /absolute/path/to/config.json profile-id
```

Fix the profile until validation succeeds. When the target UI is available, open **Settings → Appearance**, select **Reload profiles**, and confirm the profile appears without a validation error. Reloading is inspection; leave the previous applied resolution active.

**Complete when:** bundled validation succeeds and, when UI access exists, PI WEB discovers the profile without an error.

## 5. Hand activation to the user

Report:

- gateway and config path;
- profile id and base;
- each overridden token and intended effect;
- any unsupported request;
- validation evidence.

Tell the user to open **Settings → Appearance**, reload profiles, select the profile to preview it, and use **Apply profile** if they accept it. If this edits an active profile, explain that PI WEB retains its last valid applied revision until they preview and apply the revision.

**Complete when:** the user has an exact preview/apply path and no activation action was taken on their behalf.
