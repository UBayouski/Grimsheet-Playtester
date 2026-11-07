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

## 2026-11-07 — crew-spike plan change: command cron to script cron

Surface: IDE, Crew

Features: spec, mcp

What I asked for: After the spike showed the cron missing from the Schedule page, find out why. Then switch the Probe_Cron to a Python script cron that launches the Node probe, update requirements, design and tasks first, and run task 5.

What Kiro did: Found in the gateway and security logs that Crew 0.12.0 on Windows rejects every `command` cron for lack of a POSIX shell (E18). Revised requirement 1.1 and added 4.9 and 4.10. Updated the design: `app.json` cron, launcher section, order of work, assumptions A-01, A-04, A-05, A-09 and A-23 re-scoped, and new A-24 to A-26. Rewrote task 5. Wrote `spike/scripts/probe_cron.py` (standard library only) and pushed it with the dashboard Sync button, so no reinstall or re-trust was needed. Ran task 5 through the Schedule page with Playwright.

What changed because of it: The replay job cannot be a `command` cron on a Windows gateway; the Brief now says so. On this machine a script cron works:
- It runs as a child of the gateway, and node, npm and git are on its PATH.
- The manifest `env` does not reach it.
- The run limit is `timeout`, not `timeout_secs`; `timeout_secs` alone left the 30 s default in place, and must be at least `timeout + 5`.
- The dashboard stayed responsive during runs.

## 2026-11-07 - crew-spike: the Crew spike, from install to deletion

Surface: IDE, CLI, Crew

Features: spec, steering, agent, mcp, power, vibe

What I asked for: Run the throwaway `crew-spike` spec: build a small Crew app, install it on Windows, and answer the three open questions in `docs/BRIEF.md` section 6 by observation (how the page reads a file a cron wrote, whether a cron or an agent run can reach the network, clone, build and find Node, and how a skill reaches an agent). Then write the answers into the Notes, the Brief and the steering, and delete the spike.

What Kiro did:
- Read the Crew docs through the Context7 power and recorded what they did not say. Wrote the spike app (a Node probe, a Python cron launcher, a probe agent and skill, a React page) and installed it with the Crew CLI; the user trusted it in the dashboard.
- Drove the dashboard with the Playwright MCP: Library, Schedule, the probe page, the Sync button, the cron's Run, and read the gateway and security logs to explain each result.
- Ran the cron by hand and on a schedule, tested the timeout fields, the results route and freshness, and repaired two failed Syncs (a run held read-only git files while a Sync moved `data\`).
- Ran five agent runs out of five (A1 to A5), after three false starts that ran nothing and are not counted: A1 had no tools, A4 added `"tools": ["execute_bash"]` and passed every check, A2 and A3 and A5 tested three `skill://` forms. About 1.5 credits in total.
- Wrote `docs/CREW_NOTES.md` section h (h.1 to h.9, A-01 to A-26), updated `BRIEF.md` and five steering files, copied the evidence to `docs/evidence/` without the Windows user name and without the screenshots that showed a local path, then uninstalled the app and deleted its data, the agent's clone, the generated files and `spike/`.

What changed because of it:
- The replay job is a Python `script` cron that launches Node, not a `command` cron (a Windows gateway rejects those); the limit is `timeout`, and `timeout_secs` must be at least `timeout + 5`.
- The Grimsheet clone lives outside the app folder (`%LOCALAPPDATA%`), because a Sync moved `data\` and failed twice on a run's read-only git files.
- Results go into a key in `data\config.json`, read with `GET /api/apps/<app>/config`; the page never PUTs it (a PUT replaces the whole object) and polls, because no event marks a finished run.
- The agent declares `"tools": ["execute_bash"]`, uses the `skill://~/.kiro/crew/apps/<app>/skills/*/SKILL.md` glob (project-relative globs are not loaded on Windows), and its skills follow shell-agnostic rules because its shell is PowerShell 5.1.
- The README will say only Windows was tested. The spec plan changed for `replay-runner`, `exploit-hunt`, `dashboard` and `packaging`.
- Mistakes worth keeping: three of the first four agent chats were spent before checking the gateway log, which names the missing `tools` list at once; a Sync was started with a leftover temp folder present; two evidence files were first written to the wrong folder and moved. At the end an empty `spike\ui` folder could not be deleted because another process (probably an open editor) held it.