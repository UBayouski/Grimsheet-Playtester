# E40: how large a config value the Config_Route returns in full, and what was seen of the gateway token (packaging task 13)

date: 2026-11-08. Crew 0.12.0 (`kirocrew --version` printed "kirocrew 0.12.0"), app grimsheet-playtester 1.0.0 installed from commit 9c2f703, measurement program at commit 9f64b86 (`scripts/packaging/measure-config-route.mjs`), run by the user in a terminal. Paths use ~. No token, address or body is recorded.

## Method
- The program wrote a probe, the key `packagingProbe` holding `{"pad":"<text>"}` of an exact size in bytes, into the installed app's `data\config.json` under the results lock (`.results.lock`), and read `GET /api/apps/grimsheet-playtester/config` after each write. The token was sent in the query form (`?token=`). No PUT was sent.
- Before any write it read `/api/crons` (the replay job present and not running; no `.run.lock` or `.hunt.lock`) and the Config_Route (R6.16), then ran the ladder 16384, 32768, 49152, 65536, 98304, 131072, 262144, 524288, 1048576 bytes. A step is good when the answer is 200, parses as JSON, and `packagingProbe` equals what was written. It always removes the probe at the end.
- The installed `config.json` before the run held only `playtesterResults` (body 1369 bytes when read through the route, Results_Key 1228 bytes).

## Result (status ok)
| probe bytes written | status | body bytes returned | ms |
|---|---|---|---|
| 16384 | 200 | 17774 | 22 |
| 32768 | 200 | 34158 | 23 |
| 49152 | 200 | 50542 | 23 |
| 65536 | 200 | 66926 | 22 |
| 98304 | 200 | 99694 | 25 |
| 131072 | 200 | 132462 | 22 |
| 262144 | 200 | 263534 | 23 |
| 524288 | 200 | 525678 | 25 |
| 1048576 | 200 | 1049966 | 46 |

- All nine steps were good: status 200, the body parsed, the probe equal to what was written. `largestGood` 1048576, `firstBad` null, `reachedCap` true. No failure was found up to 1 MiB, the highest size tested. No step was bad or blocked, so there was no bisect.
- The body size minus the probe size is 1390 bytes at every step. The body before the run was 1369 bytes, so the key name and punctuation added 21 bytes (the gateway's own serialisation; not examined further).
- Removal: `done` true, `configRestored` true (the file equals its content before the run, without the probe key), `routeRestored` true (the route again returned the content before the run). The run made 12 requests, all answered 200: `/api/crons` and the Config_Route before any write, nine steps, and one read of the Config_Route after the removal.
- The message of the report is empty. After the run the installed `config.json` held only `playtesterResults`; no `packagingProbe`, lock file or temp file.

## Reading (R6.8)
- The largest size returned in full is 1048576 bytes (the cap of the ladder), which is at least 65536. The Byte_Budget stays 65536 and is not changed. The route limit, if any, is above 1 MiB; it was not looked for above that. The 65536 is the budget that this project keeps for the Results_Key; it is not a limit of the route.
- Not tested: sizes above 1 MiB, a PUT, and the time of a read when the file is larger than 1 MiB (46 ms at 1 MiB, from the same machine).

## Blocked attempts before this run, and what was seen of the token (cause not proven)
- The same program, with the same address, ended without a measurement in these attempts. Each one stopped before any write that was kept, and the probe was removed:
  1. The first real run (old code, which counted every non-200 as a size failure): `/api/crons` answered 200, then the Config_Route answered 403 at every step, with the same 47-byte body in 1 to 2 ms down to 1024 bytes. The old program wrongly printed status ok with a first failing size of 1024 (a slip, fixed, see the packaging Notes). The address had been presented by a dry run shortly before.
  2. After the fix: a dry run with a fresh address read both routes fine; the real run a few minutes later, with the same address, was blocked: 403 "Forbidden" on `/api/crons`, no step, nothing written.
  3. The same pattern once more, with the dashboard closed and the same address pasted into the dry run and then the real run: 403 "Forbidden" on `/api/crons`, nothing written.
- A token whose last character was changed gave 403 "Forbidden" on `/api/crons` and 403 "invalid signature" on the Config_Route.
- The run in this file presented a fresh address first, pasted straight into the real run, with no dry run before it and the dashboard closed. It made 12 requests, all answered 200.
- Reading, not proven: every blocked run reused an address that an earlier command had already presented; the one run whose process presented a fresh address first succeeded. This fits "a login link works for the process that presents it first and is refused for a later one" better than "a link serves two requests". The first real run (200 on `/api/crons`, then 403 on the Config_Route within milliseconds) is explained by neither.
- The Crew documentation describes the `?token=` address as a login link with a 5-minute click window, exchanged on use for a session cookie `mc_token_<port>` (session lifetime up to 20 hours), and says that presenting the same link again inside the window is allowed. The observations above do not show that.
- Practical rule: one fresh `kirocrew token` for each command, pasted straight away; a dry run and a real run need two addresses, or the dry run is skipped (the real run makes the same reads before any write). An exchange of the link for the session cookie inside `route-reader.mjs` is an option if a later step needs one address across several commands; it is not built.
