# Requirements Document

## Introduction

`crew-spike` is a throwaway. It builds the smallest Kiro Crew app that answers the three open questions in `docs/BRIEF.md` section 6, on this Windows machine, using only the documented behaviour in `docs/CREW_NOTES.md` as its starting point. Each answer is recorded with evidence in `docs/CREW_NOTES.md`, `docs/BRIEF.md` is updated where an answer changes the design, and the spike code is deleted at the end.

The three questions:
1. How does the `ui/` page read a file that a cron command wrote?
2. Can a cron command and an agent run reach the network, clone a public GitHub repo, and find `node` on the path?
3. How does a skill listed in `app.json` map into the agent's `skill://` resources?

All spike code lives in `spike/` at the repo root (`spike/app.json`, `spike/agents/`, `spike/skills/`, `spike/scripts/`, `spike/ui/`). The spike proves answers only. It is not the replay runner, the verifier or the dashboard, and none of its code is reused.

## Glossary

- **Spike_App**: the throwaway Crew app built by this spec.
- **Probe_Cron**: a cron in Spike_App that runs a `command` with no model call.
- **Probe_Agent**: the agent in Spike_App, run on request.
- **Probe_Skill**: the skill in Spike_App, listed in `app.json` `skills`.
- **Probe_Page**: the `ui/` page of Spike_App.
- **Evidence**: a captured command line, its output or exit code, a file path with contents, or a screenshot, with the date it was taken.
- **Notes**: `docs/CREW_NOTES.md`.
- **Brief**: `docs/BRIEF.md`.
- **Public_Test_Repo**: `https://github.com/UBayouski/Grimsheet`, branch `main`, cloned shallow.

## Requirements

### Requirement 1: Smallest installable Spike_App

**User Story:** As the developer, I want the smallest Crew app that can be installed locally, so that every later probe runs inside a real app.

#### Acceptance Criteria

1. THE Spike_App SHALL contain only `app.json`, one agent file, one skill directory, one Node probe script (`spike/scripts/probe.mjs`) run by a cron command, and a `ui/` project with one page, all inside `spike/`. THE Spike_App SHALL NOT use the Python cron `script` form.
2. THE `app.json` SHALL declare `displayName`, a semver `version`, `agents`, `skills`, `crons`, `permissions` with `cron: true`, and `ui`, following `docs/CREW_NOTES.md` section a.
3. WHEN the Spike_App is installed with `kirocrew app install` using an absolute local path, trusted as a third-party app (dashboard Settings, Security, Third-party apps, as in `docs/CREW_NOTES.md` section g) and then enabled, THE Spike_App SHALL appear in the Library tab, the sidebar and the Schedule page. THE spike SHALL record the exact steps taken, including the trust step.
4. IF installation or enabling fails, THEN THE spike SHALL record the exact command, error output and the step of `docs/CREW_NOTES.md` section g that was followed.
5. WHERE a field's behaviour is marked "not documented" in the Notes, THE spike SHALL treat it as an unknown to be observed, not as an assumption.

### Requirement 2: Read the docs and skill before probing

**User Story:** As the developer, I want the spike to use the available Crew guidance first, so that probes test real gaps and not things the docs already answer.

#### Acceptance Criteria

1. WHEN the `kirocrew-app-dev` skill is available in the session, THE spike SHALL read it before building Spike_App and SHALL record which of its guidance was used.
2. IF the `kirocrew-app-dev` skill is not available, THEN THE spike SHALL record that it was unavailable and continue with the Context7 library `/kirodotdev/kirocrew`.
3. WHEN `/kirodotdev/kirocrew` does not answer a question, THE spike SHALL query the Context7 library `/websites/deepwiki_kirodotdev_kirocrew` and record the question asked and the result.
4. THE spike SHALL NOT fill a gap from memory; an unanswered question SHALL be answered by observation or recorded as still not documented.

### Requirement 3: Question 1, UI reads a file a cron command wrote

**User Story:** As the developer, I want to know how the Probe_Page can read a file written by the Probe_Cron, so that I can choose the result storage format.

#### Acceptance Criteria

1. THE Probe_Cron SHALL write a small JSON file containing a timestamp and a run counter to a location chosen from what the Notes document (the app data directory).
2. THE Probe_Cron SHALL also write a bounded index file listing the last N runs, matching the `_index.json` suggestion in Notes section f.
3. WHEN the Probe_Cron is run by hand and by schedule, THE spike SHALL record where the file was actually written on this machine, as a full path. THE scheduled run SHALL use a short `every` interval (for example 120 seconds) for the spike only, and THE spike SHALL disable the Probe_Cron again once the scheduled run is recorded.
4. THE Probe_Page SHALL try to read the written file through each route the spike can find in the docs, including `useAppApi()` against a declared `permissions.api` path and any SDK storage or app-data call, and display the result of each attempt (data shown, empty, or error text).
5. WHEN a route returns the file contents, THE spike SHALL record the route, the `permissions` entries it required, and the response shape.
6. IF no documented route returns the file, THEN THE spike SHALL record every route tried with its error, and SHALL test the fallback in Brief section 6 (writing results where the documented API can serve them).
7. THE spike SHALL record whether the Probe_Page sees a changed file without reinstalling the app, and whether `useAppEvents` or a reload is needed.
8. THE spike SHALL record the path of cron output in the dashboard Schedule page, to settle the "output location not documented" gap in Notes section d.

### Requirement 4: Question 2, network, clone and node from a cron command

**User Story:** As the developer, I want to know what a cron command can do on this machine, so that I can decide whether the replay job can fetch and build Grimsheet.

#### Acceptance Criteria

1. WHEN the Probe_Cron runs, THE Probe_Cron SHALL write a probe report containing: the working directory, the user, the value of `PATH`, the output of `node --version`, `npm --version` and `git --version` (or the error for each), and the shell used.
2. WHEN the Probe_Cron runs, THE Probe_Cron SHALL attempt an HTTPS request to `github.com` and record the status or error.
3. WHEN the Probe_Cron runs, THE Probe_Cron SHALL attempt a shallow clone of the Public_Test_Repo into the app data directory and record the exit code, duration, the resulting commit hash, and the error text on failure.
4. WHEN the clone succeeds, THE Probe_Cron SHALL attempt `npm ci` and `npm run build:play` in the clone and record the exit codes and whether `dist-play/headless.js` exists, so that the replay job's build step is proven or disproven.
5. WHEN the clone succeeds, THE Probe_Cron SHALL run `node scripts/play.mjs --list` in the clone and record the output.
6. THE Probe_Cron SHALL record the cron `timeout` it ran under and whether any step was cut short by it.
7. WHEN a clone already exists in the app data directory, THE Probe_Cron SHALL fetch and reset instead of cloning, and record that the second run did so.
8. THE probe report SHALL be written even when individual steps fail, so that one failure does not hide the others.

### Requirement 5: Question 2, network, clone and node from an agent run

**User Story:** As the developer, I want the same facts for an agent run, so that I know whether the hunt job can run the Grimsheet command itself.

#### Acceptance Criteria

1. WHEN the Probe_Agent is run on request, THE Probe_Agent SHALL execute the same checks as Requirement 4 (PATH, `node`, `npm`, `git`, HTTPS to `github.com`, shallow clone, `scripts/play.mjs --list`) through its own tools and report each result.
2. THE spike SHALL record which tools the Probe_Agent had (`tools`, `allowedTools`) and which of them it used.
3. IF the Probe_Agent is blocked by a tool restriction, approval prompt or sandbox rule, THEN THE spike SHALL record the exact message and the setting involved.
4. THE spike SHALL record any difference between the cron command result and the agent result for each check.
5. IF the first Probe_Agent run is blocked from the network, THEN THE spike SHALL record whether `permissions.network` changed any observed result, by running the checks with and without the permission declared.
6. IF the first Probe_Agent run is not blocked from the network, THEN THE spike SHALL record that the `permissions.network` comparison was not needed and why.
7. THE spike SHALL use at most five Probe_Agent runs in total across Requirements 5 and 6, to save Kiro credits.

### Requirement 6: Question 3, skill mapping into `skill://`

**User Story:** As the developer, I want to know how a skill in `app.json` reaches the agent, so that the `playtester` agent loads `play-level` and `find-exploits` correctly.

#### Acceptance Criteria

1. THE Probe_Skill SHALL be a directory with a `SKILL.md` containing `name` and `description` frontmatter and a body with a unique marker phrase, listed in `app.json` `skills`.
2. WHEN Spike_App is installed, THE spike SHALL record the on-disk install path of the Probe_Skill, found with `kirocrew app info` or the file system.
3. THE Probe_Agent SHALL be tried with each of these `resources` setups in turn: no `skill://` entry; the glob form shown in the docs; a glob matching the recorded install path.
4. FOR EACH setup, THE spike SHALL ask the Probe_Agent to list the skills it can see and to quote the marker phrase, and SHALL record whether the skill was visible.
5. THE spike SHALL record the working `skill://` glob, or record that none of the tried forms worked and what was observed.
6. THE spike SHALL record whether the `license` and `metadata` frontmatter fields (used by the `grimsheet-playtest` play-level skill) are accepted or ignored, by adding them to the Probe_Skill and observing the install and load.
7. THE spike SHALL record whether a skill directory's extra files (`scripts/`, `references/`) are reachable by the agent at the install path.

### Requirement 7: Evidence

**User Story:** As the developer, I want each answer backed by evidence, so that the Notes can be trusted by later specs.

#### Acceptance Criteria

1. THE spike SHALL record each answer in the Notes as a new dated section stating the question, the answer, the Evidence, the Windows version and the Crew version observed.
2. WHEN an answer replaces a "not documented" marker in the Notes, THE spike SHALL edit that marker to point to the new section and SHALL keep the original wording of the gap visible.
3. IF a question cannot be answered, THEN THE spike SHALL record what was tried, what was seen, and that the item stays not documented.
4. THE spike SHALL mark every Notes statement that comes from observation on this machine as such, separate from statements that come from the Context7 libraries.
5. THE spike SHALL NOT include secrets, tokens or the dashboard token URL in recorded Evidence, in screenshots, or in screenshot file names.
6. WHEN a check needs someone to look at the dashboard (Requirements 1.3, 3.4, 3.7 and 3.8), THE spike SHALL perform it with the Playwright MCP server, save screenshots under `spike/`, and describe each screenshot in the Evidence.

### Requirement 8: Update the Brief and steering

**User Story:** As the developer, I want the design documents to follow the answers, so that later specs start from facts.

#### Acceptance Criteria

1. WHEN an answer contradicts or settles a statement in the Brief, THE spike SHALL update that statement in the Brief and list each change with the Notes section that justifies it.
2. WHEN the UI cannot read run output through a documented route, THE spike SHALL apply the fallback of Brief section 6 to the Brief before any later spec is written.
3. WHEN an answer settles a gap marked "not documented" in `.kiro/steering/crew-app.md` or `.kiro/steering/dashboard.md`, THE spike SHALL update those steering files to match the Notes.
4. THE spike SHALL record in `KIRO_USAGE.md` what Kiro did during the spike and what decisions changed because of it.

### Requirement 9: Bounded and safe

**User Story:** As the developer, I want the spike to stay small and harmless, so that it does not cost time or touch anything it should not.

#### Acceptance Criteria

1. THE spike SHALL NOT write to the Grimsheet repository in any way; it only clones it read-only.
2. THE Spike_App SHALL write only inside its own app data directory and `spike/`.
3. THE spike SHALL use no paid APIs and no hosting.
4. THE spike SHALL NOT run git write operations in this repository (commit, stash, push, reset) as part of its tasks.
5. THE spike SHALL be finished within the Nov 8 to Nov 9 window in Brief section 9.

### Requirement 10: Delete the spike code

**User Story:** As the developer, I want the throwaway removed, so that the real app starts clean.

#### Acceptance Criteria

1. WHEN all answers are recorded and the Brief is updated, THE spike SHALL uninstall Spike_App with `kirocrew` and delete its app data directory including the Public_Test_Repo clone.
2. THE spike SHALL delete the spike code only after the user confirms the Notes and Brief changes are complete.
3. WHEN deletion is done, THE spike SHALL list the remaining files in the repository to show that only `docs/`, `.kiro/`, `KIRO_USAGE.md` and the other pre-existing files remain.
4. WHEN deletion is done, THE spike SHALL have deleted `spike/` whole, including `node_modules`, build output and screenshots.
5. THE spec files in `.kiro/specs/crew-spike/` SHALL remain as the record of the spike.
