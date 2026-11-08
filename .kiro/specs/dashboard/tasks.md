# Implementation Plan: dashboard

## Overview

This plan builds the Dashboard_Page in `ui/`: a React and Vite project in TypeScript (strict) that builds to one ES module, `ui/dist/index.mjs`. The design states the layers: `src/core/` (pure modules), `src/controller/` (reader, scheduler wiring, clipboard flow; no React and no SDK import), `src/components/` with `src/page.tsx` (a thin layer), and `src/index.tsx` (the entry with the default export). Tests use Vitest and fast-check, with `react-dom/server` for rendering. No test uses a browser or the network.

Order of work: the project and its guards first (versions, install, environment test, fixtures, source scan, base generators), then the pure core in the order json, time, colour, errors, tokens, results, findings, crons, cards, viewmodel, poll, then a checkpoint, then the controller with the fake Env, then the components with `react-dom/server`, then the page and the entry, then the build and `check-dist`, then a final checkpoint and the usage log. Each module is built test-first: one task writes tests that fail, the next makes them pass, and property tests follow the implementation.

Rules that apply to every task:
- Work happens inside `ui/`, plus the files a task names. `app.json` is not edited by any task (that belongs to the `packaging` spec). `scripts/`, the root `tests/`, the root `package.json` and the root `tsconfig.json` are not edited. If a task finds that a root file must change, STOP and ask the user.
- `npm install` runs only inside `ui/`, and only after the user has said yes in task 1.1. `@kirocrew/app-sdk` is never installed. No other task installs anything; if a task needs a new package, STOP and ask.
- Property-test failure rule: every property test uses `numRuns` of at least 100 and a tag `// Feature: dashboard, Property N: <title>`. If a property fails, STOP and report the counterexample to the user. Never narrow an arbitrary, never add `fc.pre`, never lower `numRuns`, never loosen an expectation to make a property pass. Valid inputs are built by construction, and invalid inputs are built by corrupting a valid one.
- If a task finds that the design cannot be implemented as written (a React API differs between versions, a requirement and the design contradict, a fixture contradicts the design), STOP and report. Do not change the design or work around it.
- The page uses only React APIs that exist in React 18 and React 19: `useSyncExternalStore`, `useMemo`, `useRef`, `useEffect`, `useState`. No `use()`, no Actions, no `ref` as a prop.
- Files under `src/core/` import only from `src/core/`. Files under `src/controller/` import only from `src/core/`, `src/controller/` and the types of `src/sdk.ts`. Neither imports `react`, `react-dom` or `@kirocrew/app-sdk`. Only `src/index.tsx` imports `@kirocrew/app-sdk`, and nothing imports `@kirocrew/app-sdk/ui`.
- Test files that need a folder use `fs.mkdtemp` under `os.tmpdir()` and remove only the folder they created. Fixtures contain no absolute path and no user name. No task deletes anything it did not create.
- No git write command is run in this spec (no commit, branch, push). Commands are PowerShell-safe: one command per call, no `&&`, no inline JSON. Files are written without a BOM.
- Commands run in `ui/` (use the working-directory option of the shell tool). A task that writes failing tests runs `npx vitest --run <file>` and expects failures because the module does not exist or is incomplete. The task that follows runs the same command and expects a pass. `npm run typecheck` is run after each implementation task, not after a failing-test task.
- The wording of every fixed text comes from `src/core/text.ts`. A test that checks a requirement's literal wording writes the literal string in the test, so a wrong constant is caught.

## Tasks

- [x] 1. Project and guards
  - [x] 1.1 Create the `ui/` project (asks the user twice)
    - Look up the current versions with the read-only command `npm view <package> version` for `react`, `react-dom`, `@types/react`, `@types/react-dom` and `vite`. `vitest` (5.1.0), `fast-check` (4.10.2) and `typescript` (6.0.3) are taken from the root `package.json` and must be identical. Then **STOP and ask the user** to confirm the exact version list. Say which React major each candidate is (the host's React version is not recorded, Open question Q10); `react` and `react-dom` must be one exact version, `@types/react` and `@types/react-dom` the matching ones.
    - After the user confirms, write `ui/package.json` (`private`, `type: module`, exact versions with no `^` or `~`, no `@kirocrew/app-sdk`, scripts `build` = `vite build && node scripts/check-dist.mjs`, `typecheck` = `tsc --noEmit`, `test` = `vitest --run`), `ui/tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `jsx: react-jsx`, `moduleResolution: bundler`, `module: ESNext`, `target: ES2022`, `lib` with `DOM`, `include` `src`, `tests`, `vite.config.ts`, `vitest.config.ts`), `ui/vite.config.ts` exactly as in the design, `ui/vitest.config.ts` (environment `node`, alias `@kirocrew/app-sdk` to `tests/stubs/app-sdk.ts`) and `ui/tests/stubs/app-sdk.ts` (an empty module).
    - Then **STOP and ask the user** for permission to run `npm install` inside `ui/`. Run it only after a yes, with the working directory set to `ui/`. Afterwards run `npm ls --depth=0` and check that `@kirocrew/app-sdk` is absent.
    - _Requirements: 9.1, 9.2, 9.3, 9.11; design "Build configuration", "React version"_

  - [x] 1.2 Write the environment test and check that the root run is unaffected
    - Create `ui/tests/environment.test.ts`: `ui/package.json` has no `@kirocrew/app-sdk`; every version in `dependencies` and `devDependencies` is exact (matches `^\d+\.\d+\.\d+$`); `vitest`, `fast-check` and `typescript` equal the root `package.json` versions (read with `node:fs`); `react` and `react-dom` have the same version; `TextDecoder` with `fatal: true` and `ignoreBOM: true` keeps a leading U+FEFF and rejects the bytes `C3 28`.
    - Command: `npx vitest --run tests/environment.test.ts`. Expected: passes. Then `npm run typecheck`.
    - Root isolation (approved by the user): first run the root `npm test` and record the number of test files and tests (the baseline). Then add `vitest.config.mjs` at the repository root with `test.include` set to `["tests/**/*.test.mjs"]` (every root test lives in `tests/`); the root `package.json` and `tsconfig.json` stay unchanged. Run the root `npm test` again and report both counts: they must equal the baseline, and nothing under `ui/` may be collected. Run the root `npm run typecheck`; it must pass. If the counts differ, STOP and report.
    - _Requirements: 9.3, 10.2, 10.8; design "Build configuration" (decision 17)_

  - [x] 1.3 Write the fixtures and the fixture scan test
    - Create the fixtures of the design in `ui/tests/fixtures/`: `config.replay-two-runs.json` (the shape of the real `data/config.json` of the replay smoke run; read that file, which is ignored by git, and copy its structure and values; it holds no path or user name), `config.amber-and-red.json`, `config.failed-run.json`, `config.with-findings.json` (the two runs plus the Findings_Value of the exploit-hunt design example and a second finding with the C3-f token `edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29`), `config.findings-only.json`, `config.no-key.json`, `config.schema-2.json`, `crons.replay-idle.json`, `crons.replay-running.json`, `crons.replay-failing.json`, `crons.none.json`. The cron fixtures have no `script` field, or a placeholder; `last_run_ts` and `next_run_ts` appear as epoch seconds, epoch milliseconds and ISO strings across the files.
    - Create `ui/tests/fixtures.test.ts`: every fixture parses as JSON, holds no drive-letter path (`[A-Za-z]:\\`), no `Users\`, no `token=` and no `/home/`, and the cron fixtures hold no `script` value other than a placeholder.
    - Command: `npx vitest --run tests/fixtures.test.ts`. Expected: passes.
    - _Requirements: 10.9; Assumption A-2, A-6_

  - [x] 1.4 Write the source-scan test
    - Create `ui/tests/source-scan.test.ts`. It reads every file under `ui/src/` as text (an empty or missing `src/` passes) and fails on: `.post(`, `.put(`, `.delete(`, `fetch(`, `XMLHttpRequest`, `useAppEvents`, `dangerouslySetInnerHTML`, a dynamic `import(`, `@kirocrew/app-sdk/ui`, an import of `use`, `useActionState`, `useOptimistic` or `useFormStatus` from `react`; on an import of `react`, `react-dom` or `@kirocrew/app-sdk` in `src/core/` or `src/controller/`; on an import in `src/core/` from outside `src/core/`; and on an import of `@kirocrew/app-sdk` in any file other than `src/index.tsx`. Add a self-test that runs the scanning function on strings that contain each forbidden pattern and expects a failure for each, and on a clean string and expects a pass. The same file also scans `ui/tests/*.test.ts` and `*.test.tsx`: every `fc.assert` call must pass `numRuns` with a number of at least 100, no file may contain `fc.pre` or `.filter(` inside an arbitrary passed to `fc.assert` (a plain `.filter(` is allowed only in a line that carries the comment `// by construction`), and every `Property N` named in the design has exactly one `// Feature: dashboard, Property N:` tag once the property tasks are done (the last check is skipped while no tag exists).
    - Command: `npx vitest --run tests/source-scan.test.ts`. Expected: passes (it guards the later tasks).
    - _Requirements: 1.2, 1.4, 1.5, 1.8, 2.9, 9.7, 10.1, 10.2_

  - [x] 1.5 Write the base generators
    - Create `ui/tests/arbitraries.ts` with `arbJson` (any JSON value of bounded depth, including `null`, arrays and objects with extra keys, and the keys `__proto__` and `constructor`), `corrupt(valid, arb)` (replaces one part, one field or one array element of a valid value with a value from `arb`), `arbNow` (finite numbers, plus `NaN`, `Infinity`, strings and `null` for the totality property), and `arbCodePointString(maxBytes)` (a string built from code points outside D800 to DFFF). Later tasks add their own generators to this file.
    - Create `ui/tests/arbitraries.test.ts` with unit tests: `corrupt` changes exactly one place, `arbJson` output survives `JSON.parse(JSON.stringify(x))`, `arbCodePointString` never contains a lone surrogate.
    - Command: `npx vitest --run tests/arbitraries.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 10.10_

- [x] 2. Constants, text and JSON helpers
  - [x] 2.1 Write the failing unit tests for `constants.ts`, `text.ts` and `json.ts`
    - Create `ui/tests/core.json.test.ts`. Import from `../src/core/constants`, `../src/core/text` and `../src/core/json` (missing).
    - Cases: `APP_NAME` is `grimsheet-playtester`, `CONFIG_PATH` is `/api/apps/grimsheet-playtester/config`, `CRONS_PATH` is `/api/crons`, `TOP_KEY` is `playtesterResults`; the limits (30 trend entries, 20 findings, 100 level entries, 40 tokens, 140 characters per token, 50 jobs); the text constants equal the literal wording of the requirements (`Reading results`, `No results yet. The nightly replay has not written any results.`, `No replay run recorded yet`, `No hunt has run yet`, `The last hunt found no exploits`, `Results could not be read`, `Replay job state is unavailable`, `The replay job is not registered`, `Kiro Crew did not provide the app API`, `The last replay is older than 36 hours`, `Copied`, `Copy is not available here. Select the text and press Ctrl+C.`, `Results updated`, `Unknown colour`, `time unknown`, `commit unknown`, the findings sentence of Requirement 6 criterion 6, and the help text of Requirement 7 criterion 1). `isRecord`, `readString`, `readFiniteNumber`, `readCount`, `readBool` and `clip` for each JSON type; a field with the wrong type is read as `null` and nothing is converted (the string `"1"` is not 1); `getOwn(record, key)` returns `null` for `__proto__`, `constructor` and `toString` when they are not own keys.
    - Command: `npx vitest --run tests/core.json.test.ts`. Expected: fails (module missing).
    - _Requirements: 2.6, 1.1, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.10, 3.11, 5.11, 6.6, 7.1, 9.5, 11.5, 11.6_

  - [x] 2.2 Implement `constants.ts`, `text.ts` and `json.ts`
    - Create `ui/src/core/constants.ts`, `ui/src/core/text.ts` and `ui/src/core/json.ts`, as in the design ("Validation of each part", "Time functions" for the limits). `json.ts` exports `isRecord`, `readString`, `readFiniteNumber`, `readCount`, `readBool`, `clip`, `getOwn`.
    - Command: `npx vitest --run tests/core.json.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 2.6, 2.7_

- [x] 3. Time
  - [x] 3.1 Write the failing unit tests for `time.ts`
    - Create `ui/tests/core.time.test.ts`. Import from `../src/core/time` (missing).
    - Cases: `parseTime` for `2026-11-08T11:03:12.481Z`, the form without seconds, an offset form (`+02:00`), a date only (null), a month 13, `2026-02-30` (null), `2024-02-29` (valid), `2026-02-29` (null), hour 24 (null), a number (null), `null`; `parseCronTime` for epoch seconds (`1.7e9`), epoch milliseconds (`1.7e12`), the boundary `1e11` (milliseconds) and `99999999999` (seconds), a negative number (null), `NaN` (null), an ISO string, an object (null); `formatUtc` (`2026-11-08 11:03 UTC`, the minute floored, `null` gives `time unknown`); `isStale` (exactly 129,600,000 ms before `nowMs` is not stale, one millisecond more is, a time after `nowMs` is not, `nowMs` that is `NaN`, a string or `Infinity` is not, a null time is not); `STALE_LIMIT_MS` is 129600000.
    - Command: `npx vitest --run tests/core.time.test.ts`. Expected: fails (module missing).
    - _Requirements: 5.2, 5.7, 5.11, 10.11_

  - [x] 3.2 Implement `time.ts`
    - Create `ui/src/core/time.ts` as in the design: `parseTime` with the regular expression and hand-checked field ranges and no use of `Date.parse`, `parseCronTime`, `formatUtc`, `STALE_LIMIT_MS`, `isStale`, `replayTimeOf(latest)`.
    - Command: `npx vitest --run tests/core.time.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 5.2, 5.7, 5.11_

  - [x] 3.3 Write property test for the time functions
    - Append to `ui/tests/core.time.test.ts`. Tag `// Feature: dashboard, Property 12: Time functions`. Generators: valid ISO strings built by construction (year, month, a day within the month, hour, minute, second, optional fraction, `Z` or an offset), arbitrary strings, arbitrary numbers. Checks: `formatUtc(parseTime(valid))` matches `^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$`; strings built with an invalid day, month, hour or minute give `null`; `parseCronTime(n)` for a number below `1e11` equals `parseCronTime` of the same instant in milliseconds; no input makes any of the three throw. `numRuns` 100 or more. If it fails, STOP and report the counterexample; never narrow an arbitrary, add `fc.pre`, lower `numRuns` or loosen the expectation.
    - **Property 12: Time functions**
    - Command: `npx vitest --run tests/core.time.test.ts`. Expected: passes.
    - _Requirements: 5.2, 5.7; Properties: 12_

- [x] 4. Colour
  - [x] 4.1 Write the failing unit tests for `colour.ts`
    - Create `ui/tests/core.colour.test.ts`. Import from `../src/core/colour` (missing).
    - Cases: `COLOURS` is `green, amber, red, error`; `colourLabel` for each of the five card colours gives exactly `Green: intended solution holds`, `Amber: wins with a different ink count`, `Red: no longer wins`, `Not judged`, `No result`; `normaliseColour` keeps the four known strings and turns `purple`, an empty string and `GREEN` into `error`; `markerClass` gives a different class for each of the five colours and the same class for the same colour.
    - Command: `npx vitest --run tests/core.colour.test.ts`. Expected: fails (module missing).
    - _Requirements: 2.10, 4.3_

  - [x] 4.2 Implement `colour.ts`
    - Create `ui/src/core/colour.ts` as in the design ("Colour mapping").
    - Command: `npx vitest --run tests/core.colour.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 2.10, 4.3_

- [x] 5. Error text
  - [x] 5.1 Write the failing unit tests for `errors.ts`
    - Create `ui/tests/core.errors.test.ts`. Import from `../src/core/errors` (missing).
    - Cases: an object with a string `message` gives its first line; a multi-line message gives only the first line; an error with a `stack` property never shows the stack; a value without a string `message` (a number, `null`, a string, an object) gives `The request failed`; the text is clipped to 200 characters; `token=abc123&x=1` becomes `token=…&x=1`; `Bearer abc.def` becomes `Bearer …`; the fixed phrase for the time limit is `The request took longer than 10 seconds`.
    - Command: `npx vitest --run tests/core.errors.test.ts`. Expected: fails (module missing).
    - _Requirements: 3.13_

  - [x] 5.2 Implement `errors.ts`
    - Create `ui/src/core/errors.ts` with `errorText` and `TIME_LIMIT_TEXT` as in the design ("Reader and controller").
    - Command: `npx vitest --run tests/core.errors.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 3.13_

  - [x] 5.3 Write property test for the error text
    - Append to `ui/tests/core.errors.test.ts`. Tag `// Feature: dashboard, Property 15: Bounded text`. Generators: any value (`arbJson`), objects with a `message` made of arbitrary strings with embedded newlines, `token=` and `Bearer` followed by arbitrary non-space text. Checks: the result is one line (no `\n` or `\r`), at most 200 characters, holds no `token=` followed by a value and no `Bearer` followed by a value, and `errorText` never throws. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 15: Bounded text**
    - Command: `npx vitest --run tests/core.errors.test.ts`. Expected: passes.
    - _Requirements: 3.13; Properties: 15_

- [x] 6. Token codec
  - [x] 6.1 Write the failing unit tests for `tokens.ts`
    - Create `ui/tests/core.tokens.test.ts`. Import from `../src/core/tokens` (missing).
    - Cases: `decodeToken` for `N`, `S`, `E`, `W`, `wait`, `undo`; `n`, `Wait` and `EDIT:B14=7` give null (case sensitive); `edit:B14=7`; `edit:B14=%3DB15%2B1` gives raw `=B15+1`; `edit:B14=%3d` (lower case) gives raw `=`; `edit:B14=` (empty raw) is valid; `edit:b14=7`, `edit:B=7`, `edit:14=7`, `edit:ABCDEFG1=7` (more than 6 characters) give null; a lone `%`, `%4`, `%ZZ`, a raw containing a space, `=`, `:` or `é` unescaped give null; `%C3%28` and `%FF` and an overlong `%C0%AF` and a surrogate `%ED%A0%80` give null; `%EF%BB%BF` (a BOM) decodes to U+FEFF and is kept; a non-string input gives null. The C3-f token `edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29` decodes to the raw `=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")`. `decodeActions` returns null if any token fails and the list otherwise. `encodeAction` and `encodeActions` give upper-case hex and keep `A-Z a-z 0-9 . _ -`; `encodeAction` of a raw with a space gives `%20`, a double quote `%22`, `é` gives `%C3%A9`. `actionsFileText` is `JSON.stringify(actions, null, 2)` with no trailing newline, and its keys are in the order `kind`, `dir` (or `address`, `raw`). `replayCommand('02-the-chaser')` gives `node scripts/play.mjs 02-the-chaser --actions-file <actions-file>`; `..`, `a/b`, `A`, an empty string and a string with a space give null.
    - Command: `npx vitest --run tests/core.tokens.test.ts`. Expected: fails (module missing).
    - _Requirements: 7.2, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x] 6.2 Implement `tokens.ts`
    - Create `ui/src/core/tokens.ts` as in the design ("Token codec"): a module-level `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`, a hand scan of the raw part, the address rule, no 40-byte limit.
    - Command: `npx vitest --run tests/core.tokens.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 7.2, 7.5, 7.6, 7.7, 7.9_

  - [x] 6.3 Write property test for the Token round trip
    - Append to `ui/tests/core.tokens.test.ts`. Add `arbAction` and `arbActionList` (1 to 40 actions; moves from `N S E W`; `wait`; `undo`; edits with an address of 1 to 3 capital letters and 1 to 3 digits and a `raw` from `arbCodePointString`, so no lone surrogate) to `ui/tests/arbitraries.ts`. Tag `// Feature: dashboard, Property 8: Token round trip`. Check `decodeActions(encodeActions(list))` equals `list`; also check that the encoded tokens match the grammar (no character outside `A-Z a-z 0-9 . _ - % : =` in an edit token, and `%` always followed by two upper-case hex digits), and an example check of the C3-f token. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 8: Token round trip**
    - Command: `npx vitest --run tests/core.tokens.test.ts`. Expected: passes.
    - _Requirements: 7.8, 10.5; Properties: 8_

  - [x] 6.4 Write property test for the decoder's totality
    - Append to `ui/tests/core.tokens.test.ts`. Tag `// Feature: dashboard, Property 9: Decoder totality and rejection`. Checks over arbitrary strings: `decodeToken` never throws and returns an action or null; a token built as `edit:A1=` plus a raw part that holds a lone `%`, a `%` followed by one hex digit, a `%` followed by a non-hex pair, or an invalid UTF-8 byte sequence (built from a list of known invalid sequences) is null; for any valid action list, replacing every upper-case hex digit pair of the encoded tokens with lower case decodes to the same actions. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 9: Decoder totality and rejection**
    - Command: `npx vitest --run tests/core.tokens.test.ts`. Expected: passes.
    - _Requirements: 7.9, 10.5; Properties: 9_

- [x] 7. Latest run, level entries and trend
  - [x] 7.1 Write the failing unit tests for `results.ts`
    - Create `ui/tests/core.results.test.ts`. Import from `../src/core/results` (missing) and the fixtures.
    - Cases for `parseSchema`: 1 gives no notice; 2, `"1"`, absent and `null` give the notice `This value comes from a different schema version (found: N)` or `(found: none)`. `parseLatest`: the real fixture gives the run id, state, short commit (first 7 characters), the time from `finishedAt`, the full hash; `commit` null gives `commit unknown` data; a `failure` record is copied with each field clipped to 200; `failure` with a wrong type is null; a `finishedAt` that is not a string falls back to `startedAt`; a `finishedAt` string that does not parse gives `time unknown` and no fallback; a `state` outside the four is null; a non-record is null. `parseLevelEntries`: valid entries kept; a non-record, a missing `levelId`, a missing or non-string `colour` dropped and counted; an unknown colour string becomes `error` with the label `Unknown colour`; a repeated `levelId` keeps the first and counts the rest; `inkSpent` and `minimalInk` both finite integers at least 0 give `ink`, otherwise null; `endHp` finite at least 0 kept, `-1` and `"3"` give null; `timedOut` only for exactly `true`; 101 entries keep 100 and count 1. `parseTrend`: a non-array gives no runs and a dropped count of 1; entries without a string `runId` or a finite integer `counter` are dropped and counted; the counts use `readCount` (a string `"3"` gives null); `levels` that is not a record becomes `{}`; keys with non-string values are ignored; an unknown colour in the map becomes `error`; sorting by `counter` descending, ties by `startedAt` descending, then `runId` descending; a repeated `runId` keeps the first after sorting; 31 entries keep 30 and count 1.
    - Command: `npx vitest --run tests/core.results.test.ts`. Expected: fails (module missing).
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.10, 3.7, 3.8, 4.5, 4.6, 4.7, 4.11, 5.1, 5.3, 5.11_

  - [x] 7.2 Implement `results.ts`
    - Create `ui/src/core/results.ts` with `parseSchema`, `parseLatest`, `parseLevelEntries` and `parseTrend` as in the design ("Validation of each part").
    - Command: `npx vitest --run tests/core.results.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 2.3, 2.5, 2.6, 2.7, 4.11_

  - [x] 7.3 Write property test for the trend order and size
    - Append to `ui/tests/core.results.test.ts`. Add `arbTrendEntry` and `arbTrend` to `ui/tests/arbitraries.ts` (valid entries with counters in any order, repeated `runId`s, repeated counters, 0 to 80 entries, and `arbJson` elements mixed in). Tag `// Feature: dashboard, Property 4: Trend order and size`. Checks: `runs` has at most 30 entries; it is sorted by `counter` descending, with ties by `startedAt` descending and then `runId` descending; no `runId` repeats; the dropped count plus the kept count equals the number of input elements minus the removed duplicates. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 4: Trend order and size**
    - Command: `npx vitest --run tests/core.results.test.ts`. Expected: passes.
    - _Requirements: 4.11, 2.7, 4.14; Properties: 4_

- [x] 8. Findings
  - [x] 8.1 Write the failing unit tests for `findings.ts`
    - Create `ui/tests/core.findings.test.ts`. Import from `../src/core/findings` (missing) and the fixtures.
    - Cases for `parseFindings`: absent gives `present` false and no drop; a record with `items` empty gives `present` true and an empty list; a legacy array, a string and a number give `present` false and `dropped` 1; the header: `updatedAt`, `commit` and its short form, `huntId`, six counts (a count that is not a finite integer at least 0 is null); a different `schemaVersion` gives the notice; one Finding of the fixture gives `classLabel` `Cheaper win`, `commitShort`, the formatted time, `tokensText`, `replayCommand`, `actionsFileText`, the result fields; classes `free_win` and `unexpected_route` give `Free win` and `Unexpected route`; an unknown class shows the stored string clipped to 40; a Finding with 41 tokens, with a 141-character token, with no `actions`, with a non-string `id` is dropped and counted; a Finding with a token that does not decode is kept with `actionsFileText` null; a level id that does not match `^[a-z0-9][a-z0-9-]*$` is kept with `replayCommand` null; ordering by `foundAt` descending then `id` descending, an unparseable `foundAt` sorts last; duplicates (same level id, class and tokens) keep the first in that order and are not counted; 21 distinct valid items keep 20 and count 1. `isEarlierCommit`: both present and different gives true; equal, either null or an empty string gives false.
    - Command: `npx vitest --run tests/core.findings.test.ts`. Expected: fails (module missing).
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 5.4, 5.5, 6.1, 6.2, 6.3, 6.5, 6.7, 7.2, 7.5, 7.6_

  - [x] 8.2 Implement `findings.ts`
    - Create `ui/src/core/findings.ts` with `parseFindings` and `isEarlierCommit` as in the design ("Findings order and caps"). It uses `tokens.ts` for `replayCommand` and `actionsFileText`.
    - Command: `npx vitest --run tests/core.findings.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 2.3, 2.7, 6.1, 6.3, 6.5, 6.7, 7.1, 7.2, 7.5, 7.6_

  - [x] 8.3 Write property test for the findings view
    - Append to `ui/tests/core.findings.test.ts`. Add `arbFinding` and `arbFindingsValue` to `ui/tests/arbitraries.ts` (up to 40 items, with duplicates, out-of-order and equal times, tokens from `arbActionList` encoded, class strings from the three known and arbitrary ones, and invalid items built by `corrupt`). Tag `// Feature: dashboard, Property 7: Findings view`. Checks: at most 20 items; no two items with the same level id, class and token list; the items are in `foundAt` descending order (parsed time, unparseable last) then `id` descending; every item has 1 to 40 tokens of at most 140 characters; `dropped` equals the number of invalid items plus the number of distinct valid items beyond 20. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 7: Findings view**
    - Command: `npx vitest --run tests/core.findings.test.ts`. Expected: passes.
    - _Requirements: 6.3, 6.7, 6.8, 2.7; Properties: 7_

- [x] 9. Crons
  - [x] 9.1 Write the failing unit tests for `crons.ts`
    - Create `ui/tests/core.crons.test.ts`. Import from `../src/core/crons` (missing) and the cron fixtures.
    - Cases: `findReplayJob` picks the job named exactly `replay`; the job whose name ends with `/replay`; when no name matches, the job whose `script` contains `replay_cron.py`; the first match in list order; no job gives `not-registered`; `jobs` that is not an array gives `unavailable`; only the first 50 jobs are inspected. `parseJob`: `last_run_ts` and `next_run_ts` in seconds, milliseconds and ISO string form give `YYYY-MM-DD HH:MM UTC`; a value of another type gives `time unknown`; `last_status` clipped to 40; `is_running` only for exactly `true`; `consecutive_failures` by `readCount`; `paused` when `user_paused` is `true` or `enabled` is `false`; the result object has no key `script`, `command` or `folder` and no value that contains the `script` string of the input. `readIsRunning(cronsValue)` is true only for a found replay job with `is_running` exactly true, and false for anything else including `null`.
    - Command: `npx vitest --run tests/core.crons.test.ts`. Expected: fails (module missing).
    - _Requirements: 5.6, 5.7, 5.8, 5.9, 5.10, 3.11, 8.5; Assumption A-5, A-6_

  - [x] 9.2 Implement `crons.ts`
    - Create `ui/src/core/crons.ts` with `findReplayJob`, `parseJob`, `readIsRunning` as in the design. The `script` string is read only inside `findReplayJob`.
    - Command: `npx vitest --run tests/core.crons.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 5.6, 5.7, 5.8, 5.9, 5.10, 8.5_

- [x] 10. Level cards
  - [x] 10.1 Write the failing unit tests for `cards.ts`
    - Create `ui/tests/core.cards.test.ts`. Import from `../src/core/cards` (missing).
    - Cases: the ids are the union of `latest.levels` and the newest run's `levels`, sorted ascending by plain comparison (`02` before `10`, `a` before `b`, upper case before lower case is not a concern because ids are lower case); a card from `latest.levels` shows its entry; a card only in the newest run takes the run's colour, has `noDetail` true and no ink or end HP; `outcome` is `won` for green and amber, `not won` for red, `not judged` for error, `no result` for none; the trend cells are one per run in `runs`, newest first, with `none` where the run does not name the level; `trendText` for 12 runs of 11 green and 1 amber is `Last 12 runs: 11 green, 1 amber`; zero runs give `No runs recorded`; counts of zero are left out and the order is green, amber, red, not judged, no result; 101 distinct ids keep 100; the colour of a card does not change when `inkSpent` and `minimalInk` change.
    - Command: `npx vitest --run tests/core.cards.test.ts`. Expected: fails (module missing).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [x] 10.2 Implement `cards.ts`
    - Create `ui/src/core/cards.ts` with `buildCards` as in the design ("Cards and the trend"). It never reads `inkSpent` or `minimalInk` to decide a colour.
    - Command: `npx vitest --run tests/core.cards.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 4.1, 4.4, 4.8, 4.9, 4.10_

  - [x] 10.3 Write property test for one card per level id
    - Append to `ui/tests/core.cards.test.ts`. Add `arbLevelEntry` and `arbLatest` to `ui/tests/arbitraries.ts`. Tag `// Feature: dashboard, Property 5: One card per level id`. Checks: for any level entries and any trend, the card ids are exactly the distinct ids of the entries and of the newest run (capped at 100), in ascending order, with no card for any other id. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 5: One card per level id**
    - Command: `npx vitest --run tests/core.cards.test.ts`. Expected: passes.
    - _Requirements: 4.1, 4.14; Properties: 5_

  - [x] 10.4 Write property test for colour and label
    - Append to `ui/tests/core.cards.test.ts`. Tag `// Feature: dashboard, Property 6: Colour and label`. Checks over generated entries (known and unknown colour strings, any ink values): every card colour is one of `green`, `amber`, `red`, `error`, `none`; for a known colour the `label` equals `colourLabel(colour)`; for an unknown colour string the colour is `error` and the label is `Unknown colour`; `markerClass(a) === markerClass(b)` exactly when `a === b`; replacing the ink values of every entry by arbitrary values leaves every card colour unchanged. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 6: Colour and label**
    - Command: `npx vitest --run tests/core.cards.test.ts`. Expected: passes.
    - _Requirements: 2.10, 4.3, 4.4, 10.4; Properties: 6_

- [x] 11. View_Model, change key and app-name notice
  - [x] 11.1 Write the failing unit tests for `viewmodel.ts`, `change-key.ts` and `app-name.ts`
    - Create `ui/tests/core.viewmodel.test.ts`. Import from `../src/core/viewmodel`, `../src/core/change-key` and `../src/core/app-name` (missing), and the fixtures. A helper `route(value, status)` builds a `RouteState`.
    - Cases for `buildViewModel`: both routes `pending` give `loading` true; a good config with no key gives `hasData` true and `present` false; `config.replay-two-runs.json` gives five green cards, two runs, commit `6372d9a`, `findings.present` false, no stale warning at a `nowMs` one hour after the replay; the same at 37 hours gives `stale` true; `config.amber-and-red.json` gives the amber, red, timed-out and error cards; `config.failed-run.json` gives `replay.failure` with stage, reason code and message and no cards; `config.findings-only.json` gives `replay` null and the findings; `config.with-findings.json` gives two findings; `config.schema-2.json` gives the schema notice and still reads the parts; a config route `failed` with a good value keeps the results and carries the error text and the read time; a config route `failed` without a good value gives `hasData` false and the error; a crons route `failed` gives the job area error and leaves the results unchanged; `crons.replay-idle.json`, `-running.json`, `-failing.json` and `-none.json` give a found job, a running job, `consecutiveFailures` above 0, and `not-registered`; the View_Model contains no `script` text; every value is JSON (a `JSON.parse(JSON.stringify(vm))` round trip gives an equal object). A part that throws inside a builder is replaced by its empty state (inject a getter that throws on an input record). `changeKey`: equal for the same data with different read times, different when a level colour or a finding changes. `appNameNotice('grimsheet-playtester')` is null; another name gives a notice that holds both names; a non-string gives null.
    - Command: `npx vitest --run tests/core.viewmodel.test.ts`. Expected: fails (module missing).
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 5.1, 5.11, 8.10, 8.11, 9.9, 11.7_

  - [x] 11.2 Implement `viewmodel.ts`, `change-key.ts` and `app-name.ts`
    - Create `ui/src/core/viewmodel.ts` (the types of the design and `buildViewModel`, wrapping each part builder in its own `try`), `ui/src/core/change-key.ts` (`changeKey(vm)` is `JSON.stringify` of `vm.results` and `vm.job`) and `ui/src/core/app-name.ts` (`appNameNotice`).
    - Command: `npx vitest --run tests/core.viewmodel.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.11, 9.9_

  - [x] 11.3 Write property tests for totality and determinism
    - Append to `ui/tests/core.viewmodel.test.ts`. Add `arbResultsValue`, `arbCronJob`, `arbCronsValue` and `arbRouteState` to `ui/tests/arbitraries.ts`. Two tests, tags `// Feature: dashboard, Property 1: Total View_Model` and `// Feature: dashboard, Property 2: Deterministic`. Property 1: for any JSON value as the config value, any JSON value as the crons value, any statuses and any value from `arbNow`, `buildViewModel` returns an object with the keys of the View_Model and does not throw. Property 2: two calls with equal inputs (the second built by `structuredClone`) return results that are equal with `toStrictEqual`. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 1: Total View_Model**, **Property 2: Deterministic**
    - Command: `npx vitest --run tests/core.viewmodel.test.ts`. Expected: passes.
    - _Requirements: 2.2, 2.8, 10.3, 10.7; Properties: 1, 2_

  - [x] 11.4 Write property test for "a bad part never blanks the good parts"
    - Append to `ui/tests/core.viewmodel.test.ts`. Tag `// Feature: dashboard, Property 3: A bad part never blanks the good parts`. Start from a valid Results_Value (`arbResultsValue` with `latest`, `trend` and `findings` all present), and replace one of `latest`, `trend`, `findings` by an arbitrary JSON value or remove it. Compare with the View_Model of the unchanged value: replacing `latest` leaves `results.runs`, `results.findings` and `job` equal; replacing `trend` leaves `results.replay`, `results.findings` and `job` equal; replacing `findings` leaves `results.replay`, `results.runs`, `results.levels` and `job` equal. Replacing the crons value (by any JSON) leaves `results` equal. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 3: A bad part never blanks the good parts**
    - Command: `npx vitest --run tests/core.viewmodel.test.ts`. Expected: passes.
    - _Requirements: 2.3, 10.6; Properties: 3_

  - [x] 11.5 Write property test for the stale warning
    - Append to `ui/tests/core.viewmodel.test.ts`. Tag `// Feature: dashboard, Property 11: Stale warning`. Over `arbResultsValue` (with `finishedAt` and `startedAt` as valid ISO strings, absent, null, unparseable strings and non-strings) and finite `nowMs` built as the replay time plus an offset taken around the boundary (offsets from -1 hour to 72 hours, and the exact values 129,600,000 and 129,600,001): `replay.stale` is true exactly when the replay time (the `finishedAt` string if it is a string, otherwise `startedAt`) parses and `nowMs - time > 129600000`. Add example tests for the boundary (exactly 36 hours is not stale, one millisecond more is), an unparseable `finishedAt` (no fallback, no warning), an absent time, a time in the future, and a `nowMs` that is `NaN`, `Infinity`, a string or `null` (no warning). `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 11: Stale warning**
    - Command: `npx vitest --run tests/core.viewmodel.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 5.11, 10.11; Properties: 11_

- [x] 12. Poll scheduler
  - [x] 12.1 Write the failing unit tests for `poll.ts`
    - Create `ui/tests/core.poll.test.ts`. Import from `../src/core/poll` (missing).
    - Cases for `decide`: hidden gives `none`; in flight gives `none`; no previous start gives `start`; 59,999 ms after the last start gives `wait` with `ms` 1; exactly 60,000 ms gives `start`; with `isRunning` true the interval is 15,000; the effective interval never exceeds the base interval. Cases for `step`: `mount` while visible starts at once and sets `inFlight` and `lastStartMs`; `mount` while hidden does nothing; `tick` starts or waits by `decide`; `visibility` to hidden gives `none`; `visibility` to visible after more than one interval starts at once, and after less gives `wait` for the rest; `refresh` while visible and idle starts; `refresh` while in flight or hidden gives `none`; `complete` clears `inFlight`, takes `isRunning` and decides; a `complete` with nothing in flight changes nothing but `isRunning` and cannot start before the interval; `unmount` closes the scheduler and every later event gives `none`.
    - Command: `npx vitest --run tests/core.poll.test.ts`. Expected: fails (module missing).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9, 8.12_

  - [x] 12.2 Implement `poll.ts`
    - Create `ui/src/core/poll.ts` as in the design ("Poll scheduler as a state machine"): `POLL_INTERVAL_MS`, `RUNNING_INTERVAL_MS`, `decide`, `step`, `initialScheduler`.
    - Command: `npx vitest --run tests/core.poll.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.12_

  - [x] 12.3 Write property test for the poll scheduler
    - Append to `ui/tests/core.poll.test.ts`. Add `arbSchedulerEvents` (sequences of `tick`, `visibility`, `refresh` and `complete` with non-decreasing times) to `ui/tests/arbitraries.ts`. Tag `// Feature: dashboard, Property 10: Poll scheduler`. The model completes every Read it starts, at a generated later time. Checks for every prefix: the number of Reads in flight is never above 1; no `start` effect is returned while `visible` is false or `closed` is true; every `start` from a `tick` or a `visibility` event comes at least one effective interval after the previous start (or is the first); `decide` never returns an interval above `POLL_INTERVAL_MS`; after the sequence, with the page visible and nothing in flight, a `tick` at a time past the interval gives `start` (progress). `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 10: Poll scheduler**
    - Command: `npx vitest --run tests/core.poll.test.ts`. Expected: passes.
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.12, 8.13; Properties: 10_

- [x] 13. Checkpoint: the pure core
  - [x] 13.1 Ensure the core tests, the typecheck and the guards pass
    - In `ui/` run `npm test`, then `npm run typecheck`. Both must pass. Check with a read-only search that nothing under `ui/src/core/` imports `react`, `react-dom`, `@kirocrew/app-sdk` or a file outside `core/`. From the repository root run `npm test` once more and check that it still runs the same number of files and tests as the baseline of task 1.2 and collects no file under `ui/`. Ask the user if questions arise.
    - _Requirements: 10.1, 10.12_

- [x] 14. Controller
  - [x] 14.1 Write the fake Env helper and its self-test
    - Create `ui/tests/helpers/fake-env.ts` exporting `makeFakeEnv()` (a manual clock `nowMs`/`advance`, a timer queue where `setTimeout` records `{id, fn, due}` and `advance` runs the due callbacks in order, `clearTimeout`, `isVisible`/`setVisible`, `onVisibilityChange` with an unsubscribe) and `makeFakeApi(script)` (a recording fake with only a `get(path)` method whose answers are resolved, rejected, delayed or never settling, as the script says; it records every call). Create `ui/tests/helpers/fake-env.test.ts` with unit tests: timers fire in order of due time, a cleared timer does not fire, the recording fake records the calls, a never-settling answer stays pending.
    - Command: `npx vitest --run tests/helpers/fake-env.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 10.8_

  - [x] 14.2 Write the failing unit tests for `reader.ts`
    - Create `ui/tests/controller.reader.test.ts`. Import from `../src/controller/reader` (missing), the fake Env and the fake API.
    - Cases: a resolved answer gives `{ok: true, value}`; a rejected answer and a synchronous throw give `{ok: false, error}` with the text from `errorText`; an answer that has not settled after 10,000 ms gives `{ok: false, error: 'The request took longer than 10 seconds'}`; a late answer after the limit is ignored (the result does not change and no second result is produced); the timer is cleared after a fast answer; `readRoute` calls only `api.get`, once, with the path it was given.
    - Command: `npx vitest --run tests/controller.reader.test.ts`. Expected: fails (module missing).
    - _Requirements: 8.8, 3.13, 1.1, 1.2_

  - [x] 14.3 Implement `env.ts` and `reader.ts`
    - Create `ui/src/controller/env.ts` (the `Env` type and `realEnv()`, which uses `Date.now`, `setTimeout`, `clearTimeout`, `document.visibilityState` and the `visibilitychange` event, read when called, not at module load) and `ui/src/controller/reader.ts` (`readRoute` as in the design).
    - Command: `npx vitest --run tests/controller.reader.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 8.8_

  - [x] 14.4 Write the failing unit tests for `controller.ts`
    - Create `ui/tests/controller.controller.test.ts`. Import from `../src/controller/controller` (missing), the fake Env and the fake API.
    - Cases: `start` while visible starts one Read at once with two `get` calls (both issued before either settles, which shows they are parallel); the first snapshot has both routes `pending`; after both answers the routes are `ok` with `good` and `goodAtMs`; a failing config route keeps the earlier `good` and sets `error`; one route succeeding and the other failing in the same Read updates only the successful one; the next Read starts 60,000 ms after the start of the previous one, and 15,000 ms after it when the crons answer shows `is_running` true; a Read never starts while one is in flight (a never-settling request ends at the 10 s limit and the next Read follows); no Read starts while hidden; becoming visible after more than one interval starts a Read at once, after less waits for the rest; `refresh` while idle starts a Read, while in flight does nothing; `stop` clears the timer, unsubscribes from visibility, and an answer that arrives after `stop` changes nothing; `start` after `stop` works (strict mode); with `api` null no request is made and both routes show `Kiro Crew did not provide the app API`; `getSnapshot` returns the same object until something changes; every snapshot carries `nowMs` from the Env; the recorded calls are `get` calls to the two paths only.
    - Command: `npx vitest --run tests/controller.controller.test.ts`. Expected: fails (module missing).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 9.5, 1.1, 1.2, 1.3_

  - [x] 14.5 Implement `controller.ts`
    - Create `ui/src/controller/controller.ts` with `DashboardController` and `Snapshot` as in the design ("Reader and controller"): one timer, a generation counter, the two `readRoute` calls started in parallel, `complete` sent when both have settled with `isRunning` from `readIsRunning`, `stop` bumping the generation.
    - Command: `npx vitest --run tests/controller.controller.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9, 8.10, 8.11_

  - [x] 14.6 Write property test for "read only"
    - Append to `ui/tests/controller.controller.test.ts`. Add `arbControllerOps` to `ui/tests/arbitraries.ts` (sequences of `advance(ms)`, `visible(true|false)`, `refresh`, `stop`, `start`, with the API script giving each request a random outcome: resolved, rejected, delayed beyond the limit, never settling). Tag `// Feature: dashboard, Property 13: Read only`. Checks: every call recorded by the fake API is a `get` of `/api/apps/grimsheet-playtester/config` or `/api/crons`; the fake API has no other method, so any other call throws and fails the test; the number of requests in flight from one controller never exceeds 2 (one Read); no request is issued while the page is hidden except the Read that was already in flight. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 13: Read only**
    - Command: `npx vitest --run tests/controller.controller.test.ts`. Expected: passes.
    - _Requirements: 1.1, 1.2, 1.3, 1.7, 8.13; Properties: 13_

  - [x] 14.7 Write the failing unit tests for `copy.ts`
    - Create `ui/tests/controller.copy.test.ts`. Import from `../src/controller/copy` (missing).
    - Cases: `writeText` resolving gives `{ok: true}` and the selection copy is not tried; `writeText` missing, rejecting or throwing falls back to `selectionCopy`; `selectionCopy` returning `true` gives `{ok: true}`; `selectionCopy` returning `false`, throwing or missing gives `{ok: false}`; `copyText` never throws. The copy-state reducer: success gives `copied` with the message `Copied` and a clear action after 3,000 ms; failure gives `fallback` with the message `Copy is not available here. Select the text and press Ctrl+C.` and the text to show; a new copy replaces the earlier state.
    - Command: `npx vitest --run tests/controller.copy.test.ts`. Expected: fails (module missing).
    - _Requirements: 11.5, 11.6_

  - [x] 14.8 Implement `copy.ts`
    - Create `ui/src/controller/copy.ts` with `CopyEnv`, `copyText` and the copy-state reducer as in the design ("Clipboard flow").
    - Command: `npx vitest --run tests/controller.copy.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 11.5, 11.6_

- [x] 15. Components
  - [x] 15.1 Write the failing render tests for the page states
    - Create `ui/tests/components.states.test.tsx`. Import `DashboardView` from `../src/components/DashboardView` (missing). Render with `renderToStaticMarkup` from `react-dom/server` and a View_Model built by `buildViewModel` from the fixtures. A helper renders with no-op handlers.
    - One test for each of Requirement 3, criteria 1 to 12: loading shows `Reading results`; no key shows the no-results text and no level cards and no findings list; key without `latest` shows `No replay run recorded yet` and still the trend and findings; `findings` absent shows `No hunt has run yet`; `findings` with no items shows `The last hunt found no exploits` and the hunt header; findings without `latest` shows both; a failed run shows stage, reason code and message with the cards; `cut-short` and `running` show the state as text; a config failure shows `Results could not be read`, the error and `last read at` with the earlier results kept; a crons failure shows `Replay job state is unavailable` in the job area only; no job shows `The replay job is not registered`; both failures on the first Read show both errors and a Refresh_Button that is not disabled. Also: the dropped counts are shown as text (for example `2 findings could not be read`); the schema notice is shown; the app-name notice is shown with both names; `Kiro Crew did not provide the app API` is shown when the API is missing, with the Refresh_Button disabled; a view-model string containing `<b>x</b>` appears escaped.
    - Command: `npx vitest --run tests/components.states.test.tsx`. Expected: fails (module missing).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.14, 2.4, 2.5, 9.5, 9.9_

  - [x] 15.2 Implement `DashboardView`, `ReplaySummary`, `JobPanel`, `LiveRegion` and `styles`
    - Create `ui/src/components/DashboardView.tsx`, `ReplaySummary.tsx`, `JobPanel.tsx`, `LiveRegion.tsx` and `styles.ts` as in the design ("Components"): a `main` with an `h1`, sections with accessible names, the Refresh_Button (`aria-busy` and the text `Reading` while a Read is in flight), the style constant in one `<style>` element, the short commit with the full hash in `title` and in visually hidden text, the stale warning next to the time, the job area with `replay running now`, `consecutive failures` and a `Warning:` text, `paused`. Every string from the View_Model is rendered as a child text node. No `dangerouslySetInnerHTML`. The components import only React and `src/core`.
    - Command: `npx vitest --run tests/components.states.test.tsx`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 3.1–3.14, 5.1, 5.3, 5.6, 5.8, 5.9, 5.11, 8.2, 8.3, 8.10, 11.1, 11.7, 11.8_

  - [x] 15.3 Write the failing render tests for the level cards, the trend strip and the run counts
    - Create `ui/tests/components.levels.test.tsx`. Import `LevelCard`, `TrendStrip`, `RunCounts` from `../src/components/*` (missing).
    - Cases: a card shows the level id in an `h3`, the Colour_Label text for each of the five colours, the outcome (`won`, `not won`, `not judged` with the reason code, `play timed out`), `ink spent N of minimal M` or `ink not recorded`, `end HP N` when present and no end HP text when absent, `no detail in the last run`; the strip is a `role="img"` element whose `aria-label` equals the text equivalent, the same text is visible, the cells are `aria-hidden`, the text `oldest to newest` is present, and the first cell in the markup is the oldest run; the run counts table lists the four counts of each run newest first, with `unknown` for a null count; the marker class depends on the colour only.
    - Command: `npx vitest --run tests/components.levels.test.tsx`. Expected: fails (module missing).
    - _Requirements: 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.12, 4.13, 11.2_

  - [x] 15.4 Implement `LevelCard`, `TrendStrip` and `RunCounts`
    - Create `ui/src/components/LevelCard.tsx`, `TrendStrip.tsx` (with `RunCounts` in the same file or its own) as in the design.
    - Command: `npx vitest --run tests/components.levels.test.tsx`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 4.2–4.13, 11.2_

  - [x] 15.5 Write the failing render tests for the findings list and the copy controls
    - Create `ui/tests/components.findings.test.tsx`. Import `FindingsList`, `FindingItem`, `CopyButton` from `../src/components/*` (missing).
    - Cases: the findings sentence of Requirement 6 criterion 6 is present; the hunt header shows the time, short commit, Hunt_Id and the six counts, with `unknown` for a null count; an item shows the level id, the class label, the short commit, the time, the tokens separated by single spaces in a monospace `code` element, the result fields, `found on an earlier commit` when the latest commit differs and not when it is equal or absent; an unknown class shows the stored string; a valid level id shows the Replay_Command and the help text of Requirement 7 criterion 1; an invalid level id shows `level id not valid` and no command; a decodable item shows the Actions_File_Text in a read-only block and its copy button; an item that does not decode shows `action list could not be converted to a file`, still shows the tokens and the token copy button, and no file text; there are three copy buttons for a decodable item and two otherwise; each is a `button` element whose accessible name includes the level id (`Copy action list for 02-the-chaser`, `Copy replay command for 02-the-chaser`, `Copy actions file for 02-the-chaser`); the fallback view shows a read-only, focused `textarea` holding the text and the message `Copy is not available here. Select the text and press Ctrl+C.`; the live region has `aria-live="polite"`; no suggestion to pass JSON inline appears.
    - Command: `npx vitest --run tests/components.findings.test.tsx`. Expected: fails (module missing).
    - _Requirements: 5.4, 5.5, 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.4, 11.5, 11.6_

  - [x] 15.6 Implement `FindingsList`, `FindingItem` and `CopyButton`
    - Create `ui/src/components/FindingsList.tsx`, `FindingItem.tsx` and `CopyButton.tsx` as in the design. The token element uses `white-space: pre-wrap` and `overflow-wrap: anywhere` (in the style constant). The fallback `textarea` is focused and fully selected in a `useEffect` (`focus()` then `select()`).
    - Command: `npx vitest --run tests/components.findings.test.tsx`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 6.1–6.7, 7.1–7.7, 11.4, 11.5, 11.6_

  - [x] 15.7 Write property test for "text, not markup"
    - Create `ui/tests/components.safety.test.tsx`. Add generators for strings that hold `<script>`, `<img src=x onerror=1>`, `&amp;`, quotes, `javascript:`, `</style>` and newlines, placed into every string field of a Results_Value, a Findings_Value and a Crons value (including a `script` field on the cron job), to `ui/tests/arbitraries.ts`. Tag `// Feature: dashboard, Property 14: Text, not markup`. Check on the markup of the whole page: the count of `<script`, `<img` and `<a ` is zero; every generated hostile string that is shown appears only in its escaped form (`&lt;`, `&quot;`, `&amp;`); the `script` string of the cron job appears neither in the markup nor in the View_Model; the page never contains an `href` or `src` attribute built from route data. `numRuns` 100 or more. Failure rule as in task 3.3.
    - **Property 14: Text, not markup**
    - Command: `npx vitest --run tests/components.safety.test.tsx`. Expected: passes.
    - _Requirements: 2.9, 5.10; Properties: 14_

  - [x] 15.8 Write the accessibility tests
    - Create `ui/tests/components.a11y.test.tsx`. Render the whole page from `config.with-findings.json` and `crons.replay-idle.json`. Check: exactly one `main`; headings in order (`h1`, then `h2` sections, then `h3` cards and findings, no level skipped); each `section` has an accessible name (`aria-labelledby` or `aria-label`); every level card holds its Colour_Label text; every colour marker is `aria-hidden` and accompanied by text; every trend strip has its text; every control is a `button` element with a non-empty accessible name; the buttons that name a level include the level id; the style constant contains a `:focus-visible` rule, a `prefers-reduced-motion` rule, no `animation` and no `transition` that the content needs, and no `color:` declaration on a label rule (labels use the host text colour); the live region is `aria-live="polite"`; the Refresh_Button shows `aria-busy="true"` and the text `Reading` while a Read is in flight.
    - Command: `npx vitest --run tests/components.a11y.test.tsx`. Expected: passes (it exercises finished code). Then `npm run typecheck`.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.7, 11.8, 11.9_

- [x] 16. Page and entry
  - [x] 16.1 Write the failing unit tests for `page.tsx` and `sdk.ts`
    - Create `ui/tests/page.test.tsx`. Import `createDashboardPage` from `../src/page` and `pickFunction` from `../src/sdk` (missing).
    - Cases: `pickFunction` returns a function export and null for a missing export, a non-function export and a missing record; `createDashboardPage` reads `useAppApi` and `useAppInfo` once, at the call (a spy counts `typeof` reads of the fake SDK record); the component renders with a fake SDK whose `useAppApi` returns a recording API with `get` only; with `useAppApi` missing, the page shows `Kiro Crew did not provide the app API` and the Refresh_Button is disabled; with `useAppApi` throwing, the same and no crash; with `useAppInfo` returning a different `name`, the notice shows both names and the paths still use `grimsheet-playtester`; with `useAppInfo` missing or throwing, no notice and no crash; the first render shows `Reading results`; the component uses no hook outside the five allowed React hooks and the two SDK hooks.
    - Command: `npx vitest --run tests/page.test.tsx`. Expected: fails (module missing).
    - _Requirements: 9.4, 9.5, 9.6, 9.9, 3.1, 3.12_

  - [x] 16.2 Implement `sdk.ts`, `page.tsx` and `index.tsx`
    - Create `ui/src/sdk.ts` (`SdkRecord`, `pickFunction`), `ui/src/page.tsx` (`createDashboardPage(sdk)`: the two SDK hooks read once at creation and called unconditionally in the component; `useRef` for the controller; `useEffect` for `start` and `stop`; `useSyncExternalStore` for the snapshot; `useMemo` for `buildViewModel`; `useState` for the copy state and the live-region message; the `changeKey` comparison for `Results updated`; the real `CopyEnv` read inside the click handler) and `ui/src/index.tsx` (`import * as sdk from '@kirocrew/app-sdk'` and the default export, as in the design).
    - Command: `npx vitest --run tests/page.test.tsx`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 9.4, 9.5, 9.6, 9.8, 9.9_

  - [x] 16.3 Write the test for the entry module
    - Create `ui/tests/entry.test.tsx`. Import `../src/index` (the Vitest alias maps `@kirocrew/app-sdk` to the empty stub). Check: the default export is a function; rendering it with `renderToStaticMarkup` shows `Kiro Crew did not provide the app API` (the stub has no `useAppApi`) and does not throw; the module has no named exports other than the default.
    - Command: `npx vitest --run tests/entry.test.tsx`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 9.4, 9.5, 9.8_

- [x] 17. Build and check-dist
  - [x] 17.1 Write the failing tests for `check-dist`
    - Create `ui/tests/check-dist.test.ts`. Import `checkDistText` and `checkDistFiles` from `../scripts/check-dist.mjs` (missing).
    - Cases for `checkDistText(text)`: a clean module that imports only the five allowed specifiers and `import * as` the SDK passes; each of these fails with a message that names the problem: an import from `@kirocrew/app-sdk/ui`; an import from `react-dom/client`; an import from `./other.js`; a named SDK import (`import { useAppApi } from "@kirocrew/app-sdk"`); `C:\Users\someone\x`; `D:\work`; `Users\`; `token=abc`; `http://localhost:5476`; `https://example.com`. `checkDistFiles(names)` passes for `['index.mjs']` and fails for an empty list, a missing `index.mjs`, and any extra file.
    - Command: `npx vitest --run tests/check-dist.test.ts`. Expected: fails (module missing).
    - _Requirements: 9.1, 9.2, 9.4, 9.7, 9.10_

  - [x] 17.2 Implement `scripts/check-dist.mjs`
    - Create `ui/scripts/check-dist.mjs` (plain ESM, JSDoc, no dependency) exporting `checkDistText` and `checkDistFiles`, and, when run as the entry, reading `dist/` and `dist/index.mjs` relative to its own location and exiting with code 1 and the messages on a failure.
    - Change after the first build (approved by the developer, an exception to "never edit the check"): the check for `token=` looks for a token value, not the bare text. It is a case-insensitive match of `token=` followed by at least 6 characters from `[A-Za-z0-9._~%-]`, and the message is "contains a token value". Reason: the first version flagged the redaction code of `errors.ts` (its pattern `token=[^\s&]*` and its replacement text `token=…`), which only mentions the word. Tests in `tests/check-dist.test.ts` come first: it flags `?token=ab12cd34ef` and `TOKEN=abcdef`, and passes the pattern source `token=[^\s&]*` and the output `token=…`. The redaction code stays plain; code written to hide text from a scan is not acceptable.
    - Command: `npx vitest --run tests/check-dist.test.ts`. Expected: passes. Then `npm run typecheck`.
    - _Requirements: 9.2, 9.7, 9.10_

  - [x] 17.3 Run the build and read the result
    - In `ui/` run `npm run build`. Expected: Vite writes `dist/index.mjs` and `check-dist` passes. Read (read only) the import lines of `dist/index.mjs` and report them: only `react/jsx-runtime`, `react` (hooks) and `@kirocrew/app-sdk` as a namespace are expected, and the size. Confirm that the build used no network. If the build fails or `check-dist` fails, STOP and report; do not edit the check to make it pass.
    - `dist/` is ignored by git (the root `.gitignore` has `dist/`). Nothing is installed into the host: that belongs to `packaging`.
    - _Requirements: 9.1, 9.2, 9.7, 9.10, 9.11_

- [x] 18. Final checkpoint
  - [x] 18.1 Ensure all tests and gates pass
    - In `ui/` run `npm test`, `npm run typecheck` and `npm run build`. All three must pass. From the repository root run `npm test` and `npm run typecheck` and check that the root results are unchanged and that no `ui/` file was collected by the root run. Run `git status --porcelain` (read only) and confirm that only `ui/`, `.kiro/specs/dashboard/`, `.kiro/steering/dashboard.md` and (after task 19.1) `KIRO_USAGE.md` changed, and that `app.json`, `scripts/`, the root `tests/`, the root `package.json` and the root `tsconfig.json` did not. Ask the user if questions arise.
    - _Requirements: 10.12, 9.1_

- [x] 19. Update `KIRO_USAGE.md`
  - [x] 19.1 Write the dashboard entry
    - Read `KIRO_USAGE.md` first and follow its entry format (`## YYYY-MM-DD - short title`, then `Surface`, `Features`, `What I asked for`, `What Kiro did`, `What changed because of it`). Append an entry for the dashboard spec: requirements reviewed with changes, the design with 22 decisions, the pure core built test-first, the 15 properties (tag `pbt`), the controller with a fake clock and a recording fake API, `react-dom/server` rendering tests, the decision not to import `@kirocrew/app-sdk/ui` and the reason (E09), the stale warning added by the developer, the React 18 and 19 compatibility rule, the check-dist script, and any decision that changed because of a test.
    - Name no tool other than Kiro. Replace any Windows user name or home path with `~`, `%USERPROFILE%` or `%LOCALAPPDATA%`.
    - _Requirements: 10.12_

## Notes

- Out of scope for this plan, and not done by any task: the `app.json` edit (`ui.entry`, the two `permissions.api` entries, Requirement 1 criterion 6 and Requirement 9 criterion 1's manifest side), installing the page into Kiro Crew, reading `/api/crons` on the installed app (Open question Q3), the config route size limit (Q8), `mountFunction` and `entryPoint` (Q9), and the host's React version (Q10). They belong to the `packaging` spec.
- The compact Level_Entry carries `endHp` for a ReplayOk since the `replay-runner` amendment (task 16.1; Open question Q1, closed). The page shows end HP when the entry has it and needed no change when the amendment landed.
- Tasks that write failing tests (2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1, 14.2, 14.4, 14.7, 15.1, 15.3, 15.5, 16.1, 17.1) are expected to fail until the implementation task that follows. `npm run typecheck` is run after implementation tasks, because a test that imports a missing module cannot type-check.
- Property 14 and the accessibility tests render with `react-dom/server`, so effects (`useEffect`) do not run in them. The effects (`start`, `stop`, focus and select of the fallback text area, the 3 second clear of the copy message) are covered by the controller and copy tests and by the page test with the fake SDK; a real browser check belongs to `packaging`.
- Requirement 11, criterion 3 (contrast) is met by construction: label text uses the host text colour and the marker colours are decoration only. Task 15.8 checks the style constant for that; the contrast in both host themes is not measured here (the requirement excludes assistive-technology validation).
- Only React 18 and 19 common APIs are used. If a task finds that an API behaves differently between the two (for example `useSyncExternalStore` server rendering), STOP and report.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["3.1", "4.1", "5.1", "6.1"] },
    { "id": 6, "tasks": ["3.2", "4.2", "5.2", "6.2"] },
    { "id": 7, "tasks": ["3.3", "5.3", "6.3", "6.4"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["7.2"] },
    { "id": 10, "tasks": ["7.3", "8.1", "9.1"] },
    { "id": 11, "tasks": ["8.2", "9.2"] },
    { "id": 12, "tasks": ["8.3", "10.1"] },
    { "id": 13, "tasks": ["10.2"] },
    { "id": 14, "tasks": ["10.3", "10.4", "11.1"] },
    { "id": 15, "tasks": ["11.2"] },
    { "id": 16, "tasks": ["11.3", "11.4", "11.5", "12.1"] },
    { "id": 17, "tasks": ["12.2"] },
    { "id": 18, "tasks": ["12.3"] },
    { "id": 19, "tasks": ["13.1"] },
    { "id": 20, "tasks": ["14.1"] },
    { "id": 21, "tasks": ["14.2", "14.7"] },
    { "id": 22, "tasks": ["14.3", "14.8"] },
    { "id": 23, "tasks": ["14.4"] },
    { "id": 24, "tasks": ["14.5"] },
    { "id": 25, "tasks": ["14.6"] },
    { "id": 26, "tasks": ["15.1", "15.3", "15.5"] },
    { "id": 27, "tasks": ["15.2", "15.4", "15.6"] },
    { "id": 28, "tasks": ["15.7", "15.8"] },
    { "id": 29, "tasks": ["16.1"] },
    { "id": 30, "tasks": ["16.2"] },
    { "id": 31, "tasks": ["16.3", "17.1"] },
    { "id": 32, "tasks": ["17.2"] },
    { "id": 33, "tasks": ["17.3"] },
    { "id": 34, "tasks": ["18.1"] },
    { "id": 35, "tasks": ["19.1"] }
  ]
}
```
