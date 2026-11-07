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
- How a skill declared in `app.json` maps into an app agent's `skill://` glob (the namespaced install path): not documented.

## Skills
- A folder with a required `SKILL.md` (YAML frontmatter plus Markdown body); optional `scripts/`, `references/`, `assets/`. In an app: `skills/<skill-name>/SKILL.md`.
- Frontmatter fields: `name`, `description`, `always`, `triggers`, `inject_on_trigger`, `repo_scope`, `app`. None is required.
- `license` and `metadata` (present in the play-level skill) are not listed by the docs; whether they are accepted or ignored: not documented.
- Reusing the `grimsheet-playtest` play-level skill as is: not documented as safe. It assumes the Grimsheet repo root as working directory, so rewrite it for a checkout in the app data directory.

## Crons
- Schedule: `every` (seconds) or `cron_expr` (5-field), mutually exclusive. Optional `timezone` (IANA; falls back to gateway zone, then UTC), `skip_dates` (`YYYY-MM-DD`), `strict_schedule` (otherwise a random start delay, up to 59 min on a daily job).
- Other fields: `name`, `message`, `agent`, `agent_sequence`, `command`, `script`, `env`, `persistent_session` (default true), `silent` (default false), `timeout`, `timeout_secs`, `enabled`, `folder`.
- A run is an agent run (`message`), a `command` (shell, no model call, default 300s timeout) or a `script` (Python `file.py:function`, default 30s timeout).
- Where output of an app cron goes in the dashboard: not documented beyond the Schedule page listing the job.
- Pointing a cron at a specific git branch: not documented; the run must fetch it itself.

## Run environment
- Windows shell behaviour: not documented. (Linux: user-namespace sandbox, fails closed unless `agent.sandbox_allow_unsandboxed_exec` is set.)
- Node on the agent path: not guaranteed. The official Docker image has git, curl, ripgrep, unzip, Python, kiro-cli and no `node` or `npm`.
- `permissions.network` is stored and shown at install with no runtime gate (sandbox RFC page). Actual agent network policy: not documented.
- Cloning a public GitHub repo from a run: not documented.
- Writable locations: the SDK exposes an app-scoped data directory (`getAppDataDir()`). Others: not documented.
- App code runs in the gateway with the same privileges as Kiro Crew; third-party apps are denied until trusted.

## CLI
`kirocrew app init <name>`, `kirocrew app install /absolute/path/to/app`, `kirocrew app enable <name>`, `kirocrew app info <name>`, `kirocrew app dev <name>`, `kirocrew token`. Direct `kirocrew app install <git-url>`: not documented; fallback is `git clone`, build `ui/`, then local install. Third-party apps must be trusted before enable (Settings, Security, Third-party apps).
