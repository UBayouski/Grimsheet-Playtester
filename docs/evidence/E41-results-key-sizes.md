# E41: sizes of the Results_Key and of `latest` after the first replay run, and the correction of the exploit-hunt size figures (packaging task 14)

date: 2026-11-08. Crew 0.12.0, app grimsheet-playtester 1.0.0. Paths use ~. No token, address or body is recorded.

## The read (task 12.3, after run-000001; run by the user with `node scripts/packaging/read-route.mjs config`, query form of the token, status 200)
{"route":"/api/apps/grimsheet-playtester/config","status":200,"summary":{"bodyBytes":1369,"resultsKeyBytes":1228,"latestBytes":828,"trendBytes":323,"findingsBytes":null,"levelCount":5,"trendCount":1}}

- The same figures were read again later the same day, after the first failed measurement attempt, and are unchanged. The measurement of E40 restored `config.json` and the route (`configRestored` and `routeRestored` true), so no new read was made for this file.
- The sizes are the UTF-8 length of the compact `JSON.stringify` of each part. `latest` holds the compact level entries with `endHp` (replay-runner task 16.1). `bodyBytes` is the body as the route returned it.

## Arithmetic
- Parts of the Results_Key: `schemaVersion` and `updatedAt` 58, `latest` 828, `trend` 323 (one entry of 321 plus 2 brackets), key overhead 19: 58 + 828 + 323 + 19 = 1228, which equals the measured `resultsKeyBytes`.
- `latest` was 778 bytes before `endHp` was added to each compact level entry: 828 - 778 = 50 = 5 levels x 10 bytes. So about 85 bytes per level in `latest`, against about 75 before.
- Full replay value, 30 trend entries (30 x 321 + 29 commas + 2 brackets = 9661; about 9721 with three-digit counters): 58 + 828 + 9721 + 19 = 10626 bytes, computed from the measured parts and not rebuilt (it was 10576 with `latest` at 778).
- With `findings` at its cap of 16384 bytes and 12 bytes of key overhead: 10626 + 12 + 16384 = 27022, which is under 65536 with 65536 - 27022 = 38514 bytes to spare (it was 26972 and 38564).
- Per level in the whole value: 85 in `latest` plus about 762 in the 30 trend entries (the earlier text used 837 in all, with 75 in `latest`) = about 847. The trend entries carry no `endHp`, so they are unchanged.
- Level limit with the hunt at its cap: (65536 - 16384 - 12 - 6391) / 847 = 42749 / 847 = 50.47, so 50 levels with all levels green. The fixed part is 10626 - 5 x 847 = 6391. The earlier text gave it as 6394, a 3-byte slip (10576 - 5 x 837 = 6391 too); with 6394 the result is the same 50 levels. The earlier limit was 51.

## The edit of the exploit-hunt design (R9.15, the only edit in another spec's design)
- `.kiro/specs/exploit-hunt/design.md`, section "Together with the replay's value in `playtesterResults`", lines 812 to 815 (4 lines, nothing else in the file):
  - 812: the measurement now reads: installed app, 5 levels, 1 trend entry; `latest` 828 (778 before `endHp`), one trend entry 321 (the array 323), whole value 1228, route body 1369; the old 2433 bytes of the pretty-printed file was not measured again.
  - 813: `latest` 828; full replay value computed as 58 + 828 + 9721 + 19 = 10626 (was 10576, "measured by building it").
  - 814: total 10626 + 12 + 16384 = 27022, 38514 bytes to spare (was 26972 and 38564).
  - 815: about 85 bytes per level in `latest` (75 before), about 847 per level (was 837), (65536 - 16384 - 12 - 6391) / 847 = 42749 / 847 = 50.47, so 50 levels (was 51, with the 6394 slip noted).
- The hunt caps (16384 bytes for `findings`) are unchanged: the measurement of E40 found no route limit up to 1 MiB, and the Byte_Budget stays 65536.
