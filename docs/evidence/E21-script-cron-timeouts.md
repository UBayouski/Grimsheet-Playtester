# E21: script cron timeout behaviour (task 5.3)

date: 2026-11-07. Crew 0.12.0, job `a471b9f5`. Every change was pushed with the dashboard Sync (Details page). Runs were started with the Schedule page Run button. Paths use ~.

The launcher reads an optional `data\launcher\control.json` (`holdSecs`, `mode`), because the manifest `env` does not reach a script cron (E20). The hold makes the launcher sleep after `probe.mjs` exits, so a run can outlast a limit without changing `probe.mjs`. The control file was written into the installed data folder for the hold runs, then removed.

## Runs

| # | Manifest | Hold | Result (cron-history) | Launcher record | Probe report |
|---|---|---|---|---|---|
| 1 | `timeout_secs: 900`, no `timeout` | 45 s | failure, "Script timed out after 30s", 31.1 s | 10:39:39Z-66672: last write at 28.8 s, held 11/45 s, no `finishedAt`, process gone | r0011 complete (the probe finished before the hold) |
| 2 | `timeout: 120`, `timeout_secs: 900` | 45 s | success, 59.8 s | 10:42:40Z-69168: held 45/45 s, `child-exited`, 58.5 s | r0012 complete |
| 3 | `timeout: 5`, `timeout_secs: 900` | none | failure, "Script timed out after 5s", 5.9 s | 10:44:18Z-68184: no `finishedAt`; launcher and node child (pid 67028) both gone | r0013 left `running` after 8 steps (cut in npm-ci) |
| 4 | `timeout: 900`, `timeout_secs: 960` | none | success, 13.6 s | 10:46:33Z-52716: `child-exited`, 12.5 s | r0014 complete; r0013 now `cut-short`, `inferredBy: next-run` |

Gateway log for run 1: `ERROR kiro_crew.slack.gateway: Script cron 'crew-spike/probe' failed: Script timed out after 30s`. The security log shows `...probe_cron.py:run error Script timed out after 30s` and `cron_run_failure_alert alerted`, so a failed run raises a user alert.

Sync refused one restore attempt (`timeout: 900`, `timeout_secs: 900`) at 10:45:22Z: `app_update failed` with the error:

> cron entry 'probe': timeout_secs (wake budget) must cover the command/script subprocess timeout plus cleanup: need >= 905, got 900. A shorter wake budget cancels only the executor future — the subprocess keeps running while the next wake launches a duplicate.

The installed copy kept the previous values (`timeout: 5`) until a valid Sync. Also seen: each by-hand run fires six `cron_fire_time_vet` allowed events.

## Readings

- **A-25 refuted:** `timeout_secs` does **not** raise the 30 s default for a script cron. With `timeout_secs: 900` and no `timeout`, the run was killed at 30 s.
- **The script subprocess limit is `timeout`** (seconds). `timeout: 120` let a 58.5 s run finish; `timeout: 5` killed a run at 5 s.
- **`timeout_secs` is the wake budget.** It must be at least `timeout + 5`, or Sync fails and keeps the old values.
- **A-05 (re-scoped to the script cron):** the limit is honoured in seconds, from `timeout`, not `timeout_secs`. The gateway does not pass it to the script: `SPIKE_TIMEOUT_SECS` from `env` does not arrive, and nothing else carries it.
- On timeout the runner kills the launcher **and its child tree** (node was gone too), so wait mode cannot outlive the limit. The probe report stays `running` and the next run marks it `cut-short` (Requirement 4.6, 4.8 shown).
- Detached mode (task 5.2) was not run through the gateway. The hand check showed the child survives the launcher's exit with breakaway allowed. Under the runner's kill, whether a detached child survives was not tested, because it was not needed once `timeout` was found.
- Current installed values: `timeout: 900`, `timeout_secs: 960`, `every: 86400`, `enabled: true`.
- For the replay job: a script cron needs `timeout` sized for clone plus `npm ci` plus build plus play, and `timeout_secs` at least `timeout + 5`.
