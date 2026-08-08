# Port provenance

## Graduated source

- Source repository: `skill-incubator` at `a6c017105d8b2faee1639eb10b404e02483d0a8b`
- Source capability revision: `8f99c5221c4b5b508d4d88125ffba03b903ed323`
- Source capability: `skills/autonomous-grill/`
- Port date: 2026-08-08

## Preserved

- Autonomous cross-model challenge followed by human verdicts.
- A decision tree worked one consequential branch at a time.
- Fact-finding as model work rather than human questioning.
- Compact challenge rounds, a closing completeness audit, numbered proposals, and explicit dissent.
- Accepted decisions as the only inputs to domain-model updates; implementation remains separately authorized.

## Adapted for Pi Workbench

- Provider-specific Claude/GPT language became provider-neutral cross-family Independence.
- The Workbench `challenge` Cognitive Role and Level 1 `subagent` tool replace Claudex routing and agent orchestration.
- One logical advisor role is reconstructed in fresh bounded Subagents through a compact advisor ledger because Level 1 does not provide persistent child continuity.
- Primary Evidence, Cognitive Role, Subagent, and Independence use canonical Workbench language.

## Rejected as unsupported

- A child process presented as persistent across multiple calls.
- Durable shared state, managed Dispatches, Episodes, or Run authority in an attended Level 1 skill.

The port preserves the deliberation method without claiming lifecycle or continuity guarantees that the Level 1 harness does not provide.
