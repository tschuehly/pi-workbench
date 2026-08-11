# DODOREACH Tailscale File Transfer Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

Research only. Nothing in this ledger is an accepted recommendation, an approved plan, or a settled
decision. Every classification below is a candidate for a later separate decision.

## Verdict

DODOREACH's Tailscale file transfer is a claim with no linked implementation. The August 11 thread
states a natural-language Pi interaction — “send me this file” — that sends a host file to the
owner's phone or Mac. That supports a claimed agent-initiated host-to-device direction and trigger.
The transport, authentication, destination selection, size limits, failure behavior, and correctness
remain unknown, and no private mechanism is reconstructed here.

The comparable demonstrable behavior is not a Workbench module at all: PI WEB documents remote access
through a trusted private bind or explicit tunnel/proxy, while its default remains loopback and already implements
browser file upload into a workspace. A Pi-side transfer tool would therefore be solving the
remaining, much narrower problem of agent-initiated delivery — the behavior the source claims but
does not implement publicly. Ordinary delivery does not require an authoritative artifact store:
the file may already exist in the workspace. Immutable evidence retention, human retrieval, and an
agent-triggered external side effect belong to different Workbench layers.

## Scope and method

The primary August 11 thread reports the natural-language host-to-phone/Mac transfer. The complete
July 21 mobile prompt was also recovered and names a Tailscale acceptance test. The implementation is
private and unlinked; [`dodo-reach-pi-mobile-web-ui.md`](dodo-reach-pi-mobile-web-ui.md) records the
prompt provenance and wider UI requirements.

Demonstrable comparison material, at the revisions checked out locally:

| Artifact | Identity | Evidence used |
| --- | --- | --- |
| PI WEB remote access | sibling `../pi-web` at `8644d99`, `docker/README.md` | Default loopback bind; named remote-access options |
| PI WEB configuration | same checkout, `docs/config.md` | `host`/`port`, `PI_WEB_ALLOWED_HOSTS`, `maxUploadBytes`, `uploads.defaultFolder`, machine federation |
| Workbench modules | `packages/artifact-store/`, `packages/controller/` | Both directories are empty |
| Workbench V1 boundary | `docs/foundation/decisions.md` item 42, `docs/foundation/system-overview.md` | Cross-machine handoff outside V1 |
| Tailscale Taildrop | [official Taildrop documentation](https://tailscale.com/kb/1106/taildrop) reviewed 2026-08-11 | Same-owner device transfer, public alpha, tailnet opt-in |

## Claim, preserved as a claim

> DODOREACH reports that asking Pi to “send me this file” transfers it to the owner's phone or Mac,
> and the private mobile web UI prompt required a Tailscale test.

That supports a natural-language agent trigger and host-to-owner-device direction. Whether it uses
`tailscale file cp`, Taildrop, an HTTP endpoint over the tailnet, or something else; how it handles
size, collisions, secrets, and partial transfer — all unknown. No public package is attributed to it,
and none of these possibilities is treated below as if it were the source's design.

## What is demonstrable without the source

### Taildrop narrows one plausible mechanism but does not identify the private implementation

Tailscale's documented file-transfer feature, Taildrop, is peer-to-peer and encrypted but limited to
devices owned by the same Tailscale user identity; it cannot send to another user's devices, even in
the same tailnet, and tagged nodes are excluded. It is a public-alpha feature that must be enabled for
the tailnet. Transfers may resume for roughly one hour, and macOS receives files in `~/Downloads`.
This makes same-owner transfer a plausible bounded analogue, but DODOREACH never identified Taildrop,
so these properties must not be attributed to the private tool.

### PI WEB documents remote access, but loopback alone is not a tailnet path

PI WEB binds its web port to `127.0.0.1` by default (`docs/config.md` global example; `README.md`
shows `http://127.0.0.1:8504`). A loopback-only process is not directly reachable over a tailnet.
PI WEB's Docker guide instead documents either binding to a trusted private address such as a
Tailscale `100.x.y.z` address or using an explicit tunnel/proxy. DODOREACH's separate UI prompt names
Tailscale Serve, which can proxy to loopback, but the cited PI WEB docs do not establish that exact
setup. `PI_WEB_ALLOWED_HOSTS` is documented for the dev server, not as a general production
Host-header security boundary.

Thus remote phone reach is an upstream deployment posture with an explicit private bind or proxy,
not something obtained merely by combining the default loopback bind with Tailscale.

### PI WEB already implements human-initiated file transfer into a workspace

`docs/config.md` documents two upload paths in the Files panel: drag-and-drop straight into the
workspace-effective default folder, and a toolbar **Upload** dialog that allows editing the
destination. The destination is `uploads.defaultFolder`, defaulting to `.pi-web/uploads`, with a
project-local override in `<project>/.pi-web/config.json`. Body and upload size are bounded by
`maxUploadBytes`. PI WEB also supports machine federation, where selected-machine settings apply to
work running on that machine.

Once PI WEB is made reachable through an explicit private bind or proxy, a phone on the tailnet can
place a file into the workspace the agent is working in, with a configurable destination and an enforced size ceiling. That
is an implemented and documented path, not a specification.

### Agent-triggered delivery, evidence retention, and human retrieval are separate concerns

PI WEB already supports human upload and download of workspace files. The source's remaining claimed
convenience is an agent-triggered transfer to another owner device. That would be an explicit bounded
external side-effect adapter with authorization and a receipt. If the file must also become immutable
retained evidence, its hash, provenance, and retention belong to the future Artifact Store. Human
retrieval and presentation belong to PI WEB or a Review Surface. `packages/artifact-store/` and
`packages/controller/` remain unimplemented, but their absence does not prevent ordinary file
delivery from an existing workspace. Decision 42 places portable cross-machine handoff outside V1;
a convenience transfer must not silently claim handoff semantics.

## Comparison with implemented Workbench reality

| Concern | Demonstrable today | Source evidence |
| --- | --- | --- |
| Remote reach to the agent host | PI WEB documents a trusted private bind or explicit tunnel/proxy; loopback alone is not remotely reachable | Claim only |
| Human → workspace file transfer | PI WEB Files upload, destination config, size ceiling | Claim only |
| Agent → owner device transfer | Absent | Claimed natural-language host-to-phone/Mac behavior; implementation private |
| Durable evidence for a transferred file | Absent; `packages/artifact-store/` is unimplemented | Not claimed by the source |
| Cross-machine handoff | Explicitly outside V1 (Decision 42) | Claim only |

Workbench and PI WEB are better here in the only comparable respect — an implemented, bounded,
configurable human-initiated transfer over a transport the owner already controls. The source may be
better at agent-initiated transfer; there is insufficient evidence to say so, and a bespoke transfer
tool would also introduce a genuine exfiltration surface with no confinement underneath it, given
that Level 1 has no filesystem, process, or network sandbox (see
[`dodo-reach-sandbox-guard.md`](dodo-reach-sandbox-guard.md)).

## Candidate lessons (none accepted)

- **Experiment — state the supported remote-access posture, do not build transport.** If reaching a
  Workbench host from a phone matters, the smallest step is to document the already-supported PI WEB
  path (trusted private bind or explicit proxy over the owner's network) and test it, rather than add a Pi transfer tool.
  Falsifier: an owner on a tailnet reaches PI WEB and uploads a file into the active workspace with no
  new Workbench code. Owning boundary: `docs/integrations/pi-web/`.
- **Experiment — separate delivery from evidence.** If agent-triggered delivery is genuinely useful,
  model it as one explicit bounded external side effect with owner authorization and a receipt. Reuse
  PI WEB for retrieval/presentation. Promote the file to the Artifact Store only when immutable
  evidence retention is separately required.
- **Insufficient evidence — the DODOREACH capability.** No adopt, adapt, or reject verdict is
  possible on an unlinked implementation with no described mechanism.
- **Reject as a shortcut — an unconstrained network transfer tool in the Pi tool surface.** Level 1
  has no network confinement, and a general "send this file elsewhere" tool would expand the
  supported capability surface without any enforcement boundary or evidence trail beneath it.

## Open questions

1. Is there an actual unmet Workbench need here, or is the demonstrable PI WEB upload path already
   sufficient for the owner's real phone-to-host cases?
2. If agent-initiated emission is needed, does it belong to the Artifact Store interface, a PI WEB
   download surface, or neither in V1?
3. What would attributable evidence for a transferred file look like — origin session, actor,
   content hash, retention — and does anything below Level 4 need it?
4. Taildrop already enforces same-owner identity at the transport layer. Could that ever contribute
   an authorization signal to a bounded Workbench action, or must Workbench continue to treat it as
   transport evidence only?
5. Is there a public DODOREACH artifact that would turn this claim into inspectable evidence?

## Confidence and limitations

High confidence in the PI WEB configuration, upload, and remote-access statements: each is a direct
read of the named file at `8644d99`. High confidence that `packages/artifact-store/` and
`packages/controller/` are empty in the current checkout. The upload path was verified by
documentation reading, not by performing an upload over a tailnet; that end-to-end confirmation
remains outstanding. No confidence in any characterization of DODOREACH's transfer capability beyond
its claimed existence, and no mechanism for it is asserted anywhere in this ledger.
