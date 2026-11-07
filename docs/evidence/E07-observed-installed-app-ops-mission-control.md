# Observed in an installed app: ops-mission-control

date: 2026-11-07
Read-only. Nothing in this app, or any other installed app, was modified, disabled or reinstalled.

Sources read:
- `~/.kiro/crew/apps/ops-mission-control/app.json` and `installed.json` (the installed copy; the folder holds only these two files, no `ui/` folder).
- Directory listings of the bundled built-in copy under the desktop app install (`...\kiro_crew\apps\builtins\ops_mission_control`): `app.json`, `README.md` and a Python `backend/` package. No `ui/` folder there either.
- File name only: the dashboard bundle `static\dist\assets\OpsMissionControlPage-<hash>.js` contains the string `api/apps/ops-mission-control`. The contents of that bundle were NOT inspected (the inspection command was declined by the user; see the note at the end).

## installed.json

`source: builtin`, `origin: builtin`, `resources: gateway`, `lifecycle: locked`, `enabled: false`, `schemaVersion: 2`, `dev: false`, plus `sessionApprovalConsentPending` and `approvedGrantsStored` flags.

## Manifest facts

- `permissions.api`: `/api/apps/ops-mission-control`, `/api/apps/ops-mission-control/*`, `/api/chat`, `/api/chat/*`, `/api/approvals`, `/api/approvals/*`. The app's own paths use the shape `/api/apps/<app-name>` and `/api/apps/<app-name>/*`. Entries are exact paths or a trailing `/*`.
- `permissions.events`: `slots`, `notification`. Two event names that exist in the host.
- `permissions.mcpTools`: `cron_add`, `cron_list`, `send_message`, `spawn_run`, `learn_add`, `ops_mission_control_api`.
- `permissions.storage: true`, `permissions.network: true`, `permissions.cron: true`.
- `ui`: `pages` only (`route: /ops-mission-control`, `label: Mission Control`, `icon: Radio`). There is no `ui.entry`. The icon value `Radio` is a lucide-style name, which supports (does not prove) the A-08 reading of `icon`.
- `backend.routes: "backend.routes:register_routes"`. The app has a Python backend that registers HTTP routes under `/api/apps/ops-mission-control`. The page reads its data through those routes.
- Other manifest fields seen: `defaultEnabled`, `iconUrl`, `heroImage`, `screenshots` (served under `/app-assets/<name>/`), `tags`, `highlights`, `useCases`, `configuration`, `dependencies.optionalCommands`, `notifications.channels`, `platform.os` (`macos`, `linux`, `windows`).
- `crons[]` use `message` (a prompt to an agent), not `command`. Fields seen: `name`, `every` (120, 900, 300), `cron_expr` (`17 3 * * *`), `message`, `persistent_session`, `silent`, `enabled`. This app's crons are agent runs, so they are not an example of a cron `command`.

## How its UI gets data (what this evidence supports)

- The page is compiled into the dashboard bundle (a host-side page), not loaded from an app `ui/` bundle. So it is not a working example of the `ui.entry` / `@kirocrew/app-sdk` route the spike uses.
- Its data path is HTTP routes served by the app backend under `/api/apps/<name>/...`, which the app declares in `permissions.api`.

## Which of routes R1 to R7 this supports

| Route | Support from this app | What is still open for the spike |
|---|---|---|
| R1 (undeclared `api` access throws) | None. | Tested by the spike. |
| R3 (api path for app files or storage) | The shape `/api/apps/<name>` and `/api/apps/<name>/*` is a declared path form. It serves routes from `backend.routes`, which the spike does not have. | Whether any such path serves files from the app data directory without a backend: not shown. |
| R5 (events) | `slots` and `notification` are valid names for `permissions.events`. | Which events a cron run emits: not shown. |
| R6 (cron output) | None. This app's crons are silent agent runs. | Tested by the spike. |
| R2, R4, R7 (SDK data dir, served `.mjs`, config) | None. | Tested by the spike. |

The spike still runs all of its own probes. Nothing here answers question 1 for a cron `command` that writes a file.

## Note on the incomplete inspection

The bundle contents (SDK calls, polling, event subscription) were not read. If wanted, a narrower read-only look at that bundle can be done on the user's go-ahead.
