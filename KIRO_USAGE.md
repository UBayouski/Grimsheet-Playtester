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
## 2026-11-07 - exploit-hunt: four checks in a throwaway Crew app before any design
Surface: Crew
Features: agent, spec, power, mcp
What I asked for: Before designing the hunt, run checks C1 to C4 of the `exploit-hunt` requirements in a throwaway Crew app, with me at the keyboard and at most five agent runs: can `allowedTools` (or a narrower rule) remove the approval prompts of an app agent (C1); can a message cron start the app agent unattended (C2); which candidate argument forms reach Node unchanged through the agent shell (C3); and can a script in a skill folder import a module of the app's `scripts/` folder (C4). Then update the requirements from the results.
What Kiro did:
- Built a throwaway app outside every repo with three test agents (one without `allowedTools`, one with `"allowedTools": ["execute_bash"]`, one with a `permissions.rules` allow rule for one script), one skill with an argument-printing script and an import probe, and a message cron that would not fire by itself. Installed it with the Crew CLI; I trusted it in the dashboard.
- Gave me the exact chat text for each run and stopped until I reported back. Read the scripts' own log and the gateway's session log for each run (that one session only) to count approvals and see the full command behind each prompt. Looked up the approval and narrowing options in the Crew docs through the Context7 power.
- Ran four of five agent runs and skipped the fifth at my decision. Wrote `docs/CREW_NOTES.md` section h.10 and evidence E30 to E34 with the user name and home path replaced by `~`. Did not keep my screenshot, because its notifications panel also showed other apps.
- Uninstalled the app and deleted what I approved, then compared the neighbouring folders before and after.
- Updated `.kiro/specs/exploit-hunt/requirements.md` from the results.
What changed because of it:
- C1: `allowedTools` in an app agent has no effect. The gateway writes `"allowedTools": []` into the agent file it generates, and every command and skill load still prompted. A `permissions.rules` block survived into the generated file, but the command it allowed still prompted. No prompt offered "allow for this session". The approval prompt is the only guard, and the only place where an agent's own addition to a command is visible (it appended `; "exit code: $LASTEXITCODE"` once).
- C2: a message cron can start an app agent by name, but nobody approves its first prompt, which was rejected after 192 seconds, and the job still showed OK. So there is no weekly hunt cron: the hunt is on request only, from chat, with every step approved. The documented per-session trust option is recorded as a user choice for the README, untested.
- C3: PowerShell 5.1 drops literal double quotes inside single quotes. The candidate format is now an unquoted list of tokens after `--actions`, with every character of an edit value outside `A-Z a-z 0-9 . _ -` written as `%XX`. The agent could not write a 1000-character argument at all, so candidates stay short.
- C4: the hunt's entry scripts live in the `find-exploits` skill folder and import the app's `scripts/hunt/` modules by relative path; the agent runs them with the folder the skill load reports.
- Credits: 7.86 for the run in which the agent failed to write the long argument, and 0.21, 0.39 and 0.11 for the other three runs, about 8.6 in total. Choosing a cheaper model in the agent file is now a design question.
- Mistakes worth keeping: one long PowerShell write was refused because the tool could not parse it, and was split into smaller writes; one recorded approval count was a miscount that the gateway log corrected; a sub-agent edit was cancelled midway, so the next pass had to check which edits were already in the file before adding the rest.

## 2026-11-08 - exploit-hunt: the verified hunt, built test-first and run once against the real Grimsheet

Surface: CLI

Features: spec, pbt, agent

What I asked for: Approve the `exploit-hunt` requirements and design, then carry out its tasks in order. Each batch was reviewed in a separate session; the decisions below are mine. The checks C1 to C4 that came before the design are in the entry "exploit-hunt: four checks in a throwaway Crew app before any design". Same rules as the earlier specs: failing tests first, stop and report a counterexample instead of narrowing an input or loosening a check, no git writes, nothing written in the Grimsheet checkout.

What Kiro did:
- Took the approved requirements and design as the input. Before any code, made two read-only captures from the local Grimsheet checkout: the `--level-info` answer for `02-the-chaser` (11819 bytes raw) and the extra keys that `play.mjs` accepts in a Candidate_File.
- Built each module after its tests had failed: limits, tokens, args, budget, hunt-record, findings, hunt-store, publish, finish, begin, level-info and info, submit, end, cli, deps, then the four entry scripts, the agent file and the two skills.
- Built a hunt world builder (`tests/helpers/hunt-world.mjs`) over the replay's fake file system and fake processes, so the hunt runs end to end with no network and no real Grimsheet.
- Kept the verifier as the only judge. The hunt computes no class and no outcome; every Finding comes from a verifier result.
- Wrote the 15 properties (tag `pbt`, 100 to 500 runs each).
- Ran the whole flow once against the real Grimsheet on this machine:
  - Begin was ready in 13.3 s.
  - Info returned the reduced level view.
  - The C3-f candidate was rejected as `not_cheaper`.
  - The probe candidates were rejected.
  - A 132-character token reached the script whole.
  - A bad argument was refused.
  - End finished `complete` and the locks were gone.
- Tests: `npm test` in the repo root, run once: 35 files, 1153 tests, all passing. The 19 `tests/hunt.*` files hold 548 of them.

What changed because of it:
- A fixture changed the design. The raw `--level-info` for `02-the-chaser` is 11819 bytes, too large to hand to the agent. Info now returns a reduced view of 686 bytes with 4 cells.
- The raw limit of a candidate is counted in UTF-8 bytes, not characters (`MAX_RAW_BYTES = 40`).
- Property 4 was restated (below).
- The time boundary is explicit: a Hunt of exactly 2400 s is still live.
- What testing caught:
  - The design said a 20-item Findings value is 7670 bytes. Task 9.2 measured it against the real formula; the right figure is 251 + 20 x 386 + 19 = 7990.
  - The worst-case Finding bound held only for ASCII. Task 9.5 found that 40 code points of U+1F600 gave a 2639-byte Finding. Counting the raw limit in UTF-8 bytes fixed it.
  - Property 4 contradicted the Finish step. Seed 648562001 failed in task 16.3, a case seven random runs had missed: a self-finish on `time_budget_spent` refreshes the findings header. The property was restated to say so.
  - The property world first confirmed only 7 steps, because five levels had no stored solution. After seeding solutions it confirmed 44.
  - Info and `resolveActiveHunt` hid internal faults as `no_active_hunt`. They now exit 4 with `hunt_internal_error`.
  - The smoke run showed the command tool remapping exit codes (any non-zero code appeared as 1). The printed `exitStatus` covers this; a check in the same session showed exit 3 where 3 was expected.
  - One Property 4 failure (seed 5) could not be explained. It came from three test suites running at once against the 5 s default timeout. It never repeated in nine parallel runs. Test suites are now run one at a time.

## 2026-11-08 - dashboard: a page that treats every value as untrusted, built test-first

Surface: CLI

Features: spec, steering, pbt

What I asked for: Review the dashboard requirements, approve the design, then carry out the tasks in order. Each batch was reviewed in a separate session; the decisions below are mine. Same rules as the earlier specs: failing tests first, stop and report a counterexample instead of narrowing a generator or loosening a check, no git writes. I asked for a stale warning when the last replay is old.

What Kiro did:
- Reviewed the requirements against the Crew notes and evidence and recorded where the docs and the observed behaviour differ (observed behaviour wins). Wrote a design with 22 decisions.
- Built the pure core test-first: data checks, time, colour, tokens, findings, cards, view model and the poll scheduler. It imports no React and no SDK.
- Wrote the 15 properties (tag `pbt`) over generators for valid Results_Values, Findings_Values, token lists and arbitrary JSON. Invalid values are built by corrupting valid ones.
- Built the controller with a fake clock and a recording fake API that only has `get`, so a test can show the page never writes.
- Built the components and tested them with `react-dom/server`. No test uses a browser or the network.
- Did not import `@kirocrew/app-sdk/ui`. In the spike (E09), a page that imported a name the host did not export failed to link as a whole, and a `typeof` check cannot guard a missing module. A test scans `ui/src/` and `ui/dist/index.mjs` for that specifier.
- Added the stale warning I asked for (36 hours; exactly 36 hours is not stale) with a property test.
- Held the page to React APIs that exist in both React 18 and 19: `useSyncExternalStore`, `useMemo`, `useRef`, `useEffect`, `useState`. No `use()`, no Actions, no `ref` as a prop.
- Wrote the `check-dist` script, which scans the built bundle for the wrong imports, absolute paths, a user name, URLs and a token value.
- Tests: 254 `ui/` tests after the pure core (tasks 1.1 to 13.1) and 439 after the controller, components, entry and build (tasks 14.1 to 18.1), typecheck clean, one 43.9 kB `index.mjs`. These counts are from the commit messages; I did not run the `ui/` tests for this entry.

What changed because of it:
- The root test run now collects only `tests/`, so the two suites do not mix.
- `check-dist` looks for a token value, not the word `token=` (below).
- What testing caught:
  - The generator self-tests caught null-prototype objects and the `{"constructor":{}}` case.
  - The source scan for `.delete(` flagged `Set.delete`, a Set method and not an HTTP call.
  - A component test caught absent findings being counted as dropped.
  - `check-dist` flagged the word `token=` in the page's own redaction code. The first fix, hiding the character, was reverted in favour of a check for a token value: `token=` followed by at least 6 token characters.

## 2026-11-08 - packaging: from app.json to a shipped, measured Crew app

Surface: CLI, Crew

Features: spec, steering, pbt, power

What I asked for: Write the packaging spec (requirements, design, tasks), then build and ship the app: the final `app.json`, the checks, the install steps for a judge, and the first real install, replay, measurement and hunt on this machine, then the README with screenshots and the final corrections. Kiro stopped before every hand step and before every file it would change; I ran the commands that needed the gateway token and pressed every approval myself. Same rules as the earlier specs: failing tests first, stop on a counterexample or a failing check instead of loosening it, no git writes.

What Kiro did, tasks 1 to 12 (the app and its first install):
- Built test-first, each test shown failing before its code: the final `app.json` and a Manifest_Check in the root tests (identity, absent fields, the one `replay` cron with `timeout` equal to the launcher's constant and `timeout_secs` at least 5 more, the two API paths, the bundle present); the committed `ui/dist/index.mjs` with four `.gitignore` lines and a `.gitattributes` line; `npm run test:all`, which runs the six gates one at a time and compares a fresh build of `ui/` with the committed bundle byte for byte (two builds and the commit had the same SHA-256); a route reader that sends only GET to two paths on this machine and removes the token from every text; a masked prompt for the token address; and a size probe that writes one key under the results lock and always removes it.
- What testing caught: a property caught the smallest probe written as 9 bytes when `{"pad":""}` is 10; a test found that `git check-ignore -v` reports a re-included file as a match, so the verdict now comes from `-q`; the bundle check printed the temporary folder's full path, so the build now runs with `--logLevel warn`.
- The CI slip: on the first pull request the Windows runner timed out one measurement property at 5000 ms (about 5.06 s there, 1.6 s here). Fix: an explicit 30-second timeout for that test; the number of runs, the generators and the expectations were not changed.
- First install from a clean clone of the public repository: exit 0, then trust and enable in the dashboard. The page renders from the module's default export with no extra manifest field (Q9 closed), the host's React is 18.3.1, equal to the `ui/` pins (Q10 closed), the job's next run time is in epoch seconds, and the route reader's query form of the token worked on the first try. A developer build in the clone reproduced the committed bundle byte for byte.
- First replay run, started by me on the Schedule page, after the old checkout was moved aside: a fresh clone, `npm ci` and build took 9.1 seconds with a warm npm cache; all five levels green, with end HP on every card.

What Kiro did, tasks 13 to 18:
- Route size (task 13): the first real run printed a limit of 1 KiB, but every step had answered 403 in 1 to 2 ms. Kiro recorded nothing as a limit, found the cause (the pre-check read only `/api/crons`, never the route being measured, and every non-200 counted as a size failure), and fixed it test first: a step is now good, bad (a cut or unequal body, or 413) or blocked (401, 403, any other status, a timeout, a network error), the pre-check and the dry run read the config route before any write, and every step that is not good carries a short reason with the token removed. Requirement 6 and the design were updated in the same change; one property expectation changed and one property was added. After three blocked attempts the rule was clear: one fresh token address per command. The last run wrote nine probes from 16384 bytes to 1 MiB, all returned in full, and restored the file (E40). The results budget stays 65536 bytes.
- Results key sizes (task 14): `latest` is 828 bytes with `endHp` (778 before). One edit of the exploit-hunt design's size figures, its only edit in another spec: full value 10626 bytes, 27022 with findings at their cap, 50 levels (was 51). An old fixed part of 6394 was a 3-byte slip; the result is the same.
- First hunt (task 15): I ran it in a Crew chat in Normal mode. 17 approvals (1 skill load, begin, 5 level reads, 9 submissions, end), 9 of 20 attempts in 81 seconds, no refusal, no denial. The verifier confirmed 3 and rejected 6: a cheaper win on level 03 (1 ink where the stored solution needs 2) and unexpected routes on levels 02 and 05. Kiro recorded level 03 as an open question for the Grimsheet repository and acted on nothing there. The agent's summary is in the evidence word for word, with one line marked as not matching the record.
- Skipped by my choice: a second hunt with Trust (Trust stays untested) and the model measurement (the agent runs on the default model).
- Icon (task 17.0): the page icon `Ghost` showed a default cube. I read the installed Crew UI bundle and found that page icon names are used only for built-in or adopted apps. Kiro checked that reading against the installed files and found that `iconPath` is read from the app's install folder, so the value is `ui/icon.svg`, not the `icon.svg` I had proposed. Spec first (no page icon, a new requirement for `iconPath`), then the manifest check test first (14 of 58 failing), then a hand-drawn ghost of 376 bytes in Grimsheet's colours. A test that expected one `.gitattributes` line was changed with my approval. My first commit missed five files, `ui/icon.svg` among them; the second commit added them. After a Sync the stored manifest kept `iconPath` and the sidebar and the Details page showed the ghost (E43).
- README and screenshots (tasks 17.1, 17.2): an image-link test came first and passed with no links. The README now gives the measured numbers instead of "not measured" and "roughly 30", the hunt result, and the icon rule. I took the screenshots; Kiro measured every crop box from the pixels, showed it to me, and cropped and scaled only after my yes. The findings shot shows only level 02 so that the winning edit of level 03 stays hidden, and the Details shot leaves the Details card out for width.
- Corrections (task 18.2): seven edits to the brief and the steering that a measurement had shown to be wrong or out of date, each approved: the route size, no `ui/` build before install, the trust prompt, the fallback install path, how the screenshots were taken, and the answered hunt gaps G1 and G2.
- Final gates (task 18): root 1359 tests, 42 launcher tests, 439 `ui/` tests, both typechecks clean, and `npm run test:all` passed all six steps. The final read-through found no user name, home path, token or other tool's name in the README, `app.json` or the packaging scripts.

What changed because of it:
- A wrong size limit never reached the notes: the first real run caught a refusal counted as a size failure, and the fix separates "too large" from "no answer about size".
- The 65536-byte budget now rests on a measurement, and the level limit with the hunt at its cap is 50.
- A lucide icon name can never show for an installed app; the app ships its own image.
- Open: the clipboard check, the approval card options, the credits of a hunt and the dark theme were not recorded; the empty `spike\ui` folder is removed after a restart.
