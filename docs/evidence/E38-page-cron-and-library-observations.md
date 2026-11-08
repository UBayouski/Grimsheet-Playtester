# E38: the page, the Library and the crons route on the installed app (packaging task 11)

date: 2026-11-08. Crew 0.12.0. No screenshot is kept in the repo (the Schedule page shows a full script path); the user holds two screenshots without a user name or path for the README.

## Library and Details (user report)
- Enabled; "UBayouski · v1.0.0"; "Source Unknown"; Author UBayouski; Installed 11/8/2026; "Origin: Registry | Resources: Gateway | Lifecycle: Gateway"; buttons Disable, Sync, Uninstall; the description text of app.json. The app icon there and in the sidebar is a default cube; the manifest icon `Ghost` did not render.
- Resources card: playtester (agent), play-level, find-exploits (skills), replay (cron). Permissions card: API ACCESS /api/apps/grimsheet-playtester/config and /api/crons; "Cron: yes".

## The page before any run (user report)
- Renders from the default export of dist/index.mjs; the manifest has no mountFunction and no entryPoint. Text: "No results yet. The nightly replay has not written any results." Replay job card: "Last run: time unknown", "Next run: 2026-11-09 11:00 UTC", "0 consecutive failures", plus "Results read at" and "Job state read at" lines.
- `(await import('/vendor/react.mjs')).version` in the page console printed 18.3.1. The host serves React through shims at /vendor/react.mjs and /vendor/react-jsx-runtime.mjs.
- Response headers on host files include Permissions-Policy: clipboard-write=(self), clipboard-read=(self).

## Schedule page, List tab (user report)
- One row: ID starting 1077d; name "grimsheet-playtest..." (truncated); "No owning session"; type "script · python"; schedule "3:00 AM America/Los Angeles"; status Ready; last run "-"; next run "in 14h"; actions Run and Delete.

## node scripts/packaging/read-route.mjs crons, before the first run (run by the user; query form of the token; status 200)
{"route":"/api/crons","status":200,"summary":{"jobs":[{"name":"grimsheet-playtester/replay","enabled":true,"user_paused":false,"is_running":false,"last_status":null,"consecutive_failures":0,"last_run_ts":{"value":null,"type":"null","format":"none"},"next_run_ts":{"value":1794222000,"type":"number","format":"epoch-seconds"}}],"replayJobFound":true,"replayJobCount":1}}

## The same read after the first run (run by the user; query form of the token; status 200)
{"route":"/api/crons","status":200,"summary":{"jobs":[{"name":"grimsheet-playtester/replay","enabled":true,"user_paused":false,"is_running":false,"last_status":"ok","consecutive_failures":0,"last_run_ts":{"value":1794170709.9848802,"type":"number","format":"epoch-seconds"},"next_run_ts":{"value":1794222000,"type":"number","format":"epoch-seconds"}}],"replayJobFound":true,"replayJobCount":1}}

- After a run, `last_run_ts` is epoch seconds with a fraction. It equals the `finished_at` of the Executions detail in E37 (1794170709.9848802), so it marks the end of the run, not the start. `last_status` is "ok". Q6 is closed.
