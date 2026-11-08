# Requirements Document

## Introduction

`replay-runner` is the nightly job of Grimsheet Playtester. It has no model call. A Python `script` cron starts a Node script. The Node script fetches Grimsheet `main` into a per-user folder, builds it, plays every stored solution, asks the verifier for a verdict on each, and writes the outcome to files in `data\` and to one key in `data\config.json`, which the dashboard reads.

The parts are:

1. **Launcher**: `scripts/replay_cron.py` (standard library only), run by the cron as `scripts/replay_cron.py:run`. It starts `node scripts/replay.mjs` and waits.
2. **Replay script**: `scripts/replay.mjs` (plain ESM JavaScript, JSDoc types, `// @ts-check`, no build step). It does the checkout, build, replay and recording.
3. **Shared write module**: an ESM module in `scripts/` that merges the results key into `data\config.json` under a lock file. Replay uses it now. `exploit-hunt` will use it later.
4. **Cron definition**: the content of the `replay` entry for `app.json`. The edit of `app.json` belongs to the `packaging` spec.

### Facts this spec rests on

- Only Windows was tested (Crew 0.12.0, KiroCrew desktop app). See `docs/CREW_NOTES.md` section h.
- The cron runs in the KiroCrew install folder, not the app folder. The manifest `env` does not reach a script cron. A control file is the way to pass settings (Notes h.4, E20).
- A BOM in the control file made the launcher ignore it (E24).
- A `command` cron is rejected on a Windows gateway. A `script` cron works and runs as a child of the gateway (E18, E20).
- The limit of a script cron is `timeout` in seconds (default 30). `timeout_secs` must be at least `timeout + 5` (E21).
- On a timeout the runner kills the launcher and its Node child. A report left as `running` is marked `cut-short` by the next run (E21).
- The page can read no file. It reads `GET /api/apps/<app>/config`, which returns `data\config.json`. A PUT replaces the whole object, so the page never PUTs (Notes h.3, E24).
- The size limit of the config route is not documented and was not tested (Notes h.8). The `packaging` spec measures it.
- The dashboard reads whether a run was scheduled or manual from `/api/crons`; the Run_Record does not hold a trigger.
- A Sync moves `data\` and failed twice on a run's read-only git files. The clone therefore lives outside the app folder and `data\` (E17, E25, E27).
- `node scripts/play.mjs --list` prints JSON of the shape `{"levels": ["<level-id>", ...]}` and exits 0 (read in `../grimsheet/scripts/play.mjs`; no `--list` output is in `tests/fixtures/` yet).
- `play.mjs` exits 0 when it ran and 2 for bad input. It accepts `--actions-file <path>` pointing at a bare action array or at a solution object with an `actions` array.
- Real play outputs, action files and solution copies for levels 01, 02 and 03 are in `tests/fixtures/`, with the Grimsheet commit in `GRIMSHEET_COMMIT.txt` and the exit codes in `manifest.json`.

### Verifier contract

The runner uses the verifier through its design in `.kiro/specs/verifier/design.md` and never computes a colour itself:

`replayVerdict(levelId, storedSolution, exitCode, playResult)` returns either a **ReplayOk** (`levelId`, `colour` of `green`, `amber` or `red`, `won`, `endHp`, `inkSpent`, `minimalInk`, `statusChangeIndex`, `refusedAt`) or a **ReplayError** (`colour` `error`, `reasonCode`, `reason`, and `levelId` only when it was a string).

The runner passes the parsed play JSON, or `undefined` when stdout is not JSON, and the numeric exit code, or a value that is not a number when the process was killed or did not start.

### Dependencies

`replay-runner` needs the verifier's `package.json` (task 1.1 of the verifier spec), its `tsconfig.json`, and `scripts/verifier.mjs` after the verifier checkpoint. This spec creates none of them.

`replay-runner` also depends on the `packaging` spec for two checks: the measurement of the largest config value that the config route returns in full (the Byte_Budget of Requirement 9 is 65536 bytes until that spec amends it), and a check that `app.json` uses the same `timeout` as the Cron_Timeout constant in `scripts/replay_cron.py`, with `timeout_secs` at least `timeout + 5`.

### Out of scope

The measurement of the config route limit, the `app.json` timeout check (both belong to `packaging`), the verifier itself, `checkCandidate`, the hunt, the agent and skills, the dashboard, the final `app.json`, the README, and a Sync while a run is active. The `.mjs` results fallback is covered only by Open question D6.

## Glossary

- **Launcher**: `scripts/replay_cron.py`, entry point `run`.
- **Replay_Script**: `scripts/replay.mjs`, started by the Launcher.
- **App_Name**: `grimsheet-playtester` (assumption A-1). Used in the clone folder name and the config route.
- **App_Folder**: the installed folder of the app, `~\.kiro\crew\apps\<App_Name>`.
- **Data_Folder**: `<App_Folder>\data`. It is kept by a Sync.
- **Control_File**: `data\launcher\control.json`, UTF-8 without a BOM. Fields: `repoUrl`, `branch`.
- **Default_Settings**: `repoUrl` `https://github.com/UBayouski/Grimsheet` and `branch` `main`.
- **Checkout**: the local clone of Grimsheet at `%LOCALAPPDATA%\<App_Name>\grimsheet`, built from the `LOCALAPPDATA` environment variable.
- **Commit_Hash**: the full 40-character hash of the Checkout HEAD after the fetch.
- **Stored_Solution_File**: `tests/solutions/<level-id>.json` inside the Checkout.
- **Level_List**: the `levels` array printed by `play.mjs --list`.
- **Run**: one execution of the Replay_Script.
- **Run_Counter**: a positive integer that rises by one for each Run and never repeats.
- **Run_Id**: `run-` followed by the Run_Counter padded to six digits, for example `run-000042` (assumption A-8).
- **Newest**: the Run with the highest Run_Counter.
- **Run_Record**: the JSON document of one Run (Requirement 7).
- **Level_Entry**: one element of the Run_Record `levels` array (Requirement 5).
- **Run_State**: one of `running`, `complete`, `failed`, `cut-short`.
- **Result_File**: `data\runs\<Run_Id>.json`, holding one Run_Record.
- **Index_File**: `data\_index.json`, the bounded index of Runs (Requirement 8).
- **Index_Entry**: a short summary of one Run in the Index_File.
- **Results_Key**: the key `playtesterResults` in `data\config.json` (assumption A-9).
- **Trend_Entry**: a compact summary of one Run inside the Results_Key.
- **Byte_Budget**: the largest allowed size in bytes of the serialised Results_Key (Requirement 9).
- **Foreign_Key**: any top-level key of `data\config.json` other than the Results_Key, and any sub-key of the Results_Key that the Replay_Script does not own (the `findings` sub-key and unknown sub-keys).
- **Write_Module**: the shared ESM module that merges the Results_Key into `data\config.json` under the Lock_File.
- **Lock_File**: `data\.results.lock` (the results and config lock), created with exclusive create. It holds the owner's process id, a random owner token and the creation time.
- **Run_Lock_File**: `data\.run.lock`, created with exclusive create. It holds the owner's process id, a random owner token and the creation time. It keeps two Runs from working at once. It is not the Lock_File.
- **Cron_Timeout**: a constant in `scripts/replay_cron.py`, equal to the `timeout` value of the `replay` cron in seconds, passed to the Replay_Script as a command-line argument.
- **Run_Deadline**: the start time of the Run plus the Cron_Timeout minus the Safety_Margin.
- **Safety_Margin**: the seconds kept at the end of a Run for writing the final records (assumption A-12: 60).
- **Step_Limit**: the time limit of one external process (Requirement 11).
- **Fake_Play_Command**: a test double for `node scripts/play.mjs` used in tests. It prints canned output and exit codes, and needs no Grimsheet checkout.

## Requirements

### Requirement 1: Launcher

**User Story:** As the developer, I want a Python launcher that the cron can run on Windows, so that the nightly replay starts without a `command` cron and without the manifest `env`.

#### Acceptance Criteria

1. THE Launcher SHALL be a Python module at `scripts/replay_cron.py` that uses only the Python standard library and exposes a function `run` that takes one optional context argument and ignores it (`run(ctx=None)`).
2. WHEN `run` is called, THE Launcher SHALL find `scripts/replay.mjs` and the Data_Folder from the location of its own file and SHALL NOT use the working directory.
3. WHEN `run` is called, THE Launcher SHALL start `node scripts/replay.mjs` with `subprocess`, with the App_Folder as the working directory of the child, and SHALL wait for the child to exit.
4. WHEN `run` is called, THE Launcher SHALL pass to the Replay_Script the repository URL, the branch and the Cron_Timeout as the named command-line flags `--repo-url`, `--branch` and `--cron-timeout`, and SHALL NOT pass them through the manifest `env`.
5. Removed. The trigger is not passed or recorded; the dashboard reads it from `/api/crons`. The number is kept so that the other criteria keep their numbers.
6. IF the Replay_Script has not exited when the Cron_Timeout minus 5 seconds has passed, THEN THE Launcher SHALL terminate the child and its descendants and SHALL record the outcome `killed-by-launcher`.
7. WHEN the child exits, or fails to start, or is terminated, THE Launcher SHALL write `data\launcher\last-launch.json` atomically (temporary file in the same folder, then rename), with the start time, the finish time, the child exit code or `null`, and an outcome of `child-exited`, `spawn-failed` or `killed-by-launcher`.
8. IF `node` cannot be started, or the child exits with a non-zero code, or the Launcher terminates the child, THEN THE Launcher SHALL first write `last-launch.json` (criterion 7) and then raise a plain exception whose text states the cause, so that the Executions tab shows the error. The exit code 3 of the Replay_Script (`already_running`, Requirement 7, criterion 15) is a non-zero exit like any other: THE Launcher SHALL write `last-launch.json` with the exit code 3 and SHALL raise a plain exception whose text says that another replay is already running.
9. THE Launcher SHALL NOT raise the runner's Done or Skip signals (Notes h.4), and SHALL raise an exception only in the cases of criterion 8; WHEN the child exits with code 0, THE Launcher SHALL return normally.
10. WHEN a `last-launch.json` of an earlier launch exists, THE Replay_Script SHALL copy its outcome and finish time into the Run_Record field `previousLaunch` (assumption A-6). A `last-launch.json` written before a raised exception is copied in the same way.
11. WHEN `run` starts the child, THE Launcher SHALL write the stdout and stderr of the child to `data\launcher\last-child.log` (overwritten at each launch, no pipes, not parsed by the Launcher) and SHALL record the field `childLog` in `last-launch.json` as `ok`, or as `unavailable` WHEN the log file cannot be opened, in which case THE Launcher SHALL still start the child.

### Requirement 2: Control file

**User Story:** As the developer, I want the repository URL and branch in a control file, so that I can change them without changing the code.

#### Acceptance Criteria

1. WHEN `run` is called, THE Launcher SHALL read `data\launcher\control.json` as UTF-8 and parse it as JSON.
2. WHERE the Control_File holds a string `repoUrl`, THE Launcher SHALL use it, and WHERE the Control_File holds a string `branch`, THE Launcher SHALL use it.
3. IF the Control_File is missing, THEN THE Launcher SHALL use the Default_Settings and SHALL record `controlFile: "missing"` in `last-launch.json`.
4. IF the Control_File is not valid JSON, starts with a byte order mark, or is not a JSON object, THEN THE Launcher SHALL use the Default_Settings and SHALL record `controlFile: "invalid"` and a short cause in `last-launch.json`.
5. IF a field of the Control_File is missing or is not a non-empty string, THEN THE Launcher SHALL use the Default_Settings value for that field only.
6. THE Launcher SHALL NOT create or modify the Control_File.
7. WHEN any Node code writes the Control_File, THE code SHALL write UTF-8 without a BOM.
8. THE Replay_Script SHALL copy the repository URL and the branch it used into the Run_Record.

### Requirement 3: Checkout outside the app folder

**User Story:** As the developer, I want Grimsheet fetched into a local folder outside the app, so that a Sync or an install never touches the clone, and the real repository is never changed.

#### Acceptance Criteria

1. THE Replay_Script SHALL build the Checkout path from the `LOCALAPPDATA` environment variable and the App_Name, and SHALL NOT contain a hard-coded user name or drive.
2. IF `LOCALAPPDATA` is not set or is empty, THEN THE Replay_Script SHALL end the Run in the state `failed` with the failure stage `checkout` and the reason code `no_local_app_data`.
3. THE Replay_Script SHALL resolve the Checkout path and SHALL end the Run in the state `failed` with the reason code `checkout_inside_app` IF the path lies inside the App_Folder or the Data_Folder.
4. WHEN the Checkout does not exist, THE Replay_Script SHALL create it with a shallow clone (`--depth 1`) of the configured URL and branch.
5. WHEN the Checkout exists, THE Replay_Script SHALL run a shallow fetch of the configured branch and a hard reset to the fetched commit.
6. IF the Checkout exists but is not a valid git repository, or its `origin` URL differs from the configured URL, THEN THE Replay_Script SHALL, before deleting anything, check that the Checkout path is absolute, lies under `LOCALAPPDATA` and ends with `<App_Name>\grimsheet`; SHALL clear the read-only attribute on every file in the Checkout folder (git pack files are read-only, Notes h.1); SHALL delete the Checkout folder; and SHALL create it again with a shallow clone. IF the path check fails or the delete still fails, THEN THE Replay_Script SHALL end the Run in the state `failed` with the failure stage `checkout` and the reason code `checkout_delete_failed`.
7. WHEN the fetch or clone succeeds, THE Replay_Script SHALL read the Commit_Hash with `git rev-parse HEAD` and SHALL store it in the Run_Record.
8. IF the clone, the fetch or the reset exits with a non-zero code, THEN THE Replay_Script SHALL end the Run in the state `failed` with the failure stage `checkout`, the reason code `git_failed` and the exit code.
9. THE Replay_Script SHALL run only these git commands: `clone`, `fetch`, `reset`, `rev-parse`, `remote get-url`, and SHALL NOT run `push`, `commit`, `branch`, `tag`, `remote add` or `remote set-url`.
10. THE Replay_Script SHALL treat git's exit code as the result and SHALL NOT treat text on stderr as a failure (Notes h.5, E28).
11. THE Replay_Script SHALL start git directly with an argument array and no shell (Requirement 4, criterion 8).

### Requirement 4: Build and level list

**User Story:** As the developer, I want the Checkout built and its levels listed, so that the replay runs on the code at the recorded commit.

#### Acceptance Criteria

1. WHEN the Checkout is ready, THE Replay_Script SHALL run `npm ci` in the Checkout, and then `npm run build:play` in the Checkout.
2. IF `npm ci` exits with a non-zero code, THEN THE Replay_Script SHALL end the Run in the state `failed` with the failure stage `install`, the reason code `install_failed` and the exit code.
3. IF `npm run build:play` exits with a non-zero code, THEN THE Replay_Script SHALL end the Run in the state `failed` with the failure stage `build`, the reason code `build_failed` and the exit code.
4. WHEN the build succeeds, THE Replay_Script SHALL run `node scripts/play.mjs --list` in the Checkout (started by node directly with an argument array) and SHALL parse its stdout as JSON of the shape `{"levels": [string, ...]}`.
5. IF the `--list` command exits with a non-zero code, or its stdout is not JSON of that shape, or any listed id is not a string matching `^[a-z0-9][a-z0-9-]*$`, THEN THE Replay_Script SHALL end the Run in the state `failed` with the failure stage `list` and the reason code `list_failed`.
6. IF the Level_List is empty, THEN THE Replay_Script SHALL end the Run in the state `failed` with the failure stage `list` and the reason code `empty_level_list`.
7. IF the Level_List holds a duplicate id, THEN THE Replay_Script SHALL play that level once and SHALL record the duplicate in the Run_Record field `coverage.duplicateListedLevels`.
8. THE Replay_Script SHALL start node and git directly with an argument array and no shell, and SHALL start npm through a shell (Node 22.12 or later refuses to start `.cmd` files without one) with fixed arguments only, never a level id, a path or a Control_File value.
9. THE Replay_Script SHALL NOT write any file inside the Checkout other than the files that git, `npm ci` and `npm run build:play` write.
10. THE Replay_Script SHALL check every id of the Level_List against `^[a-z0-9][a-z0-9-]*$` before it uses the id in any path or command.

### Requirement 5: Replay every stored solution

**User Story:** As the developer, I want each stored solution played and judged by the verifier, so that I know which levels still have their intended solution.

#### Acceptance Criteria

1. FOR EACH level id in the Level_List, THE Replay_Script SHALL run one separate process, started by node directly with an argument array and no shell: `node scripts/play.mjs <level-id> --actions-file <path>` in the Checkout, where `<path>` is the absolute path of the Stored_Solution_File itself.
2. THE Replay_Script SHALL capture stdout and the exit code of each play process, and SHALL parse stdout as JSON, using `undefined` when stdout is not JSON.
3. WHEN a play process ends, THE Replay_Script SHALL call `replayVerdict(levelId, storedSolution, exitCode, playResult)` of the verifier, where `storedSolution` is the parsed Stored_Solution_File.
4. IF a play process exceeds its Step_Limit, THEN THE Replay_Script SHALL terminate it and its descendants, SHALL pass a non-number as the exit code to `replayVerdict`, SHALL keep the verdict as `replayVerdict` returns it, and SHALL add the field `timedOut: true` to the Level_Entry. A timed-out play SHALL NOT fail the Run (Requirement 11, criterion 6). The field `timedOut` is absent from every other Level_Entry.
5. THE Replay_Script SHALL NOT compute a colour, and SHALL NOT change a field of the verdict it receives (the extra field `timedOut` of criterion 4 is not part of the verdict).
6. WHEN `replayVerdict` returns a ReplayOk, THE Replay_Script SHALL store in the Level_Entry the fields `levelId`, `colour`, `won`, `endHp`, `inkSpent`, `minimalInk`, `statusChangeIndex` and `refusedAt` unchanged.
7. WHEN `replayVerdict` returns a ReplayError, THE Replay_Script SHALL store in the Level_Entry `levelId`, the colour `error`, the `reasonCode` and the `reason`.
8. THE Replay_Script SHALL store the colour `error` as a fourth, distinct value and SHALL NOT count it as `red` (Open question D3).
9. THE Replay_Script SHALL play the levels in the order of the Level_List.
10. THE Replay_Script SHALL pass the Stored_Solution_File to `play.mjs` and to `replayVerdict` from one read of the same file path, so that the verdict is for the file that was played.
11. FOR ALL sequences of play outputs and exit codes, running the Replay_Script twice with the same Level_List, the same Stored_Solution_Files and the same play outputs SHALL give Level_Entries that are deeply equal (determinism; times and Run_Ids are not part of a Level_Entry).

### Requirement 6: Level coverage

**User Story:** As the developer, I want a level without a usable stored solution to show up, so that a missing file is never mistaken for a green level.

#### Acceptance Criteria

1. THE Replay_Script SHALL take the set of levels to play from the Level_List and not from the files in `tests/solutions/`.
2. IF a listed level has no Stored_Solution_File, THEN THE Replay_Script SHALL record a Level_Entry with the colour `error` and the reason code `no_solution_file`, and SHALL NOT run a play process for it.
3. IF a Stored_Solution_File cannot be read or is not valid JSON, THEN THE Replay_Script SHALL record a Level_Entry with the colour `error` and the reason code `solution_unreadable`, and SHALL NOT run a play process for it.
4. WHEN `tests/solutions/` holds a `<level-id>.json` file whose id is not in the Level_List, THE Replay_Script SHALL list that id in the Run_Record field `coverage.unlistedSolutions` and SHALL NOT play it.
5. THE Replay_Script SHALL record in the Run_Record `coverage` the counts `listed`, `played`, `noSolution`, `unreadable` and `unlisted`.
6. THE Replay_Script SHALL NOT let a Level_Entry of the colour `error` end the Run in the state `failed`.
7. THE reason codes of criteria 2 and 3 SHALL be distinct from every verifier reason code.
8. FOR ALL Level_Lists and sets of solution files, the number of Level_Entries SHALL equal the number of distinct ids in the Level_List, unless the Run ends in the state `failed` with the reason code `deadline_reached` (Requirement 11, criterion 5).

### Requirement 7: Run record and states

**User Story:** As the developer, I want every run to leave one readable record, even when it fails or is killed, so that I always know what happened last night.

#### Acceptance Criteria

1. WHEN a Run has taken the Run_Lock_File (criteria 14 to 17) and starts, THE Replay_Script SHALL take the next Run_Counter, write a Result_File with the Run_State `running`, and add an Index_Entry for the Run (Requirement 8).
2. THE Run_Record SHALL hold: `schemaVersion`, `runId`, `counter`, `state`, `startedAt` and `finishedAt` (ISO 8601 UTC, `finishedAt` `null` while running), `repoUrl`, `branch`, `commit` (or `null`), `levels`, `coverage`, `failure` (or `null`), `previousLaunch`, `resultsKey` (`ok`, `too_large`, `config_unreadable`, `lock_timeout` or `write_failed`; `null` while running; `write_failed` means a file-system error while writing the temporary file or renaming `config.json`), and per-colour counts `green`, `amber`, `red` and `error`.
3. THE `failure` field SHALL hold `stage` (`checkout`, `install`, `build`, `list`, `replay`, `record`), `reasonCode`, a plain-English `message`, and the exit code when one exists, and, for the reason code `step_timeout` only (Requirement 11, criterion 6), `step` (the step name). The stage list is `checkout`, `install`, `build`, `list`, `replay`, `record`; no recorded Run has a `lock` stage, because a Run that does not take the Run_Lock_File records nothing (criterion 15).
4. WHEN all stages up to the replay succeed and every listed level has a Level_Entry, THE Replay_Script SHALL set the Run_State to `complete`.
5. WHEN a checkout, install, build or list stage fails, or the Run_Deadline is reached before all levels are played, THE Replay_Script SHALL set the Run_State to `failed` and fill `failure`.
6. IF an unexpected error occurs inside the Replay_Script, THEN THE Replay_Script SHALL set the Run_State to `failed` with the failure stage `record` and the reason code `internal_error`, and SHALL still write the Result_File.
7. WHEN a Run ends, THE Replay_Script SHALL rewrite its Result_File, update its Index_Entry and update the Results_Key, in that order.
8. WHEN a Run has taken the Run_Lock_File and starts, THE Replay_Script SHALL change every Index_Entry and Result_File with the Run_State `running` and a `startedAt` more than Cron_Timeout seconds before the start time of the new Run to the Run_State `cut-short`, and SHALL NOT change a Run in any other state (assumption A-7).
9. THE Replay_Script SHALL write each Result_File atomically: write a temporary file in `data\runs\`, then rename it over the target.
10. THE Replay_Script SHALL write each Result_File as UTF-8 without a BOM.
11. THE Replay_Script SHALL take the current time from an injectable clock, so that tests give a fixed time.
12. FOR ALL sets of stored Runs, marking stale `running` Runs as `cut-short` SHALL leave every Run in the state `complete` or `failed` unchanged, and applying the marking twice SHALL give the same result as applying it once (idempotence).
13. FOR ALL Runs of the state `running` whose age is not above the Cron_Timeout, the marking SHALL leave them unchanged.
14. WHEN a Run starts, THE Replay_Script SHALL, before it reads or writes the Index_File, any Result_File or the Checkout, take the Run_Lock_File with exclusive create and write the owner's process id, a random owner token and the creation time into it.
15. IF the Run_Lock_File exists and is not older than the Cron_Timeout, THEN THE Replay_Script SHALL record nothing: it SHALL take no Run_Counter, write no Result_File, no Index_Entry and no Results_Key, mark no Run `cut-short`, and not touch the Checkout or the Run_Lock_File; it SHALL print the one JSON line `{"state":"already_running"}` to stdout and exit with code 3 (Requirement 14, criteria 4 and 5).
16. IF the Run_Lock_File is older than the Cron_Timeout (its age taken from the creation time it holds, or from its modification time when it cannot be parsed), THEN THE Replay_Script SHALL treat it as stale, remove it and take it with exclusive create once more; IF that second take fails, THEN THE Replay_Script SHALL behave as in criterion 15.
17. WHEN a Run that holds the Run_Lock_File ends, including after an internal error, THE Replay_Script SHALL remove the Run_Lock_File only when the file holds the owner's token.
18. FOR ALL pairs of overlapping Runs, at most one SHALL reach the checkout stage; FOR ALL Runs that end with `already_running`, `data\` SHALL be unchanged (no file created, changed or deleted); and FOR ALL Run_Lock_Files not older than the Cron_Timeout, a starting Run SHALL leave the Run_Lock_File unchanged.

### Requirement 8: Result files and bounded index

**User Story:** As the developer, I want a bounded history, so that `data\` does not grow without limit and the newest runs are always kept.

#### Acceptance Criteria

1. THE Replay_Script SHALL keep one Result_File per Run in `data\runs\` and one Index_File at `data\_index.json` (assumption A-8).
2. THE Index_File SHALL hold `schemaVersion`, `lastCounter` and `runs`, where each Index_Entry has `runId`, `counter`, `state`, `startedAt`, `finishedAt`, `commit` and the four colour counts.
3. THE Replay_Script SHALL take the Run_Counter as `lastCounter` plus one, and SHALL store the new `lastCounter` in the Index_File before it writes the new Result_File.
4. IF the Index_File is missing or cannot be parsed, THEN THE Replay_Script SHALL set `lastCounter` to the highest counter found in the file names of `data\runs\`, or 0 when there is none, and SHALL rebuild the Index_File from the Result_Files that parse.
5. THE Index_File SHALL hold at most 30 Index_Entries.
6. WHEN more than 30 Runs exist, THE Replay_Script SHALL keep the 30 Runs with the highest Run_Counter and drop the others from the Index_File.
7. WHEN the Index_File has been written, THE Replay_Script SHALL delete every file in `data\runs\` that matches the Result_File name pattern and has no Index_Entry, and SHALL NOT delete any other file.
8. THE Index_File SHALL list its Index_Entries with the Newest first.
9. THE Replay_Script SHALL write the Index_File atomically, in the same way as a Result_File, under the Lock_File.
10. THE Index_File SHALL hold failed and cut-short Runs like any other Run (assumption A-10).
11. FOR ALL sequences of Runs added in any number, the Index_File SHALL never hold more than 30 Index_Entries and SHALL hold the Runs with the highest counters (the newest are kept).
12. FOR ALL sequences of Runs, the Index_Entries SHALL have unique Run_Ids.
13. FOR ALL sets of Runs, the set of kept Runs SHALL not depend on the order in which the Runs were inserted.
14. FOR ALL sequences of Runs, the Run_Counters issued SHALL strictly increase, including after eviction, after a failed Run and after a rebuild of the Index_File.

### Requirement 9: Results key in `data\config.json`

**User Story:** As the developer, I want the nightly outcome in one compact key of the config, so that the dashboard can show it through the config route without reading any other file.

#### Acceptance Criteria

1. THE Results_Key SHALL hold: `schemaVersion`, `updatedAt`, `latest` (a compact form of the Newest Run_Record, with `runId`, `counter`, `state`, `startedAt`, `finishedAt`, `commit`, `repoUrl`, `branch`, `failure`, `coverage` and a compact Level_Entry per level, which carries `levelId`, `colour`, `inkSpent`, `minimalInk`, `reasonCode` and `timedOut` (the last only when true)), `trend` (at most 30 Trend_Entries, Newest first), and `findings`.
2. EACH Trend_Entry SHALL hold `runId`, `counter`, `state`, `startedAt`, `commit`, the four colour counts, and a map from level id to colour.
3. THE Replay_Script SHALL NOT write the `findings` sub-key and SHALL keep its existing value unchanged. WHEN `findings` does not exist, THE Replay_Script SHALL NOT create it (assumption A-11).
4. THE Replay_Script SHALL own and replace only the sub-keys `schemaVersion`, `updatedAt`, `latest` and `trend` of the Results_Key.
5. THE Results_Key SHALL be limited to a Byte_Budget, measured as the UTF-8 length of `JSON.stringify` of the Results_Key.
6. THE Byte_Budget SHALL be 65536 bytes (assumption A-3). The `packaging` spec measures the route limit; IF the route cannot carry 65536 bytes, THEN the budget changes only by an amendment of this criterion.
7. Moved to the `packaging` spec: the measurement of the largest config value that the real config route returns in full, and its record in `docs/CREW_NOTES.md`. This spec depends on that result (see Dependencies). The number is kept so that the other criteria keep their numbers.
8. Moved to the `packaging` spec (no relation between the measured size and the Byte_Budget is set here; see criterion 6). The number is kept.
9. WHEN the serialised Results_Key exceeds the Byte_Budget, THE Replay_Script SHALL remove Trend_Entries, oldest first, until it fits or `trend` holds one entry.
10. Removed (the compact Level_Entries carry no `reason` text, so there is nothing to drop). The number is kept.
11. IF the Results_Key still exceeds the Byte_Budget, THEN THE Replay_Script SHALL leave `data\config.json` unchanged, set the Result_File field `resultsKey` to `too_large`, and keep the Run_State as decided by the replay.
12. THE Replay_Script SHALL merge the Results_Key into `data\config.json` in this way: read the file, parse it, replace the Results_Key sub-keys it owns, write a temporary file in `data\`, and rename it over `config.json`.
13. THE Replay_Script SHALL write `data\config.json` as UTF-8 without a BOM.
14. IF `data\config.json` does not exist, THEN THE Replay_Script SHALL create it holding only the Results_Key.
15. IF `data\config.json` exists but cannot be parsed, or is not a JSON object, THEN THE Replay_Script SHALL leave it unchanged and set the Result_File field `resultsKey` to `config_unreadable`.
16. THE Replay_Script SHALL NOT send a PUT to the config route and SHALL NOT call any HTTP route.
17. FOR ALL generated Run histories, the serialised Results_Key SHALL not exceed the Byte_Budget when a write succeeds.
18. FOR ALL generated Run histories, the `trend` SHALL hold the Newest Trend_Entries: if it drops any entry, it drops only entries with a lower counter than every entry it keeps.
19. FOR ALL generated `config.json` objects, merging the Results_Key SHALL leave every Foreign_Key deeply equal to its value before the merge.
20. FOR ALL generated Run histories and `config.json` objects, merging twice with the same Run SHALL give the same file as merging once (idempotence).
21. FOR ALL generated Results_Keys, parsing the written file and reading the Results_Key SHALL give a value deeply equal to the value written (round trip).
22. IF a file-system error occurs while the Write_Module writes the temporary file or renames it over `data\config.json`, THEN THE Replay_Script SHALL set the Result_File field `resultsKey` to `write_failed` and keep the Run_State as decided by the replay.

### Requirement 10: Shared write module with a lock

**User Story:** As the developer, I want one module that all writers of `config.json` use, so that the nightly replay and a later hunt cannot overwrite each other.

#### Acceptance Criteria

1. THE Write_Module SHALL be an ESM module in `scripts/` with JSDoc types and `// @ts-check`, exposing a function that merges an owned set of sub-keys into one named top-level key of `data\config.json` under the Lock_File.
2. THE Write_Module SHALL take the Lock_File by creating it with exclusive create, and SHALL write the owner's process id, a random owner token and the creation time into it.
3. WHEN the Lock_File already exists, THE Write_Module SHALL retry every 200 milliseconds for up to 10 seconds (assumption A-4).
4. WHEN the Lock_File is older than 60 seconds, THE Write_Module SHALL treat it as stale, remove it, and retry (assumption A-4).
5. IF the Lock_File cannot be taken within the wait, THEN THE Write_Module SHALL not write any file, SHALL return the failure `lock_timeout`, and THE Replay_Script SHALL set the Result_File field `resultsKey` to `lock_timeout` and keep the Run_State as decided by the replay.
6. THE Write_Module SHALL release the Lock_File in all cases after a successful take, including when the merge throws, and SHALL remove the Lock_File only when it holds the owner's token.
7. THE Write_Module SHALL take the Lock_File around the read, merge, temporary write and rename of `config.json`, and the Replay_Script SHALL take the same Lock_File around the update of the Index_File.
8. THE Write_Module SHALL accept the top-level key name, the owned sub-keys and the Byte_Budget as arguments, so that `exploit-hunt` can use it to write its own sub-keys without changing the Replay_Script's sub-keys.
9. THE Write_Module SHALL accept an injectable clock and file-system root, so that tests run in a temporary folder.
10. FOR ALL interleavings of two writers that own different sub-keys of the same top-level key, the final `config.json` SHALL hold the last written value of each owned sub-key and every Foreign_Key unchanged.
11. WHEN the Replay_Script ends, THE Lock_File SHALL not exist unless another writer holds it.

### Requirement 11: Timeouts

**User Story:** As the developer, I want a time budget for every step, so that the whole run finishes inside the cron timeout and a kill leaves a readable state.

#### Acceptance Criteria

1. THE `replay` cron SHALL set `timeout` to 900 seconds and `timeout_secs` to 905 seconds (assumption A-12).
2. THE value of `timeout_secs` SHALL be at least the value of `timeout` plus 5 (E21).
3. THE Replay_Script SHALL give each external process a Step_Limit and SHALL terminate the process and its descendants when the Step_Limit passes. The Step_Limits are: `git clone` or `git fetch` 120 seconds, `npm ci` 180 seconds, `npm run build:play` 120 seconds, `--list` 30 seconds, each level play 30 seconds, other git commands 30 seconds (assumption A-12).
4. THE effective Step_Limit of a process SHALL be the smaller of its fixed limit and the time left until the Run_Deadline.
5. WHEN the Run_Deadline is reached before all levels are played, THE Replay_Script SHALL set the Run_State to `failed` with the failure stage `replay` and the reason code `deadline_reached`, and SHALL record a Level_Entry for each unplayed level with the colour `error` and the reason code `not_played`.
6. IF a step other than a level play exceeds its Step_Limit, THEN THE Replay_Script SHALL record the failure with the reason code `step_timeout` and the name of the step. A level play that exceeds its Step_Limit is handled by Requirement 5, criterion 4 and does not fail the Run.
7. THE Replay_Script SHALL write the Result_File with the Run_State `running` before the first external process starts, so that a kill leaves a readable Run_Record (Requirement 7, criterion 1).
8. THE Replay_Script SHALL reserve the Safety_Margin so that the final writes of Requirement 7, criterion 7 start before the Cron_Timeout.
9. THE sum of the fixed Step_Limits of one clone, one `npm ci`, one build, one `--list`, and one play per level SHALL NOT be a reason to raise the Cron_Timeout; the Run_Deadline decides (assumption A-12, to confirm after the first real nightly runs).

### Requirement 12: Cron definition

**User Story:** As the developer, I want the exact `replay` cron entry defined, so that the `packaging` spec can place it in `app.json` without guessing.

#### Acceptance Criteria

1. THE `replay` cron entry SHALL have `name` `replay`, `script` `scripts/replay_cron.py:run`, `cron_expr` `0 3 * * *`, `timezone` `America/Los_Angeles`, `strict_schedule` true, `enabled` true, `timeout` 900 and `timeout_secs` 905 (assumptions A-2, A-12).
2. THE cron entry SHALL have no `command`, no `message` and no `agent` field.
3. THE cron entry SHALL NOT rely on `env` for any setting.
4. THE manifest that holds the cron SHALL set `permissions.cron` to true.
5. THE `packaging` spec SHALL be the place where `app.json` is edited. THIS spec SHALL only define the entry and SHALL NOT edit `app.json`.
6. THE `packaging` spec SHALL check that the `timeout` in `app.json` equals the Cron_Timeout constant in `scripts/replay_cron.py` and that `timeout_secs` is at least `timeout` plus 5.
7. THE nightly run happens only WHILE the machine and the Crew gateway are running at 03:00 America/Los_Angeles; otherwise the run is missed, and the README written by `packaging` SHALL say so.

### Requirement 13: Tests

**User Story:** As the developer, I want tests that need no network and no Grimsheet checkout, so that the runner can be trusted and run anywhere.

#### Acceptance Criteria

1. THE test suite SHALL use Vitest for unit tests and fast-check for property tests on the Node code, and SHALL need no network.
2. THE test suite SHALL run the Replay_Script against a Fake_Play_Command, a fake git command and a fake npm command, in a temporary folder with an injected clock.
3. THE test suite SHALL use the files in `tests/fixtures/` where they fit: the `*.play.json` outputs as canned play outputs, `solutions/` as Stored_Solution_Files, `manifest.json` for exit codes, and `GRIMSHEET_COMMIT.txt` for a Commit_Hash. The fixtures are read-only inputs.
4. A later task SHALL capture a `--list` output from a real run into `tests/fixtures/` (for example `list.json`), read-only against the Grimsheet checkout, using `--actions-file`-style safe invocation and a BOM-free write. Until then, the tests use a `--list` output built from the shape in the Introduction.
5. THE test suite SHALL include a property test with `numRuns` of 100 or more for each of: Requirement 5, criterion 11; Requirement 6, criterion 8; Requirement 7, criteria 12, 13 and 18; Requirement 8, criteria 11 to 14; Requirement 9, criteria 17 to 21; Requirement 10, criterion 10.
6. THE test suite SHALL tag each property test with its feature and property number, and SHALL generate Run histories, Index_Entries, Level_Entries and `config.json` objects with fast-check arbitraries.
7. THE test suite SHALL include unit tests for each failure stage (`checkout`, `install`, `build`, `list`, `replay`, `record`), for a missing, invalid and BOM-prefixed Control_File, for a stale lock and a lock timeout, for a `config.json` that is missing, unparsable, or holds Foreign_Keys, and for a play process that is killed.
8. THE test suite SHALL include a unit test that the Replay_Script calls only the two verifier exports it needs and passes exactly the four arguments of `replayVerdict`.
9. THE test suite SHALL include Python `unittest` tests for the Launcher that use a fake child command and a temporary folder, and that cover the arguments passed to the Replay_Script, the writing of `last-launch.json` before the exception, and the raise on a spawn failure, a non-zero exit, a child exit with code 3 (the exception text says another replay is already running, and `last-launch.json` is written first) and a kill (Open question D5), and that also cover `run()` called with no argument and with a dummy argument, and `last-child.log` (overwritten at each launch, `childLog` `ok`, and `childLog` `unavailable` with the child still started when the log cannot be opened).
10. Moved to the `packaging` spec (the measurement of the config route limit, Requirement 9, criterion 7). The number is kept.
11. THE test suite SHALL include unit tests for: a Level_List id that does not match `^[a-z0-9][a-z0-9-]*$` (Requirement 4, criteria 5 and 10, including `..`, a path separator, a space and an upper-case letter); the process start rules (node and git with an argument array and no shell, npm through a shell with fixed arguments, Requirement 4, criterion 8); the Checkout delete checks (a path outside `LOCALAPPDATA`, a path that does not end with `<App_Name>\grimsheet`, read-only files cleared before the delete, and a delete that still fails giving `checkout_delete_failed`, Requirement 3, criterion 6); the Run_Lock_File (a fresh lock giving `{"state":"already_running"}` and exit code 3, with no Run_Counter, Result_File, Index_Entry or Results_Key, `data\` unchanged, and an untouched Checkout and Run_Lock_File, a stale lock taken over, release only with the owner's token, Requirement 7, criteria 14 to 17); a timed-out play (verdict unchanged, `timedOut: true`, Run not failed, Requirement 5, criterion 4); and every value of the Result_File field `resultsKey` (`ok`, `too_large`, `config_unreadable`, `lock_timeout` and `write_failed`).

### Requirement 14: Non-functional limits

**User Story:** As the developer, I want the runner to stay cheap, local and honest about its platform, so that it fits the product promises.

#### Acceptance Criteria

1. THE Replay_Script SHALL make no model call and no network request other than the git operations of Requirement 3 and the npm install of Requirement 4.
2. THE Replay_Script SHALL NOT write to the Grimsheet repository in any way, remotely or in the Checkout beyond Requirement 4, criterion 9.
3. THE Replay_Script and the Write_Module SHALL be plain ESM JavaScript with JSDoc types and `// @ts-check` and SHALL need no build step.
4. THE Replay_Script SHALL print to stdout, on exit, one JSON line, and SHALL decide success by its exit code and the written files, not by stderr text. For a Run that was recorded, the line holds `runId`, `state` and `commit`. For a Run that ends with `already_running`, the line is `{"state":"already_running"}` and holds no other field.
5. THE Replay_Script SHALL exit with code 0 when the Run_State is `complete` or `failed` and the Result_File was written, with code 3 when the Run ends with `already_running`, and with code 4 when the Result_File could not be written, when the flag set is bad, or when a file-system error occurs on the Run_Lock_File (not `already_running`); for exit code 4 the stdout line is `{"state":"record_failed"}`.
6. THE documentation of this spec's output (the README, written by `packaging`) SHALL state that only Windows was tested.
7. THE Replay_Script SHALL require Node 22.12 or later and git on the PATH, and SHALL fail the Run in the stage `checkout` with the reason code `git_not_found` when git cannot be started.

## Open questions

Each item names the sources that disagree or are silent, and the assumption these requirements make. The brief is not edited. Items marked RESOLVED have an answer; items marked accepted are assumptions that the developer accepted unchanged.

- **D1. Results key content. RESOLVED.** `.kiro/steering/dashboard.md` once said to keep the value small, while `docs/BRIEF.md` section 4 and `.kiro/steering/tech.md` said the key holds the latest run, the trend of the last 30 runs and the verified findings. Resolution: the key holds the latest run, a trend of at most 30 runs and the findings, within a byte budget (Requirement 9). `dashboard.md` was updated to match. The trend is shrunk first if the budget is exceeded.
- **D2. Verifier signature. RESOLVED.** `BRIEF.md` section 7 and `tech.md` now describe `replayVerdict` and `checkCandidate` with the signatures in `.kiro/specs/verifier/design.md`. The runner follows the design (Requirement 5).
- **D3. The `error` colour. Accepted.** `BRIEF.md` and `product.md` define green, amber and red only. The verifier design adds an `error` outcome. The runner stores `error` as a fourth value, counts it apart from red, and adds the runner's own error reasons `no_solution_file`, `solution_unreadable` and `not_played`. How the dashboard shows it is decided by the `dashboard` spec.
- **D4. Shared or separate clone for the hunt. Accepted.** This spec defines one Checkout for the replay only. The hunt spec decides; a separate clone is the safer choice. No lock on the Checkout is specified here beyond the Run_Lock_File, which orders replay runs only.
- **D5. Python test tool. RESOLVED.** Python `unittest` (standard library) is approved for the Launcher, and `tech.md` was updated. Requirement 13, criterion 9 is unconditional.
- **D6. The `.mjs` results fallback. Accepted.** It is not built here. If the packaging spec's measurement shows that the route cannot carry even a minimal Results_Key, a follow-up task or spec adds it.
- **D7. Hunt cron conditions. Accepted.** No `hunt` cron is specified here.
- **D8. Sync warning. Accepted.** Out of scope. Only the `cut-short` marking covers the damage.
- **D9. Index and trend sizes. Accepted.** The Index_File and the `trend` each hold at most 30 entries (Requirements 8 and 9).
- **D11. Overlap and the newest run; index eviction. RESOLVED.** An overlapping Run records nothing (Requirement 7, criterion 15), so it cannot become the latest Run and cannot evict history from the Index_File.
- **D10. Launcher failure is visible only in the Executions tab. RESOLVED.** `run` raises a plain exception after writing `last-launch.json` when node cannot be started, when the child exits non-zero, or when the Launcher kills the child (Requirement 1, criterion 8). It never raises Done or Skip (criterion 9). The previous launch is still copied into the next Run_Record (criterion 10).

### Other open questions

- **Q1. Cron time and timezone. Accepted.** Assumption A-2: `0 3 * * *` in `America/Los_Angeles`.
- **Q2. App name. Accepted.** Assumption A-1: `grimsheet-playtester` for the folder `%LOCALAPPDATA%\grimsheet-playtester` and the route `/api/apps/grimsheet-playtester/config`. The name in `app.json` is decided by `packaging`.
- **Q3. Byte budget. Accepted.** Assumption A-3: the budget is fixed at 65536 bytes. The `packaging` spec measures the route limit. If the route cannot carry 65536 bytes, the budget is changed by amending Requirement 9.
- **Q4. Cron timeout numbers and Step_Limits. Accepted.** Assumption A-12: `timeout` 900 (a constant in the Launcher), `timeout_secs` 905, Safety_Margin 60 seconds, and the Step_Limits of Requirement 11, criterion 3. The spike measured clone and fetch in under a second to a few seconds, `npm ci` in 5 to 9 seconds and `build:play` in under 1 second (E20, E21). Confirm after real runs.
- **Q5. Lock timings. Accepted.** Assumption A-4: the results Lock_File retries every 200 ms for 10 seconds and is stale after 60 seconds.
- **Q6.** Removed. The trigger is no longer recorded; the dashboard reads it from `/api/crons`. Assumption A-5 is removed with it.
- **Q7. Previous launch. Accepted.** Assumption A-6: copying `last-launch.json` into the next Run_Record is acceptable.
- **Q8. Stale `running` rule and overlap. Accepted.** Assumption A-7: a Run_Lock_File older than the Cron_Timeout is stale and is taken over, and a `running` Run is stale when its `startedAt` is more than Cron_Timeout seconds old. A second Run that finds a fresh Run_Lock_File records nothing, prints `{"state":"already_running"}` and exits with code 3 (Requirement 7, criteria 14 to 18).
- **Q9. File layout. Accepted.** Assumption A-8: `data\runs\<Run_Id>.json`, `data\_index.json`, `data\launcher\control.json`, `data\launcher\last-launch.json`, `data\launcher\last-child.log`, `data\.results.lock`, `data\.run.lock`, Run_Id `run-NNNNNN`.
- **Q10. Key name. Accepted.** Assumption A-9: `playtesterResults`.
- **Q11. Failed runs in the index and trend. Accepted.** Assumption A-10: yes, both (Requirement 8, criterion 10).
- **Q12. `findings` ownership. Accepted.** Assumption A-11: `exploit-hunt` owns the `findings` sub-key and creates it; the replay never creates it.
- **Q13. Newest. Accepted.** The highest Run_Counter, not the latest time, because the clock can move back.
- **Q14. Dependencies. Accepted.** `replay-runner` depends on the verifier's `package.json` (task 1.1 of the verifier spec), its `tsconfig.json` and the verifier checkpoint. It creates none of them. If the verifier is late, tests can use a stub that follows the design's shapes.
- **Q15. Missing `--list` fixture. Accepted.** `tests/fixtures/` holds no `--list` output. A later task captures it (Requirement 13, criterion 4).
- **Q16. Invalid ids in the Level_List. Accepted.** A non-string id, or a string that does not match `^[a-z0-9][a-z0-9-]*$`, makes the list invalid (`list_failed`). Duplicates are played once.
- **Q17. Gateway warning. Accepted.** Notes h.8 (E28) says `node`, `npm` and `git` are "treated as unavailable" for OS introspection but still run. Watch item; Requirement 14, criterion 7 only handles a real start failure.
- **Q18. Hard-coded timezone versus the gateway zone. Accepted.** Notes h.4 says `timezone` falls back to the gateway zone if omitted. Assumption A-2 sets one fixed zone, as the brief asks.
