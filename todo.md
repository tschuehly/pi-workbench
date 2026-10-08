# To do later

- [ ] Evaluate model and profile choices using P1–P3 in [the model–role evaluation plan](docs/plans/model-role-evaluation.md). Record comparable results and ask Thomas before changing model bindings or profile instructions; leave Decision 99 unchanged.
- [ ] Decide the child-execution cache policy in [Deferred Decision 19](docs/foundation/decisions.md) after measuring cache misses. Thomas chooses whether to adopt long retention, trial it, or keep the current setting; change no defaults before that decision.
- [ ] On or after 2026-10-06, verify the context-reduction changes (installed at bfff4ff) in real use, from session files in `~/.pi/agent/sessions` and telemetry dated 2026-09-30 onward. Context: `~/.pi-workbench/handoffs/context-reduction-2026-09-29.md` and the reports in `~/.pi-workbench/evals/reports/`. Check that:
  - child session headers carry `parentSession`;
  - children call `web_enable` when they need the web, and the web tools then work;
  - models call `tools_enable` when they need workers, the monitor, or Atelier, and never fail to find those tools;
  - goal tools appear during `/goal`;
  - prompt-cache reads stay high after a mid-session enable;
  - startup tokens match `node scripts/context-usage.mjs` (2026-09-29: lead 16,899, child 13,487).
- [ ] Add a ponytail A/B arm to the model evaluation (Workstream ws-model-routing-eval-20260925): Opus 5.5 with and without the ponytail text in `~/.pi/agent/APPEND_SYSTEM.md`, on Workbench-typical tasks, measuring cost, output tokens, LOC, and correctness. No Opus 5.5 evidence exists yet (checked 2026-09-29; nearest is Opus 5 in ponytail PR #844, n≤3, conflicting). Thomas decides whether ponytail stays always on.
