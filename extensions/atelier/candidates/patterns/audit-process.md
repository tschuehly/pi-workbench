# Audit a multi-step process

**Pick when:** the human asks how work flows, what each check proves, and which policy to change.

**Hierarchy:** process map → selected step/check with its proof limit → actual attempts (including failures)
→ evidence for the policy question → Kernel Decision on that check. Sequence and parallelism come from
execution code, not diagram geometry. A broken sample and a clean control distinguish detection from reassurance.

**Compose:** [flow-map](../components/flow-map/README.md) supplies structure;
[attempt-timeline](../components/attempt-timeline/README.md) supplies what happened;
[observation-stamp](../components/observation-stamp/README.md) bounds evidence identity and freshness.
Each can stand alone; a one-check audit may need no map.

**Why:** Thomas said the ledger lacked flow and asked whether checks were parallel; he wanted half map,
half explanation and every production step. He made the attempt timeline core although the agent ranked it
last ([PL T2–T4, VV lines 35–37](../SOURCES.md)). These are owner requests, not validation of this example.

**Does not fit:** “what is running now?” without an explanatory question; use follow-work. A static graph
cannot claim current liveness. Policy choices and permission to continue one particular run are separate asks.
