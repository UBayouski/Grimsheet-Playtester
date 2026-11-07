# E22 and E23: where a cron run's output appears (task 5.4, Requirement 3.8)

date: 2026-11-07, about 10:47Z. Same Playwright session. The screenshots show no token, no address bar and no local path.

## E22-schedule-script-cron.png (Schedule)

Correction (2026-11-07, when the evidence was curated): this file shows the Executions table (the same rows as E23, with fewer details) captured while the List tab was still highlighted. It does not show the job row. The job row (ID a471b9f5, "No owning session", "script · python", "every 24h", the script path, a Ready status, Run and Delete buttons) was read from the page text and is described in E20.

## E23-schedule-executions.png (Schedule, Executions)

In words: a table with columns STATUS, JOB NAME, TIMESTAMP, DURATION, TRIGGER, SUMMARY, and five rows for `crew-spike/probe`, all with trigger "manual", newest first:
- OK, 2:46:32 AM, 13.6 s, —
- Error, 2:44:17 AM, 5.9 s, "Script timed out after 5s"
- OK, 2:42:39 AM, 59.8 s, —
- Error, 2:39:38 AM, 31.1 s, "Script timed out after 30s"
- OK, 2:36:00 AM, 13.9 s, —

Each summary has an expander (›). Clicking the error row's summary opened no dialog.

## Backing file

`~\.kiro\crew\cron-history\a471b9f5.jsonl` holds one JSON line per run: `run_id`, `job_id`, `trigger`, `started_at`, `finished_at` (epoch seconds), `duration_ms`, `status` (`success` | `failure`), `summary`, `trace`, `error`. An index line per run is in `~\.kiro\crew\cron-history\_index.jsonl`.

## Readings

- Requirement 3.8: a cron run's output is shown on the Schedule page, **Executions** tab, one row per run, backed by `~\.kiro\crew\cron-history\<job id>.jsonl`. For a script cron only the status, duration, trigger and an error summary are shown. The script's stdout (the launcher's summary line) is not shown; `summary` is empty on success.
- So the replay job cannot rely on cron output for its results. It must write its own result files, as planned. Writing a summary through `ctx` (`notify`, `crew_log_append`) is a lead, not tested.
- Task 5.4 fetch check: r0014 `clone-or-update` used `mode: fetch-reset` in 556 ms, same commit 6372d9a27ae81a6ab75e9f8ae45d1d70ccebe50b (Requirement 4.7). See E21 run 4.
- Also seen: the manual run API is `POST /api/crons/{id}/run`, and the job id is `a471b9f5`. This is a lead for UI round 2 (R6): `/api/crons` and `/api/crons/*` are in the P0 list.
