# E37: the first replay run on the installed app (packaging task 12)

date: 2026-11-08. Crew 0.12.0. Paths use ~ and %LOCALAPPDATA%.

## Before
- `%LOCALAPPDATA%\grimsheet-playtester` (a checkout and a hunt folder left by earlier smoke runs; the checkout HEAD was 6372d9a) was renamed to `grimsheet-playtester.dev`. It was kept, nothing was deleted. The installed `data\` held only config.json; no lock files; 12:44 in Los Angeles, 860 minutes before the next scheduled run.

## The run (user pressed Run on the Schedule page, List tab)
- Executions row: status OK; job grimsheet-playtester/replay; 11/8/2026 12:45:00 PM; duration 9.1 s; trigger manual; summary empty.
- Detail: run_id 71c7f96dee1e; job_id 1077d4cf; started_at 1794170700.9070275; finished_at 1794170709.9848802 (epoch seconds with fractions); duration_ms 9074; status success; summary ""; trace ""; error "".
- `%LOCALAPPDATA%\grimsheet-playtester\grimsheet` was created at 12:45:02 local during the run with node_modules and dist-play; HEAD bea7a52. The run cloned, ran `npm ci` and built from scratch; the npm cache was warm.

## After (read only)
- data\ entries: launcher\, runs\, config.json, _index.json. No .run.lock, .hunt.lock or .results.lock.
- launcher\last-child.log: {"runId":"run-000001","state":"complete","commit":"bea7a5238a3e882de188d8e884d43ea5f26e58eb"}
- launcher\last-launch.json: startedAt 2026-11-08T20:45:01.892Z; finishedAt 2026-11-08T20:45:09.905Z; exitCode 0; outcome child-exited; controlFile missing; controlFileCause null; childLog ok; repoUrl https://github.com/UBayouski/Grimsheet; branch main.
- runs\run-000001.json (1669 bytes): state complete; counter 1; commit bea7a5238a3e882de188d8e884d43ea5f26e58eb; resultsKey ok; green 5, amber 0, red 0, error 0; startedAt 2026-11-08T20:45:01.960Z; finishedAt 2026-11-08T20:45:09.742Z. Levels: 01-the-corridor green ink 0/0 endHp 3; 02-the-chaser green 1/1 endHp 3; 03-the-locked-crypt green 2/2 endHp 3; 04-the-trap-row green 1/1 endHp 5; 05-the-lich green 2/2 endHp 5; all won.
- _index.json: schemaVersion 1; lastCounter 1; one run (run-000001, complete, 5 green).

## The page after Refresh (user report)
- Last replay: run-000001, State complete, Commit bea7a52, Time 2026-11-08 20:45 UTC. Replay job: Last run 2026-11-08 20:45 UTC, Last status ok, Next run 2026-11-09 11:00 UTC, 0 consecutive failures.
- Five cards, all "Green: intended solution holds" and "won", with ink and end HP as above; each has one green trend square and "Last 1 run: 1 green (oldest to newest)". Runs table: run-000001, 5 green, 0 amber, 0 red, 0 not judged. Findings: the bounded-search sentence and "No hunt has run yet". End HP shows on every card, so replay-runner task 16.1 works end to end.
- No copy buttons on this page. Headings render at body-text size and weight.
