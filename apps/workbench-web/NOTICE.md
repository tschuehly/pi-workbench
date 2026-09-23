# Source provenance

The join-watermark and pending-question behavior in `client.mjs` was adapted from PI WEB's `src/client/src/controllers/sessionController.ts`, `src/client/src/sessionSocket.ts`, and `src/shared/apiTypes.ts` at fork commit `f17b8aebdbf5c59c4974f653d717f69584eb697a`. The owned client contains no runtime import of PI WEB frontend code. Its protocol subset is maintained here and is not a full Chat port.

`pi-web-shell.css` adapts PI WEB's palette and selected `appStyles`, `chatStyles`, and `promptEditorStyles` from `src/client/index.html` and `src/client/src/components/shared.ts` at fork commit `75482792`. The adapted stylesheet is copied into the owned build, never imported from the fork.

PI WEB is MIT licensed. Copyright (c) 2026 Federico Jaramillo Martinez. The full license is included as `LICENSE-PI-WEB.txt` in this source and its built assets.
