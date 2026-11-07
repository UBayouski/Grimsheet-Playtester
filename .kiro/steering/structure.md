# Structure

Planned layout (BRIEF sections 5 and 7). Only `docs/`, `.kiro/` and the top-level files exist today. Do not create the other folders until a spec task calls for them.

```
app.json                  Crew manifest
agents/
  playtester.json         reads levels, writes candidate action lists, never edits Grimsheet
skills/
  play-level/SKILL.md     build and run the command, read the result
  find-exploits/SKILL.md  three exploit classes, attempt budget, candidate file format
scripts/                  ESM JS with JSDoc and // @ts-check; no build step
  replay.mjs              nightly replay entry point (cron command)
ui/                       React + Vite + TypeScript strict dashboard
tests/                    Vitest and fast-check; no network
docs/
  BRIEF.md                product brief (input for Kiro)
  CREW_NOTES.md           Crew facts with sources and "not documented" gaps
.kiro/
  steering/               product, tech, structure, crew-app, dashboard
  specs/                  crew-spike, verifier, replay-runner, exploit-hunt, dashboard, packaging
KIRO_USAGE.md             Kiro usage log
```

## Conventions
- Skill folders hold a required `SKILL.md`; optional `scripts/`, `references/`, `assets/`.
- Agents are JSON files listed in `app.json` `agents`; skills are directory paths listed in `app.json` `skills`.
- Run output (result files and bounded index) lives in the app data directory, not in the repo. How the UI reads it is an open question (spec 1, `crew-spike`).

## Spec order
1. crew-spike (throwaway; findings go to `docs/CREW_NOTES.md`, code deleted)
2. verifier
3. replay-runner
4. exploit-hunt
5. dashboard
6. packaging
