# E24: Probe_Page round 2, the script context and freshness (tasks 6.1 remainder, 6.2, 6.3)

date: 2026-11-07, 10:56Z to 11:07Z. Crew 0.12.0, KiroCrew desktop app, job `a471b9f5`. Playwright MCP on a 30-minute token (not recorded). Paths under the user profile use ~. Each change was pushed with the dashboard Details → **Sync** (10:57:00Z, 11:01:51Z, 11:05:13Z), with no reinstall and no re-trust. Runs were started with the Schedule page **Run** button. Dev mode was on until 11:01Z (`kirocrew app dev crew-spike --off`, "normal caching restored"), and off for every freshness reading below.

## What changed for round 2

- `spike/app.json` 0.0.2. `permissions.api`: `/api/apps/crew-spike/config`, `/api/crons`, `/api/crons/a471b9f5`. `permissions.events`: first `crons` and `notification`, then `refresh` and `notification` (11:05Z, see R5). `storage: true` and `cron: true` unchanged. No other path was declared.
- `ui/src/routes.ts`: R2 is now `useAppInfo()`. R3 is GET config. R4 and R4b import `spike-latest.mjs` with and without `?t=`. R6 is GET `/api/crons` plus the a471b9f5 entry. R6b is GET `/api/crons/a471b9f5`. R7 is GET, PUT, GET on config. `tsc --noEmit` (strict) and `vite build` exit 0 after every edit.
- `scripts/probe_cron.py` reads three new optional keys from `data\launcher\control.json`. `childEnv` passes `SPIKE_*` names only to `probe.mjs`; it carries `SPIKE_SERVE_DIR` = the installed `ui\`, because the manifest `env` does not arrive (E20). `ctxNotify` and `ctxLog` call `ctx.notify` and `ctx.crew_log_append` once each, after the child exits, and record the result in `ctxTests`. The first control file was written by PowerShell with a UTF-8 BOM and was ignored (`controlError: Unexpected UTF-8 BOM`, run of 10:58:13Z). It was rewritten without a BOM.

## Round 2 rows (read from the DOM, 10:57:41Z unless stated)

| Row | Request | Permission entry | Result and response shape |
|---|---|---|---|
| R0 | `Object.keys(sdk)` | none | Same 34 exports as E14. `APP_SDK_LEVEL` 1. |
| R1 | `useAppApi().get("/api/apps")` (control, undeclared) | not declared | `AppApiPermissionError: [app-sdk] App "crew-spike" not permitted to access /api/apps. Declared: [/api/apps/crew-spike/config, /api/crons, /api/crons/a471b9f5]`. The rule is exact-path: `/api/apps/crew-spike/config` does not open `/api/apps`. |
| R2 | `useAppInfo()` | none | `{"name":"crew-spike","version":"0.0.2","permissions":{"api":[...3 paths],"events":[...]},"active":true}`. **No app folder or data folder path.** No `update` key was present. |
| R3 | `GET /api/apps/crew-spike/config` | `api: /api/apps/crew-spike/config` | `{"spikeCounter":1}` on first read. A plain JSON object; on this install `data\config.json` holds the same value. |
| R7 | GET, then `PUT /api/apps/crew-spike/config` with `{spikeCounter:n}`, then GET | same entry, no separate PUT entry | PUT answers `{"ok":true,"name":"crew-spike"}`. GET after shows the new value. **PUT replaces the whole config**: sending `{spikeCounter:11}` after a config of `{spikeCounter:10, probeExtra:"seed"}` left `{spikeCounter:11}` (11:03:58Z). It does not merge. |
| R6 | `GET /api/crons` | `api: /api/crons` | `{jobs:[...], server_tz, default_tz, host_tz}`. Only one job (`a471b9f5`) is in `jobs` for this app; whether the list is filtered to the app's own jobs is not shown. The entry has `last_run_ts`, `last_status` (`ok`), `next_run_ts`, `is_running`, `running_since`, `consecutive_failures`, `enabled`, `user_paused`, `every_secs`, `timeout_secs`, `script` (absolute path), and `has_result: false`, `last_result: null`, `last_error: null`. **No run output**, not even after `ctx.notify`. |
| R6b | `GET /api/crons/a471b9f5` | `api: /api/crons/a471b9f5` | `AppApiError: API 405: 405: Method Not Allowed`. The single-job route has no GET (the docs list PATCH and DELETE only). |
| R4 | `import("/apps/crew-spike/ui/spike-latest.mjs?t=<now>")` | none | Before any run that sets `SPIKE_SERVE_DIR`: 404 (as in E14). After the run of 10:59:47Z: `data`, report r0016, counter 16, `status: complete`. |
| R4b | same URL without `?t=` | none | Same as R4 at first load. See freshness for the difference. |
| R5 | `useAppEvents(name, cb)` | `events` entry | Never fired. Details under "Events" below. |

Not tried in round 2 because nothing points to it: a storage or files route (no documented path; E14 R3). `getAppDataDir`, `getAppConfig`, `setAppConfig` are not exported (E14).

## A-13: a file written after install is served

- `probe.mjs` wrote `~\.kiro\crew\apps\crew-spike\ui\spike-latest.mjs` (10,378 bytes) at 11:00:04Z. The page imported it at once: `GET /apps/crew-spike/ui/spike-latest.mjs` answers 200, `application/javascript`, `Cache-Control: no-cache`, with an `ETag` and `Last-Modified`. The entry bundle carries the same headers with dev mode off.
- Only module types are served. Files written by hand into the installed `ui\` and removed again: `tmp-probe.json` → 404, `tmp-probe.txt` → 403. So the fallback must be a `.mjs` (or `.js`) module, not JSON.
- **Sync deletes it.** After the Sync at 11:01:51Z the installed `ui\` was replaced from the source and `spike-latest.mjs` was gone until the next run wrote it again. Each app update leaves the page without data until the next run. The `data\` folder, which holds config, runs and the index, is kept by Sync. It is moved out and back during the update; see E25.

## The script run context (`ctx.notify`, `ctx.crew_log_append`)

Launcher records from 10:59:48Z to 11:05:58Z (6 runs) all show:
- `ctx.notify("SPIKE-NOTIFY-<stamp> crew-spike probe finished")` returns `{"ok":true,"slack":false,"session":false,"delivered_to":"notification"}`. The text appears in the dashboard **notification feed** (`/notifications`, Activity Feed) as an "Agent Message" with the marker (screenshot not kept (shows unrelated local notifications)). It reaches the page's WebSocket as a frame `{"type":"notification","data":{"kind":"agent","source":"system","channel":"system.agent","title":"Agent Message","body":"SPIKE-NOTIFY-..."}}`. It does **not** appear on the Schedule page. Executions still shows an empty summary for each of these runs (screenshot E24-schedule-executions-after-notify.png). `/api/crons` still has `has_result: false`, `last_result: null`.
- `ctx.crew_log_append("crew_spike_probe", {...}, max_age_s=3600)` raises `RuntimeError: crew_log_append() failed: HTTP 404: {"error": "not found", "code": "not_found"}`. The bundled source (`kiro_crew/cron_script_context.py`, read-only) says it needs a job bound to a crewmate (`cron_not_member_bound`) and writes `custom.latest.<type>` for a crewmate's page. This app cron has `member_id: null`, so it is not a route for an app page. Why the answer is 404 and not `cron_not_member_bound` is not known.

Screenshots, in words. E24-notifications-feed.png (screenshot not kept (shows unrelated local notifications)): the Activity Feed with filter counts at the top, "TODAY", and an "Agent Message" card whose body reads `SPIKE-NOTIFY-20261107T105948Z crew-spike probe finished`, followed by a "Cron: crew-spike/probe" entry. E24-schedule-executions-after-notify.png: the Executions table, newest first, with OK rows for 2:59:47 AM (16.9 s) and 2:58:11 AM (25.9 s), both trigger manual with an empty summary ("—"), then the older rows from E23. Neither shows a token or an address bar.

## Events (R5)

- Subscribed to `crons` and `notification` (10:57Z to 11:05Z). The SDK logs a warning for `crons`: `Event "crons" is not recognized by the gateway's scope gate.` `notification` raised no warning.
- A WebSocket capture on the page during a run (11:04:xx) saw 8 frames in 28 s: 6 `dashboard` (a 5 s heartbeat), 1 `{"type":"refresh","data":{"kinds":["crons"]}}` about 2.8 s after Run was pressed (at run start, not at the end), and 1 `notification` carrying the `ctx.notify` body. No frame marked the run finishing.
- Changed to `refresh` and `notification` (Sync 11:05:13Z). Two runs with `ctx.notify` (11:05:19Z and 11:05:58Z) were polled every 2 s for 28 s. **The `useAppEvents` callback never fired** for either name, although the `notification` frame reached the page's socket. The tab was visible and focused. The SDK's `useAppEvents` source was read in the page: it gates by `permissions.events` and then calls the host `subscribe`. Why the host delivered nothing to this app is not documented.
- So no event tells an app page that a cron run finished in 0.12.0 on this machine.

## Freshness (6.3), with dev mode off

One sequence (11:03:26Z to 11:04:04Z). The page was loaded, a run was started from the Schedule tab, and the page was read at each step:

| Step | R4 (`?t=`) counter | R4b (no `?t=`) counter | R6 `last_run_ts` | R7 config |
|---|---|---|---|---|
| A. page loaded (11:02:41Z) | 17 | 17 | run 16 | 9 → 10 |
| B. run 18 finished, no action | 17 | 17 | unchanged | unchanged |
| C. Refresh button | **18** | 17 | **new** | 10 → 11 |
| D. page reload | 18 | **18** | new | 11 → 12 |

- Nothing updates without an action: the page has no poll, and no event fires (above).
- **Refresh** (re-running the routes in place) picks up the new run for every HTTP route and for the `?t=` import. The import without a cache-buster stays stale until a reload. That is the browser's module map, which keeps one module per URL for the page's lifetime; the server headers (`no-cache`, ETag) do not change it.
- **Reload** updates everything.
- Answer to "needs `useAppEvents`, Refresh or a reload": Refresh (or a timer) is enough for HTTP routes and for an import with a fresh `?t=`. `useAppEvents` gives no signal.

## Readings

- **A-13 confirmed**: a `.mjs` written under the installed `ui\` after install is served (200, `no-cache`) and imports. Only module types are served (`.json` 404, `.txt` 403), and a Sync or update deletes the file.
- **A-07 (round 2)**: `permissions.api` is a list of exact path strings, matched exactly (R1), and one entry covers both GET and PUT on a path (R7). The SDK enforces `permissions.events` and warns on unknown names. `storage: true` is stored and exposes no SDK call (E14).
- **A-12 (adds)**: `useAppInfo()` returns `{name, version, permissions:{api, events}, active}` and no path. There is no SDK route to the app data directory. The config route is the replacement for `getAppConfig`/`setAppConfig`, and its PUT replaces the whole object.
- **R6**: `/api/crons` gives run state (`last_run_ts`, `last_status`, `is_running`, `consecutive_failures`, `next_run_ts`) but no output for a script cron.
- **ctx**: `notify` reaches the notification feed and the socket, not the Schedule page or `/api/crons`. `crew_log_append` is refused for an app cron.

## R3b: can the cron put its result into the config the page reads? (added 2026-11-07, 17:26Z to 17:29Z; task 6.2)

Setup: `probe_cron.py` got an optional control-file key `spikeLastRun` (true). In wait mode, after `probe.mjs` exits, the launcher reads `data\_index.json` (newest run), reads `data\config.json`, adds `spikeLastRun: {reportId, counter, finishedAt}`, keeps every other key, and writes it back as UTF-8 without a BOM through `data\config.json.tmp` and `os.replace`. The control file in the installed copy was rewritten without a BOM with `"spikeLastRun": true`. Pushed with Sync (E26). A hand check of the function against a throwaway folder kept `spikeCounter` and a nested key and wrote no BOM. The job was paused, so its Run button was disabled; the run was started with `POST /api/crons/a471b9f5/run`, the route the button uses (200, `trigger: manual` in cron-history).

Results:
- **The cron's write reaches the page's route.** After the run of 17:27:53Z, `GET /api/apps/crew-spike/config` answered `{"spikeCounter":18,"probeExtra":"seed","spikeLastRun":{"reportId":"r0026-20261107T172753Z","counter":26,"finishedAt":"2026-11-07T17:28:07.852Z"}}`. The route reads the file at request time; the other keys survived. It took 17 s from the Run to the key appearing (the probe's own run time).
- **Refresh shows it without a reload.** With the page already loaded (its R3 showed `{"spikeCounter":17}`), the Refresh button made R3 show the full object including `spikeLastRun` (counter 26). No reload, no `?t=`.
- **A PUT from the page drops it.** In the same Refresh, R7 read the config (with `spikeLastRun`), sent `{"spikeCounter":19}`, and the route answered `{"ok":true}`; the GET after and `data\config.json` hold `{"spikeCounter":19}`. `spikeLastRun` and `probeExtra` are gone, which confirms PUT replaces the whole object (as in R7 above). The two writers can also race: the launcher reads and rewrites the file, a page PUT in between would lose one of the edits. Nothing was done to test that.
- **Page order caveat.** On first load the route list appears to have run twice in a row (inferred from R7's counter going 16 to 18 and the first load's R3 lacking the key), so the first load's R3 had already lost the key to the first R7. The clean reading is the Refresh one above.
- **Size limit.** The docs read for `CREW_NOTES.md` list no size limit for the config; none was tested.
- Reading: a results route exists that needs no `.mjs`, survives Sync (the config is in `data\`, which Sync keeps) and needs no event. The real app should have only the cron write it, the page never PUT it (or PUT only via read-merge-write), and keep the payload to a pointer such as the latest run id and counter.
