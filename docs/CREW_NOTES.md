# Kiro Crew app notes

Researched 2026-11-07 with the Context7 power. Every answer below came from Context7, none from kiro.dev (kiro.dev was not needed and was not read).

Context7 libraries used:
- `/kirodotdev/kirocrew` (Kiro Crew, 33987 snippets). All answers below.
- `/websites/deepwiki_kirodotdev_kirocrew` was resolved for `@kirocrew/app-sdk` but not queried.

Source paths are in the `kirodotdev/kirocrew` GitHub repo, as returned by Context7.

## a. app.json manifest
Library `/kirodotdev/kirocrew`; pages `docs/app-kit/manifest-reference.md`, `skills/kirocrew-app-dev/SKILL.md`, `docs/app-kit/getting-started.md`.
- Required: `displayName` (gateway uses it for UI). `version` must be a semver string (used for `updateAvailable`). The docs' examples also always carry `name`, `description`, `author`. A formal required/optional table was not returned: "not documented" beyond this.
- Optional/other fields seen: `tags`, `iconPath`, `agents`, `skills`, `crons`, `permissions`, `ui`, `setup`, `sops`, `mcpServers`. Omit `resources`.
- Agents: `"agents": ["agents/sample-agent.json"]` (file paths).
- Skills: `"skills": ["skills/my-skill"]` (string paths to skill directories; legacy object entries are normalized).
- Crons: `crons` array (see d). A manifest with crons must also declare `"cron": true` in `permissions`.
- UI: `"ui": {"entry": "dist/index.mjs", "pages": [{"route": "/apps/<name>", "label": "...", "icon" or "iconUrl"}]}`, optional `sidebar`. `entry` is relative to `ui/`.
- `permissions` must be an object. Keys: `api`, `events`, `mcpTools`, `storage`, `network`, `memory`, `cron`, `sessionApproval`, `spawn`, `jobs`, `exposeToApps`. A non-object parses to empty.
- `setup`: `onInstall`, `onUninstall`, `onEnable`, `onDisable`.

## b. Agents
Library `/kirodotdev/kirocrew`; pages `docs/app-kit/getting-started.md`, `src/kiro_crew/docs/agents.md`, `docs/request-for-change/rfc-federated-app-platform.md`.
- Format: JSON file with `name`, `description`, `tools`, `allowedTools`, `resources`, `prompt`, `model`.
- Location in an app: any path listed in `app.json` `agents`; the examples use `agents/<name>.json` in the app root.
- Tie to skills: a `skill://<glob>` entry in the agent's `resources`, e.g. `"skill://.kiro/skills/*/SKILL.md"`. A custom agent with no `skill://` mapping gets no skill catalog (RFC page). How a skill declared in `app.json` is mapped into an app agent's `skill://` glob (the namespaced install path): not documented.

## c. Skills
Library `/kirodotdev/kirocrew`; pages `skills/README.md`, `src/kiro_crew/docs/skills.md`, `docs/reference/kiro-cli/skills.md`.
- Format: a folder with a required `SKILL.md` (YAML frontmatter plus Markdown body), optional `scripts/`, `references/`, `assets/`.
- Location in an app: `skills/<skill-name>/SKILL.md`, listed in `app.json` `skills`. Outside an app: `.kiro/skills/` or `~/.kiro/skills/`.
- Frontmatter fields: `name`, `description`, `always`, `triggers`, `inject_on_trigger`, `repo_scope`, `app`. None is required.
- Same format as Kiro powers' skills? The layout (folder + `SKILL.md` + frontmatter with `name`/`description`) matches. The play-level skill also has `license` and `metadata`; the docs do not list those, and whether they are accepted or ignored is not documented.
- Reuse as is? Not documented as safe. The file is a plain SKILL.md, so it would likely load, but its content assumes the Grimsheet repo root as the working directory (`npm run build:play`, `scripts/play.mjs`, `tests/solutions`). A run would need a Grimsheet checkout and Node. This is my reading of the skill file, not a Context7 statement.

## d. Crons
Library `/kirodotdev/kirocrew`; pages `docs/app-kit/manifest-reference.md`, `src/kiro_crew/docs/cron-and-scheduling.md`.
- Schedule: `every` (seconds) or `cron_expr` (5-field, e.g. `30 9 * * 1-5`), mutually exclusive. Optional `timezone` (IANA; default falls back to gateway zone, then UTC), `skip_dates` (`YYYY-MM-DD`), `strict_schedule` (otherwise a random start delay, up to 59 min on a daily job).
- Other fields: `name`, `message` (prompt sent to the agent), `agent`, `agent_sequence`, `command`, `script`, `env`, `persistent_session` (default true), `silent` (default false), `timeout`, `timeout_secs`, `enabled`, `folder`.
- What a run can do: an agent run with the `message` prompt; or a `command` (shell, no model call, default 300s timeout) or `script` (Python `file.py:function`, default 30s timeout).
- Output: delivered automatically unless `silent: true`. For Slack, to the conversation that scheduled the job. Where output goes for an app cron in the dashboard: not documented beyond the Schedule page listing the job.
- Not documented: pointing a cron at a specific git branch (e.g. Grimsheet's main). The agent would have to fetch it itself.

## e. Run environment
Library `/kirodotdev/kirocrew`; pages `src/kiro_crew/docs/apps.md`, `docs/guides/remote-crew-on-ec2.md`, `docs/guides/docker-troubleshooting.md`, `docs/request-for-change/rfc-app-sandbox-isolation.md`, `docs/app-kit/getting-started.md`.
- Shell: agent commands run as subprocesses; on Linux they run in a user-namespace sandbox, and if none is available command execution fails closed unless `agent.sandbox_allow_unsandboxed_exec` is set. Windows behavior: not documented.
- Node: not guaranteed in the agent environment. The official Docker image ships git, curl, ripgrep, unzip, Python, kiro-cli and no `node` or `npm`. For building a UI the prerequisite is Node.js 22.12+ (24 LTS recommended).
- Network: `permissions.network` exists, but per the sandbox RFC page `mcpTools`, `cron` and `network` are "stored and shown at install with no runtime gate". Actual agent network policy: not documented.
- Cloning a public GitHub repo from a run: not documented. `git` is present in the Docker image, and registry installs clone from any git-cloneable URL.
- Writing files: the SDK exposes an app-scoped data directory (`getAppDataDir()`). Other writable locations: not documented.
- App code itself runs in the gateway with the same privileges as Kiro Crew (no process sandbox); third-party apps are denied until trusted.

## f. ui/ and @kirocrew/app-sdk
Library `/kirodotdev/kirocrew`; pages `docs/app-kit/getting-started.md`, `docs/app-kit/migration-guide.md`, `docs/app-kit/api-reference.md`, `docs/system-specs/modules/app-kit-platform.md`, `docs/request-for-change/rfc-federated-app-platform.md`.
- Data: `useAppApi()` gives `get/post/put/delete` against gateway `/api/...` paths; `useAppEvents(event, cb)` subscribes to WebSocket events. Both are limited to paths and events declared in `permissions.api` and `permissions.events` (undeclared access throws). Storage: `permissions.storage` exists and the SDK has `getAppDataDir`, `getAppConfig`, `setAppConfig`. How a UI reads files an agent or cron wrote: not documented; the app-dev skill suggests keeping a bounded `_index.json` in the app data directory.
- Build: standard React + Vite project in `ui/`; `npm run build` produces an ESM bundle (`.mjs`). Do not `npm install @kirocrew/app-sdk`: the host provides it, plus React, ReactDOM and lucide-react, via an import map, so mark them as build externals. An RFC page also lists a `kirocrewApp()` Vite plugin; the getting-started page does not use it, so treat it as unconfirmed.
- Serve: the dashboard dynamically `import()`s `/apps/<app>/ui/<entry>` as an ESM module (no iframe). HTML is not served; only `.mjs`/`.js` etc.
- Shared UI components: `@kirocrew/app-sdk/ui` (`Card`, `CardTitle`, `PageHeader`, `StatCard`).
- Current SDK version: not documented. It is not published to npm per the migration guide.

## g. Install, run, test, judge install
Library `/kirodotdev/kirocrew`; pages `docs/app-kit/publishing-guide.md`, `docs/app-kit/getting-started.md`, `skills/kirocrew-app-dev/SKILL.md`, `src/kiro_crew/docs/apps.md`.
- The CLI in the docs is `kirocrew`, not `kiro-cli`. ~~No `kiro-cli` app command was found.~~ Correction (observed 2026-11-07): the `kirocrew` CLI exists on this machine but is bundled with the KiroCrew desktop app and is not on PATH. Run it by full path: `& "C:\Program Files\KiroCrew\resources\backend-dist\kirocrew-backend\bin\kirocrew.cmd" <args>`. Version 0.12.0. `kirocrew app --help` lists install, import, list, enable, update, disable, mcp, uninstall, info, dev, init; `uninstall` "preserves app data by default". `kiro-cli crew` is a forwarder to the Crew CLI and needs `kirocrew` on PATH; without it, it reports Kiro Crew is not installed.
- Local: `cd ui && npm install && npm run build`, then `kirocrew app install /absolute/path/to/app` and `kirocrew app enable <name>`. Scaffold with `kirocrew app init <name>`. Debug with `kirocrew app info <name>`; live reload with `kirocrew app dev <name>`. Verify in the dashboard (`kirocrew token`, open the URL): Library tab, sidebar page, Schedule page for crons, chat with the agent. Local installs skip `setup.onInstall`, so the UI must be built beforehand.
- Third-party apps must be trusted before enable (Settings, Security, Third-party apps).
- Judge from a public GitHub repo: the docs say any git-cloneable URL works for publishing, and a registry install clones the source, runs the build and `setup.onInstall`. The official catalog needs an App Store listing request issue. A direct `kirocrew app install <git-url>` command: not documented (the CLI examples only show local paths). Fallback: `git clone`, build `ui/`, then local install.
