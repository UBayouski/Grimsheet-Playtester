// @ts-check
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { replayVerdict as replayVerdictTyped, checkCandidate as checkCandidateTyped } from '../scripts/verifier.mjs';
import {
  BREAKERS,
  CLASSES,
  arbAction,
  arbAddress,
  arbAnything,
  arbCandidateInput,
  arbCandidateInputBroken,
  arbCandidateInputFor,
  arbCandidateInputMixed,
  arbLevelId,
  arbPlayFor,
  arbReplayInput,
  arbReplayInputBroken,
  arbReplayInputFor,
  arbReplayInputMixed,
  arbStored,
} from './arbitraries.mjs';

const NUM_RUNS = 200;

// The properties read fields of both outcome shapes, so the results are typed loosely here.
const replayVerdict = /** @type {(...args: any[]) => any} */ (replayVerdictTyped);
const checkCandidate = /** @type {(...args: any[]) => any} */ (checkCandidateTyped);

/**
 * Deep clone that keeps each object's prototype. `structuredClone` turns the null-prototype objects
 * that fast-check builds into plain objects, which `toStrictEqual` then reports as different.
 * @param {any} value
 * @returns {any}
 */
function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (typeof value !== 'object' || value === null) return value;
  const copy = Object.create(Object.getPrototypeOf(value));
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, { value: deepClone(value[key]), enumerable: true, writable: true, configurable: true });
  }
  return copy;
}
/**
 * Calls the verifier function named by `fn`.
 * @param {'replay'|'check'} fn
 * @param {any[]} args
 * @returns {any}
 */
function call(fn, args) {
  return fn === 'replay'
    ? replayVerdict(args[0], args[1], args[2], args[3])
    : checkCandidate(args[0], args[1], args[2], args[3], args[4], args[5]);
}

/**
 * Every kind of call: valid, partly broken (with breakers) and arbitrary arguments, for both functions.
 * @type {fc.Arbitrary<{fn: 'replay'|'check', args: any[]}>}
 */
const arbCall = fc.oneof(
  arbReplayInputMixed.map(({ args }) => ({ fn: /** @type {'replay'} */ ('replay'), args })),
  arbCandidateInputMixed.map(({ args }) => ({ fn: /** @type {'check'} */ ('check'), args })),
  arbAnything.map((args) => ({ fn: /** @type {'replay'} */ ('replay'), args: args.slice(0, 4) })),
  arbAnything.map((args) => ({ fn: /** @type {'check'} */ ('check'), args })),
);

// Feature: verifier, Property 1: Determinism
describe('Property 1: Determinism', () => {
  it('two calls with deeply equal cloned arguments return deeply equal results', () => {
    fc.assert(
      fc.property(arbCall, ({ fn, args }) => {
        const first = call(fn, deepClone(args));
        const second = call(fn, deepClone(args));
        expect(second).toStrictEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 2: Verdicts are JSON-safe and inputs are untouched
describe('Property 2: Verdicts are JSON-safe and inputs are untouched', () => {
  it('the result survives a JSON round trip and the arguments are not changed', () => {
    fc.assert(
      fc.property(arbCall, ({ fn, args }) => {
        const before = deepClone(args);
        const result = call(fn, args);
        expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
        expect(args).toStrictEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 3: Colour matches won and ink
describe('Property 3: Colour matches won and ink', () => {
  it('green, amber and red follow won and the ink spent, and exactly one applies', () => {
    fc.assert(
      fc.property(arbReplayInput, ([levelId, stored, exitCode, play]) => {
        const r = replayVerdict(levelId, stored, exitCode, play);
        const won = play.final.status === 'won';
        const spent = play.start.ink - play.final.ink;
        expect(['green', 'amber', 'red']).toContain(r.colour);
        if (r.colour === 'green') {
          expect(won).toBe(true);
          expect(spent).toBe(stored.minimalInk);
        }
        if (r.colour === 'amber') {
          expect(won).toBe(true);
          expect(spent).not.toBe(stored.minimalInk);
        }
        if (r.colour === 'red') expect(won).toBe(false);
        // the three conditions are disjoint and cover every valid input
        const holds = [won && spent === stored.minimalInk, won && spent !== stored.minimalInk, !won];
        expect(holds.filter(Boolean)).toHaveLength(1);
        expect(r.colour).toBe(['green', 'amber', 'red'][holds.indexOf(true)]);
        // the reported measures are the measured ones
        expect(r.won).toBe(won);
        expect(r.inkSpent).toBe(spent);
        expect(r.minimalInk).toBe(stored.minimalInk);
        expect(r.endHp).toBe(play.final.hp);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

/**
 * The Step `action` echo for an action: only kind, dir (move), address and raw (edit).
 * @param {any} a
 * @returns {any}
 */
function echo(a) {
  if (a.kind === 'move') return { kind: 'move', dir: a.dir };
  if (a.kind === 'edit') return { kind: 'edit', address: a.address, raw: a.raw };
  return { kind: a.kind };
}

// Feature: verifier, Property 4: Refusals do not change the colour
describe('Property 4: Refusals do not change the colour', () => {
  it('inserting a refused step (and its action) keeps the colour and sets refusedAt', () => {
    fc.assert(
      fc.property(
        arbReplayInputFor(fc.constant(/** @type {'won'} */ ('won'))),
        arbAction,
        fc.nat(),
        ([levelId, stored, exitCode, play], action, positionSeed) => {
          const before = replayVerdict(levelId, stored, exitCode, play);
          expect(before.colour === 'green' || before.colour === 'amber').toBe(true);
          const pos = positionSeed % (stored.actions.length + 1);
          const stored2 = deepClone(stored);
          stored2.actions.splice(pos, 0, deepClone(action));
          const play2 = deepClone(play);
          const prev = pos === 0 ? play.start : play.steps[pos - 1];
          play2.steps.splice(pos, 0, {
            index: pos,
            action: echo(action),
            accepted: false,
            reason: 'refused-for-test',
            message: 'The action was refused.',
            damage: [],
            hero: prev.hero,
            hp: prev.hp,
            ink: prev.ink,
            turn: prev.turn,
            status: prev.status,
          });
          play2.steps.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
            s.index = i;
          });
          const firstRefused = play2.steps.findIndex((/** @type {any} */ s) => s.accepted === false);
          play2.refusedAt = firstRefused;
          const after = replayVerdict(levelId, stored2, exitCode, play2);
          expect(after.colour).toBe(before.colour);
          expect(after.refusedAt).toBe(firstRefused);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 5: Confirmed only when the replay reproduces the class
describe('Property 5: Confirmed only when the replay reproduces the class', () => {
  it('a confirmed result is won and meets the definition of the claimed class', () => {
    fc.assert(
      fc.property(arbCandidateInput, ([levelId, stored, claimedClass, candidate, exitCode, play]) => {
        const r = checkCandidate(levelId, stored, claimedClass, candidate, exitCode, play);
        expect(['confirmed', 'rejected']).toContain(r.outcome);
        const won = play.final.status === 'won';
        const spent = play.start.ink - play.final.ink;
        const edits = candidate.filter((/** @type {any} */ a) => a.kind === 'edit').length;
        expect(r.editCount).toBe(edits);
        expect(r.inkSpent).toBe(spent);
        expect(r.minimalInk).toBe(stored.minimalInk);
        expect(r.won).toBe(won);
        if (r.outcome === 'confirmed') {
          expect(won).toBe(true);
          expect(r.reasonCode).toBe('class_reproduced');
          if (claimedClass === 'free_win') {
            expect(r.editCount).toBe(0);
            expect(r.minimalInk).toBeGreaterThan(0);
          }
          if (claimedClass === 'cheaper_win') expect(r.inkSpent).toBeLessThan(r.minimalInk);
          if (claimedClass === 'unexpected_route') expect(r.newEditAddresses.length).toBeGreaterThan(0);
        }
        // and the other way round: a won replay that meets the definition is confirmed
        const meets =
          won &&
          ((claimedClass === 'cheaper_win' && spent < stored.minimalInk) ||
            (claimedClass === 'free_win' && edits === 0 && stored.minimalInk > 0) ||
            (claimedClass === 'unexpected_route' && r.newEditAddresses.length > 0));
        expect(r.outcome === 'confirmed').toBe(meets);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 6: Not won is never confirmed
describe('Property 6: Not won is never confirmed', () => {
  it('a play that did not win is rejected with not_won for any claimed class', () => {
    fc.assert(
      fc.property(
        arbCandidateInputFor(fc.constantFrom(/** @type {'lost'|'other'} */ ('lost'), /** @type {'lost'|'other'} */ ('other'))),
        ([levelId, stored, claimedClass, candidate, exitCode, play]) => {
          const r = checkCandidate(levelId, stored, claimedClass, candidate, exitCode, play);
          expect(r.outcome).toBe('rejected');
          expect(r.reasonCode).toBe('not_won');
          expect(r.won).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 7: Copy of the stored solution is rejected
describe('Property 7: Copy of the stored solution is rejected', () => {
  it('a candidate that copies the stored actions, with a green replay, is rejected for every class', () => {
    // Domain: in Grimsheet only an accepted edit spends ink (1 ink per edit; undo refunds it), so a green
    // replay of a stored solution with minimalInk above 0 contains at least one edit. The stored solution
    // is built that way: when minimalInk is above 0 and it has no edit, one edit is put in front.
    // This is a construction, not a filter, and `arbStored` itself is unchanged.
    const arbEdit = fc.record({ kind: fc.constant('edit'), address: arbAddress, raw: fc.string({ maxLength: 8 }) });
    const arbCoherentStored = (/** @type {string} */ levelId) =>
      fc.tuple(arbStored(levelId), arbEdit).map(([stored, edit]) =>
        stored.minimalInk > 0 && !stored.actions.some((/** @type {any} */ a) => a.kind === 'edit')
          ? { ...stored, actions: [edit, ...stored.actions] }
          : stored,
      );
    const arbGreenCopy = arbLevelId.chain((levelId) =>
      arbCoherentStored(levelId).chain((stored) =>
        arbPlayFor(levelId, stored.actions, 'won', stored.minimalInk, ['equal']).map((play) => ({ levelId, stored, play })),
      ),
    );
    fc.assert(
      fc.property(arbGreenCopy, ({ levelId, stored, play }) => {
        // the replay is green: won, ink spent equal to minimalInk
        expect(replayVerdict(levelId, stored, 0, play).colour).toBe('green');
        for (const claimedClass of CLASSES) {
          const r = checkCandidate(levelId, stored, claimedClass, deepClone(stored.actions), 0, play);
          expect(r.outcome).toBe('rejected');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 8: Edit order in the stored solution does not matter
describe('Property 8: Edit order in the stored solution does not matter', () => {
  it('permuting the edit actions of the stored solution does not change the result', () => {
    fc.assert(
      fc.property(
        arbCandidateInput,
        fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
        ([levelId, stored, claimedClass, candidate, exitCode, play], keys) => {
          const positions = stored.actions
            .map((/** @type {any} */ a, /** @type {number} */ i) => (a.kind === 'edit' ? i : -1))
            .filter((/** @type {number} */ i) => i >= 0);
          const edits = positions.map((/** @type {number} */ i) => stored.actions[i]);
          const order = /** @type {number[]} */ (edits.map((/** @type {any} */ _, /** @type {number} */ k) => k)).sort(
            (/** @type {number} */ a, /** @type {number} */ b) => keys[a] - keys[b] || a - b,
          );
          const permuted = deepClone(stored);
          positions.forEach((/** @type {number} */ pos, /** @type {number} */ k) => {
            permuted.actions[pos] = deepClone(edits[order[k]]);
          });
          const before = checkCandidate(levelId, stored, claimedClass, candidate, exitCode, play);
          const after = checkCandidate(levelId, permuted, claimedClass, candidate, exitCode, play);
          expect(after).toStrictEqual(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 9: Address case does not matter
describe('Property 9: Address case does not matter', () => {
  it('changing the case and padding of the stored addresses does not change the result', () => {
    /** @type {Array<(a: string) => string>} */
    const transforms = [(a) => a, (a) => a.toLowerCase(), (a) => `  ${a} `, (a) => `\t${a.toLowerCase()}`];
    fc.assert(
      fc.property(
        arbCandidateInput,
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 12, maxLength: 12 }),
        ([levelId, stored, claimedClass, candidate, exitCode, play], modes) => {
          const changed = deepClone(stored);
          changed.actions.forEach((/** @type {any} */ a, /** @type {number} */ i) => {
            if (a.kind === 'edit') a.address = transforms[modes[i]](a.address);
          });
          const before = checkCandidate(levelId, stored, claimedClass, candidate, exitCode, play);
          const after = checkCandidate(levelId, changed, claimedClass, candidate, exitCode, play);
          expect(after).toStrictEqual(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

/**
 * Independent model of the new-cell rule: normalised addresses of accepted edits that are not undone by
 * the next accepted step, minus the cells the stored solution edits, sorted.
 * @param {any} stored
 * @param {any[]} steps
 * @returns {string[]}
 */
function modelNewEditAddresses(stored, steps) {
  const norm = (/** @type {string} */ a) => a.trim().toUpperCase();
  const storedCells = new Set(stored.actions.filter((/** @type {any} */ a) => a.kind === 'edit').map((/** @type {any} */ a) => norm(a.address)));
  const kept = new Set();
  steps.forEach((s, i) => {
    if (s.action.kind !== 'edit' || !s.accepted) return;
    let next = i + 1;
    while (next < steps.length && !steps[next].accepted) next += 1;
    const undone = next < steps.length && steps[next].action.kind === 'undo';
    if (!undone) kept.add(norm(s.action.address));
  });
  return [...kept].filter((a) => !storedCells.has(a)).sort();
}

// Feature: verifier, Property 10: Undone and refused edits are not new cells
describe('Property 10: Undone and refused edits are not new cells', () => {
  it('newEditAddresses lists only kept accepted edits on cells the stored solution never edits, sorted, no duplicates', () => {
    fc.assert(
      fc.property(arbCandidateInput, ([levelId, stored, claimedClass, candidate, exitCode, play]) => {
        const r = checkCandidate(levelId, stored, claimedClass, candidate, exitCode, play);
        expect(r.outcome === 'confirmed' || r.outcome === 'rejected').toBe(true);
        expect(r.newEditAddresses).toStrictEqual(modelNewEditAddresses(stored, play.steps));
        expect(r.newEditAddresses).toStrictEqual([...new Set(r.newEditAddresses)].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Inserts steps (and their actions) at a position of a valid candidate input; the inserted steps take
   * the status, hp and ink of the step before them. Returns the new arguments and the first inserted index.
   * @param {any[]} input
   * @param {number} position
   * @param {Array<{action: any, accepted: boolean}>} inserted
   */
  function insertSteps(input, position, inserted) {
    const [levelId, stored, claimedClass, candidate, exitCode, play] = input;
    const candidate2 = deepClone(candidate);
    const play2 = deepClone(play);
    const pos = position % (candidate.length + 1);
    const prev = pos === 0 ? play.start : play.steps[pos - 1];
    candidate2.splice(pos, 0, ...inserted.map((x) => deepClone(x.action)));
    play2.steps.splice(
      pos,
      0,
      ...inserted.map((x) => {
        /** @type {any} */
        const step = { index: pos, action: echo(x.action), accepted: x.accepted };
        if (!x.accepted) {
          step.reason = 'refused-for-test';
          step.message = 'The action was refused.';
        }
        return { ...step, damage: [], hero: prev.hero, hp: prev.hp, ink: prev.ink, turn: prev.turn, status: prev.status };
      }),
    );
    play2.steps.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      s.index = i;
    });
    const first = play2.steps.findIndex((/** @type {any} */ s) => s.accepted === false);
    if (first >= 0) play2.refusedAt = first;
    else delete play2.refusedAt;
    return [levelId, stored, claimedClass, candidate2, exitCode, play2];
  }

  const NEW_CELL = { kind: 'edit', address: 'Z9', raw: '=9' };

  it('an accepted edit, any refused steps, then an accepted undo never lists the cell (Z9 is outside the grid)', () => {
    fc.assert(
      fc.property(arbCandidateInput, fc.nat(), fc.integer({ min: 0, max: 3 }), (input, position, refusedBetween) => {
        const inserted = [
          { action: NEW_CELL, accepted: true },
          ...Array.from({ length: refusedBetween }, () => ({ action: { kind: 'wait' }, accepted: false })),
          { action: { kind: 'undo' }, accepted: true },
        ];
        const args = insertSteps(input, position, inserted);
        const r = checkCandidate(args[0], args[1], args[2], args[3], args[4], args[5]);
        expect(r.newEditAddresses).not.toContain('Z9');
        expect(r.newEditAddresses).toStrictEqual(modelNewEditAddresses(args[1], args[5].steps));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a refused edit never lists the cell', () => {
    fc.assert(
      fc.property(arbCandidateInput, fc.nat(), (input, position) => {
        const args = insertSteps(input, position, [{ action: NEW_CELL, accepted: false }]);
        const r = checkCandidate(args[0], args[1], args[2], args[3], args[4], args[5]);
        expect(r.newEditAddresses).not.toContain('Z9');
        expect(r.editCount).toBe(args[3].filter((/** @type {any} */ a) => a.kind === 'edit').length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 11: Bad input gives an error, never a throw
const REASON_CODES = [
  'bad_input', 'play_failed', 'malformed_play_result', 'level_mismatch', 'malformed_solution', 'unknown_class',
  'malformed_candidate', 'replay_mismatch', 'internal_error', 'class_reproduced', 'not_won', 'no_ink_below_zero',
  'minimal_ink_zero', 'not_cheaper', 'has_edits', 'no_new_cell',
];

/**
 * @param {any} r
 * @param {'replay'|'check'} fn
 */
function expectValidOutcome(r, fn) {
  expect(typeof r).toBe('object');
  expect(r).not.toBeNull();
  const kind = fn === 'replay' ? r.colour : r.outcome;
  expect(fn === 'replay' ? ['green', 'amber', 'red', 'error'] : ['confirmed', 'rejected', 'error']).toContain(kind);
  expect(REASON_CODES).toContain(r.reasonCode ?? 'class_reproduced');
  if (kind === 'error') {
    expect(typeof r.reasonCode).toBe('string');
    expect(typeof r.reason).toBe('string');
  }
}

describe('Property 11: Bad input gives an error, never a throw', () => {
  it('arbitrary values in every argument position never throw and give a valid outcome', () => {
    fc.assert(
      fc.property(arbAnything, (args) => {
        expectValidOutcome(replayVerdict(args[0], args[1], args[2], args[3]), 'replay');
        expectValidOutcome(checkCandidate(args[0], args[1], args[2], args[3], args[4], args[5]), 'check');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a broken replay input gives the reason code its breaker names', () => {
    fc.assert(
      fc.property(arbReplayInputBroken, ({ args, expectedCode }) => {
        const r = replayVerdict(args[0], args[1], args[2], args[3]);
        expect(r.colour).toBe('error');
        expect(r.reasonCode).toBe(expectedCode);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a broken candidate input gives the reason code its breaker names', () => {
    fc.assert(
      fc.property(arbCandidateInputBroken, ({ args, expectedCode }) => {
        const r = checkCandidate(args[0], args[1], args[2], args[3], args[4], args[5]);
        expect(r.outcome).toBe('error');
        expect(r.reasonCode).toBe(expectedCode);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a mixed stream: broken inputs give their code, unbroken ones give no error', () => {
    fc.assert(
      fc.property(arbReplayInputMixed, arbCandidateInputMixed, (replay, candidate) => {
        const r = replayVerdict(replay.args[0], replay.args[1], replay.args[2], replay.args[3]);
        if (replay.expectedCode === null) expect(r.colour).not.toBe('error');
        else expect(r.reasonCode).toBe(replay.expectedCode);
        const c = checkCandidate(candidate.args[0], candidate.args[1], candidate.args[2], candidate.args[3], candidate.args[4], candidate.args[5]);
        if (candidate.expectedCode === null) expect(c.outcome).not.toBe('error');
        else expect(c.reasonCode).toBe(candidate.expectedCode);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Deterministic companion to Property 11: one test per breaker, applied to fixed valid inputs, so a
// breaker that random sampling rarely draws is still checked.
describe('Property 11 (deterministic): every breaker gives its reason code on a fixed valid input', () => {
  const FIXED_LEVEL = '02-the-chaser';

  /**
   * A play that replays `actions`: one ink spent, ends won.
   * @param {any[]} actions
   * @returns {any}
   */
  function fixedPlay(actions) {
    const n = actions.length;
    const steps = actions.map((/** @type {any} */ a, /** @type {number} */ i) => ({
      index: i,
      action: echo(a),
      accepted: true,
      damage: [],
      hero: 'B6',
      hp: 3,
      ink: 0,
      turn: i + 1,
      status: i === n - 1 ? 'won' : 'playing',
    }));
    return {
      levelId: FIXED_LEVEL,
      start: { hero: 'B6', hp: 3, ink: 1, turn: 0, status: 'playing', monsters: [] },
      steps,
      final: { hero: 'B6', hp: 3, ink: 0, turn: n, status: 'won', monsters: [] },
      sheet: [],
    };
  }

  /** @returns {any} */
  function fixedStored() {
    return {
      levelId: FIXED_LEVEL,
      minimalInk: 1,
      actions: [
        { kind: 'edit', address: 'B14', raw: '=1' },
        { kind: 'move', dir: 'E' },
        { kind: 'wait' },
        { kind: 'move', dir: 'E' },
      ],
    };
  }

  /** The fixed replay input as a breaker context (no claimed class, no candidate). @returns {any} */
  function replayCtx() {
    const stored = fixedStored();
    return { levelId: FIXED_LEVEL, stored, claimedClass: undefined, candidate: undefined, exitCode: 0, play: fixedPlay(stored.actions) };
  }

  /** The fixed candidate input: an edit on a new cell, so the address and step breakers apply. @returns {any} */
  function candidateCtx() {
    const candidate = [
      { kind: 'edit', address: 'C3', raw: '=2' },
      { kind: 'move', dir: 'E' },
      { kind: 'move', dir: 'E' },
    ];
    return { levelId: FIXED_LEVEL, stored: fixedStored(), claimedClass: 'unexpected_route', candidate, exitCode: 0, play: fixedPlay(candidate) };
  }

  it('the fixed inputs are valid', () => {
    const r = replayCtx();
    expect(replayVerdict(r.levelId, r.stored, r.exitCode, r.play).colour).toBe('green');
    const c = candidateCtx();
    const result = checkCandidate(c.levelId, c.stored, c.claimedClass, c.candidate, c.exitCode, c.play);
    expect(result.outcome).toBe('confirmed');
    expect(result.newEditAddresses).toEqual(['C3']);
  });

  it('the breaker names are unique and there are 20 of them', () => {
    expect(new Set(BREAKERS.map((b) => b.name)).size).toBe(BREAKERS.length);
    expect(BREAKERS).toHaveLength(20);
  });

  it.each(BREAKERS.map((b) => [b.name, b]))('breaker %s', (_name, breaker) => {
    const b = /** @type {import('./arbitraries.mjs').Breaker} */ (breaker);
    const onReplay = b.scope === 'both' && b.applies(replayCtx());
    const onCandidate = b.applies(candidateCtx());
    expect(onReplay || onCandidate).toBe(true);
    if (onReplay) {
      const ctx = replayCtx();
      b.apply(ctx);
      const r = replayVerdict(ctx.levelId, ctx.stored, ctx.exitCode, ctx.play);
      expect(r.colour).toBe('error');
      expect(r.reasonCode).toBe(b.code);
    }
    if (onCandidate) {
      const ctx = candidateCtx();
      b.apply(ctx);
      const r = checkCandidate(ctx.levelId, ctx.stored, ctx.claimedClass, ctx.candidate, ctx.exitCode, ctx.play);
      expect(r.outcome).toBe('error');
      expect(r.reasonCode).toBe(b.code);
    }
  });
});

// Feature: verifier, Property 12: Mismatched steps are an error
describe('Property 12: Mismatched steps are an error', () => {
  const KINDS = ['move', 'wait', 'edit', 'undo'];
  const DIRECTIONS = ['N', 'S', 'E', 'W'];

  /**
   * Applies one mutation to the steps of a play: change one step action (kind, dir, address or raw),
   * drop a step, or add a step. With no steps only "add" is possible.
   * @param {any} play
   * @param {{op: 'change'|'drop'|'add', at: number, tweak: number}} m
   */
  function mutate(play, m) {
    const steps = play.steps;
    const n = steps.length;
    if (n === 0 || m.op === 'add') {
      steps.splice(n === 0 ? 0 : m.at % (n + 1), 0, { index: 0, action: { kind: 'wait' }, accepted: true, status: 'playing' });
      return;
    }
    const i = m.at % n;
    if (m.op === 'drop') {
      steps.splice(i, 1);
      return;
    }
    const action = steps[i].action;
    if (m.tweak % 2 === 1 && action.kind === 'move') {
      action.dir = DIRECTIONS[(DIRECTIONS.indexOf(action.dir) + 1 + (m.tweak % 3)) % 4];
    } else if (m.tweak % 2 === 1 && action.kind === 'edit') {
      if (m.tweak % 4 === 1) action.address = `${action.address}x`;
      else action.raw = `${action.raw}x`;
    } else {
      steps[i].action = { kind: KINDS[(KINDS.indexOf(action.kind) + 1 + (m.tweak % 3)) % 4] };
    }
  }

  const arbMutation = fc.record({
    op: fc.constantFrom(/** @type {'change'|'drop'|'add'} */ ('change'), /** @type {'change'|'drop'|'add'} */ ('drop'), /** @type {'change'|'drop'|'add'} */ ('add')),
    at: fc.nat(),
    tweak: fc.nat(),
  });

  it('a replay verdict with a changed, dropped or added step is replay_mismatch', () => {
    fc.assert(
      fc.property(arbReplayInput, arbMutation, ([levelId, stored, exitCode, play], m) => {
        const broken = deepClone(play);
        mutate(broken, m);
        const r = replayVerdict(levelId, stored, exitCode, broken);
        expect(r.colour).toBe('error');
        expect(r.reasonCode).toBe('replay_mismatch');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a candidate check with a changed, dropped or added step is replay_mismatch', () => {
    fc.assert(
      fc.property(arbCandidateInput, arbMutation, ([levelId, stored, claimedClass, candidate, exitCode, play], m) => {
        const broken = deepClone(play);
        mutate(broken, m);
        const r = checkCandidate(levelId, stored, claimedClass, candidate, exitCode, broken);
        expect(r.outcome).toBe('error');
        expect(r.reasonCode).toBe('replay_mismatch');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 13: Status change index is valid
describe('Property 13: Status change index is valid', () => {
  const STATUSES = ['playing', 'won', 'lost', 'dead'];

  /** Valid replay inputs whose start status and step statuses vary. @type {fc.Arbitrary<any[]>} */
  const arbVariedStatus = arbReplayInput.chain(([levelId, stored, exitCode, play]) =>
    fc
      .tuple(
        fc.constantFrom(...STATUSES),
        fc.array(fc.constantFrom(...STATUSES), { minLength: play.steps.length, maxLength: play.steps.length }),
      )
      .map(([startStatus, statuses]) => {
        const varied = deepClone(play);
        varied.start.status = startStatus;
        statuses.forEach((status, i) => {
          varied.steps[i].status = status;
        });
        if (statuses.length > 0) varied.final.status = statuses[statuses.length - 1];
        return [levelId, stored, exitCode, varied];
      }),
  );

  it('statusChangeIndex is null or the first position whose step status differs from the one before', () => {
    fc.assert(
      fc.property(arbVariedStatus, ([levelId, stored, exitCode, play]) => {
        const r = replayVerdict(levelId, stored, exitCode, play);
        expect(r.colour).not.toBe('error');
        /** @type {string[]} */
        const statuses = [play.start.status, ...play.steps.map((/** @type {any} */ s) => s.status)];
        const expected = statuses.findIndex((s, i) => i > 0 && s !== statuses[i - 1]);
        const index = r.statusChangeIndex;
        if (index === null) {
          // no step changes the status (also true for empty steps)
          expect(expected).toBe(-1);
          return;
        }
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(play.steps.length);
        const before = index === 0 ? play.start.status : play.steps[index - 1].status;
        expect(play.steps[index].status).not.toBe(before);
        // no earlier step changes the status
        for (let j = 0; j < index; j += 1) {
          const prev = j === 0 ? play.start.status : play.steps[j - 1].status;
          expect(play.steps[j].status).toBe(prev);
        }
        expect(index).toBe(expected - 1);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: verifier, Property 14: Generated inputs never reach the safety net
describe('Property 14: Generated inputs never reach the safety net', () => {
  it('valid, broken and arbitrary inputs never give internal_error', () => {
    fc.assert(
      fc.property(arbCall, ({ fn, args }) => {
        const r = call(fn, args);
        expect(r.reasonCode).not.toBe('internal_error');
      }),
      { numRuns: 300 },
    );
  });

  it('valid replay and candidate inputs never give internal_error', () => {
    fc.assert(
      fc.property(arbReplayInput, arbCandidateInput, (replay, candidate) => {
        expect(replayVerdict(replay[0], replay[1], replay[2], replay[3]).reasonCode).not.toBe('internal_error');
        expect(checkCandidate(candidate[0], candidate[1], candidate[2], candidate[3], candidate[4], candidate[5]).reasonCode).not.toBe('internal_error');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('broken inputs and arbitrary values never give internal_error', () => {
    fc.assert(
      fc.property(arbReplayInputBroken, arbCandidateInputBroken, arbAnything, (replay, candidate, anything) => {
        const results = [
          replayVerdict(replay.args[0], replay.args[1], replay.args[2], replay.args[3]),
          checkCandidate(candidate.args[0], candidate.args[1], candidate.args[2], candidate.args[3], candidate.args[4], candidate.args[5]),
          replayVerdict(anything[0], anything[1], anything[2], anything[3]),
          checkCandidate(anything[0], anything[1], anything[2], anything[3], anything[4], anything[5]),
        ];
        for (const r of results) expect(r.reasonCode).not.toBe('internal_error');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
