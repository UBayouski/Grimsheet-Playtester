# E30 - Hunt checks: throwaway app setup and install (2026-11-07)

Throwaway Crew app `hunt-checks` v0.0.1, built outside every repo (folder `D:\Projects\Kiroween\hunt-checks`, removed at the end of the checks; removal is recorded in E34).
Crew 0.12.0 (`kirocrew --version` printed `kirocrew 0.12.0`), run by full path (the CLI is bundled with the desktop app and not on PATH).

## App content (as installed)
- `app.json`: name `hunt-checks`, version 0.0.1, `permissions: {"cron": true}`, no `ui`, two agents, one skill, one cron.
- `agents/checker-ask.json`: `tools: ["execute_bash"]`, no `allowedTools`, `resources: ["skill://~/.kiro/crew/apps/hunt-checks/skills/*/SKILL.md"]`.
- `agents/checker-open.json`: the same plus `allowedTools: ["execute_bash"]`.
- `skills/probe-skill/` with `SKILL.md` (name, description, license MIT, metadata), `scripts/argv.mjs`, `scripts/import-probe.mjs`, `references/commands.md`.
- `scripts/shared.mjs`: one exported constant.
- Cron `c2`: message "Load probe-skill and run argv.mjs once with the argument hello.", `agent: checker-open`, `cron_expr: 0 0 29 2 *` (29 February, will not fire by itself before 2028), `timezone: America/Los_Angeles`, `strict_schedule: true`, `enabled: true`, `persistent_session: false`, `silent: false`, `timeout: 300`, `timeout_secs: 305`.
- Addition to the two scripts beyond the prompt: each appends its raw argument list (or import result) as one JSON line to `%LOCALAPPDATA%\hunt-checks\argv-log.jsonl`, outside the app folder, so that what reaches Node does not depend on the agent copying output. stdout and the exit code are unchanged. Local smoke test (outside the agent): `argv.mjs hello "a b"` printed `["hello","a b"]`, exit 0; `import-probe.mjs` printed `{"ok":true,"exports":{"SHARED_CONSTANT":"hunt-checks-shared-7421"},"error":null}`, exit 0; the smoke-test log lines were deleted before the checks.

## Install
Command: `& "C:\Program Files\KiroCrew\resources\backend-dist\kirocrew-backend\bin\kirocrew.cmd" app install D:\Projects\Kiroween\hunt-checks`
Output (exit code 0):
```
installed hunt-checks v0.0.1
WARNING kiro_crew.apps.bridges: App hunt-checks:
   registration blocked by execution policy: third-party app execution is disabled; trust this app alone from the dashboard's App Store, whose install, update and enable prompts ask for it (agent.apps_trusted), or set agent.apps_allow_third_party=true to allow every third-party app's Python, backend, and manifest shell code
   Run: kirocrew app enable hunt-checks
skipping executable resource registration (resource_register): third-party app execution is disabled
```
Same behaviour as the crew-spike (h.1): the app installs, but agents, skills and the cron are not registered until the app is trusted. Trust and enable are done by the developer in the dashboard (Settings, Security, Third-party apps). No token or dashboard URL was used or recorded.
## Change before trust: case C3-f, uninstall and reinstall
- Added case C3-f to `skills/probe-skill/references/commands.md`: an unquoted space-separated list in which the edit value is fully percent-encoded: `node <SKILL_FOLDER>/scripts/argv.mjs --actions N edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29 E`. It is recorded like the other C3 cases (what reaches Node).
- The app was not yet trusted, so it was uninstalled and installed again: `kirocrew app uninstall hunt-checks` printed "uninstalled hunt-checks" (exit 0) with a warning that the conversation pointers are left in place while a gateway runs and that reinstalling under this name may resume the removed app's transcript (nothing had run, so there is none). The app folder `~\.kiro\crew\apps\hunt-checks` was left behind holding only `data\` (same as h.1).
- `kirocrew app install D:\Projects\Kiroween\hunt-checks` again: warning "Removing orphaned partial install at ~\.kiro\crew\apps\hunt-checks" (the leftover folder), then "installed hunt-checks v0.0.1" and the same trust warning as above.
- Check: the installed `skills\probe-skill\references\commands.md` has the C3-f case and its SHA-256 equals the source file's. `kirocrew app info hunt-checks` shows `enabled: false`, source `D:\Projects\Kiroween\hunt-checks`, `resources: gateway`, and the manifest with both agents and the skill.

## Files to remove at the end of the checks (13.10)
1. The installed app (`kirocrew app uninstall hunt-checks`), its leftover folder `~\.kiro\crew\apps\hunt-checks` (holds `data\`), the job's file in `~\.kiro\crew\cron-history\` and the generated agent files `~\.kiro\agents\hunt-checks--*.json`, if any.
2. The source folder `D:\Projects\Kiroween\hunt-checks`.
3. `%LOCALAPPDATA%\hunt-checks` (holds `argv-log.jsonl`).

## Redaction note
`import-probe.mjs` logs `here`, `realHere` and `cwd`, which contain the Windows user name. In every evidence file these are written with `~` or `%USERPROFILE%` in place of the user name and home path.
## After trust and enable (checked by the assistant, read only)
- `kirocrew app info hunt-checks`: `enabled: true`, `resources: gateway`; manifest cron `c2` has `agent: checker-open`, `cron_expr: 0 0 29 2 *`, `timezone: America/Los_Angeles`, `timeout: 300`, `timeout_secs: 305`, `strict_schedule: true`, `persistent_session: false`. The gateway accepted `agent: checker-open` at registration with no warning (this is registration only; whether the run uses that agent is C2).
- `kirocrew cron list` (filtered to this app) shows one job `hunt-checks/c2` (8-hex id `8f9e2de5`), "At 12:00 AM PST, on day 29 of the month, only in February", owner none, created by `app:hunt-checks`. The list has `trigger` to run a job immediately; the dashboard Schedule page also has Run.
- Generated agent files: `~\.kiro\agents\hunt-checks--checker-ask.json` and `~\.kiro\agents\hunt-checks--checker-open.json`.
- The skill is registered as a junction `~\.kiro\crew\skills\hunt-checks\probe-skill` (Directory, ReparsePoint, LinkType Junction), as in h.6.