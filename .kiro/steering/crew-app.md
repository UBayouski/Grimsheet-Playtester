---
inclusion: fileMatch
fileMatchPattern: ["app.json", "agents/**", "skills/**"]
---

# Kiro Crew app rules

Source: `docs/CREW_NOTES.md` (Context7 library `/kirodotdev/kirocrew`). "Not documented" means exactly that: do not fill the gap from memory; record it as an open question or test it in the spike.

## app.json manifest
- Required: `displayName`. `version` must be a semver string (used for `updateAvailable`). Examples also always carry `name`, `description`, `author`. A formal required/optional table: not documented.
- Other fields seen: `tags`, `iconPath`, `agents`, `skills`, `crons`, `permissions`, `ui`, `setup`, `sops`, `mcpServers`. Omit `resources`.
- `agents`: array of file paths, e.g. `["agents/sample-agent.json"]`.
- `skills`: array of string paths to skill directories, e.g. `["skills/my-skill"]` (legacy object entries are normalized).
- `crons`: array. A manifest with crons must also set `"cron": true` in `permissions`.
- `ui`: `{"entry": "dist/index.mjs", "pages": [{"route": "/apps/<name>", "label": "...", "icon" or "iconUrl"}]}`, optional `sidebar`. `entry` is relative to `ui/`.
- `permissions` must be an object (a non-object parses to empty). Keys: `api`, `events`, `mcpTools`, `storage`, `network`, `memory`, `cron`, `sessionApproval`, `spawn`, `jobs`, `exposeToApps`.
- `setup`: `onInstall`, `onUninstall`, `onEnable`, `onDisable`. Local installs skip `setup.onInstall`.

## Agents
- JSON file with `name`, `description`, `tools`, `allowedTools`, `resources`, `prompt`, `model`. Examples place it at `agents/<name>.json`.
- Skills reach an agent through a `skill://<glob>` entry in `resources`, e.g. `"skill://.kiro/skills/*/SKILL.md"`. An agent with no `skill://` mapping gets no skill catalog.
- How a skill declared in `app.json` maps into an app agent's `skill://` glob (the namespaced install path): not documented. → answered in section h.6 (observed 2026-11-07)

## Skills
- A folder with a required `SKILL.md` (YAML frontmatter plus Markdown body); optional `scripts/`, `references/`, `assets/`. In an app: `skills/<skill-name>/SKILL.md`.
- Frontmatter fields: `name`, `description`, `always`, `triggers`, `inject_on_trigger`, `repo_scope`, `app`. None is required.
- `license` and `metadata` (present in the play-level skill) are not listed by the docs; whether they are accepted or ignored: not documented. → answered in section h.6 (observed 2026-11-07)
- Reusing the `grimsheet-playtest` play-level skill as is: not documented as safe. It assumes the Grimsheet repo root as working directory, so rewrite it for a checkout in the app data directory.

## Crons
- Schedule: `every` (seconds) or `cron_expr` (5-field), mutually exclusive. Optional `timezone` (IANA; falls back to gateway zone, then UTC), `skip_dates` (`YYYY-MM-DD`), `strict_schedule` (otherwise a random start delay, up to 59 min on a daily job).
- Other fields: `name`, `message`, `agent`, `agent_sequence`, `command`, `script`, `env`, `persistent_session` (default true), `silent` (default false), `timeout`, `timeout_secs`, `enabled`, `folder`.
- A run is an agent run (`message`), a `command` (shell, no model call, default 300s timeout) or a `script` (Python `file.py:function`, default 30s timeout).
- Where output of an app cron goes in the dashboard: not documented beyond the Schedule page listing the job. → answered in section h.7 (observed 2026-11-07)
- Pointing a cron at a specific git branch: not documented; the run must fetch it itself. → answered in section h.4 (observed 2026-11-07)

## Run environment
- Windows shell behaviour: not documented. → answered in sections h.4 and h.5 (observed 2026-11-07) (Linux: user-namespace sandbox, fails closed unless `agent.sandbox_allow_unsandboxed_exec` is set.)
- Node on the agent path: not guaranteed. The official Docker image has git, curl, ripgrep, unzip, Python, kiro-cli and no `node` or `npm`. → answered in sections h.4 and h.5 (observed 2026-11-07)
- `permissions.network` is stored and shown at install with no runtime gate (sandbox RFC page). Actual agent network policy: not documented. → answered in sections h.4 and h.5 (observed 2026-11-07)
- Cloning a public GitHub repo from a run: not documented. → answered in sections h.4 and h.5 (observed 2026-11-07)
- Writable locations: the SDK exposes an app-scoped data directory (`getAppDataDir()`). Others: not documented. → answered in sections h.3, h.4 and h.5 (observed 2026-11-07)
- App code runs in the gateway with the same privileges as Kiro Crew; third-party apps are denied until trusted.

## CLI
`kirocrew app init <name>`, `kirocrew app install /absolute/path/to/app`, `kirocrew app enable <name>`, `kirocrew app info <name>`, `kirocrew app dev <name>`, `kirocrew token`. Direct `kirocrew app install <git-url>`: not documented; fallback is `git clone`, build `ui/`, then local install. Third-party apps must be trusted before enable (Settings, Security, Third-party apps).

## Decisions from the spike (Windows, Crew 0.12.0; sections h.1 to h.8)
Only Windows was tested. Nothing was checked on macOS, Linux or WSL; the README says so.

### Crons
- A `command` cron is rejected on a Windows gateway at registration (E18). Use a Python `script` cron (`"script": "scripts/<name>.py:run"`, standard library only) that starts Node with `subprocess`. It runs as a child of the gateway; the dashboard stays responsive (E20).
- The script's working folder is the KiroCrew install folder, so the launcher finds its files relative to `__file__`. The manifest `env` does not reach the script (E20), so settings (repo URL, branch, mode) come from a control file under `data\launcher\`. Write that file without a BOM (a BOM made the launcher ignore it, E24).
- Set `timeout` (seconds, default 30) high enough for clone, `npm ci`, `build:play` and every replay; `timeout_secs` is a wake budget and must be at least `timeout + 5` or a Sync is refused (E21). On a timeout the runner kills the launcher and its Node child, so write the report atomically and mark an older `running` report `cut-short` on the next run.
- The Grimsheet clone lives outside the app folder, in a per-user local folder (`%LOCALAPPDATA%\<app>`), never in `data\`: the install drops `.git` and `node_modules`, and a Sync moves `data\`, which failed twice on a run's read-only git pack files (E17, E25, E27).
- Do not Sync while a run is active or while `~\.kiro\crew\apps\.<app>-data-tmp` exists (E26, E27).
- Pause with `enabled: false` plus a Sync, or `POST /api/crons/<id>/enable {"enabled": false}`. A paused job's Run button is disabled; `POST /api/crons/<id>/run` still starts it. A changed manifest `env` is not applied to an existing job until the app is disabled and enabled.
- Watch item: the gateway logs "node is on PATH at C:\Program Files\nodejs\node.EXE but does not resolve under the trusted system directories (C:\WINDOWS\system32, C:\WINDOWS\system32\WindowsPowerShell\v1.0), so it is treated as unavailable; OS introspection that needs it degrades ..." (same for `npm` and `git`, E28). The commands still ran. Re-check after a Crew update.

### Agents and skills
- Declare `"tools": ["execute_bash"]`. With no `tools` list nothing is mounted (gateway log "declares no usable 'tools' list ... no tool access", E29). Do not set `allowedTools`: every shell command and the skill load then asks for an approval, about 3 to 12 per run, and the user must be told so.
- Skills: `"resources": ["skill://~/.kiro/crew/apps/<app>/skills/*/SKILL.md"]`. Project-relative globs (`skill://.kiro/skills/*/SKILL.md`) are not loaded on Windows; absolute and `~` globs are (E29, A2, A3, A5). Add no user name to any committed file.
- An agent edit reaches the installed copy and `~\.kiro\agents` with a Sync; no reinstall is needed (E29).
- The agent's shell is Windows PowerShell 5.1 and git's stderr progress text shows as `NativeCommandError` while the exit code is 0 (E28). Skills must follow the shell-agnostic rules in `tech.md`.

## Evidence ids
Evidence ids (E01 to E29) refer to `docs/evidence/INDEX.md`; the files are in `docs/evidence/`.
