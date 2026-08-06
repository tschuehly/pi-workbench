# Workstream — PI WEB prototype UX

This work is tracked in the operational user-local **Workstream Store** as Workstream
`pi-web-prototype-ux`. The store is authoritative; this file is only a repo-side pointer and does
not duplicate its ledger or current-state projection.

- **Store location:** `~/.pi-workbench/workstreams` (user-local, not committed).
- **Inspect (run from repo root):**

  ```bash
  node --input-type=module -e 'import {createUserLocalWorkstreamStore} from "./packages/workstream-store/src/index.js"; console.log(JSON.stringify(await createUserLocalWorkstreamStore().inspect("pi-web-prototype-ux"),null,2))'
  ```

Session 1 is the Pi lead session that produced the prototype (status active). Its confirmed
checkpoint references commits `a383b6a`, `fb28eaa`, `430354b`, `5dcb630`. Two durable Human Tasks
are pending — accept the direction, and do the Context/child-inspect conciseness pass — with
authoritative status in the store.

Repo artifacts the Workstream links:

- Plan: [`pi-web-unified-chat-workstream-prototype.md`](./pi-web-unified-chat-workstream-prototype.md)
- Working prototype: [`../research/reports/pi-web-unified-chat-workstream-prototype.html`](../research/reports/pi-web-unified-chat-workstream-prototype.html)
