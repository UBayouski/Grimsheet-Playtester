# E34 - Hunt checks: removal of the throwaway app (13.10) (2026-11-07)

Done after the developer's approval ("delete A only, leave B as it is"). Windows user name and home path are written as `~` and `%LOCALAPPDATA%`.

## Before
- A baseline of directory entry names (names only) was taken of `~\.kiro\agents` (20 entries), `~\.kiro\crew\skills` (43), `~\.kiro\crew\apps` (28) and `~\.kiro\crew\cron-history` (3 files), plus the number of files in `~\.kiro\crew\sessions` (420) and of folders in `~\.kiro\crew\crew-log\sessions` (19), to check afterwards that nothing outside the hunt-checks entries changed.
- Reparse points (junctions, symlinks): none inside the three folders to be deleted. The skill junction was `~\.kiro\crew\skills\hunt-checks\probe-skill` (inside a normal folder `skills\hunt-checks`), pointing at `~\.kiro\crew\apps\hunt-checks\skills\probe-skill`. The rule for it: remove only the link itself (`cmd /c rmdir <path>` without `/s`, or `(Get-Item <path>).Delete()`), never `Remove-Item -Recurse` on a junction. It turned out not to be needed (below).

## Commands and results
1. `& "C:\Program Files\KiroCrew\resources\backend-dist\kirocrew-backend\bin\kirocrew.cmd" app uninstall hunt-checks` - exit 0. Output: "removed 1 cron job(s) from scheduler", "uninstalled hunt-checks", and the same warning as at the first uninstall: conversation pointers are left in place because a running gateway owns `session_map.json`; reinstalling under this name may resume the removed app's transcript.
2. `kirocrew app info hunt-checks` - "App 'hunt-checks' is not installed."
3. Checked straight after the uninstall: the three generated agent files `~\.kiro\agents\hunt-checks--*.json`, the folder `~\.kiro\crew\skills\hunt-checks` with its junction, and `~\.kiro\crew\apps\hunt-checks` (14 files) were still there. Checked again 6 seconds later: **the agent files and the skills folder with its junction were gone** (the gateway's cleanup is asynchronous; the junction needed no removal by hand), and `~\.kiro\crew\apps\hunt-checks` held only 1 file (`data\`).
4. Deleted by the assistant, each after a leaf-name check (`hunt-checks`), a reparse-point scan (none) and `attrib -r`:
   - `~\.kiro\crew\apps\hunt-checks` (1 file), then `Remove-Item -LiteralPath <path> -Recurse -Force`; exists afterwards: no.
   - `D:\Projects\Kiroween\hunt-checks` (9 files); exists afterwards: no.
   - `%LOCALAPPDATA%\hunt-checks` (1 file, `argv-log.jsonl`); exists afterwards: no.
   - `~\.kiro\crew\cron-history\8f9e2de5.jsonl` (`Remove-Item -LiteralPath`); exists afterwards: no.
5. The security log shows the gateway's own steps at 02:32:15Z: `app_crons_deregister` (app hunt-checks, removed 1), `deregister_skills` (app hunt-checks, skills `['probe-skill']`) and `app_trust_revoke` ("grant removed on uninstall"; a reinstall needs trust again).

## Check that nothing else changed
- `~\.kiro\agents`: 20 -> 17 entries, the difference is exactly the three `hunt-checks--*` files; no other difference.
- `~\.kiro\crew\apps`: 28 -> 27, the difference is exactly `hunt-checks`.
- `~\.kiro\crew\cron-history`: 3 -> 2 files, the difference is exactly `8f9e2de5.jsonl` (`_index.jsonl` and one other file are unchanged).
- `~\.kiro\crew\sessions`: 420 -> 420 files; `~\.kiro\crew\crew-log\sessions`: 19 -> 19 folders.
- `~\.kiro\crew\skills`: 43 -> 41 entries: the expected `hunt-checks` folder, **and one more: a top-level entry named `probe-skill`**, which was in the baseline and is gone. The assistant deleted nothing there. The gateway's `deregister_skills` event for app hunt-checks with skills `['probe-skill']` at 02:32:15Z is the likely cause (its own cleanup of the skill this app registered), but the entry could not be inspected after it was gone, so whether it was only a copy or link of this app's skill is inferred, not seen.
- `app list` no longer contains `hunt-checks`.

## Left in place (list B, by the developer's decision)
Chat files `~\.kiro\crew\sessions\dashboard_chat-12-...`, `-14-...`, `-15-...jsonl` and `sessions\cron_8f9e2de5_60db2840.jsonl`; the matching `crew-log\sessions\sess_*` folders and `crew-log\members\checker-ask-*`; one line each in `cron-history\_index.jsonl` and `notifications.jsonl`; token-usage lines in `usage\tokens`; the append-only security log; the conversation pointers in `session_map.json`; and one dismissable notification card.