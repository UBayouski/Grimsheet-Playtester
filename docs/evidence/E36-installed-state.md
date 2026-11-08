# E36: what the gateway stored after the install, trust and enable (packaging task 11)

date: 2026-11-08. Crew 0.12.0. Paths use ~. The secret file of the app folder was not read.

## kirocrew app info grimsheet-playtester (after trust and enable)
- name grimsheet-playtester, version 1.0.0, enabled true, installedAt 2026-11-08T20:13:11Z, updatedAt 2026-11-08T20:17:36Z.
- source: `~\crew-install-src\grimsheet-playtester` (the folder that was installed from), origin registry, resources gateway, lifecycle gateway, schemaVersion 2, dev false.
- approvedGrantsStored true; approvedGrants: api [`/api/apps/grimsheet-playtester/config`, `/api/crons`], events [].
- manifest as stored: name, version, displayName, description, author UBayouski, agents [agents/playtester.json], skills [skills/play-level, skills/find-exploits], crons [{name replay, cron_expr "0 3 * * *", script scripts/replay_cron.py:run, timezone America/Los_Angeles, timeout 900, timeout_secs 905, strict_schedule true}], ui {entry dist/index.mjs, pages [{route /apps/grimsheet-playtester, label Grimsheet Playtester, icon Ghost}]}, permissions {api [two paths], cron true}.
- Differences from app.json: the cron's `enabled: true` is not stored (default); key order differs; nothing else.

## ~\.kiro\agents\grimsheet-playtester--playtester.json
- name playtester; description as in agents/playtester.json; tools ["execute_bash"]; resources ["skill://~/.kiro/crew/apps/grimsheet-playtester/skills/*/SKILL.md"]; prompt unchanged from agents/playtester.json (about 1,900 characters, not copied here); mcpServers {} (added by the App Kit); no allowedTools; no model.

## ~\.kiro\crew\apps\grimsheet-playtester\approved-grants.json
- api [`/api/apps/grimsheet-playtester/config`, `/api/crons`]; events []; linkPreviewHosts, linkPreviewTextPatterns, linkPreviewFullUrl, messageActions, linkOpenHosts, linkOpenFullUrl, composerActions, selectionActions: all [].

## Top-level entries of the installed app folder
.github, .kiro, agents, data, docs, scripts, skills, tests, ui, .gitattributes, .gitignore, app-crons.json, app.json, approved-grants.json, installed.json, KIRO_USAGE.md, LICENSE, package-lock.json, package.json, README.md, tsconfig.json, vitest.config.mjs (and the secret file, not listed or read). No `.git` folder. `data\` held only config.json (`{}`, 4 bytes, written 20:18:34Z) before the first run.
