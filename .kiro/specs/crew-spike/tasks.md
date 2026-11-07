# Implementation Plan: crew-spike

## Overview

This plan builds the throwaway Crew app in `spike/`, installs it on this Windows machine, and answers the three open questions in `docs/BRIEF.md` section 6 by observation. It follows the design's Order of work, P0 to P7, in that order. The language is plain ESM JavaScript for `spike/scripts/probe.mjs` and TypeScript strict for `spike/ui/`, as the design states.

The spike has no automated tests. Verification is observation plus evidence: each piece of evidence is a file in `spike/evidence/` with a row in `spike/evidence/INDEX.md`. The only automated check is `tsc --noEmit` for `ui/`. Steps that need the user are marked "(you)".

Rules that apply to every task:
- Nothing is filled from memory. An unanswered question is observed or recorded as still not documented (Requirements 2.4, 7.3).
- Evidence is scrubbed and checked for tokens before it gets an `INDEX.md` row. The dashboard token URL is never written down (Requirement 7.5).
- No git write command is run in this repository, and nothing is written to the Grimsheet repo (Requirements 9.1, 9.4).
- Notes statements from observation are marked Observed. Statements from the Context7 libraries are marked Context7 (Requirement 7.4).
- Every assumption id A-01 to A-23 from the design is closed or tested by at least one task below. Task 8.4 checks that none is left open.

## Tasks

- [ ] 1. P0: Read the docs and prepare evidence capture
  - [ ] 1.1 Read the available Crew guidance before building
    - If the `kirocrew-app-dev` skill is available in the session, read it and note which guidance is used. If it is not available, note that and continue.
    - Query Context7 `/kirodotdev/kirocrew` for: the paths that serve app files and storage, cron output and completion events, `permissions.api` and `permissions.events` shapes, `tools` and `allowedTools` values, and the `skill://` glob form.
    - Where `/kirodotdev/kirocrew` does not answer, query `/websites/deepwiki_kirodotdev_kirocrew`. Keep each question and result as a draft for Notes section h.2.
    - Fix the round 2 `permissions.api` and `permissions.events` values from what the docs list. If the docs list no path, leave them empty and record "no documented path".
    - Closes no assumption by itself. It settles the inputs that A-07, A-12, A-14 and A-17 are tested against.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 7.4_

  - [ ] 1.2 Create the evidence folder and index
    - Create `spike/evidence/INDEX.md` with the columns `id`, `requirement`, `date`, `what it shows`, `file`, `redaction checked`.
    - Add a short redaction check procedure at the top: pass text through the `scrub()` pattern and search for `token` before an index row is added.
    - Confirm the Playwright MCP server is listed in `.kiro/settings/mcp.json`. Screenshots are named `E<nn>-<slug>.png` with no token text in the name.
    - _Requirements: 7.1, 7.5, 7.6_

- [ ] 2. P1: Write the Spike_App
  - [ ] 2.1 Write `app.json`, the agent file and the skill directory
    - Create `spike/app.json` with the round 1 content from the design: `displayName`, `version` 0.0.1, one agent, one skill, one cron (`enabled: false`, `every: 120`, `timeout_secs: 900`, `env.SPIKE_TIMEOUT_SECS`), `permissions` with `cron: true`, empty `api` and `events`, `storage: true`, and the `ui` entry and page.
    - Create `spike/agents/probe-agent.json` with setup S1 (`resources: []`, no `tools`, no `allowedTools`, no `network`).
    - Create `spike/skills/probe-skill/SKILL.md` with `name`, `description`, `license`, `metadata` and the marker `lantern-kettle-4821`. Add `scripts/marker.mjs` (prints `SCRIPT-MARKER: kettle-orchard-7730`) and `references/note.md` (holds `REFERENCE-MARKER: orchard-lantern-1159`).
    - The files are written in this task. Install and load results come later, so A-06, A-07, A-08, A-09 and A-19 are tested in tasks 4.2, 6.2 and 7.2.
    - _Requirements: 1.1, 1.2, 1.5, 6.1, 9.2_

  - [ ] 2.2 Write `spike/scripts/probe.mjs`
    - ESM with `// @ts-check` and JSDoc types, Node built-ins only. Export `parseIndex`, `insertRun`, `patchRun`, `markStaleRunning`, `runStep`, `scrub`, `tailText` and `toModuleText`. Run `main()` only when the file is the entry point.
    - Implement the 11 steps in the design's probe order, with the step limits, the total budget (`SPIKE_TIMEOUT_SECS - 60`), `taskkill /PID <pid> /T /F` on timeout, and `shell: true` for child processes.
    - Rewrite the report atomically after each step. A failed step never stops the next one. Skip rules follow the design: the clone is skipped only when `git` is missing; steps 9 to 11 run whenever the clone succeeded.
    - Pick the data directory from `SPIKE_DATA_DIR`, otherwise `<script dir>/../data`, and record `dataDir.source`. Keep the index bounded at 5 runs. Mark older `running` entries `cut-short` with `inferredBy: "next-run"`. Write `spike-latest.mjs` into `SPIKE_SERVE_DIR` only when it is set.
    - Write only inside `dataDir` and `SPIKE_SERVE_DIR`. Exit 0 whenever a report was written.
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 9.1, 9.2_

  - [ ] 2.3 Write and type-check the `ui/` project
    - Create `spike/ui/package.json`, `tsconfig.json` (`strict: true`), `vite.config.ts` (library build to `dist/index.mjs`, with `@kirocrew/app-sdk`, React, ReactDOM and lucide-react as externals), `src/sdk.d.ts`, `src/routes.ts` and `src/index.tsx`.
    - Do not `npm install @kirocrew/app-sdk`. The local `sdk.d.ts` declares only the calls the page uses.
    - The page runs routes R1 to R7 on mount and on a Refresh button. Each row shows the route id, status (`data`, `empty` or `error`) and the first 300 characters of the result or error. It never hides a failure.
    - Run `npm install`, `npx tsc --noEmit` and the Vite build inside `spike/ui/`. Fix errors until both pass. Save the `tsc` output as evidence with an `INDEX.md` row.
    - Writes the code for A-11 and A-12; they are tested in task 6.1.
    - _Requirements: 3.4, 3.6, 3.7, 1.1_

  - [ ] 2.4 Run `probe.mjs` by hand from PowerShell
    - Run `node scripts/probe.mjs --trigger manual` from `spike/` with `SPIKE_DATA_DIR` unset, so the fallback directory is used. Check the report has all 11 steps, the index holds at most 5 runs, and a run repeated more than 5 times evicts the oldest report file.
    - Run it once with a bad step (for example a PATH without `git`) to confirm a failure does not hide later steps.
    - Save the report and `_index.json` as evidence with scrubbed `INDEX.md` rows. This checks the script itself only. It does not answer A-01 or A-04, which depend on the gateway shell.
    - _Requirements: 4.1, 4.8, 3.2, 7.5_

- [ ] 3. Checkpoint - Ensure the spike code runs before installing
  - Ensure `tsc --noEmit` passes, the hand run produced a full report, and no evidence row is missing. Ask the user if questions arise.

- [ ] 4. P2: Record versions, install, trust and enable
  - [ ] 4.1 Record the machine and Crew versions
    - Capture the Windows caption and version with `Get-CimInstance Win32_OperatingSystem`.
    - Run `kirocrew --version`. If the flag does not exist, record the error and take the version text from `kirocrew app info`, or "not available".
    - Save both as evidence. They go in the header of Notes section h.
    - Closes A-20.
    - _Requirements: 7.1, 1.4_

  - [ ] 4.2 Install the Spike_App, trust it and enable it (you)
    - Run `kirocrew app install <absolute path to spike>` and save the exact command and output. If it fails, record the command, the error text and the Notes section g step followed, and stop and report.
    - (you) Open the dashboard, go to Settings, Security, Third-party apps, and trust the app. Tell the assistant when done. Do not paste the token URL anywhere.
    - Run `kirocrew app enable crew-spike` and `kirocrew app info crew-spike`. Record the on-disk install path, whether `spike/` was copied or pointed at, and the exact error text for any rejected manifest field.
    - Closes A-02 (install path readable and shown by `app info`). Tests A-06 (`name`, `description`, `author` accepted), A-08 (the `icon` value), A-07 for the round 1 shapes, and A-19 for install-time acceptance of `license` and `metadata`. If the install rejects `license` or `metadata`, reinstall without them and keep the rejection text.
    - _Requirements: 1.3, 1.4, 1.5, 6.2, 6.6, 7.1, 9.2_

  - [ ] 4.3 Capture the dashboard views with the Playwright MCP
    - Open the dashboard through the Playwright MCP server using the token URL from `kirocrew token`. Do not record the URL.
    - Screenshot the Library tab, the sidebar and the Schedule page. Check each page does not display the token before saving. Describe each screenshot in words in its `INDEX.md` row.
    - If the Playwright MCP cannot reach the dashboard, (you) take the screenshots by hand and save them under `spike/evidence/` with the same naming rule.
    - Confirms A-08 (sidebar icon appears or is dropped).
    - _Requirements: 1.3, 7.5, 7.6_

- [ ] 5. P3: Run the cron command through the gateway
  - [ ] 5.1 Run the Probe_Cron once by hand from the Schedule page
    - Start the `probe` cron from the Schedule page (`enabled: false`). Use the Playwright MCP; if it cannot start the run, (you) press Run and tell the assistant.
    - Copy the new `runs/*.json` and `_index.json`. From the report record: `environment.cwd`, user, `PATH`, `envNames`, the shell and parent image, the `node`, `npm` and `git` versions, the HTTPS status, the clone mode, commit and duration, `npm ci` and `build:play` exit codes, `headlessJsExists`, and the `--list` output.
    - If `node scripts/probe.mjs` fails because the script or `node` is not found, record the failure text from the Schedule page, then retry with the absolute path from `kirocrew app info` or `where node`.
    - Record the full path where the file was actually written on this machine, and compare it with the data directory from `kirocrew app info`.
    - Closes A-01 (cwd), A-03 (`envNames` shows no data directory variable, or shows one), A-04 (`npm-version` result under `shell: true`), A-09 (`env` reaches the command; `enabled: false` allows a manual run) and A-23 (a run can be started by hand from the Schedule page).
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 9.1_

  - [ ] 5.2 Check the cron timeout behaviour
    - Edit `app.json` to set `timeout_secs` and `SPIKE_TIMEOUT_SECS` to 20, then reinstall (or apply the change by the method the app info shows, and record which one was needed). Run the cron once. The clone and build steps cannot finish in 20 s, so the report should stay `running`.
    - Run the cron again and check the older run is now `cut-short` with `inferredBy: "next-run"`. Record whether `timeout` or `timeout_secs` was honoured and in which unit.
    - Restore the 900 s value and reinstall. Record that the restore worked.
    - Closes A-05.
    - _Requirements: 4.6, 4.8_

  - [ ] 5.3 Record the second-run fetch behaviour and the cron output location
    - Run the cron again with the 900 s timeout. Check the `clone-or-update` step reports `mode: "fetch-reset"` and the same or newer commit.
    - Use the Playwright MCP to open the Schedule page for the run. Record where the command output appears (path, view or log), and describe the screenshot.
    - Closes the "output location not documented" gap in Notes section d. No assumption id maps only here; it supports A-01 and A-23.
    - _Requirements: 4.7, 3.8, 7.2_

- [ ] 6. P4: UI rounds, freshness and the scheduled run
  - [ ] 6.1 UI round 1: nothing declared
    - Open the Probe_Page with the Playwright MCP, with `permissions.api` and `permissions.events` empty. Record the row for each route R1 to R7, with the exact error text for each failure.
    - Check that the entry module's default export renders as the page, that the SDK calls in `sdk.d.ts` exist at runtime, and what R2 `getAppDataDir()` returns. Compare that value with `dataDir.path` from the report.
    - Closes A-11 (default export is the page component) and A-12 (SDK signatures match runtime). Tests A-07 for the undeclared case (R1).
    - _Requirements: 3.4, 3.5, 3.6, 3.3, 7.6_

  - [ ] 6.2 UI round 2: declare what the docs list
    - Edit `app.json` to version 0.0.2 with the `permissions.api` and `permissions.events` values fixed in task 1.1, and add `SPIKE_DATA_DIR` (the path from `kirocrew app info`) and `SPIKE_SERVE_DIR` (the installed `ui/` directory) to the cron `env`. Reinstall and run the cron once.
    - Record for each route R1 to R7: the result, the `permissions` entries it needed, and the response shape. If a route has no documented path, record "no documented path" and do not guess one.
    - If no documented route returns the cron's file, record every route tried with its error and test the Brief section 6 fallback (R4, the `spike-latest.mjs` module).
    - Closes A-07 (shapes of `permissions.api`, `events`, `storage`, with the accepted values or error text) and A-13 (a `.mjs` written after install under `ui/` is served and imported).
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7_

  - [ ] 6.3 Check freshness without reinstalling
    - Follow the design's freshness procedure: load the page and note the latest `counter` per route, let a new run finish, press Refresh and note any change, reload and note again, and compare R4 with and without the `?t=` cache-buster.
    - Record whether `useAppEvents` fired when the run finished and which event name. Record the answer to "needs `useAppEvents`, Refresh or a reload".
    - Adds to A-12 and A-13. No assumption id closes only here.
    - _Requirements: 3.7, 3.5_

  - [ ] 6.4 Scheduled run, then disable the cron
    - Enable the cron with `every: 120` by the Schedule page or an edit and reinstall. Record which method toggles it. Wait for one run with `trigger: "cron"` and copy the report.
    - Disable the cron again and use the Playwright MCP to capture the Schedule page showing it disabled. Record the toggle method.
    - Adds to A-09 and A-05. No assumption id closes only here.
    - _Requirements: 3.3, 3.2, 4.6_

- [ ] 7. P5: Agent runs A1 to A5 (at most five in total)
  - [ ] 7.1 Create the agent run ledger
    - Create `spike/evidence/agent-runs.md` as the working ledger with one row per run A1 to A5: run id, setup, date, what was asked, outcome and `unused` where a run was not needed.
    - Update the ledger after every run so the count is always visible. Stop at five.
    - Prepares task 7.5.
    - _Requirements: 5.7, 7.1_

  - [ ] 7.2 Run A1: setup S1 and the full network and clone checks (you)
    - Replace `<DATA_DIR>` in `probe-agent.json` with the recorded data directory. Record whether the agent edit needed a reinstall or took effect directly.
    - Start the agent from the dashboard chat. The Playwright MCP may start it; if it cannot, (you) start the Probe_Agent and send the prompt. (you) Answer any approval prompts and tell the assistant the exact prompt text.
    - Ask for the Requirement 5.1 checks: `PATH`, `node --version`, `npm --version`, `git --version`, HTTPS to `github.com`, shallow clone into `<DATA_DIR>/agent-grimsheet`, `node scripts/play.mjs --list` (with `npm ci` and `npm run build:play` first if `dist-play` is missing), then "list your tools", then the S1 skill question.
    - Record the tools it had and used, any block (message and the setting involved), and the difference from the cron result for each check.
    - Closes A-14 (default toolset without `tools` or `allowedTools`), A-15 (agent edits need a reinstall or not) and A-16 (the agent is started from the dashboard chat). Tests A-10 by showing whether the network was blocked.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.3, 6.4, 7.5_

  - [ ] 7.3 Run A2 and A3: skill setups S2 and S3 (you)
    - A2: set `resources` to `["skill://.kiro/skills/*/SKILL.md"]` and ask the agent to list visible skills and quote the marker. The result is `visible` only if the quote is `lantern-kettle-4821`. If A1 was blocked from the shell, also repeat the checks it could not do.
    - A3: set `resources` to the glob matching the install path recorded in task 4.2 (forward slashes first) and ask the same question. Then ask the agent to read `references/note.md` and run `node scripts/marker.mjs` from the skill folder, and record both markers.
    - (you) Answer approval prompts and start each run from the dashboard chat if the Playwright MCP cannot.
    - Record the working `skill://` glob, or that no tried form worked and what was seen. Record whether `license` and `metadata` were accepted or ignored at load time, and whether `scripts/` and `references/` were reachable.
    - Closes A-17 (the docs glob), A-18 (the install-path glob) and A-19 (`license` and `metadata` at load time).
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 5.3_

  - [ ] 7.4 Use reserve runs A4 and A5 only where needed (you)
    - A4: if A1 was blocked from the network, add `"network": true` and repeat the checks, and record whether any result changed. If A1 was not blocked, do not run A4 for the network comparison and record why. If a `tools` or `allowedTools` fix was needed, rerun the failed checks and record the field names and values taken from the docs.
    - A5: use it for the one result that is still ambiguous (for example a backslash `skill://` form, or a result that disagreed with the cron). Mark any unused run `unused` in the ledger.
    - (you) Answer approval prompts and start runs from the dashboard chat if the Playwright MCP cannot.
    - Closes A-10 (`network` has no runtime effect, or the observed effect), or records it as not needed with the reason.
    - _Requirements: 5.5, 5.6, 5.7, 6.5_

  - [ ] 7.5 Write the agent run ledger to Notes section h.5
    - Copy the ledger (run id, setup, date, what was asked, outcome, unused runs) into `docs/CREW_NOTES.md` section h.5. Check the total is at most five.
    - State in Notes the tools the agent had, any block and its setting, and each difference from the cron result.
    - If section h does not exist yet, create it first as described in task 8.1.
    - _Requirements: 5.2, 5.3, 5.4, 5.7, 7.1_

- [ ] 8. P6: Notes, Brief and steering
  - [ ] 8.1 Write the findings into `docs/CREW_NOTES.md` section h
    - Add `## h. Spike findings (crew-spike)` after section g with a header block: date, Windows version, Crew version, and the legend (Observed, Context7).
    - Add subsections h.1 Install and trust, h.2 Docs and skill consulted, h.3 UI data path, h.4 Cron: node, network, clone, build, h.5 Agent (written by task 7.5), h.6 Skill mapping, h.7 Cron output location, h.8 Still not documented.
    - Each subsection has four lines: Question, Answer, Basis, Evidence. Evidence lists the ids and describes each screenshot in words, with no links to screenshot files.
    - Add a results table for all assumptions A-01 to A-23 marked confirmed, refuted or still not documented.
    - Include no secrets, tokens or the dashboard token URL.
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 5.2, 5.4_

  - [ ] 8.2 Replace the "not documented" markers in sections a to g
    - For each gap that an answer settles, keep the original sentence word for word and append ` → answered in section h.N (observed <date>)`.
    - Do the same in `.kiro/steering/crew-app.md` and `.kiro/steering/dashboard.md`.
    - _Requirements: 7.2, 8.3_

  - [ ] 8.3 Update `docs/BRIEF.md` and the steering files
    - Apply the design's Downstream edits table to the Brief: the result-reading route (or the Brief section 6 fallback), the replay clone and build constraints, the hunt's network and `node` constraint, and the working `skill://` glob.
    - If the UI cannot read run output through a documented route, apply the Brief section 6 fallback before any later spec, and update `dashboard.md` "Data access", and `tech.md` where the clone or build result changes a statement.
    - List each changed Brief statement with the Notes section that justifies it.
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 8.4 Check the assumption table and evidence index
    - Check every assumption id A-01 to A-23 is marked in Notes as confirmed, refuted or still not documented. A-21 and A-22 stay open until task 10.2, so mark them "pending deletion" and update them there.
    - Check every `INDEX.md` row has `redaction checked` set, and search `docs/`, `.kiro/` and `spike/evidence/` for the token URL. Fix any hit.
    - _Requirements: 7.1, 7.3, 7.5_

- [ ] 9. Checkpoint - Ensure Notes and Brief are complete
  - Ensure every question is answered or recorded as not documented, the Brief and steering match the Notes, and no evidence row is missing. Ask the user if questions arise.

- [ ] 10. P7: Delete the spike
  - [ ] 10.1 Ask the user to confirm before any deletion (you)
    - (you) Review the Notes and Brief changes. Show the list of what will be deleted: the installed app, `<dataDir>` with the clones, and `spike/`. Wait for an explicit yes. Do not delete anything before it.
    - _Requirements: 10.2_

  - [ ] 10.2 Uninstall the app and delete its app data directory
    - Run `kirocrew app --help` to find the real uninstall command, and use it; `kirocrew app disable crew-spike` first if that command exists. Record the commands and output. Check with `kirocrew app info crew-spike` that the app is gone.
    - Before deleting `<dataDir>`, check the path is non-empty, absolute, and its last segment contains `crew-spike`. Record whether the directory was still there after uninstall. Remove it with `Remove-Item -LiteralPath <path> -Recurse -Force`. If a long path blocks it, record the error and retry with `cmd /c rmdir /s /q`.
    - Update Notes h.1 with the uninstall command and the data directory result.
    - Closes A-21 (the uninstall command) and A-22 (uninstall may leave the data directory).
    - _Requirements: 10.1, 9.2_

  - [ ] 10.3 Delete `spike/` and list what remains
    - Copy any remaining Notes updates first, since `spike/evidence/` is deleted with the folder. Delete `spike/` whole with `Remove-Item -LiteralPath d:\Projects\Kiroween\grimsheet-playtester\spike -Recurse -Force`, including `node_modules`, `ui/dist` and screenshots. Confirm it is gone.
    - List the remaining files with `Get-ChildItem -Recurse -File` excluding `.git`. Show the user that only `.gitignore`, `LICENSE`, `KIRO_USAGE.md`, `docs/` and `.kiro/` remain, and that `.kiro/specs/crew-spike/` is still there.
    - Run no git write command.
    - _Requirements: 10.3, 10.4, 10.5, 9.4_

- [ ] 11. Update `KIRO_USAGE.md`
  - [ ] 11.1 Write the crew-spike entry
    - Add an entry for this spec: what Kiro did during the spike (docs read, app built, installs, cron and agent runs, Notes and Brief edits, deletion), the number of agent runs used out of five, and each decision that changed because of the answers.
    - Name no AI tool other than Kiro.
    - _Requirements: 8.4_

## Notes

- Tasks marked "(you)" need the user: trusting the app, answering approval prompts, starting an agent run when the Playwright MCP cannot, and confirming before deletion.
- There are no test, property-test, Vitest or fast-check tasks, and no `spike/dev` task. The spike is observation. `tsc --noEmit` for `ui/` is the only automated check.
- Assumption coverage: A-01, A-03, A-04, A-09, A-23 (5.1); A-02, A-06, A-07, A-08, A-19 (4.2); A-05 (5.2); A-11, A-12 (6.1); A-07, A-13 (6.2); A-14, A-15, A-16 (7.2); A-17, A-18, A-19 (7.3); A-10 (7.4); A-20 (4.1); A-21, A-22 (10.2). Task 8.4 checks the full table.
- Evidence lives in `spike/evidence/` until task 10.3 deletes it, so Notes describe each screenshot in words.
- The agent run ledger is capped at five runs (Requirement 5.7).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2"] },
    { "id": 6, "tasks": ["4.3"] },
    { "id": 7, "tasks": ["5.1"] },
    { "id": 8, "tasks": ["5.2"] },
    { "id": 9, "tasks": ["5.3"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.2"] },
    { "id": 12, "tasks": ["6.3"] },
    { "id": 13, "tasks": ["6.4"] },
    { "id": 14, "tasks": ["7.1"] },
    { "id": 15, "tasks": ["7.2"] },
    { "id": 16, "tasks": ["7.3"] },
    { "id": 17, "tasks": ["7.4"] },
    { "id": 18, "tasks": ["8.1"] },
    { "id": 19, "tasks": ["7.5"] },
    { "id": 20, "tasks": ["8.2"] },
    { "id": 21, "tasks": ["8.3"] },
    { "id": 22, "tasks": ["8.4"] },
    { "id": 23, "tasks": ["10.1"] },
    { "id": 24, "tasks": ["10.2"] },
    { "id": 25, "tasks": ["10.3"] },
    { "id": 26, "tasks": ["11.1"] }
  ]
}
```
