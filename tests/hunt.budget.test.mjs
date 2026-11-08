// @ts-check
// Task 7.1 of the exploit-hunt spec: unit tests for scripts/hunt/budget.mjs (written before the module exists).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { budgetLeft, deadlineOf, decideSubmit } from '../scripts/hunt/budget.mjs';
import { parseSubmitArgs } from '../scripts/hunt/args.mjs';
import { arbSubmitState } from './hunt.arbitraries.mjs';

const LEVELS = ['01-the-corridor', '02-the-chaser'];
const DEADLINE = 1_000_000;

/** @returns {any} a valid parsed Hunt_Submit command line for the given level */
function good(levelId = '01-the-corridor') {
  const parsed = parseSubmitArgs(['--level', levelId, '--class', 'free_win', '--actions', 'E', 'N']);
  if (!parsed.ok) throw new Error('fixture must parse');
  return parsed;
}

/** @returns {any} a parsed command line that failed to parse */
function bad() {
  const parsed = parseSubmitArgs(['--level', '01-the-corridor']);
  if (parsed.ok) throw new Error('fixture must not parse');
  return parsed;
}

/** A state that passes all seven checks; tests override one or more fields. */
function state(over = {}) {
  return {
    active: true,
    refusals: 0,
    attempts: 0,
    levelAttempts: /** @type {Record<string, number>} */ ({}),
    levels: LEVELS,
    nowMs: DEADLINE - 1000,
    deadlineMs: DEADLINE,
    parsed: good(),
    ...over,
  };
}

describe('decideSubmit: attempt', () => {
  it('returns an attempt that carries the parsed level, class and actions', () => {
    const p = good('02-the-chaser');
    const d = decideSubmit(state({ parsed: p }));
    expect(d).toEqual({ kind: 'attempt', levelId: '02-the-chaser', claimedClass: 'free_win', actions: p.actions });
  });

  it('still attempts with 3 level attempts, 19 total attempts and 9 refusals', () => {
    const d = decideSubmit(state({ levelAttempts: { '01-the-corridor': 3 }, attempts: 19, refusals: 9 }));
    expect(d.kind).toBe('attempt');
  });
});

describe('decideSubmit: the seven reason codes', () => {
  it('1 no_active_hunt: charge none, finish false', () => {
    expect(decideSubmit(state({ active: false }))).toEqual({
      kind: 'refuse', reasonCode: 'no_active_hunt', charge: 'none', finish: false,
    });
  });

  it('2 refusal_budget_spent: charge none, finish true', () => {
    expect(decideSubmit(state({ refusals: 10 }))).toEqual({
      kind: 'refuse', reasonCode: 'refusal_budget_spent', charge: 'none', finish: true,
    });
  });

  it('3 bad_arguments: charge refusal, finish false, detail copied from the parser', () => {
    const p = bad();
    expect(decideSubmit(state({ parsed: p }))).toEqual({
      kind: 'refuse', reasonCode: 'bad_arguments', charge: 'refusal', finish: false, detail: p.detail,
    });
  });

  it('4 unknown_level: charge refusal, finish false', () => {
    expect(decideSubmit(state({ parsed: good('09-not-in-this-hunt') }))).toEqual({
      kind: 'refuse', reasonCode: 'unknown_level', charge: 'refusal', finish: false,
    });
  });

  it('5 level_budget_spent: charge refusal, finish false', () => {
    expect(decideSubmit(state({ levelAttempts: { '01-the-corridor': 4 } }))).toEqual({
      kind: 'refuse', reasonCode: 'level_budget_spent', charge: 'refusal', finish: false,
    });
  });

  it('6 total_budget_spent: charge none, finish true', () => {
    expect(decideSubmit(state({ attempts: 20 }))).toEqual({
      kind: 'refuse', reasonCode: 'total_budget_spent', charge: 'none', finish: true,
    });
  });

  it('7 time_budget_spent: charge none, finish true', () => {
    expect(decideSubmit(state({ nowMs: DEADLINE + 5000 }))).toEqual({
      kind: 'refuse', reasonCode: 'time_budget_spent', charge: 'none', finish: true,
    });
  });
});

describe('decideSubmit: order of checks', () => {
  it('a state that fails checks 3 and 5 gives bad_arguments', () => {
    const d = decideSubmit(state({ parsed: bad(), levelAttempts: { '01-the-corridor': 4 } }));
    expect(d).toMatchObject({ kind: 'refuse', reasonCode: 'bad_arguments' });
  });

  it('refusals at 10 and a bad argument gives refusal_budget_spent', () => {
    const d = decideSubmit(state({ refusals: 10, parsed: bad() }));
    expect(d).toMatchObject({ kind: 'refuse', reasonCode: 'refusal_budget_spent', charge: 'none', finish: true });
  });

  it('no active hunt wins over a spent refusal budget', () => {
    expect(decideSubmit(state({ active: false, refusals: 10 }))).toMatchObject({ reasonCode: 'no_active_hunt' });
  });

  it('level_budget_spent (5) comes before total_budget_spent (6) and time_budget_spent (7)', () => {
    const d = decideSubmit(state({ levelAttempts: { '01-the-corridor': 4 }, attempts: 20, nowMs: DEADLINE }));
    expect(d).toMatchObject({ reasonCode: 'level_budget_spent', charge: 'refusal', finish: false });
  });

  it('total_budget_spent (6) comes before time_budget_spent (7)', () => {
    expect(decideSubmit(state({ attempts: 20, nowMs: DEADLINE }))).toMatchObject({ reasonCode: 'total_budget_spent' });
  });

  it('unknown_level (4) comes before level_budget_spent (5)', () => {
    const d = decideSubmit(state({ parsed: good('09-not-in-this-hunt'), levelAttempts: { '09-not-in-this-hunt': 4 } }));
    expect(d).toMatchObject({ reasonCode: 'unknown_level' });
  });

  it('lazy finish: the call that spends the 10th refusal is answered and charged, the 11th is refused and finishes', () => {
    // 9 refusals so far: a bad argument is still answered as bad_arguments and charged (it becomes the 10th).
    expect(decideSubmit(state({ refusals: 9, parsed: bad() }))).toMatchObject({
      reasonCode: 'bad_arguments', charge: 'refusal', finish: false,
    });
    // 10 refusals now: the next call, valid or not, is refused without a charge and finishes the hunt.
    expect(decideSubmit(state({ refusals: 10, parsed: bad() }))).toMatchObject({
      reasonCode: 'refusal_budget_spent', charge: 'none', finish: true,
    });
    expect(decideSubmit(state({ refusals: 10 }))).toMatchObject({
      reasonCode: 'refusal_budget_spent', charge: 'none', finish: true,
    });
  });
});

describe('decideSubmit: boundaries', () => {
  it('now >= deadline is spent', () => {
    expect(decideSubmit(state({ nowMs: DEADLINE }))).toMatchObject({ reasonCode: 'time_budget_spent', finish: true });
  });

  it('now = deadline - 1 is not spent', () => {
    expect(decideSubmit(state({ nowMs: DEADLINE - 1 })).kind).toBe('attempt');
  });

  it('level attempts 3 is open, 4 is spent', () => {
    expect(decideSubmit(state({ levelAttempts: { '01-the-corridor': 3 } })).kind).toBe('attempt');
    expect(decideSubmit(state({ levelAttempts: { '01-the-corridor': 4 } }))).toMatchObject({ reasonCode: 'level_budget_spent' });
  });

  it('total attempts 19 is open, 20 is spent', () => {
    expect(decideSubmit(state({ attempts: 19 })).kind).toBe('attempt');
    expect(decideSubmit(state({ attempts: 20 }))).toMatchObject({ reasonCode: 'total_budget_spent' });
  });

  it('refusals 9 is open, 10 is spent', () => {
    expect(decideSubmit(state({ refusals: 9 })).kind).toBe('attempt');
    expect(decideSubmit(state({ refusals: 10 }))).toMatchObject({ reasonCode: 'refusal_budget_spent' });
  });

  it('a level missing from levelAttempts counts as 0 attempts', () => {
    expect(decideSubmit(state({ levelAttempts: { '02-the-chaser': 4 } })).kind).toBe('attempt');
  });
});

describe('deadlineOf', () => {
  it('is readyAtMs + 1800000', () => {
    expect(deadlineOf(0)).toBe(1_800_000);
    expect(deadlineOf(1_700_000_000_000)).toBe(1_700_001_800_000);
  });
});

describe('budgetLeft', () => {
  /** A Hunt_Record reduced to the fields the budgets read. */
  function record(over = {}) {
    return {
      attempts: 7,
      refusals: 1,
      budget: { perLevel: 4, total: 20, seconds: 1800, refusals: 10 },
      levels: {
        '01-the-corridor': { attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 },
        '02-the-chaser': { attempts: 4, confirmed: 1, rejected: 2, error: 0, duplicate: 1, notRecorded: 0 },
      },
      ...over,
    };
  }

  it('reports level, total, refusals and seconds left', () => {
    const left = budgetLeft(/** @type {any} */ (record()), '01-the-corridor', 0, 100_000);
    expect(left).toEqual({ level: 4, total: 13, refusals: 9, seconds: 100 });
  });

  it('level is 0 for a level whose attempts are spent', () => {
    expect(budgetLeft(/** @type {any} */ (record()), '02-the-chaser', 0, 100_000).level).toBe(0);
  });

  it('level is null when no level applies (null id or a level not in the record)', () => {
    expect(budgetLeft(/** @type {any} */ (record()), null, 0, 100_000).level).toBeNull();
    expect(budgetLeft(/** @type {any} */ (record()), '09-not-in-this-hunt', 0, 100_000).level).toBeNull();
  });

  it('seconds is never negative once the deadline has passed', () => {
    expect(budgetLeft(/** @type {any} */ (record()), '01-the-corridor', 200_000, 100_000).seconds).toBe(0);
    expect(budgetLeft(/** @type {any} */ (record()), '01-the-corridor', 100_000, 100_000).seconds).toBe(0);
  });

  it('a fresh record has the full budgets', () => {
    const fresh = record({ attempts: 0, refusals: 0 });
    expect(budgetLeft(/** @type {any} */ (fresh), '01-the-corridor', 0, 1_800_000)).toEqual({
      level: 4, total: 20, refusals: 10, seconds: 1800,
    });
  });
});

// Feature: exploit-hunt, Property 6: One reason code per call
// **Validates: Requirements 9.10, 9.3, 9.4, 9.5**
describe('Property 6: One reason code per call', () => {
  /**
   * Independent oracle: the seven predicates of Requirement 9, criterion 10, as a plain chain with the
   * literal limits (4 per level, 20 in total, 10 refusals).
   * @param {any} s
   * @returns {{reasonCode: string, charge: 'none'|'refusal', finish: boolean} | {reasonCode: 'attempt'}}
   */
  function oracle(s) {
    if (s.active !== true) return { reasonCode: 'no_active_hunt', charge: 'none', finish: false };
    if (s.refusals >= 10) return { reasonCode: 'refusal_budget_spent', charge: 'none', finish: true };
    if (s.parsed.ok !== true) return { reasonCode: 'bad_arguments', charge: 'refusal', finish: false };
    if (s.levels.indexOf(s.parsed.levelId) === -1) return { reasonCode: 'unknown_level', charge: 'refusal', finish: false };
    const used = s.levelAttempts[s.parsed.levelId] === undefined ? 0 : s.levelAttempts[s.parsed.levelId];
    if (used >= 4) return { reasonCode: 'level_budget_spent', charge: 'refusal', finish: false };
    if (s.attempts >= 20) return { reasonCode: 'total_budget_spent', charge: 'none', finish: true };
    if (s.nowMs >= s.deadlineMs) return { reasonCode: 'time_budget_spent', charge: 'none', finish: true };
    return { reasonCode: 'attempt' };
  }

  it('decideSubmit returns exactly one result and it equals the oracle', () => {
    fc.assert(
      fc.property(arbSubmitState, (s) => {
        const expected = oracle(s);
        const got = decideSubmit(s);
        if (expected.reasonCode === 'attempt') {
          expect(got.kind).toBe('attempt');
          expect(got).toEqual({
            kind: 'attempt', levelId: s.parsed.levelId, claimedClass: s.parsed.claimedClass, actions: s.parsed.actions,
          });
          return;
        }
        expect(got.kind).toBe('refuse');
        if (got.kind !== 'refuse') return;
        expect(got.reasonCode).toBe(expected.reasonCode);
        expect(got.charge).toBe(/** @type {any} */ (expected).charge);
        expect(got.finish).toBe(/** @type {any} */ (expected).finish);
        if (got.reasonCode === 'bad_arguments') expect(got.detail).toBe(s.parsed.detail);
      }),
      { numRuns: 500 },
    );
  });
});
