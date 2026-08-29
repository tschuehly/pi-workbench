# Workstream Atlas

Reusable local Atelier for auditing and resuming Pi Workbench Workstreams. It reads the authoritative user-local Workstream Store and keeps generated snapshots and interaction state out of Git.

Build and verify from the repository root:

```bash
npm run workstream-dashboard:build
npm run workstream-dashboard:verify
```

Serve it from its own directory:

```bash
cd tools/workstream-dashboard
PORT=4764 UI=index.html STORE=workstream-dashboard ROOT=. node tools/review-server.mjs
```

During an attended review, arm `tools/review-poll.sh` through the monitor workflow documented by the Atelier skill.

## Files

- `build-dashboard.mjs` — projects the local Store into dashboard data and HTML.
- `dashboard.template.html` — task-shaped Workstream interface.
- `verify-dashboard.mjs` — checks the projection against the Store.
- `tools/` — copied Atelier kernel and poller.
- `.review/`, `dashboard-data.json`, and `index.html` — local generated state, intentionally ignored.

New Workstreams appear as **Unreviewed** until their group and audit explanation are added to `build-dashboard.mjs`.
