import { readFileSync } from 'node:fs';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbAnyConfigValue, arbConfigValue, arbCronsValue, arbJson, arbNow, arbRouteState } from './arbitraries';
import { appNameNotice } from '../src/core/app-name';
import { changeKey } from '../src/core/change-key';
import type { RouteState } from '../src/core/types';
import { buildViewModel } from '../src/core/viewmodel';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const READ_AT = Date.UTC(2026, 10, 8, 2, 0, 0);
const FINISHED = Date.UTC(2026, 10, 8, 1, 27, 0, 391);
const HOUR = 3600 * 1000;

export const pending = (): RouteState => ({ status: 'pending', hasGood: false, good: undefined, goodAtMs: null, error: null });
export const ok = (value: unknown, at: number | null = READ_AT): RouteState => ({ status: 'ok', hasGood: true, good: value, goodAtMs: at, error: null });
export const failed = (error: string, good?: { value: unknown; at: number }): RouteState =>
  good === undefined ? { status: 'failed', hasGood: false, good: undefined, goodAtMs: null, error } : { status: 'failed', hasGood: true, good: good.value, goodAtMs: good.at, error };

const build = (config: RouteState, crons: RouteState = ok(fixture('crons.replay-idle.json')), nowMs: unknown = FINISHED + HOUR) => buildViewModel({ config, crons, nowMs });

describe('buildViewModel: loading and routes', () => {
  it('is loading while either route is pending', () => {
    expect(build(pending(), pending()).loading).toBe(true);
    expect(build(ok({}), pending()).loading).toBe(true);
    expect(build(pending(), ok({ jobs: [] })).loading).toBe(true);
    expect(build(ok({}), ok({ jobs: [] })).loading).toBe(false);
    expect(build(failed('x'), failed('y')).loading).toBe(false);
  });

  it('a config answer with no key: data, but no results', () => {
    const vm = build(ok(fixture('config.no-key.json')));
    expect(vm.results).toMatchObject({ hasData: true, present: false, replay: null, levels: [], runs: [], notice: null });
    expect(vm.results.findings.present).toBe(false);
  });

  it('a config value that is not a record has data but no key', () => {
    for (const v of [[], 'x', 5, null]) expect(build(ok(v)).results, JSON.stringify(v)).toMatchObject({ hasData: true, present: false });
  });

  it('shows the time of the last good read of each route and the error of the latest failed one', () => {
    const vm = build(failed('config boom', { value: fixture('config.replay-two-runs.json'), at: READ_AT }), failed('crons boom', { value: fixture('crons.replay-idle.json'), at: READ_AT + 60000 }));
    expect(vm.resultsRoute).toEqual({ error: 'config boom', readAt: '2026-11-08 02:00 UTC' });
    expect(vm.jobRoute).toEqual({ error: 'crons boom', readAt: '2026-11-08 02:01 UTC' });
    expect(build(ok({}), ok({ jobs: [] })).resultsRoute).toEqual({ error: null, readAt: '2026-11-08 02:00 UTC' });
  });

  it('a failed route without a text gets a fixed phrase', () => {
    expect(build({ ...failed('x'), error: null }).resultsRoute.error).toBe('The request failed');
  });
});

describe('buildViewModel: the real two-run fixture', () => {
  const vm = build(ok(fixture('config.replay-two-runs.json')));

  it('has five green cards, two runs and the short commit', () => {
    expect(vm.results.present).toBe(true);
    expect(vm.results.levels.map((c) => [c.levelId, c.colour])).toEqual([
      ['01-the-corridor', 'green'],
      ['02-the-chaser', 'green'],
      ['03-the-locked-crypt', 'green'],
      ['04-the-trap-row', 'green'],
      ['05-the-lich', 'green'],
    ]);
    expect(vm.results.runs.map((r) => r.counter)).toEqual([2, 1]);
    expect(vm.results.replay).toMatchObject({ runId: 'run-000002', state: 'complete', commit: '6372d9a27ae81a6ab75e9f8ae45d1d70ccebe50b', commitShort: '6372d9a', time: '2026-11-08 01:27 UTC', failure: null });
    expect(vm.results.findings.present).toBe(false);
    expect(vm.results.dropped).toEqual({ levels: 0, trend: 0 });
    expect(vm.results.runs[0]).toEqual({ runId: 'run-000002', counter: 2, state: 'complete', startedAt: '2026-11-08 01:26 UTC', commitShort: '6372d9a', counts: { green: 5, amber: 0, red: 0, error: 0 } });
    expect(vm.results.levels[0]?.trendText).toBe('Last 2 runs: 2 green');
  });

  it('has no stale warning one hour after the replay and has one after 37 hours', () => {
    expect(vm.results.replay?.stale).toBe(false);
    expect(build(ok(fixture('config.replay-two-runs.json')), undefined, FINISHED + 37 * HOUR).results.replay?.stale).toBe(true);
    expect(build(ok(fixture('config.replay-two-runs.json')), undefined, FINISHED + 36 * HOUR).results.replay?.stale).toBe(false);
    expect(build(ok(fixture('config.replay-two-runs.json')), undefined, FINISHED + 36 * HOUR + 1).results.replay?.stale).toBe(true);
  });

  it('has no stale warning when the Now_Input is not a finite number', () => {
    for (const now of [NaN, Infinity, 'x', null, undefined]) expect(build(ok(fixture('config.replay-two-runs.json')), undefined, now).results.replay?.stale).toBe(false);
  });
});

describe('buildViewModel: other fixtures', () => {
  it('amber, red, timed out and error cards', () => {
    const levels = build(ok(fixture('config.amber-and-red.json'))).results.levels;
    expect(levels.map((c) => c.colour)).toEqual(['green', 'amber', 'red', 'error', 'error']);
    expect(levels[2]).toMatchObject({ endHp: 0, outcome: 'not won' });
    expect(levels[3]).toMatchObject({ timedOut: true, reasonCode: 'play_failed', outcome: 'not judged' });
    expect(levels[1]?.ink).toEqual({ spent: 2, minimal: 1 });
    expect(levels[1]?.trendText).toBe('Last 3 runs: 2 green, 1 amber');
  });

  it('a failed run shows its failure and no cards, and keeps the trend', () => {
    const vm = build(ok(fixture('config.failed-run.json')));
    expect(vm.results.replay).toMatchObject({ state: 'failed', failure: { stage: 'build', reasonCode: 'build_failed', message: 'The Grimsheet build failed with exit code 1.' } });
    expect(vm.results.levels).toEqual([]);
    expect(vm.results.runs).toHaveLength(2);
  });

  it('findings without latest or trend', () => {
    const vm = build(ok(fixture('config.findings-only.json')));
    expect(vm.results.replay).toBeNull();
    expect(vm.results.levels).toEqual([]);
    expect(vm.results.runs).toEqual([]);
    expect(vm.results.findings.items).toHaveLength(2);
  });

  it('the two runs with findings', () => {
    const vm = build(ok(fixture('config.with-findings.json')));
    expect(vm.results.findings.items.map((i) => i.id)).toEqual(['hunt-20261108T110312Z-012', 'hunt-20261108T110312Z-007']);
    expect(vm.results.findings.header?.huntId).toBe('hunt-20261108T110312Z');
    expect(vm.results.levels).toHaveLength(5);
  });

  it('a different schema version gives the notice and still reads the parts', () => {
    const vm = build(ok(fixture('config.schema-2.json')));
    expect(vm.results.notice).toBe('This value comes from a different schema version (found: 2)');
    expect(vm.results.levels).toHaveLength(5);
    expect(build(ok(fixture('config.replay-two-runs.json'))).results.notice).toBeNull();
  });

  it('a present key that is not a record has the key and empty parts', () => {
    const vm = build(ok({ playtesterResults: 'oops' }));
    expect(vm.results).toMatchObject({ hasData: true, present: true, replay: null, levels: [], runs: [] });
    expect(vm.results.findings.present).toBe(false);
  });

  it('a bad latest does not blank the trend and the findings', () => {
    const config = fixture('config.with-findings.json') as { playtesterResults: Record<string, unknown> };
    const vm = build(ok({ playtesterResults: { ...config.playtesterResults, latest: 'bad' } }));
    expect(vm.results.replay).toBeNull();
    expect(vm.results.runs).toHaveLength(2);
    expect(vm.results.findings.items).toHaveLength(2);
    expect(vm.results.levels).toHaveLength(5); // the cards of the newest run remain
  });

  it('counts dropped level entries and trend entries', () => {
    const config = fixture('config.replay-two-runs.json') as { playtesterResults: { latest: { levels: unknown[] }; trend: unknown[] } };
    config.playtesterResults.latest.levels.push(5, null);
    config.playtesterResults.trend.push('junk');
    expect(build(ok(config)).results.dropped).toEqual({ levels: 2, trend: 1 });
  });
});

describe('buildViewModel: the job', () => {
  it('is pending while the crons route is pending', () => {
    expect(build(ok({}), pending()).job).toEqual({ kind: 'pending' });
  });

  it('shows the fixtures', () => {
    expect(build(ok({}), ok(fixture('crons.replay-idle.json'))).job).toMatchObject({ kind: 'found', running: false, consecutiveFailures: 0, paused: false, lastStatus: 'ok' });
    expect(build(ok({}), ok(fixture('crons.replay-running.json'))).job).toMatchObject({ kind: 'found', running: true });
    expect(build(ok({}), ok(fixture('crons.replay-failing.json'))).job).toMatchObject({ kind: 'found', consecutiveFailures: 3, paused: true });
    expect(build(ok({}), ok(fixture('crons.none.json'))).job).toEqual({ kind: 'not-registered' });
  });

  it('a failed crons route without a good value is unavailable, and leaves the results unchanged', () => {
    const config = ok(fixture('config.replay-two-runs.json'));
    const withJob = build(config, ok(fixture('crons.replay-idle.json')));
    const without = build(config, failed('crons down'));
    expect(without.job).toEqual({ kind: 'unavailable' });
    expect(without.jobRoute.error).toBe('crons down');
    expect(without.results).toStrictEqual(withJob.results);
  });

  it('a failed crons route keeps the last good job', () => {
    const vm = build(ok({}), failed('down', { value: fixture('crons.replay-running.json'), at: READ_AT }));
    expect(vm.job).toMatchObject({ kind: 'found', running: true });
    expect(vm.jobRoute.error).toBe('down');
  });

  it('the View_Model holds no script text', () => {
    const vm = build(ok({}), ok(fixture('crons.replay-failing.json')));
    expect(JSON.stringify(vm)).not.toContain('replay_cron');
    expect(JSON.stringify(vm)).not.toContain('script');
  });
});

describe('buildViewModel: robustness', () => {
  it('is plain JSON: a JSON round trip gives an equal object', () => {
    for (const name of ['config.replay-two-runs.json', 'config.with-findings.json', 'config.amber-and-red.json', 'config.failed-run.json']) {
      const vm = build(ok(fixture(name)));
      expect(JSON.parse(JSON.stringify(vm))).toStrictEqual(vm);
    }
  });

  it('a part that throws inside its builder gets its empty state and the others are kept', () => {
    const hostile = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('hostile'); }, ownKeys: () => { throw new Error('hostile'); } });
    const config = fixture('config.with-findings.json') as { playtesterResults: Record<string, unknown> };
    const vm = build(ok({ playtesterResults: { ...config.playtesterResults, latest: hostile } }));
    expect(vm.results.replay).toBeNull();
    expect(vm.results.runs).toHaveLength(2);
    expect(vm.results.findings.items).toHaveLength(2);
    const vm2 = build(ok({ playtesterResults: { ...config.playtesterResults, findings: hostile, trend: hostile } }));
    expect(vm2.results.findings.present).toBe(false);
    expect(vm2.results.findings.dropped).toBe(1);
    expect(vm2.results.runs).toEqual([]);
    expect(vm2.results.replay).not.toBeNull();
  });
});

describe('changeKey', () => {
  it('is equal for the same data read at another time, and differs when a colour or a finding changes', () => {
    const a = build(ok(fixture('config.with-findings.json'), READ_AT));
    const b = build(ok(fixture('config.with-findings.json'), READ_AT + 120000));
    expect(changeKey(a)).toBe(changeKey(b));
    const config = fixture('config.with-findings.json') as { playtesterResults: { latest: { levels: Array<{ colour: string }> }; findings: { items: Array<{ class: string }> } } };
    config.playtesterResults.latest.levels[0]!.colour = 'red';
    expect(changeKey(build(ok(config)))).not.toBe(changeKey(a));
    const other = fixture('config.with-findings.json') as { playtesterResults: { findings: { items: Array<{ class: string }> } } };
    other.playtesterResults.findings.items[0]!.class = 'free_win';
    expect(changeKey(build(ok(other)))).not.toBe(changeKey(a));
  });

  it('differs when the job state changes', () => {
    expect(changeKey(build(ok({}), ok(fixture('crons.replay-idle.json'))))).not.toBe(changeKey(build(ok({}), ok(fixture('crons.replay-running.json')))));
  });
});

describe('appNameNotice', () => {
  it('is null for the expected name and for a value that is not a string', () => {
    expect(appNameNotice('grimsheet-playtester')).toBeNull();
    for (const v of [undefined, null, 5, {}, []]) expect(appNameNotice(v)).toBeNull();
  });

  it('holds both names for another name', () => {
    const notice = appNameNotice('other-app');
    expect(notice).toContain('grimsheet-playtester');
    expect(notice).toContain('other-app');
  });

  it('clips a long name', () => {
    expect(appNameNotice('x'.repeat(500))?.length).toBeLessThan(300);
  });
});
describe('view model properties', () => {
  const same = <T,>(v: T): T => structuredClone(v);

  // Feature: dashboard, Property 1: Total View_Model
  it('Property 1: any config value, crons value, statuses and Now_Input give a View_Model and do not throw', () => {
    fc.assert(
      fc.property(arbRouteState(arbAnyConfigValue), arbRouteState(arbCronsValue), arbNow, (config, crons, nowMs) => {
        const vm = buildViewModel({ config, crons, nowMs });
        expect(Object.keys(vm).sort()).toEqual(['job', 'jobRoute', 'loading', 'results', 'resultsRoute']);
        expect(typeof vm.loading).toBe('boolean');
        expect(Array.isArray(vm.results.levels)).toBe(true);
        expect(vm.results.findings.items.length).toBeLessThanOrEqual(20);
        expect(vm.results.runs.length).toBeLessThanOrEqual(30);
        expect(vm.results.levels.length).toBeLessThanOrEqual(100);
      }),
      { numRuns: 400 },
    );
  });

  it('Property 1: also for inputs that are not route states at all', () => {
    fc.assert(
      fc.property(arbJson, arbJson, arbNow, (config, crons, nowMs) => {
        const vm = buildViewModel({ config: config as RouteState, crons: crons as RouteState, nowMs });
        expect(typeof vm.loading).toBe('boolean');
      }),
      { numRuns: 200 },
    );
  });

  // Feature: dashboard, Property 2: Deterministic
  it('Property 2: equal inputs give equal View_Models', () => {
    fc.assert(
      fc.property(arbRouteState(arbAnyConfigValue), arbRouteState(arbCronsValue), arbNow, (config, crons, nowMs) => {
        const first = buildViewModel({ config, crons, nowMs });
        const second = buildViewModel({ config: same(config), crons: same(crons), nowMs });
        expect(second).toStrictEqual(first);
        expect(JSON.parse(JSON.stringify(first))).toStrictEqual(first);
      }),
      { numRuns: 300 },
    );
  });

  // Feature: dashboard, Property 3: A bad part never blanks the good parts
  it('Property 3: replacing latest, trend or findings leaves the independent sections equal', () => {
    const REMOVE = Symbol('remove');
    const arbReplacement = fc.oneof(arbJson, fc.constant(REMOVE));
    fc.assert(
      fc.property(arbConfigValue, fc.constantFrom('latest', 'trend', 'findings'), arbReplacement, arbRouteState(arbCronsValue), arbNow, (config, part, replacement, crons, nowMs) => {
        const results = config['playtesterResults'] as Record<string, unknown>;
        const changedResults: Record<string, unknown> = { ...results };
        if (replacement === REMOVE) delete changedResults[part];
        else changedResults[part] = replacement;
        const before = buildViewModel({ config: ok(config), crons, nowMs });
        const after = buildViewModel({ config: ok({ ...config, playtesterResults: changedResults }), crons, nowMs });
        // the job never depends on the results
        expect(after.job).toStrictEqual(before.job);
        expect(after.results.notice).toStrictEqual(before.results.notice);
        if (part !== 'latest') expect(after.results.replay).toStrictEqual(before.results.replay);
        if (part !== 'trend') expect(after.results.runs).toStrictEqual(before.results.runs);
        if (part !== 'findings') expect(after.results.findings).toStrictEqual(before.results.findings);
        if (part === 'findings') expect(after.results.levels).toStrictEqual(before.results.levels);
      }),
      { numRuns: 300 },
    );
  });

  it('Property 3: replacing the crons value leaves the results equal', () => {
    fc.assert(
      fc.property(arbConfigValue, arbRouteState(arbCronsValue), arbRouteState(arbCronsValue), arbNow, (config, cronsA, cronsB, nowMs) => {
        const a = buildViewModel({ config: ok(config), crons: cronsA, nowMs });
        const b = buildViewModel({ config: ok(config), crons: cronsB, nowMs });
        expect(b.results).toStrictEqual(a.results);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: dashboard, Property 11: Stale warning
  it('Property 11: the warning is shown exactly when the replay time parses and is more than 36 hours before now', () => {
    const ISO = ['2026-11-01T01:00:00.000Z', '2026-11-05T12:30:00Z', '2026-11-08T01:27:00.391Z', '2026-11-08T11:03:12.481Z'];
    const arbFinished = fc.oneof(fc.constantFrom(...ISO), fc.constant(null), fc.constant(undefined), fc.constantFrom('garbage', '2026-02-30T00:00:00Z', ''), fc.integer({ min: 0, max: 5 }));
    const arbStarted = fc.oneof(fc.constantFrom(...ISO), fc.constant(undefined), fc.constantFrom('garbage', 'x'));
    const arbOffset = fc.oneof(fc.constantFrom(STALE, STALE + 1, STALE - 1, 0, -1, 1, -STALE), fc.integer({ min: -3 * HOUR, max: 72 * HOUR }));
    fc.assert(
      fc.property(arbFinished, arbStarted, arbOffset, arbNow, fc.boolean(), (finishedAt, startedAt, offset, otherNow, useOffset) => {
        const latest: Record<string, unknown> = { runId: 'run-000001', state: 'complete' };
        if (finishedAt !== undefined) latest['finishedAt'] = finishedAt;
        if (startedAt !== undefined) latest['startedAt'] = startedAt;
        // the replay time by the rule of the requirement, read with Date.parse (an oracle independent of parseTime)
        const chosen = typeof finishedAt === 'string' ? finishedAt : startedAt;
        const parsed = typeof chosen === 'string' && ISO.includes(chosen) ? Date.parse(chosen) : null;
        const nowMs: unknown = useOffset && parsed !== null ? parsed + offset : otherNow;
        const vm = buildViewModel({ config: ok({ playtesterResults: { latest } }), crons: pending(), nowMs });
        const expected = parsed !== null && typeof nowMs === 'number' && Number.isFinite(nowMs) && nowMs - parsed > 129_600_000;
        expect(vm.results.replay?.stale).toBe(expected);
        expect(vm.results.replay?.time === 'time unknown').toBe(parsed === null);
      }),
      { numRuns: 500 },
    );
  });

  it('the boundary: exactly 36 hours is not stale, one millisecond more is', () => {
    const latest = { runId: 'r', finishedAt: '2026-11-08T01:27:00.391Z' };
    const at = (nowMs: unknown) => buildViewModel({ config: ok({ playtesterResults: { latest } }), crons: pending(), nowMs }).results.replay?.stale;
    expect(at(FINISHED + STALE)).toBe(false);
    expect(at(FINISHED + STALE + 1)).toBe(true);
    expect(at(FINISHED - 1)).toBe(false);
    expect(at(Number.NaN)).toBe(false);
  });
});

const STALE = 129_600_000;