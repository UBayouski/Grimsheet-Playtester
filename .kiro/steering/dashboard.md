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
- Current SDK version: not documented.

## Data access
- `useAppApi()` gives `get/post/put/delete` against gateway `/api/...` paths. `useAppEvents(event, cb)` subscribes to WebSocket events. Both are limited to paths and events declared in `permissions.api` and `permissions.events`; undeclared access throws.
- Also available: `permissions.storage`, `getAppDataDir`, `getAppConfig`, `setAppConfig`.
- How the UI reads a file a cron or agent wrote: not documented. The app-dev skill suggests a bounded `_index.json` in the app data directory. Do not design the result format until the spike answers this.

## Components
`@kirocrew/app-sdk/ui` provides `Card`, `CardTitle`, `PageHeader`, `StatCard`.

## Planned content
One card per level with its colour (green, amber, red), last result and trend over the last runs; a findings list with a copyable action list and the command that replays it; commit hash and time of the last replay and hunt.

## Quality
Dashboard must be accessible: semantic markup, text labels alongside colour (colour is never the only signal), keyboard-operable copy buttons.
