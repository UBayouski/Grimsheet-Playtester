# E26: repair after the failed Sync (task 6, before task 7)

date: 2026-11-07, 17:24Z to 17:29Z (local 09:24 to 09:29). Crew 0.12.0, job `a471b9f5`. Paths use ~. The user approved deleting `~\.kiro\crew\apps\.crew-spike-data-tmp` and nothing else outside the repo.

## Steps and results

1. **Job state before anything.** `GET /api/crons`, entry `a471b9f5`: `enabled: false`, `user_paused: true`, `next_run_ts: null`, `is_running: false`. Safe to go on.
2. **Data folder intact.** `~\.kiro\crew\apps\crew-spike\data`: 7,020 files, with `config.json` (`{"spikeCounter":15}`), `_index.json` (nextCounter 25), `runs\` (5 reports), `launcher\`, `grimsheet\` and `.kirocrew-deps.lock`.
3. **Leftover deleted.** `.crew-spike-data-tmp`: 5,680 files before, 3 of them read-only. `attrib -r "<tmp>\*" /s /d`, then `Remove-Item -Recurse -Force`. After: the folder is gone (0 files), and `data\` still has 7,020 files.
4. **Sync (Details page, `spike/app.json` at `enabled: false`), once, 17:25:24Z. It succeeded.**
   - Security log: `POST /api/apps/crew-spike/update` outcome `ok`; `app_update` completed. No WinError 5, no new `.crew-spike-data-tmp`, `data\` still 7,020 files. No run was active (job not running, last scheduled run hours earlier).
   - `app-crons.json` is back in the installed copy: `crew-spike/probe`, `every: 120`, `timeout: 100`, `timeout_secs: 110`, `enabled: false`.
   - The job shows **Paused**: `enabled: false`, `user_paused: true`, `next_run_ts: null`; the Schedule page row says Paused, and its Run button is **disabled with the hint "Resume to run"**. (After the earlier API pause in E25 the Run button was enabled; this state differs.)
   - probe-skill registered again: security log `register_skills ... outcome completed, app=crew-spike skills=['crew-spike/probe-skill']`. (The Library page was not opened.)
   - Other lines at the same Sync: `grants_widened` outcome `staged` ("update added permissions.api/events entries; approve to grant them"). `approved-grants.json` holds the three api paths and the event `notification`; the event `refresh` (added in E24) is not in it. `useAppEvents` never fired in E24 either way. Gateway log warning: the cron's `env` changed in the manifest and "the job keeps its current value(s) until the app is disabled and enabled again" (the manifest `env` does not reach the job, as in E20).
   - Sync works again when no run is active. That fits the cause inferred in E25 (a running job held files under `data\`).

## Config route after the Sync (observation, cause not known)

Before the repair Sync, `data\config.json` held `{"spikeCounter":15}`. After it, `GET /api/apps/crew-spike/config` answered `{"spikeCounter":16,"probeExtra":"seed"}`, and the file matched that. The values from the last E24 page write (counter 16 with `probeExtra`) are what the route returned, so the file read before the Sync was not the latest state. Why is not shown by anything read here.

## Screenshot not kept (screenshot not kept (shows a local path)), in words

The Schedule List after the repair: the Schedule List, narrow window. One row, `a471b…`, `crew-spike/probe` ("No owning session"), "script · python", "every 2m", a message cell with the script path (the user name is visible in it). The Status column is cut off after its first letter ("P"), so Paused is read from the API and the DOM, not from the picture. The Run button is greyed out; Delete and the "…" menu are active. No token, no address bar.
