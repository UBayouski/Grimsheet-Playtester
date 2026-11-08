# Implementation Plan: replay-runner

## Overview

This plan builds the nightly replay: the Python Launcher `scripts/replay_cron.py`, the Node entry `scripts/replay.mjs`, and the modules under `scripts/replay/`, plus `scripts/file-lock.mjs` and `scripts/results-store.mjs`. The language is plain ESM JavaScript with JSDoc types and `// @ts-check` (the design states it), and standard-library Python for the Launcher. Node tests use Vitest and fast-check. Python tests use `unittest`. No test uses the network, a real Grimsheet checkout, a real git or a real npm.

Order of work: shared types and test helpers first, then one read-only capture of a real `--list` output, then the pure modules (run-record, index-store, levels, process arithmetic, file-lock, results-store), a checkpoint, then checkout, then `run.mjs` and `replay.mjs`, then the Python Launcher, a final checkpoint, and the usage log. Each module is built test-first: one task writes tests that fail, the next makes them pass.

Rules that apply to every task:
- `scripts/verifier.mjs` is finished and must not be edited, and neither may the verifier's tests (`tests/arbitraries.mjs`, `tests/verifier.*.test.mjs`) or fixtures (they are read-only inputs). Only `scripts/replay.mjs` imports the verifier at run time. Tests may import `replayVerdict` for the integration-style test with the real fixtures.
- No change to `package.json` or `tsconfig.json`. If a task finds one is needed, STOP and ask the user.
- Property-test failure rule: if a property fails, STOP and report the counterexample to the user. Never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen an expectation to make a property pass. Valid inputs are built by construction.
- If a task finds the design cannot be implemented as written (a verifier shape differs, a fixture contradicts the design, a needed `fs` method is missing, a real `--list` output has another shape), STOP and report to the user. Do not change the design or work around it.
- Test files that need a folder use `fs.mkdtemp` under `os.tmpdir()` and remove only the folder they created. No task deletes anything else.
- No git write command is run in this spec (no commit, branch, push). `git` appears only inside fakes.
- Commands are PowerShell-safe: one command per call, no `&&`, no inline JSON. Files are written without a BOM.
- A task that writes failing tests runs `npx vitest --run <file>` and expects failures because the module does not exist or is incomplete. The task that follows runs the same command and expects a pass. `npm run typecheck` is run after each implementation task, not after a failing-test task.

## Tasks

- [x] 1. Shared types and test helpers
  - [x] 1.1 Write `scripts/replay/types.mjs` (typedefs only)
    - Create `scripts/replay/types.mjs` with `// @ts-check` and JSDoc typedefs only, no run-time code, and `export {}` so it is a module: `Deps`, `Fs`, `ReplayOk`, `ReplayError`, `LevelEntry`, `Coverage`, `Failure`, `RunRecord`, `IndexEntry`, `IndexFile`, `TrendEntry`, `CompactRun`, `ResultsKey`, `ProcSpec`, `ProcResult`, `StartProcess`, all as in the design's Components and Data Models sections. `ReplayOk` and `ReplayError` are re-declared here (design Overview), not imported from `../verifier.mjs`.
    - Run `npm run typecheck`. It must pass.
    - _Requirements: 14.3, 5.6, 5.7_

  - [x] 1.2 Write the in-memory fake file system helper and its self-test
    - Create `tests/helpers/fake-fs.mjs` (`// @ts-check`) exporting `makeMemFs(options)`. It implements exactly the `Fs` methods of the design: `readFile`, `writeFile` (flag `wx` raises an error with `code` `EEXIST`), `rename` (atomic replace), `rm`, `mkdir`, `readdir`, `stat` (with `mtimeMs`), `chmod`, `realpath`. Files are a map from normalised path to `{content, mtimeMs, readOnly}`. A missing file raises an error with `code` `ENOENT`. A read-only file refuses `rm` until `chmod 0o666`. A fake clock `{nowMs, advance(ms)}` sets `mtimeMs`.
    - Add an optional gate: every operation first awaits `gate(label)`, so a test can pass a scheduler that decides which writer's next operation proceeds (design Testing Strategy, "interleaving"). Export `makeScheduler(choices)`: given an array of 0s and 1s, it lets writer 0 or writer 1 take its next step. Document in JSDoc that `sleep` in tests advances the fake clock and yields.
    - Create `tests/replay.fake-fs.test.mjs` with unit tests: `wx` raises `EEXIST`, a rename replaces, a missing file raises `ENOENT`, a read-only file needs `chmod` before `rm`, the scheduler runs two writers in the given order.
    - Command: `npx vitest --run tests/replay.fake-fs.test.mjs`. Expected: passes (the helper and its test are written together in this task). Then `npm run typecheck`.
    - _Requirements: 13.2, 10.9_

  - [x] 1.3 Write `tests/replay.arbitraries.mjs`
    - Create `tests/replay.arbitraries.mjs` (`// @ts-check`, imports `fast-check`). Export the arbitraries named in the design: `arbIndexEntry` (counter 1 to 200, `runId` from the counter, one of the four states, start times in a fixed range, counts 0 to 8), `arbLevelEntry` (a ReplayOk shape or an error entry with a runner or verifier code, `timedOut` sometimes true), `arbRunRecord` (built from `arbLevelEntry` lists with consistent counts and coverage), `arbConfig` (a JSON object with random foreign keys and, sometimes, an existing `playtesterResults` holding `findings` and an unknown sub-key), `arbRunHistory` (0 to 60 records with increasing counters, plus a size-stress variant with long reason texts), `arbLevelList` (0 to 8 ids from a valid pool and an invalid pool, with duplicates), and `arbInvalidLevelId` (includes `..`, a path separator, a space, an upper-case letter, an empty string, a non-string).
    - Valid inputs are built by construction, never filtered with `fc.pre`.
    - Exercised first by the tests of tasks 2 to 7 (this file has no test of its own).
    - Run `npm run typecheck`. It must pass.
    - _Requirements: 13.5, 13.6_

  - [x] 1.4 Capture a real `--list` output into `tests/fixtures/list.json` (read only against Grimsheet)
    - In PowerShell set `$g = (Resolve-Path ../grimsheet).Path` and `$r = (Get-Location).Path` (both absolute). Check that `$g\dist-play\headless.js` exists with `Test-Path`. If it does not, STOP and report to the user. Do not build in `../grimsheet`, and write nothing under it.
    - Run `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)` in the same session, then `$out = node "$g\scripts\play.mjs" --list` and read `$LASTEXITCODE` on the very next line. It must be 0; otherwise STOP and report.
    - Join the output lines with a newline and write `$r\tests\fixtures\list.json` with `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))` (no BOM).
    - Read the file with the file-reading tool and check it is JSON of the shape `{"levels": ["<id>", ...]}` with ids that match `^[a-z0-9][a-z0-9-]*$` and that it includes `01-the-corridor`, `02-the-chaser` and `03-the-locked-crypt`. If the shape differs from the design (for example another top-level key), STOP and report to the user before any `levels.mjs` code is written.
    - Success is the exit code and the JSON, not stderr text.
    - _Requirements: 13.4, 4.4_

  - [x] 1.5 Write the fake process starter helper
    - Create `tests/helpers/fake-spawn.mjs` (`// @ts-check`) exporting `makeFakeSpawn(table)`: a `StartProcess` that looks up a `ProcResult` by `command` plus the leading `args`, records every call (`{command, args, cwd, shell, timeoutMs, label}`) in `calls`, and can be told to fail, to exit non-zero, to hang (`timedOut: true`) or to be unable to start (`startError`). Export `makeFakeGrimsheet(options)` that builds a table with: fake git (`clone`, `fetch`, `reset`, `rev-parse HEAD` returning the first line of `tests/fixtures/GRIMSHEET_COMMIT.txt`, `remote get-url`), fake npm (`ci`, `run build:play`), a `--list` answer built from `tests/fixtures/list.json`, and a Fake_Play_Command that maps a level id to a canned stdout and exit code from `tests/fixtures/*.play.json` and `manifest.json`. Fixtures are read only through `node:fs`.
    - Create `tests/replay.fake-spawn.test.mjs` with unit tests: the lookup, the call record, the hang and the start error.
    - Command: `npx vitest --run tests/replay.fake-spawn.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 13.2, 13.3_

- [x] 2. Run-record module (pure)
  - [x] 2.1 Write the failing unit tests for `run-record.mjs`
    - Create `tests/replay.run-record.test.mjs`. Import from `../scripts/replay/run-record.mjs` (the module does not exist yet) and `tests/replay.arbitraries.mjs`.
    - Cases: `levelEntryFromVerdict` copies a ReplayOk's eight fields unchanged and adds `timedOut` only when true; for a ReplayError it keeps `levelId`, colour `error`, `reasonCode`, `reason`; `levelEntryError` for `no_solution_file`, `solution_unreadable`, `not_played`; `countColours`; `newRunRecord` (state `running`, counts 0, `levels` empty, `resultsKey` null); `finalizeRecord` returns a new object and leaves the input unchanged; `indexEntryOf`, `trendEntryOf` (map of level id to colour), `trendEntryFromIndexEntry` (empty `levels` map), `compactLatest` (keys absent in the source are left out, not `null`; `timedOut` only when true); `buildResultsKey` keeps foreign sub-keys of `existingTop` in the size count, trims the oldest trend entries first, stops at one entry and then returns `{ok:false}`; `byteLength` is the UTF-8 length of the JSON text (use a non-ASCII string).
    - Command: `npx vitest --run tests/replay.run-record.test.mjs`. Expected: fails (module missing).
    - _Requirements: 5.5, 5.6, 5.7, 5.8, 9.1, 9.2, 9.4, 9.5, 9.9, 9.11, 7.2, 8.2_

  - [x] 2.2 Implement `scripts/replay/run-record.mjs`
    - Create `scripts/replay/run-record.mjs` (`// @ts-check`, no I/O, no imports of real modules) with the exports of the design: `SCHEMA_VERSION`, `BYTE_BUDGET` (65536), `MAX_RUNS` (30), `levelEntryFromVerdict`, `levelEntryError`, `countColours`, `newRunRecord`, `finalizeRecord`, `indexEntryOf`, `trendEntryOf`, `trendEntryFromIndexEntry`, `compactLatest`, `buildResultsKey`, `byteLength`, and the private `pick`. Follow the "Compact forms" and "Trend building and trimming" algorithms exactly. The runner never computes a colour.
    - Command: `npx vitest --run tests/replay.run-record.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 5.5, 5.6, 5.7, 5.8, 9.1, 9.2, 9.4, 9.5, 9.9, 9.11, 7.2, 8.2_

  - [x] 2.3 Write property test for the trend
    - Append to `tests/replay.run-record.test.mjs`. Tag `// Feature: replay-runner, Property 9: Trend keeps the newest`. One `fc.assert`, `numRuns` 100 or more, over `arbRunHistory` and a generated budget. If it fails, STOP and report the counterexample; never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen the expectation.
    - **Property 9: Trend keeps the newest** — for any Run history and any budget, `buildResultsKey` returns a `trend` sorted Newest first, and any entry the trimming drops has a lower counter than every entry it keeps.
    - **Validates: Requirements 9.2, 9.18**
    - Command: `npx vitest --run tests/replay.run-record.test.mjs`. Expected: passes.
    - _Requirements: 9.2, 9.18_

- [x] 3. Index store
  - [x] 3.1 Write the failing unit tests for `index-store.mjs`
    - Create `tests/replay.index-store.test.mjs`. Import from `../scripts/replay/index-store.mjs` (missing) and the helpers `tests/helpers/fake-fs.mjs`, `tests/replay.arbitraries.mjs`.
    - Cases on the fake file system: `runIdOf(42)` is `run-000042`; `RESULT_FILE_PATTERN` matches `run-000042.json` and `run-1000000.json` but not a temp file name; `insertEntry` keeps 30, newest first, replaces a repeated `runId`; `markCutShort` changes only old `running` entries; `loadOrRebuildIndex` rebuilds from Result_Files when the Index_File is missing or unparsable, ignores a Result_File that does not parse, and sets `lastCounter` to the highest counter in names or entries; `writeResultFile` and `writeIndex` write a temp file then rename, UTF-8, no BOM, two-space indent, trailing newline; `readResultFile` returns `null` for missing or bad JSON; `pruneResultFiles` deletes only files that match the pattern and have no Index_Entry; `startRun` follows step 4 of the design (marks stale `running` Runs `cut-short` and rewrites their Result_Files with `finishedAt` left `null`, takes the counter as `max(lastCounter, highest name) + 1`, writes the Index_File before the running Result_File, prunes); `finishRunInIndex` updates the entry. Add one smoke test in a real temp folder (`fs.mkdtemp` under `os.tmpdir()`, removed afterwards) for the atomic rename.
    - Command: `npx vitest --run tests/replay.index-store.test.mjs`. Expected: fails (module missing).
    - _Requirements: 7.1, 7.8, 7.9, 7.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

  - [x] 3.2 Implement `scripts/replay/index-store.mjs`
    - Create `scripts/replay/index-store.mjs` (`// @ts-check`) with the exports of the design: `RESULT_FILE_PATTERN`, `runIdOf`, `insertEntry`, `markCutShort`, `loadOrRebuildIndex`, `writeResultFile`, `readResultFile`, `writeIndex`, `pruneResultFiles`, `startRun`, `finishRunInIndex`. It uses only `deps.fs`, `deps.paths` and the pure functions of `run-record.mjs`. Temp files are named `.<name>.<token>.tmp` so pruning never touches them (Decision 18). The caller holds the results lock; this module takes no lock itself.
    - If a needed `fs` method is missing from the helper of task 1.2, STOP and report.
    - Command: `npx vitest --run tests/replay.index-store.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 7.1, 7.8, 7.9, 7.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

  - [x] 3.3 Write property test for the index bound
    - Append to `tests/replay.index-store.test.mjs`. Tag `// Feature: replay-runner, Property 1: Index bound and newest kept`. `numRuns` 100 or more. If it fails, STOP and report the counterexample; never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen the expectation.
    - **Property 1: Index bound and newest kept** — for any sequence of Index_Entries with distinct counters inserted in any number, the Index_File never holds more than 30 entries, and the entries it holds are exactly those with the highest counters, listed Newest first.
    - **Validates: Requirements 8.2, 8.5, 8.6, 8.8, 8.11**
    - Command: `npx vitest --run tests/replay.index-store.test.mjs`. Expected: passes.
    - _Requirements: 8.2, 8.5, 8.6, 8.8, 8.11_

  - [x] 3.4 Write property test for unique Run_Ids
    - Append to `tests/replay.index-store.test.mjs`. Tag `// Feature: replay-runner, Property 2: Unique Run_Ids`. `numRuns` 100 or more. Failure rule as in task 3.3: STOP and report; never narrow, `fc.pre`, lower `numRuns` or loosen.
    - **Property 2: Unique Run_Ids** — for any sequence of insertions, including repeated insertions of the same Run_Id, the Index_Entries have unique Run_Ids.
    - **Validates: Requirements 8.12**
    - _Requirements: 8.12_

  - [x] 3.5 Write property test for insertion order
    - Append to `tests/replay.index-store.test.mjs`. Tag `// Feature: replay-runner, Property 3: Insertion order does not matter`. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 3: Insertion order does not matter** — for any set of Runs and any two orders of inserting them, the set of kept Runs is the same.
    - **Validates: Requirements 8.13**
    - _Requirements: 8.13_

  - [x] 3.6 Write property test for counters
    - Append to `tests/replay.index-store.test.mjs`. Tag `// Feature: replay-runner, Property 4: Counters strictly increase`. `numRuns` 100 or more. Use the fake file system and generated sequences of `startRun`, eviction, failed Runs, `cut-short` marking and a deleted or corrupted Index_File (rebuild). Failure rule as in task 3.3.
    - **Property 4: Counters strictly increase** — for any sequence of Runs, including eviction, failed Runs, `cut-short` marking and a rebuild of the Index_File from the Result_Files, each Run_Counter issued is greater than every counter issued before.
    - **Validates: Requirements 8.3, 8.4, 8.14**
    - _Requirements: 8.3, 8.4, 8.14_

  - [x] 3.7 Write property test for idempotent cut-short marking
    - Append to `tests/replay.index-store.test.mjs`. Tag `// Feature: replay-runner, Property 5: Cut-short marking is idempotent and spares final states`. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 5: Cut-short marking is idempotent and spares final states** — for any set of stored entries and any clock time, marking twice gives the same result as marking once, and every entry in state `complete`, `failed` or `cut-short` is unchanged.
    - **Validates: Requirements 7.8, 7.12**
    - _Requirements: 7.8, 7.12_

  - [x] 3.8 Write property test for young running Runs
    - Append to `tests/replay.index-store.test.mjs`. Tag `// Feature: replay-runner, Property 6: Young running Runs are unchanged`. `numRuns` 100 or more. Failure rule as in task 3.3. Then run `npm run typecheck`.
    - **Property 6: Young running Runs are unchanged** — for any entry in state `running` whose age is not above `cronTimeoutSec`, marking leaves it unchanged; an older `running` entry becomes `cut-short`.
    - **Validates: Requirements 7.8, 7.13**
    - _Requirements: 7.8, 7.13_

- [x] 4. Level list and coverage
  - [x] 4.1 Write the failing unit tests for `levels.mjs`
    - Create `tests/replay.levels.test.mjs`. Import from `../scripts/replay/levels.mjs` (missing). Read `tests/fixtures/list.json` (from task 1.4) with `node:fs`, parse it, and feed it to `parseLevelList`; expect `ok` with the ids in order. Also build `{"levels": [...]}` shapes by hand for the failure cases.
    - Cases: `isValidLevelId` for valid ids and for `..`, `a/b`, `a\\b`, a space, an upper-case letter, an empty string, a number; `parseLevelList` for non-zero exit, `undefined` output, a missing `levels` key, a non-array, a non-string id, an invalid id (`list_failed`), an empty list (`empty_level_list`), duplicates (kept once, listed in `duplicates`); `readSolution` for `ok` (returns the path and the parsed value from one read), `no_file`, `unreadable` (bad JSON), using the fake file system and the solution copies in `tests/fixtures/solutions/`; `findUnlisted` (sorted ids of `tests/solutions/*.json` not in the list); `buildCoverage` counts `listed`, `played`, `noSolution`, `unreadable`, `unlisted` and carries `duplicateListedLevels` and `unlistedSolutions`.
    - Command: `npx vitest --run tests/replay.levels.test.mjs`. Expected: fails (module missing).
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.10, 6.1, 6.2, 6.3, 6.4, 6.5, 5.10_

  - [x] 4.2 Implement `scripts/replay/levels.mjs`
    - Create `scripts/replay/levels.mjs` (`// @ts-check`) with the exports of the design: `LEVEL_ID_PATTERN` (`/^[a-z0-9][a-z0-9-]*$/`), `isValidLevelId`, `parseLevelList`, `readSolution`, `findUnlisted`, `buildCoverage`. The id is validated before it is used in any path (Requirement 4.10).
    - Command: `npx vitest --run tests/replay.levels.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.10, 6.1, 6.2, 6.3, 6.4, 6.5, 5.10_

  - [x] 4.3 Write property test for one entry per distinct listed id
    - Append to `tests/replay.levels.test.mjs`. Tag `// Feature: replay-runner, Property 15: One entry per distinct listed id`. `numRuns` 100 or more. Over `arbLevelList` and generated sets of solution files (missing, unreadable, valid, unlisted), apply the pure per-level decision (`readSolution`, `buildCoverage`) and check the count, the order and that an id with no usable solution has no play request. The whole-Run version of this property is exercised again in task 10.4. If it fails, STOP and report the counterexample; never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen the expectation.
    - **Property 15: One entry per distinct listed id** — for any Level_List (with duplicates) and any set of solution files, the number of Level_Entries equals the number of distinct listed ids, in list order, and an id with no usable solution never starts a play process.
    - **Validates: Requirements 4.7, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 11.5**
    - _Requirements: 4.7, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 11.5_

  - [x] 4.4 Write property test for level id validation
    - Append to `tests/replay.levels.test.mjs`. Tag `// Feature: replay-runner, Property 16: Level ids are validated before use`. `numRuns` 100 or more. Over generated list outputs and `arbInvalidLevelId`. Failure rule as in task 4.3.
    - **Property 16: Level ids are validated before use** — for any list output, the Level_List is accepted only when it is a `{levels: string[]}` object whose ids all match `^[a-z0-9][a-z0-9-]*$`, and for any id that fails the pattern, no process is started and no path is built.
    - **Validates: Requirements 4.5, 4.10**
    - _Requirements: 4.5, 4.10_

- [x] 5. Process arithmetic and starter
  - [x] 5.1 Write the failing unit tests for `process.mjs`
    - Create `tests/replay.process.test.mjs`. Import from `../scripts/replay/process.mjs` (missing).
    - Cases: `STEP_LIMITS_MS` values (git fetch 120000, npm ci 180000, build 120000, list 30000, play 30000, git 30000); `SAFETY_MARGIN_MS` 60000; `runDeadline(startedAtMs, 900)` equals `startedAtMs + 840000`; `effectiveLimit` for a fixed limit below, equal to and above the time left, and a deadline already passed (0). `makeStartProcess` smoke tests with real tiny `node` children (`process.execPath` with `-e`, fixed script text, no network): stdout and exit code are captured; a child that sleeps past a short `timeoutMs` resolves `timedOut: true` and is gone afterwards (tree kill); a command that cannot start resolves `startError` set; stdout over the 16 MiB cap is cut. Assert the start rules by spying on the spawn function passed in `opts`: `git` and `node` use `shell: false`, `npm` uses `shell: true` on `win32` and fixed arguments.
    - Command: `npx vitest --run tests/replay.process.test.mjs`. Expected: fails (module missing).
    - _Requirements: 11.3, 11.4, 4.8, 5.4, 11.6_

  - [x] 5.2 Implement `scripts/replay/process.mjs`
    - Create `scripts/replay/process.mjs` (`// @ts-check`) with `STEP_LIMITS_MS`, `SAFETY_MARGIN_MS`, `effectiveLimit`, `runDeadline` and `makeStartProcess(opts)` (`opts` = `{platform, setTimeoutFn, clearTimeoutFn}` plus an injectable `spawnFn` that defaults to `node:child_process.spawn`). Tree kill on Windows: `taskkill /PID <pid> /T /F` through a second spawn with `shell: false`; on other hosts start `detached` and kill with `process.kill(-pid, 'SIGKILL')` (untested branch, noted in the README by `packaging`). Output is capped at 16 MiB.
    - Command: `npx vitest --run tests/replay.process.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 11.3, 11.4, 4.8, 5.4, 11.6_

  - [x] 5.3 Write property test for the step limit
    - Append to `tests/replay.process.test.mjs`. Tag `// Feature: replay-runner, Property 18: Step limit is the smaller of the fixed limit and the time left`. `numRuns` 100 or more. If it fails, STOP and report the counterexample; never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen the expectation.
    - **Property 18: Step limit is the smaller of the fixed limit and the time left** — for any fixed limit, time and deadline, `effectiveLimit` equals `max(0, min(fixed, deadline - now))`.
    - **Validates: Requirements 11.3, 11.4**
    - _Requirements: 11.3, 11.4_

- [x] 6. File lock
  - [x] 6.1 Write the failing unit tests for `file-lock.mjs`
    - Create `tests/replay.file-lock.test.mjs`. Import from `../scripts/file-lock.mjs` (missing) and `tests/helpers/fake-fs.mjs`.
    - Cases: a first take succeeds and the file holds `{pid, token, createdAt}` (32 hex characters in the token, no BOM); a fresh lock with `waitMs` 0 gives `held`; with a wait and a fresh lock the call retries every 200 ms (fake `sleep` advances the clock) and returns `timeout`; a stale lock (older than `staleAfterMs`, age from `createdAt`, or from the modification time when the content does not parse) is moved to `<lock>.stale-<token>`, removed, and the take succeeds; a moved lock whose content differs from the one read is put back; any other file-system error gives `io_error`; `releaseLock` removes the file only when it holds the token and returns `false` otherwise; `lockCreatedMs` for valid JSON, bad JSON and missing content.
    - Command: `npx vitest --run tests/replay.file-lock.test.mjs`. Expected: fails (module missing).
    - _Requirements: 7.14, 7.15, 7.16, 7.17, 10.2, 10.3, 10.4, 10.6_

  - [x] 6.2 Implement `scripts/file-lock.mjs`
    - Create `scripts/file-lock.mjs` (`// @ts-check`) with `acquireLock`, `releaseLock` and `lockCreatedMs`, following the "Stale-lock takeover" algorithm of the design exactly. Uses only `deps.fs`, `deps.clock`, `deps.sleep`, `deps.token`, `deps.pid`.
    - Command: `npx vitest --run tests/replay.file-lock.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 7.14, 7.15, 7.16, 7.17, 10.2, 10.3, 10.4, 10.6_

- [x] 7. Results store (Write_Module)
  - [x] 7.1 Write the failing unit tests for `results-store.mjs`
    - Create `tests/replay.results-store.test.mjs`. Import from `../scripts/results-store.mjs` (missing), the fake file system and the arbitraries.
    - Cases for `mergeTopKey`: `config.json` missing (created holding only the top key); parsed object with foreign keys (kept); unparsable, not an object, and BOM-prefixed (`config_unreadable`, file untouched); an existing `findings` sub-key and an unknown sub-key (kept; `findings` not created when absent); too large (`too_large`, file untouched); a lock that cannot be taken in 10 s (`lock_timeout`, nothing written); a failing rename or temp write (`write_failed`); the lock is released after success, after `config_unreadable`, and when `buildOwned` throws; a lock is removed only by its owner's token; output has no BOM. Cases for `withResultsLock` (does not nest, returns the value or `lock_timeout`) and `RESULTS_LOCK_FILE` equal to `.results.lock`.
    - Command: `npx vitest --run tests/replay.results-store.test.mjs`. Expected: fails (module missing).
    - _Requirements: 9.12, 9.13, 9.14, 9.15, 9.22, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

  - [x] 7.2 Implement `scripts/results-store.mjs`
    - Create `scripts/results-store.mjs` (`// @ts-check`) with `RESULTS_LOCK_FILE`, `withResultsLock` and `mergeTopKey`, following the "Config merge" algorithm of the design (lock with 200 ms retry, 10 s wait, 60 s stale; read, parse, `buildOwned`, size check, temp file `data\.config.<token>.tmp`, rename; release in `finally`). It never sends an HTTP request (Requirement 9.16).
    - Command: `npx vitest --run tests/replay.results-store.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 9.12, 9.13, 9.14, 9.15, 9.16, 9.22, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

  - [x] 7.3 Write property test for the Byte_Budget
    - Append to `tests/replay.results-store.test.mjs`. Tag `// Feature: replay-runner, Property 8: Results_Key fits the Byte_Budget`. `numRuns` 100 or more, over `arbRunHistory` (including the size-stress variant) and `arbConfig`, running `mergeTopKey` on the fake file system with `buildResultsKey`. If it fails, STOP and report the counterexample; never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen the expectation.
    - **Property 8: Results_Key fits the Byte_Budget** — for any Run history and any existing `config.json`, when a merge reports `ok`, the serialised top-level value is at most 65536 bytes; when even one trend entry does not fit, the file is left unchanged and the outcome is `too_large`.
    - **Validates: Requirements 9.5, 9.6, 9.9, 9.11, 9.17**
    - _Requirements: 9.5, 9.6, 9.9, 9.11, 9.17_

  - [x] 7.4 Write property test for foreign keys
    - Append to `tests/replay.results-store.test.mjs`. Tag `// Feature: replay-runner, Property 10: Foreign keys survive a merge`. `numRuns` 100 or more, over `arbConfig`. Failure rule as in task 7.3.
    - **Property 10: Foreign keys survive a merge** — for any `config.json` object, a merge leaves every top-level key other than the Results_Key deeply equal, and every sub-key of the Results_Key other than `schemaVersion`, `updatedAt`, `latest` and `trend` deeply equal; `findings` is not created when absent.
    - **Validates: Requirements 9.3, 9.4, 9.19**
    - _Requirements: 9.3, 9.4, 9.19_

  - [x] 7.5 Write property test for merge idempotence
    - Append to `tests/replay.results-store.test.mjs`. Tag `// Feature: replay-runner, Property 11: Merge is idempotent`. `numRuns` 100 or more; the clock is fixed so `updatedAt` is the same. Failure rule as in task 7.3.
    - **Property 11: Merge is idempotent** — for any Run history and any `config.json`, merging the same Run twice gives the same file content as merging once.
    - **Validates: Requirements 9.12, 9.20**
    - _Requirements: 9.12, 9.20_

  - [x] 7.6 Write property test for the round trip
    - Append to `tests/replay.results-store.test.mjs`. Tag `// Feature: replay-runner, Property 12: Results_Key round trip`. `numRuns` 100 or more. Failure rule as in task 7.3.
    - **Property 12: Results_Key round trip** — for any Results_Key built from generated Run histories, parsing the written `config.json` and reading the Results_Key gives a value deeply equal to the value written, and the file has no BOM.
    - **Validates: Requirements 9.13, 9.21**
    - _Requirements: 9.13, 9.21_

  - [x] 7.7 Write property test for two writers (scripted interleaving)
    - Append to `tests/replay.results-store.test.mjs`. Tag `// Feature: replay-runner, Property 13: Two writers with different owned sub-keys`. `numRuns` 100 or more. Use the in-memory fake file system with the gate scheduler of task 1.2: two `mergeTopKey` calls (one owns `latest` and `trend`, one owns `findings`), a generated array of 0s and 1s decides which writer's next operation proceeds, the shared fake clock, and a fake `sleep` that advances the clock and yields. Failure rule as in task 7.3. Then run `npm run typecheck`.
    - **Property 13: Two writers with different owned sub-keys** — for any scripted interleaving of two writers, the final file holds the last value written by each writer and every other key unchanged; the lock file does not exist at the end unless a writer still holds it; and a lock is removed only by a holder of its token.
    - **Validates: Requirements 7.17, 10.6, 10.10, 10.11**
    - _Requirements: 7.17, 10.6, 10.10, 10.11_

- [x] 8. Checkpoint - pure modules
  - [x] 8.1 Ensure `npm test` and `npm run typecheck` both pass
    - Run `npm test`, then `npm run typecheck`. Both must pass for everything built so far (tasks 1 to 7). Ask the user if questions arise.
    - _Requirements: 13.1_

- [x] 9. Checkout
  - [x] 9.1 Write the failing unit tests for `checkout.mjs`
    - Create `tests/replay.checkout.test.mjs`. Import from `../scripts/replay/checkout.mjs` (missing), `tests/helpers/fake-spawn.mjs` and the fake file system.
    - Cases: `assertAllowedGit` accepts `clone`, `fetch`, `reset`, `rev-parse`, `remote get-url` and throws for `push`, `commit`, `branch`, `tag`, `status`, `remote add`, `remote set-url`; `checkoutPath` builds `<localAppData>\<appName>\grimsheet` and returns `null` for an empty `localAppData`; `checkDeletable` for a good path, a path outside `LOCALAPPDATA`, a path not ending in `<App_Name>\grimsheet`, a path inside the App_Folder or Data_Folder (`checkout_inside_app`); `ensureCheckout` for: no checkout (shallow clone with `--depth 1`), existing valid checkout (shallow fetch of the branch, hard reset, `rev-parse HEAD` read into `commit`), wrong `origin` or not a repository (read-only attributes cleared, folder removed, new clone), a delete that still fails (`checkout_delete_failed`), `no_local_app_data`, `git_not_found` (`startError`), `git_failed` with the exit code, a git step over its limit (`step_timeout` with `step`), and text on stderr with exit 0 is not a failure. Check git and node are started with `shell: false` and an argument array.
    - Command: `npx vitest --run tests/replay.checkout.test.mjs`. Expected: fails (module missing).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 14.7_

  - [x] 9.2 Implement `scripts/replay/checkout.mjs`
    - Create `scripts/replay/checkout.mjs` (`// @ts-check`) with `ALLOWED_GIT`, `assertAllowedGit`, `checkoutPath`, `checkDeletable`, `ensureCheckout`, `forceRemove` as in the design. Every git call passes through `assertAllowedGit`. The delete runs only after `checkDeletable` passes. Failures return `{ok:false, failure}` with the reason codes of the design table.
    - Command: `npx vitest --run tests/replay.checkout.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 14.7_

  - [x] 9.3 Write property test for allowed git subcommands
    - Append to `tests/replay.checkout.test.mjs`. Tag `// Feature: replay-runner, Property 17: Only allowed git subcommands`. `numRuns` 100 or more, over generated checkout states (missing, valid, wrong origin, not a repository) and generated git outcomes. If it fails, STOP and report the counterexample; never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen the expectation.
    - **Property 17: Only allowed git subcommands** — for any run of `ensureCheckout` over generated checkout states, every git invocation the fake spawn sees has a subcommand from the allowed list, and none is `push`, `commit`, `branch`, `tag`, `status`, `remote add` or `remote set-url`.
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.9**
    - _Requirements: 3.4, 3.5, 3.6, 3.9_

- [x] 10. Orchestrator `run.mjs`
  - [x] 10.1 Write the failing unit tests for `runReplay`
    - Create `tests/replay.run.test.mjs`. Import `runReplay` from `../scripts/replay/run.mjs` (missing), the fake file system, `tests/helpers/fake-spawn.mjs` (`makeFakeGrimsheet`) and a table-driven verifier stub.
    - Cases: a full `complete` Run (Result_File, Index_Entry, `playtesterResults` in `config.json`, stdout line `{runId, state, commit}`, exit 0); each failure stage with its reason code and exit code in `failure` (`checkout`, `install`, `build`, `list`, `replay`, `record`); `step_timeout` with `step`; a Level_Entry of colour `error` never fails the Run; `no_solution_file` and `solution_unreadable` start no play process; a timed-out play gives `timedOut: true`, the verdict from the stub with a non-number exit code, and the Run is not failed; `deadline_reached` with `not_played` entries and the entry count equal to the distinct listed ids; no time left before a non-play step gives `step_timeout` (Decision 14); the order of writes in step 8 (final Result_File with `resultsKey` null, then the Index_Entry, then `config.json`, then the Result_File rewritten with the outcome), and each `resultsKey` value (`ok`, `too_large`, `config_unreadable`, `lock_timeout`, `write_failed`); an unexpected throw gives `record` and `internal_error` and still writes the files; a fresh Run_Lock_File gives `{"state":"already_running"}` and exit 3 with `data\` byte-for-byte unchanged and the Checkout untouched; a stale lock is taken over; the lock is released only with the owner's token and also after an internal error; a Result_File write failure gives `{"state":"record_failed"}` and exit 4; the verifier stub is called with exactly four arguments and only `replayVerdict` is used; `previousLaunch` copies `outcome` and `finishedAt` from `last-launch.json` or is `null`; the solution is read once and its path is the one passed to `play.mjs`.
    - Command: `npx vitest --run tests/replay.run.test.mjs`. Expected: fails (module missing).
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.9, 5.10, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.14, 7.15, 7.16, 7.17, 9.11, 9.15, 10.5, 11.5, 11.6, 11.7, 13.7, 13.8, 13.11, 14.4, 14.5_

  - [x] 10.2 Implement `scripts/replay/run.mjs`
    - Create `scripts/replay/run.mjs` (`// @ts-check`) with `runReplay(deps, args)` and the private steps `startRecord`, `runStages`, `replayLevels`, `finish`, in the order of operations in the design (steps 1 to 10): Run_Lock_File first, `previousLaunch`, start of the record in one hold of the results lock, checkout, `npm ci`, `npm run build:play`, `--list`, replay with a deadline check before each level, finish in the four writes, release in `finally`. It takes everything from `deps` and `args`; it never reads `process.env`, `process.argv`, the real clock or the real file system. It calls the verifier only through `deps.verifier(levelId, stored, exitCode, play)` with exactly four arguments and never computes a colour.
    - If the design cannot be implemented as written (a verifier shape differs, a fixture contradicts it), STOP and report.
    - Command: `npx vitest --run tests/replay.run.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.9, 5.10, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.14, 7.15, 7.16, 7.17, 9.11, 9.15, 10.5, 11.5, 11.6, 11.7, 11.8, 14.4, 14.5_

  - [x] 10.3 Write property test for determinism of Level_Entries
    - Append to `tests/replay.run.test.mjs`. Tag `// Feature: replay-runner, Property 14: Same play output gives the same Level_Entries`. `numRuns` 100 or more, over `arbLevelList`, generated solution files and canned play outputs and exit codes, with a table-driven verifier stub that returns generated ReplayOk or ReplayError values. Failure rule: if it fails, STOP and report the counterexample; never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen the expectation.
    - **Property 14: Same play output gives the same Level_Entries** — for any Level_List, set of solution files and canned play outputs and exit codes, running the Replay_Script twice gives deeply equal Level_Entries, and each ReplayOk entry's fields equal the verdict's fields (the colour is never computed by the runner).
    - **Validates: Requirements 5.5, 5.6, 5.7, 5.9, 5.11**
    - _Requirements: 5.5, 5.6, 5.7, 5.9, 5.11_

  - [x] 10.4 Write property test for overlapping Runs (scripted interleaving)
    - Append to `tests/replay.run.test.mjs`. Tag `// Feature: replay-runner, Property 7: Overlap records nothing`. `numRuns` 100 or more. Use the in-memory fake file system with the gate scheduler of task 1.2: (a) for any file-system state with a Run_Lock_File younger than the Cron_Timeout, a starting Run returns `already_running` and leaves every file under `data\` and the Checkout byte-for-byte equal and takes no counter; (b) for two `runReplay` calls with a scripted interleaving of their steps, at most one reaches the checkout stage (count calls to the fake `git clone` and `fetch`). Failure rule as in task 10.3.
    - **Property 7: Overlap records nothing** — for any file-system state with a Run_Lock_File younger than the Cron_Timeout, a starting Run returns `already_running`, leaves every file under `data\` and the Checkout byte-for-byte equal, and takes no counter. For any two Runs started with scripted interleaving of their steps, at most one reaches the checkout stage.
    - **Validates: Requirements 7.14, 7.15, 7.16, 7.18**
    - _Requirements: 7.14, 7.15, 7.16, 7.18_

  - [x] 10.5 Write the integration-style test with the real verifier and the real fixtures
    - Create `tests/replay.run.integration.test.mjs`. It imports the real `replayVerdict` from `../scripts/verifier.mjs` (read only, not edited) and runs `runReplay` with `makeFakeGrimsheet` over the fixtures: levels 01, 02 and 03 from `tests/fixtures/*.play.json` and `solutions/`. The verifier's own fixture test (`tests/verifier.fixtures.test.mjs`) shows that levels 01, 02 and 03 are all green; assert that each of the three Level_Entries is green and that its fields equal the verdict fields the real verifier returns.
    - The solution copies in `tests/fixtures/solutions/` are given to the run through the fake Grimsheet helper, which places them in a temp folder (`fs.mkdtemp` under `os.tmpdir()`, removed afterwards). `tests/fixtures` is never edited.
    - Truncated case: build the stored solution file given to the run from the truncated action list `tests/fixtures/actions/02-the-chaser.truncated.json`, with `minimalInk` 1 and `levelId` `02-the-chaser`, and use `02-the-chaser.truncated.play.json` as the play output. The Level_Entry is `red`. Against the full `02-the-chaser` solution the same truncated play output gives `replay_mismatch`, which is an `error` Level_Entry; one test asserts that too.
    - Listed ids from `tests/fixtures/list.json` that have no solution copy in `tests/fixtures/solutions/` get the `no_solution_file` entry and start no play process; assert that no play call is recorded for them, and that the Run is `complete`.
    - If a real verifier result or a fixture contradicts the design, STOP and report.
    - Command: `npx vitest --run tests/replay.run.integration.test.mjs`. Expected: passes (it exercises finished code). Then `npm run typecheck`.
    - _Requirements: 5.3, 5.5, 5.6, 5.7, 13.3_

- [x] 11. Entry script `replay.mjs`
  - [x] 11.1 Write the failing unit tests for `replay.mjs`
    - Create `tests/replay.entry.test.mjs`. Import `parseArgs` and `buildRealDeps` from `../scripts/replay.mjs` (missing). Importing must not start a Run (`main` runs only when the file is the entry, checked with `import.meta.url`).
    - Cases: `parseArgs` for a good flag set (`--repo-url`, `--branch`, `--cron-timeout` as a positive integer); missing flag, repeated flag, unknown flag, non-numeric or zero timeout all return `null`; `buildRealDeps` returns the keys of `Deps`, `platform` `win32` or `other`, `token()` gives 32 hex characters, and `verifier` is the verifier's `replayVerdict`; `paths.appFolder` is derived from the script location and `paths.dataFolder` is `<appFolder>\data`. Test `main` through an exported helper that takes `argv` and an injected `runReplay`: a bad flag set prints `{"state":"record_failed"}` and sets exit code 4; `runReplay`'s line is printed as one JSON line to stdout and nothing else; exit codes 0, 3 and 4 map as in the design table.
    - Command: `npx vitest --run tests/replay.entry.test.mjs`. Expected: fails (module missing).
    - _Requirements: 1.4, 14.3, 14.4, 14.5_

  - [x] 11.2 Implement `scripts/replay.mjs`
    - Create `scripts/replay.mjs` (`// @ts-check`) with `parseArgs`, `buildRealDeps` (real `node:fs/promises`, `crypto.randomBytes(16).toString('hex')`, `process.pid`, `process.env.LOCALAPPDATA` or an empty string, `makeStartProcess`, and `replayVerdict` imported from `./verifier.mjs`) and `main` (calls `runReplay`, prints the one JSON line, sets `process.exitCode`). This is the only file that imports the verifier at run time. Do not edit `scripts/verifier.mjs`.
    - Command: `npx vitest --run tests/replay.entry.test.mjs`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 1.4, 14.1, 14.3, 14.4, 14.5_

- [x] 12. Python Launcher
  - [x] 12.1 Check the import path and write the failing Launcher tests
    - Create `tests/test_replay_cron.py` with `unittest`. It imports the Launcher as `from scripts import replay_cron` (namespace packages: no `__init__.py` files are added). From the repo root run `python -m unittest tests.test_replay_cron`. Expected at this point: it fails because `scripts/replay_cron.py` does not exist (an `ImportError` naming `replay_cron`), not because `tests` or `scripts` cannot be imported as namespace packages. If `tests.test_replay_cron` itself cannot be found or imported, STOP and ask the user; do not add files outside `scripts/` and `tests/` without asking.
    - `__pycache__` is not in `.gitignore`. Adding the line `__pycache__/` is approved, so do not ask. Read `.gitignore` first and add the line only if it is missing, keeping every other line. This is a file edit, not a git command.
    - Write the test cases listed in the design's Python Launcher section, using `unittest.mock.patch.object` on the seams `_spawn`, `_kill_tree`, `_now`, `_sleep` and `_data_dir`, a fake child with `pid`, `poll()` and `kill()`, and a temporary folder from `tempfile.mkdtemp` (removed with `shutil.rmtree` in `tearDown`) for `data/`: child arguments are exactly `node`, the script path, `--repo-url`, URL, `--branch`, name, `--cron-timeout`, `900`; `cwd` is the app folder; no shell, no `env`, no pipes (`stdout` and `stderr` are the same file object); `run(object())` and `run()` behave the same and a dummy that raises on any attribute access does not fail; `last-child.log` is open when `_spawn` is called, closed after, overwritten at the next launch, and not parsed; `childLog` `ok`; log unavailable (opening raises `OSError`) starts the child with `subprocess.DEVNULL` and records `unavailable`; paths come from `__file__`, not from the working directory (change it in the test); Control_File missing, invalid JSON, BOM-prefixed, a JSON array, a field of the wrong type (per-field default), valid, and the file is never created or changed; `last-launch.json` has the expected fields, no BOM, and is written before the exception is raised; exit 0 returns; exit 3 raises with "already running" and the file has `exitCode` 3; exit 1 raises; spawn failure raises; a child that never exits raises after `KILL_AFTER` seconds with outcome `killed-by-launcher` and `_kill_tree` called; the raised exception is a plain `RuntimeError`, never a Done or Skip type.
    - Command: `python -m unittest tests.test_replay_cron`. Expected: fails (module missing).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 13.9_

  - [x] 12.2 Implement `scripts/replay_cron.py`
    - Create `scripts/replay_cron.py` (standard library only) with the constants `CRON_TIMEOUT = 900`, `KILL_AFTER = CRON_TIMEOUT - 5`, `DEFAULT_REPO_URL`, `DEFAULT_BRANCH`, the seams `_spawn`, `_kill_tree` (`taskkill /PID <pid> /T /F` through `subprocess.run` with an argument list, fallback `proc.kill()`), `_now`, `_sleep`, `_data_dir`, and `def run(ctx=None)` following steps 1 to 8 of the Launcher design. Paths come from `__file__`. `last-launch.json` is written atomically (temp file in `data/launcher/`, then `os.replace`), without a BOM, before any raise. The Launcher never writes the Control_File and never raises the runner's Done or Skip.
    - End the file with `if __name__ == "__main__": run()`, so that `python scripts/replay_cron.py` starts a run.
    - Add a unittest to `tests/test_replay_cron.py`: importing the module does not start a run. Use `importlib` for a fresh import (remove the module from `sys.modules` first) with the spawn seam patched, and assert the fake spawn is never called on import (equivalently, that no child process is started).
    - Command: `python -m unittest tests.test_replay_cron`. Expected: passes. Then `npm run typecheck` (it must still pass; the Python file is not part of it).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 12.2, 12.3_

  - [x] 12.3 Check the Launcher against the Node entry flags
    - Add one test to `tests/test_replay_cron.py` that reads `scripts/replay.mjs` as text (read only) and checks it mentions `--repo-url`, `--branch` and `--cron-timeout`, and that `replay_cron.CRON_TIMEOUT` is 900 and `KILL_AFTER` is 895. The `app.json` check belongs to `packaging`.
    - Command: `python -m unittest tests.test_replay_cron`. Expected: passes.
    - _Requirements: 1.4, 11.1, 12.1_

- [x] 13. Final checkpoint
  - [x] 13.1 Ensure all tests and gates pass
    - Run `npm test`, then `npm run typecheck`, then `python -m unittest tests.test_replay_cron`. All three must pass. Confirm with `git status --porcelain` (read only) that nothing under `scripts/verifier.mjs`, `tests/arbitraries.mjs`, `tests/verifier.*.test.mjs`, `package.json` or `tsconfig.json` changed, and that nothing under `../grimsheet` was written. Ask the user if questions arise.
    - _Requirements: 13.1, 13.2, 13.5, 13.9, 14.3_

  - [x] 13.2 Manual smoke run against the real Grimsheet (asks first)
    - Before anything else, STOP and ask the user to confirm this smoke run. Do nothing until the user says yes.
    - Check `.gitignore` first and add the line `data/` only if it is missing (approved), keeping every other line, because the run writes `<repo>\data\`.
    - From the repo root run `python scripts/replay_cron.py`. It clones https://github.com/UBayouski/Grimsheet into `%LOCALAPPDATA%\grimsheet-playtester\grimsheet`. Nothing is written under `../grimsheet`.
    - The Launcher finds the data folder from its own location, so the run writes `<repo>\data\`. In this smoke run the app folder is the repo root. Check that the replay uses this consistently (App_Folder, Data_Folder and the checkout path). If the `checkout_inside_app` rule or the path logic makes the run fail in the repo layout, STOP and report.
    - Read, read only: `data\launcher\last-launch.json`, `data\launcher\last-child.log`, `data\_index.json`, the Result_File and `data\config.json`. Expect: state `complete`, a colour for every listed level, `commit` equal to the remote `main` HEAD (check with `git ls-remote https://github.com/UBayouski/Grimsheet refs/heads/main`, read only), `resultsKey` `ok`, and no lock files left.
    - Run it a second time to exercise the fetch and reset path. Check that the counter went up by one and that the trend has two entries.
    - Report the duration of each stage (from the Result_File times or the log), any warning on stderr, and anything that differs from the design. If a run fails, STOP and report; do not fix code in this task.
    - Packaging must install from a clean clone, because a local `data\` folder would be copied by `kirocrew app install`.
    - The task deletes nothing. The files it creates (`data\` and the checkout under `%LOCALAPPDATA%`) are left in place and listed in the report; cleaning them up is the user's decision.
    - _Requirements: 4.1, 4.2, 5.1, 7.1, 9.12_

- [x] 14. Update `KIRO_USAGE.md`
  - [x] 14.1 Write the replay-runner entry
    - Read `KIRO_USAGE.md` first and follow its entry format (`## YYYY-MM-DD - short title`, then `Surface`, `Features`, `What I asked for`, `What Kiro did`, `What changed because of it`). Append an entry for the replay-runner spec: requirements and design approved, the real `--list` output captured before the code, test-first steps, the 18 properties (tag `pbt`), the in-memory fake file system with scripted interleavings, the Python Launcher with `unittest`, and any decision that changed because of a fixture or a test.
    - Name no tool other than Kiro. Replace any Windows user name or home path with `~`, `%USERPROFILE%` or `%LOCALAPPDATA%`.
    - _Requirements: 13.1_

## Notes

- Out of scope for this plan, and not done by any task: a real run against the gateway, the `app.json` edit (the `replay` cron entry of Requirement 12), the check that `app.json` `timeout` equals `CRON_TIMEOUT`, and the measurement of the config route size limit. They belong to the `packaging` spec.
- The design's Decisions to confirm (for example 11, the lock left after a kill, and 16, `latest` when the Newest Run failed) are implemented as written; no task changes or tests an alternative.
- Tasks that write failing tests (2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 9.1, 10.1, 11.1, 12.1) are expected to fail until the implementation task that follows. This is intended. `npm run typecheck` is run after implementation tasks, because a test that imports a missing module cannot type-check.
- Property 8 is tested at the merge level in `tests/replay.results-store.test.mjs` (task 7.3); the pure `buildResultsKey` budget cases are unit tests in `tests/replay.run-record.test.mjs`. The design's Testing Strategy table lists Property 8 with the run-record file; the merge-level form is what the property states.
- Tasks in the same wave touch different files, but a `npm run typecheck` in one task also type-checks files that another task of the same wave is editing. If the only errors are in a file of another task, finish that task and run the command again.
- A Vitest hook on Windows must start from the real-case working directory of the repo root. This spec adds no hook.
- The smoke run (task 13.2) is the only task that touches the network and the real Grimsheet repo (read only). It is not part of `npm test`. The note above that a real run against the gateway belongs to `packaging` stays true: the smoke run does not use the gateway.
- Only Windows was tested. The non-Windows tree-kill branch of `process.mjs` is untested code.
- No test depends on the network. The only real processes are small `node -e` children in `tests/replay.process.test.mjs`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4"] },
    { "id": 4, "tasks": ["1.5"] },
    { "id": 5, "tasks": ["2.1"] },
    { "id": 6, "tasks": ["2.2"] },
    { "id": 7, "tasks": ["2.3"] },
    { "id": 8, "tasks": ["3.1"] },
    { "id": 9, "tasks": ["3.2"] },
    { "id": 10, "tasks": ["3.3"] },
    { "id": 11, "tasks": ["3.4"] },
    { "id": 12, "tasks": ["3.5"] },
    { "id": 13, "tasks": ["3.6"] },
    { "id": 14, "tasks": ["3.7"] },
    { "id": 15, "tasks": ["3.8"] },
    { "id": 16, "tasks": ["4.1"] },
    { "id": 17, "tasks": ["4.2"] },
    { "id": 18, "tasks": ["4.3"] },
    { "id": 19, "tasks": ["4.4"] },
    { "id": 20, "tasks": ["5.1"] },
    { "id": 21, "tasks": ["5.2"] },
    { "id": 22, "tasks": ["5.3"] },
    { "id": 23, "tasks": ["6.1"] },
    { "id": 24, "tasks": ["6.2"] },
    { "id": 25, "tasks": ["7.1"] },
    { "id": 26, "tasks": ["7.2"] },
    { "id": 27, "tasks": ["7.3"] },
    { "id": 28, "tasks": ["7.4"] },
    { "id": 29, "tasks": ["7.5"] },
    { "id": 30, "tasks": ["7.6"] },
    { "id": 31, "tasks": ["7.7"] },
    { "id": 32, "tasks": ["8.1"] },
    { "id": 33, "tasks": ["9.1"] },
    { "id": 34, "tasks": ["9.2"] },
    { "id": 35, "tasks": ["9.3"] },
    { "id": 36, "tasks": ["10.1"] },
    { "id": 37, "tasks": ["10.2"] },
    { "id": 38, "tasks": ["10.3"] },
    { "id": 39, "tasks": ["10.4"] },
    { "id": 40, "tasks": ["10.5"] },
    { "id": 41, "tasks": ["11.1"] },
    { "id": 42, "tasks": ["11.2"] },
    { "id": 43, "tasks": ["12.1"] },
    { "id": 44, "tasks": ["12.2"] },
    { "id": 45, "tasks": ["12.3"] },
    { "id": 46, "tasks": ["13.1"] },
    { "id": 47, "tasks": ["13.2"] },
    { "id": 48, "tasks": ["14.1"] }
  ]
}
```
