# Port provenance

## Graduated source

- Source repository: `skill-incubator` at `372f3d091489abcd74436faa4fda15db09f96edf`
- Source capability: `skills/model-orchestration/`
- Source runtime adapter: `claudex.sh` and `docs/claudex-orchestration.md`
- Port date: 2026-07-30

## Preserved

- Cognitive-role vocabulary and the initial role-to-model policy.
- Fresh raw quota as an eligibility gate.
- Explicit refusal instead of silent model-family substitution.
- Model and Model Effort selection per bounded assignment.
- Cross-family Independence as a deliberate role property.

## Adapted for Pi

- Provider identifiers are Pi catalog identifiers (`openai-codex`, `anthropic`).
- Runtime resolution checks Pi's model catalog directly.
- `pi-role` replaces the Claudex launcher for unmanaged interactive lead sessions.
- Managed work passes a proposed binding through the Workbench controller's Dispatch interface.

## Rejected as runtime-specific

- Claude Code workflows, teams, custom-agent frontmatter, and workflow resumption.
- CLIProxyAPI effort overrides and `CLAUDE_CODE_SUBAGENT_MODEL` wiring.
- Launching Claude Code, Codex CLI, or Claudex from a Pi worker.
- Cooperative Claudex leases presented as controller enforcement.

Pi is the only Workbench model-worker runtime. The useful Claudex policy graduated; its provider-specific harness did not.
