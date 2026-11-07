# Product: Grimsheet Playtester

A Kiro Crew app that replays every Grimsheet level each night and sends an agent to break them.
Tagline: The night watch for a haunted spreadsheet.

Hackathon: Kiroween 2026, Best Kiro Crew App bonus, attached to the Grimsheet entry (category Frankenstein).
Deadline Dec 4, 2026, 2:00 PM PT. Feature freeze Nov 28.

## Who it is for
The developer of a puzzle game who needs to know after every change: do all levels still have their intended solution, and has a level become easier than intended. Grimsheet (https://github.com/UBayouski/Grimsheet, branch `main`) has five levels, each with a stored solution and a `minimalInk` (fewest formula edits). Unit tests check the solutions; nobody checks for new cheap routes.

Pitch: an agent proposes exploits, a deterministic engine checks every claim before it is recorded. No finding reaches the dashboard unless replaying its action list reproduces it.

## Two jobs
- Replay (nightly, no model call): a cron `command` fetches Grimsheet `main` into the app data directory, records the commit hash, builds it, plays every stored solution, writes one result file per run and updates a bounded index (last 30 runs).
- Hunt (weekly and on request, agent run): the `playtester` agent with the `find-exploits` skill studies each level and proposes action lists. The verifier replays each one. Only verified candidates are recorded; rejected ones are counted, not shown. The attempt budget per level is fixed in the skill.

## Level colours
- green: the stored solution still wins with ink spent equal to `minimalInk`
- red: it no longer wins
- amber: it wins with a different ink count

## Exploit classes
- cheaper win: won with ink spent below `minimalInk`
- free win: won with zero edits on a level whose `minimalInk` is above 0
- unexpected route: a win that edits a cell the stored solution never touches

## Non-goals
- Writing to the Grimsheet repo in any way (no commits, branches, issues, pull requests).
- An exhaustive solver or proof that no cheaper win exists. The hunt is a bounded search and the README says so.
- Other games, a hosted version, accounts, notifications outside Crew.
- Editing levels or suggesting fixes automatically.

## Source of truth
`docs/BRIEF.md` is the product brief. Crew facts come from `docs/CREW_NOTES.md`. Where the notes say "not documented", say so; do not fill gaps from memory.
