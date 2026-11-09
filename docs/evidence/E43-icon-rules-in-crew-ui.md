# E43: how Crew 0.12.0 shows an installed app's icon (packaging task 17.0, Q2)

date: 2026-11-08. Crew 0.12.0 (`kirocrew --version`). Read only, from the files that the KiroCrew desktop app installs under `$env:ProgramFiles\KiroCrew\resources\backend-dist\kirocrew-backend\Lib\site-packages\kiro_crew\`. No file was changed. The finding was first drafted by the user from the same bundle and checked here.

## Files read
- `static/dist/assets/appNav-S3ohAyzl.js` (2415 bytes): the sidebar entries of the apps.
- `static/dist/assets/useHeroArt-B6Tz6IeT.js` (2264 bytes): how an art path becomes an address.
- `apps/routes.py`: the route `GET /apps/{name}/art/{path:.*}`.
- `apps/routes_art.py`: `handle_app_art_file`, `_declared_art_paths`, `_read_declared_art`.
- `apps/registry_pipeline/store_art.py`: `_ART_MANIFEST_FIELDS`, `_ART_IMAGE_EXTENSIONS`, `_ART_MAX_BYTES`, `_SAFE_PATH_RE`.
- `apps/routes_static.py`: the content type of `.svg`.

## What the navigation code does (appNav)
- A map of 16 lucide names to glyphs: Users, Inbox, Gamepad2, MessageSquareDot, ClipboardCheck, BookOpen, BookOpenText, Brain, FolderTree, FlaskConical, ScanSearch, ScrollText, Contact, ShoppingBag, Activity, FolderPlus.
- Each entry gets `glyphAllowed: builtin || adopted`, where `builtin` is `origin === "builtin"` and `adopted` is an adopted legacy app with a route. `iconName` is the page's `icon`, but it is shown only when `glyphAllowed` is true and the name is in the map.
- `iconUrl` comes from the manifest's `iconPath`, or else its `iconUrl`, and `iconUrlDark` from `iconPathDark`, or else `iconUrlDark`. `pageIconUrl` is the first page's `iconUrl`. With none of them, a default glyph is shown.
- This app is installed (origin registry, see E36), so the page `icon` `Ghost` cannot render. That fits the default cube seen after the first install (E38).

## How an `iconPath` is served
- `iconPath` becomes `/apps/<name>/art/<path>` (each path part encoded), served by `handle_app_art_file`.
- The handler refuses an empty path, a path with `..` or a leading `/` (400), and an extension outside `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico` (403).
- It serves only a path that the installed manifest declares in an art field (`iconPath`, `iconPathDark`, the hero images, `screenshots`, `screenshotsDark`). It reads `<install folder of the app>/<path>` with one descriptor, refuses links and anything outside the install folder, and answers 404 for every other case.
- The size ceiling is 8 MiB, and the path grammar is `^[A-Za-z0-9_./-]+$`.
- An `.svg` is sent as `image/svg+xml` with `Content-Security-Policy: default-src 'none'; sandbox` and `Cache-Control: no-cache`.
- The path is relative to the app's install folder, so a file at `ui/icon.svg` needs `"iconPath": "ui/icon.svg"`; `"icon.svg"` would read `<install folder>/icon.svg`.

## Seen after the Sync (2026-11-09, install source at commit 341deee)
- `kirocrew app info grimsheet-playtester` (read only, exit 0): version 1.0.0, enabled true, updatedAt 2026-11-09T00:27:28Z, source the install clone. The stored manifest keeps `"iconPath": "ui/icon.svg"` (its keys: name, version, displayName, description, author, agents, skills, crons, ui, permissions, iconPath); there is no `iconUrl`, and the page is stored as `{route, label}` with no `icon`.
- The installed `ui\icon.svg` exists (376 bytes) and has the same SHA-256 as the repo file. The data folder was kept by the Sync (hunts, launcher, runs, config.json, _index.json).
- User report: the sidebar entry "Grimsheet Playtester" shows the ghost instead of the default cube. The Details card and the dark theme were not reported.
- Screenshots taken by the user after the Sync (2026-11-08, `docs/screenshots/`): the sidebar entry (`sidebar-entry.png`), the Details page (`library-details.png`) and the Library's Enabled row (`library-enabled.png`) all show the ghost, on the Details page and in the Library on a light tile. So the Details card shows the image too. The dark theme was not checked. In `library-details.png` the Details card (author, install date, origin) is left out for width.
- The finding above holds: an installed app's sidebar icon comes from `iconPath`.
