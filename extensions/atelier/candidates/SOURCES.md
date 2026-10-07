# Source register

Read this when tracing a candidate. Candidate READMEs cite these stable source IDs; paths are
relative to the named repository or retained Workstream artifact, never the development checkout.
Code is an **original reimplementation** of mechanisms, not copied upstream code. Private-source
licences were not found: no licence permission is assumed. Synthetic examples carry no customer data.

## Authority

[Decisions 107–132](../../../docs/foundation/decisions.md#atelier-agent-built-pages) and
[Glossary](../GLOSSARY.md) take precedence over older research recommendations. D107 keeps these
out of the Registry; D117 makes content arrangements optional; D127–132 settle versions, Delivery,
undo, domain reads, Verdict and Mac-only default. Earlier synthesis questions are not fresh authority.

## Kernel

The sibling [`kernel/atelier.js`](../kernel/atelier.js) Page contract was inspected, not modified.
`atl-key` nests domain identities; `atl-ver` binds judged content to a revision; `atl-verdict` declares
a scale; `atl-request` on a button/form declares a typed job; `atl-group` groups Comment Send.
Load the copied Kernel once in the real Page. Samples deliberately do not simulate its Event Log,
undo, answers, Delivery or replay. Their transient view state is not saved human review state.
Read [integration limits](INTEGRATION.md) before claiming an end-to-end workflow works.

## Evidence labels

- **Observed:** owner actions or production history support the source mechanism, not this new code.
- **Owner-spec:** explicit owner request/verdict or a requirements briefing, not a tested candidate.
- **Mechanism:** primary source inspected; no owner validation of this adaptation.
- **Scout-only:** supplied landscape note; not promoted into a unique Component from that note alone.

## Owner

`skill-incubator-private`, local Git HEAD `aecff37e7bd691c6df9c6cb75c592eadbb34e790`;
no origin remote is configured, so no GitHub revision URL is asserted. Retained files below may be
untracked; SHA-256, not repository HEAD, identifies the exact supplied evidence. No licence found.
VV = variant verdicts; JV = structured marks; LAU = live-annotation report; FL = feedback ledger.

| ID | Repository-relative path | SHA-256 of inspected bytes |
|---|---|---|
| VV | `atelier/docs/variant-verdict-20261006.md` | `a2d47d3b47949c5a11bd93035a6e843a6840d9f975d5575527942f2aa2c5cf8a` |
| JV | `atelier/docs/judging-2026-10-06-verdicts.json` | `a5a3d5df370128d1a757695e9b8f5e903a369fd5043b2524152d98ef12e52928` |
| LAU | `atelier/docs/live-annotation-use.md` | `13aad926b2ab1aef9db1e3777b89a3f6908d3e34169f057e616964f10cf3c297` |
| FL | `atelier/docs/feedback-ledger.md` | `6d4f3392872378bd2246d403b0a3ab5c745e0f78459a604e6831269b8834d845` |

VV favors P4 structure + P1 flow + P3 timeline; rejects P2's absent flow. LAU demonstrates both
useful live marking and false confidence from non-exercisable scenarios. FL's confirmed-collapse
request is page-local, not a Kernel rule. These are the grounds for the catalogue's owner claims.

## Use cases

Retained artifact `ws-atelier-native-20261006/use-cases/`, dated 2026-10-07, no Git commit or licence.
Each analysis cites its source session lines / briefing sections. This catalogue cites those
analyses, not a claim of independently replaying private sessions or inspecting customer records.

| ID | Artifact-relative path | SHA-256 |
|---|---|---|
| PL | `use-cases/photoquest-pipeline-page.md` | `2531bfdb8b80b813acf6a0f15e26db8d576c488a4cbdf97ea0340539cb7b2fed` |
| ME | `use-cases/me-eval-studio.md` | `a3118ea165ebeb78128d320ee10cdcae5deeaa2fefac33fd49238a704373e01b` |
| WC | `use-cases/world-console-impeccable-review.md` | `bf677ba044f516686ca5ecdcb189b1caaeae554071a867a5f917c0e976b8792b` |
| VR | `use-cases/video-review-studio.md` | `fd81acfe93a2e2b88a825d4538b1c1e4b26bf81c5986be34f2264f003e2aae24` |
| SYN | `use-cases/SYNTHESIS.md` | `34fc6e88b251ffcee7cd6bfc93148b9daca7e7de95e1c8a67718cb79b47b4fbf` |

ME has no built studio. WC judging of the four Impeccable trials was unobserved at its cutoff.
VR has substantial real-use history, but D119's rebuilt side-by-side comparison was not run.
Coverage of every §2 row and its constituent elements is in [COVERAGE.md](COVERAGE.md).

## Prototypes

Retained artifact `ws-atelier-native-20261006/evidence/pipeline-review-prototypes/`; original
session artifacts have no Git revision or licence. These SHA-256s identify inspected primary files.
P1 is a map, P2 a rejected ledger, P3 a timeline, P4 inline Decisions. Agent ranking was not substituted
for the owner's contrasting verdict (PL §2).

| Artifact-relative source | SHA-256 |
|---|---|
| `evidence/pipeline-review-prototypes/p1/build.mjs` | `af429ca4e754f5c9a4d18e4efd673c31b79f79857cf5ad37010169070ee56e4a` |
| `evidence/pipeline-review-prototypes/p3/surface.mjs` | `db3d7d33ed03c89793806d1acd1a458c242b17b808a6414011b32bfa089feaa8` |
| `evidence/pipeline-review-prototypes/p3/surface.css` | `65b4568fcb0cb59371dd17ac354fe898d70ff8b94bb6d12d428e0e83e032ffa6` |
| `evidence/pipeline-review-prototypes/p3/build-data.mjs` | `a30649fe2140e0e427579a8a1215c58f495e5ee8d6cf5ab6c4188dcc115c80d5` |
| `evidence/pipeline-review-prototypes/p4/app.mjs` | `b4325d628c4d688153ce765980edcd5cf4509b1260730629c501fe59f0f8b072` |

## Primary implementations

Repository revisions link to source snapshots; each path below is an inspected file unless marked report-only.

### Effective HTML
<a id="effective-html"></a>

[effective-html source snapshot](https://github.com/plannotator/effective-html/tree/2ac1dfecb0f2474e75260cb6d3c9b9d6d9b5062e) · MIT.
- [`skills/html/SKILL.md`](https://github.com/plannotator/effective-html/blob/2ac1dfecb0f2474e75260cb6d3c9b9d6d9b5062e/skills/html/SKILL.md)
- [`site/public/catalog/featured/workspaces-architecture.html`](https://github.com/plannotator/effective-html/blob/2ac1dfecb0f2474e75260cb6d3c9b9d6d9b5062e/site/public/catalog/featured/workspaces-architecture.html)
- [`examples/release-readiness/wireframe.html`](https://github.com/plannotator/effective-html/blob/2ac1dfecb0f2474e75260cb6d3c9b9d6d9b5062e/examples/release-readiness/wireframe.html)

### agent-html-skills
<a id="agent-html-skills"></a>

[agent-html-skills source snapshot](https://github.com/f-labs-io/agent-html-skills/tree/a9ddeb2a8d73e83ee7278aadf781ead29638562a) · MIT.
- [`plugins/html-skills/skills/html-testing-checklist/SKILL.md`](https://github.com/f-labs-io/agent-html-skills/blob/a9ddeb2a8d73e83ee7278aadf781ead29638562a/plugins/html-skills/skills/html-testing-checklist/SKILL.md)

### AgentClick
<a id="agentclick"></a>

[AgentClick source snapshot](https://github.com/agentlayer-io/AgentClick/tree/7409b3967eeafc603d27cec8615da1998a4a6ef3) · MIT.
- [`skills/clickui-plan/SKILL.md`](https://github.com/agentlayer-io/AgentClick/blob/7409b3967eeafc603d27cec8615da1998a4a6ef3/skills/clickui-plan/SKILL.md)
- [`packages/web/src/pages/PlanPage.tsx`](https://github.com/agentlayer-io/AgentClick/blob/7409b3967eeafc603d27cec8615da1998a4a6ef3/packages/web/src/pages/PlanPage.tsx)

### html-plan
<a id="html-plan"></a>

[claude-plugins-community source snapshot](https://github.com/anthropics/claude-plugins-community/tree/f60f0454df3045f724c43c6346ec80bdcc3472b2) · Root Apache-2.0; plugin metadata says MIT: unresolved conflict, no code copied.
- [`html-plan/skills/html-plan/SKILL.md`](https://github.com/anthropics/claude-plugins-community/blob/f60f0454df3045f724c43c6346ec80bdcc3472b2/html-plan/skills/html-plan/SKILL.md)

### Visual Explainer
<a id="visual-explainer"></a>

[visual-explainer source snapshot](https://github.com/nicobailon/visual-explainer/tree/a0ece8a01dbd1e96533ed3acc372d012dbcc552b) · MIT.
- [`plugins/visual-explainer/SKILL.md`](https://github.com/nicobailon/visual-explainer/blob/a0ece8a01dbd1e96533ed3acc372d012dbcc552b/plugins/visual-explainer/SKILL.md)
- [`plugins/visual-explainer/templates/page.html`](https://github.com/nicobailon/visual-explainer/blob/a0ece8a01dbd1e96533ed3acc372d012dbcc552b/plugins/visual-explainer/templates/page.html)

### Lavish
<a id="lavish"></a>

[lavish-axi source snapshot](https://github.com/kunchenguid/lavish-axi/tree/cd202acec10daa8241de99051b9b563f8ac979ce) · MIT.
- [`src/playbooks.js`](https://github.com/kunchenguid/lavish-axi/blob/cd202acec10daa8241de99051b9b563f8ac979ce/src/playbooks.js)

### pi-artifacts
<a id="pi-artifacts"></a>

[pi-extensions source snapshot](https://github.com/nicknisi/pi-extensions/tree/831da2a679d4251645343e9f4ee23d0e6a850f5d) · MIT.
- [`packages/artifacts/review.ts`](https://github.com/nicknisi/pi-extensions/blob/831da2a679d4251645343e9f4ee23d0e6a850f5d/packages/artifacts/review.ts)

### pi-visual
<a id="pi-visual"></a>

[pi-visual source snapshot](https://github.com/deblasis/pi-visual/tree/31d976bba9ccb1e98d6afdb3395f194f9623e82a) · Package declares MIT; root licence file not found.
- [`spa/app.js`](https://github.com/deblasis/pi-visual/blob/31d976bba9ccb1e98d6afdb3395f194f9623e82a/spa/app.js)

### Plannotator
<a id="plannotator"></a>

[plannotator source snapshot](https://github.com/backnotprop/plannotator/tree/e66af2f1076f25aff3d6e6620c8a1433ac311aee) · MIT / Apache-2.0 dual licence files.
- [`packages/ui/components/DecisionControl.tsx`](https://github.com/backnotprop/plannotator/blob/e66af2f1076f25aff3d6e6620c8a1433ac311aee/packages/ui/components/DecisionControl.tsx)

### shadcn
<a id="shadcn"></a>

[shadcn-ui source snapshot](https://github.com/shadcn-ui/ui/tree/6efecd8fe9aa167886fe2cc0c05c5623a5bb5670) · MIT.
- [`packages/registry/src/registry/schema.ts`](https://github.com/shadcn-ui/ui/blob/6efecd8fe9aa167886fe2cc0c05c5623a5bb5670/packages/registry/src/registry/schema.ts)

### ndrstnd
<a id="ndrstnd"></a>

Installed npm package `ndrstnd@0.1.2`, `dist/web/page.js`, Apache-2.0 (`LICENSE` inspected).
No clone/commit supplied; package version and byte hash identify the actual renderer, not mutable HEAD.
`dist/web/page.js` SHA-256: `25709212262fc10df4b739484eb6aa58eb861ea28dfd43fa30cecedc5bae1198`.

### Review Studio
<a id="review-studio"></a>

[Review Studio source snapshot](https://github.com/tschuehly/PhotoQuest-studio/tree/d95a02a81e3e5fe281d47e165980dc48e1342b57); no root licence found.
- `tools/review-studio.html` · inspected bytes SHA-256 `4e27745c159793b77a550a6de40bc3451708eda83695a7bb5d5eab0a89c15960`.
Referenced server/lifecycle behavior comes from the matching design report and use-case analysis; it was not re-run here.

### World-console
<a id="world-console"></a>

[World-console source snapshot](https://github.com/embabel-worlds/worlds-console/tree/af61a2664c1d2413862e0ede5c23189a99f65410); no root licence found.
- `app/src/reviewBridge.ts` · inspected bytes SHA-256 `50272376524bdccf2f915e57193c00b0755bea736d3127d01d47e968738ec13c`.
- `.review/atelier/build-surface.mjs` · inspected bytes SHA-256 `e26371ed324a7eed89cec7ab0f9e5e18f7a46312f1a28d6c8ff0e9bc41fa662d`.
Referenced server/lifecycle behavior comes from the matching design report and use-case analysis; it was not re-run here.

## Design reports

All 15 reports under `skill-incubator-private/atelier/docs/evidence/design-research-20261006/`
were evaluated: agent-html-skills, agentclick, atelier-history, effective-html, html-plan, lavish,
ndrstnd, pi-artifacts, pi-native, pi-visual, plannotator, review-studio, shadcn, visual-explainer,
world-console-review. Their mechanisms, failures and evidence limits are reconciled in
[EVALUATION.md](EVALUATION.md); claims labelled observed refer to the report's primary evidence.

## Landscape

39 supplied scout notes under `skill-incubator-private/atelier/docs/evidence/tool-landscape-20261006/`,
plus `atelier/docs/tool-landscape-20261006.md`, informed selection. Source URLs/revisions/licence
claims for scout-only tools remain in their notes. No code from those tools is copied here.
A note or a vendor claim is not evidence of owner use; the 39 dispositions are in [EVALUATION.md](EVALUATION.md).
