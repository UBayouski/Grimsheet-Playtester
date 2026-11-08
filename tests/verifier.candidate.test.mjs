// @ts-check
import { describe, it, expect } from 'vitest';
import { checkCandidate } from '../scripts/verifier.mjs';

const LEVEL = '02-the-chaser';
const CLASSES = ['cheaper_win', 'free_win', 'unexpected_route'];

const MOVE_E = { kind: 'move', dir: 'E' };
const EDIT_B14 = { kind: 'edit', address: 'B14', raw: '=1' };
const EDIT_C3 = { kind: 'edit', address: 'C3', raw: '=2' };

/** @returns {any} a stored solution: one edit on B14 and two moves, minimalInk 1 */
function storedOne() {
  return { levelId: LEVEL, minimalInk: 1, actions: [{ ...EDIT_B14 }, { ...MOVE_E }, { ...MOVE_E }] };
}

/**
 * Builds the six arguments of checkCandidate: a stored solution, a claimed class, the candidate
 * actions and the play that replays the candidate (steps echo the candidate actions).
 * @param {{stored?: any, claimedClass?: any, candidate?: any[], spent?: number, endStatus?: string,
 *   refused?: number[], exitCode?: any}} [o]
 * @returns {any[]} [levelId, stored, claimedClass, candidate, exitCode, play]
 */
function build(o = {}) {
  const stored = o.stored ?? storedOne();
  const candidate = o.candidate ?? [{ ...MOVE_E }, { ...MOVE_E }];
  const refused = o.refused ?? [];
  const spent = o.spent ?? 0;
  const endStatus = o.endStatus ?? 'won';
  const n = candidate.length;
  /** @type {any[]} */
  const steps = candidate.map((a, i) => {
    /** @type {any} */
    const action = { kind: a.kind };
    if (a.kind === 'move') action.dir = a.dir;
    if (a.kind === 'edit') {
      action.address = a.address;
      action.raw = a.raw;
    }
    /** @type {any} */
    const step = { index: i, action, accepted: !refused.includes(i) };
    if (refused.includes(i)) {
      step.reason = 'refused-for-test';
      step.message = 'The action was refused.';
    }
    step.damage = [];
    step.hero = 'B6';
    step.hp = 3;
    step.ink = i === n - 1 ? 0 : spent;
    step.turn = i + 1;
    step.status = i === n - 1 ? endStatus : 'playing';
    return step;
  });
  const last = steps[n - 1];
  /** @type {any} */
  const play = {
    levelId: LEVEL,
    start: { hero: 'B6', hp: 3, ink: spent, turn: 0, status: 'playing', monsters: [] },
    steps,
    final: { hero: 'B6', hp: 3, ink: 0, turn: n, status: last ? last.status : endStatus, monsters: [] },
  };
  return [LEVEL, stored, o.claimedClass ?? 'cheaper_win', candidate, o.exitCode ?? 0, play];
}

/**
 * @param {Parameters<typeof build>[0]} [o]
 * @param {(args: any[]) => void} [change] edits the built arguments before the call
 * @returns {any}
 */
function check(o, change) {
  const a = build(o);
  if (change) change(a);
  return checkCandidate(a[0], a[1], a[2], a[3], a[4], a[5]);
}

/**
 * @param {any} r
 * @param {string} code
 * @param {{levelId?: unknown, claimedClass?: unknown}} [expected] levelId / claimedClass expected on the error (omit for none)
 */
function expectCheckError(r, code, expected = {}) {
  expect(r.outcome).toBe('error');
  expect(r.reasonCode).toBe(code);
  expect(typeof r.reason).toBe('string');
  expect(r.reason.length).toBeGreaterThan(0);
  expect('colour' in r).toBe(false);
  if (typeof expected.levelId === 'string') expect(r.levelId).toBe(expected.levelId);
  else expect('levelId' in r).toBe(false);
  if (typeof expected.claimedClass === 'string') expect(r.claimedClass).toBe(expected.claimedClass);
  else expect('claimedClass' in r).toBe(false);
  expect(JSON.parse(JSON.stringify(r))).toEqual(r);
}

const RESULT_KEYS = [
  'claimedClass', 'editCount', 'inkSpent', 'levelId', 'minimalInk', 'newEditAddresses', 'outcome', 'reason', 'reasonCode', 'won',
];

describe('checkCandidate: cheaper_win', () => {
  it('confirmed: won with less ink than minimalInk', () => {
    const r = check({ claimedClass: 'cheaper_win', spent: 0 });
    expect(r.outcome).toBe('confirmed');
    expect(r.reasonCode).toBe('class_reproduced');
    expect(r.inkSpent).toBe(0);
    expect(r.minimalInk).toBe(1);
  });

  it.each([[1], [2]])('rejected not_cheaper when the win spends %j (minimalInk 1)', (spent) => {
    const r = check({ claimedClass: 'cheaper_win', spent });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('not_cheaper');
  });

  it('minimalInk 0 gives no_ink_below_zero', () => {
    const r = check({ claimedClass: 'cheaper_win', stored: { levelId: LEVEL, minimalInk: 0, actions: [{ ...MOVE_E }, { ...MOVE_E }] } });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('no_ink_below_zero');
    expect(r.reason).not.toMatch(/Measured/);
  });
});

describe('checkCandidate: free_win', () => {
  it('confirmed: won with no edits and minimalInk above 0', () => {
    const r = check({ claimedClass: 'free_win', spent: 1 });
    expect(r.outcome).toBe('confirmed');
    expect(r.reasonCode).toBe('class_reproduced');
    expect(r.editCount).toBe(0);
  });

  it('rejected has_edits when the candidate holds an edit', () => {
    const r = check({ claimedClass: 'free_win', candidate: [{ ...EDIT_B14 }, { ...MOVE_E }], spent: 1 });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('has_edits');
    expect(r.editCount).toBe(1);
  });

  it('rejected has_edits even when the edit was refused', () => {
    const r = check({ claimedClass: 'free_win', candidate: [{ ...EDIT_B14 }, { ...MOVE_E }], refused: [0], spent: 1 });
    expect(r.reasonCode).toBe('has_edits');
    expect(r.editCount).toBe(1);
  });

  it('minimalInk 0 gives minimal_ink_zero', () => {
    const r = check({ claimedClass: 'free_win', stored: { levelId: LEVEL, minimalInk: 0, actions: [{ ...MOVE_E }] } });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('minimal_ink_zero');
    expect(r.reason).not.toMatch(/Measured/);
  });
});

describe('checkCandidate: unexpected_route', () => {
  it('confirmed: an accepted edit on a cell the stored solution never edits', () => {
    const r = check({ claimedClass: 'unexpected_route', candidate: [{ ...EDIT_C3 }, { ...MOVE_E }], spent: 1 });
    expect(r.outcome).toBe('confirmed');
    expect(r.reasonCode).toBe('class_reproduced');
    expect(r.newEditAddresses).toEqual(['C3']);
  });

  it('rejected no_new_cell: the candidate edits only a stored cell', () => {
    const r = check({ claimedClass: 'unexpected_route', candidate: [{ ...EDIT_B14 }, { ...MOVE_E }], spent: 1 });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('no_new_cell');
    expect(r.newEditAddresses).toEqual([]);
  });

  it('rejected no_new_cell: the candidate has no edit at all', () => {
    const r = check({ claimedClass: 'unexpected_route' });
    expect(r.reasonCode).toBe('no_new_cell');
  });

  it('a stored lower-case address matches an upper-case step address', () => {
    const stored = storedOne();
    stored.actions[0].address = 'b14';
    const r = check({ claimedClass: 'unexpected_route', stored, candidate: [{ ...EDIT_B14 }, { ...MOVE_E }], spent: 1 });
    expect(r.reasonCode).toBe('no_new_cell');
    expect(r.newEditAddresses).toEqual([]);
  });

  it('a lower-case or padded step address matches an upper-case stored address', () => {
    for (const address of ['b14', ' B14 ', ' b14']) {
      const r = check({ claimedClass: 'unexpected_route', candidate: [{ kind: 'edit', address, raw: '=1' }, { ...MOVE_E }], spent: 1 });
      expect(r.reasonCode).toBe('no_new_cell');
      expect(r.newEditAddresses).toEqual([]);
    }
  });

  it('a refused edit on a new cell gives no_new_cell, and still counts in editCount', () => {
    const r = check({ claimedClass: 'unexpected_route', candidate: [{ ...EDIT_C3 }, { ...MOVE_E }], refused: [0], spent: 1 });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('no_new_cell');
    expect(r.newEditAddresses).toEqual([]);
    expect(r.editCount).toBe(1);
  });

  it('an accepted edit on a new cell, an accepted undo, then the stored solution: rejected no_new_cell', () => {
    const stored = storedOne();
    const candidate = [{ ...EDIT_C3 }, { kind: 'undo' }, ...structuredClone(stored.actions)];
    const r = check({ claimedClass: 'unexpected_route', stored, candidate, spent: 1 });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('no_new_cell');
    expect(r.newEditAddresses).toEqual([]);
    expect(r.editCount).toBe(2);
  });

  it('a refused step between the edit and the undo still counts as undone', () => {
    const stored = storedOne();
    const candidate = [{ ...EDIT_C3 }, { kind: 'wait' }, { kind: 'undo' }, ...structuredClone(stored.actions)];
    const r = check({ claimedClass: 'unexpected_route', stored, candidate, refused: [1], spent: 1 });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('no_new_cell');
    expect(r.newEditAddresses).toEqual([]);
  });

  it('an edit followed by an accepted step that is not an undo is kept', () => {
    const candidate = [{ ...EDIT_C3 }, { ...MOVE_E }, { kind: 'undo' }];
    const r = check({ claimedClass: 'unexpected_route', candidate, spent: 1 });
    expect(r.outcome).toBe('confirmed');
    expect(r.newEditAddresses).toEqual(['C3']);
  });

  it('an edit followed only by a refused undo is kept', () => {
    const candidate = [{ ...EDIT_C3 }, { kind: 'undo' }];
    const r = check({ claimedClass: 'unexpected_route', candidate, refused: [1], spent: 1 });
    expect(r.outcome).toBe('confirmed');
    expect(r.newEditAddresses).toEqual(['C3']);
  });
});

describe('checkCandidate: measured values', () => {
  it('not_won is rejected for every claimed class', () => {
    for (const claimedClass of CLASSES) {
      const r = check({ claimedClass, endStatus: 'lost', candidate: [{ ...EDIT_C3 }, { ...MOVE_E }], spent: 0 });
      expect(r.outcome).toBe('rejected');
      expect(r.reasonCode).toBe('not_won');
      expect(r.won).toBe(false);
      expect(r.reason).not.toMatch(/Measured/);
    }
  });

  it('a run still in progress is not won', () => {
    const r = check({ claimedClass: 'cheaper_win', endStatus: 'playing' });
    expect(r.reasonCode).toBe('not_won');
  });

  it('a copy of the stored actions is rejected for all three classes (minimalInk 1, one edit)', () => {
    const stored = storedOne();
    const expected = { cheaper_win: 'not_cheaper', free_win: 'has_edits', unexpected_route: 'no_new_cell' };
    for (const claimedClass of CLASSES) {
      const r = check({ claimedClass, stored, candidate: structuredClone(stored.actions), spent: 1 });
      expect(r.outcome).toBe('rejected');
      expect(r.reasonCode).toBe(/** @type {Record<string, string>} */ (expected)[claimedClass]);
    }
  });

  it('a copy of the stored actions is rejected for all three classes (minimalInk 0, no edits)', () => {
    const stored = { levelId: LEVEL, minimalInk: 0, actions: [{ ...MOVE_E }, { ...MOVE_E }, { ...MOVE_E }] };
    const expected = { cheaper_win: 'no_ink_below_zero', free_win: 'minimal_ink_zero', unexpected_route: 'no_new_cell' };
    for (const claimedClass of CLASSES) {
      const r = check({ claimedClass, stored, candidate: structuredClone(stored.actions), spent: 0 });
      expect(r.outcome).toBe('rejected');
      expect(r.reasonCode).toBe(/** @type {Record<string, string>} */ (expected)[claimedClass]);
    }
  });

  it('editCount counts refused edits too', () => {
    const candidate = [{ ...EDIT_C3 }, { kind: 'edit', address: 'D4', raw: '=3' }, { ...MOVE_E }];
    const r = check({ claimedClass: 'unexpected_route', candidate, refused: [0], spent: 1 });
    expect(r.editCount).toBe(2);
    expect(r.newEditAddresses).toEqual(['D4']);
  });

  it('newEditAddresses is normalised, sorted (default string sort) and has no duplicates', () => {
    const candidate = [
      { kind: 'edit', address: 'C3', raw: '1' },
      { kind: 'edit', address: 'a2', raw: '1' },
      { kind: 'edit', address: 'A10', raw: '1' },
      { kind: 'edit', address: 'c3', raw: '2' },
      { kind: 'edit', address: ' A2 ', raw: '3' },
      { kind: 'edit', address: 'B14', raw: '4' },
      { ...MOVE_E },
    ];
    const r = check({ claimedClass: 'unexpected_route', candidate, spent: 1 });
    expect(r.newEditAddresses).toEqual(['A10', 'A2', 'C3']);
    expect(r.editCount).toBe(6);
  });

  it('a confirmed result carries exactly the Check_Result fields', () => {
    const r = check({ claimedClass: 'cheaper_win', spent: 0 });
    expect(Object.keys(r).sort()).toEqual(RESULT_KEYS);
    expect(r).toMatchObject({
      levelId: LEVEL,
      claimedClass: 'cheaper_win',
      outcome: 'confirmed',
      reasonCode: 'class_reproduced',
      won: true,
      inkSpent: 0,
      minimalInk: 1,
      editCount: 0,
      newEditAddresses: [],
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('a rejected result carries exactly the Check_Result fields', () => {
    const r = check({ claimedClass: 'free_win', candidate: [{ ...EDIT_B14 }, { ...MOVE_E }], spent: 1 });
    expect(Object.keys(r).sort()).toEqual(RESULT_KEYS);
    expect(r).toMatchObject({ levelId: LEVEL, claimedClass: 'free_win', outcome: 'rejected', reasonCode: 'has_edits', won: true, inkSpent: 1, minimalInk: 1, editCount: 1 });
  });

  it('does not change its arguments', () => {
    const args = build({ claimedClass: 'unexpected_route', candidate: [{ ...EDIT_C3 }, { kind: 'undo' }, { ...MOVE_E }], spent: 1 });
    const copy = structuredClone(args);
    checkCandidate(args[0], args[1], args[2], args[3], args[4], args[5]);
    expect(args).toEqual(copy);
  });

  it('the order of the stored edit actions does not change the outcome', () => {
    const stored = { levelId: LEVEL, minimalInk: 2, actions: [{ ...EDIT_B14 }, { kind: 'edit', address: 'B15', raw: '=2' }, { ...MOVE_E }] };
    const reversed = { ...stored, actions: [stored.actions[1], stored.actions[0], stored.actions[2]] };
    const candidate = [{ ...EDIT_C3 }, { kind: 'edit', address: 'B15', raw: '=2' }, { ...MOVE_E }];
    const a = check({ claimedClass: 'unexpected_route', stored, candidate, spent: 2 });
    const b = check({ claimedClass: 'unexpected_route', stored: reversed, candidate, spent: 2 });
    expect(b).toEqual(a);
  });
});

describe('checkCandidate: error outcomes', () => {
  it.each([['speed_run'], ['CHEAPER_WIN'], ['']])('unknown_class for the string %j (claimedClass is carried)', (claimedClass) => {
    expectCheckError(check({ claimedClass }), 'unknown_class', { levelId: LEVEL, claimedClass });
  });

  it.each([[undefined], [null], [5], [{}], [['cheaper_win']]])('unknown_class for %j (no claimedClass on the error)', (claimedClass) => {
    expectCheckError(check({}, (a) => { a[2] = claimedClass; }), 'unknown_class', { levelId: LEVEL });
  });

  it.each([[undefined], [null], ['move'], [{}], [7]])('malformed_candidate: candidate %j is not an array', (bad) => {
    expectCheckError(check({}, (a) => { a[3] = bad; }), 'malformed_candidate', { levelId: LEVEL, claimedClass: 'cheaper_win' });
  });

  it.each([
    [{ kind: 'teleport' }],
    [{ kind: 'move', dir: 'X' }],
    [{ kind: 'move' }],
    [{ kind: 'edit', address: 'B14' }],
    [null],
    ['move'],
  ])('malformed_candidate: a candidate action %j is not a known action', (bad) => {
    const r = check({}, (a) => { a[3].push(bad); });
    expectCheckError(r, 'malformed_candidate', { levelId: LEVEL, claimedClass: 'cheaper_win' });
  });

  it('replay_mismatch: the play is the replay of other actions', () => {
    const r = check({}, (a) => { a[3] = [{ ...MOVE_E }, { kind: 'wait' }]; });
    expectCheckError(r, 'replay_mismatch', { levelId: LEVEL, claimedClass: 'cheaper_win' });
  });

  it('replay_mismatch: a different step count', () => {
    expectCheckError(check({}, (a) => { a[5].steps.pop(); }), 'replay_mismatch', { levelId: LEVEL, claimedClass: 'cheaper_win' });
  });

  it('replay_mismatch: an address that differs only in case', () => {
    const r = check({ candidate: [{ ...EDIT_C3 }, { ...MOVE_E }] }, (a) => { a[5].steps[0].action.address = 'c3'; });
    expectCheckError(r, 'replay_mismatch', { levelId: LEVEL, claimedClass: 'cheaper_win' });
  });

  it('a step with only an extra field does not mismatch', () => {
    const r = check({}, (a) => {
      a[5].steps[0].action.extra = 1;
      a[5].steps[0].more = 'x';
    });
    expect(r.outcome).toBe('confirmed');
  });

  it('the steps are compared with the candidate, not with the stored actions', () => {
    const r = check({ claimedClass: 'free_win', candidate: [{ kind: 'wait' }, { kind: 'wait' }, { kind: 'wait' }, { kind: 'wait' }], spent: 1 });
    expect(r.outcome).toBe('confirmed');
  });

  it('bad_input for exit code 2, play_failed for exit code 1', () => {
    expectCheckError(check({ exitCode: 2 }), 'bad_input', { levelId: LEVEL, claimedClass: 'cheaper_win' });
    expectCheckError(check({ exitCode: 1 }), 'play_failed', { levelId: LEVEL, claimedClass: 'cheaper_win' });
  });

  it('malformed_play_result, level_mismatch and malformed_solution are shared with the replay verdict', () => {
    expectCheckError(check({}, (a) => { delete a[5].steps; }), 'malformed_play_result', { levelId: LEVEL, claimedClass: 'cheaper_win' });
    expectCheckError(check({}, (a) => { a[0] = 5; }), 'level_mismatch', { claimedClass: 'cheaper_win' });
    expectCheckError(check({}, (a) => { a[1].levelId = '01-the-corridor'; }), 'level_mismatch', { levelId: LEVEL, claimedClass: 'cheaper_win' });
    expectCheckError(check({}, (a) => { a[1].minimalInk = 1.5; }), 'malformed_solution', { levelId: LEVEL, claimedClass: 'cheaper_win' });
  });

  it('the order of checks: solution, class, candidate, mismatch', () => {
    // malformed solution wins over an unknown class
    expectCheckError(check({}, (a) => { a[1].minimalInk = -1; a[2] = 'speed_run'; }), 'malformed_solution', { levelId: LEVEL, claimedClass: 'speed_run' });
    // unknown class wins over a malformed candidate
    expectCheckError(check({}, (a) => { a[2] = 'speed_run'; a[3] = null; }), 'unknown_class', { levelId: LEVEL, claimedClass: 'speed_run' });
    // malformed candidate wins over a mismatch
    expectCheckError(check({}, (a) => { a[3].push({ kind: 'teleport' }); }), 'malformed_candidate', { levelId: LEVEL, claimedClass: 'cheaper_win' });
  });
});

describe('checkCandidate: measured-class text on rejections', () => {
  it('exactly one other class applies: "Measured class: X."', () => {
    // no edits and the win spends exactly minimalInk: not cheaper, but a free_win
    const r = check({ claimedClass: 'cheaper_win', spent: 1 });
    expect(r.reasonCode).toBe('not_cheaper');
    expect(r.reason).toMatch(/ Measured class: free_win\.$/);
  });

  it('exactly one other class applies (unexpected_route)', () => {
    const r = check({ claimedClass: 'cheaper_win', candidate: [{ ...EDIT_C3 }, { ...MOVE_E }], spent: 1 });
    expect(r.reasonCode).toBe('not_cheaper');
    expect(r.reason).toMatch(/ Measured class: unexpected_route\.$/);
  });

  it('no other class applies: "Measured class: none."', () => {
    const r = check({ claimedClass: 'free_win', candidate: [{ ...EDIT_B14 }, { ...MOVE_E }], spent: 1 });
    expect(r.reasonCode).toBe('has_edits');
    expect(r.reason).toMatch(/ Measured class: none\.$/);
  });

  it('two other classes apply: "Measured classes: A and B."', () => {
    // an edit on a new cell and less ink than minimalInk: cheaper_win and unexpected_route
    const r = check({ claimedClass: 'free_win', candidate: [{ ...EDIT_C3 }, { ...MOVE_E }], spent: 0 });
    expect(r.reasonCode).toBe('has_edits');
    expect(r.reason).toMatch(/ Measured classes: cheaper_win and unexpected_route\.$/);
  });

  it('two other classes apply (cheaper_win and free_win)', () => {
    const r = check({ claimedClass: 'unexpected_route', spent: 0 });
    expect(r.reasonCode).toBe('no_new_cell');
    expect(r.reason).toMatch(/ Measured classes: cheaper_win and free_win\.$/);
  });

  it('the reason code stays the claimed-class code', () => {
    expect(check({ claimedClass: 'cheaper_win', spent: 1 }).reasonCode).toBe('not_cheaper');
    expect(check({ claimedClass: 'free_win', candidate: [{ ...EDIT_C3 }, { ...MOVE_E }], spent: 0 }).reasonCode).toBe('has_edits');
    expect(check({ claimedClass: 'unexpected_route', spent: 0 }).reasonCode).toBe('no_new_cell');
  });

  it('not_won, minimal_ink_zero, no_ink_below_zero and confirmed results carry no suffix', () => {
    const zero = { levelId: LEVEL, minimalInk: 0, actions: [{ ...MOVE_E }] };
    expect(check({ claimedClass: 'cheaper_win', endStatus: 'lost' }).reason).not.toMatch(/Measured/);
    expect(check({ claimedClass: 'free_win', stored: zero }).reason).not.toMatch(/Measured/);
    expect(check({ claimedClass: 'cheaper_win', stored: zero }).reason).not.toMatch(/Measured/);
    expect(check({ claimedClass: 'cheaper_win', spent: 0 }).reason).not.toMatch(/Measured/);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 7.1: the safety net. A throwing getter forces an internal fault; the result is an error value.
// ---------------------------------------------------------------------------------------------

const boom = () => {
  throw new Error('boom');
};

describe('checkCandidate: safety net (internal_error)', () => {
  /** @type {[string, (a: any[]) => void][]} */
  const throwers = [
    ['play.start', (a) => Object.defineProperty(a[5], 'start', { get: boom, enumerable: true })],
    ['play.final', (a) => Object.defineProperty(a[5], 'final', { get: boom, enumerable: true })],
    ['play.steps', (a) => Object.defineProperty(a[5], 'steps', { get: boom, enumerable: true })],
    ['stored.actions', (a) => Object.defineProperty(a[1], 'actions', { get: boom, enumerable: true })],
    ['a candidate action', (a) => Object.defineProperty(a[3], '0', { get: boom, enumerable: true })],
  ];

  it.each(throwers)('a throwing %s getter gives internal_error, not a throw', (_name, makeThrow) => {
    const a = build({ claimedClass: 'free_win' });
    makeThrow(a);
    expect(() => checkCandidate(a[0], a[1], a[2], a[3], a[4], a[5])).not.toThrow();
    const r = checkCandidate(a[0], a[1], a[2], a[3], a[4], a[5]);
    expectCheckError(r, 'internal_error', { levelId: LEVEL, claimedClass: 'free_win' });
    expect(/** @type {any} */ (r).reason).toBe('The verifier hit an internal fault.');
  });

  it('the error carries claimedClass only when it is a string', () => {
    for (const claimedClass of [5, null, undefined, {}]) {
      const a = build({});
      Object.defineProperty(a[5], 'start', { get: boom, enumerable: true });
      a[2] = claimedClass;
      expectCheckError(checkCandidate(a[0], a[1], a[2], a[3], a[4], a[5]), 'internal_error', { levelId: LEVEL });
    }
    const a = build({});
    Object.defineProperty(a[5], 'start', { get: boom, enumerable: true });
    a[2] = 'speed_run';
    expectCheckError(checkCandidate(a[0], a[1], a[2], a[3], a[4], a[5]), 'internal_error', { levelId: LEVEL, claimedClass: 'speed_run' });
  });

  it('the error carries levelId when the argument is a string', () => {
    const a = build({});
    Object.defineProperty(a[5], 'start', { get: boom, enumerable: true });
    const r = /** @type {any} */ (checkCandidate('01-the-corridor', a[1], a[2], a[3], a[4], a[5]));
    expect(r.levelId).toBe('01-the-corridor');
  });

  it('a non-string levelId is judged before any input is read: level_mismatch, no levelId, no throw', () => {
    // Nothing is read from the other arguments before the levelId check, so internal_error cannot be
    // forced with a non-string levelId; the omission of levelId is covered by the typeof check.
    const a = build({});
    Object.defineProperty(a[5], 'start', { get: boom, enumerable: true });
    expectCheckError(checkCandidate(5, a[1], a[2], a[3], a[4], a[5]), 'level_mismatch', { claimedClass: 'cheaper_win' });
  });
});

// ---------------------------------------------------------------------------------------------
// Task 8.1: audit additions. Requirement 5 reason codes and the replay_mismatch cases, for the
// candidate check (the replay-verdict file already holds them for replayVerdict).
// ---------------------------------------------------------------------------------------------

describe('checkCandidate: audit additions', () => {
  const expected = { levelId: LEVEL, claimedClass: 'free_win' };

  it('level_mismatch when the play levelId differs from the argument', () => {
    expectCheckError(check({ claimedClass: 'free_win' }, (a) => { a[5].levelId = '01-the-corridor'; }), 'level_mismatch', expected);
  });

  it.each([[2], [1], ['0'], [null], [undefined], [Number.NaN]])('exit code %j is bad_input or play_failed', (exitCode) => {
    const r = check({ claimedClass: 'free_win' }, (a) => { a[4] = exitCode; });
    expectCheckError(r, exitCode === 2 ? 'bad_input' : 'play_failed', expected);
  });

  /** @type {[string, (a: any[]) => void][]} */
  const malformedPlays = [
    ['final.ink is NaN', (a) => { a[5].final.ink = Number.NaN; }],
    ['start.ink is infinite', (a) => { a[5].start.ink = Number.POSITIVE_INFINITY; }],
    ['final.hp is not a number', (a) => { a[5].final.hp = '3'; }],
    ['final.status is not a string', (a) => { a[5].final.status = 1; }],
    ['start is missing', (a) => { delete a[5].start; }],
    ['final is missing', (a) => { delete a[5].final; }],
    ['steps is not an array', (a) => { a[5].steps = {}; }],
    ['a step is not an object', (a) => { a[5].steps[0] = null; }],
    ['a step has no object action', (a) => { a[5].steps[0].action = 'move'; }],
    ['a step has a non-boolean accepted', (a) => { a[5].steps[0].accepted = 1; }],
    ['ink spent is negative', (a) => { a[5].final.ink = a[5].start.ink + 1; }],
    ['the play result is missing', (a) => { a[5] = undefined; }],
  ];

  it.each(malformedPlays)('malformed_play_result: %s', (_name, change) => {
    expectCheckError(check({ claimedClass: 'free_win' }, change), 'malformed_play_result', expected);
  });

  /** @type {[string, (a: any[]) => void][]} */
  const malformedSolutions = [
    ['a stored action of unknown kind', (a) => { a[1].actions.push({ kind: 'teleport' }); }],
    ['minimalInk -1', (a) => { a[1].minimalInk = -1; }],
    ['stored actions missing', (a) => { delete a[1].actions; }],
    ['the stored solution is missing', (a) => { a[1] = undefined; }],
  ];

  it.each(malformedSolutions)('malformed_solution: %s', (_name, change) => {
    expectCheckError(check({ claimedClass: 'free_win' }, change), 'malformed_solution', expected);
  });

  const withEdit = { candidate: [{ ...EDIT_C3 }, { ...MOVE_E }], claimedClass: 'free_win' };

  it('replay_mismatch: a changed dir', () => {
    expectCheckError(check(withEdit, (a) => { a[5].steps[1].action.dir = 'W'; }), 'replay_mismatch', expected);
  });

  it('replay_mismatch: a changed kind', () => {
    expectCheckError(check(withEdit, (a) => { a[5].steps[1].action = { kind: 'wait' }; }), 'replay_mismatch', expected);
  });

  it('replay_mismatch: a changed raw', () => {
    expectCheckError(check(withEdit, (a) => { a[5].steps[0].action.raw = '=other'; }), 'replay_mismatch', expected);
  });

  it('replay_mismatch: an extra step', () => {
    expectCheckError(check(withEdit, (a) => { a[5].steps.push({ ...a[5].steps[1], index: 2 }); }), 'replay_mismatch', expected);
  });

  it('a stored action with an extra field does not mismatch', () => {
    const r = check({ claimedClass: 'free_win', spent: 1 }, (a) => { a[1].actions[0].note = 'x'; });
    expect(r.outcome).toBe('confirmed');
  });

  it('a mismatch is reported before any class decision, even for a lost run', () => {
    expectCheckError(check({ claimedClass: 'free_win', endStatus: 'lost' }, (a) => { a[5].steps.pop(); }), 'replay_mismatch', expected);
  });

  it('a win that is also a lost-run class claim is judged on the claimed class only', () => {
    // free_win claimed, the replay is a cheaper_win too (0 ink spent): still confirmed as free_win
    const r = check({ claimedClass: 'free_win', spent: 0 });
    expect(r.outcome).toBe('confirmed');
    expect(r.claimedClass).toBe('free_win');
  });
});

// Added after a mutation check: dropping `&& minimalInk > 0` from the free_win test used for the
// measured-class text left every test passing. With minimalInk 0, a no-edit win is not a free_win.
describe('checkCandidate: measured-class text when minimalInk is 0', () => {
  it('a no-edit win with minimalInk 0 is not named as a free_win: "Measured class: none."', () => {
    const stored = { levelId: LEVEL, minimalInk: 0, actions: [{ ...MOVE_E }, { ...MOVE_E }] };
    const r = check({ claimedClass: 'unexpected_route', stored, candidate: [{ ...MOVE_E }, { ...MOVE_E }], spent: 0 });
    expect(r.outcome).toBe('rejected');
    expect(r.reasonCode).toBe('no_new_cell');
    expect(r.won).toBe(true);
    expect(r.editCount).toBe(0);
    expect(r.reason).toMatch(/ Measured class: none\.$/);
  });
});
