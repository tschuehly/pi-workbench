# Review bridge

Candidate Component · Observed source, new adaptation · WC. Not a Registry admission (107).
Pins and a region picker turn an embedded app location into explicit Page material.

## Choose
- **Use:** a dev-only trial app that the Page may inspect; selector pins, first-visible resolution,
  click-to-select, nearest-scroll focus, picker returning CSS path/text/rect/viewport/route.
- **Skip:** production apps, arbitrary remote sites, or mere screenshots (use frame-strip).

## Copy and connect
Copy `bridge.js` to the app; call `installAtelierReviewBridge` only in its dev build with `dev:true`
and the exact configured Page origin. Activate only with `?review=1`; this is not authentication.
Copy the receiving code in `example.html`, and adapt the iframe URL and allowlisted item IDs.
`target.html` is only the synthetic local test app. The preview works over loopback HTTP;
opening `example.html` as a file shows an explicit no-bridge message without loading scripts remotely.
- **Kernel / Keys:** the picked locator becomes material at `picked-region` with build + locator
  version; Request `create-review-claim` carries that data and the human's note. The agent creates
  a stable domain claim Key. Comment/Verdict, Event Log, Send, undo and Delivery remain Kernel-owned.
- **Boundary:** both ends check `origin` **and** `source`, validate shapes and render text with
  `textContent`. Pass exact origins, never `*`; do not accept a parent origin from an untrusted URL.
- **Ceiling:** small, stable-selector reviews (200 items), full-document re-resolution; simultaneous
  pins on one element can overlap. Add stacking only when a real Page needs overlapping claims.

## Evidence and provenance
[World-console](../../SOURCES.md#world-console), `app/src/reviewBridge.ts` and
`.review/atelier/build-surface.mjs` at the recorded revision; no licence located; **original code**.
[LAU](../../SOURCES.md#owner) found pins + Confirm/Redo effective, but Apps were confirmed against
404s. A resolved selector means **located**, never scenario-ready or verified; pair with
[scenario-readiness](../scenario-readiness/README.md). No scenario simulator is hidden here.

## Check
`node extensions/atelier/candidates/check.mjs --browser` exercises origin/source rejection,
pins, picking and same-selector node replacement. Four files exceed the ~120-line aim because the
copy crosses two documents and needs explicit trust checks; no application dependency is required.
