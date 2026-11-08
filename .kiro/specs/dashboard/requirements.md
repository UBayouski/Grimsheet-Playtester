# Requirements Document

## Introduction

`dashboard` is the `ui/` page of Grimsheet Playtester. It is a React and Vite page, TypeScript strict, that the Kiro Crew dashboard loads as an ES module. It shows three things: the result of the last nightly replay (one card per level, with a colour, the last result and a trend), the findings of the exploit hunt (each one a verified action list with the command that replays it), and the state of the replay job.

The page is read only. It reads two HTTP routes and never writes to either. The replay cron and the hunt scripts write the results key into `data\config.json`; the page cannot read any other file (Notes h.3; E24 R3b). A PUT to the config route replaces the whole config object and would wipe the results (E24 R7), so the page sends no write request of any kind.

The page treats everything it reads as untrusted. The two writers are separate programs that evolve on their own, an old value can survive a reinstall, and a route can fail. Every state has a defined display, and a bad part never blanks the good parts.

What was read for this spec (read only): `docs/BRIEF.md` (sections 5 and 10), `.kiro/steering/dashboard.md` and `crew-app.md`, `docs/CREW_NOTES.md` (sections f and h.3), evidence E09, E10, E14 and E24, `.kiro/specs/replay-runner/requirements.md` and `scripts/replay/types.mjs`, `.kiro/specs/exploit-hunt/design.md` (Findings_Value, token grammar, play command), and the shape (not the content) of a real `data/config.json` from the replay smoke run. The Context7 library `/kirodotdev/kirocrew` was queried for the app-kit docs (see "Docs re-check").

Not verified here: no page has been built, so no requirement below has been seen to work in a real host. Specifically untested are the format of `last_run_ts` and `next_run_ts` in `/api/crons`, the clipboard in the host, and the config route's size limit (Notes h.8).

### Docs re-check

Context7 was queried on 2026-11-08 (library `/kirodotdev/kirocrew`, pages `docs/app-kit/getting-started.md`, `migration-guide.md`, `manifest-reference.md`, `api-reference.md`, `docs/system-specs/modules/learn-cron-dashboard.md`, and an RFC page). The docs agree with `docs/CREW_NOTES.md` section f on: the SDK is not installed and the host provides it, React, ReactDOM and lucide-react through an import map (so they are build externals); `useAppApi` gives `get/post/put/delete`; `permissions.api` is an array of path strings, with `/api/example/*` as the documented form for a subtree; `ui.entry` is relative to `ui/` (example `dist/index.mjs`); `GET/PUT /api/apps/{name}/config` exists. Differences and additions:

- **New, not in section f:** `ui.pages[]` entries accept `entryPoint` (a per-page override of `ui.entry`) and `mountFunction` (default `mount`). The spike observed that the default export of `dist/index.mjs` rendered as the page (E14, A-11 confirmed), so these requirements use a default export and no `mountFunction`. Whether `mountFunction` matters for a page with a default export is not documented.
- **New:** the docs say a PUT to the config route from a dashboard subject is owner only. The spike's PUT worked from the page (E24 R7). This does not change the rule that the page never writes.
- **New:** `GET /api/crons` is documented as returning `{jobs: [...]}`, and for an app token only the app's own jobs. Section h.3 and E24 R6 did not know whether the list is filtered; the docs say it is. The documented example job fields are `id`, `message`, `last_result`, `last_error`, `command`, `script`; the fields the spike observed (`last_run_ts`, `last_status`, `is_running`, `consecutive_failures`, `next_run_ts`, `enabled`, `user_paused`) are not in the docs page that came back. Observed evidence wins.
- **Differs, `useAppInfo`:** the RFC page documents `{name, version, permissions}`; the spike observed `{name, version, permissions, active}` and no data-folder path (E24 R2). Observed wins.
- **Differs, named imports:** the docs examples use named imports (`import { useAppApi, useAppEvents } from '@kirocrew/app-sdk'`). A missing named export fails the whole module at link time (E09), and `getAppDataDir`, `getAppConfig` and `setAppConfig` are not exported in Crew 0.12.0 (E14). Observed wins: these requirements use a namespace import and `typeof` checks.
- **Differs, build output:** an RFC page says `npm run build` writes `build/dist/index.mjs` and mentions a `kirocrewApp()` Vite plugin. The getting-started and manifest pages say `dist/index.mjs` under `ui/`, which is what the spike built and installed (E10, E11). The plugin stays unconfirmed.
- **Not used:** `@kirocrew/app-sdk/ui` is documented (`Card`, `CardTitle`, `PageHeader`, `StatCard`), but the spike never imported it, the real export list of `@kirocrew/app-sdk` has no such components (E14), and whether the host's import map resolves that module in 0.12.0 is not observed. A static import of an unresolved module fails the whole page at link time (E09), and a `typeof` check cannot guard a missing module, so the page does not import it (Requirement 9, criterion 7; Assumption A-4; Open question Q4, closed).
- The docs returned nothing on a size limit of the config route, on events that mark a finished cron run, or on a documented replay command for a finding.

## Glossary

- **Dashboard_Page**: the React page built from `ui/`, the subject of this spec.
- **App_Name**: `grimsheet-playtester`, the name in the config route (Assumption A-1 of `replay-runner`).
- **Config_Route**: `GET /api/apps/grimsheet-playtester/config`. It returns the whole content of `data\config.json` as a JSON object.
- **Crons_Route**: `GET /api/crons`. It returns `{jobs: [...], ...}`; each job carries `last_run_ts`, `last_status`, `is_running`, `consecutive_failures`, `next_run_ts`, `enabled`, `user_paused` (E24 R6).
- **Results_Value**: the value under the key `playtesterResults` in the config object. Sub-keys: `schemaVersion`, `updatedAt`, `latest`, `trend` (written by the replay) and `findings` (written by the hunt).
- **Latest_Run**: `Results_Value.latest`, the compact form of the newest finished replay run: `runId`, `counter`, `state` (`running`, `complete`, `failed` or `cut-short`), `startedAt`, `finishedAt`, `commit`, `repoUrl`, `branch`, `failure`, `coverage`, and `levels`, a list of Level_Entries.
- **Level_Entry**: one element of `latest.levels`: `levelId`, `colour` (`green`, `amber`, `red` or `error`), and optionally `inkSpent`, `minimalInk`, `reasonCode`, `timedOut` and `endHp`. The replay's compact entry gains `endHp` in a separate `replay-runner` amendment (Open question Q1, closed); until it is made the entry has none.
- **Trend_Entry**: one element of `Results_Value.trend`: `runId`, `counter`, `state`, `startedAt`, `commit`, the counts `green`, `amber`, `red`, `error`, and `levels`, a map from level id to colour. The replay writes at most 30, newest first.
- **Findings_Value**: `Results_Value.findings`, an object with `schemaVersion`, `updatedAt`, `commit`, `huntId`, `counts` (`attempts`, `confirmed`, `rejected`, `error`, `duplicate`, `notRecorded`) and `items` (exploit-hunt design, "Findings_Value and one Finding"). A legacy array or any non-object is treated as empty (exploit-hunt Decision 29).
- **Finding**: one element of `Findings_Value.items`: `id`, `levelId`, `class` (`cheaper_win`, `free_win` or `unexpected_route`), `commit`, `huntId`, `foundAt`, `actions` (a list of Tokens), and `result` (`won`, `inkSpent`, `minimalInk`, `editCount`, `newEditAddresses`, `reasonCode`).
- **Token**: one element of a Finding's `actions`, in the exploit-hunt token grammar: `N`, `S`, `E`, `W`, `wait`, `undo`, or `edit:ADDRESS=RAW` where RAW is percent-encoded UTF-8.
- **View_Model**: the plain object that a pure function builds from the two route values; the React components only render it.
- **Colour_Label**: the text shown with a colour: for `green` "Green: intended solution holds", for `amber` "Amber: wins with a different ink count", for `red` "Red: no longer wins", for `error` "Not judged".
- **Level_Card**: the card of one level.
- **Replay_Job**: the entry of `/api/crons` `jobs` for the nightly replay (Assumption A-5).
- **Now_Input**: the current time in milliseconds since the epoch, which the page reads from its clock and passes to the View_Model builder as an argument (Requirement 2, criterion 8).
- **Stale_Limit**: 36 hours, which is 129,600,000 milliseconds (Requirement 5, criterion 11).
- **Read**: one attempt to fetch both routes. A Read ends when both requests have settled or timed out.
- **Poll_Timer**: the timer that starts a Read on a schedule.
- **Poll_Interval**: the delay between the start of one scheduled Read and the next.
- **Refresh_Button**: the button that starts a Read on demand.
- **Replay_Command**: the text `node scripts/play.mjs <level-id> --actions-file <actions-file>` with the Finding's level id filled in (Requirement 7).
- **Actions_File_Text**: the JSON array of action objects that a Finding's Tokens decode to; the content of the file the Replay_Command reads.
- **Clipboard_Fallback**: the display shown when the host gives the page no working clipboard (Requirement 11).
- **Host**: the Kiro Crew dashboard that loads the page.

## Requirements

### Requirement 1: Read-only data access

**User Story:** As the developer, I want the page to only read two routes and never write, so that it cannot wipe the results that the nightly job and the hunt write.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL obtain its data only from `GET /api/apps/grimsheet-playtester/config` and `GET /api/crons`.
2. THE Dashboard_Page SHALL send no POST, PUT, PATCH or DELETE request to any route.
3. THE Dashboard_Page SHALL NOT call `GET /api/crons/<id>` (the single-job route answers 405, E24 R6b) and SHALL NOT call any route other than the two named in criterion 1.
4. THE Dashboard_Page SHALL NOT subscribe to events (no `useAppEvents`), because no event marks a finished run in Crew 0.12.0 (E24).
5. THE Dashboard_Page SHALL NOT import a results module under `ui/` and SHALL NOT use any fallback for the Config_Route.
6. THE Dashboard_Page SHALL need exactly the `permissions.api` entries `/api/apps/grimsheet-playtester/config` and `/api/crons`, and no `permissions.events` entry; the edit of `app.json` belongs to the `packaging` spec.
7. WHEN a test drives the Dashboard_Page with a recording fake of `useAppApi`, THE recorded calls SHALL be GET calls to the two paths of criterion 1 and nothing else, for any sequence of mounts, polls, refreshes, route failures and unmounts.
8. THE test suite SHALL scan the source files under `ui/src/` and fail IF a call to the `post`, `put` or `delete` method of the API object, a `fetch` call, an `XMLHttpRequest` or a `useAppEvents` call appears.

### Requirement 2: Untrusted input becomes a total View_Model

**User Story:** As the developer, I want every possible route value to produce a defined display, so that a malformed value, an old value or a half-written value never crashes the page.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL build the View_Model with one pure function that takes the Config_Route value, the Crons_Route value, the read status of each route and the Now_Input, and returns a View_Model.
2. FOR ALL inputs of any JSON type, including `null`, `undefined`, arrays, strings, numbers, deeply nested objects and objects with extra or missing keys, and for any value of the Now_Input (a number that is not finite, or not a number, included), THE function SHALL return a View_Model and SHALL NOT throw.
3. THE function SHALL validate each part of the Results_Value on its own: `latest`, each Level_Entry, `trend`, each Trend_Entry, `findings`, each Finding, and each Crons_Route job. A part that fails validation SHALL be dropped or replaced by its empty state, and its sibling parts SHALL be kept.
4. WHEN a part is dropped, THE View_Model SHALL record a count of dropped items for that part, and THE Dashboard_Page SHALL show that count as text (for example "2 findings could not be read").
5. WHEN `schemaVersion` of the Results_Value or of the Findings_Value is a number greater than 1, or is not a number, THE function SHALL still read every part whose shape validates, and THE View_Model SHALL carry a notice that the value comes from a different schema version.
6. WHEN a string, number or boolean field has the wrong type, THE function SHALL treat that field as absent and SHALL NOT convert it by guessing (for example a string `"1"` is not the number 1).
7. THE function SHALL cap its output: at most 30 Trend_Entries, at most 20 Findings, at most 100 Level_Entries, at most 40 Tokens in a Finding, and at most 140 characters in a Token. A Finding with more Tokens or a longer Token SHALL be dropped and counted. Other items beyond a cap SHALL be left out and counted.
8. THE function SHALL return equal View_Models for equal inputs, the Now_Input included (it reads no clock, no random source and no global; the current time reaches it only as the Now_Input argument).
9. THE Dashboard_Page SHALL render every string from a route value as text and SHALL NOT use `dangerouslySetInnerHTML`, build a link from route data, or use route data as a URL, a style value or an element name.
10. FOR ALL View_Models, THE colour of every Level_Card SHALL be one of `green`, `amber`, `red`, `error` and `none` (no result); a colour string outside the first four SHALL become `error` with the text "Unknown colour" in its place.

### Requirement 3: Defined display for every state

**User Story:** As the developer, I want each situation named on screen, so that I can tell an empty install from a broken one.

#### Acceptance Criteria

1. WHEN the first Read has not finished, THE Dashboard_Page SHALL show a loading state with the text "Reading results".
2. WHEN the Config_Route answers but the object has no `playtesterResults` key, THE Dashboard_Page SHALL show the text "No results yet. The nightly replay has not written any results." and SHALL NOT show level cards or a findings list.
3. WHEN `playtesterResults` exists but `latest` is absent or invalid, THE Dashboard_Page SHALL show "No replay run recorded yet" in the level area, and SHALL still show a valid trend and a valid Findings_Value.
4. WHEN `findings` is absent, THE Dashboard_Page SHALL show "No hunt has run yet" in the findings area and SHALL NOT show an error.
5. WHEN `findings` is present and `items` is empty, THE Dashboard_Page SHALL show "The last hunt found no exploits" with the hunt header (Requirement 5, criterion 4).
6. WHEN `findings` exists but `latest` does not (the hunt wrote first), THE Dashboard_Page SHALL show the findings and the text of criterion 3.
7. WHEN `latest.state` is `failed`, THE Dashboard_Page SHALL show the failure stage, the reason code and the message of `latest.failure` as text, and SHALL still show the Level_Cards that `latest.levels` holds.
8. WHEN `latest.state` is `cut-short` or `running`, THE Dashboard_Page SHALL show that state as text and SHALL show the levels that are present.
9. WHEN the Config_Route request fails or times out, THE Dashboard_Page SHALL show "Results could not be read" with a short error text, and SHALL keep showing the last good results from an earlier Read, marked "last read at" with the time of that Read (Requirement 8, criterion 7).
10. WHEN the Crons_Route request fails or times out, THE Dashboard_Page SHALL show "Replay job state is unavailable" in the job area only, and SHALL show the results area unchanged.
11. WHEN the Crons_Route answers but holds no Replay_Job, THE Dashboard_Page SHALL show "The replay job is not registered" in the job area.
12. WHEN both routes fail on the first Read, THE Dashboard_Page SHALL show both error texts and a Refresh_Button that works.
13. THE Dashboard_Page SHALL show an error text that is at most 200 characters, taken from the error's message or a fixed phrase, and SHALL NOT show a stack trace, a request header or a token.
14. THE test suite SHALL render each state of criteria 1 to 12 with `react-dom/server` and assert the named text.

### Requirement 4: Level cards, colour, last result and trend

**User Story:** As the developer, I want one card per level with its colour, last result and trend, so that I see which levels hold and which changed.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL show one Level_Card for each level id in the union of the ids in `latest.levels` and the ids in the newest valid Trend_Entry, ordered by level id ascending (plain string comparison).
2. THE Level_Card SHALL show the level id, the colour as a coloured marker and the Colour_Label as text next to it.
3. FOR ALL Level_Cards, THE Colour_Label text SHALL be the text defined in the Glossary for the card's colour, and the marker colour SHALL be a function of the card's colour only.
4. THE Level_Card SHALL show the stored colour of the Level_Entry and SHALL NOT compute a colour from `inkSpent` and `minimalInk` (the replay and the verifier own the colour).
5. WHEN the colour is `green` or `amber`, THE Level_Card SHALL show "won"; WHEN the colour is `red`, THE Level_Card SHALL show "not won"; WHEN the colour is `error`, THE Level_Card SHALL show "not judged" and the `reasonCode` of the Level_Entry when it has one; WHEN `timedOut` is true, THE Level_Card SHALL show "play timed out".
6. WHEN the Level_Entry has `inkSpent` and `minimalInk` that are finite non-negative integers, THE Level_Card SHALL show "ink spent N of minimal M" with those numbers; otherwise THE Level_Card SHALL show "ink not recorded".
7. WHERE the Level_Entry carries `endHp` as a finite non-negative number, THE Level_Card SHALL show "end HP N"; WHERE it does not, THE Level_Card SHALL omit the end HP. (The compact Level_Entry of `replay-runner` Requirement 9, criterion 1 has no `endHp` today; the developer decided that a separate `replay-runner` amendment adds it, so this page needs no change when it lands: Open question Q1, closed.)
8. WHEN a level id is in the newest Trend_Entry but not in `latest.levels`, THE Level_Card SHALL show the colour from the Trend_Entry and the text "no detail in the last run".
9. THE Level_Card SHALL show a trend: for each of the valid Trend_Entries that name the level, newest first and at most 30, the colour of that level in that run; a Trend_Entry that does not name the level SHALL give the colour `none`.
10. THE Level_Card SHALL give the trend a text equivalent, such as "Last 12 runs: 11 green, 1 amber", in the accessible name of the trend and visible as text, so that the trend is readable without colour.
11. THE View_Model SHALL order the trend newest first by `counter` descending (ties by `startedAt` descending, then `runId`), SHALL hold at most one Trend_Entry for each `runId`, and SHALL hold at most 30 entries, whatever the input holds.
12. THE Dashboard_Page SHALL draw the trend strip with the oldest run on the left and the newest on the right, and SHALL state this in the text "oldest to newest".
13. THE Dashboard_Page SHALL show a run-level trend line: the four counts of each Trend_Entry as text in a list or table, for the same entries.
14. THE test suite SHALL include a property test for each of: criterion 3; criterion 11 (no more than 30 entries, newest first, no repeated `runId`); and criterion 1 (one card for each distinct level id, ordered ascending).

### Requirement 5: Commit and time of the last replay, last hunt and job state

**User Story:** As the developer, I want the commit and time of the last replay and the last hunt, and the state of the nightly job, so that I know how fresh the picture is.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL show for the last replay: the short commit (the first 7 characters of `latest.commit`, the full hash in the element's `title` and in text for assistive technology), the time (`latest.finishedAt`, else `latest.startedAt`), and the state of the run.
2. THE Dashboard_Page SHALL show every time as UTC in the form `YYYY-MM-DD HH:MM UTC`, built by a pure function; WHEN a time string does not parse as an ISO 8601 date, THE function SHALL return the text "time unknown".
3. WHEN `latest.commit` is `null` or absent, THE Dashboard_Page SHALL show "commit unknown".
4. THE Dashboard_Page SHALL show for the last hunt, taken from the Findings_Value header: the time (`updatedAt`), the short commit, the Hunt_Id (`huntId`), and the counts `attempts`, `confirmed`, `rejected`, `error`, `duplicate` and `notRecorded` as text. There is no hunt cron, so the Findings_Value header is the only source.
5. WHEN a count of the header is not a finite non-negative integer, THE Dashboard_Page SHALL show "unknown" for that count.
6. THE Dashboard_Page SHALL show for the Replay_Job: the last run time (`last_run_ts`), the last status (`last_status`), whether it is running now (`is_running`), the consecutive failures (`consecutive_failures`), the next run time (`next_run_ts`), and "paused" when `user_paused` is true or `enabled` is false.
7. THE function that reads `last_run_ts` and `next_run_ts` SHALL accept a finite number (seconds since the epoch when below 1e11, milliseconds otherwise) or an ISO 8601 string, and SHALL return "time unknown" for any other value (Assumption A-6).
8. WHEN `consecutive_failures` is a number greater than 0, THE Dashboard_Page SHALL show it with the text "consecutive failures" and the job area SHALL carry a warning label as text, not only a colour.
9. WHEN `is_running` is true, THE Dashboard_Page SHALL show the text "replay running now".
10. THE Dashboard_Page SHALL NOT show the `script`, `command`, `folder` or any path field of a cron job, because the Crons_Route returns an absolute path in `script` (E24 R6).
11. WHEN the time of the last replay (`latest.finishedAt` when it is a string, otherwise `latest.startedAt`) parses as an ISO 8601 date and is more than the Stale_Limit before the Now_Input, THE Dashboard_Page SHALL show the text "The last replay is older than 36 hours" next to the replay time. A time exactly 36 hours before the Now_Input is not stale. WHEN the time does not parse, is absent, or lies after the Now_Input, or WHEN the Now_Input is not a finite number, THE Dashboard_Page SHALL show no stale warning. A `finishedAt` string that does not parse gives "time unknown" and no stale warning; the page does not fall back to `startedAt` in that case.

### Requirement 6: Findings list

**User Story:** As the developer, I want the verified exploits listed with their level, class and action list, so that I can see how a level can be broken.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL show each valid Finding with: the level id, the class as a text label ("Cheaper win", "Free win", "Unexpected route"), the commit it was found on (short), the time it was found, the action list, and the result (`inkSpent`, `minimalInk`, `editCount`, `newEditAddresses`).
2. WHEN the class is not one of the three known classes, THE Dashboard_Page SHALL show the class string as text, capped at 40 characters, and SHALL still show the Finding.
3. THE Dashboard_Page SHALL show the Findings in the order of the stored items sorted newest first by `foundAt` descending, then `id` descending, and SHALL NOT show two Findings with the same level id, class and Token list (the first in that order stays).
4. THE Dashboard_Page SHALL show the action list as the Tokens separated by single spaces, in a monospace element that wraps long lines, so that a long list is readable without horizontal scrolling of the page.
5. WHEN `latest.commit` and the Finding's `commit` are both present and differ, THE Dashboard_Page SHALL label the Finding "found on an earlier commit". The hunt does not retire older Findings (exploit-hunt, Requirement 10, criterion 14), so a Finding can describe a commit that no longer exists.
6. THE Dashboard_Page SHALL describe the findings area in one sentence: "Every finding was reproduced by replaying its action list. The hunt is a bounded search, not a proof that no cheaper win exists."
7. WHEN the Findings_Value holds items that were dropped by validation or by the cap of Requirement 2, criterion 7, THE Dashboard_Page SHALL show the count of such items.
8. FOR ALL generated Findings_Values, THE findings view SHALL hold at most 20 Findings, no two with the same level id, class and Token list, in newest-first order.

### Requirement 7: Replay command and copy actions

**User Story:** As the developer, I want to copy a finding's action list and see the command that replays it, so that I can reproduce it myself.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL show for each Finding the Replay_Command, built by a pure function as `node scripts/play.mjs <level-id> --actions-file <actions-file>`, where `<level-id>` is the Finding's `levelId` and `<actions-file>` is the literal text `<actions-file>`. The command form is the play command of `replay-runner` Requirement 5, criterion 1 and of the exploit-hunt design (Hunt_Submit flow). The page does not know the path of any checkout or file, so next to the command it shows the help text: "Run it in a Grimsheet checkout after npm ci and npm run build:play (play.mjs stops with "Run npm run build:play first" without the bundle), with the path of a file that holds the Actions_File_Text."
2. WHEN the level id does not match `^[a-z0-9][a-z0-9-]*$`, THE Dashboard_Page SHALL NOT show a Replay_Command for that Finding and SHALL show "level id not valid".
3. THE Dashboard_Page SHALL show a copy button for the action list that copies the Tokens separated by single spaces.
4. THE Dashboard_Page SHALL show a copy button for the Replay_Command.
5. WHERE every Token of the Finding decodes, THE Dashboard_Page SHALL show a copy button for the Actions_File_Text and the text itself in a read-only block. The decoding rules are those of the exploit-hunt design ("Token grammar", Decode): `N`, `S`, `E`, `W` become `{"kind":"move","dir":"<letter>"}`, `wait` becomes `{"kind":"wait"}`, `undo` becomes `{"kind":"undo"}`, and `edit:ADDRESS=RAW` becomes `{"kind":"edit","address":"ADDRESS","raw":"<decoded RAW>"}`, with RAW decoded from percent-encoded UTF-8.
6. IF a Token does not decode (an unknown token, a bad escape, or bytes that are not valid UTF-8), THEN THE Dashboard_Page SHALL omit the Actions_File_Text for that Finding and SHALL show "action list could not be converted to a file", and SHALL still show the Tokens and their copy button.
7. THE Actions_File_Text SHALL be a JSON array (a bare action array is accepted by `play.mjs`, verifier design), written with two-space indentation, so that the user saves it to a file; the page SHALL NOT suggest passing JSON inline, because Windows PowerShell removes the quotes of inline JSON (`tech.md`).
8. FOR ALL valid action lists, encoding the list to Tokens by the canonical rule of the exploit-hunt design (upper-case hex, every byte outside `A-Z a-z 0-9 . _ -` as `%XX`) and decoding it with the page's decoder SHALL give the original action list (round trip). The test suite SHALL also decode the C3-f token of the exploit-hunt design to the edit value `=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")`.
9. THE decoder SHALL accept both cases of hex digits, SHALL reject a lone `%`, a `%` followed by fewer than two hex digits, and byte sequences that are not valid UTF-8, and SHALL NOT throw for any string.
10. THE exploit-hunt design gives no standalone command for a user to replay a Finding: `hunt-submit` charges an Attempt against an active hunt and is not a replay. The developer decided that the play command of the game itself is enough and that no replay-finding script is added (Open question Q2, closed), so the Replay_Command of criterion 1 is that play command.

### Requirement 8: Freshness: Refresh button, poll timer, visibility

**User Story:** As the developer, I want the page to update itself and to have a Refresh button, so that I see a finished run without reloading and without wasting requests.

#### Acceptance Criteria

1. WHEN the Dashboard_Page mounts, THE Dashboard_Page SHALL start one Read at once.
2. THE Dashboard_Page SHALL show a Refresh_Button; WHEN it is activated and no Read is in flight, THE Dashboard_Page SHALL start a Read at once.
3. WHILE a Read is in flight, THE Dashboard_Page SHALL NOT start another Read, whether the trigger is the Poll_Timer, the Refresh_Button or a visibility change; the Refresh_Button SHALL be disabled with `aria-busy` and a text "Reading".
4. WHILE the page is visible, THE Poll_Timer SHALL start a Read when the Poll_Interval has passed since the start of the previous Read, with the Poll_Interval at 60 seconds (decided; Open question Q5, closed).
5. WHILE the Replay_Job reports `is_running` as true, THE Poll_Timer SHALL use a Poll_Interval of 15 seconds, so that a finished run appears soon after it ends (replay runs seen in the spike took 7 to 60 seconds, E20).
6. WHILE the page is hidden (`document.visibilityState` is `hidden`), THE Poll_Timer SHALL start no Read.
7. WHEN the page becomes visible again, THE Dashboard_Page SHALL start a Read at once IF the last Read started more than one Poll_Interval ago, and otherwise SHALL schedule the next Read for the remaining time.
8. THE Dashboard_Page SHALL give each route request a time limit of 10 seconds. WHEN a request exceeds it, THE Dashboard_Page SHALL treat that route as failed for this Read and SHALL ignore the late answer.
9. THE Dashboard_Page SHALL discard the answer of a Read that was superseded or that finished after the page unmounted, and SHALL clear the Poll_Timer and any pending time limit on unmount.
10. THE Dashboard_Page SHALL show the time of the last successful read of each route ("Results read at", "Job state read at", UTC) and SHALL keep the earlier value when a later Read of that route fails.
11. WHEN one route succeeds and the other fails in the same Read, THE Dashboard_Page SHALL update the data of the route that succeeded and keep the last good data of the other.
12. THE Poll_Timer decisions SHALL be made by a pure function that takes the visibility, whether a Read is in flight, the start time of the last Read, the current time, the Poll_Interval and the `is_running` flag, and returns what to do (start now, wait N milliseconds, or do nothing). The component SHALL only carry out that decision.
13. FOR ALL sequences of ticks, visibility changes, Refresh activations and Read completions fed to the scheduler function, the number of Reads in flight SHALL never exceed 1, no Read SHALL start while the page is hidden, and every Read that starts SHALL end in a completion, a failure or a time limit.

### Requirement 9: Build, externals and load

**User Story:** As the developer, I want a page that builds to one module the host can load, so that it installs in Kiro Crew without a bundled SDK or React.

#### Acceptance Criteria

1. THE `ui/` project SHALL be a React and Vite project in TypeScript with `strict` set to true, and `npm run build` SHALL write one ES module `ui/dist/index.mjs`, the value of `ui.entry` (the edit of `app.json` belongs to `packaging`).
2. THE build SHALL mark `@kirocrew/app-sdk`, `react`, `react/jsx-runtime`, `react-dom` and `lucide-react` as externals, and SHALL NOT bundle them. The bundle of the spike imported `react/jsx-runtime` from the host (E10), so that specifier is an external too.
3. THE `ui/package.json` SHALL NOT list `@kirocrew/app-sdk` as a dependency, and `npm install @kirocrew/app-sdk` SHALL NOT be run.
4. THE Dashboard_Page SHALL import `@kirocrew/app-sdk` as a namespace (`import * as sdk`) typed as a record of unknown values, and SHALL check each export with `typeof` before use, because a missing named export fails the whole module at link time (E09, E10).
5. WHEN `useAppApi` is not a function, or calling it throws, THE Dashboard_Page SHALL show "Kiro Crew did not provide the app API" and SHALL NOT crash.
6. THE Dashboard_Page SHALL read the SDK hooks once at module load, so that the order of hooks is the same on every render (E10).
7. THE Dashboard_Page SHALL NOT import `@kirocrew/app-sdk/ui` (a static import of a module that the Host's import map does not resolve fails the whole page at link time, and a `typeof` check cannot guard a missing module, E09), and SHALL render with its own semantic elements. A test SHALL scan `ui/src/` and `ui/dist/index.mjs` and fail IF the specifier `@kirocrew/app-sdk/ui` appears.
8. THE Dashboard_Page SHALL have the page component as the default export of `ui/src` entry (A-11, E14).
9. THE Dashboard_Page SHALL take App_Name from a constant, and WHEN `useAppInfo` is available and returns a different `name`, THE Dashboard_Page SHALL still use the constant and SHALL show a notice with both names (Assumption A-1).
10. THE built bundle SHALL contain no absolute path, no user name, no token and no dashboard URL, and a test or build check SHALL scan `ui/dist/index.mjs` for a drive letter path, `Users\` and `token=`.
11. THE `ui/` build and tests SHALL NOT need the network after `npm install`.

### Requirement 10: Testability: pure functions, Vitest and fast-check

**User Story:** As the developer, I want the logic in pure functions with property tests, so that I can trust the page without a browser.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL implement in pure functions, in modules with no import of React or the SDK: the View_Model builder (Requirement 2), the colour and Colour_Label mapping, the trend builder, the findings view builder, the time formatter, the Token decoder and encoder, the Replay_Command builder, and the poll scheduler (Requirement 8, criterion 12).
2. THE test suite SHALL use Vitest and fast-check, and every property test SHALL use `numRuns` of at least 100 and a tag of the form `// Feature: dashboard, Property N: <title>`.
3. THE test suite SHALL include a property test that, for any JSON value as the config input and any JSON value as the crons input, the View_Model builder returns a View_Model and does not throw (Requirement 2, criterion 2).
4. THE test suite SHALL include a property test that, for any Level_Card, the Colour_Label equals the label of its colour (Requirement 4, criterion 3).
5. THE test suite SHALL include property tests for the trend (Requirement 4, criterion 11), the findings view (Requirement 6, criterion 8), the Token round trip (Requirement 7, criterion 8), the decoder's totality (Requirement 7, criterion 9) and the poll scheduler (Requirement 8, criterion 13).
6. THE test suite SHALL include a property test that a bad part never blanks the good parts: FOR ALL valid Results_Values and any single part replaced by an arbitrary JSON value, every other part of the View_Model is equal to the View_Model of the unchanged value.
7. THE test suite SHALL include a property test that the View_Model builder is deterministic (Requirement 2, criterion 8).
8. THE test suite SHALL render the components with `react-dom/server` and a fake SDK object; it SHALL NOT need a browser or the network.
9. THE test suite SHALL use fixtures derived from the shape of a real `data/config.json` of the replay smoke run, and SHALL contain no absolute path or user name in any fixture; a test SHALL scan the fixtures for a drive letter path and `Users\`. A fixture of the Crons_Route SHALL omit the `script` field or hold a placeholder.
10. THE test suite SHALL include generators (fast-check arbitraries) for valid Results_Values, for Findings_Values, for Token lists within the limits, and for arbitrary JSON, and SHALL build invalid values by corrupting a valid one.
11. THE test suite SHALL include a property test for the stale warning: FOR ALL Results_Values and all Now_Inputs, the View_Model shows the stale warning exactly when the replay time parses and is more than 129,600,000 milliseconds before the Now_Input; and example tests SHALL state the boundary (a time exactly 36 hours before the Now_Input is not stale, one millisecond more is), an unparseable time, an absent time and a time in the future (no warning).
12. THE type check (`tsc --noEmit`, strict) and the tests SHALL pass before the `ui/` task is marked done.

### Requirement 11: Accessibility and clipboard fallback

**User Story:** As a user of the page, I want it to work with a keyboard and without colour, and I want a copy action that still helps when the clipboard is not available.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL use semantic elements: a `main` landmark, `h1` to `h3` headings in order, `section` elements with accessible names, `ul` or `table` for lists of runs and findings, and `button` elements for actions.
2. THE Dashboard_Page SHALL NOT use colour as the only signal: every colour marker SHALL come with its Colour_Label text, every trend strip with its text equivalent, and every warning with a text.
3. THE Dashboard_Page SHALL give each marker colour a text contrast ratio of at least 4.5 to 1 against its background for the label text, in both the light and the dark theme of the Host, by using the Host's own text colour for labels and marker colours only as decoration (WCAG validation by assistive technology and expert review is not part of this spec).
4. THE copy buttons and the Refresh_Button SHALL be operable by keyboard (Tab, Enter and Space), SHALL show a visible focus indicator, and SHALL have an accessible name that includes the level id, for example "Copy action list for 02-the-chaser".
5. WHEN a copy succeeds, THE Dashboard_Page SHALL show "Copied" in a polite live region (`aria-live="polite"`) and SHALL clear it after 3 seconds.
6. WHEN `navigator.clipboard.writeText` is missing, or the call rejects or throws, THE Dashboard_Page SHALL try a selection-based copy, and WHEN that fails too, THE Dashboard_Page SHALL show the text in a read-only, focused and fully selected text area with the message "Copy is not available here. Select the text and press Ctrl+C.", in the same live region.
7. THE Dashboard_Page SHALL show the Refresh_Button's state in text and `aria-busy`, and SHALL announce "Results updated" in the live region only when the data changed, not at every poll.
8. THE Dashboard_Page SHALL respect `prefers-reduced-motion` and SHALL use no animation that is needed to read the content.
9. THE test suite SHALL check with `react-dom/server` that every Level_Card holds its Colour_Label text, every copy button is a `button` element with an accessible name, and the page holds one `main`.

## Assumptions

- **A-1. App name.** The App_Name is `grimsheet-playtester` (`replay-runner` assumption A-1). Settled by the `packaging` spec when `app.json` is final; the constant is one place to change.
- **A-2. Result shape.** The Results_Value has the shape in `scripts/replay/types.mjs` (`ResultsKey`, `CompactRun`, `TrendEntry`) and the exploit-hunt design (Findings_Value). The shape was read from the types and a real value of the replay smoke run (two runs, five levels, no `findings` key). Settled by a fixture test against a value written by the replay code, and later by a real hunt.
- **A-3. Trend order.** The replay writes `trend` newest first (`replay-runner` Requirement 9, criterion 1; the real value agrees). The page does not rely on it and sorts by `counter` (Requirement 4, criterion 11).
- **A-4. `@kirocrew/app-sdk/ui` is not used.** The docs list the components, but the spike never imported them, the export list of `@kirocrew/app-sdk` has no components of that kind (E14), and an unresolved static import fails the whole page. The page does not import the module and renders with its own markup (Requirement 9, criterion 7). Nothing to settle; a later spec may revisit it after a spike build.
- **A-5. How the Replay_Job is found.** The job is the entry of `jobs` whose `name` is exactly `replay` or ends with `/replay` (the spike's job showed as `crew-spike/probe` on the Schedule page, E20), or, when no name matches, whose `script` contains `replay_cron.py`. The page uses `script` only to find the job and never shows it. Settled by reading `/api/crons` of the installed app once (Open question Q3).
- **A-6. Time fields of `/api/crons`.** `last_run_ts` and `next_run_ts` are epoch seconds, epoch milliseconds or ISO strings; E24 names the fields but does not record their format. The parser accepts the three forms. Settled by one read of the route.
- **A-7. Findings stay.** A Finding is not retired when the commit changes (exploit-hunt Requirement 10, criterion 14); the page labels it instead and neither dims nor hides it (Requirement 6, criterion 5; Open question Q7, closed).
- **A-8. Size.** The config object can hold the Results_Value up to the replay's byte budget of 65536 bytes plus other keys; the page parses what the route returns and does not check the size. Settled by the `packaging` measurement of the route limit (Notes h.8). If the route cannot carry the budget, Requirement 3, criterion 9 shows the failure.
- **A-9. Poll cost.** Both routes are served by the local gateway and the config value is at most about 27 KB in the designs (exploit-hunt, "Size calculation": 10.6 KB replay value plus at most 16 KB findings). One Read a minute is a small load. Settled by no measurement; if the Host shows slowness, the interval is raised.
- **A-10. Clipboard.** The Host may or may not give the page a working `navigator.clipboard`; the page is not in an iframe (Notes f: the module is imported, no iframe). Settled by one click in the installed app.
- **A-11. Default export.** The default export of the entry is the page (E14). Settled in 0.12.0; a later Crew version may need `mountFunction`.
- **A-12. Local limits of the page.** The caps of 30 trend entries, 20 findings, 100 levels, 40 tokens and 140 characters per token are the page's own display limits. They follow the writers' limits (30 runs, 20 items, 40 tokens, a 132-character edit token) with some room. They are not read from the writers.

## Open questions

Closed by the developer's decisions:

- **Q1. End HP and "won" on the Level_Card. Closed.** The compact Level_Entry of `latest` has no `endHp` today. The developer decided that it gains `endHp` in a separate `replay-runner` amendment, made later in another session. This spec keeps Requirement 4, criterion 7 as written (show end HP when present, omit it otherwise) and derives "won" from the colour. Nothing changes here when the amendment lands.
- **Q2. Is the Replay_Command enough? Closed.** Yes: the play command is enough and no `replay-finding` script is added. Requirement 7, criterion 1 carries the help text about `npm ci`, `npm run build:play` and the file.
- **Q4. Shared components. Closed: not used.** The page does not import `@kirocrew/app-sdk/ui` (Requirement 9, criterion 7; A-4).
- **Q5. Poll interval. Closed.** 60 seconds, and 15 seconds while the replay job is running (Requirement 8, criteria 4 and 5).
- **Q6. Stale replay warning. Closed: added.** Requirement 5, criterion 11 and a property in Requirement 10, criterion 11. The View_Model builder takes the Now_Input (Requirement 2, criteria 1, 2 and 8).
- **Q7. Findings of an earlier commit. Closed.** The page keeps the label "found on an earlier commit" and neither dims nor hides the Finding (Requirement 6, criterion 5).

Still open:

- **Q3. Replay_Job identification (for `packaging`).** Which `name` or `script` value does the installed replay job carry in `/api/crons`? The page now also accepts a job named exactly `replay` (A-5). What would settle it: `packaging` reads `/api/crons` once on the installed app and records the job's `name`, `last_run_ts` format and `next_run_ts` format (A-5, A-6) in `docs/CREW_NOTES.md`.
- **Q8. Config route size limit (for `packaging`).** Not documented, not tested (Notes h.8, A-8). What would settle it: the `packaging` measurement.
- **Q9. `mountFunction` and per-page `entryPoint` (for `packaging`).** Found in the docs, not in the spike. What would settle it: a read of `kirocrew app info` or the manifest reference by the `packaging` spec when `app.json` is written; nothing changes here unless the default export stops working.
- **Q10. React version of the host (for `packaging`).** Which React version does the host provide, 18 or 19? Not recorded in the spike or the docs read. The page uses only APIs that exist in both (design, "React version"). What would settle it: `packaging` reads `React.version` once in the console of the installed page at the first install, and records it in `docs/CREW_NOTES.md`; the `ui/` dev dependency is pinned to one exact version at the task.
