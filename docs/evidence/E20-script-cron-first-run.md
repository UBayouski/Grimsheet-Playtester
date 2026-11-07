# E20: script cron, registration and first by-hand run (task 5.0, 5.1)

date: 2026-11-07. Crew 0.12.0, KiroCrew desktop app, gateway pid 63920 on 127.0.0.1:5476. Playwright MCP on a 30-minute token (not recorded). Paths under the user profile use ~.

## 5.0 Launcher, hand check, registration

- `spike/scripts/probe_cron.py` written (standard library only, `run(ctx)`). `probe.mjs` is unchanged.
- Hand check with the gateway's own Python (`C:\Program Files\KiroCrew\resources\backend-dist\kirocrew-backend\python.exe`, 3.12.16, `-I`) against a throwaway copy in %TEMP%, deleted afterwards:
  - wait mode: `outcome=child-exited`, 13.1 s, child exit 0, all 11 probe steps ok;
  - detached mode: the launcher returned in 0.6 s (`started-detached`, `breakaway: true`), and the probe report completed 15.7 s later.
- `spike/app.json`: the command cron was replaced by `"script": "scripts/probe_cron.py:run"`, `every: 86400`, `enabled: true`, `env` with `SPIKE_TIMEOUT_SECS` and `SPIKE_LAUNCH_MODE`.
- Pushed with the dashboard Details → **Sync** at 10:34:29Z. No reinstall was needed and the app stayed trusted. Security log at 10:34:30Z: `app_cron_script_vetted` allowed, `cron_script_vetted` allowed, `cron_add_job` ok (job `a471b9f5`), `app_cron_add_job` allowed, `app_crons_register` `crons=['crew-spike/probe']`. The stored `app-crons.json` shows `script`, an empty `command`, every 86400 and `enabled: true`.
- No run fired on its own after registration.

## Where the cron is listed (A-23)

Schedule page, List view, read from the page text (the screenshot E22-schedule-script-cron.png did not capture it: it shows the Executions list while the List tab was still highlighted, see E22-E23). The row: ID `a471b9f5`, name `crew-spike/probe`, "No owning session", type "script · python", schedule "every 24h", the script path (`~\.kiro\crew\apps\crew-spike\scripts\probe_cron.py:run`), status Ready, last run "-", next run "in 23h", and Run and Delete buttons.

## 5.1 First by-hand run (wait mode), started 10:36:01Z with the Run button

The Run button sends `POST /api/crons/a471b9f5/run`, recorded as `trigger: manual` in `~\.kiro\crew\cron-history\a471b9f5.jsonl`.

Launcher record `data\launcher\20261107T103601Z-31472.json`:
- pid 31472, ppid **63920 (the gateway)**, parent image python.exe. `sys.executable` is the bundled `python.exe`; `sys.flags.isolated` is false.
- cwd: `C:\Program Files\KiroCrew` (the desktop app folder, **not** the app folder).
- `which`: node `C:\Program Files\nodejs\node.EXE`, npm `C:\Program Files\nodejs\npm.CMD`, git `C:\Program Files\Git\cmd\git.EXE`. Node was found on PATH (`source: path`). The env has 66 names and PATH has 52 entries.
- `SPIKE_*` values: **none**. The manifest cron `env` did not reach the script process, so mode came from the default (`wait`) and the launch timeout from the default (870 s).
- `ctx`: `kiro_crew.cron_script_context.ScriptContext`, public attributes `call_tool, close, create_session_folder, crew_log_append, job, list_session_folders, message, notify, open_session, send_to_session, set_session_mode`.
- outcome `child-exited`, elapsed 12.7 s, child pid 45700, exit 0.

Probe report `~\.kiro\crew\apps\crew-spike\data\runs\r0010-20261107T103602Z.json` (`trigger: cron`, `status: complete`, `dataDir.source: fallback` = `~\.kiro\crew\apps\crew-spike\data`):
- cwd is the app folder (set by the launcher); platform win32/x64; Node v24.18.0; ComSpec `C:\WINDOWS\system32\cmd.exe`; parent python.exe (the launcher).
- `budgetSecs` and `timeoutSecsMirror` are null, because `SPIKE_TIMEOUT_SECS` did not arrive.
- envNames: no `SPIKE_*`. Names that look host-related: `KIROCREW_BOUND_PORT`, `KIROCREW_BUNDLED_KAS_DIR`, `KIROCREW_DESKTOP_GATEWAY`, `KIROCREW_PROJECT_DIR`, `KIROCREW_SESSION_KEY`, `KIROCREW_STUB_SESSION_TOKEN`, `_KIROCREW_CRON_SCRIPT_CHILD`, `_KIROCREW_GH_PREVALIDATED`. Values were not recorded. None is named as an app data directory.
- Steps, all ok:

| Step | Duration | Result |
|---|---|---|
| node-version | 41 ms | v24.18.0 |
| npm-version | 257 ms | 11.16.0 |
| git-version | 51 ms | 2.53.0.windows.2 |
| https-github | 137 ms | HTTP 200 |
| git-ls-remote | 368 ms | main = 6372d9a27ae8... |
| clone-or-update | 838 ms | `clone-after-delete` (removed 21 entries of the install's non-git copy), commit 6372d9a27ae81a6ab75e9f8ae45d1d70ccebe50b |
| npm-ci | 8958 ms | exit 0, 142 packages |
| build-play | 647 ms | `headlessJsExists: true` |
| play-list | 71 ms | 01-the-corridor, 02-the-chaser, 03-the-locked-crypt, 04-the-trap-row, 05-the-lich |

Index after the run: nextCounter 11, 5 entries (r0006 to r0010).

## Dashboard responsiveness (Requirement 4.10), E20-latency-wait-mode.csv

`GET http://localhost:5476/` once a second:
- Baseline before the run: n=29, mean 40 ms, max 60 ms.
- During the run (10:36:01.8Z to 10:36:14.6Z): n=13, mean 40 ms, max 53 ms, all HTTP 200.
- Second loop E21-latency-hold45.csv, across the two hold runs in E21 (10:39:39Z to 10:43:44Z): n=242, mean 85 ms, max 212 ms, all HTTP 200.

Every sample was under the 2 s threshold.

## Readings

- **A-24 confirmed:** a script cron runs in a child process of the gateway (ppid = gateway pid 63920), under the gateway's bundled Python.
- **Requirement 4.10:** the wait-mode launcher did not block the gateway. Detached mode (task 5.2) was not needed for blocking. It was hand-checked only.
- **A-26 confirmed:** node, npm and git are on the script cron's PATH on this machine.
- **A-01 refuted** for the script cron: its cwd is the desktop app folder `C:\Program Files\KiroCrew`, not the app folder. The launcher does not depend on it.
- **A-09 refuted** for the script cron: the manifest `env` does not reach the script's process (no `SPIKE_*` at all). `enabled: true` lists and schedules the cron; `enabled: false` does not hide it (E18).
- **A-23 confirmed** for the script cron: it is listed on the Schedule page (List) with a Run button, and the by-hand run works.
- **A-03:** no env var named for the app data directory. `KIROCREW_PROJECT_DIR` is a lead (value not recorded). The probe's fallback (`<app>\data`) worked.
- **A-04:** `npm --version` works through `shell: true` (cmd) from the launcher's environment. Whether it would work without the shell was not tested.
- The script cron's summary in the run history is empty for a successful run. The launcher's printed line is not used as the run summary (see E22-E23).
