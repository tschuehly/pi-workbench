# Triage of the "Interesting Agentic" Telegram export (2026-11-25)

Source: Thomas's Telegram channel export, 235 messages from 2026-02-23 to 2026-11-24 (copy in
`~/.pi-workbench/scratch/research-backlog-20261125/`). 125 distinct X posts were read through the
fxtwitter API (2 unreadable: one suspended account, one server error). Titled blog, GitHub and paper
links were judged by title and source only and were **not opened**.

Verdicts: **analyze** = still relevant, worth a real read against Pi Workbench or Thomas's projects.
Everything not listed is stale (early-2026 Claude Code tips, Ralph-loop explainers, Opus 4.x
specifics), already covered by Pi Workbench, or off topic (design prompts, Gemini animation, routers,
marketing).

## 1. Fewer review cycles and deterministic guardrails

Feeds the todo items "Challenge-mode review" and "deterministic checks in the agent loop".

- **poteto (Grok Bot team): how he shipped 2,500 PRs in a month** —
  [talk post](https://x.com/poteto/status/2102050467505430555), [AIE talk](https://youtu.be/O_zcc6Xl12g),
  [Matt Pocock's summary](https://x.com/mattpocockuk/status/2103431302527508886). Lock agents into
  abstractions they cannot misuse, enforce them with lint rules, build verification infrastructure so
  agents bring evidence. Strongest single source here.
- **"pstack" / poteto-mode principles** — [principles post](https://x.com/poteto/status/2110496830429839869),
  [repo-hardening prompt](https://x.com/RayFernando1337/status/2124222002076733869): mine the git log,
  past fixes and review comments for repeated mistakes, then make each impossible (architecture, then
  types, then a lint whose error names the fix, then a test). Agents name the principle behind each
  decision. Directly applicable to review findings that recur.
- **deslop-please** — [post](https://x.com/MOVNTDQ/status/2124947434078155043): a linter for codebase
  structure problems, built after poteto's talk; claims fewer tokens per task.
- **Turn AGENTS.md rules into automated checks** — [prompt](https://x.com/matthieunapoli/status/2024507469394039057):
  every rule that becomes a check also leaves startup context.
- **CODE_STANDARDS.md for a reviewer, not the implementer** — [Matt Pocock](https://x.com/mattpocockuk/status/2043320548776681627):
  save tokens during implementation, spend them during review.
- **Self-improving code review agent** — [Zach Lloyd](https://x.com/zachlloydtweets/status/2077428025474355521).
- **Stop being the code-review bottleneck** — [PostHog](https://x.com/posthog/status/2075645235724767739).
- **Code Factory** (risk-aware checks before merge, review agent, machine-checkable evidence) —
  [Ryan Carson](https://x.com/ryancarson/status/2023452909883609111).
- **Semi-formal reasoning checklist for checking patches (Meta, 93%)** —
  [post](https://x.com/rohanpaul_ai/status/2029091029400600933): a reviewer template that forces a
  traced code path and evidence per claim.
- **/ship-check: six cleanup passes, each an isolated subagent, one confirmation at the end** —
  [post](https://x.com/Shpigford/status/2077344419670364261).
- **Replace inference steps with deterministic ones over time** —
  [badlogic (Pi author)](https://x.com/badlogicgames/status/2078833720203808922); matches the
  Workbench invariant "models propose, deterministic modules own".
- Titled links, not opened: [hamelsmu/claude-review-loop](https://github.com/hamelsmu/claude-review-loop),
  [kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes),
  [basecamp/gh-signoff](https://github.com/basecamp/gh-signoff) (local CI sign-off),
  [Spec-Driven Development Needs an Exit Strategy](https://www.the-main-thread.com/p/spec-driven-development-exit-strategy),
  [Reddit: two closing questions per session](https://www.reddit.com/r/ClaudeAI/comments/1vbkq6o/i_close_every_claude_session_with_the_same_two/).

## 2. Learning from past sessions, skills and context

- **backpass: a "backward pass" over many past transcripts to fix skills and memory** —
  [post](https://x.com/kunchenguid/status/2095000784832434230), [repo](https://github.com/kunchenguid/backpass).
  Pi Workbench already has session-log extraction (`tools/session-logs/`); this is the missing loop.
- **Cutting AGENTS.md by ~50% while improving quality** — [case study](https://x.com/kunchenguid/status/2104241432467067343).
  Relevant to the startup-context work.
- **Reasoning effort is a ceiling, not a floor** — [kunchenguid](https://x.com/kunchenguid/status/2103325882752598078),
  [Anthropic: spending your effort](https://x.com/trq212/status/2103576349499855160). Input for model
  routing and the model-role evaluation.
- **Anthropic on harness design and skills** — [Seeing like an agent](https://x.com/trq212/status/2027463795355095314),
  [How we use skills](https://x.com/trq212/status/2033949937936085378).
- **Skill quality and evals** — [Dark Arts of Skill Engineering](https://x.com/pbakaus/status/2077114326985687525),
  [Eval Engineering skill](https://x.com/Vtrivedy10/status/2079976006644072796),
  [ai-evals-course/evals-skills](https://github.com/ai-evals-course/evals-skills).
- **Ponytail measured by JetBrains** — [Does it really cut tokens](https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/).
  Read before the ponytail A/B todo item.
- **Dynamic context injection in skills** — [theo](https://x.com/theo/status/2043103001121034581); check
  whether Pi skills support it.
- Titled, not opened: [Lilian Weng on harnesses](https://lilianweng.github.io/posts/2026-07-04-harness/),
  [Inside the harness](https://nicknisi.com/posts/inside-the-harness/),
  [HumanLayer advanced context engineering](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/wsff.md),
  [Codified Context paper](https://arxiv.org/abs/2602.20478), [arXiv 2608.27454](https://arxiv.org/abs/2608.27454),
  [Spotify Portal: −90% Claude Code tokens](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90),
  [OpenClaw CI cost reduction](https://vincent.build/openclaw-ci-cost-reduction/).

## 3. Pi ecosystem, orchestration, remote agents

- **"Catch me up since my last message"** — [poteto's /bro](https://x.com/plannotator/status/2109032429667135536),
  [plannotator inbox](https://plannotator.ai/inbox/). Same as Thomas's own idea in the export
  (2026-11-24): Pi Workbench remembers when he last looked at a Chat and summarizes what happened since,
  ideally in the Cockpit.
- **A custom Pi subagent manager** — [Arnav Gupta](https://x.com/championswimmer/status/2107883453811233185); compare with ours.
- **Pi distros / pi-factory** — [onusoz](https://x.com/onusoz/status/2103022805201670200): a lean Pi
  build without the usual skills and AGENTS.md; relevant to child startup cost.
- **Remote agents** — [remote_pi](https://github.com/jacobaraujo7/remote_pi), [Lucas Meijer's
  cloud-agent tool](https://x.com/lucasmeijer/status/2108248641605706006). Input for the Hetzner todo item.
- **Starter set of Pi packages** — [Voxyz](https://x.com/Voxyz_ai/status/2089324197981950408); plus
  titled [Kun's Pi agent config](https://blog.kunchenguid.com/p/kuns-pi-agent-config),
  [pi-dynamic-workflows](https://github.com/QuintinShaw/pi-dynamic-workflows). Input for the Pi-packages todo item.
- **Agents file feedback on their own tools** — [submit_feedback MCP tool](https://x.com/matt_ambrogi/status/2122722680784687600).
- **Docs kept current by hooks** — [Geoffrey Huntley on HLDDs](https://x.com/GeoffreyHuntley/status/2103421056765853984).
- **Review UX for big diffs** — [semantic-review](https://github.com/mikker/semantic-review) (HTML story
  of a change, comments pasted back), [calldiff](https://x.com/tanishqk/status/2085884731300946163).
  Both overlap with Atelier Pages; worth a look for the review step.
- **Cheaper browser verification** — [Playwright CLI + Jev vs Playwright MCP](https://x.com/filip_hric/status/2103450014143947164).

## 4. Research agent

- **Smaug: X bookmarks filed into a Markdown knowledge base, linked to current work** —
  [post](https://x.com/alexhillman/status/2103535209408774201), [repo](https://github.com/alexknowshtml/smaug).
  Closest existing tool to the planned research agent.
- **Nightly job that picks one action item** — [Ryan Carson](https://x.com/ryancarson/status/2013335112713109972);
  the same shape as the planned weekly research task.
- **Debating research subagents** — [weaponized-curiosity](https://github.com/ayushrajsinghparihar/weaponized-curiosity).

## 5. Spring and JVM (input for the perfect-Spring-Boot skill)

- [sivalabs: Spring Boot skills from his architecture patterns](https://x.com/sivalabs/status/2006937997028241806),
  [spring-modular-monolith](https://github.com/sivaprasadreddy/spring-modular-monolith),
  [spring-modulith-workshop](https://github.com/sivaprasadreddy/spring-modulith-workshop), with
  [Matt Pocock's improve-codebase-architecture skill](https://github.com/mattpocock/skills/blob/main/improve-codebase-architecture/SKILL.md).
- [hannobr/spring-boot-agent-harness](https://github.com/hannobr/spring-boot-agent-harness),
  [decebals/claude-code-java](https://github.com/decebals/claude-code-java),
  [jdubois boot-ui vertical-PR agent](https://github.com/jdubois/boot-ui/blob/main/.github%2Fagents%2Fbootui-vertical-pr.agent.md),
  [Supabase Postgres best practices for agents](https://supabase.com/blog/postgres-best-practices-for-ai-agents),
  [jOOQ MCP server](https://jooq-mcp.martinelli.ch/),
  [Why senior Java developers use AI tools wrong](https://www.the-main-thread.com/p/ai-coding-tools-java-compounding-engineering).

## Not carried forward

- Already in Pi Workbench: grill-me / interview-before-plan (Alignment and `ask_user`), handoff
  commands (Workstream checkpoints), librarian/research subagents, independent multi-model review,
  ELI5 / HTML plans / in-app mocks (Atelier Pages), pi-intercom (chat-to-chat messages), humanizer
  (write-for-humans), "audit the choices, not the code" (Alignment).
- Thomas's own notes: the Big Sky Dev Conf talk transcript (2026-07-23) and talk-feedback notes
  (2026-03-24) are talk material, not research items. "Blogposts get stale. Auto updating?" and
  "custom skills wrapping tools" are fragments without enough context to act on.
