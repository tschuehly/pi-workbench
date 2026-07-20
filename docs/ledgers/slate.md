# Slate Evidence Ledger

## Scope

Official Random Labs material about Slate's thread-and-episode architecture, context management, parallel orchestration, skills, configuration, and long-running software work. Reviewed on 2026-07-18.

## Findings

1. Slate uses one central orchestration agent to dispatch bounded actions to isolated worker threads. A thread performs one action, pauses, and returns control to the orchestrator.
   - Source: [Slate: moving beyond ReAct and RLM](https://randomlabs.ai/blog/slate)
2. Each completed thread action produces an episode: a compressed representation of the useful action history. Episodes can be referenced by the orchestrator and supplied as inputs to later threads without copying the complete tactical context.
   - Source: [Slate: moving beyond ReAct and RLM](https://randomlabs.ai/blog/slate)
3. Frequent episode boundaries let the orchestrator revise strategy as evidence arrives. Several independent threads can execute in parallel and synchronize through their returned episodes.
   - Source: [Slate: moving beyond ReAct and RLM](https://randomlabs.ai/blog/slate)
4. Slate models skills as contextual actions. A selected skill is injected into a scoped thread for an episode and removed when the episode ends. Random Labs also describes an alpha design that routes autonomous skills to threads and interactive skills to synchronous forks.
   - Source: [Skills as Dynamic Actions](https://randomlabs.ai/blog/skill-chaining)
5. Slate exposes project and global configuration for permissions, role-oriented model slots, MCP servers, commands, headless JSONL execution, and server/attach operation.
   - Sources: [Configuration](https://docs.randomlabs.ai/en/using-slate/configuration), [The Basics](https://docs.randomlabs.ai/en/using-slate)
6. Random Labs describes Slate's routing behavior as promising but leaves formal analysis and benchmarking for future work.
   - Source: [Slate: moving beyond ReAct and RLM](https://randomlabs.ai/blog/slate)
7. In Random Labs' library-porting case study, Slate declared completion before full verification, omitted four source files, and later needed a reminder of the high-level compatibility goal. Clear feedback loops improved the run.
   - Source: [Porting an entire library to a different language with a sentence](https://randomlabs.ai/blog/porting-a-library-with-slate)

## Specification Implications

- Use a typed episode as the common synchronization and context-transfer result for every bounded Pi dispatch.
- Keep execution-graph nodes semantic and store tactical actions as episodes within their owning node.
- Implement coordinator, worker, and subagent semantics with one parameterized Pi execution primitive.
- Use coordinator-to-worker dispatch and episode return as the initial coordination topology. Represent deliberation as linked claim, challenge, and response episodes instead of peer mailboxes.
- Resolve skills per dispatch, scope their instructions to the execution context, and record their exact versions in the resulting episode.
- Preserve the deterministic controller, durable ledger, primary evidence, independent verification, owner acceptance, and cleanup lifecycle. Episode compression is context management, not a correctness or authority mechanism.

## Confidence and Limits

- The architecture and product behavior are documented by Slate's creators and are high-confidence descriptions of their intended system.
- Slate's current package is proprietary, so the public material does not independently verify its internal implementation.
- Claims about routing quality, context coherence, and parallel speed are product observations rather than controlled comparative evidence.
- Slate's terminology informs the workbench design but does not define the Pi protocol or storage schema.
