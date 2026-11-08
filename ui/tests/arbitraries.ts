import * as fc from 'fast-check';

/** Keys that are risky in a plain object lookup. They appear as own keys in generated objects. */
export const RISKY_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'levels', 'latest', 'trend', 'findings'];

const arbKey: fc.Arbitrary<string> = fc.oneof({ weight: 3, arbitrary: fc.string({ maxLength: 6 }) }, { weight: 1, arbitrary: fc.constantFrom(...RISKY_KEYS) });

const arbNumber: fc.Arbitrary<number> = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((n) => (Object.is(n, -0) ? 0 : n));

function jsonOfDepth(depth: number): fc.Arbitrary<unknown> {
  const leaf: fc.Arbitrary<unknown> = fc.oneof(fc.constant(null), fc.boolean(), arbNumber, fc.string({ maxLength: 12 }));
  if (depth <= 0) return leaf;
  const inner = jsonOfDepth(depth - 1);
  return fc.oneof(
    { weight: 3, arbitrary: leaf },
    { weight: 1, arbitrary: fc.array(inner, { maxLength: 4 }) },
    { weight: 1, arbitrary: fc.dictionary(arbKey, inner, { maxKeys: 4, noNullPrototype: true }) },
  );
}

/**
 * Any JSON value of bounded depth: null, booleans, finite numbers, strings, arrays and objects with extra keys.
 * Objects have the normal prototype, as every value that comes out of JSON.parse does (the routes give parsed JSON).
 */
export const arbJson: fc.Arbitrary<unknown> = jsonOfDepth(3);

/** A value for the Now_Input: finite numbers, and some values that are not finite numbers. */
export const arbNow: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 4_000_000_000_000 }) },
  { weight: 1, arbitrary: fc.double({ noNaN: false }) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Infinity, -Infinity, null, undefined, '1700000000000', {}) },
  { weight: 1, arbitrary: arbJson },
);

export type Path = Array<string | number>;

/** The paths of every element and member below the root (not the root itself). */
export function pathsOf(value: unknown, prefix: Path = []): Path[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => [[...prefix, i], ...pathsOf(item, [...prefix, i])]);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).flatMap((key) => [[...prefix, key], ...pathsOf((value as Record<string, unknown>)[key], [...prefix, key])]);
  }
  return [];
}

function replaceAt(root: unknown, path: Path, replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  const copy = structuredClone(root) as Record<string | number, unknown>;
  let node = copy;
  for (const step of path.slice(0, -1)) node = node[step] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  Object.defineProperty(node, last, { value: replacement, enumerable: true, writable: true, configurable: true });
  return copy;
}

/**
 * Corrupts a valid value in exactly one place: one member, one array element, or (for a scalar) the root,
 * is replaced by a value from `arb`. The rest of the value is untouched.
 */
export function corrupt(valid: unknown, arb: fc.Arbitrary<unknown> = arbJson): fc.Arbitrary<unknown> {
  const paths = pathsOf(valid);
  if (paths.length === 0) return arb;
  return fc.tuple(fc.nat(paths.length - 1), arb).map(([i, replacement]) => replaceAt(valid, paths[i] as Path, replacement));
}

/** The smallest set of paths at which two JSON values differ. Used by the tests of `corrupt`. */
export function changedPaths(a: unknown, b: unknown, prefix: Path = []): Path[] {
  if (Object.is(a, b)) return [];
  const bothArrays = Array.isArray(a) && Array.isArray(b);
  const bothObjects = !Array.isArray(a) && !Array.isArray(b) && a !== null && b !== null && typeof a === 'object' && typeof b === 'object';
  if (bothArrays) {
    const n = Math.max(a.length, b.length);
    return Array.from({ length: n }, (_, i) => changedPaths(a[i], b[i], [...prefix, i])).flat();
  }
  if (bothObjects) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((key) => changedPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], [...prefix, key]));
  }
  return [prefix];
}

/**
 * A string built from code points outside D800 to DFFF (so it has no lone surrogate), whose UTF-8 form
 * is at most `maxBytes` bytes long: it has at most floor(maxBytes / 4) code points of at most 4 bytes.
 */
export function arbCodePointString(maxBytes: number): fc.Arbitrary<string> {
  const codePoint = fc.oneof(fc.integer({ min: 0, max: 0xd7ff }), fc.integer({ min: 0xe000, max: 0x10ffff }));
  return fc.array(codePoint, { maxLength: Math.floor(maxBytes / 4) }).map((points) => String.fromCodePoint(...points));
}
// ---- time ----

export interface IsoParts {
  year: number; month: number; day: number; hour: number; minute: number;
  second: number | null; fraction: string | null; zone: string;
}

function daysIn(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
}

const arbZone: fc.Arbitrary<string> = fc.oneof(
  fc.constant('Z'),
  fc
    .tuple(fc.constantFrom('+', '-'), fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(([sign, h, m]) => `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`),
);

/**
 * The parts of a valid ISO 8601 string, built by construction: the day is chosen within the month. The year
 * is 1 to 9998, so that the instant, with any offset, still falls in the years 0000 to 9999 that
 * `YYYY-MM-DD HH:MM UTC` can print.
 */
export const arbIsoParts: fc.Arbitrary<IsoParts> = fc
  .tuple(fc.integer({ min: 1, max: 9998 }), fc.integer({ min: 1, max: 12 }))
  .chain(([year, month]) =>
    fc.record({
      year: fc.constant(year),
      month: fc.constant(month),
      day: fc.integer({ min: 1, max: daysIn(year, month) }),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      second: fc.option(fc.integer({ min: 0, max: 59 }), { nil: null }),
      fraction: fc.option(fc.stringMatching(/^[0-9]{1,9}$/), { nil: null }),
      zone: arbZone,
    }),
  )
  .map((p) => (p.second === null ? { ...p, fraction: null } : p));

export function isoOf(p: IsoParts): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  const seconds = p.second === null ? '' : `:${two(p.second)}${p.fraction === null ? '' : `.${p.fraction}`}`;
  return `${String(p.year).padStart(4, '0')}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}${seconds}${p.zone}`;
}

/** A string in the ISO shape with one field out of range, built by replacing one field of a valid one. */
export const arbBadIso: fc.Arbitrary<string> = fc.tuple(arbIsoParts, fc.constantFrom('month', 'day', 'hour', 'minute', 'second', 'offsetHour', 'offsetMinute'), fc.integer({ min: 0, max: 7 })).map(([p, field, extra]) => {
  const two = (n: number): string => String(n).padStart(2, '0');
  const parts = { year: String(p.year).padStart(4, '0'), month: two(p.month), day: two(p.day), hour: two(p.hour), minute: two(p.minute), second: two(p.second ?? 0), zone: p.zone === 'Z' ? '+00:00' : p.zone };
  switch (field) {
    case 'month': parts.month = extra % 2 === 0 ? '00' : String(13 + extra * 10).slice(0, 2); break;
    case 'day': parts.day = extra % 2 === 0 ? '00' : two(daysIn(p.year, p.month) + 1 + extra); break;
    case 'hour': parts.hour = two(24 + extra); break;
    case 'minute': parts.minute = two(60 + extra); break;
    case 'second': parts.second = two(60 + extra); break;
    case 'offsetHour': parts.zone = `+${two(24 + extra)}:00`; break;
    case 'offsetMinute': parts.zone = `+00:${two(60 + extra)}`; break;
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parts.zone}`;
});
// ---- tokens and actions ----

import type { Action } from '../src/core/tokens';

const arbAddress: fc.Arbitrary<string> = fc
  .tuple(fc.stringMatching(/^[A-Z]{1,3}$/), fc.stringMatching(/^[0-9]{1,3}$/))
  .map(([letters, digits]) => `${letters}${digits}`);

/** One valid action. An edit has an address of 1 to 3 capital letters and 1 to 3 digits, and a raw value of at most 40 bytes. */
export const arbAction: fc.Arbitrary<Action> = fc.oneof(
  fc.constantFrom('N', 'S', 'E', 'W').map((dir): Action => ({ kind: 'move', dir })),
  fc.constant<Action>({ kind: 'wait' }),
  fc.constant<Action>({ kind: 'undo' }),
  fc.tuple(arbAddress, arbCodePointString(40)).map(([address, raw]): Action => ({ kind: 'edit', address, raw })),
);

/** A valid action list of 1 to 40 actions. */
export const arbActionList: fc.Arbitrary<Action[]> = fc.array(arbAction, { minLength: 1, maxLength: 40 });
// ---- trend ----

import { isRecord } from '../src/core/json';

export interface TrendItem {
  valid: boolean;
  value: unknown;
  runId: string | null;
}

const arbStartedAt: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom('2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', '2026-11-04T10:00:00.500Z', 'not a time'),
  { nil: null },
);

/** A valid Trend_Entry (runId from a pool of 60 so that ids repeat, counters 0 to 12 so that counters repeat). */
export const arbTrendEntry: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    runId: fc.integer({ min: 0, max: 59 }).map((n) => `run-${String(n).padStart(3, '0')}`),
    counter: fc.integer({ min: 0, max: 12 }),
    state: fc.constantFrom('running', 'complete', 'failed', 'cut-short', 'weird'),
    startedAt: arbStartedAt,
    commit: fc.option(fc.stringMatching(/^[0-9a-f]{40}$/), { nil: null }),
    green: fc.integer({ min: 0, max: 8 }),
    amber: fc.integer({ min: 0, max: 8 }),
    red: fc.integer({ min: 0, max: 8 }),
    error: fc.integer({ min: 0, max: 8 }),
    levels: fc.dictionary(fc.constantFrom('01-the-corridor', '02-the-chaser', '03-the-locked-crypt'), fc.constantFrom('green', 'amber', 'red', 'error', 'purple'), { noNullPrototype: true }),
  })
  .map((entry) => (entry.startedAt === null ? { ...entry, startedAt: undefined } : entry));

/** An element that is surely not a valid Trend_Entry: JSON that is not a record, or a record that is wrapped. */
const arbNotATrendEntry: fc.Arbitrary<unknown> = arbJson.map((value) => (isRecord(value) ? { wrapped: value } : value));

/** A list of trend elements, valid and invalid, each tagged by construction. */
export const arbTrendItems: fc.Arbitrary<TrendItem[]> = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: arbTrendEntry.map((value): TrendItem => ({ valid: true, value, runId: value['runId'] as string })) },
    { weight: 1, arbitrary: arbNotATrendEntry.map((value): TrendItem => ({ valid: false, value, runId: null })) },
  ),
  { maxLength: 80 },
);

/** Alias used by the tests of Requirement 4: the same list, as the raw value that the route would give. */
export const arbTrend: fc.Arbitrary<unknown[]> = arbTrendItems.map((items) => items.map((item) => item.value));
// ---- findings ----

import { encodeActions } from '../src/core/tokens';

export interface FindingItem {
  valid: boolean;
  value: unknown;
  /** levelId, class and tokens, for a valid item: the key of the duplicate rule. */
  key: string | null;
}

const FOUND_AT = ['2026-11-08T09:00:10Z', '2026-11-08T10:05:00Z', '2026-11-08T11:14:02.511Z', '2026-11-08T12:30:00Z', '2026-11-09T01:00:00Z', 'garbage'];
const LEVELS = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt', '../x'];
const CLASSES = ['cheaper_win', 'free_win', 'unexpected_route', 'odd_class'];
const TOKEN_LISTS: string[][] = [
  ['E'],
  ['E', 'N'],
  ['wait', 'undo'],
  ['edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29', 'E'],
  ['bogus', 'E'],
];

const arbTokenList: fc.Arbitrary<string[]> = fc.oneof(fc.constantFrom(...TOKEN_LISTS), arbActionList.map((list) => encodeActions(list)));

export const arbFinding: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    id: fc.integer({ min: 0, max: 99 }).map((n) => `hunt-x-${String(n).padStart(3, '0')}`),
    levelId: fc.constantFrom(...LEVELS),
    class: fc.constantFrom(...CLASSES),
    commit: fc.option(fc.stringMatching(/^[0-9a-f]{40}$/), { nil: null }),
    foundAt: fc.constantFrom(...FOUND_AT),
    actions: arbTokenList,
    result: fc.record({
      won: fc.boolean(),
      inkSpent: fc.nat({ max: 3 }),
      minimalInk: fc.nat({ max: 3 }),
      editCount: fc.nat({ max: 4 }),
      newEditAddresses: fc.array(fc.constantFrom('A1', 'B14', 'C3'), { maxLength: 4 }),
    }),
  })
  .map((finding) => ({ ...finding, huntId: 'hunt-x' }));

const BREAKERS: Array<(f: Record<string, unknown>) => Record<string, unknown>> = [
  (f) => ({ ...f, actions: Array.from({ length: 41 }, () => 'E') }),
  (f) => ({ ...f, actions: ['E', 'x'.repeat(141)] }),
  (f) => ({ ...f, actions: [] }),
  (f) => ({ ...f, actions: 'E N' }),
  (f) => ({ ...f, actions: ['E', 5] }),
  (f) => ({ ...f, id: 5 }),
  (f) => ({ ...f, levelId: null }),
  (f) => ({ ...f, class: 7 }),
  (f) => ({ ...f, foundAt: null }),
];

/** Valid and invalid items, tagged by construction; an invalid item is a valid one with one field broken, or JSON that is not a record. */
export const arbFindingItems: fc.Arbitrary<FindingItem[]> = fc.array(
  fc.oneof(
    {
      weight: 5,
      arbitrary: arbFinding.map((value): FindingItem => ({
        valid: true,
        value,
        key: `${value['levelId'] as string}\u0000${(value['class'] as string).slice(0, 40)}\u0000${(value['actions'] as string[]).join(' ')}`,
      })),
    },
    { weight: 1, arbitrary: fc.tuple(arbFinding, fc.nat(BREAKERS.length - 1)).map(([f, i]): FindingItem => ({ valid: false, value: (BREAKERS[i] as (f: Record<string, unknown>) => Record<string, unknown>)(f), key: null })) },
    { weight: 1, arbitrary: arbJson.map((v): FindingItem => ({ valid: false, value: isRecord(v) ? { wrapped: v } : v, key: null })) },
  ),
  { maxLength: 60 },
);

/** A Findings_Value record around the items. */
export function findingsValueOf(items: FindingItem[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    updatedAt: '2026-11-08T11:14:02.640Z',
    commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
    huntId: 'hunt-x',
    counts: { attempts: 7, confirmed: 2, rejected: 4, error: 0, duplicate: 1, notRecorded: 0 },
    items: items.map((item) => item.value),
  };
}

export const arbFindingsValue: fc.Arbitrary<Record<string, unknown>> = arbFindingItems.map(findingsValueOf);
// ---- cards ----

/** Level ids for the card tests: a small pool, so that ids repeat across entries and runs. Plain string order matters (upper case sorts first). */
export const LEVEL_POOL = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt', '04-the-trap-row', '05-the-lich', '10-late', 'a', 'b', 'a-1', 'A-upper', 'zz'];
export const KNOWN_COLOURS = ['green', 'amber', 'red', 'error'];

/** A raw level entry as the route would give it: known and unknown colours, any ink numbers, optional extras. */
export const arbLevelEntryRaw: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    levelId: fc.constantFrom(...LEVEL_POOL),
    colour: fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...KNOWN_COLOURS) }, { weight: 1, arbitrary: fc.constantFrom('purple', 'GREEN', '') }),
    inkSpent: fc.nat({ max: 5 }),
    minimalInk: fc.nat({ max: 5 }),
    endHp: fc.nat({ max: 5 }),
    reasonCode: fc.constantFrom('play_failed', 'replay_mismatch', 'level_mismatch'),
    timedOut: fc.boolean(),
  },
  { requiredKeys: ['levelId', 'colour'] },
);

export const arbLevelEntriesRaw: fc.Arbitrary<Array<Record<string, unknown>>> = fc.array(arbLevelEntryRaw, { maxLength: 20 });

/** Runs with distinct counters (so the newest run is the one with the largest counter) whose level maps name ids of the pool. */
export const arbRunsForCards: fc.Arbitrary<Array<Record<string, unknown>>> = fc
  .uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 6 })
  .chain((counters) =>
    fc.tuple(
      ...counters.map((counter) =>
        fc.record({
          runId: fc.constant(`run-${counter}`),
          counter: fc.constant(counter),
          levels: fc.dictionary(fc.constantFrom(...LEVEL_POOL), fc.constantFrom(...KNOWN_COLOURS), { noNullPrototype: true }),
        }),
      ),
    ),
  )
  .map((runs) => runs as Array<Record<string, unknown>>);
// ---- results values, crons values, route states ----

import type { RouteState } from '../src/core/types';

const ISO_POOL = ['2026-11-01T01:00:00.000Z', '2026-11-05T12:30:00Z', '2026-11-07T23:59:59.999Z', '2026-11-08T01:27:00.391Z', '2026-11-08T11:03:12.481Z'];

/** A valid `latest`: unique level ids, a time, an optional failure. */
export const arbLatest: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    runId: fc.integer({ min: 1, max: 99 }).map((n) => `run-${String(n).padStart(6, '0')}`),
    counter: fc.integer({ min: 1, max: 99 }),
    state: fc.constantFrom('running', 'complete', 'failed', 'cut-short'),
    startedAt: fc.constantFrom(...ISO_POOL),
    finishedAt: fc.oneof(fc.constantFrom(...ISO_POOL), fc.constant(null)),
    commit: fc.option(fc.stringMatching(/^[0-9a-f]{40}$/), { nil: null }),
    repoUrl: fc.constant('https://github.com/UBayouski/Grimsheet'),
    branch: fc.constant('main'),
    failure: fc.option(fc.record({ stage: fc.constantFrom('checkout', 'build', 'list'), reasonCode: fc.constantFrom('git_failed', 'build_failed'), message: fc.string({ maxLength: 40 }), exitCode: fc.option(fc.nat({ max: 3 }), { nil: null }) }), { nil: null }),
    coverage: fc.constant({ listed: 5, played: 5, noSolution: 0, unreadable: 0, unlisted: 0, duplicateListedLevels: [], unlistedSolutions: [] }),
    levels: fc.uniqueArray(arbLevelEntryRaw, { selector: (e) => e['levelId'] as string, maxLength: 8 }),
  });

export const arbValidFindingsValue: fc.Arbitrary<Record<string, unknown>> = fc
  .array(arbFinding, { maxLength: 25 })
  .map((list) => findingsValueOf(list.map((value): FindingItem => ({ valid: true, value, key: null }))));

/** A valid Results_Value with `latest`, `trend` and `findings` all present. */
export const arbResultsValue: fc.Arbitrary<Record<string, unknown>> = fc.record({
  schemaVersion: fc.constant(1),
  updatedAt: fc.constant('2026-11-08T11:03:47.950Z'),
  latest: arbLatest,
  trend: fc.uniqueArray(arbTrendEntry, { selector: (e) => e['runId'] as string, maxLength: 35 }),
  findings: arbValidFindingsValue,
});

/** A config object: a valid Results_Value under its key, and a foreign key. */
export const arbConfigValue: fc.Arbitrary<Record<string, unknown>> = fc.record({ theme: fc.constantFrom('dark', 'light'), playtesterResults: arbResultsValue });

export const arbCronJob: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    id: fc.string({ maxLength: 8 }),
    name: fc.constantFrom('replay', 'grimsheet-playtester/replay', 'other', 'x/replay', 'replayer', 5),
    script: fc.oneof(fc.constantFrom('<app>/scripts/replay_cron.py', '<app>/scripts/other.py'), fc.string({ maxLength: 20 })),
    last_run_ts: fc.oneof(fc.integer({ min: 0, max: 4_000_000_000 }), fc.integer({ min: 100_000_000_000, max: 4_000_000_000_000 }), fc.constantFrom(...ISO_POOL), arbJson),
    next_run_ts: fc.oneof(fc.integer({ min: 0, max: 4_000_000_000 }), fc.constantFrom(...ISO_POOL), arbJson),
    last_status: fc.oneof(fc.constantFrom('ok', 'error'), arbJson),
    is_running: fc.oneof(fc.boolean(), arbJson),
    consecutive_failures: fc.oneof(fc.nat({ max: 5 }), arbJson),
    enabled: fc.oneof(fc.boolean(), arbJson),
    user_paused: fc.oneof(fc.boolean(), arbJson),
  },
  { requiredKeys: [] },
);

export const arbCronsValue: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ jobs: fc.array(arbCronJob, { maxLength: 6 }), server_tz: fc.constant('UTC') }) },
  { weight: 1, arbitrary: arbJson },
);

/** A config value or crons value: valid, corrupted in one place, or any JSON. */
export const arbAnyConfigValue: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 2, arbitrary: arbConfigValue },
  { weight: 2, arbitrary: arbConfigValue.chain((valid) => corrupt(valid)) },
  { weight: 1, arbitrary: arbJson },
);

export const arbRouteState = (arbValue: fc.Arbitrary<unknown>): fc.Arbitrary<RouteState> =>
  fc.record({
    status: fc.constantFrom('pending', 'ok', 'failed'),
    hasGood: fc.boolean(),
    good: arbValue,
    goodAtMs: fc.option(fc.integer({ min: 0, max: 4_000_000_000_000 }), { nil: null }),
    error: fc.option(fc.string({ maxLength: 300 }), { nil: null }),
  });
// ---- scheduler ----

export type SchedulerOp =
  | { type: 'tick'; dt: number }
  | { type: 'visibility'; dt: number; visible: boolean }
  | { type: 'refresh'; dt: number }
  | { type: 'complete'; dt: number; isRunning: boolean }
  | { type: 'unmount'; dt: number };

const arbDt = fc.oneof(fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 0, max: 90_000 }), fc.constantFrom(0, 14_999, 15_000, 59_999, 60_000, 60_001));

/** Operations with non-negative time steps: ticks, visibility changes, Refresh activations and Read completions. */
export const arbSchedulerOps: fc.Arbitrary<SchedulerOp[]> = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: arbDt.map((dt): SchedulerOp => ({ type: 'tick', dt })) },
    { weight: 3, arbitrary: fc.tuple(arbDt, fc.boolean()).map(([dt, visible]): SchedulerOp => ({ type: 'visibility', dt, visible })) },
    { weight: 2, arbitrary: arbDt.map((dt): SchedulerOp => ({ type: 'refresh', dt })) },
    { weight: 4, arbitrary: fc.tuple(arbDt, fc.boolean()).map(([dt, isRunning]): SchedulerOp => ({ type: 'complete', dt, isRunning })) },
    { weight: 1, arbitrary: arbDt.map((dt): SchedulerOp => ({ type: 'unmount', dt })) },
  ),
  { maxLength: 80 },
);
// ---- controller ----

export type ControllerOp =
  | { op: 'advance'; ms: number }
  | { op: 'visible'; visible: boolean }
  | { op: 'refresh' }
  | { op: 'stop' }
  | { op: 'start' };

/** How one request ends: at once, after a delay, late (after the 10 second limit), by an error, never, or by a synchronous throw. */
export const REQUEST_OUTCOMES = ['ok', 'okDelayed', 'okLate', 'fail', 'failDelayed', 'never', 'throw'] as const;
export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

export const arbRequestOutcomes: fc.Arbitrary<RequestOutcome[]> = fc.array(
  fc.oneof({ weight: 4, arbitrary: fc.constant<RequestOutcome>('ok') }, { weight: 4, arbitrary: fc.constantFrom(...REQUEST_OUTCOMES) }),
  { minLength: 1, maxLength: 12 },
);

export const arbControllerOps: fc.Arbitrary<ControllerOp[]> = fc.array(
  fc.oneof(
    { weight: 6, arbitrary: fc.oneof(fc.integer({ min: 0, max: 5_000 }), fc.integer({ min: 0, max: 80_000 }), fc.constantFrom(9_999, 10_000, 14_999, 15_000, 59_999, 60_000)).map((ms): ControllerOp => ({ op: 'advance', ms })) },
    { weight: 3, arbitrary: fc.boolean().map((visible): ControllerOp => ({ op: 'visible', visible })) },
    { weight: 3, arbitrary: fc.constant<ControllerOp>({ op: 'refresh' }) },
    { weight: 1, arbitrary: fc.constant<ControllerOp>({ op: 'stop' }) },
    { weight: 1, arbitrary: fc.constant<ControllerOp>({ op: 'start' }) },
  ),
  { maxLength: 30 },
);
// ---- hostile text ----

/** Strings that would do harm if they were put into markup, a URL or a style. */
export const HOSTILE_SNIPPETS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '</style><script>1</script>',
  '<svg onload=1>',
  '"><b>x</b>',
  "' onmouseover='1",
  '&amp; &lt;b&gt;',
  'javascript:alert(1)',
  'line one\nline two',
  '<!-- comment -->',
  '${1+1} {{x}}',
];

export const arbHostile: fc.Arbitrary<string> = fc.oneof(fc.constantFrom(...HOSTILE_SNIPPETS), fc.tuple(fc.constantFrom(...HOSTILE_SNIPPETS), fc.string({ maxLength: 10 })).map(([a, b]) => `${a}${b}`));

/** Puts `prefix` in front of every string value (not key) of a JSON value. */
export function prefixStrings(value: unknown, prefix: string): unknown {
  if (typeof value === 'string') return `${prefix}${value}`;
  if (Array.isArray(value)) return value.map((item) => prefixStrings(item, prefix));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, prefixStrings(v, prefix)]));
  return value;
}