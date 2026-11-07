# Tech

## Stack
- Host needs Node 22.12+ and git; the README says so. Dev machine is Windows with PowerShell.
- Scripts: plain ESM JavaScript with JSDoc types and `// @ts-check`, so a cron runs them with no build step.
- `ui/`: TypeScript strict, React and Vite (as the Crew docs require). The host provides `@kirocrew/app-sdk`, React, ReactDOM and lucide-react, so they are build externals. Do not `npm install @kirocrew/app-sdk`; it is not published to npm.
- Tests: Vitest for the verifier, the result index and the replay script (with a fake play command); fast-check for properties. No test depends on the network.
- No paid APIs, no hosting. MIT licence. Written from scratch: it runs Grimsheet's command and does not copy Grimsheet code.

## Verifier
A pure function from (level id, action list, `play.mjs` output) to a verdict, unit-tested without Grimsheet.

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
