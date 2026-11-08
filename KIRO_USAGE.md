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

## 2026-11-07 - verifier: a pure verdict module, built test-first from real fixtures

Surface: CLI

Features: spec, pbt

What I asked for: Carry out the `verifier` spec task by task, in order, with a review after each group: tooling, fixtures captured from Grimsheet's real play command, test arbitraries, then `scripts/verifier.mjs` in test-first steps (validation, replay verdict, candidate check, safety net), the full property set, the fixture tests and a checkpoint. No git writes, nothing written in the Grimsheet checkout, and a rule to stop and report instead of narrowing a test input or loosening a check to make a test pass.

What Kiro did: Set up Vitest, fast-check and the typecheck with exact versions. Captured five real play outputs from the local Grimsheet checkout before writing any verifier code (the stored solutions of levels 01, 02 and 03, a truncated list, and a list that starts with an undo that Grimsheet refuses) and checked their shape against the design. Wrote the arbitraries and 20 "breakers": broken inputs that each name the reason code they must produce. Then, for each step, wrote the tests first, watched them fail, and wrote the verifier until they passed: validation and error outcomes, the replay verdict (green, amber, red), the candidate check (the three exploit classes, the rule for accepted edits and undo, the measured-class text in rejections) and a try/catch safety net that turns any internal fault into an `internal_error` value. Wrote the 14 properties (determinism; JSON safety and untouched inputs; colour; refusals; confirmed only when the replay reproduces the class; not won; a copy of the stored solution; edit order; address case; undone and refused edits; bad input; mismatched steps; status change index; the safety net never reached), one deterministic test for each breaker, and 11 fixture tests. Result: 294 tests, typecheck clean.

What changed because of it:
- The real fixtures matched the design, including the refused-step fields (`accepted`, `reason`, `message`, `refusedAt`) and the extra fields the verifier ignores, so no design decision changed because of them. Capturing them first meant the refused-undo case was tested against real output, not a guess.
- Property 7 (a copy of the stored solution is rejected) failed on a stored solution with `minimalInk` 1 and no actions: a copy of it is a valid `free_win` under Requirement 4.2, which contradicts Requirement 3.8. The generator was wrong, not the verifier. Grimsheet's rule is that only an accepted edit spends ink (1 ink per edit; an undo refunds it), so a real stored solution with `minimalInk` above 0 always has an edit. The property's domain was fixed to match (by construction, not by filtering), design.md was updated, and requirements.md and the verifier were left unchanged.
- Property 2 failed once because of a test bug: fast-check builds objects with a null prototype, and the clone used to check that inputs were untouched turned them into plain objects. The verifier had not changed anything. The test now uses a clone that keeps prototypes.
- A mutation check, done in a separate session, found one untested branch: dropping the `minimalInk > 0` guard from the free_win test used for the measured-class text left every test passing. It got a unit test (a no-edit win with `minimalInk` 0 is not named as a free_win).
- One limit worth knowing: an `internal_error` cannot be forced with a non-string level id, because nothing is read before the level id check, so that case is covered by the check itself and not by a forced fault.

## 2026-11-07 - replay-runner: a nightly replay built test-first, then run against the real Grimsheet

Surface: CLI

Features: spec, pbt

What I asked for: Approve the `replay-runner` requirements and design, then carry out its tasks in order with a review after each group: shared test helpers, the pure modules, the file-system modules, the orchestrator, the entry script, the Python launcher, a checkpoint, and last a manual smoke run against the real repository. Same rules as before: failing tests first, stop and report a counterexample instead of narrowing an input or loosening a check, no git writes, nothing written in the Grimsheet checkout, no change to the verifier.

What Kiro did: Captured the real `--list` output of Grimsheet before writing any code (five levels), and built an in-memory fake file system (with a fake clock, a token source and a two-writer scheduler for scripted interleavings) and a fake process starter that replays the stored play fixtures. Then wrote each module after its tests had failed for the right reason: run records and the bounded trend, the index store (30 runs, newest first, counters that only go up, cut-short marking), level list and coverage, the process starter with step limits and tree kill, a lock file with stale takeover, the config merge under a lock, the checkout with its git allow-list and delete checks, the orchestrator `runReplay`, the entry script, and a Python launcher tested with `unittest`. Wrote the 18 properties (tag `pbt`, 200 runs each), including the config merge with two writers under scripted interleavings, and an integration test that runs the real verifier over the real fixtures. At the end: 596 Node tests, 42 Python tests, typecheck clean. Then, after a confirmation, ran `python scripts/replay_cron.py` twice against the real repository.

What changed because of it:
- A flaky test found a real bug. A play that timed out was sometimes reported with exit code 1 and `timedOut: false`: the tree kill makes the child exit, and its close event could win the race against the timeout path. The starter now marks the timeout when the timer fires, so a close caused by our own kill counts as a timeout. A regression test with a spawn spy covers the race.
- Property 15 failed once, and the model in the test was wrong, not the code: the test seeded solution files for all eight pool levels but listed one, so seven files were correctly reported as unlisted. The expected value now counts them. No arbitrary, run count or expectation was narrowed.
- On this Node (v24) starting `npm` through a shell with an argument array prints the DEP0190 deprecation warning. On Windows `npm` is now started as one fixed command string, `npm ci` or `npm run build:play`, taken from an allow-list of exact argument sets; any other npm argument set is refused before anything is started. The design's start rules were updated.
- The checkout path, the delete check and `ensureCheckout` take a `subPath` (default `grimsheet`) so that `exploit-hunt` can keep its own checkout under the same app folder. A sub-path is one or more segments matching `^[a-z0-9][a-z0-9-]*$` joined by a backslash; anything else is refused with a new reason code, `invalid_sub_path`. The replay always uses the default.
- Smoke run against https://github.com/UBayouski/Grimsheet (the first Run cloned it into `%LOCALAPPDATA%`): both Runs ended `complete` in about 7 seconds each, on the commit that `git ls-remote` gave for `main`, with all five levels green, `resultsKey` `ok`, no lock files left, counters 1 and 2, and a trend of two entries. The second Run took the fetch and reset path and read the first launch as `previousLaunch`.
- One gap the smoke run showed: `last-child.log` holds only the final JSON line, because the runner captures npm's output through pipes and discards it. So the log cannot show an npm warning or how long `npm ci` and the build took; the Result_File has no per-stage times either. Nothing was changed inside the task; it is listed as a possible improvement.
- Mistakes worth keeping: one module (`checkout.mjs`) was written before its tests, so it was moved aside, the tests were written and shown to fail, and the file was put back; several of my own tests had wrong expectations (a path separator, an exit code, a missing type) and were fixed in the tests, never in the checks.
