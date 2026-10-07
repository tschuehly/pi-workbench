# review-bridge

**Pick:** marking inside an embedded, controlled dev app is explicitly in scope; otherwise a Page Comment suffices.
**Lesson:** validate `postMessage` origin AND source in both documents; a precise locator is still not proof.
Scaled 1440/1024/390 app widths found real overflow; sizing only the iframe transform clips the Kernel UI
([LAU via WC T2/§3; judgement B2](../../SOURCES.md)). Absorbs viewport-frame.

**Use:** copy [example.html](example.html)'s receiver and [bridge.js](bridge.js) into the dev app; configure exact
parent/target origins. [target.html](target.html) is a synthetic same-origin fixture, not production integration.
The Key wraps the clipped stage so its Comment button/threads sit outside. Width restores from the URL;
locator, captured build, note and picker state restore on `atelier:update`. Sent Requests live only in the Event Log.
The unsent draft lasts this tab only; a changed build disables submitting the stale locator until repicked.
**Boundary:** handshake is idempotent; allowlisted locator fields are serialized as text. Project handlers still
validate the Request and allocate a durable claim Key. No new cross-document Kernel anchor kind is claimed.
**Skip:** uncontrolled third-party apps, screenshot-only review, or unavailable scenarios. Pair with claim-card.
Original reimplementation inspired by [Worlds Console](../../SOURCES.md); private-source licence permission is not assumed.
