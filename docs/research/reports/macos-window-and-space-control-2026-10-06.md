# Agent control of macOS windows and Spaces (2026-10-06)

Reviewed on 2026-10-06. Research only; nothing here is installed or configured.
Context observed on Thomas's Mac at review time: macOS 26.5.2, SIP enabled (`csrutil status`),
Raycast installed, no yabai/AeroSpace/Hammerspoon/skhd. PI WEB's launchd agents run
`/usr/bin/env /bin/zsh -lc "exec node …"` (`~/Library/LaunchAgents/com.pi-web.*.plist`).
Claims carry a primary-source link. **Unconfirmed** marks anything I could not verify at the owning
source.

## Recommendation

1. **Never give Accessibility to Terminal, `node`, or `zsh`.** Accessibility lets an app "run
   scripts and system commands to control your Mac"
   ([Apple, Privacy & Security](https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac)).
   Granted to Terminal, every agent shell command gets it. Grant it to **one dedicated window-manager
   app** and let the agent drive that app through its CLI. The CLI talks to the running app over a
   socket, so the calling process (Terminal or the launchd Node service) needs no permission.
2. **Smallest setup that covers the whole wish list: AeroSpace.** It needs no SIP change, uses public
   Accessibility APIs plus one private call, and offers a CLI with JSON output to list, switch, and
   move windows across workspaces and monitors. Config rules restore a fixed layout. The cost: it
   replaces native Spaces with its own emulated workspaces. You keep one macOS Space per display.
   It also tiles by default, which a config rule can turn off.
3. **If native Spaces must stay: yabai with SIP left on (v7.1.25 or later).** It can query Spaces,
   windows, and displays; focus a Space; move a window to a Space or display; and set frames. It
   **cannot** create, destroy, or reorder Spaces without partially disabling SIP. Do not disable SIP.
   It relies on private SkyLight calls that macOS updates have broken repeatedly.
4. **Raycast alone is not enough for an agent.** It acts on the focused window only, and deeplinks
   ask for confirmation. Its window commands cannot target a Space by number on macOS. The
   extension API can, but that path requires Raycast Pro.
5. **The Pi Workbench app can place only its own windows,** using public AppKit: frame and display,
   all-Spaces or follow-active-Space behaviour, and Space-change notifications. No public API puts a
   window on a *specific* Space. Making the app a general window controller would need Accessibility
   and a stable signing identity; today's ad-hoc signature would lose the grant on every rebuild.

## 1. Native Apple options

### Window frames: Accessibility (AXUIElement) and AppleScript/System Events

- Assistive apps use `AXUIElement` functions to "communicate with and control accessible
  applications" ([AXUIElement.h](https://developer.apple.com/documentation/applicationservices/axuielement_h)).
  A process checks its own trust with `AXIsProcessTrustedWithOptions`. That function "Returns whether
  the current process is a trusted accessibility client", and `kAXTrustedCheckOptionPrompt` makes it
  prompt ([Apple](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)).
- AppleScript UI scripting goes through System Events' Processes Suite and "relies upon the …
  accessibility frameworks". The user must enable it "on an app-by-app (including script apps)
  basis" ([Mac Automation Scripting Guide](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html)).
  Telling System Events to act also needs the **Automation** permission: "Allow apps to access and
  control other apps" ([Apple](https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac)).
- AX can move and resize windows on the current Space and across displays. It has no concept of
  Spaces. Hammerspoon's AX-based window list "can only return windows in the current Mission Control
  Space" ([hs.window.allWindows](https://www.hammerspoon.org/docs/hs.window.html#allWindows)).
- macOS 15 and later include built-in tiling. Window ▸ Move & Resize and Fn‑Control shortcuts
  (Fill, Center, halves) act on the **active window**
  ([Apple](https://support.apple.com/guide/mac-help/mac-window-tiling-icons-keyboard-shortcuts-mchl9674d0b0/mac)).
  An agent could trigger them with synthetic keys, which again needs Accessibility.

### Which process needs the permission (Terminal vs launchd)

- TCC checks the **responsible process**. Apple's Endpoint Security talk says `eslogger` "requires
  the user to have authorized the responsible process for Full Disk Access, such as Terminal.app or
  SSH" ([WWDC22 110345](https://developer.apple.com/videos/play/wwdc2022/110345/)). Apple defines
  the responsible process in its launch-constraint docs: "An app that launches a helper process
  directly is both the parent process and the responsible process for the helper"
  ([Apple](https://developer.apple.com/documentation/security/applying-launch-environment-and-library-constraints)).
  So `osascript` or a Swift helper started from Terminal uses **Terminal's** grants.
- From the launchd PI WEB service, no app is responsible. The grant would have to attach to the
  executable itself, here `zsh` and then Homebrew `node`. **Unconfirmed:** I found no Apple page that
  states the launchd-agent case explicitly. Apple's DTS thread
  ["What is a responsible process?"](https://developer.apple.com/forums/thread/731504) was behind a
  bot check.
- TCC remembers code by its designated requirement (DR). For ad-hoc-signed code, the DR "is tied to
  that specific version of the code", so "macOS can't reliably track the identity of the code"
  ([TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)).
  An upgraded `node`, or the ad-hoc-signed Pi Workbench app
  (`apps/pi-web-macos/Scripts/install-app.sh` line 161, `codesign --sign -`), loses its grant
  after each update. yabai warns about the same thing for source builds
  ([README](https://github.com/asmvik/yabai#requirements-and-caveats)).
- **Screen Recording** is not needed to move windows. It is listed as "Screen & System Audio
  Recording" ([Apple](https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac)).
  `CGPreflightScreenCaptureAccess` and `CGRequestScreenCaptureAccess` exist from macOS 10.15 (SDK
  `CGWindow.h`). yabai needs it only for window animations
  ([README](https://github.com/asmvik/yabai#requirements-and-caveats)). **Unconfirmed:** that
  `kCGWindowName` titles are hidden without Screen Recording. This is widely reported, but Apple's
  `CGWindow.h` does not say so.
- Raycast's manual says Accessibility is renamed "Device Control and Data Access" on macOS 27
  ([Raycast](https://manual.raycast.com/window-management)). **Unconfirmed** at Apple.

### CGWindowList

- `CGWindowListCopyWindowInfo` returns window dictionaries with bounds, window ID, and owner. It is
  read-only, and it returns NULL "outside of a GUI security session"
  ([Apple](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:))).
  Hammerspoon notes it works "without Accessibility Permissions"
  ([hs.window.list](https://www.hammerspoon.org/docs/hs.window.html#list)).
- Its only Space link, `kCGWindowWorkspace`, is `API_DEPRECATED("No longer supported",
  macos(10.5,10.8))` in the macOS SDK's `CoreGraphics/CGWindow.h`.

### Spaces: no public API

- Public AppKit can only:
  - observe Space changes through `NSWorkspace.activeSpaceDidChangeNotification`, which carries no
    `userInfo` ([Apple](https://developer.apple.com/documentation/appkit/nsworkspace/activespacedidchangenotification));
  - check whether one of the app's own windows is on the active Space with `NSWindow.isOnActiveSpace`
    ([Apple](https://developer.apple.com/documentation/appkit/nswindow/isonactivespace));
  - set `NSWindow.CollectionBehavior` on the app's own windows, for example `canJoinAllSpaces` or
    `moveToActiveSpace` ([Apple](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct)).
- AeroSpace's guide states it directly: "Apple doesn't provide public API to communicate with Spaces
  (create/delete/reorder/switch Space and move windows between Spaces)"
  ([AeroSpace guide](https://nikitabobko.github.io/AeroSpace/guide#emulation-of-virtual-workspaces)).
  Rectangle says the same ([README](https://github.com/rxhanson/Rectangle#rectangle-doesnt-have-the-ability-to-move-to-other-desktopsspaces)).
- **Private CGS/SkyLight APIs.** The SDK's `CoreGraphics.tbd` exports symbols such as
  `CGSCopyManagedDisplaySpaces`, `CGSGetActiveSpace`, `CGSManagedDisplaySetCurrentSpace`,
  `CGSMoveWindowsToManagedSpace`, and `CGSAddWindowsToSpaces`, but no public header declares them.
  They are private and may change at any update. In third-party code, Hammerspoon uses `SLS*` calls
  to list Spaces, read the active Space, and list a Space's windows
  ([libspaces.m](https://github.com/Hammerspoon/hammerspoon/blob/master/extensions/spaces/libspaces.m)).
  Apple has repeatedly closed the write paths:
  - Moving windows broke in 14.5, then in 15. Hammerspoon issue
    [#3698](https://github.com/Hammerspoon/hammerspoon/issues/3698) is still open, with a 26.1
    report.
  - yabai needed SIP partially off to move windows on Sequoia until it found
    `SLSBridgedMoveWindowsToManagedSpaceOperation` in v7.1.25 (2026‑05‑08)
    ([CHANGELOG](https://github.com/asmvik/yabai/blob/master/CHANGELOG.md),
    [#2788](https://github.com/asmvik/yabai/issues/2788)).
  - Creating, destroying, and moving Spaces still requires code running inside Dock.app (see yabai
    below).
- Users can already do these things by hand: create up to 16 Spaces in Mission Control; switch with
  Control‑Left/Right; move a window by dragging it to the screen edge or to a Space in Mission
  Control; and pin an app to a Space through Dock ▸ Options ▸ Assign To
  ([Apple](https://support.apple.com/en-gb/guide/mac-help/mh14112/mac)). Control‑Up opens Mission
  Control ([Apple](https://support.apple.com/en-us/102650)).

### Mission Control shortcuts as a switching workaround

- Shortcuts are configured in System Settings ▸ Keyboard ▸ Keyboard Shortcuts ▸ Mission Control
  ([Apple](https://support.apple.com/guide/mac-help/keyboard-shortcuts-mchlp2262/mac)). Control‑N
  "Switch to Desktop N" entries exist there, off by default. **Unconfirmed** at an Apple page; this
  comes from the System Settings UI and community docs.
- An agent can post Control‑Left/Right or Control‑N as synthetic keys, which needs Accessibility for
  the posting process. Animation runs, and you get no confirmation or Space ID.
- A community workaround moves a window to another Space by holding the mouse down on its title bar
  and pressing Control‑N. It is posted in Hammerspoon
  [#3698](https://github.com/Hammerspoon/hammerspoon/issues/3698). It is a fragile hack and works on
  the same display only.

## 2. Tools

### AeroSpace

- "Doesn't require disabling SIP". It uses public AX plus one private call, `_AXUIElementGetWindow`.
  It runs on macOS 13+. It is not notarized; the Homebrew cask strips quarantine
  ([README](https://github.com/nikitabobko/AeroSpace)).
- **Emulated workspaces.** Windows of inactive workspaces are moved off-screen to a bottom corner.
  The intended setup is one macOS Space per monitor. Every monitor needs free space in a bottom
  corner. On quit, or when a crash is imminent, windows are restored to view
  ([guide](https://nikitabobko.github.io/AeroSpace/guide#emulation-of-virtual-workspaces)).
- **CLI** ([commands](https://nikitabobko.github.io/AeroSpace/commands)):
  - list: `list-windows`, `list-workspaces`, `list-monitors`, all with `--json`;
  - switch: `workspace <name>`;
  - move a window: `move-node-to-workspace` and `move-node-to-monitor`, both take `--window-id`;
  - move a workspace: `move-workspace-to-monitor`;
  - resize: `resize`.
  The CLI talks to the app over a documented socket protocol
  ([guide](https://nikitabobko.github.io/AeroSpace/guide#socket-protocol)).
- **Config** is plain TOML ([guide](https://nikitabobko.github.io/AeroSpace/guide)):
  - `persistent-workspaces` keeps named workspaces;
  - `workspace-to-monitor-force-assignment` pins workspaces to monitors;
  - `on-window-detected` callbacks run `move-node-to-workspace` or `layout floating` per app bundle
    ID. These restore a fixed layout.
- Workspaces are name-addressable and "can not be 'closed'"
  ([commands](https://nikitabobko.github.io/AeroSpace/commands#workspace-back-and-forth)). Creating
  a workspace means naming it; there is no reordering.
- Permission: Accessibility for AeroSpace.app (it uses the AX API per the README). **Unconfirmed:**
  an explicit permission page in the guide.

### yabai

- yabai controls "windows, spaces and displays" through a CLI. It requires Accessibility, plus Screen
  Recording only for animations. It supports macOS 11–26
  ([README](https://github.com/asmvik/yabai)). The repository now lives at `asmvik/yabai`;
  AeroSpace still links `koekeishiya/yabai`.
- **Works with SIP on** ([man page](https://github.com/asmvik/yabai/blob/master/doc/yabai.asciidoc)):
  - `query --spaces/--windows/--displays` (JSON);
  - `window --move/--resize/--grid/--display/--space`;
  - `display --focus`;
  - `space --focus`, which works with SIP on since v7.1.19 (2026‑04‑18);
  - moving windows between Spaces works with SIP on again since v7.1.25 (2026‑05‑08)
    ([CHANGELOG](https://github.com/asmvik/yabai/blob/master/CHANGELOG.md)).
- **Requires SIP partially disabled** (a scripting addition injected into Dock.app):
  - Space create, destroy, move, swap, and send-to-display;
  - `display --space`;
  - sticky, opacity, shadow, layers, and scratchpad
  ([wiki](https://github.com/asmvik/yabai/wiki/Disabling-System-Integrity-Protection),
  [man page](https://github.com/asmvik/yabai/blob/master/doc/yabai.asciidoc)).
  On Apple Silicon with macOS 13+, this means `csrutil enable --without fs --without debug --without
  nvram` plus the `-arm64e_preview_abi` boot-arg (wiki).
- Caveats: "Displays have separate Spaces" must be on. Disable "Automatically rearrange Spaces"
  ([README](https://github.com/asmvik/yabai)). Each macOS point release has needed scripting-addition
  updates (CHANGELOG entries for 26.2, 26.3, 26.4, and 26.6).

### Hammerspoon

- `hs.window` reads and sets frames (`setFrame`, `moveToScreen`) through AX, on the current Space
  ([docs](https://www.hammerspoon.org/docs/hs.window.html)).
- `hs.spaces` mixes private APIs with "Accessibility hacks". Create, remove, and go-to are done by
  driving Mission Control through the Dock with visible animation
  ([docs](https://www.hammerspoon.org/docs/hs.spaces.html)). It needs no SIP change.
- `moveWindowToSpace` returns `true` but does nothing on macOS 15+, and is reported on 26.1
  ([#3698](https://github.com/Hammerspoon/hammerspoon/issues/3698), open).
- Agent access: the `hs` CLI through `hs.ipc`, which must be loaded in `init.lua`
  ([docs](https://www.hammerspoon.org/docs/hs.ipc.html)). This means arbitrary Lua runs with
  Hammerspoon's Accessibility grant, a broad surface.

### Raycast (installed)

- Built-in Window Management acts on "the focused window":
  - halves, thirds, and similar layouts; Move Window to x,y; Resize Window to W×H;
  - previous/next display; previous/next Space ("Only on Mac");
  - Create Layout for up to eight windows per display, and Save Current Layout.
  "Open/Close/Move to Desktop 1…9" are Windows-only
  ([manual .md](https://manual.raycast.com/window-management.md)). Needs Accessibility.
- Deeplinks:
  - `raycast://customWindowManagementCommand?...` takes absolute or relative size and offset.
  - Layout deeplinks take only an existing `name`
    ([manual](https://manual.raycast.com/window-management)).
  - Command deeplinks `raycast://extensions/<owner>/<ext>/<cmd>` accept `launchType=background`.
    Raycast "will ask you to confirm" each deeplink launch
    ([developers](https://developers.raycast.com/information/lifecycle/deeplinks)).
- Extension API `WindowManagement` ([developers](https://developers.raycast.com/api-reference/window-management)):
  - `getDesktops()` lists Spaces;
  - `getWindowsOnActiveDesktop()` lists windows on the current Space;
  - `setWindowBounds({id, bounds, desktopId})` moves a window by ID, including to another desktop.
  It needs Raycast Pro. **Unconfirmed:** whether `desktopId` moves still work on macOS 26.

### Rectangle

- `open -g "rectangle://execute-action?name=left-half"` and similar named actions act on the
  frontmost window. There is no Space support: "Apple never released a public API". Rectangle Pro
  has next/prev Space actions ([README](https://github.com/rxhanson/Rectangle)).

### Amethyst

- A tiling manager. It needs Accessibility and recommends turning off auto-rearranged Spaces
  ([README](https://github.com/ianyh/Amethyst)).
- Its hotkey commands include `throw-space-n`, `throw-screen-n`, and `focus-screen-n`
  ([config docs](https://github.com/ianyh/Amethyst/blob/development/docs/configuration-files.md)).
- **Unconfirmed:** any documented CLI or URL scheme, and whether `throw-space` works on macOS 15+.

### Other options seen (not evaluated)

[rift](https://github.com/acsandmann/rift) (virtual workspaces + private APIs) and
[InstantSpaceSwitcher](https://github.com/jurplel/InstantSpaceSwitcher) (synthetic trackpad gesture),
both listed in AeroSpace's README; [Drag.spoon](https://github.com/mogenson/Drag.spoon)
(Mission Control drag workaround).

## 3. Comparison

Legend: ✅ yes · ⚠️ partial or fragile · ❌ no · ? unconfirmed. "Focused" = front window only.

| Option | Move/resize window | List Spaces | Switch Space | Window → Space | Create/remove/reorder Space | Multi-display | SIP off? | Agent-scriptable CLI | Permissions (holder) |
|---|---|---|---|---|---|---|---|---|---|
| AppleScript / System Events | ✅ current Space | ❌ | ⚠️ synthetic keys | ❌ | ❌ | ✅ by coordinates | No | `osascript` | Accessibility + Automation (Terminal or the caller) |
| Own AX code (Swift helper) | ✅ current Space | ❌ | ⚠️ synthetic keys | ❌ | ❌ | ✅ | No | own binary | Accessibility (the helper's responsible process) |
| CGWindowList | read only | ❌ | ❌ | ❌ | ❌ | ✅ read | No | own binary | None for bounds; titles ? |
| Private CGS/SkyLight (own code) | — | ✅ | ⚠️ | ⚠️ breaks often | ❌ without Dock injection | ✅ | create/destroy need injection | own binary | Accessibility |
| Mission Control shortcuts | — | ❌ | ✅ Ctrl‑←/→/N | ⚠️ drag hack | ❌ | per display | No | key events | Accessibility (event poster) |
| **AeroSpace** | ✅ any window ID | ✅ workspaces | ✅ | ✅ | ✅ by name / ❌ reorder (emulated) | ✅ | **No** | ✅ `aerospace … --json` | Accessibility (AeroSpace.app only) |
| yabai, SIP on (≥7.1.25) | ✅ | ✅ JSON | ✅ | ✅ | ❌ | ✅ | No | ✅ `yabai -m` | Accessibility (yabai) |
| yabai, SIP partly off | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **Yes** | ✅ | Accessibility + Dock injection |
| Hammerspoon | ✅ | ✅ | ⚠️ via Mission Control UI | ❌ on macOS 15+ | ⚠️ via Mission Control UI | ✅ | No | ✅ `hs` (arbitrary Lua) | Accessibility (Hammerspoon) |
| Raycast built-in | ✅ focused | ❌ | ⚠️ prev/next | ⚠️ focused, prev/next | ❌ | ✅ prev/next | No | ⚠️ deeplinks with confirmation | Accessibility (Raycast) |
| Raycast extension API (Pro) | ✅ by ID | ✅ `getDesktops` | ? | ✅ `desktopId` ? | ❌ | ✅ | No | ⚠️ via deeplink | Accessibility (Raycast) |
| Rectangle | ✅ focused, presets | ❌ | ❌ | ❌ | ❌ | ✅ | No | ⚠️ `rectangle://` URL | Accessibility (Rectangle) |
| Amethyst | ✅ tiling | ❌ | ? | ⚠️ `throw-space-n` hotkey ? | ❌ | ✅ | ? | ❌ none documented | Accessibility (Amethyst) |
| Pi Workbench app (public AppKit) | ✅ own windows only | ❌ | ❌ | ⚠️ all Spaces or active Space only | ❌ | ✅ own windows | No | would need new endpoint | None for own windows |

## 4. Recommended setup and Pi Workbench options

**Agent control (proposed):**

1. Install AeroSpace through its Homebrew cask, then grant Accessibility to **AeroSpace.app only**.
2. Turn off tiling with an `on-window-detected` → `layout floating` rule if Thomas wants classic
   floating windows.
3. Declare `persistent-workspaces` and monitor assignments, and add per-app `on-window-detected`
   rules. Together these are the "fixed layout".
4. The agent calls `aerospace list-windows --all --json`, `aerospace workspace X`, and
   `aerospace move-node-to-workspace --window-id N X` from Terminal or the launchd service. Neither
   needs any TCC grant.
5. Keep SIP on. If native Spaces must remain, swap AeroSpace for yabai ≥7.1.25, which gives the same
   shape minus Space create/destroy/reorder.

**What the Pi Workbench app can do natively (public API):**

- Put each of its own windows on a chosen display and frame. It already restores frames from
  `NSScreen.visibleFrame` (`apps/pi-web-macos/Sources/PIWebMac/main.swift` ~L351–378).
- Choose Space behaviour per window. Today it uses `[.moveToActiveSpace, .fullScreenPrimary]`
  (`main.swift` L617). `canJoinAllSpaces` would show a window on every Space.
- React to Space switches via `activeSpaceDidChangeNotification` and `isOnActiveSpace`, for example
  to show a Workstream's window only when it is on screen.
- **Limits:**
  - It cannot pin a window to "Desktop 3", list Spaces, or switch Spaces without private APIs.
  - Controlling *other* apps' windows would need Accessibility for the app plus a stable
    (non-ad-hoc) signing identity per TN3127, and would make the app a high-privilege controller.
    Prefer delegating to AeroSpace or yabai.
