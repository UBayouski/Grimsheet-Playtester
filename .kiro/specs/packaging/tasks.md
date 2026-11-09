# Implementation Plan: packaging

## Overview

This plan builds the packaging parts that the design states: the checks that run in the root `npm test` (Manifest_Check, README lint, repo-file checks), the combined command `test:all`, the hand-step programs under `scripts/packaging/` (route reader, secret prompt, probe writer, measurement), and the files Crew and git read (`app.json`, `.gitignore`, `.gitattributes`, `README.md`). It then lists the Hand_Run_Steps in the order of the design: first install, first replay run, config route size, the sizes of the Results_Key, first agent-run hunt, the optional model plan. The last task is the `KIRO_USAGE.md` entry.

Order of work: preparation (the build reproducibility check and the token form, both read-only or temp-folder only), then the repo files, the Manifest_Check and `app.json`, the route reader, the probe writer, the measurement, `read-route`, `test:all`, the README lint and the README, a checkpoint, then the hand steps (each starts with a STOP that asks the user), then the final README facts, a final checkpoint, and the usage entry.

Rules that apply to every task:
- Work happens in the files a task names. The `ui/` source, `agents/playtester.json`, `tests/hunt.texts.test.mjs`, `docs/BRIEF.md` and the steering files are **not** edited by any task, except the tasks that say "only after the user approves" (16.4, 16.6, 11.5 for the `ui/` React pins, 18.2). If a task finds that another file must change, STOP and ask.
- Property tests use `fast-check` with `numRuns` of at least 100 and a tag `// Feature: packaging, Property N: <title>`. If a property fails, STOP and report the counterexample. Never narrow an arbitrary, never add `fc.pre`, never lower `numRuns`, never loosen an expectation to make a test pass. Valid inputs are built by construction.
- If a task finds that the design cannot be implemented as written, or that a requirement and the design contradict, STOP and report. Do not change the design or work around it.
- Test files that need a folder use `fs.mkdtemp` under `os.tmpdir()` and remove only the folder they created. Fixtures hold no absolute path, user name or token. No task deletes anything it did not create.
- No agent task runs a git write command (no add, commit, push, branch, tag). Where a commit is needed (before task 11), the user makes it. Read-only git commands (`status`, `check-ignore`, `check-attr`, `clone` of a local path into a new folder) are allowed where a task names them.
- The token of the gateway is never written to a file, a log, the shell history or any record, and is never seen by the agent: programs that need it prompt the user at a masked prompt in the user's own terminal (design "Route access and the token"). The agent never runs `kirocrew token`.
- Suites run one at a time, never in parallel. Commands are PowerShell-safe: one command per call, no `&&`, no inline JSON. Files are written without a BOM. Paths in records are shown as `~`, `%USERPROFILE%` or `%LOCALAPPDATA%`.
- A task that writes failing tests runs only that file with `npx vitest --run <file>` in the repository root and expects failures for the stated reason. The task that follows runs the same command and expects a pass. `npm run typecheck` is run after each implementation task, not after a failing-test task.
- No file names a tool or assistant other than Kiro. `kirocrew` calls, builds, installs and any step that touches the real gateway, the real network or the user's machine state are made only inside the hand-step tasks (1.1, 1.2 and 11 to 16), each after its STOP.

## Tasks

- [x] 1. Preparation (read only or temp folders only)
  - [x] 1.1 Check that the `ui/` build is reproducible (asks the user)
    - **STOP and ask the user** before the first command. Say which commands will run, that they write only two new folders under `%TEMP%` (`pkg-build-a`, `pkg-build-b`) and read `ui/dist/index.mjs`, and that nothing in `ui/` changes.
    - After a yes, from `ui/`: `Test-Path node_modules\vite\bin\vite.js`; then `node node_modules\vite\bin\vite.js build --outDir "$env:TEMP\pkg-build-a" --emptyOutDir`; then the same into `pkg-build-b`; then `Get-FileHash` of `pkg-build-a\index.mjs`, `pkg-build-b\index.mjs` and `ui\dist\index.mjs`. Ask before removing the two temp folders (the agent created them).
    - Acceptance: the three hashes are equal. Then the design's byte comparison stays. IF `pkg-build-a` and `pkg-build-b` are equal and `ui\dist\index.mjs` differs, the committed copy is stale: report, and rebuild with `npm run build` in `ui/` only after the user approves (it rewrites only `ui/dist`, which is build output). IF the two temp builds differ, compare after turning CRLF into LF; IF they still differ, STOP and report the first differing byte offset (design "Stale-bundle check").
    - Record the result as a line in the Notes list at the end of this file (no repo file is changed otherwise).
    - _Requirements: 8.2; design "Stale-bundle check", D5_

  - [x] 1.2 Settle D6: how an API request carries the token (asks the user)
    - **STOP and ask the user** before running anything. The command is `& "$env:ProgramFiles\KiroCrew\resources\backend-dist\kirocrew-backend\bin\kirocrew.cmd" token --help`, which prints help text only, and the agent does not run `kirocrew token` itself. Also query Kiro's documentation power for the Crew pages about the gateway API and tokens (read only).
    - Decide which of two forms the route reader uses: `bearer` (header) or `query`. Write the finding as a new section "i. Packaging: how an API request carries the token" in `docs/CREW_NOTES.md`, with "Observed" or "Docs say" as basis and "not documented" where the pages are silent. The section holds no token, no address with a token, and no user name.
    - IF neither form is documented or one cannot be chosen, keep both behind the constant `TOKEN_FORM` (default `bearer`), say so in the section, and mark the conditional task 6.3 (`--manual-read`) as needed.
    - Acceptance: the Notes_File section exists and names the chosen form (or "both, undecided"); the choice is reported to the user.
    - _Requirements: 6.13; design "Route access and the token", D6_

- [x] 2. Repo files for the committed bundle
  - [x] 2.1 Write the repo-file tests (expected to fail)
    - Create `tests/packaging.repo-files.test.mjs`. It runs `git check-ignore -v -- <path>` and `git check-attr text -- <path>` with `spawnSync` and fixed argument arrays (read only, no network) and expects: `ui/dist/index.mjs` is not ignored (exit code 1); `ui/dist/other.js` and `ui/dist/maps/a.map` are ignored by the rule `ui/dist/*` (exit 0); `ui/other/dist/x.js` and `dist/x.js` are ignored by the rule `dist/` (exit 0); `node_modules/x`, `data/x` and `coverage/x` stay ignored; `ui/dist/index.mjs` has `text: unset`. It also reads `.gitignore` and expects the four lines in the order `dist/`, `!ui/dist/`, `ui/dist/*`, `!ui/dist/index.mjs`.
    - Command: `npx vitest --run tests/packaging.repo-files.test.mjs`. Expected: failures, because `ui/dist/index.mjs` is ignored today and `.gitattributes` does not exist.
    - _Requirements: 8.2, 14.5; design ".gitignore", ".gitattributes"_

  - [x] 2.2 Change `.gitignore` and add `.gitattributes`
    - In `.gitignore`, replace the line `dist/` with the four lines of the design, in order; leave every other line unchanged. Create `.gitattributes` with the single line `ui/dist/index.mjs -text`. Both files are written without a BOM.
    - Command: `npx vitest --run tests/packaging.repo-files.test.mjs`. Expected: passes. Then the read-only commands of the design, shown to the user: `git check-ignore -q ui/dist/index.mjs` (no output, exit 1; with `-v` git prints the negated rule and exits 0), `git check-ignore -v ui/dist/other.js`, `git check-attr text -- ui/dist/index.mjs`, `git status --porcelain ui/dist` (expected `?? ui/dist/`). Then `npm run typecheck`.
    - Acceptance: all pass; the command output is reported. The user adds and commits the bundle later (task 10.3).
    - _Requirements: 8.2, 14.5_

- [x] 3. Manifest_Check and `app.json`
  - [x] 3.1 Write the Manifest_Check tests (expected to fail)
    - Create `tests/packaging.manifest.test.mjs` with: a valid-manifest builder (design "The manifest"); Property 1 (valid manifests pass), Property 2 (`timeout` differs from the launcher constant), Property 3 (short `timeout_secs`), Property 4 (extra cron, including a cron named `hunt`), Property 5 (forbidden text and a BOM); example tests for each failing rule of R5.7 (a `timeout` that differs, a `timeout_secs` of `timeout` plus 4, an extra `hunt` cron) and for each row of the rule table (absent fields, agents and skills, permissions, `ui`, `bundle` missing or empty); and one test that reads the real `app.json`, `scripts/replay_cron.py`, `agents/playtester.json`, both skill folders and `ui/dist/index.mjs` and expects no problem.
    - Command: `npx vitest --run tests/packaging.manifest.test.mjs`. Expected: failures, because `scripts/packaging/manifest-check.mjs` does not exist (and `app.json` does not exist). Show the failing run (R5.6).
    - _Requirements: 1.1 to 1.7, 2.1 to 2.5, 3.1 to 3.5, 4.1 to 4.9, 5.1 to 5.8_

  - [x] 3.2 Implement `checkManifest`
    - Create `scripts/packaging/manifest-check.mjs` (`// @ts-check`, JSDoc types, no import except `node:` modules). Export `checkManifest({ manifestBytes, launcherText, agentText, skillDirs, bundleBytes })` returning a list of `{ rule, message }` with the rules `bom`, `json`, `identity`, `absent`, `agents-skills`, `crons`, `permissions`, `ui`, `timeout`, `timeout-secs`, `text`, `bundle` of the design.
    - Command: `npx vitest --run tests/packaging.manifest.test.mjs`. Expected: all pure tests and properties pass; the real-file test still fails only because `app.json` does not exist. Then `npm run typecheck`.
    - _Requirements: 5.1 to 5.5, 5.8; design "Manifest_Check"_

  - [x] 3.3 Write `app.json`
    - Write `app.json` at the repo root with exactly the content of the design (UTF-8, no BOM, two-space indent, trailing newline). No `resources`, `setup`, `mcpServers`, `sops`, `storage`, `events`, `network`, `mountFunction` or `entryPoint`.
    - Command: `npx vitest --run tests/packaging.manifest.test.mjs`. Expected: passes, including the real-file test. Then `npm test` (one suite at a time) and `npm run typecheck`.
    - Acceptance: the file passes; the `timeout` equals `CRON_TIMEOUT` of the launcher (900) and `timeout_secs` is 905.
    - _Requirements: 1.1 to 1.7, 2.1, 2.2, 3.1 to 3.4, 4.1 to 4.9_

- [x] 4. Route reader and secret prompt
  - [x] 4.1 Write the fakes and the route-reader tests (expected to fail)
    - Create `tests/helpers/packaging-fakes.mjs` (a fake `fetch` that records every call, with settable behaviours: 200 with a body, 401 whose body echoes the token, a thrown error whose message holds the token, a timeout, a truncated body, a non-JSON body; and a fake runner for `test:all`). Create `tests/packaging.route-reader.test.mjs` with: Property 9 for the reader (the token and its URL-encoded form never appear in a returned result, a message or any recorded write, for tokens of 8 to 64 printable characters including regular-expression characters, `%` and `+`); Property 12 (every path outside the two allowed paths is refused with no request made; every request is `GET`; `redirect` is `error`); example tests for both `TOKEN_FORM` values, the 15-second limit, `parseAccessInput` (a printed address gives origin and token; a bare token gives only a token; an address with no `token=` is refused), and the prompts (the masked prompt echoes nothing to the output stream and returns the answer; an empty answer is refused; the visible origin prompt refuses an answer that contains `token=` and never echoes it).
    - Command: `npx vitest --run tests/packaging.route-reader.test.mjs`. Expected: failures, because the modules do not exist.
    - _Requirements: 6.2, 6.13, 9.4; design "Route access and the token"; Properties 9, 12_

  - [x] 4.2 Implement the reader and the prompt
    - Create `scripts/packaging/route-reader.mjs` (`readRoute({ fetch, origin, token, path, timeoutMs, form })`, `scrub(text, token)`, the allow list of two paths, `TOKEN_FORM` with default `query` as decided in task 1.2) and `scripts/packaging/secret-prompt.mjs` (`parseAccessInput`, `promptVisible`, `promptSecret` with a muted output stream). Neither writes a file; neither prints a body.
    - Command: `npx vitest --run tests/packaging.route-reader.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 6.13, 9.4; design "Route access and the token"_

- [x] 5. Probe writer
  - [x] 5.1 Write the probe tests (expected to fail)
    - Create `tests/packaging.config-probe.test.mjs` using `makeMemFs`, `makeFakeClock`, `makeSleep`, `makeTokenSource` of `tests/helpers/fake-fs.mjs`. Property 6 (round trip: for all JSON-safe config objects without `packagingProbe` and all sizes from 10 to 200000, `writeProbe` then `removeProbe` restores the parsed file, leaves no lock file and no temp file, and no other key changes at any moment; also when an error is thrown between the two and the `finally` block runs), Property 7 (the UTF-8 length of `JSON.stringify(buildProbe(n))` equals `n` for `n` from 10 to 2 MiB), and an idempotence test (the same size written twice gives the same file). Example tests: a lock held by another owner makes the write wait and then end with `lock_timeout` and no write; a `config.json` that is not an object stops the run; the probe key is never `playtesterResults`.
    - Command: `npx vitest --run tests/packaging.config-probe.test.mjs`. Expected: failures, because the module does not exist.
    - _Requirements: 6.2, 6.4, 6.6, 6.12; design "Measurement program"; Properties 6, 7_

  - [x] 5.2 Implement the probe writer
    - Create `scripts/packaging/config-probe.mjs`: `PROBE_KEY`, `buildProbe(bytes)`, `writeProbe(deps, bytes)`, `removeProbe(deps)`, using `withResultsLock` of `scripts/results-store.mjs` (the lock `.results.lock`), a temp file `.config.<token>.tmp` in `data\` and a rename. The lock is taken once per call and never held across a request.
    - Command: `npx vitest --run tests/packaging.config-probe.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - Note for the usage log: the first run of this task failed Property 7 on the counterexample `[9]` (seed 102778929). The smallest probe `{"pad":""}` is 10 bytes, not 9, so `MIN_PROBE_BYTES` and the pad length were off by one: a slip in the design and in the first version of the tests, caught by the property. Fix: `MIN_PROBE_BYTES = 10`. The generators use the constant, so the ranges moved from 9 to 10 with it; the properties and the other tests are unchanged. The four literal 9s in the example tests (the constant, the smallest probe, the size below the minimum, the pad pattern) were corrected to 10, 10, 9 and 10 + 25.
    - _Requirements: 6.2, 6.4, 6.6, 6.12_

- [x] 6. Measurement
  - [x] 6.1 Write the measurement tests (expected to fail)
    - Create `tests/packaging.measure.test.mjs` and `tests/packaging.entry.test.mjs` (the measurement entry part). Property 8 (for all limits L from 0 to 2 MiB and the four failure modes of a fake route: `largestGood` is the greatest tested size at most L; below 1 MiB `firstBad` is above L and `firstBad - largestGood` is at most 1024; from 1 MiB `reachedCap` is true and `firstBad` is null; the probe is removed in every case), Property 9 end to end (the printed report and all fake-file writes hold no token), Property 11 (for all home-folder strings the report and every message hold none). Example tests: the ladder sizes are `16384, 32768, 49152, 65536, 98304, 131072, 262144, 524288, 1048576`; the first step failing bisects from 0; `--dry-run` writes nothing and reads only `/api/crons`; refusal when the `replay` job `is_running`, when `.run.lock` or `.hunt.lock` exists and is not stale, and when `config.json` is not an object; removal on a thrown error and on `SIGINT`; `configRestored` and `routeRestored` in the report; the report shows paths as `~\...`.
    - Command: `npx vitest --run tests/packaging.measure.test.mjs tests/packaging.entry.test.mjs`. Expected: failures, because the modules do not exist.
    - _Requirements: 6.1 to 6.6, 6.10, 6.11, 6.12, 6.13; Properties 8, 9, 11_

  - [x] 6.2 Implement the measurement and its entry
    - Create `scripts/packaging/measure.mjs` (`SIZES`, `runMeasurement`, `renderReport`) and the thin entry `scripts/packaging/measure-config-route.mjs` (real `deps` with `dataFolder` built from the home folder, the two prompts, `--dry-run`). The entry prints the report to standard output only and writes no file.
    - Command: `npx vitest --run tests/packaging.measure.test.mjs tests/packaging.entry.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - Acceptance: the program is not run against the real gateway in this task (that is task 13).
    - _Requirements: 6.1 to 6.6, 6.10, 6.11, 6.12, 6.13_

  - [x] 6.3 Conditional: `--manual-read` (only if task 1.2 found no usable token form)
    - Skip this task unless task 1.2 marked it as needed. Tests first in `tests/packaging.measure.test.mjs`: with `--manual-read` the program prints the size it just wrote, waits, and takes the status and byte length that the user types (and the first and last 16 characters of the body), and still removes the probe. Then implement it in `measure.mjs`. Command: `npx vitest --run tests/packaging.measure.test.mjs`, then `npm run typecheck`.
    - _Requirements: 6.3, 6.13; design "Route access and the token" (fallback)_

- [x] 7. `read-route`
  - [x] 7.1 Write the summary and entry tests (expected to fail)
    - In `tests/packaging.route-reader.test.mjs` and `tests/packaging.entry.test.mjs` add: Property 10 (for all job objects with an arbitrary `script` value and arbitrary extra fields, `summariseCrons` never contains the `script` value and has only the allow-listed keys), example tests for the time-field format detection (`epoch-seconds` below 1e11, `epoch-milliseconds` from 1e11, `iso-string`, `unknown`), the Replay_Job rule boolean (name `replay`, name ending `/replay`, else `script` containing `replay_cron.py`), `summariseConfig` (byte size of the body, of `playtesterResults`, of `latest`, of `trend`, of `findings` when present, level count, trend count; numbers only), and the entry (`crons` and `config` subcommands with injected prompts and `fetch`; an unknown subcommand is refused with no request).
    - Command: `npx vitest --run tests/packaging.route-reader.test.mjs tests/packaging.entry.test.mjs`. Expected: failures, because the functions and the entry do not exist.
    - _Requirements: 9.4, 9.15, 10.3; Property 10_

  - [x] 7.2 Implement `read-route`
    - Create `scripts/packaging/read-route.mjs` with `summariseCrons`, `summariseConfig` and the entry `main` (the subcommands `crons` and `config`; prints a summary only; no file written).
    - Command: the same `npx vitest --run` as in 7.1. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 9.4, 9.15, 10.3_

- [x] 8. `test:all`
  - [x] 8.1 Write the combined-command tests (expected to fail)
    - Create `tests/packaging.test-all.test.mjs` with the fake runner of `tests/helpers/packaging-fakes.mjs`. Property 13 (for all lists of six exit codes: the runner is called for the steps up to and including the first non-zero one, in list order, never with two calls in flight; the returned code equals that first non-zero code, or 0), Property 14 (equal bytes pass; any single changed, inserted or removed byte, or a missing file, fails with a one-line message that holds `npm run build`). Example tests: the six steps and their commands and folders as in the design table; a step that cannot start prints `[test:all] could not start: <label>` and returns 1; the root `package.json` script `test:all` equals `node scripts/test-all.mjs`; the temp-folder build uses `--outDir` and never writes `ui/dist`; the temp folder is removed in a `finally` block.
    - Command: `npx vitest --run tests/packaging.test-all.test.mjs`. Expected: failures, because the module and the script do not exist.
    - _Requirements: 7.1 to 7.6, 7.9, 8.2; Properties 13, 14_

  - [x] 8.2 Implement `scripts/test-all.mjs` and the npm script
    - Create `scripts/test-all.mjs` (`STEPS`, `runSteps`, `compareBundle`, `main`; `main` runs only as the entry point; `npm` is started as a fixed command string with a shell on Windows as `scripts/replay/process.mjs` does, `python` and `node` with argument arrays and no shell). Add `"test:all": "node scripts/test-all.mjs"` to the root `package.json` scripts (the only change there; user approval is given in the spec).
    - Command: `npx vitest --run tests/packaging.test-all.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - Acceptance: `test:all` is not run yet (task 10.2 runs it once).
    - _Requirements: 7.1 to 7.6, 7.9, 8.2_

- [x] 9. README lint and README
  - [x] 9.1 Write the README tests (expected to fail)
    - Create `tests/packaging.readme.test.mjs`. Property 15 (a README built from the required phrases plus filler passes; removing any one required phrase gives a problem that names it; inserting a drive letter, `Users\`, `token=`, `localhost`, `127.0.0.1`, an address outside the two allowed prefixes, or a placeholder word gives a problem). Example tests: the required phrases `Windows`, `only Windows was tested`, `03:00`, `on request`, `bounded search`, `MIT`, the two links, `companion`, `Grimsheet entry`; the lint source holds no list of other tool or assistant names (a test reads `scripts/packaging/readme-lint.mjs` and checks that it holds no word list beyond the allowed phrases); and one test that reads the real `README.md` and expects no problem.
    - Command: `npx vitest --run tests/packaging.readme.test.mjs`. Expected: failures, because the lint and the README do not exist.
    - _Requirements: 12.21, 12.24, 12.25; Property 15_

  - [x] 9.2 Implement `lintReadme`
    - Create `scripts/packaging/readme-lint.mjs` (`lintReadme(text)` returning `{ rule, message }` items; the address allow-list `https://github.com/UBayouski/` and `https://grimsheet.onrender.com`).
    - Command: `npx vitest --run tests/packaging.readme.test.mjs`. Expected: the pure tests and properties pass; the real-file test fails only because `README.md` does not exist. Then `npm run typecheck`.
    - _Requirements: 12.24_

  - [x] 9.3 Write `README.md` (first version, before the measurements)
    - Write `README.md` at the repo root with the ten sections of the design, in order. The Crew_CLI is shown by the path built from `$env:ProgramFiles`. Numbers that a hand step has not recorded are written as "not measured" (credits per hunt, the Approval_Count, the route size limit); a text that was not seen (the build-tool warning) is described without quotation marks or left out; no screenshots yet and no text about them.
    - Read the README against R12.21 (no tool or assistant other than Kiro, by reading) and against the criteria of R12 and R13; list any criterion that waits for a measurement.
    - Command: `npx vitest --run tests/packaging.readme.test.mjs`. Expected: passes.
    - _Requirements: 8.2 to 8.15, 12.1 to 12.25, 13.1 to 13.4_

- [ ] 10. Checkpoint after the code tasks
  - [x] 10.1 Run the gates, one at a time
    - Run in this order, one command per call, and report each count: `npm test` (root); `npm run typecheck` (root); `python -m unittest tests.test_replay_cron`; `npm test` in `ui/`; `npm run typecheck` in `ui/`. If one fails, STOP and report; do not change a check.
    - Acceptance: all pass. Baselines before this spec: root 35 files and 1154 tests; Python 42 tests; `ui/` 27 files and 439 tests.
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 10.2 Run `npm run test:all` once
    - Run it from the repo root (after the user says yes: it runs a `ui/` build into a temp folder). Expected: the six steps pass and it prints `all 6 steps passed`.
    - _Requirements: 7.1 to 7.6, 7.9_

  - [ ] 10.3 STOP: ask the user to commit
    - **STOP and ask the user** to review `git status --porcelain`, to commit the new and changed files, including `ui/dist/index.mjs`, `.gitignore` and `.gitattributes`, and then to push the commit to `https://github.com/UBayouski/Grimsheet-Playtester.git` (the agent runs no git write command). The hand steps clone from the pushed repository. Wait for the user to say that the commit and the push are done, then run `git status --porcelain` and `git log -1 --oneline` (read only) and report.
    - _Requirements: 8.2, 9.2_

- [x] 11. First real install (Hand_Run_Step; Requirement 9)
  - [x] 11.1 STOP: ask the user to approve the whole step (Gate A)
    - Print the 17-step table of the design ("Requirement 9: first install") with the commands, the paths each touches, and the gates B to H. **STOP and ask the user** to approve the step. The clone source is fixed: the public repository `https://github.com/UBayouski/Grimsheet-Playtester.git`. Nothing runs before a yes. Commands run one at a time; the first unexpected output stops the step.
    - _Requirements: 9.1; design "Protocol for every Hand_Run_Step"_

  - [x] 11.2 Clone and verify the Clean_Clone (Gate B)
    - **STOP and ask the user** (Gate B), then `git clone https://github.com/UBayouski/Grimsheet-Playtester.git "$env:USERPROFILE\crew-install-src\grimsheet-playtester"`. The source is the public repository, so the install sees exactly what a judge clones (this needs the network and the user's push of task 10.3). Then `git -C <clone> status --porcelain` (expected empty), `Test-Path <clone>\data` (False), `Test-Path <clone>\ui\dist\index.mjs` (True), `Test-Path <clone>\spike` (False). Also `CREW app info grimsheet-playtester` before the install (expected: not installed).
    - Acceptance: the four checks match; the output is recorded with paths as `%USERPROFILE%`.
    - _Requirements: 9.2, 8.1_

  - [x] 11.3 Install (Gate C)
    - **STOP and ask the user** (Gate C). Then `CREW app install "$env:USERPROFILE\crew-install-src\grimsheet-playtester"` with `CREW` as the path built from `$env:ProgramFiles`. Record the exit code, the output and every warning, with paths shown as `~`.
    - _Requirements: 8.4, 8.5, 9.3_

  - [x] 11.4 Trust, enable and observe (Gate D)
    - Tell the user to run `kirocrew token` in their own terminal, open the printed address, trust the app (Settings, Security, Third-party apps) and enable it. The agent does not run `kirocrew token` and does not ask for the address. **STOP** until the user says it is done (Gate D). Then ask the user what they see: Library (Enabled), the sidebar entry and whether the icon `Ghost` shows a glyph (Q2; if not, the manifest changes to `Moon`, only after the user approves, as a new small change of `app.json` with the Manifest_Check run again), the Schedule page (the `replay` job, and the point when it appeared: Q14), Details, Resources (one agent, two skills), whether `permissions.storage` was needed (Q3: the page's read of the Config_Route works without it).
    - _Requirements: 8.6, 8.8, 9.3, 9.10, 9.12; Open questions Q2, Q3, Q14_

  - [x] 11.5 Page checks and the crons read (Gate E)
    - Ask the user to check in the page that it renders from the default export (R9.5), to read `React.version` once in the browser console (R9.6), and to press each copy button once (R9.7). IF the React major version is not 18, STOP and report; change the `ui/` React and type pins to the exact host version only after the user approves, followed by the `ui/` test and build gates.
    - **STOP and ask the user** to run `node scripts/packaging/read-route.mjs crons` in their own terminal in the working folder and to paste the printed summary (Gate E). Record the job `name`, the time formats and the Replay_Job rule result; the record holds no `script` value.
    - _Requirements: 9.4, 9.5, 9.6, 9.7; dashboard Q3, Q9, Q10_

  - [x] 11.6 Records of the installed state
    - Run, one per call: `CREW app info grimsheet-playtester`; `Get-Content "$env:USERPROFILE\.kiro\agents\grimsheet-playtester--playtester.json"`; `Get-Content "$env:USERPROFILE\.kiro\crew\apps\grimsheet-playtester\approved-grants.json"` (never `.app_secret`). Record: the stored manifest and any field the gateway dropped or normalised; that the generated agent has `tools` with `execute_bash` and the `skill://` resource; what the grants file held; and whether trust or enable needed an action for the declared `permissions.api` entries.
    - _Requirements: 9.10, 9.11, 9.12_

  - [x] 11.7 Developer path check (Gate G)
    - **STOP and ask the user** (Gate G). Then in `<clone>\ui`: `npm ci`, `npm run build`, and `git -C <clone> status --porcelain`. Copy the exact build-tool warning text if one is printed, or record that none appeared (Q4); the README may quote it only now (R8.9). Expected: `git status --porcelain` is empty, which shows that the build is reproducible on a second tree. IF it is not empty, STOP and report (design "Stale-bundle check").
    - _Requirements: 8.2, 8.9; Open question Q4_

  - [x] 11.8 Write the install records (Gate H)
    - Show the user the planned text, then write: a Notes_File section for the first install (Observed; commands, exit codes, output, warnings, trust and enable steps, the answers to Q2, Q3, Q4, Q6, Q11, Q14, dashboard Q3, Q9, Q10, the clipboard result), new evidence files in `docs/evidence/` (next free ids) and the rows in `docs/evidence/INDEX.md`. The Crew version, the app version and the date go in. List the files in the installed folder to answer Q11 (names only). Check every record for a user name, home path or token before saving. No other repo file changes.
    - _Requirements: 9.3, 9.8 (partly), 9.13, 9.14_

- [x] 12. First replay run (Hand_Run_Step; Requirement 9)
  - [x] 12.1 STOP: ask the user to approve the run (Gate F)
    - **STOP and ask the user.** Say what the run does: it fetches Grimsheet `main` into `%LOCALAPPDATA%\grimsheet-playtester`, builds it, plays every stored solution, and writes into the installed app's `data\`. It needs the network. It must not be started within 20 minutes of 03:00 America/Los_Angeles. Wait for the yes.
    - _Requirements: 9.1, 9.8_

  - [x] 12.2 Run and record
    - The user presses **Run** on the Schedule page for `replay` and says when it has stopped. Record the Executions tab row (status, duration, trigger, summary), and whether the page then shows one card per level after a Refresh. Compare the duration with `timeout` 900 (Q7).
    - _Requirements: 9.8, 9.9; Open question Q7_

  - [x] 12.3 Read the sizes after the run
    - **STOP and ask the user** to run `node scripts/packaging/read-route.mjs config` in their own terminal and paste the printed numbers. Record them in the working notes of this task only (the Notes_File entry is written in task 14.2, after task 13).
    - _Requirements: 9.8, 9.15_

- [x] 13. Config route size (Hand_Run_Step; Requirement 6)
  - [x] 13.1 STOP: ask the user to approve the measurement (Gate A)
    - Print the table of the design ("Requirement 6"), the ladder sizes, the bisect rule and the warning about 03:00 America/Los_Angeles. **STOP and ask the user** to approve, and to confirm the `replay` job is not running and no hunt is active. Say that the user runs both commands, because both prompt for the token.
    - _Requirements: 6.1, 6.13_

  - [x] 13.2 Dry run
    - The user runs `node scripts/packaging/measure-config-route.mjs --dry-run` and pastes the output. The agent checks that nothing blocks (job not running, no fresh lock files) and that the planned sizes are right. **STOP** until the user approves the real run (Gate B).
    - _Requirements: 6.1, 6.12_

  - [x] 13.3 Real run
    - The user runs `node scripts/packaging/measure-config-route.mjs` and pastes the report. The agent checks `configRestored` and `routeRestored` in the report. IF `configRestored` is false, STOP and tell the user which key to remove by hand; make no other change.
    - _Requirements: 6.2 to 6.6_

  - [x] 13.4 Records and the decision
    - Write the evidence file and the Notes_File section (R6.7), and in the same evidence file add the observation on token lifetime recorded in the Notes below (what was seen, and that the cause is not proven): the largest size returned in full, the first size that failed or "no failure up to 1 MiB", the method, the date, the Crew version, the status codes; check the text for a user name, home path or token (R6.11). Apply R6.8 to R6.10: IF the largest size is at least 65536, the Byte_Budget stays and the section says it is not changed. IF it is below 65536, STOP and report (**Gate C**) with the measured number; the amendments of replay-runner R9.6 and the exploit-hunt Findings_Caps are made only as separate, approved changes. IF the route cannot carry a minimal Results_Key, report that the `.mjs` fallback of replay-runner D6 is needed and build nothing.
    - _Requirements: 6.7 to 6.11_

- [x] 14. Results_Key sizes and the exploit-hunt design correction (Requirement 9, criterion 15)
  - [x] 14.1 STOP: show the planned correction
    - **STOP and ask the user.** Run `node scripts/packaging/read-route.mjs config` again (the user's terminal; the probe is gone after task 13) and show the numbers: body, Results_Key, `latest` (with `endHp`), `trend`, level count and trend count. Show the lines of `.kiro/specs/exploit-hunt/design.md` ("Together with the replay's value", about lines 812 to 815) that will change and the new values, as a diff.
    - _Requirements: 9.15_

  - [x] 14.2 Record and correct
    - After a yes: add the sizes to the Notes_File; correct in one edit the measured sizes in the exploit-hunt design (`latest` 778 bytes, about 75 bytes per level, and the totals and level limit derived from them). Change nothing else in that file; this is the only edit in another spec's design. List the edit for the Usage_Entry.
    - _Requirements: 9.14, 9.15_

- [x] 15. First agent-run hunt (Hand_Run_Step; Requirement 10)
  - [x] 15.1 STOP: ask the user to approve the hunt (Gate A)
    - Print the table of the design ("Requirement 10"), the expected Approval_Count (about 30), the budgets (4 per level, 20 per hunt, 1800 seconds, 10 refusals), what the hunt creates, and that the approval mode stays **Normal**. **STOP and ask the user** to approve and to start the hunt themselves. The agent does not start it.
    - _Requirements: 10.1, 10.2, 10.7_

  - [x] 15.2 Preflight (done inside 15.1 with the equivalent read-only checks at 15:54 in Los Angeles: no `.hunt.lock`, no `data\hunts`, no hunt folder yet; the user declined a repeat, because `hunt-begin` checks the locks itself)
    - Run, one per call: `Test-Path "$env:USERPROFILE\.kiro\crew\apps\grimsheet-playtester\data\.hunt.lock"` (expected False) and `Get-ChildItem "$env:USERPROFILE\.kiro\crew\apps\grimsheet-playtester\data\hunts"` (expected no active hunt). Report.
    - _Requirements: 10.1_

  - [x] 15.3 The hunt (run by the user in a chat with the `playtester` agent)
    - Privacy rule recorded at Gate A: the approval prompts show the full path of the skill folder, which holds the Windows user name, so a prompt is never filmed or screenshotted uncropped; any text the user pastes from a prompt shows the path as `~`.
    - The user opens the chat, asks for a hunt, and answers each approval prompt. The user (or the chat record the user pastes) gives the Approval_Count split into skill loads, Hunt_Begin, Hunt_Info, Hunt_Submit, Hunt_End and charged refusals; the credits on the usage line; the elapsed time; the model on the usage line; and every command the agent ran with an addition not given by the skill. YOLO is never used; the approval mode is never changed by the agent. IF the hunt stalls, fails, or shows a result that differs from the exploit-hunt design, STOP and report; change no hunt code.
    - _Requirements: 10.2 to 10.5, 10.7, 10.8, 10.11_

  - [x] 15.4 Optional: one hunt with the selector option **Trust** (Gate B) (skipped: the user answered no; one hunt, mode Normal only; **Trust** stays untested)
    - **STOP and ask the user** whether to try it. Only if yes: the user repeats the hunt in a new chat with the option **Trust** for that chat only, and the same figures are recorded. Mark **Trust** as tested or still untested.
    - _Requirements: 10.6_

  - [x] 15.5 Records (Gate C)
    - Clipboard check, moved here from task 12 (the copy buttons exist only on a finding, and the page had none before the hunt; the check is possible only if the hunt recorded at least one finding; with none, record "not tested: no finding to copy" and leave the check open). Tell the user exactly what to press and look for: on the findings list, each finding has three buttons, "Copy action list", "Copy replay command" and "Copy actions file" (their accessible names end with "for <level id>"). Press each kind once, on one finding. After each press look under the page for the text "Copied" (a polite live region that clears after about 3 seconds), then paste into a plain text editor and compare with the text shown above the button (the action list, the `node scripts/play.mjs <level> --actions-file <file>` command, the JSON actions file). If instead the text "Copy is not available here. Select the text and press Ctrl+C." appears, a read-only text area with the text is focused and selected: press Ctrl+C there, paste, and record that the fallback was used. Record per kind: worked or not, "Copied" seen or not, fallback seen or not, pasted text equal to the shown text or not. The Permissions-Policy header of the host (clipboard-write and clipboard-read for the page itself) is already recorded in E38.
    - After the hunt: `Get-Content "$env:USERPROFILE\.kiro\crew\apps\grimsheet-playtester\data\hunts\<Hunt_Id>.json"`, and the user runs `node scripts/packaging/read-route.mjs config` (the numbers include `findings`). List every file the hunt created and delete none. Compare the Approval_Count with the "roughly 30" and the 3 to 12 of the spike, and say whether the 1800-second Time_Budget suits a run that waits for approvals. Record what the dashboard shows for the Hunt_Record and the Findings. **STOP and ask the user** to approve the Notes_File section and the evidence files, then write them.
    - _Requirements: 10.3, 10.4, 10.9, 10.10, 10.12_

- [ ] 16. Optional: model field plan (Hand_Run_Step; Requirement 11)
  - [ ] 16.1 STOP: ask whether to measure at all (Gate A)
    - **STOP and ask the user.** IF no: record the skip in the Notes_File (the agent file keeps no `model`) and go to task 17. IF yes: continue.
    - _Requirements: 11.2, 11.5_

  - [ ] 16.2 Read the accepted `model` form (read only)
    - With Kiro's documentation power, read the Crew page on agent spec fields. Record the accepted form of `model` and write "not documented" for anything the page does not say.
    - _Requirements: 11.1_

  - [ ] 16.3 Run 1, no `model`
    - The user runs, in a chat with `playtester`, the four calls in this order: `hunt-begin.mjs`; `hunt-info.mjs --level 02-the-chaser`; `hunt-submit.mjs --level 02-the-chaser --class cheaper_win --actions E E E E N N E E E E E S S` (the list of the skill's first example; the same in both runs); `hunt-end.mjs`. The user reports the credits on the usage line.
    - _Requirements: 11.2_

  - [ ] 16.4 Add the candidate `model` (only after the user approves)
    - **STOP and ask the user** (Gate B) before editing. Only after a yes: add the candidate `model` value to `agents/playtester.json`, and update `tests/hunt.texts.test.mjs` in the same task so that its lint allows the field. Run `npx vitest --run tests/hunt.texts.test.mjs` (expected: passes) and `npm run typecheck`. The user then runs **Sync** in the dashboard, not while a run or a hunt is active.
    - _Requirements: 11.3; exploit-hunt R1.10_

  - [ ] 16.5 Read the generated agent file and run 2
    - Run `Get-Content "$env:USERPROFILE\.kiro\agents\grimsheet-playtester--playtester.json"` and look for `model`. Then the user repeats the four calls of task 16.3 and reports the credits and the model on the usage line. Compare. One pair of runs is a rough signal only (0.1 to 0.4 credits is the scale of such runs); the record says so.
    - _Requirements: 11.2, 11.3_

  - [ ] 16.6 Keep or revert (only after the user approves)
    - IF the field did not survive the Sync, revert the edit of task 16.4 (agent file and test) and record that the cost question stays open. IF it survived, ask the user whether to keep it. Either way, record the result in the Notes_File. Run `npx vitest --run tests/hunt.texts.test.mjs` after a revert or a keep.
    - _Requirements: 11.3, 11.4_

- [ ] 17. README with the measured facts and the screenshots
  - [ ] 17.1 Update the README text
    - Replace the "not measured" statements with the recorded numbers and their dates: the Approval_Count (R12.8) and the credits (R12.12) from task 15, the route size limit (R12.18) from task 13, the **Trust** result (R12.9), and the build-tool warning text if task 11.7 saw one (R8.9). Where a number was not measured, the README says so. Command: `npx vitest --run tests/packaging.readme.test.mjs`. Expected: passes.
    - _Requirements: 8.9, 10.12, 12.8, 12.9, 12.12, 12.18_

  - [ ] 17.2 Screenshots (asks the user)
    - **STOP and ask the user** how the screenshots are taken: by the developer on the installed page, or by a capture the user approves. A capture saves no token, no session address and no address bar that holds either, and the images show no user name or home path. Save the images under `docs/screenshots/` (names without a user name), add them to the README, and re-run `npx vitest --run tests/packaging.readme.test.mjs`.
    - _Requirements: 12.20_

- [ ] 18. Final checkpoint and corrections
  - [ ] 18.1 Run the gates, one at a time
    - Run in this order, one command per call: `npm test` (root); `npm run typecheck` (root); `python -m unittest tests.test_replay_cron`; `npm test` in `ui/`; `npm run typecheck` in `ui/`; then `npm run test:all`. Report each count. If one fails, STOP and report.
    - _Requirements: 7.1 to 7.6_

  - [ ] 18.2 Corrections to the brief or the steering (only after the user approves)
    - IF a measurement of tasks 11 to 16 shows a statement in `docs/BRIEF.md` or a steering file to be wrong, list each one and the corrected text, **STOP and ask the user**, and edit only what the user approves. List each change for the Usage_Entry. IF there is none, say so.
    - _Requirements: 14.4_

  - [ ] 18.3 Final review by reading
    - Read `README.md`, `app.json`, the new scripts and all new records for a Windows user name, home path, drive letter, token, dashboard address, and for any tool or assistant name other than Kiro (R12.21, R14.1, R14.2). Report the result; fix by the user's choice. Run `git status --porcelain` (read only) and list the files changed by this spec.
    - _Requirements: 12.21, 14.1, 14.2, 14.3_

- [ ] 19. `KIRO_USAGE.md` entry
  - [ ] 19.1 Append the Usage_Entry
    - Read `KIRO_USAGE.md` for its entry format. Append `## YYYY-MM-DD - packaging: the app made installable, checked, and run on a real gateway` with `Surface`, `Features`, `What I asked for`, `What Kiro did`, `What changed because of it`. Include: which Hand_Run_Steps were run and which skipped; the measured numbers of tasks 11 to 15; every difference between the documentation and observed behaviour that was found; the edit of the exploit-hunt design (task 14.2); any change under tasks 11.4, 11.5, 16 and 18.2 (each made only after approval). Name no tool other than Kiro; no user name or home path. Written after every other task is done or skipped by the user.
    - _Requirements: 15.1 to 15.4_

## Notes

- Hand steps need the user at the keyboard: they hold the gateway token and press the buttons of the dashboard. The agent runs only the commands that name no token.
- The reproducibility result of task 1.1 and the token form of task 1.2 are recorded here once known:
  - Build reproducibility (task 1.1): done 2026-11-08. Two builds into temp folders and `ui/dist/index.mjs` have the same SHA-256 and the same size (43902 bytes). The byte comparison of the design stays. The temp folders were removed.
  - Token form (task 1.2): done 2026-11-08. `kirocrew token --help` does not say how a request carries the token. The documentation shows the dashboard token as `?token=` (query); `Authorization: Bearer` is documented only for webhooks. `TOKEN_FORM` defaults to `query`, `bearer` stays supported; neither was tried on the gateway (notes, section i). Task 6.3 is not marked as needed yet; task 11.5 shows which form works.
- Open for the first install and recorded by tasks 11 to 13: Q3 (`storage`), Q4 (build-tool warning), Q6 (time formats), Q7 (cron timing), Q11 (files copied at install), Q14 (job registration order). Q2 is settled in the design (`Ghost`, fallback `Moon`); task 11.4 confirms it.
- The design's D1 to D6 are confirmed by the user; D6 is settled in task 1.2.
- Task 6.3 (`--manual-read`) was not needed: task 1.2 found a documented token form (`query`), so the conditional task was skipped. Task 11.5 shows whether the gateway accepts it; if not, 6.3 is reopened.
- Slips and deviations found while running tasks 1 to 10, for the usage log:
  - Task 2.1: `git check-ignore -v` prints the negated rule and exits 0 for a re-included file, so the first test was wrong; the test now takes the verdict from `git check-ignore -q` and uses `-v` only for the matching rule.
  - Task 5.2: Property 7 caught `MIN_PROBE_BYTES = 9` (the smallest probe `{"pad":""}` is 10 bytes), seed 102778929.
  - Task 4.2: the reader also refuses any origin that is not on this machine and removes the token in its JSON-escaped form, not only the raw and URL-encoded forms.
  - Task 9.1: the planned test that reads the lint source for a list of names was replaced by Property 15a (any filler text passes), because a test that listed such names would put them in a repo file.
  - Task 9.2: the allowed address prefix `https://grimsheet.onrender.com` needs a boundary after it, so that a look-alike host such as that name followed by another domain is refused.
  - Tests found and fixed three of their own slips (an assertion of `false` against `undefined`, a fake `close` event that turned `null` into 0, a path style mismatch); none loosened a check.
  - CI slip (draft PR #1, windows-latest): `tests/packaging.measure.test.mjs`, Property 8, "Test timed out in 5000ms" (about 5058 ms on the runner, about 1.6 s locally; the runner is about 3 times slower). Each of its 100 cases runs a full ladder and bisect with probes up to 1 MiB, so the cost is inherent. Fix: an explicit timeout of 30000 ms as the last argument of that `it(...)`, with a one-line comment. `numRuns`, the generators and every expectation are unchanged. Lesson for the usage log: a property test that is slow on this machine can fail on a slower runner; the local run and `test:all` did not show it. Other tests over 1000 ms locally and on the default 5000 ms limit (not changed): `hunt.publish` "hunt and replay merges leave each other's keys alone and commute" 1339 ms, `hunt.submit` Property 7 1017 ms, `ui` `core.time` Property 12 1560 ms; the `replay.process` test that kills a child tree (5680 ms) already has an explicit 20000 ms limit.
- Hand-step progress, 2026-11-08 (first install; the text for the Notes_File section is written in task 11.8):
  - Clone, install (exit 0, version 1.0.0, registration blocked until trusted), trust and enable by the user in the dashboard, and the reads of tasks 11.4 to 11.6 are done. Observed and not yet written into `docs/`: the install warning names `agent.apps_trusted` and `agent.apps_allow_third_party` and says to trust the app from the dashboard's App Store; Details shows Origin Registry and Source Unknown for a local install; the sidebar and Details show a default cube, so the `Ghost` icon name did not render (Q2); the page renders from the default export with no `mountFunction` or `entryPoint` (Q9 closed); `React.version` is 18.3.1 through the host shims at `/vendor/react.mjs` (Q10 closed); `approvedGrants` holds exactly the two api paths; the stored manifest drops the cron `enabled: true`; the generated agent file gains `mcpServers: {}`.
  - Gate E: the route reader worked with the `query` form on the first try (status 200). The job name is `grimsheet-playtester/replay`, the page rule finds exactly one job, `next_run_ts` is epoch seconds, and `last_run_ts` is null before a run (D6 settled; `bearer` untried; task 6.3 stays skipped).
  - Not observed (recorded as such): the trust screen and button label, when the `replay` job appeared (Q14), and any permission prompt for the api paths.
  - First replay run (task 12, 2026-11-08, manual, from the Schedule page): status OK, 9.1 s (run record 20:45:01.96Z to 20:45:09.74Z), summary empty. Before it, `%LOCALAPPDATA%\grimsheet-playtester` was renamed to `grimsheet-playtester.dev` (kept; not deleted), so the run did a fresh clone, `npm ci` and build, with a warm npm cache. Result: run-000001, state complete, commit bea7a52, five levels green with end HP 3, 3, 3, 5, 5, `resultsKey` ok, `last-launch.json` outcome child-exited with exit code 0 and control file missing (the default), no lock file left. Page: five green cards with end HP (replay-runner task 16.1 works end to end), the runs table, the findings empty state; headings render at body-text size (host CSS reset; optional `ui/` style fix only after approval); no copy buttons on this page, so the clipboard check moves to task 15. Config read: body 1369 bytes, Results_Key 1228, `latest` 828 (778 before `endHp`, +10 per level), trend 323, one trend entry, five levels, no `findings`. Q7: 9.1 s against the 900 s limit with a warm cache; a cold cache was not measured.
  - Open: tasks 11.7 (Gate G, developer path check) and 11.8 (Gate H, the records) are done after the first replay run; the copy buttons are checked in task 15.
  - First real measurement run (task 13.3, 2026-11-08), a slip the real run caught: the tool printed status `ok` with `largestGood` 0 and `firstBad` 1024, but every step, from 16384 down to 1024 bytes, had answered 403 with the same 47-byte body in 1 to 2 ms. The same route had answered 200 earlier that day, and a fresh token gave 200 again afterwards (body 1369 bytes, Results_Key 1228 bytes, the same as before the run). It was an access refusal and not a size limit, but the tool would have reported a limit of 1 KiB. Nothing was recorded as a limit: no R6 evidence file and no Notes_File section were written, and Gate C was not reached. Cleanup worked (no probe key, lock file or temp file left). Cause, as far as it can be shown: the code paths of the measurement and of `read-route` are identical; the pre-check had read only `/api/crons` (which answered 200), so it never tested the token against the Config_Route, and `classify` treated every answer other than a good one as a size failure. That the Config_Route refused a token that `/api/crons` accepted is likely but not proven (the 47-byte body was not recorded). Fix, test first (failing run shown before the code): a step is good, bad (a 200 that is cut, does not parse or differs, or a 413) or blocked (401 or 403 as `access_refused <status>`, any other status as `unexpected_status <status>`, a timeout, a network error), and a blocked step ends the run with no bisect and no limit; the pre-check and the dry run read the Config_Route before any write; every step that is not good carries a scrubbed `reason` of at most 80 characters, `read-route` shows the same kind of reason for a status that is not 2xx, and the report gives `routeReason` when the route is not restored. Spec and design updated in the same change (R6.14 to R6.17, design measurement section, Property 8 changed and Property 8b added). Expectations changed to follow the new rule, none loosened: the dry run now reads `/api/crons` and the Config_Route, Property 8 now expects `blocked` for its timeout mode (the generator is unchanged), the 401 example of `read-route` now expects a reason, and two tests that counted reads of the Config_Route now count the pre-check read. Lessons for the usage log: a pre-check must test the credential against the thing that is measured; a measurement tool must separate "the answer says the size is too large" from "the answer says nothing about size"; record the reason text of a refusal in the first report.
  - Token diagnostic and rerun, 2026-11-08 (run by the user; the fix of the slip above was in place): `read-route crons` with a token whose last character was changed answered 403 with the reason "Forbidden", so `/api/crons` does check the token; `read-route config` with the same wrong token answered 403 with the reason "invalid signature", very likely the 47-byte answer of the first real run (the token is signed and the config route refused the signature). A dry run with a fresh token gave status `dry-run`, both routes read fine, no blocker. The real run a few minutes later ended `blocked` with "access_refused 403 on /api/crons: Forbidden", no step, nothing written, removal done (the new pre-check did its job). Reading of the user: the token stopped being valid between the dry run and the real run, and during the first real run; likely cause, not proven: issuing a new token or opening the dashboard invalidates the previous one. Two points stay open: the earlier idea that `/api/crons` ignores the token is refuted, so the first real run (`/api/crons` answered 200, then the Config_Route answered 403 within milliseconds) is not explained by a token that expired before the run began; either the token became invalid in the milliseconds between those two reads, or the two routes validate it differently. The rerun will use one fresh token immediately for the dry run and the real run, with the dashboard closed. At task 13.4 this observation on token lifetime goes into the evidence, with that caveat. No code was changed for it.
  - Config route size (task 13, 2026-11-08, run by the user at commit 9f64b86 with one fresh address pasted straight into the real run, no dry run, dashboard closed): status ok, nine ladder steps all good (200, parsed, equal) from 16384 to 1048576 bytes, body 17774 to 1049966 bytes, 22 to 46 ms, `largestGood` 1048576, `firstBad` null, `reachedCap` true, removal done with `configRestored` and `routeRestored` true; 12 requests in all (two pre-check reads, nine steps, one read after the removal), all 200. R6.8 applies: the largest size is at least 65536, so the Byte_Budget stays 65536 and the Notes_File says it is not changed; Gate C was not reached. The extra read of `read-route config` in the design table (row 4) was not needed: the removal already reports `configRestored` and `routeRestored`, and R6.6 asks for nothing more. Records: E40, sections k and l of `docs/CREW_NOTES.md`. The session-cookie exchange in `route-reader.mjs` is recorded as an option only (one address across several commands); it is not built and no code changed in task 13.4.
  - Hunt (task 15), Gate A approved by the user on 2026-11-08: one hunt, started by the user in a chat with the `playtester` agent, approval mode Normal, one-time approve only, following the deny list of 15.1; start well before 02:40 in Los Angeles (the replay runs at 03:00). Gate B declined (no hunt with **Trust**; **Trust** stays untested). No repeated preflight. After the hunt the user pastes the chat's final summary, the approval counts by kind, any refusals or denials, the options seen on the approval card, and the usage line. Privacy rule: the approval prompts show the full skill path with the Windows user name, so they are never filmed or screenshotted uncropped.
  - Hunt result (task 15, 2026-11-08): Hunt_Record `hunt-20261108T235753Z` complete, 17 approvals (1 skill load, begin, 5 info, 9 submit, end; no play-level load, no refusal, no denial, no added command), 9 of 20 attempts in 81 s (the agent stopped by choice), 3 findings (a cheaper win on 03-the-locked-crypt, 1 ink against 2; unexpected routes on 02 and 05), 6 rejected as `not_won`; findings 1475 bytes and Results_Key 2715 bytes, read from `config.json` (no route read). Records: E42, section n of `docs/CREW_NOTES.md`; the agent's final summary is in E42 verbatim, with one inexact line noted (for 03 it says three edits were more than the 2 ink allowed; the record shows `not_won`). Not reported by the user and therefore recorded as "not recorded", still open: the options on the approval card (Open question 11), the usage line (credits, elapsed time, model), what the dashboard shows for the hunt, and the clipboard check on the three copy buttons (the buttons exist now). The README therefore keeps saying that credits per hunt are not measured, and that **Trust** is untested; the approval count it quotes can now say that one hunt of 9 attempts needed 17 approvals and a full hunt about 28 to 29.
  - Open question for the Grimsheet repository, not to act on: 03-the-locked-crypt has a confirmed cheaper win (one edit of B14, `=1337/RUNE_SALT`, wins with 1 ink against the stored minimum of 2). Fixing the level or accepting a new minimum is a separate decision in the Grimsheet repository; this app writes nothing there.
  - For the usage log (task 19): the first real hunt needed 17 approvals, none refused or denied, no command with anything added, and found a cheaper win that the stored minimum did not allow; the privacy rule about the approval prompts (the full path with the Windows user name) was kept.
  - For the usage log (task 19), the one edit in another spec's design (R9.15, task 14.2): `.kiro/specs/exploit-hunt/design.md`, lines 812 to 815 only (4 lines changed, nothing else in the file). `latest` 778 to 828 bytes (replay-runner task 16.1 added `endHp`, +10 bytes for each of 5 levels), about 75 to 85 bytes per level in `latest`, full replay value 10576 to 10626 bytes (now computed from the measured parts, not rebuilt), total with `findings` at its cap 26972 to 27022 with 38514 bytes to spare, about 837 to 847 bytes per level, level limit 51 to 50; the fixed part of that estimate is written as 6391 and the earlier 6394 is noted as a 3-byte slip with the same result. Records: section m of `docs/CREW_NOTES.md`, E41.
  - For the usage log (task 19): three blocked attempts (the first real run, the retry after the fix, and the last retry) before learning that a token address should be used by one command only; the pre-check stopped every blocked run before any write that was kept, and one slip (a refusal counted as a size limit) was caught by the first real run and fixed test first.
- A commit is made by the user (task 10.3). Until then the Clean_Clone of task 11 has nothing to clone.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["3.3", "4.1"] },
    { "id": 6, "tasks": ["4.2", "5.1"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["6.1"] },
    { "id": 9, "tasks": ["6.2"] },
    { "id": 10, "tasks": ["6.3", "7.1"] },
    { "id": 11, "tasks": ["7.2", "8.1"] },
    { "id": 12, "tasks": ["8.2", "9.1"] },
    { "id": 13, "tasks": ["9.2"] },
    { "id": 14, "tasks": ["9.3"] },
    { "id": 15, "tasks": ["10.1"] },
    { "id": 16, "tasks": ["10.2"] },
    { "id": 17, "tasks": ["10.3"] },
    { "id": 18, "tasks": ["11.1"] },
    { "id": 19, "tasks": ["11.2"] },
    { "id": 20, "tasks": ["11.3"] },
    { "id": 21, "tasks": ["11.4"] },
    { "id": 22, "tasks": ["11.5", "11.6"] },
    { "id": 23, "tasks": ["11.7"] },
    { "id": 24, "tasks": ["11.8"] },
    { "id": 25, "tasks": ["12.1"] },
    { "id": 26, "tasks": ["12.2"] },
    { "id": 27, "tasks": ["12.3"] },
    { "id": 28, "tasks": ["13.1"] },
    { "id": 29, "tasks": ["13.2"] },
    { "id": 30, "tasks": ["13.3"] },
    { "id": 31, "tasks": ["13.4"] },
    { "id": 32, "tasks": ["14.1"] },
    { "id": 33, "tasks": ["14.2"] },
    { "id": 34, "tasks": ["15.1"] },
    { "id": 35, "tasks": ["15.2"] },
    { "id": 36, "tasks": ["15.3"] },
    { "id": 37, "tasks": ["15.4"] },
    { "id": 38, "tasks": ["15.5"] },
    { "id": 39, "tasks": ["16.1"] },
    { "id": 40, "tasks": ["16.2"] },
    { "id": 41, "tasks": ["16.3"] },
    { "id": 42, "tasks": ["16.4"] },
    { "id": 43, "tasks": ["16.5"] },
    { "id": 44, "tasks": ["16.6"] },
    { "id": 45, "tasks": ["17.1"] },
    { "id": 46, "tasks": ["17.2"] },
    { "id": 47, "tasks": ["18.1"] },
    { "id": 48, "tasks": ["18.2"] },
    { "id": 49, "tasks": ["18.3"] },
    { "id": 50, "tasks": ["19.1"] }
  ]
}
```
