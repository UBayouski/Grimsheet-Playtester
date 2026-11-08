# E31 - Hunt checks, Run 1 (checker-ask, no allowedTools): C4 and C3 (2026-11-07)

Agent run 1 of at most 5 (13.11). Started by the developer in chat with agent `checker-ask`; the developer approved each prompt. Windows user name and home path are written as `%USERPROFILE%`. The "received by Node" column comes from the assistant's reading of the raw log `%LOCALAPPDATA%\hunt-checks\argv-log.jsonl` (one line per call, written by the script itself), not from the agent's own report.

Run facts (dashboard display, as reported by the developer): model shown as `auto`, 7.86 credits, 5 min 21 s, 2026-11-07 17:28 local. Tool calls listed in the transcript: 1 skill load, 1 `Get-Content` of `references/commands.md`, 6 `node` commands (C4-1, C3-a, C3-b, C3-c, C3-d, C3-f). C3-e did not run (see below).

## C4 - script location (13.13)
- The skill load reported the folder `%USERPROFILE%\.kiro\crew\apps\hunt-checks\skills\probe-skill` (the installed app path, not the junction `~\.kiro\crew\skills\hunt-checks\probe-skill`). The agent used that path for every command: yes, the load reports the folder.
- Command run (path shortened in the prompt list by the UI, see below): `node %USERPROFILE%\.kiro\crew\apps\hunt-checks\skills\probe-skill/scripts/import-probe.mjs`, exit 0, stdout `{"ok":true,"exports":{"SHARED_CONSTANT":"hunt-checks-shared-7421"},"error":null}`.
- Raw log: `here` = `realHere` = `%USERPROFILE%\.kiro\crew\apps\hunt-checks\skills\probe-skill\scripts\import-probe.mjs`; `cwd` = `%USERPROFILE%\.kiro\crew\workspace` (not the app folder). The relative import `../../../scripts/shared.mjs` resolved to the App_Folder `scripts/shared.mjs`: yes.
- Extra check by the assistant, not an agent run (a plain `node` call from the assistant's shell): running the same script through the junction path `%USERPROFILE%\.kiro\crew\skills\hunt-checks\probe-skill\scripts\import-probe.mjs` also resolved the import (`ok: true`, same stdout, exit 0). Node reported `here` as the real path (`...\apps\hunt-checks\...`) even when started through the junction, so a script started through the junction still imports from the installed app folder. The junction target is `%USERPROFILE%\.kiro\crew\apps\hunt-checks\skills\probe-skill`.
- Conclusion for A-16: a thin entry script in the skill folder can import a module of the App_Folder `scripts/` folder by relative path (`../../../scripts/<module>.mjs`), whether it is started by the apps path or the junction path.

## C3 - what reaches Node (13.12)
The agent ran the commands from `commands.md` (it reported the file text unchanged except for the substituted folder). Received by Node (raw log, JSON array of `process.argv.slice(2)`):

| case | command argument as written in commands.md | received by Node |
|---|---|---|
| C3-a | `--actions 'edit:B14==IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")'` | `["--actions","edit:B14==IF(DIST(HERO,SELF)<1,TOWARD(HERO),-)"]` (2 args; the two double quotes around `-` are gone) |
| C3-b | `--actions 'edit:B14==IF(DIST(HERO,SELF)<1,TOWARD(HERO),%22-%22)'` | `["--actions","edit:B14==IF(DIST(HERO,SELF)<1,TOWARD(HERO),%22-%22)"]` (2 args, unchanged) |
| C3-c | `--actions N E wait undo` | `["--actions","N","E","wait","undo"]` (5 args: each token separate) |
| C3-d | `--actions 'p%41%;q'` | `["--actions","p%41%;q"]` (2 args, unchanged: `%` and `;` survive inside single quotes) |
| C3-e | `--actions '<1000 characters>'` | NOT RUN: the agent reported that its tool call was cut off while it wrote the 1000-character argument, so nothing ran (no exit code, no log line). The log shows a gap of about 5 minutes between C3-d (01:23:46 UTC) and C3-f (01:28:40 UTC). Needs a spare run (Open item below). |
| C3-f | `--actions N edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29 E` | `["--actions","N","edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29","E"]` (4 args; the 74-character encoded edit value arrived unchanged as one argument) |

Findings so far (C3-a to C3-d, C3-f):
- PowerShell 5.1 removes double quote characters inside a single-quoted argument before Node sees them (C3-a). A literal `"` therefore cannot be sent; it must be written as `%22`.
- With `%22` the same value arrives intact (C3-b). `%`, `;`, `:`, `=`, `(`, `)`, `,`, `<` inside a single-quoted argument arrive unchanged (C3-a, C3-b, C3-d).
- An unquoted space-separated list arrives as separate arguments (C3-c, C3-f). A fully percent-encoded edit value contains no character that PowerShell treats specially, and it arrived as one argument (C3-f).
- NOT shown yet: a single-quoted argument that holds spaces (the written C3-a example has none), and a 1000-character argument (C3-e).

## Approvals and the gateway log (13.4, 13.12; read only, this session only)
Source: the gateway's own session log for this one chat (`~\.kiro\crew\crew-log\sessions\<session id>\log.jsonl`, agent `checker-ask`). No other session was opened. Event counts: 47 events; 8 `tool/called`, 8 `approval/requested`, 8 `approval/decided` with `decision: approved` (none denied, none other), 9 `tool/completed`.

- **Number of approval prompts: 8** (approval ids 2 to 9; there is no id 1 in this session's log). The developer's first count of 9 was a miscount; the developer's second count (8 tool calls, 8 approvals expected) matches the log.
- Each prompt: tool `disclose_context` with reason "Load skill: probe-skill" (id 2); tool `run_command` with the reason text equal to the full command line (ids 3 to 9). The gateway's approval record holds the whole command, including the double quotes of C3-a as the agent typed them and the full 74-character value of C3-f. The dashboard list shows each command cut off with "…" (as seen in the transcript the developer pasted), so the cut-off is a display matter, not a limit of what is asked.
- The approvals were: skill load (1), `Get-Content "~\.kiro\crew\apps\hunt-checks\skills\probe-skill\references\commands.md"` (1), then `node <skill folder>/scripts/...` for C4-1, C3-a, C3-b, C3-c, C3-d and C3-f (6). That is 8 approvals for 8 tool calls.
- Allow-at-once option (13.4): the developer reports that no prompt offered "allow for this session", "always allow" or a similar option. The log has no field for such an option, so this rests on the developer's report.
- The agent did not change any command from `commands.md`; the commands in the approval records equal the file lines with the folder substituted (backslashes, then `/scripts/...`).

## C3-e: why it did not run, and what the log shows
- No approval was requested for C3-e: the agent never made that tool call. The log has one `tool/completed` event with `status: failed`, `is_error: true`, `result_bytes: 583` and no matching `tool/called` or `approval/requested` event. It completed 281 seconds after the previous tool result (C3-d, 01:23:46Z, the same clock as the argv log) and about 5 seconds before the next `tool/called` (C3-f). The agent's own summary says its tool call was cut off while it wrote the 1000-character argument and nothing ran.
- Reading: the agent (model `auto`) could not produce the 1000-character argument as a tool call; the failure happened before any prompt or shell. The shell's handling of a 1000-character argument was therefore NOT measured, and the way the approval prompt shows a long argument was NOT observed. The developer decided not to spend a spare run on C3-e. What can be said: with this agent and model, one attempt to emit a 1000-character literal argument failed (a string of 1000 repeated `A`; a different string might behave differently, which is not tested), so candidate length is bounded in practice by what the agent can write in one tool call. The longest argument the agent did write and Node did receive is 74 characters (C3-f).
- Not tested (no run spent): a single-quoted argument that holds spaces (the C3-a example has none). Not needed if the design passes the Candidate_Text as an unquoted token list (C3-c, C3-f show that arrives as separate arguments).

## Credits and time (13.7)
- Dashboard display, as reported by the developer: 7.86 credits, 5 min 21 s, model shown as `auto`, 2026-11-07 17:28 local. The gateway's `turn/completed` event for the same turn records `credits: 7.858406725538972`, `duration_ms: 320766`, `model: auto`, 10 model calls, 22,774 context tokens used of a window of 1,000,000.
- Time: of the 320.6 s of the turn, 281 s sit between the C3-d result and the failed C3-e call; the first seven tool calls took about 20 s and the C3-f call about 8 s, including the approvals.
- The spike's agent runs cost 0.17 to 0.9 credits (h.5). This run cost about 9 to 46 times as much. Likely cause (a hypothesis, not measured: the log has no credits per model call): the long failed generation, and ten model calls with a growing history. Credits for the title call alone were 0.025 (`background/completed`, kind `title`).
- Question for the design: choose a cheaper model in the agent file (`model` field, Notes b); the agent files of this check set no `model` and ran on `auto`.