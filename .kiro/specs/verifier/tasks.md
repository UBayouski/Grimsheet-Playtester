# Implementation Plan: verifier

## Overview

This plan builds `scripts/verifier.mjs`, the pure module that turns `play.mjs` output into a replay verdict (green, amber, red, error) or a candidate check (confirmed, rejected, error). The language is plain ESM JavaScript with JSDoc types and `// @ts-check`, as the design states. Tests use Vitest and fast-check and need no network and no Grimsheet checkout.

Order of work: tooling first, then fixtures captured from the real play command (so the real output shapes are known before any verifier code), then the arbitraries, then the verifier in four test-first steps (validation, replay verdict, candidate check, safety net), then the full property set, the fixture tests, a checkpoint and the usage log.

Rules that apply to every task:
- The verifier does no I/O. Only the fixture capture (task 2) reads `../grimsheet`, and it never writes there and never builds there. No test runs `play.mjs`.
- No git write command is run in this spec. `git rev-parse` and `git status --porcelain` only read.
- Commands are PowerShell-safe: one command per call, no `&&`, no inline JSON (use `--actions-file`).
- Real requirement numbers come from `requirements.md`. Property numbers come from `design.md`.
- If a task finds the real output contradicts the design, it stops and reports to the user. It does not change the design or write verifier code on its own.

## Tasks

- [x] 1. Set up tooling
  - [x] 1.1 Create `package.json` and `tsconfig.json`, install, and pass the empty gates
    - Write `package.json` at the repo root with `"name": "grimsheet-playtester"`, `"private": true`, `"type": "module"`, `"engines": {"node": ">=22.12"}`, scripts `"test": "vitest --run"` and `"typecheck": "tsc --noEmit -p tsconfig.json"`, and `devDependencies` `typescript` `6.0.3`, `vitest` `5.1.0`, `fast-check` `4.10.2`, all exact (no `^` or `~`).
    - Write `tsconfig.json` exactly as in the design's Tooling section (`allowJs`, `checkJs`, `noEmit`, `strict`, `target` ES2022, `module` and `moduleResolution` NodeNext, `types: ["node"]`, `include` of `scripts/**/*.mjs` and `tests/**/*.mjs`).
    - Run `npm install --save-dev --save-exact @types/node@22` so the 22.x release is resolved and pinned exactly. Then run `npm install`.
    - Vitest exits with an error when it finds no test files, and `tsc` fails with TS18003 when `include` matches no file. To keep both gates passing before real code exists, write one smoke test, `tests/smoke.test.mjs`, with `// @ts-check`, importing `describe`, `it`, `expect` from `vitest` and asserting `1 + 1` equals `2`. It is removed in task 8.17 once real tests exist.
    - Run `npm test` and `npm run typecheck`. Both must pass.
    - If the `checkJs` typecheck misbehaves with `typescript` 6.0.3 (for example it fails on `tsconfig.json` options or on the smoke test with errors that are not in the repo's code), STOP and report to the user. Fallback options (another pinned version, other options) are the user's choice. Do not change the pinned versions on your own.
    - _Requirements: 1.1, 7.1_

  - [x] 1.2 Check that `node_modules` is ignored
    - Read `.gitignore` (read only). It already lists `node_modules/`. If that line is missing when this task runs, add `node_modules/` to `.gitignore` with a file edit. This is a file edit, not a git command.
    - Run `git check-ignore node_modules` to confirm (a read-only command; it prints the path when ignored).
    - _Requirements: 7.1_

- [x] 2. Capture fixtures from the real play command
  - [x] 2.1 Prepare the folders, record the commit, and write the action files
    - Create `tests/fixtures/`, `tests/fixtures/solutions/` and `tests/fixtures/actions/`.
    - In PowerShell set `$g = (Resolve-Path ../grimsheet).Path` and `$r = (Get-Location).Path` (both absolute). Run `git -C $g rev-parse HEAD` and `git -C $g status --porcelain`. Write `tests/fixtures/GRIMSHEET_COMMIT.txt`: the commit hash on the first line, then `clean` (porcelain output empty) or `dirty`.
    - Check that `$g\dist-play\headless.js` exists. If it does not, STOP and report to the user. Do not build in `../grimsheet`.
    - Copy `$g\tests\solutions\01-the-corridor.json`, `02-the-chaser.json` and `03-the-locked-crypt.json` to `tests/fixtures/solutions/` and to `tests/fixtures/actions/` (`Copy-Item`, destination inside this repo only).
    - With the file-writing tool (not a shell redirect, so there is no BOM and no quote loss) write two hand-made action files in `tests/fixtures/actions/`: `02-the-chaser.truncated.json` (a bare JSON array holding the first 3 actions of the `02-the-chaser` solution) and `01-the-corridor.undo-first.json` (a bare JSON array: `{"kind":"undo"}` followed by the moves of the `01-the-corridor` solution).
    - Nothing is written under `../grimsheet`.
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [x] 2.2 Run `play.mjs` for the five cases and save raw stdout and the manifest
    - Before the first `node` call, run `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)` in the same PowerShell session, because Windows PowerShell 5.1 otherwise decodes node's stdout with the console code page and would corrupt any non-ASCII text in a capture.
    - For each case run `node "$g\scripts\play.mjs" <level-id> --actions-file "$r\tests\fixtures\actions\<name>.json"` with absolute paths, capture stdout into a variable, and read `$LASTEXITCODE` on the very next line. Cases: `01-the-corridor` (solution copy), `02-the-chaser` (solution copy), `03-the-locked-crypt` (solution copy), `02-the-chaser` with the truncated list, `01-the-corridor` with the undo-first list.
    - Save each stdout as `tests/fixtures/<name>.play.json` with `[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding $false))` (UTF-8 without BOM; join captured lines with a newline). File names: `01-the-corridor.play.json`, `02-the-chaser.play.json`, `03-the-locked-crypt.play.json`, `02-the-chaser.truncated.play.json`, `01-the-corridor.undo-first.play.json`.
    - Write `tests/fixtures/manifest.json`, a JSON array of `{file, levelId, actionsFile, exitCode, note}` with the exit code read from `$LASTEXITCODE` and a note that describes each case (for example "01 solution preceded by a refused undo"). Write it without a BOM.
    - Success is the exit code and the JSON, not stderr text. Do not run `npm ci` or any build in `../grimsheet`.
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

  - [x] 2.3 Inspect the captured JSON against the design
    - Read each `.play.json` and check, with the file-reading tool: top-level `levelId`, `start`, `steps`, `final`, and `refusedAt` (present only when an action was refused); `start` and `final` carry `hero`, `hp`, `ink`, `turn`, `status`; each step carries `index`, `action`, `accepted`, `damage`, `hero`, `hp`, `ink`, `turn`, `status`, and, when refused, `reason` and `message`.
    - Check the five exit codes in `manifest.json`: expect 0 for all five.
    - Check the cases the design expects: 01, 02, 03 end with `final.status` `"won"` and `start.ink - final.ink` equal to `minimalInk` of the matching solution copy; the truncated case does not win; the undo-first case has `refusedAt` 0, step 0 with `accepted` false plus `reason` and `message`, and still wins.
    - Check that each step `action` echoes only `kind`, `dir` (move), `address` and `raw` (edit), as Requirement 5.11 relies on.
    - Write the findings as a short list in the task notes of this spec session (not in a new file). If the real output contradicts the design or the requirements (for example the refused-step fields, a missing field, an exit code other than 0, or a step `action` with extra or renamed fields), STOP and report to the user before changing the design or writing any verifier code.
    - _Requirements: 8.1, 5.11, 7.6_

- [x] 3. Build the test arbitraries
  - [x] 3.1 Write the action, stored-solution and play-result arbitraries
    - Create `tests/arbitraries.mjs` (`// @ts-check`, JSDoc types). Import `fast-check`.
    - `arbAction`: `move` with `dir` from N/S/E/W, `wait`, `edit` with address from the grid `A1`..`C20` and a short `raw`, and `undo`.
    - `arbStored(levelId)`: `{levelId, minimalInk: nat 0..4, actions: array of arbAction}`.
    - `arbPlayFor(levelId, actions, mode)`: builds a consistent Play_Result from an action list. One step per action with `index`, `action` (only `kind`, `dir`, `address`, `raw`), `accepted` (mostly true, sometimes false with `reason` and `message`), `status`, `ink`, `hp`. `mode` is `won`, `lost` or `other`; the ink spent is chosen below, equal to or above `minimalInk`. `final.ink = start.ink - spent`, `final` equals the last step, `refusedAt` is the first refused index when any.
    - Exercised first by the tests of tasks 4 to 6 (tasks 3.1 to 3.3 have no test of their own).
    - _Requirements: 7.5_

  - [x] 3.2 Write the input arbitraries
    - In `tests/arbitraries.mjs` add `arbReplayInput` (stored, then a Play_Result built from `stored.actions`; yields `[levelId, stored, 0, play]`), `arbCandidateInput` (stored, claimed class, candidate actions that are an `arbAction` array or sometimes a copy of the stored actions, play built from the candidate; yields all six arguments) and `arbAnything` (`fc.anything()` for each argument position).
    - Valid inputs are built by construction, never filtered with `fc.pre`.
    - _Requirements: 7.5_

  - [x] 3.3 Write the breakers with their expected reason codes
    - In `tests/arbitraries.mjs` add a breaker list applied with probability about 0.15. Each breaker returns the broken arguments and the reason code it must produce: wrong exit code (2 gives `bad_input`; 1 and `"0"` give `play_failed`), a deleted or null play field (`malformed_play_result`), `NaN` ink (`malformed_play_result`), negative ink spent (`malformed_play_result`), another `levelId` in the play or the solution (`level_mismatch`), solution `minimalInk` of `-1` or `1.5` (`malformed_solution`), missing stored `actions` (`malformed_solution`), a stored action of unknown kind (`malformed_solution`), an unknown class (`unknown_class`), a candidate action of unknown kind (`malformed_candidate`), one step action changed, one step dropped, and an address case flipped (all `replay_mismatch`).
    - Export `arbReplayInput` and `arbCandidateInput` both with and without the breaker, so a test can ask for valid inputs only or for broken inputs with their expected code.
    - _Requirements: 7.5, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12_

- [x] 4. Validation and the error outcomes (test-first)
  - [x] 4.1 Write the unit tests for the validation error codes
    - Create `tests/verifier.replay.test.mjs`. Import `replayVerdict` from `../scripts/verifier.mjs` (the module does not exist yet; the file fails until 4.2).
    - Add one case per code in the design's validation order, for `replayVerdict`: `level_mismatch` for a non-string `levelId` (the error has no `levelId` field) and for a play and a solution `levelId` mismatch; `bad_input` for exit code 2; `play_failed` for exit code 1 and for a non-number exit code; `malformed_play_result` for each of: play result missing, `start`/`final`/`steps` missing, `start.ink`/`final.ink`/`final.hp` not finite, `final.status` not a string, a step that is not an object, a step with no object `action`, a step with a non-boolean `accepted`, and a negative ink spent; `malformed_solution` for a missing solution, missing `actions`, `minimalInk` of `-1` and `1.5`, and a stored action of unknown kind.
    - Add a test that the first failing step wins when two inputs are bad (exit code 2 with a malformed play result gives `bad_input`).
    - Error objects carry `colour: 'error'`, `reasonCode`, `reason`, and `levelId` only when it is a string.
    - Command: `npx vitest --run tests/verifier.replay.test.mjs` (expected to fail until 4.2).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.13, 7.4_

  - [x] 4.2 Create `scripts/verifier.mjs` with the validation helpers and the replay entry
    - Create `scripts/verifier.mjs` with `// @ts-check`, the JSDoc typedefs from the design (`Action`, `ExploitClass`, `StoredSolution`, `PlayState`, `Step`, `PlayResult`, `Colour`, `ReplayOk`, `ReplayError`, `ReplayVerdict`, `CheckOk`, `CheckError`, `CheckResult`, `ReasonCode`), and no imports.
    - Add the private helpers `isKnownAction`, `normaliseAddress` (trim and upper-case, strings only) and `errorOutcome` (reason text fixed per code; `levelId` only when it is a string; keys omitted, never `undefined`).
    - Add `validateCommon(levelId, stored, exitCode, play)` that applies steps 1 to 6 of the design's validation order (`level_mismatch`, `bad_input`, `play_failed`, `malformed_play_result`, play `level_mismatch`, `malformed_solution`, stored `level_mismatch`) using `typeof` and `Array.isArray` only, so nothing throws on unchecked values.
    - Export `replayVerdict(levelId, storedSolution, exitCode, playResult)`. For now it returns the validation error when there is one; the decision branch is added in 5.2 (leave one marked `TODO(5.2)` comment that 5.2 removes).
    - Command: `npx vitest --run tests/verifier.replay.test.mjs`. The validation tests from 4.1 must pass.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.13_

  - [x] 4.3 Typecheck the validation code
    - Run `npm run typecheck`. Fix every error in `scripts/verifier.mjs`, `tests/arbitraries.mjs` and `tests/verifier.replay.test.mjs`.
    - Run `npm test`. The smoke test and the validation tests pass.
    - _Requirements: 1.1_

- [x] 5. Replay verdict (test-first)
  - [x] 5.1 Write the unit tests for the replay verdict
    - In `tests/verifier.replay.test.mjs` add cases built by hand: `green` (won, ink equal); `amber` with more ink and with less ink; `red` (not won, whatever the ink); a refused step with a win keeps the colour and sets `refusedAt` to the first refused index (and a Play_Result `refusedAt` that is not a non-negative integer falls back to the first step with `accepted === false`, then to `null`); `statusChangeIndex` is `null` for empty steps and for no change, and the zero-based position of the first change otherwise (including change at position 0 against `start.status`); all verdict fields present (`levelId`, `colour`, `won`, `endHp`, `inkSpent`, `minimalInk`, `statusChangeIndex`, `refusedAt`).
    - Add `replay_mismatch` cases: step count differs; a step with only an extra field does not mismatch; an `address` that differs only in case does mismatch; a changed `kind`, `dir` or `raw` mismatches.
    - Command: `npx vitest --run tests/verifier.replay.test.mjs` (the new cases fail until 5.2).
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.13, 5.11, 6.1, 6.2, 6.3, 6.4, 7.4_

  - [x] 5.2 Implement the replay decision
    - In `scripts/verifier.mjs` add `inkSpent`, `statusChangeIndex`, `actionsMatchSteps` (kind, `dir` for move, `address` and `raw` for edit, compared exactly) and the refusedAt rule (Play_Result `refusedAt` when a non-negative integer, else the index of the first step with `accepted === false`, else `null`).
    - Complete `replayVerdict`: after `validateCommon`, apply the `replay_mismatch` check (step 9) against the stored actions, then decide the colour (`green`, `amber`, `red`) and return the `ReplayOk` shape. Remove the `TODO(5.2)` comment. Do not sort or change input arrays.
    - Command: `npx vitest --run tests/verifier.replay.test.mjs`. All replay tests pass.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.12, 2.13, 5.11, 6.1, 6.2, 6.3, 6.4_

- [x] 6. Candidate check (test-first)
  - [x] 6.1 Write the unit tests for the candidate check
    - Create `tests/verifier.candidate.test.mjs`. Import `checkCandidate` (fails until 6.2).
    - Cases: each class confirmed and rejected (`cheaper_win`, `free_win`, `unexpected_route`); `unknown_class`; `malformed_candidate` (not an array, an action of unknown kind); `replay_mismatch`; `not_won` for any claimed class; `minimalInk` 0 gives `no_ink_below_zero` (cheaper) and `minimal_ink_zero` (free); `has_edits`; `not_cheaper`; a stored lower-case address matches an upper-case step address; a refused edit on a new cell gives `no_new_cell`; an accepted edit on a new cell followed by an accepted `undo` and then the stored solution gives `rejected` with `no_new_cell`; a refused step between the edit and the `undo` still counts as undone; a copy of the stored actions is rejected for all three classes; `editCount` counts refused edits too; `newEditAddresses` is sorted without duplicates.
    - Measured-class text: a rejection ends with "Measured class: X." when exactly one other class applies, "Measured class: none." when none, and "Measured classes: A and B." when two. The reason code stays the claimed-class code.
    - Check the Check_Result carries `levelId`, `claimedClass`, `outcome`, `reasonCode`, `reason`, `won`, `inkSpent`, `minimalInk`, `editCount`, `newEditAddresses`.
    - Command: `npx vitest --run tests/verifier.candidate.test.mjs` (expected to fail until 6.2 to 6.4).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 7.4_

  - [x] 6.2 Add the candidate validation and mismatch steps
    - In `scripts/verifier.mjs` export `checkCandidate(levelId, storedSolution, claimedClass, candidateActions, exitCode, playResult)`. After `validateCommon`, apply step 7 (`unknown_class`), step 8 (`malformed_candidate`, using `isKnownAction`) and step 9 (`replay_mismatch` against the candidate actions). The error outcome carries `claimedClass` only when it is a string.
    - Until 6.3 a valid input returns a marked `TODO(6.3)` placeholder error outcome with reason code `internal_error`; 6.3 removes it.
    - Command: `npx vitest --run tests/verifier.candidate.test.mjs`. The validation cases pass; the class cases still fail.
    - _Requirements: 3.1, 3.5, 3.7, 5.11, 5.12, 5.13_

  - [x] 6.3 Implement the accepted-edit rule and the three class tests
    - In `scripts/verifier.mjs` add `acceptedEditAddresses(steps)` with the undo rule (an accepted edit whose next accepted step is an accepted `undo` is skipped; refused steps are passed over when looking for the next accepted step), `newEditAddresses` (addresses not edited by the stored solution, normalised, unique, default string sort), and `editCount` (all `edit` actions in the candidate, refused ones included).
    - Complete `checkCandidate`: `not_won` first; then `cheaper_win` (`no_ink_below_zero`, `not_cheaper`), `free_win` (`minimal_ink_zero`, `has_edits`) and `unexpected_route` (`no_new_cell`); `confirmed` with `class_reproduced` only from those branches, reading only `won`, `inkSpent`, `minimalInk`, `editCount` and `newEditAddresses`. Remove the `TODO(6.3)` placeholder.
    - Command: `npx vitest --run tests/verifier.candidate.test.mjs`.
    - _Requirements: 3.2, 3.3, 3.4, 3.6, 3.8, 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 4.10, 4.11_

  - [x] 6.4 Add the measured-class text to rejections
    - In `scripts/verifier.mjs` compute, on a rejection from a class branch, the other two classes whose tests are true (`isCheaper && minimalInk > 0`, `isFree`, `isUnexpected`) and append "Measured class: X.", "Measured class: none." or "Measured classes: A and B." to the reason. `not_won`, `minimal_ink_zero` and `no_ink_below_zero` carry no suffix. The reason code does not change.
    - Command: `npx vitest --run tests/verifier.candidate.test.mjs`. All candidate tests pass. Then run `npm run typecheck`.
    - _Requirements: 4.8, 3.3_

- [x] 7. Safety-net wrapper (test-first)
  - [x] 7.1 Write the unit tests that force `internal_error`
    - In `tests/verifier.replay.test.mjs` and `tests/verifier.candidate.test.mjs` add cases that pass an input object with a throwing getter (for example a play result whose `start` getter throws). Expect no throw and an error outcome with `reasonCode` `internal_error` for both `replayVerdict` and `checkCandidate`.
    - Check the error carries `levelId` when the `levelId` argument is a string and omits it when it is not; for the candidate check, `claimedClass` only when it is a string.
    - Command: `npx vitest --run tests/verifier.replay.test.mjs tests/verifier.candidate.test.mjs` (the new cases fail until 7.2).
    - _Requirements: 5.1, 5.2, 7.4_

  - [x] 7.2 Split each export into a wrapper and an inner function
    - In `scripts/verifier.mjs` rename the current bodies to private `replayVerdictInner` and `checkCandidateInner`. Make `replayVerdict` and `checkCandidate` thin wrappers that call the inner function inside `try/catch` and, on a throw, return `errorOutcome` with `internal_error` ("The verifier hit an internal fault."). The catch result is built with `typeof` checks only, so building it cannot throw.
    - Command: `npm test` and then `npm run typecheck`. Both pass.
    - _Requirements: 1.6, 5.1, 5.2_

- [x] 8. Full test suite: unit audit, properties and fixtures
  - [x] 8.1 Audit the unit tests against the design's unit list
    - Compare `tests/verifier.replay.test.mjs` and `tests/verifier.candidate.test.mjs` with the "Unit cases" list in the design and with Requirement 7.4. Add any case that is missing (for example one case per reason code, each colour, each class confirmed and rejected, the `minimalInk` 0 cases, lower-case addresses, refused edit steps, the undone-edit case).
    - Command: `npm test`.
    - _Requirements: 7.4_

  - [x] 8.2 Write property test for determinism
    - Create `tests/verifier.properties.test.mjs` (imports `fast-check`, `vitest`, the verifier and `tests/arbitraries.mjs`). Tag each property `// Feature: verifier, Property N: <title>`. Each is one `fc.assert` with `numRuns` 100 or more.
    - **Property 1: Determinism** — for any arguments (valid, broken or arbitrary), calling either function twice with deeply equal cloned arguments returns deeply equal results.
    - **Validates: Requirements 1.5, 2.12, 3.11**
    - _Requirements: 1.5, 2.12, 3.11_

  - [x] 8.3 Write property test for JSON safety and untouched inputs
    - **Property 2: Verdicts are JSON-safe and inputs are untouched** — the result equals `JSON.parse(JSON.stringify(result))`, and the arguments deep-equal a clone taken before the call.
    - **Validates: Requirements 1.3, 1.4**
    - _Requirements: 1.3, 1.4_

  - [x] 8.4 Write property test for colour
    - **Property 3: Colour matches won and ink** — for valid replay input, `green` implies won and ink spent equal to `minimalInk`; `amber` implies won and a different ink; `red` implies not won; the colour is exactly one of the three.
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.8, 2.9, 2.10, 2.11**
    - _Requirements: 2.2, 2.3, 2.4, 2.8, 2.9, 2.10, 2.11_

  - [x] 8.5 Write property test for refusals
    - **Property 4: Refusals do not change the colour** — for a valid winning replay input, inserting a refused step (the same action added to the stored actions and as a refused step, so steps and actions stay in step) leaves the colour unchanged and sets `refusedAt`.
    - **Validates: Requirements 2.7**
    - _Requirements: 2.7_

  - [x] 8.6 Write property test for confirmed candidates
    - **Property 5: Confirmed only when the replay reproduces the class** — for valid candidate input, `confirmed` implies the play is won and the measured values meet the claimed class; `free_win` confirmed implies `editCount` 0 and `minimalInk` above 0; `cheaper_win` confirmed implies ink spent below `minimalInk`.
    - **Validates: Requirements 3.2, 3.3, 3.9, 4.1, 4.2, 4.3, 4.10, 4.11**
    - _Requirements: 3.2, 3.3, 3.9, 4.1, 4.2, 4.3, 4.10, 4.11_

  - [x] 8.7 Write property test for not won
    - **Property 6: Not won is never confirmed** — for valid candidate input with a non-winning play result and any claimed class, the outcome is `rejected` with `not_won`.
    - **Validates: Requirements 3.6**
    - _Requirements: 3.6_

  - [x] 8.8 Write property test for a copy of the stored solution
    - **Property 7: Copy of the stored solution is rejected** — for any valid stored solution and a green replay of its own actions, every class is rejected.
    - **Validates: Requirements 3.8**
    - _Requirements: 3.8_

  - [x] 8.9 Write property test for edit order in the stored solution
    - **Property 8: Edit order in the stored solution does not matter** — permuting the edit actions of the stored solution does not change the outcome.
    - **Validates: Requirements 4.9**
    - _Requirements: 4.9_

  - [x] 8.10 Write property test for address case
    - **Property 9: Address case does not matter** — changing the case and padding of the stored solution addresses (not the candidate's) does not change the outcome.
    - **Validates: Requirements 4.6**
    - _Requirements: 4.6_

  - [x] 8.11 Write property test for undone and refused edits
    - **Property 10: Undone and refused edits are not new cells** — `newEditAddresses` has no address whose only accepted edits are refused or followed by an accepted `undo` (refused steps in between are skipped), and the list is sorted and free of duplicates.
    - **Validates: Requirements 3.4, 4.7**
    - _Requirements: 3.4, 4.7_

  - [x] 8.12 Write property test for bad input
    - **Property 11: Bad input gives an error, never a throw** — for any value in each argument position (`arbAnything`) and for the breakers, the function returns without throwing, and a broken input gives its expected reason code from the breaker list.
    - **Validates: Requirements 5.1, 5.2, 5.13**
    - _Requirements: 5.1, 5.2, 5.13_

  - [x] 8.13 Write property test for mismatched steps
    - **Property 12: Mismatched steps are an error** — for valid input, changing one step action (kind, dir, address or raw), or dropping or adding a step, gives `replay_mismatch` and never a colour, `confirmed` or `rejected`.
    - **Validates: Requirements 2.13, 3.7, 5.11**
    - _Requirements: 2.13, 3.7, 5.11_

  - [x] 8.14 Write property test for the status change index
    - **Property 13: Status change index is valid** — read through `replayVerdict` (the helper is private): `statusChangeIndex` is `null` or a valid position whose step status differs from the one before it (or from `start.status` at 0), and no earlier step changes status. Use play results with varied statuses.
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 8.15 Write property test that the safety net is never reached
    - **Property 14: Generated inputs never reach the safety net** — for inputs from `arbReplayInput`, `arbCandidateInput` (with and without a breaker) and `arbAnything`, the result is never an error with reason code `internal_error`.
    - **Validates: Requirements 5.1**
    - _Requirements: 5.1_

  - [x] 8.16 Write the fixture tests
    - Create `tests/verifier.fixtures.test.mjs`. It reads `tests/fixtures/manifest.json`, the `.play.json` files and the solution copies with `node:fs` (read only) and never runs `play.mjs`. Use `new URL(..., import.meta.url)` for paths.
    - Expect: 01, 02, 03 give `green`; the truncated list gives `red`; the 03 solution as a candidate is rejected for all three classes; the truncated list as a candidate is `rejected` with `not_won`; for undo-first, check the play result has `refusedAt` 0 and step 0 with `accepted === false`, `reason` and `message`, then pass a stored-solution copy built from the undo-first action list with `minimalInk` 0 and expect `green` with `refusedAt` 0.
    - If a real output differs from these expectations in a way task 2.3 did not already report, STOP and report to the user. Do not edit the expectation to hide it.
    - Command: `npx vitest --run tests/verifier.fixtures.test.mjs`.
    - _Requirements: 7.6, 8.4, 2.2, 2.4, 2.7, 3.6, 3.8_

  - [x] 8.17 Remove the smoke test
    - Delete `tests/smoke.test.mjs`, which only kept the gates passing before real tests existed.
    - Command: `npm test`. Real tests still run, so Vitest finds files.
    - _Requirements: 7.1_

- [x] 9. Checkpoint - Ensure `npm test` and `npm run typecheck` both pass
  - Run `npm test`, then run `npm run typecheck`. Both must pass. Ask the user if questions arise.

- [x] 10. Update `KIRO_USAGE.md`
  - [x] 10.1 Write the verifier entry
    - Read `KIRO_USAGE.md` first and follow its entry format (date heading, `Surface`, `Features`, `What I asked for`, `What Kiro did`, `What changed because of it`). Append an entry for the verifier spec: requirements and design approved, the real fixtures captured before the code, test-first steps, the 14 properties (tag `pbt`), the safety net, and any decision that changed because of the fixtures.
    - Name no tool other than Kiro. Replace the user's Windows username and home path with `~` if any path appears.
    - _Requirements: 7.1_

## Notes

- Tasks that run commands use PowerShell-safe single commands (`npm test`, `npm run typecheck`, `npx vitest --run <file>`). No task uses `&&`.
- The smoke test in 1.1 is removed in 8.17. It exists only so `vitest --run` and `tsc` do not fail on an empty project.
- Tasks 4.1, 5.1, 6.1 and 7.1 each write tests that fail until the code task that follows them. This is intended.
- No property test is optional. Every unit and property test is a core task, so no sub-task carries a `*`.
- If a Kiro hook later runs Vitest on Windows, it must start from the real-case working directory (the design's Tooling note). This spec adds no hook.
- No task runs a git write command. The spec has no commit task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["3.3"] },
    { "id": 6, "tasks": ["4.1"] },
    { "id": 7, "tasks": ["4.2"] },
    { "id": 8, "tasks": ["4.3"] },
    { "id": 9, "tasks": ["5.1"] },
    { "id": 10, "tasks": ["5.2"] },
    { "id": 11, "tasks": ["6.1"] },
    { "id": 12, "tasks": ["6.2"] },
    { "id": 13, "tasks": ["6.3"] },
    { "id": 14, "tasks": ["6.4"] },
    { "id": 15, "tasks": ["7.1"] },
    { "id": 16, "tasks": ["7.2"] },
    { "id": 17, "tasks": ["8.1"] },
    { "id": 18, "tasks": ["8.2", "8.16", "8.17"] },
    { "id": 19, "tasks": ["8.3"] },
    { "id": 20, "tasks": ["8.4"] },
    { "id": 21, "tasks": ["8.5"] },
    { "id": 22, "tasks": ["8.6"] },
    { "id": 23, "tasks": ["8.7"] },
    { "id": 24, "tasks": ["8.8"] },
    { "id": 25, "tasks": ["8.9"] },
    { "id": 26, "tasks": ["8.10"] },
    { "id": 27, "tasks": ["8.11"] },
    { "id": 28, "tasks": ["8.12"] },
    { "id": 29, "tasks": ["8.13"] },
    { "id": 30, "tasks": ["8.14"] },
    { "id": 31, "tasks": ["8.15"] },
    { "id": 32, "tasks": ["9"] },
    { "id": 33, "tasks": ["10.1"] }
  ]
}
```
