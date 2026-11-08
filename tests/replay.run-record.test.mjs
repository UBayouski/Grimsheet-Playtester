// @ts-check
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { arbRunHistory, arbRunRecord } from './replay.arbitraries.mjs';
import {
  SCHEMA_VERSION,
  BYTE_BUDGET,
  MAX_RUNS,
  levelEntryFromVerdict,
  levelEntryError,
  countColours,
  newRunRecord,
  finalizeRecord,
  indexEntryOf,
  trendEntryOf,
  trendEntryFromIndexEntry,
  compactLatest,
  buildResultsKey,
  byteLength,
} from '../scripts/replay/run-record.mjs';

/** @returns {any} a ReplayOk verdict */
function okVerdict() {
  return { levelId: '02-the-chaser', colour: 'amber', won: true, endHp: 3, inkSpent: 2, minimalInk: 1, statusChangeIndex: 13, refusedAt: null };
}

/** @returns {any} a finished record with three levels */
function sampleRecord() {
  return {
    schemaVersion: 1,
    runId: 'run-000042',
    counter: 42,
    state: 'complete',
    startedAt: '2026-11-08T11:03:12.481Z',
    finishedAt: '2026-11-08T11:03:47.902Z',
    repoUrl: 'https://github.com/UBayouski/Grimsheet',
    branch: 'main',
    commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
    levels: [
      { levelId: '01-the-corridor', colour: 'green', won: true, endHp: 3, inkSpent: 0, minimalInk: 0, statusChangeIndex: 8, refusedAt: null },
      { levelId: '02-the-chaser', colour: 'amber', won: true, endHp: 3, inkSpent: 2, minimalInk: 1, statusChangeIndex: 13, refusedAt: null },
      { levelId: '05-the-lich', colour: 'error', reasonCode: 'play_failed', reason: 'The play command failed (unexpected exit code).', timedOut: true },
    ],
    coverage: { listed: 3, played: 3, noSolution: 0, unreadable: 0, unlisted: 1, duplicateListedLevels: [], unlistedSolutions: ['99-old-level'] },
    failure: null,
    previousLaunch: { outcome: 'child-exited', finishedAt: '2026-11-07T11:04:20.115Z' },
    resultsKey: 'ok',
    green: 1,
    amber: 1,
    red: 0,
    error: 1,
  };
}

describe('run-record: constants', () => {
  it('has the schema version, the Byte_Budget and the run limit of the design', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(BYTE_BUDGET).toBe(65536);
    expect(MAX_RUNS).toBe(30);
  });
});

describe('levelEntryFromVerdict', () => {
  it('copies the eight fields of a ReplayOk unchanged, without timedOut', () => {
    const verdict = okVerdict();
    const entry = levelEntryFromVerdict(verdict, '02-the-chaser', false);
    expect(entry).toStrictEqual(okVerdict());
    expect(entry).not.toBe(verdict);
    expect('timedOut' in entry).toBe(false);
  });

  it('adds timedOut only when true', () => {
    expect(levelEntryFromVerdict(okVerdict(), '02-the-chaser', true)).toStrictEqual({ ...okVerdict(), timedOut: true });
    expect('timedOut' in levelEntryFromVerdict(okVerdict(), '02-the-chaser', false)).toBe(false);
    expect('timedOut' in levelEntryFromVerdict(okVerdict(), '02-the-chaser', /** @type {any} */ (undefined))).toBe(false);
  });

  it('keeps only the verdict fields (an extra field is not copied)', () => {
    const entry = levelEntryFromVerdict({ ...okVerdict(), extra: 'x' }, '02-the-chaser', false);
    expect('extra' in entry).toBe(false);
  });

  it('keeps levelId, colour error, reasonCode and reason of a ReplayError', () => {
    const verdict = { levelId: '05-the-lich', colour: 'error', reasonCode: 'play_failed', reason: 'The play command failed (unexpected exit code).' };
    expect(levelEntryFromVerdict(/** @type {any} */ (verdict), '05-the-lich', true)).toStrictEqual({ ...verdict, timedOut: true });
  });

  it('takes the level id from the argument when a ReplayError has none', () => {
    const verdict = { colour: 'error', reasonCode: 'level_mismatch', reason: 'The level id does not match.' };
    expect(levelEntryFromVerdict(/** @type {any} */ (verdict), '03-the-locked-crypt', false)).toStrictEqual({
      levelId: '03-the-locked-crypt',
      colour: 'error',
      reasonCode: 'level_mismatch',
      reason: 'The level id does not match.',
    });
  });
});

describe('levelEntryError', () => {
  it.each([
    ['no_solution_file', 'The listed level has no stored solution file.'],
    ['solution_unreadable', 'The stored solution file could not be read or is not valid JSON.'],
    ['not_played', 'The level was not played because the run reached its deadline.'],
  ])('%s gives a colour error entry with its reason text', (code, reason) => {
    expect(levelEntryError('04-the-trap-row', /** @type {any} */ (code))).toStrictEqual({ levelId: '04-the-trap-row', colour: 'error', reasonCode: code, reason });
  });
});

describe('countColours', () => {
  it('counts each colour', () => {
    expect(countColours(sampleRecord().levels)).toEqual({ green: 1, amber: 1, red: 0, error: 1 });
  });

  it('gives zeros for no levels', () => {
    expect(countColours([])).toEqual({ green: 0, amber: 0, red: 0, error: 0 });
  });
});

describe('newRunRecord', () => {
  it('starts in state running with zero counts, no levels and resultsKey null', () => {
    const r = newRunRecord({
      runId: 'run-000007',
      counter: 7,
      startedAt: '2026-11-08T11:03:12.481Z',
      repoUrl: 'https://github.com/UBayouski/Grimsheet',
      branch: 'main',
      previousLaunch: { outcome: 'child-exited', finishedAt: '2026-11-07T11:04:20.115Z' },
    });
    expect(r).toStrictEqual({
      schemaVersion: 1,
      runId: 'run-000007',
      counter: 7,
      state: 'running',
      startedAt: '2026-11-08T11:03:12.481Z',
      finishedAt: null,
      repoUrl: 'https://github.com/UBayouski/Grimsheet',
      branch: 'main',
      commit: null,
      levels: [],
      coverage: { listed: 0, played: 0, noSolution: 0, unreadable: 0, unlisted: 0, duplicateListedLevels: [], unlistedSolutions: [] },
      failure: null,
      previousLaunch: { outcome: 'child-exited', finishedAt: '2026-11-07T11:04:20.115Z' },
      resultsKey: null,
      green: 0,
      amber: 0,
      red: 0,
      error: 0,
    });
  });

  it('keeps a null previousLaunch', () => {
    const r = newRunRecord({ runId: 'run-000001', counter: 1, startedAt: 'x', repoUrl: 'u', branch: 'b', previousLaunch: null });
    expect(r.previousLaunch).toBeNull();
  });
});

describe('finalizeRecord', () => {
  it('returns a new object with the final fields and recounted colours, and leaves the input unchanged', () => {
    const start = newRunRecord({ runId: 'run-000042', counter: 42, startedAt: '2026-11-08T11:03:12.481Z', repoUrl: 'u', branch: 'main', previousLaunch: null });
    const before = structuredClone(start);
    const done = sampleRecord();
    const final = finalizeRecord(start, {
      state: 'complete',
      finishedAt: done.finishedAt,
      commit: done.commit,
      levels: done.levels,
      coverage: done.coverage,
      failure: null,
    });
    expect(start).toStrictEqual(before);
    expect(final).not.toBe(start);
    expect(final.state).toBe('complete');
    expect(final.finishedAt).toBe(done.finishedAt);
    expect(final.commit).toBe(done.commit);
    expect(final.levels).toStrictEqual(done.levels);
    expect(final.coverage).toStrictEqual(done.coverage);
    expect(final.failure).toBeNull();
    expect([final.green, final.amber, final.red, final.error]).toEqual([1, 1, 0, 1]);
    expect(final.runId).toBe('run-000042');
    expect(final.resultsKey).toBeNull();
  });

  it('records a failure', () => {
    const start = newRunRecord({ runId: 'run-000003', counter: 3, startedAt: 's', repoUrl: 'u', branch: 'b', previousLaunch: null });
    const failure = { stage: /** @type {const} */ ('build'), reasonCode: 'build_failed', message: 'The Grimsheet build failed with exit code 1.', exitCode: 1 };
    const final = finalizeRecord(start, { state: 'failed', finishedAt: 'f', commit: null, levels: [], coverage: start.coverage, failure });
    expect(final.state).toBe('failed');
    expect(final.failure).toStrictEqual(failure);
  });
});

describe('indexEntryOf, trendEntryOf, trendEntryFromIndexEntry', () => {
  it('indexEntryOf picks the eleven index fields', () => {
    expect(indexEntryOf(sampleRecord())).toStrictEqual({
      runId: 'run-000042',
      counter: 42,
      state: 'complete',
      startedAt: '2026-11-08T11:03:12.481Z',
      finishedAt: '2026-11-08T11:03:47.902Z',
      commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
      green: 1,
      amber: 1,
      red: 0,
      error: 1,
    });
  });

  it('trendEntryOf has the trend fields and a map of level id to colour', () => {
    expect(trendEntryOf(sampleRecord())).toStrictEqual({
      runId: 'run-000042',
      counter: 42,
      state: 'complete',
      startedAt: '2026-11-08T11:03:12.481Z',
      commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
      green: 1,
      amber: 1,
      red: 0,
      error: 1,
      levels: { '01-the-corridor': 'green', '02-the-chaser': 'amber', '05-the-lich': 'error' },
    });
  });

  it('trendEntryFromIndexEntry has an empty levels map and no finishedAt', () => {
    const entry = indexEntryOf(sampleRecord());
    const trend = trendEntryFromIndexEntry(entry);
    expect(trend).toStrictEqual({
      runId: 'run-000042',
      counter: 42,
      state: 'complete',
      startedAt: '2026-11-08T11:03:12.481Z',
      commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
      green: 1,
      amber: 1,
      red: 0,
      error: 1,
      levels: {},
    });
    expect('finishedAt' in trend).toBe(false);
  });
});

describe('compactLatest', () => {
  it('keeps the eleven fields and a compact levels list', () => {
    const c = compactLatest(sampleRecord());
    expect(Object.keys(c).sort()).toEqual(
      ['branch', 'commit', 'counter', 'coverage', 'failure', 'finishedAt', 'levels', 'repoUrl', 'runId', 'startedAt', 'state'],
    );
    expect(c.levels).toStrictEqual([
      { levelId: '01-the-corridor', colour: 'green', endHp: 3, inkSpent: 0, minimalInk: 0 },
      { levelId: '02-the-chaser', colour: 'amber', endHp: 3, inkSpent: 2, minimalInk: 1 },
      { levelId: '05-the-lich', colour: 'error', reasonCode: 'play_failed', timedOut: true },
    ]);
  });

  it('leaves out keys the source does not have, and does not set them to null', () => {
    const record = sampleRecord();
    delete record.commit;
    record.levels = [{ levelId: '04-the-trap-row', colour: 'error', reasonCode: 'no_solution_file', reason: 'x' }];
    const c = compactLatest(record);
    expect('commit' in c).toBe(false);
    expect(c.levels[0]).toStrictEqual({ levelId: '04-the-trap-row', colour: 'error', reasonCode: 'no_solution_file' });
    expect('inkSpent' in c.levels[0]).toBe(false);
  });

  it('keeps inkSpent 0 and adds timedOut only when true', () => {
    const record = sampleRecord();
    record.levels = [
      { levelId: 'a', colour: 'green', won: true, endHp: 3, inkSpent: 0, minimalInk: 0, statusChangeIndex: null, refusedAt: null },
      { levelId: 'b', colour: 'error', reasonCode: 'play_failed', reason: 'r' },
    ];
    const c = compactLatest(record);
    expect(c.levels[0]).toStrictEqual({ levelId: 'a', colour: 'green', endHp: 3, inkSpent: 0, minimalInk: 0 });
    expect('timedOut' in c.levels[1]).toBe(false);
  });

  it('keeps endHp 0 of a ReplayOk, and gives an error entry no endHp', () => {
    const record = sampleRecord();
    record.levels = [
      { levelId: 'a', colour: 'red', won: false, endHp: 0, inkSpent: 1, minimalInk: 1, statusChangeIndex: null, refusedAt: null },
      { levelId: 'b', colour: 'error', reasonCode: 'play_failed', reason: 'r' },
    ];
    const c = compactLatest(record);
    expect(c.levels[0]).toStrictEqual({ levelId: 'a', colour: 'red', endHp: 0, inkSpent: 1, minimalInk: 1 });
    expect(c.levels[1]).toStrictEqual({ levelId: 'b', colour: 'error', reasonCode: 'play_failed' });
    expect('endHp' in c.levels[1]).toBe(false);
  });

  it('does not change the record', () => {
    const record = sampleRecord();
    const before = structuredClone(record);
    compactLatest(record);
    expect(record).toStrictEqual(before);
  });
});

describe('byteLength', () => {
  it('is the UTF-8 length of the JSON text', () => {
    expect(byteLength('abc')).toBe(5);
    expect(byteLength('\u00e9')).toBe(4); // quote, two bytes, quote
    expect(byteLength('\u20ac')).toBe(5); // euro sign is three bytes
    expect(byteLength('\ud83d\ude00')).toBe(6); // an emoji is four bytes
    expect(byteLength({ a: 1 })).toBe(7);
    expect(byteLength({ k: '\u00e9' })).toBe(JSON.stringify({ k: '\u00e9' }).length + 1);
  });
});

describe('buildResultsKey', () => {
  /**
   * @param {number} counter
   * @param {number} [width] extra characters in the commit-less level map, to make an entry bigger
   * @returns {any}
   */
  function trendEntry(counter, width = 0) {
    return {
      runId: `run-${String(counter).padStart(6, '0')}`,
      counter,
      state: 'complete',
      startedAt: '2026-11-08T11:03:12.481Z',
      commit: null,
      green: 1,
      amber: 0,
      red: 0,
      error: 0,
      levels: { [`level-${'x'.repeat(width)}`]: 'green' },
    };
  }
  const latest = () => compactLatest(sampleRecord());

  it('returns ok with the owned sub-keys when everything fits', () => {
    const trend = [trendEntry(3), trendEntry(2), trendEntry(1)];
    const r = buildResultsKey({ existingTop: {}, latest: latest(), trend, updatedAt: '2026-11-08T11:03:47.950Z', budget: BYTE_BUDGET });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.owned.schemaVersion).toBe(1);
    expect(r.owned.updatedAt).toBe('2026-11-08T11:03:47.950Z');
    expect(r.owned.latest).toStrictEqual(latest());
    expect(r.owned.trend).toStrictEqual(trend);
  });

  it('sorts the trend Newest first and does not change its input', () => {
    const trend = [trendEntry(1), trendEntry(3), trendEntry(2)];
    const before = structuredClone(trend);
    const r = buildResultsKey({ existingTop: {}, latest: latest(), trend, updatedAt: 'u', budget: BYTE_BUDGET });
    expect(trend).toStrictEqual(before);
    expect(r.ok && r.owned.trend.map((t) => t.counter)).toEqual([3, 2, 1]);
  });

  it('trims the oldest trend entries first until the whole value fits', () => {
    const trend = [5, 4, 3, 2, 1].map((c) => trendEntry(c, 200));
    const full = byteLength({ schemaVersion: 1, updatedAt: 'u', latest: latest(), trend });
    const threeFit = byteLength({ schemaVersion: 1, updatedAt: 'u', latest: latest(), trend: trend.slice(0, 3) });
    expect(threeFit).toBeLessThan(full);
    const r = buildResultsKey({ existingTop: {}, latest: latest(), trend, updatedAt: 'u', budget: threeFit });
    expect(r.ok && r.owned.trend.map((t) => t.counter)).toEqual([5, 4, 3]);
  });

  it('counts foreign sub-keys of existingTop toward the size', () => {
    const trend = [3, 2, 1].map((c) => trendEntry(c));
    const withoutForeign = buildResultsKey({ existingTop: {}, latest: latest(), trend, updatedAt: 'u', budget: 20000 });
    expect(withoutForeign.ok && withoutForeign.owned.trend).toHaveLength(3);
    const findings = ['f'.repeat(19000)];
    const withForeign = buildResultsKey({ existingTop: { findings }, latest: latest(), trend, updatedAt: 'u', budget: 20000 });
    expect(withForeign.ok && withForeign.owned.trend.length).toBeLessThan(3);
  });

  it('keeps at least one trend entry, then reports not ok', () => {
    const trend = [3, 2, 1].map((c) => trendEntry(c));
    const r = buildResultsKey({ existingTop: {}, latest: latest(), trend, updatedAt: 'u', budget: 10 });
    expect(r).toEqual({ ok: false });
    const oneFits = byteLength({ schemaVersion: 1, updatedAt: 'u', latest: latest(), trend: [trend[0]] });
    const r2 = buildResultsKey({ existingTop: {}, latest: latest(), trend, updatedAt: 'u', budget: oneFits });
    expect(r2.ok && r2.owned.trend.map((t) => t.counter)).toEqual([3]);
    const r3 = buildResultsKey({ existingTop: {}, latest: latest(), trend, updatedAt: 'u', budget: oneFits - 1 });
    expect(r3).toEqual({ ok: false });
  });

  it('with no trend entries it can still fit or report not ok', () => {
    const fits = buildResultsKey({ existingTop: {}, latest: latest(), trend: [], updatedAt: 'u', budget: BYTE_BUDGET });
    expect(fits.ok && fits.owned.trend).toEqual([]);
    expect(buildResultsKey({ existingTop: {}, latest: latest(), trend: [], updatedAt: 'u', budget: 10 })).toEqual({ ok: false });
  });

  it('when ok, the whole top-level value is within the budget', () => {
    const trend = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((c) => trendEntry(c, 300));
    const existingTop = { findings: ['a', 'b'], mystery: 1 };
    const budget = 5000;
    const r = buildResultsKey({ existingTop, latest: latest(), trend, updatedAt: 'u', budget });
    expect(r.ok).toBe(true);
    if (r.ok) expect(byteLength({ ...existingTop, ...r.owned })).toBeLessThanOrEqual(budget);
  });
});

describe('buildResultsKey properties', () => {
  // Feature: replay-runner, Property 9: Trend keeps the newest
  it('Property 9: the trend is sorted Newest first and trimming drops only entries older than every kept one', () => {
    fc.assert(
      fc.property(arbRunHistory, arbRunRecord, fc.integer({ min: 0, max: 120000 }), (history, latestRecord, budget) => {
        const trend = history.map((record) => trendEntryOf(record));
        const sortedCounters = trend.map((t) => t.counter).sort((a, b) => b - a);
        const r = buildResultsKey({ existingTop: {}, latest: compactLatest(latestRecord), trend, updatedAt: 'u', budget });
        if (!r.ok) return;
        const kept = r.owned.trend.map((t) => t.counter);
        // Newest first.
        for (let i = 1; i < kept.length; i += 1) expect(kept[i - 1]).toBeGreaterThan(kept[i]);
        // Every dropped entry has a lower counter than every kept entry.
        const keptSet = new Set(kept);
        const dropped = sortedCounters.filter((c) => !keptSet.has(c));
        for (const d of dropped) for (const k of kept) expect(d).toBeLessThan(k);
        // What is kept is the newest prefix.
        expect(kept).toEqual(sortedCounters.slice(0, kept.length));
      }),
      { numRuns: 200 },
    );
  });
});
