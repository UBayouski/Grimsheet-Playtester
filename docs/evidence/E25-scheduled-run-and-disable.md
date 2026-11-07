# E25: scheduled run, disable, and a failed Sync (task 6.4)

date: 2026-11-07, 11:07Z to 11:14Z. Crew 0.12.0, job `a471b9f5`. Paths use ~.

## Scheduled run

- `spike/app.json`: `every: 120`, `timeout: 100`, `timeout_secs: 110` (at least `timeout + 5`, E21), `env.SPIKE_TIMEOUT_SECS` "100", `enabled: true`. The control file kept `SPIKE_SERVE_DIR`; `ctxNotify` and `ctxLog` were turned off. Pushed with Sync at 11:07:32Z (ok). The installed `app-crons.json` showed every 120, enabled true, timeout 100, timeout_secs 110.
- The scheduler fired on its own three times. Cron-history (`~\.kiro\crew\cron-history\a471b9f5.jsonl`):

| trigger | status | duration | started (UTC) |
|---|---|---|---|
| scheduled | success | 14.7 s | 11:07:58 |
| scheduled | success | 26.0 s | 11:09:58 |
| scheduled | success | 27.1 s | 11:11:58 |

- A scheduler run is recorded as `trigger: "scheduled"`, and a Run-button run as `"manual"`. The probe report says `trigger: cron` for both (r0022 and r0023 are `complete`). The first fire came 26 s after the Sync, not 120 s later, so the interval counted from the last run (11:05:58Z). No random start delay showed at this interval.

## Disabling it

1. Edit `"enabled": false` in `spike/app.json` and Sync (the manifest route). **This failed twice**:
   - 11:12:22Z. Security log `POST /api/apps/crew-spike/update` outcome `error`. Gateway log: `Failed to restore app crew-spike after update error`, `PermissionError: [WinError 5] Access is denied: '~\.kiro\crew\apps\crew-spike\data' -> '~\.kiro\crew\apps\.crew-spike-data-tmp'`, then `Access is denied: '...\crew-spike\data\grimsheet\.git\objects\pack\pack-<id>.idx'` (`manager_install.py`, `update_app`, lines 738 and 784, read-only). The scheduled run of 11:11:58Z was still running (it took 27.1 s), so the Sync landed while `git` and `node` held files under `data\`.
   - 11:12:43Z. The second Sync failed with `[WinError 5] Access is denied: '~\.kiro\crew\apps\.crew-spike-data-tmp\grimsheet\.git\objects\pack\pack-<id>.idx'`. The security log shows `deregister_skills app=crew-spike skills=['probe-skill']` (completed) just before that error.
   - The cron stayed enabled at every 120 s. The Schedule page showed it "Running" during the first attempt (screenshot not kept (shows a local path)).
2. Pause through the gateway (the toggle that worked). `POST /api/crons/a471b9f5/enable` with `{"enabled": false}`, sent from the authenticated dashboard page at about 11:13:40Z, answered `200 {"ok": true}`. `/api/crons` then showed `enabled: false`, `user_paused: true`, `next_run_ts: null`. The Schedule page List shows the row as **Paused**, with next run "—" and the Run and Delete buttons (screenshot not kept (shows a local path)). No run fired after 11:11:58Z. The Schedule page List has no pause control of its own: its row actions are Run (or Cancel while running) and Delete. `kirocrew cron pause` exists in the CLI (`kirocrew cron --help`), but the CLI cannot reach the desktop gateway (E11), so it was not used.

Screenshots not kept (screenshot not kept (shows a local path)), in words. During the failed Sync: the Schedule List with the `crew-spike/probe` row, "every 2m", status Running, last run "2m ago", next run "now", and Cancel and Delete buttons. After the pause: the same row with status Paused, last run "1m ago", next run "—", and Run and Delete buttons. The script path on screen includes the user name. Neither shows a token or an address bar.

## State left by the failed Sync (needs the user)

- The app is still installed, trusted and enabled (`kirocrew app info`: version 0.0.2, enabled true). The job is registered and paused.
- `~\.kiro\crew\apps\crew-spike\data` is intact: grimsheet, launcher, runs, `config.json`, `_index.json`, the lock file, 7,020 files.
- Left behind: `~\.kiro\crew\apps\.crew-spike-data-tmp`, a partial copy of `data\` with 5,680 files. The installed `app-crons.json` is gone. Installed `app.json` still says every 120 and enabled true. The source `spike/app.json` says every 120 and enabled false.
- The probe skill was deregistered by the second attempt, so it may be missing until a Sync succeeds. This was not checked further.
- Nothing was deleted or repaired. A retry needs the leftover temp folder handled first, and the user to decide.

## Readings

- **Requirement 3.3**: a scheduled run happens on time with `every: 120`, recorded as `trigger: scheduled`. A-09 (adds): the scheduling fields reach the job; only `env` does not.
- **A-05 (adds)**: `timeout: 100` / `timeout_secs: 110` was accepted, and runs of 15 to 27 s finished.
- **Toggle method**: the `POST /api/crons/{id}/enable` route pauses a job (`user_paused: true`) and the Schedule page shows Paused. The manifest route (`enabled: false` plus Sync) could not be confirmed, because Sync failed.
- **New risk for the real app (observed once, cause inferred)**: a Sync or update on Windows moves `data\` aside and back. With a run holding files in `data\` (a git clone's read-only pack files included), the move fails, and the restore fails too. That leaves a `.<app>-data-tmp` folder and a half-updated install. The replay job should keep its clone where an update does not move it, or updates should only happen while no run is active. Which of these Crew supports is not documented.
