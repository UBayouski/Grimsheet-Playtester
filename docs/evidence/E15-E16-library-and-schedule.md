# E15 and E16: Library and Schedule views (task 4.3)

date: 2026-11-07, about 10:11Z. Same Playwright session as E14. Neither screenshot shows an address bar or the token.

## E15-library.png (Library tab, /apps/library)

In words: the Library page "Manage your installed apps" with "1 update available / View updates". An "Enabled 3" group lists Command Bar (No sidebar page), Crew Spike (In sidebar) and Task Runner (In sidebar). A "Disabled 20" group lists built-in apps (Agent Worlds, Auto-Improvement, Research Lab, AWS Control, Code Review Sage, Crew Companion, Design Critique, Design Tweak, Dev Fleet, Files, Issue Radar, Notes, Meetings, Mochi, Ops Mission Control, Papyrus, Personal Shopper, PPTX Maker, Create Folders From Project, Spec Builder), each with an Enable button.

Sidebar (seen in E14 and here): under Apps, "Crew Spike" appears with a "Pop out app to its own window" button, next to Task Runner. The sidebar shows the page label and an icon.

## E16-schedule.png (Schedule page, /schedule)

In words: "Schedule — Manage recurring cron jobs and scheduled tasks", tabs List, Calendar, Executions, then "No scheduled jobs yet" and pre-made templates. The page text does not mention crew-spike, Crew Spike or probe, also after waiting 3 s.

The app's cron `probe` (`enabled: false`, a `command` cron) is not listed on the Schedule page. Possible causes, none confirmed: the cron is disabled; command crons count as "manifest shell code" that the install warning said was not registered until trusted; or app crons are listed elsewhere (Executions tab not opened). This is the first question for task 5.1.

Side check: a page-context `fetch('/api/cron')` returned 404. That path was a guess, not from the docs, and is not used as a route.

## Readings

- Requirement 1.3: the app appears in the Library (Enabled, In sidebar) and in the sidebar. It does not appear on the Schedule page (see above).
- A-08 (the `icon` value is a lucide-react name): the sidebar entry shows an icon with no error. Whether it is the FlaskConical glyph is not confirmed from the snapshot. Supported, not closed.
