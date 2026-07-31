# Model-Routing Field Notes

## Scope

Recent practitioner advice supplied by Thomas on 2026-07-16, checked against Pi's current worker, session, and cache primitives. These posts are routing hypotheses rather than benchmark evidence.

## Supplied Claims

1. ClaudeDevs recommends asymmetric delegation: escalate difficult judgment to a Fable advisor or delegate mechanical work to Sonnet workers. The post also claims that each managed subagent keeps an independent cache.
   - Source: [ClaudeDevs, 2026-07-07](https://x.com/ClaudeDevs/status/2074606065170456777)
2. Dan McAteer recommends using Fable as orchestrator while delegating reasoning-heavy phases to Opus to conserve Fable usage.
   - Source: [Dan McAteer, 2026-06-11](https://x.com/daniel_mac8/status/2065066247448821841)
3. Diego Cabezas recommends Fable for orchestration, Opus for deep reasoning, Sonnet for mechanical work, and Codex as an independent peer perspective. For high-stakes decisions, the post recommends independent parallel answers followed by synthesis.
   - Source: [Diego Cabezas, 2026-07-01](https://x.com/diegocabezas01/status/2072436501263339841)

## Transferable Patterns

- Route by cognitive role instead of using the strongest model for every step.
- Separate synthesis, deep comprehension, mechanical execution, and independent challenge.
- Preserve independence for parallel high-stakes opinions by withholding peer answers until synthesis.
- Reuse a specialist when repeated work on the same semantic scope benefits from continuity.
- Record usage and quality outcomes so routing advice can be evaluated against real repository work.

## Pi-Specific Qualification

- The deterministic controller, not the coordinator model, owns the Quality Run state machine. A strong coordinator contributes judgment and synthesis without becoming the transition authority.
- Claude, Codex, and other models are selected inside Pi rather than through provider-specific coding-agent harnesses.
- Pi supports cache-retention preferences and provider-dependent session affinity. Unsupported options may be ignored.
- Pi's official ephemeral subagent example uses isolated no-session processes. Repeating the same named subagent therefore does not by itself guarantee a durable conversation or cache.
- Warm continuity and fresh independence are different requirements: resumable Pi workers serve the former; ephemeral Pi subagents serve the latter.

## Specification Implications

- `WorkerSpec` declares cognitive role, required capability, reasoning effort, continuity, independence, model binding, and cache-retention preference separately.
- Model names remain repository policy or resolved dispatch bindings rather than universal workflow semantics.
- Run analysis records cache reads and writes, latency, quota pressure, retries, review yield, rework, and acceptance outcomes by role and model.
- Routing changes enter the compounding pipeline as evidence-backed workflow candidates.

## Confidence

- The social posts are recent and useful as practitioner experience, but they do not establish comparative quality or cost by themselves.
- Pi API and session behavior are high-confidence implementation evidence.
- The best role-to-model mapping for the target repositories remains an empirical question for pilot runs.
