# Kiro Usage Log

A running log of how Kiro was used to build Grimsheet Playtester, one entry per session. This becomes the Kiroween write-up.

Judges ask about: surfaces (IDE / CLI / Web / Crew), custom agents, hooks, specs vs vibe coding, steering, MCP, property-based testing, powers. Tag each entry with the relevant ones.

## Entry format

## YYYY-MM-DD — short title

Surface: IDE | CLI | Web | Crew | none

Features: spec | steering | hook | mcp | agent | pbt | power | vibe

What I asked for:

What Kiro did:

What changed because of it (time saved, bug caught, decision made):

## 2026-11-07 — Research Kiro Crew app docs with Context7

Surface: CLI

Features: power, mcp

What I asked for: Activate the Context7 power, look up the current Kiro Crew app and @kirocrew/app-sdk docs (manifest, agents, skills, crons, run environment, UI, install and test), and record the answers with sources. Also add LICENSE, .gitignore and this log.

What Kiro did: Activated the Context7 power and confirmed its resolve-library-id and query-docs tools were connected. Lookups made:
- resolve "Kiro Crew" -> `/kirodotdev/kirocrew` (chosen); also listed `/kirodotdev/kiro`, `/websites/kiro_dev_cli`, `/websites/kiro_dev`.
- resolve "@kirocrew/app-sdk" -> `/websites/deepwiki_kirodotdev_kirocrew` (listed, not queried).
- `/kirodotdev/kirocrew`: app.json manifest fields and declaring agents, skills, crons, UI.
- `/kirodotdev/kirocrew`: agent file format and location, tying agents to skills.
- `/kirodotdev/kirocrew`: skills SKILL.md format and location.
- `/kirodotdev/kirocrew`: cron schedule syntax, what a run can do, where output goes.
- `/kirodotdev/kirocrew`: install and test an app locally with the CLI.
- `/kirodotdev/kirocrew`: run sandbox, shell, network, Node, git clone, file writes.
- `/kirodotdev/kirocrew`: app-sdk UI data access (api, events, storage), build and serve.
- `/kirodotdev/kirocrew`: installing from a GitHub repo; app storage permission; SDK version and Vite build; agents field and skill mapping; Node version; third-party app trust.
All answers in docs/CREW_NOTES.md came from Context7. None came from kiro.dev; it was not read. Gaps (SDK version, UI reading cron output, direct git-URL install, agent network and clone rules) are marked "not documented".

What changed because of it: The notes show the docs use the `kirocrew` CLI rather than `kiro-cli`, that `@kirocrew/app-sdk` is provided by the host and must not be installed from npm, and that Node is not guaranteed inside the run environment. These shape the plan for the app.

## 2026-11-07 — Generate steering docs from the brief

Surface: IDE

Features: steering

What I asked for: Generate steering docs from docs/BRIEF.md and docs/CREW_NOTES.md. docs/BRIEF.md was drafted outside Kiro from docs/CREW_NOTES.md and approved by me. The steering was generated from it in this session.

What Kiro did: Created five files in `.kiro/steering/`:
- `product.md` (always included)
- `tech.md` (always included)
- `structure.md` (always included)
- `crew-app.md` (fileMatch on `app.json`, `agents/**`, `skills/**`)
- `dashboard.md` (fileMatch on `ui/**`)

What changed because of it: Crew facts and their "not documented" markers now load into context whenever the manifest, agents, skills or UI are touched, so gaps are not filled from memory.

## 2026-11-07 — Review and revise crew-spike requirements

Surface: IDE

Features: spec

What I asked for: Review the crew-spike requirements and revise them before design.

What Kiro did: Applied six changes to the requirements: (1) all spike code lives in `spike/` and is deleted whole; (2) the probe is a Node script (`spike/scripts/probe.mjs`) run by a cron command, not the Python `script` form; (3) the trust step for third-party apps comes before enable; (4) the scheduled run uses a short `every` interval and the cron is disabled again afterwards; (5) at most five agent runs in total, with the `permissions.network` comparison only if the first run is blocked; (6) dashboard checks use the Playwright MCP server, with screenshots under `spike/` and the token URL never recorded. Added `.kiro/settings/mcp.json` with the Playwright server.

What changed because of it: The requirements were reviewed and revised before any design was written, which bounds credit use and keeps the spike self-contained.

## 2026-11-07 — Design and task list for crew-spike

Surface: IDE

Features: spec

What I asked for: Write the crew-spike design from the approved requirements, then the task list. At design review I asked for the automated tests to be removed from the spike.

What Kiro did: Wrote the design (spike layout, exact `app.json`, probe report format, probe order, UI read routes, three `skill://` setups, five-run agent budget, evidence capture, deletion steps) with 23 assumptions marked "Assumption (to test)". After review it removed `spike/dev`, the Correctness Properties section and the automated part of the Testing Strategy, and wrote the task list in the design's order of work with "(you)" marks on the steps that need me.

What changed because of it: The design dropped its automated tests at review. The spike code is throwaway and is deleted whole, so unit and property tests would test code that does not survive. The index-bound, round-trip and verdict properties belong to the verifier and replay-runner specs (BRIEF section 11), where the code is kept. The spike is checked by observation and recorded evidence, plus `tsc --noEmit` for `ui/`.
