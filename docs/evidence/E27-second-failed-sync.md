# E27: a second failed Sync, found before agent run A1 (task 7.2)

date: 2026-11-07, 17:26Z to 17:34Z. Crew 0.12.0. Paths use ~. Nothing was deleted or retried.

## What the security log shows (`~\.kiro\crew\security_events.jsonl`)

| time (Z) | event | outcome |
|---|---|---|
| 17:26:16 | `POST /api/apps/crew-spike/update` (my Sync from E26, the launcher change) | ok |
| 17:26:41 | `POST /api/crons/a471b9f5/run` (my manual run, R3b); the run ended 17:26:53 | ok |
| 17:26:48 | `POST /api/apps/crew-spike/update`, caller `dashboard_user`, **not issued by me** | **error**: `[WinError 5] Access is denied: ...\crew-spike\data\grimsheet\.git\objects\pack\pack-<id>.idx`; "rollback failed" |
| 17:26:51 | `POST /api/apps/crew-spike/enable` (app enable), **not issued by me** | ok |
| 17:26:57, 17:27:00 | two more `POST .../update` calls, **not issued by me** | error: Access denied on the same `.idx`, now under `~\.kiro\crew\apps\.crew-spike-data-tmp\grimsheet\...` |
| 17:33:17 | `POST /api/apps/crew-spike/update` (my Sync of the `probe-agent.json` change) | **error**, same Access denied under `.crew-spike-data-tmp` |

The three unrequested update calls and the enable came from the dashboard (caller `dashboard_user`), while my Playwright page sat on the Schedule page. Who or what sent them is not shown by anything read here. The 17:26:48 attempt overlapped my manual run (the launcher and `probe.mjs` were running until 17:26:53), which fits the cause inferred in E25.

I did not look for a leftover folder before the 17:33 Sync. That was a gap in my check: `.crew-spike-data-tmp` already existed from 17:26:46, and the later Syncs fail on it. E26 said Sync "works when no run is active"; the 17:26:16 Sync did, and the 17:33 one did not because of this leftover.

## State now (read only)

- `~\.kiro\crew\apps\.crew-spike-data-tmp`: 268 files (`launcher`, `runs`, `config.json`, `_index.json`, `.kirocrew-deps.lock`, and a `grimsheet` folder from 02:36). Three of them are read-only (the pack files).
- `~\.kiro\crew\apps\crew-spike\data`: 7,023 files, intact (grimsheet, launcher, runs, config, index).
- Installed `app-crons.json`: missing again. Installed `agents\probe-agent.json`: still holds the `<DATA_DIR>` text. The source `spike/agents/probe-agent.json` holds the real path.
- App: enabled, version 0.0.2. Job `a471b9f5`: `enabled: false`, `user_paused: true`, no next run, not running.
- Whether probe-skill is registered right now was not checked; the log shows a `deregister_skills` at 17:27:00 and no `register_skills` after it.

## Repair and Sync (17:35Z to 17:37Z, after the user confirmed the 17:26 dashboard calls were theirs)

- Approved deletion of `.crew-spike-data-tmp` (attrib -r, Remove-Item -Recurse -Force): 268 files before, folder gone after. `data\` unchanged: 7,023 files before and after, and a hash over every file's path, size and modified time was identical before and after.
- A1 change: the agent clones to `%LOCALAPPDATA%\crew-spike\agent-grimsheet` (`%LOCALAPPDATA%/crew-spike/agent-grimsheet` in `probe-agent.json`), outside the app folder. The folder did not exist yet.
- Before the Sync: job `a471b9f5` paused and not running; no `.crew-spike-data-tmp`.
- Sync once, 17:36:31Z: `app_update` completed, `POST /api/apps/crew-spike/update` ok; `register_skills` completed (probe-skill registered again); `app_crons_register` completed. Installed `app-crons.json` is back (every 120, enabled false); the job is still Paused. `data\` still 7,023 files.
- The installed `agents\probe-agent.json` carries the new path, and so does the copy Crew writes to `~\.kiro\agents\crew-spike--probe-agent.json` (modified 09:36:31 local), so an agent file edit reached both without a reinstall. The dashboard agent catalog lists `probe-agent` (source `package`). Whether a run uses the new text is shown by the run itself.
