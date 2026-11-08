// @ts-check
// Unit tests of scripts/hunt/level-info.mjs (`reduceLevelInfo`) and scripts/hunt/info.mjs (`runInfo`)
// (design: Decision 8, "level-info.mjs", "Hunt_Info flow", the Hunt_Info printed bodies; Requirement 4,
// criteria 2 and 5). The Hunt_End cases are added in task 17. The modules do not exist yet: these tests
// fail until task 15.2.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reduceLevelInfo } from '../scripts/hunt/level-info.mjs';
import { huntPaths, writeActive, writeHuntRecord } from '../scripts/hunt/hunt-store.mjs';
import { chargeAttempt, countsOf, newHuntRecord, readyRecord, recordOutcome } from '../scripts/hunt/hunt-record.mjs';
import { tryPrintActions } from '../scripts/hunt/tokens.mjs';
import { INFO_MAX_BYTES } from '../scripts/hunt/limits.mjs';
import { STEP_LIMITS_MS } from '../scripts/replay/process.mjs';
import { procFail, procOk } from './helpers/fake-spawn.mjs';
import { CONFIG_PATH, DATA_FOLDER, HUNT_CHECKOUT, makeHuntWorld } from './helpers/hunt-world.mjs';

const HUNT_ID = 'hunt-20261108T110312Z';
const COMMIT = 'e1c61a35b3da027aada5d9ef4460efa4470488a4';
const TOKEN = '9f3c0a51d2b84e67a1c05be3f7d92a48';
const READY_AT = '2026-11-08T11:03:40.000Z';
const LEVELS = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt'];
const HUNTS = `${DATA_FOLDER}\\hunts`;
const LOCK = `${DATA_FOLDER}\\.hunt.lock`;
const ACTIVE = `${HUNTS}\\active.json`;
const RECORD_PATH = `${HUNTS}\\${HUNT_ID}.json`;
const L02_INFO = '02-the-chaser';

const FIXTURE_TEXT = readFileSync(new URL('./fixtures/level-info/02-the-chaser.json', import.meta.url), 'utf8');
const FIXTURE = JSON.parse(FIXTURE_TEXT);
const STORED_02 =
  'edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29 E E E E N N E E E E E S S';

/** @param {unknown} value @returns {number} */
const bytesOf = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** @param {any} info @returns {string[]} the addresses of the cells */
const addressesOf = (info) => info.cells.map((/** @type {any} */ c) => c.address);

/**
 * A synthetic level: an 8 by 8 grid (rows 1 to 8, columns A to H) and the given cells.
 * @param {any[]} cells
 * @returns {any}
 */
function syntheticLevel(cells) {
  const wall = '########';
  const row = '#......#';
  return {
    id: 'synthetic',
    title: 'Synthetic',
    hint: 'h',
    startingHp: 3,
    ink: 2,
    map: [wall, row, row, row, row, row, row, wall],
    cells,
  };
}

describe('reduceLevelInfo', () => {
  it('reduces the 02 fixture to exactly 4 cells and 686 bytes of compact JSON', () => {
    const reduced = /** @type {any} */ (reduceLevelInfo(FIXTURE));
    expect(addressesOf(reduced)).toEqual(['A14', 'B14', 'A15', 'B15']);
    expect(reduced.cells).toHaveLength(4);
    expect(bytesOf(reduced)).toBe(686);
  });

  it('keeps every other top-level field unchanged and in order, and does not change its input', () => {
    const before = JSON.stringify(FIXTURE);
    const reduced = /** @type {any} */ (reduceLevelInfo(FIXTURE));
    expect(Object.keys(reduced)).toEqual(Object.keys(FIXTURE));
    for (const key of Object.keys(FIXTURE)) {
      if (key !== 'cells') expect(reduced[key]).toEqual(FIXTURE[key]);
    }
    expect(JSON.stringify(FIXTURE)).toBe(before);
    expect(reduced).not.toBe(FIXTURE);
  });

  it('keeps a kept cell exactly as given, with no key added', () => {
    const reduced = /** @type {any} */ (reduceLevelInfo(FIXTURE));
    expect(reduced.cells[0]).toEqual({ address: 'A14', raw: 'Move rule of M1', locked: true });
    expect(Object.keys(reduced.cells[1])).toEqual(['address', 'raw', 'name']);
  });

  it('keeps a locked formula inside the grid', () => {
    const info = syntheticLevel([{ address: 'G6', raw: '=IF(KEY=1337,".","#")', locked: true }]);
    expect(addressesOf(reduceLevelInfo(info))).toEqual(['G6']);
  });

  it('drops a single-character locked tile inside the grid', () => {
    const info = syntheticLevel([
      { address: 'B2', raw: '#', locked: true },
      { address: 'C3', raw: '.', locked: true },
    ]);
    expect(/** @type {any} */ (reduceLevelInfo(info)).cells).toEqual([]);
  });

  it('keeps a cell with a name inside the grid', () => {
    const info = syntheticLevel([{ address: 'C3', raw: '.', locked: true, name: 'DOOR' }]);
    expect(addressesOf(reduceLevelInfo(info))).toEqual(['C3']);
  });

  it('keeps an unlocked single-character cell inside the grid', () => {
    const info = syntheticLevel([{ address: 'D4', raw: '.' }]);
    expect(addressesOf(reduceLevelInfo(info))).toEqual(['D4']);
  });

  it('keeps an address that does not parse', () => {
    const info = syntheticLevel([
      { address: 'not-an-address', raw: '#', locked: true },
      { address: 'a1', raw: '#', locked: true },
    ]);
    expect(addressesOf(reduceLevelInfo(info))).toEqual(['not-an-address', 'a1']);
  });

  it('keeps a cell outside the grid (the rule panel), even a single-character locked one', () => {
    const info = syntheticLevel([
      { address: 'A14', raw: '#', locked: true },
      { address: 'I2', raw: '#', locked: true },
    ]);
    expect(addressesOf(reduceLevelInfo(info))).toEqual(['A14', 'I2']);
  });

  it('keeps the order of the kept cells', () => {
    const info = syntheticLevel([
      { address: 'B2', raw: '#', locked: true },
      { address: 'G6', raw: '=1', locked: true },
      { address: 'A9', raw: 'x', locked: true },
      { address: 'C3', raw: 'ab', locked: true },
    ]);
    expect(addressesOf(reduceLevelInfo(info))).toEqual(['G6', 'A9', 'C3']);
  });

  it('returns a copy unchanged when there is no map array or no cells array', () => {
    const noMap = { id: 'a', cells: [{ address: 'B2', raw: '#', locked: true }] };
    const noCells = { id: 'b', map: ['##'] };
    expect(reduceLevelInfo(noMap)).toEqual(noMap);
    expect(reduceLevelInfo(noMap)).not.toBe(noMap);
    expect(reduceLevelInfo(noCells)).toEqual(noCells);
  });

  it('never throws on values that are not level descriptions', () => {
    for (const v of [null, undefined, 7, 'text', [], {}, { map: 'x', cells: 'y' }]) {
      expect(() => reduceLevelInfo(v)).not.toThrow();
    }
  });
});

/**
 * A world in the state of a live Hunt: the running ready record, the pointer, the Hunt lock with the Hunt token.
 * @param {{levelInfo?: import('../scripts/replay/types.mjs').ProcResult, afterReadySec?: number}} [o]
 */
async function liveWorld(o = {}) {
  const w = makeHuntWorld({ levelInfo: o.levelInfo ?? procOk(FIXTURE_TEXT) });
  w.fs.seedDir(HUNTS);
  let record = newHuntRecord({ huntId: HUNT_ID, startedAt: '2026-11-08T11:03:12.000Z', repoUrl: 'https://example.invalid/g', branch: 'main' });
  record = readyRecord(record, { readyAt: READY_AT, commit: COMMIT, levels: LEVELS, levelsSkipped: 0 });
  await writeHuntRecord(w.deps, record);
  await writeActive(w.deps, { schemaVersion: 1, huntId: HUNT_ID, token: TOKEN, readyAt: READY_AT });
  w.fs.seedFile(LOCK, JSON.stringify({ pid: 4242, token: TOKEN, createdAt: READY_AT }));
  w.seedConfig({});
  w.clock.advance(Date.parse(READY_AT) + (o.afterReadySec ?? 100) * 1000 - w.clock.nowMs());
  return w;
}

describe('Hunt_Info: the printed level', () => {
  it('prints the reduced view as compact JSON with the stored solution and what is left, exit 0', async () => {
    const w = await liveWorld();
    const res = await w.info(['--level', '02-the-chaser']);
    expect(res.exit).toBe(0);
    const body = /** @type {any} */ (res.body);
    expect(body).toEqual({
      state: 'level',
      levelId: '02-the-chaser',
      info: reduceLevelInfo(FIXTURE),
      stored: { minimalInk: 1, actionCount: 14, actions: STORED_02 },
      left: { level: 4, total: 20, refusals: 10, seconds: 1700 },
    });
    expect(addressesOf(body.info)).toEqual(['A14', 'B14', 'A15', 'B15']);
    expect(bytesOf(body.info)).toBe(686);
    expect(Object.keys(body.info)).toEqual(Object.keys(FIXTURE));
  });

  it('writes the stored actions as the space-joined tokens of the stored solution', async () => {
    const w = await liveWorld();
    const stored = JSON.parse(/** @type {string} */ (w.fs.peek(`${HUNT_CHECKOUT}\\tests\\solutions\\02-the-chaser.json`)));
    const tokens = /** @type {string[]} */ (tryPrintActions(stored.actions));
    const body = /** @type {any} */ ((await w.info(['--level', '02-the-chaser'])).body);
    expect(body.stored.actions).toBe(tokens.join(' '));
    expect(body.stored.actionCount).toBe(tokens.length);
  });

  it('runs node scripts/play.mjs <id> --level-info in the Hunt_Checkout without a shell', async () => {
    const w = await liveWorld();
    await w.info(['--level', '02-the-chaser']);
    expect(w.calls.spawn).toHaveLength(1);
    const call = w.calls.spawn[0];
    expect(call.command).toBe('node');
    expect(call.args).toEqual(['scripts/play.mjs', '02-the-chaser', '--level-info']);
    expect(call.cwd).toBe(HUNT_CHECKOUT);
    expect(call.shell).toBe(false);
    expect(call.timeoutMs).toBeGreaterThan(0);
    expect(call.timeoutMs).toBeLessThanOrEqual(STEP_LIMITS_MS.list);
    expect(w.calls.info).toEqual([{ levelId: '02-the-chaser' }]);
  });

  it('writes nothing and charges nothing on success', async () => {
    const w = await liveWorld();
    const before = w.fs.snapshot();
    await w.info(['--level', '02-the-chaser']);
    expect(w.fs.snapshot()).toEqual(before);
  });

  it('takes no call lock: a held call lock neither blocks nor changes', async () => {
    const w = await liveWorld();
    const callLock = huntPaths(w.deps).callLockPath;
    const held = JSON.stringify({ pid: 1, token: 'other-call', createdAt: new Date(w.clock.nowMs()).toISOString() });
    w.fs.seedFile(callLock, held);
    const nowBefore = w.clock.nowMs();
    const res = await w.info(['--level', '02-the-chaser']);
    expect(res.exit).toBe(0);
    expect(/** @type {any} */ (res.body).state).toBe('level');
    expect(w.fs.peek(callLock)).toBe(held);
    expect(w.clock.nowMs()).toBe(nowBefore);
  });
});

describe('Hunt_Info: the game command fails', () => {
  it.each([
    ['a non-zero exit', procFail(1, 'boom', '')],
    ['output that is not JSON', procOk('this is not json')],
  ])('gives info null and level_info_failed for %s', async (_name, result) => {
    const w = await liveWorld({ levelInfo: result });
    const before = w.fs.snapshot();
    const res = await w.info(['--level', '02-the-chaser']);
    expect(res.exit).toBe(0);
    expect(res.body).toEqual({
      state: 'level',
      levelId: '02-the-chaser',
      info: null,
      reasonCode: 'level_info_failed',
      stored: { minimalInk: 1, actionCount: 14, actions: STORED_02 },
      left: { level: 4, total: 20, refusals: 10, seconds: 1700 },
    });
    expect(w.fs.snapshot()).toEqual(before);
  });
});

describe('Hunt_Info: an internal fault is not a refusal', () => {
  it('a throw from the process dependency gives exit 4 hunt_internal_error and leaves the Hunt running', async () => {
    const w = await liveWorld();
    const before = w.fs.snapshot();
    const { runInfo } = await import('../scripts/hunt/info.mjs');
    const faulty = {
      ...w.deps,
      spawn: /** @type {any} */ (
        async () => {
          throw new Error('unexpected fault in spawn');
        }
      ),
    };
    const res = await runInfo(faulty, ['--level', '02-the-chaser']);
    expect(res.exit).toBe(4);
    expect(res.body).toEqual({ outcome: 'error', reasonCode: 'hunt_internal_error', reason: expect.any(String) });
    // nothing written; the record, pointer and lock are exactly as they were
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.fs.peek(LOCK)).toContain(TOKEN);
    // and a normal call afterwards still sees a live Hunt
    const again = /** @type {any} */ (await w.info(['--level', '02-the-chaser']));
    expect(again.exit).toBe(0);
    expect(again.body.state).toBe('level');
  });
});

/** Makes readFile fail with EACCES for one path. @param {ReturnType<typeof makeHuntWorld>} w @param {string} target */
function denyRead(w, target) {
  const real = w.deps.fs;
  w.deps.fs = {
    ...real,
    async readFile(p, ...rest) {
      if (p === target) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return /** @type {any} */ (real.readFile)(p, ...rest);
    },
  };
}

describe('Hunt_Info: resolving the Hunt', () => {
  it('a missing active.json is no_active_hunt, exit 3, nothing written', async () => {
    const w = makeHuntWorld({ levelInfo: procOk(FIXTURE_TEXT) });
    w.fs.seedDir(HUNTS);
    const before = w.fs.snapshot();
    const res = await w.info(['--level', L02_INFO]);
    expect(res.exit).toBe(3);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('no_active_hunt');
    expect(w.fs.snapshot()).toEqual(before);
  });

  it.each([ACTIVE, LOCK])('an EACCES while reading %s is exit 4 hunt_internal_error, nothing written', async (target) => {
    const w = await liveWorld();
    const before = w.fs.snapshot();
    denyRead(w, target);
    const res = await w.info(['--level', L02_INFO]);
    expect(res.exit).toBe(4);
    expect(res.body).toEqual({ outcome: 'error', reasonCode: 'hunt_internal_error', reason: expect.any(String) });
    expect(w.fs.snapshot()).toEqual(before);
  });
});

describe('Hunt_Info: the stored solution cannot be read', () => {
  it('gives stored null and no_solution_file for a missing file', async () => {
    const w = await liveWorld();
    await w.fs.rm(`${HUNT_CHECKOUT}\\tests\\solutions\\02-the-chaser.json`);
    const res = await w.info(['--level', '02-the-chaser']);
    expect(res.exit).toBe(0);
    const body = /** @type {any} */ (res.body);
    expect(body.state).toBe('level');
    expect(body.info).toEqual(reduceLevelInfo(FIXTURE));
    expect(body.stored).toBeNull();
    expect(body.storedReasonCode).toBe('no_solution_file');
    expect(body.left).toEqual({ level: 4, total: 20, refusals: 10, seconds: 1700 });
  });

  it('gives stored null and solution_unreadable for a file that is not JSON', async () => {
    const w = await liveWorld();
    w.fs.seedFile(`${HUNT_CHECKOUT}\\tests\\solutions\\02-the-chaser.json`, '{bad');
    const res = await w.info(['--level', '02-the-chaser']);
    expect(res.exit).toBe(0);
    const body = /** @type {any} */ (res.body);
    expect(body.stored).toBeNull();
    expect(body.storedReasonCode).toBe('solution_unreadable');
    expect(body.info).toEqual(reduceLevelInfo(FIXTURE));
  });
});

describe('Hunt_Info: level_info_too_large', () => {
  /** A level whose reduced view is far over 8192 bytes: 40 unlocked cells with a long raw inside the grid. */
  function oversized() {
    const cells = Array.from({ length: 40 }, (_, i) => ({ address: `${'ABCDEFGH'[i % 8]}${(i % 6) + 2}`, raw: `=SUM(${'9'.repeat(250)})` }));
    return { ...syntheticLevel(cells), title: 'OVERSIZED-TITLE-MARKER' };
  }

  it('refuses with the refusal fields only, exit 3, and prints no part of the level', async () => {
    const level = oversized();
    const expectedBytes = bytesOf(reduceLevelInfo(level));
    expect(expectedBytes).toBeGreaterThan(INFO_MAX_BYTES);
    const w = await liveWorld({ levelInfo: procOk(JSON.stringify(level)) });
    const res = await w.info(['--level', '02-the-chaser']);
    expect(res.exit).toBe(3);
    const body = /** @type {any} */ (res.body);
    expect(body).toEqual({
      outcome: 'refused',
      reasonCode: 'level_info_too_large',
      reason: 'The level description is too large to print.',
      bytes: expectedBytes,
      maxBytes: 8192,
    });
    const text = JSON.stringify(res);
    expect(text).not.toContain('OVERSIZED-TITLE-MARKER');
    expect(text).not.toContain('SUM(');
    expect(text).not.toContain('"stored"');
  });

  it('charges nothing, writes nothing and does not finish the Hunt', async () => {
    const w = await liveWorld({ levelInfo: procOk(JSON.stringify(oversized())) });
    const before = w.fs.snapshot();
    await w.info(['--level', '02-the-chaser']);
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.fs.has(ACTIVE)).toBe(true);
    expect(w.fs.has(LOCK)).toBe(true);
    expect(JSON.parse(/** @type {string} */ (w.fs.peek(RECORD_PATH))).state).toBe('running');
  });

  it('accepts a reduced view of exactly 8192 bytes or less (the cap is on the reduced text)', async () => {
    // The raw output is far larger than 8192 bytes, but the reduced view is 686 bytes.
    expect(Buffer.byteLength(FIXTURE_TEXT, 'utf8')).toBeGreaterThan(INFO_MAX_BYTES);
    const w = await liveWorld();
    const res = await w.info(['--level', '02-the-chaser']);
    expect(res.exit).toBe(0);
  });
});

describe('Hunt_Info: refusals charge nothing and write nothing', () => {
  /**
   * @param {ReturnType<typeof makeHuntWorld>} w
   * @param {string[]} argv
   * @param {string} reasonCode
   */
  async function expectRefusal(w, argv, reasonCode) {
    const before = w.fs.snapshot();
    const res = await w.info(argv);
    expect(res.exit).toBe(3);
    const body = /** @type {any} */ (res.body);
    expect(body.outcome).toBe('refused');
    expect(body.reasonCode).toBe(reasonCode);
    expect(typeof body.reason).toBe('string');
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.calls.spawn).toHaveLength(0);
    return body;
  }

  it('no_active_hunt: nothing is active', async () => {
    const w = makeHuntWorld({ levelInfo: procOk(FIXTURE_TEXT) });
    await expectRefusal(w, ['--level', '02-the-chaser'], 'no_active_hunt');
  });

  it('no_active_hunt: the Hunt lock holds another token', async () => {
    const w = await liveWorld();
    w.fs.seedFile(LOCK, JSON.stringify({ pid: 4242, token: 'a-newer-hunt-token', createdAt: READY_AT }));
    await expectRefusal(w, ['--level', '02-the-chaser'], 'no_active_hunt');
  });

  it.each([[[]], [['--level']], [['--bogus']], [['--level', 'Not A Level']], [['--level', '02-the-chaser', 'extra']]])(
    'bad_arguments for %j',
    async (argv) => {
      const w = await liveWorld();
      await expectRefusal(w, /** @type {string[]} */ (argv), 'bad_arguments');
    },
  );

  it('unknown_level: a valid id that is not in this Hunt', async () => {
    const w = await liveWorld();
    await expectRefusal(w, ['--level', '99-not-here'], 'unknown_level');
  });

  it('time_budget_spent: does not finish the Hunt', async () => {
    const w = await liveWorld({ afterReadySec: 1800 });
    await expectRefusal(w, ['--level', '02-the-chaser'], 'time_budget_spent');
    expect(w.fs.has(ACTIVE)).toBe(true);
    expect(w.fs.has(LOCK)).toBe(true);
    expect(JSON.parse(/** @type {string} */ (w.fs.peek(RECORD_PATH))).state).toBe('running');
  });

  it('does not refuse with time_budget_spent one second before the deadline', async () => {
    const w = await liveWorld({ afterReadySec: 1799 });
    const res = await w.info(['--level', '02-the-chaser']);
    expect(res.exit).toBe(0);
    expect(/** @type {any} */ (res.body).left.seconds).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Hunt_End (task 17.1; design: "Hunt_End" printed body, Decisions 5 and 14, "Finish (finishHunt)").
// `runEnd` is reached through the world's `end` helper, which imports scripts/hunt/end.mjs when called, so the
// Info cases above still load. These cases fail until task 17.2 creates the module.
// ---------------------------------------------------------------------------------------------------------
const CALL_LOCK = `${DATA_FOLDER}\\.hunt-call.lock`;
const L02 = '02-the-chaser';
const L03 = '03-the-locked-crypt';

/** @param {ReturnType<typeof makeHuntWorld>} w @returns {any} */
const readRecord = (w) => JSON.parse(/** @type {string} */ (w.fs.peek(RECORD_PATH)));
/** @param {ReturnType<typeof makeHuntWorld>} w @returns {any} */
const readConfig = (w) => JSON.parse(/** @type {string} */ (w.fs.peek(CONFIG_PATH)));

/**
 * A live Hunt with 7 Attempts: level 02 has 4 (1 confirmed, 1 duplicate, 2 rejected), level 03 has 3
 * (1 error, 2 rejected), level 01 has none; one refusal is charged.
 * @param {any} record
 * @returns {any}
 */
function someAttempts(record) {
  let r = record;
  /** @type {Array<[string, 'confirmed'|'rejected'|'error'|'duplicate', string]>} */
  const steps = [
    [L02, 'confirmed', 'class_reproduced'],
    [L02, 'duplicate', 'duplicate_finding'],
    [L02, 'rejected', 'not_won'],
    [L02, 'rejected', 'not_cheaper'],
    [L03, 'error', 'unknown_class'],
    [L03, 'rejected', 'not_won'],
    [L03, 'rejected', 'not_won'],
  ];
  for (const [level, outcome, code] of steps) r = recordOutcome(chargeAttempt(r, level), level, outcome, code);
  r.refusals = 1;
  return r;
}

/**
 * A live Hunt for End: the ready record (optionally changed), the pointer, the Hunt lock with the Hunt token.
 * @param {{mutate?: (record: any) => any, config?: unknown, configText?: string, afterReadySec?: number}} [o]
 */
async function endWorld(o = {}) {
  const w = makeHuntWorld();
  w.fs.seedDir(HUNTS);
  let record = newHuntRecord({ huntId: HUNT_ID, startedAt: '2026-11-08T11:03:12.000Z', repoUrl: 'https://example.invalid/g', branch: 'main' });
  record = readyRecord(record, { readyAt: READY_AT, commit: COMMIT, levels: LEVELS, levelsSkipped: 0 });
  if (o.mutate) record = o.mutate(record);
  await writeHuntRecord(w.deps, record);
  await writeActive(w.deps, { schemaVersion: 1, huntId: HUNT_ID, token: TOKEN, readyAt: READY_AT });
  w.fs.seedFile(LOCK, JSON.stringify({ pid: 4242, token: TOKEN, createdAt: READY_AT }));
  if (o.configText !== undefined) w.fs.seedFile(CONFIG_PATH, o.configText);
  else w.seedConfig(o.config ?? {});
  w.clock.advance(Date.parse(READY_AT) + (o.afterReadySec ?? 100) * 1000 - w.clock.nowMs());
  return w;
}

describe('Hunt_End: finishing the Hunt', () => {
  it('prints the complete body of the design, exit 0', async () => {
    const w = await endWorld({ mutate: someAttempts });
    const res = await w.end([]);
    expect(res.exit).toBe(0);
    expect(res.body).toEqual({
      state: 'complete',
      huntId: HUNT_ID,
      commit: COMMIT,
      summary: { attempts: 7, refusals: 1, confirmed: 1, rejected: 4, error: 1, duplicate: 1, notRecorded: 0, seconds: 100, findingsKey: 'ok' },
      levels: {
        '01-the-corridor': { attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 },
        [L02]: { attempts: 4, confirmed: 1, rejected: 2, error: 0, duplicate: 1, notRecorded: 0 },
        [L03]: { attempts: 3, confirmed: 0, rejected: 2, error: 1, duplicate: 0, notRecorded: 0 },
      },
      finished: true,
    });
  });

  it('lists every hunted level in `levels`, in the order of the record', async () => {
    const w = await endWorld({ mutate: someAttempts });
    const body = /** @type {any} */ ((await w.end([])).body);
    expect(Object.keys(body.levels)).toEqual(LEVELS);
    expect(Object.keys(body)).toEqual(['state', 'huntId', 'commit', 'summary', 'levels', 'finished']);
  });

  it('makes the record complete, removes active.json and releases the Hunt lock with the Hunt token', async () => {
    const w = await endWorld({ mutate: someAttempts });
    await w.end([]);
    const rec = readRecord(w);
    expect(rec.state).toBe('complete');
    expect(rec.finishedAt).toBe(new Date(w.clock.nowMs()).toISOString());
    expect(rec.attempts).toBe(7);
    expect(rec.findingsKey).toBe('ok');
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(w.fs.has(LOCK)).toBe(false);
  });

  it('does not remove a Hunt lock that holds another token', async () => {
    const w = await endWorld({ mutate: someAttempts });
    // The pointer and the record still match the Hunt, but the lock now belongs to a newer Hunt: End refuses.
    w.fs.seedFile(LOCK, JSON.stringify({ pid: 4242, token: 'a-newer-hunt-token', createdAt: READY_AT }));
    const before = w.fs.snapshot();
    const res = await w.end([]);
    expect(res.exit).toBe(3);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('no_active_hunt');
    expect(w.fs.snapshot()).toEqual(before);
  });

  it('releases the call lock', async () => {
    const w = await endWorld({ mutate: someAttempts });
    await w.end([]);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });

  it('refreshes the findings header with the six counts, updatedAt at the call, commit and huntId of the Hunt', async () => {
    const w = await endWorld({ mutate: someAttempts });
    const callMs = w.clock.nowMs();
    await w.end([]);
    const findings = readConfig(w).playtesterResults.findings;
    expect(Object.keys(findings).sort()).toEqual(['commit', 'counts', 'huntId', 'items', 'schemaVersion', 'updatedAt']);
    expect(findings.schemaVersion).toBe(1);
    expect(findings.updatedAt).toBe(new Date(callMs).toISOString());
    expect(findings.commit).toBe(COMMIT);
    expect(findings.huntId).toBe(HUNT_ID);
    expect(findings.counts).toEqual(countsOf(readRecord(w)));
    expect(Object.keys(findings.counts).sort()).toEqual(['attempts', 'confirmed', 'duplicate', 'error', 'notRecorded', 'rejected']);
    expect(findings.items).toEqual([]);
  });

  it('refreshes the header also for a Hunt with no Attempt and no Finding', async () => {
    const w = await endWorld();
    const callMs = w.clock.nowMs();
    const res = await w.end([]);
    expect(res.exit).toBe(0);
    const findings = readConfig(w).playtesterResults.findings;
    expect(findings.updatedAt).toBe(new Date(callMs).toISOString());
    expect(findings.commit).toBe(COMMIT);
    expect(findings.huntId).toBe(HUNT_ID);
    expect(findings.counts).toEqual(countsOf(readRecord(w)));
    expect(findings.items).toEqual([]);
    expect(/** @type {any} */ (res.body).summary).toEqual({
      attempts: 0, refusals: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0, seconds: 100, findingsKey: 'ok',
    });
  });

  it('keeps the items of an existing findings value unchanged when no Finding is pending', async () => {
    const item = { id: 'hunt-20261101T000000Z-001', levelId: L02, foundAt: '2026-11-01T00:00:00.000Z' };
    const existing = { schemaVersion: 1, updatedAt: '2026-11-01T00:00:00.000Z', commit: 'old', huntId: 'hunt-20261101T000000Z', counts: { confirmed: 1, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 }, items: [item] };
    const w = await endWorld({ mutate: someAttempts, config: { playtesterResults: { schemaVersion: 1, findings: existing, latest: { keep: 'me' } }, foreign: 7 } });
    await w.end([]);
    const cfg = readConfig(w);
    expect(JSON.stringify(cfg.playtesterResults.findings.items)).toBe(JSON.stringify([item]));
    expect(cfg.playtesterResults.findings.huntId).toBe(HUNT_ID);
    expect(cfg.playtesterResults.latest).toEqual({ keep: 'me' });
    expect(cfg.foreign).toBe(7);
  });

  it('starts no process and writes no Candidate_File', async () => {
    const w = await endWorld({ mutate: someAttempts });
    await w.end([]);
    expect(w.calls.spawn).toHaveLength(0);
  });
});

describe('Hunt_End: a merge failure', () => {
  it('still finishes the Hunt and reports findingsKey', async () => {
    const w = await endWorld({ mutate: someAttempts, configText: '{not json' });
    const res = await w.end([]);
    expect(res.exit).toBe(0);
    const body = /** @type {any} */ (res.body);
    expect(body.state).toBe('complete');
    expect(body.finished).toBe(true);
    expect(body.summary.findingsKey).toBe('config_unreadable');
    expect(w.fs.peek(CONFIG_PATH)).toBe('{not json');
    expect(readRecord(w).state).toBe('complete');
    expect(readRecord(w).findingsKey).toBe('config_unreadable');
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(w.fs.has(LOCK)).toBe(false);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });
});

describe('Hunt_End: refusals', () => {
  it('no_active_hunt: nothing is active, exit 3, the printed body, nothing written (Decision 14)', async () => {
    const w = makeHuntWorld();
    w.seedConfig({});
    const before = w.fs.snapshot();
    const res = await w.end([]);
    expect(res.exit).toBe(3);
    expect(res.body).toEqual({ outcome: 'refused', reasonCode: 'no_active_hunt', reason: 'No hunt is active.' });
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.calls.spawn).toHaveLength(0);
  });

  it('bad_arguments: an argument is given, exit 3, nothing written, the Hunt stays live', async () => {
    const w = await endWorld({ mutate: someAttempts });
    const before = w.fs.snapshot();
    const res = await w.end(['--level', L02]);
    expect(res.exit).toBe(3);
    const body = /** @type {any} */ (res.body);
    expect(body.outcome).toBe('refused');
    expect(body.reasonCode).toBe('bad_arguments');
    expect(typeof body.reason).toBe('string');
    expect(w.fs.snapshot()).toEqual(before);
    expect(readRecord(w).state).toBe('running');
    expect(readRecord(w).refusals).toBe(1); // not charged: End refusals are outside the seven checks of Requirement 9
    expect(w.fs.has(ACTIVE)).toBe(true);
    expect(w.fs.has(LOCK)).toBe(true);
  });

  it.each([ACTIVE, LOCK])('an EACCES while reading %s: exit 4 hunt_internal_error, nothing finished or written, call lock released', async (target) => {
    const w = await endWorld({ mutate: someAttempts });
    const before = w.fs.snapshot();
    denyRead(w, target);
    const res = await w.end([]);
    expect(res.exit).toBe(4);
    expect(res.body).toEqual({ outcome: 'error', reasonCode: 'hunt_internal_error', reason: expect.any(String) });
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
    expect(readRecord(w).state).toBe('running');
    expect(w.fs.has(ACTIVE)).toBe(true);
  });

  it('call_busy: a fresh call lock is held, exit 3, the printed body, nothing written, the Hunt not finished', async () => {
    const w = await endWorld({ mutate: someAttempts });
    const held = JSON.stringify({ pid: 1, token: 'other-call', createdAt: new Date(w.clock.nowMs()).toISOString() });
    w.fs.seedFile(CALL_LOCK, held);
    const before = w.fs.snapshot();
    const res = await w.end([]);
    expect(res.exit).toBe(3);
    expect(res.body).toEqual({ outcome: 'refused', reasonCode: 'call_busy', reason: 'Another hunt call is still running. Try again.' });
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.fs.peek(CALL_LOCK)).toBe(held);
    expect(readRecord(w).state).toBe('running');
  });

  it('call_busy comes before the no_active_hunt check', async () => {
    const w = makeHuntWorld();
    w.fs.seedFile(CALL_LOCK, JSON.stringify({ pid: 1, token: 'other-call', createdAt: new Date(w.clock.nowMs()).toISOString() }));
    const res = await w.end([]);
    expect(res.exit).toBe(3);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('call_busy');
  });

  it('call_busy comes before the argument check (the order of Hunt_Submit)', async () => {
    const w = await endWorld({ mutate: someAttempts });
    const held = JSON.stringify({ pid: 1, token: 'other-call', createdAt: new Date(w.clock.nowMs()).toISOString() });
    w.fs.seedFile(CALL_LOCK, held);
    const before = w.fs.snapshot();
    const res = await w.end(['--level', L02]);
    expect(res.exit).toBe(3);
    expect(res.body).toEqual({ outcome: 'refused', reasonCode: 'call_busy', reason: 'Another hunt call is still running. Try again.' });
    expect(w.fs.snapshot()).toEqual(before);
    expect(readRecord(w).state).toBe('running');
  });

  it('no_active_hunt comes before the argument check (resolve before parse)', async () => {
    const w = makeHuntWorld();
    w.seedConfig({});
    const before = w.fs.snapshot();
    const res = await w.end(['--level', L02]);
    expect(res.exit).toBe(3);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('no_active_hunt');
    expect(w.fs.snapshot()).toEqual(before);
  });
});

describe('Hunt_End: repeated and late calls', () => {
  it('End twice: the second call is no_active_hunt and writes nothing', async () => {
    const w = await endWorld({ mutate: someAttempts });
    const first = await w.end([]);
    expect(first.exit).toBe(0);
    const after = w.fs.snapshot();
    const second = await w.end([]);
    expect(second.exit).toBe(3);
    expect(second.body).toEqual({ outcome: 'refused', reasonCode: 'no_active_hunt', reason: 'No hunt is active.' });
    expect(w.fs.snapshot()).toEqual(after);
  });

  it('End after a self-finish: no_active_hunt, the final record and the findings are not touched', async () => {
    const w = await endWorld({ mutate: someAttempts, afterReadySec: 1800 });
    const selfFinish = await w.submit(['--level', '01-the-corridor', '--class', 'cheaper_win', '--actions', 'E']);
    expect(selfFinish.exit).toBe(3);
    expect(/** @type {any} */ (selfFinish.body).finished).toBe(true);
    expect(readRecord(w).state).toBe('complete');
    const after = w.fs.snapshot();
    const res = await w.end([]);
    expect(res.exit).toBe(3);
    expect(res.body).toEqual({ outcome: 'refused', reasonCode: 'no_active_hunt', reason: 'No hunt is active.' });
    expect(w.fs.snapshot()).toEqual(after);
  });
});
