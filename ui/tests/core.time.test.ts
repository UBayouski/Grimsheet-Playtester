import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbBadIso, arbIsoParts, arbJson, arbNow, isoOf } from './arbitraries';
import { STALE_LIMIT_MS, formatUtc, isStale, parseCronTime, parseTime, replayTimeOf } from '../src/core/time';

const T = Date.UTC(2026, 10, 8, 11, 3, 12, 481);

describe('parseTime', () => {
  it('parses the forms the writers produce', () => {
    expect(parseTime('2026-11-08T11:03:12.481Z')).toBe(T);
    expect(parseTime('2026-11-08T11:03:12Z')).toBe(T - 481);
    expect(parseTime('2026-11-08T11:03Z')).toBe(T - 481 - 12000);
  });

  it('handles an offset', () => {
    expect(parseTime('2026-11-08T13:03:12.481+02:00')).toBe(T);
    expect(parseTime('2026-11-08T09:03:12.481-02:00')).toBe(T);
  });

  it('keeps the first three digits of a longer fraction', () => {
    expect(parseTime('2026-11-08T11:03:12.4819999Z')).toBe(T);
    expect(parseTime('2026-11-08T11:03:12.4Z')).toBe(T - 81);
  });

  it('returns null for a date only, a wrong month, day, hour, minute, second or offset', () => {
    for (const s of [
      '2026-11-08',
      '2026-13-08T00:00:00Z',
      '2026-00-08T00:00:00Z',
      '2026-11-31T00:00:00Z',
      '2026-02-30T00:00:00Z',
      '2026-02-29T00:00:00Z',
      '2026-11-08T24:00:00Z',
      '2026-11-08T11:60:00Z',
      '2026-11-08T11:03:60Z',
      '2026-11-08T11:03:12+24:00',
      '2026-11-08T11:03:12+02:60',
      '2026-11-08 11:03:12Z',
      '2026-11-08T11:03:12',
      ' 2026-11-08T11:03:12Z',
      '2026-11-08T11:03:12Z ',
      '',
      'not a date',
    ]) {
      expect(parseTime(s), s).toBeNull();
    }
  });

  it('accepts 29 February in a leap year and rejects it in 1900', () => {
    expect(parseTime('2024-02-29T00:00:00Z')).toBe(Date.UTC(2024, 1, 29));
    expect(parseTime('2000-02-29T00:00:00Z')).toBe(Date.UTC(2000, 1, 29));
    expect(parseTime('1900-02-29T00:00:00Z')).toBeNull();
  });

  it('returns null for a value that is not a string', () => {
    for (const v of [null, undefined, 5, true, {}, [], ['2026-11-08T11:03:12Z']]) expect(parseTime(v)).toBeNull();
  });
});

describe('parseCronTime', () => {
  it('reads epoch seconds below 1e11 and epoch milliseconds from there', () => {
    expect(parseCronTime(1_700_000_000)).toBe(1_700_000_000_000);
    expect(parseCronTime(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseCronTime(99_999_999_999)).toBe(99_999_999_999_000);
    expect(parseCronTime(1e11)).toBe(1e11);
    expect(parseCronTime(0)).toBe(0);
  });

  it('reads an ISO string', () => {
    expect(parseCronTime('2026-11-08T11:03:12.481Z')).toBe(T);
  });

  it('returns null for a negative number, NaN, Infinity, a number too large for a date, and other types', () => {
    for (const v of [-1, NaN, Infinity, -Infinity, 9e15, '1700000000', {}, [], null, undefined, true]) expect(parseCronTime(v), String(v)).toBeNull();
  });
});

describe('formatUtc', () => {
  it('formats as YYYY-MM-DD HH:MM UTC and floors the minute', () => {
    expect(formatUtc(T)).toBe('2026-11-08 11:03 UTC');
    expect(formatUtc(Date.UTC(2026, 0, 2, 3, 4, 59, 999))).toBe('2026-01-02 03:04 UTC');
    expect(formatUtc(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31 23:59 UTC');
  });

  it('gives "time unknown" for null, NaN and a value that is not a date', () => {
    expect(formatUtc(null)).toBe('time unknown');
    expect(formatUtc(NaN)).toBe('time unknown');
    expect(formatUtc(Infinity)).toBe('time unknown');
    expect(formatUtc(9e15)).toBe('time unknown');
  });
});

describe('isStale', () => {
  it('has a limit of 36 hours', () => {
    expect(STALE_LIMIT_MS).toBe(129_600_000);
    expect(STALE_LIMIT_MS).toBe(36 * 3600 * 1000);
  });

  it('is false at exactly 36 hours and true one millisecond later', () => {
    expect(isStale(T, T + STALE_LIMIT_MS)).toBe(false);
    expect(isStale(T, T + STALE_LIMIT_MS + 1)).toBe(true);
  });

  it('is false for a time after now, equal to now, and for a null time', () => {
    expect(isStale(T + 5, T)).toBe(false);
    expect(isStale(T, T)).toBe(false);
    expect(isStale(null, T + 10 * STALE_LIMIT_MS)).toBe(false);
  });

  it('is false when now is not a finite number', () => {
    for (const now of [NaN, Infinity, -Infinity, '1800000000000', null, undefined, {}]) expect(isStale(T, now), String(now)).toBe(false);
  });
});

describe('replayTimeOf', () => {
  it('takes finishedAt when it is a string, otherwise startedAt', () => {
    expect(replayTimeOf({ finishedAt: '2026-11-08T11:03:12.481Z', startedAt: '2026-11-08T10:00:00Z' })).toBe(T);
    expect(replayTimeOf({ finishedAt: null, startedAt: '2026-11-08T11:03:12.481Z' })).toBe(T);
    expect(replayTimeOf({ startedAt: '2026-11-08T11:03:12.481Z' })).toBe(T);
    expect(replayTimeOf({ finishedAt: 5, startedAt: '2026-11-08T11:03:12.481Z' })).toBe(T);
  });

  it('does not fall back to startedAt when finishedAt is a string that does not parse', () => {
    expect(replayTimeOf({ finishedAt: 'garbage', startedAt: '2026-11-08T11:03:12.481Z' })).toBeNull();
  });

  it('returns null when there is no usable time', () => {
    expect(replayTimeOf({})).toBeNull();
    expect(replayTimeOf({ startedAt: 'x' })).toBeNull();
  });

  it('does not read the prototype chain', () => {
    const record = Object.create({ finishedAt: '2026-11-08T11:03:12.481Z' }) as Record<string, unknown>;
    expect(replayTimeOf(record)).toBeNull();
  });
});
describe('time properties', () => {
  // Feature: dashboard, Property 12: Time functions
  it('Property 12: formatUtc, parseTime and parseCronTime', () => {
    // A valid ISO string, built by construction, is read and printed in the form YYYY-MM-DD HH:MM UTC.
    fc.assert(
      fc.property(arbIsoParts, (parts) => {
        const ms = parseTime(isoOf(parts));
        expect(ms).not.toBeNull();
        expect(formatUtc(ms)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      }),
      { numRuns: 300 },
    );
    // A string with a month, day, hour, minute, second or offset out of range is "time unknown".
    fc.assert(
      fc.property(arbBadIso, (text) => {
        expect(parseTime(text), text).toBeNull();
        expect(formatUtc(parseTime(text))).toBe('time unknown');
      }),
      { numRuns: 300 },
    );
    // Below 1e11 a number is seconds. From 1e8 seconds up, the same instant in milliseconds reads the same
    // (a smaller instant in milliseconds is below 1e11 and so reads as seconds: the rule has that limit).
    fc.assert(
      fc.property(fc.integer({ min: 100_000_000, max: 99_999_999_999 }), (seconds) => {
        expect(parseCronTime(seconds)).toBe(seconds * 1000);
        expect(parseCronTime(seconds * 1000)).toBe(parseCronTime(seconds));
      }),
      { numRuns: 300 },
    );
    // Nothing throws, whatever the input.
    fc.assert(
      fc.property(arbJson, arbNow, (value, now) => {
        expect(() => {
          parseTime(value);
          parseCronTime(value);
          formatUtc(parseCronTime(value));
          isStale(parseTime(value), now);
          isStale(parseCronTime(now), now);
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) replayTimeOf(value as Record<string, unknown>);
        }).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it('an instant outside the years 0000 to 9999 cannot be printed and is "time unknown"', () => {
    const ms = parseTime('9999-12-31T23:59:00-23:59');
    expect(ms).not.toBeNull();
    expect(formatUtc(ms)).toBe('time unknown');
  });

  it('a small number of milliseconds reads as seconds (the limit of the rule)', () => {
    expect(parseCronTime(5000)).toBe(5_000_000);
  });
});