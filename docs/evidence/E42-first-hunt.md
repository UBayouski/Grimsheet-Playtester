# E42: the first agent-run hunt on the installed app (packaging task 15)

date: 2026-11-08. Crew 0.12.0, app grimsheet-playtester 1.0.0, Grimsheet commit bea7a52. Paths use ~ and %LOCALAPPDATA%. The approval prompts show the full skill path, which holds the Windows user name; no prompt was filmed or screenshotted uncropped, and nothing from a prompt is copied here with the path.

## Chat (user report)
- Approval mode Normal, one-time approve only. Steps in the chat, one approval each: Load skill find-exploits (1), Start the exploit hunt (1), Read level info 01 to 05 (5), Try ... (9 submits), End the hunt (1): 17 in all. No play-level skill load, no refused call, no denial, no command with anything added to it. The 1800 s budget did not end the hunt (81 s); the agent stopped by choice after 9 of 20 attempts.
- Approval card options seen: not recorded (the user did not report them). Open question 11 of the exploit-hunt spec stays open.
- Usage line (credits, elapsed time, model): not recorded (the user did not report it). The credits per hunt stay unmeasured.
- What the dashboard shows for the hunt: not recorded (the user did not report it).

## Final summary of the agent, verbatim (the user's paste; it holds no path)
> Hunt id: hunt-20261108T235753Z. I used 9 of 20 attempts and had 0 refusals. 3 were confirmed and 6 were rejected. The hunt took 81 seconds.
> Confirmed:
> 03-the-locked-crypt, cheaper_win: I made one edit, B14 set to =1337/RUNE_SALT, then walked east. It won with 1 ink. The stored route needs 2. The finding id is hunt-20261108T235753Z-003.
> 05-the-lich, unexpected_route: I edited B16 to 0 and B18 to 0, then walked. It won with 2 ink, and B18 is a cell the stored route never edits. The finding id is -006.
> 02-the-chaser, unexpected_route: I edited B15 to 0 so the monster can't hurt the hero, then walked around it. It won with 1 ink, and B15 is a new cell. The finding id is -008.
> Rejected (all not_won):
> 02-the-chaser: Three tries. Two were no-edit walks and both lost. The third edited B15 and kept the stored path, and the monster blocked the way.
> 05-the-lich: Editing only B16 lost. The hero's HP reached 0 at step 5.
> 04-the-trap-row: Editing B16 left the divide-by-zero in place, so the level didn't end.
> 03-the-locked-crypt: Three edits were more than the 2 ink allowed.
> I made no attempts on 01-the-corridor, because it has 0 ink and no cell to edit. This was a bounded search of 9 candidates, so it doesn't prove that no cheaper win exists on levels 1, 2, 4 and 5.

- The explanations are the agent's wording, not verified facts. One line is inexact against the record: for 03-the-locked-crypt the summary says "Three edits were more than the 2 ink allowed", while the Hunt_Record only shows that attempt (candidate 009, unexpected_route) as `not_won`. The counts, the finding ids and the ink figures agree with the Hunt_Record and with the findings below.

## data\hunts\hunt-20261108T235753Z.json (1441 bytes, read only)
- state complete; startedAt 2026-11-08T23:57:53.832Z; readyAt 2026-11-08T23:58:00.567Z; finishedAt 2026-11-08T23:59:22.191Z; repoUrl https://github.com/UBayouski/Grimsheet; branch main; commit bea7a5238a3e882de188d8e884d43ea5f26e58eb.
- budget perLevel 4, total 20, seconds 1800, refusals 10; levelsSkipped 0; attempts 9; refusals 0; findingsKey ok; pendingFindings []; failure null.
- levels: 01-the-corridor 0 attempts; 02-the-chaser 4 attempts, 1 confirmed, 3 rejected; 03-the-locked-crypt 2 attempts, 1 confirmed, 1 rejected; 04-the-trap-row 1 attempt, 1 rejected; 05-the-lich 2 attempts, 1 confirmed, 1 rejected; no error, duplicate or notRecorded.
- reasonCodes: not_won 6; class_reproduced 3.
- No .hunt.lock, .run.lock, .results.lock, .hunt-call.lock or active.json was left in data\.

## playtesterResults.findings in data\config.json (read only; the file is 4855 bytes)
- Header: schemaVersion 1; updatedAt 2026-11-08T23:59:22.187Z; commit bea7a52...; huntId hunt-20261108T235753Z; counts attempts 9, confirmed 3, rejected 6, error 0, duplicate 0, notRecorded 0.
- Items (all commit bea7a5238a3e882de188d8e884d43ea5f26e58eb):
  - hunt-20261108T235753Z-003, 03-the-locked-crypt, cheaper_win, found 23:58:44.977Z, actions `edit:B14=%3D1337%2FRUNE_SALT E E E E E E E E E`, result won, inkSpent 1, minimalInk 2, editCount 1, no new edit address, class_reproduced (407 bytes).
  - hunt-20261108T235753Z-006, 05-the-lich, unexpected_route, found 23:59:00.950Z, actions `edit:B16=0 edit:B18=0 N N E E E E E E E E E`, won, inkSpent 2, minimalInk 2, editCount 2, new edit address B18, class_reproduced (412 bytes).
  - hunt-20261108T235753Z-008, 02-the-chaser, unexpected_route, found 23:59:10.264Z, actions `edit:B15=0 N N E E E E E E E E E S S`, won, inkSpent 1, minimalInk 1, editCount 1, new edit address B15, class_reproduced (409 bytes).
- Sizes (UTF-8 bytes of compact JSON): Results_Key 2715; findings 1475; latest 828; trend 323 (one entry); 5 levels. The parts add up: 58 + 828 + 323 + 19 + 12 + 1475 = 2715. The sizes were taken from the file; no read of the route was made.

## Files the hunt created (listed, none deleted)
- ~\.kiro\crew\apps\grimsheet-playtester\data\hunts\hunt-20261108T235753Z.json
- The `findings` key in data\config.json.
- %LOCALAPPDATA%\grimsheet-playtester\hunt\ (new): grimsheet\ (the hunt checkout: 7014 files, with .git and node_modules, HEAD bea7a52) and candidates\hunt-20261108T235753Z\ with nine files: 001-05-the-lich-cheaper_win.json (731 bytes), 002-02-the-chaser-cheaper_win.json (761), 003-03-the-locked-crypt-cheaper_win.json (649), 004-02-the-chaser-cheaper_win.json (761), 005-04-the-trap-row-unexpected_route.json (636), 006-05-the-lich-unexpected_route.json (812), 007-02-the-chaser-unexpected_route.json (842), 008-02-the-chaser-unexpected_route.json (842), 009-03-the-locked-crypt-unexpected_route.json (794).
- Attempts by order: 001 05 cheaper_win rejected; 002 02 cheaper_win rejected; 003 03 cheaper_win confirmed; 004 02 cheaper_win rejected; 005 04 unexpected_route rejected; 006 05 unexpected_route confirmed; 007 02 unexpected_route rejected; 008 02 unexpected_route confirmed; 009 03 unexpected_route rejected.

## Clipboard check on the findings
- Not recorded: the user reported no result for Copy action list, Copy replay command or Copy actions file. The copy buttons now exist (the hunt recorded three findings), so the check can still be done; it stays open.

## Open question for the Grimsheet repository (not acted on)
- 03-the-locked-crypt has a confirmed cheaper win: one edit of B14 wins with 1 ink, against a stored minimum of 2. Whether to fix the level or accept a new minimum is a decision in the Grimsheet repository; this app writes nothing there.
