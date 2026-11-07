# E14: Probe_Page, round 1 (nothing declared), Crew 0.12.0

date: 2026-11-07, page run at 10:09:54Z
How: Playwright MCP opened the dashboard on a 30-minute token, then `/apps/crew-spike`. The token URL was used only for the first navigation and is not recorded here. The screenshot `E14-probe-page-round1.png` shows the dashboard sidebar and the page; it shows no address bar and no token.
App state: installed 10:06:33Z, trusted and enabled from the dashboard by the user. `permissions.api` and `permissions.events` empty. Cron never run, so no `spike-latest.mjs` exists (`SPIKE_SERVE_DIR` is not set).

Screenshot, in words: the Kiro Crew sidebar with "Crew Spike" selected under Apps, a heading "Crew Spike: read routes", a Refresh button, "last run: 2026-11-07T10:09:54.005Z", and a table of rows R0 to R7 matching the list below.

## Rows as rendered (read from the DOM)

| Row | Status | Result |
|---|---|---|
| R0 Object.keys(sdk) | data | export list, clipped at 300 chars; full list below |
| R1 useAppApi().get("/api/apps") before any declaration | error | `AppApiPermissionError: [app-sdk] App "crew-spike" not permitted to access /api/apps. Declared: []` |
| R2 getAppDataDir() | not exported | `getAppDataDir not exported` |
| R3 useAppApi().get(storage/files path) | error | `Error: no documented path` (no path was found in P0; none guessed) |
| R4 import() of spike-latest.mjs | error | `TypeError: Failed to fetch dynamically imported module: http://localhost:5476/apps/crew-spike/ui/spike-latest.mjs?t=...`; console: 404 Not Found |
| R5 useAppEvents | empty | `(no events; subscribed to 0)` |
| R6 useAppApi().get(cron/schedule path) | error | `Error: no documented path` |
| R7 getAppConfig / setAppConfig | not exported | `getAppConfig and setAppConfig not exported` |

No note was shown for `useAppApi()`, so it exists, was called and returned an object.
Console errors on the page: two `403 Forbidden` on `/api/instances` (dashboard shell, not the spike page) and the R4 `404`.

## Real SDK export list

Read in the page with `import('@kirocrew/app-sdk')` (the same import-map entry the page uses). The import map maps `@kirocrew/app-sdk` to `/vendor/kirocrew-app-sdk.mjs`. `APP_SDK_LEVEL` = 1. 34 exports:

APP_SDK_LEVEL:number, AppApiProvider:function, ChatEmbed:function, ChatMessageList:object, ChatPanel:function, GROUPED_ROLES:object, ToolCallPill:object, activeLocale:function, checkSubscribeAllowed:function, compareText:function, defaultMessageRenderers:object, deriveFollowUpOptions:function, extractSteeringAcks:function, fmtCurrency:function, fmtDate:function, fmtDateTime:function, fmtNumber:function, fmtRelative:function, fmtTime:function, mergeRenderers:function, parseOptions:function, resolveRenderer:function, stripPartialOptionMarker:function, useAppApi:function, useAppEvents:function, useAppInfo:function, useChatLauncher:function, useChatSession:function, useImeGuard:function, useLanguageGeneration:function, useNavBadge:function, useNavigate:function, useNotify:function, useTheme:function

Names assumed in `sdk.d.ts` (design) and their real `typeof`: useAppApi function; useAppEvents function; getAppDataDir undefined; getAppConfig undefined; setAppConfig undefined.

## Readings

- A-11 (entry default export is the page component): **confirmed**. The default export of `dist/index.mjs` rendered as the `/apps/crew-spike` page.
- A-12 (SDK signatures in sdk.d.ts match runtime): **refuted** for getAppDataDir, getAppConfig and setAppConfig, which Crew 0.12.0 does not export. useAppApi and useAppEvents exist; `useAppApi()` returns an object whose `get` returns a promise that rejects with `AppApiPermissionError` for an undeclared path.
- R1 confirms the documented rule: undeclared api access throws. Error class and text recorded above. The message also prints the declared list (`Declared: []`).
- R2 cannot be tested as designed. `useAppInfo` exists and is a lead for the app data directory question (not tested yet; its return shape is unknown).
- R4: a 404 here is expected, because nothing has written `spike-latest.mjs` yet. It does not test A-13. It does show that a missing file under `/apps/crew-spike/ui/` returns 404 rather than a dashboard page.
- R7 has no SDK config calls to test. Notes section f should list config calls as not exported in 0.12.0.
