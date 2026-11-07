# E18: why the `probe` cron is missing from the Schedule page

date: 2026-11-07, 10:16Z to 10:24Z. Crew 0.12.0 (KiroCrew desktop app, gateway on 127.0.0.1:5476), Windows 11 Pro 10.0.26300.
Playwright MCP on a 30-minute token (not recorded). Paths under the user profile use ~. Gateway log lines are quoted with the user path replaced by ~.

## Checked in the order asked

### 1. Does the dashboard list app crons anywhere else?

- Schedule page (`/schedule`), tabs List and Executions: "No scheduled jobs yet". No mention of crew-spike, Crew Spike or probe, after the dashboard trust and enable at 10:16:52Z.
- Library → Crew Spike → "More actions" menu: Details, Unpin, Sync, Disable, Uninstall.
- App Details page (`/apps/detail/crew-spike`, screenshot E18-app-details.png). In words: the header reads "Crew Spike, Enabled, Grimsheet Playtester · v0.0.1, Source Unknown", with buttons Disable, Sync ("Sync app from its source directory") and Uninstall, then the description. "Permissions" lists Storage: yes, Cron: yes. "Resources" lists probe-agent, probe-skill and probe. "Details" shows the author, the install date and "Origin: Registry | Resources: Gateway | Lifecycle: Gateway". The cron is listed by name only, with no schedule, status or run control.
- Earlier finding corrected: the dashboard does have an update-in-place for a local app. It is the **Sync** button (Library menu or Details page), not "Update".

### 2. What app info and the installed files say

- `kirocrew app info crew-spike` → `manifest.crons[0]`: name probe, every 120, command `node scripts/probe.mjs --trigger cron`, env SPIKE_TIMEOUT_SECS 900, timeout_secs 900, persistent_session false, enabled false (`silent: false` dropped).
- Installed `app.json`: the same, with `silent: false` kept.
- The host writes `~\.kiro\crew\apps\crew-spike\app-crons.json` with the cron normalised: name `crew-spike/probe`, `app: crew-spike`, every 120, command as above, `cron_expr`, `agent`, `message`, `script`, `folder` empty, `timeout: 0`, `timeout_secs: 900`, `strict_schedule: false`, `enabled: false`.

### 3. Does `enabled: false` hide it? (A-09)

- `spike/app.json` was changed to `enabled: true` and `every: 86400`, so it would not fire on its own. Pushed to the install with the dashboard **Sync** button at 10:21:43Z, so no uninstall or reinstall was needed, and the app stayed trusted and enabled.
- After the Sync, `app-crons.json` shows every 86400 and enabled true. The Schedule page still shows "No scheduled jobs yet". No run file appeared in `data\runs`; nextCounter is still 10.
- So `enabled: false` is **not** what hides it.

## Root cause (gateway log, ~\.kiro\crew\gateway.log)

The same warning appears at every enable or Sync (01:53:16, 02:03:15, 02:09:15, 02:16:52, 02:21:43, local time):

> App crew-spike: cron 'crew-spike/probe' command rejected: Error: No POSIX shell available to run this command cron. Command crons execute with `sh -c` under POSIX-sh semantics (what the storage-time vet gate assumes); Windows ships no such shell (Git for Windows's sh.exe is bash and would widen the language past the vet). Use a script cron or an LLM `message` cron on this platform, or run the gateway under POSIX.

The security event log (`security_events.jsonl`) has the same events at 10:21:43Z:
- `app_cron_command_vetted`, outcome **denied**, `app=crew-spike cron=crew-spike/probe`, error "No POSIX shell available ..."
- `app_crons_register`, outcome completed, `app=crew-spike crons=[]` (no cron registered)
- `app_update` completed (the Sync), plus `deregister_skills` / `register_skills` (`crew-spike/probe-skill`)

Present on this machine but not used by the gateway: `C:\WINDOWS\system32\bash.exe` (WSL launcher) and Git for Windows `sh.exe`.

## Readings

- **A command cron cannot run on a Windows gateway (Crew 0.12.0).** It is vetted and denied at registration, so it never reaches the scheduler or the Schedule page, whether it is enabled or not. This blocks task 5 as planned, and it bears on the real app's nightly replay, which the Brief specifies as a cron `command`.
- The host's own alternatives: a `script` cron (Python `file.py:function`; docs default timeout 30 s), an LLM `message` cron (costs credits; the product says replay makes no model call), or a gateway running under POSIX.
- A-09: `env` reaching the command, and a manual run with `enabled: false`, **cannot be tested** with a command cron on Windows. Partly answered: `enabled: false` does not hide a cron. A rejected cron is not listed at all.
- A-23 (a run can be started by hand from the Schedule page): not testable for a command cron here; nothing is listed to start.
- A-01, A-03, A-04, A-05: untested (no gateway run).
- Status left in place: the installed cron is `enabled: true`, every 86400, and stays rejected, so it cannot fire.
