---
inclusion: fileMatch
fileMatchPattern: "ui/**"
---

# Dashboard (`ui/`) rules

Source: `docs/CREW_NOTES.md` section f. "Not documented" items stay open until the `crew-spike` answers them.

## Build and serve
- Standard React + Vite project in `ui/`, TypeScript strict. `npm run build` produces an ESM bundle (`.mjs`); `app.json` `ui.entry` (for example `dist/index.mjs`) is relative to `ui/`.
- Do not `npm install @kirocrew/app-sdk`. The host provides it, plus React, ReactDOM and lucide-react, via an import map. Mark them as build externals.
- An RFC page lists a `kirocrewApp()` Vite plugin; the getting-started page does not use it. Treat it as unconfirmed.
- The dashboard dynamically `import()`s `/apps/<app>/ui/<entry>` as an ESM module (no iframe). HTML is not served; only `.mjs`/`.js` and similar.
- Local installs skip `setup.onInstall`, so build `ui/` before `kirocrew app install`.
- Current SDK version: not documented. → partly answered in section h.3 (observed 2026-11-07): the runtime exports `APP_SDK_LEVEL` 1; no version string.

## Data access
- `useAppApi()` gives `get/post/put/delete` against gateway `/api/...` paths. `useAppEvents(event, cb)` subscribes to WebSocket events. Both are limited to paths and events declared in `permissions.api` and `permissions.events`; undeclared access throws.
- Also available: `permissions.storage`, `getAppDataDir`, `getAppConfig`, `setAppConfig`. Correction (observed 2026-11-07, section h.3, E14): Crew 0.12.0 does not export `getAppDataDir`, `getAppConfig` or `setAppConfig`. A named import of a missing export fails the whole module at link time, so `import * as sdk` and check `typeof`, or use only the calls listed below.
- How the UI reads a file a cron or agent wrote: not documented. The app-dev skill suggests a bounded `_index.json` in the app data directory. Do not design the result format until the spike answers this. → answered in section h.3 (observed 2026-11-07); see "Data access, decided" below.

## Components
`@kirocrew/app-sdk/ui` provides `Card`, `CardTitle`, `PageHeader`, `StatCard`.

## Planned content
One card per level with its colour (green, amber, red), last result and trend over the last runs; a findings list with a copyable action list and the command that replays it; commit hash and time of the last replay and hunt.

## Quality
Dashboard must be accessible: semantic markup, text labels alongside colour (colour is never the only signal), keyboard-operable copy buttons.

## Data access, decided (spike findings, 2026-11-07; section h.3)
- The page reads run results through `GET /api/apps/<app>/config` (declare `"/api/apps/<app>/config"` in `permissions.api`; matching is exact, one entry covers GET and PUT). The replay cron writes a results key into `data\config.json` (E24 R3b, E26). Keep the value small: a pointer to the latest run (run id, counter, finished time) plus what the cards need, not a history.
- The page **never PUTs** that route. A PUT replaces the whole object and wipes the cron's results (E24 R7, R3b). If a page setting is ever needed, read, merge and write all keys back, and accept that it can race with the cron; prefer none.
- Settings such as the repo URL and branch live in the launcher's control file under `data\launcher\`, not in the config route.
- No event marks a finished run (`useAppEvents` never fired, E24). The page re-reads on a timer and has a Refresh button. A Refresh updates every HTTP route; `import()` of a changed module needs a `?t=` cache-buster.
- `GET /api/crons` (declare `"/api/crons"`) gives per-job run state for the header: `last_run_ts`, `last_status`, `is_running`, `consecutive_failures`, `next_run_ts`, `enabled`, `user_paused`. It gives no run output. `GET /api/crons/<id>` answers 405.
- Fallback if the config route fails: a `.mjs` results module under the installed `ui\`, rewritten at the start of each run (`.json` is not served; a Sync deletes the file, so the page shows nothing until the next run).
- `useAppInfo()` returns `{name, version, permissions, active}` and no data-folder path.

## Evidence ids
Evidence ids (E01 to E29) refer to `docs/evidence/INDEX.md`; the files are in `docs/evidence/`.
