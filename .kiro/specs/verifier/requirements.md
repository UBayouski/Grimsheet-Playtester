# Requirements Document

## Introduction

`verifier` is a pure function module in `scripts/` (plain ESM JavaScript with JSDoc types and `// @ts-check`, no build step). It turns the output of Grimsheet's play command into a verdict. It does no I/O: no process spawning, no file reads, no network. The callers (`replay-runner` and `exploit-hunt`) run `node scripts/play.mjs <level-id> --actions-file <path>` themselves and pass in the exit code and the parsed JSON.

The verifier has two uses:
1. **Replay verdict.** Did the stored solution of a level still win at the intended ink cost? The answer is green, amber or red, or `error` when the input is unusable.
2. **Candidate check.** Does an exploit that the agent proposed really reproduce its claimed class? The answer is confirmed or rejected, or `error` when the input is unusable.

The verifier is unit-tested with Vitest and property-tested with fast-check. No test needs a Grimsheet checkout or the network.

### Out of scope

Running `play.mjs`, writing action files, the result index, the results key in `data\config.json`, the cron, the agent and the UI. These belong to the later specs `replay-runner`, `exploit-hunt` and `dashboard`.

### Grounding in the real play command

The field names and exit codes below were checked against Grimsheet's `scripts/play.mjs`, `src/play/headless.ts` and `tests/solutions/*.json` in the local checkout. They match Brief section 3, with these differences and additions:

- Actions have a fourth kind, `{"kind":"undo"}`. Brief section 3 lists only `move`, `wait` and `edit`.
- Undo is a one-step undo (`src/game/turn.ts`, around lines 143-165): it reverts the last accepted turn or edit and refunds the ink, and after one undo a second consecutive undo is refused with `nothing-to-undo`. The verifier therefore does not count an accepted edit as a changed cell when the next accepted Step after it is an accepted `undo`. Grimsheet's `parseAction` (`src/game/turn.ts`, line 57) copies only `kind` (all kinds), `dir` (`move`), and `address` and `raw` (`edit`) from an action into the Step.
- The play JSON has more fields than the Brief lists: `levelId`, `refusedAt` (index of the first refused action, or absent when none was refused), and `sheet` (a dump of non-empty cells). Each step also carries `index`, `action`, and, when refused, `reason` and `message`. The verifier reads only the fields it needs and ignores the rest.
- A refused action does not stop the play. It is reported as a step with `accepted: false` and the run goes on.
- `start` and `final` carry `hero`, `hp`, `ink`, `turn`, `status` and `monsters`. Ink spent is `start.ink - final.ink`, as in the Brief.
- Exit code 2 means bad input (unknown level id, invalid actions, missing bundle, unreadable file). Exit code 0 means the play ran. No other exit code is defined by `play.mjs`; a crash from Node would give another non-zero code.
- The solution files hold `levelId`, `minimalInk` and `actions`, as in the Brief. In the current checkout `minimalInk` is 0 for `01-the-corridor` (a level where a free win is not a class), 1 for `02-the-chaser` and `04-the-trap-row`, and 2 for `03-the-locked-crypt` and `05-the-lich`.
- The set of status values (other than `"won"`) is not listed in the sources the spec author read. The verifier compares `status` only against `"won"` and otherwise treats it as an opaque string.

## Glossary

- **Verifier**: the pure function module in `scripts/` described by this spec.
- **Level_Id**: the string id of a Grimsheet level, for example `02-the-chaser`.
- **Action**: one entry of an action list: `{"kind":"move","dir":"N|S|E|W"}`, `{"kind":"wait"}`, `{"kind":"edit","address":"B14","raw":"7"}` or `{"kind":"undo"}`.
- **Edit_Address**: the `address` of an `edit` Action, normalised by trimming spaces and upper-casing it (`b14` becomes `B14`).
- **Stored_Solution**: the parsed content of `tests/solutions/<level-id>.json`: `levelId`, `minimalInk` and `actions`.
- **Minimal_Ink**: the `minimalInk` of a Stored_Solution, a non-negative integer.
- **Play_Result**: the parsed JSON that `play.mjs` prints, together with the process exit code. Fields used: `levelId`, `start`, `steps`, `final`, `refusedAt`.
- **Step**: one entry of `Play_Result.steps`, with `index`, `action`, `accepted`, `hp`, `ink`, `status` and the other fields listed in the Introduction.
- **Ink_Spent**: `start.ink - final.ink` of a Play_Result.
- **Won**: `final.status` equals the string `"won"`.
- **Status_Change_Index**: the position in `steps` of the first Step whose `status` differs from the previous status, where the previous status of the first Step is `start.status`. It is `null` when no Step changes the status.
- **Replay_Verdict**: the output of the replay function (Requirement 2).
- **Colour**: one of `green`, `amber`, `red`.
- **Candidate**: an exploit proposed by the agent: a claimed class and an action list.
- **Exploit_Class**: one of `cheaper_win`, `free_win`, `unexpected_route` (defined in Requirement 4).
- **Candidate_Check**: the check of one Candidate against its replay (Requirement 3).
- **Check_Result**: the output of the Candidate_Check: `confirmed`, `rejected` or `error`, with a reason code and a plain-English reason.
- **Verdict**: a Replay_Verdict or a Check_Result.
- **Error_Outcome**: the outcome `error`, used when the input cannot be judged. It is never a Colour and never `rejected`.
- **Accepted_Edit_Address**: the Edit_Address of a Step whose `accepted` is true and whose `action.kind` is `edit`, unless the next accepted Step after it is an accepted Step whose `action.kind` is `undo`. Refused Steps between the edit and the `undo` are skipped when the next accepted Step is found.
- **Fixture**: a real `play.mjs` output (or Stored_Solution) captured from a run and stored under `tests/fixtures/`.

## Requirements

### Requirement 1: Pure function with no I/O

**User Story:** As the developer, I want the verifier to be a pure function, so that I can test it without Grimsheet and trust that the same input always gives the same answer.

#### Acceptance Criteria

1. THE Verifier SHALL be an ES module in `scripts/` written in plain JavaScript with JSDoc types and `// @ts-check`, with no build step.
2. THE Verifier SHALL NOT spawn processes, read or write files, read environment variables, read the clock, use randomness, or open network connections.
3. THE Verifier SHALL NOT modify its arguments.
4. THE Verifier SHALL return a plain object that survives `JSON.parse(JSON.stringify(x))` unchanged.
5. FOR ALL inputs, calling the Verifier twice with deeply equal arguments SHALL return deeply equal Verdicts (determinism).
6. THE Verifier SHALL export one function for the Replay_Verdict and one function for the Candidate_Check.

### Requirement 2: Replay verdict

**User Story:** As the developer, I want each stored solution judged green, amber or red, so that I see at a glance which levels still have their intended solution.

#### Acceptance Criteria

1. THE Replay_Verdict function SHALL take the Level_Id, the Stored_Solution, the play exit code and the parsed Play_Result.
2. WHEN the Play_Result is Won and Ink_Spent equals Minimal_Ink, THE Verifier SHALL return the Colour `green`.
3. WHEN the Play_Result is Won and Ink_Spent differs from Minimal_Ink, THE Verifier SHALL return the Colour `amber`.
4. WHEN the Play_Result is not Won, THE Verifier SHALL return the Colour `red`, whatever the Ink_Spent.
5. THE Replay_Verdict SHALL report these fields: `levelId`, `colour`, `won` (boolean), `endHp` (`final.hp`), `inkSpent`, `minimalInk`, `statusChangeIndex` and `refusedAt` (the first refused action index, or `null`).
6. THE Replay_Verdict SHALL report `statusChangeIndex` as the Status_Change_Index of the Play_Result.
7. WHEN the Play_Result is Won and a Step was refused, THE Verifier SHALL still return the Colour decided by criteria 2 and 3 and SHALL report the refusal in `refusedAt`.
8. FOR ALL valid inputs, a `green` Replay_Verdict SHALL have `won` true and `inkSpent` equal to `minimalInk`.
9. FOR ALL valid inputs, a `red` Replay_Verdict SHALL have `won` false.
10. FOR ALL valid inputs, an `amber` Replay_Verdict SHALL have `won` true and `inkSpent` different from `minimalInk`.
11. FOR ALL valid inputs, exactly one Colour SHALL be returned (the three Colour conditions are disjoint and cover every valid input).
12. THE Replay_Verdict SHALL depend only on the Play_Result, the Level_Id, the Stored_Solution and the exit code (same inputs, same Verdict).
13. IF the Play_Result `steps` do not match the Stored_Solution `actions` under the comparison of Requirement 5, criterion 11, THEN THE Verifier SHALL return the Error_Outcome with reason code `replay_mismatch`, before any Colour decision (Requirement 5, criterion 13).

### Requirement 3: Candidate check

**User Story:** As the developer, I want every exploit claim checked against its replay, so that no finding is recorded unless a replay reproduces it.

#### Acceptance Criteria

1. THE Candidate_Check function SHALL take the Level_Id, the Stored_Solution, the claimed Exploit_Class, the Candidate actions, the play exit code and the parsed Play_Result of replaying those actions.
2. WHEN the replay reproduces the claimed Exploit_Class (Requirement 4), THE Verifier SHALL return `confirmed`.
3. WHEN the input is valid and the replay does not reproduce the claimed Exploit_Class, THE Verifier SHALL return `rejected`.
4. THE Check_Result SHALL include `levelId`, `claimedClass`, `outcome`, a stable `reasonCode`, a plain-English `reason`, and the measured `won`, `inkSpent`, `minimalInk`, `editCount` (number of `edit` Actions in the Candidate) and `newEditAddresses` (sorted Accepted_Edit_Addresses that the Stored_Solution never edits; an accepted edit that the next accepted Step undoes is not an Accepted_Edit_Address and is not listed).
5. WHEN the claimed Exploit_Class is none of `cheaper_win`, `free_win`, `unexpected_route`, THE Verifier SHALL return the Error_Outcome with reason code `unknown_class`.
6. IF the Play_Result is not Won, THEN THE Verifier SHALL return `rejected` with reason code `not_won`, whatever the claimed Exploit_Class.
7. WHEN the Play_Result does not match the Candidate (Requirement 5, criterion 11), THE Verifier SHALL return the Error_Outcome and never `confirmed`.
8. A Candidate that is a copy of the Stored_Solution actions SHALL be rejected for every Exploit_Class when the replay is Won with Ink_Spent equal to Minimal_Ink.
9. FOR ALL valid inputs, `confirmed` SHALL be returned only if the Play_Result is Won and the measured values satisfy the definition of the claimed Exploit_Class (a candidate is confirmed only if replaying it reproduces its claimed class).
10. THE Verifier SHALL NOT confirm a Candidate on the strength of the claimed class, the agent's description or any field other than the Play_Result and the Candidate actions.
11. THE Candidate_Check SHALL depend only on its arguments (same inputs, same Check_Result).

### Requirement 4: Definitions of the three Exploit_Classes

**User Story:** As the developer, I want the exploit classes defined exactly, so that a finding means the same thing on every run.

#### Acceptance Criteria

1. THE Verifier SHALL treat a Candidate as a `cheaper_win` WHEN the Play_Result is Won and Ink_Spent is less than Minimal_Ink.
2. THE Verifier SHALL treat a Candidate as a `free_win` WHEN the Play_Result is Won, the Candidate holds zero `edit` Actions and Minimal_Ink is greater than 0.
3. THE Verifier SHALL treat a Candidate as an `unexpected_route` WHEN the Play_Result is Won and at least one Accepted_Edit_Address (an accepted edit that the next accepted Step does not undo) is not an Edit_Address of any `edit` Action in the Stored_Solution.
4. WHEN Minimal_Ink is 0, THE Verifier SHALL reject a `cheaper_win` claim with reason code `no_ink_below_zero` and a `free_win` claim with reason code `minimal_ink_zero`.
5. WHEN a Candidate edits only addresses that the Stored_Solution also edits, THE Verifier SHALL reject an `unexpected_route` claim with reason code `no_new_cell`.
6. THE Verifier SHALL compare Edit_Addresses after normalisation, so that `b14` and `B14` are the same cell.
7. THE Verifier SHALL ignore `edit` Steps that were refused (`accepted` false) when it finds Accepted_Edit_Addresses, because a refused edit changed no cell. THE Verifier SHALL also ignore an accepted `edit` Step when the next accepted Step after it is an accepted `undo` Step, because the one-step undo reverts that edit; refused Steps between the edit and the `undo` are skipped when the next accepted Step is found.
8. THE Verifier SHALL judge each claim only against the claimed Exploit_Class. A Candidate that meets a different class SHALL still be rejected for the claimed one, and the rejection reason SHALL name the class that was measured when exactly one other class applies.
9. THE Verifier SHALL NOT change the Check_Result outcome because of the order of the edit Actions in the Stored_Solution.
10. FOR ALL valid inputs, a Candidate confirmed as `free_win` SHALL have `editCount` 0 and `minimalInk` greater than 0.
11. FOR ALL valid inputs, a Candidate confirmed as `cheaper_win` SHALL have `inkSpent` less than `minimalInk`.

### Requirement 5: Bad input gives the Error_Outcome

**User Story:** As the developer, I want unusable input reported as an error, so that a broken run is never shown as a red level or a rejected exploit.

#### Acceptance Criteria

1. THE Verifier SHALL return the Error_Outcome (`outcome` or `colour` field set to `error`) for unusable input, and SHALL NOT throw for any input value, including `undefined`, `null`, numbers and strings.
2. THE Error_Outcome SHALL carry a stable `reasonCode` and a plain-English `reason`, and SHALL carry the fields `levelId` when it is a string, and no Colour.
3. IF the play exit code is 2, THEN THE Verifier SHALL return the Error_Outcome with reason code `bad_input`.
4. IF the play exit code is any other value than 0, THEN THE Verifier SHALL return the Error_Outcome with reason code `play_failed`.
5. IF the Play_Result is missing, is not an object, or lacks `start`, `steps` or `final`, THEN THE Verifier SHALL return the Error_Outcome with reason code `malformed_play_result`.
6. IF any of `start.ink`, `final.ink` and `final.hp` is not a finite number, or `final.status` is not a string, THEN THE Verifier SHALL return the Error_Outcome with reason code `malformed_play_result`.
7. IF the Play_Result `levelId` is present and differs from the Level_Id argument, THEN THE Verifier SHALL return the Error_Outcome with reason code `level_mismatch`.
8. IF the Stored_Solution `levelId` differs from the Level_Id argument, THEN THE Verifier SHALL return the Error_Outcome with reason code `level_mismatch`.
9. IF the Stored_Solution is missing, lacks an `actions` array, or its `minimalInk` is not a non-negative integer, THEN THE Verifier SHALL return the Error_Outcome with reason code `malformed_solution`. The Stored_Solution actions SHALL be Actions of known kinds, and an action of unknown kind (or a malformed action) SHALL give the same reason code `malformed_solution`.
10. IF Ink_Spent is negative, THEN THE Verifier SHALL return the Error_Outcome with reason code `malformed_play_result`.
11. WHEN producing a Replay_Verdict or checking a Candidate, IF the Play_Result `steps` do not match the actions (the Stored_Solution actions for the Replay_Verdict, the Candidate actions for the Candidate_Check), THEN THE Verifier SHALL return the Error_Outcome with reason code `replay_mismatch`. A mismatch is a different count, or a Step `action` that differs from the action at the same position in `kind`, in `dir` for a `move`, or in `address` or `raw` for an `edit`. The `address` is compared exactly as given, without normalisation. Only these fields are compared because Grimsheet copies only these fields into the Step, so extra fields in an action do not appear in the Step. This proves the Play_Result is the replay of these actions.
12. WHEN checking a Candidate, IF the Candidate actions are not an array of Actions of known kinds, THEN THE Verifier SHALL return the Error_Outcome with reason code `malformed_candidate`.
13. THE Verifier SHALL apply the checks of this requirement before any Colour or `confirmed`/`rejected` decision, in a fixed order, so that the reason code for a given bad input is always the same.

### Requirement 6: Status change index

**User Story:** As the developer, I want to know where in a run the status changed, so that I can find the moment a level was won or lost.

#### Acceptance Criteria

1. THE Verifier SHALL compute the Status_Change_Index by comparing each Step `status` with the previous Step `status`, starting from `start.status`.
2. WHEN `steps` is empty, THE Verifier SHALL report `statusChangeIndex` as `null`.
3. WHEN no Step changes the status, THE Verifier SHALL report `statusChangeIndex` as `null`.
4. WHEN a Step changes the status, THE Verifier SHALL report the zero-based position of the first such Step in `steps`.
5. FOR ALL Play_Results, a non-null `statusChangeIndex` SHALL be a valid position in `steps`, and the Step at that position SHALL have a `status` different from the Step before it (or from `start.status` at position 0).

### Requirement 7: Tests

**User Story:** As the developer, I want unit and property tests that need no Grimsheet checkout, so that the verifier can be trusted and run anywhere.

#### Acceptance Criteria

1. THE test suite SHALL use Vitest for unit tests and fast-check for property tests, and SHALL need no network and no Grimsheet checkout.
2. THE test suite SHALL include a property test for each of these: determinism (Requirement 1, criterion 5); green implies won with equal ink, red implies not won, amber implies won with different ink (Requirement 2, criteria 8 to 10); exactly one Colour for valid input (Requirement 2, criterion 11); `confirmed` only when the replay reproduces the claimed class (Requirement 3, criterion 9); `free_win` and `cheaper_win` confirmations meet their definitions (Requirement 4, criteria 10 and 11); the verifier never throws for arbitrary input (Requirement 5, criterion 1); a non-null `statusChangeIndex` is valid (Requirement 6, criterion 5); a Verdict survives a JSON round trip unchanged (Requirement 1, criterion 4).
3. THE test suite SHALL include a property that reordering the edit Actions of the Stored_Solution does not change the Check_Result outcome (Requirement 4, criterion 9).
4. THE test suite SHALL include unit tests for each reason code in Requirement 5 (including `replay_mismatch` for both the Replay_Verdict and the Candidate_Check, with a case where only an extra field differs, which does not mismatch, and a case where `address` differs only in case, which does mismatch), for each Colour, for each Exploit_Class confirmed and rejected, for the `minimalInk` 0 cases, for lower-case addresses, for refused `edit` Steps, and for an edit on a new cell that is then undone, followed by the stored solution, which is rejected as `unexpected_route` with reason code `no_new_cell`.
5. THE test suite SHALL generate Play_Results with fast-check arbitraries that match the field shapes in the Introduction.
6. THE test suite SHALL include unit tests that run the replay function on at least one real `play.mjs` output for a won level and one for a level that was not won, and the candidate function on at least one real replay.

### Requirement 8: Fixtures from real runs (later task)

**User Story:** As the developer, I want test fixtures captured from a real run, so that the tests reflect the real output and not my memory of it.

#### Acceptance Criteria

1. WHEN the verifier tasks are executed, THE tasks SHALL include a step that captures real `play.mjs` output for the stored solutions of at least two levels, and for at least one modified action list that does not win, from a local Grimsheet checkout, and stores them under `tests/fixtures/`.
2. THE captured Fixtures SHALL include the Grimsheet commit hash they were taken from, in a file next to them.
3. THE tasks SHALL capture the Fixtures with `--actions-file`, never with inline JSON.
4. THE Fixtures SHALL be read-only inputs to the tests; no test SHALL call `play.mjs`.
5. THE capture step SHALL NOT write to the Grimsheet checkout.
