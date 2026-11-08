# Requirements Document

## Introduction

`packaging` is the last spec of Grimsheet Playtester. It turns the finished parts (verifier, replay-runner, exploit-hunt, dashboard) into one installable Kiro Crew app and documents how to install it. It collects every hand-off that the earlier specs left to `packaging`. Each criterion below names its source in the form `[spec Rn.c]` (requirement and criterion), `[spec Qn]` (open question), `[spec Dn]` or `[spec An]` (decision or assumption), or `[brief §n]`, `[notes h.n]`, `[En]` (evidence id of `docs/evidence/INDEX.md`).

The parts of this feature are:

1. **Final manifest**: `app.json` at the repo root, with `name`, the `agents` and `skills` entries, the `replay` cron, the `ui` entry and the permissions.
2. **Manifest check**: an automated test that reads `app.json` and `scripts/replay_cron.py` and checks the rules of Requirements 1 to 5.
3. **Measurements and first real runs**, each a hand-run step that asks the user first: the config route size, the first install on this machine, the first agent-run hunt inside Crew, and the model field plan.
4. **Combined test command** for the root project and `ui/`.
5. **README** and **KIRO_USAGE.md** entry.

This spec defines requirements only. It writes no file outside `.kiro/specs/packaging/` now, edits no code, and runs no test, build, install or Crew command. The design and tasks come after review.

### Facts this spec rests on

- Only Windows was tested: Windows 11, Crew 0.12.0, the KiroCrew desktop app, one user, one machine [notes h intro].
- `kirocrew app install <absolute path>` copies the whole app folder, `data\` included, and drops every `.git`, `node_modules`, `__pycache__`, `.venv` and `.kirocrew-deps` folder at any depth [notes h.1; E17; Crew publishing guide, section "What gets copied at install time"]. A local-path install does not run `setup.onInstall` [notes g; Crew app-dev skill].
- `ui/dist/` is ignored by git today (root `.gitignore`: `dist/`, `data/`, `node_modules/`), so a fresh clone has no `ui/dist/index.mjs`. This spec changes that: the built bundle is committed (Requirement 8, criterion 2).
- A third-party app is not trusted after install; its agents, skills and crons are not registered until it is trusted in the dashboard (Settings, Security, Third-party apps) and enabled. A reinstall needs trust again [notes h.1; E08].
- A Sync keeps trust and `data\`; the CLI cannot update an installed local app while the desktop gateway runs [notes h.1; E11].
- `kirocrew` (0.12.0) is bundled with the desktop app and is not on PATH [notes g; E05].
- The current repo contents: `agents/playtester.json` (no `model`, no `allowedTools`), `skills/play-level`, `skills/find-exploits`, `scripts/` (replay, hunt, `replay_cron.py` with `CRON_TIMEOUT = 900` and `KILL_AFTER = CRON_TIMEOUT - 5`), `ui/` (own `package.json`, exact pins, `npm run build` runs `vite build` then `node scripts/check-dist.mjs`), root `package.json` (`npm test` is `vitest --run`, `npm run typecheck`), `LICENSE`, `KIRO_USAGE.md`. There is no `app.json` and no README yet.
- The scripts import no package from `node_modules` (checked by a search for non-relative, non-`node:` imports under `scripts/**/*.mjs`: no match), so the installed copy runs them with no `npm install`.
- A leftover folder `spike\ui` (untracked, not in git) exists in the working folder on this machine [KIRO_USAGE.md, crew-spike entry]. It is not in git, so a clean clone does not carry it.

### Docs consulted and how they differ from observed behaviour

The documentation for the library `/kirodotdev/kirocrew` was queried through Kiro's documentation power on 2026-11-08 (pages: the manifest reference, the app-dev skill, the getting-started page, the publishing guide, the cron dashboard module page). The section "Differences between the documentation and observed behaviour" near the end lists every difference. Where documentation and observation differ, observation wins, as in the earlier specs.

### Out of scope

Any change to the verifier, replay, hunt scripts or page logic; a `hunt` cron (decided against) [exploit-hunt R14.1]; a registry or App Store listing; macOS, Linux and WSL; a `kirocrew app install <git-url>` flow (not documented, not tried) [notes g, h.8]; the `.mjs` results fallback unless Requirement 6 shows the route cannot carry a minimal Results_Key [replay-runner D6]; a Sync during a run or a hunt [replay-runner D8; exploit-hunt design].

## Glossary

- **App_Name**: `grimsheet-playtester`, the manifest `name`, the folder `~\.kiro\crew\apps\grimsheet-playtester` and the route segment of the config route [replay-runner Q2/A-1; dashboard A-1; exploit-hunt A-1].
- **Manifest**: the file `app.json` at the repo root.
- **Manifest_Check**: the automated test of Requirement 5.
- **Replay_Cron**: the entry of `crons` named `replay`, defined by replay-runner Requirement 12, criterion 1.
- **Cron_Timeout**: the Python constant `CRON_TIMEOUT` in `scripts/replay_cron.py` (900 at the time of writing).
- **Launcher**: `scripts/replay_cron.py`.
- **Config_Route**: `GET /api/apps/grimsheet-playtester/config`, which returns the content of `data\config.json`.
- **Crons_Route**: `GET /api/crons`.
- **Results_Key**: the top-level key `playtesterResults` of `data\config.json` [replay-runner Q10/A-9].
- **Byte_Budget**: the size limit of the Results_Key, 65536 bytes (UTF-8 length of `JSON.stringify`) [replay-runner R9.5, R9.6].
- **Config_Probe_Value**: a throwaway test value of a chosen size that the measurement of Requirement 6 places under a key of `data\config.json` that is not the Results_Key.
- **Clean_Clone**: a fresh `git clone` of this repo into an empty folder, with no `data\`, no `node_modules` and no `ui\dist` build output from earlier work (the clone carries only the committed `ui/dist/index.mjs`).
- **Install_Source**: the folder given to `kirocrew app install`; it is a Clean_Clone.
- **Crew_CLI**: the `kirocrew` command, run by its full path on this machine [notes g].
- **Hand_Run_Step**: a step that touches the real Crew gateway, the real network or the user's machine state, and that the user must approve first.
- **Approval_Count**: the number of approval prompts the user answers during one hunt.
- **README**: `README.md` at the repo root.
- **Usage_Entry**: the last entry of `KIRO_USAGE.md`, in its existing format (`## YYYY-MM-DD - short title`, then `Surface`, `Features`, `What I asked for`, `What Kiro did`, `What changed because of it`).
- **Notes_File**: `docs/CREW_NOTES.md`.

## Requirements

### Requirement 1: Manifest identity and static fields

**User Story:** As a judge or developer, I want a manifest that Crew accepts and that names the app correctly, so that the app installs and shows up in the Library.

#### Acceptance Criteria

1. THE Manifest SHALL set `name` to the App_Name. [replay-runner Q2; dashboard A-1; exploit-hunt A-1; notes a (`name` always present in examples)]
2. THE Manifest SHALL set `displayName` (required by Crew), the `version` string `1.0.0` (Open question Q12, closed), a one-sentence `description` and an `author`. [notes a; crew-app steering "app.json manifest"]
3. THE Manifest SHALL NOT contain the field `resources`. [notes a]
4. THE Manifest SHALL NOT contain `setup.onInstall`, `setup.onUninstall`, `setup.onEnable` or `setup.onDisable`, because a local install does not run `onInstall` and the app needs no lifecycle script. [brief §10 item 6; notes g]
5. THE Manifest SHALL be valid JSON written as UTF-8 without a BOM. [replay-runner R9.13 (same rule for `config.json`); notes h.4 (a BOM made the launcher ignore its control file)]
6. THE Manifest SHALL contain no secret, token, dashboard URL, user name, home path or drive letter. [exploit-hunt R15.4; dashboard R9.10]
7. THE `author` value SHALL be `UBayouski` (Open question Q1, closed), and SHALL NOT be a Windows user name or a home path.

### Requirement 2: `agents` and `skills` entries

**User Story:** As the developer, I want the manifest to register the agent and both skills, so that the playtester agent and its skills exist after install.

#### Acceptance Criteria

1. THE Manifest SHALL set `agents` to `["agents/playtester.json"]`. [exploit-hunt R1.9, Dependencies "packaging"; notes a]
2. THE Manifest SHALL set `skills` to `["skills/play-level", "skills/find-exploits"]`, as string paths to skill directories. [exploit-hunt Dependencies "packaging"; notes a, c]
3. THE Manifest_Check SHALL verify that each path of `agents` and `skills` exists in the repo, that each skill directory holds a `SKILL.md`, and that the agent file parses as JSON with `tools` equal to `["execute_bash"]` and no `allowedTools`. [exploit-hunt R1.3, R1.4, R16.6; notes h.5, h.10.4]
4. THE Manifest_Check SHALL verify that the single `skill://` entry in `agents/playtester.json` `resources` is `skill://~/.kiro/crew/apps/grimsheet-playtester/skills/*/SKILL.md`, so that its app segment equals the Manifest `name`. [exploit-hunt R16.6; notes h.6, A-18]
5. THE Manifest SHALL contain no `mcpServers` and no `sops` entry. [brief §5 (the parts list names none)]

### Requirement 3: The `replay` cron, and no `hunt` cron

**User Story:** As the developer, I want exactly the cron that replay-runner defines and no other, so that the nightly job runs and nothing promises an unattended hunt.

#### Acceptance Criteria

1. THE Manifest SHALL contain in `crons` exactly one entry, with `name` `replay`, `script` `scripts/replay_cron.py:run`, `cron_expr` `0 3 * * *`, `timezone` `America/Los_Angeles`, `strict_schedule` true, `enabled` true, `timeout` 900 and `timeout_secs` 905. [replay-runner R12.1, A-2, A-12, R11.1]
2. THE Replay_Cron SHALL have no `command`, no `message`, no `agent`, no `every` and no `env` field. [replay-runner R12.2, R12.3; notes h.4 (`command` rejected on a Windows gateway; `env` does not reach a script cron)]
3. THE Manifest SHALL set `permissions.cron` to true. [replay-runner R12.4; notes a]
4. THE Manifest SHALL contain no cron named `hunt` and no cron with a `message` or `agent` field. [exploit-hunt R14.1, R14.9, R12.1; notes h.10.5]
5. THE Manifest_Check SHALL fail IF `crons` holds more than the `replay` entry. [exploit-hunt R14.1]

### Requirement 4: `ui` entry and permissions

**User Story:** As the developer, I want the page registered with only the access it needs, so that the dashboard can read results and cannot write or subscribe.

#### Acceptance Criteria

1. THE Manifest SHALL set `ui.entry` to `dist/index.mjs`, relative to `ui/`. [dashboard R9.1; notes a, f]
2. THE Manifest SHALL set `ui.pages` to one page whose `route` is `/apps/grimsheet-playtester` and whose `label` is the display name of the app, with an `icon` that is a Lucide icon name (see Open question Q2). [notes a (`ui.pages` fields), A-08]
3. THE Manifest SHALL set `permissions.api` to exactly `["/api/apps/grimsheet-playtester/config", "/api/crons"]`. [dashboard R1.6; notes h.3 (exact match, one entry covers GET and PUT)]
4. THE Manifest SHALL contain no `permissions.events` entry. [dashboard R1.4, R1.6; notes h.3 (no event marks a finished run)]
5. THE Manifest SHALL contain no `permissions.api` entry for `/api/crons/*` or any other path. [dashboard R1.3; notes h.3 (`GET /api/crons/<id>` answers 405)]
6. THE Manifest SHALL NOT set `permissions.network`, `mcpTools`, `memory`, `sessionApproval`, `spawn`, `jobs` or `exposeToApps`. [notes h.8 (effect of `network` not tested; no network block seen)]
7. THE `permissions.storage` value SHALL follow Open question Q3.
8. THE Manifest SHALL contain no `mountFunction` and no per-page `entryPoint`, WHILE the first install (Requirement 9) shows that the default export of `dist/index.mjs` renders as the page. [dashboard Q9, A-11; notes A-11]
9. THE Manifest_Check SHALL verify that the `permissions.api` list equals the two paths of criterion 3 with the App_Name taken from the Manifest `name`.

### Requirement 5: Manifest check (timeout rules and the rest)

**User Story:** As the developer, I want an automated check that the manifest and the Launcher agree, so that a Sync is not refused and the cron is not killed early.

#### Acceptance Criteria

1. THE Manifest_Check SHALL read the integer after `CRON_TIMEOUT =` in `scripts/replay_cron.py` and SHALL fail IF the Replay_Cron `timeout` is not equal to it. [replay-runner R12.6; replay-runner design "CRON_TIMEOUT = 900 ... packaging checks this"; replay-runner tasks 12.3 and Notes]
2. THE Manifest_Check SHALL fail IF the Replay_Cron `timeout_secs` is less than `timeout` plus 5. [replay-runner R12.6, R11.2; notes h.4, A-05; E21]
3. THE Manifest_Check SHALL fail IF `timeout` or `timeout_secs` is missing or is not an integer, because a script cron without `timeout` is killed at 30 seconds. [notes h.4; E21]
4. THE Manifest_Check SHALL verify the structural rules of Requirements 1 to 4 that a program can read: required fields, absent fields, exact `crons`, exact `permissions.api`, absent `events`, and the absence of a drive letter, `Users\` and `token=` in the file text.
5. THE Manifest_Check SHALL need no network, no Crew gateway and no Grimsheet checkout, and SHALL be part of the root `npm test`. [replay-runner R13.1; exploit-hunt R16.1]
6. THE Manifest_Check SHALL be written test-first, with a failing run shown before the Manifest exists. [project practice in earlier specs' tasks]
7. THE Manifest_Check SHALL include an example test for each failing rule (a `timeout` that differs from the constant, a `timeout_secs` of `timeout` plus 4, an extra `hunt` cron).
8. IF the Launcher constant changes, THEN THE Manifest_Check SHALL fail until the Manifest `timeout` is changed to match, and `timeout_secs` SHALL be re-derived as at least `timeout` plus 5.

### Requirement 6: Measure the config route size limit (Hand_Run_Step)

**User Story:** As the developer, I want to know the largest config value the real route returns in full, so that the Byte_Budget rests on a measurement and not on an assumption.

#### Acceptance Criteria

1. WHEN the app is installed and enabled (Requirement 9), THE measurement SHALL be run by the user in a terminal, because it needs the gateway token (criterion 13), and only after the user has approved it, because it writes a test value into the installed app's `data\config.json`. [replay-runner R9.7, R13.10; dashboard Q8, A-8; notes h.8]
2. THE measurement SHALL place a Config_Probe_Value under a key other than the Results_Key, SHALL leave every other key of `data\config.json` unchanged, and SHALL send no PUT to the Config_Route. [replay-runner R9.16; notes h.3 (a PUT replaces the whole object)]
3. THE measurement SHALL read the Config_Route after each size step and SHALL record, for each step, the byte size written, the HTTP status, and whether the returned body parses and equals what was written. [replay-runner R9.7]
4. THE measurement SHALL cover at least these sizes in bytes: 16384, 32768, 49152, 65536, 98304 and 131072, and SHALL continue upward until the first step the route does not return in full or until 1 MiB. [replay-runner R9.6 (65536 is the budget); exploit-hunt Open question 7 (16384-byte findings cap)]
5. WHEN a step does not return in full, THE measurement SHALL bisect between the last good and the first bad size until the gap is at most 1024 bytes.
6. THE measurement SHALL remove the Config_Probe_Value afterwards and SHALL confirm that the Results_Key and every other earlier key are unchanged. [replay-runner R9.19]
7. THE largest size returned in full, the first size that failed (or that no failure was found up to the highest tested size), the method, the date, the Crew version and the status codes SHALL be recorded in the Notes_File as a new section, with "Observed" as basis and the evidence files in `docs/evidence/`. [replay-runner R9.7; notes h.8 ("any size limit: not tested")]
8. IF the largest size returned in full is at least 65536 bytes, THEN THE Byte_Budget SHALL stay 65536 and the Notes_File entry SHALL say the budget is not changed. [replay-runner R9.6, Q3; dashboard Q8]
9. IF the largest size returned in full is below 65536 bytes, THEN THE spec work SHALL stop and report to the user with the measured number, because the Byte_Budget of replay-runner R9, the findings caps of exploit-hunt (16384 bytes for `findings`) and the dashboard's size assumption (A-8, A-9) all depend on it; THE change SHALL be made only as an amendment of replay-runner R9.6 and of the exploit-hunt Findings_Caps, approved by the user. [replay-runner R9.6, D6; exploit-hunt Open question 7, A-6; dashboard A-8]
10. IF the route cannot carry even a minimal Results_Key (a measured limit below the size of one `latest` with five levels and one `trend` entry), THEN THE work SHALL report that the `.mjs` fallback of replay-runner D6 is needed, and SHALL NOT build it inside this spec. [replay-runner D6; notes h.3]
11. THE evidence files SHALL contain no Windows user name, home path or token. [exploit-hunt R15.4]
12. THE measurement writes into the installed app's `data\config.json`, so it SHALL take the same config lock that the shared write module `scripts/results-store.mjs` takes for `mergeTopKey` (the lock file `.results.lock` in `data\`) for each write and each removal of the Config_Probe_Value. IF the design shows that a hand step cannot take that lock, THEN the measurement SHALL run only when the Schedule page shows the `replay` job not running and no `data\.hunt.lock` exists, and the design SHALL state how both facts are checked before each step. [replay-runner R9 (results lock); exploit-hunt R12 (`.hunt.lock`); `scripts/results-store.mjs`]
13. THE session token used to read the Config_Route SHALL NOT be written to any file, log, shell history line or evidence file; the evidence SHALL record the route path, the HTTP status and the sizes only. [exploit-hunt R15.4; dashboard R9.10]

### Requirement 7: Combined test command

**User Story:** As the developer, I want one command that runs the root tests and the `ui/` tests, so that I run the full gate in one step.

#### Acceptance Criteria

1. THE repo SHALL provide a Node script `scripts/test-all.mjs` and an npm script `test:all` in the root `package.json` that runs it (Open question Q8, closed). THE script SHALL run the root `npm test` and the `ui/` `npm test`, and the root `npm run typecheck` and the `ui/` `npm run typecheck`. [dashboard design decision 17 ("A combined command is left to `packaging`"); dashboard design "typecheck"]
2. THE combined command SHALL run the suites one after the other, never in parallel, because a parallel run of three suites once failed a timing test that never failed alone. [KIRO_USAGE.md exploit-hunt entry ("Test suites are now run one at a time")]
3. THE combined command SHALL stop at the first failing suite and SHALL return that suite's non-zero exit code.
4. THE combined command SHALL need no network after `npm install` has run in the root and in `ui/`. [dashboard R9.11]
5. THE combined command SHALL include the Python Launcher test (`python -m unittest tests.test_replay_cron`) in the sequence. [replay-runner R13.9, tasks 12.3 and 15.1; tech steering]
6. THE combined command SHALL work in Windows PowerShell 5.1 and in other shells: it is a Node script run by an npm script, with no `&&` chains or shell-specific syntax. [tech steering "Shell-agnostic rules"; notes h.5 (PowerShell 5.1)]
7. THE README SHALL name the combined command (Requirement 12).
8. Moved: the form of the combined command is decided (criterion 1); no README-only fallback is needed.
9. THE combined command SHALL include, as its last step, the stale-bundle check of Requirement 8, criterion 2: it builds `ui/` into a temporary folder, compares the new `index.mjs` byte for byte with the committed `ui/dist/index.mjs`, and fails with the one-line message named there. [Requirement 8, criterion 2]

### Requirement 8: Install procedure for a judge and for the developer

**User Story:** As a judge, I want exact install steps that work from a fresh clone, so that I can run the app without guessing.

#### Acceptance Criteria

1. THE install procedure SHALL start from a Clean_Clone, because `kirocrew app install` copies every file in the source folder including a local `data\` folder with run results, locks and a Grimsheet checkout state. [replay-runner tasks 13 note ("Packaging must install from a clean clone"); exploit-hunt tasks 22 note; notes h.1; E08; E17]
2. THE built bundle `ui/dist/index.mjs` SHALL be committed to the repo, so that a judge does not build `ui/` (Open question Q5, closed). THE developer SHALL rebuild it (`npm ci` then `npm run build` inside `ui/`, which runs `check-dist`) before each commit that touches `ui/`. THE combined command of Requirement 7 SHALL fail IF `ui/dist/index.mjs` is missing or differs from a fresh build of `ui/` made into a temporary folder (not `ui/dist`); the failure message SHALL be one line that names the fix (run `npm run build` in `ui/` and commit the result). THE Manifest_Check, which is part of the root `npm test`, SHALL check only that `ui/dist/index.mjs` exists and is not empty, so that the root `npm test` needs no `ui/` setup (Requirement 5, criterion 5). IF the design shows that the build is not byte-for-byte reproducible, THEN it SHALL state the comparison that is used instead. THE `.gitignore` SHALL be changed, as a task of this spec, to allow `ui/dist/index.mjs` and keep every other `dist/` content ignored, and THE file `.gitattributes` SHALL be added with the line `ui/dist/index.mjs -text`, so that line-ending conversion on a developer machine does not change the committed bytes. THE README SHALL keep the build steps as the developer path. Reason: a local-path install does not run `setup.onInstall`, and the Crew publishing guide advises a committed bundle. [brief §10 item 6; notes g; dashboard R9.1; dashboard tasks 17.3; root `.gitignore`]
3. THE install procedure SHALL state that install drops `node_modules` and `.git` folders, so nothing at runtime may rely on them, and that the root project needs no `npm install` for the app to run. [notes h.1; E17; Crew publishing guide "What gets copied at install time"; fact "scripts import no package"]
4. THE install procedure SHALL then run `kirocrew app install <absolute path of the Install_Source>` using the Crew_CLI, which on this machine is bundled with the desktop app and not on PATH, and SHALL show the path built from `$env:ProgramFiles` (`$env:ProgramFiles\KiroCrew\resources\backend-dist\kirocrew-backend\bin\kirocrew.cmd`), with no drive letter and no user name. [notes g; E05; tech steering "Kiro CLI name"]
5. THE install procedure SHALL state the expected install output: exit 0, "installed grimsheet-playtester v<version>", and a warning that executable resources (agents, skills, crons) are not registered until the app is trusted. [notes h.1; E08]
6. THE install procedure SHALL then trust the app in the dashboard (Settings, Security, Third-party apps) and enable it, and SHALL state that `kirocrew app enable` was not needed in the spike, although the install output suggests it. [notes h.1; E08; Crew docs: enable refuses an untrusted app] (see the difference list)
7. THE install procedure SHALL state that a reinstall, an uninstall followed by an install, or a Sync after a failed Sync changes the trust state and that a reinstall needs trust again. [notes h.1; E13]
8. THE install procedure SHALL tell the user what to see after enabling: the app in the Library under Enabled, the sidebar entry, the `replay` job on the Schedule page, and the agent and the two skills in the Details Resources list. [notes g; E15; E18-app-details]
9. THE install procedure SHALL state the harmless warning the build or install may print for the build tool's install script, ONLY WHEN the first install (Requirement 9) has shown the exact text; until then the README SHALL NOT quote text that was not seen (see Open question Q4). [project rule: do not fill gaps from memory]
10. THE install procedure SHALL state the gateway warning to expect: node, npm and git on PATH "do not resolve under the trusted system directories" and are treated as unavailable for OS introspection, while the commands still ran, with the exact text from the Notes_File and a note to re-check after a Crew update. [notes h.8; E28; tech steering "Watch items"]
11. THE install procedure SHALL state that a Sync must not be run while a replay or a hunt is active, or while the folder `~\.kiro\crew\apps\.grimsheet-playtester-data-tmp` exists. [notes h.1, h.4; E26; E27; crew-app steering]
12. THE install procedure SHALL state the prerequisites: Node 22.12 or later and git on PATH, Python available to the Crew gateway for the `script` cron (the Crew bundle supplies it), and network access to the Grimsheet repository. [tech steering "Stack"; replay-runner R14.7; notes h.4]
13. THE install procedure SHALL NOT recommend `kirocrew app install <git-url>`, because that form is not documented and was not tried. [notes g, h.8; crew-app steering "CLI"]
14. THE install procedure SHALL name the update path for the developer (the Library or Details **Sync** button) and SHALL state that `kirocrew app update <name> --source <dir>` failed while the desktop gateway ran. [notes h.1; E11]
15. THE install procedure SHALL state what an uninstall leaves behind (`<app dir>\data`, a cron history file, conversation pointers) and that removing them by hand needs `attrib -r` on read-only files; THE procedure SHALL make no deletion on the user's behalf. [notes h.1, h.10.6; E12; E17; E34]

### Requirement 9: First real install on this machine (Hand_Run_Step)

**User Story:** As the developer, I want the first install done once on this machine with everything recorded, so that the open questions the page and the manifest depend on are answered by observation.

#### Acceptance Criteria

1. THE first install SHALL be a Hand_Run_Step: before any Crew command is run, THE work SHALL list the commands and the files they touch and SHALL wait for the user's approval. [exploit-hunt tasks 22 note ("asks first"); replay-runner tasks 13]
2. THE first install SHALL use a Clean_Clone of this repo outside the working folder (it carries the committed `ui/dist/index.mjs`, Requirement 8, criterion 2), with the working folder's `data\`, `node_modules` and `spike\` not copied. THE step SHALL delete nothing on the user's machine unless the user approves each deletion. [replay-runner tasks 13 note; safety rules]
3. THE first install SHALL record in the Notes_File, with "Observed" as basis: the exact commands, exit codes and the output (with paths shown as `~`, `%USERPROFILE%` or `%LOCALAPPDATA%`), the trust and enable steps taken, and every warning printed. [notes h conventions]
4. THE first install SHALL answer dashboard Q3: read `GET /api/crons` once on the installed app, with the reader program run by the user (the token is typed by the user and never reaches the agent, Requirement 6, criterion 13), and record the `name` of the replay job exactly as returned, the format of `last_run_ts` and `next_run_ts` (epoch seconds, epoch milliseconds or ISO string), and confirm that the page's Replay_Job rule (a `name` of `replay` or ending `/replay`, else a `script` containing `replay_cron.py`) finds it. THE record SHALL NOT include the `script` value, because it holds an absolute path. [dashboard Q3, A-5, A-6, R5.10]
5. THE first install SHALL answer dashboard Q9: record whether the page loads and renders from the default export of `dist/index.mjs` with no `mountFunction` and no `entryPoint` in the manifest. IF it does not render, THEN THE work SHALL report and SHALL add `mountFunction` or `entryPoint` only after the user approves. [dashboard Q9, A-11]
6. THE first install SHALL answer dashboard Q10: read `React.version` of the host once in the browser console of the installed page and record it. IF the major version is not 18, THEN THE work SHALL report to the user and SHALL change the `ui/` React and type pins to the exact host version only after the user approves, followed by the `ui/` test and build gates. [dashboard Q10; dashboard design "React version"; dashboard tasks Notes]
7. THE first install SHALL perform the clipboard check that the dashboard spec left to `packaging`: on the installed page, activate each kind of copy button once and record whether `navigator.clipboard.writeText` works in the host, whether the selection fallback or the read-only text area appears instead, and whether the live region shows "Copied". [dashboard A-10, R11.5, R11.6; dashboard tasks Notes ("a real browser check belongs to `packaging`")]
8. THE first install SHALL check that the page shows results: after the first scheduled or manual run of the `replay` job (Run button on the Schedule page, which the user presses), the Config_Route returns the Results_Key and the page shows one card per level. [brief §10 item 3; dashboard R3, R4; replay-runner R7, R9]
9. THE first install SHALL record the Executions tab row of the first replay run: status, duration, trigger, and the summary text. [notes h.7; replay-runner D10]
10. THE first install SHALL record whether the Crew approvals for the declared `permissions.api` entries needed an action by the user at trust or enable time, and what `approved-grants.json` held afterwards, without reading `.app_secret`. [notes h.8 (approval of a permission entry: not documented); E08; E24]
11. THE first install SHALL record the manifest as stored (`kirocrew app info grimsheet-playtester`) and SHALL note any field the gateway dropped or normalised. [E08]
12. THE first install SHALL check that the agent file generated by the App Kit exists after enable (`~\.kiro\agents\grimsheet-playtester--playtester.json`), that its `tools` holds `execute_bash`, and that its `resources` holds the `skill://~/.kiro/crew/apps/grimsheet-playtester/skills/*/SKILL.md` entry. [notes h.6, h.10.4; exploit-hunt design "Model field plan" step 3]
13. THE first install SHALL record the Crew version, the app version and the date. [notes h conventions]
14. THE first install SHALL change no repo file other than the Notes_File, the evidence files, `docs/evidence/INDEX.md` and, by criterion 15, the measured-size lines of `.kiro/specs/exploit-hunt/design.md`, and SHALL run no git write command.
15. AFTER the first replay run (criterion 8), THE work SHALL record in the Notes_File the UTF-8 size in bytes of the Results_Key and of `latest` as read from the Config_Route (with the `endHp` that replay-runner task 16.1 added to each compact Level_Entry of a ReplayOk), the number of levels and the number of trend entries, and SHALL correct, in one edit, the measured sizes quoted in `.kiro/specs/exploit-hunt/design.md` ("Size calculation": `latest` 778 bytes, about 75 bytes per level, and the totals and level limit derived from them). This edit of the exploit-hunt design SHALL be the only edit that this spec makes in another spec's design, and the work SHALL list it in the Usage_Entry. [replay-runner task 16.1; exploit-hunt design "Together with the replay's value"]

### Requirement 10: First agent-run hunt inside Crew (Hand_Run_Step)

**User Story:** As the developer, I want one real hunt run through the installed agent, so that the credits, approvals and behaviour in chat are measured and the README states real numbers.

#### Acceptance Criteria

1. THE first hunt SHALL be a Hand_Run_Step that the user starts from a chat with the `playtester` agent; THE work SHALL not start it unasked and SHALL list what it will cost in approvals before the user begins. [exploit-hunt R12.2, R14.2; exploit-hunt Open question 5]
2. THE first hunt SHALL run in the default approval mode **Normal**, with each prompt answered by the user. [exploit-hunt R14.11, R14.14]
3. THE first hunt SHALL record the Approval_Count (split into skill loads, Hunt_Begin, Hunt_Info, Hunt_Submit, Hunt_End and charged refusals), the credits from the gateway usage line, the elapsed time, the model on the usage line, the Hunt_Record fields (`state`, `attempts`, `refusals`, `levels`, `findingsKey`), the Findings stored, and what the dashboard page shows for them. [exploit-hunt Open question 5, R14.7, R15.7; notes h.10.3]
4. THE first hunt SHALL compare the Approval_Count with the "roughly 30" of exploit-hunt R14.7 and the 3 to 12 of the spike, and SHALL record whether the Time_Budget of 1800 seconds suits an agent run that waits for the user's approvals. [exploit-hunt Open question 5, 7; brief §5]
5. THE first hunt SHALL record every command that the agent ran with an addition not given by the skill (for example a chained exit-code echo), as seen in the approval prompts. [exploit-hunt Facts; notes h.10.4]
6. THE first hunt SHALL record, if the user chooses to try it, one hunt run with the selector option **Trust** for that chat session only, and SHALL mark the **Trust** option as tested or as still untested in the Notes_File. [exploit-hunt R14.11, R14.15, A-19]
7. THE first hunt SHALL NOT use the option **YOLO** and SHALL NOT change the approval mode on the user's behalf. [exploit-hunt R14.12, R14.14]
8. THE first hunt SHALL answer exploit-hunt Open question 11 only as far as seen: whether an approval card offered more than approve and deny. [exploit-hunt Open question 11, A-19]
9. THE first hunt SHALL leave the Grimsheet repository untouched and SHALL create no commit, branch, issue or pull request. [exploit-hunt R15.1]
10. THE first hunt SHALL list every file it created (the Hunt_Checkout, the candidate folder, the Hunt_Record, the `findings` sub-key) and SHALL delete none of them; clean-up is the user's decision. [exploit-hunt tasks 22 note]
11. IF the hunt stalls, fails or shows a result that differs from the exploit-hunt design, THEN THE work SHALL stop and report, and SHALL NOT change hunt code inside this spec. [exploit-hunt tasks 22 pattern]
12. THE numbers recorded here SHALL replace the "unmeasured" statements in the README, and WHERE a number was not measured the README SHALL say so. [exploit-hunt R15.7]

### Requirement 11: Model field plan for the agent (Hand_Run_Step, optional)

**User Story:** As the developer, I want to decide the agent's `model` once with a measurement, so that the cost of a hunt is as low as the platform allows.

#### Acceptance Criteria

1. THE work SHALL read the Crew documentation page for agent spec fields (read only) for the accepted form of the `model` value, and SHALL record "not documented" for anything the page does not say. [exploit-hunt design "Model field plan" step 1; Decision 27; Open question 10]
2. WHERE the user wants the measurement, THE work SHALL run the same short task twice (no `model`, then the candidate `model`) after the user approves, and SHALL compare the credits on the gateway usage lines. THE task SHALL be Hunt_Begin, Hunt_Info for one level, one Hunt_Submit with a fixed token list, Hunt_End. [exploit-hunt design "Model field plan" step 2]
3. WHEN a `model` value is added to `agents/playtester.json`, THE agent file lint test SHALL be updated by the user-approved change, and the value SHALL be checked, after a Sync, in the generated agent file and on a real run's usage line. [exploit-hunt design "Model field plan" step 3, Requirement 1.10]
4. IF the field does not survive the App Kit's regeneration, THEN THE agent file SHALL stay without `model` and the Notes_File SHALL record that the cost question stays open. [exploit-hunt design "Model field plan" step 4]
5. WHERE the user skips the measurement, THE agent file SHALL keep no `model` field and the Notes_File SHALL record the skip. [exploit-hunt A-12]

### Requirement 12: README

**User Story:** As a judge or a new user, I want a README that says what the app does, how to install it, and what it does not do, so that I know what I am running.

#### Acceptance Criteria

1. THE README SHALL state, in its first lines, what the app does: a Kiro Crew app that replays every Grimsheet level each night and sends an agent to break them, with the tagline "The night watch for a haunted spreadsheet". [product steering; brief §1]
2. THE README SHALL explain the two jobs: the nightly replay (no model call; fetches Grimsheet `main`, records the commit hash, builds it, plays every stored solution, writes results) and the on-request hunt (agent proposes action lists, a deterministic verifier replays each one, only verified candidates are recorded). [brief §4; product steering "Two jobs"]
3. THE README SHALL state the level colours (green, red, amber) and the exploit classes (cheaper win, free win, unexpected route), and SHALL say that the dashboard also shows a fourth state "Not judged" for a level the verifier could not judge. [product steering; replay-runner D3; dashboard Glossary "Colour_Label"]
4. THE README SHALL contain the install steps of Requirement 8, in order, with the commands as plain code blocks and no user name, home path or drive letter (the Crew_CLI is shown by the path built from `$env:ProgramFiles`, Requirement 8, criterion 4), and a separate developer path with the `ui/` build steps (Requirement 8, criterion 2). [brief §10 item 6; Requirement 8]
5. THE README SHALL state that only Windows was tested (Windows 11, Crew 0.12.0, the KiroCrew desktop app, one user), and that macOS, Linux and WSL were not tested. [replay-runner R14.6; exploit-hunt R15.7; tech steering "Stack"; brief §6]
6. THE README SHALL state that the nightly replay runs at 03:00 America/Los_Angeles only WHILE the machine and the Crew gateway are running, and that the run is missed otherwise. [replay-runner R12.7]
7. THE README SHALL state that the hunt is on request only, started by the user from chat, that there is no schedule, and why: a message cron that starts the agent was rejected at its first approval after 192 seconds while the job reported OK, and `allowedTools` has no effect on an app agent. [exploit-hunt R14.2, R14.7, R12.3; notes h.10.4, h.10.5]
8. THE README SHALL state the Approval_Count to expect: about one per Hunt_Script call and roughly 30 for a full hunt (Hunt_Begin once, Hunt_Info once per level, up to 20 Hunt_Submit, Hunt_End once, and the skill loads), more only WHEN charged refusals are used (at most 10 more), AND SHALL replace "roughly 30" with the measured number once Requirement 10 has recorded one. [exploit-hunt R14.7, R15.7; Requirement 10]
9. THE README SHALL state that the default is approving each step (**Normal**), and that the user MAY switch the hunt's chat session to **Trust** at the user's own choice because it approves every tool in that session, AND SHALL mark **Trust** as tested or untested according to Requirement 10. [exploit-hunt R14.11, R14.15]
10. THE README SHALL NOT recommend **YOLO** and SHALL say why (it auto-approves every tool in every chat), and SHALL NOT present **Reads** as a way to skip the hunt's prompts (it auto-approves only read-only shell commands; the Hunt_Scripts are `node` commands that write files, expected from the documentation and not tested). [exploit-hunt R14.12]
11. THE README SHALL state the hunt budgets: 4 Attempts per level, 20 per hunt, 1800 seconds, 10 refusals, with the reason that in the default mode every Hunt_Submit is one approval and one agent turn and credits are limited. [exploit-hunt R15.7, A-4, Open question 7]
12. THE README SHALL state that credits per full hunt are unmeasured, with the observed range (a short supervised run cost 0.1 to 0.4 credits; one run with a failed long tool call cost 7.86 credits), UNLESS Requirement 10 has recorded a measured number, in which case THE README SHALL state that number and its date. [exploit-hunt R15.7; notes h.10.3, h.10.7]
13. THE README SHALL state that the hunt is a bounded search and not a proof that no cheaper win exists. [product steering "Non-goals"; brief §8; exploit-hunt R15.7, Out of scope]
14. THE README SHALL state that the app never writes to the Grimsheet repository (no commits, branches, issues or pull requests) and that it reads a fresh clone in `%LOCALAPPDATA%\grimsheet-playtester`, outside the app folder. [product steering; brief §4; exploit-hunt R15.1]
15. THE README SHALL state that the untested non-Windows branch of the process kill (`process.kill(-pid, 'SIGKILL')`) exists in the code and has not been run. [replay-runner tasks 5.2 ("untested branch, noted in the README by `packaging`"); replay-runner design "Process"]
16. THE README SHALL state the prerequisites: Node 22.12 or later and git on PATH, and the Crew version tested. [tech steering; replay-runner R14.7]
17. THE README SHALL state where results show up: the dashboard page for levels, trend and findings; the Schedule page Executions tab for the job state; and that the page polls (60 seconds, 15 seconds while the replay runs) and has a Refresh button because no event marks a finished run. [notes h.3, h.7; dashboard R8.4, R8.5]
18. THE README SHALL state the known limits: findings from an earlier commit are labelled and not retired; a Sync while a run is active can fail and leave `.grimsheet-playtester-data-tmp`; the config route size limit as measured in Requirement 6; and the watch item of the gateway warning. [dashboard R6.5; replay-runner D8; notes h.1, h.8; exploit-hunt Out of scope]
19. THE README SHALL state the licence (MIT), that the app is written from scratch and runs Grimsheet's play command without copying Grimsheet code, and that there are no paid APIs and no hosting. [tech steering "Stack"; brief §7; LICENSE]
20. THE README SHALL contain screenshots of the dashboard (Open question Q9, closed), taken by the developer on the installed page or by a capture the user approves. THE capture SHALL save no token, no session address and no browser address bar that holds either, and the images SHALL show no Windows user name or home path. [brief §9 ("screenshots"); brief §11; exploit-hunt R15.4]
21. THE README SHALL name no tool or assistant other than Kiro, and SHALL contain no Windows user name, home path, drive letter, token, `localhost` address or `127.0.0.1` address; every web address in it SHALL begin with one of the two allowed prefixes of criterion 24. [project rule; exploit-hunt R15.4]
22. THE README SHALL quote only text that was seen (a warning, a button label, an option label); IF a text was not seen, THEN THE README SHALL describe it without quotation marks or leave it out. [project rule: do not fill gaps from memory]
23. THE README SHALL refer to `docs/CREW_NOTES.md` and `docs/evidence/INDEX.md` for the facts and evidence behind the install steps.
24. A README lint test SHALL check the points that a program can check: the presence of the phrases "Windows" and "only Windows was tested", "03:00", "on request", "bounded search", "MIT", and the absence of a drive letter, `Users\`, `token=`, `localhost` and `127.0.0.1`. The lint SHALL also check that every `http://` or `https://` address in the README begins with one of the two allowed prefixes `https://github.com/UBayouski/` and `https://grimsheet.onrender.com` (this replaces a check for a dashboard address with a check that a program can do). The lint SHALL hold no list of other tool or assistant names, because such a list would put those names in a repo file; criterion 21 is a review rule, checked by reading (Open question Q10, closed). [project rule; exploit-hunt R16.7 (same kind of lint)]
25. THE README SHALL link the Grimsheet repository (https://github.com/UBayouski/Grimsheet) and the live game (https://grimsheet.onrender.com), and SHALL say that this app is the Kiro Crew companion to the Grimsheet entry. [product steering "Hackathon"]

### Requirement 13: Licence and non-claims

**User Story:** As a judge, I want the licence and the limits of the claims stated, so that the project does not promise what it cannot show.

#### Acceptance Criteria

1. THE repo SHALL keep the `LICENSE` file as the MIT licence, and THE Manifest SHALL carry no licence text that contradicts it. [tech steering "Stack"; brief §7]
2. THE README SHALL NOT claim that a hunt can run unattended, that the hunt finds every exploit, or that the app runs on a platform other than Windows. [exploit-hunt R14.8, R15.7; replay-runner R14.6]
3. THE README SHALL state that the Crew bonus claim rests on the Playtester_Agent, its two skills, the nightly replay cron and the dashboard, and that a hunt cron is not part of it. [exploit-hunt R14.8]
4. THE README SHALL state that the dashboard reads results and never writes them. [dashboard R1]

### Requirement 14: Repo hygiene for packaging files

**User Story:** As the developer, I want the packaging files to follow the repo's rules, so that nothing private or wrong is published.

#### Acceptance Criteria

1. THE files created or changed by this spec (`app.json`, `README.md`, the Manifest_Check, the combined test script, the Notes_File and evidence entries, `KIRO_USAGE.md`) SHALL contain no Windows user name, home path (use `~`, `%USERPROFILE%` or `%LOCALAPPDATA%`), token or dashboard URL. [exploit-hunt R15.4; crew-app steering]
2. THE files SHALL name no tool or assistant other than Kiro. [project rule]
3. THE work SHALL run no git write command (no add, commit, push, branch or tag). [project rule]
4. THE work SHALL edit `docs/BRIEF.md` and the steering files only to correct statements that a measurement of Requirements 6, 9 or 10 shows to be wrong, and SHALL list each such change in the Usage_Entry. [crew-spike R8.3; brief §6 table]
5. THE `ui/` and root source files SHALL stay unchanged by this spec except by an explicit user approval under Requirement 9, criterion 6 (React pins), Requirement 7 (the new `scripts/test-all.mjs` and the `test:all` entry of the root `package.json`), Requirement 8, criterion 2 (the `.gitignore` change, the new `.gitattributes` and the committed `ui/dist/index.mjs`) and Requirement 11, criterion 3 (the `model` value). [dashboard tasks "Rules that apply to every task"]

### Requirement 15: KIRO_USAGE.md entry as the last task

**User Story:** As the developer, I want the work on this spec logged, so that the Kiroween write-up can use it.

#### Acceptance Criteria

1. THE last task of this spec SHALL append the Usage_Entry to `KIRO_USAGE.md`, after reading the file for its entry format. [verifier tasks 10; replay-runner tasks 14; exploit-hunt tasks 24; dashboard tasks 19; crew-spike R8.4]
2. THE Usage_Entry SHALL state the surface, the Kiro features used (spec, steering, powers, hooks, agent), what was asked, what Kiro did, and what changed because of it, including the measured numbers of Requirements 6, 9 and 10 and every difference between the documentation and observed behaviour.
3. THE Usage_Entry SHALL name no tool other than Kiro and SHALL contain no Windows user name or home path. [project rule]
4. THE Usage_Entry SHALL be written after every other task of this spec is done or explicitly skipped by the user, and SHALL state which Hand_Run_Steps were run and which were skipped.

## Differences between the documentation and observed behaviour

Observed behaviour wins [notes h.2]. "Docs" is the library `/kirodotdev/kirocrew` (queried 2026-11-08, pages named above) or the pages cited in `docs/CREW_NOTES.md`.

| # | Docs say | Observed on Windows, Crew 0.12.0 | Citation |
|---|---|---|---|
| 1 | `command` crons are a normal kind of cron (default 300 s). | A `command` cron is rejected at registration on a Windows gateway; a Python `script` cron works. | notes h.4; E18 |
| 2 | `timeout_secs` is a per-wake budget (default 1800) and must cover `timeout` plus 5 s. | Agrees on the rule. `timeout_secs: 900` alone did not raise a script's 30 s limit; `timeout` is the limit. A Sync with 900 and 900 was refused ("need >= 905, got 900"). | notes h.4, A-05, A-25; E21 |
| 3 | Manifest `env` configures a cron. | The `env` does not reach a script cron. | notes h.4, A-09; E20 |
| 4 | A script cron's working folder is not stated. | It is the KiroCrew install folder, not the app folder. | notes h.4, A-01; E20 |
| 5 | `kirocrew app enable <name>` grants activation, after trust. | Trust and enable were done in the dashboard; the CLI `enable` was not needed. The install output still says "Run: kirocrew app enable". | notes h.1; E08 |
| 6 | The CLI updates an installed app (`app update`, App Store Update/Sync). | `app update <name> --source <dir>` failed ("No running gateway answered") while the desktop gateway ran; the dashboard **Sync** worked; `app install` again refuses ("already installed"). | notes h.1; E11 |
| 7 | "Serve your UI from a committed `ui/dist/` bundle" (publishing guide). | `ui/dist/` is ignored by this repo's `.gitignore` today; this spec commits `ui/dist/index.mjs` (R8.2, Q5 closed), so the install needs no `ui/` build. | notes g; dashboard tasks 17.3; root `.gitignore` |
| 8 | Install excludes `node_modules`, `.git`, `__pycache__`, `.venv`, `.kirocrew-deps`. | Agrees for `.git` and `node_modules` at any depth. `data\` is copied at install (docs say `data/` is "preserved across updates and uninstall"). Everything else in the folder was copied. | notes h.1; E08; E17 |
| 9 | SDK examples use named imports and `getAppDataDir`, `getAppConfig`, `setAppConfig`. | These three are not exported by SDK level 1; a missing named export fails the module at link time. | notes h.2, h.3, A-12; E09; E14 |
| 10 | `useAppInfo` returns `{name, version, permissions}`. | It returns `{name, version, permissions, active}` and no data path. | dashboard "Docs re-check"; E24 |
| 11 | `GET /api/crons` returns `{jobs: [...]}`, filtered to the app's jobs for an app token; example fields `id`, `message`, `last_result`. | Observed fields: `last_run_ts`, `last_status`, `is_running`, `consecutive_failures`, `next_run_ts`, `enabled`, `user_paused`; no run output. Format of the two time fields not recorded (Q6). | notes h.3; E24 R6; dashboard "Docs re-check" |
| 12 | A PUT to the config route from a dashboard subject is owner only. | A PUT from the page worked and replaced the whole object. | dashboard "Docs re-check"; notes h.3; E24 R7 |
| 13 | Project skills load through `skill://.kiro/skills/*/SKILL.md`. | Not loaded on Windows; `skill://~/.kiro/crew/apps/<app>/skills/*/SKILL.md` and absolute globs load. | notes h.6, A-17, A-18; E29 |
| 14 | `allowedTools` skips permission prompts. | `allowedTools` is stripped from an app agent's generated file; every command and skill load prompted. `permissions.rules` survived but did not remove a prompt. | notes h.10.4; E32 |
| 15 | `tools` lists the mounted tools; an absent list is an empty allowlist. | Agrees: no `tools` means no tool access. | notes h.5; E29 |
| 16 | The manifest reference shows `ui.entry` as `dist/index.mjs`; the app-dev skill example shows `index.mjs`. | `dist/index.mjs` was built, installed and served. | notes f; E10; E11 |
| 17 | `ui.pages[]` accepts `entryPoint` and `mountFunction` (default `mount`). | The spike used a default export and neither field; the page rendered. Not documented what `mountFunction` does with a default export. | dashboard "Docs re-check", Q9; E14, A-11 |
| 18 | `permissions.network` and `cron` are stored and shown at install with no runtime gate. | No network block was seen with `network` unset. Effect of `network`: not tested. | notes e, h.8, A-10 |
| 19 | The first cron-output location is not stated beyond the Schedule page. | Executions tab row; summary empty on success; script output not shown; `ctx.notify` goes to the Activity Feed. | notes h.7; E22, E23, E24 |
| 20 | The Library offers an Update action for installed apps. | No Update button for a locally installed app; Sync is in Details or the Library menu. | notes h.1; E12 |
| 21 | An uninstall preserves `data/` by default. | Agrees; the app folder with `data\` stayed after every uninstall, and so did `cron-history\<job id>.jsonl`. | notes h.1, A-22; E12, E17, E34 |
| 22 | Docs state no size limit for the config route. | Not tested yet; Requirement 6 measures it. | notes h.8 |

## Hand-off trace (source criterion to covering requirement)

| Hand-off | Source | Covered by |
|---|---|---|
| App `name` | replay-runner Q2/A-1; dashboard A-1; exploit-hunt A-1 | R1.1 |
| `agents` entry | exploit-hunt R1.9, Dependencies | R2.1 |
| `skills` entries | exploit-hunt Dependencies | R2.2 |
| `replay` cron entry | replay-runner R12.1 to R12.5, R11.1, R11.2 | R3.1 to R3.3 |
| No `hunt` cron | exploit-hunt R14.1, R14.9, R12.1 | R3.4, R3.5 |
| `ui` entry | dashboard R9.1 | R4.1, R4.2 |
| `permissions.api`: config and crons only; no events | dashboard R1.3, R1.4, R1.6 | R4.3 to R4.5, R4.9 |
| `timeout` equals Cron_Timeout; `timeout_secs` at least +5 | replay-runner R12.6, R11.2; design "CRON_TIMEOUT"; tasks 12.3 | R5.1 to R5.3, R5.8 |
| Config route measurement and Notes record | replay-runner R9.7, R9.8, R13.10, Q3; dashboard Q8, A-8 | R6 |
| Byte_Budget stays 65536 unless measured otherwise | replay-runner R9.6, Q3 | R6.8, R6.9 |
| `.mjs` fallback decision | replay-runner D6 | R6.10 |
| Dashboard Q3 (job name in `/api/crons`), A-5, A-6 | dashboard Q3 | R9.4 |
| Dashboard Q9 (`mountFunction`, `entryPoint`) | dashboard Q9, A-11 | R4.8, R9.5 |
| Dashboard Q10 (host React version) | dashboard Q10 | R9.6 |
| Clipboard check | dashboard A-10, tasks Notes | R9.7 |
| Combined test command | dashboard design decision 17 | R7 |
| Clean clone (local `data\` is copied) | replay-runner tasks 13; exploit-hunt tasks 22 | R8.1, R9.2 |
| Commit the built `ui/dist/index.mjs`; fail on a missing or stale bundle | brief §10 item 6; notes g; dashboard tasks 17.3 | R8.2, R14.5 |
| Install, trust, enable | brief §10 item 6; notes g, h.1 | R8.4 to R8.8 |
| Esbuild install-script warning | user hand-off list | R8.9, Q4 |
| Gateway warning to expect | brief §10 item 6; notes h.8; E28 | R8.10 |
| First real install | exploit-hunt tasks Notes; dashboard tasks Notes | R9 |
| Measured size of `latest` and the Results_Key after `endHp`; correct exploit-hunt design numbers | replay-runner task 16.1; exploit-hunt design "Together with the replay's value" | R9.15 |
| README links to Grimsheet and the live game | product steering | R12.25 |
| First agent-run hunt | exploit-hunt tasks Notes, Open question 5 | R10 |
| README: what the app does | product steering | R12.1 to R12.3 |
| README: install steps | brief §10 item 6 | R12.4 |
| README: only Windows tested | replay-runner R14.6; exploit-hunt R15.7; brief §6 | R12.5 |
| README: nightly replay only while machine and gateway are up at 03:00 | replay-runner R12.7 | R12.6 |
| README: hunt on request only, ~30 approvals | exploit-hunt R14.2, R14.7, R12.3 | R12.7, R12.8 |
| README: approval mode text | exploit-hunt R14.11, R14.12, R14.15 | R12.9, R12.10 |
| README: credits, budgets, bounded search | exploit-hunt R15.7 | R12.11 to R12.13 |
| README: untested non-Windows kill branch | replay-runner tasks 5.2 | R12.15 |
| MIT licence, bounded-search non-claim | tech and product steering; brief §7, §8 | R12.13, R12.19, R13 |
| `KIRO_USAGE.md` entry last | every earlier spec's last task | R15 |

Hand-offs found in the specs that were not in the request list: the model field plan (exploit-hunt Decision 27, Open question 10, design "Model field plan") is Requirement 11; the README text on **Trust**, **YOLO** and **Reads** and the credits statement (exploit-hunt R14.11, R14.12, R14.15, R15.7) are in R12.9 to R12.12; the untested non-Windows kill branch note (replay-runner tasks 5.2) is R12.15; the check that Q4 timings (replay-runner A-12) hold after real runs is covered by R9.8 and R9.9 only as a record, not as a change (Open question Q7); the Executions-tab summary for a failed Launcher (replay-runner D10) is R9.9; whether the permission grants need approval is R9.10; the leftover `spike\ui` folder is R9.2.

Hand-offs from the request list with no source found: none missing in the specs. Two items come from the request and not from a spec: the esbuild install-script warning (searched `docs/`, `.kiro/` and `KIRO_USAGE.md` for "esbuild" and install-script text: only dashboard design mentions esbuild as a build tool; no warning text is recorded; Q4) and the second half of "no `hunt` cron" in the README (covered by R12.7).

## Open questions

Each item names what would settle it.

- **Q1. `author` value. Closed.** The developer decided: `UBayouski` (R1.7).
- **Q2. Page `icon` and `label`.** The spike used a Lucide name (`FlaskConical`, E08) and the sidebar showed it; the name for this app is not chosen. Settled by the design choosing a name and the first install (R9) showing the sidebar entry.
- **Q3. `permissions.storage`.** The spike manifests set `storage: true`; it exposed no SDK call (E24) and whether the config route works without it was not tested. Settled by the first install: try without `storage`, and if the Config_Route fails, set `storage: true` and record it. Assumption until then: omit it.
- **Q4. The esbuild install-script warning.** No text is recorded in `docs/` or the specs. Settled by running `npm ci` in `ui/` on the Clean_Clone at the first install (the developer path, since a judge no longer builds) and copying the exact text, or recording that no warning appeared.
- **Q5. Commit `ui/dist/` or build it. Closed.** The developer decided: commit the built `ui/dist/index.mjs` (R8.2). The developer rebuilds before each commit that touches `ui/`; the Manifest_Check or the combined command fails on a missing or stale bundle; the `.gitignore` change is a task of this spec.
- **Q6. Time field formats and job name in `/api/crons`.** Settled by R9.4 (one read on the installed app).
- **Q7. Cron timing numbers.** Replay-runner Q4/A-12 says to confirm `timeout` 900, `timeout_secs` 905 and the Step_Limits after real nightly runs. Settled by the first real scheduled run (R9.8, R9.9) recording the run duration; a change to the values is a separate amendment of replay-runner R11 and R12 and of the Manifest.
- **Q8. Combined test command form. Closed.** The developer decided: a Node script `scripts/test-all.mjs` and an npm script `test:all` in the root `package.json` (R7.1).
- **Q9. Screenshots. Closed.** The developer decided: yes, taken by the developer on the installed page, or by an approved capture that saves no token (R12.20).
- **Q10. Blocked-name list for the README lint. Closed.** No list: a list of other tool or assistant names would itself put those names in a repo file, which the project rule forbids. The lint keeps the other checks (R12.24); R12.21 stays a review rule, checked by reading.
- **Q11. Whether other repo files are copied at install.** The install copies everything except the excluded folders (E08, E17), so `docs/`, `tests/`, `.kiro/` and `KIRO_USAGE.md` land in the installed copy. No Crew mechanism to exclude more was found in the docs read (publishing guide, section 9). Settled by the first install listing the installed folder, or by a docs page not yet read.
- **Q12. Version value. Closed.** The developer decided: `1.0.0` (R1.2).
- **Q13. Direct install from a git URL. Closed: not tried.** Not documented and not tried (notes g, h.8). The README uses clone and local install (R8.13).
- **Q14. Whether the `replay` job is registered on trust and enable alone.** The observed spike registered a script cron after Sync; for a fresh install the order trust, enable and the job's appearance on the Schedule page is observed only for the spike's own cron (E20). Settled by R9.8 recording when the job appeared.
