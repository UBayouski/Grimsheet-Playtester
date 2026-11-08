// @ts-check
import { describe, it, expect } from 'vitest';
import { replayVerdict } from '../scripts/verifier.mjs';

const LEVEL = '01-the-corridor';

/** A fresh valid input: a stored solution of two moves and the play that replays it. */
function validArgs() {
  const stored = {
    levelId: LEVEL,
    minimalInk: 0,
    actions: [
      { kind: 'move', dir: 'E' },
      { kind: 'move', dir: 'E' },
    ],
  };
  const play = {
    levelId: LEVEL,
    start: { hero: 'B6', hp: 3, ink: 0, turn: 0, status: 'playing', monsters: [] },
    steps: [
      { index: 0, action: { kind: 'move', dir: 'E' }, accepted: true, damage: [], hero: 'C6', hp: 3, ink: 0, turn: 1, status: 'playing' },
      { index: 1, action: { kind: 'move', dir: 'E' }, accepted: true, damage: [], hero: 'D6', hp: 3, ink: 0, turn: 2, status: 'won' },
    ],
    final: { hero: 'D6', hp: 3, ink: 0, turn: 2, status: 'won', monsters: [] },
  };
  return { levelId: LEVEL, stored, exitCode: 0, play };
}

/**
 * Calls replayVerdict with a valid input after `change` has edited it, and returns the result as any.
 * @param {(a: any) => void} change
 * @returns {any}
 */
function run(change) {
  const a = /** @type {any} */ (validArgs());
  change(a);
  return replayVerdict(a.levelId, a.stored, a.exitCode, a.play);
}

/**
 * @param {any} result
 * @param {string} code
 * @param {unknown} [levelId]
 */
function expectError(result, code, levelId) {
  expect(result.colour).toBe('error');
  expect(result.reasonCode).toBe(code);
  expect(typeof result.reason).toBe('string');
  expect(result.reason.length).toBeGreaterThan(0);
  expect('outcome' in result).toBe(false);
  if (typeof levelId === 'string') {
    expect(result.levelId).toBe(levelId);
  } else {
    expect('levelId' in result).toBe(false);
  }
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
}

describe('replayVerdict: validation error codes', () => {
  describe('level_mismatch', () => {
    it.each([[undefined], [null], [5], [{}]])('levelId argument %j is not a string', (bad) => {
      const r = run((a) => { a.levelId = bad; });
      expectError(r, 'level_mismatch');
    });

    it('play levelId differs from the argument', () => {
      const r = run((a) => { a.play.levelId = '02-the-chaser'; });
      expectError(r, 'level_mismatch', LEVEL);
    });

    it('stored solution levelId differs from the argument', () => {
      const r = run((a) => { a.stored.levelId = '02-the-chaser'; });
      expectError(r, 'level_mismatch', LEVEL);
    });
  });

  describe('bad_input and play_failed', () => {
    it('exit code 2 is bad_input', () => {
      expectError(run((a) => { a.exitCode = 2; }), 'bad_input', LEVEL);
    });

    it.each([[1], [-1], [3], [127]])('exit code %j is play_failed', (code) => {
      expectError(run((a) => { a.exitCode = code; }), 'play_failed', LEVEL);
    });

    it.each([['0'], [null], [undefined], [true], [Number.NaN]])('exit code %j (not the number 0) is play_failed', (code) => {
      expectError(run((a) => { a.exitCode = code; }), 'play_failed', LEVEL);
    });
  });

  describe('malformed_play_result', () => {
    it.each([[undefined], [null], ['play'], [7], [[]]])('play result %j is missing or not an object', (bad) => {
      expectError(run((a) => { a.play = bad; }), 'malformed_play_result', LEVEL);
    });

    it.each([['start'], ['final'], ['steps']])('play result lacks %s', (field) => {
      expectError(run((a) => { delete a.play[field]; }), 'malformed_play_result', LEVEL);
    });

    it.each([['start'], ['final']])('%s is not an object', (field) => {
      expectError(run((a) => { a.play[field] = 'x'; }), 'malformed_play_result', LEVEL);
    });

    it('steps is not an array', () => {
      expectError(run((a) => { a.play.steps = {}; }), 'malformed_play_result', LEVEL);
    });

    it.each([[Number.NaN], [Number.POSITIVE_INFINITY], ['1'], [null], [undefined]])('start.ink %j is not a finite number', (bad) => {
      expectError(run((a) => { a.play.start.ink = bad; }), 'malformed_play_result', LEVEL);
    });

    it.each([[Number.NaN], [Number.NEGATIVE_INFINITY], ['0'], [null], [undefined]])('final.ink %j is not a finite number', (bad) => {
      expectError(run((a) => { a.play.final.ink = bad; }), 'malformed_play_result', LEVEL);
    });

    it.each([[Number.NaN], [Number.POSITIVE_INFINITY], ['3'], [null], [undefined]])('final.hp %j is not a finite number', (bad) => {
      expectError(run((a) => { a.play.final.hp = bad; }), 'malformed_play_result', LEVEL);
    });

    it.each([[undefined], [null], [1], [{}]])('final.status %j is not a string', (bad) => {
      expectError(run((a) => { a.play.final.status = bad; }), 'malformed_play_result', LEVEL);
    });

    it.each([[null], ['step'], [3], [[]]])('a step that is %j is not an object', (bad) => {
      expectError(run((a) => { a.play.steps[1] = bad; }), 'malformed_play_result', LEVEL);
    });

    it.each([[undefined], [null], ['move'], [4]])('a step with action %j has no object action', (bad) => {
      expectError(run((a) => { a.play.steps[0].action = bad; }), 'malformed_play_result', LEVEL);
    });

    it.each([[undefined], [null], ['true'], [1], [0]])('a step with accepted %j is not a boolean', (bad) => {
      expectError(run((a) => { a.play.steps[0].accepted = bad; }), 'malformed_play_result', LEVEL);
    });

    it('a negative ink spent', () => {
      expectError(run((a) => { a.play.final.ink = a.play.start.ink + 1; }), 'malformed_play_result', LEVEL);
    });
  });

  describe('malformed_solution', () => {
    it.each([[undefined], [null], ['solution'], [7], [[]]])('stored solution %j is missing or not an object', (bad) => {
      expectError(run((a) => { a.stored = bad; }), 'malformed_solution', LEVEL);
    });

    it('stored solution lacks actions', () => {
      expectError(run((a) => { delete a.stored.actions; }), 'malformed_solution', LEVEL);
    });

    it('stored actions is not an array', () => {
      expectError(run((a) => { a.stored.actions = {}; }), 'malformed_solution', LEVEL);
    });

    it.each([[-1], [1.5], ['1'], [null], [undefined], [Number.NaN]])('minimalInk %j is not a non-negative integer', (bad) => {
      expectError(run((a) => { a.stored.minimalInk = bad; }), 'malformed_solution', LEVEL);
    });

    it.each([
      [{ kind: 'teleport' }],
      [{ kind: 'move', dir: 'X' }],
      [{ kind: 'move' }],
      [{ kind: 'edit', address: 'B14' }],
      [{ kind: 'edit', raw: '1' }],
      [null],
      ['move'],
    ])('a stored action %j is not a known action', (bad) => {
      expectError(run((a) => { a.stored.actions.push(bad); }), 'malformed_solution', LEVEL);
    });
  });

  describe('order of checks', () => {
    it('exit code 2 wins over a malformed play result', () => {
      expectError(run((a) => { a.exitCode = 2; a.play = null; }), 'bad_input', LEVEL);
    });

    it('a non-string levelId wins over exit code 2', () => {
      expectError(run((a) => { a.levelId = 5; a.exitCode = 2; }), 'level_mismatch');
    });

    it('a malformed play result wins over a play level mismatch', () => {
      expectError(run((a) => { delete a.play.steps; a.play.levelId = '02-the-chaser'; }), 'malformed_play_result', LEVEL);
    });

    it('a play level mismatch wins over a malformed solution', () => {
      expectError(run((a) => { a.play.levelId = '02-the-chaser'; a.stored.minimalInk = -1; }), 'level_mismatch', LEVEL);
    });

    it('a malformed solution wins over a solution level mismatch', () => {
      expectError(run((a) => { a.stored.levelId = '02-the-chaser'; delete a.stored.actions; }), 'malformed_solution', LEVEL);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Task 5.1: replay verdict (colour, refusedAt, statusChangeIndex, replay_mismatch)
// ---------------------------------------------------------------------------------------------

const MOVE_E = { kind: 'move', dir: 'E' };

/**
 * Builds a valid replay input: a stored solution and the play that replays it. Steps echo the actions.
 * Statuses are `playing` except the last step, which gets `endStatus` (default `won`).
 * @param {{actions?: any[], minimalInk?: number, startInk?: number, endInk?: number, endStatus?: string,
 *   statuses?: string[], startStatus?: string, endHp?: number, refused?: number[], playRefusedAt?: unknown}} [o]
 * @returns {any[]} [levelId, stored, exitCode, play]
 */
function build(o = {}) {
  const actions = o.actions ?? [MOVE_E, MOVE_E, MOVE_E];
  const n = actions.length;
  const endStatus = o.endStatus ?? 'won';
  const startInk = o.startInk ?? 0;
  const endInk = o.endInk ?? 0;
  const endHp = o.endHp ?? 3;
  const statuses = o.statuses ?? actions.map((_, i) => (i === n - 1 ? endStatus : 'playing'));
  const refused = o.refused ?? [];
  /** @type {any[]} */
  const steps = actions.map((a, i) => {
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
      step.reason = 'nothing-to-undo';
      step.message = 'There is nothing to undo.';
    }
    step.damage = [];
    step.hero = 'B6';
    step.hp = endHp;
    step.ink = i === n - 1 ? endInk : startInk;
    step.turn = i + 1;
    step.status = statuses[i];
    return step;
  });
  const last = steps[n - 1];
  /** @type {any} */
  const play = {
    levelId: LEVEL,
    start: { hero: 'B6', hp: endHp, ink: startInk, turn: 0, status: o.startStatus ?? 'playing', monsters: [] },
    steps,
    final: { hero: 'B6', hp: endHp, ink: endInk, turn: n, status: last ? last.status : endStatus, monsters: [] },
  };
  if ('playRefusedAt' in o) play.refusedAt = o.playRefusedAt;
  else if (refused.length > 0) play.refusedAt = Math.min(...refused);
  const stored = { levelId: LEVEL, minimalInk: o.minimalInk ?? 0, actions: structuredClone(actions) };
  return [LEVEL, stored, 0, play];
}

/**
 * @param {Parameters<typeof build>[0]} [o]
 * @param {(args: any[]) => void} [change] edits the built arguments before the call
 * @returns {any}
 */
function verdict(o, change) {
  const args = build(o);
  if (change) change(args);
  return replayVerdict(args[0], args[1], args[2], args[3]);
}

describe('replayVerdict: colour', () => {
  it('green: won, ink spent equals minimalInk', () => {
    const v = verdict({ minimalInk: 1, startInk: 2, endInk: 1 });
    expect(v).toEqual({
      levelId: LEVEL,
      colour: 'green',
      won: true,
      endHp: 3,
      inkSpent: 1,
      minimalInk: 1,
      statusChangeIndex: 2,
      refusedAt: null,
    });
  });

  it('green: won with no ink spent and minimalInk 0', () => {
    const v = verdict({ minimalInk: 0 });
    expect(v.colour).toBe('green');
    expect(v.inkSpent).toBe(0);
  });

  it('amber: won with more ink than minimalInk', () => {
    const v = verdict({ minimalInk: 1, startInk: 3, endInk: 0 });
    expect(v.colour).toBe('amber');
    expect(v.won).toBe(true);
    expect(v.inkSpent).toBe(3);
    expect(v.minimalInk).toBe(1);
  });

  it('amber: won with less ink than minimalInk', () => {
    const v = verdict({ minimalInk: 2, startInk: 2, endInk: 1 });
    expect(v.colour).toBe('amber');
    expect(v.inkSpent).toBe(1);
  });

  it('red: not won, ink spent equals minimalInk', () => {
    const v = verdict({ minimalInk: 1, startInk: 2, endInk: 1, endStatus: 'lost' });
    expect(v.colour).toBe('red');
    expect(v.won).toBe(false);
  });

  it('red: not won, ink spent differs from minimalInk', () => {
    const v = verdict({ minimalInk: 1, startInk: 4, endInk: 0, endStatus: 'lost' });
    expect(v.colour).toBe('red');
    expect(v.inkSpent).toBe(4);
  });

  it('red: the run is still in progress at the end', () => {
    const v = verdict({ endStatus: 'playing' });
    expect(v.colour).toBe('red');
    expect(v.won).toBe(false);
  });

  it('reports endHp from final.hp', () => {
    expect(verdict({ endHp: 1 }).endHp).toBe(1);
  });

  it('has exactly the eight verdict fields', () => {
    const v = verdict({});
    expect(Object.keys(v).sort()).toEqual(
      ['colour', 'endHp', 'inkSpent', 'levelId', 'minimalInk', 'refusedAt', 'statusChangeIndex', 'won'],
    );
  });

  it('does not change its arguments', () => {
    const args = build({ minimalInk: 1, startInk: 2, endInk: 1, refused: [1] });
    const copy = structuredClone(args);
    replayVerdict(args[0], args[1], args[2], args[3]);
    expect(args).toEqual(copy);
  });
});

describe('replayVerdict: refusedAt', () => {
  it('a refused step in a win keeps the colour and sets refusedAt', () => {
    const v = verdict({ minimalInk: 0, refused: [1] });
    expect(v.colour).toBe('green');
    expect(v.won).toBe(true);
    expect(v.refusedAt).toBe(1);
  });

  it('with several refusals refusedAt is the first one', () => {
    const v = verdict({ refused: [2, 1] });
    expect(v.refusedAt).toBe(1);
  });

  it('a refused step does not turn an amber into a green', () => {
    const v = verdict({ minimalInk: 1, startInk: 3, endInk: 0, refused: [0] });
    expect(v.colour).toBe('amber');
    expect(v.refusedAt).toBe(0);
  });

  it('is null when no step was refused', () => {
    expect(verdict({}).refusedAt).toBeNull();
  });

  it.each([[-1], [1.5], ['1'], [null], [Number.NaN], [undefined]])(
    'a play refusedAt of %j falls back to the first step with accepted false',
    (bad) => {
      const v = verdict({ refused: [2], playRefusedAt: bad });
      expect(v.refusedAt).toBe(2);
    },
  );

  it.each([[-1], [1.5], ['1'], [null], [undefined]])(
    'a play refusedAt of %j with no refused step falls back to null',
    (bad) => {
      const v = verdict({ playRefusedAt: bad });
      expect(v.refusedAt).toBeNull();
    },
  );

  it('uses a valid play refusedAt as given', () => {
    const v = verdict({ playRefusedAt: 0 });
    expect(v.refusedAt).toBe(0);
  });
});

describe('replayVerdict: statusChangeIndex', () => {
  it('is null for empty steps', () => {
    const v = verdict({ actions: [], endStatus: 'playing' });
    expect(v.statusChangeIndex).toBeNull();
    expect(v.colour).toBe('red');
  });

  it('is null when no step changes the status', () => {
    expect(verdict({ endStatus: 'playing' }).statusChangeIndex).toBeNull();
  });

  it('is the zero-based position of the first change', () => {
    expect(verdict({ actions: [MOVE_E, MOVE_E, MOVE_E, MOVE_E], statuses: ['playing', 'playing', 'lost', 'lost'] }).statusChangeIndex).toBe(2);
  });

  it('counts a change at position 0 against start.status', () => {
    expect(verdict({ actions: [MOVE_E], endStatus: 'won' }).statusChangeIndex).toBe(0);
  });

  it('compares the first step with start.status', () => {
    expect(verdict({ startStatus: 'ready', endStatus: 'playing' }).statusChangeIndex).toBe(0);
  });

  it('reports only the first change', () => {
    const v = verdict({ actions: [MOVE_E, MOVE_E, MOVE_E, MOVE_E], statuses: ['playing', 'won', 'playing', 'won'] });
    expect(v.statusChangeIndex).toBe(1);
  });
});

describe('replayVerdict: replay_mismatch', () => {
  it('fewer steps than stored actions', () => {
    expectError(verdict({}, (a) => { a[3].steps.pop(); }), 'replay_mismatch', LEVEL);
  });

  it('more steps than stored actions', () => {
    expectError(verdict({}, (a) => { a[3].steps.push({ ...a[3].steps[0], index: 3 }); }), 'replay_mismatch', LEVEL);
  });

  it('empty steps against a non-empty stored list', () => {
    expectError(verdict({}, (a) => { a[3].steps = []; }), 'replay_mismatch', LEVEL);
  });

  it('a step with only an extra field does not mismatch', () => {
    const v = verdict({}, (a) => {
      a[3].steps[0].extraField = 'x';
      a[3].steps[0].action.extra = 1;
    });
    expect(v.colour).toBe('green');
  });

  it('a stored action with an extra field does not mismatch', () => {
    const v = verdict({}, (a) => { a[1].actions[0].note = 'x'; });
    expect(v.colour).toBe('green');
  });

  const EDIT = { kind: 'edit', address: 'B14', raw: '=1' };

  it('an address that differs only in case mismatches (step lower case)', () => {
    const v = verdict({ actions: [EDIT, MOVE_E], minimalInk: 1, startInk: 1, endInk: 0 }, (a) => { a[3].steps[0].action.address = 'b14'; });
    expectError(v, 'replay_mismatch', LEVEL);
  });

  it('an address that differs only in case mismatches (stored lower case)', () => {
    const v = verdict({ actions: [EDIT, MOVE_E], minimalInk: 1, startInk: 1, endInk: 0 }, (a) => { a[1].actions[0].address = 'b14'; });
    expectError(v, 'replay_mismatch', LEVEL);
  });

  it('an address with padding mismatches (no normalisation)', () => {
    const v = verdict({ actions: [EDIT, MOVE_E], minimalInk: 1, startInk: 1, endInk: 0 }, (a) => { a[3].steps[0].action.address = ' B14'; });
    expectError(v, 'replay_mismatch', LEVEL);
  });

  it('a changed raw mismatches', () => {
    const v = verdict({ actions: [EDIT, MOVE_E], minimalInk: 1, startInk: 1, endInk: 0 }, (a) => { a[3].steps[0].action.raw = '=2'; });
    expectError(v, 'replay_mismatch', LEVEL);
  });

  it('a changed dir mismatches', () => {
    expectError(verdict({}, (a) => { a[3].steps[1].action.dir = 'W'; }), 'replay_mismatch', LEVEL);
  });

  it('a changed kind mismatches', () => {
    expectError(verdict({}, (a) => { a[3].steps[2].action = { kind: 'wait' }; }), 'replay_mismatch', LEVEL);
  });

  it('a mismatch is reported before any colour, even for a lost run', () => {
    const v = verdict({ endStatus: 'lost' }, (a) => { a[3].steps.pop(); });
    expectError(v, 'replay_mismatch', LEVEL);
  });

  it('an edit that matches exactly gives a colour', () => {
    const v = verdict({ actions: [EDIT, MOVE_E], minimalInk: 1, startInk: 1, endInk: 0 });
    expect(v.colour).toBe('green');
  });
});

// ---------------------------------------------------------------------------------------------
// Task 7.1: the safety net. A throwing getter forces an internal fault; the result is an error value.
// ---------------------------------------------------------------------------------------------

const boom = () => {
  throw new Error('boom');
};

describe('replayVerdict: safety net (internal_error)', () => {
  /** @type {[string, (a: any) => void][]} */
  const throwers = [
    ['play.start', (a) => Object.defineProperty(a.play, 'start', { get: boom, enumerable: true })],
    ['play.final', (a) => Object.defineProperty(a.play, 'final', { get: boom, enumerable: true })],
    ['play.steps', (a) => Object.defineProperty(a.play, 'steps', { get: boom, enumerable: true })],
    ['stored.actions', (a) => Object.defineProperty(a.stored, 'actions', { get: boom, enumerable: true })],
    ['stored.minimalInk', (a) => Object.defineProperty(a.stored, 'minimalInk', { get: boom, enumerable: true })],
  ];

  it.each(throwers)('a throwing %s getter gives internal_error, not a throw', (_name, makeThrow) => {
    const a = /** @type {any} */ (validArgs());
    makeThrow(a);
    expect(() => replayVerdict(a.levelId, a.stored, a.exitCode, a.play)).not.toThrow();
    const r = replayVerdict(a.levelId, a.stored, a.exitCode, a.play);
    expectError(r, 'internal_error', LEVEL);
    expect(/** @type {any} */ (r).reason).toBe('The verifier hit an internal fault.');
  });

  it('a throwing getter on a step action gives internal_error', () => {
    const a = /** @type {any} */ (validArgs());
    Object.defineProperty(a.play.steps[0], 'action', { get: boom, enumerable: true });
    expectError(replayVerdict(a.levelId, a.stored, a.exitCode, a.play), 'internal_error', LEVEL);
  });

  it('the internal_error result carries levelId because the argument is a string', () => {
    const a = /** @type {any} */ (validArgs());
    Object.defineProperty(a.play, 'start', { get: boom, enumerable: true });
    const r = /** @type {any} */ (replayVerdict('01-the-corridor', a.stored, a.exitCode, a.play));
    expect(r.levelId).toBe('01-the-corridor');
  });

  it('a non-string levelId is judged before any input is read: level_mismatch, no levelId, no throw', () => {
    // Nothing is read from the other arguments before the levelId check, so internal_error cannot be
    // forced with a non-string levelId; the omission of levelId is covered by errorOutcome's typeof check.
    const a = /** @type {any} */ (validArgs());
    Object.defineProperty(a.play, 'start', { get: boom, enumerable: true });
    expectError(replayVerdict(5, a.stored, a.exitCode, a.play), 'level_mismatch');
  });
});
