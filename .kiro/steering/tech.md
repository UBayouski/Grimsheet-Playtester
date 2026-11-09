# Tech

## Stack
- Host needs Node 22.12+ and git; the README says so. Dev machine is Windows with PowerShell. **Only Windows was tested** (Crew 0.12.0, KiroCrew desktop app); the README says so unless a WSL check is done.
- Scripts: plain ESM JavaScript with JSDoc types and `// @ts-check`, so a cron runs them with no build step. The only Python is the cron launcher (standard library only), because a Windows gateway rejects `command` crons and runs `script` crons in Python (spike E18, E20; Notes h.4).
- `ui/`: TypeScript strict, React and Vite (as the Crew docs require). The host provides `@kirocrew/app-sdk`, React, ReactDOM and lucide-react, so they are build externals. Do not `npm install @kirocrew/app-sdk`; it is not published to npm.
- Tests: Vitest for the verifier, the result index and the replay script (with a fake play command); fast-check for properties. The Python launcher is tested with `unittest` from the standard library. No test depends on the network.
- No paid APIs, no hosting. MIT licence. Written from scratch: it runs Grimsheet's command and does not copy Grimsheet code.

## Verifier
A pure module, `scripts/verifier.mjs`, with two functions: `replayVerdict(levelId, storedSolution, exitCode, playResult)` and `checkCandidate(levelId, storedSolution, claimedClass, candidateActions, exitCode, playResult)`. Signatures and result shapes are in `.kiro/specs/verifier/design.md`. Unit-tested without Grimsheet.

## Properties to test
- Same play output gives the same verdict.
- The result index never holds more than 30 runs and keeps the newest.
- A candidate is recorded only if replaying it reproduces its claimed class.

## Grimsheet command contract (the target)
- `npm ci`, then `npm run build:play` writes `dist-play/headless.js`.
- `node scripts/play.mjs --list` lists level ids; `<level-id> --level-info` describes a level.
- `node scripts/play.mjs <level-id> --actions-file <path>` prints JSON: `start`, one entry per step (`accepted`, `damage`, `hero`, `hp`, `ink`, `turn`, `status`), and `final`. Won means `final.status === "won"`; ink spent is `start.ink - final.ink`. Exit 2 means bad input.
- Actions: `{"kind":"move","dir":"N|S|E|W"}`, `{"kind":"wait"}`, `{"kind":"edit","address":"B14","raw":"7"}`.
- `tests/solutions/<level-id>.json` holds `levelId`, `minimalInk`, `actions`.
- On Windows PowerShell inline JSON arguments lose their quotes: always use `--actions-file`.

## Kiro CLI name
The Crew docs use the `kirocrew` CLI, not `kiro-cli`. On this machine `kirocrew` (0.12.0) is bundled with the KiroCrew desktop app and is not on PATH, so call it by full path:
`& "C:\Program Files\KiroCrew\resources\backend-dist\kirocrew-backend\bin\kirocrew.cmd" <args>`.
Do not install or build Kiro Crew. `kiro-cli crew` only forwards to the Crew CLI and needs it on PATH. `kirocrew app uninstall` preserves app data by default.

## Hooks (planned)
Run Vitest on save for `scripts/**` and `ui/src/**`; type-check and lint before the agent finishes a task.

## Replay launcher (decided by the spike, 2026-11-07)
- A Python `script` cron (`scripts/replay_cron.py:run`, standard library only) starts `node scripts/replay.mjs` with `subprocess` and waits (E20). It never raises the runner's Done or Skip.
- The script's working folder is the KiroCrew install folder and the manifest `env` does not reach it (E20). The launcher finds its files from `__file__` and reads settings (repo URL, branch) from a control file `data\launcher\control.json`, written without a BOM (E24). Sync keeps `data\` and replaces `scripts\`, so settings live in `data\`.
- Cron fields: `timeout` (seconds) sized for clone, `npm ci`, `build:play` and all replays; `timeout_secs` at least `timeout + 5` (E21).
- The Grimsheet clone is in `%LOCALAPPDATA%\<app>` (built in Node/Python from the environment, never hard-coded), not in the app folder or `data\` (E17, E25, E27).
- Results: the run writes a results key into `data\config.json` (read, merge, temp file in `data\`, rename; E24 R3b). It must hold everything the page needs, because the page can read no other file: the latest run, the trend of the last 30 runs and the verified findings, kept compact. The route returned values up to 1 MiB in full (no limit found; packaging task 13, E40); the results key keeps its own budget of 65536 bytes. Two writers (replay and hunt) need one shared module with a lock file. Fallback: a `.mjs` module under `ui\` rewritten at the start of each run (Sync deletes it).

## Shell-agnostic rules for skills and agent prompts
The agent shell on Windows is PowerShell 5.1, and git's stderr progress text shows as `NativeCommandError` while the exit code is 0 (E28). Other hosts may differ. So:
- A skill tells the agent to run only `node scripts/<name>.mjs <args>`. No `&&` or `;` chains, pipes, redirects, `cd`, `$env:` or `$VAR`, and no inline JSON (PowerShell removes its quotes).
- Candidates are written to files and replayed with `--actions-file <path>`. Paths are built inside Node, never typed into a prompt or skill.
- Success is the exit code plus the JSON the script prints, never stderr text.
- The agent has `"tools": ["execute_bash"]` and no `allowedTools`: each shell command and the skill load asks for an approval (3 to 12 per run in the spike).

## Watch items
- Gateway warning (E28): `node`, `npm` and `git` on PATH "do not resolve under the trusted system directories ... so it is treated as unavailable; OS introspection that needs it degrades". Commands still ran. Re-check after a Crew update.

## Evidence ids
Evidence ids (E01 to E29) refer to `docs/evidence/INDEX.md`; the files are in `docs/evidence/`.
