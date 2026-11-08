---
name: play-level
description: Read a Grimsheet level and the result of a replayed candidate through the hunt scripts. Use when studying a level, or when reading what a submitted candidate did.
license: MIT
metadata:
  author: Grimsheet Playtester
  version: "1.0.0"
---

# Read a Grimsheet level and a result

This skill is about reading. The budgets, the candidate format and the order of calls are in the find-exploits skill. Load that skill first.

Hunt_Begin prepares the game for you. Nothing here asks you to prepare anything. You only run the four hunt scripts, one command at a time.

## How to run a script

The hunt scripts are in the scripts folder of the find-exploits skill. The skill load for find-exploits reports its folder. In a command, SKILL_FOLDER stands for that folder: write the folder in its place.

Run each command exactly as given and append nothing: no semicolon, no echo of an exit-code variable, no quotes around the script path, and nothing before or after the command. The user sees the command in the approval prompt, which is the only place where an addition would show. Wait for the answer to each approval. Ignore stderr text. Read the JSON the script prints and its exitStatus field.

## Read a level

Run Hunt_Info once for each level:

```
node SKILL_FOLDER/scripts/hunt-info.mjs --level 02-the-chaser
```

It prints the level description from the game and the stored solution. The description comes from the game's own level-info command: title, hint, starting HP, ink, hero, monsters, map and cells. The stored solution is the intended route. It gives minimalInk, the fewest formula edits the intended route needs, and the route itself written as tokens. The description lists only the cells that matter: the rule panel, unlocked or named cells, formulas and cells with more than one character. The plain map tiles are in map. If the description is too large, the script refuses with the reason code level_info_too_large and prints nothing of it.

The current stored routes fit the limits for candidates, so you can send any cell text from them back as it is, in percent form.

## The actions

- A move goes one cell north, south, east or west: N, S, E, W.
- wait lets a turn pass without moving.
- undo reverts the last accepted turn or edit and refunds its ink. It goes back one step only: a second undo in a row is refused.
- An edit changes the text of one cell. It costs 1 ink when the formula changes.

A zero-edit probe uses only moves and waits. Its ink spent is then 0.

## Read a result

Every Hunt_Submit prints one JSON value. Read these fields:

- outcome: confirmed, rejected, error, duplicate, not_recorded or refused.
- reasonCode and reason: the verdict and the plain sentence. Learn from a rejection.
- won, inkSpent, minimalInk, editCount, newEditAddresses: what the replay measured. Ink spent is the start ink minus the final ink.
- play: steps, finalStatus, finalHp, firstRefused and firstStatusChange. Steps are counted from 0 in the order of your tokens. Actions after the game ends are refused. firstStatusChange is the first step where the game status changes, and it is the place to look: it shows where the level was won or lost.
- left: attempts left on this level, attempts left in total, refusals left and seconds left.
- finished: true when the hunt is over.
- exitStatus: 0 when the call was carried out, 3 when it was refused, 4 when a record could not be written.

An exit status of 2 from the game itself is not shown. It appears as the reason code bad_input.

## Ideas taken from the Grimsheet play-level skill

Only these ideas were taken: the description of the three action kinds plus undo, the fields of the play output, the meaning of exit 2, and the tip that a zero-edit probe uses only moves and waits. No text or code of the Grimsheet repository is copied.
