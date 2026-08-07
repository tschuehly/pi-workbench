# Credential Broker Plan

Status: proposed; implementation is blocked on the Phase 0 security feasibility gate.

## Outcome

Add one Workbench-owned Credential Broker capability for machine-local credentials used by trusted external integrations. A human enters each secret once through a masked attended interaction. The broker persists the value in the operating-system credential store and later runs a reviewed, bounded wrapper without placing the secret in model context, process arguments, repository files, shell history, Pi sessions, or Workstream state.

The broker is a harness capability, not a Run authority system. A stored credential proves only that local authentication material exists. It does not authorize a model to select arbitrary credentials, commands, URLs, HTTP methods, environments, or external side effects.

The first production pilot is PhotoQuest's read-only Instagram wrapper. The design must remain useful to Stripe, TikTok, DataForSEO, the PhotoQuest Admin API, and future bounded integrations without encoding PhotoQuest concepts into the broker.

## Why Workbench should own this capability

The current PhotoQuest wrappers repeat Keychain prompting, storage, retrieval, deletion, and redaction. The resulting interfaces are inconsistent, and value-less `security -w` calls cause additional password-data and retype prompts. Public application identifiers are also stored as if they were secrets.

Existing Pi packages provide useful evidence but not a complete fit:

- [`pi-secrets`](https://github.com/liamvinberg/pi-secrets) demonstrates masked Pi interaction and output redaction, but stores values only for one Pi process and injects them into the ambient shell environment.
- [`@victor-software-house/pi-credential-vault`](https://github.com/victor-software-house/pi-credential-vault) demonstrates persistent Keychain and age adapters, but manages model-provider credentials only and targets the older `@mariozechner/*` Pi interface.
- [`@arvoretech/pi-secret-firewall`](https://www.npmjs.com/package/@arvoretech/pi-secret-firewall) provides useful defense-in-depth redaction but is not a credential store or an authority mechanism.
- [`latchkey`](https://github.com/imbue-ai/latchkey) demonstrates credential-bound HTTP execution, but its generic curl surface is broader than Workbench's bounded-capability posture.

Pi Workbench should adapt the proven mechanics rather than install one package as a second credential, workflow, or permission owner. This follows the harness contract: versioned capability code lives in the harness; credentials and machine-specific state remain local.

## Security posture

The intended guarantee is narrow and structural at the supported interface: the broker exposes no sanctioned operation that reveals a stored value, excludes values from normal execution artifacts, and uses operating-system access control to prevent silent casual reads through unrelated processes. It protects against accidental disclosure, interface misuse, and a direct unapproved `security` lookup.

It does not protect against a deliberately hostile or misaligned process with the same macOS user authority and unrestricted bash. Such a process may attach a debugger, transform a value after compromise, or attack trusted code. Level 1 has no filesystem, process, or network sandbox, so the broker must not be described as an adversarial isolation boundary. Its structural controls constrain the supported capability; they do not expand Level 1 authority or make prompt guidance enforceable.

The initial implementation trusts:

- the operating system and the current macOS user session;
- the installed Credential Broker executable;
- the explicitly installed immutable wrapper snapshot; and
- the provider named by that wrapper's fixed contract.

It does not claim protection from root, a debugger, a compromised operating system, or arbitrary malicious code running with equivalent credential-store entitlement. Output redaction remains defense in depth; it cannot detect every transformed or split representation of a secret.

Level 1 currently has unrestricted local bash and no process, filesystem, or network sandbox. Therefore ordinary Keychain items readable by `/usr/bin/security` do not satisfy even this narrower interface guarantee. Phase 0 must prove that a dedicated installed executable can create credentials whose access control permits the broker but denies or requires attended approval for an unrelated `security find-generic-password` process. If macOS cannot enforce that property with a stable installation and signing identity, implementation stops until the owner chooses either a purely cooperative accidental-disclosure posture or a mandatory sandbox/access-control dependency.

## Harness capability package and seam

Create `packages/credential-broker/` as a versioned harness capability package outside the five canonical Run-lifecycle deep modules. Its interface carries credential metadata and bounded operations; its implementation hides masked input, storage adapters, access control, wrapper installation, digest verification, private credential transport, refresh writeback, cancellation, output validation, and redaction. The package grants no Run authority and owns no Workbench ledger or canonical state.

```ts
interface CredentialBroker {
  setup(request: SetupRequest, interaction: SecretInteraction): Promise<CredentialReceipt>;
  status(bindingId: BindingId): Promise<CredentialStatus>;
  remove(request: RemoveRequest, interaction: ConfirmationInteraction): Promise<CredentialReceipt>;
  execute(request: BoundOperationRequest, signal?: AbortSignal): Promise<BoundOperationResult>;
}
```

Interface rules:

- `setup` accepts a declared binding identifier, not a secret value. `SecretInteraction` supplies exactly one masked attended value directly to the implementation.
- `status` reports only `missing`, `ready`, `expired`, or `unavailable`, plus non-secret expiry metadata when the provider contract supplies it. It never lists unrelated namespaces, lengths, hashes, prefixes, or value fragments.
- `remove` is attended and confirmation-protected. It is not model-callable.
- `execute` accepts a binding identifier, a finite operation name, and schema-validated non-secret input. It accepts no executable path, shell fragment, URL, HTTP method, environment variable, credential namespace, or arbitrary arguments.
- The module exposes no `get`, `resolve`, `reveal`, `export`, generic environment injection, or generic command execution operation.
- Unknown bindings, modified wrappers, unavailable storage, missing credentials, invalid inputs, invalid outputs, unsupported interaction modes, and uncertain process outcomes fail closed.

Use two internal adapters because behavior genuinely varies:

- `CredentialStore`: in-memory fake and macOS Keychain implementations.
- `SecretInteraction`: deterministic fake, terminal masked input, Pi TUI, and PI WEB sensitive-input implementations.

Do not expose these internal seams to provider wrappers.

## Binding and wrapper model

A versioned binding manifest describes the non-secret contract for one integration:

- stable binding identifier;
- required credential slots and optional expiry semantics;
- finite human-only and model-callable operations;
- input and normalized output schemas;
- reviewed wrapper source and installation digest;
- fixed executable runtime and exact launch shape;
- timeout and output limits;
- credential slots the wrapper may replace during OAuth exchange or refresh; and
- expected provider hosts for review and later sandbox enforcement.

Repository content may propose a binding, but a credential-bearing execution uses only a human-installed immutable snapshot under machine-local Workbench state. The broker resolves the installed snapshot by digest, rejects symlinks and path substitution, and refuses execution after any content mismatch. Agent-edited repository wrappers never receive credentials until a human installs the reviewed revision.

The broker launches the wrapper directly without a shell and with a minimal allowlisted environment. It removes proxy, dynamic-loader, language-startup, TLS-key-log, and other injection variables. Credentials travel over a private inherited file descriptor or equivalent platform channel, never argv or the parent Pi environment. A separate narrow control channel permits only manifest-declared credential replacement for OAuth exchange and refresh. The broker validates normalized wrapper output before it reaches Pi and never spills raw credential-bearing output to disk.

Non-secret application IDs, client keys, API logins, form identifiers, account metadata, and provider configuration remain outside Keychain. Provider-owned local configuration uses a documented machine-local file with restrictive permissions. The broker does not become a generic configuration store.

## Human and Pi surfaces

Provide a companion `pi-credential` executable:

```text
pi-credential setup <binding>
pi-credential status <binding>
pi-credential remove <binding>
pi-credential run <binding> <operation> [validated options]
pi-credential doctor
```

`setup` reads once from a controlling terminal with echo disabled. It rejects a value supplied in argv, environment, redirected stdin, or a non-interactive process. `run` resolves all credential slots and wrapper details from the installed binding; callers cannot override them.

Add `extensions/credential-broker/` with only model-safe operations:

- `credential_status`
- `credential_execute`

Credential-bearing execution remains visible attended tool activity under Level 1's continuous Human Attention. Capability resolution selects the exact binding for the current trusted repository/session; availability on the machine grants no ambient cross-project access, and child Pi processes do not inherit it.

Attended setup and removal remain extension commands or shell-owned actions, not model tools. Pi's current generic input interface is not documented as a secret-safe persistence boundary, and `ctx.ui.custom()` is unavailable in RPC mode. Before setup is offered through Pi or PI WEB, add or obtain an upstream Pi sensitive-input interaction that marks the response as secret and proves it is excluded from model context, session JSONL, RPC traces, notifications, and telemetry. Until then, the companion terminal command is the supported setup surface.

PI WEB remains a client. If it renders setup, it uses the same typed sensitive-input interaction and never stores credential values in Workstream or Run state.

## Implementation phases

### Phase 0 — Security feasibility and package evidence

1. Create a disposable macOS prototype that stores one canary credential through a dedicated signed executable using an explicit Security-framework access-control list or `SecAccessControl` policy tied to that executable's stable code identity.
2. Prove the broker can read it after restart.
3. Prove direct `/usr/bin/security`, an unrelated Node process, and an unsigned replacement cannot read it silently. Record whether each attempt is denied, triggers an attended system prompt, or succeeds; only denial or an unavoidable attended prompt passes.
4. Rebuild and upgrade the broker prototype to establish whether signing identity and Keychain access survive supported updates.
5. Inspect and pin the exact reusable mechanisms from `pi-secrets`, `pi-credential-vault`, and their Keychain dependency. Record provenance, licenses, release commits, rejected ownership, and findings in a new credential-specific research source or an explicit addition to `docs/research/sources/pi-package-evaluation.md`.
6. Inspect `extensions/quota-startup/` for reusable attended-prompt and Keychain-diagnostic conventions. Keep its model-provider authentication responsibility separate from broker storage.
7. Decide whether the first release supports macOS only or whether another verified store adapter is required.

**Gate:** do not implement the public module until the access-control result supports the documented guarantee. If it fails, write a decision proposal describing the reduced cooperative posture and its consequences before continuing.

### Phase 1 — Contract and deterministic fixture suite

1. Add the Credential Broker decision to `docs/foundation/decisions.md` and update `docs/contracts/harness.md`: capability code and binding manifests are versioned; credential values and installed trust state remain machine-local; the broker is separate from startup quota checks, sits outside the five Run-lifecycle deep modules, and grants no Run authority.
2. Define binding, operation, status, result, and typed-error schemas as a capability-local contract. They are not Run-protocol records and do not extend the Run schema registry.
3. Create fake store, interaction, wrapper, clock, and process adapters.
4. Write failing interface-level tests before implementation.

The red suite must cover malformed identifiers, unknown bindings and operations, cross-binding substitution, unavailable storage, missing credentials, invalid interaction modes, modified wrapper snapshots, malformed output, timeout, cancellation, and unknown process outcome.

### Phase 2 — Core broker and companion CLI

1. Implement binding validation and immutable wrapper installation.
2. Implement setup, per-binding status, attended removal, and bounded execution against the fake store.
3. Implement direct process launch, minimal environment construction, private credential transport, bounded output, normalized result validation, and revision-checked OAuth writeback.
4. Implement the terminal CLI and `doctor` command.
5. Add exact, URL-encoded, base64, and common encoded-form redaction as secondary containment.

### Phase 3 — macOS Keychain adapter

1. Implement the proven native Keychain access-control design.
2. Provision the helper as a versioned harness capability; do not commit generated binaries or credential state.
3. Add deterministic adapter tests and a disposable real-Keychain smoke suite with guaranteed cleanup.
4. Test locked Keychain, denied access, duplicate or corrupt items, upgrade identity, and removal.

No plaintext, age-file, environment, or native Pi-auth fallback is permitted in the first release. An unavailable Keychain produces a typed failure.

### Phase 4 — Pi and PI WEB interaction

1. Add the model-safe Pi tools and attended commands.
2. Implement or contribute the generic sensitive-input interaction upstream-first.
3. Add the PI WEB rendering path only after the sensitive response is demonstrably absent from all persisted and model-visible channels.
4. Resolve binding availability through trusted harness/repository capability configuration rather than making every installed credential globally available to every Pi session or child.
5. Ensure subordinate Pi processes receive no credential capability unless explicitly resolved for their bounded assignment.

### Phase 5 — PhotoQuest Instagram pilot

1. Register an Instagram binding whose model-callable operations remain the existing bounded connectivity and read-only analytics operations.
2. Keep the app identifier and provider metadata in machine-local non-secret configuration.
3. Move only the app secret and OAuth token material into broker-managed slots.
4. Adapt OAuth exchange and refresh to use revision-checked credential writeback without authorization codes, tokens, callback values, or secrets entering chat or argv.
5. Preserve the wrapper's fixed hosts, scopes, paths, fields, date bounds, pagination limits, normalization, and redaction contract.
6. Remove direct Keychain access from the provider wrapper after migration succeeds.
7. Run connectivity and one bounded owned-media read only after attended OAuth completes locally.

Do not migrate the other PhotoQuest providers until the Instagram pilot passes and its evidence is reviewed.

### Phase 6 — Provider migration and promotion

Migrate one provider at a time. Static-key providers use one secret slot; OAuth providers use separate client-secret and token slots with provider-specific refresh semantics. Remove non-secret Keychain entries rather than importing them. Preserve each wrapper's existing read-only and output bounds.

After each migration, run provider fixture tests, broker contract tests, a credential-leak scan, and the provider's documented bounded smoke. Promote the capability to the curated harness only after macOS installation, Pi TUI, PI WEB, restart, failure, and migration evidence pass.

## Acceptance evidence

The implementation is complete only when tests prove:

1. setup displays one broker-owned masked prompt and no second Keychain retype prompt;
2. canary values never appear in argv, parent Pi environment, stdout, stderr, diagnostics, temporary files, local configuration, Git state, Pi session JSONL, RPC traces, Workstream records, or PI WEB telemetry;
3. direct credential-store reads by an unrelated process are denied or require attended approval as established in Phase 0;
4. only an installed digest-matched wrapper can receive the credential;
5. symlink, path-shadowing, wrapper mutation, and time-of-check/time-of-use attempts fail closed;
6. a binding cannot request another binding's credentials or substitute its own namespace;
7. proxy, loader, startup-hook, and inherited-secret environment variables do not reach the wrapper;
8. raw, encoded, split, malformed, and oversized wrapper output cannot leak a fixture canary into Model Context;
9. setup and removal refuse non-interactive invocation, while status remains non-mutating and model-safe;
10. missing, locked, denied, corrupt, and expired credentials produce bounded typed failures without fallback;
11. concurrent OAuth refresh uses revision checks and cannot silently overwrite a newer credential;
12. cancellation and timeout confirm child termination or report `outcome_unknown`;
13. Pi and PI WEB expose no credential retrieval or generic credential-bearing execution interface;
14. binding capabilities are resolved per trusted repository/session scope and are not inherited automatically by child Pi processes;
15. restart preserves usable credentials without persisting values in Workbench state; and
16. the PhotoQuest Instagram fixture suite, broker suite, Workbench root tests, connectivity check, and one bounded live read pass. Live evidence remains machine-local and introduces no committed credential, token, callback value, or checked-in dependency on local credential state.

## Stop conditions

Stop and request owner judgment if:

- Keychain access control cannot structurally prevent silent unrelated reads;
- Pi or PI WEB cannot provide a sensitive interaction that excludes values from sessions and traces;
- a wrapper requires model-selected URLs, commands, headers, or environments;
- the installed wrapper cannot be pinned and verified without a mutable path race;
- provider output cannot be normalized before reaching Model Context; or
- implementation would require a daemon, ambient global environment injection, or a second authority/ledger system.

## Out of scope

- Model-provider `/login` credential management.
- Generic curl, shell, HTTP, URL, header, or environment credential injection.
- Secret reveal, export, clipboard copy, prefix listing, cross-project enumeration, or synchronization.
- Cloud or team vaults, multi-user sharing, backup, and cross-machine transfer.
- Automatic trust of repository-edited wrappers.
- Treating redaction as protection from an adversarial same-user process.
- A Run Controller, daemon, database, managed execution, or new Level 1 authority claim.
- Immediate migration of every PhotoQuest provider before the Instagram pilot is accepted.
