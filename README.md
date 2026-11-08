# Grimsheet Playtester

*The night watch for a haunted spreadsheet.*

Grimsheet Playtester is a Kiro Crew app that replays every Grimsheet level each night and sends an agent to break them. It is the Kiro Crew companion to the Grimsheet entry:

- Grimsheet, the game: https://github.com/UBayouski/Grimsheet
- Play it live: https://grimsheet.onrender.com

Grimsheet has five levels. Each has a stored solution and a `minimalInk` (the fewest formula edits that win). Unit tests check the stored solutions, but nobody checks whether a change made a level easier than intended. This app does, and it never writes to the Grimsheet repository.

## What it does

There are two jobs.

**The nightly replay (no model call).** A scheduled job fetches the `main` branch of Grimsheet, records the commit hash, builds it, plays every stored solution through Grimsheet's own play command, and writes the results. Each level gets a colour:

- green: the stored solution still wins, with ink spent equal to `minimalInk`
- red: it no longer wins
- amber: it wins, with a different ink count

The dashboard also shows a fourth state, "Not judged", for a level that the verifier could not judge (for example when its stored solution file is missing).

**The hunt, on request.** You start it from a chat with the `playtester` agent. The agent studies the levels and proposes action lists. A deterministic verifier replays every proposal, and only a proposal that reproduces its claim is recorded. A proposal that does not reproduce is counted, not shown. A recorded finding has one of three classes:

- cheaper win: won with ink spent below `minimalInk`
- free win: won with zero edits on a level whose `minimalInk` is above 0
- unexpected route: a win that edits a cell the stored solution never touches

The hunt is a bounded search and not a proof that no cheaper win exists. It runs on request only, started by you from chat. There is no schedule for it. A scheduled job that starts the agent was tried: its first approval was rejected after about three minutes while the job still reported OK, and `allowedTools` has no effect on an app agent. So the hunt has no cron, and nothing here claims that a hunt can run unattended.

## Install (from a clone)

This was run on Windows 11 with Kiro Crew 0.12.0 (the KiroCrew desktop app), one user on one machine, and only Windows was tested. macOS, Linux and WSL were not tested.

Prerequisites:

- Node 22.12 or later and git, both on PATH.
- Python available to the Crew gateway for the scheduled job (the Crew bundle supplies it).
- Network access to the Grimsheet repository.

The built page `ui/dist/index.mjs` is committed, so you do not build anything to install.

1. Clone this repository into a new, empty folder.

   ```powershell
   git clone https://github.com/UBayouski/Grimsheet-Playtester.git
   ```

2. Install it with the Crew command line. On this setup the command line is bundled with the desktop app and is not on PATH, so call it by the path built from `$env:ProgramFiles`. Give the absolute path of the clone.

   ```powershell
   & "$env:ProgramFiles\KiroCrew\resources\backend-dist\kirocrew-backend\bin\kirocrew.cmd" app install "<absolute path of the clone>"
   ```

   Expect exit code 0 and a line that says the app was installed, with a warning that executable resources (agents, skills and crons) are not registered until the app is trusted. The install copies the whole folder, `data\` included, and drops every `.git` and `node_modules` folder. That is why you install from a fresh clone.

3. Trust and enable the app in the dashboard: Settings, Security, Third-party apps. The command `kirocrew token` prints a dashboard access address; open it in your browser and do not share it. The install output suggests `kirocrew app enable`; trusting and enabling in the dashboard is what was done and tested here. A reinstall, an uninstall followed by an install, or a Sync after a failed Sync needs trust again.

4. Check what you should see afterwards: the app under Enabled in the Library, a sidebar entry, the `replay` job on the Schedule page, and the agent and the two skills in the Resources list of the app's Details.

Things to know:

- The gateway may log a warning that `node`, `npm` and `git` on PATH do not resolve under the trusted system directories, and treat them as unavailable for operating-system introspection. The commands still ran. Check again after a Crew update.
- Do not run a Sync while a replay or a hunt is active, or while the folder `~\.kiro\crew\apps\.grimsheet-playtester-data-tmp` exists.
- An uninstall leaves `<app folder>\data`, a cron history file and conversation pointers behind. Removing them by hand may need `attrib -r` on read-only files. Nothing here deletes anything for you.
- Installing straight from a git address (`kirocrew app install <git-url>`) is not documented and was not tried. Use the clone.

## Developer path

The root project needs no `npm install` for the app to run, because the scripts import no package. To work on the project:

```powershell
npm ci
npm test
npm run typecheck
```

To rebuild the page, run these in the `ui/` folder, and rebuild before each commit that touches `ui/`:

```powershell
npm ci
npm run build
```

The build writes `ui/dist/index.mjs` and checks it. `npm run test:all` runs the whole gate one step at a time: the root tests, the root typecheck, the launcher tests, the `ui/` tests, the `ui/` typecheck, and a check that the committed `ui/dist/index.mjs` equals a fresh build.

To update an installed copy, use the **Sync** button in the app's Details. The command `kirocrew app update <name> --source <dir>` failed while the desktop gateway was running.

## When things run, and what you see

- The nightly replay runs at 03:00 America/Los_Angeles, and only while the machine and the Crew gateway are running. If they are not, that run is missed.
- The dashboard page shows the levels, the trend of the last runs and the verified findings. The Executions tab of the Schedule page shows the state of the job. The page polls every 60 seconds (every 15 seconds while the replay runs) and has a Refresh button, because nothing signals that a run has finished.
- The replay reads a fresh clone of Grimsheet that it keeps in `%LOCALAPPDATA%\grimsheet-playtester`, outside the app folder.
- The dashboard reads results and never writes them.

## The hunt: approvals, budgets and cost

The agent runs under approvals. The default approval mode is **Normal**: each command the agent runs is shown to you first, and you approve it. Expect about one approval per hunt command, and roughly 30 for a full hunt: one to begin, one per level to read it, up to 20 submissions, one to end, and the loads of the skills. Charged refusals add more, at most 10.

- You may switch the chat session of a hunt to the selector option **Trust** at your own choice. It approves every tool in that session. That option has not been tested here.
- This README does not recommend **YOLO**: it auto-approves every tool in every chat.
- **Reads** is not a way to skip the prompts of the hunt. It approves read-only shell commands only, and the hunt commands are `node` commands that write files. That is expected from the documentation and was not tested.

Budgets: 4 attempts per level, 20 attempts per hunt, 1800 seconds, and 10 refusals. In the default mode every submission is one approval and one agent turn, and credits are limited, so the budgets are small.

Credits per full hunt are not measured. What was seen: a short supervised run cost 0.1 to 0.4 credits, and one run in which a long tool call failed cost 7.86 credits.

## Limits

- Findings from an earlier Grimsheet commit are labelled as such and are not retired.
- A Sync while a run is active can fail and leave `.grimsheet-playtester-data-tmp` behind.
- The size limit of the config route that carries the results is not measured yet; the results are kept within 65536 bytes by design.
- The code has a branch for ending a process on other systems (`process.kill(-pid, 'SIGKILL')`). It exists and has not been run.
- The Crew bonus claim of this project rests on the `playtester` agent, its two skills, the nightly replay job and the dashboard. A hunt job is not part of it.

## Licence

MIT, see `LICENSE`. This app is written from scratch: it runs Grimsheet's play command and does not copy Grimsheet code. It uses no paid APIs and no hosting.

The facts and evidence behind the install steps are in `docs/CREW_NOTES.md` and `docs/evidence/INDEX.md`.
