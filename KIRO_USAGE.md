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
