import { readFileSync } from 'node:fs';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbTrendItems } from './arbitraries';
import { parseLatest, parseLevelEntries, parseSchema, parseTrend } from '../src/core/results';

const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const top = (name: string): Record<string, unknown> => fixture(name)['playtesterResults'] as Record<string, unknown>;

describe('parseSchema', () => {
  it('gives no notice for the number 1', () => {
    expect(parseSchema(1)).toBeNull();
  });

  it('gives a notice for another number, and for a value that is not a number', () => {
    expect(parseSchema(2)).toBe('This value comes from a different schema version (found: 2)');
    expect(parseSchema(0)).toBe('This value comes from a different schema version (found: 0)');
    for (const v of ['1', undefined, null, true, {}, []]) expect(parseSchema(v), String(v)).toBe('This value comes from a different schema version (found: none)');
  });
});

describe('parseLatest', () => {
  it('reads the real two-run fixture', () => {
    const latest = parseLatest(top('config.replay-two-runs.json')['latest']);
    expect(latest).toMatchObject({
      runId: 'run-000002',
      state: 'complete',
      commit: '6372d9a27ae81a6ab75e9f8ae45d1d70ccebe50b',
      commitShort: '6372d9a',
      failure: null,
    });
    expect(latest?.timeMs).toBe(Date.UTC(2026, 10, 8, 1, 27, 0, 391));
  });

  it('a null or absent commit gives null', () => {
    expect(parseLatest({ runId: 'r', commit: null })?.commit).toBeNull();
    expect(parseLatest({ runId: 'r' })?.commit).toBeNull();
    expect(parseLatest({ runId: 'r', commit: '' })?.commit).toBeNull();
    expect(parseLatest({ runId: 'r', commit: 5 })?.commitShort).toBeNull();
  });

  it('copies a failure record with each field clipped to 200 characters', () => {
    const latest = parseLatest({ runId: 'r', state: 'failed', failure: { stage: 'build', reasonCode: 'build_failed', message: 'm'.repeat(300), exitCode: 1 } });
    expect(latest?.failure).toEqual({ stage: 'build', reasonCode: 'build_failed', message: 'm'.repeat(200) });
  });

  it('a failure with a wrong type is null', () => {
    for (const failure of [null, 5, 'x', [], {}, { stage: 'build' }, { stage: 1, reasonCode: 'a', message: 'b' }]) {
      expect(parseLatest({ runId: 'r', failure })?.failure, JSON.stringify(failure)).toBeNull();
    }
  });

  it('takes finishedAt when it is a string, falls back to startedAt otherwise, and does not fall back from a string that does not parse', () => {
    expect(parseLatest({ runId: 'r', finishedAt: '2026-11-08T11:00:00Z', startedAt: '2026-11-08T10:00:00Z' })?.timeMs).toBe(Date.UTC(2026, 10, 8, 11));
    expect(parseLatest({ runId: 'r', finishedAt: null, startedAt: '2026-11-08T10:00:00Z' })?.timeMs).toBe(Date.UTC(2026, 10, 8, 10));
    expect(parseLatest({ runId: 'r', finishedAt: 'garbage', startedAt: '2026-11-08T10:00:00Z' })?.timeMs).toBeNull();
  });

  it('a state outside the four is null', () => {
    for (const state of ['running', 'complete', 'failed', 'cut-short']) expect(parseLatest({ runId: 'r', state })?.state).toBe(state);
    for (const state of ['done', '', 5, null]) expect(parseLatest({ runId: 'r', state })?.state).toBeNull();
  });

  it('needs a record with a string runId or startedAt', () => {
    for (const v of [null, undefined, 5, 'x', [], {}, { runId: 5 }, { startedAt: 7 }]) expect(parseLatest(v), JSON.stringify(v)).toBeNull();
    expect(parseLatest({ startedAt: '2026-11-08T10:00:00Z' })).not.toBeNull();
    expect(parseLatest({ runId: 'r' })).not.toBeNull();
  });
});

describe('parseLevelEntries', () => {
  it('reads the entries of the real fixture', () => {
    const { entries, dropped } = parseLevelEntries((top('config.replay-two-runs.json')['latest'] as Record<string, unknown>)['levels']);
    expect(dropped).toBe(0);
    expect(entries.map((e) => [e.levelId, e.colour, e.ink])).toEqual([
      ['01-the-corridor', 'green', { spent: 0, minimal: 0 }],
      ['02-the-chaser', 'green', { spent: 1, minimal: 1 }],
      ['03-the-locked-crypt', 'green', { spent: 2, minimal: 2 }],
      ['04-the-trap-row', 'green', { spent: 1, minimal: 1 }],
      ['05-the-lich', 'green', { spent: 2, minimal: 2 }],
    ]);
  });

  it('reads the amber, red, timed-out and error entries with end HP', () => {
    const { entries } = parseLevelEntries((top('config.amber-and-red.json')['latest'] as Record<string, unknown>)['levels']);
    expect(entries.map((e) => e.colour)).toEqual(['green', 'amber', 'red', 'error', 'error']);
    expect(entries[2]?.endHp).toBe(0);
    expect(entries[3]).toMatchObject({ timedOut: true, reasonCode: 'play_failed' });
    expect(entries[4]).toMatchObject({ timedOut: false, reasonCode: 'replay_mismatch' });
  });

  it('drops and counts an entry that is not a record, has no levelId, or has no string colour', () => {
    const { entries, dropped } = parseLevelEntries([
      { levelId: 'a', colour: 'green' },
      5,
      null,
      'x',
      [],
      { colour: 'green' },
      { levelId: 'b' },
      { levelId: 'c', colour: 3 },
      { levelId: '', colour: 'green' },
      { levelId: 'x'.repeat(81), colour: 'green' },
    ]);
    expect(entries.map((e) => e.levelId)).toEqual(['a']);
    expect(dropped).toBe(9);
  });

  it('turns an unknown colour string into error and marks the stored colour as unknown', () => {
    const { entries } = parseLevelEntries([{ levelId: 'a', colour: 'purple' }, { levelId: 'b', colour: 'green' }]);
    expect(entries[0]).toMatchObject({ colour: 'error', label: 'Unknown colour' });
    expect(entries[1]).toMatchObject({ colour: 'green', label: 'Green: intended solution holds' });
  });

  it('keeps the first of a repeated levelId and counts the rest', () => {
    const { entries, dropped } = parseLevelEntries([
      { levelId: 'a', colour: 'green' },
      { levelId: 'a', colour: 'red' },
      { levelId: 'a', colour: 'amber' },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.colour).toBe('green');
    expect(dropped).toBe(2);
  });

  it('reads ink only when both numbers are finite integers at least 0', () => {
    const ink = (inkSpent: unknown, minimalInk: unknown) => parseLevelEntries([{ levelId: 'a', colour: 'green', inkSpent, minimalInk }]).entries[0]?.ink;
    expect(ink(2, 1)).toEqual({ spent: 2, minimal: 1 });
    expect(ink(0, 0)).toEqual({ spent: 0, minimal: 0 });
    for (const [a, b] of [[1, undefined], [undefined, 1], [-1, 1], [1, -1], [1.5, 1], ['1', 1], [1, '1'], [NaN, 1], [null, null]]) expect(ink(a, b), `${a} ${b}`).toBeNull();
  });

  it('reads end HP when it is a finite number at least 0', () => {
    const hp = (endHp: unknown) => parseLevelEntries([{ levelId: 'a', colour: 'green', endHp }]).entries[0]?.endHp;
    expect(hp(3)).toBe(3);
    expect(hp(0)).toBe(0);
    expect(hp(2.5)).toBe(2.5);
    for (const v of [-1, '3', null, undefined, NaN, {}]) expect(hp(v), String(v)).toBeNull();
  });

  it('sets timedOut only for exactly true and clips the reason code to 60', () => {
    const one = (extra: Record<string, unknown>) => parseLevelEntries([{ levelId: 'a', colour: 'error', ...extra }]).entries[0];
    expect(one({ timedOut: true })?.timedOut).toBe(true);
    for (const v of [false, 1, 'true', null, undefined]) expect(one({ timedOut: v })?.timedOut, String(v)).toBe(false);
    expect(one({ reasonCode: 'r'.repeat(100) })?.reasonCode).toBe('r'.repeat(60));
    expect(one({ reasonCode: 5 })?.reasonCode).toBeNull();
  });

  it('keeps 100 entries and counts the rest', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ levelId: `level-${String(i).padStart(3, '0')}`, colour: 'green' }));
    const { entries, dropped } = parseLevelEntries(many);
    expect(entries).toHaveLength(100);
    expect(dropped).toBe(1);
  });

  it('gives nothing for an absent value and counts a value that is not a list', () => {
    expect(parseLevelEntries(undefined)).toEqual({ entries: [], dropped: 0 });
    expect(parseLevelEntries(null)).toEqual({ entries: [], dropped: 0 });
    expect(parseLevelEntries('x')).toEqual({ entries: [], dropped: 1 });
    expect(parseLevelEntries({})).toEqual({ entries: [], dropped: 1 });
  });
});

describe('parseTrend', () => {
  const entry = (counter: number, extra: Record<string, unknown> = {}) => ({ runId: `run-${String(counter).padStart(6, '0')}`, counter, startedAt: `2026-11-0${counter}T00:00:00Z`, ...extra });

  it('reads the real fixture', () => {
    const { runs, dropped } = parseTrend(top('config.replay-two-runs.json')['trend']);
    expect(dropped).toBe(0);
    expect(runs.map((r) => r.counter)).toEqual([2, 1]);
    expect(runs[0]).toMatchObject({ runId: 'run-000002', state: 'complete', startedAt: '2026-11-08T01:26:53.212Z', commit: '6372d9a27ae81a6ab75e9f8ae45d1d70ccebe50b' });
    expect(runs[0]?.counts).toEqual({ green: 5, amber: 0, red: 0, error: 0 });
    expect([...(runs[0]?.levels ?? new Map())]).toHaveLength(5);
  });

  it('a value that is not a list gives no runs and one dropped', () => {
    for (const v of [{}, 'x', 5, true]) expect(parseTrend(v), String(v)).toEqual({ runs: [], dropped: 1 });
    expect(parseTrend(undefined)).toEqual({ runs: [], dropped: 0 });
  });

  it('drops and counts an entry without a string runId or a finite integer counter', () => {
    const { runs, dropped } = parseTrend([entry(3), 5, null, { counter: 1 }, { runId: 'r' }, { runId: 'r', counter: -1 }, { runId: 'r', counter: 1.5 }, { runId: 'r', counter: '1' }, { runId: 5, counter: 1 }]);
    expect(runs.map((r) => r.counter)).toEqual([3]);
    expect(dropped).toBe(8);
  });

  it('reads a count with readCount: a string is null', () => {
    const { runs } = parseTrend([entry(1, { green: '3', amber: 2, red: -1, error: 1.5 })]);
    expect(runs[0]?.counts).toEqual({ green: null, amber: 2, red: null, error: null });
  });

  it('treats levels that is not a record as empty, ignores bad keys and values, and turns an unknown colour into error', () => {
    const levelsOf = (levels: unknown) => [...(parseTrend([entry(1, { levels })]).runs[0]?.levels ?? new Map())];
    expect(levelsOf(undefined)).toEqual([]);
    expect(levelsOf([])).toEqual([]);
    expect(levelsOf('x')).toEqual([]);
    expect(levelsOf({ a: 'green', b: 5, c: null, '': 'red', ['k'.repeat(81)]: 'red', d: 'purple' })).toEqual([['a', 'green'], ['d', 'error']]);
  });

  it('reads at most 100 keys of a levels map', () => {
    const levels = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`level-${String(i).padStart(3, '0')}`, 'green']));
    expect(parseTrend([entry(1, { levels })]).runs[0]?.levels.size).toBe(100);
  });

  it('sorts by counter descending, then startedAt descending, then runId descending', () => {
    const { runs } = parseTrend([
      { runId: 'a', counter: 1, startedAt: '2026-11-01T00:00:00Z' },
      { runId: 'b', counter: 2, startedAt: '2026-11-01T00:00:00Z' },
      { runId: 'c', counter: 2, startedAt: '2026-11-02T00:00:00Z' },
      { runId: 'd', counter: 2, startedAt: '2026-11-02T00:00:00Z' },
      { runId: 'e', counter: 2 },
    ]);
    expect(runs.map((r) => r.runId)).toEqual(['d', 'c', 'b', 'e', 'a']);
  });

  it('keeps the first of a repeated runId after sorting', () => {
    const { runs, dropped } = parseTrend([
      { runId: 'x', counter: 1, startedAt: '2026-11-01T00:00:00Z', green: 1 },
      { runId: 'x', counter: 5, startedAt: '2026-11-05T00:00:00Z', green: 5 },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.counts.green).toBe(5);
    expect(dropped).toBe(0);
  });

  it('keeps 30 entries and counts the rest', () => {
    const { runs, dropped } = parseTrend(Array.from({ length: 31 }, (_, i) => ({ runId: `run-${i}`, counter: i })));
    expect(runs).toHaveLength(30);
    expect(runs[0]?.counter).toBe(30);
    expect(runs[29]?.counter).toBe(1);
    expect(dropped).toBe(1);
  });

  it('does not read the prototype chain', () => {
    const levels = Object.create({ polluted: 'green' }) as Record<string, unknown>;
    expect(parseTrend([entry(1, { levels })]).runs[0]?.levels.size).toBe(0);
  });
});
describe('trend properties', () => {
  // Feature: dashboard, Property 4: Trend order and size
  it('Property 4: at most 30 runs, newest first, no repeated runId, and every element accounted for', () => {
    fc.assert(
      fc.property(arbTrendItems, (items) => {
        const { runs, dropped } = parseTrend(items.map((item) => item.value));
        expect(runs.length).toBeLessThanOrEqual(30);
        // order: counter descending, then startedAt descending (a missing one last), then runId descending
        for (let i = 1; i < runs.length; i += 1) {
          const a = runs[i - 1]!;
          const b = runs[i]!;
          if (a.counter !== b.counter) {
            expect(a.counter).toBeGreaterThan(b.counter);
          } else if (a.startedAt !== b.startedAt) {
            expect(b.startedAt === null || (a.startedAt !== null && a.startedAt > b.startedAt)).toBe(true);
          } else {
            expect(a.runId > b.runId).toBe(true);
          }
        }
        const ids = runs.map((run) => run.runId);
        expect(new Set(ids).size).toBe(ids.length);
        // accounting: dropped = invalid elements + distinct valid runIds beyond 30; duplicates are removed silently
        const validIds = new Set(items.filter((item) => item.valid).map((item) => item.runId));
        expect(runs.length).toBe(Math.min(validIds.size, 30));
        expect(dropped).toBe(items.filter((item) => !item.valid).length + Math.max(0, validIds.size - 30));
        for (const id of ids) expect(validIds.has(id)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});